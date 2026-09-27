/**
 * 图标角标：显示今日累计（如 2.4h / 34m）。
 * 达到目标 80% 变为警告色，达到目标变为警示色。
 */

import { fmtBadge, dateKey, goalVariant, sumSeconds } from '../lib/pure.js';
import { getSettings } from '../lib/settings.js';
import { getDay } from './store.js';

// 与 UI_UI 设计令牌一致的取值。
const COLORS = {
  muted: 'hsl(215.4, 16.3%, 46.9%)',
  warning: 'hsl(37.7, 92.1%, 50.2%)',
  destructive: 'hsl(0, 84.2%, 60.2%)',
};

export async function updateBadge() {
  const today = await getDay(dateKey());
  const total = sumSeconds(today);

  const settings = await getSettings();
  const variant = settings.goal.enabled
    ? goalVariant(total, settings.goal.dailyMinutes * 60)
    : 'none';

  await chrome.action.setBadgeText({ text: fmtBadge(total) });
  await chrome.action.setBadgeBackgroundColor({
    color: variant === 'over' ? COLORS.destructive : variant === 'near' ? COLORS.warning : COLORS.muted,
  });
  if (chrome.action.setBadgeTextColor) {
    await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  }
}
