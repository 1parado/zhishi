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

  const activeHours = Object.keys(timeline)
    .filter((h) => sumSeconds(timeline[h]) > 0)
    .sort();

  if (!activeHours.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = t('timelineEmpty');
    wrap.append(empty);
    return;
  }

  for (const hour of activeHours) {
    const sites = Object.entries(timeline[hour]).sort((a, b) => b[1] - a[1]);
    const hourTotal = sumSeconds(timeline[hour]);

    const row = document.createElement('div');
    row.className = 'tl-row';

    const head = document.createElement('div');
    head.className = 'tl-row-head';
    const hourLabel = document.createElement('span');
    hourLabel.className = 'tl-hour';
    hourLabel.textContent = `${hour}:00 – ${hour}:59`;
    const rowTotal = document.createElement('span');
    rowTotal.className = 'tl-row-total num';
    rowTotal.textContent = fmtDuration(hourTotal);
    head.append(hourLabel, rowTotal);
    row.append(head);

    const sitesWrap = document.createElement('div');
    sitesWrap.className = 'tl-sites';
    const max = sites[0][1];
    for (const [domain, seconds] of sites) {
      const line = document.createElement('div');
      line.className = 'tl-site';

      const name = document.createElement('span');
      name.className = 'tl-site-name';
      name.textContent = domain;

      const track = document.createElement('div');
      track.className = 'bar-track';
      const fill = document.createElement('div');
      fill.className = 'bar-fill';
      fill.style.width = `${Math.max((seconds / max) * 100, 2)}%`;
      track.append(fill);

      const time = document.createElement('span');
      time.className = 'tl-site-time num';
      time.textContent = fmtDuration(seconds);

      line.append(name, track, time);
      sitesWrap.append(line);
    }
    row.append(sitesWrap);
    wrap.append(row);
  }
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
