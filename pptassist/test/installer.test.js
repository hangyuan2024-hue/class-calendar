// 一键下载安装：读国内存储的清单、下分卷压缩包（断点续传、校验）、7-Zip 解压、找到整合包的文件夹；模型和插件也先走国内存储
"use strict";
const assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto");
const { execFileSync } = require("child_process");
const INST = require("../core/installer");
const MIRROR = require("../core/mirror");
const E = require("../core/engine");
const W = require("../core/workflows");
const DL = require("../core/dl");
const ok = (m) => console.log("✓ " + m);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "inst-"));
  const z = INST.sevenZip();
  try { fs.chmodSync(z, 0o755); } catch (e) {}
  // 做一个假的 ComfyUI 整合包，压成 7z 分卷（每卷 3KB）
  const src = path.join(tmp, "src", "ComfyUI_windows_portable");
  fs.mkdirSync(path.join(src, "ComfyUI", "comfy"), { recursive: true }); fs.mkdirSync(path.join(src, "python_embeded"));
  fs.writeFileSync(path.join(src, "ComfyUI", "main.py"), "print('hi')\n"); fs.writeFileSync(path.join(src, "python_embeded", "python.exe"), crypto.randomBytes(9000));
  execFileSync(z, ["a", "-v3k", "-mx=1", path.join(tmp, "pk", "ComfyUI_windows_portable_nvidia.7z"), src], { stdio: "ignore" });
  const vols = fs.readdirSync(path.join(tmp, "pk")).sort();
  assert.ok(vols.length >= 3 && vols[0].endsWith(".7z.001"), vols.join());
  const files = Object.fromEntries(vols.map((v) => [v, fs.readFileSync(path.join(tmp, "pk", v))]));
  // 假的 GPT-SoVITS 整合包（一个 7z，不分卷）
  const gsvSrc = path.join(tmp, "src", "GPT-SoVITS-v2pro-20250604"); fs.mkdirSync(path.join(gsvSrc, "runtime"), { recursive: true }); fs.writeFileSync(path.join(gsvSrc, "api_v2.py"), "");
  execFileSync(z, ["a", "-mx=1", path.join(tmp, "gs", "GPT-SoVITS-v2pro-20250604.7z"), gsvSrc], { stdio: "ignore" });
  files["GPT-SoVITS-v2pro-20250604.7z"] = fs.readFileSync(path.join(tmp, "gs", "GPT-SoVITS-v2pro-20250604.7z"));
  const model = crypto.randomBytes(20000), zipNode = fs.readFileSync(path.join(__dirname, "fixtures", "sample.pptx"));   // pptx 就是 zip
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  // 假的国内存储 + 清单
  let hits = [];
  const srv = http.createServer((q, r) => {
    const u = new URL(q.url, "http://x"); hits.push(u.pathname);
    if (u.pathname === "/download/ai-mirror.json") {
      const B = `http://127.0.0.1:${srv.address().port}`;
      const f = {};
      vols.forEach((v) => { f["ai/pkg/comfyui-v0.45.0/" + v] = { group: "comfyui", name: v, url: `${B}/ai/pkg/${v}`, size: files[v].length, sha256: sha(files[v]), pkg: "comfyui", ver: "v0.45.0" }; });
      f["ai/pkg/gsv-20250604/GPT-SoVITS-v2pro-20250604.7z"] = { name: "GPT-SoVITS-v2pro-20250604.7z", url: `${B}/ai/pkg/GPT-SoVITS-v2pro-20250604.7z`, size: files["GPT-SoVITS-v2pro-20250604.7z"].length, pkg: "gsv", ver: "20250604" };
      f["ai/pkg/comfyui-v0.44.0/old.7z"] = { name: "old.7z", url: `${B}/ai/pkg/old.7z`, size: 5, pkg: "comfyui", ver: "v0.44.0" };
      f["ai/models/vae/qwen_image_vae.safetensors"] = { name: "qwen_image_vae.safetensors", url: `${B}/ai/models/vae`, size: model.length, sha256: sha(model), model: "qwenVae" };
      f["ai/models/diffusion_models/wan2.1-i2v-14b-480p-Q5_K_M.gguf"] = { name: "wan2.1-i2v-14b-480p-Q5_K_M.gguf", url: `${B}/ai/models/q5`, size: model.length, model: "wanI2V", src: "https://huggingface.co/city96/Wan2.1-I2V-14B-480P-gguf/resolve/main/wan2.1-i2v-14b-480p-Q5_K_M.gguf" };
      f["ai/nodes/x.zip"] = { name: "x.zip", url: `${B}/ai/nodes/x.zip`, size: zipNode.length, node: W.NODE_PACKS[0].dir, commit: W.NODE_PACKS[0].commit };
      r.setHeader("content-type", "application/json"); return r.end(JSON.stringify({ files: f }));
    }
    let body = null;
    if (u.pathname.startsWith("/ai/pkg/")) body = files[u.pathname.slice(8)];
    if (u.pathname === "/ai/models/vae" || u.pathname === "/ai/models/q5") body = model;
    if (u.pathname === "/ai/nodes/x.zip") body = zipNode;
    if (!body) { r.statusCode = 404; return r.end(); }
    const m = /bytes=(\d+)-/.exec(q.headers.range || "");
    if (m) { r.writeHead(206, { "content-length": body.length - m[1] }); return r.end(body.subarray(+m[1])); }
    r.writeHead(200, { "content-length": body.length }); r.end(body);
  });
  await new Promise((ok2) => srv.listen(0, "127.0.0.1", ok2));
  const B = `http://127.0.0.1:${srv.address().port}`;
  const mirror = MIRROR.create({ sources: [B + "/nope.json", B + "/download/ai-mirror.json"] });

  const pk = await mirror.pkg("comfyui");
  assert.equal(pk.ver, "v0.45.0"); assert.deepStrictEqual(pk.parts.map((x) => x.name), vols);
  assert.equal(await mirror.pkg("hy3d"), null);
  ok("清单：第一个地址读不到换下一个；整合包挑最新版本，分卷按顺序");

  // 路径有中文 / 空格：不让装
  await assert.rejects(INST.install("comfyui", path.join(tmp, "中文"), { mirror }), /中文或空格/);
  await assert.rejects(INST.install("comfyui", path.join(tmp, "a b"), { mirror }), /中文或空格/);
  // 空间不够
  await assert.rejects(INST.install("comfyui", path.join(tmp, "big"), { mirror, extraSpace: 1e18 }), /空间不够/);
  ok("装之前查：路径只能是英文和数字、硬盘空间够不够");

  // 装：下载（第二卷先放一半，测续传）→ 校验 → 解压 → 找到文件夹
  const parent = path.join(tmp, "AI");
  const home = path.join(parent, INST.SUB.comfyui, "_downloading");
  fs.mkdirSync(home, { recursive: true }); fs.writeFileSync(path.join(home, vols[1] + ".part"), files[vols[1]].subarray(0, 1000));
  const msgs = []; hits = [];
  const r = await INST.install("comfyui", parent, { mirror, onMsg: (m) => msgs.push(m) });
  assert.equal(r.dir, path.join(parent, INST.SUB.comfyui, "ComfyUI_windows_portable")); assert.equal(r.ver, "v0.45.0");
  assert.ok(fs.existsSync(path.join(r.dir, "ComfyUI", "main.py")));
  assert.equal(E.inspect(r.dir).ok, process.platform === "win32");   // 假的 Python 只放了 python.exe
  assert.ok(!fs.existsSync(home), "压缩包装完删掉");
  assert.ok(msgs.some((m) => m.stage === "extract" && m.p === 0) && msgs.some((m) => m.stage === "check"));
  ok("一键装：从国内存储下分卷（断了接着下）、校验 sha256、7-Zip 解压、找到整合包的文件夹、删掉压缩包");

  // 下坏了：校验不通过，删掉重下，还不对就报错
  const bad = MIRROR.create({ fetch: async (u, o) => { const res = await fetch(u, o); if (!/ai-mirror/.test(u)) return res; const j = await res.json(); for (const v of Object.values(j.files)) if (v.sha256) v.sha256 = "0".repeat(64); return new Response(JSON.stringify(j)); }, sources: [B + "/download/ai-mirror.json"] });
  await assert.rejects(INST.install("comfyui", path.join(tmp, "AI2"), { mirror: bad }), /校验没通过/);
  ok("文件校验不通过：不解压，报错");

  // 模型、插件也先走国内存储
  const eng = E.create({ mirror, hf: ["https://hf.example"], gh: [""], pip: [""] });
  const vae = await eng.resolve("qwenVae", 12);
  assert.equal(vae.urls[0], B + "/ai/models/vae"); assert.equal(vae.urls[1], "https://hf.example/Comfy-Org/Qwen-Image_ComfyUI/resolve/main/split_files/vae/qwen_image_vae.safetensors"); assert.equal(vae.sha256, sha(model));
  const wan = await eng.resolve("wanI2V", 16);
  assert.equal(wan.name, "wan2.1-i2v-14b-480p-Q5_K_M.gguf"); assert.equal(wan.urls[0], B + "/ai/models/q5"); assert.equal(wan.urls[1], "https://hf.example/city96/Wan2.1-I2V-14B-480P-gguf/resolve/main/wan2.1-i2v-14b-480p-Q5_K_M.gguf");
  const d = path.join(tmp, "m.bin"); await DL.download(vae.urls, d, { want: { size: vae.size, sha256: vae.sha256 } }); assert.deepStrictEqual(fs.readFileSync(d), model);
  assert.ok((await mirror.node(W.NODE_PACKS[0].dir, W.NODE_PACKS[0].commit)).url.endsWith("/ai/nodes/x.zip"));
  ok("模型、插件：国内存储里有就先从国内下，Hugging Face / GitHub 镜像当后备");

  // 清单里没有的整合包：说清楚怎么办
  await assert.rejects(INST.install("hy3d", path.join(tmp, "AI3"), { mirror }), /AI 组件搬到国内存储/);

  // 软件里：「一键下载安装 GPT-SoVITS」装好自动选上那个文件夹
  const { createService } = require("../core/service");
  const user = path.join(tmp, "user"); fs.mkdirSync(user);
  const sends = [];
  const svc = createService({ user, documents: user, version: "t", send: (ch, d) => sends.push([ch, d]), pickFile: async () => null, pickDir: async () => path.join(tmp, "AI4"), openPath() {}, reveal() {}, openExternal() {}, voiceOpt: {}, mirrorOpt: { sources: [B + "/download/ai-mirror.json"] } });
  const info = await svc.H.setupInfo();
  assert.equal(info.pkg.comfyui.ver, "v0.45.0"); assert.equal(info.pkg.gsv.ver, "20250604"); assert.equal(info.pkg.hy3d, null); assert.equal(info.feat.portrait.cn, false);
  const gd = await svc.H.voiceInstall();
  assert.equal(gd, path.join(tmp, "AI4", INST.SUB.gsv, "GPT-SoVITS-v2pro-20250604")); assert.equal(svc.H.state().profile.gsvDir, gd);
  assert.ok(sends.some(([ch, d]) => ch === "setup" && d.kind === "gsv" && d.stage === "extract"));
  await assert.rejects(svc.H.ai3dInstall(), /AI 组件搬到国内存储/);
  svc.shutdown();
  ok("软件里一键装 GPT-SoVITS：装好自动选上；国内存储里没有的给出提示");
  ok("国内存储里还没有：提示先运行「AI 组件搬到国内存储」");
  srv.close();
  console.log("一键下载安装：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
