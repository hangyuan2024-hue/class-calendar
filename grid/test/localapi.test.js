// 捞小智本机接口（app/localapi.js）× 捞捞思维导图：
//   导图模块原样跑（learn/mindmap/server.js，不改它的代码）；一键接入走它自己的 /api/ai/config，把「自定义接口」填成本机接口；
//   然后用导图自己的「测试连接」（/api/ai/test，它自己的代码去请求）证明它真的在用捞小智回答；流式也能透传；Key 不对拒绝；在算任务时 503；断开换回原来的平台
"use strict";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), net = require("net");
const { spawn } = require("child_process");
const API = require("../app/localapi");
const MM = require("../app/ppt/mindmap.js");
const MOD = path.join(__dirname, "..", "..", "learn", "mindmap");
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const call = (port, method, p, body, headers = {}) => new Promise((resolve, reject) => {
  const d = body ? Buffer.from(JSON.stringify(body)) : null;
  const r = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...(d ? { "Content-Type": "application/json", "Content-Length": d.length } : {}), ...headers } }, (res) => { let s = ""; res.on("data", (c) => (s += c)); res.on("end", () => resolve({ status: res.statusCode, text: s, json: (() => { try { return JSON.parse(s); } catch (e) { return null; } })() })); });
  r.on("error", reject); r.end(d);
});

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lapi-"));
  // 假的本机大模型（llama-server）
  const seen = [];
  const llama = http.createServer((q, r) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
    const body = JSON.parse(b); seen.push(body);
    if (body.stream) { r.writeHead(200, { "Content-Type": "text/event-stream" }); for (const w of ["数组是", "一组同类型的变量。"]) r.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`); return r.end("data: [DONE]\n\n"); }
    r.writeHead(200, { "Content-Type": "application/json" }); r.end(JSON.stringify({ model: "local", choices: [{ message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }));
  }); });
  await new Promise((d) => llama.listen(0, "127.0.0.1", d));
  let busy = null, starts = 0;
  const api = API.create({ dir: () => tmp, port: await freePort(), busy: () => busy, backend: async ({ eyes }) => { starts++; return { url: `http://127.0.0.1:${llama.address().port}`, extra: eyes ? { x_eyes: true } : null }; } });

  // 导图模块自己的服务，先填好一家外面的平台（假装用户原来用 DeepSeek）
  const mport = await freePort();
  const env = { ...process.env, MM_PORT: String(mport), MM_STORAGE_DIR: path.join(tmp, "maps"), MM_AI_CONFIG_FILE: path.join(tmp, "ai-config.json") };
  fs.writeFileSync(env.MM_AI_CONFIG_FILE, JSON.stringify({ version: 1, activeProvider: "deepseek", profiles: { deepseek: { baseURL: "https://api.deepseek.com", model: "deepseek-chat", apiKey: "sk-user-own" }, glm: { baseURL: "https://open.bigmodel.cn/api/paas/v4", model: "", apiKey: "" }, kimi: { baseURL: "https://api.moonshot.cn/v1", model: "", apiKey: "" }, custom: { baseURL: "", model: "", apiKey: "" } } }));
  // 导图模块「自己管 AI 设置」的那种组装（独立版 / 网页版用的 ai-config.cjs；照 learn/runtime/mindmap-part.js 的拼法，只引用它的文件，不改）
  const boot = path.join(tmp, "mm-boot.js");
  fs.writeFileSync(boot, `const http=require("http"),J=require("path").join,M=${JSON.stringify(path.join(MOD, "js"))};
const files=require(J(M,"map-files.cjs")),ai=require(J(M,"ai-server.cjs")).createHandler({settings:require(J(M,"ai-config.cjs")).createService()}),aiH=ai;
const P=+process.env.MM_PORT;http.createServer((q,r)=>q.url.startsWith("/api/maps")?files.handle(q,r,P):q.url.startsWith("/api/ai/")?aiH(q,r,P):(r.writeHead(404),r.end())).listen(P,"127.0.0.1",()=>console.log("已启动"));`);
  const srv = spawn(process.execPath, [boot], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100 && !/已启动/.test(log); i++) await sleep(100);
  try {
    const mm = MM.create({ ports: [mport], dirs: [path.join(tmp, "maps")] });
    const r = await api.connect(mm);
    assert.ok(r.on && /^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(r.url) && r.model === "laolao-xiaozhi" && /^lx-/.test(r.key));
    const cfg = (await call(mport, "GET", "/api/ai/config")).json;
    assert.equal(cfg.activeProvider, "custom"); assert.equal(cfg.profiles.custom.baseURL, r.url); assert.equal(cfg.profiles.custom.model, "laolao-xiaozhi"); assert.ok(cfg.profiles.custom.hasKey);
    assert.ok(cfg.profiles.deepseek.hasKey && cfg.profiles.deepseek.model === "deepseek-chat", "原来那家的配置和 Key 不动");
    // 导图自己的「测试连接」：它自己的代码去请求「自定义接口」，拿到的是捞小智的回答
    const t = await call(mport, "POST", "/api/ai/test", { provider: "custom", profile: { baseURL: r.url, model: "laolao-xiaozhi" } });
    assert.equal(t.status, 200, t.text); assert.ok(t.json.ok);
    assert.ok(seen.length === 1 && seen[0].messages[0].content.includes("Reply only OK") && seen[0].max_tokens === 256);
    ok("一键接入：走导图自己的 /api/ai/config 把「自定义接口」填成本机接口；导图自己的「测试连接」通过——它真的在用捞小智回答；原来那家的 Key 不动");

    const ap = +new URL(r.url).port, auth = { Authorization: "Bearer " + r.key };
    const s = await call(ap, "POST", "/v1/chat/completions", { model: "laolao-xiaozhi", stream: true, stream_options: { include_usage: true }, max_tokens: 65536, messages: [{ role: "user", content: [{ type: "text", text: "这张图讲了什么" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }] }, auth);
    assert.ok(/数组是/.test(s.text) && /\[DONE\]/.test(s.text), "流式回答原样透传");
    const last = seen[seen.length - 1];
    assert.equal(last.max_tokens, 4096, "要的输出太长：截到本机放得下的"); assert.equal(last.x_eyes, true, "带图片：用能看图的那版");
    assert.equal((await call(ap, "POST", "/v1/chat/completions", { messages: [] }, { Authorization: "Bearer wrong-key" })).status, 401);
    assert.equal((await call(ap, "GET", "/v1/models")).json.data[0].id, "laolao-xiaozhi");
    busy = "训练答题大脑";
    const b = await call(ap, "POST", "/v1/chat/completions", { messages: [{ role: "user", content: "hi" }] }, auth);
    assert.equal(b.status, 503); assert.match(b.json.error.message, /训练答题大脑/);
    busy = null;
    const pre = await call(ap, "OPTIONS", "/v1/chat/completions", null, { Origin: "https://www.laolaokechengbiao.cn", "Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true" });
    assert.equal(pre.status, 204);
    assert.equal((await call(ap, "GET", "/v1/models", null, { Origin: "https://evil.example.com" })).status, 403, "别的网站不能用");
    ok("本机接口：流式原样透传、带图片自动用能看图的那版、输出长度截到放得下；Key 不对 401；在算训练任务时 503 说清楚");

    // 重开客户端：上次开着，这次自动开（导图那边的配置不用重填）
    api.stop(false);
    const api2 = API.create({ dir: () => tmp, port: ap, busy: () => null, backend: async () => ({ url: `http://127.0.0.1:${llama.address().port}` }) });
    for (let i = 0; i < 50 && !api2.info().on; i++) await sleep(50);
    assert.equal(api2.info().url, r.url); assert.equal(api2.info().key, r.key);
    const d = await api2.disconnect(mm);
    assert.equal(d.on, false);
    const cfg2 = (await call(mport, "GET", "/api/ai/config")).json;
    assert.equal(cfg2.activeProvider, "deepseek"); assert.equal(cfg2.profiles.custom.baseURL, ""); assert.equal(cfg2.profiles.custom.hasKey, false); assert.ok(cfg2.profiles.deepseek.hasKey);
    ok("重开客户端接口自动开、地址和 Key 不变；断开：导图换回原来用的平台，自定义那栏清空");

    // 仓库里那份导图（server.js）用的是「课内学习」的统一 AI 设置：没法从这边填，说清楚、给出手动填的值
    const p2 = await freePort();
    const s2 = spawn(process.execPath, [path.join(MOD, "server.js")], { env: { ...env, MM_PORT: String(p2) }, stdio: ["ignore", "pipe", "pipe"] });
    let l2 = ""; s2.stdout.on("data", (x) => (l2 += x));
    for (let i = 0; i < 100 && !/已启动/.test(l2); i++) await sleep(100);
    try { await assert.rejects(api2.connect(MM.create({ ports: [p2], dirs: [] })), /课内学习.*自定义接口/); } finally { s2.kill(); }
    assert.ok(api2.info().on && api2.info().url, "接口已经开着：照着手动填就能用");
    ok("课内学习那份导图（统一 AI 设置）：说清楚去课程顶栏填，接口照样开着、给出地址 / 模型 / Key");
  } finally { srv.kill(); llama.close(); }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("本机接口 × 捞捞思维导图：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
