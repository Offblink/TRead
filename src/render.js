/* render — markdown-it + KaTeX + highlight.js 管线 */

const md = window.markdownit({
  html: false,
  linkify: true,
  typographer: false,
  highlight(str, lang) {
    if (lang && window.hljs.getLanguage(lang)) {
      try { return window.hljs.highlight(str, { language: lang, ignoreIllegals: true }).value; }
      catch (e) { /* fall through */ }
    }
    return '';
  },
});

export function renderMarkdown(text) {
  return md.render(text || '');
}

/** 渲染 md + 数学公式到容器（innerHTML 覆盖） */
export function renderRich(container, text) {
  container.innerHTML = renderMarkdown(text);
  renderMath(container);
}

/** 对容器内 $...$ / $$...$$ / \(..\) / \[..] 做 KaTeX 渲染 */
export function renderMath(container) {
  if (!container.querySelector('.katex') && !/\$\$|\\\(|\\\[|\$[^$\n]+\$/m.test(container.textContent)) return;
  try {
    window.renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'pre', 'code', 'textarea'],
    });
  } catch (e) { console.warn('[render] math', e); }
}
