// 捞捞自己训练的模型：老师端后台下载、核对；下次生成时才换上；能退回上一版；管理员撤回时跟着退回；Q版插件接进 ComfyUI 的节点图
"use strict";
const assert = require("assert");
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const G = require("../core/gridmodels");
const WF = require("../core/workflows");
const ok = (m) => console.log("✓", m);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-gm-"));
  const blobs = { v1: crypto.randomBytes(5000), v2: crypto.randomBytes(7000) };
  const ent = (v, bad) => ({ version: +v.slice(1), metrics: { score: v === "v1" ? 0.9 : 0.95 }, files: [{ name: "lora", key: `jobs/${v}/lora.safetensors`, url: `${base}/pub/${v}/lora.safetensors`, size: blobs[v].length, sha256: bad ? "0".repeat(64) : crypto.createHash("sha256").update(blobs[v]).digest("hex") }] });
  let base = "", man = null, hits = 0;
  const srv = http.createServer((q, r) => {
    if (q.url.startsWith("/pub/models/manifest.json")) { r.setHeader("content-type", "application/json"); return r.end(JSON.stringify(man)); }
    const pc = /^\/pub\/private\/([\w-]+)\/manifest\.json/.exec(q.url);
    if (pc) { if (pc[1] !== "goodcode1") { r.statusCode = 404; return r.end("{}"); } r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({ models: { "voice-王老师": { version: 3, metrics: {}, files: ["gpt", "sovits", "ref", "reftext"].map((n) => ({ name: n, url: `${base}/pub/v1/${n}.bin?c=goodcode1`, size: blobs.v1.length, sha256: crypto.createHash("sha256").update(blobs.v1).digest("hex") })) } } })); }
    const m = /^\/pub\/(v\d)\//.exec(q.url);
    if (m) { hits++; return r.end(blobs[m[1]]); }
    r.statusCode = 404; r.end();
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const ev = [];
  const gm = G.create({ dir: path.join(tmp, "gm"), sources: ["http://127.0.0.1:1/x", base + "/pub/models/manifest.json"], onEvent: (e) => ev.push(e) });

  assert.equal(gm.use("qversion-lora"), null);
  man = { models: { "qversion-lora": ent("v1") } };
  await gm.check();
  assert.deepEqual(gm.status().pending, { "qversion-lora": 1 });
  assert.equal(gm.status().current["qversion-lora"], undefined, "下好了也先不换");
  let u = gm.use("qversion-lora");
  assert.equal(u.version, 1); assert.ok(fs.readFileSync(u.files.lora).equals(blobs.v1));
  ok("后台下载第 1 版、核对 sha256；下次生成时才换上");

  man = { models: { "qversion-lora": ent("v2") } };
  await gm.check(); hits = 0; await gm.check();
  assert.equal(hits, 0, "下过的不再下");
  assert.equal(gm.status().current["qversion-lora"].version, 1, "正在用的不动");
  assert.equal(gm.use("qversion-lora").version, 2);
  ok("每天的新版：后台下好，下一次生成时换成第 2 版；下过的不重复下");

  assert.ok(gm.rollback("qversion-lora"));
  assert.equal(gm.use("qversion-lora").version, 1);
  ok("新版出问题：退回上一版");

  // 管理员撤回 → 清单里是第 1 版；老师端现在用的就是第 1 版 → 不动
  man = { models: { "qversion-lora": ent("v1") } };
  await gm.check();
  assert.equal(gm.use("qversion-lora").version, 1);
  // 坏的文件不换
  blobs.v3 = crypto.randomBytes(100);
  man = { models: { "qversion-lora": { ...ent("v2", true), version: 3 } } };
  await gm.check();
  assert.equal(gm.status().pending["qversion-lora"], undefined);
  assert.ok(ev.some((e) => e.stage === "error" && /不完整/.test(e.error)));
  assert.equal(gm.use("qversion-lora").version, 1);
  ok("下载的文件对不上 sha256：不换，下次再下");

  // 节点图：插件接在加速插件后面
  const g = WF.portrait({ photo: "p.png", loras: [{ name: "laolao/qversion-2.safetensors", strength: 0.8 }] }, (k) => k + ".safetensors");
  const lo = Object.values(g).filter((n) => n.class_type === "LoraLoaderModelOnly");
  assert.equal(lo.length, 2); assert.equal(lo[1].inputs.lora_name, "laolao/qversion-2.safetensors"); assert.equal(lo[1].inputs.strength_model, 0.8);
  assert.deepEqual(g["6"].inputs.model, ["70", 0]);
  assert.equal(Object.values(WF.portrait({ photo: "p.png" }, (k) => k)).filter((n) => n.class_type === "LoraLoaderModelOnly").length, 1, "没有插件时照旧");
  ok("Q版插件接进 ComfyUI 的节点图（接在 4 步加速插件后面）；没有插件时照旧");

  // 老师自己的声音（不公开）：填了声音码才下载
  {
    let code = null;
    const g2 = G.create({ dir: path.join(tmp, "gm2"), sources: [base + "/pub/models/manifest.json"], codes: () => [code] });
    assert.equal(await g2.tryCode("badcode99"), null, "声音码不对");
    assert.equal(await g2.tryCode("goodcode1"), "voice-王老师");
    await g2.check(); assert.equal(g2.use("voice-王老师"), null, "没填码不下载");
    code = "goodcode1"; await g2.check();
    const v = g2.use("voice-王老师");
    assert.equal(v.version, 3); assert.ok(v.files.gpt && v.files.sovits && v.files.ref && v.files.reftext);
    assert.deepEqual(g2.privateNames(), ["voice-王老师"]);
    ok("老师自己的声音：填了声音码才下载（码不对会提示）；下好后念课件时用它");
  }
  srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
  console.log("捞捞自己的模型（老师端）：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
