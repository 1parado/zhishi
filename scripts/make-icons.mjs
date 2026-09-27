/**
 * 生成扩展图标：slate 圆角方块 + 白色时钟环与指针。
 * 令牌取自 UI_UI 体系 primary = hsl(222.2 47.4% 11.2%) ≈ #0F172A。
 * 运行：node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'icons');
mkdirSync(outDir, { recursive: true });

// hsl(222.2 47.4% 11.2%) → #0F172A
const BG = [15, 23, 42];
const FG = [255, 255, 255];

const clamp01 = (v) => Math.min(Math.max(v, 0), 1);

/** 圆角矩形有向距离（内部为负）。 */
function roundedRectSDF(px, py, cx, cy, halfSize, radius) {
  const dx = Math.abs(px - cx) - (halfSize - radius);
  const dy = Math.abs(py - cy) - (halfSize - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** 圆环有向距离。 */
function ringSDF(px, py, cx, cy, radius, thickness) {
  return Math.abs(Math.hypot(px - cx, py - cy) - radius) - thickness / 2;
}

/** 线段有向距离（圆帽）。 */
function segmentSDF(px, py, ax, ay, bx, by, thickness) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t)) - thickness / 2;
}

function drawIcon(size) {
  const data = Buffer.alloc(size * size * 4, 0);
  const c = size / 2;
  const bgHalf = size / 2 - 0.5;
  const corner = size * 0.24;
  const ringR = size * 0.3;
  const ringT = Math.max(size * 0.08, 1.6);
  const handT = Math.max(size * 0.06, 1.2);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      const bgDist = roundedRectSDF(px, py, c, c, bgHalf, corner);
      const bgAlpha = clamp01(0.5 - bgDist);
      if (bgAlpha <= 0) continue;

      let shape = Math.min(ringSDF(px, py, c, c, ringR, ringT), 1e9);
      // 时钟指针：向上（分针）与向右（时针）。
      shape = Math.min(shape, segmentSDF(px, py, c, c, c, c - ringR * 0.62, handT));
      shape = Math.min(shape, segmentSDF(px, py, c, c, c + ringR * 0.5, c, handT));
      const fgAlpha = clamp01(0.5 - shape);

      const alpha = bgAlpha * fgAlpha;
      const i = (y * size + x) * 4;
      data[i] = BG[0] + (FG[0] - BG[0]) * alpha;
      data[i + 1] = BG[1] + (FG[1] - BG[1]) * alpha;
      data[i + 2] = BG[2] + (FG[2] - BG[2]) * alpha;
      data[i + 3] = Math.round(255 * bgAlpha);
    }
  }
  return data;
}

/* ---------- PNG 编码 ---------- */

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const png = encodePNG(size, drawIcon(size));
  const path = join(outDir, `icon${size}.png`);
  writeFileSync(path, png);
  console.log(`written ${path} (${png.length} bytes)`);
}
