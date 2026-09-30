import { fmtDuration } from '../lib/pure.js';
import { applyI18n, initI18n, t } from '../lib/i18n.js';
import { initTheme } from '../lib/theme.js';
import { getSettings } from '../lib/settings.js';
import { getDay, setGrant } from '../background/store.js';
import { dateKey } from '../lib/pure.js';

const params = new URLSearchParams(location.search);
const domain = params.get('domain') || '';
// 专注模式拦截：没有放行窗口，只提示去哪里关闭。
const isFocus = params.get('reason') === 'focus';

const $ = (id) => document.getElementById(id);

async function render() {
  await initI18n();
  await applyI18n();
  await initTheme();
  $('domain').textContent = domain;

  if (isFocus) {
    $('blockTitleText').textContent = t('blockFocusTitle');
    $('usage').hidden = true;
    $('grantBtn').hidden = true;
    $('blockNote').textContent = t('blockFocusNote');
  }

  if (domain) {
    const [settings, today] = await Promise.all([getSettings(), getDay(dateKey())]);
    const limit = settings.limits.find((l) => l.enabled && l.domain === domain);
    if (limit && !isFocus) {
      $('usage').textContent = t('blockUsage', {
        used: fmtDuration(today[domain] || 0),
        limit: fmtDuration(limit.minutes * 60),
      });
    }
    document.title = `${domain} · ${isFocus ? t('blockFocusTitle') : t('blockPageTitle')}`;
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
