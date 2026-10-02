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

/**
 * 多段公共后缀（「根域名」需要多取一段）的紧凑清单。
 *
 * 完整的 Public Suffix List 有上万条、体积远超本扩展所需；这里只收常见项，
 * 未命中的一律按「最后两段」处理——对单段 TLD 的域名（linux.do、
 * xiaomi.jobs.f.mioffice.cn → mioffice.cn）这是正确答案。
 *
 * 两类都收：
 *  - ICANN 型（gov.cn、co.uk）：注册局把二级后缀开放给各级机构，真正的注册
 *    发生在第三段；
 *  - 私有型（github.io、vercel.app、blogspot.com）：平台把整段后缀租给用户，
 *    不列的话所有用户的子域会被错误地合并成一个「网站」。
 */
const MULTI_LABEL_SUFFIXES = new Set([
  // 中国大陆
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
  // 中国香港 / 中国澳门 / 中国台湾
  'com.hk', 'net.hk', 'org.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.mo', 'net.mo', 'org.mo', 'edu.mo', 'gov.mo',
  'com.tw', 'net.tw', 'org.tw', 'edu.tw', 'gov.tw', 'idv.tw',
  // 日本 / 韩国
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'ad.jp', 'ed.jp', 'go.jp', 'gr.jp', 'lg.jp',
  'co.kr', 'ne.kr', 'or.kr', 're.kr', 'pe.kr', 'go.kr', 'ac.kr', 'hs.kr', 'ms.kr', 'es.kr', 'sc.kr',
  // 英国 / 爱尔兰
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'ac.uk', 'gov.uk', 'nhs.uk', 'police.uk',
  'co.ie', 'gov.ie',
  // 大洋洲
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'asn.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'ac.nz', 'govt.nz', 'geek.nz', 'gen.nz', 'kiwi.nz', 'school.nz',
  // 拉美
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'blog.br', 'wiki.br', 'eco.br',
  'com.mx', 'net.mx', 'org.mx', 'edu.mx', 'gob.mx',
  'com.ar', 'net.ar', 'org.ar', 'edu.ar', 'gob.ar',
  'com.co', 'net.co', 'org.co', 'edu.co', 'gov.co',
  'com.pe', 'net.pe', 'org.pe', 'edu.pe', 'gob.pe',
  'com.ve', 'com.ec', 'com.uy', 'com.bo', 'com.py', 'com.do', 'com.gt',
  'com.sv', 'com.hn', 'com.ni', 'com.pa', 'com.cu',
  // 东南亚 / 南亚
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg', 'per.sg',
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my', 'name.my',
  'com.ph', 'net.ph', 'org.ph', 'edu.ph', 'gov.ph',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  'co.id', 'net.id', 'org.id', 'web.id', 'ac.id', 'sch.id', 'go.id', 'mil.id', 'biz.id', 'my.id', 'or.id',
  'co.th', 'ac.th', 'go.th', 'in.th', 'mi.th', 'net.th', 'or.th',
  'com.kh', 'com.la', 'com.mm', 'com.np', 'com.lk', 'com.bd', 'com.pk', 'net.pk', 'org.pk', 'edu.pk', 'gov.pk',
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'nic.in', 'ac.in', 'edu.in', 'gov.in', 'res.in',
  // 非洲 / 中东
  'co.za', 'net.za', 'org.za', 'gov.za', 'ac.za', 'web.za',
  'co.ke', 'or.ke', 'ne.ke', 'go.ke', 'ac.ke', 'sc.ke', 'me.ke',
  'com.ng', 'net.ng', 'org.ng', 'edu.ng', 'gov.ng', 'sch.ng', 'name.ng',
  'com.eg', 'net.eg', 'org.eg', 'edu.eg', 'gov.eg', 'sci.eg',
  'com.sa', 'net.sa', 'org.sa', 'edu.sa', 'gov.sa', 'med.sa', 'pub.sa', 'sch.sa',
  'com.ae', 'net.ae', 'org.ae', 'ac.ae', 'gov.ae', 'mil.ae', 'sch.ae',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il', 'k12.il', 'muni.il',
  'co.ir', 'net.ir', 'org.ir', 'ac.ir', 'gov.ir', 'sch.ir',
  // 欧洲其他
  'com.tr', 'net.tr', 'org.tr', 'edu.tr', 'gov.tr', 'av.tr', 'bel.tr', 'biz.tr', 'gen.tr', 'info.tr', 'k12.tr', 'name.tr', 'tel.tr', 'web.tr',
  'com.ru', 'net.ru', 'org.ru', 'pp.ru', 'msk.ru', 'spb.ru', 'int.ru',
  'com.ua', 'net.ua', 'org.ua', 'edu.ua', 'gov.ua', 'in.ua',
  'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'info.pl', 'biz.pl', 'waw.pl',
  'co.at', 'or.at', 'ac.at', 'gv.at', 'priv.at',
  'co.hu', 'org.hu', 'gov.hu', 'edu.hu',
  'com.gr', 'net.gr', 'org.gr', 'edu.gr', 'gov.gr',
  'com.pt', 'net.pt', 'org.pt', 'edu.pt', 'gov.pt', 'publ.pt', 'int.pt',
  'com.ro', 'org.ro', 'nt.ro',
  'co.no', 'priv.no',
  // 平台分配的私有后缀：不列会让同一平台的所有用户被并成一个站点
  'github.io', 'gitlab.io', 'gitee.io', 'pages.dev', 'workers.dev',
  'vercel.app', 'now.sh', 'netlify.app', 'netlify.com', 'web.app', 'firebaseapp.com',
  'herokuapp.com', 'herokussl.com', 'glitch.me', 'repl.co', 'replit.app', 'repl.it',
  'surge.sh', 'onrender.com', 'fly.dev', 'railway.app', 'webflow.io',
  'blogspot.com', 'notion.site', 'wordpress.com', 'myshopify.com',
  'translate.goog', 'cloudfront.net', 'amazonaws.com', 's3.amazonaws.com',
]);

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * 提取根域名（注册域 / registrable domain）：linux.do 与 cdk.linux.do
 * 都归到 linux.do，方便跨子域合并统计。
 *
 * 规则：默认取最后两段；末两段命中多段公共后缀（gov.cn、co.uk）时再多取一段；
 * IPv4 与单段主机名（localhost）原样返回；IPv6 字面量不做处理直接返回。
 *
 * @param {string} host 主机名（classifyUrl 的输出：已小写、已去 www.）
 * @returns {string} 根域名；输入不是字符串或为空时返回 ''
 */
export function rootDomain(host) {
  const h = typeof host === 'string' ? host.trim().toLowerCase().replace(/\.+$/, '') : '';
  if (!h) return '';
  // IPv6 字面量（URL.hostname 会给成 [::1] 形态）与 IPv4 没有根域名概念，原样返回。
  if (h.includes(':')) return h;
  if (IPV4_RE.test(h)) return h;
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  // 从最长的候选后缀往下试：命中即再多取一段作为注册域。
  for (let n = 4; n >= 2; n--) {
    if (labels.length > n && MULTI_LABEL_SUFFIXES.has(labels.slice(-n).join('.'))) {
      return labels.slice(-(n + 1)).join('.');
    }
  }
  return labels.slice(-2).join('.');
}

/**
 * 把扁平的 { 域名: 数值 } 按根域名合并求和——时长表与次数表都适用。
 * 非数值一律跳过，口径与 sumByDomain / sortRank 保持一致。
 */
export function mergeByRoot(flat) {
  const out = {};
  for (const [domain, value] of Object.entries(flat || {})) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const key = rootDomain(domain) || domain;
    out[key] = (out[key] || 0) + value;
  }
  return out;
}

/**
 * 把聚合域名还原成可打开的网址（排行项点击跳转用）。
 * 只接受「至少两段、且每段都是字母数字连字符」的纯主机名——
 * 域名来源是 classifyUrl，本就是 hostname，这里再挡一道，
 * 避免把异常值拼进 URL；ipv6、端口、路径都不可能出现在这。
 */
export function siteUrl(domain) {
  if (typeof domain !== 'string') return null;
  const host = domain.trim().toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  // 每段不能以连字符开头或结尾（RFC 952/1123）
  if (host.split('.').some((label) => label.startsWith('-') || label.endsWith('-'))) return null;
  return `https://${host}/`;
}

/**
 * 打开的标签页 → 待加入白名单的域名列表。
 *
 * 只认 http/https（复用 classifyUrl 的口径，浏览器内部页、扩展页、本地文件
 * 一律返回 null 被跳过）；同一域名开了多个标签页时**保序去重**并记下标签数，
 * 界面上显示成「×3」，不重复列三行。
 *
 * @param {Array<{url?: string}>} tabs chrome.tabs.query 的返回
 * @returns {Array<{ domain: string, count: number }>}
 */
export function tabDomains(tabs) {
  const counts = new Map();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    const domain = classifyUrl(tab?.url);
    if (!domain) continue;
    counts.set(domain, (counts.get(domain) || 0) + 1);
  }
  return [...counts].map(([domain, count]) => ({ domain, count }));
}

/**
 * 合并域名列表（批量加入白名单用）：existing 在前、incoming 追加在后。
 *
 * existing 原样保留——顺序与大小写都不动，避免顺手改动用户已有的数据；
 * incoming 做一次 trim + 小写（域名大小写不敏感，与表单、右键菜单的口径一致）；
 * 两边都去重，空值丢弃。
 */
export function mergeDomains(existing, incoming) {
  const out = [];
  const seen = new Set();
  for (const site of Array.isArray(existing) ? existing : []) {
    if (typeof site !== 'string' || !site || seen.has(site)) continue;
    seen.add(site);
    out.push(site);
  }
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const domain = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
  }
  return out;
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

/** 紧凑时长（进度环等小空间展示）：3小时21分 / 3h 21m，去掉普通格式的空格与「钟」。 */
export function fmtDurationCompact(totalSeconds, locale = 'zh') {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return locale === 'en' ? '0s' : '0 秒';
  }
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  if (locale === 'en') {
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
    return `${s}s`;
  }
  if (h > 0) return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  if (m > 0) return s > 0 ? `${m}分${s}秒` : `${m}分`;
  return `${s}秒`;
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
 * 把多天数据合并成扁平的 { domain: 数值 }：range='day' 只取 endKey 当天，
 * 否则取 endKey 往前含今天共 span 天求和。
 */
export function sumByDomain(map, endKey, range = 'day', span = 7) {
  const totals = {};
  const add = (day) => {
    for (const [domain, value] of Object.entries(day || {})) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      totals[domain] = (totals[domain] || 0) + value;
    }
  };
  if (range === 'day') {
    add(map?.[endKey]);
  } else {
    for (let i = span - 1; i >= 0; i--) add(map?.[shiftDateKey(endKey, -i)]);
  }
  return totals;
}

/**
 * 扁平 { domain: 数值 } → 按数值降序的 [{ domain, value }]。
 * 过滤非正数；并列时按域名升序，保证渲染顺序稳定（不随对象键序抖动）。
 */
export function sortRank(flat) {
  return Object.entries(flat || {})
    .filter(([, value]) => typeof value === 'number' && Number.isFinite(value) && value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([domain, value]) => ({ domain, value }));
}

/**
 * 排行榜聚合：把 { 'YYYY-MM-DD': { domain: 数值 } } 按「今日」或「近 N 天」
 * 求和后降序返回。
 *
 * 数值口径由调用方决定——传时长表就是按时间排，传次数表就是按次数排，
 * 所以 dashboard 与 popup 能共用同一个聚合实现。
 * 实时排序只读当前选中的那一张表：时长与次数各自独立记录，但每次
 * 排行只展示所选维度，避免一行里并排两个数值造成误读。
 *
 * byRoot 为 true 时再把结果按根域名合并（linux.do + cdk.linux.do → linux.do）。
 */
export function rankEntries(map, endKey, range = 'day', span = 7, byRoot = false) {
  const flat = sumByDomain(map, endKey, range, span);
  return sortRank(byRoot ? mergeByRoot(flat) : flat);
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

/**
 * 连续记录天数：从 endKey 往回数连续有正用量的日子。
 * 当天还没用不算断签（从昨天起算），全程无记录返回 0。
 */
export function streakDays(dailyMap, endKey) {
  const has = (key) => sumSeconds(dailyMap[key]) > 0;
  let key = has(endKey) ? endKey : shiftDateKey(endKey, -1);
  if (!has(key)) return 0;
  let n = 0;
  while (has(key)) {
    n += 1;
    key = shiftDateKey(key, -1);
  }
  return n;
}

/** 目标用量状态：ok（<80%）/ near（≥80%）/ over（≥100%）/ none（未启用）。 */
export function goalVariant(usedSeconds, goalSeconds) {
  if (!goalSeconds || goalSeconds <= 0) return 'none';
  if (usedSeconds >= goalSeconds) return 'over';
  if (usedSeconds >= goalSeconds * 0.8) return 'near';
  return 'ok';
}

/**
 * 专注模式拦截判定：开启且域名不在白名单时拦截。
 * 白名单按域名精确匹配（与 classifyUrl 的输出口径一致，已去 www.）。
 */
export function isFocusBlocked(domain, focus) {
  if (!focus?.enabled || !domain) return false;
  return !(Array.isArray(focus.sites) && focus.sites.includes(domain));
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
