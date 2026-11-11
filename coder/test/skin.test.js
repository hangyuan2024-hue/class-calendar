// 皮肤商店：皮肤数据洗干净、洗几遍都一样；商店从网站取列表，断网用上次的；设置里只存合格的皮肤
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
require("../renderer/avatar3d.js"); require("../renderer/stage3d.js");   // 没有 THREE 也能用 sanitizeSkin
const { sanitizeSkin, ROBOT } = globalThis.LaoStage;
const { createService } = require("../core/service");
const ok = (m) => console.log("✓ " + m);

(async () => {
  const teacher = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "code-skins", "c-teacher.json"), "utf8"));
  const a = sanitizeSkin(teacher);
  assert.equal(a.model, "person"); assert.equal(a.person.hairStyle, "ponytail"); assert.equal(a.person.bangs, "side"); assert.equal(a.person.faceStyle, "doll"); assert.equal(a.person.rig, false); assert.equal(a.person.grid, true); assert.equal(a.person.shoes, 0x6b4430); assert.equal(a.person.eyeStyle, "smile"); assert.equal(a.person.glasses, false); assert.equal(a.person.top, 0x26262c); assert.equal(a.person.collar, null); assert.equal(a.colors.body, 0x7c8cf0); assert.equal(a.person.earpods, true);
  assert.deepStrictEqual(sanitizeSkin(a), a);
  ok("皮肤数据：官网的老师皮肤能读；洗过的再洗一遍不变（拖出去的小窗口收到的就是洗过的）");
  const bad = sanitizeSkin({ id: "x<script>", name: "<img onerror=1>", model: "person", person: { hairStyle: "mohawk", top: "red", onload: "alert(1)" }, code: "alert(1)" });
  assert.equal(bad.id, "xscript"); assert.ok(!/[<>]/.test(bad.name)); assert.equal(bad.person.hairStyle, "bob"); assert.equal(bad.person.top, 0x6d8cf0);
  assert.ok(!("code" in bad) && !("onload" in bad.person));
  assert.equal(bad.person.faceStyle, "doll"); assert.equal(bad.person.rig, false); assert.equal(sanitizeSkin({ id: "f", model: "person", person: { faceStyle: "screen", rig: true } }).person.rig, true);
  assert.equal(sanitizeSkin({ id: "f", model: "person", person: { faceImage: "javascript:alert(1)" } }).person.faceImage, undefined);
  // 公仔脸 / 屏幕脸的线条：合格的原样留下（洗两遍一样），乱的不要
  const fl = globalThis.LaoAvatar.defaultLines(), sk = sanitizeSkin({ id: "f", model: "person", person: { faceLines: fl } });
  assert.ok(sk.person.faceLines && sk.person.faceLines.eyes.length === 2);
  assert.deepEqual(sanitizeSkin(sk).person.faceLines, sk.person.faceLines);
  assert.equal(sanitizeSkin({ id: "f", model: "person", person: { faceLines: { brows: "<script>" } } }).person.faceLines, undefined);
  assert.equal(sanitizeSkin({ id: "f", model: "person", person: { faceLines: { ...fl, mouth: { line: [[2, 3]], h: 1, open: 0 } } } }).person.faceLines, undefined);
  assert.ok(sanitizeSkin({ id: "f", model: "person", person: { faceImage: "data:image/jpeg;base64,/9j/AAAA" } }).person.faceImage.startsWith("data:image/jpeg"));
  assert.deepStrictEqual(sanitizeSkin(null), ROBOT); assert.equal(sanitizeSkin({ id: "r", model: "??" }).model, "robot");
  ok("不认识的字段丢掉、发型 / 颜色写错用默认、名字里的尖括号去掉");

  const site = fs.mkdtempSync(path.join(os.tmpdir(), "skin-site-"));
  fs.writeFileSync(path.join(site, "index.json"), JSON.stringify({ skins: [{ file: "c-teacher.json" }, { file: "../../etc/passwd" }, { file: "huge.json" }, { file: "missing.json" }] }));
  fs.writeFileSync(path.join(site, "c-teacher.json"), JSON.stringify(teacher));
  fs.writeFileSync(path.join(site, "huge.json"), JSON.stringify({ id: "huge", desc: "x".repeat(90000) }));
  const srv = http.createServer((q, r) => { const f = path.join(site, path.basename(q.url)); if (fs.existsSync(f)) r.end(fs.readFileSync(f)); else { r.statusCode = 404; r.end(); } }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}/`;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "skin-user-"));
  const env = { dev: true, res: data, user: path.join(data, "u"), documents: path.join(data, "d"), version: "t", send() {}, pickDir: async () => null, pickFile: async () => null, trash: async () => {}, reveal() {}, openPath() {}, openExternal() {} };
  let svc = createService({ ...env, skinBase: base });
  const r1 = await svc.H.skinStore();
  assert.equal(r1.online, true); assert.deepStrictEqual(r1.skins.map((s) => s.id), ["c-teacher"]);
  ok("商店：从网站拿列表；奇怪的文件名、超过 80KB、拿不到的都跳过");
  srv.close();
  svc = createService({ ...env, skinBase: "http://127.0.0.1:1/" });
  const r2 = await svc.H.skinStore();
  assert.equal(r2.online, false); assert.deepStrictEqual(r2.skins.map((s) => s.id), ["c-teacher"]);
  ok("断网：用上次拿到的皮肤");
  assert.equal(svc.H.setSettings({ skin: teacher }).skin.id, "c-teacher");
  assert.equal(svc.H.setSettings({ skin: { id: "../x" } }).skin.id, "c-teacher");
  assert.equal(svc.H.setSettings({ skin: null }).skin, null);
  ok("设置：只存合格的皮肤；换回原版存 null");
  console.log("皮肤商店：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
