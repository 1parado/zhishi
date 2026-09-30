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
}

/** 页面初始化时读设置套用一次。 */
export async function initTheme() {
  const { theme } = await getSettings();
  applyTheme(theme);
}
