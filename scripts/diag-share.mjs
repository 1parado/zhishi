/**
 * 分享卡片专项验证脚本（开发辅助，零依赖，Node 22+）。
 *
 * 无头启动 Edge 加载本扩展，然后：
 *   1. 灌入 140 天演示数据；
 *   2. 打开仪表盘分享弹窗，依次生成 年度 / 日报 / 周报 三种卡片并导出全尺寸 PNG；
 *   3. 走真实资料编辑流：输入昵称、经 file input 上传头像、切换「显示我的信息」；
 *   4. 校验 settings.profile 落盘与卡片重绘。
 *
 * 运行：node scripts/diag-share.mjs
 * 输出：verify/share-*.png 与控制台检查结果。
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'verify');
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), 'zhishi-profile-'));

const BROWSER = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;

const browser = spawn(
  BROWSER,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--load-extension=${root}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,1000',
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
      await sleep(400);
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

async function withPage(url, urlPart, fn) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' });
  const target = await res.json();
  const c = connect(target.webSocketDebuggerUrl);
  await c.opened;
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Page.navigate', { url });
  try {
    await until(async () => {
      const { result } = await c.send('Runtime.evaluate', {
        expression: `location.href.includes(${JSON.stringify(urlPart)}) && document.readyState`,
        returnByValue: true,
      });
      if (result.value !== 'complete') throw new Error(String(result.value));
      return true;
    }, 15_000, `加载 ${urlPart}`);
    return await fn(c);
  } finally {
    c.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
  }
}

async function evaluate(c, expression, label = '') {
  const tag = label ? ` [${label}]` : '';
  let result;
  try {
    result = await c.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
  } catch (err) {
    throw new Error(`evaluate${tag} 失败：${err.message}`);
  }
  if (result.exceptionDetails) {
    throw new Error(
      `evaluate${tag} 失败：${result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)}`
    );
  }
  return result.result?.value;
}

async function screenshot(c, filename) {
  await sleep(400);
  const { data } = await c.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  writeFileSync(join(outDir, filename), Buffer.from(data, 'base64'));
  console.log(`截图 ${filename}`);
}

/** 把弹窗预览 img 的 data URL 保存为全尺寸 PNG。 */
async function savePreviewCard(c, filename) {
  const dataUrl = await evaluate(
    c,
    `document.getElementById('sharePreview').src`,
    'preview-src'
  );
  if (!dataUrl?.startsWith('data:image/png;base64,')) {
    throw new Error(`sharePreview 不是 PNG data URL：${String(dataUrl).slice(0, 60)}`);
  }
  writeFileSync(join(outDir, filename), Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
  console.log(`导出卡片 ${filename}`);
}

try {
  await until(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, 20_000, '调试端口');
  console.log('调试端口就绪');

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

  // 1. 演示数据（__seedDemo 结尾刷新页面，上下文销毁属预期）。
  await withPage(`chrome-extension://${extId}/src/pages/dashboard.html`, 'dashboard.html', async (c) => {
    await evaluate(c, 'window.__seedDemo().catch(() => {})').catch(() => {});
  });
  await sleep(1500);
  console.log('已灌入 140 天演示数据');

  // 2. 打开分享弹窗，遍历三种卡片。
  await withPage(`chrome-extension://${extId}/src/pages/dashboard.html`, 'dashboard.html', async (c) => {
    // 年度卡（原有入口）
    await evaluate(c, `document.getElementById('shareCardBtn').click()`, '打开弹窗(年度)');
    await sleep(900);
    const modalShown = await evaluate(c, `!document.getElementById('shareModal').hidden`);
    console.log(`分享弹窗打开 → ${modalShown ? '✓' : '✗'}`);
    await savePreviewCard(c, 'share-year.png');
    await screenshot(c, 'share-modal-year.png');

    // 日报卡（今日统计卡入口 → 弹窗内默认定位今日）
    await evaluate(
      c,
      `(() => {
        document.getElementById('shareModal').hidden = true;
        document.getElementById('shareTodayBtn').click();
        return !document.getElementById('shareModal').hidden;
      })()`,
      '今日卡入口'
    );
    await sleep(900);
    const dayPressed = await evaluate(
      c,
      `document.querySelector('#shareRange .segment[data-range="day"]').getAttribute('aria-pressed')`
    );
    console.log(`今日卡入口定位 range=day → ${dayPressed === 'true' ? '✓' : '✗'}`);
    await savePreviewCard(c, 'share-day.png');
    await screenshot(c, 'share-modal-day.png');

    // 周报卡
    await evaluate(c, `document.querySelector('#shareRange .segment[data-range="week"]').click()`, '切周报');
    await sleep(900);
    await savePreviewCard(c, 'share-week.png');
    await screenshot(c, 'share-modal-week.png');

    // 3. 资料编辑：昵称（走真实 input 事件）。
    await evaluate(
      c,
      `(() => {
        const input = document.getElementById('shareNameInput');
        input.value = 'Paradox';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
      '输入昵称'
    );
    await sleep(1000); // 250ms 防抖 + 保存 + 重绘
    const savedName = await evaluate(
      c,
      `chrome.storage.local.get('settings').then((d) => d.settings.profile?.name ?? '')`
    );
    console.log(`昵称落盘 → "${savedName}" ${savedName === 'Paradox' ? '✓' : '✗'}`);

    // 头像：在页面里造一张 PNG 并走真实 file input（验证压缩管线）。
    const avatarUploaded = await evaluate(
      c,
      `(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 300;
        const ctx = canvas.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, 400, 300);
        g.addColorStop(0, '#ff7a59');
        g.addColorStop(1, '#7c3aed');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 400, 300);
        ctx.fillStyle = '#fff';
        ctx.font = '700 120px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('P', 200, 155);
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
        const file = new File([blob], 'avatar.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        const input = document.getElementById('shareAvatarInput');
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
      '上传头像'
    );
    await sleep(1200);
    const savedAvatar = await evaluate(
      c,
      `chrome.storage.local.get('settings').then((d) => (d.settings.profile?.avatar || '').slice(0, 30))`
    );
    const previewShown = await evaluate(
      c,
      `!document.getElementById('shareAvatarPreview').hidden && document.getElementById('shareAvatarPlaceholder').hidden && !document.getElementById('shareAvatarRemove').hidden`
    );
    console.log(
      `头像上传 → ${avatarUploaded && savedAvatar.startsWith('data:image/jpeg') ? '落盘 JPEG ✓' : `✗（${savedAvatar}）`}，控件态 ${previewShown ? '✓' : '✗'}`
    );

    // 隐藏开关：关 → 卡片无用户区；开 → 恢复。
    await evaluate(c, `document.getElementById('shareShowSwitch').click()`, '关显示开关');
    await sleep(900);
    const showOff = await evaluate(
      c,
      `document.getElementById('shareShowSwitch').getAttribute('aria-checked')`
    );
    await savePreviewCard(c, 'share-week-noprofile.png');
    await evaluate(c, `document.getElementById('shareShowSwitch').click()`, '开显示开关');
    await sleep(900);
    await savePreviewCard(c, 'share-week-profile.png');
    await screenshot(c, 'share-modal-week-profile.png');
    console.log(
      `显示开关 → 关后 aria-checked=${showOff}（应为 false）${showOff === 'false' ? ' ✓' : ' ✗'}`
    );

    // Esc 关闭弹窗。
    await evaluate(
      c,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
      'Esc'
    );
    await sleep(300);
    const closed = await evaluate(c, `document.getElementById('shareModal').hidden`);
    console.log(`Esc 关闭弹窗 → ${closed ? '✓' : '✗'}`);

    // 4. 暗色主题卡片：切暗色后重新打开弹窗，导出三种暗色卡。
    await evaluate(
      c,
      `(async () => {
        const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
        await saveSettings({ theme: 'dark' });
        await new Promise((r) => setTimeout(r, 800));
        return document.documentElement.dataset.theme ?? '';
      })()`,
      '切暗色'
    );
    await sleep(300);
    await evaluate(c, `document.getElementById('shareTodayBtn').click()`, '打开弹窗(暗色日报)');
    await sleep(900);
    const darkAttr = await evaluate(c, `document.documentElement.dataset.theme ?? ''`);
    console.log(`暗色模式生效 → data-theme=${darkAttr} ${darkAttr === 'dark' ? '✓' : '✗'}`);
    await savePreviewCard(c, 'share-day-dark.png');
    await evaluate(c, `document.querySelector('#shareRange .segment[data-range="week"]').click()`, '暗色周报');
    await sleep(900);
    await savePreviewCard(c, 'share-week-dark.png');
    await evaluate(c, `document.querySelector('#shareRange .segment[data-range="year"]').click()`, '暗色年报');
    await sleep(900);
    await savePreviewCard(c, 'share-year-dark.png');
    await screenshot(c, 'share-modal-year-dark.png');

    // 恢复浅色，避免影响其他验证截图。
    await evaluate(
      c,
      `(async () => {
        const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
        await saveSettings({ theme: 'light' });
        return true;
      })()`,
      '恢复浅色'
    );
  });

  console.log('\n分享卡片验证完成，产物位于 verify/ 目录');
} finally {
  browser.kill();
  await sleep(500);
  browser.kill('SIGKILL');
}
