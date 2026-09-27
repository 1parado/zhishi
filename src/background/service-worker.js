/**
 * 后台入口：汇总所有模块，注册浏览器事件监听。
 * 所有事件最终汇入 tracker.tick —— 结算上一段、重估当前标签页。
 */

import { ensureAlarms } from './health.js';
import { ensureMenu } from './menu.js';
import { updateBadge } from './badge.js';
import { getHeartbeatState, isPopupOpen, noteHeartbeat, tick } from './tracker.js';

chrome.idle.setDetectionInterval(60);

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms();
  ensureMenu();
  tick('installed');
});

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms();
  ensureMenu();
  updateBadge();
  tick('startup');
});

chrome.tabs.onActivated.addListener(() => tick());
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  if (info.url !== undefined || info.status === 'complete') tick();
});
chrome.tabs.onRemoved.addListener(() => tick());
chrome.windows.onFocusChanged.addListener(() => tick());
chrome.windows.onRemoved.addListener(() => tick());
chrome.idle.onStateChanged.addListener(() => tick());

// 每分钟兜底结算：service worker 休眠期间由闹钟唤醒。
chrome.alarms.create('flush', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush') tick('alarm');
});

// 数据或设置变化 → 刷新角标；设置变化 → 同步健康提醒闹钟。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some((k) => k.startsWith('d:'))) updateBadge();
  if (changes.settings) {
    ensureAlarms();
    updateBadge();
  }
});

// 供页面探测后台是否存活；内容脚本心跳在此登记。
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ping') {
    sendResponse({ ok: true, ts: Date.now() });
    return false;
  }
  if (msg && msg.type === 'zhishi-heartbeat') {
    noteHeartbeat(sender);
    return false;
  }
  // popup 打开瞬间可能因焦点切换竞态清掉会话，主动触发一次结算续上。
  if (msg && msg.type === 'zhishi-popup-opened') {
    tick('popup');
    return false;
  }
  if (msg && msg.type === 'debug-heartbeats') {
    isPopupOpen().then((popupOpen) =>
      sendResponse({ heartbeats: getHeartbeatState(), popupOpen })
    );
    return true; // 异步响应
  }
  return false;
});
