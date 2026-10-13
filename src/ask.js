/* ask — 提问生命周期：创建 qa 节点 → 继承上下文 → 流式回答 → 订阅/重试
 *
 * streams: nodeId -> { status:'streaming'|'done'|'error'|'aborted', text, error, controller, subs }
 * 多视图（父页卡片 + 子页正文）可同时订阅同一 stream。
 */

import { getState, createNode, messagesFor, save } from './store.js';
import { streamChat } from './ai.js';

const streams = new Map();

export function getStream(id) { return streams.get(id); }

export function subscribe(id, fn) {
  const s = streams.get(id);
  if (!s) return () => {};            // 无活动流：内容由调用方直接渲染
  s.subs.add(fn);
  fn(s);
  return () => s.subs.delete(fn);
}

function notify(s) {
  for (const fn of s.subs) {
    try { fn(s); } catch (e) { console.warn('[ask] subscriber', e); }
  }
}

/** 从划线锚点重建送给 LLM 的划线引文 */
function quoteOf(node) {
  const a = node.anchor;
  if (!a || !a.text) return '';
  return '…' + (a.before || '') + ' ≪' + a.text + '≫ ' + (a.after || '') + '…';
}

/**
 * 提问：创建子节点并启动流。
 * @returns 新节点
 */
export function ask({ parentId, anchor, question }) {
  const node = createNode({ parentId, kind: 'qa', title: question, content: '', anchor });
  const s = {
    status: 'streaming', text: '', error: '',
    controller: new AbortController(), subs: new Set(),
  };
  streams.set(node.id, s);
  run(node, s);
  return node;
}

export function retry(id) {
  const node = getState().nodes[id];
  const s = streams.get(id);
  if (!node || !s) return;
  s.controller = new AbortController();
  run(node, s);
}

export function abort(id) {
  const s = streams.get(id);
  if (s && s.status === 'streaming') s.controller.abort();
}

async function run(node, s) {
  s.status = 'streaming';
  s.error = '';
  s.text = '';
  notify(s);
  try {
    const msgs = messagesFor(node.parentId, quoteOf(node), node.title);
    console.info('[ctx] 发送 messages=', msgs.length,
      '上下文字符≈', msgs.reduce((n, m) => n + m.content.length, 0),
      '| 问题:', node.title.slice(0, 40));
    let sinceSave = 0;
    for await (const chunk of streamChat(msgs, getState().settings, s.controller.signal)) {
      s.text += chunk;
      node.content = s.text;
      notify(s);
      sinceSave += chunk.length;
      if (sinceSave > 800) { sinceSave = 0; save(); }
    }
    s.status = 'done';
    node.content = s.text;
    if (!s.text) s.text = node.content;
    save();
  } catch (e) {
    if (e && e.name === 'AbortError') {
      s.status = 'aborted';
      node.content = s.text;
      save();
    } else {
      s.status = 'error';
      s.error = (e && e.message) || String(e);
      node.content = s.text;
      save();
      console.warn('[ask] stream error', e);
    }
  }
  notify(s);
}
