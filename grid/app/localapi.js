// 捞小智 · 本机大模型接口（OpenAI 兼容：/v1/models、/v1/chat/completions）
//   给捞捞思维导图（学习捞捞队的模块）用：它本身就能接「自定义兼容接口」，只是原来只能填外面平台的地址和 Key。
//   这里在本机开一个同样格式的接口，背后是捞小智（训练、考试通过的 LoRA 自动换上），导图里提问、生成、复核都由本机模型回答，
//   回答照样按导图自己的方式变成节点。不改导图模块的代码：一键接入走的是它自己的 /api/ai/config 接口，填「自定义接口」那一栏。
//   · 只听 127.0.0.1；要带 Key（本机随机生成，存在 dir/localapi.json）
//   · 这台电脑在算训练任务时回 503，说清楚原因；请求里要的输出太长就截到本机放得下的长度
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const MODEL = "laolao-xiaozhi";
const PORT = 18321;

function create(o) {
  const F = path.join(o.dir(), "localapi.json");
  let st = {};
  try { st = JSON.parse(fs.readFileSync(F, "utf8")); } catch (e) {}
  if (!st.key) { st.key = "lx-" + crypto.randomBytes(18).toString("hex"); saveSt(); }
  function saveSt() { try { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify(st, null, 1)); } catch (e) {} }
  let server = null, port = null, served = 0;
  const log = (m) => { try { o.log && o.log("本机接口：" + m); } catch (e) {} };
  const json = (res, code, v) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(v)); };
  const err = (res, code, msg, type = "server_error") => json(res, code, { error: { message: msg, type } });

  // 网页版的思维导图（在浏览器里跑）也能接：只放行捞捞自己的网站和本机页面；公网页面访问本机要回 Private-Network 那一项
  const okOrigin = (x) => /^https:\/\/([a-z0-9-]+\.)*laolaokechengbiao\.cn$/i.test(x) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(x);
  async function handle(req, res) {
    const origin = req.headers.origin;
    if (origin) {
      if (!okOrigin(origin)) { req.resume(); return err(res, 403, "只给捞捞的网站和本机页面用", "invalid_request_error"); }
      res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") {
        res.writeHead(204, { "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600" });
        return res.end();
      }
    }
    const u = (req.url || "").split("?")[0].replace(/\/+$/, "");
    if (u === "/v1/models" || u === "/models") return json(res, 200, { object: "list", data: [{ id: MODEL, object: "model", owned_by: "laolao" }] });
    if (u !== "/v1/chat/completions" && u !== "/chat/completions") return err(res, 404, "没有这个接口（只有 /v1/models、/v1/chat/completions）", "invalid_request_error");
    if (req.method !== "POST") return err(res, 405, "要用 POST", "invalid_request_error");
    if ((req.headers.authorization || "") !== "Bearer " + st.key) { req.resume(); return err(res, 401, "Key 不对：在捞小智「接入思维导图」里看本机的 Key", "invalid_api_key"); }
    let size = 0; const parts = [];
    for await (const c of req) { size += c.length; if (size > 24e6) return err(res, 413, "请求太大", "invalid_request_error"); parts.push(c); }
    let body; try { body = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch (e) { return err(res, 400, "不是 JSON", "invalid_request_error"); }
    if (!Array.isArray(body.messages)) return err(res, 400, "缺 messages", "invalid_request_error");
    const busy = o.busy && o.busy();
    if (busy) return err(res, 503, `这台电脑正在算「${busy}」，显卡腾不出来：在捞捞算力里先暂停计算再试`);
    const eyes = body.messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c && c.type === "image_url"));
    let be;
    try { be = await o.backend({ eyes }); } catch (e) { return err(res, 503, "本机大模型没启动起来：" + e.message); }
    // 输出长度：导图那边默认要几千到几万 token；本机上下文放不下那么多，截到 maxOut
    const maxOut = o.maxOut || 4096;
    const out = { ...body, model: "local", max_tokens: Math.min(+body.max_tokens || +body.max_completion_tokens || maxOut, maxOut) };
    delete out.max_completion_tokens;
    if (be.extra) Object.assign(out, be.extra);
    const data = Buffer.from(JSON.stringify(out));
    served++;
    const up = http.request(be.url.replace(/\/+$/, "") + "/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": data.length } }, (r) => {
      res.writeHead(r.statusCode, { "Content-Type": r.headers["content-type"] || "application/json", "Cache-Control": "no-store" });
      r.pipe(res);
      r.on("error", () => res.end());
    });
    up.on("error", (e) => { if (!res.headersSent) err(res, 502, "本机大模型没回应：" + e.message); else res.end(); });
    res.on("close", () => { if (!res.writableEnded) up.destroy(); });
    up.end(data);
    try { o.touch && o.touch(); } catch (e) {}
  }

  function start() {
    if (server) return Promise.resolve(port);
    const base = o.port || PORT;
    return new Promise((resolve, reject) => {
      let p = base;
      const s = http.createServer((q, r) => handle(q, r).catch((e) => { if (!r.headersSent) err(r, 500, e.message); else r.end(); }));
      s.on("error", (e) => { if (e.code === "EADDRINUSE" && p < base + 5) { p++; s.listen(p, "127.0.0.1"); } else reject(e); });
      s.listen(p, "127.0.0.1", () => { server = s; port = p; st.on = true; saveSt(); log("开在 127.0.0.1:" + p); resolve(p); });
    });
  }
  function stop(remember = true) { if (server) { try { server.close(); } catch (e) {} } server = null; port = null; if (remember) { st.on = false; saveSt(); } }
  const info = () => ({ on: !!server, url: port ? `http://127.0.0.1:${port}/v1` : null, model: MODEL, key: st.key, served, connected: st.connected || null });

  // ---------- 一键接入捞捞思维导图：用它自己的 /api/ai/config，把「自定义接口」填成本机接口并设为正在用的；记下原来用的哪一家，断开时换回去 ----------
  function mmReq(mport, method, p, body) {
    return new Promise((resolve, reject) => {
      const d = body ? Buffer.from(JSON.stringify(body)) : null;
      const r = http.request({ host: "127.0.0.1", port: mport, method, path: p, timeout: 8000, headers: d ? { "Content-Type": "application/json", "Content-Length": d.length } : {} }, (res) => {
        let s = ""; res.setEncoding("utf8"); res.on("data", (c) => (s += c));
        res.on("end", () => { let j = null; try { j = JSON.parse(s); } catch (e) {} res.statusCode >= 400 ? reject(new Error((j && j.error) || "思维导图回了 " + res.statusCode)) : resolve(j); });
      });
      r.on("timeout", () => r.destroy(new Error("思维导图没响应"))); r.on("error", reject); r.end(d);
    });
  }
  const keep = (cfg) => Object.fromEntries(Object.entries(cfg.profiles).map(([k, p]) => [k, { baseURL: p.baseURL, model: p.model, maxOutputTokens: p.maxOutputTokens }]));
  async function connect(mindmap) {
    const p = await start();   // 先把接口开起来：自动填不了时，用户照着手动填也能用
    const mport = await mindmap.find();
    if (!mport) throw new Error("没找到正在运行的捞捞思维导图：先在捞捞课程表电脑版里打开「思维导图」（或者启动独立版），再点接入；也可以在导图的大模型设置里手动填下面这些");
    const cfg = await mmReq(mport, "GET", "/api/ai/config");
    if (cfg && cfg.shared) throw Object.assign(new Error("这份思维导图用的是「课内学习」的统一 AI 设置，没法从这边自动填：在课程顶栏的 AI 设置里选「自定义接口」，把下面的地址、模型、Key 填进去保存就行"), { manual: info() });
    if (!cfg || !cfg.profiles || !cfg.profiles.custom) throw Object.assign(new Error("这个版本的思维导图没有「自定义接口」一栏，没法自动填：在它的大模型设置里手动填下面的地址、模型、Key"), { manual: info() });
    const was = cfg.activeProvider === "custom" && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(cfg.profiles.custom.baseURL) ? (st.connected && st.connected.was) || "deepseek" : cfg.activeProvider;
    const wasCustom = cfg.activeProvider === "custom" && !/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(cfg.profiles.custom.baseURL) ? cfg.profiles.custom : (st.connected && st.connected.wasCustom) || null;
    const profiles = keep(cfg);
    profiles.custom = { baseURL: `http://127.0.0.1:${p}/v1`, model: MODEL, apiKey: st.key, maxOutputTokens: Math.max(1024, o.maxOut || 4096) };
    await mmReq(mport, "PUT", "/api/ai/config", { revision: cfg.revision, activeProvider: "custom", profiles });
    st.connected = { at: Date.now(), port: mport, was, wasCustom: wasCustom ? { baseURL: wasCustom.baseURL, model: wasCustom.model } : null }; saveSt();
    log("接入了思维导图（127.0.0.1:" + mport + "），原来用的是 " + was);
    return info();
  }
  async function disconnect(mindmap) {
    const mport = await mindmap.find();
    if (mport && st.connected) {
      const cfg = await mmReq(mport, "GET", "/api/ai/config");
      const profiles = keep(cfg);
      // 自定义那一栏：原来填的是别的平台就填回去（Key 要用户自己再填一次：我们没存别人的 Key），原来空着就清空
      profiles.custom = st.connected.wasCustom ? { ...st.connected.wasCustom, clearKey: true } : { baseURL: "", model: "", clearKey: true };
      await mmReq(mport, "PUT", "/api/ai/config", { revision: cfg.revision, activeProvider: st.connected.was || "deepseek", profiles });
    }
    st.connected = null; saveSt(); stop();
    return info();
  }
  if (st.on) start().catch((e) => log("没开起来：" + e.message));
  return { start, stop, info, connect, disconnect, key: () => st.key };
}

module.exports = { create, MODEL, PORT };
