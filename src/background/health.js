/**
 * 健康提醒：护眼（20-20-20）与久坐，通过 chrome.alarms 周期触发系统通知。
 * 闹钟的存在与否由设置驱动（ensureAlarms），闲置时不打扰。
 */

import { inTimeWindow } from '../lib/pure.js';
import { getSettings } from '../lib/settings.js';
import { initI18n, t } from '../lib/i18n.js';

export const EYE_ALARM = 'eyeReminder';
export const SIT_ALARM = 'sitReminder';

/** 提醒是否处于用户设定的触发时段内（'all' 全天；'range' 仅 from–to，支持跨零点）。 */
function withinActiveHours(settings, now = new Date()) {
  const hours = settings.health.activeHours;
  if (!hours || hours.mode !== 'range') return true;
  return inTimeWindow(now, hours.from, hours.to);
}

/** 依据设置同步护眼/久坐闹钟。settings 变化时由 service-worker 调用。 */
export async function ensureAlarms() {
  const settings = await getSettings();
  await syncOne(EYE_ALARM, settings.health.eye);
  await syncOne(SIT_ALARM, settings.health.sit);
}

async function syncOne(name, cfg) {
  const existing = await chrome.alarms.get(name);
  const enabled = cfg?.enabled && cfg.intervalMin > 0;
  if (enabled) {
    if (!existing || existing.periodInMinutes !== cfg.intervalMin) {
      await chrome.alarms.create(name, { periodInMinutes: cfg.intervalMin });
    }
  } else if (existing) {
    await chrome.alarms.clear(name);
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== EYE_ALARM && alarm.name !== SIT_ALARM) return;
  const settings = await getSettings();
  if (alarm.name === EYE_ALARM && !settings.health.eye.enabled) return;
  if (alarm.name === SIT_ALARM && !settings.health.sit.enabled) return;
  if (!withinActiveHours(settings)) return;

  // 人不在电脑前就不打扰。
  const idleState = await chrome.idle.queryState(60);
  if (idleState !== 'active') return;

  await initI18n(true); // 语言偏好可能刚切换过，强制重读。

  if (alarm.name === EYE_ALARM) {
    chrome.notifications.create(`eye-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t('notifEyeTitle'),
      message: t('notifEyeBody'),
    });
  } else {
    chrome.notifications.create(`sit-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: t('notifSitTitle'),
      message: t('notifSitBody'),
    });
  }
});

// 点击通知打开仪表盘。
chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/dashboard.html') });
});
