/**
 * 分享卡片绘制（纯 Canvas，零依赖）。
 *
 * 三种卡片共用同一套视觉语言（参考设计稿：绿色系、白/深卡、大号纯色
 * 数值、薄荷色数据卡），并支持浅色与暗色两套调色板——theme 由调用方
 * 按当前界面主题传入（'light' | 'dark'）：
 *   年度卡 drawShareCard —— 1080×1560，年度总使用 + 统计 + 排行 + 全年热力图 + 按星期分布。
 *   日报卡 drawTrendCard(range='day')   —— 1080×1440（3:4），今日总使用 + 较昨日趋势
 *                                          + 近 7 天趋势柱状（带数值标签）+ 2×2 图标数据卡
 *                                          + Top5 排行 + 用户区。
 *   周报卡 drawTrendCard(range='week')  —— 同版面，近 7 天总使用 + 较上个 7 天趋势。
 *
 * 版面层次（自上而下）：Hero 大数字（视觉焦点）→ 迷你走势 → 次要数据
 * → 站点排行 → 头像 + 昵称（归属感）→ 品牌页脚。
 */

import {
  dateKey,
  mergeByRoot,
  shiftDateKey,
  streakDays,
  sumSeconds,
  usageLevel,
  weekSeries,
} from './pure.js';
import { fmtDurationCompact } from './i18n.js';

const W = 1080;
const H = 1560; // 年度卡画布高
const TH = 1440; // 日报 / 周报画布高（3:4）
const CARD_R = 32;
const X = 112; // 内容左缘
const RIGHT = W - 112; // 内容右缘
const INNER_W = RIGHT - X;
const P_PAD = 28; // 面板内边距
const PX = X + P_PAD; // 面板内容左缘
const PR = RIGHT - P_PAD; // 面板内容右缘
const HEAD_Y = 100; // 品牌头顶

const FONT = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

/* ---------- 主题调色板（浅 / 暗） ---------- */

// 热力档：无 / 绿 / 黄 / 橙 / 红（与 heat-cell 一致；暗色下空档用深灰绿）。
const HEAT_LIGHT = ['#edf0f5', '#3cae66', '#f4a72e', '#f78a50', '#ef5350'];
const HEAT_DARK = ['#202824', '#35b56f', '#e5a437', '#ef8a50', '#f2635a'];

const PALETTES = {
  light: {
    dark: false,
    bgTop: '#f6f9f7',
    bgBottom: '#eff3f1',
    glow1: 'rgba(14, 138, 104, 0.10)',
    glow2: 'rgba(18, 169, 126, 0.08)',
    card: '#ffffff',
    cardBorder: '#e6ece8',
    fg: '#131a16',
    muted: '#66736d',
    faint: '#93a09a',
    accent: '#0e8a68', // 主绿：徽章 / 今日柱 / 排名徽章 / 趋势下降
    soft: '#dff0e8', // 浅薄荷：过去柱 / 用户胶囊底
    softer: '#eef6f1', // 统计卡底
    track: '#e4ece7',
    panel: '#f2f7f4',
    panelBorder: '#e7eee9',
    border: '#e4ebe7',
    barFrom: '#0b6b51',
    barTo: '#2fae85',
    warn: '#c47417', // 趋势上升
    badgeBg: '#0e8a68',
    badgeFg: '#ffffff',
    rankFg: '#ffffff',
    avatarBg: '#0e8a68',
    avatarFg: '#ffffff',
    pillBg: '#dff0e8',
    heat: HEAT_LIGHT,
  },
  dark: {
    dark: true,
    bgTop: '#0c0f0e',
    bgBottom: '#0c0f0e',
    glow1: 'rgba(62, 220, 152, 0.06)',
    glow2: 'rgba(62, 220, 152, 0.04)',
    card: '#141917',
    cardBorder: 'rgba(255, 255, 255, 0.08)',
    fg: '#f2f6f4',
    muted: '#9daba4',
    faint: '#6d7a74',
    accent: '#3edc98',
    soft: '#1d4a38',
    softer: '#1b221f',
    track: '#252d29',
    panel: '#191f1c',
    panelBorder: 'rgba(255, 255, 255, 0.06)',
    border: 'rgba(255, 255, 255, 0.08)',
    barFrom: '#2fd48e',
    barTo: '#8af0c4',
    warn: '#f2b24c',
    badgeBg: '#153428',
    badgeFg: '#3edc98',
    rankFg: '#0b0e0d',
    avatarBg: '#3edc98',
    avatarFg: '#0b0e0d',
    pillBg: '#153428',
    heat: HEAT_DARK,
  },
};

export function cardPalette(theme) {
  return theme === 'dark' ? PALETTES.dark : PALETTES.light;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    // 兜底：老内核无 roundRect 时退化为直角
    ctx.rect(x, y, w, h);
  }
}

function fillRR(ctx, x, y, w, h, r, fill) {
  ctx.fillStyle = fill;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
}

function text(ctx, str, x, y, { size = 24, weight = 400, color, align = 'left', fill = null } = {}) {
  ctx.fillStyle = fill || color;
  ctx.textAlign = align;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillText(str, x, y);
  return ctx.measureText(str).width;
}

/** 按最大宽度截断字符串（带省略号）。调用前先把 ctx.font 设为目标字号。 */
function ellipsize(ctx, str, maxWidth) {
  if (ctx.measureText(str).width <= maxWidth) return str;
  let s = str;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

/** 绿色渐变（排行条 / 柱状通用）：深绿 → 亮绿。 */
function barGrad(ctx, x0, x1dot, P) {
  const g = ctx.createLinearGradient(x0, 0, x1dot, 0);
  g.addColorStop(0, P.barFrom);
  g.addColorStop(1, P.barTo);
  return g;
}

function fmtHours(seconds, hourShort) {
  const h = seconds / 3600;
  if (h >= 100) return `${Math.round(h)} ${hourShort}`;
  if (h >= 10) return `${h.toFixed(1)} ${hourShort}`;
  return fmtDurationCompact(Math.round(seconds));
}

/** 某天日期键 → '2026.10.01' 形式的短日期。 */
const dotDate = (key) => key.replaceAll('-', '.');

/* ---------- 简单线条图标（绿色，参考稿统计卡同款） ---------- */

function iconClock(ctx, cx, cy, s, color) {
  const r = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.55);
  ctx.lineTo(cx, cy + r * 0.08);
  ctx.lineTo(cx + r * 0.42, cy + r * 0.26);
  ctx.stroke();
}

function iconGlobe(ctx, cx, cy, s, color) {
  const r = s / 2;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.09;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy, r * 0.45, r, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.stroke();
}

function iconStar(ctx, cx, cy, s, color) {
  const r = s / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const aOut = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    const aIn = aOut + Math.PI / 5;
    const px = cx + Math.cos(aOut) * r;
    const py = cy + Math.sin(aOut) * r;
    const qx = cx + Math.cos(aIn) * r * 0.44;
    const qy = cy + Math.sin(aIn) * r * 0.44;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
    ctx.lineTo(qx, qy);
  }
  ctx.closePath();
  ctx.fill();
}

function iconCalendar(ctx, cx, cy, s, color) {
  const w = s * 0.86;
  const h = s * 0.78;
  const x = cx - w / 2;
  const y = cy - h / 2 + s * 0.06;
  ctx.strokeStyle = color;
  ctx.lineWidth = s * 0.085;
  ctx.lineCap = 'round';
  rr(ctx, x, y, w, h, s * 0.14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.3);
  ctx.lineTo(x + w, y + h * 0.3);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.22, y - s * 0.1);
  ctx.lineTo(cx - w * 0.22, y + s * 0.06);
  ctx.moveTo(cx + w * 0.22, y - s * 0.1);
  ctx.lineTo(cx + w * 0.22, y + s * 0.06);
  ctx.stroke();
  ctx.fillStyle = color;
  for (const dx of [-w * 0.22, 0, w * 0.22]) {
    ctx.beginPath();
    ctx.arc(cx + dx, y + h * 0.62, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
  }
}

const STAT_ICONS = {
  clock: iconClock,
  globe: iconGlobe,
  star: iconStar,
  calendar: iconCalendar,
};

/* ---------- 统计聚合（导出供测试） ---------- */

/** { domain: 秒 } → 去零降序的 [domain, seconds][]；byRoot 时先按根域名合并。 */
function siteRank(flat, byRoot) {
  return Object.entries(byRoot ? mergeByRoot(flat) : flat)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1]);
}

/** 今日卡数据：今日总量、昨日总量、今日 Top5、站点数、连续记录、近 7 天序列。 */
export function dayCardStats(days, todayKey, byRoot = false) {
  const today = days?.[todayKey] || {};
  const sites = siteRank(today, byRoot);
  const week = weekSeries(days || {}, todayKey, 7);
  return {
    total: sumSeconds(today),
    prevTotal: sumSeconds(days?.[shiftDateKey(todayKey, -1)]),
    topSites: sites.slice(0, 5),
    siteCount: sites.length,
    streak: streakDays(days || {}, todayKey),
    week,
    weekTotal: week.reduce((acc, d) => acc + d.seconds, 0),
  };
}

/** 周报卡数据：近 7 天总量、上个 7 天总量、Top5、站点数、连续记录、最活跃一天。 */
export function weekCardStats(days, todayKey, byRoot = false) {
  const week = weekSeries(days || {}, todayKey, 7);
  const perSite = new Map();
  for (const day of week) {
    for (const [domain, seconds] of Object.entries(days?.[day.key] || {})) {
      perSite.set(domain, (perSite.get(domain) || 0) + seconds);
    }
  }
  const active = siteRank(Object.fromEntries(perSite), byRoot);
  const peak = week.reduce((m, d) => (d.seconds > (m?.seconds ?? -1) ? d : m), null);
  return {
    total: week.reduce((acc, d) => acc + d.seconds, 0),
    prevTotal: weekSeries(days || {}, shiftDateKey(todayKey, -7), 7).reduce(
      (acc, d) => acc + d.seconds,
      0
    ),
    topSites: active.slice(0, 5),
    siteCount: active.length,
    streak: streakDays(days || {}, todayKey),
    week,
    peak: peak?.seconds > 0 ? peak : null,
  };
}

/* ---------- 共享绘制原语 ---------- */

/**
 * 卡片底版：背景渐变 + 光晕 → 白/深卡 → 品牌头（圆形时钟 + 品牌名 +
 * 徽章胶囊 + 右侧日期）。cardH 决定画布高，调用前先设好画布尺寸。
 */
function drawChrome(ctx, strings, badgeText, dateText, cardH, P) {
  const bg = ctx.createLinearGradient(0, 0, W, cardH);
  bg.addColorStop(0, P.bgTop);
  bg.addColorStop(1, P.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, cardH);
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, cardH);
  };
  glow(150, 110, 440, P.glow1);
  glow(950, cardH - 110, 480, P.glow2);

  /* 白 / 深卡片 + 柔和阴影 */
  const card = { x: 48, y: 48, w: W - 96, h: cardH - 96 };
  ctx.save();
  ctx.shadowColor = P.dark ? 'rgba(0, 0, 0, 0.5)' : 'rgba(15, 23, 42, 0.10)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = P.card;
  rr(ctx, card.x, card.y, card.w, card.h, CARD_R);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = P.cardBorder;
  ctx.lineWidth = 1;
  rr(ctx, card.x, card.y, card.w, card.h, CARD_R);
  ctx.stroke();

  /* 品牌头：圆形时钟图标 + 品牌名 + 徽章胶囊 + 右侧日期 */
  const iconC = { x: X + 26, y: HEAD_Y + 26 };
  iconClock(ctx, iconC.x, iconC.y, 52, P.accent);
  const brandW = text(ctx, strings.brand, X + 66, HEAD_Y + 38, { size: 44, weight: 700, color: P.fg });

  // 徽章：紧随品牌名之后，按文案实测宽度画胶囊
  ctx.font = `600 22px ${FONT}`;
  const badgeW = ctx.measureText(badgeText).width + 40;
  const badgeX = X + 66 + brandW + 22;
  fillRR(ctx, badgeX, HEAD_Y + 6, badgeW, 44, 22, P.badgeBg);
  text(ctx, badgeText, badgeX + badgeW / 2, HEAD_Y + 36, {
    size: 22,
    weight: 600,
    color: P.badgeFg,
    align: 'center',
  });

  text(ctx, dateText, RIGHT, HEAD_Y + 38, { size: 24, color: P.muted, align: 'right' });
}

/** 面板底：圆角矩形（浅色下为浅灰绿，暗色下为深色卡）。 */
function drawPanel(ctx, p, P) {
  fillRR(ctx, X, p.y, INNER_W, p.h, 22, P.panel);
  ctx.strokeStyle = P.panelBorder;
  ctx.lineWidth = 1;
  rr(ctx, X, p.y, INNER_W, p.h, 22);
  ctx.stroke();
}

/**
 * 站点排行行：绿色排名徽章 + 域名 + 绿色渐变进度条 + 时长。
 * 年度卡（pitch 52）与日报周报卡（pitch 46）共用，尺寸经参数收缩。
 */
function drawRankRows(
  ctx,
  sites,
  { x0, y0, x1, pitch },
  P,
  {
    nameSize = 22,
    badgeR = 14,
    barH = 10,
    valSize = 20,
    numSize = 16,
    nameMax = 360,
    valGap = 130,
    emptyText = '',
  } = {}
) {
  const barX = x0 + 40 + nameMax;
  const barEnd = x1 - valGap - 14;
  const barW = barEnd - barX;
  if (!sites.length) {
    if (emptyText) text(ctx, emptyText, x0, y0 + 20, { size: 21, color: P.faint });
    return;
  }
  sites.forEach(([domain, seconds], i) => {
    const y = y0 + i * pitch;
    // 全部绿色实心徽章（参考稿样式）
    ctx.fillStyle = P.accent;
    ctx.beginPath();
    ctx.arc(x0 + badgeR, y - 5, badgeR, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, String(i + 1), x0 + badgeR, y + 1, {
      size: numSize,
      weight: 700,
      color: P.rankFg,
      align: 'center',
    });
    ctx.font = `400 ${nameSize}px ${FONT}`;
    const name = ellipsize(ctx, domain, nameMax);
    text(ctx, name, x0 + 40, y, { size: nameSize, color: P.fg });
    const ratio = seconds / (sites[0][1] || 1);
    fillRR(ctx, barX, y - barH / 2, barW, barH, barH / 2, P.track);
    fillRR(ctx, barX, y - barH / 2, Math.max(barW * ratio, 16), barH, barH / 2, barGrad(ctx, barX, barX + barW, P));
    text(ctx, fmtDurationCompact(Math.round(seconds)), x1, y, {
      size: valSize,
      color: P.muted,
      align: 'right',
    });
  });
}

/** 页脚：分隔线 + 品牌信息 + 生成日期。 */
function drawFooter(ctx, strings, footY, todayKey, P) {
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X, footY - 40);
  ctx.lineTo(RIGHT, footY - 40);
  ctx.stroke();
  text(ctx, `${strings.brand} · ${strings.tagline}`, X, footY, { size: 19, color: P.muted });
  text(ctx, strings.generated.replace('{date}', dotDate(todayKey)), RIGHT, footY, {
    size: 19,
    color: P.faint,
    align: 'right',
  });
}

/** 用户区：头像（照片圆形裁剪 / 绿底首字母）+ 昵称 + 连续记录胶囊。 */
async function drawProfileRow(ctx, y, profile, strings, chipText, P) {
  const S = 64;
  const cx = X + S / 2;
  const cy = y + S / 2;
  let drew = false;
  if (profile.avatar) {
    try {
      const img = await loadImage(profile.avatar);
      const side = Math.min(img.width, img.height);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, S / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        cx - S / 2,
        cy - S / 2,
        S,
        S
      );
      ctx.restore();
      drew = true;
    } catch {
      // 头像不可用：回退到首字母头像
    }
  }
  if (!drew) {
    ctx.fillStyle = P.avatarBg;
    ctx.beginPath();
    ctx.arc(cx, cy, S / 2, 0, Math.PI * 2);
    ctx.fill();
    const letter = (profile.name || strings.brand).trim().charAt(0).toUpperCase();
    text(ctx, letter, cx, cy + 11, { size: 30, weight: 700, color: P.avatarFg, align: 'center' });
  }

  if (profile.name) {
    ctx.font = `700 34px ${FONT}`;
    const name = ellipsize(ctx, profile.name, 380);
    text(ctx, name, X + S + 22, cy + 12, { size: 34, weight: 700, color: P.fg });
  }
  if (chipText) {
    ctx.font = `600 22px ${FONT}`;
    const cw = ctx.measureText(chipText).width + 40;
    fillRR(ctx, RIGHT - cw, cy - 22, cw, 44, 22, P.pillBg);
    text(ctx, chipText, RIGHT - cw / 2, cy + 8, {
      size: 22,
      weight: 600,
      color: P.accent,
      align: 'center',
    });
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/* ---------- 年度卡 ---------- */

/**
 * 在传入 canvas 上绘制年度分享卡片并返回 canvas。
 * strings：界面文案（由调用方用 i18n 组装）；P：cardPalette(theme)。
 */
export function drawShareCard(canvas, days, todayKey, strings, P = PALETTES.light, byRoot = false) {
  const year = todayKey.slice(0, 4);
  const { perDay, total, activeDays, peak, topSites } = aggregate(days, year, byRoot);
  const dailyAvg = activeDays > 0 ? total / activeDays : 0;

  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';

  drawChrome(ctx, strings, strings.report.replace('{year}', year), dotDate(todayKey), H, P);

  /* Hero 面板：年度总使用大字 */
  const HERO = { y: 214, h: 204 };
  fillRR(ctx, X, HERO.y, INNER_W, HERO.h, 24, P.dark ? P.panel : P.softer);
  ctx.strokeStyle = P.panelBorder;
  ctx.lineWidth = 1;
  rr(ctx, X, HERO.y, INNER_W, HERO.h, 24);
  ctx.stroke();

  text(ctx, strings.totalLabel, PX, HERO.y + 46, { size: 20, color: P.muted });
  text(ctx, fmtHours(total, strings.hourShort), PX, HERO.y + 132, { size: 80, weight: 800, color: P.fg });
  const range = perDay.length
    ? `${dotDate(perDay[0][0])} – ${dotDate(perDay[perDay.length - 1][0])}`
    : year;
  text(ctx, `${range} · ${strings.activeDaysN.replace('{n}', activeDays)}`, RIGHT - P_PAD, HERO.y + 132, {
    size: 21,
    color: P.muted,
    align: 'right',
  });

  /* 统计行：日均 / 最高单日 / 最常访问 */
  const STATS_Y = 486;
  ctx.font = `700 34px ${FONT}`;
  const stats = [
    { label: strings.dailyAvg, value: fmtHours(dailyAvg, strings.hourShort) },
    { label: strings.peakDay, value: peak ? fmtHours(peak[1], strings.hourShort) : '0' },
    {
      label: strings.topSite,
      value: topSites.length ? ellipsize(ctx, topSites[0][0], 190) : '—',
    },
  ];
  const colW = INNER_W / stats.length;
  stats.forEach(({ label, value }, i) => {
    const x = X + i * colW;
    text(ctx, value, x, STATS_Y, { size: 34, weight: 700, color: P.fg });
    text(ctx, label, x, STATS_Y + 34, { size: 18, color: P.muted });
    if (i > 0) {
      ctx.strokeStyle = P.border;
      ctx.beginPath();
      ctx.moveTo(x - colW / 2, STATS_Y - 30);
      ctx.lineTo(x - colW / 2, STATS_Y + 30);
      ctx.stroke();
    }
  });

  /* 面板 A：站点排行 Top 5 */
  const PANEL_A = { y: 560, h: 380 };
  drawPanel(ctx, PANEL_A, P);
  text(ctx, strings.sitesTitle, PX, PANEL_A.y + 44, { size: 24, weight: 700, color: P.fg });
  drawRankRows(ctx, topSites, { x0: PX, y0: PANEL_A.y + 96, x1: PR, pitch: 52 }, P, {
    emptyText: strings.empty,
  });

  /* 面板 B：全年热力图 */
  const PANEL_B = { y: 964, h: 224 };
  drawPanel(ctx, PANEL_B, P);
  const heatHeadY = PANEL_B.y + 44;
  const cell = 11;
  const pitch = cell + 4;
  text(ctx, strings.heatTitle, PX, heatHeadY, { size: 24, weight: 700, color: P.fg });
  // 图例（右对齐：少 ▢▢▢▢▢ 多）
  let lx = RIGHT - P_PAD - (5 * 16 + 58);
  text(ctx, strings.less, lx, heatHeadY, { size: 17, color: P.faint });
  lx += 26;
  for (let i = 0; i < 5; i++) {
    fillRR(ctx, lx, heatHeadY - 12, 12, 12, 3, P.heat[i]);
    lx += 16;
  }
  text(ctx, strings.more, lx + 4, heatHeadY, { size: 17, color: P.faint });

  const gridY = heatHeadY + 26;
  const secByDay = new Map(perDay);
  const firstMonday = firstMondayOf(year);
  const lastSunday = lastSundayOf(year);
  for (let d = new Date(firstMonday); d <= lastSunday; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    if (d.getFullYear() !== Number(year) || key > todayKey) continue;
    const col = Math.floor((d - firstMonday) / 86400000 / 7);
    const row = (d.getDay() + 6) % 7;
    fillRR(ctx, PX + col * pitch, gridY + row * pitch, cell, cell, 2.5, P.heat[usageLevel(secByDay.get(key) || 0)]);
  }

  /* 面板 C：按星期分布（周一..周日，各星期平均使用时长） */
  const PANEL_C = { y: 1212, h: 172 };
  drawPanel(ctx, PANEL_C, P);
  text(ctx, strings.byWeekday, PX, PANEL_C.y + 44, { size: 24, weight: 700, color: P.fg });
  const colW7 = (PR - PX) / 7;
  const dayCount = {};
  const daySum = {};
  {
    const end = dateKeyToLocal(todayKey);
    for (let d = new Date(Number(year), 0, 1); d <= end; d.setDate(d.getDate() + 1)) {
      const wd = (d.getDay() + 6) % 7; // 周一 = 0
      dayCount[wd] = (dayCount[wd] || 0) + 1;
    }
  }
  for (const [key, seconds] of secByDay) {
    const wd = (dateKeyToLocal(key).getDay() + 6) % 7;
    daySum[wd] = (daySum[wd] || 0) + seconds;
  }
  const weekdayAvgs = Array.from({ length: 7 }, (_, wd) =>
    dayCount[wd] ? (daySum[wd] || 0) / dayCount[wd] : 0
  );
  const maxAvg = Math.max(...weekdayAvgs, 1);
  const barBase = PANEL_C.y + PANEL_C.h - 46;
  weekdayAvgs.forEach((avg, wd) => {
    const cx = PX + colW7 * wd + colW7 / 2;
    const bh = Math.max((avg / maxAvg) * 56, 5);
    fillRR(ctx, cx - 15, barBase - bh, 30, bh, 7, barGrad(ctx, cx - 15, cx + 15, P));
    text(ctx, strings.weekLabels[wd], cx, barBase + 26, {
      size: 17,
      color: P.muted,
      align: 'center',
    });
  });

  drawFooter(ctx, strings, H - 100, todayKey, P);
  return canvas;
}

function aggregate(days, year, byRoot = false) {
  const perDay = new Map();
  const perSite = new Map();
  for (const [key, sites] of Object.entries(days || {})) {
    if (!key.startsWith(year)) continue;
    let dayTotal = 0;
    for (const [domain, seconds] of Object.entries(sites)) {
      dayTotal += seconds;
      perSite.set(domain, (perSite.get(domain) || 0) + seconds);
    }
    perDay.set(key, dayTotal);
  }
  const daysArr = [...perDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const total = daysArr.reduce((acc, [, s]) => acc + s, 0);
  const activeDays = daysArr.filter(([, s]) => s > 0).length;
  const peak = daysArr.reduce((m, [k, s]) => (s > (m?.[1] ?? -1) ? [k, s] : m), null);
  const topSites = siteRank(Object.fromEntries(perSite), byRoot).slice(0, 5);
  return { perDay: daysArr, total, activeDays, peak, topSites };
}

function firstMondayOf(year) {
  const start = new Date(year, 0, 1);
  return new Date(year, 0, 1 - ((start.getDay() + 6) % 7));
}

/** 'YYYY-MM-DD' → 本地时区 Date（dateKey 的逆操作）。 */
function dateKeyToLocal(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function lastSundayOf(year) {
  const end = new Date(year, 11, 31);
  return new Date(year, 11, 31 + (6 - ((end.getDay() + 6) % 7)));
}

/* ---------- 日报 / 周报卡（3:4） ---------- */

// 版面常量（自上而下）：Hero → 迷你 7 天趋势 → 2×2 图标数据卡 → 排行 → 用户区 → 页脚
const T_HERO_LABEL = 232;
const T_HERO_VALUE = 332;
const T_TREND = 386;
const T_CHART = { y: 444, h: 248 }; // 暗色下的趋势图面板（浅色仅画内容）
const T_CHART_TITLE = 488;
const T_CHART_BASE = 640;
const T_CHART_LABEL = 674;
const T_STATS = { y: 712, cellH: 96, gap: 16 };
const T_RANK_TITLE = 972;
const T_RANK_ROWS = 1018;
const T_RANK_PITCH = 46;
const T_PROFILE_Y = 1242;
const T_FOOT_Y = 1360;

/**
 * 在传入 canvas 上绘制日报（range='day'）或周报卡（range='week'）。
 * profile：{ name, avatar, show }（settings.profile），无昵称无头像时省略用户区。
 */
export async function drawTrendCard(canvas, { days, todayKey, range, strings, profile = null, theme = 'light', byRoot = false }) {
  const isWeek = range === 'week';
  const stats = isWeek ? weekCardStats(days, todayKey, byRoot) : dayCardStats(days, todayKey, byRoot);
  const hour = strings.hourShort;
  const P = cardPalette(theme);

  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = TH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';

  const weekdayOf = (key) => strings.weekLabels[(dateKeyToLocal(key).getDay() + 6) % 7];
  const headerDate = isWeek
    ? `${dotDate(stats.week[0].key)} – ${dotDate(stats.week[stats.week.length - 1].key)}`
    : `${dotDate(todayKey)} ${weekdayOf(todayKey)}`;
  drawChrome(ctx, strings, isWeek ? strings.badgeWeek : strings.badgeDay, headerDate, TH, P);

  /* Hero：总使用大字 + 环比趋势（上升橙 / 下降绿 / 持平灰） */
  text(ctx, isWeek ? strings.weekTotal : strings.todayTotal, X, T_HERO_LABEL, {
    size: 20,
    color: P.muted,
  });
  text(ctx, fmtHours(stats.total, hour), X, T_HERO_VALUE, { size: 96, weight: 800, color: P.fg });

  if (stats.prevTotal > 0) {
    const label = isWeek ? strings.vsPrev7 : strings.vsYesterday;
    const pct = Math.round(((stats.total - stats.prevTotal) / stats.prevTotal) * 100);
    let trendText;
    let trendColor;
    if (pct > 0) {
      trendText = `↑ ${label} ↑${pct}%`;
      trendColor = P.warn;
    } else if (pct < 0) {
      trendText = `↓ ${label} ↓${Math.abs(pct)}%`;
      trendColor = P.accent;
    } else {
      trendText = `${label} · ${strings.flat}`;
      trendColor = P.muted;
    }
    text(ctx, trendText, X, T_TREND, { size: 30, weight: 600, color: trendColor });
  }

  /* 近 7 天趋势：柱顶数值标签 + 底部基线（暗色下加面板底） */
  if (P.dark) drawPanel(ctx, T_CHART, P);
  text(ctx, strings.miniTitle, X, T_CHART_TITLE, { size: 26, weight: 700, color: P.fg });
  const maxSec = Math.max(...stats.week.map((d) => d.seconds), 1);
  const colW = (PR - PX) / 7;
  stats.week.forEach((day, i) => {
    const cx = PX + colW * i + colW / 2;
    const bh = Math.max((day.seconds / maxSec) * 118, 5);
    const top = T_CHART_BASE - bh;
    const isToday = day.key === todayKey;
    text(ctx, fmtDurationCompact(Math.round(day.seconds)), cx, top - 12, {
      size: 19,
      weight: isToday ? 700 : 400,
      color: isToday ? P.accent : P.muted,
      align: 'center',
    });
    // 柱色：日报只高亮今天（其余浅色）；周报整周都是主绿。
    fillRR(ctx, cx - 20, top, 40, bh, 9, !isWeek && !isToday ? P.soft : P.accent);
    text(ctx, weekdayOf(day.key), cx, T_CHART_LABEL, {
      size: 19,
      weight: isToday ? 600 : 400,
      color: isToday ? P.accent : P.muted,
      align: 'center',
    });
  });
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(PX, T_CHART_BASE + 1);
  ctx.lineTo(PR, T_CHART_BASE + 1);
  ctx.stroke();

  /* 2×2 图标数据卡：日均 / 访问网站 / 最常访问 + 连续记录（日报）或最活跃一天（周报） */
  const cells = isWeek
    ? [
        { icon: 'clock', label: strings.dailyAvg, value: fmtHours(stats.total / 7, hour) },
        {
          icon: 'calendar',
          label: `${strings.busiestDay} · ${stats.peak ? weekdayOf(stats.peak.key) : '—'}`,
          value: stats.peak ? fmtHours(stats.peak.seconds, hour) : '0',
        },
        { icon: 'globe', label: strings.activeSites, value: String(stats.siteCount) },
        { icon: 'star', label: strings.topSite, value: stats.topSites[0]?.[0] ?? '—' },
      ]
    : [
        { icon: 'clock', label: strings.dailyAvg, value: fmtHours(stats.weekTotal / 7, hour) },
        { icon: 'globe', label: strings.activeSites, value: String(stats.siteCount) },
        { icon: 'star', label: strings.topSite, value: stats.topSites[0]?.[0] ?? '—' },
        {
          icon: 'calendar',
          label: strings.streak,
          value: strings.streakDays.replace('{n}', stats.streak),
        },
      ];
  const cellW = (INNER_W - T_STATS.gap) / 2;
  cells.forEach(({ icon, label, value }, i) => {
    const cx = X + (i % 2) * (cellW + T_STATS.gap);
    const cy = T_STATS.y + Math.floor(i / 2) * (T_STATS.cellH + T_STATS.gap);
    fillRR(ctx, cx, cy, cellW, T_STATS.cellH, 18, P.softer);
    STAT_ICONS[icon](ctx, cx + 46, cy + T_STATS.cellH / 2, 40, P.accent);
    ctx.font = `700 32px ${FONT}`;
    const val = label === strings.topSite ? ellipsize(ctx, value, cellW - 88 - 24) : value;
    text(ctx, val, cx + 88, cy + 44, { size: 32, weight: 700, color: P.fg });
    text(ctx, label, cx + 88, cy + 76, { size: 17, color: P.muted });
  });

  /* 站点排行 Top 5（无面板，直接排在卡面上） */
  text(ctx, strings.sitesTitle, X, T_RANK_TITLE, { size: 26, weight: 700, color: P.fg });
  drawRankRows(
    ctx,
    stats.topSites,
    { x0: PX, y0: T_RANK_ROWS, x1: PR, pitch: T_RANK_PITCH },
    P,
    { nameSize: 28, badgeR: 15, barH: 14, valSize: 25, numSize: 17, emptyText: strings.empty }
  );

  /* 用户区：头像 + 昵称 + 连续记录胶囊（未填写或选择隐藏时省略） */
  const prof = profile?.show !== false && (profile?.name || profile?.avatar) ? profile : null;
  if (prof) {
    const streakChip = stats.streak >= 2 ? strings.streakChip.replace('{n}', stats.streak) : null;
    await drawProfileRow(ctx, T_PROFILE_Y, prof, strings, streakChip, P);
  }

  drawFooter(ctx, strings, T_FOOT_Y, todayKey, P);
  return canvas;
}

/** 生成卡片 PNG data URL（2x 高清）。range：'day' | 'week' | 'year'；theme：'light' | 'dark'。 */
export async function renderShareCardDataURL({
  days,
  todayKey,
  range = 'year',
  strings,
  profile = null,
  theme = 'light',
  byRoot = false,
}) {
  const canvas = document.createElement('canvas');
  if (range === 'day' || range === 'week') {
    await drawTrendCard(canvas, { days, todayKey, range, strings, profile, theme, byRoot });
  } else {
    drawShareCard(canvas, days, todayKey, strings, cardPalette(theme), byRoot);
  }
  return canvas.toDataURL('image/png');
}
