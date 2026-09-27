/**
 * 右键菜单：
 *  - 「将 xx.com 加入网站限额」：打开仪表盘限额页并预填域名；
 *  - 「为 xx.com 开启/关闭视频心跳」：切换该站点的心跳白名单。
 */

import { classifyUrl } from '../lib/pure.js';
import { getSettings, saveSettings } from '../lib/settings.js';

const MENU_ADD_LIMIT = 'zhishi-add-limit';
const MENU_HEARTBEAT = 'zhishi-heartbeat';

export function ensureMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      { id: MENU_ADD_LIMIT, title: '将此网站加入网站限额', contexts: ['page'] },
      () => void chrome.runtime.lastError
    );
    chrome.contextMenus.create(
      { id: MENU_HEARTBEAT, title: '为此网站开启视频心跳', contexts: ['page'] },
      () => void chrome.runtime.lastError
    );
  });
}

async function updateTitles(tab) {
  const domain = classifyUrl(tab?.url);
  let heartbeatOn = false;
  if (domain) {
    const settings = await getSettings();
    heartbeatOn = settings.heartbeat?.sites?.includes(domain) ?? false;
  }
  const update = (id, title) =>
    chrome.contextMenus.update(id, { title }, () => void chrome.runtime.lastError);

  update(MENU_ADD_LIMIT, domain ? `将 ${domain} 加入网站限额` : '将此网站加入网站限额');
  update(
    MENU_HEARTBEAT,
    domain
      ? heartbeatOn
        ? `关闭 ${domain} 的视频心跳`
        : `为 ${domain} 开启视频心跳`
      : '为此网站开启视频心跳'
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
