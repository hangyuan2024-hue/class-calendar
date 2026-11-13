// 训练老师的声音（假的 GPT-SoVITS 整合包：检查我们交给它的东西对不对、流程走通）：
//   · 老师录的每一句（有讲稿）+ 导入的整段录音（切开、识别）→ 训练列表
//   · 预处理三步（环境变量和 GPT-SoVITS 训练界面一样）→ 合并 → 写训练配置 → SoVITS → GPT → 用 api_v2 念 3 句试听
//   · 发布成「voice-老师名字」：不进公开清单，凭声音码才能下载
"use strict";
process.removeAllListeners("warning"); process.on("warning", () => {});
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-voice-"));
process.env.LG_ADMIN_HOME = path.join(tmp, "admin");
const Server = require("../server");
const Agent = require("../worker/agent");
const Tools = require("../tools/grid");
const ROOT = path.join(__dirname, "..");
const PY = process.env.PYTHON || "python3";
const ok = (m) => console.log("✓", m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f, what, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };
const W = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// 一段 1.5 秒的 wav（16 位、32k）
function wav(f, sec = 1.5) {
  const n = Math.floor(32000 * sec), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(32000, 24); b.writeUInt32LE(64000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * 8000), 44 + i * 2);
  W(f, b);
  return f;
}

// ---------- 假的 GPT-SoVITS 整合包 ----------
const G = path.join(tmp, "GPT-SoVITS");
const need = (keys) => `import os,sys\nmiss=[k for k in ${JSON.stringify(keys)} if not os.environ.get(k)]\nassert not miss, "缺环境变量 %s" % miss\n`;
W(path.join(G, "api_v2.py"), `import sys,json,http.server
port=int(sys.argv[sys.argv.index("-p")+1])
class H(http.server.BaseHTTPRequestHandler):
  def log_message(self,*a): pass
  def do_GET(self):
    self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
  def do_POST(self):
    n=int(self.headers.get("Content-Length",0)); b=json.loads(self.rfile.read(n))
    assert b["ref_audio_path"] and b["prompt_text"]
    self.send_response(200); self.end_headers(); self.wfile.write(b"RIFF"+b"\\0"*9000)
http.server.HTTPServer(("127.0.0.1",port),H).serve_forever()
`);
const PDS = path.join(G, "GPT_SoVITS", "prepare_datasets");
W(path.join(PDS, "1-get-text.py"), need(["inp_text", "exp_name", "opt_dir", "bert_pretrained_dir", "i_part", "all_parts", "version"]) + `
rows=[l.split("|") for l in open(os.environ["inp_text"],encoding="utf-8").read().splitlines() if l]
assert all(len(r)==4 and os.path.exists(r[0]) and r[2]=="zh" and r[3] for r in rows), rows
open(os.path.join(os.environ["opt_dir"],"2-name2text-0.txt"),"w",encoding="utf-8").write("\\n".join("%s\\tph\\t1\\t%s"%(os.path.basename(r[0]),r[3]) for r in rows))
`);
W(path.join(PDS, "2-get-hubert-wav32k.py"), need(["inp_text", "exp_name", "opt_dir", "cnhubert_base_dir"]));
W(path.join(PDS, "3-get-semantic.py"), need(["inp_text", "exp_name", "opt_dir", "pretrained_s2G", "s2config_path"]) + `
rows=[l.split("|") for l in open(os.environ["inp_text"],encoding="utf-8").read().splitlines() if l]
open(os.path.join(os.environ["opt_dir"],"6-name2semantic-0.tsv"),"w",encoding="utf-8").write("\\n".join("%s\\t1 2 3"%os.path.basename(r[0]) for r in rows))
`);
W(path.join(G, "GPT_SoVITS", "s2_train.py"), `import sys,json,os
c=json.load(open(sys.argv[sys.argv.index("--config")+1],encoding="utf-8"))
assert c["train"]["pretrained_s2G"] and c["data"]["exp_dir"] and c["save_weight_dir"] and c["name"]
assert os.path.exists(os.path.join(c["data"]["exp_dir"],"2-name2text.txt"))
open(os.path.join(c["save_weight_dir"],c["name"]+"_e%d_s10.pth"%c["train"]["epochs"]),"wb").write(b"sovits")
`);
W(path.join(G, "GPT_SoVITS", "s1_train.py"), `import sys,os,yaml
c=yaml.safe_load(open(sys.argv[sys.argv.index("--config_file")+1],encoding="utf-8"))
assert open(c["train_semantic_path"],encoding="utf-8").readline().startswith("item_name\\tsemantic_audio")
assert os.path.exists(c["train_phoneme_path"]) and c["pretrained_s1"]
open(os.path.join(c["train"]["half_weights_save_dir"],c["train"]["exp_name"]+"-e%d.ckpt"%c["train"]["epochs"]),"wb").write(b"gpt")
`);
W(path.join(G, "GPT_SoVITS", "configs", "s2.json"), JSON.stringify({ train: { batch_size: 32, epochs: 100 }, data: {}, model: {} }));
W(path.join(G, "GPT_SoVITS", "configs", "s1longer-v2.yaml"), "train:\n  batch_size: 8\n  epochs: 20\n");
for (const f of ["gsv-v2final-pretrained/s2G2333k.pth", "gsv-v2final-pretrained/s2D2333k.pth", "gsv-v2final-pretrained/s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt", "chinese-roberta-wwm-ext-large/config.json", "chinese-hubert-base/config.json"])
  W(path.join(G, "GPT_SoVITS", "pretrained_models", f), "x");
W(path.join(G, "tools", "slice_audio.py"), `import sys,os,shutil
i,o=sys.argv[1],sys.argv[2]
for f in os.listdir(i): shutil.copy(os.path.join(i,f),os.path.join(o,"cut_"+f))
`);
W(path.join(G, "tools", "asr", "funasr_asr.py"), `import sys,os
a=sys.argv; i=a[a.index("-i")+1]; o=a[a.index("-o")+1]
open(os.path.join(o,os.path.basename(i)+".list"),"w",encoding="utf-8").write("\\n".join("%s|x|ZH|导入录音里识别出来的一句话"%os.path.join(i,f) for f in sorted(os.listdir(i))))
`);
// 假的 ffmpeg：输入本来就是 wav，照抄
const FF = path.join(tmp, "ff.py");
W(FF, "import sys,shutil\na=sys.argv\nshutil.copy(a[a.index('-i')+1],a[-1])\n");

(async () => {
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000, noTick: true });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 3, server: url });
  const j = await Agent.join(inv.link, "王老师", { name: "王老师的电脑" });
  const ensured = [];
  const ag = Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, "w"), python: PY, caps: { vram: 6, gsv: true }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
    gsv: { ensure: async (say) => { ensured.push(1); say("装好了"); return { dir: G, python: PY, ffmpegCmd: [PY, FF] }; } } });

  // 王老师在「录声音和表情」里录了两段（每段 10 句）
  await Tools.plan(admin, path.join(ROOT, "plans", "voice.json"));
  const rj = app.core.db.prepare("select id from jobs where name like '录声音%'").get().id;
  for (let seg = 0; seg < 2; seg++) {
    const h = (await ag.api("/api/human/next", { job: rj })).item;
    const outs = [];
    for (let i = 0; i < 10; i++) {
      const f = wav(path.join(tmp, "rec", `${seg}`, `s${String(i).padStart(3, "0")}.webm`), 2 + (i % 3));
      outs.push(await ag.upload(rj, h.task.id, f, "rec"));
      W(path.join(tmp, "rec", `${seg}`, `s${String(i).padStart(3, "0")}.json`), "[]");
      outs.push(await ag.upload(rj, h.task.id, path.join(tmp, "rec", `${seg}`, `s${String(i).padStart(3, "0")}.json`), "rec"));
    }
    await ag.api("/api/human/done", { task: h.task.id, outputs: outs, result: { secs: 30 } });
  }
  // 还导入了一段手机录音
  const imp = wav(path.join(tmp, "手机录音.m4a"), 3);
  await Tools.api(admin, "/api/admin/import/done", { member: "王老师", key: "x", name: "a" }).then(() => assert.fail("坏的 key 也收"), (e) => assert.match(e.message, /文件不对/));
  const st = await Tools.api(admin, "/api/admin/import/start", { name: "phone.m4a" });
  assert.ok((await fetch(st.url, { method: "PUT", body: fs.readFileSync(imp) })).ok);
  await Tools.api(admin, "/api/admin/import/done", { member: "王老师", key: st.key, name: "phone.m4a", size: fs.statSync(imp).size });
  const vd = app.core.voiceData("王老师");
  assert.equal(Object.keys(vd.texts).length, 20, "录的 20 句都有讲稿"); assert.equal(Object.keys(vd.files).filter((k) => k.startsWith("imp")).length, 1);
  assert.equal(vd.texts[Object.keys(vd.texts)[0]], JSON.parse(fs.readFileSync(path.join(ROOT, "plans", "voice.json"), "utf8")).jobs[0].params.items[0].lines[0]);
  ok("王老师的声音数据：录的每一句都对上讲稿（20 句），还有 1 段导入的手机录音");

  // 设好「声音训练」，训练王老师的声音
  const plan = JSON.parse(fs.readFileSync(path.join(ROOT, "plans", "voice-train.json"), "utf8"));
  const pf = path.join(tmp, "vt.json");
  fs.writeFileSync(pf, JSON.stringify({ ...plan, stages: plan.stages.map((s) => ({ ...s, recipeFile: path.join(ROOT, "recipes", "voice_train.py"), params: { ...s.params, minSeconds: 20 } })) }));
  await Tools.cycle(admin, pf);
  const r = await Tools.api(admin, "/api/admin/pipeline/run", { name: "声音训练", extra: { member: "王老师", voiceOf: "王老师" } });
  ag.start();
  await until(() => app.core.db.prepare("select state from runs where id=?").get(r.run).state !== "running", "训练王老师的声音").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null").all()); throw e; });
  ag.stop();
  assert.equal(app.core.db.prepare("select state from runs where id=?").get(r.run).state, "done");
  assert.equal(ensured.length, 1, "先准备好 GPT-SoVITS");
  const res = JSON.parse(app.core.db.prepare("select result from tasks t join jobs j on j.id=t.job_id where j.run_id=?").get(r.run).result);
  assert.equal(res.clips, 21, "20 句录的 + 1 句导入识别出来的"); assert.equal(res.version, "v2");
  assert.equal(app.core.db.prepare("select count(*) as n from outputs o join jobs j on j.id=o.job_id where j.run_id=? and o.name like 'sample-%'").get(r.run).n, 3, "念了 3 句试听");
  ok(`训练王老师的声音：${res.clips} 句（${res.minutes} 分钟）→ 预处理 → 音色 → 语气 → 念 3 句试听`);

  // 不公开：公开清单里没有；凭声音码才能下载
  const pubm = await (await fetch(url + "/pub/models/manifest.json")).json();
  assert.ok(!pubm.models["voice-王老师"], "老师的声音不进公开清单");
  const code = (await Tools.api(admin, "/api/admin/model/code", { name: "voice-王老师" })).code;
  const pm = await (await fetch(`${url}/pub/private/${code}/manifest.json`)).json();
  const m = pm.models["voice-王老师"];
  assert.ok(m && m.files.map((f) => f.name).join() === "gpt,sovits,ref,reftext");
  assert.equal(await (await fetch(m.files[0].url)).text(), "gpt", "凭声音码能下载");
  assert.equal((await fetch(m.files[0].url.replace(/\?c=.*/, ""))).status, 404, "没有声音码下载不了");
  assert.equal((await fetch(`${url}/pub/private/wrongcode123/manifest.json`)).status, 404);
  const code2 = (await Tools.api(admin, "/api/admin/model/code", { name: "voice-王老师", rotate: true })).code;
  assert.notEqual(code2, code); assert.equal((await fetch(m.files[0].url)).status, 404, "换了码，旧的作废");
  ok("老师的声音不公开：公开清单里没有；凭声音码才能下载；码泄露了可以换，旧的作废");

  app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("训练老师的声音：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
