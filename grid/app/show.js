// 捞捞算力 · 成品展示「捞小智」：训练出来的几样本事合在一个对话里，就在算力客户端里看、里试（不用装捞捞PPT助手）
//   · 讲题：本地大模型（llama.cpp，客户端自带）+ 最新发布的答题 LoRA
//   · 做 PPT（做完接着说怎么改就怎么改，界面上实时看每一页）、办教务的事（模拟教务后端）：和捞捞PPT助手用同一份代码（app/ppt/，打包时从 pptassist/core 拷过来）
//   · 说话：捞捞的专属声音（GPT-SoVITS + 最新发布的 laolao-voice），一句一句边答边合成
//   「自动融合」：盯着调度中心的发布清单。哪一样训练、考试通过、发布了新版 → 后台下载、核对 → 下一句话就用新版
//   （答题 LoRA 换了就重新带上它启动大模型；声音下一句就用新的），并且在界面上记一笔「成品第几版」。不用人点。
//   · 打电话：界面上一直听着，说完一停就把这句话（wav）送到本机的听写（app/hear.js，FunASR）变成文字，再按语音通话的规矩回答；
//     这时候大模型带的是「口语对话」LoRA（chat-lora，训练、考试通过才有；没有就还用答题 LoRA），挂了电话换回答题 LoRA
//   · 检测报告（app/ppt/checkup.js）：头皮检测结果的统一接口——合作方接口 / 导入文件 / 捞捞自己的看图 + 问卷，插头可换；
//     看图要大模型带上视觉组件（mmproj，约 0.8G，第一次用才下载），带上以后这次开着就一直带着（不来回重启）
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const PPT = (f) => require(path.join(__dirname, "ppt", f));

// ---------- 数字怎么念：交给声音之前先换成汉字（不让语音模型自己猜，有时会念成「1 百二十 3」） ----------
//   学号、电话、编号这种长数字（5 位以上，或者 0 开头）一位一位念：「二零二五零一…」；年份也一位一位念：「二零二六年」；
//   日期「2026-11-27」→「二零二六年十一月二十七日」；时间「8:30」→「八点三十分」；百分数、小数；别的 4 位以内按数值念：「35」→「三十五」
const DIG = "零一二三四五六七八九";
const digitsZh = (x) => [...String(x)].map((c) => DIG[+c]).join("");
function natZh(n) {
  n = Math.floor(+n);
  if (!(n >= 0) || n > 9999) return digitsZh(n);
  if (n === 0) return "零";
  const u = ["", "十", "百", "千"], str = String(n);
  let out = "", zero = false;
  for (let i = 0; i < str.length; i++) { const d = +str[i], pos = str.length - 1 - i; if (!d) { zero = true; continue; } if (zero && out) out += "零"; zero = false; out += DIG[d] + u[pos]; }
  return out.replace(/^一十/, "十");
}
const numZh = (x) => (x.length >= 5 || (x.length > 1 && x[0] === "0") ? digitsZh(x) : natZh(+x));
function speakNums(t) {
  return String(t)
    .replace(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/g, (_, y, m, d) => `${digitsZh(y)}年${natZh(m)}月${natZh(d)}日`)
    .replace(/(\d{1,2})月(\d{1,2})[日号]/g, (_, m, d) => `${natZh(m)}月${natZh(d)}日`)
    .replace(/(\d{4})\s*年/g, (_, y) => digitsZh(y) + "年")
    // 编号类的数字不管几位都一位一位念：「教室 301」「301 教室」「学号 2025…」「验证码 0815」
    .replace(/(学号|工号|编号|电话|手机|号码|验证码|密码|代码|房间号|房号|房间|教室|座位号|座位|车次|课程号|班级号)(\s*[:：]?\s*[A-Za-z]?)(\d+)/g, (_, a, b, d) => a + b + digitsZh(d))
    .replace(/(\d{3,4})(?=\s*(?:教室|室|房|号楼|号房|班))/g, (d) => digitsZh(d))
    .replace(/(\d{1,2}):(\d{2})/g, (_, h, m) => natZh(h) + "点" + (+m ? natZh(m) + "分" : ""))
    .replace(/(\d+)(?:\.(\d+))?\s*%/g, (_, a, b) => "百分之" + numZh(a) + (b ? "点" + digitsZh(b) : ""))
    .replace(/(\d+)\.(\d+)/g, (_, a, b) => numZh(a) + "点" + digitsZh(b))
    .replace(/\d+/g, numZh)
    .replace(/(^|[^一-龥])二(?=[个位次天本张条门节只件块种周年月人])/g, "$1两");
}

// ---------- 听写常见的听错：编程、计算机课上的词（Paraformer 不认识的英文名、同音字） ----------
const ASR_FIX = [
  [/(Pardon|帕顿|拍森|派森|排森|怕森|派生)\s*(语言)?/gi, "Python$2"], [/(加瓦|假哇|嘉娃)(语言)?/g, "Java$2"],
  [/(?:C|c|西|希|吸)\s*(?:加加|＋＋|\+\+)/g, "C++"], [/(?:C|c)\s*(?:元|圆|园|源|原)(?!素|旦)/g, "C语言"], [/(?:希|吸)\s*语言/g, "C语言"],
  [/硬件城/g, "硬件层"], [/内核城/g, "内核层"], [/系统调用城/g, "系统调用层"], [/数据解构/g, "数据结构"], [/算发/g, "算法"],
  [/置针/g, "指针"], [/指真/g, "指针"], [/驱东/g, "驱动"], [/冒泡排续/g, "冒泡排序"], [/链表(?:饭|反)转/g, "链表反转"],
];
const fixAsr = (t) => ASR_FIX.reduce((s, [a, b]) => s.replace(a, b), String(t || ""));

// 讲题用的底子：和答题 LoRA 训练时用的是同一个（通义千问 Qwen3-VL-4B 的 Q4 量化版）
const LLM_SPEC = { name: "Qwen3VL-4B-Instruct-Q4_K_M.gguf", mirrorModel: "llmMain", ctx: 16384, slots: 1, urls: [
  "https://www.modelscope.cn/models/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/master/Qwen3VL-4B-Instruct-Q4_K_M.gguf",
  "https://hf-mirror.com/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf",
  "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/Qwen3VL-4B-Instruct-Q4_K_M.gguf"] };
// 更聪明的大脑：显卡 8G 以上、答题大脑还没训练出来、不用看图的时候，用 Qwen3-8B（和答题数据工厂的出题老师是同一个文件，国内存储里有）
const BIG_SPEC = { name: "Qwen3-8B-Q4_K_M.gguf", size: 5027783488, mirrorModel: "gridTeacher", ctx: 16384, slots: 1, label: "更聪明的本地大模型（Qwen3-8B）", urls: [
  "https://www.modelscope.cn/models/Qwen/Qwen3-8B-GGUF/resolve/master/Qwen3-8B-Q4_K_M.gguf",
  "https://hf-mirror.com/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
  "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf"] };
// Qwen3 会先写一段 <think>…</think> 再回答：关掉（chat_template_kwargs），万一还写了就滤掉，不显示、不念
function noThink(onDelta) {
  let inThink = false, buf = "";
  return (t) => {
    buf += t;
    for (;;) {
      if (inThink) { const k = buf.indexOf("</think>"); if (k < 0) { buf = buf.slice(-8); return; } buf = buf.slice(k + 8); inThink = false; continue; }
      const k = buf.indexOf("<think>");
      if (k < 0) { const at = buf.lastIndexOf("<"), tail = at >= 0 ? buf.slice(at) : "", keep = tail && "<think>".startsWith(tail) ? tail : ""; const out = buf.slice(0, buf.length - keep.length); buf = keep; if (out && onDelta) onDelta(out); return; }   // 只扣住可能是「<think>」开头的那一小截
      if (k > 0 && onDelta) onDelta(buf.slice(0, k));
      buf = buf.slice(k + 7); inThink = true;
    }
  };
}
// 看图组件（同一个模型的视觉部分）：只有检测报告看照片的时候才下载、才带上
const MMPROJ_SPEC = { name: "mmproj-Qwen3VL-4B-Instruct-F16.gguf", mirrorModel: "llmMmproj", urls: [
  "https://www.modelscope.cn/models/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/master/mmproj-Qwen3VL-4B-Instruct-F16.gguf",
  "https://hf-mirror.com/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-F16.gguf",
  "https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-4B-Instruct-F16.gguf"] };

function create(o) {
  const XZ = PPT("xiaozhi.js"), GM = PPT("gridmodels.js"), VOICE = PPT("voice.js"), MEDIA = PPT("media.js"), CHAT = PPT("chat.js"), CLOUD = PPT("cloud.js");
  const emit = (e) => { try { o.send && o.send(e); } catch (x) {} };
  // 云端大脑（DeepSeek）：选了云端、填了 Key，讲题、做 PPT、办事就交给它（不占这台电脑的显卡）；看图照旧用本机模型。配置存在数据文件夹的 cloud.json
  const cloud = (o.cloudFactory || CLOUD.create)({ file: () => path.join(o.dir(), "cloud.json"), onThinking: () => emit({ type: "note", text: "正在想（DeepSeek 思考中）…" }), ...(o.cloudOpt || {}) });
  const cloudOn = () => { try { return cloud.active(); } catch (e) { return false; } };
  const log = o.log || (() => {});
  let cur = null;       // { dir, models, xz }：数据文件夹搬了就重新来
  let speakOn = true, active = false, timer = null, url = null, lastBuild = -1, checking = null, calling = false, eyes = false;
  const voice = VOICE.create({});
  // 捞捞的声音还没训练好 / 这台电脑没装声音组件：先用电脑自带的中文朗读，训练好了自动换上
  const sys = (o.sysTtsFactory || PPT("systts.js").create)(o.sysTtsOpt || {});
  // 好听的临时声音（Kokoro）和「真人感」声音（声音组件 + 公开录音）：文件放在数据文件夹的 tts/ 里
  const tbase = () => (o.base ? o.base() : path.dirname(o.dir()));
  const kok = (o.kokoroFactory || require("./kokoro").create)({ base: tbase, log: (m) => log(m), ...(o.kokoroOpt || {}) });
  const real = (o.realFactory || require("./realvoice").create)({ base: tbase, log: (m) => log(m), ...(o.realOpt || {}) });
  let voicePref = "kokoro";
  try { const v = JSON.parse(fs.readFileSync(path.join(o.dir(), "voice-pref.json"), "utf8")).pref; voicePref = ["real", "teacher"].includes(v) ? v : "kokoro"; } catch (e) {}
  let sysSt = { ok: false, why: "" };
  const sysCheck = () => sys.available().then((st) => { sysSt = st; return st; }).catch(() => sysSt);
  const ear = (o.hearFactory || require("./hear").create)({ log: (m) => log("听写：" + m), ...(o.hearOpt || {}) });
  // ffmpeg：用声音组件自带的那个（安装包里不另外带）
  const ffCmd = () => { const gd = o.gsvDir && o.gsvDir(); return o.ffmpeg || (gd && [path.join(gd, "ffmpeg.exe"), path.join(gd, "runtime", "ffmpeg.exe"), path.join(gd, "ffmpeg")].find((x) => fs.existsSync(x))) || (() => { try { return PPT("media.js").ffmpegPath(); } catch (e) { return "ffmpeg"; } })(); };
  // 老师的声音：上传一段录音，照着它说（零样本，不用训练）；和老师的 3D 小人配在一起，就是「老师的分身」
  const tv = (o.teacherVoiceFactory || require("./teachervoice").create)({ base: tbase, ffmpeg: ffCmd, ear, gsvDir: () => (o.gsvDir ? o.gsvDir() : null), media: PPT("media.js"), log: (m) => log(m) });

  // 用不用 8B：显卡 8G 以上（o.vram 报的）、不看图、答题大脑 / 口语对话还没训练出来（训练出来的 LoRA 是配 4B 的）
  let bigNow = false;
  function useBig() {
    if (o.noBig || eyes) return false;
    const v = o.vram ? +o.vram() || 0 : 0;
    if (v < 7.5) return false;
    try { const m = cur && cur.models; if (m && (m.use("qa-lora") || m.use("base-stack") || (calling && m.use("chat-lora")))) return false; } catch (e) {}
    return true;
  }
  // 知识库里的视频、录音 → 带时间的文字稿：ffmpeg 抽成 16k 单声道 wav（用声音组件自带的 ffmpeg），本机听写分句带时间
  async function transcribe(file, say = () => {}) {
    const gd = o.gsvDir && o.gsvDir();
    if (!gd) throw new Error("听写组件还没装好：先在成品展示里接一次电话（会自动准备好）");
    const ff = ffCmd();
    const wav = path.join(require("os").tmpdir(), `lx-kb-${process.pid}-${Date.now()}.wav`);
    say(`把「${path.basename(file)}」的声音抽出来`);
    await new Promise((resolve, reject) => {
      const [cmd, ...pre] = Array.isArray(ff) ? ff : [ff];   // o.ffmpeg 可以是 [程序, 前面固定的参数…]（测试用 node 跑一个假的）
      const p = require("child_process").spawn(cmd, [...pre, "-y", "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-f", "wav", wav], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
      let err = ""; p.stderr.on("data", (d) => (err = (err + d).slice(-600)));
      p.on("error", (e) => reject(new Error("抽声音没成：" + e.message)));
      p.on("exit", (c) => (c === 0 && fs.existsSync(wav) ? resolve() : reject(new Error("抽声音没成：" + err.split(/\r?\n/).filter(Boolean).slice(-1)[0]))));
    });
    try { say(`听写「${path.basename(file)}」（一小时的视频要几分钟到十几分钟）`); return await ear.segments(gd, wav, say); }
    finally { fs.rmSync(wav, { force: true }); }
  }
  // 底座的永久层：发布的 base-stack = stack（哪几个 LoRA、各是第几版、比例多少）+ bundle（这些 LoRA 的 .gguf 打成的包）
  //   第一次用时解压到 bundle 旁边；→ { layers, loras: [{ path, scale }] }
  async function baseStack(models) {
    const m = models.use("base-stack");
    if (!m || !m.files || !m.files.stack || !m.files.bundle) return null;
    const st = JSON.parse(fs.readFileSync(m.files.stack, "utf8"));
    const dir = m.files.bundle + ".d";
    if (!fs.existsSync(path.join(dir, ".ok"))) {
      fs.rmSync(dir, { recursive: true, force: true });
      await (o.extract || PPT("installer.js").extract)(m.files.bundle, dir, {});
      fs.writeFileSync(path.join(dir, ".ok"), "");
    }
    const layers = (st.layers || []).filter((l) => l && l.gguf);
    const loras = layers.map((l) => ({ path: path.join(dir, path.basename(l.gguf)), scale: +l.scale || 1 }));
    for (const x of loras) if (!fs.existsSync(x.path)) throw new Error("包里少了 " + path.basename(x.path));
    return { version: m.version, layers, loras };
  }
  function S() {
    const dir = o.dir();
    if (cur && cur.dir === dir) return cur;
    if (cur) { try { cur.models.stop(); } catch (e) {} }
    fs.mkdirSync(dir, { recursive: true });
    const server = String(o.server() || "").replace(/\/+$/, "");
    const models = (o.modelsFactory || GM.create)({ dir: path.join(dir, "models"), want: XZ.PARTS.map((p) => p.key), ...(server ? { sources: [server + "/pub/models/manifest.json"] } : {}),
      onEvent: (e) => { if (e.stage === "download") emit({ type: "note", text: `有新版：正在下载「${nameOf(e.name)}」第 ${e.version} 版…` }); }, ...(o.modelsOpt || {}) });
    let loraIds = { base: [], main: -1, ground: -1, ppt: -1, eyes: -1 };
    const local = {
      // 每一句之前都看一眼：答题 LoRA 换了新版，就带上新版重新启动（llmw 发现 LoRA 路径变了会自己重启）；带上起不来就退回上一版
      start: async (opt) => {
        const say = (m) => emit({ type: "note", text: m });
        if (opt && opt.eyes) eyes = true;
        // 文件名用组件镜像里的那个（和训练答题大脑时考试用的是同一个文件，不重复下 2.5G）
        const big = useBig();
        const spec = big ? { ...BIG_SPEC } : { ...LLM_SPEC, ...(eyes ? { mmproj: MMPROJ_SPEC } : {}) };
        if (!big && o.llmName) { try { const n = await o.llmName(); if (n && /\.gguf$/i.test(n)) spec.name = n; } catch (e) {} }
        bigNow = big;
        for (let i = 0; i < 3; i++) {
          // 底座的永久层（base-stack）：合进底座的几个 LoRA，各带比例，一直挂着；已经合进底座的那一版答题 / 口语 LoRA 不再单独挂（不然算了两遍）
          const stack = big ? null : await baseStack(models).catch((e) => { log("底座的永久层用不了（" + e.message + "）：退回上一版"); models.rollback("base-stack"); return null; });
          const absorbed = (k) => { const m = models.use(k); return !!(stack && m && stack.layers.some((l) => l.name === k && l.version >= m.version)); };
          // 打电话的时候优先带口语对话 LoRA（没训练好就用答题 LoRA）；换了 LoRA，llmw 会自己重启大模型
          const c = calling && !absorbed("chat-lora") ? models.use("chat-lora") : null, key = c && c.files && c.files.lora ? "chat-lora" : "qa-lora";
          const q = key === "chat-lora" ? c : absorbed("qa-lora") ? null : models.use("qa-lora"), lora = q && q.files && q.files.lora;
          // 平时关着、用到时才打开的几个 LoRA（考过试才有；8B 不挂：LoRA 是配 4B 的；已经合进底座的那一版不再单独挂）：
          //   「先核对再回答」ground-lora（查资料回答、核对时）、「改 PPT」ppt-lora（调改 PPT 的工具时）、「眼力」vision-lora（看图还原 PPT、认公仔特征时）
          const EXTRA = [["ground", "ground-lora", "先核对再回答"], ["ppt", "ppt-lora", "改 PPT"], ["eyes", "vision-lora", "眼力"]];
          const ex = big ? [] : EXTRA.map(([k, key, name]) => { const m = absorbed(key) ? null : models.use(key); return m && m.files && m.files.lora ? { k, key, name, path: m.files.lora } : null; }).filter(Boolean);
          const bl = stack ? stack.loras : [], nb = bl.length, nm = lora && !big ? 1 : 0;
          try { url = await o.llm.ensure({ ...spec, ...(nb ? { baseLoras: bl } : {}), ...(lora && !big ? { lora } : {}), ...(ex.length ? { extraLoras: ex.map((x) => x.path) } : {}) }, say);
            loraIds = { base: bl.map((x, j) => ({ id: j, scale: x.scale })), main: nm ? nb : -1, ground: -1, ppt: -1, eyes: -1 };
            ex.forEach((x, j) => { loraIds[x.k] = nb + nm + j; });
            return; }
          catch (e) {
            if (ex.length) { const x = ex[ex.length - 1]; log(`带上「${x.name}」LoRA 启动不了（${e.message}）：退回上一版`); models.rollback(x.key); continue; }
            if (!lora || i === 2) throw e; log(`带上新的${key === "chat-lora" ? "口语对话" : "答题"} LoRA 启动不了（${e.message}）：退回上一版`); models.rollback(key);
          }
        }
      },
      chat: (m, opt = {}) => {
        try { o.llm.touch && o.llm.touch(); } catch (e) {}
        // 查资料回答、核对（opt.mode = ground / check）：打开 ground-lora；改 PPT（ppt）：打开 ppt-lora；看图（eyes）：打开 vision-lora
        //   这时关掉答题 / 口语 LoRA；llama-server 的 lora 字段没写到的都按 0。底座的永久层要照原来的比例写上（没写到的会被当成 0）
        const want = opt.mode === "ground" || opt.mode === "check" ? "ground" : opt.mode === "ppt" ? "ppt" : opt.mode === "eyes" ? "eyes" : null;
        const lo = want && loraIds[want] >= 0 ? { lora: [...(loraIds.base || []), ...(loraIds.main >= 0 ? [{ id: loraIds.main, scale: 0 }] : []), { id: loraIds[want], scale: 1 }] } : null;
        const extra = { ...(bigNow ? { chat_template_kwargs: { enable_thinking: false } } : {}), ...(lo || {}) };
        return CHAT.chatAt(url, m, { ...opt, ...(bigNow ? { onDelta: noThink(opt.onDelta) } : {}), ...(Object.keys(extra).length ? { extra } : {}) });
      },
    };
    // 云端开着：对话走云端，看图走本机（local）；关着：全部走本机
    const llm = CLOUD.wrap(local, cloud);
    const xz = XZ.create({ dir, llm, grid: models, kbOpt: { transcribe }, onEvent: (e) => emit(e), now: o.now, log: (m) => log(m), ...(o.xzOpt || {}) });
    cur = { dir, models, xz, llm };
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
  function setActive(v) { active = !!v; schedule(); if (active) { fuse("打开展示").catch(() => {}); earPrefetch(); } return active; }
  // 听写模型（几百 M）：打开展示时就在后台先下好（只在还没下过的时候；下好后 10 分钟没人用自己关），不用等到打电话说完第一句才开始下
  const earSay = (m, p) => emit({ type: "ear", text: m, pct: p && p.pct != null ? p.pct : null, done: !!(p && p.done) });
  function earPrefetch() {
    const dir = o.gsvDir ? o.gsvDir() : null;
    if (!dir || ear.ready(dir) || ear.running || ear.preparing || o.noEarPrefetch || (o.busy && o.busy())) return false;   // 这台电脑在算任务时不抢内存
    log("后台先准备听写（第一次打电话要用）");
    ear.warm(dir, earSay);
    return true;
  }

  // ---------- 说话 ----------
  const sayable = (text, max = 200) => {
    let t = String(text || "").replace(/```[\s\S]*?```/g, "").replace(/\$\$?[^$]*\$\$?/g, "（公式）").replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").replace(/[#*`>_~|]/g, "").replace(/\s+/g, " ").trim();
    t = speakNums(t);
    if (t.length > max) { const cut = t.slice(0, max); const k = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("！"), cut.lastIndexOf("？")); t = k > 20 ? cut.slice(0, k + 1) : cut + "……"; }
    return t;
  };
  // 现在用哪种声音：训练好的捞捞声音（要声音组件）＞ 真人感（声音组件 + 公开录音，用户选了才用）＞ Kokoro 中文女声 ＞ 电脑自带朗读
  function engineNow() {
    const m = S().models.use("laolao-voice");
    const ok = !!(m && m.files && m.files.gpt && m.files.sovits && m.files.ref);
    const gsv = o.gsvDir ? o.gsvDir() : null;
    if (voicePref === "teacher" && gsv && tv.ready()) return { eng: "teacher", m, gsv, ok };   // 选了老师的声音：比捞捞的声音优先
    if (ok && gsv) return { eng: "trained", m, gsv };
    if (voicePref === "real" && gsv && real.ready()) return { eng: "real", m, gsv, ok };
    if (kok.ready()) return { eng: "kokoro", m, gsv, ok };
    if (sysSt.ok) return { eng: "sys", m, gsv, ok };
    return { eng: null, m, gsv, ok };
  }
  function voiceInfo() {
    const e = engineNow(), m = e.m, ok = e.eng === "trained" || !!e.ok;
    const after = ok ? `（捞捞的声音第 ${m.version} 版已下好，这台电脑装上声音组件就换上）` : "（捞捞的声音训练、考试通过后自动换上）";
    const label = e.eng === "teacher" ? "老师的声音（照着上传的录音说）"
      : e.eng === "trained" ? `捞捞的声音（第 ${m.version} 版）`
      : e.eng === "real" ? "真人感声音（声音组件照着公开录音说）" + after
      : e.eng === "kokoro" ? "好听的临时声音（Kokoro 中文女声）" + after
      : e.eng === "sys" ? "临时用电脑自带的朗读" + after
      : ok ? `捞捞的声音第 ${m.version} 版（这台电脑还没装声音组件）` : `捞捞的声音还没训练好${sysSt.why ? "，" + sysSt.why : ""}：回答先只出字（训练、考试通过后自动下载）`;
    return { on: speakOn, model: ok, version: ok ? m.version : null, gsv: !!e.gsv, engine: voice.state.state, can: !!e.eng, temp: !["trained", "teacher"].includes(e.eng) && !!e.eng, kind: e.eng, pref: voicePref,
      choices: { kokoro: kok.ready(), real: !!(e.gsv && real.ready()), teacher: !!(e.gsv && tv.ready()) }, teacher: tv.info(), label };
  }
  const cacheWav = (t, tag) => path.join(S().dir, "say", crypto.createHash("sha1").update(t + "|" + tag).digest("hex").slice(0, 20) + ".wav");
  function pack(buf, t, extra) { const w = MEDIA.readWav(buf); return { wav: buf.toString("base64"), text: t, ms: Math.round(w.seconds * 1000), levels: MEDIA.lipLevels(w.samples, w.rate, 25), ...extra }; }
  async function cached(t, tag, make) {
    fs.mkdirSync(path.join(S().dir, "say"), { recursive: true });
    const f = cacheWav(t, tag);
    if (!fs.existsSync(f)) fs.writeFileSync(f, await make());
    return fs.readFileSync(f);
  }
  async function speakSys(t) {
    const st = await sysCheck();
    if (!st.ok) return null;
    return pack(await cached(t, "sys", () => sys.tts(t)), t, { version: 0, temp: true, kind: "sys" });
  }
  let voiceErr = "";   // 最近一次声音出错的原因（界面上说清楚，不再只报声音的名字）
  async function speakKokoro(t) {
    if (!kok.ready()) return null;
    try { const r = pack(await cached(t, "kokoro" + (o.kokoroOpt && o.kokoroOpt.voice || ""), () => kok.tts(t)), t, { version: 0, temp: true, kind: "kokoro" }); voiceErr = ""; return r; }
    catch (e) { voiceErr = "Kokoro 声音出错：" + e.message; log(voiceErr); return null; }
  }
  // 老师的声音：有「声音底座」（所有老师的录音接着训的，发布了才有）就用底座的权重，没有就用声音组件自带的
  async function speakTeacher(t) {
    const r = tv.ref(), b = S().models.use("voice-base"), w = b && b.files && b.files.gpt && b.files.sovits ? { gpt: b.files.gpt, sovits: b.files.sovits } : {};
    return pack(await cached(t, `teacher|${r.at}|${r.text}|${w.gpt ? b.version : 0}`, () => voice.tts({ text: t, refWav: r.wav, promptText: r.text, ...w })), t, { version: 0, kind: "teacher" });
  }
  // 临时声音：Kokoro，不行再电脑自带
  const speakTemp = async (t) => (await speakKokoro(t)) || (await speakSys(t));
  async function speak(text) {
    if (!speakOn) return null;
    const t = sayable(text); if (!t) return null;
    await sysCheck();
    const e = engineNow();
    if (e.eng === "trained" || e.eng === "real" || e.eng === "teacher") {
      try {
        if (voice.state.state !== "ready") await voice.start(e.gsv, o.voiceOpt || {});
        if (e.eng === "teacher") return await speakTeacher(t);
        if (e.eng === "trained") {
          const m = e.m; let prompt = ""; try { prompt = fs.readFileSync(m.files.reftext, "utf8").trim(); } catch (x) {}
          return pack(await cached(t, "v" + m.version, () => voice.tts({ text: t, refWav: m.files.ref, promptText: prompt, gpt: m.files.gpt, sovits: m.files.sovits })), t, { version: m.version, kind: "trained" });
        }
        const r = real.ref();
        return pack(await cached(t, "real|" + r.wav, () => voice.tts({ text: t, refWav: r.wav, promptText: r.text })), t, { version: 0, temp: true, kind: "real" });
      } catch (x) {
        log("声音组件说不了（" + x.message + "）：这一句先用临时声音");
        const r = await speakTemp(t); if (r) return r;
        throw x;
      }
    }
    const r = await speakTemp(t);
    if (r) return r;
    const dir = o.gsvDir ? o.gsvDir() : null;
    return { skip: !dir && e.ok ? "这台电脑还没装声音组件（GPT-SoVITS）：领过一次训练声音的任务就有了，或者点「装上声音组件」" : voiceErr ? voiceErr + (sysSt.ok ? "" : "；" + (sysSt.why || "电脑自带朗读也用不了")) + "。点「试一下声音」看详细原因" : voiceInfo().label };
  }
  // 试一下声音：每种都试一句，告诉界面哪种能用、不能用的原因；能用的第一种的声音一起返回（界面上直接放出来）
  async function voiceTest() {
    const t = "你好，我是捞小智，很高兴见到你。", out = [];
    let play = null;
    const tryOne = async (kind, name, fn) => {
      const t0 = Date.now();
      try { const r = await fn(); if (!r) throw new Error("没准备好"); out.push({ kind, name, ok: true, ms: Date.now() - t0 }); if (!play) play = r; }
      catch (e) { out.push({ kind, name, ok: false, err: String(e.message || e).slice(0, 300) }); }
    };
    await tryOne("kokoro", "Kokoro 中文女声", async () => { if (!kok.ready()) throw new Error("声音模型还没下好（在上面的「准备组件」里下）"); return pack(await kok.tts(t), t, { kind: "kokoro" }); });
    const st = await sysCheck(); sys.state && Object.assign(sysSt, st);
    await tryOne("sys", "Windows 自带的中文朗读" + (st.name ? "（" + st.name + "）" : ""), async () => { if (!st.ok) throw new Error(st.why || "这台电脑没有"); return pack(await sys.tts(t), t, { kind: "sys" }); });
    const dir = o.gsvDir ? o.gsvDir() : null;
    await tryOne("real", "真人感（声音组件）", async () => { if (!dir) throw new Error("还没装声音组件"); const r = real.ref(); if (!r) throw new Error("还没下参考录音"); if (voice.state.state !== "ready") await voice.start(dir, o.voiceOpt || {}); return pack(await voice.tts({ text: t, refWav: r.wav, promptText: r.text }), t, { kind: "real" }); });
    if (tv.ready()) await tryOne("teacher", "老师的声音（照着上传的录音）", async () => { if (!dir) throw new Error("还没装声音组件"); if (voice.state.state !== "ready") await voice.start(dir, o.voiceOpt || {}); return speakTeacher(t); });
    log("试声音：" + out.map((x) => `${x.name} ${x.ok ? "能用（" + x.ms + " 毫秒）" : "不行：" + x.err}`).join("；"));
    return { results: out, play };
  }
  // 声音自动考试（core/voiceexam.js）：现在用的声音念几句固定的话 → 本机听写回来 → 错字率、数字念对没有
  async function voiceExam() {
    const gd = o.gsvDir ? o.gsvDir() : null;
    if (!gd) throw new Error("听写组件还没装好：先在成品展示里接一次电话（会自动准备好）");
    const e = engineNow();
    const r = await PPT("voiceexam.js").run({ say: (t) => sayable(t),
      synth: async (t) => { const x = await speak(t); if (!x || !x.wav) throw new Error((x && x.skip) || "现在没有能用的声音"); return Buffer.from(x.wav, "base64"); },
      hear: (wav) => ear.hear(gd, wav) });
    const out = { ...r, engine: e.eng, at: Date.now() };
    try { fs.writeFileSync(path.join(o.dir(), "voice-exam.json"), JSON.stringify(out)); } catch (x) {}
    log(`声音考试（${e.eng}）：错字率 ${Math.round(r.cer * 100)}%，数字念对 ${r.numOk == null ? "—" : Math.round(r.numOk * 100) + "%"}`);
    return out;
  }
  function setVoicePref(v) { voicePref = ["real", "teacher"].includes(v) ? v : "kokoro"; try { fs.writeFileSync(path.join(o.dir(), "voice-pref.json"), JSON.stringify({ pref: voicePref })); } catch (e) {} return voiceInfo(); }
  // 说过的话留 200 段，再多删旧的
  function tidy() { try { const d = path.join(S().dir, "say"); const fsx = fs.readdirSync(d).map((f) => ({ f: path.join(d, f), t: fs.statSync(path.join(d, f)).mtimeMs })).sort((a, b) => b.t - a.t); for (const x of fsx.slice(200)) fs.rmSync(x.f, { force: true }); } catch (e) {} }

  // ---------- 准备组件：打开展示时先把要用的都下好，必需的下好了才开放使用 ----------
  const PREP = [
    { key: "llm", name: "本地大模型", what: "讲题、做 PPT、办事、联网查资料", size: "约 2.5G（8G 以上显卡用更聪明的 8B，约 5G）", required: true },
    { key: "voice", name: "好听的声音", what: "Kokoro 中文女声，本机合成", size: "约 330M", required: true },
    { key: "gsv", name: "声音组件", what: "打电话的听写、真人感声音（GPT-SoVITS）", size: "约 8G", required: false },
    { key: "ear", name: "听写模型", what: "打电话时把你说的话变成字", size: "约 1G", required: false, after: "gsv" },
    { key: "real", name: "真人感声音的参考录音", what: "公开录音 AISHELL-3 里的一位女声", size: "约 200M", required: false, after: "gsv" },
  ];
  const prep = { running: false, st: {} };
  const llmSpec = async () => { if (useBig()) return { ...BIG_SPEC }; const spec = { ...LLM_SPEC }; if (o.llmName) { try { const n = await o.llmName(); if (n && /\.gguf$/i.test(n)) spec.name = n; } catch (e) {} } return spec; };
  async function isReady(key) {
    const dir = o.gsvDir ? o.gsvDir() : null;
    if (key === "llm") return cloudOn() || (o.llm && o.llm.hasModel ? o.llm.hasModel(await llmSpec()) : true);   // 用云端大脑：不用下本地大模型
    if (key === "voice") return kok.ready();
    if (key === "gsv") return !!dir;
    if (key === "ear") return !!(dir && ear.ready(dir));
    if (key === "real") return real.ready();
    return false;
  }
  async function prepStatus() {
    const items = [];
    for (const p0 of PREP) { const p = p0.key === "llm" && cloudOn() ? { ...p0, name: "大脑：" + cloud.info().providerName + "（云端）", what: "讲题、做 PPT、办事都交给云端，不用下本地大模型（看图时才用本机的）", size: "不用下载" } : p0;
      const r = await isReady(p.key); const s = prep.st[p.key] || {}; items.push({ ...p, state: r ? "ready" : s.state || "missing", pct: r ? 100 : s.pct != null ? s.pct : null, text: s.text || "", err: s.err || "" }); }
    const open = items.filter((x) => x.required).every((x) => x.state === "ready");
    return { items, open, running: prep.running, optional: !!prep.optional };
  }
  const pctIn = (m) => { const x = /(\d{1,3})%/.exec(String(m || "")); return x ? Math.min(100, +x[1]) : null; };
  async function prepRun(opt = {}) {
    if (prep.running) return prepStatus();
    prep.running = true; prep.optional = opt.all !== false;
    const tell = async () => emit({ type: "prep", prep: await prepStatus() });
    (async () => {
      try {
        for (const p of PREP) {
          if (!p.required && !prep.optional) continue;
          if (await isReady(p.key)) continue;
          if (p.after && !(await isReady(p.after))) { prep.st[p.key] = { state: "error", err: "要先装好声音组件" }; continue; }
          prep.st[p.key] = { state: "running", pct: 0, text: "" }; await tell();
          let lastT = 0;
          const say = (m, x) => { const pct = x && x.pct != null ? x.pct : pctIn(m); prep.st[p.key] = { state: "running", pct: pct != null ? pct : prep.st[p.key].pct, text: String(m || "") }; if (Date.now() - lastT > 800) { lastT = Date.now(); tell(); } };
          try {
            const dir = o.gsvDir ? o.gsvDir() : null;
            if (p.key === "llm") { if (!o.llm.prefetch) throw new Error("这个版本不能先下载大模型"); await o.llm.prefetch(await llmSpec(), say); }
            else if (p.key === "voice") await kok.ensure(say);
            else if (p.key === "gsv") { if (!o.gsvEnsure) throw new Error("这里装不了声音组件"); await o.gsvEnsure(say); }
            else if (p.key === "ear") { if (!(await ear.warm(dir, say))) throw new Error("听写模型没准备好（检查网络后再试）"); }
            else if (p.key === "real") await real.ensure(say);
            prep.st[p.key] = { state: "ready", pct: 100 };
          } catch (e) { prep.st[p.key] = { state: "error", err: e.message }; log(`准备组件「${p.name}」没成：${e.message}`); }
          await tell();
        }
      } finally { prep.running = false; await tell(); }
    })();
    return prepStatus();
  }

  // ---------- 打电话 ----------
  function setCall(on) {
    calling = !!on; S().xz.setVoice(calling);
    const dir = o.gsvDir ? o.gsvDir() : null;
    if (calling && dir && !ear.running) ear.warm(dir, earSay);   // 一接通就准备听写（第一次下模型时界面上看得到进度），不等第一句说完
    return callInfo();
  }
  function callInfo() { const c = S().models.use("chat-lora"); return { on: calling, lora: c && c.files && c.files.lora ? c.version : null, ear: !!(o.gsvDir && o.gsvDir()), earReady: !!ear.running, earPct: ear.progress() }; }
  // 界面上录到的一句话（16k 单声道 wav 的 base64）→ 文字
  async function hear(b64) {
    const wav = Buffer.from(String(b64 || ""), "base64");
    if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF") throw new Error("录到的声音格式不对");
    if (wav.length > 8 * 1048576) throw new Error("这句话太长了，分几句说");
    const dir = o.gsvDir ? o.gsvDir() : null;
    if (!dir) throw new Error("打电话要用声音组件（GPT-SoVITS，里面带听写）：先点「装上声音组件」");
    return { text: fixAsr(await ear.hear(dir, wav, earSay)) };
  }

  async function state() {
    const { xz } = S(); await xz.ready(); await sysCheck();
    const me = xz.who(), actor = xz.campus.identities()[me.role], lp = xz.lastPpt();
    return { who: me, product: xz.product(), busy: xz.busy(), voice: voiceInfo(), prep: await prepStatus(), call: callInfo(), llm: { ok: !!(o.llm && o.llm.ok()), running: !!(o.llm && o.llm.running && o.llm.running()) },
      cloud: cloud.info(), team: xz.teamMode(), task: o.busy ? o.busy() : null, ppt: lp ? { name: path.basename(lp.file), title: lp.title, pages: lp.pages, rev: lp.rev } : null, exam: xz.lastExam(),
      requests: xz.campus.myRequests(actor).requests.slice(0, 8), pending: xz.campus.pending(actor).requests.slice(0, 8), campus: xz.campus.stats() };
  }
  async function send(text) {
    const t = o.busy ? o.busy() : null;
    if (t && !cloudOn()) throw new Error(`这台电脑正在算「${t}」，显卡腾不出来：先点「暂停计算」再试（或者把大脑换成云端，就不用停）`);
    const { xz } = S();
    await xz.send(String(text || "").slice(0, 4000), []);
    // 这一句说完了：要是刚才下好了新版，现在换上
    fuse("说完一句").catch(() => {});
    return state();
  }
  // ---------- 检测报告（界面右边那张卡片直接点的；对话里问由捞小智调工具） ----------
  const CK = () => S().xz.checkup;
  async function checkupScan(a = {}) {
    const t = o.busy ? o.busy() : null;
    if (t && Array.isArray(a.images) && a.images.length && (a.source || CK().config().source) !== "partner") throw new Error(`这台电脑正在算「${t}」，显卡腾不出来看照片：先点「暂停计算」再测（只答问卷不用显卡）`);
    if (S().xz.busy()) throw new Error("捞小智正在回答，等它说完再测");
    const r = await CK().scan({ images: a.images, answers: a.answers, source: a.source });
    return { report: r, view: CK().view() };
  }

  schedule();
  sysCheck();
  // 本机大模型接口（app/localapi.js）：给捞捞思维导图当「自定义接口」用，背后就是捞小智现在用的模型和 LoRA
  const api = (o.apiFactory || require("./localapi").create)({ dir: o.dir, log, busy: o.busy, port: o.apiPort, maxOut: o.apiMaxOut,
    touch: () => { try { o.llm.touch && o.llm.touch(); } catch (e) {} },
    backend: async ({ eyes: e }) => { const s = S(); await s.llm.start(e ? { eyes: true } : {}); return { url, extra: bigNow ? { chat_template_kwargs: { enable_thinking: false } } : null }; } });
  const mm = () => S().xz.mindmap;
  return {
    apiInfo: () => api.info(), apiConnect: async () => { if (!mm()) throw new Error("没有带思维导图的接入"); return api.connect(mm()); }, apiDisconnect: async () => api.disconnect(mm()),
    state, send, speak, fuse, product, setActive, hear, setCall, prepStatus, prepRun, setVoicePref, voiceTest, voiceExam,
    // 知识库：捞小智「先核对再回答」查的本机资料（一个文件夹，放 .txt / .md）
    kb: async () => { const x = S().xz, k = x.kb; fs.mkdirSync(k.dir, { recursive: true }); let maps = null; try { maps = x.mindmap ? (await x.mindmap.list()).maps.map((m) => m.title) : null; } catch (e) {}
      let r = null; try { r = await k.refresh({}); } catch (e) {}
      return { dir: k.dir, files: k.list(), maps, status: k.status(), errors: r ? r.errors : [] }; },
    // 联网考试（core/webexam.js）：第一次录快照（要上网），以后都按快照考，分数能和上一版比
    webExam: async (mode) => {
      const t = o.busy ? o.busy() : null;
      if (t && !cloudOn()) throw new Error(`这台电脑正在算「${t}」，先暂停计算再考`);
      const { llm } = S(), dir = path.join(o.dir(), "webexam");
      const m = mode === "record" || !fs.existsSync(path.join(dir, "record.json")) ? "record" : "replay";
      return PPT("webexam.js").run({ dir, mode: m, llm, onProgress: (i, n) => emit({ type: "note", text: `联网考试：第 ${i}/${n} 道` }) });
    },
    // 整理知识库：读新放进来的文件，视频、录音听写成带时间的文字稿（慢，点了才做）
    kbImport: async () => { const k = S().xz.kb; const r = await k.refresh({ media: true, say: (m) => emit({ type: "note", text: m }) }); return { ...r, status: k.status() }; },
    // 训练任务要开始了：把显存让出来（声音组件、听写；本地大模型由 service 关）
    releaseGpu: () => { try { voice.stop(); } catch (e) {} try { ear.stop(); } catch (e) {} },
    apiStop: () => api.stop(false),
    stop: () => S().xz.stop(), reset: () => { S().xz.reset(); return true; },
    // 云端大脑：看设置、改设置（换了大脑就开一段新对话：两边的对话记录格式不一样）、试一下连不连得上
    cloudInfo: () => cloud.info(),
    cloudSet: (patch) => { const before = cloud.info(), r = cloud.setConfig(patch || {}); if (before.current !== r.current || before.think !== r.think) { try { S().xz.reset(); } catch (e) {} } return r; },
    cloudModels: (id) => cloud.listModels(String(id || "")),
    // 「多个助手一起做」开关（对话框下面）
    setTeam: (on) => S().xz.setTeam(!!on),
    cloudTest: (v) => cloud.test(v || undefined),
    // 老师的声音：传录音（要授权）→ 挑好参考、默认就用它；改参考文字；听一下截出来的那段；删掉
    teacherVoice: () => tv.info(),
    teacherVoiceFrom: async (file, consent) => {
      const say = (m, x) => emit({ type: "avatar", text: String(m || ""), p: x && x.p != null ? x.p : null, done: !!(x && x.done) });
      if (!(o.gsvDir && o.gsvDir())) { if (!o.gsvEnsure) throw new Error("要先装好声音组件（GPT-SoVITS）"); say("先装声音组件（GPT-SoVITS，约 8G，只装这一次）…"); await o.gsvEnsure((m) => say(m)); }
      const r = await tv.fromFile(file, consent, say);
      if (r.ready) setVoicePref("teacher");
      return { ...r, voice: voiceInfo() };
    },
    teacherVoiceText: (t) => { const r = tv.setText(t); if (r.ready && voicePref !== "teacher") setVoicePref("teacher"); return { ...r, voice: voiceInfo() }; },
    teacherVoicePreview: () => tv.preview(),
    teacherVoiceWipe: () => { const r = tv.wipe(); if (voicePref === "teacher") setVoicePref("kokoro"); return { ...r, voice: voiceInfo() }; },
    setRole: async (r) => { S().xz.setRole(r); return state(); },
    setSpeak: (on) => { speakOn = !!on; if (!speakOn) { try { voice.stop(); } catch (e) {} } return voiceInfo(); },
    approve: async (id, ok) => { S().xz.campus.approveNext(String(id), ok !== false); return state(); },
    campusReset: async () => { S().xz.campus.reset(); S().xz.reset(); return state(); },
    lastPpt: () => S().xz.lastPpt(),
    checkupView: (base) => CK().view({ base: base || undefined }), checkupScan, checkupConfig: (c) => CK().setConfig(c || {}),
    checkupImport: (file) => CK().importFile(file), checkupDemo: () => CK().demo(), checkupWipe: () => CK().wipe(), checkupRemove: (id) => CK().remove(String(id)),
    checkupPhoto: (f) => CK().photo(f),
    // PPT 预览：每一页一张 SVG（rev 没变就返回 null）；界面上直接点的换配色、撤销；打开老师自己的 .pptx 让它改
    // 考一考现在这版模型做 PPT、改 PPT 的本事（8 道题，程序核对）
    pptExam: async () => { const t = o.busy ? o.busy() : null; if (t && !cloudOn()) throw new Error(`这台电脑正在算「${t}」，显卡腾不出来：先点「暂停计算」再考`); return S().xz.pptExam(); },
    slides: (rev) => S().xz.slides(rev), pptTheme: (k) => S().xz.pptTheme(k), pptUndo: () => S().xz.pptUndo(),
    openPpt: async (file) => { if (!/\.pptx$/i.test(String(file || ""))) throw new Error("只能打开 .pptx（老版本的 .ppt 先在 PowerPoint 里另存成 .pptx）"); await S().xz.openPpt(file); return state(); },
    shutdown: () => { try { api.stop(false); } catch (e) {} clearInterval(timer); try { kok.stop(); } catch (e) {} try { voice.stop(); } catch (e) {} try { ear.stop(); } catch (e) {} if (cur) { try { cur.models.stop(); } catch (e) {} } tidy(); },
    LLM_SPEC, MMPROJ_SPEC,
  };
}

module.exports = { create, LLM_SPEC, MMPROJ_SPEC, BIG_SPEC, speakNums, fixAsr, noThink };
