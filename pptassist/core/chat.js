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
  return Object.assign(new Error("AI 助手出错（" + code + "）：" + msg), { status: code, raw: msg });
}

// 复读检测：小模型偶尔会卡在一个词上一直重复（「豆腐脑、豆腐脑、豆腐脑……」），一直写到字数上限才停。
//   结尾是同一小段（2~30 字）连着重复 6 遍以上、同一句（8~30 字）重复 4 遍以上、或者同一大段（30~200 字）连着重复 3 遍以上，就算卡住了 → 返回该截断的位置。
//   只看带字的（「|---|---|」表格线、「0, 0, 0」这种不算）
function loopAt(t) {
  const tail = t.slice(-1500), off = t.length - tail.length;
  for (const [re, min] of [[/([\s\S]{2,30}?)\1{5,}[\s\S]{0,30}$/u, 36], [/([\s\S]{8,30}?)\1{3,}[\s\S]{0,30}$/u, 60], [/([\s\S]{30,200}?)\1{2,}[\s\S]{0,200}$/u, 120]]) {
    const m = re.exec(tail);
    if (m && /\p{L}/u.test(m[1]) && m[0].length >= min) return off + m.index + m[1].length;   // 留第一遍
  }
  return -1;
}
// 采样参数不是每个服务都认（有的版本 dry_penalty_last_n 不收 -1、有的不认 dry_*）：
//   报 400 而且点名了某个附加参数 → 记下来（按服务地址），去掉它重发一次；以后对这个服务都不再发
const BAD_EXTRA = new Map();
function chatAt(base, messages, opt = {}) {
  const bad = BAD_EXTRA.get(base);
  const strip = (x) => { if (!x || !bad) return x; const o = { ...x }; for (const k of bad) delete o[k]; return o; };
  let cur = chatOnce(base, messages, { ...opt, extra: strip(opt.extra) }), aborted = false;
  const p = cur.catch((e) => {
    const keys = Object.keys(strip(opt.extra) || {});
    if (aborted || e.status !== 400 || !keys.length) throw e;
    const named = keys.filter((k) => String(e.raw || e.message).includes(k));
    // 没点名但像是参数校验报错（unknown / invalid / must be）：附加的采样参数全去掉试一次
    const drop = named.length ? named : /field|param|unknown|invalid|must be|unrecognized|extra/i.test(String(e.raw || e.message)) ? keys.filter((k) => /^(dry_|repeat_)/.test(k)) : [];
    if (!drop.length) throw e;
    BAD_EXTRA.set(base, new Set([...(bad || []), ...drop]));
    const now = BAD_EXTRA.get(base);
    cur = chatOnce(base, messages, { ...opt, extra: Object.fromEntries(Object.entries(opt.extra).filter(([k]) => !now.has(k))) });
    return cur;
  });
  p.abort = () => { aborted = true; cur.abort(); };
  return p;
}
function chatOnce(base, messages, { tools, onDelta, onThink, temperature = 0.3, maxTokens = 1500, model = "local", extra, apiKey, timeoutMs, loopGuard = true } = {}) {
  let req = null, stopped = false, timedOut = false;
  const url = new URL(endpoint(base)), lib = url.protocol === "https:" ? https : http;
  const p = new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, messages, stream: true, ...(temperature != null ? { temperature } : {}), max_tokens: maxTokens, ...(tools && tools.length ? { tools, tool_choice: "auto" } : {}),
      ...(apiKey ? { stream_options: { include_usage: true } } : {}), ...(extra || {}) });
    const headers = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) };
    req = lib.request(url, { method: "POST", headers }, (res) => {
      if (res.statusCode !== 200) { let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => reject(httpError(res.statusCode, s, !!apiKey))); return; }
      let buf = "", content = "", think = "", usage = null, done = false, checked = 0, looped = false; const calls = [];
      res.setEncoding("utf8");
      const line = (l) => {
        l = l.trim(); if (!l.startsWith("data:")) return;
        const d = l.slice(5).trim(); if (d === "[DONE]") return;
        let j; try { j = JSON.parse(d); } catch (e) { return; }
        if (j.usage) usage = j.usage;
        const delta = ((j.choices || [])[0] || {}).delta || {};
        if (delta.reasoning_content) { think += delta.reasoning_content; onThink && onThink(delta.reasoning_content); }
        if (delta.content) {
          content += delta.content; onDelta && onDelta(delta.content);
          if (loopGuard && content.length - checked >= 40) {
            checked = content.length;
            const cut = loopAt(content);
            if (cut > 0) { content = content.slice(0, cut).replace(/[、，,\s]+$/, "") + "……"; looped = true; onDelta && onDelta("\n\n（后面在重复同样的话，先停下了）"); stopped = true; try { req.destroy(); } catch (e) {} end(); }
          }
        }
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
        if (looped) r.looped = true;
        resolve(r);
      };
      res.on("end", end); res.on("close", end);
      // 连接中途断了（res 报 aborted）：说人话；等太久被我们自己掐断的，报「等了多久」
      res.on("error", (e) => (stopped ? end() : reject(timedOut ? new Error(`等了 ${Math.round(timeoutMs / 1000)} 秒没有回音（网络不稳，或者一次要写的内容太长）`) : /aborted|ECONNRESET|socket hang up/i.test(e.message) ? Object.assign(new Error("和 AI 服务的连接中途断了（网络不稳，或者一次要写的内容太长）：再发一次试试；要做很长的文件可以说「分成几个文件」"), { cut: true }) : e)));
    });
    // 云端：一直没有回音（网断了一半）就别干等；思考模式下第一个字可能要等一会儿，所以给得宽一点
    if (timeoutMs) req.setTimeout(timeoutMs, () => { if (!stopped) { timedOut = true; req.destroy(new Error(`等了 ${Math.round(timeoutMs / 1000)} 秒没有回音`)); } });
    req.on("error", (e) => (stopped ? resolve(finish("", [])) : reject(Object.assign(new Error((apiKey ? "连不上 AI 服务：" : "连不上 AI 助手：") + (timedOut ? `等了 ${Math.round(timeoutMs / 1000)} 秒没有回音` : e.message)), { cut: /ECONNRESET|socket hang up|aborted/i.test(e.message) }))));
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

module.exports = { chatAt, finish, endpoint, loopAt, BAD_EXTRA };
