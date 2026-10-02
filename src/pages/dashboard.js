import {
  dateKey,
  filterLimits,
  isValidTime,
  mergeDomains,
  rankEntries,
  shortDate,
  shiftDateKey,
  siteUrl,
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
import { applyI18n, fmtDuration, initI18n, refreshLocale, t } from '../lib/i18n.js';
import { applyTheme, initTheme, resolvedTheme } from '../lib/theme.js';
import { renderShareCardDataURL } from '../lib/share-card.js';
import { siteIconUrl, setFavicons } from '../lib/site-icons.js';
import { loadFaviconMap } from '../lib/favicon.js';
import { openSiteTab } from '../lib/site-link.js';
import { listOpenTabs } from '../lib/open-tabs.js';
import { clearAllData, getAllDays, getAllVisits } from '../background/store.js';

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
      renderOverview(latestDays, latestSettings, latestVisits);
      break;
    case 'limits':
      renderLimits(latestSettings);
      renderHeartbeat(latestSettings); // 视频心跳卡片已移入网站限额页
      break;
    case 'allowlist':
      renderFocus(latestSettings);
      break;
    case 'health':
      renderHealth(latestSettings);
      break;
    case 'data':
      // 导出 / 清除为静态卡片，无需动态渲染。
      break;
    case 'settings':
      renderSettings(latestSettings);
      break;
  }
}

/* ---------- 数据加载 ---------- */

async function loadAll() {
  const [days, visits, settings, favicons] = await Promise.all([
    getAllDays(),
    getAllVisits(),
    getSettings(),
    loadFaviconMap(),
  ]);
  return { days, visits, settings, favicons };
}

/* ---------- 概览 ---------- */

function renderOverview(days, settings, visits) {
  renderWeekChartType(settings.weekChart);
  const todayKey = dateKey();
  const todayTotal = sumSeconds(days[todayKey]);
  const week = weekSeries(days, todayKey, 7);
  const weekTotal = week.reduce((acc, d) => acc + d.seconds, 0);

  $('statToday').textContent = fmtDuration(todayTotal);

  $('statWeek').textContent = fmtDuration(weekTotal);
  $('statWeekAvg').textContent = t('dailyAvg', { time: fmtDuration(Math.round(weekTotal / 7)) });

  renderWeekChart(week, settings.weekChart, settings.goal);
  renderHeatmap(days, todayKey);
  renderTopSites(days, visits, todayKey, settings.topSitesRange, settings.topSitesMetric, settings.mergeByRoot);
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

// 排行维度切换（时间 / 次数）。
for (const segment of document.querySelectorAll('#topSitesMetric .segment')) {
  segment.addEventListener('click', () => {
    topSitesExpanded = false;
    saveSettings({ topSitesMetric: segment.dataset.metric });
  });
}

function renderTopSitesMetricType(metric) {
  for (const segment of document.querySelectorAll('#topSitesMetric .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.metric === metric));
  }
}

// 按根域名合并：只改展示层聚合方式，时长与次数始终按完整域名记录。
$('topSitesMerge').addEventListener('click', async () => {
  const s = await getSettings();
  topSitesExpanded = false;
  await saveSettings({ mergeByRoot: !(s.mergeByRoot !== false) });
});

function renderTopSitesMergeType(byRoot) {
  $('topSitesMerge').setAttribute('aria-checked', String(byRoot === true));
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

// 饼状图七天各一色：chart-1..5 + 两个淡化变体循环。
const DAY_COLORS = ['1', '2', '3', '4', '5', '6', '7'];

function renderWeekChart(week, chartType, goal) {
  const wrap = $('weekChart');
  wrap.textContent = '';
  if (chartType === 'line') return renderWeekLine(week, wrap, goal);
  if (chartType === 'pie') return renderWeekPie(week, wrap);
  // 柱状图不画基线：柱体与基线挤在一起，基线过高时只能贴顶，反而误导。
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

function renderWeekLine(week, wrap, goal) {
  wrap.className = '';
  // 按容器实际宽度绘制，坐标系与显示像素 1:1，高度与柱状图一致（140px）。
  const W = Math.max(wrap.clientWidth || 800, 320);
  const H = 140;
  const dataMax = Math.max(...week.map((d) => d.seconds), 60);
  const bottom = 16;
  const top = 10;
  const todayKey = dateKey();

  // 每日目标基线：始终把目标值纳入 Y 轴范围（取数据与目标的较大者 + 10% 留白），
  // 保证目标虚线一定落在可视区域内。目标远高于数据时折线会被压缩，优先保证基线可见。
  const goalSec = goal?.enabled ? goal.dailyMinutes * 60 : 0;
  const max = goal?.enabled ? Math.max(dataMax, goalSec) * 1.1 : dataMax;

  const pts = week.map((day, i) => [
    (i + 0.5) * W / 7, // 7 等分列中心，与下方标签 grid(gap:0) 列中心严格对齐
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

  // 基线：横向虚线 + 右端数值标签。max = max(dataMax, goalSec)*1.1，yg 恒在绘图区内。
  if (goal?.enabled) {
    const yg = H - bottom - (goalSec / max) * (H - bottom - top);
    svg.append(svgEl('line', { class: 'week-goal-svg', x1: 0, y1: yg, x2: W, y2: yg }));
    const gl = svgEl('text', { class: 'week-goal-svg-label', x: W - 2, y: yg - 3, 'text-anchor': 'end' });
    gl.textContent = fmtDuration(goalSec);
    svg.append(gl);
  }

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
  pieWeekData = { week, total };

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
        'data-i': String(i),
        cx: 50,
        cy: 50,
        r: 38,
        'stroke-dasharray': `${Math.max(frac * C - 1.2, 0.8)} ${C}`,
        'stroke-dashoffset': -acc * C,
        transform: 'rotate(-90 50 50)',
      });
      svg.append(seg);
      acc += frac;
    }

    const item = document.createElement('span');
    item.className = 'legend-item';
    item.dataset.i = String(i);
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
  const grid = $('heatmap');
  const months = $('heatMonths');
  const weekdays = $('heatWeekdays');
  grid.textContent = '';
  months.textContent = '';
  weekdays.textContent = '';
  heatCellData = {};

  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
  const fmtMonth = new Intl.DateTimeFormat(locale, { month: 'short' });
  const fmtWeekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });

  // 左侧星期标签：行序周一 → 周日（与格子行一一对应）。
  const mondayBase = new Date(2026, 8, 21); // 已知周一
  for (let r = 0; r < 7; r++) {
    const span = document.createElement('span');
    span.className = 'heat-weekday';
    span.textContent = fmtWeekday.format(new Date(mondayBase.getTime() + r * 86400000));
    weekdays.append(span);
  }

  // 日历年视图：1 月 1 日 → 12 月 31 日；列 = 周一对齐的 ISO 周（周一在顶部）。
  const year = Number(todayKey.slice(0, 4));
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const firstMonday = new Date(year, 0, 1 - ((yearStart.getDay() + 6) % 7));
  const lastSunday = new Date(year, 11, 31 + (6 - ((yearEnd.getDay() + 6) % 7)));
  const weeks = Math.round((lastSunday - firstMonday) / 86400000 / 7) + 1;
  grid.style.gridTemplateColumns = `repeat(${weeks}, 12px)`;

  const monthCols = new Map(); // 'M' → 该月 1 日的列位与日期（标签对齐用）
  let yearTotal = 0;
  for (let d = new Date(firstMonday); d <= lastSunday; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    const inYear = d.getFullYear() === year;
    const col = Math.floor((d - firstMonday) / 86400000 / 7);
    const row = (d.getDay() + 6) % 7;

    if (inYear && d.getDate() === 1) {
      monthCols.set(`${d.getFullYear()}-${d.getMonth()}`, { col, date: new Date(d) });
    }

    const el = document.createElement('span');
    el.className = 'heat-cell';
    el.style.gridColumn = String(col + 1);
    el.style.gridRow = String(row + 1);

    // 年外的日子或未来日期：透明占位，保持列对齐，不可交互。
    if (!inYear || key > todayKey) {
      el.classList.add('ghost');
      grid.append(el);
      continue;
    }

    const sites = Object.entries(days[key] || {}).sort((a, b) => b[1] - a[1]);
    const seconds = sumSeconds(days[key]);
    yearTotal += seconds;
    heatCellData[key] = { seconds, top: sites.slice(0, 3) };

    el.dataset.level = String(usageLevel(seconds));
    el.dataset.date = key;
    if (seconds > 0) el.classList.add('has-data');
    grid.append(el);
  }

  // 月份标签贴在网格底部、与列对齐（1 月在最左 → 12 月在最右）；相邻过近时跳过。
  const colWidth = 15;
  let prevLeft = -100;
  const sortedMonths = [...monthCols.values()].sort((a, b) => a.col - b.col);
  for (const { col, date } of sortedMonths) {
    const left = col * colWidth;
    if (left - prevLeft < 36) continue;
    prevLeft = left;
    const span = document.createElement('span');
    span.className = 'heat-month';
    span.style.left = `${left + 1}px`;
    span.textContent = fmtMonth.format(date);
    months.append(span);
  }

  $('yearTotal').textContent = t('yearTotal', { time: fmtDuration(yearTotal) });
  $('yearTitle').textContent = locale === 'en' ? String(year) : `${year} 年`;
}

// 悬停详情卡与点击跳转（事件委托，网格重 build 后依然有效）。
let heatCellData = {};

function heatTipContent(key) {
  const data = heatCellData[key] || { seconds: 0, top: [] };
  const [y, m, d] = key.split('-').map(Number);
  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
  const dateText = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(
    new Date(y, m - 1, d)
  );

  const tip = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'tip-title';
  title.textContent = dateText;
  const total = document.createElement('div');
  total.textContent = `${t('totalLabel')}：${fmtDuration(data.seconds)}`;
  tip.append(title, total);
  for (const [domain, seconds] of data.top) {
    const line = document.createElement('div');
    line.className = 'tip-line';
    line.textContent = `${domain} · ${fmtDuration(seconds)}`;
    tip.append(line);
  }
  return tip;
}

const heatGrid = $('heatmap');
const heatTip = $('heatTip');

heatGrid?.addEventListener('mousemove', (event) => {
  if (!heatTip) return;
  const cell = event.target.closest('.heat-cell');
  const data = cell && heatCellData[cell.dataset.date];
  // 0 用时的日期仍显示「日期 + 总计 0」；仅对透明占位格（ghost，无 data）隐藏。
  if (!data) {
    heatTip.hidden = true;
    return;
  }
  heatTip.textContent = '';
  heatTip.append(heatTipContent(cell.dataset.date));
  heatTip.hidden = false;
  const tipWidth = heatTip.offsetWidth || 200;
  const left = Math.min(event.clientX + 14, window.innerWidth - tipWidth - 10);
  heatTip.style.left = `${left}px`;
  heatTip.style.top = `${event.clientY + 14}px`;
});

heatGrid?.addEventListener('mouseleave', () => {
  if (!heatTip) return;
  heatTip.hidden = true;
});

heatGrid?.addEventListener('click', (event) => {
  const cell = event.target.closest('.heat-cell.has-data');
  if (cell) location.href = `timeline.html?date=${cell.dataset.date}`;
});

// 饼图悬停浮层（事件委托，图表重 build 后依然有效）。
let pieWeekData = { week: [], total: 0 };
const pieTip = $('pieTip');
const pieWrapEl = $('weekChart');

function pieTipContent(i) {
  const { week, total } = pieWeekData;
  const day = week[i];
  if (!day) return null;
  const [y, m, d] = day.key.split('-').map(Number);
  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
  const dateText = new Intl.DateTimeFormat(locale, {
    weekday: 'short', month: 'long', day: 'numeric',
  }).format(new Date(y, m - 1, d));
  const pct = total > 0 ? Math.round((day.seconds / total) * 100) : 0;
  const tip = document.createElement('div');
  const title = document.createElement('div');
  title.className = 'tip-title';
  title.textContent = dateText;
  const line = document.createElement('div');
  line.className = 'tip-line';
  line.textContent = `${fmtDuration(day.seconds)} · ${pct}%`;
  tip.append(title, line);
  return tip;
}

function pieHoverIndex(event) {
  const seg = event.target.closest('.pie-seg');
  if (seg && seg.dataset.i != null) return Number(seg.dataset.i);
  const item = event.target.closest('.legend-item');
  if (item && item.dataset.i != null) return Number(item.dataset.i);
  return -1;
}

function clearPieActive() {
  if (!pieWrapEl) return;
  for (const s of pieWrapEl.querySelectorAll('.pie-seg.is-active')) s.classList.remove('is-active');
}

pieWrapEl?.addEventListener('mousemove', (event) => {
  if (!pieTip) return;
  const i = pieHoverIndex(event);
  if (i < 0) { pieTip.hidden = true; clearPieActive(); return; }
  clearPieActive();
  const seg = pieWrapEl.querySelector(`.pie-seg[data-i="${i}"]`);
  if (seg) seg.classList.add('is-active');
  pieTip.textContent = '';
  const content = pieTipContent(i);
  if (!content) { pieTip.hidden = true; return; }
  pieTip.append(content);
  pieTip.hidden = false;
  const tipWidth = pieTip.offsetWidth || 160;
  pieTip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - tipWidth - 10)}px`;
  pieTip.style.top = `${event.clientY + 14}px`;
});

pieWrapEl?.addEventListener('mouseleave', () => {
  if (pieTip) pieTip.hidden = true;
  clearPieActive();
});

$('todayCard').addEventListener('click', () => {
  location.href = `timeline.html?date=${dateKey()}`;
});

$('todayCard').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    location.href = `timeline.html?date=${dateKey()}`;
  }
});

// 排行展示条数：默认前 7，可展开查看更多。
const TOP_SITES_DEFAULT = 7;
const TOP_SITES_MAX = 50;
let topSitesExpanded = false;

function renderTopSites(days, visits, todayKey, range, metric, byRoot) {
  const wrap = $('topSites');
  wrap.textContent = '';
  // 控件高亮跟着渲染走——否则切换后按钮显示的和实际排序不一致。
  renderTopSitesRangeType(range);
  renderTopSitesMetricType(metric);
  renderTopSitesMergeType(byRoot);

  // 时长与次数是两张独立的表（d: / v:），但排行一次只读所选的那一张：
  // 两个维度都在后台照常记录，展示则只显示当前排序依据，避免同一行并排两个数值。
  const byVisits = metric === 'visits';
  const entries = rankEntries(byVisits ? visits : days, todayKey, range, 7, byRoot);
  const total = entries.length;
  const shown = topSitesExpanded ? entries.slice(0, TOP_SITES_MAX) : entries.slice(0, TOP_SITES_DEFAULT);

  if (!total) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = byVisits
      ? t('rankEmptyVisits')
      : range === 'day'
        ? t('rankEmptyDay')
        : t('rankEmptyWeek');
    wrap.append(empty);
    return;
  }

  const max = shown[0].value;
  for (const { domain, value } of shown) {
    // 能还原成合法网址时整行是按钮（点击跳转），否则退化为纯展示行。
    const clickable = siteUrl(domain) !== null;
    const row = document.createElement(clickable ? 'button' : 'div');
    row.className = 'top-row';
    if (clickable) {
      row.type = 'button';
      row.title = t('openSite', { site: domain });
      row.setAttribute('aria-label', t('openSite', { site: domain }));
      row.addEventListener('click', () => openSiteTab(domain));
    }

    const name = document.createElement('span');
    name.className = 'top-name';
    name.textContent = domain;
    name.style.backgroundImage = siteIconUrl(domain);

    const track = document.createElement('div');
    track.className = 'bar-track';
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = `${Math.max((value / max) * 100, 2)}%`;
    track.append(fill);

    // 只显示当前排序维度：按时间排显示时长，按次数排显示次数。
    // 另一个维度仍在后台记录（见 tracker.js 的 addSeconds / noteVisit），只是不在这里展示。
    const time = document.createElement('span');
    time.className = 'top-time num';
    time.textContent = byVisits ? t('visitTimes', { n: value }) : fmtDuration(value);

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
        renderTopSites(
          latestDays,
          latestVisits,
          dateKey(),
          latestSettings.topSitesRange,
          latestSettings.topSitesMetric,
          latestSettings.mergeByRoot
        );
      }
    });
    wrap.append(more);
  }
}

/* ---------- 限额 ---------- */

// 最新数据快照，供搜索/筛选免落盘即时刷新。
let latestDays = null;
let latestVisits = null;
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

// 健康提醒倒计时：开启提醒后每秒刷新「约 X 后提醒」（读取闹钟真实调度时间）；
// 关闭即隐藏。闹钟尚未注册（刚开启的瞬间）时按完整间隔兜底。
const HEALTH_COUNTDOWNS = [
  { kind: 'eye', alarm: 'eyeReminder', el: 'eyeCountdown' },
  { kind: 'sit', alarm: 'sitReminder', el: 'sitCountdown' },
];

async function updateHealthCountdown() {
  if (!latestSettings) return;
  for (const { kind, alarm, el } of HEALTH_COUNTDOWNS) {
    const node = $(el);
    const cfg = latestSettings.health[kind];
    if (!cfg?.enabled || !(cfg.intervalMin > 0)) {
      node.hidden = true;
      continue;
    }
    let remainMs = null;
    try {
      const a = await chrome.alarms.get(alarm);
      if (a?.scheduledTime != null) remainMs = a.scheduledTime - Date.now();
    } catch {
      // alarms API 不可用：按完整间隔兜底
    }
    if (remainMs == null) remainMs = cfg.intervalMin * 60_000;
    if (remainMs < 0) remainMs = 0;
    node.hidden = false;
    node.textContent = t('nextReminderIn', { time: fmtDuration(Math.round(remainMs / 1000)) });
  }
}
setInterval(updateHealthCountdown, 1000);

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

/* ---------- 设置 ---------- */

async function renderSettings(settings) {
  $('goalSwitch').setAttribute('aria-checked', String(settings.goal.enabled));
  $('goalLine').hidden = !settings.goal.enabled;
  $('goalMinutes').value = String(settings.goal.dailyMinutes);
  $('faviconSwitch').setAttribute('aria-checked', String(settings.realFavicon));
  renderLocaleSwitch(await initI18n());
}

$('goalSwitch').addEventListener('click', async () => {
  const settings = await getSettings();
  await saveSettings({ goal: { enabled: !settings.goal.enabled } });
});

// 图标来源切换。settings 变化会触发本页重渲染（见 storage.onChanged），
// 届时 setFavicons 会用新开关重新注入，无需手动刷新。
$('faviconSwitch').addEventListener('click', async () => {
  const settings = await getSettings();
  await saveSettings({ realFavicon: !settings.realFavicon });
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

/* ---------- 专注模式 ---------- */

function renderFocus(settings) {
  const focus = settings.focus || { enabled: false, sites: [] };
  $('focusSwitch').setAttribute('aria-checked', String(focus.enabled));
  $('focusSwitch').closest('.focus-card').classList.toggle('focus-on', focus.enabled);

  const row = $('focusSites');
  row.textContent = '';
  if (!focus.sites.length) {
    const empty = document.createElement('p');
    // 不用公共 .empty（带品牌时钟图标），白名单空态只要一行安静的小字。
    empty.className = 'muted focus-empty';
    empty.textContent = t('focusEmpty');
    row.append(empty);
    renderFocusPicker();
    return;
  }
  for (const site of focus.sites) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(document.createTextNode(site));

    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', t('focusRemoveAria', { domain: site }));
    del.addEventListener('click', async () => {
      const s = await getSettings();
      await saveSettings({ focus: { sites: s.focus.sites.filter((x) => x !== site) } });
    });

    chip.append(del);
    row.append(chip);
  }
  renderFocusPicker();
}

/* ---------- 白名单：从当前标签页批量添加 ---------- */

// 打开面板时快照一次标签页列表：面板开着时整页每分钟还会重渲染，
// 每次都重新 query 会让行序和勾选在用户眼皮底下跳动。
let pickedTabs = [];
let pickerSelected = new Set();
let pickerOpen = false;
// 「已加入 N 个站点」这类一次性反馈：留在脚注里直到下一次交互。
// 不这样做的话，加入后 300ms 的整页重渲染会立刻把它冲掉，点击像没反应。
let pickerFlash = '';

/** 当前所有可添加的标签项（排除已在白名单里的域名）。 */
function addableTabs() {
  const sites = latestSettings?.focus?.sites ?? [];
  return pickedTabs.filter((tab) => !sites.includes(tab.domain));
}

async function openPicker() {
  pickerOpen = true;
  pickerFlash = '';
  pickerSelected.clear();
  $('focusPicker').hidden = false;
  $('focusImportToggle').setAttribute('aria-expanded', 'true');
  pickedTabs = await listOpenTabs();
  renderPicker();
}

function closePicker() {
  pickerOpen = false;
  pickerFlash = '';
  pickerSelected.clear();
  $('focusPicker').hidden = true;
  $('focusImportToggle').setAttribute('aria-expanded', 'false');
}

function renderPicker() {
  // 已经被加入白名单的域名不再可能被选中（批量加入后勾选自动落到 0）。
  const addableSet = new Set(addableTabs().map((tab) => tab.domain));
  for (const domain of [...pickerSelected]) {
    if (!addableSet.has(domain)) pickerSelected.delete(domain);
  }

  const list = $('focusPickerList');
  const sites = latestSettings?.focus?.sites ?? [];
  list.textContent = '';

  if (!pickedTabs.length) {
    const empty = document.createElement('p');
    empty.className = 'muted focus-empty';
    empty.textContent = t('focusPickerEmpty');
    list.append(empty);
  }

  for (const { domain, count } of pickedTabs) {
    const inList = sites.includes(domain);
    const row = document.createElement('div');
    row.className = inList ? 'tab-pick-row is-added' : 'tab-pick-row';

    const main = document.createElement('label');
    main.className = 'tab-pick-main';

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'tab-pick-box';
    box.disabled = inList;
    // 已在白名单的行显示为「已勾选但不可改」——配右侧的「已在白名单」标签，
    // 一眼能看出它已经在名单里，而不是「没被选中」。
    box.checked = inList || pickerSelected.has(domain);
    box.setAttribute('aria-label', domain);
    // 只更新计数与按钮态，不整块重渲染——重建节点会让勾选框失去焦点。
    box.addEventListener('change', () => {
      if (box.checked) pickerSelected.add(domain);
      else pickerSelected.delete(domain);
      pickerFlash = '';
      renderPickerFooter();
    });

    const icon = document.createElement('span');
    icon.className = 'tab-pick-icon';
    icon.style.backgroundImage = siteIconUrl(domain);

    const name = document.createElement('span');
    name.className = 'tab-pick-name';
    name.textContent = domain;

    main.append(box, icon, name);

    if (count > 1) {
      const meta = document.createElement('span');
      meta.className = 'tab-pick-meta muted num';
      meta.textContent = t('focusPickerTabs', { n: count });
      main.append(meta);
    }

    row.append(main);

    // 单个与批量共用勾选这一条路径：只勾一行再点「批量加入」就是只加一个。
    // 曾经的「行内 ＋ 快速添加」是第二条路径，两套心智模型反而要用户先选，
    // 已移除——已在白名单的行用标签说明状态即可。
    if (inList) {
      const tag = document.createElement('span');
      tag.className = 'tab-pick-tag muted';
      tag.textContent = t('focusPickerAdded');
      row.append(tag);
    }

    list.append(row);
  }

  renderPickerFooter();
}

function renderPickerFooter() {
  const addable = addableTabs();
  const selected = pickerSelected.size;

  $('focusPickerCount').textContent =
    pickerFlash || (selected ? t('focusPickerSelected', { n: selected }) : t('focusPickerNoneSel'));

  const addBtn = $('focusPickerAdd');
  addBtn.disabled = selected === 0;
  // 只勾一个时不再说「批量加入 1 个」——单个与批量走的是同一条勾选路径。
  addBtn.textContent = selected
    ? selected === 1
      ? t('focusPickerAddOne')
      : t('focusPickerAddN', { n: selected })
    : t('focusPickerAdd');

  // 全选按钮在「全选中 / 有未选」之间切换文案，有可选项时才可用。
  const all = addable.map((tab) => tab.domain);
  const allSelected = all.length > 0 && all.every((domain) => pickerSelected.has(domain));
  const allBtn = $('focusPickerAll');
  allBtn.disabled = all.length === 0;
  allBtn.textContent = allSelected ? t('focusPickerClear') : t('focusPickerAll');

  const note = $('focusImportNote');
  note.hidden = false;
  note.textContent = addable.length
    ? t('focusImportFound', { n: addable.length })
    : t('focusImportNone');
}

/** 面板开着时随整页重渲染刷新（例如从别处改了白名单）。未打开则不动。 */
function renderFocusPicker() {
  if (pickerOpen) renderPicker();
}

/**
 * 加入白名单：批量与单条共用一条路径，一次写入，避免逐条 saveSettings
 * 触发多次落盘与多次重渲染。新增 0 个（都已在白名单里）时不写存储。
 */
async function addFocusSites(domains) {
  const s = await getSettings();
  const sites = s.focus?.sites ?? [];
  const next = mergeDomains(sites, domains);
  const added = next.length - sites.length;

  if (added > 0) {
    await saveSettings({ focus: { sites: next } });
    // 不等 storage.onChanged 的 300ms 防抖，先把本地镜像推进到最新，
    // 让 chips 与选择器（renderFocus 内部会带上）立刻反映结果。
    latestSettings = { ...s, focus: { ...(s.focus ?? { enabled: false }), sites: next } };
  }
  if (pickerOpen) {
    pickerFlash = added ? t('focusPickerAddedN', { n: added }) : t('focusPickerAllAdded');
  }
  if (added > 0 || pickerOpen) renderFocus(latestSettings);
}

$('focusImportToggle').addEventListener('click', () => {
  if (pickerOpen) closePicker();
  else openPicker();
});

$('focusPickerRefresh').addEventListener('click', async () => {
  pickerFlash = '';
  pickedTabs = await listOpenTabs();
  renderPicker();
});

$('focusPickerAll').addEventListener('click', () => {
  const all = addableTabs().map((tab) => tab.domain);
  const allSelected = all.length > 0 && all.every((domain) => pickerSelected.has(domain));
  pickerSelected = new Set(allSelected ? [] : all);
  pickerFlash = '';
  // 勾选框要跟着动，整块重渲染一次最省事（这里没有焦点需要保留）。
  renderPicker();
});

$('focusPickerAdd').addEventListener('click', () => {
  if (!pickerSelected.size) return;
  addFocusSites([...pickerSelected]);
});

$('focusPickerClose').addEventListener('click', closePicker);

$('focusSwitch').addEventListener('click', async () => {
  const s = await getSettings();
  await saveSettings({ focus: { enabled: !(s.focus?.enabled === true) } });
  // 立即重估当前标签页：白名单外站点马上跳拦截页 / 关闭后马上放行。
  chrome.runtime.sendMessage({ type: 'zhishi-popup-opened' }).catch(() => {});
});

$('focusForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const domain = normalizeDomain($('focusDomain').value);
  if (!domain) return;
  const s = await getSettings();
  if (s.focus.sites.includes(domain)) return;
  await saveSettings({ focus: { sites: [...s.focus.sites, domain] } });
  $('focusDomain').value = '';
});

/* ---------- 分享卡片 ---------- */

function shareStrings() {
  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
  const fmtWd = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  // 2026-09-21 是已知周一，依次取周一..周日标签
  const weekLabels = Array.from({ length: 7 }, (_, i) =>
    fmtWd.format(new Date(2026, 8, 21 + i))
  );
  return {
    brand: '知时',
    tagline: t('brandSubDash'),
    report: t('shareReport'),
    hourShort: t('hourShort'),
    totalLabel: t('shareTotalLabel'),
    activeDaysN: t('shareActiveDaysN'),
    dailyAvg: t('shareDailyAvg'),
    peakDay: t('sharePeakDay'),
    topSite: t('shareTopSite'),
    sitesTitle: t('shareSitesTitle'),
    heatTitle: t('shareHeatTitle'),
    byWeekday: t('shareByWeekday'),
    weekLabels,
    less: t('heatFew'),
    more: t('heatMany'),
    empty: t('shareEmpty'),
    generated: t('shareGenerated'),
    // 日报 / 周报卡
    badgeDay: t('shareBadgeDay'),
    badgeWeek: t('shareBadgeWeek'),
    todayTotal: t('shareTodayTotal'),
    weekTotal: t('shareWeekTotal'),
    vsYesterday: t('shareVsYesterday'),
    vsPrev7: t('shareVsPrev7'),
    flat: t('shareFlat'),
    miniTitle: t('shareMiniTitle'),
    activeSites: t('shareActiveSites'),
    streak: t('shareStreak'),
    streakDays: t('shareStreakDays'),
    streakChip: t('shareStreakChip'),
    busiestDay: t('shareBusiestDay'),
  };
}

// 弹窗内当前卡片类型与资料编辑状态。三个入口共用一个弹窗。
let shareRange = 'year';
let shareNameTimer = null;

function syncShareRangeUI() {
  for (const segment of document.querySelectorAll('#shareRange .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.range === shareRange));
  }
}

function syncShareProfileUI() {
  const profile = latestSettings?.profile || {};
  $('shareNameInput').value = profile.name || '';
  $('shareShowSwitch').setAttribute('aria-checked', String(profile.show !== false));
  const hasAvatar = !!profile.avatar;
  $('shareAvatarPreview').src = profile.avatar || '';
  $('shareAvatarPreview').hidden = !hasAvatar;
  $('shareAvatarPlaceholder').hidden = hasAvatar;
  $('shareAvatarRemove').hidden = !hasAvatar;
}

async function redrawShareCard() {
  const days = latestDays || (await getAllDays());
  const url = await renderShareCardDataURL({
    days,
    todayKey: dateKey(),
    range: shareRange,
    strings: shareStrings(),
    profile: latestSettings?.profile || null,
    theme: resolvedTheme(),
    // 分享卡片是导出物，没有自己的开关：跟随「按根域名合并」设置，
    // 免得卡片上的 Top5 与仪表盘排行显示不一致。
    byRoot: latestSettings?.mergeByRoot !== false,
  });
  $('sharePreview').src = url;
  $('shareDownload').href = url;
  $('shareDownload').download = `zhishi-share-${shareRange}.png`;
}

function openShareModal(range) {
  shareRange = range;
  syncShareRangeUI();
  syncShareProfileUI();
  redrawShareCard();
  $('shareModal').hidden = false;
}

$('shareCardBtn')?.addEventListener('click', () => openShareModal('year'));

// 今日 / 近 7 天统计卡内嵌分享按钮：阻断冒泡，避免触发卡片本身的跳转。
$('shareTodayBtn')?.addEventListener('click', (event) => {
  event.stopPropagation();
  openShareModal('day');
});
$('shareTodayBtn')?.addEventListener('keydown', (event) => event.stopPropagation());
$('shareWeekBtn')?.addEventListener('click', () => openShareModal('week'));

for (const segment of document.querySelectorAll('#shareRange .segment')) {
  segment.addEventListener('click', () => {
    shareRange = segment.dataset.range;
    syncShareRangeUI();
    redrawShareCard();
  });
}

// 昵称即时保存（防抖）并重绘。
$('shareNameInput')?.addEventListener('input', (event) => {
  clearTimeout(shareNameTimer);
  shareNameTimer = setTimeout(async () => {
    latestSettings = await saveSettings({ profile: { name: event.target.value } });
    redrawShareCard();
  }, 250);
});

// 头像上传：居中方形裁剪并压缩到 256×256 JPEG 存 data URL（仅本机）。
async function compressAvatar(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('empty image');
    const S = 256;
    const canvas = document.createElement('canvas');
    canvas.width = S;
    canvas.height = S;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, S, S);
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      S,
      S
    );
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

$('shareAvatarInput')?.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    const avatar = await compressAvatar(file);
    latestSettings = await saveSettings({ profile: { avatar } });
    syncShareProfileUI();
    redrawShareCard();
  } catch {
    // 图片解析失败：忽略本次选择
  }
});

$('shareAvatarRemove')?.addEventListener('click', async () => {
  latestSettings = await saveSettings({ profile: { avatar: '' } });
  syncShareProfileUI();
  redrawShareCard();
});

$('shareShowSwitch')?.addEventListener('click', async () => {
  const show = latestSettings?.profile?.show === false;
  latestSettings = await saveSettings({ profile: { show } });
  syncShareProfileUI();
  redrawShareCard();
});

for (const el of document.querySelectorAll('#shareModal [data-close]')) {
  el.addEventListener('click', () => {
    $('shareModal').hidden = true;
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('shareModal').hidden) {
    $('shareModal').hidden = true;
  }
});

// auto 主题下系统切换明暗时，弹窗开着就同步重绘卡片主题。
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!$('shareModal').hidden) redrawShareCard();
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
  const { days, visits, settings, favicons } = await loadAll();
  latestDays = days;
  latestVisits = visits;
  latestSettings = settings;
  // 图标必须在 renderActiveTab 之前注入：siteIconUrl 是同步取值的。
  setFavicons(favicons, settings.realFavicon);
  applyTheme(settings.theme);
  renderThemeSwitch(settings.theme);
  renderActiveTab();
  // 弹窗开着时（语言切换 / 数据落盘）同步重绘分享卡片。
  if (!$('shareModal').hidden) redrawShareCard();
}

function renderLocaleSwitch(locale) {
  for (const segment of document.querySelectorAll('#localeSwitch .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.locale === locale));
  }
}

// 主题切换：保存偏好 → 立即套用 → 重渲染当前选项卡。
function renderThemeSwitch(theme) {
  for (const segment of document.querySelectorAll('#dashThemeSwitch .segment')) {
    segment.setAttribute('aria-pressed', String(segment.dataset.theme === theme));
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

for (const segment of document.querySelectorAll('#dashThemeSwitch .segment')) {
  segment.addEventListener('click', async () => {
    const theme = segment.dataset.theme;
    applyTheme(theme);
    renderThemeSwitch(theme);
    await saveSettings({ theme });
  });
}

// 后台每分钟落盘，保持页面数据最新。
let renderTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) {
    const s = changes.settings.newValue;
    refreshLocale(s?.locale);
    applyTheme(s?.theme);
    renderThemeSwitch(s?.theme);
    applyI18n().then(renderActiveTab);
  }
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 300);
});

// 初始化语言（读取保存的偏好）并套用静态文案，再渲染数据。
await initI18n();
await applyI18n();
await initTheme();
render();

// 深链支持：右键菜单 / 外部链接可带 ?tab=limits&add=domain（或 tab=allowlist），
// 直接切到对应选项卡并预填域名，焦点落到输入框。
const deepLink = new URLSearchParams(location.search);
if (deepLink.get('tab')) showTab(deepLink.get('tab'));
if (deepLink.get('add')) {
  if (deepLink.get('tab') === 'allowlist') {
    $('focusDomain').value = deepLink.get('add');
    $('focusDomain').focus();
  } else {
    $('limitDomain').value = deepLink.get('add');
    $('limitMinutes').focus();
    $('limitMinutes').select();
  }
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
