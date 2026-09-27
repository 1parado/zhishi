import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profile = mkdtempSync(join(tmpdir(), 'zhishi-hbdiag-'));
const PORT = 9345;

const browser = spawn(
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--load-extension=${root}`,
    '--no-first-run',
    '--window-size=1280,900',
    '--window-position=-32000,-32000',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, label) =>
  Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 超时`)), ms))]);

const targets = async () => (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const eventWaiters = [];
  const contexts = [];

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method === 'Runtime.executionContextCreated') {
      contexts.push(msg.params.context);
    }
    if (msg.method) for (const w of eventWaiters) w(msg);
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('ws error')));
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const waitEvent = (method, timeoutMs = 8000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} 等待超时`)), timeoutMs);
      eventWaiters.push((msg) => {
        if (msg.method === method) {
          clearTimeout(timer);
          resolve(msg.params);
        }
      });
    });

  return { opened, send, waitEvent, contexts, close: () => ws.close() };
}

async function evalIn(c, expression, contextId) {
  const params = { expression, awaitPromise: true, returnByValue: true };
  if (contextId) params.contextId = contextId;
  const result = await c.send('Runtime.evaluate', params);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate 异常');
  }
  return result.result?.value;
}

async function openPopup(extId) {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' });
  const target = await res.json();
  const c = connect(target.webSocketDebuggerUrl);
  await c.opened;
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Page.navigate', { url: `chrome-extension://${extId}/src/pages/popup.html` });
  await withTimeout((async () => {
    while (true) {
      const v = await evalIn(c, 'location.href.includes("popup.html") && document.readyState');
      if (v === 'complete') return c;
      await sleep(300);
    }
  })(), 15000, 'popup 加载');
  return { target, c };
}

try {
  await withTimeout((async () => {
    await sleep(6000);
    const list = await targets();
    const sw = list.find(
      (t) => t.type === 'service_worker' && t.url.endsWith('/src/background/service-worker.js')
    );
    const extId = new URL(sw.url).host;
    console.log('扩展 ID:', extId);

    // 1. 白名单设置
    const popup1 = await openPopup(extId);
    await evalIn(popup1.c, `(async () => {
      const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
      await saveSettings({ heartbeat: { enabled: true, sites: ['127.0.0.1'] } });
      return true;
    })()`);
    console.log('1. 白名单已设置 ✓');
    popup1.c.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${popup1.target.id}`).catch(() => {});

    // 2. 打开视频页
    const res = await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' });
    const videoTarget = await res.json();
    const vc = connect(videoTarget.webSocketDebuggerUrl);
    await vc.opened;
    await vc.send('Page.enable');
    await vc.send('Runtime.enable');
    await vc.send('Page.navigate', { url: 'http://127.0.0.1:8123/' });
    await withTimeout((async () => {
      while (true) {
        const v = await evalIn(vc, 'document.readyState').catch(() => 'loading');
        if (v === 'complete') break;
        await sleep(300);
      }
    })(), 15000, '视频页加载');
    await sleep(8000);

    // 3. 视频状态（在 127.0.0.1 origin 的 default 上下文里探测）
    const pageContext = vc.contexts.find((ctx) => ctx.origin === 'http://127.0.0.1:8123');
    console.log('3. 页面上下文:', pageContext ? `id=${pageContext.id}` : '未找到');
    const videoState = await evalIn(
      vc,
      `(() => {
        const v = document.querySelector('video');
        return v
          ? { found: true, paused: v.paused, readyState: v.readyState, networkState: v.networkState, time: v.currentTime, error: v.error && v.error.code, src: (v.currentSrc || '').slice(0, 70) }
          : { found: false, bodyLen: document.body.innerHTML.length, bodySnippet: document.body.innerHTML.slice(0, 120) };
      })()`,
      pageContext?.id
    );
    console.log('   视频状态:', JSON.stringify(videoState));
    await sleep(3000);
    const time2 = await evalIn(vc, 'document.querySelector("video")?.currentTime ?? -1', pageContext?.id);
    console.log('   3 秒后 currentTime:', time2, time2 > videoState.time ? '(在播放)' : '(未推进)');

    // 4. 内容脚本注入检查：枚举执行上下文找 isolated world
    await sleep(1000);
    console.log('4. 执行上下文:', vc.contexts.map((ctx) => ({ id: ctx.id, name: ctx.name, origin: ctx.origin, aux: JSON.stringify(ctx.auxData ?? {}) })));

    const isolated = vc.contexts.find(
      (ctx) => ctx.auxData && ctx.auxData.type === 'isolated'
    );
    if (isolated) {
      const hasChrome = await evalIn(vc, 'typeof chrome !== "undefined" && !!chrome.runtime', isolated.id);
      console.log('   isolated 上下文有 chrome.runtime:', hasChrome);
    // 3.5 自动心跳检查：视频自动播放后应已自发登记（此刻还没手动发过）
    const auto = await evalIn(vc, 'chrome.runtime.sendMessage({type:"debug-heartbeats"})', isolated.id);
    console.log('3.5 自动心跳（尚未手动发送）:', JSON.stringify(auto));

    // 4. 手动从内容脚本上下文发心跳（对照）
    await evalIn(vc, 'chrome.runtime.sendMessage({type:"zhishi-heartbeat"})', isolated.id);
    console.log('4. 已从内容脚本上下文手动发送心跳');
    } else {
      console.log('5. ✗ 未找到 isolated 上下文 → 内容脚本未注入');
    }

    // 6. 读后台登记状态
    await sleep(2000);
    const popup2 = await openPopup(extId);
    const hb = await evalIn(popup2.c, 'chrome.runtime.sendMessage({type:"debug-heartbeats"})');
    console.log('6. 后台心跳登记:', JSON.stringify(hb));
    popup2.c.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${popup2.target.id}`).catch(() => {});
    vc.close();
    await fetch(`http://127.0.0.1:${PORT}/json/close/${videoTarget.id}`).catch(() => {});
  })(), 90_000, '诊断流程');
} catch (err) {
  console.log('ERR:', err.message);
} finally {
  browser.kill();
  setTimeout(() => process.exit(0), 300);
}
