/**
 * 主题预套用（经典同步脚本，须在 <head> 的样式表 <link> 之前引入）。
 *
 * 主题原本要等页面模块异步读完 chrome.storage 才套用，暗色模式下每次
 * 跳转都会先画一帧浅色再变暗（闪白）。这里在首次绘制前从 localStorage
 * 镜像（由 theme.js 的 applyTheme 回写）同步恢复主题；'auto' 用
 * matchMedia 现场解析，与 CSS 媒体查询结果一致。模块加载后 initTheme
 * 仍会按设置再套用一次，二者结果相同，只是消除了中间的浅色帧。
 */
(function () {
  try {
    var theme = localStorage.getItem('zhishi-theme');
    if (theme !== 'light' && theme !== 'dark') {
      theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.dataset.theme = theme;
  } catch {
    // localStorage 不可用时维持默认（跟随系统媒体查询）。
  }
})();
