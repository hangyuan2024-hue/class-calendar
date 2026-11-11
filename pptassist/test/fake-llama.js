// 假的 llama-server（测试用）：/health；/v1/chat/completions 流式，按老师说的话给出固定的回答或工具调用
"use strict";
const http = require("http");
function start(port) {
  const st = { reqs: [] };
  const srv = http.createServer((q, r) => {
    if (q.url === "/health") { r.writeHead(200, { "content-type": "application/json" }); return r.end('{"status":"ok"}'); }
    let b = ""; q.on("data", (c) => (b += c));
    q.on("end", () => {
      const body = JSON.parse(b || "{}"); st.reqs.push(body);
      const ms = body.messages || [], last = ms[ms.length - 1] || {};
      const txt = (m) => (Array.isArray(m.content) ? m.content.filter((c) => c.type === "text").map((c) => c.text).join("") : m.content || "");
      r.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta) => r.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      const words = (s) => { for (const w of s.match(/.{1,3}/gs) || []) send({ content: w }); };
      const call = (name, args, i = 0) => { const a = JSON.stringify(args); send({ tool_calls: [{ index: i, id: "c" + i + Date.now(), function: { name, arguments: "" } }] }); for (let k = 0; k < a.length; k += 7) send({ tool_calls: [{ index: i, function: { arguments: a.slice(k, k + 7) } }] }); };
      const sys = txt(ms[0] || {});
      if (/LaTeX。只输出/.test(sys)) words("$$\\frac{a+b}{2}\\ge\\sqrt{ab}$$");
      else if (last.role === "tool") {
        const prev = ms.filter((m) => m.role === "tool").length;
        if (last.name === "get_outline" && /标题/.test(txt(ms.filter((m) => m.role === "user").pop()))) call("set_text", { slide: 2, shape: "title", lines: ["冒泡排序（新）"] });
        else words(`好了，${last.name === "add_slide" ? "加好了一页" : last.name === "insert_formula" ? "公式插好了" : "改好了"}。（第 ${prev} 步）`);
      } else {
        const t = txt(last);
        if (/加一页/.test(t)) { words("好的，我来加一页。"); call("add_slide", { after: 2, title: "小结", lines: ["相邻比较", "大的往后换"] }); }
        else if (/公式/.test(t)) words('我来插公式。<tool_call>{"name":"insert_formula","arguments":{"slide":2,"latex":"E=mc^2","where":"bottom"}}</tool_call>');
        else if (/标题/.test(t)) call("get_outline", {});
        else if (/删/.test(t)) words("确定要删第 2 页吗？");
        else if (/慢/.test(t)) { let k = 0; const iv = setInterval(() => { send({ content: "字" }); if (++k > 200) { clearInterval(iv); r.end("data: [DONE]\n\n"); } }, 20); r.on("close", () => clearInterval(iv)); return; }
        else words("你好，我是捞捞。");
      }
      r.end("data: [DONE]\n\n");
    });
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok({ st, close: () => srv.close() })));
}
module.exports = { start };
