// 和本地大模型（llama-server，OpenAI 兼容的 /v1/chat/completions）说话：流式；带工具（function calling），也认 Qwen 写在正文里的 <tool_call>。
//   捞捞PPT助手（core/llm.js）和捞捞算力的成品展示（app/show.js）用同一份。
"use strict";
const http = require("http");

function chatAt(base, messages, { tools, onDelta, temperature = 0.3, maxTokens = 1500, model = "local", extra } = {}) {
  let req = null, stopped = false;
  const p = new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, stream: true, temperature, max_tokens: maxTokens, ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}), ...(extra || {}) });
    req = http.request(String(base).replace(/\/+$/, "") + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => {
      if (res.statusCode !== 200) { let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => reject(new Error("AI 助手出错（" + res.statusCode + "）：" + s.slice(0, 300)))); return; }
      let buf = "", content = ""; const calls = [];
      res.setEncoding("utf8");
      const line = (l) => {
        l = l.trim(); if (!l.startsWith("data:")) return;
        const d = l.slice(5).trim(); if (d === "[DONE]") return;
        let j; try { j = JSON.parse(d); } catch (e) { return; }
        const delta = ((j.choices || [])[0] || {}).delta || {};
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
      const end = () => { if (buf) line(buf); buf = ""; resolve(finish(content, calls.filter(Boolean))); };
      res.on("end", end); res.on("close", end);
      res.on("error", (e) => (stopped ? end() : reject(e)));
    });
    req.on("error", (e) => (stopped ? resolve(finish("", [])) : reject(new Error("连不上 AI 助手：" + e.message))));
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

module.exports = { chatAt, finish };
