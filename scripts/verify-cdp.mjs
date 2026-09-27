/**
 * 端到端验证脚本（开发辅助，零依赖，Node 22+）。
 *
 * 无头启动 Edge（Chrome 正式版 137+ 已移除 --load-extension）加载本扩展，然后：
 *   1. 从 service worker 目标解析扩展 ID；
 *   2. 灌入 140 天演示数据；
 *   3. 截图 popup / dashboard / block 三个页面；
 *   4. 端到端验证限额：给 example.com 设 5 分钟限额并预置超额用量，
 *      导航到 https://example.com，确认被重定向到拦截页。
 *
 * 运行：node scripts/verify-cdp.mjs
 * 输出：verify/*.png 与控制台检查结果。
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

// Chrome 正式版（137+）已移除 --load-extension 支持，Edge 仍然支持，用它做无头验证。
const BROWSER = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;

// 无头模式下 idle 状态恒为 locked，计时与限额不会触发；用屏幕外窗口模拟真实会话。
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

// VW/VH 环境变量可覆盖窗口尺寸，用于窄视口响应式检查。
const viewWidth = process.env.VW || 1280;
const viewHeight = process.env.VH || 900;
if (process.env.VW) {
  const args = browser.spawnargs;
  const idx = args.indexOf('--window-size=1280,900');
  if (idx !== -1) args[idx] = `--window-size=${viewWidth},${viewHeight}`;
}

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

/** 连接一个 CDP 目标，返回 { send, close }。 */
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
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  return { opened, send, close: () => ws.close() };
}

/**
 * 打开一个新标签页并导航到 url（/json/new 无法直达 chrome-extension://，
 * 先开空白页再用 Page.navigate），就绪后执行回调。
 */
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

async function evaluate(c, expression) {
  const result = await c.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      `evaluate 失败：${result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails)}`
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

try {
  await until(async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, 20_000, '调试端口');
  console.log('调试端口就绪');

  // 1. 扩展 ID：来自其 service worker 目标。
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
  console.log(`扩展 ID：${extId}，service worker 正常运行 ✓`);

  // 2. 演示数据（__seedDemo 结尾会刷新页面，刷新销毁执行上下文属预期）。
  await withPage(`chrome-extension://${extId}/src/pages/dashboard.html`, 'dashboard.html', async (c) => {
    await evaluate(c, 'window.__seedDemo().catch(() => {})').catch(() => {});
  });
  console.log('已灌入 140 天演示数据');
  await sleep(1500);

  // 3. dashboard 截图。
  await withPage(`chrome-extension://${extId}/src/pages/dashboard.html`, 'dashboard.html', async (c) => {
    await screenshot(c, 'dashboard.png');
  });

  // 3b. 深链截图：右键菜单直达限额页并预填域名。
  await withPage(
    `chrome-extension://${extId}/src/pages/dashboard.html?tab=limits&add=example.com`,
    'dashboard.html',
    async (c) => {
      const prefilled = await evaluate(c, 'document.getElementById("limitDomain").value');
      console.log(`深链预填域名 → ${prefilled} ${prefilled === 'example.com' ? '✓' : '✗'}`);
      await screenshot(c, 'dashboard-deeplink.png');

      // 灌入 3 条限额规则，验证搜索与筛选。
      await evaluate(c, `(async () => {
        const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
        await saveSettings({
          limitsEnabled: true,
          seq: 3,
          limits: [
            { id: 1, domain: 'bilibili.com', minutes: 30, enabled: true },
            { id: 2, domain: 'baidu.com', minutes: 20, enabled: false },
            { id: 3, domain: 'zhihu.com', minutes: 10, enabled: true },
          ],
        });
        return true;
      })()`);
      await sleep(800);

      const count = await evaluate(c, `(() => {
        const input = document.getElementById('limitSearch');
        input.value = 'bi';
        input.dispatchEvent(new Event('input'));
        return document.querySelectorAll('.limit-row').length;
      })()`);
      console.log(`搜索 "bi" → ${count} 条 ${count === 1 ? '✓（应为 bilibili.com）' : '✗'}`);

      const over = await evaluate(c, `(() => {
        const key = 'd:' + new Date().toLocaleDateString('sv-SE');
        return chrome.storage.local.get(key).then(data => {
          const day = data[key] || {};
          day['bilibili.com'] = 1800; // 30 分钟，恰好达到限额
          return chrome.storage.local.set({ [key]: day });
        });
      })()`);
      void over;
      await sleep(800);
      const overDomains = await evaluate(c, `(() => {
        document.getElementById('limitSearch').value = '';
        document.getElementById('limitSearch').dispatchEvent(new Event('input'));
        document.querySelector('.segment[data-status="over"]').click();
        return [...document.querySelectorAll('.limit-domain')].map((el) => el.textContent);
      })()`);
      // 演示数据可能让多条规则同时达标，断言核心事实：
      // bilibili 必须在列（脚本预置了恰好达限的用量），baidu（无用量）必须排除。
      const overOk = overDomains.includes('bilibili.com') && !overDomains.includes('baidu.com');
      console.log(
        `筛选「今日已达」→ [${overDomains.join(', ')}] ${overOk ? '✓' : '✗'}`
      );
      // 时段屏蔽编辑器展开（截图里能看到展开的编辑器）。
      const schedOpen = await evaluate(c, `(() => {
        document.querySelector('.schedule-btn').click();
        return !!document.querySelector('.limit-schedule');
      })()`);
      console.log(`时段屏蔽编辑器 → ${schedOpen ? '✓' : '✗'}`);
      await screenshot(c, 'limits-filter.png');
    }
  );

  // 4. popup 截图 + 后台存活探测 + 实时秒表检查。
  await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
    const pong = await evaluate(c, 'chrome.runtime.sendMessage({type:"ping"})');
    console.log(`后台 ping → ${JSON.stringify(pong)} ${pong?.ok ? '✓' : '✗'}`);
    await screenshot(c, 'popup.png');
  });

  // 4b. popup 实时秒表：植入进行中的会话并触发重渲染，状态行应每秒推进。
  //     不用重载页面——页面加载事件会唤醒后台结算，锁定沙箱里会把会话清掉。
  const ticks = await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
    await evaluate(c, `(async () => {
      await chrome.storage.session.set({
        session: { tabId: 1, windowId: 1, domain: 'example.com', startedAt: Date.now() - 30000 },
      });
      // 写一个 d: 前缀的键触发 popup 的 storage.onChanged 重渲染。
      await chrome.storage.local.set({ 'd:__probe': {} });
      return true;
    })()`);
    await sleep(500);
    const t1 = await evaluate(c, 'document.getElementById("status").textContent');
    await sleep(2200);
    const t2 = await evaluate(c, 'document.getElementById("status").textContent');
    await evaluate(c, 'chrome.storage.local.remove("d:__probe")');
    return { t1, t2 };
  });
  console.log(
    ticks.t1 !== ticks.t2 && ticks.t1.includes('正在记录')
      ? `popup 实时秒表 ✓（${ticks.t1} → ${ticks.t2}）`
      : `popup 实时秒表 ✗（${ticks.t1} / ${ticks.t2}）`
  );

  // 5. 拦截页静态截图。
  await withPage(
    `chrome-extension://${extId}/src/pages/block.html?domain=bilibili.com`,
    'block.html',
    async (c) => {
      await screenshot(c, 'block.png');
    }
  );

  // 5b. 视频心跳端到端：本地自动播放视频页 → 心跳应被后台登记。
  //     前置：python -m http.server 8123 托管 %TEMP%\zhishi-video\index.html。
  const videoServerUp = await fetch('http://127.0.0.1:8123/', { signal: AbortSignal.timeout(2000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (!videoServerUp) {
    console.log('（跳过心跳实测：本地 8123 视频服务未启动）');
  } else {
    await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
      await evaluate(c, `(async () => {
        const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
        await saveSettings({ heartbeat: { enabled: true, sites: ['127.0.0.1'] } });
        return true;
      })()`);
    });

    const videoRes = await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' });
    const videoTarget = await videoRes.json();
    const vc = connect(videoTarget.webSocketDebuggerUrl);
    await vc.opened;
    await vc.send('Page.enable');
    await vc.send('Page.navigate', { url: 'http://127.0.0.1:8123/' });
    await until(async () => {
      const { result } = await vc.send('Runtime.evaluate', {
        expression: 'location.href.includes("8123") && document.readyState',
        returnByValue: true,
      });
      if (result.value !== 'complete') throw new Error(String(result.value));
      return true;
    }, 15_000, '视频页加载');
    await sleep(27_000); // 覆盖播放事件上报 + 一次 20 秒周期心跳

    const hb = await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) =>
      evaluate(c, 'chrome.runtime.sendMessage({type:"debug-heartbeats"})')
    );
    const beatAge = hb?.heartbeats?.['127.0.0.1'];
    console.log(
      `视频心跳 → ${beatAge !== undefined ? `已登记 ✓（${beatAge} 秒前）` : '未登记 ✗'}`
    );
    vc.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${videoTarget.id}`).catch(() => {});
  }

  // 6. 端到端：example.com 限额 5 分钟，预置 10 分钟用量 → 导航应被拦截。
  const todayKey = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD（本地时区）
  await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
    await evaluate(c, `(async () => {
      const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
      await saveSettings({
        limitsEnabled: true,
        seq: 1,
        limits: [{ id: 1, domain: 'example.com', minutes: 5, enabled: true }],
      });
      const key = 'd:${todayKey}';
      const data = await chrome.storage.local.get(key);
      const day = data[key] || {};
      day['example.com'] = (day['example.com'] || 0) + 600;
      await chrome.storage.local.set({ [key]: day });
      return true;
    })()`);
  });
  console.log('已设置 example.com 限额 5 分钟，预置 10 分钟用量');

  const expected = `chrome-extension://${extId}/src/pages/block.html?domain=example.com`;
  const finalUrl = await withPage('https://example.com/', 'example.com', async (c) => {
    await sleep(2500);
    return evaluate(c, 'location.href');
  }).catch(() => null);

  // 导航后标签页可能被 tick 重定向，重新读取最终地址。
  const list = await targets();
  const navTab = list.find((t) => (t.url ?? '').startsWith(expected));
  const url = navTab?.url ?? finalUrl ?? '(未知)';
  console.log(url === expected ? `限额拦截生效 ✓ → ${url}` : `限额拦截未生效 ✗ → ${url}`);

  // 7. 复杂限额操作序列：限额 → 超限 → 放行 10 分钟 → 删除限额 → 新增 6 分钟限额。
  //    期望：删除时放行记录一并作废，新限额因今日已用 10 分钟 ≥ 6 分钟而立即拦截。
  const seqResult = await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) =>
    evaluate(c, `(async () => {
      const { saveSettings, removeLimit, addLimit } = await import(chrome.runtime.getURL('src/lib/settings.js'));
      const { setGrant, getGrants } = await import(chrome.runtime.getURL('src/background/store.js'));
      const { isBlocked } = await import(chrome.runtime.getURL('src/background/tracker.js'));
      const key = 'd:${todayKey}';
      await saveSettings({
        limitsEnabled: true,
        seq: 1,
        limits: [{ id: 1, domain: 'bilibili.com', minutes: 5, enabled: true }],
      });
      await chrome.storage.local.set({ [key]: { 'bilibili.com': 600 } });

      const blocked1 = await isBlocked('bilibili.com'); // 超 5 分钟限额 → true
      await setGrant('bilibili.com', Date.now() + 600_000); // 放行 10 分钟
      const blocked2 = await isBlocked('bilibili.com'); // 放行期内 → false
      await removeLimit(1); // 删除限额
      const grantsAfterRemove = await getGrants(); // 放行应一并作废
      await addLimit('bilibili.com', 6); // 新增 6 分钟限额
      const blocked3 = await isBlocked('bilibili.com'); // 已用 600s ≥ 360s → 立即 true
      return { blocked1, blocked2, grantsAfterRemove, blocked3 };
    })()`)
  );
  const seqOk =
    seqResult.blocked1 === true &&
    seqResult.blocked2 === false &&
    Object.keys(seqResult.grantsAfterRemove).length === 0 &&
    seqResult.blocked3 === true;
  console.log(
    `复杂限额序列 → 初始拦截 ${seqResult.blocked1} / 放行后 ${seqResult.blocked2} / 删除后放行残留 ${JSON.stringify(
      seqResult.grantsAfterRemove
    )} / 新 6 分钟限额拦截 ${seqResult.blocked3} ${seqOk ? '✓' : '✗'}`
  );

  console.log('\n全部验证完成，截图位于 verify/ 目录');
} finally {
  browser.kill();
  await sleep(500);
  browser.kill('SIGKILL');
}
