// 和大模型说话（OpenAI 兼容的 /v1/chat/completions）：流式；带工具（function calling），也认 Qwen 写在正文里的 <tool_call>。
//   · 本地：llama-server（http://127.0.0.1:端口），捞捞PPT助手（core/llm.js）和捞捞算力的成品展示（app/show.js）用同一份
//   · 云端：DeepSeek 等（https，带 API Key；core/cloud.js）。地址以 /v1 这类版本号结尾的，直接接 /chat/completions
//   思考模式（DeepSeek 的 reasoning_content）：不当正文显示、不念，单独交给 onThink；工具调用的下一轮要原样带回去（agent.js 会带）
"use strict";
const http = require("http");
const https = require("https");

const endpoint = (base) => { const b = String(base).replace(/\/+$/, ""); return /\/v\d+$/.test(b) ? b + "/chat/completions" : b + "/v1/chat/completions"; };

// 云端常见的出错：说成老师看得懂的话
function httpError(code, body, cloud) {
  let msg = body; try { const j = JSON.parse(body); msg = (j.error && (j.error.message || j.error)) || j.message || body; } catch (e) {}
  msg = String(msg || "").slice(0, 300);
  if (cloud) {
    if (code === 401) return new Error("API Key 不对（401）：检查一下填的 Key 有没有复制全");
    if (code === 402) return new Error("账户余额不足（402）：去开放平台充值，或者先换回本机模型");
    if (code === 429) return new Error("请求太频繁了（429）：等一会儿再问");
    if (code >= 500) return new Error(`AI 服务那边出错了（${code}），等一会儿再试：${msg}`);
  }
  return new Error("AI 助手出错（" + code + "）：" + msg);
}

function chatAt(base, messages, { tools, onDelta, onThink, temperature = 0.3, maxTokens = 1500, model = "local", extra, apiKey, timeoutMs } = {}) {
  let req = null, stopped = false;
  const url = new URL(endpoint(base)), lib = url.protocol === "https:" ? https : http;
  const p = new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, stream: true, ...(temperature != null ? { temperature } : {}), max_tokens: maxTokens, ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
      ...(apiKey ? { stream_options: { include_usage: true } } : {}), ...(extra || {}) });
    const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) };
    req = lib.request(url, { method: "POST", headers }, (res) => {
      if (res.statusCode !== 200) { let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => reject(httpError(res.statusCode, s, !!apiKey))); return; }
      let buf = "", content = "", think = "", usage = null, done = false; const calls = [];
      res.setEncoding("utf8");
      const line = (l) => {
        l = l.trim(); if (!l.startsWith("data:")) return;
        const d = l.slice(5).trim(); if (d === "[DONE]") return;
        let j; try { j = JSON.parse(d); } catch (e) { return; }
        if (j.usage) usage = j.usage;
        const delta = ((j.choices || [])[0] || {}).delta || {};
        if (delta.reasoning_content) { think += delta.reasoning_content; onThink && onThink(delta.reasoning_content); }
        if (delta.content) { content += delta.content; onDelta && onDelta(delta.content); }
        for (const tc of delta.tool_calls || []) {
          const k = tc.index != null ? tc.index : calls.length;
          calls[k] = calls[k] || { id: tc.id || "call_" + k, type: "function", function: { name: "", arguments: "" } };
          if (tc.id) calls[k].id = tc.id;
          if (tc.function && tc.function.name) calls[k].function.name += tc.function.name;
          if (tc.function && tc.function.arguments) calls[k].function.arguments += tc.function.arguments;
        }
      };
      res.on("data", (chunk) => { buf += chunk; const ls = buf.split("\n"); buf = ls.pop(); ls.forEach(line); });
      const end = () => {
        if (done) return; done = true;
        if (buf) line(buf); buf = "";
        const r = finish(content, calls.filter(Boolean));
        if (think) r.reasoning_content = think;
        if (usage) r.usage = usage;
        resolve(r);
      };
      res.on("end", end); res.on("close", end);
      res.on("error", (e) => (stopped ? end() : reject(e)));
    });
    // 云端：一直没有回音（网断了一半）就别干等；思考模式下第一个字可能要等一会儿，所以给得宽一点
    if (timeoutMs) req.setTimeout(timeoutMs, () => { if (!stopped) req.destroy(new Error(`等了 ${Math.round(timeoutMs / 1000)} 秒没有回音`)); });
    req.on("error", (e) => (stopped ? resolve(finish("", [])) : reject(new Error((apiKey ? "连不上 AI 服务：" : "连不上 AI 助手：") + e.message))));
    req.end(body);
  });
  p.abort = () => { stopped = true; try { req && req.destroy(); } catch (e) {} };
  return p;
}

// 模型没走「工具调用」接口、把调用写在正文里（<tool_call>{…}</tool_call>）：也认出来
function finish(content, calls) {
  if (calls.length || !/<tool_call>/.test(content)) return { content: content.trim(), tool_calls: calls };
  const out = [];
  const text = content.replace(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g, (m, j) => {
    try { const o = JSON.parse(j); out.push({ id: "call_t" + out.length, type: "function", function: { name: o.name, arguments: JSON.stringify(o.arguments || o.parameters || {}) } }); } catch (e) {}
    return "";
  });
  return { content: text.trim(), tool_calls: out };
}

module.exports = { chatAt, finish, endpoint };
