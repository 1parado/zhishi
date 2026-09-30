/**
 * 计时引擎（事件驱动）。
 *
 * 计时口径：标签页活跃 + 浏览器窗口在前台 + 系统非闲置，三者同时满足才计入。
 * MV3 的 service worker 会被随时杀掉，因此会话状态存放在 storage.session
 * （整个浏览器会话内存活），每个事件结算上一段时长后立刻重新评估当前标签页。
 */

import { classifyUrl, capChunk, dateKey, inTimeWindow } from '../lib/pure.js';
import { getSettings } from '../lib/settings.js';
import { addSegmentRows } from '../lib/idb.js';
import { addSeconds, getDay, getGrants } from './store.js';

const SESSION_KEY = 'session';
const MAX_CHUNK_MS = 90_000;
const TICK_DEBOUNCE_MS = 400;
const HEARTBEAT_FRESH_MS = 90_000;
// 阅读心跳（滚动）的新鲜窗口：略大于闲置判定阈值 60 秒，
// 内容脚本每 20 秒至多上报一次，只要 60 秒内滚动过就算「人在看」。
const SCROLL_FRESH_MS = 65_000;

// domain → 最近一次心跳时间戳。心跳由内容脚本在播放音视频时上报，
// 仅对用户在设置中标记的站点被采信（noteHeartbeat 里统一把关）。
const heartbeatDomains = new Map();

// domain → 最近一次滚动时间戳。滚动是真实的用户输入，任何站点都采信。
const scrollDomains = new Map();

let lastTickAt = 0;

function heartbeatFresh(domain) {
  const ts = heartbeatDomains.get(domain);
  return typeof ts === 'number' && Date.now() - ts < HEARTBEAT_FRESH_MS;
}

function scrollFresh(domain) {
  const ts = scrollDomains.get(domain);
  return typeof ts === 'number' && Date.now() - ts < SCROLL_FRESH_MS;
}

function pruneHeartbeats(now) {
  for (const [domain, ts] of heartbeatDomains) {
    if (now - ts > HEARTBEAT_FRESH_MS) heartbeatDomains.delete(domain);
  }
  for (const [domain, ts] of scrollDomains) {
    if (now - ts > SCROLL_FRESH_MS) scrollDomains.delete(domain);
  }
}

/** 内容脚本心跳上报入口：校验设置白名单后登记。 */
export async function noteHeartbeat(sender) {
  const domain = classifyUrl(sender?.tab?.url);
  if (!domain) return;
  const settings = await getSettings();
  if (!settings.heartbeat?.enabled) return;
  if (!settings.heartbeat.sites?.includes(domain)) return;
  heartbeatDomains.set(domain, Date.now());
}

/** 内容脚本阅读心跳（滚轮/触摸滚动）上报入口：真实输入，所有站点直接采信。 */
export function noteScrollActivity(sender) {
  const domain = classifyUrl(sender?.tab?.url);
  if (!domain) return;
  scrollDomains.set(domain, Date.now());
}

/** 诊断用：当前新鲜心跳（域名 → 距上次心跳的秒数）。 */
export function getHeartbeatState(now = Date.now()) {
  const out = {};
  for (const [domain, ts] of heartbeatDomains) {
    const age = Math.round((now - ts) / 1000);
    if (age <= HEARTBEAT_FRESH_MS / 1000) out[domain] = age;
  }
  return out;
}

/** 诊断用：当前新鲜的阅读心跳（域名 → 距上次滚动的秒数）。 */
export function getScrollActivityState(now = Date.now()) {
  const out = {};
  for (const [domain, ts] of scrollDomains) {
    const age = Math.round((now - ts) / 1000);
    if (age <= SCROLL_FRESH_MS / 1000) out[domain] = age;
  }
  return out;
}

/**
 * 结算上一段会话并重新评估当前标签页。所有标签页 / 窗口 / 闲置事件
 * 与每分钟兜底闹钟都汇入这里。
 */
export async function tick(reason = 'event') {
  const now = Date.now();
  if (reason === 'event' && now - lastTickAt < TICK_DEBOUNCE_MS) return;
  lastTickAt = now;
  pruneHeartbeats(now);

  const idleState = await chrome.idle.queryState(60);
  const credited = await settle(idleState, now);
  await restartSession(idleState);
  return credited;
}

/**
 * 把一次结算的计入区间 [startMs, endMs) 按分钟边界拆成真实分段写入 IDB。
 * 时间线页据此画出零近似的甘特块；失败静默（聚合数据不受影响）。
 */
async function writeSegments(domain, startMs, endMs) {
  try {
    const rows = [];
    let cursor = startMs;
    while (cursor < endMs) {
      const d = new Date(cursor);
      const minuteEnd = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        d.getMinutes() + 1
      ).getTime();
      const sliceEnd = Math.min(minuteEnd, endMs);
      rows.push({ date: dateKey(d), start: cursor, end: sliceEnd, domain });
      cursor = sliceEnd;
    }
    await addSegmentRows(rows);
  } catch {
    // IDB 不可用时跳过：聚合数据仍然完整，时间线退回小时桶近似。
  }
}

/**
 * 把上一段会话记入当日聚合与分段库。
 * 「锁定」一律暂停；「闲置」时若该站点有视频心跳（正在播放音视频）
 * 或阅读心跳（60 秒内滚动过），视为人在，继续计时。
 */
async function settle(idleState, now) {
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  await chrome.storage.session.remove(SESSION_KEY);
  if (!session || !session.domain) return 0;
  if (idleState === 'locked') return 0;
  // 闲置时：视频心跳（白名单站点）或阅读心跳（60 秒内滚动过）任一新鲜即视为人在。
  if (idleState !== 'active' && !heartbeatFresh(session.domain) && !scrollFresh(session.domain)) {
    return 0;
  }

  const seconds = Math.floor(capChunk(now - session.startedAt, MAX_CHUNK_MS) / 1000);
  if (seconds < 1) return 0;

  // 只把「计入」的区间写成真实分段（跨分钟自动拆分）。
  await writeSegments(session.domain, session.startedAt, session.startedAt + seconds * 1000);
  await addSeconds(session.domain, seconds);
  return seconds;
}

/**
 * 扩展自己的 popup 是否打开。popup 会夺走浏览器窗口焦点，
 * 但它开着就意味着用户正停留在浏览器里——此时不应按「不在前台」暂停计时。
 * （用户切去其他应用时 popup 会自动关闭，所以不会误判。）
 */
export async function isPopupOpen() {
  try {
    if (chrome.runtime.getContexts) {
      const contexts = await chrome.runtime.getContexts({ contextTypes: ['POPUP'] });
      return contexts.length > 0;
    }
    return chrome.extension.getViews({ type: 'popup' }).length > 0;
  } catch {
    return false;
  }
}

/**
 * 依据前台窗口的活跃标签页开启新会话。
 * 拦截判定不受闲置影响（锁屏除外）；只有「人在」（活跃或有心跳）才开新会话。
 */
async function restartSession(idleState) {
  if (idleState === 'locked') return;
  const popupOpen = await isPopupOpen();
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab || typeof tab.windowId !== 'number') return;

  let win;
  try {
    win = await chrome.windows.get(tab.windowId);
  } catch {
    return;
  }
  if (!win.focused && !popupOpen) return;

  const domain = classifyUrl(tab.url);
  if (!domain) return;

  if (await isBlocked(domain)) {
    const url = chrome.runtime.getURL(`src/pages/block.html?domain=${encodeURIComponent(domain)}`);
    if (!tab.url || !tab.url.startsWith(chrome.runtime.getURL(''))) {
      await chrome.tabs.update(tab.id, { url });
    }
    return;
  }

  if (idleState !== 'active' && !heartbeatFresh(domain) && !scrollFresh(domain)) return;

  await chrome.storage.session.set({
    [SESSION_KEY]: { tabId: tab.id, windowId: win.id, domain, startedAt: Date.now() },
  });
}

/** 该域名今天是否已触达限额或处于时段屏蔽窗口（且未处于放行期）。 */
export async function isBlocked(domain) {
  const settings = await getSettings();
  if (!settings.limitsEnabled) return false;
  const limit = settings.limits.find((l) => l.enabled && l.domain === domain && l.minutes > 0);
  if (!limit) return false;

  const grants = await getGrants();
  if ((grants[domain] || 0) > Date.now()) return false;

  // 时段屏蔽：窗口内直接拦截，支持跨零点。
  if (limit.schedule && inTimeWindow(new Date(), limit.schedule.from, limit.schedule.to)) {
    return true;
  }

  const today = await getDay(dateKey());
  return (today[domain] || 0) >= limit.minutes * 60;
}

/** 当前正在计时的会话（popup 显示「正在记录」用）。 */
export async function currentSession() {
  const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
  return session || null;
}
