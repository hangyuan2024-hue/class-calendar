// 捞小智的形象（app/avatar.js）：照片要先勾授权；装 3D 引擎 → 画 Q版 → 挑一张 → 做成 3D → 换上；导入 avatar.glb；一键删除
"use strict";
const assert = require("assert"), fs = require("fs"), os = require("os"), path = require("path");
const AV = require("../app/avatar");
const ok = (m) => console.log("✓", m);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-av-"));
  const base = path.join(tmp, "data"); fs.mkdirSync(base);
  const photo = path.join(tmp, "me.jpg"); fs.writeFileSync(photo, Buffer.alloc(2000, 7));
  const glb = path.join(tmp, "a.glb"); fs.writeFileSync(glb, Buffer.concat([Buffer.from("glTF"), Buffer.alloc(3000)]));
  let pick = null; const runs = [];
  const hy = path.join(base, "ai", "LaolaoAI-Hunyuan3D");
  const ai3dMod = { inspect: (d) => (d && fs.existsSync(path.join(d, "hy3dgen")) ? { ok: true, dir: d, python: "py", hy: d } : { ok: false }) };
  const ai3dFactory = () => ({ state: () => ({ busy: false }), cancel: () => true, run: async (rt, args, onMsg) => {
    runs.push(args[0]); onMsg({ msg: "在做 " + args[0], p: 0.5 });
    const at = (k) => args[args.indexOf(k) + 1];
    if (args[0] === "stylize") for (let i = 0; i < +at("--n"); i++) fs.writeFileSync(path.join(at("--out"), `cand_${i}.png`), "png" + i);
    if (args[0] === "to3d") fs.writeFileSync(at("--out"), "raw");
    if (args[0] === "build") fs.writeFileSync(path.join(at("--out"), "avatar.glb"), Buffer.concat([Buffer.from("glTF"), Buffer.alloc(100)]));
    return { done: true, notes: ["眼睛和嘴绑好了"] };
  } });
  const install = async (kind, parent, { onMsg }) => { assert.equal(kind, "hy3d"); onMsg({ msg: "下载 3D 引擎 30%" }); fs.mkdirSync(path.join(parent, "LaolaoAI-Hunyuan3D", "hy3dgen"), { recursive: true }); return { dir: path.join(parent, "LaolaoAI-Hunyuan3D") }; };
  const av = AV.create({ base: () => base, pickFile: async () => pick, ai3dMod, ai3dFactory, install });
  const ev = []; const H = AV.handlers(av, (e) => ev.push(e));

  let st = await H.showAvatar();
  assert.equal(st.use, "robot"); assert.equal(st.ready, false);
  await assert.rejects(() => H.showAvatarStylize(), /先装好 3D 引擎/);
  st = await H.showAvatarInstall();
  assert.equal(st.ready, true); assert.deepEqual(runs, ["setup"]); assert.ok(ev.some((e) => /3D 引擎 30%/.test(e.text)));
  ok("装 3D 引擎：下整合包（进度报给界面）、装工坊要的组件；没装好不能画");

  pick = photo;
  await assert.rejects(() => H.showAvatarPhoto({}), /授权|同意/);
  st = await H.showAvatarPhoto({ ok: true });
  assert.equal(st.photo, true); assert.ok(st.consent && st.consent.at);
  ok("上传照片：不勾授权传不了；勾了才存（只存在这台电脑上），记下授权时间");

  const urls = await H.showAvatarStylize({ n: 3 });
  assert.equal(urls.length, 3); assert.match(urls[0], /^data:image\/png;base64,/);
  await assert.rejects(() => H.showAvatarBuild(), /先挑一张/);
  await H.showAvatarChoose(1);
  st = await H.showAvatarBuild();
  assert.equal(st.use, "3d"); assert.deepEqual(st.notes, ["眼睛和嘴绑好了"]);
  assert.deepEqual(runs, ["setup", "stylize", "to3d", "build"]);
  const m = await H.showAvatarModel(); assert.equal(Buffer.from(m, "base64").toString("ascii", 0, 4), "glTF");
  ok("画 3 张 Q版 → 挑一张 → 做成 3D、绑好眼睛和嘴 → 自动换上，界面拿得到 avatar.glb");

  st = await H.showAvatarUse("robot"); assert.equal(st.use, "robot"); assert.equal(await H.showAvatarModel(), null);
  pick = path.join(tmp, "x.glb"); fs.writeFileSync(pick, "not a model at all, definitely not glTF" + "x".repeat(2000));
  await assert.rejects(() => H.showAvatarImport(), /不是 \.glb/);
  pick = glb; st = await H.showAvatarImport(); assert.equal(st.use, "3d");
  ok("换回机器人；导入做好的 avatar.glb（不是 glb 的不收）");

  st = await H.showAvatarWipe();
  assert.equal(st.use, "robot"); assert.equal(st.photo, false); assert.equal(st.has3d, false); assert.equal(st.consent, null);
  assert.ok(!fs.existsSync(path.join(base, "avatar", "cands")));
  ok("一键删除：照片、立绘、3D 模型都删掉，授权撤回，换回机器人");
  console.log("捞小智的形象：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
