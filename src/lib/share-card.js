/**
 * 分享卡片绘制（纯 Canvas，零依赖）。
 *
 * 把「年度总使用 + 统计 + 站点排行 + 全年热力图 + 按星期分布」画成一张
 * 1080×1560 的分享图，2x 缩放导出保证清晰度。配色固定浅色（分享图不随
 * 系统主题），与扩展的 shadcn 令牌同源：蓝紫主色、绿黄橙红热力档。
 *
 * 版面结构（自上而下）：
 *   白卡 + 顶部渐变色带 → 品牌头 + 年度徽章 → 渐变着色 Hero 面板
 *   （年度总使用大字 + 日期范围）→ 四格统计 → 站点排行面板
 *   → 热力图面板 → 按星期分布面板 → 页脚
 */

import { dateKey, usageLevel } from './pure.js';
import { fmtDurationCompact } from './i18n.js';

const W = 1080;
const H = 1560;
const CARD = { x: 48, y: 48, w: W - 96, h: H - 96, r: 32 };
const X = 112; // 内容左缘
const RIGHT = W - 112; // 内容右缘
const INNER_W = RIGHT - X;
const P_PAD = 28; // 面板内边距
const PX = X + P_PAD; // 面板内容左缘
const PR = RIGHT - P_PAD; // 面板内容右缘

const FONT = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

// 与 shared.css :root 浅色主题对齐
const C = {
  bgTop: '#f5f8ff',
  bgBottom: '#fdf6ff',
  card: '#ffffff',
  cardBorder: 'rgba(226, 232, 240, 0.9)',
  fg: '#0a0f1e',
  muted: '#64748b',
  faint: '#94a3b8',
  chart1: '#3b82f6',
  chart2: '#8b5cf6',
  track: '#e9edf3',
  divider: '#e2e8f0',
  panel: '#f7f9fc',
  panelBorder: '#eef1f6',
  heroBorder: 'rgba(59, 130, 246, 0.14)',
  chipBg: '#eef2ff',
  chipFg: '#4f46e5',
  // 热力档：无 / 绿 / 黄 / 橙 / 红（85% 色 + 15% 白，与 heat-cell 一致）
  heat: ['#edf0f5', '#3cae66', '#f4a72e', '#f78a50', '#ef5350'],
};

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

function text(ctx, str, x, y, { size = 24, weight = 400, color = C.fg, align = 'left', fill = null } = {}) {
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

/** 横向蓝紫渐变（进度条 / 大字通用）。 */
function gradH(ctx, x0, x1) {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, C.chart1);
  g.addColorStop(1, C.chart2);
  return g;
}

function fmtHours(seconds, hourShort) {
  const h = seconds / 3600;
  if (h >= 100) return `${Math.round(h)} ${hourShort}`;
  if (h >= 10) return `${h.toFixed(1)} ${hourShort}`;
  return fmtDurationCompact(Math.round(seconds));
}

/** 汇总某一年数据：总量 / 活跃天数 / 峰值 / Top 站点 / 逐日秒数。 */
function aggregate(days, year) {
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
  const topSites = [...perSite.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return { perDay: daysArr, total, activeDays, peak, topSites };
}

/* ---------- 版面常量（自上而下） ---------- */
const HEAD_Y = 100; // logo / 徽章顶
const HERO = { y: 214, h: 204 }; // Hero 面板
const STATS_Y = 486; // 统计行数值基线
const PANEL_A = { y: 560, h: 380 }; // 站点排行
const PANEL_B = { y: 964, h: 224 }; // 热力图
const PANEL_C = { y: 1212, h: 172 }; // 按星期分布
const FOOT_Y = H - 100; // 页脚基线

/**
 * 在传入 canvas 上绘制分享卡片并返回 canvas。
 * strings：界面文案（由调用方用 i18n 组装）。
 */
export function drawShareCard(canvas, days, todayKey, strings) {
  const year = todayKey.slice(0, 4);
  const { perDay, total, activeDays, peak, topSites } = aggregate(days, year);
  const dailyAvg = activeDays > 0 ? total / activeDays : 0;

  const dpr = 2;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';

  /* 背景：柔和渐变 + 双色光晕 */
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, C.bgTop);
  bg.addColorStop(1, C.bgBottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = (x, y, r, color) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  };
  glow(150, 110, 440, 'rgba(59, 130, 246, 0.17)');
  glow(950, 1450, 480, 'rgba(139, 92, 246, 0.16)');

  /* 白卡片 + 柔和阴影 */
  ctx.save();
  ctx.shadowColor = 'rgba(15, 23, 42, 0.11)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = C.card;
  rr(ctx, CARD.x, CARD.y, CARD.w, CARD.h, CARD.r);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = C.cardBorder;
  ctx.lineWidth = 1;
  rr(ctx, CARD.x, CARD.y, CARD.w, CARD.h, CARD.r);
  ctx.stroke();

  // 顶部渐变色带（沿卡片圆角裁剪）
  ctx.save();
  rr(ctx, CARD.x, CARD.y, CARD.w, CARD.h, CARD.r);
  ctx.clip();
  ctx.fillStyle = gradH(ctx, CARD.x, CARD.x + CARD.w);
  ctx.fillRect(CARD.x, CARD.y, CARD.w, 7);
  ctx.restore();

  /* 头部：品牌 logo（渐变圆角方块 + 白色时钟）+ 年度徽章 */
  const logo = { x: X, y: HEAD_Y, s: 54 };
  fillRR(ctx, logo.x, logo.y, logo.s, logo.s, 15, gradH(ctx, logo.x, logo.x + logo.s));
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  const cc = logo.x + logo.s / 2;
  const cy = logo.y + logo.s / 2;
  ctx.beginPath();
  ctx.arc(cc, cy, 13.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cc, cy - 7.5);
  ctx.lineTo(cc, cy + 1);
  ctx.lineTo(cc + 5.5, cy + 3.5);
  ctx.stroke();

  text(ctx, strings.brand, logo.x + logo.s + 18, logo.y + 34, { size: 44, weight: 700 });
  text(ctx, strings.tagline, logo.x + logo.s + 18, logo.y + 66, { size: 20, color: C.muted });

  // 年度徽章：按文案实测宽度画胶囊
  const chipFont = `600 22px ${FONT}`;
  ctx.font = chipFont;
  const chipText = strings.report.replace('{year}', year);
  const chipW = ctx.measureText(chipText).width + 44;
  fillRR(ctx, RIGHT - chipW, HEAD_Y + 4, chipW, 46, 23, C.chipBg);
  text(ctx, chipText, RIGHT - chipW / 2, HEAD_Y + 34, {
    size: 22,
    weight: 600,
    color: C.chipFg,
    align: 'center',
  });

  /* Hero 面板：渐变着色，年度总使用大字（渐变填充） */
  const hero = ctx.createLinearGradient(X, HERO.y, RIGHT, HERO.y + HERO.h);
  hero.addColorStop(0, 'rgba(59, 130, 246, 0.075)');
  hero.addColorStop(1, 'rgba(139, 92, 246, 0.075)');
  fillRR(ctx, X, HERO.y, INNER_W, HERO.h, 24, hero);
  ctx.strokeStyle = C.heroBorder;
  ctx.lineWidth = 1;
  rr(ctx, X, HERO.y, INNER_W, HERO.h, 24);
  ctx.stroke();

  text(ctx, strings.totalLabel, PX, HERO.y + 46, { size: 20, color: C.muted });
  const heroVal = fmtHours(total, strings.hourShort);
  ctx.font = `800 78px ${FONT}`;
  const valW = ctx.measureText(heroVal).width;
  const valGrad = ctx.createLinearGradient(PX, 0, PX + valW, 0);
  valGrad.addColorStop(0, C.chart1);
  valGrad.addColorStop(1, C.chart2);
  text(ctx, heroVal, PX, HERO.y + 128, { size: 78, weight: 800, fill: valGrad });

  const range = perDay.length
    ? `${perDay[0][0].replaceAll('-', '.')} – ${perDay[perDay.length - 1][0].replaceAll('-', '.')}`
    : year;
  text(ctx, `${range} · ${strings.activeDaysN.replace('{n}', activeDays)}`, RIGHT - P_PAD, HERO.y + 128, {
    size: 21,
    color: C.muted,
    align: 'right',
  });

  /* 统计行：日均 / 最高单日 / 最常访问 / 覆盖星期 */
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
    text(ctx, value, x, STATS_Y, { size: 34, weight: 700 });
    text(ctx, label, x, STATS_Y + 34, { size: 18, color: C.muted });
    if (i > 0) {
      ctx.strokeStyle = C.divider;
      ctx.beginPath();
      ctx.moveTo(x - colW / 2, STATS_Y - 30);
      ctx.lineTo(x - colW / 2, STATS_Y + 30);
      ctx.stroke();
    }
  });

  /* 面板通用底 */
  const panel = (p) => {
    fillRR(ctx, X, p.y, INNER_W, p.h, 22, C.panel);
    ctx.strokeStyle = C.panelBorder;
    ctx.lineWidth = 1;
    rr(ctx, X, p.y, INNER_W, p.h, 22);
    ctx.stroke();
  };

  /* 面板 A：站点排行 Top 5 */
  panel(PANEL_A);
  text(ctx, strings.sitesTitle, PX, PANEL_A.y + 44, { size: 24, weight: 700 });
  const rowY0 = PANEL_A.y + 96;
  const rowPitch = 52;
  // 进度条区域：域名列 360px，时间列右对齐 130px
  const barX = PX + 40 + 360;
  const barEnd = PR - 130 - 14;
  const barW = barEnd - barX;
  if (!topSites.length) {
    text(ctx, strings.empty, PX, rowY0 + 20, { size: 21, color: C.faint });
  }
  topSites.forEach(([domain, seconds], i) => {
    const y = rowY0 + i * rowPitch;
    // 排名徽章：前三名渐变圆，其余浅灰圆
    const r = 14;
    if (i < 3) {
      ctx.fillStyle = gradH(ctx, PX, PX + 120);
      ctx.beginPath();
      ctx.arc(PX + r, y - 5, r, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, String(i + 1), PX + r, y + 1, {
        size: 16,
        weight: 700,
        color: '#ffffff',
        align: 'center',
      });
    } else {
      fillRR(ctx, PX, y - 19, r * 2, r * 2, r, C.track);
      text(ctx, String(i + 1), PX + r, y + 1, {
        size: 16,
        weight: 600,
        color: C.muted,
        align: 'center',
      });
    }
    ctx.font = `400 22px ${FONT}`;
    const name = ellipsize(ctx, domain, 360);
    text(ctx, name, PX + 40, y, { size: 22 });
    // 进度条（圆角胶囊）
    const ratio = seconds / (topSites[0][1] || 1);
    fillRR(ctx, barX, y - 11, barW, 10, 5, C.track);
    fillRR(ctx, barX, y - 11, Math.max(barW * ratio, 16), 10, 5, gradH(ctx, barX, barX + barW));
    text(ctx, fmtDurationCompact(Math.round(seconds)), PR, y, {
      size: 20,
      color: C.muted,
      align: 'right',
    });
  });

  /* 面板 B：全年热力图 */
  panel(PANEL_B);
  const heatHeadY = PANEL_B.y + 44;
  const cell = 11;
  const pitch = cell + 4;
  text(ctx, strings.heatTitle, PX, heatHeadY, { size: 24, weight: 700 });
  // 图例（右对齐：少 ▢▢▢▢▢ 多）
  let lx = RIGHT - P_PAD - (5 * 16 + 58);
  text(ctx, strings.less, lx, heatHeadY, { size: 17, color: C.faint });
  lx += 26;
  for (let i = 0; i < 5; i++) {
    fillRR(ctx, lx, heatHeadY - 12, 12, 12, 3, C.heat[i]);
    lx += 16;
  }
  text(ctx, strings.more, lx + 4, heatHeadY, { size: 17, color: C.faint });

  const gridY = heatHeadY + 26;
  const secByDay = new Map(perDay);
  const firstMonday = firstMondayOf(year);
  const lastSunday = lastSundayOf(year);
  for (let d = new Date(firstMonday); d <= lastSunday; d.setDate(d.getDate() + 1)) {
    const key = dateKey(d);
    if (d.getFullYear() !== Number(year) || key > todayKey) continue;
    const col = Math.floor((d - firstMonday) / 86400000 / 7);
    const row = (d.getDay() + 6) % 7;
    fillRR(ctx, PX + col * pitch, gridY + row * pitch, cell, cell, 2.5, C.heat[usageLevel(secByDay.get(key) || 0)]);
  }

  /* 面板 C：按星期分布（周一..周日，各星期平均使用时长） */
  panel(PANEL_C);
  text(ctx, strings.byWeekday, PX, PANEL_C.y + 44, { size: 24, weight: 700 });
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
    fillRR(ctx, cx - 15, barBase - bh, 30, bh, 7, gradH(ctx, cx - 15, cx + 15));
    text(ctx, strings.weekLabels[wd], cx, barBase + 26, {
      size: 17,
      color: C.muted,
      align: 'center',
    });
  });

  /* 页脚：品牌信息 + 生成日期 */
  ctx.strokeStyle = C.divider;
  ctx.beginPath();
  ctx.moveTo(X, FOOT_Y - 40);
  ctx.lineTo(RIGHT, FOOT_Y - 40);
  ctx.stroke();
  text(ctx, `${strings.brand} · ${strings.tagline}`, X, FOOT_Y, { size: 19, color: C.muted });
  text(ctx, strings.generated.replace('{date}', todayKey.replaceAll('-', '.')), RIGHT, FOOT_Y, {
    size: 19,
    color: C.faint,
    align: 'right',
  });

  return canvas;
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

/** 生成卡片 PNG data URL（2x 高清）。 */
export function renderShareCardDataURL(days, todayKey, strings) {
  const canvas = document.createElement('canvas');
  drawShareCard(canvas, days, todayKey, strings);
  return canvas.toDataURL('image/png');
}
