/* mapdrawer — 右侧拓扑地图：树形缩进 + hover tooltip + 点击跳转 */

import { getState, childrenOf, onChange } from './store.js';

const $ = id => document.getElementById(id);
const drawer = $('mapdrawer'), scrim = $('drawer-scrim'), treeEl = $('map-tree'), tip = $('tooltip');
let cb = {};   // { navigate(id) }
let opened = false;

export function init(callbacks) {
  cb = callbacks;
  $('map-close').addEventListener('click', close);
  scrim.addEventListener('click', close);
  onChange(() => { if (opened) refresh(); });
  treeEl.addEventListener('click', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    close();
    cb.navigate(row.dataset.id, {});
  });
  treeEl.addEventListener('mouseover', (e) => {
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const n = getState().nodes[row.dataset.id];
    if (!n) return;
    tip.textContent = n.kind === 'doc' ? '📄 ' + n.title : '💬 ' + n.title;
    tip.hidden = false;
    moveTip(e);
  });
  treeEl.addEventListener('mousemove', (e) => { if (!tip.hidden) moveTip(e); });
  treeEl.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest('.tree-row')) tip.hidden = true;
  });
}

function moveTip(e) {
  const pad = 14;
  let x = e.clientX + pad, y = e.clientY + pad;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  if (x + w > innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

export function refresh() {
  const st = getState();
  treeEl.textContent = '';
  if (!st.roots.length) {
    treeEl.innerHTML = '<div class="tree-empty">还没有文档</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  for (const rootId of st.roots) buildGroup(rootId, frag, st.currentId);
  treeEl.appendChild(frag);
}

function buildGroup(id, parent, currentId) {
  const st = getState();
  const node = st.nodes[id];
  if (!node) return;
  const group = document.createElement('div');
  group.className = 'tree-group';
  const row = document.createElement('div');
  row.className = 'tree-row' + (id === currentId ? ' cur' : '');
  row.dataset.id = id;
  const ti = document.createElement('span');
  ti.className = 'ti';
  ti.textContent = node.kind === 'doc' ? '📄' : '💬';
  const tt = document.createElement('span');
  tt.className = 'tt';
  tt.textContent = node.title || '（无标题）';
  const del = document.createElement('button');
  del.className = 'tree-del';
  del.type = 'button';
  del.textContent = '✕';
  del.title = '删除该节点（含其下全部提问）';
  del.addEventListener('click', (e) => {
    e.stopPropagation();                 // 别顺带跳转到这一页
    if (cb.remove) cb.remove(id, node.title);
  });
  row.append(ti, tt, del);
  group.appendChild(row);

  const kids = childrenOf(id);
  if (kids.length) {
    const box = document.createElement('div');
    box.className = 'tree-children';
    for (const k of kids) buildGroup(k.id, box, currentId);
    group.appendChild(box);
  }
  parent.appendChild(group);
}

export function toggle() { opened ? close() : open(); }

export function open() {
  refresh();
  opened = true;
  drawer.hidden = false;
  scrim.hidden = false;
  tip.hidden = true;
  if (window.gsap) {
    gsap.fromTo(drawer, { x: '100%' }, { x: 0, duration: .38, ease: 'power3.out' });
    gsap.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: .3 });
    gsap.fromTo(treeEl.querySelectorAll('.tree-row'),
      { x: 16, opacity: 0 }, { x: 0, opacity: 1, duration: .3, stagger: .015, delay: .08, ease: 'power2.out' });
  }
}

export function close() {
  if (!opened) return;
  opened = false;
  tip.hidden = true;
  const done = () => { drawer.hidden = true; scrim.hidden = true; };
  if (window.gsap) {
    gsap.to(drawer, { x: '100%', duration: .28, ease: 'power2.in', onComplete: done });
    gsap.to(scrim, { opacity: 0, duration: .25, onComplete: () => { scrim.hidden = true; } });
  } else done();
}

export function isOpen() { return opened; }
