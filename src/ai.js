/* ai — OpenAI 兼容 /chat/completions 流式客户端 (SSE) */

export function hasSettings(settings) {
  return Boolean(settings && settings.baseURL && settings.model);
}

/**
 * 流式对话。yield 增量文本。
 * @param {Array<{role,content}>} messages
 * @param {{baseURL,apiKey,model}} settings
 * @param {AbortSignal} signal
 */
export async function* streamChat(messages, settings, signal) {
  if (!settings.baseURL) throw new Error('尚未配置 Base URL（右上角 ⚙ 设置）');
  if (!settings.model) throw new Error('尚未配置模型名（右上角 ⚙ 设置）');

  const url = settings.baseURL.replace(/\/+$/, '') + '/chat/completions';
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { Authorization: 'Bearer ' + settings.apiKey } : {}),
      },
      body: JSON.stringify({ model: settings.model, messages, stream: true }),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('网络错误：' + e.message + '（若为 CORS 拒绝，需改用可跨域的端点）');
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`HTTP ${res.status} ${res.statusText}${detail ? ' — ' + detail : ''}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      // 兼容 data: 前多空格 / 批量行
      try {
        const j = JSON.parse(data);
        const delta = j.choices && j.choices[0] && j.choices[0].delta;
        if (delta && delta.content) yield delta.content;
      } catch (e) { /* 不完整的行留给下一轮 */ }
    }
  }
}

/** 非流式小请求（连通性测试用） */
export async function ping(settings, signal) {
  const url = settings.baseURL.replace(/\/+$/, '') + '/chat/completions';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(settings.apiKey ? { Authorization: 'Bearer ' + settings.apiKey } : {}),
    },
    body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
    signal,
  });
  return { ok: res.ok, status: res.status, statusText: res.statusText };
}
