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
  // 装了 AI 引擎（ComfyUI，模型在国内存储）：画 Q版立绘用它，不走 3D 工坊自己的画法（那条要从 Hugging Face 下模型，国内常连不上）
  {
    const base2 = path.join(tmp, "data2"); fs.mkdirSync(base2);
    const calls = [], runs2 = [];
    const comfy = { ready: async () => true, call: async (op, a, ctx) => {
      calls.push(op);
      if (op === "info") return { models: { qwenEdit: "q.safetensors", qwenClip: "c.safetensors", qwenVae: "v.safetensors", qwenFast: "f.safetensors" } };
      if (op === "upload") { assert.ok(fs.existsSync(path.join(ctx.dir, a.path)), "照片先拷进工作文件夹"); return { name: "lg-" + a.as }; }
      if (op === "run") {
        const g = a.graph, load = Object.values(g).find((n) => n.class_type === "LoadImage"), lat = Object.values(g).find((n) => n.class_type === "EmptySD3LatentImage");
        assert.equal(load.inputs.image, "lg-avatar-photo.jpg"); assert.equal(lat.inputs.batch_size, 3);
        const out = path.join(ctx.dir, "comfy-1"); fs.mkdirSync(out, { recursive: true });
        return { files: [0, 1, 2].map((i) => { const f = path.join(out, `p_${i}.png`); fs.writeFileSync(f, "png" + i); return f; }) };
      }
    } };
    const av2 = AV.create({ base: () => base2, pickFile: async () => photo, ai3dMod, ai3dFactory: () => ({ state: () => ({ busy: false }), cancel: () => true, run: async (rt, args) => { runs2.push(args[0]); return {}; } }), install, comfy });
    await av2.setPhoto({ ok: true });
    const u2 = await av2.stylize({ n: 3 });
    assert.equal(u2.length, 3); assert.deepEqual(calls, ["info", "upload", "run"]); assert.ok(!runs2.includes("stylize"), "没走 3D 工坊的画法");
    assert.ok(!fs.existsSync(path.join(base2, "avatar", "comfy")), "临时文件夹删掉了");
    ok("装了 AI 引擎：Q版立绘用 ComfyUI 画（模型在国内存储），不用 3D 工坊从 Hugging Face 下模型");
  }
  console.log("捞小智的形象：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
