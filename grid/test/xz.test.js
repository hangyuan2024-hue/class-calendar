// 捞小智电脑版（xz/）：界面上每个按钮都有对应的后台功能；模型只从公开清单拿；页面引用的文件都在；
//   打包配置里没有训练网的东西（配方、训练计划、调度中心、领任务的代码）
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), crypto = require("crypto");
const ok = (m) => console.log("✓", m);
const R = path.join(__dirname, "..");
const { createXz, SOURCES, pickBase } = require("../xz/service");

(async () => {
  // 1. 界面里调用的每个后台功能，捞小智电脑版都有
  const used = new Set();
  for (const f of ["show.js", "checkup.js"]) for (const m of fs.readFileSync(path.join(R, "app", "renderer", f), "utf8").matchAll(/call\("(\w+)"/g)) used.add(m[1]);
  for (const m of fs.readFileSync(path.join(R, "xz", "renderer", "xz.js"), "utf8").matchAll(/call\("(\w+)"/g)) used.add(m[1]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-xz-"));
  // 假的公开清单
  let models = {};
  const blobs = new Map(), hits = [];
  const srv = http.createServer((q, r) => { const u = q.url.split("?")[0]; hits.push(u);
    if (u === "/dl/models/manifest.json") { r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({ models })); }
    if (blobs.has(u)) return r.end(blobs.get(u)); r.statusCode = 404; r.end(); });
  await new Promise((d) => srv.listen(0, "127.0.0.1", d));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const ensured = [];
  let llmHave = false, kokHave = false;
  const llm = { ok: () => true, running: () => false, touch() {}, stop() {}, ensure: async (spec) => { ensured.push(spec); throw new Error("测试里不启动大模型"); },
    hasModel: () => llmHave, prefetch: async (spec, say) => { say("下载本地大模型：40%，3.0M/秒"); await new Promise((r) => setTimeout(r, 300)); llmHave = true; } };
  const MEDIA = require("../../pptassist/core/media");
  const kokoro = { ready: () => kokHave, stop() {}, ensure: async (say) => { say("下载好听的声音：50%", { pct: 50 }); await new Promise((r) => setTimeout(r, 300)); kokHave = true; }, tts: async () => MEDIA.writeWav(new Float32Array(24000).map((_, i) => Math.sin(i / 9) * 0.3), 24000) };
  const evs = [];
  const gsv = { inspect: () => null, find: () => null, ensure: async () => { throw new Error("测试里装不了声音组件"); } };
  const xz = createXz({ user: path.join(tmp, "user"), dataDir: path.join(tmp, "data"), llmFactory: () => llm, gsvFactory: () => gsv, sources: [base + "/dl/models/manifest.json"], noDetect: true, send: (ch, d) => evs.push(d),
    showOpt: { kokoroFactory: () => kokoro, sysTtsFactory: () => ({ available: async () => ({ ok: false, why: "测试" }), tts: async () => Buffer.alloc(0) }), hearOpt: { python: "none" } } });
  const missing = [...used].filter((m) => typeof xz.H[m] !== "function");
  assert.deepEqual(missing, [], "捞小智电脑版缺这些后台功能：" + missing.join("、"));
  ok(`界面上用到的 ${used.size} 个后台功能，捞小智电脑版都有`);

  // 2. 状态、体验版：还没发布过模型 → 每样都是临时版
  let st = await xz.H.showState();
  assert.equal(st.task, null); assert.equal(st.paused, false); assert.equal(st.app.trial, true);
  assert.ok(st.product.parts.every((p) => !p.ready && p.temp));
  ok("打开就能用：不领任务、不暂停计算；还没训练好的每样都写着临时用什么");

  // 2b. 先准备组件：必需的（大模型、好听的声音）下好了才开放；进度一直报
  let pp = await xz.H.showPrep();
  assert.equal(pp.open, false); assert.deepEqual(pp.items.filter((x) => x.required).map((x) => x.key), ["llm", "voice"]);
  await xz.H.showPrepRun({ all: true });
  for (let i = 0; i < 50 && (await xz.H.showPrep()).running; i++) await new Promise((r) => setTimeout(r, 100));
  pp = await xz.H.showPrep();
  assert.equal(pp.open, true, JSON.stringify(pp.items));
  assert.ok(evs.some((e) => e.type === "prep" && e.prep.items.some((x) => x.key === "llm" && x.state === "running" && x.pct === 40)), "大模型下载进度报给界面");
  assert.equal(pp.items.find((x) => x.key === "gsv").state, "error", "声音组件在测试里装不了：记下原因，不挡着开放");
  ok("打开先准备组件：大模型、好听的声音下好才开放（进度报给界面）；声音组件这些可选的没成也不挡着");
  // 2c. 声音：没训练好、没装声音组件 → 用 Kokoro 女声，好听的临时声音
  st = await xz.H.showState();
  assert.equal(st.voice.kind, "kokoro"); assert.match(st.voice.label, /Kokoro/);
  const sp = await xz.H.showSpeak("你好，我是捞小智。");
  assert.equal(sp.kind, "kokoro"); assert.ok(sp.ms > 900 && sp.levels.length > 5);
  assert.equal((await xz.H.showVoicePref("real")).kind, "kokoro", "选了真人感但还没装声音组件：先照旧用 Kokoro");
  ok("回答有声音：没训练好时用 Kokoro 中文女声（带口型）；真人感要装好声音组件才用");

  // 3. 新版从公开清单下载、换上
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  const b1 = Buffer.from("GGUF-qa1"); blobs.set("/dl/models/qa-lora/1/0.gguf", b1);
  models = { "qa-lora": { version: 1, metrics: { acc: 0.7 }, files: [{ name: "lora", size: b1.length, sha256: sha(b1), url: base + "/dl/models/qa-lora/1/0.gguf" }] } };
  const P = await xz.H.showCheck().then((s) => s.product);
  assert.equal(P.parts.find((p) => p.key === "qa-lora").version, 1);
  assert.ok(hits.every((u) => u.startsWith("/dl/models/")), "只读公开清单：" + hits.join(","));
  ok("训练、考试通过的新版：从公开清单（dl 域名）下载、核对、换上；不碰调度中心的其他接口");

  // 4. 默认地址：只有 https 的 dl 域名，没有调度中心的 IP、端口
  assert.deepEqual(SOURCES, ["https://dl.laolaokechengbiao.cn/dl/models/manifest.json"]);
  const code = ["service.js", "main.js", "renderer/xz.js", "renderer/index.html"].map((f) => fs.readFileSync(path.join(R, "xz", f), "utf8")).join("\n");
  assert.ok(!/\d+\.\d+\.\d+\.\d+|:8787|\/api\/|token/i.test(code.replace(/127\.0\.0\.1/g, "")), "捞小智电脑版里不该有调度中心的地址、接口");
  if (process.platform === "win32") assert.ok(/^[\x20-\x7e]+$/.test(pickBase("C:\\Users\\张三\\AppData\\Roaming\\LaolaoXiaozhi")), "中文用户名换到公共文件夹");
  else assert.equal(pickBase("/home/a/b"), "/home/a/b");
  ok("默认只连 https://dl.laolaokechengbiao.cn 的公开清单；代码里没有调度中心的 IP、端口、接口");

  // 5. 页面引用的文件都在
  const html = fs.readFileSync(path.join(R, "xz", "renderer", "index.html"), "utf8");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(fs.existsSync(path.join(R, "xz", "renderer", m[1])) || /vendor\/three|deckview\.js/.test(m[1]), "页面引用的文件不在：" + m[1]);
  for (const id of new Set([...fs.readFileSync(path.join(R, "app", "renderer", "show.js"), "utf8").matchAll(/\$\("#(\w+)"\)/g)].map((m) => m[1]))) assert.ok(html.includes(`id="${id}"`), "页面里少了 #" + id);
  assert.match(html, /还没有正式训练好/);
  ok("页面：show.js 要的元素都在、引用的文件都在；顶上写明「还没有正式训练好」");

  // 6. 打包配置：只放捞小智用到的文件
  const cfg = JSON.parse(fs.readFileSync(path.join(R, "xz", "builder.json"), "utf8"));
  const files = cfg.files.join(" ");
  for (const bad of ["recipes", "plans", "server", "worker", "tools", "app/**", "py/**"]) assert.ok(!cfg.files.includes(bad + "/**") && !cfg.files.includes(bad), "打包里不该有 " + bad);
  assert.ok(!/app\/(service|assist|inject|lan|updater|env|ai|power)\.js/.test(files), "不带训练网客户端的代码");
  assert.ok(cfg.files.includes("xz/**") && cfg.files.includes("app/show.js"));
  ok("打包配置只放捞小智用到的文件：没有配方、训练计划、调度中心、领任务和远程协助的代码");

  xz.shutdown(); srv.close();
  console.log("捞小智电脑版：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
