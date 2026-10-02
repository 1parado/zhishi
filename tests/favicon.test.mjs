import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFaviconUrl } from '../src/lib/favicon.js';

test('sanitizeFaviconUrl 接受内联 data:image', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  assert.equal(sanitizeFaviconUrl(png), png);
  assert.equal(sanitizeFaviconUrl('data:image/svg+xml,%3Csvg/%3E'), 'data:image/svg+xml,%3Csvg/%3E');
  assert.equal(sanitizeFaviconUrl('data:image/x-icon;base64,AAAB'), 'data:image/x-icon;base64,AAAB');
  // 非图片的 data URL 一律拒绝
  assert.equal(sanitizeFaviconUrl('data:text/html,<script>x</script>'), null);
});

test('sanitizeFaviconUrl 接受 http/https 远程地址', () => {
  assert.equal(
    sanitizeFaviconUrl('https://www.bilibili.com/favicon.ico'),
    'https://www.bilibili.com/favicon.ico'
  );
  assert.equal(sanitizeFaviconUrl('http://a.cn/i.png?x=1&y=2'), 'http://a.cn/i.png?x=1&y=2');
  // 首尾空白会被裁剪
  assert.equal(sanitizeFaviconUrl('  https://a.cn/f.ico  '), 'https://a.cn/f.ico');
});

test('sanitizeFaviconUrl 拒绝非 http(s) 协议', () => {
  assert.equal(sanitizeFaviconUrl('chrome://theme/IDR_DEFAULT_FAVICON'), null);
  assert.equal(sanitizeFaviconUrl('chrome-extension://abc/icon.png'), null);
  assert.equal(sanitizeFaviconUrl('edge://favicon/x'), null);
  assert.equal(sanitizeFaviconUrl('file:///D:/favicon.ico'), null);
  assert.equal(sanitizeFaviconUrl('blob:https://a.cn/uuid'), null);
  assert.equal(sanitizeFaviconUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeFaviconUrl('ftp://a.cn/f.ico'), null);
});

test('sanitizeFaviconUrl 拒绝会被拼进 CSS url() 的危险字符', () => {
  // url("…") 里出现双引号 / 反斜杠 / 圆括号能把声明提前闭合；单引号与空白
  // 虽然无害，也一并从严拒绝，保证拼字符串时无需再转义。
  assert.equal(sanitizeFaviconUrl('https://a.cn/a".ico'), null);
  assert.equal(sanitizeFaviconUrl("https://a.cn/a'.ico"), null);
  assert.equal(sanitizeFaviconUrl('https://a.cn/a).ico'), null);
  assert.equal(sanitizeFaviconUrl('https://a.cn/a(1).ico'), null);
  assert.equal(sanitizeFaviconUrl('https://a.cn/a\\".ico'), null);
  assert.equal(sanitizeFaviconUrl('https://a.cn/a b.ico'), null);
});

test('sanitizeFaviconUrl 拒绝空值与超长值', () => {
  assert.equal(sanitizeFaviconUrl(undefined), null);
  assert.equal(sanitizeFaviconUrl(null), null);
  assert.equal(sanitizeFaviconUrl(123), null);
  assert.equal(sanitizeFaviconUrl(''), null);
  assert.equal(sanitizeFaviconUrl('   '), null);

  // 远程地址上限 2KB
  const longRemote = `https://a.cn/${'x'.repeat(2100)}.ico`;
  assert.equal(sanitizeFaviconUrl(longRemote), null);
  assert.notEqual(sanitizeFaviconUrl(`https://a.cn/${'x'.repeat(100)}.ico`), null);

  // 内联图标上限 64KB
  const longData = `data:image/png;base64,${'A'.repeat(65 * 1024)}`;
  assert.equal(sanitizeFaviconUrl(longData), null);
  assert.notEqual(sanitizeFaviconUrl(`data:image/png;base64,${'A'.repeat(1024)}`), null);
});
