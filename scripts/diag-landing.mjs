import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const profile = mkdtempSync(join(tmpdir(), 'zhishi-landing-'));
const PORT = 9360;

const browser = spawn(
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
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

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
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
  return { opened, send, close: () => ws.close() };
}

try {
  await withTimeout(
    (async () => {
      await sleep(5000);
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      const c = connect(page.webSocketDebuggerUrl);
      await c.opened;
      await c.send('Page.enable');
      // 沙箱会把窗口钳制到 ~485px，用设备仿真强制桌面视口。
      await c.send('Emulation.setDeviceMetricsOverride', {
        width: 1280,
        height: 900,
        deviceScaleFactor: 0,
        mobile: false,
      });
      const url = pathToFileURL(join(root, 'docs', 'index.html')).href;
      await c.send('Page.navigate', { url });
      await withTimeout(
        (async () => {
          while (true) {
            const v = await c.send('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
            if (v.result?.value === 'complete') break;
            await sleep(300);
          }
        })(),
        15000,
        '宣传页加载'
      );
      // 截图前置：图片立即可见（取消懒加载与渐入），等待解码。
      await c.send('Runtime.evaluate', {
        expression: `(() => {
          document.querySelectorAll('img[loading]').forEach((img) => (img.loading = 'eager'));
          document.querySelectorAll('figure').forEach((f) => f.classList.add('faded'));
          return [...document.images].map((img) => img.complete);
        })()`,
        returnByValue: true,
      });
      await sleep(1500);
      const metrics = await c.send('Runtime.evaluate', {
        expression: 'JSON.stringify({ w: document.documentElement.clientWidth, h: document.body.scrollHeight })',
        returnByValue: true,
      });
      console.log('页面尺寸:', metrics.result?.value);
      const shot = await c.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true,
      });
      writeFileSync(join(root, 'verify', 'landing-full.png'), Buffer.from(shot.data, 'base64'));
      console.log('截图 landing-full.png');
      c.close();
    })(),
    45_000,
    '宣传页截图'
  );
} catch (err) {
  console.log('ERR:', err.message);
} finally {
  browser.kill();
  setTimeout(() => process.exit(0), 300);
}
