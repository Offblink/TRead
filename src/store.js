/* store — 树模型、持久化、上下文继承
 *
 * 节点: { id, parentId, kind:'doc'|'qa', title, content, anchor, createdAt }
 *   - doc 根: title=文件名, content=md 原文
 *   - qa:     title=提问原文, content=AI 回答(md), anchor=源划线三元组
 * 上下文: buildParts(viewId) 沿 parentId 走到根, 组装
 *   [根文档] + [沿途祖先 QA 对] + [当前页] , 兄弟问题共享同一前缀(按 viewId 缓存)
 */

const KEY = 'nest-reader:v1';

const SYS_PROMPT =
  '你是一名精读助手。基于提供的文档与上下文精确、直接地回答读者的问题。' +
  '使用 Markdown 排版；数学公式使用 LaTeX（行内 $...$，行间 $$...$$）。' +
  '不要复述问题，不要寒暄。若上下文中没有依据，明确指出。';

export const DEFAULT_SETTINGS = { baseURL: '', apiKey: '', model: '', budget: 120000 };

function freshState() {
  return { v: 1, nodes: {}, roots: [], currentId: null, settings: { ...DEFAULT_SETTINGS } };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.nodes && s.roots) {
        s.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
        s.currentId = s.nodes[s.currentId] ? s.currentId : null;
        return s;
      }
    }
  } catch (e) { console.warn('[store] load failed', e); }
  return freshState();
}

let state = load();

/* ── 变更与持久化 ─────────────────────────────── */

let version = 0;          // 结构版本，供 context 缓存失效
let persistTimer = null;
const listeners = new Set();

export function getState() { return state; }

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit() { for (const fn of listeners) { try { fn(); } catch (e) { console.warn('[store] listener', e); } } }

/** 结构变更后调用：立即通知 UI，延迟 250ms 落盘 */
export function save() {
  version++;
  emit();
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.warn('[store] persist failed', e); }
  }, 250);
}

/* ── 树操作 ───────────────────────────────────── */

export function childrenOf(id) {
  return Object.values(state.nodes)
    .filter(n => n.parentId === id)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function pathToRoot(id) {
  const path = [];
  let n = state.nodes[id];
  while (n) { path.unshift(n); n = state.nodes[n.parentId]; }
  return path;
}

export function createNode({ parentId = null, kind, title, content = '', anchor = null }) {
  const id = 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const node = { id, parentId, kind, title, content, anchor, createdAt: Date.now() };
  state.nodes[id] = node;
  if (kind === 'doc' && !parentId) state.roots.push(id);
  save();
  return node;
}

export function deleteSubtree(id) {
  const doomed = new Set();
  (function walk(x) {
    doomed.add(x);
    childrenOf(x).forEach(c => walk(c.id));
  })(id);
  for (const d of doomed) delete state.nodes[d];
  state.roots = state.roots.filter(r => !doomed.has(r));
  if (doomed.has(state.currentId)) state.currentId = state.nodes[state.currentId] ? state.currentId : null;
  save();
  return doomed;
}

/* ── 上下文继承 ───────────────────────────────── */

let ctxCache = { v: -1, viewId: null, parts: null };

/**
 * 组装 viewId 页面的上下文 parts（不含 system 与最终问题）。
 * [doc 根文档] + [祖先 qa 问答对（root→view 之间）] + [view 为 qa 时的当前页]
 * 超预算：从最远祖先成对截断，仍超则截根文档（保头尾）。
 */
export function buildParts(viewId) {
  if (ctxCache.v === version && ctxCache.viewId === viewId) return ctxCache.parts;

  const path = pathToRoot(viewId);
  const parts = [];
  if (path.length) {
    const root = path[0];
    parts.push({ kind: 'doc', role: 'user', content: '【文档全文】\n' + (root.content || '') });
    for (const n of path.slice(1, -1)) {
      parts.push({ kind: 'anc-q', role: 'user', content: '【上游问题】\n' + n.title });
      parts.push({ kind: 'anc-a', role: 'assistant', content: '【上游回答】\n' + (n.content || '') });
    }
    const view = path[path.length - 1];
    if (view.kind === 'qa' && view.content) {
      parts.push({ kind: 'cur', role: 'user', content: '【当前页面（上一回答）】\n' + view.content });
    }
    applyBudget(parts, Number(state.settings.budget) || DEFAULT_SETTINGS.budget);
  }
  ctxCache = { v: version, viewId, parts };
  return parts;
}

function applyBudget(parts, budget) {
  const total = parts.reduce((s, p) => s + p.content.length, 0);
  if (total <= budget) return;
  let over = total - budget;
  const dropped = [];
  // 1) 从最远的上游问答开始整对丢弃
  for (let i = parts.length - 1; i >= 0 && over > 0; i--) {
    const p = parts[i];
    if (p.kind !== 'anc-q' && p.kind !== 'anc-a') continue;
    if (p.content.length <= over) {
      over -= p.content.length;
      dropped.push(p.kind + ':' + p.content.length);
      parts.splice(i, 1);
    } else {
      p.content = cutTail(p.content, p.content.length - over);
      over = 0;
      break;
    }
  }
  // 2) 仍超 → 截根文档（保头 60% / 尾 40%）
  const doc = parts.find(p => p.kind === 'doc');
  if (over > 0 && doc && doc.content.length > over + 500) {
    doc.content = cutMiddle(doc.content, doc.content.length - over);
    dropped.push('doc-trim:' + over);
    over = 0;
  }
  if (over > 0) console.warn('[ctx] 预算内放不下，超出', over);
  if (dropped.length) console.info('[ctx] 超预算截断', dropped, 'budget=', budget);
}

function cutTail(s, keep) { return s.slice(0, keep); }
function cutMiddle(s, keep) {
  const head = Math.floor(keep * 0.6), tail = keep - head;
  return s.slice(0, head) + '\n…（中间省略）…\n' + s.slice(s.length - tail);
}

/** 上下文预览（composer 芯片与日志用） */
export function contextPreview(viewId) {
  const parts = buildParts(viewId);
  let docChars = 0, ancCount = 0, curChars = 0;
  for (const p of parts) {
    if (p.kind === 'doc') docChars = p.content.length;
    else if (p.kind === 'anc-q') ancCount++;
    else if (p.kind === 'cur') curChars = p.content.length;
  }
  return {
    docChars, ancCount, curChars,
    total: parts.reduce((s, p) => s + p.content.length, 0),
  };
}

/** 最终发给 LLM 的 messages（system + 上下文 + 划线 + 新问题） */
export function messagesFor(viewId, quote, question) {
  const parts = buildParts(viewId);
  const finalMsg = (quote ? '【划线及附近上下文】\n' + quote + '\n\n' : '') + '【我的问题】\n' + question;
  return [
    { role: 'system', content: SYS_PROMPT },
    ...parts.map(p => ({ role: p.role, content: p.content })),
    { role: 'user', content: finalMsg },
  ];
}

/* ── 导入 / 导出 ──────────────────────────────── */

export function exportData() {
  const { nodes, roots, currentId, settings } = state;
  return {
    v: 1, app: 'nest-reader', exportedAt: new Date().toISOString(),
    nodes, roots, currentId,
    settings: { ...settings, apiKey: '' }, // 导出不带 key
  };
}

export function importData(obj) {
  if (!obj || typeof obj !== 'object' || !obj.nodes || !Array.isArray(obj.roots)) {
    throw new Error('不是有效的 nest-reader 数据文件');
  }
  const nodes = {};
  for (const [id, n] of Object.entries(obj.nodes)) {
    if (n && typeof n === 'object' && n.kind) {
      nodes[id] = {
        id, parentId: n.parentId ?? null, kind: n.kind,
        title: String(n.title || ''), content: String(n.content || ''),
        anchor: n.anchor || null, createdAt: n.createdAt || Date.now(),
      };
    }
  }
  const roots = obj.roots.filter(id => nodes[id]);
  state = { v: 1, nodes, roots, currentId: nodes[obj.currentId] ? obj.currentId : null, settings: { ...DEFAULT_SETTINGS, ...(obj.settings || {}) } };
  save();
  return state;
}
