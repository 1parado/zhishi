/**
 * 右键菜单：
 *  - 「将 xx.com 加入网站限额」：打开仪表盘限额页并预填域名；
 *  - 「为 xx.com 开启/关闭视频心跳」：切换该站点的心跳白名单。
 * 菜单文案随界面语言变化（settings.locale）。
 */

import { classifyUrl } from '../lib/pure.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { initI18n, t } from '../lib/i18n.js';

const MENU_ADD_LIMIT = 'zhishi-add-limit';
const MENU_HEARTBEAT = 'zhishi-heartbeat';

export async function ensureMenu() {
  await initI18n(true);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      { id: MENU_ADD_LIMIT, title: t('menuLimitSite'), contexts: ['page'] },
      () => void chrome.runtime.lastError
    );
    chrome.contextMenus.create(
      { id: MENU_HEARTBEAT, title: t('menuHbSite'), contexts: ['page'] },
      () => void chrome.runtime.lastError
    );
  });
}

async function updateTitles(tab) {
  await initI18n(true);
  const domain = classifyUrl(tab?.url);
  let heartbeatOn = false;
  if (domain) {
    const settings = await getSettings();
    heartbeatOn = settings.heartbeat?.sites?.includes(domain) ?? false;
  }
  const update = (id, title) =>
    chrome.contextMenus.update(id, { title }, () => void chrome.runtime.lastError);

  update(
    MENU_ADD_LIMIT,
    domain ? t('menuLimitDomain', { domain }) : t('menuLimitSite')
  );
  update(
    MENU_HEARTBEAT,
    domain
      ? heartbeatOn
        ? t('menuHbOff', { domain })
        : t('menuHbOn', { domain })
      : t('menuHbSite')
  );
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    await updateTitles(await chrome.tabs.get(tabId));
  } catch {
    // 标签页可能已关闭
  }
});

chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (info.url !== undefined && tab.active) updateTitles(tab);
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === MENU_ADD_LIMIT) {
    const domain = classifyUrl(info.pageUrl);
    const params = new URLSearchParams({ tab: 'limits' });
    if (domain) params.set('add', domain);
    chrome.tabs.create({
      url: chrome.runtime.getURL(`src/pages/dashboard.html?${params}`),
    });
    return;
  }

  if (info.menuItemId === MENU_HEARTBEAT) {
    const domain = classifyUrl(info.pageUrl);
    if (!domain) return;
    const settings = await getSettings();
    const sites = settings.heartbeat?.sites ?? [];
    const next = sites.includes(domain)
      ? sites.filter((s) => s !== domain)
      : [...sites, domain];
    await saveSettings({ heartbeat: { sites: next } });
    if (info.tabId != null) {
      try {
        await updateTitles(await chrome.tabs.get(info.tabId));
      } catch {
        // 标签页可能已关闭
      }
    }
  }
});
