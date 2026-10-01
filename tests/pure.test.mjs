import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  capChunk,
  classifyUrl,
  dateKey,
  filterLimits,
  fmtBadge,
  fmtDuration,
  fmtDurationCompact,
  goalVariant,
  inTimeWindow,
  isFocusBlocked,
  isValidTime,
  shiftDateKey,
  shortDate,
  sumSeconds,
  toCSV,
  streakDays,
  usageLevel,
  weekSeries,
  weekdayShort,
} from '../src/lib/pure.js';

test('dateKey 输出本地 YYYY-MM-DD', () => {
  assert.equal(dateKey(new Date(2026, 8, 27)), '2026-09-27');
});

test('shiftDateKey 处理跨月与跨年', () => {
  assert.equal(shiftDateKey('2026-09-01', -1), '2026-08-31');
  assert.equal(shiftDateKey('2026-01-01', -1), '2025-12-31');
  assert.equal(shiftDateKey('2026-02-28', 1), '2026-03-01');
});

test('classifyUrl 只统计 http/https 并去掉 www.', () => {
  assert.equal(classifyUrl('https://www.bilibili.com/video/1'), 'bilibili.com');
  assert.equal(classifyUrl('http://GitHub.com/'), 'github.com');
  assert.equal(classifyUrl('chrome://extensions/'), null);
  assert.equal(classifyUrl('chrome-extension://abc/popup.html'), null);
  assert.equal(classifyUrl('file:///D:/x.txt'), null);
  assert.equal(classifyUrl(''), null);
  assert.equal(classifyUrl(undefined), null);
  assert.equal(classifyUrl('https://'), null);
});

test('capChunk 限制单次结算上限', () => {
  assert.equal(capChunk(-5), 0);
  assert.equal(capChunk(1000), 1000);
  assert.equal(capChunk(3600_000), 90_000);
});

test('fmtDuration 中文时长，精确到秒', () => {
  assert.equal(fmtDuration(0), '0 秒');
  assert.equal(fmtDuration(42), '42 秒');
  assert.equal(fmtDuration(75), '1 分 15 秒');
  assert.equal(fmtDuration(34 * 60), '34 分钟');
  assert.equal(fmtDuration(2 * 3600), '2 小时');
  assert.equal(fmtDuration(2 * 3600 + 18 * 60), '2 小时 18 分');
  assert.equal(fmtDuration(3600 + 61), '1 小时 1 分');
});

test('fmtDuration 英文时长', () => {
  assert.equal(fmtDuration(0, 'en'), '0 sec');
  assert.equal(fmtDuration(42, 'en'), '42 sec');
  assert.equal(fmtDuration(75, 'en'), '1 min 15 sec');
  assert.equal(fmtDuration(34 * 60, 'en'), '34 min');
  assert.equal(fmtDuration(3600, 'en'), '1 hour');
  assert.equal(fmtDuration(2 * 3600, 'en'), '2 hours');
  assert.equal(fmtDuration(2 * 3600 + 18 * 60, 'en'), '2 hours 18 min');
});

test('fmtDurationCompact 中文紧凑时长（进度环用）', () => {
  assert.equal(fmtDurationCompact(0), '0 秒');
  assert.equal(fmtDurationCompact(42), '42秒');
  assert.equal(fmtDurationCompact(75), '1分15秒');
  assert.equal(fmtDurationCompact(34 * 60), '34分');
  assert.equal(fmtDurationCompact(2 * 3600), '2小时');
  assert.equal(fmtDurationCompact(2 * 3600 + 18 * 60), '2小时18分');
  assert.equal(fmtDurationCompact(12 * 3600 + 34 * 60), '12小时34分');
});

test('fmtDurationCompact 英文紧凑时长', () => {
  assert.equal(fmtDurationCompact(0, 'en'), '0s');
  assert.equal(fmtDurationCompact(42, 'en'), '42s');
  assert.equal(fmtDurationCompact(75, 'en'), '1m 15s');
  assert.equal(fmtDurationCompact(34 * 60, 'en'), '34m');
  assert.equal(fmtDurationCompact(3600, 'en'), '1h');
  assert.equal(fmtDurationCompact(2 * 3600 + 18 * 60, 'en'), '2h 18m');
});

test('fmtBadge 角标文本', () => {
  assert.equal(fmtBadge(0), '');
  assert.equal(fmtBadge(59), '');
  assert.equal(fmtBadge(34 * 60), '34m');
  assert.equal(fmtBadge(2.4 * 3600), '2.4h');
  assert.equal(fmtBadge(10.4 * 3600), '10h');
});

test('weekdayShort 与 shortDate', () => {
  assert.equal(weekdayShort('2026-09-27'), '日');
  assert.equal(shortDate('2026-09-27'), '9/27');
});

test('sumSeconds 求和与容错', () => {
  assert.equal(sumSeconds({ a: 10, b: 20 }), 30);
  assert.equal(sumSeconds(undefined), 0);
});

test('weekSeries 返回最近 7 天升序', () => {
  const days = { '2026-09-27': { a: 60 }, '2026-09-25': { b: 120 } };
  const series = weekSeries(days, '2026-09-27', 7);
  assert.equal(series.length, 7);
  assert.equal(series[6].key, '2026-09-27');
  assert.equal(series[6].seconds, 60);
  assert.equal(series[4].key, '2026-09-25');
  assert.equal(series[4].seconds, 120);
  assert.equal(series[0].seconds, 0);
});

test('streakDays 从今天往回数连续有记录的日子', () => {
  const days = {
    '2026-09-25': { a: 60 },
    '2026-09-26': { a: 60 },
    '2026-09-27': { a: 60 },
  };
  assert.equal(streakDays(days, '2026-09-27'), 3);
});

test('streakDays 当天没用不断签，从昨天起算', () => {
  const days = {
    '2026-09-25': { a: 60 },
    '2026-09-26': { a: 60 },
  };
  assert.equal(streakDays(days, '2026-09-27'), 2);
  // 中间断档（09-23 有、09-24 无）：只数最近一段
  days['2026-09-23'] = { a: 60 };
  assert.equal(streakDays(days, '2026-09-27'), 2);
  assert.equal(streakDays({}, '2026-09-27'), 0);
});

test('usageLevel 绝对时长分档（绿/黄/橙/红）', () => {
  assert.equal(usageLevel(0), 0);
  assert.equal(usageLevel(3599), 1);
  assert.equal(usageLevel(3600), 2);
  assert.equal(usageLevel(3 * 3600 - 1), 2);
  assert.equal(usageLevel(3 * 3600), 3);
  assert.equal(usageLevel(6 * 3600 - 1), 3);
  assert.equal(usageLevel(6 * 3600), 4);
});

test('goalVariant 状态', () => {
  assert.equal(goalVariant(100, 0), 'none');
  assert.equal(goalVariant(70, 100), 'ok');
  assert.equal(goalVariant(85, 100), 'near');
  assert.equal(goalVariant(100, 100), 'over');
});

test('isFocusBlocked 白名单拦截', () => {
  const focus = { enabled: true, sites: ['github.com'] };
  assert.equal(isFocusBlocked('github.com', focus), false);
  assert.equal(isFocusBlocked('bilibili.com', focus), true);
  assert.equal(isFocusBlocked(null, focus), false); // 内部页面无域名，不拦
  // 关闭时不拦
  assert.equal(isFocusBlocked('bilibili.com', { enabled: false, sites: [] }), false);
  // 结构缺失时安全兜底
  assert.equal(isFocusBlocked('bilibili.com', undefined), false);
  assert.equal(isFocusBlocked('bilibili.com', { enabled: true }), true);
});

test('toCSV 导出排序稳定', () => {
  const csv = toCSV({
    '2026-09-27': { 'b.com': 30, 'a.com': 60 },
    '2026-09-26': { 'a.com': 15 },
  });
  assert.equal(
    csv,
    'date,domain,seconds\n2026-09-26,a.com,15\n2026-09-27,a.com,60\n2026-09-27,b.com,30\n'
  );
});

test('filterLimits 按名称与状态筛选', () => {
  const limits = [
    { id: 1, domain: 'bilibili.com', minutes: 30, enabled: true },
    { id: 2, domain: 'Baidu.com', minutes: 20, enabled: false },
    { id: 3, domain: 'zhihu.com', minutes: 10, enabled: true },
  ];
  const usage = { 'bilibili.com': 1800, 'zhihu.com': 60 };

  assert.deepEqual(
    filterLimits(limits, { text: 'bi' }, usage).map((l) => l.id),
    [1]
  );
  // 大小写不敏感
  assert.deepEqual(
    filterLimits(limits, { text: 'BAIDU' }, usage).map((l) => l.id),
    [2]
  );
  assert.deepEqual(
    filterLimits(limits, { status: 'on' }, usage).map((l) => l.id),
    [1, 3]
  );
  assert.deepEqual(
    filterLimits(limits, { status: 'off' }, usage).map((l) => l.id),
    [2]
  );
  // 今日已达：bilibili 1800s ≥ 30min，zhihu 未达
  assert.deepEqual(
    filterLimits(limits, { status: 'over' }, usage).map((l) => l.id),
    [1]
  );
  // 组合条件
  assert.deepEqual(
    filterLimits(limits, { text: 'zhihu', status: 'on' }, usage).map((l) => l.id),
    [3]
  );
  // 默认不过滤
  assert.equal(filterLimits(limits, {}, usage).length, 3);
  assert.equal(filterLimits(null, {}).length, 0);
});

test('isValidTime 校验 HH:MM', () => {
  assert.equal(isValidTime('09:00'), true);
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('9:5'), false);
  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime(''), false);
  assert.equal(isValidTime(undefined), false);
});

test('inTimeWindow 支持常规与跨零点窗口', () => {
  const at = (h, m) => new Date(2026, 8, 27, h, m);
  assert.equal(inTimeWindow(at(10, 0), '09:00', '22:00'), true);
  assert.equal(inTimeWindow(at(8, 59), '09:00', '22:00'), false);
  assert.equal(inTimeWindow(at(9, 0), '09:00', '22:00'), true);
  assert.equal(inTimeWindow(at(22, 0), '09:00', '22:00'), false);
  // 跨零点：23:00–08:00
  assert.equal(inTimeWindow(at(23, 30), '23:00', '08:00'), true);
  assert.equal(inTimeWindow(at(2, 0), '23:00', '08:00'), true);
  assert.equal(inTimeWindow(at(12, 0), '23:00', '08:00'), false);
  assert.equal(inTimeWindow(at(7, 59), '23:00', '08:00'), true);
  assert.equal(inTimeWindow(at(8, 0), '23:00', '08:00'), false);
  // 相等视为空窗口，非法输入不命中
  assert.equal(inTimeWindow(at(10, 0), '09:00', '09:00'), false);
  assert.equal(inTimeWindow(at(10, 0), 'abc', '22:00'), false);
});
