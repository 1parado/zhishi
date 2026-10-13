/**
 * 轻量 Markdown → HTML 渲染器（零依赖）。
 *
 * 支持：代码块、行内代码、粗体、斜体、标题、有序/无序列表、
 * 引用、水平线、链接、段落与换行。
 *
 * 安全：先提取代码块与行内代码（避免内部内容被其他规则处理），
 * 再转义 HTML，最后套用行内与块级格式。所有用户/AI 文本中的
 * HTML 标签都会被转义，不会产生注入面。
 */

const IC_OPEN = '\uE000'; // Private Use Area，不会出现在正常文本中
const IC_CLOSE = '\uE001';

/**
 * @param {string} text
 * @returns {string} HTML 字符串
 */
export function renderMarkdown(text) {
  if (!text) return '';

  const parts = [];
  let lastIdx = 0;
  // 代码块：```lang\n code ```
  const re = /```(\w*)\n?([\s\S]*?)```/g;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIdx) {
      parts.push(renderTextBlock(text.slice(lastIdx, m.index)));
    }
    const code = m[2].replace(/\n$/, '');
    parts.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(renderTextBlock(text.slice(lastIdx)));
  }

  return parts.join('\n');
}

/** 处理非代码块文本：转义 HTML → 行内格式 → 块级格式。 */
function renderTextBlock(raw) {
  let text = escapeHtml(raw);

  // 提取行内代码，避免内容被粗体/斜体等规则误处理
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `${IC_OPEN}IC${codes.length - 1}${IC_CLOSE}`;
  });

  // 粗体 **text**
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // 斜体 *text*（前后不能是 *，避免与粗体冲突）
  text = text.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  // 链接 [text](url)
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
  );

  // 还原行内代码（内容需再次转义，因为它跳过了上方的行内格式）
  text = text.replace(
    new RegExp(`${IC_OPEN}IC(\\d+)${IC_CLOSE}`, 'g'),
    (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`
  );

  return renderBlocks(text);
}

/** 块级格式：标题、列表、引用、水平线、段落。 */
function renderBlocks(text) {
  const lines = text.split('\n');
  const out = [];
  let inUl = false;
  let inOl = false;
  let para = [];

  const flush = () => {
    if (para.length) {
      out.push(`<p>${para.join('<br>')}</p>`);
      para = [];
    }
  };
  const closeLists = () => {
    if (inUl) { out.push('</ul>'); inUl = false; }
    if (inOl) { out.push('</ol>'); inOl = false; }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) { flush(); closeLists(); continue; }

    // 标题 # ~ ####
    const h = t.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      flush(); closeLists();
      const lv = h[1].length;
      out.push(`<h${lv}>${h[2]}</h${lv}>`);
      continue;
    }

    // 水平线 ---
    if (/^---+$/.test(t)) {
      flush(); closeLists();
      out.push('<hr>');
      continue;
    }

    // 引用 >（HTML 转义后为 &gt;）
    const bq = t.match(/^&gt;\s?(.*)$/);
    if (bq) {
      flush(); closeLists();
      out.push(`<blockquote>${bq[1]}</blockquote>`);
      continue;
    }

    // 无序列表 - / *
    const ul = t.match(/^[-*]\s+(.+)$/);
    if (ul) {
      flush();
      if (inOl) { out.push('</ol>'); inOl = false; }
      if (!inUl) { out.push('<ul>'); inUl = true; }
      out.push(`<li>${ul[1]}</li>`);
      continue;
    }

    // 有序列表 1.
    const ol = t.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flush();
      if (inUl) { out.push('</ul>'); inUl = false; }
      if (!inOl) { out.push('<ol>'); inOl = true; }
      out.push(`<li>${ol[1]}</li>`);
      continue;
    }

    para.push(t);
  }

  flush();
  closeLists();
  return out.join('\n');
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
