/**
 * 网站真实图标（favicon）的采集与缓存。
 *
 * 与 site-icons.js 的静态品牌 SVG／字母图标不同，这里拿的是站点**自己**的图标：
 * 直接读浏览器已经解析好的 tab.favIconUrl —— 不主动请求 /favicon.ico、不做任何
 * 抓取。浏览器标签页上显示的是什么，这里就存什么。
 *
 * 存储：chrome.storage.local 的 'favicons' 键，{ 域名: 图标 URL }。
 * 每个域名只在首次拿到图标时写入一次，之后不再覆盖（用户手动设置过的值不会
 * 被后来的访问冲掉）。写入是纯本地操作，零网络。
 *
 * 采集与渲染解耦：这里无条件采集，是否真的用真图标由页面按设置决定
 * （见 site-icons.js 的 setFavicons），所以开关来回切换不会丢已采集的数据。
 */

import { classifyUrl } from './pure.js';

export const FAVICON_KEY = 'favicons';

// 单条 URL 长度上限。Chrome 常把小图标直接内联成 data URL，故放宽到 64KB；
// 远程 URL 限制 2KB —— 正常图标地址不可能这么长，超了就是脏数据。
const MAX_DATA_URL_LEN = 64 * 1024;
const MAX_REMOTE_URL_LEN = 2048;

// 最多缓存多少个域名。满了以后只更新已有域名，不再新增，避免无限膨胀。
// （真实使用量级：几百个域名 × 每条几十到几百字节，远达不到上限。）
const MAX_ENTRIES = 1000;

// 只接受两类图标地址：内联 data:image/* 与 http(s) 远程地址。
// 反斜杠、单双引号、圆括号、空白一律拒绝——这些字符会被原样拼进 CSS 的
// url("…")。单引号其实在双引号包裹下无害，这里从严处理。
// data URL 的参数段要同时容忍 `;base64`（无值）与 `;charset=utf-8`（有值）。
const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+(?:;[a-z0-9-]+(?:=[a-z0-9-]*)?)*,[^\s"'()\\]+$/i;
const REMOTE_URL_RE = /^https?:\/\/[^\s"'()\\]+$/i;

// 浏览器给「没有图标的站点」生成的内部占位图，不该当成真图标存下来。
const JUNK_URL_RE = /^chrome(-extension)?:\/\/theme\/IDR_/i;

/**
 * 校验并归一化一个候选图标地址，返回可安全用于 CSS 的 URL；不合格返回 null。
 *
 * 纯函数，不触碰 chrome API，可直接单测。
 */
export function sanitizeFaviconUrl(raw) {
  if (typeof raw !== 'string') return null;
  const url = raw.trim();
  if (!url) return null;
  if (JUNK_URL_RE.test(url)) return null;

  if (DATA_URL_RE.test(url)) return url.length <= MAX_DATA_URL_LEN ? url : null;
  if (REMOTE_URL_RE.test(url)) return url.length <= MAX_REMOTE_URL_LEN ? url : null;
  return null;
}

/** 读取全部已缓存图标：{ 域名: URL }。读不到就返回空对象——图标缺失不影响主流程。 */
export async function loadFaviconMap() {
  try {
    const data = await chrome.storage.local.get(FAVICON_KEY);
    const map = data[FAVICON_KEY];
    return map && typeof map === 'object' ? map : {};
  } catch {
    return {};
  }
}

// 内存镜像：避免每次 tabs 事件都读一次 storage 来判重。
// 只在 service worker 里维护；页面用的是 loadFaviconMap 的一次性快照。
let memo = null;
let memoCount = 0;

async function ensureMemo() {
  if (memo) return memo;
  memo = await loadFaviconMap();
  memoCount = Object.keys(memo).length;
  return memo;
}

// 写串行化：并发采集不同域名时，保证后一次写入覆盖前一次的顺序是对的
// （memo 是同一个对象，串行后写进去的必然是最新全量）。
let writeChain = Promise.resolve();

function persist() {
  const snapshot = { ...memo };
  writeChain = writeChain
    .then(() => chrome.storage.local.set({ [FAVICON_KEY]: snapshot }))
    .catch(() => {
      // 存储失败不影响计时：图标是锦上添花，下次访问该站点会再试一次。
    });
  return writeChain;
}

/**
 * 从标签页采集图标。
 *
 * 域名口径与统计数据一致（classifyUrl：仅 http/https、去掉 www.），
 * 这样 favicon 的键能直接和 d:YYYY-MM-DD 里的域名对上。
 *
 * 三道守卫（对齐 time-tracker-4-browser 的踩坑经验）：
 *  1. URL 不合法或拿不到 favIconUrl —— 直接放弃；
 *  2. 该域名已有缓存 —— 放弃，只采首次，永不覆盖；
 *  3. 地址不合规（scheme 不对／超长／含危险字符）—— 丢弃。
 *
 * @param {{ url?: string, favIconUrl?: string }} tab 标签页对象
 * @returns {Promise<boolean>} 是否新增了一条
 */
export async function captureFavicon(tab) {
  const domain = classifyUrl(tab?.url);
  if (!domain) return false;

  const map = await ensureMemo();
  if (map[domain] !== undefined) return false;

  const url = sanitizeFaviconUrl(tab?.favIconUrl);
  if (!url) return false;

  if (memoCount >= MAX_ENTRIES) return false;

  map[domain] = url;
  memoCount += 1;
  await persist();
  return true;
}

/**
 * 清空全部图标缓存（配合「清除全部记录」）。内存镜像一并重置，
 * 否则后台会以为已有缓存、从而不再重新采集。
 */
export async function clearFavicons() {
  memo = null;
  memoCount = 0;
  try {
    await chrome.storage.local.remove(FAVICON_KEY);
  } catch {
    // 忽略：存储不可用时也没有残留可清。
  }
}
