import { classifyUrl, dateKey, goalVariant, sumSeconds } from '../lib/pure.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { applyI18n, fmtDuration, fmtDurationCompact, initI18n, refreshLocale, t } from '../lib/i18n.js';
import { applyTheme, initTheme } from '../lib/theme.js';
import { siteIconUrl } from '../lib/site-icons.js';
import { getDay } from '../background/store.js';
import { currentSession } from '../background/tracker.js';

const $ = (id) => document.getElementById(id);

// 实时秒表缓存：每秒用「今日已落盘 + 未落盘会话」推算当前站点与今日总量。
let cachedSession = null;
let cachedToday = null;
let cachedTodayTotal = 0;
let liveTimer = null;
// 排行列表里当前站点那一行的时间元素，随会话实时推进。
let liveSiteTimeEl = null;

async function render() {
  await initI18n();
  renderLocaleSwitch(await initI18n());
  const [today, settings, session, tabs] = await Promise.all([
    getDay(dateKey()),
    getSettings(),
    currentSession(),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []),
  ]);
  cachedSession = session;
  cachedToday = today;
  cachedTodayTotal = sumSeconds(today);
  renderStatus(session, today, tabs[0]);
  renderToday(today, settings);
  renderSites(today, session);
  renderSwitches(settings);
  applyTheme(settings.theme);
  renderThemeSwitch(settings.theme);
}

function renderStatus(session, today, activeTab) {
  const el = $('status');
  if (session?.domain) {
    const live = (today[session.domain] || 0) + (Date.now() - session.startedAt) / 1000;
    el.textContent = t('statusRecording', { domain: session.domain, time: fmtDuration(live) });
  } else {
    el.textContent = t('statusPaused');
  }
}

// 当前站点与今日总量每秒跳动，让「正在记录」变得可感知。
let pausedPollCount = 0;

function startTicker() {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    const session = cachedSession;
    if (!session?.domain || !cachedToday) {
      // 暂停状态下每 5 秒重查一次会话，覆盖事件遗漏的边缘情况。
      pausedPollCount += 1;
      if (pausedPollCount % 5 === 0) render();
      return;
    }
    pausedPollCount = 0;
    const elapsed = (Date.now() - session.startedAt) / 1000;

    const liveSite = (cachedToday[session.domain] || 0) + elapsed;
    $('status').textContent = t('statusRecording', { domain: session.domain, time: fmtDuration(liveSite) });
    if (liveSiteTimeEl) liveSiteTimeEl.textContent = fmtDuration(liveSite);

    const liveTotal = fmtDuration(cachedTodayTotal + elapsed);
    // 环内用紧凑格式（不换行不出环），下方纯文本模式用完整格式。
    $('todayTotal').textContent = fmtDurationCompact(cachedTodayTotal + elapsed);
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
    // 周长 2π×46 ≈ 289.03，与 popup.css 的 stroke-dasharray 一致。
    circle.style.strokeDashoffset = String(289.03 * (1 - ratio));
    $('ringCaption').textContent = t('goalMinutes', { n: settings.goal.dailyMinutes });
  } else {
    $('ringWrap').hidden = true;
    $('plainWrap').hidden = false;
  }
  // 环内用紧凑格式（不换行不出环），纯文本模式用完整格式。
  $('todayTotal').textContent = fmtDurationCompact(total);
  $('todayTotalPlain').textContent = fmtDuration(total);
}

function renderSites(today, session) {
  const list = $('siteList');
  list.textContent = '';
  liveSiteTimeEl = null;
  const entries = Object.entries(today).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('topEmpty');
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
    name.style.backgroundImage = siteIconUrl(domain);

    const time = document.createElement('span');
    time.className = 'site-time num';
    time.textContent = fmtDuration(seconds);

    // 当前站点的时间行实时推进（已落盘 + 未落盘会话）。
    if (session?.domain === domain) {
      liveSiteTimeEl = time;
      time.textContent = fmtDuration(seconds + (Date.now() - session.startedAt) / 1000);
    }

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
    ? t('eyeEvery', { n: settings.health.eye.intervalMin })
    : t('off');

  const limit = $('limitSwitch');
  limit.setAttribute('aria-checked', String(settings.limitsEnabled));
  $('limitSub').textContent = settings.limitsEnabled ? t('limitsBlocking') : t('off');

  const focus = $('focusSwitch');
  focus.setAttribute('aria-checked', String(settings.focus?.enabled === true));
  const focusSites = settings.focus?.sites?.length ?? 0;
  $('focusSub').textContent =
    settings.focus?.enabled === true
      ? t('focusOnSub', { n: focusSites })
      : t('focusOffSub');
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
  $('focusSwitch').addEventListener('click', async () => {
    const settings = await getSettings();
    await saveSettings({ focus: { enabled: !(settings.focus?.enabled === true) } });
    // 开关后立即重估当前标签页：白名单外站点马上跳拦截页 / 关闭后马上放行。
    chrome.runtime.sendMessage({ type: 'zhishi-popup-opened' }).catch(() => {});
  });

  // 必须用 tabs.create 开新标签页：普通链接会把 popup 自身导航走，
  // 弹窗窗口会缩到内容宽度，页面越来越小。
  $('dashLink').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/dashboard.html') });
  });
}

// 数据每分钟落盘、设置即时生效，监听变化保持弹窗实时。
let sessionRenderTimer = null;
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && (changes.settings || Object.keys(changes).some((k) => k.startsWith('d:')))) {
    if (changes.settings) {
      const s = changes.settings.newValue;
      refreshLocale(s?.locale);
      applyTheme(s?.theme);
      renderThemeSwitch(s?.theme);
      await applyI18n();
    }
    render();
  }
  // 后台重建/清除会话时同步界面——popup 打开瞬间的竞态靠这里兜住。
  if (area === 'session' && changes.session) {
    clearTimeout(sessionRenderTimer);
    sessionRenderTimer = setTimeout(render, 150);
  }
});

// 语言迷你切换：立即生效并持久化。
function renderLocaleSwitch(locale) {
  for (const segment of document.querySelectorAll('#popupLocale .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.locale === locale));
  }
}

// 主题迷你切换：立即生效并持久化。
function renderThemeSwitch(theme) {
  for (const segment of document.querySelectorAll('#popupTheme .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.theme === theme));
  }
}

for (const segment of document.querySelectorAll('#popupLocale .segment')) {
  segment.addEventListener('click', async () => {
    refreshLocale(segment.dataset.locale);
    await applyI18n();
    render();
    await saveSettings({ locale: segment.dataset.locale });
  });
}

for (const segment of document.querySelectorAll('#popupTheme .segment')) {
  segment.addEventListener('click', async () => {
    const theme = segment.dataset.theme;
    applyTheme(theme);
    renderThemeSwitch(theme);
    await saveSettings({ theme });
  });
}

bindSwitches();
// 打开瞬间通知后台立即结算续上会话：焦点切换事件可能抢先清掉会话。
chrome.runtime.sendMessage({ type: 'zhishi-popup-opened' }).catch(() => {});
await initI18n();
await applyI18n();
await initTheme();
render().then(startTicker);
