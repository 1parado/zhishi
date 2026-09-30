import { dateKey, shortDate, shiftDateKey, sumSeconds } from '../lib/pure.js';
import { applyI18n, fmtDuration, initI18n, t } from '../lib/i18n.js';
import { siteIconUrl } from '../lib/site-icons.js';
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
// 「主要网站」列表的展开偏好（默认折叠降噪），跨日保持。
let tlSitesExpanded = false;
let tlSitesCount = 0;

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
  const settings = await getSettings();
  tlSitesExpanded = settings.tlSitesExpanded;

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

  if (segments.length) {
    renderRibbon(
      segments.map((s) => ({ domain: s.domain, start: s.start, end: s.end })),
      wrap,
      false
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
  renderSites(day, tlSitesExpanded);
}

/** 24 小时色带（含缩放窗口、重叠错位、brush 拖选、点击跳转）。 */
function renderRibbon(segsAbs, wrap) {
  wrap.textContent = ''; // 缩放/重置的重绘也走这里，先清空旧内容
  const startMs = dayStartMs(currentDate);
  const dayEnd = startMs + 86400000;
  const vStart = view.start ?? startMs;
  const vEnd = view.end ?? dayEnd;
  const span = vEnd - vStart;

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

  // 按开始时间排序后铺排；与前一色块重叠时错位到第二车道（上移 + 半透明）。
  let prevEnd = -Infinity;
  for (const seg of [...segsAbs].sort((a, b) => a.start - b.start)) {
    const s = Math.max(seg.start, vStart);
    const e = Math.min(seg.end, vEnd);
    if (e <= s) continue;
    const el = document.createElement('span');
    el.className = 'tl-seg';
    el.dataset.color = colorOf(seg.domain);
    el.style.left = `${((s - vStart) / span) * 100}%`;
    el.style.width = `${Math.max(((e - s) / span) * 100, 0.15)}%`;
    if (seg.start < prevEnd) {
      el.classList.add('lane2'); // 重叠：上移 2px + 半透明
    } else {
      prevEnd = seg.end;
    }
    el.title = `${seg.domain} · ${fmtClock(s)} – ${fmtClock(e)} · ${fmtDuration(
      Math.round((e - s) / 1000)
    )}`;
    el.addEventListener('click', () => {
      if (suppressSegClick) return;
      window.open(`https://${seg.domain}`, '_blank');
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

  // 图例（域名 + 色点）
  const legendBlock = document.createElement('div');
  legendBlock.className = 'tl-legend-block';
  const legend = document.createElement('div');
  legend.className = 'legend-row';
  for (const [domain, color] of colorMap) {
    const item = document.createElement('span');
    item.className = 'legend-item';
    const dot = document.createElement('span');
    dot.className = 'pie-dot';
    dot.dataset.color = color;
    item.append(dot, document.createTextNode(domain));
    legend.append(item);
  }
  legendBlock.append(legend);
  wrap.append(legendBlock);

  attachBrush(strip, segsAbs, wrap, vStart, span);
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

function renderSites(day, expanded) {
  const wrap = $('tlSites');
  wrap.textContent = '';

  const entries = Object.entries(day).sort((a, b) => b[1] - a[1]);
  tlSitesCount = entries.length;
  const toggle = $('tlSitesToggle');

  if (!entries.length) {
    if (toggle) toggle.hidden = true;
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('timelineEmpty');
    wrap.append(empty);
    return;
  }

  if (toggle) {
    toggle.hidden = false;
    updateToggle(toggle, entries.length, expanded);
  }
  // 默认折叠（降噪）：collapsed 类隐藏整张列表，点击按钮展开。
  wrap.classList.toggle('collapsed', !expanded);

  const max = entries[0][1];
  for (const [domain, seconds] of entries) {
    const row = document.createElement('div');
    row.className = 'top-row';

    const name = document.createElement('span');
    name.className = 'top-name';
    name.textContent = domain;
    name.style.backgroundImage = siteIconUrl(domain);

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

function updateToggle(toggle, count, expanded) {
  toggle.textContent = expanded ? t('showLess') : t('showMore', { n: count });
  toggle.setAttribute('aria-expanded', String(expanded));
}

$('tlSitesToggle')?.addEventListener('click', async () => {
  const wrap = $('tlSites');
  // 当前是否折叠 → 点击后取反。
  const willExpand = wrap.classList.contains('collapsed');
  wrap.classList.toggle('collapsed', !willExpand);
  tlSitesExpanded = willExpand;
  updateToggle($('tlSitesToggle'), tlSitesCount, willExpand);
  // 偏好持久化，跨日与跨刷新保持。
  await saveSettings({ tlSitesExpanded: willExpand });
});

function goto(key) {
  currentDate = key;
  view.start = null;
  view.end = null;
  history.replaceState(null, '', `timeline.html?date=${key}`);
  render();
}

$('prevDay').addEventListener('click', () => goto(shiftDateKey(currentDate, -1)));
$('nextDay').addEventListener('click', () => goto(shiftDateKey(currentDate, 1)));
$('todayBtn').addEventListener('click', () => goto(dateKey()));

render();
