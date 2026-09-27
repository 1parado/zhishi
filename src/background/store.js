/**
 * 每日聚合数据的存取。键格式 d:YYYY-MM-DD → { [domain]: seconds }，
 * 按天分键避免每次结算重写整个历史对象。
 */

import { dateKey } from '../lib/pure.js';

export async function addSeconds(domain, seconds, when = new Date()) {
  const key = `d:${dateKey(when)}`;
  const data = await chrome.storage.local.get(key);
  const day = data[key] || {};
  day[domain] = (day[domain] || 0) + seconds;
  await chrome.storage.local.set({ [key]: day });
  return day;
}

export async function getDay(key) {
  const k = `d:${key}`;
  const data = await chrome.storage.local.get(k);
  return data[k] || {};
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
  const keys = Object.keys(all).filter((k) => k.startsWith('d:') || k === GRANTS_KEY);
  if (keys.length) await chrome.storage.local.remove(keys);
}
