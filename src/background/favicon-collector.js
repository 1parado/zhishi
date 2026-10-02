/**
 * 网站图标采集器：事件驱动，命中一次即入库。
 *
 * 只在「标签页地址变化 / 加载完成 / favIconUrl 变化」时尝试，且只读浏览器
 * 已经解析好的 tab.favIconUrl —— 本模块不发任何网络请求。
 *
 * 采集结果只是渲染时的优选来源，缺失时页面会回落到内置品牌 SVG 或字母图标，
 * 所以这里的任何失败都不该冒泡到计时主流程之外。
 */

import { captureFavicon } from '../lib/favicon.js';

function capture(tab) {
  // 静默失败：图标是锦上添花，不能影响计时。
  captureFavicon(tab).catch(() => {});
}

export function initFaviconCollector() {
  chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
    // favIconUrl 常随 status === 'complete' 一起给出，但已缓存图标或 SPA 跳转
    // 时可能只报 url／favIconUrl 变化，三种都试一次（captureFavicon 内部会
    // 用内存镜像判重，重复调用无额外开销）。
    if (info.url === undefined && info.status !== 'complete' && info.favIconUrl === undefined) {
      return;
    }
    capture(tab);
  });

  // onActivated 只给 tabId，要取完整 Tab 才看得到 favIconUrl。
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    chrome.tabs.get(tabId).then(capture).catch(() => {});
  });
}
