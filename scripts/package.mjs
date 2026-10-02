#!/usr/bin/env node
/**
 * 把扩展打成可直接上传 Chrome 应用商店的 zip。
 *
 * 纯 Node 实现（无三方依赖、不依赖系统 zip 命令）：Node 没有内置写 zip 的能力，
 * 而 Chrome 应用商店只接受 zip 上传，所以这里按 ZIP 规范手写一遍。
 *
 * 两条硬约束：
 *   - zip 的**根目录**必须直接是 manifest.json，不能多套一层文件夹，否则商店报
 *     "Manifest file is missing or unreadable"。
 *   - 只收运行时真正需要的文件（manifest.json / icons / src），docs、scripts、
 *     tests、README 一并排除——它们不影响扩展运行，只会让审核包变大。
 *
 * 用法：node scripts/package.mjs [--out <dir>]   默认输出到 dist/
 */
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 打包进 zip 的顶层条目（顺序即 zip 内顺序，manifest 放最前便于人工核对）。 */
const ENTRIES = ['manifest.json', 'icons', 'src'];

/** 顺带排除的杂物，避免把编辑器/系统文件带进审核包。 */
const IGNORED = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/* ---------- ZIP 底层 ---------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** ZIP 用的是 MS-DOS 时间格式：秒只有 2 秒精度。 */
function dosDateTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

function buildZip(files) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name, 'utf8');
    const { time, date } = dosDateTime(file.mtime);
    const crc = crc32(file.data);

    // 小文件 deflate 后反而变大（多了压头压尾），此时退回 store（不压缩）。
    const deflated = deflateRawSync(file.data, { level: 9 });
    const compress = deflated.length < file.data.length;
    const payload = compress ? deflated : file.data;
    const method = compress ? 8 : 0;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header
    header.writeUInt16LE(20, 4); // 解压所需版本 2.0
    header.writeUInt16LE(0x0800, 6); // 文件名按 UTF-8 解释
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(payload.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28); // 无 extra field
    local.push(header, nameBuf, payload);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // central directory header
    entry.writeUInt16LE(20, 4); // 生成方版本
    entry.writeUInt16LE(20, 6); // 解压所需版本
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(time, 12);
    entry.writeUInt16LE(date, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(file.data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt16LE(0, 30); // extra
    entry.writeUInt16LE(0, 32); // comment
    entry.writeUInt16LE(0, 34); // 起始磁盘号
    entry.writeUInt16LE(0, 36); // 内部属性
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // 外部属性：unix 0644
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += header.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
  eocd.writeUInt16LE(0, 4); // 本磁盘号
  eocd.writeUInt16LE(0, 6); // central directory 起始磁盘号
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // 无注释

  return Buffer.concat([...local, centralBuf, eocd]);
}

/* ---------- 收集文件 ---------- */

/** 递归收集单个条目；目录按 posix 风格写进 zip，跨平台解压才一致。 */
function collect(absPath, entryName, out) {
  const stat = statSync(absPath);
  if (stat.isDirectory()) {
    const names = readdirSync(absPath).sort();
    for (const name of names) {
      if (IGNORED.has(name)) continue;
      collect(join(absPath, name), posix.join(entryName, name), out);
    }
    return;
  }
  out.push({ name: entryName, data: readFileSync(absPath), mtime: stat.mtime });
}

function parseOut(argv) {
  const i = argv.indexOf('--out');
  return i !== -1 && argv[i + 1] ? resolve(argv[i + 1]) : join(ROOT, 'dist');
}

/**
 * manifest 里显式声明的资源（图标、popup、service worker、options 页、内容脚本）
 * 必须都在包里——少一个，扩展装上就直接报错，而且商店审核也会打回。
 * 只做保守的路径字面量匹配：match patterns（<all_urls>）之类不会命中。
 */
function assertManifestRefs(manifest, files) {
  const names = new Set(files.map((f) => f.name));
  const missing = [];
  const visit = (node) => {
    if (typeof node === 'string') {
      if (/^[a-z0-9_./-]+\.(?:html|js|mjs|css|png|jpe?g|svg|gif|woff2?)$/i.test(node) && !names.has(node)) {
        missing.push(node);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node && typeof node === 'object') for (const value of Object.values(node)) visit(value);
  };
  visit(manifest);
  if (missing.length) throw new Error(`manifest 引用的文件未打包：${[...new Set(missing)].join('、')}`);
}

function main() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  if (!manifest.version) throw new Error('manifest.json 缺少 version 字段');

  const files = [];
  for (const name of ENTRIES) collect(join(ROOT, name), name, files);

  if (files[0]?.name !== 'manifest.json') {
    throw new Error(`zip 首项应为 manifest.json，实际为 ${files[0]?.name}`);
  }
  assertManifestRefs(manifest, files);

  const zip = buildZip(files);
  const outDir = parseOut(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });

  const outFile = join(outDir, `zhishi-${manifest.version}.zip`);
  writeFileSync(outFile, zip);

  const raw = files.reduce((acc, f) => acc + f.data.length, 0);
  const pct = raw ? ((1 - zip.length / raw) * 100).toFixed(1) : '0.0';
  console.log(`已打包 ${files.length} 个文件 → ${relative(ROOT, outFile).split(sep).join('/')}`);
  console.log(`原始 ${(raw / 1024).toFixed(1)} KB → 压缩后 ${(zip.length / 1024).toFixed(1)} KB（省 ${pct}%）`);
  console.log(`版本 ${manifest.version}，根目录首项 ${files[0].name}`);
}

main();
