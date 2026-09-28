/**
 * 网站品牌色图标：内联 SVG data URL，零网络、零存储、带内存缓存。
 * 已知站点用品牌色，未知站点按域名哈希取色。
 */

// 国内外常用站点的品牌色（hex，data URL 友好）
const BRAND_COLORS = {
  'bilibili.com': '#fb7299',
  'github.com': '#181717',
  'google.com': '#4285f4',
  'youtube.com': '#ff0000',
  'zhihu.com': '#0084ff',
  'stackoverflow.com': '#f48024',
  'linux.do': '#00aa00',
  'twitter.com': '#000000',
  'x.com': '#000000',
  'reddit.com': '#ff4500',
  'wikipedia.org': '#000000',
  'baidu.com': '#2932e1',
  'weibo.com': '#e6162d',
  'taobao.com': '#ff5000',
  'jd.com': '#e1251b',
  'douyin.com': '#161823',
  'iqiyi.com': '#00be06',
  'netflix.com': '#e50914',
  'amazon.com': '#ff9900',
  'microsoft.com': '#0078d4',
  'apple.com': '#555555',
  'notion.so': '#000000',
  'yuque.com': '#25b864',
  'csdn.net': '#fc5531',
  'juejin.cn': '#1e80ff',
  'medium.com': '#000000',
  'linkedin.com': '#0a66c2',
  'facebook.com': '#1877f2',
  'instagram.com': '#e4405f',
  'qq.com': '#12b7f5',
  'tencent.com': '#00a4ff',
  'slack.com': '#4a154b',
  'discord.com': '#5865f2',
  'figma.com': '#f24e1e',
  'notion.site': '#000000',
  'gmail.com': '#ea4335',
  '163.com': '#e60012',
  'sina.com.cn': '#e60012',
  'tmall.com': '#ff0036',
  'pinduoduo.com': '#e02e24',
  'douyu.com': '#ff5d23',
  'huya.com': '#fbb040',
  'twitch.tv': '#9146ff',
  'spotify.com': '#1db954',
  'telegram.org': '#0088cc',
  'whatsapp.com': '#25d366',
  'vuejs.org': '#42b883',
  'reactjs.org': '#61dafb',
  'nodejs.org': '#339933',
  'python.org': '#3776ab',
};

// 未知站点的回退色板（12 色，哈希取模）
const FALLBACK_COLORS = [
  '#5b8def', '#e85d75', '#f0a04b', '#5cb85c',
  '#9b59b6', '#1abc9c', '#e74c3c', '#3498db',
  '#f39c12', '#2ecc71', '#e67e22', '#34495e',
];

function brandColor(domain) {
  return BRAND_COLORS[domain] ?? FALLBACK_COLORS[hashDomain(domain) % FALLBACK_COLORS.length];
}

function hashDomain(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = (hash * 31 + domain.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// 内存缓存：同一域名只生成一次 SVG data URL。
const urlCache = new Map();

/**
 * 返回内联 SVG data URL 字符串，直接用作 CSS background-image。
 * SVG = 圆角方块（品牌色）+ 居中白色首字母。
 */
export function siteIconUrl(domain) {
  if (urlCache.has(domain)) return urlCache.get(domain);

  const color = brandColor(domain);
  const letter = domain.charAt(0).toUpperCase();
  // 单引号属性避免转义；# 编码为 %23（data URL 要求）
  const safeColor = color.replace('#', '%23');
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'>` +
    `<rect width='24' height='24' rx='6' fill='${safeColor}'/>` +
    `<text x='12' y='17' text-anchor='middle' font-family='system-ui,sans-serif' font-size='14' font-weight='600' fill='white'>${letter}</text>` +
    `</svg>`;
  const url = `url("data:image/svg+xml,${svg}")`;
  urlCache.set(domain, url);
  return url;
}
