/**
 * 每日聚合数据的存取。键格式：
 *   d:YYYY-MM-DD → { [domain]: seconds }  使用时长
 *   v:YYYY-MM-DD → { [domain]: count }    访问次数
 * 时长与次数分开成键，避免混入同一对象后时长计算（sumSeconds 等）被污染。
 * 按天分键避免每次结算重写整个历史对象。
 */

import { dateKey } from '../lib/pure.js';
import { clearSegments } from '../lib/idb.js';
import { clearFavicons } from '../lib/favicon.js';

export async function addSeconds(domain, seconds, when = new Date()) {
  const dateStr = dateKey(when);
  const dayKey = `d:${dateStr}`;
  const hourKey = `h:${dateStr}`;
  const hour = String(when.getHours()).padStart(2, '0');

  const data = await chrome.storage.local.get([dayKey, hourKey]);
  const day = data[dayKey] || {};
  day[domain] = (day[domain] || 0) + seconds;

  // 小时桶：时间线页用（小时 → 域名 → 秒），与每日聚合同源同量。
  const hours = data[hourKey] || {};
  hours[hour] = hours[hour] || {};
  hours[hour][domain] = (hours[hour][domain] || 0) + seconds;

  await chrome.storage.local.set({ [dayKey]: day, [hourKey]: hours });
  return day;
}

export async function getDay(key) {
  const k = `d:${key}`;
  const data = await chrome.storage.local.get(k);
  return data[k] || {};
}

/**
 * 给某域名累加一次访问。由 tracker 在「活跃站点发生变化」时调用，
 * 同一段连续停留只会记一次（去重在 tracker 侧靠 lastDomain 完成）。
 */
export async function addVisit(domain, when = new Date()) {
  const key = `v:${dateKey(when)}`;
  const data = await chrome.storage.local.get(key);
  const day = data[key] || {};
  day[domain] = (day[domain] || 0) + 1;
  await chrome.storage.local.set({ [key]: day });
  return day;
}

/** 某一天的访问次数：{ [domain]: count }，无数据返回空对象。 */
export async function getVisits(key) {
  const k = `v:${key}`;
  const data = await chrome.storage.local.get(k);
  return data[k] || {};
}

/** 读取全部访问次数：{ 'YYYY-MM-DD': { domain: count } }。 */
export async function getAllVisits() {
  const all = await chrome.storage.local.get(null);
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('v:')) out[k.slice(2)] = v;
  }
  return out;
}

/** 读取全部历史：{ 'YYYY-MM-DD': { domain: seconds } }。 */
export async function getAllDays() {
  const all = await chrome.storage.local.get(null);
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('d:')) out[k.slice(2)] = v;
  }
  return out;
}

/** 放行记录：{ [domain]: untilMs }，期间该站点不再被限额拦截。 */
const GRANTS_KEY = 'grants';

export async function getGrants() {
  const data = await chrome.storage.local.get(GRANTS_KEY);
  return data[GRANTS_KEY] || {};
}

/** 某一天的小时桶：{ '08': { domain: seconds }, ... }，无数据返回空对象。 */
export async function getTimeline(dateStr) {
  const key = `h:${dateStr}`;
  const data = await chrome.storage.local.get(key);
  return data[key] || {};
}

export async function setGrant(domain, untilMs) {
  const grants = await getGrants();
  grants[domain] = untilMs;
  await chrome.storage.local.set({ [GRANTS_KEY]: grants });
}

/** 清除某域名的放行（其对应限额被删除时调用，避免放行残留到新建的限额上）。 */
export async function clearGrant(domain) {
  const grants = await getGrants();
  if (domain in grants) {
    delete grants[domain];
    await chrome.storage.local.set({ [GRANTS_KEY]: grants });
  }
}

export async function clearAllData() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    (k) => k.startsWith('d:') || k.startsWith('h:') || k.startsWith('v:') || k === GRANTS_KEY
  );
  if (keys.length) await chrome.storage.local.remove(keys);
  await clearSegments(); // IDB 中的浏览分段一并清除
  await clearFavicons(); // 采集到的网站图标也属于浏览痕迹，一并清除
}
