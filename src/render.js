/* render — markdown-it + KaTeX + highlight.js 管线
 *
 * 三种视图（doc 节点按 detect() 的结果选）：
 *   md   → markdown 渲染（+ KaTeX 公式 + 块级代码高亮）
 *   code → 整篇语法高亮（hljs；认不出的语言退化成未高亮的等宽代码）
 *   text → 纯文本（保留空白，正文字体）
 */

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

/* ── 文件类型检测 ─────────────────────────────── */

const EXT_LANG = {
  py: 'python', pyw: 'python', pyi: 'python',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', fs: 'fsharp', vb: 'vbnet',
  java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', groovy: 'groovy', gradle: 'gradle',
  go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', dart: 'dart',
  lua: 'lua', r: 'r', jl: 'julia', m: 'objectivec', pl: 'perl', pm: 'perl',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ksh: 'bash',
  ps1: 'powershell', psm1: 'powershell', psd1: 'powershell',
  bat: 'dos', cmd: 'dos',
  sql: 'sql', json: 'json', jsonc: 'json', json5: 'json',
  yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini',
  env: 'ini', properties: 'ini',
  xml: 'xml', html: 'xml', htm: 'xml', xhtml: 'xml', svg: 'xml', vue: 'xml', svelte: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  tex: 'latex', sty: 'latex', cls: 'latex',
  diff: 'diff', patch: 'diff',
  makefile: 'makefile', cmake: 'cmake',
  proto: 'protobuf', graphql: 'graphql', gql: 'graphql',
  tf: 'ini', hcl: 'ini', nix: 'ini',
  asm: 'x86asm', s: 'x86asm',
  ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', ml: 'ocaml',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure',
  vim: 'vim', awk: 'awk',
};

// 无扩展名 / 特殊文件名
const NAME_LANG = {
  makefile: 'makefile', gnumakefile: 'makefile',
  dockerfile: 'dockerfile', containerfile: 'dockerfile',
  'cmakelists.txt': 'cmake',
  '.bashrc': 'bash', '.zshrc': 'bash', '.profile': 'bash', '.gitignore': 'ini',
  '.editorconfig': 'ini', '.npmrc': 'ini', '.prettierrc': 'json',
};

const MD_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx']);
const TEXT_EXT = new Set(['txt', 'text', 'log', 'csv', 'tsv', 'rst', 'org', 'srt', 'vtt']);

const SHEBANG_LANG = [
  [/python/i, 'python'], [/node|deno|bun/i, 'javascript'], [/zsh|bash|sh\b/i, 'bash'],
  [/pwsh|powershell/i, 'powershell'], [/perl/i, 'perl'], [/ruby/i, 'ruby'],
  [/lua/i, 'lua'], [/rscript/i, 'r'],
];

const MD_HINTS = [
  /^#{1,6} \S/m, /^```/m, /^\s*[-*+] \S/m, /^\s*\d+\. \S/m, /^\s*>\s\S/m,
  /\[[^\]]+\]\([^)\s]+\)/, /^\|.+\|\s*$/m, /\*\*[^*\n]+\*\*/,
];
const CODE_HINTS = [
  /^#!\/usr\/bin|\/env /m,
  /^\s*(import|from|export|const|let|var|function|class|def|async|await|public|private|protected|return|package|using|namespace)\b/m,
  /[;{}]\s*$/m,
  /^\s*(\/\/|#\s|--\s|\/\*)/m,
  /<\/?[a-zA-Z][\w-]*(\s[^>]*)?>/,
  /^\s*[\w.<>]+\s+[\w.<>]+\s*\([^)]*\)\s*\{/m,
];

function splitName(filename) {
  const name = String(filename || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(dot + 1) : '';
  return { name, ext: base };
}

function sniffText(text) {
  const head = text.slice(0, 20000);
  const mdHits = MD_HINTS.reduce((n, re) => n + (re.test(head) ? 1 : 0), 0);
  if (mdHits >= 2) return { mode: 'md', lang: null };
  for (const [re, lang] of SHEBANG_LANG) {
    if (re.test(head.split('\n')[0] || '') && /^#!/.test(head)) return { mode: 'code', lang };
  }
  const codeHits = CODE_HINTS.reduce((n, re) => n + (re.test(head) ? 1 : 0), 0);
  if (codeHits >= 2) return { mode: 'code', lang: null };
  return { mode: 'text', lang: null };
}

/** 按文件名 + 内容猜视图与语言：{ mode: 'md'|'code'|'text', lang } */
export function detect(text, filename) {
  const { name, ext } = splitName(filename);
  if (NAME_LANG[name]) return { mode: 'code', lang: NAME_LANG[name] };
  if (MD_EXT.has(ext)) return { mode: 'md', lang: null };
  if (TEXT_EXT.has(ext)) {
    // .txt/.log 这类也可能其实是 markdown 或代码 → 内容再判一次
    const sniffed = sniffText(text);
    return sniffed.mode === 'text' ? sniffed : sniffed;
  }
  if (EXT_LANG[ext]) {
    const lang = EXT_LANG[ext];
    return { mode: 'code', lang: window.hljs.getLanguage(lang) ? lang : null };
  }
  return sniffText(text);
}

/** 老数据没有 mode 字段：按标题 + 内容补出来 */
export function modeOf(node) {
  if (node && (node.mode === 'md' || node.mode === 'code' || node.mode === 'text')) {
    return { mode: node.mode, lang: node.lang || null };
  }
  return detect(node?.content || '', node?.title || '');
}

/* ── 三种视图 ─────────────────────────────────── */

export function renderCode(container, text, lang) {
  const known = lang && window.hljs.getLanguage(lang) ? lang : null;
  const pre = document.createElement('pre');
  pre.className = 'doc-code';
  const code = document.createElement('code');
  code.className = 'hljs' + (known ? ' language-' + known : '');
  if (known) {
    try {
      code.innerHTML = window.hljs.highlight(text || '', { language: known, ignoreIllegals: true }).value;
    } catch (e) {
      code.textContent = text || '';       // 高亮失败也别丢内容
    }
  } else {
    code.textContent = text || '';
  }
  pre.appendChild(code);
  container.innerHTML = '';
  container.appendChild(pre);
}

export function renderPlain(container, text) {
  const div = document.createElement('div');
  div.className = 'doc-plain';
  div.textContent = text || '';
  container.innerHTML = '';
  container.appendChild(div);
}

/** 按模式渲染整页（md / code / text） */
export function renderDoc(container, text, mode, lang) {
  if (mode === 'code') renderCode(container, text, lang);
  else if (mode === 'text') renderPlain(container, text);
  else renderRich(container, text);
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
