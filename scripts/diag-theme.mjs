/**
 * 主题首绘验证脚本（开发辅助，零依赖，Node 22+）。
 *
 * 验证 theme-boot.js 在样式表之前同步套用主题，消除暗色模式跳转闪白。
 * 判定法：把 localStorage 镜像设为与 settings 相反的值——首帧出现的主题
 * 若等于镜像值，只可能来自 boot 脚本（模块 initTheme 读取的是 settings）。
 *
 *   1. 仪表盘设置 theme='dark' → localStorage 镜像应写入 'dark'；
 *   2. settings=dark + 镜像=dark：时间线页首帧应为 dark（用户场景）；
 *   3. settings=auto + 清镜像 + 模拟系统暗色：首帧 dark（matchMedia 现场解析），
 *      模块套用后 data-theme 应清空、镜像回写保留 'auto' 原值；
 *   4. settings=light + 镜像=dark + 模拟系统暗色：首帧 dark（boot），
 *      模块套用后修正为 light —— 证明 boot 先于模块。
 *
 * 运行：node scripts/diag-theme.mjs
 */

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profile = mkdtempSync(join(tmpdir(), 'zhishi-theme-'));

const BROWSER = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9335;

const browser = spawn(
  BROWSER,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--load-extension=${root}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,900',
    '--window-position=-32000,-32000',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await sleep(300);
    }
  }
  throw new Error(`等待 ${label} 超时：${lastErr?.message ?? lastErr}`);
}

async function targets() {
  return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('WebSocket 连接失败')));
  });

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP ${method} 超时`));
      }, 20_000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

  return { opened, send, close: () => ws.close() };
}

async function evaluate(c, expression, label = '') {
  const tag = label ? ` [${label}]` : '';
  const result = await c.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`evaluate${tag} 失败：${result.exceptionDetails.exception?.description ?? ''}`);
  }
  return result.result?.value;
}

/** 打开新标签页，返回连接（finally 里由调用方关闭）。 */
async function openPage() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' });
  const target = await res.json();
  const c = connect(target.webSocketDebuggerUrl);
  await c.opened;
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  return { c, targetId: target.id };
}

async function closePage(targetId) {
  await fetch(`http://127.0.0.1:${PORT}/json/close/${targetId}`).catch(() => {});
}

/**
 * 导航后高频轮询（无 sleep，逐次 CDP 往返），返回主题首次出现的快照。
 * boot 是 head 中的阻塞经典脚本：它执行时解析尚未结束（readyState=loading），
 * 而 deferred 模块最早也要到 interactive 才运行，二者在快照上可区分。
 */
async function firstPaintTheme(c, url) {
  await c.send('Page.navigate', { url });
  for (let i = 0; i < 4000; i++) {
    try {
      const theme = await evaluate(
        c,
        `document.documentElement.dataset.theme ?? ''`,
        '首绘轮询'
      );
      if (theme) {
        const ready = await evaluate(c, `document.readyState`, '首绘轮询');
        return { theme, ready };
      }
    } catch {
      // 新文档上下文尚未建立，继续
    }
  }
  throw new Error('首绘主题捕获超时');
}

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${label} → ${ok ? '✓' : '✗'}${detail ? `（${detail}）` : ''}`);
  if (!ok) failures += 1;
};

const DASH = (extId) => `chrome-extension://${extId}/src/pages/dashboard.html`;
const TIMELINE = (extId) => `chrome-extension://${extId}/src/pages/timeline.html`;

try {
  await until(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, 20_000, '调试端口');

  const swTarget = await until(async () => {
    const list = await targets();
    const sw = list.find(
      (t) =>
        t.type === 'service_worker' &&
        t.url.startsWith('chrome-extension://') &&
        t.url.endsWith('/src/background/service-worker.js')
    );
    if (!sw) throw new Error('尚未发现扩展 service worker');
    return sw;
  }, 30_000, '扩展 service worker');
  const extId = new URL(swTarget.url).host;
  console.log(`扩展 ID：${extId}`);

  // 1. 仪表盘设置暗色主题 → 检查镜像。
  {
    const { c, targetId } = await openPage();
    try {
      await c.send('Page.navigate', { url: DASH(extId) });
      await until(async () => {
        const { result } = await c.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        });
        if (result.value !== 'complete') throw new Error(String(result.value));
        return true;
      }, 15_000, '仪表盘加载');
      const out = await evaluate(
        c,
        `(async () => {
          const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
          await saveSettings({ theme: 'dark' });
          await new Promise((r) => setTimeout(r, 600));
          return {
            mirror: localStorage.getItem('zhishi-theme'),
            attr: document.documentElement.dataset.theme ?? '',
          };
        })()`,
        '设置暗色'
      );
      check('暗色主题落盘 + localStorage 镜像', out.attr === 'dark' && out.mirror === 'dark', JSON.stringify(out));
    } finally {
      c.close();
      await closePage(targetId);
    }
  }

  // 2. 用户场景：settings=dark + 镜像=dark → 时间线首绘即暗色。
  {
    const { c, targetId } = await openPage();
    try {
      const snap = await firstPaintTheme(c, TIMELINE(extId));
      check('时间线首绘即暗色', snap.theme === 'dark', `首现 theme=${snap.theme} readyState=${snap.ready}`);
      const finalAttr = await evaluate(
        c,
        `Promise.resolve(document.documentElement.dataset.theme ?? '')`,
        '终态'
      );
      check('时间线终态保持暗色', finalAttr === 'dark', `data-theme=${finalAttr}`);
      check(
        'boot 脚本先于样式表（head 顺序）',
        await evaluate(
          c,
          `(() => {
            const boot = document.head.querySelector('script[src="theme-boot.js"]');
            const css = document.head.querySelector('link[rel="stylesheet"]');
            return !!boot && !!css && Boolean(boot.compareDocumentPosition(css) & Node.DOCUMENT_POSITION_FOLLOWING);
          })()`,
          'head 顺序'
        )
      );
    } finally {
      c.close();
      await closePage(targetId);
    }
  }

  // 3. auto 路径：settings=auto + 清镜像 + 系统暗色 → boot 现场解析为 dark。
  {
    const { c: setup, targetId: setupId } = await openPage();
    try {
      await setup.send('Page.navigate', { url: DASH(extId) });
      await until(async () => {
        const { result } = await setup.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        });
        if (result.value !== 'complete') throw new Error(String(result.value));
        return true;
      }, 15_000, '设置页加载');
      await evaluate(
        setup,
        `(async () => {
          const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
          await saveSettings({ theme: 'auto' });
          await new Promise((r) => setTimeout(r, 600));
          localStorage.removeItem('zhishi-theme');
          return true;
        })()`,
        '切回 auto'
      );
    } finally {
      setup.close();
      await closePage(setupId);
    }

    const { c, targetId } = await openPage();
    try {
      await c.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: 'dark' }],
      });
      const snap = await firstPaintTheme(c, DASH(extId));
      check('auto + 系统暗色 → 首绘暗色', snap.theme === 'dark', `首现 theme=${snap.theme} readyState=${snap.ready}`);
      await sleep(900); // 等 initTheme 套用
      const after = await evaluate(
        c,
        `({ attr: document.documentElement.dataset.theme ?? '', mirror: localStorage.getItem('zhishi-theme') })`,
        'auto 终态'
      );
      check('auto 终态交回媒体查询、镜像保留原值', after.attr === '' && after.mirror === 'auto', JSON.stringify(after));
    } finally {
      c.close();
      await closePage(targetId);
    }
  }

  // 4. 反证 boot 先于模块：settings=light + 镜像=dark → 首帧 dark（boot），终态 light（模块）。
  {
    const { c: setup, targetId: setupId } = await openPage();
    try {
      await setup.send('Page.navigate', { url: DASH(extId) });
      await until(async () => {
        const { result } = await setup.send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        });
        if (result.value !== 'complete') throw new Error(String(result.value));
        return true;
      }, 15_000, '设置页加载');
      await evaluate(
        setup,
        `(async () => {
          const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
          await saveSettings({ theme: 'light' });
          await new Promise((r) => setTimeout(r, 600));
          localStorage.setItem('zhishi-theme', 'dark');
          return true;
        })()`,
        '镜像与设置相反'
      );
    } finally {
      setup.close();
      await closePage(setupId);
    }

    const { c, targetId } = await openPage();
    try {
      const snap = await firstPaintTheme(c, TIMELINE(extId));
      check('镜像先于设置生效（boot 先于模块）', snap.theme === 'dark', `首现 theme=${snap.theme} readyState=${snap.ready}`);
      await sleep(900);
      const finalAttr = await evaluate(c, `document.documentElement.dataset.theme ?? ''`, '终态');
      check('模块随后按设置修正为 light', finalAttr === 'light', `data-theme=${finalAttr}`);
    } finally {
      c.close();
      await closePage(targetId);
    }
  }

  console.log(failures === 0 ? '\n主题首绘验证全部通过' : `\n${failures} 项未通过`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  browser.kill();
  await sleep(500);
  browser.kill('SIGKILL');
}
