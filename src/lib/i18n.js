/**
 * 轻量 i18n：zh / en 双语字典。
 * 不用 chrome.i18n 的原因是它跟随浏览器界面语言、无法运行时切换；
 * 这里由设置驱动（settings.locale），默认跟随浏览器语言。
 *
 * 用法：
 *   await initI18n();            // 页面初始化时预处理一次
 *   t('key', { n: 1 });          // 同步取词（locale 已缓存）
 *   await applyI18n(document);   // 把 data-i18n* 属性套上译文
 *   refreshLocale('en');         // 设置变化时刷新缓存
 *   fmtDuration(3600);           // 按当前语言格式化时长
 */

import { fmtDuration as fmtDurationBase, fmtDurationCompact as fmtDurationCompactBase } from './pure.js';

const MESSAGES = {
  zh: {
    brandName: '知时',
    brandSubDash: '注意力与健康 · 数据仅存本机',
    statusRecording: '正在记录：{domain} · 今日 {time}',
    statusPaused: '浏览器不在前台，计时暂停',
    todayLabel: '今日使用',
    topSites: '网站排行',
    topEmpty: '今天还没有记录，正常使用网页后这里会出现排行。',
    openSite: '打开 {site}',
    eyeRest: '护眼提醒',
    eyeEvery: '每 {n} 分钟望向远处',
    off: '已停用',
    siteLimits: '网站限额',
    limitsBlocking: '达到限额后拦截',
    openDashboard: '打开仪表盘',
    goalMinutes: '目标 {n} 分钟',

    tabOverview: '概览',
    tabLimits: '网站限额',
    tabAllowlist: '白名单',
    tabHealth: '健康提醒',
    tabData: '数据',
    tabSettings: '设置',
    today: '今日',
    last7: '近 7 天',
    dailyAvg: '日均 {time}',
    dailyGoal: '每日目标',
    dailyGoalDesc: '设定每日使用上限，弹窗会显示进度环，接近或超过时角标变色。',
    goalOk: '状态不错',
    goalNear: '接近目标',
    goalOver: '已超过目标',
    goalMinutesAria: '每日目标分钟数',
    minutes: '分钟',
    chartBar: '柱状',
    chartLine: '折线',
    chartPie: '饼状',
    pastYear: '近一年',
    yearTotal: '共 {time}',
    heatFew: '少',
    heatMany: '多',
    heatHint: '点击任意一天，查看它的小时级时间线。',
    viewTimeline: '查看时间线 ↗',
    rangeDay: '今日',
    rangeWeek: '近 7 天',
    metricTime: '时间',
    metricVisits: '次数',
    visitTimes: '{n} 次',
    showMore: '查看更多（共 {n} 个站点）',
    showLess: '收起',
    rankEmptyDay: '今天还没有记录。',
    rankEmptyWeek: '近 7 天还没有记录。',
    rankEmptyVisits: '还没有访问次数记录——次数从开始统计后累积，历史时长不会补算。',

    limitsDesc: '为指定网站设置每日使用上限，达到后打开该网站会跳转到提醒页，次日自动恢复。',
    domainPlaceholder: '网站域名，如 bilibili.com',
    minutesPerDay: '分钟 / 天',
    add: '添加',
    limitMinutesAria: '每日分钟数',
    searchPlaceholder: '按网站名查找…',
    filterAll: '全部',
    filterOn: '启用中',
    filterOff: '已停用',
    filterOver: '今日已达',
    limitsEmpty: '还没有添加限额网站。用上方表单添加第一条。',
    limitsEmptyFiltered: '没有符合条件的限额网站，换个关键词或筛选条件试试。',
    perDay: '每日 {n} 分钟',
    disabledSuffix: ' · 已停用',
    blockedSuffix: ' · {from}–{to} 屏蔽',
    scheduleBtn: '时段',
    scheduleEnable: '启用时段屏蔽',
    to: '至',
    scheduleHint: '窗口内打开该网站直接拦截，支持跨零点，放行 10 分钟仍然有效',
    scheduleFromAria: '时段开始',
    scheduleEndAria: '时段结束',
    limitSwitchAria: '{domain} 限额开关',
    limitRemoveAria: '删除 {domain} 限额',

    reminderSchedule: '提醒时段',
    reminderScheduleDesc: '护眼与久坐提醒只在所选时段内触发，避免深夜打扰。',
    allDay: '全天',
    timeWindow: '时间段',
    crossMidnightHint: '支持跨零点，如 09:00 至 22:00',
    scheduleStartAria: '时段开始',
    scheduleEndAria2: '时段结束',
    eyeTitle: '护眼提醒',
    eyeDesc: '按 20-20-20 法则，定时提醒你望向 6 米外的远处。间隔可设 5–120 分钟。',
    eyeIntervalAria: '护眼提醒间隔（分钟）',
    nextReminderIn: '约 {time} 后提醒',
    sitTitle: '久坐提醒',
    sitDesc: '定时提醒你起身活动，减少连续久坐。间隔可设 10–240 分钟，人离开电脑时不会打扰。',
    sitIntervalAria: '久坐提醒间隔（分钟）',

    hbTitle: '视频心跳',
    hbDesc: '对以下站点，页面正在播放音视频时持续计时（含画中画与后台窗口），不受「60 秒无输入视为离开」的闲置判定影响。也可以在视频网站页面右键快速开关。',
    hbNone: '当前没有收到心跳：播放中的视频站点需在白名单内；扩展重载后请刷新对应页面。',
    hbNow: '当前心跳：{list}',
    secondsAgo: ' 秒前',
    hbSwitchAria: '视频心跳开关',
    hbRemoveAria: '移除 {domain} 的视频心跳',
    hbDomainPlaceholder: '域名，如 youtube.com',
    hbAdd: '添加站点',

    focusTitle: '专注模式',
    focusDesc: '白名单工作模式：开启后仅白名单内的站点可访问，其余网站一律跳转拦截页。适合工作、学习时保持专注。可在扩展弹窗快速开关。',
    focusPlaceholder: '域名，如 github.com',
    focusAdd: '添加白名单',
    focusEmpty: '还没有白名单站点。开启专注模式后，只有白名单内的站点可以访问。',
    focusRemoveAria: '将 {domain} 移出白名单',
    focusOnSub: '{n} 个白名单站点',
    focusOffSub: '仅白名单站点可访问',

    shareBtn: '生成分享卡片',
    shareSave: '保存 PNG',
    shareClose: '关闭',
    shareReport: '{year} 年度报告',
    hourShort: '小时',
    shareTotalLabel: '年度总使用',
    shareActiveDaysN: '{n} 个活跃天',
    shareDailyAvg: '日均使用',
    sharePeakDay: '最高单日',
    shareTopSite: '最常访问',
    shareSitesTitle: '站点排行',
    shareHeatTitle: '全年热力图',
    shareByWeekday: '按星期分布',
    shareGenerated: '生成于 {date}',
    shareEmpty: '暂无数据',
    shareYearSeg: '年度',
    shareBadgeDay: '今日报告',
    shareBadgeWeek: '近 7 天报告',
    shareTodayTotal: '今日总使用',
    shareWeekTotal: '近 7 天总使用',
    shareVsYesterday: '较昨日',
    shareVsPrev7: '较上个 7 天',
    shareFlat: '持平',
    shareMiniTitle: '近 7 天趋势',
    shareActiveSites: '访问网站',
    shareStreak: '连续记录',
    shareStreakDays: '{n} 天',
    shareStreakChip: '连续 {n} 天',
    shareBusiestDay: '最活跃',
    shareNickname: '昵称',
    shareNicknamePlaceholder: '怎么称呼你？',
    shareAvatarAria: '上传头像',
    shareAvatarRemove: '移除头像',
    shareShowProfile: '在卡片上显示我的信息',

    exportTitle: '导出',
    exportDesc: '按天、按域名导出全部记录。',
    exportCsv: '导出 CSV',
    exportJson: '导出 JSON',
    clearTitle: '清除数据',
    clearDesc: '删除全部使用记录，设置会保留。此操作不可恢复。',
    clearBtn: '清除全部记录',
    clearConfirm: '再次点击确认删除',
    privacy: '所有数据仅保存在本机浏览器中，不上传任何服务器；只记录域名与时长，不记录页面内容。',

    language: '语言 / Language',
    languageDesc: '界面语言，切换立即生效。/ UI language, applies immediately.',
    siteIconTitle: '网站图标',
    siteIconDesc: '优先显示网站自己的图标——地址来自浏览器访问时解析好的图标，本扩展不抓取也不上传。关闭后只用内置品牌图标或首字母。',
    themeLabel: '主题',
    themeLight: '浅色',
    themeDark: '暗色',
    themeDesc: '浅色、暗色，切换立即生效。',
    themeAria: '主题',
    githubTitle: 'GitHub 仓库',

    blockPageTitle: '今日限额已用完',
    blockTitle: '该网站今日限额已用完',
    blockUsage: '已用 {used} · 限额 {limit}',
    grantBtn: '放行 10 分钟',
    viewStats: '去看看统计',
    blockNote: '明天自动恢复。放行期间会继续正常计时。',
    blockFocusTitle: '专注模式进行中',
    blockFocusNote: '该站点不在白名单内。点击浏览器工具栏的知时图标即可关闭专注模式。',

    timelineTitle: '时间线',
    timelinePrev: '前一天',
    timelineNext: '后一天',
    timelineToday: '今天',
    totalLabel: '当日总时长',
    tlAxisTitle: '时间轴',
    tlAxisHint: '每个色块是一段真实浏览记录，悬停查看起止时间；在色带上拖选可放大区间，点击色块打开对应网站。',
    tlReset: '重置缩放',
    tlLegendMore: '展开全部（共 {n} 个）',
    tlFallback: '该日为小时级近似数据（升级前的记录）。',
    timelineEmpty: '这一天还没有记录。',
    backToDash: '返回仪表盘',

    notifEyeTitle: '护眼提醒 · 20-20-20',
    notifEyeBody: '望向 6 米外的事物 20 秒，让眼睛放松一下。',
    notifSitTitle: '久坐提醒',
    notifSitBody: '已经连续坐了一段时间，起来活动两分钟吧。',

    menuLimitSite: '将此网站加入网站限额',
    menuLimitDomain: '将 {domain} 加入网站限额',
    menuFocusSite: '将此网站加入专注白名单',
    menuFocusAdd: '将 {domain} 加入专注白名单',
    menuFocusRemove: '将 {domain} 移出专注白名单',
    menuHbSite: '为此网站开启视频心跳',
    menuHbOn: '为 {domain} 开启视频心跳',
    menuHbOff: '关闭 {domain} 的视频心跳',
  },

  en: {
    brandName: 'Know your time',
    brandSubDash: 'Attention & wellness · Data stays local',
    statusRecording: 'Recording {domain} · {time} today',
    statusPaused: 'Browser in background — timing paused',
    todayLabel: 'Today',
    topSites: 'Top sites',
    topEmpty: 'No records yet today. Browse normally and the ranking appears here.',
    openSite: 'Open {site}',
    eyeRest: 'Eye rest',
    eyeEvery: 'Look away every {n} min',
    off: 'Off',
    siteLimits: 'Site limits',
    limitsBlocking: 'Blocks at limit',
    openDashboard: 'Open dashboard',
    goalMinutes: 'Goal {n} min',

    tabOverview: 'Overview',
    tabLimits: 'Site limits',
    tabAllowlist: 'Allowlist',
    tabHealth: 'Wellness',
    tabData: 'Data',
    tabSettings: 'Settings',
    today: 'Today',
    last7: 'Last 7 days',
    dailyAvg: 'Avg {time}/day',
    dailyGoal: 'Daily goal',
    dailyGoalDesc: 'Set a daily cap. The popup shows a progress ring, and the badge changes color as you approach or pass it.',
    goalOk: 'On track',
    goalNear: 'Near goal',
    goalOver: 'Over goal',
    goalMinutesAria: 'Daily goal in minutes',
    minutes: 'min',
    chartBar: 'Bar',
    chartLine: 'Line',
    chartPie: 'Pie',
    pastYear: 'Past year',
    yearTotal: 'Total {time}',
    heatFew: 'Less',
    heatMany: 'More',
    heatHint: 'Click any day to open its hour-by-hour timeline.',
    viewTimeline: 'View timeline ↗',
    rangeDay: 'Today',
    rangeWeek: 'Last 7 days',
    metricTime: 'Time',
    metricVisits: 'Visits',
    visitTimes: '{n} visits',
    showMore: 'Show more ({n} sites total)',
    showLess: 'Show less',
    rankEmptyDay: 'No records today.',
    rankEmptyWeek: 'No records this week.',
    rankEmptyVisits: 'No visit counts yet — they accumulate from now on, past time is not back-filled.',

    limitsDesc: 'Set a daily cap for specific sites. Once reached, opening the site shows a reminder page until tomorrow.',
    domainPlaceholder: 'Domain, e.g. bilibili.com',
    minutesPerDay: 'min / day',
    add: 'Add',
    limitMinutesAria: 'Daily minutes',
    searchPlaceholder: 'Search by site…',
    filterAll: 'All',
    filterOn: 'Enabled',
    filterOff: 'Disabled',
    filterOver: 'Limit reached',
    limitsEmpty: 'No limits yet. Add your first one with the form above.',
    limitsEmptyFiltered: 'No limits match. Try another keyword or filter.',
    perDay: '{n} min / day',
    disabledSuffix: ' · disabled',
    blockedSuffix: ' · blocked {from}–{to}',
    scheduleBtn: 'Schedule',
    scheduleEnable: 'Time-window block',
    to: 'to',
    scheduleHint: 'Opening the site inside the window is blocked directly. Overnight windows supported; a 10-minute allow still works.',
    scheduleStartAria: 'Window start',
    scheduleEndAria2: 'Window end',
    limitSwitchAria: '{domain} limit switch',
    limitRemoveAria: 'Remove {domain} limit',

    reminderSchedule: 'Reminder schedule',
    reminderScheduleDesc: 'Eye and sitting reminders fire only within the chosen window, so nights stay quiet.',
    allDay: 'All day',
    timeWindow: 'Time window',
    crossMidnightHint: 'Overnight windows supported, e.g. 09:00–22:00',
    scheduleStartAria: 'Window start',
    scheduleEndAria2: 'Window end',
    eyeTitle: 'Eye rest',
    eyeDesc: 'Follows the 20-20-20 rule: periodic nudges to look at something far away. Interval 5–120 min.',
    eyeIntervalAria: 'Eye rest interval (minutes)',
    nextReminderIn: 'Reminds in {time}',
    sitTitle: 'Sitting break',
    sitDesc: 'Periodic nudges to stand up and move. Interval 10–240 min; silent while you are away from the computer.',
    sitIntervalAria: 'Sitting break interval (minutes)',

    hbTitle: 'Video heartbeat',
    hbDesc: 'For these sites, timing continues while audio or video plays (including PiP and background windows) — the 60-second idle rule does not apply. You can also toggle it from the right-click menu on a video site.',
    hbNone: 'No heartbeat yet: playing video sites must be allowlisted, and pages need a refresh after reloading the extension.',
    hbNow: 'Heartbeat: {list}',
    secondsAgo: 's ago',
    hbSwitchAria: 'Video heartbeat switch',
    hbRemoveAria: 'Disable heartbeat for {domain}',
    hbDomainPlaceholder: 'Domain, e.g. youtube.com',
    hbAdd: 'Add site',

    focusTitle: 'Focus mode',
    focusDesc: 'Allowlist-only work mode: while enabled, only allowlisted sites are accessible — everything else redirects to a block page. Toggle it quickly from the popup.',
    focusPlaceholder: 'Domain, e.g. github.com',
    focusAdd: 'Add to allowlist',
    focusEmpty: 'No allowlisted sites yet. Once Focus mode is on, only allowlisted sites are accessible.',
    focusRemoveAria: 'Remove {domain} from allowlist',
    focusOnSub: '{n} allowlisted sites',
    focusOffSub: 'Only allowlisted sites',

    shareBtn: 'Share card',
    shareSave: 'Save PNG',
    shareClose: 'Close',
    shareReport: '{year} report',
    hourShort: 'hrs',
    shareTotalLabel: 'Total this year',
    shareActiveDaysN: '{n} active days',
    shareDailyAvg: 'Daily avg',
    sharePeakDay: 'Busiest day',
    shareTopSite: 'Top site',
    shareSitesTitle: 'Top sites',
    shareHeatTitle: 'Year heatmap',
    shareByWeekday: 'By weekday',
    shareGenerated: 'Generated {date}',
    shareEmpty: 'No data yet',
    shareYearSeg: 'Year',
    shareBadgeDay: 'Daily report',
    shareBadgeWeek: 'Weekly report',
    shareTodayTotal: 'Total today',
    shareWeekTotal: 'Total last 7 days',
    shareVsYesterday: 'vs yesterday',
    shareVsPrev7: 'vs previous 7 days',
    shareFlat: 'no change',
    shareMiniTitle: 'Last 7 days',
    shareActiveSites: 'Sites visited',
    shareStreak: 'Streak',
    shareStreakDays: '{n} days',
    shareStreakChip: '{n}-day streak',
    shareBusiestDay: 'Busiest day',
    shareNickname: 'Name',
    shareNicknamePlaceholder: 'Your name',
    shareAvatarAria: 'Upload avatar',
    shareAvatarRemove: 'Remove avatar',
    shareShowProfile: 'Show my name & avatar',

    exportTitle: 'Export',
    exportDesc: 'Export everything by day and by domain.',
    exportCsv: 'Export CSV',
    exportJson: 'Export JSON',
    clearTitle: 'Clear data',
    clearDesc: 'Delete all usage records. Settings are kept. This cannot be undone.',
    clearBtn: 'Clear all records',
    clearConfirm: 'Click again to confirm',
    privacy: 'All data stays in this browser — nothing is uploaded. Only domains and durations are recorded, never page content.',

    language: '语言 / Language',
    languageDesc: '界面语言，切换立即生效。/ UI language, applies immediately.',
    siteIconTitle: 'Site icons',
    siteIconDesc: 'Prefer each site’s own icon, as parsed by the browser when you visit it — this extension fetches and uploads nothing. When off, built-in brand icons or initials are used instead.',
    themeLabel: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeDesc: 'Light or dark. Applies immediately.',
    themeAria: 'Theme',
    githubTitle: 'GitHub repository',

    blockPageTitle: 'Daily limit reached',
    blockTitle: 'Daily limit reached for this site',
    blockUsage: 'Used {used} · Limit {limit}',
    grantBtn: 'Allow 10 minutes',
    viewStats: 'View stats',
    blockNote: 'Resets tomorrow. Timing continues as usual during the allow window.',
    blockFocusTitle: 'Focus mode is on',
    blockFocusNote: 'This site is not on the allowlist. Click the Zhishi toolbar icon to turn Focus mode off.',

    timelineTitle: 'Timeline',
    timelinePrev: 'Previous day',
    timelineNext: 'Next day',
    timelineToday: 'Today',
    totalLabel: 'Total',
    tlAxisTitle: 'Timeline',
    tlAxisHint: 'Each block is a real browsing segment — hover for times, drag on the strip to zoom, click a block to open the site.',
    tlReset: 'Reset zoom',
    tlLegendMore: 'Show all ({n})',
    tlFallback: 'Hour-level approximation (recorded before this upgrade).',
    timelineEmpty: 'No records for this day.',
    backToDash: 'Back to dashboard',

    notifEyeTitle: 'Eye rest · 20-20-20',
    notifEyeBody: 'Look at something 20 feet away for 20 seconds and let your eyes relax.',
    notifSitTitle: 'Sitting break',
    notifSitBody: "You've been sitting for a while — stand up and move around for two minutes.",

    menuLimitSite: 'Limit this site',
    menuLimitDomain: 'Limit {domain}',
    menuFocusSite: 'Add this site to Focus allowlist',
    menuFocusAdd: 'Add {domain} to Focus allowlist',
    menuFocusRemove: 'Remove {domain} from Focus allowlist',
    menuHbSite: 'Enable video heartbeat for this site',
    menuHbOn: 'Enable video heartbeat for {domain}',
    menuHbOff: 'Disable video heartbeat for {domain}',
  },
};

let currentLocale = null;

function browserLocale() {
  try {
    const ui = (chrome.i18n?.getUILanguage?.() || '').toLowerCase();
    return ui.startsWith('zh') ? 'zh' : 'en';
  } catch {
    return 'zh';
  }
}

async function settingsLocale() {
  try {
    const data = await chrome.storage.local.get('settings');
    const locale = data.settings?.locale;
    return ['zh', 'en'].includes(locale) ? locale : null;
  } catch {
    return null;
  }
}

/** 预读 locale（幂等）。force=true 时重新读设置（语言切换后调用）。 */
export async function initI18n(force = false) {
  if (currentLocale && !force) return currentLocale;
  currentLocale = (await settingsLocale()) ?? browserLocale();
  return currentLocale;
}

/** 设置变化后同步缓存。 */
export function refreshLocale(locale) {
  if (['zh', 'en'].includes(locale)) currentLocale = locale;
}

/** 当前生效语言（未初始化时按浏览器语言兜底）。 */
export function getLocale() {
  return currentLocale ?? browserLocale();
}

/** 按当前语言格式化时长。 */
export function fmtDuration(seconds) {
  return fmtDurationBase(seconds, getLocale());
}

/** 按当前语言格式化紧凑时长（进度环等小空间展示）。 */
export function fmtDurationCompact(seconds) {
  return fmtDurationCompactBase(seconds, getLocale());
}

/** 同步取词。参数用 {name} 占位。 */
export function t(key, params = {}) {
  let str = MESSAGES[currentLocale ?? 'zh']?.[key] ?? MESSAGES.zh[key] ?? key;
  for (const [k, v] of Object.entries(params)) str = str.replaceAll(`{${k}}`, String(v));
  return str;
}

/** 把 data-i18n / data-i18n-placeholder / data-i18n-aria / data-i18n-title 套上译文。 */
export async function applyI18n(root = document) {
  await initI18n();
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) {
    el.setAttribute('title', t(el.dataset.i18nTitle));
  }
  document.documentElement.lang = currentLocale === 'en' ? 'en' : 'zh-CN';
}
