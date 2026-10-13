/* settings — AI 配置面板、数据导出/导入、文件选择 */

import { getState, save, exportData, importData } from './store.js';

const $ = id => document.getElementById(id);
let cb = {}; // { reload(), toast(msg, kind) }

export function init(callbacks) {
  cb = callbacks;
  $('btn-settings').addEventListener('click', open);
  $('btn-settings-entry').addEventListener('click', open);
  $('set-cancel').addEventListener('click', close);
  $('set-save').addEventListener('click', onSave);
  $('settings').addEventListener('mousedown', (e) => { if (e.target.id === 'settings') close(); });
  $('set-export').addEventListener('click', exportJson);
  $('set-import').addEventListener('click', importJson);
}

export function needsConfig() {
  const s = getState().settings;
  return !s.baseURL || !s.model;
}

export function open() {
  const s = getState().settings;
  $('set-baseurl').value = s.baseURL || '';
  $('set-key').value = s.apiKey || '';
  $('set-model').value = s.model || '';
  $('set-budget').value = s.budget || 120000;
  $('settings').hidden = false;
  if (window.gsap) {
    gsap.fromTo($('settings').querySelector('.modal'),
      { scale: .95, opacity: 0 }, { scale: 1, opacity: 1, duration: .22, ease: 'power2.out' });
  }
  setTimeout(() => $('set-baseurl').focus(), 60);
}

export function close() { $('settings').hidden = true; }

function onSave() {
  const s = getState().settings;
  s.baseURL = $('set-baseurl').value.trim();
  s.apiKey = $('set-key').value.trim();
  s.model = $('set-model').value.trim();
  s.budget = Math.max(8000, Number($('set-budget').value) || 120000);
  save();
  close();
  cb.toast && cb.toast('设置已保存', 'ok');
}

/* ── 数据导出 / 导入 ──────────────────────────── */

export function exportJson() {
  const data = JSON.stringify(exportData(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'TRead-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  cb.toast && cb.toast('已导出（不含 API Key）', 'ok');
}

export function importJson() {
  pickFile('file-json').then(file => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importData(JSON.parse(reader.result));
        cb.toast && cb.toast('数据已导入', 'ok');
        cb.reload && cb.reload();
      } catch (e) {
        cb.toast && cb.toast('导入失败：' + e.message, 'err');
      }
    };
    reader.readAsText(file, 'utf-8');
  });
}

/* ── 文件选择 ────────────────────────────────── */

function pickFile(inputId) {
  return new Promise(resolve => {
    const input = document.getElementById(inputId);
    if (!input) { resolve(null); return; }
    input.value = '';
    input.onchange = () => { const f = input.files[0]; input.value = ''; resolve(f || null); };
    input.click();
  });
}

export function pickMarkdown() { return pickFile('file-md'); }
