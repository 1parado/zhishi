/**
 * 排行项点击跳转：优先切到已打开的同域标签页，没有才新建。
 * 直接重复开一个标签会让「点击排行」变成制造重复页，体验很差。
 */
import { siteUrl } from './pure.js';

/** match pattern 里的主机名要求，异常时 query 会直接抛，故整体兜底。 */
async function findExistingTab(domain) {
  try {
    const tabs = await chrome.tabs.query({
      url: [`*://${domain}/*`, `*://*.${domain}/*`],
    });
    return tabs.find((tab) => tab.id != null) ?? null;
  } catch {
    return null;
  }
}

/**
 * 打开站点。返回是否真的发生了跳转（域名非法时返回 false）。
 * @returns {Promise<boolean>}
 */
export async function openSiteTab(domain) {
  const url = siteUrl(domain);
  if (!url) return false;

  const existing = await findExistingTab(domain);
  if (existing) {
    // 同窗口内切换可能被 popup 自身占用焦点，先激活再聚焦窗口。
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    }
    return true;
  }

  await chrome.tabs.create({ url });
  return true;
}
