import { dateKey, fmtDuration, goalVariant, sumSeconds } from '../lib/pure.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { getDay } from '../background/store.js';
import { currentSession } from '../background/tracker.js';

const $ = (id) => document.getElementById(id);

// 实时秒表缓存：每秒用「今日已落盘 + 未落盘会话」推算当前站点与今日总量。
let cachedSession = null;
let cachedToday = null;
let cachedTodayTotal = 0;
let liveTimer = null;

async function render() {
  const [today, settings, session] = await Promise.all([
    getDay(dateKey()),
    getSettings(),
    currentSession(),
  ]);
  cachedSession = session;
  cachedToday = today;
  cachedTodayTotal = sumSeconds(today);
  renderStatus(session, today);
  renderToday(today, settings);
  renderSites(today);
  renderSwitches(settings);
}

function renderStatus(session, today) {
  const el = $('status');
  if (session?.domain) {
    const live = (today[session.domain] || 0) + (Date.now() - session.startedAt) / 1000;
    el.textContent = `正在记录：${session.domain} · 今日 ${fmtDuration(live)}`;
  } else {
    el.textContent = '浏览器不在前台，计时暂停';
  }
}

// 当前站点与今日总量每秒跳动，让「正在记录」变得可感知。
function startTicker() {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    const session = cachedSession;
    if (!session?.domain || !cachedToday) return;
    const elapsed = (Date.now() - session.startedAt) / 1000;

    const liveSite = (cachedToday[session.domain] || 0) + elapsed;
    $('status').textContent = `正在记录：${session.domain} · 今日 ${fmtDuration(liveSite)}`;

    const liveTotal = fmtDuration(cachedTodayTotal + elapsed);
    $('todayTotal').textContent = liveTotal;
    $('todayTotalPlain').textContent = liveTotal;
  }, 1000);
}

function renderToday(today, settings) {
  const total = sumSeconds(today);
  const goalSeconds = settings.goal.enabled ? settings.goal.dailyMinutes * 60 : 0;
  const variant = goalVariant(total, goalSeconds);

  if (settings.goal.enabled) {
    $('plainWrap').hidden = true;
    $('ringWrap').hidden = false;
    const ratio = Math.min(total / goalSeconds, 1);
    const circle = $('ringValue');
    circle.dataset.variant = variant;
    circle.style.strokeDashoffset = String(257.6 * (1 - ratio));
    $('ringCaption').textContent = `目标 ${settings.goal.dailyMinutes} 分钟`;
  } else {
    $('ringWrap').hidden = true;
    $('plainWrap').hidden = false;
  }
  $('todayTotal').textContent = fmtDuration(total);
  $('todayTotalPlain').textContent = fmtDuration(total);
}

function renderSites(today) {
  const list = $('siteList');
  list.textContent = '';
  const entries = Object.entries(today).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '今天还没有记录，正常使用网页后这里会出现排行。';
    list.append(empty);
    return;
  }

  const max = entries[0][1];
  for (const [domain, seconds] of entries) {
    const row = document.createElement('div');
    row.className = 'site-row';

    const name = document.createElement('span');
    name.className = 'site-name';
    name.textContent = domain;

    const time = document.createElement('span');
    time.className = 'site-time num';
    time.textContent = fmtDuration(seconds);

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max((seconds / max) * 100, 2)}%`;
    track.append(fill);

    row.append(name, time, track);
    list.append(row);
  }
}

function renderSwitches(settings) {
  const eye = $('eyeSwitch');
  eye.setAttribute('aria-checked', String(settings.health.eye.enabled));
  $('eyeSub').textContent = settings.health.eye.enabled
    ? `每 ${settings.health.eye.intervalMin} 分钟望向远处`
    : '已停用';

  const limit = $('limitSwitch');
  limit.setAttribute('aria-checked', String(settings.limitsEnabled));
  $('limitSub').textContent = settings.limitsEnabled ? '达到限额后拦截' : '已停用';
}

function bindSwitches() {
  $('eyeSwitch').addEventListener('click', async () => {
    const settings = await getSettings();
    await saveSettings({ health: { eye: { enabled: !settings.health.eye.enabled } } });
  });
  $('limitSwitch').addEventListener('click', async () => {
    const settings = await getSettings();
    await saveSettings({ limitsEnabled: !settings.limitsEnabled });
  });

  // 必须用 tabs.create 开新标签页：普通链接会把 popup 自身导航走，
  // 弹窗窗口会缩到内容宽度，页面越来越小。
  $('dashLink').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/dashboard.html') });
  });
}

// 数据每分钟落盘、设置即时生效，监听变化保持弹窗实时。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.settings || Object.keys(changes).some((k) => k.startsWith('d:')))) {
    render();
  }
});

bindSwitches();
render().then(startTicker);
