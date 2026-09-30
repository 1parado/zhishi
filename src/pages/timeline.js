import { dateKey, shortDate, shiftDateKey, sumSeconds } from '../lib/pure.js';
import { applyI18n, fmtDuration, initI18n, t } from '../lib/i18n.js';
import { initTheme } from '../lib/theme.js';
import { getSegmentsByDate } from '../lib/idb.js';
import { getDay, getTimeline } from '../background/store.js';
import { getSettings, saveSettings } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
let currentDate = params.get('date') || dateKey();

// 缩放窗口（当天内的毫秒区间）；null = 全天视图。
const view = { start: null, end: null };
// brush 拖选后短暂抑制色块点击，避免拖选结束误开网站。
let suppressSegClick = false;
// 时间轴图例：默认只展示 Top 6 站点（按当日时长降序），展开偏好跨日保持。
const LEGEND_TOP_N = 6;
let tlLegendExpanded = false;
// 当前点击高亮的站点（null = 不高亮），缩放重绘后保持。
let highlightDomain = null;

function dateLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' }).format(
    new Date(y, m - 1, d)
  );
}

function dayStartMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function fmtClock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function render() {
  await initI18n();
  await applyI18n();
  await initTheme();
  const settings = await getSettings();
  tlLegendExpanded = settings.tlLegendExpanded;

  const [hourBuckets, day, segments] = await Promise.all([
    getTimeline(currentDate),
    getDay(currentDate),
    getSegmentsByDate(currentDate).catch(() => []),
  ]);
  const total = sumSeconds(day);

  $('tlDate').textContent = dateLabel(currentDate);
  $('tlTotal').textContent = fmtDuration(total);
  $('nextDay').disabled = shiftDateKey(currentDate, 1) > dateKey();
  document.title = `${dateLabel(currentDate)} · ${t('timelineTitle')}`;

  const wrap = $('timeline');
  wrap.textContent = '';
  view.start = null;
  view.end = null;
  highlightDomain = null; // 整页重绘时复位过滤

  if (segments.length) {
    renderRibbon(
      segments.map((s) => ({ domain: s.domain, start: s.start, end: s.end })),
      wrap
    );
  } else {
    // 升级前（或 IDB 不可用）的旧数据：退回小时桶近似渲染。
    renderHours(hourBuckets, wrap);
    if (Object.keys(hourBuckets).length) {
      const note = document.createElement('p');
      note.className = 'muted tl-fallback';
      note.textContent = t('tlFallback');
      wrap.append(note);
    }
  }
}

/** 24 小时色带（含缩放窗口、重叠错位、brush 拖选、点击跳转）。 */
function renderRibbon(segsAbs, wrap) {
  wrap.textContent = ''; // 缩放/重置的重绘也走这里，先清空旧内容
  const startMs = dayStartMs(currentDate);
  const dayEnd = startMs + 86400000;
  const vStart = view.start ?? startMs;
  const vEnd = view.end ?? dayEnd;
  const span = vEnd - vStart;

  // 同域名、间隔 ≤ 60 秒的相邻分段合并为「一次浏览」。
  // 计时按分钟切片落盘，直接渲染的话一个多小时的连续浏览会被拆成几十个
  // 小片，悬停只能看到单片的两三秒，与色块长度对不上；合并后色块 =
  // 一次真实浏览，悬停显示整段起止与累计时长（间隔不计入时长）。
  const MERGE_GAP_MS = 60_000;
  const sessions = [];
  const lastByDomain = new Map();
  for (const seg of [...segsAbs].sort((a, b) => a.start - b.start)) {
    const last = lastByDomain.get(seg.domain);
    if (last && seg.start - last.end <= MERGE_GAP_MS) {
      last.end = Math.max(last.end, seg.end);
      last.seconds += seg.end - seg.start;
    } else {
      const s = { domain: seg.domain, start: seg.start, end: seg.end, seconds: seg.end - seg.start };
      sessions.push(s);
      lastByDomain.set(seg.domain, s);
    }
  }

  const colorMap = new Map();
  let colorCursor = 0;
  const colorOf = (domain) => {
    if (!colorMap.has(domain)) {
      colorMap.set(domain, String((colorCursor % 7) + 1));
      colorCursor += 1;
    }
    return colorMap.get(domain);
  };

  const strip = document.createElement('div');
  strip.className = 'tl-strip';

  // 按开始时间铺排合并后的浏览段；与前一段重叠时错位到第二车道（上移 + 半透明）。
  let prevEnd = -Infinity;
  for (const sess of sessions) {
    const s = Math.max(sess.start, vStart);
    const e = Math.min(sess.end, vEnd);
    if (e <= s) continue;
    const el = document.createElement('span');
    el.className = 'tl-seg';
    el.dataset.color = colorOf(sess.domain);
    el.dataset.domain = sess.domain; // 图例点击过滤时按域名匹配
    el.style.left = `${((s - vStart) / span) * 100}%`;
    el.style.width = `${Math.max(((e - s) / span) * 100, 0.15)}%`;
    if (sess.start < prevEnd) {
      el.classList.add('lane2'); // 重叠：上移 2px + 半透明
    } else {
      prevEnd = sess.end;
    }
    el.title = `${sess.domain} · ${fmtClock(s)} – ${fmtClock(e)} · ${fmtDuration(
      Math.round(sess.seconds / 1000)
    )}`;
    el.addEventListener('click', () => {
      if (suppressSegClick) return;
      window.open(`https://${sess.domain}`, '_blank');
    });
    strip.append(el);
  }

  // 左侧日期标签 + 色带 + 刻度轴
  const row = document.createElement('div');
  row.className = 'tl-strip-row';
  const dateChip = document.createElement('span');
  dateChip.className = 'tl-date-chip';
  dateChip.textContent = shortDate(currentDate);
  const main = document.createElement('div');
  main.className = 'tl-strip-main';
  main.append(strip);
  row.append(dateChip, main);

  wrap.append(row);

  // 刻度轴：按缩放窗口自适应步长（约 6 档）。
  const spanMin = span / 60000;
  const steps = [5, 10, 15, 30, 60, 120, 240, 480];
  const stepMin = steps.find((s) => spanMin / s <= 7) ?? 480;
  const axis = document.createElement('div');
  axis.className = 'tl-axis';
  const firstTick = Math.ceil(vStart / (stepMin * 60000)) * stepMin * 60000;
  for (let ms = firstTick; ms <= vEnd; ms += stepMin * 60000) {
    const tick = document.createElement('span');
    tick.className = 'tl-tick';
    tick.textContent = fmtClock(ms);
    tick.style.left = `${((ms - vStart) / span) * 100}%`;
    axis.append(tick);
  }
  main.append(axis);

  // 缩放状态下的重置按钮。
  if (view.start !== null) {
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'btn btn-ghost btn-sm tl-reset';
    reset.textContent = t('tlReset');
    reset.addEventListener('click', () => {
      view.start = null;
      view.end = null;
      renderRibbon(segsAbs, wrap);
    });
    main.append(reset);
  }

  // 图例（域名 + 色点）：按可视区间内站点总时长降序，默认只展示 Top 6，其余折叠降噪。
  const legendBlock = document.createElement('div');
  legendBlock.className = 'tl-legend-block';

  const domainTotal = new Map();
  for (const seg of segsAbs) {
    const s = Math.max(seg.start, vStart);
    const e = Math.min(seg.end, vEnd);
    if (e <= s) continue;
    domainTotal.set(seg.domain, (domainTotal.get(seg.domain) ?? 0) + (e - s));
  }
  const domains = [...colorMap.keys()].sort(
    (a, b) => (domainTotal.get(b) ?? 0) - (domainTotal.get(a) ?? 0)
  );

  const legend = document.createElement('div');
  legend.className = 'legend-row';
  const shownDomains = tlLegendExpanded ? domains : domains.slice(0, LEGEND_TOP_N);
  for (const domain of shownDomains) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'legend-item';
    item.dataset.domain = domain;
    item.classList.toggle('active', highlightDomain === domain);
    item.setAttribute('aria-pressed', String(highlightDomain === domain));
    const dot = document.createElement('span');
    dot.className = 'pie-dot';
    dot.dataset.color = colorMap.get(domain);
    item.append(dot, document.createTextNode(domain));
    // 点击图例：只高亮该站点的色块，其余降低透明度；再次点击取消。
    item.addEventListener('click', () => {
      highlightDomain = highlightDomain === domain ? null : domain;
      applyHighlight(legend);
    });
    legend.append(item);
  }
  legendBlock.append(legend);

  // 展开全部 / 收起：站点数超过 Top N 时才出现，靠右放置，不增加视觉权重。
  if (domains.length > LEGEND_TOP_N) {
    const toggleRow = document.createElement('div');
    toggleRow.className = 'tl-legend-toggle-row';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn btn-ghost btn-sm tl-legend-toggle';
    updateLegendToggle(toggle, domains.length);
    toggle.addEventListener('click', async () => {
      tlLegendExpanded = !tlLegendExpanded;
      // 偏好持久化，跨日与跨刷新保持；重绘时间轴与图例。
      await saveSettings({ tlLegendExpanded });
      renderRibbon(segsAbs, wrap);
    });
    toggleRow.append(toggle);
    legendBlock.append(toggleRow);
  }
  wrap.append(legendBlock);
  applyHighlight(legend);

  attachBrush(strip, segsAbs, wrap, vStart, span);
}

/** 按当前 highlightDomain 过滤时间轴：只显示选中站点的色块，其余隐藏。 */
function applyHighlight(legend) {
  const wrap = $('timeline');
  for (const el of wrap.querySelectorAll('.tl-seg')) {
    const hit = !highlightDomain || el.dataset.domain === highlightDomain;
    el.classList.toggle('off', !hit);
  }
  if (legend) {
    for (const item of legend.querySelectorAll('.legend-item')) {
      const active = item.dataset.domain === highlightDomain;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    }
  }
}

function updateLegendToggle(toggle, count) {
  toggle.textContent = tlLegendExpanded ? t('showLess') : t('tlLegendMore', { n: count });
  toggle.setAttribute('aria-expanded', String(tlLegendExpanded));
}

/** brush 拖选：按住拖动选出时间区间（约 2~4 小时最实用），松开即放大。 */
function attachBrush(strip, segsAbs, wrap, vStart, span) {
  let brushRect = null;
  let x0 = 0;
  let dragging = false;

  strip.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary) return;
    dragging = true;
    x0 = event.clientX;
    brushRect = document.createElement('div');
    brushRect.className = 'tl-brush-rect';
    brushRect.style.left = `${event.clientX - strip.getBoundingClientRect().left}px`;
    brushRect.style.width = '0px';
    strip.append(brushRect);
    strip.setPointerCapture(event.pointerId);
  });

  strip.addEventListener('pointermove', (event) => {
    if (!dragging || !brushRect) return;
    const rect = strip.getBoundingClientRect();
    const x = Math.min(Math.max(event.clientX, rect.left), rect.right);
    const left = Math.min(x0, x);
    brushRect.style.left = `${left - rect.left}px`;
    brushRect.style.width = `${Math.max(Math.abs(x - x0), 1)}px`;
  });

  const finish = (event) => {
    if (!dragging || !brushRect) return;
    dragging = false;
    const rect = strip.getBoundingClientRect();
    const px0 = Math.min(Math.max(x0, rect.left), rect.right);
    const px1 = Math.min(Math.max(event.clientX, rect.left), rect.right);
    const selLeft = Math.min(px0, px1);
    const selWidth = Math.abs(px1 - px0);
    brushRect.remove();
    const wasDragged = selWidth > 6;
    if (wasDragged) suppressSegClick = true;
    setTimeout(() => {
      suppressSegClick = false;
    }, 250);

    if (!wasDragged) return; // 视为点击，不缩放

    const a = vStart + ((selLeft - rect.left) / rect.width) * span;
    const b = vStart + ((selLeft + selWidth - rect.left) / rect.width) * span;
    const selStart = Math.min(a, b);
    const selEnd = Math.max(a, b);
    const selMinutes = (selEnd - selStart) / 60000;

    // 区间过宽（>13h）没有放大意义，过窄（<10min）难以阅读：忽略本次拖选。
    if (selMinutes < 10 || selMinutes > 780) {
      renderRibbon(segsAbs, wrap);
      return;
    }
    view.start = Math.round(selStart);
    view.end = Math.round(selEnd);
    renderRibbon(segsAbs, wrap);
  };

  strip.addEventListener('pointerup', finish);
  strip.addEventListener('pointercancel', (event) => {
    dragging = false;
    brushRect?.remove();
    void event;
  });
}

/** 近似模式（旧数据回退）：把每个小时桶内的域名按顺序铺进 24 小时色带。 */
function renderHours(timeline, wrap) {
  const segsAbs = [];
  const hours = Object.keys(timeline).sort();
  for (const hour of hours) {
    const hourStart = dayStartMs(currentDate) + Number(hour) * 3600000;
    let offset = hourStart;
    const sites = Object.entries(timeline[hour]).sort((a, b) => b[1] - a[1]);
    for (const [domain, seconds] of sites) {
      if (seconds <= 0) continue;
      segsAbs.push({ domain, start: offset, end: offset + seconds * 1000 });
      offset += seconds * 1000;
    }
  }

  if (!segsAbs.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('timelineEmpty');
    wrap.append(empty);
    return;
  }
  renderRibbon(segsAbs, wrap);
}

function goto(key) {
  currentDate = key;
  view.start = null;
  view.end = null;
  highlightDomain = null; // 切换日期后高亮无意义，一并复位
  history.replaceState(null, '', `timeline.html?date=${key}`);
  render();
}

$('prevDay').addEventListener('click', () => goto(shiftDateKey(currentDate, -1)));
$('nextDay').addEventListener('click', () => goto(shiftDateKey(currentDate, 1)));
$('todayBtn').addEventListener('click', () => goto(dateKey()));

render();
