/* annotate — 划线系统
 *
 * 定位: text-quote 三元组 {before, text, after}，基于 body.textContent 全文偏移
 *       选区 → Range.getBoundingClientRect → 浮动菜单 → composer → 提问
 * 装饰: decorate() 把当前视图的 qa 子节点画成 <mark> + 问答卡片
 */

import { renderRich, renderMarkdown, renderMath } from './render.js';
import { getState, childrenOf, contextPreview, deleteSubtree } from './store.js';
import { ask, subscribe, getStream, retry, abort } from './ask.js';

let body = null;          // #body 元素（跨视图稳定）
let viewId = null;        // 当前视图节点 id
let pending = null;       // { anchor, rect } 已选中待提问
let composerMode = 'inline';
let cb = {};              // { navigate(nodeId, opts), refreshMap() }
const cardSubs = [];      // decorate 建立的订阅
const pageSubs = [];      // fillBody 建立的订阅（正文流式）
let bound = false;

export function init(callbacks) { cb = callbacks; }

export function setView(el, id) {
  if (bound && body !== el) unbindAll();
  body = el;
  viewId = id;
}

export function unbindAll() {
  while (cardSubs.length) cardSubs.pop()();
  while (pageSubs.length) pageSubs.pop()();
}

/* ── 文本偏移工具 ─────────────────────────────── */

function offsetOf(container, offset) {
  const r = document.createRange();
  r.setStart(body, 0);
  r.setEnd(container, offset);
  return r.toString().length;
}

function textNodesWithOffsets() {
  const out = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let acc = 0, n;
  while ((n = walker.nextNode())) {
    out.push({ node: n, start: acc, end: acc + n.data.length });
    acc += n.data.length;
  }
  return { list: out, total: acc };
}

/** 在全文中定位 anchor，返回 {list, start, end} 或 null */
function locate(anchor) {
  const full = body.textContent;
  const { list } = textNodesWithOffsets();
  let idx = -1, best = -Infinity, from = 0;
  while (true) {
    const i = full.indexOf(anchor.text, from);
    if (i < 0) break;
    let score = 0;
    if (anchor.before) score += suffixScore(anchor.before, full.slice(Math.max(0, i - 120), i));
    if (anchor.after) score += prefixScore(anchor.after, full.slice(i + anchor.text.length, i + anchor.text.length + 120));
    if (score > best) { best = score; idx = i; }
    from = i + 1;
  }
  if (idx < 0) return null;
  return { list, start: idx, end: idx + anchor.text.length };
}

function suffixScore(a, b) { // a 尾部与 b 尾部的公共字符数
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function prefixScore(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** 把 [start,end) 文本段包成 <mark class="hl">，返回第一个 mark */
function wrapRange(loc) {
  const { list, start, end } = loc;
  let first = null;
  for (const t of list) {
    if (t.end <= start || t.start >= end) continue;
    let node = t.node;
    const localStart = Math.max(0, start - t.start);
    const localEnd = Math.min(node.data.length, end - t.start);
    if (localStart > 0) node = node.splitText(localStart);
    if (localEnd - localStart < node.data.length) node.splitText(localEnd - localStart);
    const m = document.createElement('mark');
    m.className = 'hl';
    node.parentNode.insertBefore(m, node);
    m.appendChild(node);
    if (!first) first = m;
  }
  return first;
}

/* ── 装饰：子节点 → mark + 卡片 ───────────────── */

export function decorate() {
  while (cardSubs.length) cardSubs.pop()();
  if (!body || !viewId) return;
  const kids = childrenOf(viewId).filter(n => n.kind === 'qa');
  for (const k of kids) decorateOne(k);
}

function decorateOne(node) {
  if (node.anchor && node.anchor.text) {
    const loc = locate(node.anchor);
    if (loc) {
      const mark = wrapRange(loc);
      if (mark) {
        mark.dataset.node = node.id;
        mark.title = '💬 ' + node.title;
        const card = buildCard(node, false);
        insertAfterBlock(mark, card);
        return;
      }
    }
  }
  // 锚点失效或无锚点：卡片仍要出现（虚线样式）
  const card = buildCard(node, true);
  body.appendChild(card);
}

function insertAfterBlock(mark, card) {
  let ref = mark.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,td,pre,div') || mark;
  while (ref.nextSibling && ref.nextSibling.classList && ref.nextSibling.classList.contains('qa-card')) {
    ref = ref.nextSibling;
  }
  ref.parentNode.insertBefore(card, ref.nextSibling);
}

/* ── 问答卡片 ─────────────────────────────────── */

function buildCard(node, lost) {
  const card = document.createElement('div');
  card.className = 'qa-card' + (lost ? ' lost' : '');
  card.dataset.node = node.id;

  const head = document.createElement('div');
  head.className = 'qa-head';
  head.innerHTML = '<span class="qa-icon">💬</span>';
  const q = document.createElement('div');
  q.className = 'qa-q';
  q.textContent = node.title;
  head.appendChild(q);

  const actions = document.createElement('div');
  actions.className = 'qa-actions';
  const btnDeep = document.createElement('button');
  btnDeep.className = 'btn ghost';
  btnDeep.textContent = '⤴ 再问一问';
  btnDeep.title = '全屏打开这页，继续深入';
  btnDeep.addEventListener('click', () => {
    const mark = body.querySelector(`mark.hl[data-node="${node.id}"]`);
    const rect = mark ? mark.getBoundingClientRect() : card.getBoundingClientRect();
    cb.navigate(node.id, { rect });
  });
  const btnDel = document.createElement('button');
  btnDel.className = 'btn ghost';
  btnDel.textContent = '✕';
  btnDel.title = '删除该提问（含其下的嵌套）';
  btnDel.addEventListener('click', () => {
    if (!confirm('删除「' + node.title.slice(0, 30) + '」及其全部子提问？')) return;
    abort(node.id);
    deleteSubtree(node.id);
    cb.rerender();
  });
  actions.append(btnDeep, btnDel);
  head.appendChild(actions);
  card.appendChild(head);

  const ans = document.createElement('div');
  ans.className = 'qa-answer';
  card.appendChild(ans);

  wireAnswer(node, ans);
  return card;
}

/** 让卡片答案区跟随流式状态 */
function wireAnswer(node, ans) {
  const s = getStream(node.id);
  const paint = (state) => {
    const txt = state.text || '';
    if (state.status === 'streaming' && !txt) {
      ans.className = 'qa-answer';
      ans.innerHTML = '<div class="qa-empty">正在生成回答</div>';
      return;
    }
    ans.className = 'qa-answer md-body';
    ans.innerHTML = renderMarkdown(txt);
    renderMath(ans);
    removeError(ans);
    if (state.status === 'error') showRetry(ans, node, state.error);
  };
  if (s) cardSubs.push(subscribe(node.id, paint));
  else if (node.content) paint({ status: 'done', text: node.content });
  else ans.innerHTML = '<div class="qa-empty">（无回答）</div>';
}

function showRetry(ans, node, msg) {
  removeError(ans);
  const box = document.createElement('div');
  box.className = 'qa-error';
  box.textContent = '⚠ ' + msg;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = '重试';
  btn.addEventListener('click', () => retry(node.id));
  box.appendChild(btn);
  ans.appendChild(box);
}
function removeError(ans) {
  const e = ans.querySelector('.qa-error');
  if (e) e.remove();
}

/* ── 选区 → 浮动菜单 ──────────────────────────── */

const $ = id => document.getElementById(id);
const selmenu = $('selmenu'), composer = $('composer');

function hideMenu() { if (!selmenu.hidden) { selmenu.hidden = true; pending = null; } }

function insideExcluded(range) {
  const c = range.commonAncestorContainer;
  const el = c.nodeType === 3 ? c.parentElement : c;
  return Boolean(el && el.closest('.katex, pre, code'));
}

function onMouseUp(e) {
  if (e && e.target.closest && e.target.closest('.popover,#selmenu')) return;
  setTimeout(handleSelection, 0);
}

function handleSelection() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) { hideMenu(); return; }
  const range = sel.getRangeAt(0);
  if (!body || !body.contains(range.commonAncestorContainer)) { hideMenu(); return; }
  if (insideExcluded(range)) { hideMenu(); return; }
  const raw = range.toString();
  if (!raw.trim()) { hideMenu(); return; }

  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  if (end <= start) { hideMenu(); return; }
  const full = body.textContent;
  const anchor = {
    before: full.slice(Math.max(0, start - 80), start),
    text: full.slice(start, end),
    after: full.slice(end, end + 80),
  };
  pending = { anchor, rect: range.getBoundingClientRect() };
  showMenu(pending.rect);
}

function showMenu(rect) {
  selmenu.hidden = false;
  const w = selmenu.offsetWidth, h = selmenu.offsetHeight;
  let x = rect.left + rect.width / 2 - w / 2;
  x = Math.max(8, Math.min(x, innerWidth - w - 8));
  let y = rect.top - h - 10;
  if (y < 56) y = rect.bottom + 10;
  y = Math.max(8, Math.min(y, innerHeight - h - 8));
  selmenu.style.left = x + 'px';
  selmenu.style.top = y + 'px';
  if (window.gsap) {
    gsap.fromTo(selmenu, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: .18, ease: 'power2.out' });
    gsap.fromTo(selmenu.children, { y: 5, opacity: 0 }, { y: 0, opacity: 1, duration: .18, stagger: .04, ease: 'power2.out' });
  }
}

/* ── composer（提问输入） ─────────────────────── */

function openComposer(mode) {
  if (!pending) return;
  composerMode = mode;
  selmenu.hidden = true;
  const p = contextPreview(viewId);
  const ctxParts = [`根文档 ${fmt(p.docChars)} 字`];
  if (p.ancCount) ctxParts.push(`${p.ancCount} 个上游问答`);
  if (p.curChars) ctxParts.push('当前页回答');
  $('composer-ctx').textContent = `上下文将携带：${ctxParts.join(' + ')}（约 ${fmt(p.total)} 字）`;
  const t = pending.anchor.text;
  $('composer-quote').textContent = '“' + (t.length > 50 ? t.slice(0, 50) + '…' : t) + '”';
  $('composer-input').value = '';

  composer.hidden = false;
  const w = composer.offsetWidth, h = composer.offsetHeight;
  let x = Math.max(8, Math.min(pending.rect.left, innerWidth - w - 8));
  let y = pending.rect.top - h - 12;
  if (y < 56) y = Math.min(pending.rect.bottom + 12, innerHeight - h - 8);
  y = Math.max(8, Math.min(y, innerHeight - h - 8));
  composer.style.left = x + 'px';
  composer.style.top = y + 'px';
  if (window.gsap) gsap.fromTo(composer, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: .2, ease: 'power2.out' });
  $('composer-input').focus();
}

function closeComposer() {
  composer.hidden = true;
  pending = null;
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
}

function sendQuestion() {
  const q = $('composer-input').value.trim();
  if (!q || !pending) return;
  const { anchor, rect } = pending;
  const mode = composerMode;
  composer.hidden = true;
  pending = null;
  window.getSelection().removeAllRanges();

  const node = ask({ parentId: viewId, anchor, question: q });
  decorateOne(node);          // 父页立即出现 mark + 卡片
  cb.refreshMap && cb.refreshMap();
  if (mode === 'full') cb.navigate(node.id, { rect });
  else {
    // 滚到新卡片
    const card = body.querySelector(`.qa-card[data-node="${node.id}"]`);
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

const fmt = n => n >= 10000 ? (n / 10000).toFixed(1) + ' 万' : n.toLocaleString();

/* ── 正文（当前视图节点）流式填充 ─────────────── */

export function fillBody(node) {
  while (pageSubs.length) pageSubs.pop()();
  const s = getStream(node.id);
  const paintBody = (text) => {
    renderRich(body, text || '');
    decorate();
    wirePageError(node);
  };
  if (s) {
    pageSubs.push(subscribe(node.id, (st) => {
      if (st.status === 'streaming') {
        if (st.text) paintBody(st.text);
        else if (!body.querySelector('.ph')) { body.innerHTML = '<p class="ph">✍️ 正在生成回答…</p>'; }
      } else {
        paintBody(st.text || node.content);
      }
    }));
    if (s.status === 'streaming' && !s.text) body.innerHTML = '<p class="ph">✍️ 正在生成回答…</p>';
  } else if (node.content) {
    paintBody(node.content);
  } else {
    body.innerHTML = '<p class="ph">（空页面）</p>';
  }
}

function wirePageError(node) {
  const s = getStream(node.id);
  if (!s || s.status !== 'error') return;
  const box = document.createElement('div');
  box.className = 'qa-error';
  box.style.marginBottom = '16px';
  box.textContent = '⚠ ' + s.error;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = '重试';
  btn.addEventListener('click', () => retry(node.id));
  box.appendChild(btn);
  body.prepend(box);
}

/* ── 绑定（boot 一次） ────────────────────────── */

export function bind() {
  if (bound) return;
  bound = true;
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousedown', (e) => {
    if (!selmenu.hidden && !e.target.closest('#selmenu')) hideMenu();
    if (!composer.hidden && !e.target.closest('#composer') && !e.target.closest('#selmenu')) {
      // composer 失焦不自动关（可能在选文本），只在点击正文远处时关
      if (e.target.closest('#body') && !pending) closeComposer();
    }
  });
  window.addEventListener('scroll', () => hideMenu(), true);

  selmenu.addEventListener('click', (e) => {
    const btn = e.target.closest('.mi');
    if (!btn || !pending) return;
    openComposer(btn.dataset.act === 'deep' ? 'full' : 'inline');
  });
  $('composer-send').addEventListener('click', sendQuestion);
  $('composer-cancel').addEventListener('click', closeComposer);
  $('composer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuestion(); }
    if (e.key === 'Escape') { e.preventDefault(); closeComposer(); }
  });
  // 点击已划线 → 高亮对应卡片
  document.addEventListener('click', (e) => {
    const m = e.target.closest && e.target.closest('mark.hl');
    if (!m || !body || !body.contains(m)) return;
    const card = body.querySelector(`.qa-card[data-node="${m.dataset.node}"]`);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.remove('flash');
      if (window.gsap) gsap.fromTo(card, { borderColor: '#4ade80' }, { borderColor: '#1a1a2e', duration: 1.2 });
    }
  });
}

export function isOpen() { return !composer.hidden || !selmenu.hidden; }
export function closeAll() { closeComposer(); hideMenu(); }
