// 打电话的听写（app/hear.js）：第一次要下几百 M 的识别模型——
//   进度（tqdm 的百分比）一直报给界面；下载在动就接着等，3 分钟一点动静都没有才算卡住；
//   提前准备和真打电话同时来只起一个；准备好过一次就记下来（以后打开展示不再提前下）
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const Hear = require("../app/hear");
const ok = (m) => console.log("✓", m);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-hear-"));
  // 假的听写：像魔搭下载那样用 \r 刷进度条，下完再开端口；mode=stall 时什么都不输出
  const fake = path.join(tmp, "fake-asr.js");
  fs.writeFileSync(fake, `
const http = require("http"); const port = +process.argv[2], mode = process.argv[3];
if (mode === "stall") setInterval(() => {}, 1000);
else {
  let p = 0;
  const t = setInterval(() => {
    p += 20; process.stderr.write("\\rDownloading [model.pt]: " + p + "%|" + "█".repeat(p / 10) + "| " + p * 8 + "M/800M");
    if (p >= 100) { clearInterval(t); process.stdout.write("\\n耳朵准备好了\\n");
      http.createServer((q, r) => { let n = 0; q.on("data", (c) => (n += c.length)); q.on("end", () => r.end(JSON.stringify({ text: "听到 " + n + " 字节" }))); }).listen(port, "127.0.0.1"); }
  }, 150);
}`);
  const gsv = path.join(tmp, "gsv"); fs.mkdirSync(gsv);
  let mode = "ok", spawned = 0;
  const ear = Hear.create({ python: process.execPath, args: (p) => { spawned++; return [fake, String(p), mode]; }, stallMs: 1500, waitMs: 20000 });

  assert.equal(Hear.pctOf("\rDownloading [model.pt]:  45%|████▌     | 360M/800M"), 45);
  assert.equal(Hear.pctOf("耳朵准备好了"), null);

  // 1. 提前准备 + 马上打电话：只起一个；进度一直报，最后报「准备好了」
  assert.equal(ear.ready(gsv), false);
  const a = [], b = [];
  const w = ear.warm(gsv, (m, p) => a.push({ m, ...p }));
  await new Promise((r) => setTimeout(r, 200));
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(100)]);
  const text = await ear.hear(gsv, wav, (m, p) => b.push({ m, ...p }));
  assert.equal(await w, true);
  assert.equal(spawned, 1, "提前准备和打电话同时来，只起一个");
  assert.equal(text, "听到 104 字节");
  const pcts = a.filter((x) => x.pct != null && !x.done).map((x) => x.pct);
  assert.ok(pcts.length >= 1 && pcts.every((x) => x > 0 && x <= 100), JSON.stringify(a));
  assert.ok(a.some((x) => /下载识别模型 \d+%/.test(x.m)), "进度写成「正在下载识别模型 45%」");
  assert.ok(a.some((x) => x.done) && b.some((x) => x.done), "等着的两边都收到「准备好了」");
  assert.equal(ear.ready(gsv), true, "准备好过一次就记下来");
  ok(`第一次打电话：下载进度一直报给界面（${pcts.join("% → ")}%），提前准备和打电话只起一个，好了两边都知道；记下「下过了」`);

  // 2. 下好以后再开：说「正在打开听写」，不说下载
  ear.stop();
  const c = [];
  await ear.start(gsv, (m) => c.push(m));
  assert.match(c[0], /正在打开听写/);
  ear.stop();
  ok("下好以后再开：提示「正在打开听写」");

  // 3. 卡住：一点动静都没有才报错（说清楚是网络、可以接着下）
  mode = "stall";
  const g2 = path.join(tmp, "gsv2"); fs.mkdirSync(g2);
  const t0 = Date.now();
  await assert.rejects(() => ear.start(g2), /卡住了.*网络/);
  assert.ok(Date.now() - t0 < 6000);
  assert.equal(await ear.warm(g2), false, "提前准备失败不抛错");
  ok("下载卡住（一段时间没有任何进展）才报错，说清楚检查网络、再点会接着下；提前准备失败不打扰");
  ear.stop();

  // 4. 听写模型从捞捞的国内存储下（一个包），不从魔搭一个个文件下；下好不再下；镜像里没有就交给 FunASR
  mode = "ok";
  const g3 = path.join(tmp, "gsv3"); fs.mkdirSync(g3);
  let dls = 0, exs = 0, hasMirror = true;
  const mirror = { model: async (k) => (hasMirror && k === "asrZh" ? [{ size: 1000, url: "https://cos.example/ai/asr/funasr.tar" }] : []), sources: (x) => [x.url] };
  const dl = { download: async (urls, dest, { onProg }) => { dls++; assert.deepEqual(urls, ["https://cos.example/ai/asr/funasr.tar"]); for (const got of [300, 700, 1000]) { onProg({ got, total: 1000 }); await new Promise((r) => setTimeout(r, 1300)); } fs.writeFileSync(dest, "tar"); return dest; } };
  const extract = async (tar, to) => { exs++; for (const m of Hear.ASR_MODELS) { fs.mkdirSync(path.join(to, m), { recursive: true }); fs.writeFileSync(path.join(to, m, "model.pt"), "x"); } };
  const ear2 = Hear.create({ python: process.execPath, args: (p) => [fake, String(p), mode], mirror, dl, extract, stallMs: 1500, waitMs: 20000 });
  const d = [];
  await ear2.start(g3, (m) => d.push(m));
  assert.equal(dls, 1); assert.equal(exs, 1);
  assert.ok(d.some((m) => /国内存储.*只下这一次/.test(m) && /\d+%/.test(m)), d.join(" | "));
  assert.ok(fs.existsSync(Hear.MODELS_OK(g3)) && !fs.existsSync(path.join(g3, "tools", "asr", "asr-models.tar")), "下好记一笔，压缩包删掉");
  ear2.stop(); await ear2.start(g3); assert.equal(dls, 1, "下好的不再下"); ear2.stop();
  const g4 = path.join(tmp, "gsv4"); fs.mkdirSync(g4); hasMirror = false;
  await ear2.start(g4); assert.equal(dls, 1, "镜像里没有：不下，交给 FunASR 自己从魔搭下"); ear2.stop();
  ok("听写模型从捞捞的国内存储下一个包（带进度）、解压到整合包里；下好不再下；国内存储还没有就照旧从魔搭下");
  console.log("听写：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
