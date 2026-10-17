/* app — 引导、导航、视图渲染与转场、入口屏 */

import { getState, save, onChange, createNode, childrenOf, pathToRoot } from './store.js';
import * as annotate from './annotate.js';
import * as mapdrawer from './mapdrawer.js';
import * as settings from './settings.js';

const $ = id => document.getElementById(id);
const els = {};

function cacheEls() {
  ['entry', 'app', 'body', 'page', 'page-title', 'page-sub', 'topbar', 'crumbs',
   'btn-back', 'btn-map', 'btn-open', 'btn-export', 'btn-import', 'entry-roots',
   'entry-hint', 'toast', 'btn-theme', 'btn-theme-entry'].forEach(id => els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = $(id));
}

/* ── toast ───────────────────────────────────── */
let toastTimer = null;
function toast(msg, kind = '') {
  const t = els.toast;
  t.textContent = msg;
  t.className = kind;
  t.hidden = false;
  if (window.gsap) gsap.fromTo(t, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: .25, ease: 'power2.out' });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (window.gsap) gsap.to(t, { opacity: 0, duration: .3, onComplete: () => { t.hidden = true; } });
    else t.hidden = true;
  }, 2600);
}

/* ── 主题（深/浅，token 一处切换） ──────────── */

// 语法高亮主题跟着明暗切：浅色下块级代码用 github 浅色语法色（vendor/github.min.css），
// 页面 head 里已按 localStorage 预先切好一次，这里负责后续手动切换
function applyHighlightTheme(t) {
  const light = document.getElementById('hljs-light');
  const dark = document.getElementById('hljs-dark');
  if (light) light.disabled = t !== 'light';
  if (dark) dark.disabled = t === 'light';
}

function applyTheme(t) {
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  applyHighlightTheme(t);
  const icon = t === 'light' ? '☀️' : '🌙';
  els.btnTheme.textContent = icon;
  els.btnThemeEntry.textContent = icon;
  const s = st().settings;
  if (s.theme !== t) { s.theme = t; save(); }
}

function toggleTheme(e) {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  const root = document.documentElement;
  const run = () => applyTheme(next);
  if (!document.startViewTransition) { run(); return; }  // 老引擎直接切
  // 涟漪：从点击位置圆形展开覆盖全屏
  const x = (e && e.clientX) || innerWidth - 40;
  const y = (e && e.clientY) || 40;
  const r = Math.ceil(Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)));
  root.style.setProperty('--tr-x', x + 'px');
  root.style.setProperty('--tr-y', y + 'px');
  root.style.setProperty('--tr-r', r + 'px');
  try { document.startViewTransition(run); } catch (err) { run(); }
}

/* ── 自定义确认框（Promise 化，替代原生 confirm） ── */

function confirmDialog(message, okLabel = '删除') {
  return new Promise(resolve => {
    const scrim = $('confirm');
    $('confirm-msg').textContent = message;
    $('confirm-ok').textContent = okLabel;
    scrim.hidden = false;
    if (window.gsap) {
      gsap.fromTo(scrim.querySelector('.modal'),
        { scale: .95, opacity: 0 }, { scale: 1, opacity: 1, duration: .2, ease: 'power2.out' });
    }
    const ok = $('confirm-ok'), cancel = $('confirm-cancel');
    function close(v) {
      scrim.hidden = true;
      ok.removeEventListener('click', onOk);
      cancel.removeEventListener('click', onCancel);
      scrim.removeEventListener('mousedown', onBackdrop);
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    }
    function onOk() { close(true); }
    function onCancel() { close(false); }
    function onBackdrop(e) { if (e.target === scrim) close(false); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
    }
    ok.addEventListener('click', onOk);
    cancel.addEventListener('click', onCancel);
    scrim.addEventListener('mousedown', onBackdrop);
    document.addEventListener('keydown', onKey, true);
    cancel.focus();
  });
}

/* ── 屏幕切换 ────────────────────────────────── */

function showScreen(name) {
  els.entry.hidden = name !== 'entry';
  els.app.hidden = name !== 'app';
}

/* ── 入口屏 ──────────────────────────────────── */

function renderEntry() {
  const st = getState();
  els.entryRoots.textContent = '';
  els.entryHint.hidden = st.roots.length > 0;
  for (const id of st.roots) {
    const n = st.nodes[id];
    if (!n) continue;
    const card = document.createElement('button');
    card.className = 'root-card';
    const h = document.createElement('h3');
    h.textContent = '📄 ' + n.title;
    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = `${n.content.length.toLocaleString()} 字 · ${childrenOf(id).length} 个提问`;
    card.append(h, m);
    card.addEventListener('click', () => show(id));
    els.entryRoots.appendChild(card);
  }
}

function goEntry() {
  st().currentId = null;
  save();
  renderEntry();
  showScreen('entry');
}

async function openFile() {
  const file = await settings.pickMarkdown();
  if (!file) return;
  const text = await file.text();
  const node = createNode({ kind: 'doc', title: file.name, content: text });
  toast('已打开 ' + file.name, 'ok');
  show(node.id);
}

/* ── 视图渲染 ────────────────────────────────── */

const st = () => getState();

function show(id, { rect } = {}) {
  const state = st();
  const node = state.nodes[id];
  if (!node) { goEntry(); return; }

  state.currentId = id;
  save();
  showScreen('app');
  els.app.dataset.kind = node.kind;

  els.pageTitle.textContent = node.title;
  els.pageSub.textContent = node.kind === 'doc'
    ? `📄 文档 · ${node.content.length.toLocaleString()} 字 · ${pathToRoot(id).length === 1 ? '根节点' : ''}`
    : `💬 提问 · ${new Date(node.createdAt).toLocaleString()}`;

  annotate.setView(els.body, id);
  annotate.fillBody(node);
  updateChrome(id);

  animateIn(rect);
  if (mapdrawer.isOpen()) mapdrawer.refresh();
}

function rerender() {
  const id = st().currentId;
  if (id) show(id);
  else goEntry();
}

function updateChrome(id) {
  // 面包屑
  const path = pathToRoot(id);
  els.crumbs.textContent = '';
  path.forEach((n, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '›';
      els.crumbs.appendChild(sep);
    }
    const c = document.createElement('span');
    c.className = 'crumb' + (n.id === id ? ' cur' : '');
    c.textContent = n.title.length > 18 ? n.title.slice(0, 18) + '…' : n.title;
    if (n.id !== id) c.addEventListener('click', () => show(n.id));
    els.crumbs.appendChild(c);
  });
}

/* ── 转场 ────────────────────────────────────── */

function animateIn(rect) {
  if (!window.gsap) return;
  gsap.killTweensOf(els.page);
  if (rect && rect.width > 2) {
    const x = ((rect.left + rect.width / 2) / innerWidth * 100).toFixed(1);
    const y = ((rect.top + rect.height / 2) / innerHeight * 100).toFixed(1);
    gsap.fromTo(els.page,
      { clipPath: `circle(0% at ${x}% ${y}%)`, webkitClipPath: `circle(0% at ${x}% ${y}%)` },
      { clipPath: 'circle(150% at ' + x + '% ' + y + '%)', webkitClipPath: 'circle(150% at ' + x + '% ' + y + '%)',
        duration: .5, ease: 'power3.out' });
    const reading = els.page.querySelector('.reading');
    gsap.fromTo(reading, { opacity: 0 }, { opacity: 1, duration: .3, delay: .08 });
  } else {
    gsap.fromTo(els.page, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .32, ease: 'power2.out' });
  }
}

/* ── 导航 ────────────────────────────────────── */

function navigate(id, opts = {}) {
  if (!st().nodes[id]) return;
  if (mapdrawer.isOpen()) mapdrawer.close();
  annotate.closeAll();
  show(id, opts);
}

function goBack() {
  const cur = st().nodes[st().currentId];
  if (cur && cur.parentId) navigate(cur.parentId);
  else goEntry();
}

/* ── 键盘 ────────────────────────────────────── */

function onKey(e) {
  if (e.key !== 'Escape') return;
  if (!$('settings').hidden) { settings.close(); return; }
  if (annotate.isOpen()) { annotate.closeAll(); return; }
  if (mapdrawer.isOpen()) { mapdrawer.close(); return; }
}

/* ── 启动 ────────────────────────────────────── */

function boot() {
  cacheEls();

  annotate.init({ navigate, refreshMap: () => mapdrawer.refresh(), rerender, toast, confirm: confirmDialog });
  annotate.setDocks($('dock-left'), $('dock-right'));
  mapdrawer.init({ navigate });
  settings.init({ reload, toast });

  els.btnBack.addEventListener('click', goBack);
  els.btnMap.addEventListener('click', () => mapdrawer.toggle());
  els.btnTheme.addEventListener('click', toggleTheme);
  els.btnThemeEntry.addEventListener('click', toggleTheme);
  els.btnOpen.addEventListener('click', openFile);
  els.btnExport.addEventListener('click', settings.exportJson);
  els.btnImport.addEventListener('click', settings.importJson);
  document.addEventListener('keydown', onKey);
  // 窗口跨过停靠断点（1340px）时重排：宽屏旁注 / 窄屏行内
  let wasWide = innerWidth >= 1340, resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const isWide = innerWidth >= 1340;
      if (isWide !== wasWide) {
        wasWide = isWide;
        if (!els.app.hidden) rerender();
      }
    }, 250);
  });
  // 原生右键菜单：除输入框外全部禁用（代码块也禁，复制走选区「复制」或 Ctrl+C）
  document.addEventListener('contextmenu', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('textarea, input, [contenteditable="true"]')) return;
    e.preventDefault();
  });
  onChange(() => { if (!els.entry.hidden) renderEntry(); });

  annotate.bind();

  reload();

  applyTheme(st().settings.theme === 'light' ? 'light' : 'dark');

  if (settings.needsConfig()) {
    settings.open();
    toast('先配置 AI 端点（OpenAI 兼容）');
  }
}

function reload() {
  const state = st();
  applyTheme(state.settings.theme === 'light' ? 'light' : 'dark');
  if (state.currentId && state.nodes[state.currentId]) show(state.currentId);
  else goEntry();
}

boot();
