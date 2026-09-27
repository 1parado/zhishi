import { dateKey, fmtDuration, shiftDateKey, sumSeconds } from '../lib/pure.js';
import { applyI18n, initI18n, t } from '../lib/i18n.js';
import { getSegmentsByDate } from '../lib/idb.js';
import { getDay, getTimeline } from '../background/store.js';

const $ = (id) => document.getElementById(id);

const params = new URLSearchParams(location.search);
let currentDate = params.get('date') || dateKey();

function dateLabel(key) {
  const [y, m, d] = key.split('-').map(Number);
  const locale = document.documentElement.lang === 'en' ? 'en-US' : 'zh-CN';
  return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', year: 'numeric' }).format(
    new Date(y, m - 1, d)
  );
}

async function render() {
  await initI18n();
  await applyI18n();

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

  if (segments.length) {
    renderSegments(segments, wrap);
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
  renderSites(day);
}

function dayStartMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

function fmtClock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 精确模式：每个结算分段就是一个真实甘特块。 */
function renderSegments(segments, wrap) {
  const colorMap = new Map();
  let colorCursor = 0;
  const colorOf = (domain) => {
    if (!colorMap.has(domain)) {
      colorMap.set(domain, String((colorCursor % 7) + 1));
      colorCursor += 1;
    }
    return colorMap.get(domain);
  };

  const startMs = dayStartMs(currentDate);
  const DAY_MS = 86400000;
  const strip = document.createElement('div');
  strip.className = 'tl-strip';
  for (const seg of segments) {
    const el = document.createElement('span');
    el.className = 'tl-seg';
    el.dataset.color = colorOf(seg.domain);
    el.style.left = `${((seg.start - startMs) / DAY_MS) * 100}%`;
    el.style.width = `${Math.max(((seg.end - seg.start) / DAY_MS) * 100, 0.15)}%`;
    el.title = `${seg.domain} · ${fmtClock(seg.start)} – ${fmtClock(seg.end)} · ${fmtDuration(
      Math.round((seg.end - seg.start) / 1000)
    )}`;
    strip.append(el);
  }
  wrap.append(strip);
  appendAxis(wrap);
}

/** 近似模式（旧数据回退）：把每个小时桶内的域名按顺序铺进 24 小时色带。 */
function renderHours(timeline, wrap) {
  const colorMap = new Map();
  let colorCursor = 0;
  const colorOf = (domain) => {
    if (!colorMap.has(domain)) {
      colorMap.set(domain, String((colorCursor % 7) + 1));
      colorCursor += 1;
    }
    return colorMap.get(domain);
  };

  const segs = [];
  const hours = Object.keys(timeline).sort();
  for (const hour of hours) {
    const hourStart = Number(hour) * 3600;
    let offset = hourStart;
    const sites = Object.entries(timeline[hour]).sort((a, b) => b[1] - a[1]);
    for (const [domain, seconds] of sites) {
      if (seconds <= 0) continue;
      segs.push({ domain, start: offset, len: seconds, color: colorOf(domain) });
      offset += seconds;
    }
  }

  if (!segs.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('timelineEmpty');
    wrap.append(empty);
    return;
  }

  const strip = document.createElement('div');
  strip.className = 'tl-strip';
  for (const seg of segs) {
    const el = document.createElement('span');
    el.className = 'tl-seg';
    el.dataset.color = seg.color;
    el.style.left = `${(seg.start / 86400) * 100}%`;
    el.style.width = `${Math.max((seg.len / 86400) * 100, 0.15)}%`;
    const startH = Math.floor(seg.start / 3600);
    el.title = `${seg.domain} · ${String(startH).padStart(2, '0')} 时段 · ${fmtDuration(seg.len)}`;
    strip.append(el);
  }
  wrap.append(strip);
  appendAxis(wrap);
}

function appendAxis(wrap) {
  const axis = document.createElement('div');
  axis.className = 'tl-axis';
  for (let i = 0; i <= 6; i++) {
    const tick = document.createElement('span');
    tick.className = 'tl-tick';
    tick.textContent = `${String(i * 4).padStart(2, '0')}:00`;
    tick.style.left = `${(i / 6) * 100}%`;
    axis.append(tick);
  }
  wrap.append(axis);
}

function renderSites(day) {
  const wrap = $('tlSites');
  wrap.textContent = '';

  const entries = Object.entries(day).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('timelineEmpty');
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

function goto(key) {
  currentDate = key;
  history.replaceState(null, '', `timeline.html?date=${key}`);
  render();
}

$('prevDay').addEventListener('click', () => goto(shiftDateKey(currentDate, -1)));
$('nextDay').addEventListener('click', () => goto(shiftDateKey(currentDate, 1)));
$('todayBtn').addEventListener('click', () => goto(dateKey()));

render();
