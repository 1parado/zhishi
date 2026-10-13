/**
 * AI 助手核心模块：Ollama 客户端、上下文构建、系统提示词、动作框架。
 *
 * 纯函数（buildUsageContext / buildSystemPrompt / formatToolCallDescription /
 * AGENT_TOOLS）不依赖 chrome API，可被 Node 测试直接调用。
 * Ollama 客户端（checkConnection / listModels / chatStream）与动作执行
 * （executeAction）运行在 dashboard 页面上下文，需要 fetch 与 settings.js。
 */

import { dateKey, shiftDateKey, sumSeconds, rankEntries, fmtDuration, fmtDurationCompact } from './pure.js';
import { addLimit, removeLimit, setLimitEnabled, saveSettings, getSettings } from './settings.js';

/* ========================================================================
 * 纯函数：上下文构建与提示词
 * ====================================================================== */

/**
 * 将使用数据与设置格式化为简洁文本上下文，供系统提示词嵌入。
 * @param {Record<string, Record<string, number>>} days — { 'YYYY-MM-DD': { domain: seconds } }
 * @param {Record<string, Record<string, number>>} visits — { 'YYYY-MM-DD': { domain: count } }
 * @param {object} settings — 归一化后的设置对象
 * @param {'zh'|'en'} locale
 * @returns {string}
 */
export function buildUsageContext(days, visits, settings, locale = 'zh') {
  const isZh = locale !== 'en';
  const today = dateKey();
  const todayData = days[today] || {};
  const todayTotal = sumSeconds(todayData);
  const todayVisits = visits[today] || {};
  const todayRank = rankEntries(days, today, 'day', 1, settings.mergeByRoot).slice(0, 10);

  const weekStart = shiftDateKey(today, -6);
  const week = weekSeriesLocal(days, today, 7);
  const weekTotal = week.reduce((sum, d) => sum + d.seconds, 0);
  const weekAvg = Math.round(weekTotal / 7);
  const weekRank = rankEntries(days, today, 'week', 7, settings.mergeByRoot).slice(0, 10);

  const lastWeekEnd = shiftDateKey(today, -1);
  const lastWeek = weekSeriesLocal(days, lastWeekEnd, 7);
  const lastWeekTotal = lastWeek.reduce((sum, d) => sum + d.seconds, 0);

  const L = (s) => (isZh ? s.zh : s.en);
  const lines = [];

  lines.push(L({ zh: `## 今日使用 (${today})`, en: `## Today (${today})` }));
  lines.push(L({ zh: `总时长: ${fmtDuration(todayTotal)}`, en: `Total: ${fmtDuration(todayTotal, 'en')}` }));
  if (todayRank.length > 0) {
    lines.push(L({ zh: '网站排行:', en: 'Top sites:' }));
    for (let i = 0; i < todayRank.length; i++) {
      const { domain, value: seconds } = todayRank[i];
      const vc = todayVisits[domain] || 0;
      lines.push(
        L({
          zh: `${i + 1}. ${domain} — ${fmtDuration(seconds)} (${vc}次访问)`,
          en: `${i + 1}. ${domain} — ${fmtDuration(seconds, 'en')} (${vc} visits)`,
        })
      );
    }
  }

  lines.push(
    L({
      zh: `\n## 本周使用 (${weekStart} 至 ${today})`,
      en: `\n## This Week (${weekStart} to ${today})`,
    })
  );
  lines.push(
    L({
      zh: `总时长: ${fmtDuration(weekTotal)}, 日均: ${fmtDuration(weekAvg)}`,
      en: `Total: ${fmtDuration(weekTotal, 'en')}, Daily avg: ${fmtDuration(weekAvg, 'en')}`,
    })
  );
  if (lastWeekTotal > 0) {
    const pct = (((weekTotal - lastWeekTotal) / lastWeekTotal) * 100).toFixed(1);
    const sign = pct > 0 ? '+' : '';
    lines.push(
      L({
        zh: `环比上周: ${sign}${pct}% (上周 ${fmtDuration(lastWeekTotal)})`,
        en: `vs last week: ${sign}${pct}% (last week ${fmtDuration(lastWeekTotal, 'en')})`,
      })
    );
  }
  const wdZh = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const wdEn = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  lines.push(
    L({ zh: '每日时长: ', en: 'Daily: ' }) +
      week
        .map((d) => {
          const day = new Date(d.key + 'T00:00:00').getDay();
          return `${isZh ? wdZh[day] : wdEn[day]} ${fmtDurationCompact(d.seconds, locale)}`;
        })
        .join(', ')
  );
  if (weekRank.length > 0) {
    lines.push(L({ zh: '本周排行:', en: 'Week top sites:' }));
    for (let i = 0; i < weekRank.length; i++) {
      const { domain, value: seconds } = weekRank[i];
      lines.push(
        L({
          zh: `${i + 1}. ${domain} — ${fmtDuration(seconds)}`,
          en: `${i + 1}. ${domain} — ${fmtDuration(seconds, 'en')}`,
        })
      );
    }
  }

  lines.push(L({ zh: '\n## 当前设置', en: '\n## Current Settings' }));
  lines.push(
    settings.goal.enabled
      ? L({
          zh: `每日目标: ${fmtDuration(settings.goal.dailyMinutes * 60)} (已启用)`,
          en: `Daily goal: ${fmtDuration(settings.goal.dailyMinutes * 60, 'en')} (enabled)`,
        })
      : L({ zh: '每日目标: 未设置', en: 'Daily goal: not set' })
  );

  const activeLimits = settings.limits.filter((l) => l.enabled);
  if (settings.limitsEnabled && activeLimits.length > 0) {
    lines.push(L({ zh: '网站限额 (已启用):', en: 'Site limits (enabled):' }));
    for (const l of activeLimits) {
      lines.push(
        L({
          zh: `- ${l.domain}: ${l.minutes}分钟/天`,
          en: `- ${l.domain}: ${l.minutes} min/day`,
        })
      );
    }
  } else {
    lines.push(L({ zh: '网站限额: 未启用', en: 'Site limits: disabled' }));
  }

  lines.push(
    L({
      zh: `专注模式: ${settings.focus.enabled ? '已开启' : '已关闭'}`,
      en: `Focus mode: ${settings.focus.enabled ? 'on' : 'off'}`,
    })
  );
  if (settings.focus.enabled && settings.focus.sites.length > 0) {
    lines.push(
      L({ zh: `白名单: ${settings.focus.sites.join(', ')}`, en: `Allowlist: ${settings.focus.sites.join(', ')}` })
    );
  }

  lines.push(
    L({
      zh: `护眼提醒: ${settings.health.eye.enabled ? `每${settings.health.eye.intervalMin}分钟` : '已关闭'}`,
      en: `Eye reminder: ${settings.health.eye.enabled ? `every ${settings.health.eye.intervalMin} min` : 'off'}`,
    })
  );
  lines.push(
    L({
      zh: `久坐提醒: ${settings.health.sit.enabled ? `每${settings.health.sit.intervalMin}分钟` : '已关闭'}`,
      en: `Sit reminder: ${settings.health.sit.enabled ? `every ${settings.health.sit.intervalMin} min` : 'off'}`,
    })
  );

  return lines.join('\n');
}

/** weekSeries 的本地包装，避免从 pure.js 导入过多。pure.js 的 weekSeries 签名相同。 */
function weekSeriesLocal(dailyMap, endKey, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = shiftDateKey(endKey, -i);
    out.push({ key, seconds: sumSeconds(dailyMap[key]) });
  }
  return out;
}

/**
 * 组装系统提示词。
 * @param {string} context — buildUsageContext 的输出
 * @param {'zh'|'en'} locale
 * @returns {string}
 */
export function buildSystemPrompt(context, locale = 'zh') {
  if (locale === 'en') {
    return [
      'You are the AI assistant for the "ZhiShi" browser extension. You can view the user\'s browsing data, answer questions about their habits, and modify settings after user confirmation.',
      '',
      context,
      '',
      '## Available Actions',
      'You can perform the following via tool calls. Before calling a tool, briefly explain your intent. The system shows a confirmation card; actions only execute after user approval.',
      '- set_limit: Set daily time limit for a site (domain, minutes)',
      '- remove_limit: Remove a site limit (domain)',
      '- toggle_focus: Enable/disable focus mode (enabled)',
      '- add_allowlist: Add site to focus allowlist (domain)',
      '- remove_allowlist: Remove site from allowlist (domain)',
      '- toggle_eye_reminder: Toggle eye rest reminder (enabled, interval_min)',
      '- toggle_sit_reminder: Toggle sit reminder (enabled, interval_min)',
      '- set_goal: Set daily usage goal (enabled, daily_minutes)',
      '',
      '## Guidelines',
      '- Keep answers concise, in English',
      '- Base answers on the data above; state honestly when data is insufficient',
      '- Never modify settings without user confirmation',
      '- Explain reasoning when giving suggestions',
      '- Format durations as "Xh Ym" or "Ym"',
    ].join('\n');
  }
  return [
    '你是"知时"浏览器扩展的 AI 助手。你可以查看用户的浏览使用数据，回答关于浏览习惯的问题，并在用户确认后修改设置。',
    '',
    context,
    '',
    '## 可用操作',
    '你可以通过工具调用执行以下操作。调用工具前，先用自然语言简要说明意图，系统会向用户展示确认卡片，用户同意后才会执行。',
    '- set_limit: 为网站设置每日使用限额（domain, minutes）',
    '- remove_limit: 移除网站限额（domain）',
    '- toggle_focus: 开启或关闭专注模式（enabled）',
    '- add_allowlist: 添加专注模式白名单（domain）',
    '- remove_allowlist: 移除专注模式白名单（domain）',
    '- toggle_eye_reminder: 开关护眼提醒（enabled, interval_min）',
    '- toggle_sit_reminder: 开关久坐提醒（enabled, interval_min）',
    '- set_goal: 设置每日目标（enabled, daily_minutes）',
    '',
    '## 行为准则',
    '- 回答简洁明了，用中文',
    '- 基于上述数据回答，数据不足时如实说明',
    '- 修改设置前必须获得用户确认，不可静默操作',
    '- 给出建议时说明理由，如"你本周在 bilibili.com 花了 8 小时，建议设置限额"',
    '- 时间格式用"X小时Y分钟"或"Y分钟"',
  ].join('\n');
}

/* ========================================================================
 * 纯数据：Ollama 工具定义
 * ====================================================================== */

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_limit',
      description: 'Set a daily time limit (in minutes) for a website domain',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Website domain, e.g. bilibili.com' },
          minutes: { type: 'number', description: 'Daily limit in minutes (5-1440)' },
        },
        required: ['domain', 'minutes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_limit',
      description: 'Remove the daily time limit for a website domain',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Website domain' },
        },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_focus',
      description: 'Enable or disable focus mode (only allowlisted sites are accessible)',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true to enable, false to disable' },
        },
        required: ['enabled'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_allowlist',
      description: 'Add a website domain to the focus mode allowlist',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Website domain to allowlist' },
        },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_allowlist',
      description: 'Remove a website domain from the focus mode allowlist',
      parameters: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Website domain to remove' },
        },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_eye_reminder',
      description: 'Toggle the eye rest reminder on or off, optionally changing the interval',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true to enable, false to disable' },
          interval_min: { type: 'number', description: 'Reminder interval in minutes (5-120)' },
        },
        required: ['enabled'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'toggle_sit_reminder',
      description: 'Toggle the sit reminder on or off, optionally changing the interval',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true to enable, false to disable' },
          interval_min: { type: 'number', description: 'Reminder interval in minutes (10-240)' },
        },
        required: ['enabled'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_goal',
      description: 'Set the daily usage goal in minutes',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'true to enable the goal, false to disable' },
          daily_minutes: { type: 'number', description: 'Daily goal in minutes (15-1440)' },
        },
        required: ['enabled'],
      },
    },
  },
];

/**
 * 将工具调用格式化为人类可读的操作描述，用于确认卡片展示。
 * @param {{function?:{name?:string,arguments?:object}}|{name?:string,arguments?:object}} toolCall
 * @param {'zh'|'en'} locale
 * @returns {string}
 */
export function formatToolCallDescription(toolCall, locale = 'zh') {
  const name = toolCall?.function?.name || toolCall?.name || '';
  const args = toolCall?.function?.arguments || toolCall?.arguments || {};
  const isZh = locale !== 'en';

  const domain = String(args.domain || '').replace(/^www\./, '');
  const enabled = args.enabled;
  const minutes = args.minutes || args.daily_minutes || args.interval_min;

  const desc = {
    set_limit: {
      zh: `为 ${domain} 设置每日 ${minutes} 分钟限额`,
      en: `Set ${minutes} min/day limit for ${domain}`,
    },
    remove_limit: {
      zh: `移除 ${domain} 的每日限额`,
      en: `Remove daily limit for ${domain}`,
    },
    toggle_focus: {
      zh: enabled ? '开启专注模式' : '关闭专注模式',
      en: enabled ? 'Enable focus mode' : 'Disable focus mode',
    },
    add_allowlist: {
      zh: `将 ${domain} 添加到专注模式白名单`,
      en: `Add ${domain} to focus allowlist`,
    },
    remove_allowlist: {
      zh: `将 ${domain} 从专注模式白名单移除`,
      en: `Remove ${domain} from focus allowlist`,
    },
    toggle_eye_reminder: {
      zh: enabled
        ? minutes
          ? `开启护眼提醒，间隔 ${minutes} 分钟`
          : '开启护眼提醒'
        : '关闭护眼提醒',
      en: enabled
        ? minutes
          ? `Enable eye reminder (every ${minutes} min)`
          : 'Enable eye reminder'
        : 'Disable eye reminder',
    },
    toggle_sit_reminder: {
      zh: enabled
        ? minutes
          ? `开启久坐提醒，间隔 ${minutes} 分钟`
          : '开启久坐提醒'
        : '关闭久坐提醒',
      en: enabled
        ? minutes
          ? `Enable sit reminder (every ${minutes} min)`
          : 'Enable sit reminder'
        : 'Disable sit reminder',
    },
    set_goal: {
      zh: enabled
        ? minutes
          ? `设置每日目标 ${minutes} 分钟`
          : '开启每日目标'
        : '关闭每日目标',
      en: enabled
        ? minutes
          ? `Set daily goal to ${minutes} min`
          : 'Enable daily goal'
        : 'Disable daily goal',
    },
  };

  const entry = desc[name];
  if (!entry) {
    return isZh ? `执行操作: ${name}` : `Execute action: ${name}`;
  }
  return isZh ? entry.zh : entry.en;
}

/* ========================================================================
 * Ollama 客户端（需要 fetch，运行在 dashboard 页面上下文）
 * ====================================================================== */

/**
 * 检查 Ollama 是否在线。
 * @param {string} endpoint — 如 'http://localhost:11434'
 * @returns {Promise<boolean>}
 */
export async function checkConnection(endpoint) {
  try {
    const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * 列出 Ollama 可用模型。
 * @param {string} endpoint
 * @returns {Promise<string[]>} 模型名数组
 */
export async function listModels(endpoint) {
  const res = await fetch(`${endpoint}/api/tags`);
  if (!res.ok) throw new Error(`Ollama API error: ${res.status}`);
  const data = await res.json();
  return (data.models || []).map((m) => m.name).filter(Boolean);
}

/**
 * 流式调用 Ollama /api/chat，逐块回调。
 * @param {string} endpoint
 * @param {string} model
 * @param {Array<{role:string,content:string,tool_calls?:object[]}>} messages
 * @param {object[]} tools — AGENT_TOOLS
 * @param {(chunk:{type:'text',content:string}|{type:'tool_calls',toolCalls:object[]})=>void} onChunk
 * @returns {Promise<{content:string,toolCalls:object[]}>}
 */
export async function chatStream(endpoint, model, messages, tools, onChunk) {
  const body = { model, messages, stream: true };
  if (tools?.length) body.tools = tools;

  const res = await fetch(`${endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama API error: ${res.status} ${text}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';
  const toolCalls = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        continue;
      }
      if (data.message?.content) {
        fullContent += data.message.content;
        onChunk({ type: 'text', content: data.message.content });
      }
      if (data.message?.tool_calls?.length) {
        toolCalls.push(...data.message.tool_calls);
        onChunk({ type: 'tool_calls', toolCalls: data.message.tool_calls });
      }
    }
  }

  return { content: fullContent, toolCalls };
}

/* ========================================================================
 * 动作执行（调用 settings.js，运行在 dashboard 页面上下文）
 * ====================================================================== */

/**
 * 执行工具调用对应的动作。所有写操作均通过 settings.js 的函数完成，
 * 它们内部会重新 getSettings 保证一致性。
 * @param {{function?:{name?:string,arguments?:object}}|{name?:string,arguments?:object}} toolCall
 * @param {object} _settings — 当前设置快照（仅用于查找已有限额）
 * @returns {Promise<{ok:boolean,message:string}>}
 */
export async function executeAction(toolCall, _settings) {
  const name = toolCall?.function?.name || toolCall?.name || '';
  const args = toolCall?.function?.arguments || toolCall?.arguments || {};
  const domain = String(args.domain || '').toLowerCase().replace(/^www\./, '');

  switch (name) {
    case 'set_limit': {
      const minutes = Math.round(Number(args.minutes));
      if (!domain) return { ok: false, message: 'domain 不能为空' };
      if (!Number.isFinite(minutes) || minutes < 5 || minutes > 1440)
        return { ok: false, message: 'minutes 需在 5–1440 之间' };
      await addLimit(domain, minutes);
      return { ok: true, message: `已为 ${domain} 设置每日 ${minutes} 分钟限额` };
    }

    case 'remove_limit': {
      if (!domain) return { ok: false, message: 'domain 不能为空' };
      const current = await getSettings();
      const limit = current.limits.find((l) => l.domain === domain);
      if (!limit) return { ok: false, message: `未找到 ${domain} 的限额` };
      await removeLimit(limit.id);
      return { ok: true, message: `已移除 ${domain} 的限额` };
    }

    case 'toggle_focus': {
      const enabled = Boolean(args.enabled);
      await saveSettings({ focus: { enabled } });
      return { ok: true, message: enabled ? '已开启专注模式' : '已关闭专注模式' };
    }

    case 'add_allowlist': {
      if (!domain) return { ok: false, message: 'domain 不能为空' };
      const current = await getSettings();
      if (current.focus.sites.includes(domain))
        return { ok: false, message: `${domain} 已在白名单中` };
      await saveSettings({ focus: { sites: [...current.focus.sites, domain] } });
      return { ok: true, message: `已将 ${domain} 添加到白名单` };
    }

    case 'remove_allowlist': {
      if (!domain) return { ok: false, message: 'domain 不能为空' };
      const current = await getSettings();
      if (!current.focus.sites.includes(domain))
        return { ok: false, message: `${domain} 不在白名单中` };
      await saveSettings({ focus: { sites: current.focus.sites.filter((s) => s !== domain) } });
      return { ok: true, message: `已将 ${domain} 从白名单移除` };
    }

    case 'toggle_eye_reminder': {
      const enabled = Boolean(args.enabled);
      const patch = { health: { eye: { enabled } } };
      if (args.interval_min != null) {
        const min = Math.round(Number(args.interval_min));
        if (Number.isFinite(min) && min >= 5 && min <= 120)
          patch.health.eye.intervalMin = min;
      }
      await saveSettings(patch);
      return { ok: true, message: enabled ? '已开启护眼提醒' : '已关闭护眼提醒' };
    }

    case 'toggle_sit_reminder': {
      const enabled = Boolean(args.enabled);
      const patch = { health: { sit: { enabled } } };
      if (args.interval_min != null) {
        const min = Math.round(Number(args.interval_min));
        if (Number.isFinite(min) && min >= 10 && min <= 240)
          patch.health.sit.intervalMin = min;
      }
      await saveSettings(patch);
      return { ok: true, message: enabled ? '已开启久坐提醒' : '已关闭久坐提醒' };
    }

    case 'set_goal': {
      const enabled = Boolean(args.enabled);
      const patch = { goal: { enabled } };
      if (args.daily_minutes != null) {
        const min = Math.round(Number(args.daily_minutes));
        if (Number.isFinite(min) && min >= 15 && min <= 1440)
          patch.goal.dailyMinutes = min;
      }
      await saveSettings(patch);
      return { ok: true, message: enabled ? '已开启每日目标' : '已关闭每日目标' };
    }

    default:
      return { ok: false, message: `未知操作: ${name}` };
  }
}
