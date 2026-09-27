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

async function withRetry(fn, attempts = 2, label = '') {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === attempts - 1) throw err;
      console.log(`${label} 第 ${i + 1} 次尝试失败（${String(err.message).slice(0, 80)}），重试…`);
      await sleep(1500);
    }
  }
}

async function screenshot(c, filename) {
  await sleep(400);
  const { data } = await c.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  });
  try {
    writeFileSync(join(outDir, filename), Buffer.from(data, 'base64'));
    console.log(`截图 ${filename}`);
  } catch (err) {
    // 磁盘满时截图降级为可选产物：写到临时目录，不阻塞功能断言。
    const fallbackPath = join(tmpdir(), filename);
    try {
      writeFileSync(fallbackPath, Buffer.from(data, 'base64'));
      console.log(`截图 ${filename}（E 盘空间不足，已写入 ${fallbackPath}）`);
    } catch {
      console.log(`截图 ${filename} 失败（磁盘空间不足，已跳过）`);
    }
  }
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

      // 近 7 天图表形式切换 + 热力图语义配色 + 排行范围切换。
      const chartChecks = await evaluate(c, `(async () => {
        const { saveSettings } = await import(chrome.runtime.getURL('src/lib/settings.js'));
        const { dateKey } = await import(chrome.runtime.getURL('src/lib/pure.js'));
        document.querySelector('.tab[data-tab="overview"]').click();
        const out = {};
        for (const [type, selector] of [['line', '.week-line'], ['pie', '.pie-seg'], ['bar', '.week-bar']]) {
          await saveSettings({ weekChart: type });
          await new Promise((r) => setTimeout(r, 400));
          out[type] = document.querySelectorAll(selector).length;
        }
        out.heatColored = !!document.querySelector(
          '.heat-cell[data-level="1"], .heat-cell[data-level="2"], .heat-cell[data-level="3"], .heat-cell[data-level="4"]'
        );
        // 热力图增强：月份标签、可点击格子、今日卡片
        out.heatMonths = document.querySelectorAll('.heat-month').length;
        out.heatCellsHasData = document.querySelectorAll('.heat-cell.has-data').length;
        out.heatWeekdays = document.querySelectorAll('.heat-weekday').length;
        out.heatWeekdayFirst =
          document.querySelector('.heat-weekday')?.textContent ?? '';
        out.todayCardClickable = document.getElementById('todayCard')?.dataset !== undefined &&
          !!document.querySelector('#todayCard');
        // 注入 10 个额外站点，验证排行默认前 7 + 查看更多展开。
        const key = 'd:' + dateKey();
        const day = (await chrome.storage.local.get(key))[key] || {};
        for (let i = 1; i <= 10; i++) day['extra' + i + '.com'] = 100 + i;
        await chrome.storage.local.set({ [key]: day });
        await new Promise((r) => setTimeout(r, 500));
        // 排行范围：今日第一名的域名应与当日数据一致。
        await saveSettings({ topSitesRange: 'day' });
        await new Promise((r) => setTimeout(r, 400));
        const dayRows = [...document.querySelectorAll('#topSites .top-name')].map((el) => el.textContent);
        const expectedTop = Object.entries(day).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
        out.dayRows = dayRows.length;
        out.dayTopMatches = dayRows[0] === expectedTop && dayRows.length > 0;
        out.topDefaultSeven = out.dayRows === 7;
        out.hasMoreBtn = !!document.querySelector('.top-more');
        document.querySelector('.top-more')?.click();
        await new Promise((r) => setTimeout(r, 200));
        out.topExpanded = document.querySelectorAll('#topSites .top-name').length;
        await saveSettings({ topSitesRange: 'week' });
        await new Promise((r) => setTimeout(r, 400));
        out.weekRows = document.querySelectorAll('#topSites .top-name').length;
        // GitHub 链接与图标 + Settings 选项卡
        out.githubLink = document.querySelector('.github-link')?.href ?? '';
        out.githubIcon = !!document.querySelector('.github-link svg');
        out.settingsLocaleSwitch = !!document.querySelector('#tab-settings #localeSwitch');
        // 语言切换：切到 English 后选项卡文案应变。
        await saveSettings({ locale: 'en' });
        await new Promise((r) => setTimeout(r, 500));
        out.enTab = [...document.querySelectorAll('.tab')].map((el) => el.textContent).join('|');
        await saveSettings({ locale: 'zh' });
        await new Promise((r) => setTimeout(r, 500));
        out.zhTab = [...document.querySelectorAll('.tab')].map((el) => el.textContent).join('|');
        return out;
      })()`);
      const chartOk =
        chartChecks.line > 0 && chartChecks.pie > 0 && chartChecks.bar === 7 && chartChecks.heatColored;
      const rangeOk =
        chartChecks.dayRows > 0 &&
        chartChecks.dayTopMatches &&
        chartChecks.weekRows > 0 &&
        chartChecks.topDefaultSeven &&
        chartChecks.hasMoreBtn &&
        chartChecks.topExpanded > 7;
      const i18nOk =
        chartChecks.githubLink === 'https://github.com/1parado/zhishi' &&
        chartChecks.githubIcon &&
        chartChecks.settingsLocaleSwitch &&
        chartChecks.enTab === 'Overview|Site limits|Wellness|Timing & data|Settings' &&
        chartChecks.zhTab === '概览|网站限额|健康提醒|计时与数据|设置';
      console.log(
        `图表切换 → 折线 ${chartChecks.line} / 饼状 ${chartChecks.pie} / 柱状 ${chartChecks.bar}，热力新配色 ${chartChecks.heatColored} ${chartOk ? '✓' : '✗'}`
      );
      console.log(
        `排行范围 → 今日默认 ${chartChecks.dayRows} 条（第 7 截断 ${chartChecks.topDefaultSeven} / 有查看更多 ${chartChecks.hasMoreBtn} / 展开后 ${chartChecks.topExpanded} 条）/ 近 7 天 ${chartChecks.weekRows} 条 ${rangeOk ? '✓' : '✗'}`
      );
      console.log(
        `i18n + GitHub → 链接 ${chartChecks.githubLink}，图标 ${chartChecks.githubIcon}，EN 标签「${chartChecks.enTab}」，ZH 标签「${chartChecks.zhTab}」 ${i18nOk ? '✓' : '✗'}`
      );
      console.log(
        `热力图增强 → 月份标签 ${chartChecks.heatMonths} 个，可点击格子 ${chartChecks.heatCellsHasData} 个，星期标签 ${chartChecks.heatWeekdays} 个（首行「${chartChecks.heatWeekdayFirst}」应为周一） ${
          chartChecks.heatMonths >= 6 &&
          chartChecks.heatCellsHasData > 0 &&
          chartChecks.heatWeekdays === 7 &&
          chartChecks.heatWeekdayFirst === '周一'
            ? '✓'
            : '✗'
        }`
      );
      await screenshot(c, 'overview-charts.png');
      // 回到限额选项卡再截图，保证截图内容与文件名一致。
      await evaluate(c, `document.querySelector('.tab[data-tab="limits"]').click()`);
      await sleep(300);
      await screenshot(c, 'limits-filter.png');
    }
  );

  // 4. popup 截图 + 后台存活探测 + 实时秒表检查。
  await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
    const pong = await evaluate(c, 'chrome.runtime.sendMessage({type:"ping"})');
    console.log(`后台 ping → ${JSON.stringify(pong)} ${pong?.ok ? '✓' : '✗'}`);
    await screenshot(c, 'popup.png');
  });

  // 4b. popup 实时秒表 + 会话竞态修复：popup 先以「暂停」渲染，
  //     种入会话后应通过 storage.session.onChanged 自动刷新为「正在记录」并每秒推进。
  const ticks = await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
    const t1 = await evaluate(c, 'document.getElementById("status").textContent');
    await evaluate(c, `(async () => {
      await chrome.storage.session.set({
        session: { tabId: 1, windowId: 1, domain: 'example.com', startedAt: Date.now() - 30000 },
      });
      return true;
    })()`);
    await sleep(700); // onChanged → 150ms 防抖重渲染
    const t2 = await evaluate(c, 'document.getElementById("status").textContent');
    await sleep(2200);
    const t3 = await evaluate(c, 'document.getElementById("status").textContent');
    return { t1, t2, t3 };
  });
  const ticksOk =
    !ticks.t1.includes('正在记录') && ticks.t2.includes('正在记录') && ticks.t2 !== ticks.t3;
  console.log(
    `popup 实时秒表 ${ticksOk ? '✓' : '✗'}（${ticks.t1} → ${ticks.t2} → ${ticks.t3}）`
  );

  // 4c. popup 语言迷你切换：切 EN 后按钮文案应变。
  const popupLocale = await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
    const inHead = await evaluate(c, '!!document.querySelector(".popup-head .lang-mini")');
    console.log(`popup 语言切换器位置 → 头部 ${inHead} ${inHead ? '✓' : '✗'}`);
    await evaluate(c, `document.querySelector('#popupLocale .segment[data-locale="en"]').click()`);
    await sleep(400);
    const enText = await evaluate(c, 'document.getElementById("dashLink").textContent');
    await evaluate(c, `document.querySelector('#popupLocale .segment[data-locale="zh"]').click()`);
    await sleep(400);
    const zhText = await evaluate(c, 'document.getElementById("dashLink").textContent');
    return { enText, zhText };
  });
  const localeOk = popupLocale.enText === 'Open dashboard' && popupLocale.zhText === '打开仪表盘';
  console.log(
    `popup 语言切换 ${localeOk ? '✓' : '✗'}（EN → ${popupLocale.enText} / ZH → ${popupLocale.zhText}）`
  );

  // 4d/4e. 时间线页（用「昨天/前天」做确定性测试，真实结算只写今天）：
  //   先验证旧数据回退（h: 小时桶近似），再种入 IDB 分段重载验证精确甘特块。
  const yesterday = new Date(Date.now() - 86_400_000).toLocaleDateString('sv-SE');
  const dayBefore = new Date(Date.now() - 2 * 86_400_000).toLocaleDateString('sv-SE');

  const tl = await withRetry(
    () =>
      withPage(
        `chrome-extension://${extId}/src/pages/timeline.html?date=${yesterday}`,
        'timeline.html',
        async (c) => {
      // 种入昨天的小时桶并重载 → 回退模式。
      await evaluate(c, `(async () => {
        await chrome.storage.local.set({
          'h:${yesterday}': {
            '09': { 'example.com': 1200, 'github.com': 600 },
            '10': { 'bilibili.com': 900 },
            '22': { 'linux.do': 300 },
          },
        });
        return true;
      })()`, '4d-种h桶');
          // reload 会销毁上下文导致 evaluate 永不返回，改用 Page.navigate 重载。
          await c.send('Page.navigate', {
            url: `chrome-extension://${extId}/src/pages/timeline.html?date=${yesterday}`,
          });
          await until(async () => {
            const v = await c.send('Runtime.evaluate', {
              expression: 'document.readyState',
              returnByValue: true,
            });
            if (v.result?.value !== 'complete') throw new Error(v.result?.value);
            return true;
          }, 30_000, '回退模式重载');
          // 原子读取回退状态。
          const t1 = JSON.parse(
            await evaluate(c, `JSON.stringify({
          segs: document.querySelectorAll('.tl-seg').length,
          ticks: document.querySelectorAll('.tl-tick').length,
          note: !!document.querySelector('.tl-fallback'),
          sites: document.querySelectorAll('#tlSites .top-row').length,
        })`)
          );

      // 种入前天的 IDB 分段（经后台消息，验证 SW 侧写入路径）。
      const seedResult = await evaluate(c, `(async () => {
        const date = '${dayBefore}';
        const rows = [
          { date, start: new Date(date + 'T09:00:00').getTime(), end: new Date(date + 'T09:20:00').getTime(), domain: 'example.com' },
          { date, start: new Date(date + 'T09:20:00').getTime(), end: new Date(date + 'T09:30:00').getTime(), domain: 'github.com' },
          { date, start: new Date(date + 'T22:00:00').getTime(), end: new Date(date + 'T22:15:00').getTime(), domain: 'linux.do' },
        ];
        return chrome.runtime.sendMessage({ type: 'debug-seed-segments', rows });
      })()`, '4e-种IDB分段');
      console.log(`  IDB 种子写入 → ${JSON.stringify(seedResult)}`);
          await c.send('Page.navigate', {
            url: `chrome-extension://${extId}/src/pages/timeline.html?date=${dayBefore}`,
          });
          await until(async () => {
            const v = await c.send('Runtime.evaluate', {
              expression: 'location.href.includes("date=") && document.readyState',
              returnByValue: true,
            });
            if (v.result?.value !== 'complete') throw new Error(String(v.result?.value));
            return true;
          }, 30_000, '精确模式加载');
          const t2 = JSON.parse(
            await evaluate(c, `JSON.stringify({
          segs: document.querySelectorAll('.tl-seg').length,
          firstLeft: document.querySelector('.tl-seg')?.style.left ?? '',
          note: !!document.querySelector('.tl-fallback'),
        })`)
          );
          await screenshot(c, 'timeline.png');
          return { t1, t2 };
        }
      ),
    2,
    '时间线页'
  );
  const tlOk =
    tl.t1.segs === 4 && tl.t1.ticks === 7 && tl.t1.note && tl.t1.sites >= 1;
  console.log(
    `时间线页（旧数据回退）→ ${tl.t1.segs} 个近似色块（应为 4）/${tl.t1.ticks} 个刻度/近似提示 ${tl.t1.note}，站点 ${tl.t1.sites} 个 ${tlOk ? '✓' : '✗'}`
  );
  const preciseOk =
    tl.t2.segs === 3 && Math.abs(parseFloat(tl.t2.firstLeft) - 37.5) < 0.5 && !tl.t2.note;
  console.log(
    `时间线页（精确分段）→ ${tl.t2.segs} 块（应为 3）/ 首块定位 ${tl.t2.firstLeft}（应为 37.5%）/ 无回退提示 ${!tl.t2.note} ${preciseOk ? '✓' : '✗'}`
  );

  // 4f. brush 拖选缩放 + 色块点击打开网站 + 重置。
  const brush = await withPage(
    `chrome-extension://${extId}/src/pages/timeline.html?date=${dayBefore}`,
    'timeline.html',
    async (c) => {
      await sleep(600);
      const t0 = await evaluate(c, `document.querySelector('.tl-tick').textContent`);
      await evaluate(c, `(() => {
        const strip = document.querySelector('.tl-strip');
        const r = strip.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const ev = (type, x) => strip.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0 }));
        ev('pointerdown', r.left + r.width * 0.25);
        ev('pointermove', r.left + r.width * 0.5);
        ev('pointerup', r.left + r.width * 0.5);
      })()`);
      await sleep(400);
      const t1 = await evaluate(c, `document.querySelector('.tl-tick').textContent`);
      const hasReset = await evaluate(c, `!!document.querySelector('.tl-reset')`);
      await evaluate(c, `document.querySelector('.tl-reset').click()`);
      await sleep(300);
      const t2 = await evaluate(c, `document.querySelector('.tl-tick').textContent`);
      // 色块点击打开对应网站
      await evaluate(c, `window.open = (u) => { window.__opened = u; return null; }; document.querySelector('.tl-seg').click()`);
      const opened = await evaluate(c, 'window.__opened ?? ""');
      return { t0, t1, hasReset, t2, opened };
    }
  );
  const brushOk =
    brush.t0 === '00:00' &&
    brush.t1 !== '00:00' &&
    brush.hasReset &&
    brush.t2 === '00:00' &&
    brush.opened.startsWith('https://');
  console.log(
    `brush 缩放与点击 → 初始刻度 ${brush.t0} / 拖选后首刻度 ${brush.t1} / 重置按钮 ${brush.hasReset} / 重置后 ${brush.t2} / 色块点击打开 ${brush.opened} ${brushOk ? '✓' : '✗'}`
  );

  // 4g. 语言持久化：popup 切 EN 后，直开仪表盘应保持英文（含时长单位）。
  await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
    await evaluate(c, `document.querySelector('#popupLocale .segment[data-locale="en"]').click()`);
    await sleep(400);
  });
  const persist = await withPage(`chrome-extension://${extId}/src/pages/dashboard.html`, 'dashboard.html', async (c) => {
    const tabs = await evaluate(c, `[...document.querySelectorAll('.tab')].map((t) => t.textContent).join('|')`);
    const storedLocale = await evaluate(c, `chrome.storage.local.get('settings').then((d) => d.settings.locale)`);
    const statToday = await evaluate(c, `document.getElementById('statToday').textContent`);
    return { tabs, storedLocale, statToday };
  });
  const persistOk =
    persist.storedLocale === 'en' &&
    persist.tabs === 'Overview|Site limits|Wellness|Timing & data|Settings' &&
    !/[一-龥]/.test(persist.statToday);
  console.log(
    `语言持久化 → 存储 ${persist.storedLocale} / 仪表盘标签「${persist.tabs}」/ 今日「${persist.statToday}」 ${persistOk ? '✓' : '✗'}`
  );
  // 恢复中文
  await withPage(`chrome-extension://${extId}/src/pages/popup.html`, 'popup.html', async (c) => {
    await evaluate(c, `document.querySelector('#popupLocale .segment[data-locale="zh"]').click()`);
    await sleep(300);
  });

  // 4f. 热力图点击跳转：点击一个有数据的格子应进入对应日期的时间线。
  const heatNav = await withPage(`chrome-extension://${extId}/src/pages/dashboard.html`, 'dashboard.html', async (c) => {
    await evaluate(c, `document.querySelector('.tab[data-tab="overview"]').click()`);
    await sleep(500);
    await evaluate(c, `document.querySelector('.heat-cell.has-data').click()`);
    await sleep(700);
    return evaluate(c, 'location.href');
  });
  console.log(
    heatNav.includes('timeline.html?date=')
      ? `热力图点击跳转 ✓ → ${heatNav.split('/').pop()}`
      : `热力图点击跳转 ✗ → ${heatNav}`
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
