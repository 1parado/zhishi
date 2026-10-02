/**
 * 设置的默认值、读取与保存。深层对象合并，数组整体替换。
 */

const SETTINGS_KEY = 'settings';

import { isValidTime } from './pure.js';
// 放行记录随限额存亡：删除限额时需要一并清除（store.js 不反向依赖本模块，无循环）。
import { clearGrant } from '../background/store.js';

export const DEFAULT_SETTINGS = {
  // 每日总目标（分钟）。enabled 为 false 时 UI 只显示用量。
  goal: { enabled: false, dailyMinutes: 240 },
  // 近 7 天图表形式：bar 柱状 / line 折线 / pie 饼状。
  weekChart: 'bar',
  // 网站排行范围：day 今日 / week 近 7 天。
  topSitesRange: 'week',
  // 网站排行维度：time 按使用时长 / visits 按访问次数。
  topSitesMetric: 'time',
  // 站点统计是否按根域名合并（linux.do + cdk.linux.do → linux.do）。
  // 只影响展示层的聚合方式：时长与次数始终按完整域名记录，关掉即看明细。
  mergeByRoot: true,
  // 时间线页时间轴图例默认只显示 Top 6 站点，展开后记住偏好。
  tlLegendExpanded: false,
  // 网站图标：优先显示网站自己的 favicon（地址由浏览器访问时给出，本扩展
  // 只做本地缓存，不抓取也不上传）。关闭后只用内置品牌图标或首字母。
  realFavicon: true,
  // 界面语言：auto 跟随浏览器语言，或强制 zh / en。
  locale: 'auto',
  // 主题：auto 跟随系统，或强制 light / dark。
  theme: 'auto',
  // 网站限额总开关 + 逐条规则：
  // { id, domain, minutes, enabled, schedule?: { from, to } }
  // schedule 存在时，该时间窗内直接拦截（支持跨零点），不受每日分钟数影响。
  limitsEnabled: false,
  limits: [],
  // 健康提醒。护眼默认开启（20-20-20），久坐默认关闭。
  // activeHours 限定提醒触发时段：mode 'all' 全天；'range' 仅 from–to 内（支持跨零点）。
  health: {
    eye: { enabled: true, intervalMin: 20 },
    sit: { enabled: false, intervalMin: 45 },
    activeHours: { mode: 'all', from: '09:00', to: '22:00' },
  },
  // 专注模式：开启后仅白名单站点可访问，其余一律跳转拦截页（与限额相互独立）。
  focus: { enabled: false, sites: [] },
  // 视频心跳：对这些站点，播放音视频期间不受闲置判定暂停。
  heartbeat: { enabled: true, sites: ['bilibili.com', 'youtube.com'] },
  // 分享卡片上的个人信息：name 昵称、avatar 头像（压缩后的 data URL）、
  // show 是否把昵称与头像画到卡片上。只存本机，不上传。
  profile: { name: '', avatar: '', show: true },
  // 限额规则自增 id，同时用作拦截判定与展示排序。
  seq: 0,
};

/** 提醒间隔的允许区间（分钟），UI 与存储统一按此收敛。 */
export const INTERVAL_RANGES = {
  eye: { min: 5, max: 120 },
  sit: { min: 10, max: 240 },
};

function clampToRange(value, range) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return range.min;
  return Math.min(Math.max(n, range.min), range.max);
}

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalize(data[SETTINGS_KEY]);
}

/** 保存补丁（深层合并）。settings 变化会触发后台各模块的 onChanged 响应。 */
export async function saveSettings(patch) {
  const current = await getSettings();
  const next = deepMerge(current, patch);
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

export async function addLimit(domain, minutes) {
  const current = await getSettings();
  const id = (current.seq || 0) + 1;
  const next = await saveSettings({
    seq: id,
    limits: [...current.limits, { id, domain, minutes, enabled: true }],
  });
  return next;
}

export async function removeLimit(id) {
  const current = await getSettings();
  const removed = current.limits.find((l) => l.id === id);
  const next = await saveSettings({ limits: current.limits.filter((l) => l.id !== id) });

  // 该域名已无启用的限额时，其放行记录一并作废，
  // 否则「放行 10 分钟 → 删除 → 新增更严限额」会让新限额静默失效到放行过期。
  if (removed && !next.limits.some((l) => l.enabled && l.domain === removed.domain)) {
    await clearGrant(removed.domain);
  }
  return next;
}

export async function setLimitEnabled(id, enabled) {
  const current = await getSettings();
  return saveSettings({
    limits: current.limits.map((l) => (l.id === id ? { ...l, enabled } : l)),
  });
}

function normalize(raw) {
  const merged = deepMerge(DEFAULT_SETTINGS, raw || {});
  merged.limits = (Array.isArray(merged.limits) ? merged.limits : [])
    .filter(
      (l) => l && typeof l.domain === 'string' && l.domain && Number.isFinite(l.minutes) && l.minutes > 0
    )
    .map((l) => ({
      ...l,
      // 时段屏蔽：两端均为合法时间才保留。
      schedule:
        l.schedule && isValidTime(l.schedule.from) && isValidTime(l.schedule.to)
          ? { from: l.schedule.from, to: l.schedule.to }
          : null,
    }));
  merged.health.eye.intervalMin = clampToRange(merged.health.eye.intervalMin, INTERVAL_RANGES.eye);
  merged.health.sit.intervalMin = clampToRange(merged.health.sit.intervalMin, INTERVAL_RANGES.sit);
  const hours = merged.health.activeHours;
  if (!isValidTime(hours.from)) hours.from = DEFAULT_SETTINGS.health.activeHours.from;
  if (!isValidTime(hours.to)) hours.to = DEFAULT_SETTINGS.health.activeHours.to;
  if (hours.mode !== 'range') hours.mode = 'all';

  if (!['bar', 'line', 'pie'].includes(merged.weekChart)) merged.weekChart = 'bar';
  if (!['day', 'week'].includes(merged.topSitesRange)) merged.topSitesRange = 'week';
  if (!['time', 'visits'].includes(merged.topSitesMetric)) merged.topSitesMetric = 'time';
  merged.mergeByRoot = merged.mergeByRoot !== false;
  merged.tlLegendExpanded = merged.tlLegendExpanded === true;
  merged.realFavicon = merged.realFavicon !== false;
  if (!['zh', 'en'].includes(merged.locale)) merged.locale = 'auto';
  if (!['light', 'dark', 'auto'].includes(merged.theme)) merged.theme = 'auto';

  merged.focus = {
    enabled: merged.focus?.enabled === true,
    sites: (Array.isArray(merged.focus?.sites) ? merged.focus.sites : []).filter(
      (s) => typeof s === 'string' && s.trim()
    ),
  };
  merged.heartbeat = {
    enabled: merged.heartbeat?.enabled !== false,
    sites: (Array.isArray(merged.heartbeat?.sites) ? merged.heartbeat.sites : []).filter(
      (s) => typeof s === 'string' && s.trim()
    ),
  };
  // 分享资料：昵称截断，头像只接受 data URL 且限制大小（上传侧已压缩到 256px）。
  merged.profile = {
    name:
      typeof merged.profile?.name === 'string' ? merged.profile.name.trim().slice(0, 24) : '',
    avatar:
      typeof merged.profile?.avatar === 'string' &&
      merged.profile.avatar.startsWith('data:image/') &&
      merged.profile.avatar.length <= 700_000
        ? merged.profile.avatar
        : '',
    show: merged.profile?.show !== false,
  };
  return merged;
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
