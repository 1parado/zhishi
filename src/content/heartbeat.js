/**
 * 视频心跳内容脚本。
 * 仅当页面可见且有音视频正在播放时，向后台发送心跳信号；
 * 是否采信由后台按用户标记的站点白名单决定（见 background/tracker.js）。
 * 不读取、不上报任何页面内容。
 */

function hasPlayingMedia() {
  for (const el of document.querySelectorAll('video, audio')) {
    if (!el.paused && !el.ended && el.readyState >= 2) return true;
  }
  return false;
}

let lastPlaying = false;

function send() {
  try {
    // 后台可能未就绪或已被卸载（扩展更新中），失败静默。
    chrome.runtime.sendMessage({ type: 'zhishi-heartbeat' }).catch(() => {});
  } catch {
    // 扩展上下文已失效
  }
}

function report() {
  const playing = document.visibilityState === 'visible' && hasPlayingMedia();
  if (playing && !lastPlaying) send();
  lastPlaying = playing;
}

// 播放状态变化即时上报（捕获阶段，覆盖各播放器自定义控件）。
for (const event of ['play', 'pause', 'ended', 'visibilitychange']) {
  document.addEventListener(event, report, true);
}

// 播放期间周期性确认，防止 service worker 休眠丢失状态。
setInterval(() => {
  if (document.visibilityState === 'visible' && hasPlayingMedia()) send();
}, 20_000);
