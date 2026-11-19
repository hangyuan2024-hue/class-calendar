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
    S.app.close();
    ok("本机存储：最近的存档在存储里找不到了 → 标成丢失、退回更早的存档（控制中心记一笔）；全没了就从头算；不再一直发同一个坏存档");
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
    S.app.close(); cosSrv.close();
    ok("COS 上的存档：确定 404 才标成丢失、退回更早的；COS 出错 / 没权限的时候照旧发，不随便扔存档");
  }
  quiet("存档丢失：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
