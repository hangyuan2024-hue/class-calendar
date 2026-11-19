// 训练的存档在存储里找不到了（404）：调度中心发存档之前先核对，确定没有了就标成丢失、退回更早的存档（都没了就从头算），
//   不再把同一个坏存档一直发给所有电脑（以前：每台都「下载失败 404」、5 分钟 / 15 分钟后再领、再失败，训练卡死）。
//   说不准的时候（COS 连不上、没权限）照旧发，不随便扔存档。只改调度中心：旧版客户端也一起好。
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path"), http = require("http");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-ckptlost-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Server = require("../server");
const Agent = require("../worker/agent");
const Tools = require("../tools/grid");
const ok = (m) => console.log("✓", m);
const quiet = console.log; console.log = (...a) => (/^✓/.test(String(a[0])) || /全部通过/.test(String(a[0])) ? quiet(...a) : null);

async function setup(name, env) {
  const app = Server.create({ data: path.join(tmp, name), leaseMs: 60000, noTick: true, env: env || {} });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 10, server: url });
  const rec = path.join(tmp, name + "-train.py"); fs.writeFileSync(rec, "import lg\nlg.done(ok=1)\n");
  const plan = path.join(tmp, name + "-plan.json");
  fs.writeFileSync(plan, JSON.stringify({ jobs: [{ name: "训练答题大脑", kind: "map", recipe: rec, params: { count: 1 }, priority: 3 }] }));
  await Tools.plan(admin, plan);
  const cred = await Agent.join(inv.link, "甲", { name: "甲的电脑", info: { gpu: "RTX 5060", vram: 8 } });
  const api = async (p, b) => { const r = await fetch(url + p, { method: "POST", headers: { authorization: "Bearer " + cred.token, "content-type": "application/json" }, body: JSON.stringify(b || {}) }); const j = await r.json(); if (r.status >= 400) throw new Error(j.error || r.status); return j; };
  const lease = async () => (await api("/api/lease", { caps: { gpu: "RTX 5060", vram: 8, ram: 32 } })).task;
  // 存一个档：拿上传地址 → 传上去 → 告诉调度中心
  const ckpt = async (t, step) => { const p = await api("/api/put", { job: t.job.id, task: t.task.id, name: "ck.bin", prefix: "ckpt-" + step }); const r = await fetch(p.url, { method: "PUT", body: Buffer.from("存档 " + step) }); assert.ok(r.ok); await api("/api/ckpt", { task: t.task.id, step, key: p.key }); return p.key; };
  return { app, url, admin, api, lease, ckpt };
}

(async () => {
  // ---------- 本机存储 ----------
  {
    const S = await setup("local");
    let t = await S.lease(); assert.ok(t && !t.resume);
    const k3 = await S.ckpt(t, 300), k7 = await S.ckpt(t, 746);
    await S.api("/api/fail", { task: t.task.id, error: "显卡掉了" });
    t = await S.lease(); assert.equal(t.resume.step, 746, "存档都在：从最近的接着算");
    assert.equal(await (await fetch(t.resume.url)).text(), "存档 746");
    await S.api("/api/fail", { task: t.task.id, error: "下载失败 404" });
    // 第 746 步的存档丢了
    fs.rmSync(S.app.store.file(k7));
    t = await S.lease();
    assert.equal(t.resume.step, 300, "最近的存档没了：退回第 300 步的"); assert.equal(await (await fetch(t.resume.url)).text(), "存档 300");
    const ev = S.app.core.overview ? JSON.stringify(S.app.core.overview(true)) : "";
    assert.match(ev, /第 746 步）在存储里找不到了：退回第 300 步的存档接着算/, "控制中心的动态里记一笔");
    await S.api("/api/fail", { task: t.task.id, error: "x" });
    t = await S.lease(); assert.equal(t.resume.step, 300, "标过丢失的不再发、也不再查");
    await S.api("/api/fail", { task: t.task.id, error: "x" });
    fs.rmSync(S.app.store.file(k3));
    t = await S.lease(); assert.equal(t.resume, null, "存档全没了：这一轮从头算，不卡住");
    // 根本原因那一头：上传的名字每次都不一样（同名再传不会盖掉 / 删掉已经登记的）；没存上的文件不让登记
    const p1 = await S.api("/api/put", { job: t.job.id, task: t.task.id, name: "out-qa-math-12-176.jsonl", prefix: "out" });
    const p2 = await S.api("/api/put", { job: t.job.id, task: t.task.id, name: "out-qa-math-12-176.jsonl", prefix: "out" });
    assert.notEqual(p1.key, p2.key, "同一个文件名传两次：两个不同的存储名字"); assert.match(p1.key, /^jobs\/\d+\/\d+\/out-out-qa-math-12-176-[0-9a-f]{8}\.jsonl$/, "名字还认得出来、扩展名不变");
    await assert.rejects(S.api("/api/ckpt", { task: t.task.id, step: 900, key: p1.key }), /存档文件在存储里找不到/, "拿了地址没传：不让登记成存档");
    await assert.rejects(S.api("/api/done", { task: t.task.id, result: { ok: 1 }, outputs: [{ name: "a.jsonl", key: p1.key, size: 1 }] }), /结果文件没存上/, "结果文件没存上：不收这次结果");
    assert.ok((await (await fetch(p1.url, { method: "PUT", body: "结果" })).ok));
    assert.equal((await S.api("/api/done", { task: t.task.id, result: { ok: 1 }, outputs: [{ name: "a.jsonl", key: p1.key, size: 6 }] })).ok, true, "存上了：照常收");
    S.app.close();
    ok("本机存储：最近的存档在存储里找不到了 → 标成丢失、退回更早的存档（控制中心记一笔）；全没了就从头算。根上：上传名字每次不同、没存上的存档 / 结果不让登记");
  }

  // ---------- 腾讯云 COS（混合存储）：只有确定的 404 才算丢了；COS 出错 / 连不上照旧发 ----------
  {
    const objs = new Map(); let headStatus = null;
    const cosSrv = http.createServer((q, r) => {
      const key = decodeURIComponent(q.url.split("?")[0]);
      if (q.method === "PUT") { const bs = []; q.on("data", (c) => bs.push(c)); q.on("end", () => { objs.set(key, Buffer.concat(bs)); r.writeHead(200).end(); }); return; }
      if (q.method === "HEAD") { if (headStatus) return r.writeHead(headStatus).end(); return r.writeHead(objs.has(key) ? 200 : 404, objs.has(key) ? { "content-length": objs.get(key).length } : {}).end(); }
      if (!objs.has(key)) return r.writeHead(404).end("NoSuchKey"); r.writeHead(200).end(objs.get(key));
    });
    await new Promise((d) => cosSrv.listen(0, "127.0.0.1", d));
    const env = { GRID_COS_BUCKET: "b-123", GRID_COS_REGION: "ap-guangzhou", GRID_COS_ENDPOINT: `http://127.0.0.1:${cosSrv.address().port}`, GRID_COS_KEY_ID: "id", GRID_COS_SECRET: "sk", GRID_COS_PATHSTYLE: "1" };
    const S = await setup("cos", env);
    assert.equal(S.app.store.kind, "hybrid");
    let t = await S.lease();
    const k3 = await S.ckpt(t, 300), k7 = await S.ckpt(t, 746);
    assert.ok([...objs.keys()].some((k) => k.endsWith(k7)), "存档传到了 COS");
    await S.api("/api/fail", { task: t.task.id, error: "x" });
    // COS 一时出错（500）/ 没权限（403）：说不准 → 照旧发最近的，不扔
    headStatus = 500; t = await S.lease(); assert.equal(t.resume.step, 746); await S.api("/api/fail", { task: t.task.id, error: "x" });
    headStatus = 403; t = await S.lease(); assert.equal(t.resume.step, 746); await S.api("/api/fail", { task: t.task.id, error: "x" });
    headStatus = null;
    for (const k of [...objs.keys()]) if (k.endsWith(k7)) objs.delete(k);
    t = await S.lease(); assert.equal(t.resume.step, 300, "COS 上确定没有了（404）：退回第 300 步");
    void k3;
    // 看门狗：放一个小文件；有别的程序把它删了（打包后清理旧安装包的脚本就是这样删光 grid/jobs/ 的）→ 控制中心报警，再放一个
    let r = await S.app.canary(); assert.equal(r.planted, true);
    const ck = [...objs.keys()].find((k) => k.endsWith("jobs/_canary/keep-me.txt")); assert.ok(ck, "看门狗文件放在 grid/jobs/ 下面（训练文件的权限够）");
    assert.deepEqual(await S.app.canary(), { ok: true }, "还在：不打扰");
    headStatus = 500; assert.equal((await S.app.canary()).unsure, true, "COS 出错：说不准，不报警"); headStatus = null;
    objs.delete(ck);
    r = await S.app.canary(); assert.equal(r.alarm, true); assert.ok(objs.has(ck), "报完警再放一个，接着看");
    assert.match(JSON.stringify(S.app.core.overview(true)), /广州存储里的训练文件被别的程序删了/, "控制中心的动态里报警");
    S.app.close(); cosSrv.close();
    ok("COS 上的存档：确定 404 才标成丢失、退回更早的；COS 出错 / 没权限的时候照旧发。看门狗：存储里的文件被别的程序删了 → 控制中心报警");
  }
  // ---------- 多一道保险：网站国内加速的同步（--delete）不许删训练文件、安装包、AI 镜像；和安装包同一个桶时干脆不删（真正的根因见 cnclean.test.js） ----------
  {
    const y = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "site-cn.yml"), "utf8").replace(/\r\n/g, "\n");
    for (const ex of ["grid/jobs/*", "grid/logs/*", "ai/*", "*.exe", "*.apk"]) assert.ok(y.includes(`--exclude "${ex}"`), "网站同步要排除 " + ex);
    const del = y.split("\n").filter((l) => /--delete/.test(l) && !/^\s*#/.test(l));
    assert.equal(del.length, 1); assert.match(del[0], /"\$\{SKIP\[@\]\}"/, "--delete 那一步带着排除列表");
    assert.match(y, /if \[ -n "\$CN_S3_BUCKET" \] && \[ "\$CN_S3_BUCKET" = "\$CN_SITE_BUCKET" \]; then[\s\S]*?else\s+aws s3 sync[^\n]*--delete/, "网站和安装包同一个桶：不跑 --delete");
    assert.match(y, /for pre in grid\/jobs\/ grid\/logs\/ ai\/[^\n]*\n[\s\S]*?list-objects-v2[\s\S]*?elif \[ -n "\$OTHER" \]/, "桶里有训练文件 / 安装包 / AI 镜像：不删（不管 Secrets 怎么填）");
    assert.match(y, /CN_S3_KEY_ID: \$\{\{ secrets\.CN_SITE_KEY_ID \|\| secrets\.CN_S3_KEY_ID \}\}/, "网站可以用只管网站桶的密钥");
    ok("网站国内加速的同步：排除训练文件（grid/jobs、grid/logs）、AI 镜像、安装包；和安装包同一个桶、或者桶里有这些东西时只传不删；网站用单独的密钥");
  }
  quiet("存档丢失：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
