import {
  dateKey,
  filterLimits,
  fmtDuration,
  goalVariant,
  heatmapLevel,
  isValidTime,
  shortDate,
  shiftDateKey,
  sumSeconds,
  toCSV,
  weekSeries,
  weekdayShort,
} from '../lib/pure.js';
import {
  addLimit,
  getSettings,
  INTERVAL_RANGES,
  removeLimit,
  saveSettings,
  setLimitEnabled,
} from '../lib/settings.js';
import { clearAllData, getAllDays } from '../background/store.js';

const $ = (id) => document.getElementById(id);

/* ---------- 选项卡 ---------- */

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}

function showTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.hidden = panel.id !== `tab-${name}`;
  }
}

/* ---------- 数据加载 ---------- */

async function loadAll() {
  const [days, settings] = await Promise.all([getAllDays(), getSettings()]);
  return { days, settings };
}

/* ---------- 概览 ---------- */

function renderOverview(days, settings) {
  const todayKey = dateKey();
  const todayTotal = sumSeconds(days[todayKey]);
  const week = weekSeries(days, todayKey, 7);
  const weekTotal = week.reduce((acc, d) => acc + d.seconds, 0);

  $('statToday').textContent = fmtDuration(todayTotal);
  const goalSeconds = settings.goal.enabled ? settings.goal.dailyMinutes * 60 : 0;
  $('goalEnabled').checked = settings.goal.enabled;
  $('goalLine').hidden = !settings.goal.enabled;
  $('goalMinutes').value = String(settings.goal.dailyMinutes);
  $('goalHint').textContent = settings.goal.enabled
    ? {
        ok: '状态不错',
        near: '接近目标',
        over: '已超过目标',
        none: '',
      }[goalVariant(todayTotal, goalSeconds)]
    : '';

  $('statWeek').textContent = fmtDuration(weekTotal);
  $('statWeekAvg').textContent = `日均 ${fmtDuration(Math.round(weekTotal / 7))}`;

  renderWeekChart(week);
  renderHeatmap(days, todayKey);
  renderTopSites(days, todayKey);
}

function renderWeekChart(week) {
  const wrap = $('weekChart');
  wrap.textContent = '';
  const max = Math.max(...week.map((d) => d.seconds), 1);
  const todayKey = dateKey();

  for (const day of week) {
    const col = document.createElement('div');
    col.className = 'week-col' + (day.key === todayKey ? ' is-today' : '');

    const bar = document.createElement('div');
    bar.className = 'week-bar';
    bar.style.height = `${Math.max((day.seconds / max) * 100, 1)}%`;
    bar.title = `${day.key} · ${fmtDuration(day.seconds)}`;

    const label = document.createElement('span');
    label.className = 'week-label';
    label.textContent = day.key === todayKey ? '今天' : weekdayShort(day.key);

    col.append(bar, label);
    wrap.append(col);
  }
}

function renderHeatmap(days, todayKey) {
  const wrap = $('heatmap');
  wrap.textContent = '';

  // 对齐到周：以今天所在周的周日为终点，向前铺 53 周。
  const today = new Date(todayKey + 'T00:00:00');
  const end = shiftDateKey(todayKey, today.getDay() === 6 ? 0 : 6 - today.getDay());
  const cells = [];
  let max = 0;
  let yearTotal = 0;
  for (let i = 0; i < 371; i++) {
    const key = shiftDateKey(end, -i);
    if (key > todayKey) continue; // 最后一周未来日期留空
    const seconds = sumSeconds(days[key]);
    yearTotal += seconds;
    max = Math.max(max, seconds);
    cells.push({ key, seconds });
  }

  for (const cell of cells) {
    const el = document.createElement('span');
    el.className = 'heat-cell';
    el.dataset.level = String(heatmapLevel(cell.seconds, max));
    el.title = `${cell.key} · ${fmtDuration(cell.seconds)}`;
    wrap.append(el);
  }

  $('yearTotal').textContent = `共 ${fmtDuration(yearTotal)}`;
}

function renderTopSites(days, todayKey) {
  const wrap = $('topSites');
  wrap.textContent = '';

  const week = weekSeries(days, todayKey, 7);
  const totals = {};
  for (const day of week) {
    for (const [domain, seconds] of Object.entries(days[day.key] || {})) {
      totals[domain] = (totals[domain] || 0) + seconds;
    }
  }
  const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 8);

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有记录。正常浏览网页后，这里会展示最常用的网站。';
    wrap.append(empty);
    return;
  }

  const max = entries[0][1];
  for (const [domain, seconds] of entries) {
    const row = document.createElement('div');
    row.className = 'top-row';

    const name = document.createElement('span');
    name.className = 'top-name';
    name.textContent = domain;

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max((seconds / max) * 100, 2)}%`;
    track.append(fill);

    const time = document.createElement('span');
    time.className = 'top-time num';
    time.textContent = fmtDuration(seconds);

    row.append(name, track, time);
    wrap.append(row);
  }
}

/* ---------- 限额 ---------- */

// 最新数据快照，供搜索/筛选免落盘即时刷新。
let latestDays = null;
let latestSettings = null;
let limitSearchText = '';
let limitStatusFilter = 'all';
// 当前展开时段屏蔽编辑器的规则 id。
let openScheduleId = null;

function renderLimits(settings) {
  const today = latestDays?.[dateKey()] || {};
  $('limitMaster').setAttribute('aria-checked', String(settings.limitsEnabled));

  const list = $('limitList');
  list.textContent = '';
  if (!settings.limits.length) {
    openScheduleId = null;
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '还没有添加限额网站。用上方表单添加第一条。';
    list.append(empty);
    return;
  }

  const shown = filterLimits(
    settings.limits,
    { text: limitSearchText, status: limitStatusFilter },
    today
  );
  if (!shown.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = '没有符合条件的限额网站，换个关键词或筛选条件试试。';
    list.append(empty);
    return;
  }

  for (const limit of shown) {
    const row = document.createElement('div');
    row.className = 'limit-row';

    const info = document.createElement('div');
    info.className = 'limit-info';
    const domain = document.createElement('span');
    domain.className = 'limit-domain';
    domain.textContent = limit.domain;
    const scheduleText = limit.schedule ? ` · ${limit.schedule.from}–${limit.schedule.to} 屏蔽` : '';
    const desc = document.createElement('span');
    desc.className = 'muted num';
    desc.textContent = `每日 ${limit.minutes} 分钟${scheduleText}${limit.enabled ? '' : ' · 已停用'}`;
    info.append(domain, desc);

    const schedBtn = document.createElement('button');
    schedBtn.type = 'button';
    schedBtn.className = 'schedule-btn';
    schedBtn.textContent = '时段';
    schedBtn.title = '时段屏蔽：设定时间窗内打开该网站直接拦截';
    schedBtn.setAttribute('aria-pressed', String(openScheduleId === limit.id));
    schedBtn.addEventListener('click', () => {
      openScheduleId = openScheduleId === limit.id ? null : limit.id;
      if (latestSettings) renderLimits(latestSettings);
    });

    const sw = document.createElement('button');
    sw.className = 'switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(limit.enabled));
    sw.setAttribute('aria-label', `${limit.domain} 限额开关`);
    sw.addEventListener('click', async () => {
      await setLimitEnabled(limit.id, !limit.enabled);
    });

    const del = document.createElement('button');
    del.className = 'limit-delete';
    del.textContent = '✕';
    del.setAttribute('aria-label', `删除 ${limit.domain} 限额`);
    del.addEventListener('click', async () => {
      if (openScheduleId === limit.id) openScheduleId = null;
      await removeLimit(limit.id);
    });

    row.append(info, schedBtn, sw, del);
    list.append(row);

    if (openScheduleId === limit.id) list.append(buildScheduleEditor(limit));
  }
}

function buildScheduleEditor(limit) {
  const editor = document.createElement('div');
  editor.className = 'limit-schedule';

  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!limit.schedule;
  label.append(cb, document.createTextNode('启用时段屏蔽'));

  const from = document.createElement('input');
  from.type = 'time';
  from.value = limit.schedule?.from ?? '23:00';
  from.setAttribute('aria-label', '屏蔽开始时间');
  const sep = document.createElement('span');
  sep.className = 'muted';
  sep.textContent = '至';
  const to = document.createElement('input');
  to.type = 'time';
  to.value = limit.schedule?.to ?? '08:00';
  to.setAttribute('aria-label', '屏蔽结束时间');

  const hint = document.createElement('span');
  hint.className = 'muted hint';
  hint.textContent = '窗口内打开该网站直接拦截，支持跨零点，放行 10 分钟仍然有效';

  async function save(schedule) {
    // 时间不完整或相等视为无效，不落盘（跨零点允许 from > to）。
    if (schedule && (!isValidTime(schedule.from) || !isValidTime(schedule.to) || schedule.from === schedule.to)) {
      return;
    }
    const settings = await getSettings();
    await saveSettings({
      limits: settings.limits.map((l) => (l.id === limit.id ? { ...l, schedule } : l)),
    });
  }

  cb.addEventListener('change', () => save(cb.checked ? { from: from.value, to: to.value } : null));
  from.addEventListener('change', () => cb.checked && save({ from: from.value, to: to.value }));
  to.addEventListener('change', () => cb.checked && save({ from: from.value, to: to.value }));

  editor.append(label, from, sep, to, hint);
  return editor;
}

$('limitMaster').addEventListener('click', async () => {
  const settings = await getSettings();
  await saveSettings({ limitsEnabled: !settings.limitsEnabled });
});

// 搜索与筛选：即时过滤，不落盘。
$('limitSearch').addEventListener('input', (event) => {
  limitSearchText = event.target.value;
  if (latestSettings) renderLimits(latestSettings);
});

for (const segment of document.querySelectorAll('.segment')) {
  segment.addEventListener('click', () => {
    limitStatusFilter = segment.dataset.status;
    for (const other of document.querySelectorAll('.segment')) {
      other.setAttribute('aria-pressed', String(other === segment));
    }
    if (latestSettings) renderLimits(latestSettings);
  });
}

$('limitForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const raw = $('limitDomain').value;
  const domain = normalizeDomain(raw);
  const minutes = clamp(parseInt($('limitMinutes').value, 10) || 0, 5, 1440);
  if (!domain || !minutes) return;

  // 添加第一条限额时自动打开总开关，避免「加了规则却不生效」的陷阱。
  const settings = await getSettings();
  if (!settings.limitsEnabled && settings.limits.length === 0) {
    await saveSettings({ limitsEnabled: true });
  }
  await addLimit(domain, minutes);
  $('limitDomain').value = '';
});

function normalizeDomain(raw) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/* ---------- 健康 ---------- */

function renderHealth(settings) {
  const eye = $('eyeSwitch');
  eye.setAttribute('aria-checked', String(settings.health.eye.enabled));
  $('eyeInterval').value = String(settings.health.eye.intervalMin);

  const sit = $('sitSwitch');
  sit.setAttribute('aria-checked', String(settings.health.sit.enabled));
  $('sitInterval').value = String(settings.health.sit.intervalMin);

  const hours = settings.health.activeHours;
  for (const seg of document.querySelectorAll('#activeHoursMode .segment')) {
    seg.setAttribute('aria-pressed', String(seg.dataset.mode === hours.mode));
  }
  $('activeHoursRange').hidden = hours.mode !== 'range';
  $('activeFrom').value = hours.from;
  $('activeTo').value = hours.to;
}

$('eyeSwitch').addEventListener('click', async () => {
  const settings = await getSettings();
  await saveSettings({ health: { eye: { enabled: !settings.health.eye.enabled } } });
});

$('sitSwitch').addEventListener('click', async () => {
  const settings = await getSettings();
  await saveSettings({ health: { sit: { enabled: !settings.health.sit.enabled } } });
});

// 自定义间隔：限定在允许区间内，越界自动收敛到边界。
function bindInterval(kind, inputId) {
  const range = INTERVAL_RANGES[kind];
  const input = $(inputId);
  input.min = String(range.min);
  input.max = String(range.max);
  input.addEventListener('change', () => {
    const value = clamp(parseInt(input.value, 10) || range.min, range.min, range.max);
    input.value = String(value);
    saveSettings({ health: { [kind]: { intervalMin: value } } });
  });
}

bindInterval('eye', 'eyeInterval');
bindInterval('sit', 'sitInterval');

// 提醒时段：全天 / 时间段（支持跨零点）。
for (const seg of document.querySelectorAll('#activeHoursMode .segment')) {
  seg.addEventListener('click', () => {
    saveSettings({ health: { activeHours: { mode: seg.dataset.mode } } });
  });
}

function saveActiveHours() {
  const from = $('activeFrom').value;
  const to = $('activeTo').value;
  if (!from || !to) return;
  saveSettings({ health: { activeHours: { from, to } } });
}

$('activeFrom').addEventListener('change', saveActiveHours);
$('activeTo').addEventListener('change', saveActiveHours);

/* ---------- 每日目标 ---------- */

$('goalEnabled').addEventListener('change', (event) => {
  saveSettings({ goal: { enabled: event.target.checked } });
});

$('goalMinutes').addEventListener('change', (event) => {
  const minutes = clamp(parseInt(event.target.value, 10) || 240, 15, 1440);
  event.target.value = String(minutes);
  saveSettings({ goal: { dailyMinutes: minutes } });
});

/* ---------- 视频心跳 ---------- */

function renderHeartbeat(settings) {
  const hb = settings.heartbeat;
  $('heartbeatSwitch').setAttribute('aria-checked', String(hb.enabled));

  const row = $('heartbeatSites');
  row.textContent = '';
  for (const site of hb.sites) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(document.createTextNode(site));

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', `移除 ${site} 的视频心跳`);
    del.addEventListener('click', async () => {
      const s = await getSettings();
      await saveSettings({
        heartbeat: { sites: s.heartbeat.sites.filter((x) => x !== site) },
      });
    });

    chip.append(del);
    row.append(chip);
  }
}

$('heartbeatSwitch').addEventListener('click', async () => {
  const s = await getSettings();
  await saveSettings({ heartbeat: { enabled: !s.heartbeat.enabled } });
});

$('heartbeatForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const domain = normalizeDomain($('heartbeatDomain').value);
  if (!domain) return;
  const s = await getSettings();
  if (s.heartbeat.sites.includes(domain)) return;
  await saveSettings({ heartbeat: { sites: [...s.heartbeat.sites, domain] } });
  $('heartbeatDomain').value = '';
});

/* ---------- 数据 ---------- */

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

$('exportCsv').addEventListener('click', async () => {
  const days = await getAllDays();
  download(`zhishi-${dateKey()}.csv`, toCSV(days), 'text/csv');
});

$('exportJson').addEventListener('click', async () => {
  const days = await getAllDays();
  download(`zhishi-${dateKey()}.json`, JSON.stringify(days, null, 2), 'application/json');
});

let clearArmed = null;
$('clearBtn').addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  if (!clearArmed) {
    btn.textContent = '再次点击确认删除';
    btn.classList.replace('btn-outline', 'btn-destructive');
    clearArmed = setTimeout(() => {
      btn.textContent = '清除全部记录';
      btn.classList.replace('btn-destructive', 'btn-outline');
      clearArmed = null;
    }, 3000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = null;
  btn.textContent = '清除全部记录';
  btn.classList.replace('btn-destructive', 'btn-outline');
  await clearAllData();
});

/* ---------- 渲染入口 ---------- */

async function render() {
  const { days, settings } = await loadAll();
  latestDays = days;
  latestSettings = settings;
  renderOverview(days, settings);
  renderLimits(settings);
  renderHealth(settings);
  renderHeartbeat(settings);
}

// 后台每分钟落盘，保持页面数据最新。
let renderTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 300);
});

render();

// 深链支持：右键菜单 / 外部链接可带 ?tab=limits&add=domain，
// 直接切到对应选项卡并预填域名，焦点落到分钟输入框。
const deepLink = new URLSearchParams(location.search);
if (deepLink.get('tab')) showTab(deepLink.get('tab'));
if (deepLink.get('add')) {
  $('limitDomain').value = deepLink.get('add');
  $('limitMinutes').focus();
  $('limitMinutes').select();
}

/**
 * 开发辅助：生成近 140 天的演示数据（仅在控制台手动调用）。
 */
window.__seedDemo = async function () {
  const todayKey = dateKey();
  const domains = [
    ['bilibili.com', 0.35],
    ['github.com', 0.3],
    ['google.com', 0.15],
    ['zhihu.com', 0.12],
    ['stackoverflow.com', 0.08],
  ];
  const writes = {};
  for (let i = 0; i < 140; i++) {
    const key = shiftDateKey(todayKey, -i);
    const dow = new Date(key + 'T00:00:00').getDay();
    const weekend = dow === 0 || dow === 6 ? 0.45 : 1;
    const base = 3600 + Math.round(Math.random() * 18000) * weekend;
    const day = {};
    for (const [domain, share] of domains) {
      if (Math.random() < 0.8) {
        day[domain] = Math.round(base * share * (0.6 + Math.random() * 0.8));
      }
    }
    writes[`d:${key}`] = day;
  }
  await chrome.storage.local.set(writes);
  location.reload();
};
