/**
 * 主题应用。令牌已在 shared.css 以 :root[data-theme='light'|'dark'] 声明，
 * 其特异性高于 @media (prefers-color-scheme)，故显式值总生效；
 * 'auto' 不设属性，回落到系统偏好。
 */
import { getSettings } from './settings.js';

const html = document.documentElement;

export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') html.dataset.theme = theme;
  else delete html.dataset.theme; // auto：跟随系统
  // 同步镜像到 localStorage：theme-boot.js 在下一页首绘前据此预套用，
  // 消除暗色模式下页面跳转的浅色闪烁。chrome.storage 本身是异步的，
  // 无法在首次绘制前读取。
  try {
    localStorage.setItem('zhishi-theme', theme);
  } catch {
    // localStorage 不可用时跳过镜像，仅影响跳转首绘，不影响本页主题。
  }
}

/** 页面初始化时读设置套用一次。 */
export async function initTheme() {
  const { theme } = await getSettings();
  applyTheme(theme);
}

/** 当前生效主题（'light' | 'dark'）：显式设置优先，auto 按系统偏好解析。 */
export function resolvedTheme() {
  return (
    html.dataset.theme ||
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
}
