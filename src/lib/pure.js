/**
 * 与 chrome API 无关的纯函数，供后台、页面与 Node 测试共用。
 */

/** 本地时区的日期键，格式 YYYY-MM-DD。 */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 把日期键平移 N 天（自动处理月末与跨年）。 */
export function shiftDateKey(key, days) {
  const [y, m, d] = key.split('-').map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}

/**
 * 从标签页 URL 提取聚合域名。只统计 http/https，
 * 去掉 www. 前缀；浏览器内部页返回 null，不计入。
 */
export function classifyUrl(url) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  if (!host) return null;
  return host.replace(/^www\./, '') || null;
}

/** 一次结算最多记入的毫秒数，防止 SW 长时间休眠后把闲置时间一次记满。 */
export function capChunk(elapsedMs, capMs = 90_000) {
  return Math.max(0, Math.min(elapsedMs, capMs));
}

/**
 * 人类可读时长，精确到秒。locale='zh'：42 秒 / 5 分 12 秒 / 2 小时 18 分；
 * locale='en'：42 sec / 5 min 12 sec / 2 hours 18 min（向下取整，不虚报）。
 */
export function fmtDuration(totalSeconds, locale = 'zh') {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return locale === 'en' ? '0 sec' : '0 秒';
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  if (locale === 'en') {
    if (h > 0) return m > 0 ? `${h} hour${h > 1 ? 's' : ''} ${m} min` : `${h} hour${h > 1 ? 's' : ''}`;
    if (m > 0) return s > 0 ? `${m} min ${s} sec` : `${m} min`;
    return `${s} sec`;
  }
  if (h > 0) return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
  if (m > 0) return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分钟`;
  return `${s} 秒`;
}

/** 扩展图标角标文本：2.4h / 34m，不足 1 分钟不显示。 */
export function fmtBadge(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 60) return '';
  const hours = totalSeconds / 3600;
  if (hours >= 1) {
    const v = hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10;
    return `${v}h`;
  }
  return `${Math.floor(totalSeconds / 60)}m`;
}

export function weekdayShort(key) {
  const [y, m, d] = key.split('-').map(Number);
  return '日一二三四五六'[new Date(y, m - 1, d).getDay()];
}

export function shortDate(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}/${d}`;
}

export function sumSeconds(dayMap) {
  if (!dayMap) return 0;
  let total = 0;
  for (const v of Object.values(dayMap)) total += v;
  return total;
}

/** 以 endKey 结尾的最近 N 天（含当天），按时间升序。 */
export function weekSeries(dailyMap, endKey, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = shiftDateKey(endKey, -i);
    out.push({ key, seconds: sumSeconds(dailyMap[key]) });
  }
  return out;
}

/**
 * 用量颜色档位（绝对时长语义，跨天可比）：
 * 0 无记录 / 1 绿（<1h）/ 2 黄（1–3h）/ 3 橙（3–6h）/ 4 红（≥6h）。
 */
export function usageLevel(seconds) {
  if (!seconds || seconds <= 0) return 0;
  if (seconds < 3600) return 1;
  if (seconds < 3 * 3600) return 2;
  if (seconds < 6 * 3600) return 3;
  return 4;
}

/** 目标用量状态：ok（<80%）/ near（≥80%）/ over（≥100%）/ none（未启用）。 */
export function goalVariant(usedSeconds, goalSeconds) {
  if (!goalSeconds || goalSeconds <= 0) return 'none';
  if (usedSeconds >= goalSeconds) return 'over';
  if (usedSeconds >= goalSeconds * 0.8) return 'near';
  return 'ok';
}

/** 全部历史导出为 CSV：date,domain,seconds。 */
export function toCSV(dailyMap) {
  const rows = ['date,domain,seconds'];
  for (const date of Object.keys(dailyMap).sort()) {
    const sites = dailyMap[date] || {};
    for (const domain of Object.keys(sites).sort()) {
      rows.push(`${date},${domain},${Math.round(sites[domain])}`);
    }
  }
  return `${rows.join('\n')}\n`;
}

/**
 * 限额规则筛选。status：all（全部）/ on（启用中）/ off（已停用）/
 * over（今日已达限额）。text 按域名子串不区分大小写匹配。
 */
export function filterLimits(limits, { text = '', status = 'all' } = {}, todayUsage = {}) {
  const query = String(text).trim().toLowerCase();
  return (limits || []).filter((rule) => {
    if (query && !String(rule.domain).toLowerCase().includes(query)) return false;
    if (status === 'on') return rule.enabled;
    if (status === 'off') return !rule.enabled;
    if (status === 'over') return (todayUsage[rule.domain] || 0) >= rule.minutes * 60;
    return true;
  });
}

/** 校验 HH:MM 时间字符串。 */
export function isValidTime(value) {
  return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

/**
 * 当前时刻是否在 HH:MM–HH:MM 窗口内（左闭右开，支持跨零点，如 23:00–08:00）。
 * from === to 视为空窗口（永不命中）。
 */
export function inTimeWindow(now = new Date(), from, to) {
  if (!isValidTime(from) || !isValidTime(to)) return false;
  const [fh, fm] = String(from).split(':').map(Number);
  const [th, tm] = String(to).split(':').map(Number);
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = fh * 60 + fm;
  const end = th * 60 + tm;
  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  return cur >= start || cur < end;
}
