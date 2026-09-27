import { fmtDuration } from '../lib/pure.js';
import { getSettings } from '../lib/settings.js';
import { getDay, setGrant } from '../background/store.js';
import { dateKey } from '../lib/pure.js';

const domain = new URLSearchParams(location.search).get('domain') || '';

const $ = (id) => document.getElementById(id);

async function render() {
  $('domain').textContent = domain;

  if (domain) {
    const [settings, today] = await Promise.all([getSettings(), getDay(dateKey())]);
    const limit = settings.limits.find((l) => l.enabled && l.domain === domain);
    if (limit) {
      $('usage').textContent = `已用 ${fmtDuration(today[domain] || 0)} · 限额 ${limit.minutes} 分钟`;
    }
    document.title = `${domain} · 今日限额已用完`;
  }
}

$('grantBtn').addEventListener('click', async () => {
  await setGrant(domain, Date.now() + 10 * 60_000);
  if (history.length > 1) {
    history.back();
  } else {
    location.replace('https://' + domain);
  }
});

render();
