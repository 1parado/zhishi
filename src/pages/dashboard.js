import {
  dateKey,
  filterLimits,
  fmtDuration,
  goalVariant,
  isValidTime,
  shortDate,
  shiftDateKey,
  sumSeconds,
  toCSV,
  usageLevel,
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
import { applyI18n, initI18n, refreshLocale, t } from '../lib/i18n.js';
import { clearAllData, getAllDays } from '../background/store.js';

const $ = (id) => document.getElementById(id);

// 只渲染当前可见的选项卡：数据每分钟刷新一次，
// 避免每次都重建热力图（371 个节点）等隐藏区域造成卡顿。
let activeTabName = 'overview';

/* ---------- 选项卡 ---------- */

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
}

function showTab(name) {
  activeTabName = name;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-pressed', String(tab.dataset.tab === name));
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.hidden = panel.id !== `tab-${name}`;
  }
  renderActiveTab();
}

function renderActiveTab() {
  if (!latestSettings) return;
  switch (activeTabName) {
    case 'overview':
      renderOverview(latestDays, latestSettings);
      break;
    case 'limits':
      renderLimits(latestSettings);
      break;
    case 'health':
      renderHealth(latestSettings);
      break;
    case 'data':
      renderHeartbeat(latestSettings);
      break;
  }
}

/* ---------- 数据加载 ---------- */

async function loadAll() {
  const [days, settings] = await Promise.all([getAllDays(), getSettings()]);
  return { days, settings };
}

/* ---------- 概览 ---------- */

function renderOverview(days, settings) {
  renderWeekChartType(settings.weekChart);
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
        ok: t('goalOk'),
        near: t('goalNear'),
        over: t('goalOver'),
        none: '',
      }[goalVariant(todayTotal, goalSeconds)]
    : '';

  $('statWeek').textContent = fmtDuration(weekTotal);
  $('statWeekAvg').textContent = t('dailyAvg', { time: fmtDuration(Math.round(weekTotal / 7)) });

  renderWeekChart(week, settings.weekChart);
  renderHeatmap(days, todayKey);
  renderTopSites(days, todayKey, settings.topSitesRange);
}

// 图表形式切换，偏好持久化到设置。
for (const segment of document.querySelectorAll('#weekChartType .segment')) {
  segment.addEventListener('click', () => {
    saveSettings({ weekChart: segment.dataset.type });
  });
}

function renderWeekChartType(type) {
  for (const segment of document.querySelectorAll('#weekChartType .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.type === type));
  }
}

// 排行范围切换（今日 / 近 7 天），切换时收起展开状态。
for (const segment of document.querySelectorAll('#topSitesRange .segment')) {
  segment.addEventListener('click', () => {
    topSitesExpanded = false;
    saveSettings({ topSitesRange: segment.dataset.range });
  });
}

function renderTopSitesRangeType(range) {
  for (const segment of document.querySelectorAll('#topSitesRange .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.range === range));
  }
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

// 近 7 天的 7 种切片颜色（chart-1..5 + 两个淡化变体）。
const DAY_COLORS = ['1', '2', '3', '4', '5', '6', '7'];

function renderWeekChart(week, chartType) {
  const wrap = $('weekChart');
  wrap.textContent = '';
  if (chartType === 'line') return renderWeekLine(week, wrap);
  if (chartType === 'pie') return renderWeekPie(week, wrap);
  renderWeekBar(week, wrap);
}

function renderWeekBar(week, wrap) {
  wrap.className = 'week-chart';
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
    label.textContent = day.key === todayKey ? t('today') : weekdayShort(day.key);

    col.append(bar, label);
    wrap.append(col);
  }
}

function renderWeekLine(week, wrap) {
  wrap.className = '';
  // 按容器实际宽度绘制，坐标系与显示像素 1:1，高度与柱状图一致（140px）。
  const W = Math.max(wrap.clientWidth || 800, 320);
  const H = 140;
  const max = Math.max(...week.map((d) => d.seconds), 60);
  const bottom = 16;
  const top = 10;
  const todayKey = dateKey();
  const pts = week.map((day, i) => [
    8 + (i * (W - 16)) / 6,
    H - bottom - (day.seconds / max) * (H - bottom - top),
  ]);

  const svg = svgEl('svg', { class: 'week-svg', viewBox: `0 0 ${W} ${H}` });
  svg.append(
    svgEl('polygon', {
      class: 'week-area',
      points: `${pts[0][0]},${H - bottom} ${pts.map((p) => p.join(',')).join(' ')} ${pts[6][0]},${H - bottom}`,
    }),
    svgEl('line', { class: 'week-baseline', x1: 4, y1: H - bottom, x2: W - 4, y2: H - bottom }),
    svgEl('polyline', { class: 'week-line', points: pts.map((p) => p.join(',')).join(' ') })
  );
  for (const [i, p] of pts.entries()) {
    const dot = svgEl('circle', { class: 'week-dot', cx: p[0], cy: p[1], r: 3.5 });
    const title = svgEl('title');
    title.textContent = `${week[i].key} · ${fmtDuration(week[i].seconds)}`;
    dot.append(title);
    svg.append(dot);
  }
  wrap.append(svg);
  appendWeekLabels(wrap, week, todayKey);
}

function renderWeekPie(week, wrap) {
  wrap.className = '';
  const todayKey = dateKey();
  const total = week.reduce((acc, day) => acc + day.seconds, 0);

  const legend = document.createElement('div');
  legend.className = 'legend-row';

  if (total <= 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('rankEmptyWeek');
    wrap.append(empty);
    return;
  }

  const C = 2 * Math.PI * 38;
  const svg = svgEl('svg', { class: 'week-svg', viewBox: '0 0 100 100' });
  let acc = 0;
  for (const [i, day] of week.entries()) {
    const frac = day.seconds / total;
    if (frac > 0) {
      const seg = svgEl('circle', {
        class: 'pie-seg',
        'data-color': DAY_COLORS[i],
        cx: 50,
        cy: 50,
        r: 38,
        'stroke-dasharray': `${Math.max(frac * C - 1.2, 0.8)} ${C}`,
        'stroke-dashoffset': -acc * C,
        transform: 'rotate(-90 50 50)',
      });
      const title = svgEl('title');
      title.textContent = `${shortDate(day.key)} · ${fmtDuration(day.seconds)}`;
      seg.append(title);
      svg.append(seg);
      acc += frac;
    }

    const item = document.createElement('span');
    item.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'pie-dot';
    dot.dataset.color = DAY_COLORS[i];
    item.append(dot, document.createTextNode(`${shortDate(day.key)} ${fmtDuration(day.seconds)}`));
    legend.append(item);
  }

  const pieWrap = document.createElement('div');
  pieWrap.className = 'pie-wrap';
  pieWrap.append(svg);
  const center = document.createElement('div');
  center.className = 'pie-center';
  const value = document.createElement('span');
  value.className = 'pie-total num';
  value.textContent = fmtDuration(total);
  const caption = document.createElement('span');
  caption.className = 'muted';
  caption.textContent = t('rangeWeek');
  center.append(value, caption);
  pieWrap.append(center);

  wrap.append(pieWrap, legend);
}

function appendWeekLabels(wrap, week, todayKey) {
  const labels = document.createElement('div');
  labels.className = 'week-chart week-labels';
  for (const day of week) {
    const span = document.createElement('span');
    span.className = 'week-label' + (day.key === todayKey ? ' is-today' : '');
    span.textContent = day.key === todayKey ? t('today') : weekdayShort(day.key);
    labels.append(span);
  }
  wrap.append(labels);
}

function renderHeatmap(days, todayKey) {
  const wrap = $('heatmap');
  wrap.textContent = '';

  // 对齐到周：以今天所在周的周日为终点，向前铺 53 周。
  const today = new Date(todayKey + 'T00:00:00');
  const end = shiftDateKey(todayKey, today.getDay() === 6 ? 0 : 6 - today.getDay());
  const cells = [];
  let yearTotal = 0;
  for (let i = 0; i < 371; i++) {
    const key = shiftDateKey(end, -i);
    if (key > todayKey) continue; // 最后一周未来日期留空
    const seconds = sumSeconds(days[key]);
    yearTotal += seconds;
    cells.push({ key, seconds });
  }

  for (const cell of cells) {
    const el = document.createElement('span');
    el.className = 'heat-cell';
    el.dataset.level = String(usageLevel(cell.seconds));
    el.title = `${cell.key} · ${fmtDuration(cell.seconds)}`;
    wrap.append(el);
  }

  $('yearTotal').textContent = t('yearTotal', { time: fmtDuration(yearTotal) });
}

// 排行展示条数：默认前 7，可展开查看更多。
const TOP_SITES_DEFAULT = 7;
const TOP_SITES_MAX = 50;
let topSitesExpanded = false;

function renderTopSites(days, todayKey, range) {
  const wrap = $('topSites');
  wrap.textContent = '';

  let entries;
  if (range === 'day') {
    entries = Object.entries(days[todayKey] || {});
  } else {
    const week = weekSeries(days, todayKey, 7);
    const totals = {};
    for (const day of week) {
      for (const [domain, seconds] of Object.entries(days[day.key] || {})) {
        totals[domain] = (totals[domain] || 0) + seconds;
      }
    }
    entries = Object.entries(totals);
  }
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.length;
  const shown = topSitesExpanded ? entries.slice(0, TOP_SITES_MAX) : entries.slice(0, TOP_SITES_DEFAULT);

  if (!total) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = range === 'day' ? t('rankEmptyDay') : t('rankEmptyWeek');
    wrap.append(empty);
    return;
  }

  const max = shown[0][1];
  for (const [domain, seconds] of shown) {
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

  if (total > TOP_SITES_DEFAULT) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'btn btn-ghost btn-sm top-more';
    more.textContent = topSitesExpanded
      ? t('showLess')
      : t('showMore', { n: total });
    more.addEventListener('click', () => {
      topSitesExpanded = !topSitesExpanded;
      if (latestDays && latestSettings) {
        renderTopSites(latestDays, dateKey(), latestSettings.topSitesRange);
      }
    });
    wrap.append(more);
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
    empty.textContent = t('limitsEmpty');
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
    empty.textContent = t('limitsEmptyFiltered');
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
    const scheduleText = limit.schedule
      ? t('blockedSuffix', { from: limit.schedule.from, to: limit.schedule.to })
      : '';
    const desc = document.createElement('span');
    desc.className = 'muted num';
    desc.textContent =
      t('perDay', { n: limit.minutes }) +
      scheduleText +
      (limit.enabled ? '' : t('disabledSuffix'));
    info.append(domain, desc);

    const schedBtn = document.createElement('button');
    schedBtn.type = 'button';
    schedBtn.className = 'schedule-btn';
    schedBtn.textContent = t('scheduleBtn');
    schedBtn.title = t('scheduleHint');
    schedBtn.setAttribute('aria-pressed', String(openScheduleId === limit.id));
    schedBtn.addEventListener('click', () => {
      openScheduleId = openScheduleId === limit.id ? null : limit.id;
      if (latestSettings) renderLimits(latestSettings);
    });

    const sw = document.createElement('button');
    sw.className = 'switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(limit.enabled));
    sw.setAttribute('aria-label', t('limitSwitchAria', { domain: limit.domain }));
    sw.addEventListener('click', async () => {
      await setLimitEnabled(limit.id, !limit.enabled);
    });

    const del = document.createElement('button');
    del.className = 'limit-delete';
    del.textContent = '✕';
    del.setAttribute('aria-label', t('limitRemoveAria', { domain: limit.domain }));
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
  label.append(cb, document.createTextNode(t('scheduleEnable')));

  const from = document.createElement('input');
  from.type = 'time';
  from.value = limit.schedule?.from ?? '23:00';
  from.setAttribute('aria-label', t('scheduleStartAria'));
  const sep = document.createElement('span');
  sep.className = 'muted';
  sep.textContent = t('to');
  const to = document.createElement('input');
  to.type = 'time';
  to.value = limit.schedule?.to ?? '08:00';
  to.setAttribute('aria-label', t('scheduleEndAria2'));

  const hint = document.createElement('span');
  hint.className = 'muted hint';
  hint.textContent = t('scheduleHint');

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

// 窗口尺寸变化时重绘当前选项卡（折线图按容器宽度绘制）。
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(renderActiveTab, 200);
});

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
    del.setAttribute('aria-label', t('hbRemoveAria', { domain: site }));
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

// 心跳诊断：显示后台最近采信的心跳，便于确认「看视频不计」类问题。
async function renderHeartbeatStatus() {
  const el = $('heartbeatStatus');
  if (!el) return;
  try {
    const res = await chrome.runtime.sendMessage({ type: 'debug-heartbeats' });
    const entries = Object.entries(res?.heartbeats || {});
    if (!entries.length) {
      el.textContent = t('hbNone');
      return;
    }
    el.textContent = t('hbNow', {
      list: entries.map(([domain, age]) => `${domain} · ${age}${t('secondsAgo')}`).join(', '),
    });  } catch {
    el.textContent = '';
  }
}

renderHeartbeatStatus();
setInterval(renderHeartbeatStatus, 20_000);

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
    btn.textContent = t('clearConfirm');
    btn.classList.replace('btn-outline', 'btn-destructive');
    clearArmed = setTimeout(() => {
      btn.textContent = t('clearBtn');
      btn.classList.replace('btn-destructive', 'btn-outline');
      clearArmed = null;
    }, 3000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = null;
  btn.textContent = t('clearBtn');
  btn.classList.replace('btn-destructive', 'btn-outline');
  await clearAllData();
});

/* ---------- 渲染入口 ---------- */

async function render() {
  await initI18n();
  renderLocaleSwitch(await initI18n());
  const { days, settings } = await loadAll();
  latestDays = days;
  latestSettings = settings;
  renderActiveTab();
}

function renderLocaleSwitch(locale) {
  for (const segment of document.querySelectorAll('#localeSwitch .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.locale === locale));
  }
}

// 语言切换：保存偏好 → 刷新词典缓存 → 重套文案 → 重渲染当前选项卡。
for (const segment of document.querySelectorAll('#localeSwitch .segment')) {
  segment.addEventListener('click', async () => {
    await saveSettings({ locale: segment.dataset.locale });
    refreshLocale(segment.dataset.locale);
    await applyI18n();
    renderActiveTab();
  });
}

// 后台每分钟落盘，保持页面数据最新。
let renderTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    refreshLocale(changes.settings.newValue?.locale);
    applyI18n().then(renderActiveTab);
  }
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
