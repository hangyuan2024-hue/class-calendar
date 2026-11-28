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
process.env.LG_MIRROR = "off";   // 配方别去读真的组件镜像清单
process.env.NO_PROXY = process.env.no_proxy = "127.0.0.1,localhost" + (process.env.NO_PROXY ? "," + process.env.NO_PROXY : "");
const SLOW = process.platform === "win32" || process.env.CI ? 3 : 1;   // Windows / CI 上的机器慢
const until = async (f, what, ms = 90000) => { const t0 = Date.now(); while (Date.now() - t0 < ms * SLOW) { const v = await f(); if (v) return v; await sleep(100); } throw new Error("等太久了：" + what); };
const W = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// 一段 1.5 秒的 wav（16 位、32k）
// 带文字的录音（假的识别从 lgtx 块里读出「听到了什么」）
function wavT(f, sec, text) {
  wav(f, sec);
  const b = fs.readFileSync(f), t0 = Buffer.from(text, "utf8"), t = Buffer.concat([t0, Buffer.alloc(t0.length % 2)]);
  const head = Buffer.alloc(8); head.write("lgtx", 0); head.writeUInt32LE(t.length, 4);
  const out = Buffer.concat([b.subarray(0, 36), head, t, b.subarray(36)]); out.writeUInt32LE(out.length - 8, 4);
  W(f, out);
  return f;
}
function wav(f, sec = 1.5, hz = 509) {
  const n = Math.floor(32000 * sec), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(32000, 24); b.writeUInt32LE(64000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * hz * i) / 32000) * 8000), 44 + i * 2);
  W(f, b);
  return f;
}

// ---------- 假的 GPT-SoVITS 整合包 ----------
const G = path.join(tmp, "GPT-SoVITS");
const need = (keys) => `import os,sys\nmiss=[k for k in ${JSON.stringify(keys)} if not os.environ.get(k)]\nassert not miss, "缺环境变量 %s" % miss\n`;
W(path.join(G, "api_v2.py"), `import sys,json,http.server,struct,math
port=int(sys.argv[sys.argv.index("-p")+1])
def wav(text):
    n=112000; pcm=b"".join(struct.pack("<h",int(math.sin(2*math.pi*509*i/32000)*8000)) for i in range(n))
    t=text.encode("utf-8"); t+=b"\\0"*(len(t)%2)
    body=b"WAVE"+b"fmt "+struct.pack("<IHHIIHH",16,1,1,32000,64000,2,16)+b"lgtx"+struct.pack("<I",len(t))+t+b"data"+struct.pack("<I",len(pcm))+pcm
    return b"RIFF"+struct.pack("<I",len(body))+body
class H(http.server.BaseHTTPRequestHandler):
  def log_message(self,*a): pass
  def do_GET(self):
    self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
  def do_POST(self):
    n=int(self.headers.get("Content-Length",0)); b=json.loads(self.rfile.read(n))
    assert b["ref_audio_path"] and b["prompt_text"]
    txt=b["text"]
    if "银行" in txt and int(b.get("seed",1))%3==0: txt=txt.replace("银行","银航")
    self.send_response(200); self.end_headers(); self.wfile.write(wav(txt))
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
// 假的识别：显卡上（float16）直接崩掉、不留 Python 报错（就像显存不够时 Windows 上那样）；只有换 CPU（float32、看不到显卡）才认得出来
W(path.join(G, "tools", "asr", "funasr_asr.py"), `import sys,os
a=sys.argv; i=a[a.index("-i")+1]; o=a[a.index("-o")+1]
if a[a.index("-p")+1] == "float16": print("model is built", flush=True); os._exit(1)
if os.environ.get("CUDA_VISIBLE_DEVICES", "x") != "": os._exit(2)
def said(f):
    b=open(f,"rb").read(); k=b.find(b"lgtx")
    if k<0: return "导入录音里识别出来的一句话"
    n=int.from_bytes(b[k+4:k+8],"little"); return b[k+8:k+8+n].rstrip(b"\\0").decode("utf-8")
open(os.path.join(o,os.path.basename(i)+".list"),"w",encoding="utf-8").write("\\n".join("%s|x|ZH|%s"%(os.path.join(i,f),said(os.path.join(i,f))) for f in sorted(os.listdir(i))))
`);
// 假的说话人模型：声音高的（学生）和低的（老师）是两个人
W(path.join(G, "GPT_SoVITS", "pretrained_models", "sv", "pretrained_eres2netv2w24s4ep4.ckpt"), "x");
W(path.join(G, "GPT_SoVITS", "librosa.py"), `import wave, numpy as np
def load(f, sr=16000):
    w = wave.open(f); a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return a, sr
`);
W(path.join(G, "GPT_SoVITS", "torch.py"), `import numpy as np
class _C:
    @staticmethod
    def is_available(): return False
cuda = _C()
class T:
    def __init__(s, a): s.a = a
    def unsqueeze(s, i): return T(np.expand_dims(s.a, i))
    def to(s, d): return s
    def half(s): return s
    def float(s): return s
    def cpu(s): return s
    def numpy(s): return s.a
def from_numpy(a): return T(a)
`);
W(path.join(G, "GPT_SoVITS", "sv.py"), `import numpy as np, torch
class SV:
    def __init__(s, dev, half): pass
    def compute_embedding3(s, t):
        a = t.a.reshape(-1)
        z = float(np.mean(np.abs(np.diff(np.sign(a))) > 0))
        return torch.T(np.array([[1.0, 0.1, 0.0]] if z < 0.08 else [[0.0, 0.2, 1.0]]))
`);
// 假的 ffmpeg：输入本来就是 wav，照抄
const FF = path.join(tmp, "ff.py");
W(FF, "import sys,shutil,os\na=sys.argv\nshutil.copy(a[a.index('-i')+1],a[-1])\nif '-af' in a:\n  d=os.path.join(os.path.dirname(a[0]),'af'); os.makedirs(d,exist_ok=True)\n  open(os.path.join(d,os.path.basename(a[-1])+'.txt'),'w').write(a[a.index('-af')+1])\n");   // 一句一个文件：几个 ffmpeg 同时跑，往一个文件追加在 Windows 上会丢行

(async () => {
  const app = Server.create({ data: path.join(tmp, "server"), leaseMs: 5000, noTick: true });
  const port = await app.listen(0, "127.0.0.1");
  const url = `http://127.0.0.1:${port}`;
  const admin = await Tools.login(url, app.core.adminToken());
  const inv = await Tools.api(admin, "/api/admin/invite", { maxUses: 3, server: url });
  const j = await Agent.join(inv.link, "王老师", { name: "王老师的电脑" });
  const ensured = [];
  const ag = Agent.create({ token: j.token, pubkey: j.pubkey, server: url, workDir: path.join(tmp, "w"), python: PY, caps: { vram: 6, gsv: true }, tickMs: 100, hbMs: 300, leaseEveryMs: 100, renewMs: 300,
    gsv: { ensure: async (say) => { ensured.push(1); if (ensured.length === 1) await sleep(6500); say("装好了"); return { dir: G, python: PY, ffmpegCmd: [PY, FF] }; } } });

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
  // 控制中心网页上传讲课视频：先登记老师（她还没装捞捞算力也行），再 PUT 上传，登记成她的录音
  await Tools.api(admin, "/api/admin/member/add", { name: "李老师" });
  const vid = wav(path.join(tmp, "上课录像.mp4"), 4);
  const up = (who, name, body, tok = admin.token) => fetch(`${url}/api/admin/upload?member=${encodeURIComponent(who)}&name=${encodeURIComponent(name)}`, { method: "PUT", headers: { authorization: "Bearer " + tok }, body });
  assert.equal((await up("李老师", "a.mp4", fs.readFileSync(vid), "bad")).status, 401, "没有管理员口令传不了");
  assert.match((await (await up("李老师", "a.exe", fs.readFileSync(vid))).json()).error, /音频或视频/);
  assert.match((await (await up("张三", "a.mp4", fs.readFileSync(vid))).json()).error, /先登记/);
  const ur = await (await up("李老师", "第一节 课.mp4", fs.readFileSync(vid))).json();
  assert.ok(ur.ok && ur.size === fs.statSync(vid).size);
  const vl = await Tools.api(admin, "/api/admin/voices");
  const li = vl.find((v) => v.member === "李老师");
  assert.equal(li.imports.length, 1); assert.equal(li.imports[0].name, "第一节 课.mp4"); assert.equal(li.model, null);
  assert.equal(Object.keys(app.core.voiceData("李老师").files).length, 1);
  await Tools.api(admin, "/api/admin/member/add", { name: "李老师" });   // 登记两次也没事
  ok("控制中心网页传讲课视频：登记老师 → 上传（要管理员口令、只收音视频）→ 记成她的录音，列表里看得到");
  for (let i = 0; i < 11; i++) {
    const stu = i % 4 === 3;   // 2 段是学生说话（声音高）
    const f = wav(path.join(tmp, `lee${i}.wav`), 3, stu ? 1500 : 509);
    assert.ok((await (await up("李老师", `课堂${i}.wav`, fs.readFileSync(f))).json()).ok);
  }
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

  // 李老师的讲课视频：12 段里 2 段是学生 → 认说话人以后只用老师本人的 10 段
  const r3 = await Tools.api(admin, "/api/admin/pipeline/run", { name: "声音训练", extra: { member: "李老师", voiceOf: "李老师" } });
  ag.start();
  await until(() => app.core.db.prepare("select state from runs where id=?").get(r3.run).state !== "running", "训练李老师的声音").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null").all()); throw e; });
  ag.stop();
  assert.equal(app.core.db.prepare("select state from runs where id=?").get(r3.run).state, "done");
  const res3 = JSON.parse(app.core.db.prepare("select result from tasks t join jobs j on j.id=t.job_id where j.run_id=?").get(r3.run).result);
  assert.equal(res3.clips, 10, "学生说话的 2 段扔掉了");
  const afAll = () => fs.readdirSync(path.join(tmp, "af")).map((x) => fs.readFileSync(path.join(tmp, "af", x), "utf8"));
  const af0 = afAll().join("\n");
  assert.match(af0, /highpass=f=70,afftdn/, "导入的录音先去噪");
  const li2 = (await Tools.api(admin, "/api/admin/voices")).find((v) => v.member === "李老师");
  assert.equal(li2.model, 1); assert.equal(li2.run.state, "done");
  ok(`讲课视频清洗：去噪 → 切句 → 识别 → 认说话人（12 段里扔掉 2 段学生说话）→ 训练出李老师的声音`);

  // 不公开：公开清单里没有；凭声音码才能下载
  const pubm = await (await fetch(url + "/pub/models/manifest.json")).json();
  assert.ok(!pubm.models["voice-王老师"], "老师的声音不进公开清单");
  assert.ok(!(await (await fetch(url + "/dl/models/manifest.json")).json()).models["voice-王老师"], "dl 公开清单里也没有");
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

  // 网上公开的高质量录音（AISHELL-3）：只下挑中的那一位；第一个地址坏了换下一个
  const OD = path.join(tmp, "aishell3");
  W(path.join(OD, "spk-info.txt"), "# 说明\nSSB0001 B female north\nSSB0002 C female north\nSSB0003 C male north\nSSB0004 C female south\nSSB0005 B male south\nSSB0006 A male north\n");
  const content = [];
  for (const [spk, n] of [["SSB0001", 30], ["SSB0002", 12], ["SSB0003", 40], ["SSB0004", 50], ["SSB0005", 25], ["SSB0006", 10]])
    for (let i = 1; i <= n; i++) {
      const id = `${spk}${String(i).padStart(4, "0")}.wav`;
      content.push(`${id}\t同 tong2 学 xue2 们 men5 好 hao3 第 di4 ${i} 句`);
      wav(path.join(OD, "train", "wav", spk, id), 3.5);
    }
  W(path.join(OD, "train", "content.txt"), content.join("\n") + "\n");
  // 网上只传了一部分录音：SSB0002 有 5 句是 404（以前算成「网络不行」，超过三分之一整轮失败）
  for (let i = 8; i <= 12; i++) fs.rmSync(path.join(OD, "train", "wav", "SSB0002", `SSB0002${String(i).padStart(4, "0")}.wav`));
  const tcontent = [];
  for (const spk of ["SSB0101", "SSB0102", "SSB0103"]) for (let i = 1; i <= 3; i++) { const id = `${spk}${String(i).padStart(4, "0")}.wav`; tcontent.push(`${id}\t大 da4 家 jia1 好 hao3`); wav(path.join(OD, "test", "wav", spk, id), 4); }
  W(path.join(OD, "test", "content.txt"), tcontent.join("\n") + "\n");
  const hits = [];
  const http = require("http");
  const fsrv = http.createServer((q, s_) => { const fp = path.join(OD, decodeURIComponent(q.url.split("?")[0])); hits.push(q.url); if (fs.existsSync(fp) && fs.statSync(fp).isFile()) { s_.writeHead(200); s_.end(fs.readFileSync(fp)); } else { s_.writeHead(404); s_.end(); } });
  await new Promise((r_) => fsrv.listen(0, "127.0.0.1", r_));
  const ob = [`http://127.0.0.1:1/nothing`, `http://127.0.0.1:${fsrv.address().port}`];
  // 下面几段测的是「公开录音打碎」那条路（现在的 laolao-voice 改成了真人录音，参数换回打碎用的那套）
  const lp0 = JSON.parse(fs.readFileSync(path.join(ROOT, "plans", "laolao-voice.json"), "utf8"));
  const AISH = { openVoice: "aishell3", voiceOf: null, script: null, refPick: null, gender: "male", mix: 3, shift: 0, pitchAlign: true, maxClips: 600, minClips: 120, refText: "这个问题其实不难，我们先把已知条件理清楚，再一步一步往下推。", maxSim: 0.75, localMix: 6, minLocalClips: 100, ages: ["C", "D"], targetF0: 128, maxF0: 180, upMax: 0.5, downMax: 2.0 };
  const lp = { ...lp0, stages: lp0.stages.map((s) => ({ ...s, params: { ...s.params, ...AISH } })) };
  const lpf = path.join(tmp, "lv.json");
  fs.writeFileSync(lpf, JSON.stringify({ ...lp, stages: lp.stages.map((s) => ({ ...s, req: { ...s.req, vram: 5.5 }, recipeFile: path.join(ROOT, "recipes", "voice_train.py"), params: { ...s.params, minSeconds: 20, mix: 1, gender: "female", shift: 2, maxClips: 600, samples: s.params.samples.slice(0, 3) } })) }));
  await Tools.cycle(admin, lpf);
  const r2 = await Tools.api(admin, "/api/admin/pipeline/run", { name: "捞捞声音", extra: { openBase: ob.join(",") } });
  ag.start();
  await until(() => app.core.db.prepare("select state from runs where id=?").get(r2.run).state !== "running", "用公开录音训练").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null").all()); throw e; });
  ag.stop();
  assert.equal(app.core.db.prepare("select state from runs where id=?").get(r2.run).state, "done");
  const res2 = JSON.parse(app.core.db.prepare("select result from tasks t join jobs j on j.id=t.job_id where j.run_id=?").get(r2.run).result);
  assert.equal(res2.clips, 7, "挑的是 26～40 岁、北方口音的女声（SSB0002）；网上没有的 5 句跳过，不算网络不行，有的 7 句都用上");
  assert.ok(hits.every((h) => !/SSB000[134]/.test(h)), "别人的录音不下载");
  const af = afAll().filter((x) => /^asetrate/.test(x));
  assert.equal(af.length, 7); assert.match(af[0], /^asetrate=35919,aresample=32000,atempo=0\.8908/, "升 2 个半音、音色一起变、语速不变");
  const pub2 = await (await fetch(url + "/pub/models/manifest.json")).json();
  assert.ok(pub2.models["laolao-voice"] && pub2.models["laolao-voice"].files.map((f) => f.name).join() === "gpt,sovits,ref,reftext,params", "捞捞的声音公开发布，老师端自动下载");
  ok(`捞捞的专属声音：自动挑了 SSB0002（26～40 岁、北方、女），只下这一位的 ${res2.clips} 句，升 2 个半音（变成另一个「人」）；第一个地址坏了换下一个；网上没有的句子（404）直接跳过、不算失败；公开发布 laolao-voice`);

  // 同事电脑连 hf-mirror / Hugging Face 不稳（SSL EOF）：先从自己的存储下打好的包（说明 + 挑中那一位的录音），一个文件
  const tarDir = path.join(tmp, "pack"); fs.mkdirSync(path.join(tarDir, "aishell3"), { recursive: true });
  fs.copyFileSync(path.join(OD, "spk-info.txt"), path.join(tarDir, "aishell3", "spk-info.txt"));
  fs.writeFileSync(path.join(tarDir, "aishell3", "content.txt"), content.filter((l) => l.startsWith("SSB0001")).join("\n") + "\n");
  fs.writeFileSync(path.join(tarDir, "aishell3", "pick.txt"), "SSB0001\n");
  for (const f of fs.readdirSync(path.join(OD, "train", "wav", "SSB0001"))) fs.copyFileSync(path.join(OD, "train", "wav", "SSB0001", f), path.join(tarDir, "aishell3", f));
  require("child_process").execFileSync("tar", ["-cf", path.join(OD, "aishell3-laolao.tar"), "-C", tarDir, "aishell3"]);
  W(path.join(OD, "ai-mirror.json"), JSON.stringify({ files: { "ai/voicedata/aishell3-laolao.tar": { group: "voicedata", name: "aishell3-laolao.tar", url: `http://127.0.0.1:${fsrv.address().port}/aishell3-laolao.tar`, model: "aishell3" } } }));
  process.env.LG_MIRROR = `http://127.0.0.1:${fsrv.address().port}/ai-mirror.json`;
  hits.length = 0;
  const rP = await Tools.api(admin, "/api/admin/pipeline/run", { name: "捞捞声音", extra: { openBase: "http://127.0.0.1:1/nothing" } });
  ag.start();
  await until(() => app.core.db.prepare("select state from runs where id=?").get(rP.run).state !== "running", "从自己的存储下公开录音").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null order by id desc limit 2").all()); throw e; });
  ag.stop();
  process.env.LG_MIRROR = "off";
  assert.equal(app.core.db.prepare("select state from runs where id=?").get(rP.run).state, "done", "hf-mirror / Hugging Face 都连不上也能训");
  const resP = JSON.parse(app.core.db.prepare("select result from tasks t join jobs j on j.id=t.job_id where j.run_id=?").get(rP.run).result);
  assert.equal(resP.clips, 30, "用的是包里选好的那一位（SSB0001）的 30 句");
  assert.ok(hits.some((h) => /aishell3-laolao\.tar/.test(h)) && hits.every((h) => !/\/train\//.test(h)), "只下了一个包，没再一句一句去下");
  ok("公开录音先从自己的存储下打好的包：hf-mirror / Hugging Face 连不上（SSL 断开）也能训捞捞的声音");

  // 打碎成捞捞自己的声音：挑几位录音多的男声混在一起训（每人一样多），参考声音用新模型自己念的、不用原来哪位的录音
  hits.length = 0;
  const mixf = path.join(tmp, "lv-mix.json");
  fs.writeFileSync(mixf, JSON.stringify({ ...lp, stages: lp.stages.map((s) => ({ ...s, req: { ...s.req, vram: 5.5 }, recipeFile: path.join(ROOT, "recipes", "voice_train.py"), params: { ...s.params, minSeconds: 20, mix: 2, shift: 1, maxClips: 40, minClips: 10, refText: "你好，我是捞捞。" } })) }));
  await Tools.cycle(admin, mixf);
  const rM = await Tools.api(admin, "/api/admin/pipeline/run", { name: "捞捞声音", extra: { openBase: ob.join(",") } });
  const logsM = []; ag.on("log", (l) => logsM.push(String((l && l.msg) || l)));
  ag.start();
  await until(() => app.core.db.prepare("select state from runs where id=?").get(rM.run).state !== "running", "打碎训练").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null order by id desc limit 2").all()); throw e; });
  ag.stop();
  assert.equal(app.core.db.prepare("select state from runs where id=?").get(rM.run).state, "done");
  const resM = JSON.parse(app.core.db.prepare("select result from tasks t join jobs j on j.id=t.job_id where j.run_id=?").get(rM.run).result);
  assert.equal(resM.clips, 40, "两位男声各 20 句（谁也不占大头）");
  assert.ok(hits.some((h) => /SSB0003/.test(h)) && hits.some((h) => /SSB0005/.test(h)) && hits.every((h) => !/SSB000[1246]\//.test(h)), "只下录音最多的两位男声：" + hits.filter((h) => /wav/.test(h)).slice(0, 3));
  const logM = logsM.join("\n");
  assert.ok(/打碎成捞捞自己的声音：2 位男声混在一起/.test(logM));
  ok("打碎：挑录音最多的几位男声、每人一样多混在一起训，音高对齐后整体挪；参考声音是新模型自己念的");

  // ---------- 声音底座：练习（念难句子、自动打分）→ 攒够了用所有老师 + 公开录音接着训整个模型 → 考试 → 发布 ----------
  const pools = app.core.db.prepare("select name from outputs where name like 'voicepool-%'").all();
  assert.ok(pools.length >= 2, "训练老师声音的时候，清洗好的录音交给了声音数据池");
  const bp = JSON.parse(fs.readFileSync(path.join(ROOT, "plans", "voice-base.json"), "utf8"));
  const bpf = path.join(tmp, "vb.json");
  const small = { drill: { sentences: 3, refs: 2, tries: 3, seed: 5 }, train: { aishellSpeakers: 2, clipsPer: 4, minSeconds: 20, evalSentences: 3, evalRefs: 3, seed: 7 } };
  fs.writeFileSync(bpf, JSON.stringify({ ...bp, stages: bp.stages.map((s) => ({ ...s, keep: 1, req: { ...s.req, vram: 5.5 }, recipeFile: path.join(ROOT, "recipes", "voice_base.py"), params: { ...s.params, ...small[s.key], openBase: ob.join(",") } })) }));
  await Tools.cycle(admin, bpf);
  const C = app.cycle;
  C.tick();
  const dj = app.core.db.prepare("select id from jobs where json_extract(params,'$.mode')='drill'").get();
  assert.ok(dj, "练习一直开着");
  ag.start();
  await until(() => app.core.db.prepare("select count(*) as n from tasks where job_id=? and state='done'").get(dj.id).n >= 1, "练习做完一个").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null").all().slice(-2)); throw e; });
  ag.stop();
  await sleep(300);
  const dres = JSON.parse(app.core.db.prepare("select result from tasks where job_id=? and state='done'").get(dj.id).result);
  assert.ok(dres.tried === 3 * 2 * 3, "3 句 × 2 个声音 × 念 3 遍");
  assert.ok(dres.kept >= 1 && dres.kept <= 6, "每句每个声音只留念得最好的一遍");
  const dk = app.core.db.prepare("select key from outputs where name like 'voicedrill-%'").get();
  assert.ok(dk, "最好的句子交上去了");
  ok(`声音练习：念难句子 ${dres.tried} 遍、识别回文字算错字率（${(dres.cer * 100).toFixed(1)}%）、比像不像 → 留 ${dres.kept} 句念得最好的`);

  const run = (await Tools.api(admin, "/api/admin/pipeline/run", { name: "声音底座" })).run;
  ag.start();
  await until(() => app.core.db.prepare("select state from runs where id=?").get(run).state !== "running", "训练声音底座", 120000).catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null").all().slice(-2)); throw e; });
  ag.stop();
  await sleep(300);
  assert.equal(app.core.db.prepare("select state from runs where id=?").get(run).state, "done");
  const bres = JSON.parse(app.core.db.prepare("select t.result from tasks t join jobs j on j.id=t.job_id where j.run_id=? and t.state='done'").get(run).result);
  assert.equal(bres.teachers, 2, "王老师、李老师（同一位老师交了好几份只用最新的）");
  assert.ok(bres.speakers >= 4 && bres.cer === 0 && bres.base_cer === 0);
  const vb = app.core.db.prepare("select * from models where name='voice-base' order by version desc").get();
  assert.ok(vb && vb.state === "released" && !vb.private, "声音底座公开发布");
  ok(`声音底座：${bres.teachers} 位老师 + 公开录音、${bres.speakers} 个说话人一起接着训整个模型 → 没参加训练的声音念考题（新旧都比）→ 发布 voice-base`);

  // 再训练李老师的声音：从声音底座接着训
  const r4 = await Tools.api(admin, "/api/admin/pipeline/run", { name: "声音训练", extra: { member: "李老师", voiceOf: "李老师" } });
  ag.start();
  await until(() => app.core.db.prepare("select state from runs where id=?").get(r4.run).state !== "running", "从底座训练李老师").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null").all().slice(-2)); throw e; });
  ag.stop();
  const res4 = JSON.parse(app.core.db.prepare("select t.result from tasks t join jobs j on j.id=t.job_id where j.run_id=? and t.state='done'").get(r4.run).result);
  assert.equal(res4.base, "voice-base", "老师的声音从底座接着训");
  ok("老师自己的声音：从声音底座接着训（底座越好，老师的声音越像）");

  // 打碎：本机已经有声音底座的公开录音包（aishell3-base）→ 直接用包里的男声，一句都不再去网上下
  {
    const cacheBase = (function find(d, n = 0) { if (n > 6 || !fs.existsSync(d)) return null; for (const x of fs.readdirSync(d, { withFileTypes: true })) { if (!x.isDirectory()) continue; const p = path.join(d, x.name); if (x.name === "aishell3-base") return p; const r = find(p, n + 1); if (r) return r; } return null; })(tmp);
    assert.ok(cacheBase, "声音底座下过公开录音包");
    const tr = path.join(cacheBase, "train");
    for (const spk of ["SSB0003", "SSB0005"]) { fs.mkdirSync(path.join(tr, spk), { recursive: true }); for (let i = 1; i <= 25; i++) wav(path.join(tr, spk, `${spk}9${String(i).padStart(3, "0")}.wav`), 3.5); }
    fs.appendFileSync(path.join(tr, "content.txt"), ["SSB0003", "SSB0005"].flatMap((spk) => Array.from({ length: 25 }, (_, i) => `${spk}9${String(i + 1).padStart(3, "0")}.wav\t大 da4 家 jia1 好 hao3 呀 ya5`)).join("\n") + "\n");
    hits.length = 0;
    const lf = path.join(tmp, "lv-local.json");
    fs.writeFileSync(lf, JSON.stringify({ ...lp, stages: lp.stages.map((s) => ({ ...s, req: { ...s.req, vram: 5.5 }, recipeFile: path.join(ROOT, "recipes", "voice_train.py"), params: { ...s.params, minSeconds: 20, mix: 2, minLocalClips: 40, refText: "你好，我是捞捞。" } })) }));
    await Tools.cycle(admin, lf);
    const rL = await Tools.api(admin, "/api/admin/pipeline/run", { name: "捞捞声音", extra: { openBase: "http://127.0.0.1:1/nothing" } });
    const logsL = []; ag.on("log", (l) => logsL.push(String((l && l.msg) || l)));
    ag.start();
    await until(() => app.core.db.prepare("select state from runs where id=?").get(rL.run).state !== "running", "打碎（本机录音包）").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null order by id desc limit 2").all()); throw e; });
    ag.stop();
    assert.equal(app.core.db.prepare("select state from runs where id=?").get(rL.run).state, "done");
    assert.ok(logsL.some((m) => /本机的公开录音包里有 \d+ 位男声/.test(m)), logsL.filter((m) => /本机|打碎/.test(m)).join("\n"));
    assert.ok(hits.every((h) => !/\/train\/wav\//.test(h)), "一句都没去网上下");
    ok("打碎：本机已经有公开录音包就直接用包里的几位男声，不再一句句去网上试（以前 8 分钟全是 404、0 句）");
  }

  // 把关：试听句识别回来错字太多 → 不发布（第 2 版念得全是乱的也发出去了）
  {
    const before = JSON.parse(JSON.stringify((await (await fetch(url + "/pub/models/manifest.json")).json()).models["laolao-voice"] || {}));
    const gf = path.join(tmp, "lv-gate.json");
    fs.writeFileSync(gf, JSON.stringify({ ...lp, stages: lp.stages.map((s) => ({ ...s, req: { ...s.req, vram: 5.5 }, recipeFile: path.join(ROOT, "recipes", "voice_train.py"), params: { ...s.params, minSeconds: 20, mix: 2, minLocalClips: 40, refText: "你好，我是捞捞。", maxCer: -1 } })) }));
    await Tools.cycle(admin, gf);
    const rG = await Tools.api(admin, "/api/admin/pipeline/run", { name: "捞捞声音", extra: { openBase: "http://127.0.0.1:1/nothing" } });
    ag.start();
    const logsG = []; ag.on("log", (l) => logsG.push(String((l && l.msg) || l)));
    await until(() => app.core.db.prepare("select count(*) n from tasks t join jobs j on j.id=t.job_id where j.run_id=? and t.error like '%不发布%'").get(rG.run).n > 0, "把关拦下").catch((e) => {
      console.log("任务：", app.core.db.prepare("select t.state, t.attempts, t.errors, substr(t.error,1,600) as error from tasks t join jobs j on j.id=t.job_id where j.run_id=?").all(rG.run));
      console.log("最后的日志：\n" + logsG.slice(-25).join("\n"));
      throw e;
    });
    ag.stop();
    const after = (await (await fetch(url + "/pub/models/manifest.json")).json()).models["laolao-voice"] || {};
    assert.equal(after.version, before.version, "没发布新版本");
    ok("把关：试听句识别回文字，错字率超过要求就不发布（念得乱的声音不会发给老师端）");
  }
  // 真人照录音稿念的录音：导入到「捞捞」名下 → 识别出来的字只用来找念的是哪一句，训练用稿子原文；对不上稿子的扔掉
  {
    await Tools.api(admin, "/api/admin/member/add", { name: "捞捞" });
    const up = (name, f) => fetch(`${url}/api/admin/upload?member=${encodeURIComponent("捞捞")}&name=${encodeURIComponent(name)}`, { method: "PUT", headers: { authorization: "Bearer " + admin.token }, body: fs.readFileSync(f) });
    const heard = [
      ["A.mp3", 5, "这个问题其实不难我们先把已知条件理清楚"],            // 参考句
      ["B.mp3", 6, "今天是2026年十一月二十七日星期五"],                  // 识别写成阿拉伯数字
      ["D.mp3", 5, "在派森里print函数会把结果显示出来"],                 // 英文词识别成了中文
      ["E.mp3", 4, "很好你说的非常清楚"],                                // 的 / 得 听错
      ["F.mp3", 5, "我们去吃火锅吧今晚上八点钟见"],                       // 稿子里没有：扔掉
      ["K.mp3", 8, "阳光穿过大气层的时候会碰到空气中很小的分子波长短的蓝光更容易被这些分子散射开来"],   // 跨两句
    ];
    for (const [n, sec, t] of heard) assert.ok((await (await up(n, wavT(path.join(tmp, "laolao", n.replace(".mp3", ".wav")), sec, t))).json()).ok);
    const sf = path.join(tmp, "lv-real.json");
    fs.writeFileSync(sf, JSON.stringify({ ...lp0, stages: lp0.stages.map((s) => ({ ...s, req: { ...s.req, vram: 5.5 }, recipeFile: path.join(ROOT, "recipes", "voice_train.py"), params: { ...s.params, minSeconds: 20 } })) }));
    await Tools.cycle(admin, sf);
    const rR = await Tools.api(admin, "/api/admin/pipeline/run", { name: "捞捞声音" });
    const logsR = []; ag.on("log", (l) => logsR.push(String((l && l.msg) || l)));
    ag.start();
    await until(() => app.core.db.prepare("select state from runs where id=?").get(rR.run).state !== "running", "真人录音训练").catch((e) => { console.log(app.core.db.prepare("select error from tasks where error is not null order by id desc limit 2").all()); throw e; });
    ag.stop();
    assert.equal(app.core.db.prepare("select state from runs where id=?").get(rR.run).state, "done", logsR.slice(-15).join("\n"));
    const resR = JSON.parse(app.core.db.prepare("select result from tasks t join jobs j on j.id=t.job_id where j.run_id=?").get(rR.run).result);
    assert.equal(resR.clips, 5, "对不上稿子的 1 段扔掉了");
    assert.ok(logsR.some((m) => /对照录音稿：5 段对上了稿子.*1 段对不上/.test(m)), logsR.filter((m) => /对照|识别/.test(m)).join("\n"));
    assert.ok(logsR.some((m) => /参考声音：用稿子里的「这个问题其实不难，我们先把已知条件理清楚。」/.test(m)), "参考句用稿子里指定的那句");
    const ao = app.core.db.prepare("select o.key from outputs o join jobs j on j.id=o.job_id where j.run_id=? and o.name like 'align%'").get(rR.run);
    assert.ok(ao, "每段对上了哪句交上去了（align.tsv）");
    const findF = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? findF(path.join(d, e.name)) : e.name === path.basename(ao.key) ? [path.join(d, e.name)] : []));
    const tl = fs.readFileSync(findF(path.join(tmp, "server"))[0], "utf8");
    assert.match(tl, /今天是二零二六年十一月二十七日，星期五。/, "数字换成稿子原文");
    assert.match(tl, /在 Python 里，print 函数会把结果显示出来。/);
    assert.match(tl, /很好，你说得非常清楚。/);
    assert.match(tl, /阳光穿过大气层的时候，会碰到空气中很小的分子。波长短的蓝光更容易被这些分子散射开来/, "跨两句的也对上了");
    assert.ok(!/火锅/.test(tl));
    const afR = afAll().join("\n");
    assert.match(afR, /highpass=f=80,afftdn=nf=-30/, "照稿子念的录音只轻度去噪");
    ok("真人录音：照录音稿对齐（识别的错字、阿拉伯数字、英文都换成稿子原文），对不上稿子的扔掉，参考句用稿子里指定的那句");
  }
  fsrv.close();

  app.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) {}   // Windows 上文件可能还没放开：清不掉也不算测试失败
  console.log("训练老师的声音：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
