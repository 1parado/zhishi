import { dateKey, fmtDuration, shiftDateKey, sumSeconds } from '../lib/pure.js';
import { applyI18n, initI18n, t } from '../lib/i18n.js';
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

  const [timeline, day] = await Promise.all([getTimeline(currentDate), getDay(currentDate)]);
  const total = sumSeconds(day);

  $('tlDate').textContent = dateLabel(currentDate);
  $('tlTotal').textContent = fmtDuration(total);
  $('nextDay').disabled = shiftDateKey(currentDate, 1) > dateKey();
  document.title = `${dateLabel(currentDate)} · ${t('timelineTitle')}`;

  renderHours(timeline);
  renderSites(day);
}

function renderHours(timeline) {
  const wrap = $('timeline');
  wrap.textContent = '';

  // 汇总所有出现过的域名，按首次出现顺序循环分配色板。
  const colorMap = new Map();
  let colorCursor = 0;
  const colorOf = (domain) => {
    if (!colorMap.has(domain)) {
      colorMap.set(domain, String((colorCursor % 7) + 1));
      colorCursor += 1;
    }
    return colorMap.get(domain);
  };

  // 把每个小时桶内的域名按顺序铺进 24 小时色带（桶内按用时降序排列）。
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
