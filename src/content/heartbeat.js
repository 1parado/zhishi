/**
 * 视频心跳内容脚本。
 * 页面有音视频正在播放（无论可见、画中画还是后台窗口）就周期性向后台发心跳；
 * 是否采信由后台按用户标记的站点白名单决定（见 background/tracker.js）。
 * 不读取、不上报任何页面内容。
 */

function hasPlayingMedia() {
  for (const el of document.querySelectorAll('video, audio')) {
    if (!el.paused && !el.ended && el.readyState >= 2) return true;
  }
  return false;
}

function send() {
  try {
    // 后台可能未就绪或已被卸载（扩展更新中），失败静默。
    chrome.runtime.sendMessage({ type: 'zhishi-heartbeat' }).catch(() => {});
  } catch {
    // 扩展上下文已失效
  }
}

let lastPlaying = false;

function report() {
  const playing = hasPlayingMedia();
  if (playing && !lastPlaying) send();
  lastPlaying = playing;
}

// 播放状态变化即时上报（捕获阶段，覆盖各播放器自定义控件）。
for (const event of ['play', 'pause', 'ended']) {
  document.addEventListener(event, report, true);
}

// 播放期间周期性确认，防止 service worker 休眠丢失状态。
setInterval(() => {
  if (hasPlayingMedia()) send();
}, 20_000);

// ---------- 阅读心跳 ----------
// 滚轮 / 触摸滚动视为「人在看页面」：向后台上报轻量活动信号，
// 后台据此放宽该域名的闲置判定（纯滚动阅读不再被误判离开）。
// 只监听真实的用户输入事件（wheel/touchmove），不监听 scroll——
// 无限流页面的程序化滚动也会触发 scroll，会把自动加载误判成人在看。
// 节流：最多每 20 秒上报一次，避免高频滚动刷爆消息通道。
let lastActivitySent = 0;

function sendActivity() {
  const now = Date.now();
  if (now - lastActivitySent < 20_000) return;
  lastActivitySent = now;
  try {
    chrome.runtime.sendMessage({ type: 'zhishi-activity' }).catch(() => {});
  } catch {
    // 扩展上下文已失效
  }
}

for (const event of ['wheel', 'touchmove']) {
  document.addEventListener(event, sendActivity, { capture: true, passive: true });
}

