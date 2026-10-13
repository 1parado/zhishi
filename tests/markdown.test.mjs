import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../src/lib/markdown.js';

test('空字符串返回空', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
});

test('纯文本包裹在 p 标签中', () => {
  const html = renderMarkdown('你好世界');
  assert.ok(html.includes('<p>'), '应包含 <p>');
  assert.ok(html.includes('你好世界'));
});

test('粗体渲染', () => {
  const html = renderMarkdown('这是**粗体**文字');
  assert.ok(html.includes('<strong>粗体</strong>'));
});

test('斜体渲染', () => {
  const html = renderMarkdown('这是*斜体*文字');
  assert.ok(html.includes('<em>斜体</em>'));
});

test('行内代码渲染', () => {
  const html = renderMarkdown('使用 `addLimit` 函数');
  assert.ok(html.includes('<code>addLimit</code>'));
});

test('代码块渲染', () => {
  const html = renderMarkdown('```js\nconst x = 1;\nconsole.log(x);\n```');
  assert.ok(html.includes('<pre>'), '应包含 <pre>');
  assert.ok(html.includes('<code>'), '应包含 <code>');
  assert.ok(html.includes('const x = 1;'));
});

test('代码块内部不被粗体规则处理', () => {
  const html = renderMarkdown('```\n**not bold**\n```');
  assert.ok(!html.includes('<strong>'), '不应有 <strong> 标签');
  assert.ok(html.includes('**not bold**'), '** 应原样保留');
});

test('标题渲染', () => {
  const html = renderMarkdown('## 标题\n### 子标题');
  assert.ok(html.includes('<h2>标题</h2>'));
  assert.ok(html.includes('<h3>子标题</h3>'));
});

test('无序列表渲染', () => {
  const html = renderMarkdown('- 项目一\n- 项目二');
  assert.ok(html.includes('<ul>'));
  assert.ok(html.includes('<li>项目一</li>'));
  assert.ok(html.includes('<li>项目二</li>'));
  assert.ok(html.includes('</ul>'));
});

test('有序列表渲染', () => {
  const html = renderMarkdown('1. 第一步\n2. 第二步');
  assert.ok(html.includes('<ol>'));
  assert.ok(html.includes('<li>第一步</li>'));
  assert.ok(html.includes('</ol>'));
});

test('链接渲染', () => {
  const html = renderMarkdown('[GitHub](https://github.com)');
  assert.ok(html.includes('<a href="https://github.com"'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('GitHub</a>'));
});

test('HTML 标签被转义防注入', () => {
  const html = renderMarkdown('<script>alert(1)</script>');
  assert.ok(!html.includes('<script>'), 'script 标签应被转义');
  assert.ok(html.includes('&lt;script&gt;'));
});

test('多段落用空行分隔', () => {
  const html = renderMarkdown('第一段\n\n第二段');
  assert.ok(html.includes('<p>第一段</p>'));
  assert.ok(html.includes('<p>第二段</p>'));
});

test('引用块渲染', () => {
  const html = renderMarkdown('> 这是引用');
  assert.ok(html.includes('<blockquote>'));
  assert.ok(html.includes('这是引用'));
});

test('流式不完整代码块安全降级', () => {
  // 未闭合的代码块不会崩溃，``` 作为普通文本显示
  const html = renderMarkdown('```\nconst x = 1;');
  assert.ok(typeof html === 'string');
  assert.ok(html.includes('const x = 1;'));
});

test('水平线渲染', () => {
  const html = renderMarkdown('上\n---\n下');
  assert.ok(html.includes('<hr>'));
});
