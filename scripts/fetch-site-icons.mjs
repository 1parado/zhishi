#!/usr/bin/env node
/**
 * 抓取常用站点的真实品牌 logo SVG，清洗压缩后内联为 data URI，生成 src/lib/site-svgs.js。
 *
 * 来源（互补）：
 *  1) Simple Icons —— 单 path 矢量 + 权威品牌色，24×24 方形，一致性最好（主源）。
 *  2) thesvg.org —— 真实多色品牌 logo，补 Simple Icons 缺失的常见站点。
 *     仅收接近方形的（宽高比 0.8~1.25），宽幅 wordmark 在 16×16 强制尺寸下会压扁变形，跳过。
 *
 * 设计目标：运行时零网络、零异步请求（同步 CSS background，无打开闪烁）。
 *
 * 用法：node scripts/fetch-site-icons.mjs
 * 需联网（仅开发期执行一次；产物随扩展打包）。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const CDN = 'https://cdn.simpleicons.org';
const THESVG = 'https://thesvg.org';
const UA = 'Mozilla/5.0 (compatible; zhishi-extension-build/1.0)';

// 接近方形才算合格（强制 16×16 background-size 下不变形）。
const ASPECT_MIN = 0.8;
const ASPECT_MAX = 1.25;

/**
 * 域名 → 图标来源配置。
 *  - si:     Simple Icons slug 候选（按优先级）
 *  - thesvg: thesvg.org slug（default.svg 变体）
 * 主源 Simple Icons 未命中且配置了 thesvg 时回退到 thesvg。
 */
const DOMAINS = {
  // ===== Simple Icons（主源，单 path + 品牌色） =====
  'bilibili.com': { si: ['bilibili'] },
  'github.com': { si: ['github'] },
  'google.com': { si: ['google'] },
  'youtube.com': { si: ['youtube'] },
  'zhihu.com': { si: ['zhihu'] },
  'stackoverflow.com': { si: ['stackoverflow'] },
  'linux.do': { si: ['linuxdo', 'linux'] },
  'twitter.com': { si: ['twitter', 'x'] },
  'x.com': { si: ['x', 'twitter'] },
  'reddit.com': { si: ['reddit'] },
  'wikipedia.org': { si: ['wikipedia'] },
  'baidu.com': { si: ['baidu'] },
  'weibo.com': { si: ['sinaweibo', 'weibo', 'sina'] },
  'taobao.com': { si: ['taobao'] },
  'jd.com': { si: ['jd', 'jingdong'] },
  'douyin.com': { si: ['douyin', 'tiktok'] },
  'iqiyi.com': { si: ['iqiyi'] },
  'netflix.com': { si: ['netflix'] },
  'amazon.com': { si: ['amazon'] },
  'apple.com': { si: ['apple'] },
  'notion.so': { si: ['notion'] },
  'yuque.com': { si: ['yuque'] },
  'csdn.net': { si: ['csdn'] },
  'juejin.cn': { si: ['juejin'] },
  'medium.com': { si: ['medium'] },
  'facebook.com': { si: ['facebook'] },
  'instagram.com': { si: ['instagram'] },
  'qq.com': { si: ['tencentqq', 'qq'] },
  'discord.com': { si: ['discord'] },
  'figma.com': { si: ['figma'] },
  'notion.site': { si: ['notion'] },
  'gmail.com': { si: ['gmail'] },
  '163.com': { si: ['netease'] },
  'sina.com.cn': { si: ['sina', 'sinaweibo'] },
  'tmall.com': { si: ['tmall'] },
  'pinduoduo.com': { si: ['pinduoduo'] },
  'douyu.com': { si: ['douyu'] },
  'huya.com': { si: ['huya'] },
  'twitch.tv': { si: ['twitch'] },
  'spotify.com': { si: ['spotify'] },
  'telegram.org': { si: ['telegram'] },
  'whatsapp.com': { si: ['whatsapp'] },
  'vuejs.org': { si: ['vuedotjs', 'vue'] },
  'reactjs.org': { si: ['react', 'reactdotjs'] },
  'nodejs.org': { si: ['nodedotjs', 'node'] },
  'python.org': { si: ['python'] },

  // ===== thesvg.org（真实多色 logo，补 Simple Icons 缺失） =====
  'microsoft.com': { thesvg: 'microsoft' },
  'linkedin.com': { thesvg: 'linkedin' },
  'slack.com': { thesvg: 'slack' },
  'tencent.com': { thesvg: 'tencent' },
  'stripe.com': { thesvg: 'stripe' },
  'airbnb.com': { thesvg: 'airbnb' },
  'dropbox.com': { thesvg: 'dropbox' },
  'shopify.com': { thesvg: 'shopify' },
  'zoom.us': { thesvg: 'zoom' },
  'canva.com': { thesvg: 'canva' },
  'adobe.com': { thesvg: 'adobe' },
  'gitlab.com': { thesvg: 'gitlab' },
  'atlassian.com': { thesvg: 'atlassian' },
  'trello.com': { thesvg: 'trello' },
  'asana.com': { thesvg: 'asana' },
  'salesforce.com': { thesvg: 'salesforce' },
  'hubspot.com': { thesvg: 'hubspot' },
  'vercel.com': { thesvg: 'vercel' },
  'netlify.com': { thesvg: 'netlify' },
  'cloudflare.com': { thesvg: 'cloudflare' },
  'digitalocean.com': { thesvg: 'digitalocean' },
  'docker.com': { thesvg: 'docker' },
  'kubernetes.io': { thesvg: 'kubernetes' },
  'redis.io': { thesvg: 'redis' },
  'mongodb.com': { thesvg: 'mongodb' },
  'supabase.com': { thesvg: 'supabase' },
  'openai.com': { thesvg: 'openai' },
  'anthropic.com': { thesvg: 'anthropic' },
  'claude.ai': { thesvg: 'claude' },
  'brave.com': { thesvg: 'brave' },
  'mozilla.org': { thesvg: 'mozilla' },
  'firefox.com': { thesvg: 'firefox' },
  'paypal.com': { thesvg: 'paypal' },
  'ebay.com': { thesvg: 'ebay' },
  'etsy.com': { thesvg: 'etsy' },
  'walmart.com': { thesvg: 'walmart' },
  'uber.com': { thesvg: 'uber' },
  'tripadvisor.com': { thesvg: 'tripadvisor' },
  'pinterest.com': { thesvg: 'pinterest' },
  'tumblr.com': { thesvg: 'tumblr' },
  'snapchat.com': { thesvg: 'snapchat' },
  'disneyplus.com': { thesvg: 'disney-plus' },
  'hulu.com': { thesvg: 'hulu' },
  'roblox.com': { thesvg: 'roblox' },
  'playstation.com': { thesvg: 'playstation' },
  'xbox.com': { thesvg: 'xbox' },
  'nintendo.com': { thesvg: 'nintendo' },
  'tesla.com': { thesvg: 'tesla' },
  'yandex.com': { thesvg: 'yandex' },
  'bing.com': { thesvg: 'bing' },
  'duckduckgo.com': { thesvg: 'duckduckgo' },
  'opera.com': { thesvg: 'opera' },
  'grammarly.com': { thesvg: 'grammarly' },
  'evernote.com': { thesvg: 'evernote' },
  'linear.app': { thesvg: 'linear' },
  'jetbrains.com': { thesvg: 'jetbrains' },
  'codepen.io': { thesvg: 'codepen' },
  'replit.com': { thesvg: 'replit' },
  'heroku.com': { thesvg: 'heroku' },
  'steampowered.com': { thesvg: 'steam' },
  'flickr.com': { thesvg: 'flickr' },
  'vimeo.com': { thesvg: 'vimeo' },
  'patreon.com': { thesvg: 'patreon' },
  'mercadolibre.com': { thesvg: 'mercadolibre' },
  'shopee.com': { thesvg: 'shopee' },
  'rakuten.com': { thesvg: 'rakuten' },
  'aliexpress.com': { thesvg: 'aliexpress' },
};

/** 抓取一个 Simple Icons slug 的 SVG 文本；404 等返回 null。 */
async function fetchSi(slug) {
  const res = await fetch(`${CDN}/${slug}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('svg')) return null;
  return res.text();
}

/** 从 thesvg.org 抓 /icons/{slug}/default.svg；404 等返回 null。 */
async function fetchThesvg(slug) {
  const res = await fetch(`${THESVG}/icons/${slug}/default.svg`, { headers: { 'User-Agent': UA } });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('svg')) return null;
  return res.text();
}

/** 解析 viewBox 的宽高，返回 [w, h] 或 null。 */
function viewBoxSize(svg) {
  const m = svg.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/);
  if (!m) return null;
  return [Number(m[3]), Number(m[4])];
}

/** thesvg logo 是否接近方形（强制 16×16 下不变形）。 */
function isSquareish(svg) {
  const wh = viewBoxSize(svg);
  if (!wh) return true; // 无 viewBox 时无法判定，保守收下
  const [w, h] = wh;
  if (!w || !h) return true;
  const ratio = w / h;
  return ratio >= ASPECT_MIN && ratio <= ASPECT_MAX;
}

/**
 * 清洗 + 压缩 SVG：
 * - 去掉 <title>…</title>
 * - 去掉 role="img"、width/height、preserveAspectRatio、xmlns:xlink 等冗余属性
 *   （width/height 会让 CSS background-size 渲染歧义，去掉后由 viewBox + background-size 统一控制）
 * - 折叠标签间空白
 * 保留：viewBox、fill（品牌色）、xmlns、<path>/<g>。
 */
function sanitize(svg) {
  return svg
    .replace(/<title>.*?<\/title>/gi, '')
    .replace(/\srole="img"/gi, '')
    .replace(/\s(?:width|height|preserveAspectRatio)="[^"]*"/gi, '')
    .replace(/\sxmlns:xlink="[^"]*"/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim();
}

/** 转 CSS 可用的 data URI：双引号包裹 URL → 内部属性改单引号，# 编码为 %23。 */
function toDataUri(svg) {
  const encoded = svg.replace(/"/g, "'").replace(/#/g, '%23');
  return `url("data:image/svg+xml,${encoded}")`;
}

async function main() {
  const out = {};
  const missed = [];
  let totalBytes = 0;
  let siHits = 0, tsHits = 0, tsSkipped = 0;

  for (const [domain, cfg] of Object.entries(DOMAINS)) {
    let chosen = null, source = '', svg = null;

    // 1) 主源：Simple Icons
    if (cfg.si) {
      for (const slug of cfg.si) {
        try {
          const raw = await fetchSi(slug);
          if (raw) { chosen = slug; source = 'si'; svg = sanitize(raw); break; }
        } catch (e) { /* 继续下一个候选 */ }
      }
    }

    // 2) 补充源：thesvg.org（主源未命中或未配置 si 时）
    if (!svg && cfg.thesvg) {
      try {
        const raw = await fetchThesvg(cfg.thesvg);
        if (raw) {
          if (!isSquareish(raw)) {
            // 宽幅 wordmark 在 16×16 下会变形，跳过走字母回退
            tsSkipped++;
            console.log(`  ~ ${domain.padEnd(22)} thesvg/${cfg.thesvg.padEnd(14)} 非方形，跳过`);
          } else {
            chosen = cfg.thesvg; source = 'thesvg'; svg = sanitize(raw);
          }
        }
      } catch (e) { /* 忽略 */ }
    }

    if (svg) {
      const uri = toDataUri(svg);
      out[domain] = uri;
      totalBytes += uri.length;
      if (source === 'si') siHits++; else tsHits++;
      const hex = (svg.match(/fill='([^']*)'/) || [])[1] || '';
      console.log(`  ✓ ${domain.padEnd(22)} ${source}/${chosen.padEnd(14)} ${String(svg.length).padStart(5)}B  ${hex}`);
    } else {
      missed.push(domain);
      console.log(`  ✗ ${domain.padEnd(22)} (no hit → 字母回退)`);
    }
  }

  const hit = Object.keys(out).length;
  const total = Object.keys(DOMAINS).length;
  const body = JSON.stringify(out, null, 0);
  const moduleSrc =
    `/* AUTO-GENERATED by scripts/fetch-site-icons.mjs — 请勿手改。\n` +
    ` * 常用站点真实品牌 logo SVG（Simple Icons + thesvg.org），内联 data URI。\n` +
    ` * 命中 ${hit}/${total} 个域名（Simple Icons ${siHits} + thesvg ${tsHits}；thesvg 非方形跳过 ${tsSkipped}），\n` +
    ` * 未命中者由 site-icons.js 回退为字母图标。\n` +
    ` * 运行时零网络：所有 SVG 已内联，无任何资源请求。\n` +
    ` */\n` +
    `export const SITE_SVG_URLS = ${body};\n`;

  const target = resolve(ROOT, 'src/lib/site-svgs.js');
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, moduleSrc, 'utf8');

  console.log(`\n命中 ${hit}/${total}（si ${siHits} + thesvg ${tsHits}，跳过 ${tsSkipped}）；data URI 合计 ${(totalBytes / 1024).toFixed(1)} KB`);
  console.log(`未命中（走字母回退）：${missed.length ? missed.join(', ') : '无'}`);
  console.log(`已写入 ${target}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
