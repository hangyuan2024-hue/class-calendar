// 捞小智的云端大脑（core/cloud.js）：用一个假的 DeepSeek（OpenAI 兼容）来测，不上网、不花钱
//   配置和 Key、思考模式的开关、思考内容不显示但工具调用后带回去、看图交给本机、用量记账、出错说人话
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const CLOUD = require("../core/cloud");
const CHAT = require("../core/chat");
const AG = require("../core/agent");
const ok = (m) => console.log("✓ " + m);

(async () => {
  // ---------- 假的 DeepSeek ----------
  const reqs = []; let mode = "ok";
  const srv = http.createServer((q, r) => {
    if (q.method === "GET" && /\/models$/.test(q.url)) { r.writeHead(200, { "content-type": "application/json" }); return r.end(JSON.stringify({ data: [{ id: "qwen-plus" }, { id: "qwen3-max" }, { id: "坏 名字" }] })); }
    let b = ""; q.on("data", (c) => (b += c));
    q.on("end", () => {
      const body = JSON.parse(b || "{}"); reqs.push({ url: q.url, auth: q.headers.authorization, body });
      if (mode === "401") { r.writeHead(401, { "content-type": "application/json" }); return r.end(JSON.stringify({ error: { message: "Authentication Fails" } })); }
      if (mode === "402") { r.writeHead(402); return r.end("{}"); }
      r.writeHead(200, { "content-type": "text/event-stream" });
      const send = (delta) => r.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      const think = body.thinking && body.thinking.type === "enabled";
      const ms = body.messages, last = ms[ms.length - 1];
      if (think) { send({ reasoning_content: "先想一想：" }); send({ reasoning_content: "鸡兔同笼…" }); }
      if (last.role === "user" && /请假/.test(last.content)) send({ tool_calls: [{ index: 0, id: "c1", function: { name: "ask_leave", arguments: '{"days":1}' } }] });
      else for (const w of ["设兔 x 只，", "答案：12 只兔。"]) send({ content: w });
      r.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 1000, prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens: 500, completion_tokens_details: { reasoning_tokens: 300 } } })}\n\n`);
      r.end("data: [DONE]\n\n");
    });
  });
  await new Promise((d) => srv.listen(0, "127.0.0.1", d));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloud-"));
  let thinking = 0;
  // 固定在周六中午（北京时间）：空闲时段
  const cloud = CLOUD.create({ file: path.join(dir, "cloud.json"), base, env: {}, now: () => new Date("2026-11-28T04:00:00Z"), onThinking: () => thinking++ });

  // ---------- 配置 ----------
  let I = cloud.info();
  assert.equal(I.brain, "local"); assert.equal(I.on, false); assert.equal(I.keySet, false); assert.equal(I.model, "deepseek-flash");
  assert.throws(() => cloud.setConfig({ brain: "cloud" }), /先填 DeepSeek 的 API Key/);
  assert.throws(() => cloud.setConfig({ key: "我的 key" }), /看着不对/);
  assert.throws(() => cloud.setConfig({ model: "gpt-9" }), /没有这个模型/);
  I = cloud.setConfig({ brain: "cloud", key: "  sk-test1234567890abcd  " });
  assert.equal(I.on, true); assert.equal(I.keyTail, "abcd"); assert.ok(!JSON.stringify(I).includes("sk-test"), "界面拿到的信息里没有完整的 Key");
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, "cloud.json")).mode & 0o777, 0o600, "Key 文件只有自己能读");
  const fromEnv = CLOUD.create({ file: path.join(dir, "x", "cloud.json"), env: { LAOLAO_DEEPSEEK_KEY: "sk-env123456789" } });
  assert.equal(fromEnv.info().keySet, true); assert.equal(fromEnv.info().keyFromEnv, true); assert.equal(fromEnv.active(), false, "有 Key 也要选了云端才用");
  ok("配置：默认用本机；选云端要先填 Key；Key 格式不对、模型名不对都说清楚；界面上只露 Key 的后四位；也能从环境变量给 Key");

  // ---------- 讲题：开思考，思考内容不当正文 ----------
  const deltas = [];
  let r = await cloud.chat([{ role: "user", content: "鸡兔同笼" }], { onDelta: (t) => deltas.push(t), temperature: 0.3, maxTokens: 1500 });
  let q = reqs[reqs.length - 1];
  assert.equal(q.url, "/v1/chat/completions"); assert.equal(q.auth, "Bearer sk-test1234567890abcd");
  assert.equal(q.body.model, "deepseek-flash"); assert.deepEqual(q.body.thinking, { type: "enabled" }); assert.equal(q.body.reasoning_effort, "high");
  assert.equal(q.body.temperature, undefined, "思考模式不传 temperature"); assert.ok(q.body.max_tokens >= 32768, "思考也算输出，给够");
  assert.deepEqual(q.body.stream_options, { include_usage: true });
  assert.equal(deltas.join(""), "设兔 x 只，答案：12 只兔。"); assert.equal(r.content, "设兔 x 只，答案：12 只兔。");
  assert.equal(r.reasoning_content, "先想一想：鸡兔同笼…"); assert.equal(thinking, 1, "开始思考时告诉界面一次");
  ok("讲题：带 Key 发到 /v1/chat/completions，开思考（不传 temperature、输出上限给够）；思考内容不混进正文、不念，界面只提示一句「在想」");

  r = await cloud.chat([{ role: "system", content: "照资料回答" }, { role: "user", content: "校运会哪天" }], { mode: "ground", temperature: 0, maxTokens: 800 });
  q = reqs[reqs.length - 1];
  assert.deepEqual(q.body.thinking, { type: "disabled" }); assert.equal(q.body.temperature, 0); assert.equal(q.body.reasoning_effort, undefined); assert.equal(r.reasoning_content, undefined);
  cloud.setConfig({ think: "off" }); await cloud.chat([{ role: "user", content: "鸡兔同笼" }]); assert.deepEqual(reqs[reqs.length - 1].body.thinking, { type: "disabled" });
  cloud.setConfig({ think: "on" }); await cloud.chat([{ role: "user", content: "x" }], { mode: "check" }); assert.deepEqual(reqs[reqs.length - 1].body.thinking, { type: "enabled" });
  cloud.setConfig({ think: "auto", model: "deepseek-v4-pro" }); await cloud.chat([{ role: "user", content: "x" }]); assert.equal(reqs[reqs.length - 1].body.model, "deepseek-v4-pro");
  cloud.setConfig({ model: "deepseek-flash" });
  ok("思考开关：自动 = 讲题开、照资料回答和核对关（格式固定、要快）；也能设成总是 / 不思考；能换 Pro");

  // ---------- 工具调用：思考内容带回去 ----------
  const local = { started: [], chats: [], start: async (o) => { local.started.push(o || {}); }, chat: (m, o) => { local.chats.push(m); const p = Promise.resolve({ content: "图上是一道方程。", tool_calls: [] }); p.abort = () => {}; return p; }, files: () => "本机的其它方法照旧" };
  const llm = CLOUD.wrap(local, cloud);
  assert.equal(llm.files(), "本机的其它方法照旧");
  const tool = { name: "ask_leave", desc: "请假", params: { days: { type: "integer" } }, req: ["days"], say: () => "请假", run: async () => ({ id: "QJ001", status: "待辅导员审批" }) };
  const ag = AG.create({ llm, deck: () => null, ppt: false, tools: [tool], system: "你是捞小智", onEvent: () => {} });
  const n0 = reqs.length;
  await ag.send("我明天请假一天");
  assert.equal(local.started.length, 0, "云端开着：不启动本机模型");
  const second = reqs[n0 + 1].body.messages.find((m) => m.role === "assistant" && m.tool_calls);
  assert.equal(second.reasoning_content, "先想一想：鸡兔同笼…", "调了工具以后，下一轮把思考内容原样带回去");
  assert.deepEqual(reqs[n0 + 1].body.thinking, { type: "enabled" });
  await ag.send("谢谢");
  assert.ok(reqs[reqs.length - 1].body.messages.filter((m) => m.role === "assistant").every((m) => "reasoning_content" in m), "之前每一轮的思考内容都带着");
  assert.deepEqual(reqs[reqs.length - 1].body.thinking, { type: "enabled" });
  ok("带工具的对话：每一轮的思考内容都原样带回去（DeepSeek 不带会报 400）；云端开着时不启动本机模型");

  // ---------- 看图：交给本机 ----------
  const nImg = reqs.length;
  await ag.send("看看这道题", ["data:image/png;base64,AAAA"]);
  assert.equal(reqs.length, nImg, "带图的这一句没发到云端"); assert.deepEqual(local.started, [{ eyes: true }]); assert.equal(local.chats.length, 1);
  await ag.send("那答案是多少");
  const after = reqs[reqs.length - 1].body;
  assert.ok(!JSON.stringify(after.messages).includes("image_url"), "之前的图在云端那边换成一句话"); assert.match(JSON.stringify(after.messages), /之前发过一张图片/);
  assert.deepEqual(after.thinking, { type: "disabled" }, "历史里有本机的回答（没有思考内容）→ 这一句先不开思考，免得 400");
  ag.reset(); await ag.send("新问题"); assert.deepEqual(reqs[reqs.length - 1].body.thinking, { type: "enabled" }, "新对话又开思考");
  ok("看图：带图的这一句交给本机模型（带视觉组件）；之后的问题回到云端，图换成一句话；混进本机回答的对话先不开思考，新对话恢复");

  // ---------- 用量 ----------
  const u = cloud.usage();
  assert.equal(u.today.calls, reqs.length, "每一次请求都记上了"); assert.ok(u.today.tokens > 0);
  // 每次：命中 800 × 0.02 + 未命中 200 × 1 + 输出 500 × 4（元/百万，空闲）= 0.002216 元；Pro 那一次贵一些
  assert.equal(CLOUD.cost(CLOUD.PROVIDERS.deepseek.models[0], { prompt_cache_hit_tokens: 800, prompt_cache_miss_tokens: 200, completion_tokens: 500 }, false).toFixed(6), "0.002216");
  assert.equal(CLOUD.peak(new Date("2026-11-26T02:00:00Z")), true, "周四北京时间 10 点是高峰"); assert.equal(CLOUD.peak(new Date("2026-11-26T05:00:00Z")), false, "13 点是空闲");
  assert.equal(CLOUD.peak(new Date("2026-11-28T02:00:00Z")), false, "周六全天空闲");
  ok(`用量：每一句记 token，按刊例价估钱（高峰 / 空闲分开算）；今天 ${u.today.calls} 次、约 ${u.today.cost} 元`);

  // ---------- 出错、试连 ----------
  const t = await cloud.test(); assert.equal(t.ok, true); assert.equal(t.model, "deepseek-flash");
  mode = "401"; await assert.rejects(cloud.test(), /API Key 不对/);
  mode = "402"; await assert.rejects(cloud.chat([{ role: "user", content: "x" }]), /余额不足/);
  mode = "ok";
  const dead = CLOUD.create({ file: path.join(dir, "d", "cloud.json"), base: "http://127.0.0.1:1", env: { LAOLAO_DEEPSEEK_KEY: "sk-dead1234567" } });
  await assert.rejects(dead.test(), /连不上 AI 服务/);
  assert.equal(CHAT.endpoint("https://api.deepseek.com"), "https://api.deepseek.com/v1/chat/completions");
  assert.equal(CHAT.endpoint("https://dashscope.aliyuncs.com/compatible-mode/v1/"), "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal(CHAT.endpoint("http://127.0.0.1:18097"), "http://127.0.0.1:18097/v1/chat/completions");
  ok("试一下：Key 对就回「好的」和用了多久；Key 不对、余额不足、连不上都说人话；地址带不带 /v1 都行");

  // ---------- 多家模型：填别家的 Key、切换、各家思考参数不一样、拉模型列表、干活模型 ----------
  assert.throws(() => cloud.setConfig({ current: "qwen/qwen-plus" }), /先填 通义千问.*API Key/);
  I = cloud.setConfig({ provider: { id: "qwen", key: "sk-qwen1234567890" } });
  assert.ok(I.choices.some((x) => x.value === "qwen/qwen-plus"), "填了 Key，下拉里就有它的模型"); assert.ok(I.choices.some((x) => x.value === "deepseek/deepseek-flash")); assert.equal(I.choices[0].value, "local");
  I = cloud.setConfig({ current: "qwen/qwen-plus" }); assert.equal(I.current, "qwen/qwen-plus"); assert.match(I.currentName, /通义千问.* · qwen-plus/);
  let n1 = reqs.length;
  r = await cloud.chat([{ role: "user", content: "你好" }, { role: "assistant", content: "好", reasoning_content: "想" }, { role: "user", content: "鸡兔同笼" }], { temperature: 0.3 });
  q = reqs[n1]; assert.equal(q.auth, "Bearer sk-qwen1234567890"); assert.equal(q.body.model, "qwen-plus");
  assert.equal(q.body.enable_thinking, undefined, "自动：用它自己的默认，不传"); assert.equal(q.body.thinking, undefined); assert.equal(q.body.temperature, 0.3);
  assert.ok(!JSON.stringify(q.body.messages).includes("reasoning_content"), "别家不认 reasoning_content：去掉"); assert.equal(r.reasoning_content, undefined); assert.equal(r.model, "qwen/qwen-plus");
  cloud.setConfig({ think: "on" }); await cloud.chat([{ role: "user", content: "x" }]); assert.equal(reqs[reqs.length - 1].body.enable_thinking, true);
  cloud.setConfig({ think: "auto" });
  // 干活模型：默认这家最便宜的那个；临时指定别的模型
  assert.equal(cloud.workerModel(), "qwen/qwen-flash", "大任务里的助手默认用这家便宜的那个");
  cloud.setConfig({ provider: { id: "qwen", models: "qwen3-max" } });
  cloud.setConfig({ worker: "deepseek/deepseek-flash" }); assert.equal(cloud.workerModel(), "deepseek/deepseek-flash", "也能指定"); cloud.setConfig({ worker: "" });
  await cloud.chat([{ role: "user", content: "x" }], { model: "deepseek/deepseek-flash", think: false }); assert.equal(reqs[reqs.length - 1].body.model, "deepseek-flash"); assert.equal(reqs[reqs.length - 1].auth, "Bearer sk-test1234567890abcd");
  assert.ok(cloud.info().choices.some((x) => x.value === "qwen/qwen3-max"), "自己加的模型名也在下拉里");
  // 拉模型列表（它的 /models）
  const lm = await cloud.listModels("qwen"); assert.equal(lm.from, "api"); assert.deepEqual(lm.models, ["qwen-plus", "qwen3-max"]);
  // 自定义接口：要地址
  assert.throws(() => cloud.setConfig({ provider: { id: "custom", base: "ftp://x" } }), /http/);
  cloud.setConfig({ provider: { id: "custom", base: base + "/v1", key: "sk-custom12345678", name: "学校的模型", models: "school-7b" } });
  I = cloud.setConfig({ current: "custom/school-7b" }); assert.match(I.currentName, /学校的模型 · school-7b/);
  await cloud.chat([{ role: "user", content: "x" }]); assert.equal(reqs[reqs.length - 1].body.model, "school-7b"); assert.equal(reqs[reqs.length - 1].body.thinking, undefined, "不认识的接口：不传思考参数");
  I = cloud.setConfig({ provider: { id: "custom", remove: true } }); assert.equal(I.current, "local", "删掉正在用的那家：回到本机");
  cloud.setConfig({ current: "deepseek/deepseek-flash" });
  ok("多家模型：填了哪家的 Key 下拉里就有哪家；切换模型；各家思考参数照它的来（DeepSeek thinking、通义 enable_thinking、不认识的不传）；别家去掉 reasoning_content；能拉模型列表、加自己的模型名、接自定义接口；干活模型默认用便宜的");

  // ---------- 混合：本机优先，难题交给云端 ----------
  {
    const st0 = local.started.length;
    cloud.setConfig({ current: "deepseek/deepseek-flash" });
    let I2 = cloud.setConfig({ current: "auto" });
    assert.equal(I2.current, "auto"); assert.equal(I2.hybrid, true); assert.match(I2.currentName, /混合.*DeepSeek/);
    assert.ok(I2.choices.some((x) => x.value === "auto"));
    const routes = []; let tier = "small", lok = true;
    const hy = CLOUD.wrap(local, cloud, { tier: () => tier, localOk: () => lok, onRoute: (r) => routes.push(r) });
    const n0 = reqs.length; local.chats.length = 0;
    await hy.chat([{ role: "user", content: "明天有什么课？" }]);
    assert.equal(reqs.length, n0); assert.equal(local.chats.length, 1); assert.equal(routes.pop().where, "local");
    await hy.chat([{ role: "user", content: "证明根号 2 是无理数" }]);
    assert.equal(reqs.length, n0 + 1); assert.equal(routes.pop().where, "cloud", "难题走云端");
    await hy.chat([{ role: "user", content: "帮我写一个快速排序的代码" }]); assert.equal(routes.pop().where, "cloud");
    tier = "big"; await hy.chat([{ role: "user", content: "帮我写一个快速排序的代码" }]); assert.equal(routes.pop().where, "local", "电脑好（8B）：一般的难题本机就行");
    await hy.chat([{ role: "user", content: "x" }], { mode: "ppt" }); assert.equal(routes.pop().where, "local");
    tier = "small"; await hy.chat([{ role: "user", content: "做一份 PPT" }], { mode: "ppt" }); assert.equal(routes.pop().where, "cloud", "小模型做 PPT 交给云端");
    lok = false; await hy.chat([{ role: "user", content: "你好" }]); const r = routes.pop(); assert.equal(r.where, "cloud"); assert.match(r.why, /本机模型还没准备好/);
    lok = true; const before = routes.length; await hy.chat([{ role: "user", content: "你好" }]); await hy.chat([{ role: "user", content: "你好" }]); assert.equal(routes.length, before + 1, "同一句话的几轮只报一次");
    assert.equal(CLOUD.route([{ role: "user", content: "看看\n\n【附件：a.docx】\n" + "字".repeat(4000) }]).where, "cloud", "带了长文件");
    I2 = cloud.setConfig({ current: "deepseek/deepseek-flash" }); assert.equal(I2.hybrid, false); assert.equal(I2.current, "deepseek/deepseek-flash");
    const fresh = CLOUD.create({ file: path.join(dir, "h", "cloud.json"), env: {} });
    assert.throws(() => fresh.setConfig({ current: "auto" }), /混合模式要先接一家云端模型/);
    local.started.length = st0;
  }
  ok("混合：本机优先；证明、写代码、带长文件、小模型做 PPT 交给云端；电脑好（8B）多留给本机；本机没准备好全走云端；每句报一次走了哪边");

  // ---------- 连接中途断了：一个字还没收到就悄悄再试一次；收到过字了就说人话报错 ----------
  {
    const http = require("http"); let n = 0, mode = "cut-early";
    const s2 = http.createServer((q, r) => { let b = ""; q.on("data", (c) => (b += c)); q.on("end", () => {
      n++; r.writeHead(200, { "content-type": "text/event-stream" });
      if (mode === "cut-early" && n === 1) return setTimeout(() => q.socket.destroy(), 20);
      if (mode === "cut-late") { r.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "写到一半" } }] })}\n\n`); return setTimeout(() => q.socket.destroy(), 30); }
      r.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "好了" } }] })}\n\n`); r.end("data: [DONE]\n\n"); }); });
    await new Promise((d) => s2.listen(0, "127.0.0.1", d));
    const c2 = CLOUD.create({ file: path.join(dir, "c2", "cloud.json"), base: `http://127.0.0.1:${s2.address().port}`, env: { LAOLAO_DEEPSEEK_KEY: "sk-cut12345678" } });
    c2.setConfig({ brain: "cloud" });
    const r1 = await c2.chat([{ role: "user", content: "x" }], { think: false }); assert.equal(r1.content, "好了"); assert.equal(n, 2, "断了重试了一次");
    mode = "cut-late"; const got = [];
    await assert.rejects(() => c2.chat([{ role: "user", content: "x" }], { think: false, onDelta: (t) => got.push(t) }), /连接中途断了/);
    assert.deepEqual(got, ["写到一半"]); assert.equal(n, 3, "收到过字就不重试");
    s2.close();
  }
  ok("和云端的连接中途断了：一个字都没收到就自动再试一次；已经在写了就报「连接中途断了」，不再是一句 aborted");

  // ---------- 关掉云端 → 全回本机 ----------
  cloud.setConfig({ brain: "local" });
  const nl = reqs.length; local.chats.length = 0;
  await llm.start(); assert.equal(local.started.length, 2);
  await llm.chat([{ role: "user", content: "x" }]); assert.equal(reqs.length, nl); assert.equal(local.chats.length, 1);
  ok("换回本机：start、chat 全部走本机模型，一句都不发到云端");

  srv.close();
  console.log("云端大脑：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
