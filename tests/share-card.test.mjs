import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shiftDateKey } from '../src/lib/pure.js';
import { dayCardStats, weekCardStats } from '../src/lib/share-card.js';

const H = 3600;

test('dayCardStats 汇总今日总量、昨日对比与 Top 站点', () => {
  const days = {
    '2026-10-01': { 'github.com': 2 * H, 'bilibili.com': H },
    '2026-09-30': { 'github.com': H },
  };
  const s = dayCardStats(days, '2026-10-01');
  assert.equal(s.total, 3 * H);
  assert.equal(s.prevTotal, H);
  assert.deepEqual(s.topSites, [
    ['github.com', 2 * H],
    ['bilibili.com', H],
  ]);
  assert.equal(s.siteCount, 2);
  assert.equal(s.streak, 2);
  assert.equal(s.week.length, 7);
  assert.equal(s.week[6].key, '2026-10-01');
  assert.equal(s.weekTotal, 4 * H);
});

test('dayCardStats 忽略 0 时长的站点', () => {
  const days = { '2026-10-01': { 'github.com': H, 'a.com': 0 } };
  const s = dayCardStats(days, '2026-10-01');
  assert.deepEqual(s.topSites, [['github.com', H]]);
  assert.equal(s.siteCount, 1);
});

test('weekCardStats 汇总近 7 天与上个 7 天对比', () => {
  const today = '2026-10-01';
  const days = {};
  for (let i = 0; i < 7; i++) {
    days[shiftDateKey(today, -i)] = { 'github.com': H, 'a.com': 600 };
  }
  // 上个 7 天只有 3 天有记录
  for (let i = 8; i <= 10; i++) {
    days[shiftDateKey(today, -i)] = { 'github.com': 2 * H };
  }
  const s = weekCardStats(days, today);
  assert.equal(s.total, 7 * (H + 600));
  assert.equal(s.prevTotal, 6 * H);
  assert.deepEqual(s.topSites[0], ['github.com', 7 * H]);
  assert.equal(s.siteCount, 2);
  assert.equal(s.streak, 7); // 本周 7 天连续；09-24（间隔天）无记录
  assert.equal(s.week.length, 7);
  // 并列最大时取最早一天，时长一致即可
  assert.equal(s.peak.key, s.week[0].key);
  assert.equal(s.peak.seconds, H + 600);
});

test('空数据时统计安全归零', () => {
  const s = dayCardStats({}, '2026-10-01');
  assert.equal(s.total, 0);
  assert.equal(s.prevTotal, 0);
  assert.deepEqual(s.topSites, []);
  assert.equal(s.streak, 0);
  assert.equal(s.weekTotal, 0);

  const w = weekCardStats({}, '2026-10-01');
  assert.equal(w.total, 0);
  assert.equal(w.prevTotal, 0);
  assert.deepEqual(w.topSites, []);
  assert.equal(w.peak, null);
});
