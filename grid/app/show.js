// 捞捞算力 · 成品展示「捞小智」：训练出来的几样本事合在一个对话里，就在算力客户端里看、里试（不用装捞捞PPT助手）
//   · 讲题：本地大模型（llama.cpp，客户端自带）+ 最新发布的答题 LoRA
//   · 做 PPT（做完接着说怎么改就怎么改，界面上实时看每一页）、办教务的事（模拟教务后端）：和捞捞PPT助手用同一份代码（app/ppt/，打包时从 pptassist/core 拷过来）
//   · 说话：捞捞的专属声音（GPT-SoVITS + 最新发布的 laolao-voice），一句一句边答边合成
//   「自动融合」：盯着调度中心的发布清单。哪一样训练、考试通过、发布了新版 → 后台下载、核对 → 下一句话就用新版
//   （答题 LoRA 换了就重新带上它启动大模型；声音下一句就用新的），并且在界面上记一笔「成品第几版」。不用人点。
//   · 打电话：界面上一直听着，说完一停就把这句话（wav）送到本机的听写（app/hear.js，FunASR）变成文字，再按语音通话的规矩回答；
//     这时候大模型带的是「口语对话」LoRA（chat-lora，训练、考试通过才有；没有就还用答题 LoRA），挂了电话换回答题 LoRA
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PPT = (f) => require(path.join(__dirname, "ppt", f));

// 讲题用的底子：和答题 LoRA 训练时用的是同一个（通义千问 Qwen3-VL-4B 的 Q4 量化版）
const LLM_SPEC = { name: "Qwen3VL-4B-Instruct-Q4_K_M.gguf", mirrorModel: "llmMain", ctx: 16384, slots: 1, urls: [
  "https://www.modelscope.cn/models/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/master/Qwen3VL-4B-Instruct-Q4_K_M.gguf",
  "https://hf-mirror.com/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf",
  "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf"] };

function create(o) {
  const XZ = PPT("xiaozhi.js"), GM = PPT("gridmodels.js"), VOICE = PPT("voice.js"), MEDIA = PPT("media.js"), CHAT = PPT("chat.js");
  const emit = (e) => { try { o.send && o.send(e); } catch (x) {} };
  const log = o.log || (() => {});
  let cur = null;       // { dir, models, xz }：数据文件夹搬了就重新来
  let speakOn = true, active = false, timer = null, url = null, lastBuild = -1, checking = null, calling = false;
  const voice = VOICE.create({});
  const ear = (o.hearFactory || require("./hear").create)({ log: (m) => log("听写：" + m), ...(o.hearOpt || {}) });

  function S() {
    const dir = o.dir();
    if (cur && cur.dir === dir) return cur;
    if (cur) { try { cur.models.stop(); } catch (e) {} }
    fs.mkdirSync(dir, { recursive: true });
    const server = String(o.server() || "").replace(/\/+$/, "");
    const models = (o.modelsFactory || GM.create)({ dir: path.join(dir, "models"), want: XZ.PARTS.map((p) => p.key), ...(server ? { sources: [server + "/pub/models/manifest.json"] } : {}),
      onEvent: (e) => { if (e.stage === "download") emit({ type: "note", text: `有新版：正在下载「${nameOf(e.name)}」第 ${e.version} 版…` }); }, ...(o.modelsOpt || {}) });
    const llm = {
      // 每一句之前都看一眼：答题 LoRA 换了新版，就带上新版重新启动（llmw 发现 LoRA 路径变了会自己重启）；带上起不来就退回上一版
      start: async () => {
        const say = (m) => emit({ type: "note", text: m });
        // 文件名用组件镜像里的那个（和训练答题大脑时考试用的是同一个文件，不重复下 2.5G）
        const spec = { ...LLM_SPEC };
        if (o.llmName) { try { const n = await o.llmName(); if (n && /\.gguf$/i.test(n)) spec.name = n; } catch (e) {} }
        for (let i = 0; i < 3; i++) {
          // 打电话的时候优先带口语对话 LoRA（没训练好就用答题 LoRA）；换了 LoRA，llmw 会自己重启大模型
          const c = calling ? models.use("chat-lora") : null, key = c && c.files && c.files.lora ? "chat-lora" : "qa-lora";
          const q = key === "chat-lora" ? c : models.use("qa-lora"), lora = q && q.files && q.files.lora;
          try { url = await o.llm.ensure({ ...spec, ...(lora ? { lora } : {}) }, say); return; }
          catch (e) { if (!lora || i === 2) throw e; log(`带上新的${key === "chat-lora" ? "口语对话" : "答题"} LoRA 启动不了（${e.message}）：退回上一版`); models.rollback(key); }
        }
      },
      chat: (m, opt) => { try { o.llm.touch && o.llm.touch(); } catch (e) {} return CHAT.chatAt(url, m, opt); },
    };
    const xz = XZ.create({ dir, llm, grid: models, onEvent: (e) => emit(e), now: o.now, ...(o.xzOpt || {}) });
    cur = { dir, models, xz };
    lastBuild = xz.product().build;
    return cur;
  }
  const nameOf = (key) => { const p = PPT("xiaozhi.js").PARTS.find((x) => x.key === key); return p ? p.name : key; };

  // ---------- 自动融合 ----------
  // 去调度中心看发布清单；有新版就下载、换上，告诉界面（界面上弹一句「××第 N 版训练好了，已经换上」）
  function fuse(why) {
    // 正好有一次在看：等它，再看一次（它开始以后可能又发布了新的）
    const run = (checking || Promise.resolve()).catch(() => {}).then(() => fuse1(why));
    checking = run.finally(() => { if (checking === me) checking = null; });
    const me = checking;
    return run;
  }
  async function fuse1(why) {
    try {
      const { models, xz } = S();
      await models.check();
      if (!xz.busy()) for (const p of XZ.PARTS) models.use(p.key);   // 正在回答的时候不换，这一句说完再换
      const P = xz.product();
      if (P.build !== lastBuild) {
        const fresh = P.log.slice(0, Math.max(0, P.build - lastBuild));
        lastBuild = P.build;
        emit({ type: "product", product: P, fresh, why: why || "" });
        for (const f of fresh) log(`成品展示：「${f.name}」${f.from ? `第 ${f.from} 版 → ` : ""}第 ${f.to} 版，已经换上（成品第 ${P.build} 版）`);
      }
      return P;
    } finally { /* 下一次接着看 */ }
  }
  const product = () => S().xz.product();
  // 开着展示的时候每 3 分钟看一次；没开着的时候半小时看一次（新版先下好，打开就能用）
  function schedule() { clearInterval(timer); if (!active && o.used && !o.used()) return; timer = setInterval(() => fuse("定时").catch(() => {}), active ? (o.activeMs || 3 * 60e3) : (o.idleMs || 30 * 60e3)); timer.unref && timer.unref(); }
  function setActive(v) { active = !!v; schedule(); if (active) fuse("打开展示").catch(() => {}); return active; }

  // ---------- 说话 ----------
  const sayable = (text, max = 200) => {
    let t = String(text || "").replace(/```[\s\S]*?```/g, "").replace(/\$\$?[^$]*\$\$?/g, "（公式）").replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").replace(/[#*`>_~|]/g, "").replace(/\s+/g, " ").trim();
    if (t.length > max) { const cut = t.slice(0, max); const k = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？")); t = k > 20 ? cut.slice(0, k + 1) : cut + "……"; }
    return t;
  };
  function voiceInfo() {
    const m = S().models.use("laolao-voice");
    const ok = !!(m && m.files && m.files.gpt && m.files.sovits && m.files.ref);
    const gsv = o.gsvDir ? o.gsvDir() : null;
    return { on: speakOn, model: ok, version: ok ? m.version : null, gsv: !!gsv, engine: voice.state.state,
      label: !ok ? "捞捞的声音还没训练好（训练、考试通过后自动下载）" : !gsv ? `捞捞的声音第 ${m.version} 版（这台电脑还没装声音组件）` : `捞捞的声音（第 ${m.version} 版）` };
  }
  async function speak(text) {
    if (!speakOn) return null;
    const m = S().models.use("laolao-voice");
    if (!m || !m.files || !m.files.gpt || !m.files.sovits || !m.files.ref) return { skip: "捞捞的声音还没训练好（训练、考试通过后自动下载）" };
    const t = sayable(text); if (!t) return null;
    const dir = o.gsvDir ? o.gsvDir() : null;
    if (!dir) return { skip: "这台电脑还没装声音组件（GPT-SoVITS）：领过一次训练声音的任务就有了，或者点「装上声音组件」" };
    if (voice.state.state !== "ready") await voice.start(dir, o.voiceOpt || {});
    let prompt = ""; try { prompt = fs.readFileSync(m.files.reftext, "utf8").trim(); } catch (e) {}
    const cache = path.join(S().dir, "say"); fs.mkdirSync(cache, { recursive: true });
    const wav = path.join(cache, crypto.createHash("sha1").update(t + "|" + m.version).digest("hex").slice(0, 20) + ".wav");
    if (!fs.existsSync(wav)) fs.writeFileSync(wav, await voice.tts({ text: t, refWav: m.files.ref, promptText: prompt, gpt: m.files.gpt, sovits: m.files.sovits }));
    const buf = fs.readFileSync(wav), w = MEDIA.readWav(buf);
    return { wav: buf.toString("base64"), text: t, version: m.version, ms: Math.round(w.seconds * 1000), levels: MEDIA.lipLevels(w.samples, w.rate, 25) };
  }
  // 说过的话留 200 段，再多删旧的
  function tidy() { try { const d = path.join(S().dir, "say"); const fsx = fs.readdirSync(d).map((f) => ({ f: path.join(d, f), t: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t); for (const x of fsx.slice(200)) fs.rmSync(x.f, { force: true }); } catch (e) {} }

  // ---------- 打电话 ----------
  function setCall(on) { calling = !!on; S().xz.setVoice(calling); if (!calling) { try { ear.stop(); } catch (e) {} } return callInfo(); }
  function callInfo() { const c = S().models.use("chat-lora"); return { on: calling, lora: c && c.files && c.files.lora ? c.version : null, ear: !!(o.gsvDir && o.gsvDir()) }; }
  // 界面上录到的一句话（16k 单声道 wav 的 base64）→ 文字
  async function hear(b64) {
    const wav = Buffer.from(String(b64 || ""), "base64");
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") throw new Error("录到的声音格式不对");
    if (wav.length > 8 * 1048576) throw new Error("这句话太长了，分几句说");
    const dir = o.gsvDir ? o.gsvDir() : null;
    if (!dir) throw new Error("打电话要用声音组件（GPT-SoVITS，里面带听写）：先点「装上声音组件」");
    return { text: await ear.hear(dir, wav, (m) => emit({ type: "note", text: m })) };
  }

  async function state() {
    const { xz } = S(); await xz.ready();
    const me = xz.who(), actor = xz.campus.identities()[me.role], lp = xz.lastPpt();
    return { who: me, product: xz.product(), busy: xz.busy(), voice: voiceInfo(), call: callInfo(), llm: { ok: !!(o.llm && o.llm.ok()), running: !!(o.llm && o.llm.running && o.llm.running()) },
      task: o.busy ? o.busy() : null, ppt: lp ? { name: path.basename(lp.file), title: lp.title, pages: lp.pages, rev: lp.rev } : null, exam: xz.lastExam(),
      requests: xz.campus.myRequests(actor).requests.slice(0, 8), pending: xz.campus.pending(actor).requests.slice(0, 8), campus: xz.campus.stats() };
  }
  async function send(text) {
    const t = o.busy ? o.busy() : null;
    if (t) throw new Error(`这台电脑正在算「${t}」，显卡腾不出来：先点「暂停计算」再试`);
    const { xz } = S();
    await xz.send(String(text || "").slice(0, 4000), []);
    // 这一句说完了：要是刚才下好了新版，现在换上
    fuse("说完一句").catch(() => {});
    return state();
  }
  schedule();
  return {
    state, send, speak, fuse, product, setActive, hear, setCall,
    stop: () => S().xz.stop(), reset: () => { S().xz.reset(); return true; },
    setRole: async (r) => { S().xz.setRole(r); return state(); },
    setSpeak: (on) => { speakOn = !!on; if (!speakOn) { try { voice.stop(); } catch (e) {} } return voiceInfo(); },
    approve: async (id, ok) => { S().xz.campus.approveNext(String(id), ok !== false); return state(); },
    campusReset: async () => { S().xz.campus.reset(); S().xz.reset(); return state(); },
    lastPpt: () => S().xz.lastPpt(),
    // PPT 预览：每一页一张 SVG（rev 没变就返回 null）；界面上直接点的换配色、撤销；打开老师自己的 .pptx 让它改
    // 考一考现在这版模型做 PPT、改 PPT 的本事（8 道题，程序核对）
    pptExam: async () => { const t = o.busy ? o.busy() : null; if (t) throw new Error(`这台电脑正在算「${t}」，显卡腾不出来：先点「暂停计算」再考`); return S().xz.pptExam(); },
    slides: (rev) => S().xz.slides(rev), pptTheme: (k) => S().xz.pptTheme(k), pptUndo: () => S().xz.pptUndo(),
    openPpt: async (file) => { if (!/\.pptx$/i.test(String(file || ""))) throw new Error("只能打开 .pptx（老版本的 .ppt 先在 PowerPoint 里另存成 .pptx）"); await S().xz.openPpt(file); return state(); },
    shutdown: () => { clearInterval(timer); try { voice.stop(); } catch (e) {} try { ear.stop(); } catch (e) {} if (cur) { try { cur.models.stop(); } catch (e) {} } tidy(); },
    LLM_SPEC,
  };
}

module.exports = { create, LLM_SPEC };
