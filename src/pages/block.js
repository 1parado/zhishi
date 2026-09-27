import { fmtDuration } from '../lib/pure.js';
import { applyI18n, initI18n, t } from '../lib/i18n.js';
import { getSettings } from '../lib/settings.js';
import { getDay, setGrant } from '../background/store.js';
import { dateKey } from '../lib/pure.js';

const domain = new URLSearchParams(location.search).get('domain') || '';

const $ = (id) => document.getElementById(id);

async function render() {
  await initI18n();
  await applyI18n();
  $('domain').textContent = domain;

  if (domain) {
    const [settings, today] = await Promise.all([getSettings(), getDay(dateKey())]);
    const limit = settings.limits.find((l) => l.enabled && l.domain === domain);
    if (limit) {
      $('usage').textContent = t('blockUsage', {
        used: fmtDuration(today[domain] || 0),
        limit: fmtDuration(limit.minutes * 60),
      });
    }
    document.title = `${domain} · ${t('blockPageTitle')}`;
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
