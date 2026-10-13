import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_TOOLS,
  buildSystemPrompt,
  buildUsageContext,
  formatToolCallDescription,
} from '../src/lib/agent.js';
import { dateKey, shiftDateKey } from '../src/lib/pure.js';

// ---- 测试用 mock 数据 ----

const today = dateKey();
const yesterday = shiftDateKey(today, -1);
const twoDaysAgo = shiftDateKey(today, -2);

const mockDays = {
  [today]: { 'bilibili.com': 7200, 'github.com': 1800, 'linux.do': 600 },
  [yesterday]: { 'bilibili.com': 5400, 'github.com': 2700 },
  [twoDaysAgo]: { 'bilibili.com': 3600, 'youtube.com': 1200 },
};

const mockVisits = {
  [today]: { 'bilibili.com': 8, 'github.com': 3, 'linux.do': 2 },
  [yesterday]: { 'bilibili.com': 5, 'github.com': 4 },
};

const mockSettings = {
  mergeByRoot: true,
  goal: { enabled: true, dailyMinutes: 240 },
  limitsEnabled: true,
  limits: [
    { id: 1, domain: 'bilibili.com', minutes: 60, enabled: true },
    { id: 2, domain: 'youtube.com', minutes: 30, enabled: false },
  ],
  focus: { enabled: false, sites: ['github.com'] },
  health: {
    eye: { enabled: true, intervalMin: 20 },
    sit: { enabled: false, intervalMin: 45 },
    activeHours: { mode: 'all', from: '09:00', to: '22:00' },
  },
  agent: { enabled: false, endpoint: 'http://localhost:11434', model: '' },
};

/* ---------- buildUsageContext ---------- */

test('buildUsageContext 包含今日总时长与排行', () => {
  const ctx = buildUsageContext(mockDays, mockVisits, mockSettings, 'zh');
  assert.ok(ctx.includes('今日使用'), '应包含「今日使用」标题');
  assert.ok(ctx.includes('bilibili.com'), '应包含 bilibili.com');
  assert.ok(ctx.includes('2小时'), 'bilibili 7200s ≈ 2小时');
});

test('buildUsageContext 包含本周汇总', () => {
  const ctx = buildUsageContext(mockDays, mockVisits, mockSettings, 'zh');
  assert.ok(ctx.includes('本周使用'), '应包含「本周使用」标题');
  assert.ok(ctx.includes('日均'), '应包含日均');
});

test('buildUsageContext 包含当前设置', () => {
  const ctx = buildUsageContext(mockDays, mockVisits, mockSettings, 'zh');
  assert.ok(ctx.includes('当前设置'), '应包含「当前设置」标题');
  assert.ok(ctx.includes('每日目标'), '应包含每日目标');
  assert.ok(ctx.includes('bilibili.com: 60分钟/天'), '应包含限额明细');
  assert.ok(ctx.includes('护眼提醒'), '应包含护眼提醒');
});

test('buildUsageContext 空数据不报错', () => {
  const ctx = buildUsageContext({}, {}, mockSettings, 'zh');
  assert.ok(ctx.includes('今日使用'));
  assert.ok(ctx.includes('0分钟') || ctx.includes('0 分'));
});

test('buildUsageContext 英文 locale 产出英文', () => {
  const ctx = buildUsageContext(mockDays, mockVisits, mockSettings, 'en');
  assert.ok(ctx.includes('## Today'), '英文标题');
  assert.ok(ctx.includes('bilibili.com'));
  assert.ok(ctx.includes('Top sites'), '排行榜标题');
});

/* ---------- buildSystemPrompt ---------- */

test('buildSystemPrompt 嵌入上下文', () => {
  const ctx = '测试上下文内容';
  const prompt = buildSystemPrompt(ctx, 'zh');
  assert.ok(prompt.includes('测试上下文内容'), '应嵌入上下文');
  assert.ok(prompt.includes('知时'), '应包含角色名');
  assert.ok(prompt.includes('set_limit'), '应包含工具说明');
});

test('buildSystemPrompt 英文版', () => {
  const prompt = buildSystemPrompt('test context', 'en');
  assert.ok(prompt.includes('test context'));
  assert.ok(prompt.includes('ZhiShi'));
  assert.ok(prompt.includes('set_limit'));
});

test('buildSystemPrompt 包含行为准则', () => {
  const zh = buildSystemPrompt('', 'zh');
  assert.ok(zh.includes('行为准则'));
  assert.ok(zh.includes('用户确认'));

  const en = buildSystemPrompt('', 'en');
  assert.ok(en.includes('Guidelines'));
  assert.ok(en.includes('confirmation'));
});

/* ---------- AGENT_TOOLS ---------- */

test('AGENT_TOOLS 每个工具有合法结构', () => {
  assert.ok(AGENT_TOOLS.length >= 8, '至少 8 个工具');

  for (const tool of AGENT_TOOLS) {
    assert.equal(tool.type, 'function', `工具 ${tool.function?.name} type 应为 function`);
    assert.ok(tool.function?.name, '应有 function.name');
    assert.ok(tool.function?.description, '应有 function.description');
    assert.equal(tool.function.parameters?.type, 'object', `${tool.function.name} parameters.type 应为 object`);
    assert.ok(Array.isArray(tool.function.parameters?.required), `${tool.function.name} required 应为数组`);
  }
});

test('AGENT_TOOLS 包含 set_limit', () => {
  const sl = AGENT_TOOLS.find((t) => t.function.name === 'set_limit');
  assert.ok(sl, '应存在 set_limit');
  assert.ok(sl.function.parameters.properties.domain, '应有 domain 参数');
  assert.ok(sl.function.parameters.properties.minutes, '应有 minutes 参数');
  assert.deepEqual(sl.function.parameters.required, ['domain', 'minutes']);
});

test('AGENT_TOOLS 参数名使用 snake_case', () => {
  const names = AGENT_TOOLS.map((t) => t.function.name);
  assert.ok(names.includes('toggle_eye_reminder'));
  assert.ok(names.includes('toggle_sit_reminder'));
  assert.ok(names.includes('add_allowlist'));
  assert.ok(names.includes('set_goal'));

  const goal = AGENT_TOOLS.find((t) => t.function.name === 'set_goal');
  assert.ok(goal.function.parameters.properties.daily_minutes, 'set_goal 应有 daily_minutes 参数');
});

/* ---------- formatToolCallDescription ---------- */

test('formatToolCallDescription set_limit', () => {
  const desc = formatToolCallDescription(
    { function: { name: 'set_limit', arguments: { domain: 'bilibili.com', minutes: 60 } } },
    'zh'
  );
  assert.ok(desc.includes('bilibili.com'));
  assert.ok(desc.includes('60'));
  assert.ok(desc.includes('限额'));
});

test('formatToolCallDescription toggle_focus', () => {
  const on = formatToolCallDescription(
    { function: { name: 'toggle_focus', arguments: { enabled: true } } },
    'zh'
  );
  assert.ok(on.includes('开启'));

  const off = formatToolCallDescription(
    { function: { name: 'toggle_focus', arguments: { enabled: false } } },
    'zh'
  );
  assert.ok(off.includes('关闭'));
});

test('formatToolCallDescription 英文', () => {
  const desc = formatToolCallDescription(
    { function: { name: 'add_allowlist', arguments: { domain: 'github.com' } } },
    'en'
  );
  assert.ok(desc.includes('github.com'));
  assert.ok(desc.includes('allowlist'));
});

test('formatToolCallDescription 未知操作回退', () => {
  const desc = formatToolCallDescription(
    { function: { name: 'unknown_action', arguments: {} } },
    'zh'
  );
  assert.ok(desc.includes('unknown_action'));
});

test('formatToolCallDescription 兼容扁平格式', () => {
  // 不带 function 包装的扁平结构
  const desc = formatToolCallDescription(
    { name: 'set_limit', arguments: { domain: 'youtube.com', minutes: 30 } },
    'zh'
  );
  assert.ok(desc.includes('youtube.com'));
  assert.ok(desc.includes('30'));
});
