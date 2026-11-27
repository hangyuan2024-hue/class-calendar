// 捞捞PPT助手 · 成品展示：「捞小智」——把捞捞算力训练出来的几样本事合在一个对话里
//   · 学术问答：本地大模型 + 最新一版答题 LoRA（考试通过才发布的）
//   · 做 PPT：按老师的要求从头做一份（12 种版式、8 套配色，版式引擎 core/deck.js 排版），做完接着说怎么改就怎么改
//     （换版式、重写一页、加页删页、换配色、调字号、标重点、公式、表格、图片、备注…和「AI 改 PPT」是同一套工具），界面上实时看每一页
//   · 办事：模拟教务后端（core/campus.js）——查课表 / 成绩 / 考试、请假、调课、借教室、选课、开证明、审批
//   · 说话：捞捞的专属声音（或者老师自己的声音）把回复念出来；形象用老师自己的，没有就用默认的捞捞
//   · 检测报告（core/checkup.js）：头皮检测的结果统一成一种报告（合作方接口 / 导入文件 / 捞捞自己的看图 + 问卷，插头可换），
//     能查最近一次、和上周比、看某一项的变化
//   「成品第几版」= 这几样各自的版本合起来；哪一样出了新版（捞捞算力训练、考试通过、发布），这里自动换上、记一笔
"use strict";
const fs = require("fs");
const path = require("path");
const AGENT = require("./agent");
const EDIT = require("./pptedit");
const DECK = require("./deck");
const CAMPUS = require("./campus");
const CHECKUP = require("./checkup");
const EYES = require("./eyes");

const PARTS = [
  { key: "base-stack", name: "底座", what: "通义千问 4B 加上一轮轮考过、合进去的本事（答题、口语……）", temp: "先用通义千问 4B 原版", metric: "gsm8k", metricName: "回归考试（数学）", base: "base_gsm8k" },
  { key: "qa-lora", name: "学术问答", what: "答题大脑：一步一步讲题", temp: "先用没训练过的底子（通义千问 4B）讲题", metric: "acc", metricName: "考试答对率", base: "base_acc" },
  { key: "laolao-voice", name: "捞捞的声音", what: "默认声音：没上传自己声音的老师用它", temp: "先用 Kokoro 中文女声（好听的临时声音）" },
  { key: "voice-base", name: "声音克隆底座", what: "照着老师的一段录音学她说话", temp: "先用声音组件自带的底子" },
  { key: "qversion-lora", name: "Q版形象", what: "照着照片画 Q版 / 3D 公仔", temp: "先用画图引擎原本的画法" },
  { key: "ground-lora", name: "先核对再回答", what: "照资料回答、标出处，说出口前逐句核对；资料里没有就说没有", temp: "先用底子自己核对（没训练过，核对得没那么准）", metric: "catch", metricName: "错句抓出来", base: "base_catch" },
  { key: "ppt-lora", name: "改 PPT", what: "听懂老师怎么改 → 调对工具、改对地方，别的页不乱动", temp: "先用底子自己改（没专门练过）", metric: "acc", metricName: "改 PPT 考试做对", base: "base_acc" },
  { key: "vision-lora", name: "眼力", what: "拍一张课件还原成能改的一页；看照片说出做公仔要的特征", temp: "先用底子自己看图", metric: "acc", metricName: "看图考试写对", base: "base_acc" },
  { key: "chat-lora", name: "口语对话", what: "打电话时说话像人：短、念得出来，听错字也懂", temp: "先用答题大脑接电话", metric: "acc", metricName: "口语考试说对", base: "base_acc" },
];
// 打电话（实时语音对话）时加给捞小智的规则：和训练口语对话大脑时用的一字不差（grid/recipes/chat_gen.py、qa_train.py；测试里核对）
const SPOKEN = `现在是语音通话：你说的每一句都会被念出来。
· 说口语、用短句，一次说两三句，先说最要紧的；要讲的内容很长，先讲第一步，再问对方要不要接着讲。
· 不要用列表、标题、加粗、表格、表情、链接和代码；不要写 LaTeX 和数学符号，公式和数字按读法说（比如「x 的平方」「三分之二」「根号二」）。
· 对方的话是语音识别出来的，可能有同音错字、没有标点、夹着「嗯」「那个」：按最可能的意思理解；实在听不懂、或者有好几种意思，就简单问一句。
· 不知道的就说不知道，不要编。`;
// 做 PPT 前把模型给的每一页理一理（小模型常见的毛病，程序改掉，不用再问一遍模型）：
//   · 代码写进了要点 / 金句 → 代码页；一条条「第一步、第二步」→ 步骤图；
//   · 连着三页都是要点 → 中间那页能拆成「小标题：说明」的换成卡片；
//   · 结尾没有小结 → 用各页的标题补一页小结
const CODEY = /[;{}]|==|\+\+|\b(int|for|while|if|return|def|print|printf|void|include)\b/;
const STEPY = /^\s*(第\s*[一二三四五六七八九十\d]+\s*步|\d+\s*[.、)）]|①|②|③|④|⑤|首先|然后|接着|其次|最后)/;
const HEADY = /^\s*(.{2,12}?)\s*[：:]\s*(.{2,})$/;
const lk = (x) => DECK.layoutKey(x && x.layout) || (Array.isArray(x && x.lines) && x.lines.length && !(Array.isArray(x.items) && x.items.length) && !x.code && !x.table && !x.formula && !x.left ? "bullets" : "");
function polish(list) {
  const out = list.map((s) => ({ ...s }));
  for (const s of out) {
    const lines = Array.isArray(s.lines) ? s.lines.map((l) => String(l == null ? "" : l)).filter((l) => l.trim()) : [], L = lk(s);
    if (!s.code && !["code", "table", "formula"].includes(L) && lines.length && lines.filter((l) => CODEY.test(l)).length >= Math.max(1, Math.ceil(lines.length * 0.6))) {
      s.layout = "code"; s.code = lines.join("\n"); s.lines = []; continue;
    }
    if ((L === "bullets" || !L) && lines.length >= 3 && lines.length <= 5 && lines.every((l) => STEPY.test(l))) {
      s.layout = "steps";
      s.items = lines.map((l) => { const t = l.replace(STEPY, "").replace(/^\s*[：:，,]\s*/, "").trim(), m = /^(.{2,10}?)[：:，,]\s*(.+)$/.exec(t); return m ? { head: m[1], body: m[2] } : { head: t.length > 10 ? t.slice(0, 8) + "…" : t, body: t.length > 10 ? t : "" }; });
      s.lines = [];
    }
  }
  for (let i = 1; i < out.length - 1; i++) {
    if (lk(out[i - 1]) !== "bullets" || lk(out[i]) !== "bullets" || lk(out[i + 1]) !== "bullets") continue;
    const ls = (out[i].lines || []).map(String);
    if (ls.length >= 2 && ls.length <= 6 && ls.filter((l) => HEADY.test(l)).length >= Math.ceil(ls.length * 0.6)) {
      out[i].layout = "cards"; out[i].items = ls.map((l) => { const m = HEADY.exec(l); return m ? { head: m[1], body: m[2] } : { head: "", body: l }; }).filter((x) => x.head || x.body); out[i].lines = [];
    }
  }
  const last = out[out.length - 1];
  if (out.length >= 4 && last && !["summary", "end"].includes(lk(last)) && !/小结|总结|回顾|复习/.test(String(last.title || ""))) {
    const heads = out.filter((x) => !["cover", "section", "end", "statement"].includes(lk(x))).map((x) => String(x.title || "").trim()).filter(Boolean).slice(0, 5);
    if (heads.length >= 3) out.push({ layout: "summary", title: "本节小结", lines: heads });
  }
  return out;
}

// 这两周每一天：「2026-11-21 周六（今天）、2026-11-22 周日、2026-11-23 下周一…」（小模型自己算星期几常错）
const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function days2w(t) {
  const d0 = new Date(t); d0.setHours(12, 0, 0, 0);
  const mon = new Date(d0); mon.setDate(d0.getDate() - ((d0.getDay() + 6) % 7));   // 这周一
  const out = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    if (d < new Date(d0.getTime() - 86400e3 * 0.5)) continue;   // 已经过去的不列
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const name = (i < 7 ? "本" : "下") + WD[d.getDay()];
    out.push(`${ymd} ${name}${ymd === `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, "0")}-${String(d0.getDate()).padStart(2, "0")}` ? "（今天）" : ""}`);
  }
  return out.join("、");
}

function create(o) {
  const dir = o.dir;
  fs.mkdirSync(dir, { recursive: true });
  const now = o.now || (() => new Date());
  const campus = o.campus || CAMPUS.create({ file: path.join(dir, "campus.json"), now });
  const HIST = path.join(dir, "product.json");
  let hist = { seen: {}, log: [] };
  try { hist = { ...hist, ...JSON.parse(fs.readFileSync(HIST, "utf8")) }; } catch (e) {}
  let role = o.role || "student";
  let voiceMode = false;   // 打电话：说的话都会被念出来，按 SPOKEN 的规则说
  const actor = () => { const I = campus.identities(); return I[role] || I.student; };
  const outDir = path.join(dir, "ppt"), LAST = path.join(outDir, "last.json");
  // 检测报告：本机看图用同一个大模型（能看图的那版要带视觉组件，llm.start({ eyes: true })）
  let lastImgs = [];
  const look = o.look || (async (imgs, prompt) => {
    if (o.llm.look) return o.llm.look(imgs, prompt);
    await o.llm.start({ eyes: true });
    const r = await o.llm.chat([{ role: "user", content: [...imgs.map((u) => ({ type: "image_url", image_url: { url: u } })), { type: "text", text: prompt }] }], { temperature: 0.1, maxTokens: 700 });
    return r.content || "";
  });
  const checkup = o.checkup || CHECKUP.create({ dir, now, look, log: o.log });

  // ---------- PPT：从头做一份、接着改、打开老师自己的 ----------
  // cur：现在手上的这一份 { d: 编辑器（core/pptedit.js）, file, title, pages, rev: 每存一次加一（界面看它变没变） }
  let cur = null, revs = 0;
  const stamp = () => { const t = now(), p = (n) => String(n).padStart(2, "0"); return `${p(t.getMonth() + 1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}`; };
  const safe = (t) => String(t || "").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 40) || "ppt";
  // 每改一步就存盘。老师正开着这个文件（Windows 上写不进去）：另存成一个新名字，告诉她
  async function saveCur() {
    const buf = await cur.d.save(); let note = null;
    fs.mkdirSync(path.dirname(cur.file), { recursive: true });
    try { fs.writeFileSync(cur.file, buf); }
    catch (e) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(e.code)) throw e;
      const base = cur.file.replace(/(-改\d+)?\.pptx$/i, ""); let k = 2, f;
      do { f = `${base}-改${k++}.pptx`; } while (fs.existsSync(f) && k < 200);
      fs.writeFileSync(f, buf); cur.file = f;
      note = `原来的文件正开着、写不进去，改好的另存成了「${path.basename(f)}」（关掉 PowerPoint 里旧的那个，打开这个）`;
    }
    cur.pages = await cur.d.count(); cur.rev = ++revs;
    try { fs.writeFileSync(LAST, JSON.stringify({ file: cur.file, title: cur.title })); } catch (e) {}
    return note ? { saved_as: path.basename(cur.file), note } : null;
  }
  async function makePpt({ title, subtitle, theme, color, slides } = {}) {
    title = String(title || "").trim();
    if (!title) throw new Error("要有标题（title）");
    // 小模型有时候把一页写成一句话（"标题：要点；要点"）：也认
    const list = polish((Array.isArray(slides) ? slides : []).map((x) => { if (typeof x !== "string") return x; const m = /^(.{1,30}?)[：:]\s*(.+)$/s.exec(x.trim()); return m ? { title: m[1], lines: m[2].split(/[；;\n]/) } : { title: x.trim() }; }).filter((x) => x && typeof x === "object" && !Array.isArray(x)).slice(0, 40));
    if (!list.length) throw new Error("至少要有一页内容（slides 里写每一页的 title 和内容）");
    const d = await EDIT.load(await DECK.blank({ theme: DECK.THEMES[theme] ? theme : "blue", color, title, now: now() }));
    const skipped = []; let at = 0;
    if (DECK.layoutKey(list[0].layout) !== "cover") { await d.addDesigned(0, { layout: "cover", title, sub: subtitle }); at = 1; }
    const n0 = at;
    for (const [i, s] of list.entries()) {
      try { const r = await d.addDesigned(at, i === 0 && !n0 ? { sub: subtitle, ...s } : s, { first: at === 0 }); at += r.pages || 1; }
      catch (e) { skipped.push(`第 ${i + 1} 页「${String(s.title || "").slice(0, 20)}」没做出来：${e.message}`); }
    }
    if (at <= n0 && n0) throw new Error("一页内容都没做出来。" + skipped.join("；"));
    fs.mkdirSync(outDir, { recursive: true });
    // 重新打开一遍：做的过程不算「改动」（不然老师说撤销，会把最后一页撤掉）
    cur = { d: await EDIT.load(await d.save()), file: path.join(outDir, `${safe(title)}-${stamp()}.pptx`), title, own: true };
    await saveCur();
    const chk = await cur.d.check(), ol = await cur.d.outline();
    return { ok: true, file: path.basename(cur.file), pages: cur.pages, theme: (await cur.d.theme()).name, outline: ol.map((x) => `${x.no}. ${x.title}（${(DECK.LAYOUTS[x.layout] || "").replace(/（.*$/, "")}）`),
      ...(skipped.length ? { skipped } : {}), ...(chk.issues.length ? { issues: chk.issues.slice(0, 6) } : {}),
      note: "做好了，界面上可以直接看每一页、也可以用 PowerPoint 打开。还想改哪里直接说：比如「第 3 页改成两栏对比」「换成绿色的」「字大一点」「加一页练习题」" };
  }
  // 打开老师自己的 .pptx 接着改：不动原文件，改的存在展示的文件夹里
  // keep：在对话里传上来的 PPT —— 打开成手上这份，但不清掉刚才聊的
  async function openPpt(file, opt = {}) {
    const buf = fs.readFileSync(file), d = await EDIT.load(buf);
    const name = path.basename(file).replace(/\.pptx$/i, "");
    fs.mkdirSync(outDir, { recursive: true });
    cur = { d, file: path.join(outDir, `${safe(name)}-改-${stamp()}.pptx`), title: name, own: false, from: file };
    await saveCur(); if (!opt.keep) agent.reset();
    return lastPpt();
  }
  const lastPpt = () => (cur ? { file: cur.file, title: cur.title, pages: cur.pages, rev: cur.rev, own: !!cur.own } : null);
  // 上次做到一半的那一份：重开以后接着改
  const boot = (async () => { try { const l = JSON.parse(fs.readFileSync(LAST, "utf8")); if (l && l.file && fs.existsSync(l.file)) { cur = { d: await EDIT.load(fs.readFileSync(l.file)), file: l.file, title: l.title || path.basename(l.file), own: true }; cur.pages = await cur.d.count(); cur.rev = ++revs; } } catch (e) { cur = null; } })();
  // 给界面画的：每一页一张 SVG。rev 和界面手上的一样（没变过）就返回 null
  async function slides(rev) {
    await boot;
    if (!cur) return { none: true };
    if (rev != null && +rev === cur.rev) return null;
    const svgs = []; for (let i = 1; i <= cur.pages; i++) { try { svgs.push(await cur.d.preview(i)); } catch (e) { svgs.push(""); } }
    const th = await cur.d.theme();
    return { rev: cur.rev, name: path.basename(cur.file), title: cur.title, pages: cur.pages, theme: th.key, theme_name: th.name, designed: await cur.d.designed(), svgs,
      themes: Object.entries(DECK.THEMES).map(([k, v]) => ({ key: k, name: v.name, bg: "#" + v.c[0], main: "#" + v.c[4], dark: "#" + v.c[3] })) };
  }
  // 界面上直接点的（不经过模型）：换配色、撤销
  async function pptTheme(key) { await boot; if (!cur) throw new Error("还没有 PPT"); if (agent.busy()) throw new Error("它正在改，等它改完"); const r = await cur.d.setTheme({ theme: key }); await saveCur(); return r; }
  async function pptUndo() { await boot; if (!cur) throw new Error("还没有 PPT"); if (agent.busy()) throw new Error("它正在改，等它改完"); const l = await cur.d.undo(); if (!l) throw new Error("没有可以撤销的了"); await saveCur(); return { undone: l }; }

  // ---------- 智能体 ----------
  const RE_PPT = /ppt|课件|幻灯|演示文稿|讲义|这一页|上一页|下一页|最后一页|第\s*[0-9一二三四五六七八九十两]+\s*页|封面|标题|配色|颜色|版式|排版|字号|字体|字大|字小|大一点|小一点|加粗|标红|高亮|标出|表格|备注|讲稿|撤销|改回|大纲|要点|两栏|卡片|步骤图|加一页|删掉/i;
  const RE_CAMPUS = /课表|上课|有课|成绩|绩点|学分|考试|请假|销假|调课|停课|补课|教室|选课|退课|证明|审批|批准|驳回|申请|规定|校历|教务|辅导员|学籍|明天|后天|下周|这周|本周/;
  const PPT_NAMES = AGENT.TOOLS.map((t) => t.name);
  const RE_MM = /导图|思维|脑图|mind\s*map|分支|节点/i;
  // 大任务（要查好几样、分几部分写、出一整套、整理一学期）：带上「多个助手一起干活」；界面上开了「多个助手」就一直带
  const RE_BIG = /对比|比较一下|调研|方案|计划|规划|整理|汇总|一整套|整套|分别|各自|每一[个章节门课]|几个方面|全面|报告|综述|一学期|大任务/;
  let teamMode = false;
  // 这一句带哪些工具（4B 的模型上下文有限，三十多个工具全带上它既慢又容易选错）：
  //   手上没有 PPT：做 PPT + 教务；手上有：说的是 PPT 的事带改 PPT 的那一套，说的是教务的事带教务的，分不清就都带
  let lastKind = "";
  //   说的是检测报告（头皮、比上周有什么进步…）或者发来了照片说头发的事：带检测的工具
  function pick(text, imgs) {
    // 联网的工具：搜网页、读网页一直带；新闻、视频、图片这几个只在说到的时候带（少带几个工具，省 token）
    const names = new Set(["make_ppt", "make_file", ...webTools.filter((t) => !t.when || t.when(text)).map((t) => t.name), ...groundTools.map((t) => t.name)]), ppt = RE_PPT.test(text), cam = RE_CAMPUS.test(text), chk = checkup.RE.test(text) || !!(imgs && imgs.length && /头|发/.test(text)), mm = RE_MM.test(text);
    // 都没提（「再简单一点」「好的」）：接着上一句说的那件事
    const kind = [ppt && "ppt", cam && "campus", chk && "check", mm && "mindmap"].filter(Boolean).join("+") || lastKind || (cur ? "ppt" : "campus");
    lastKind = kind;
    const has = (k) => kind.split("+").includes(k);
    if (cur && (has("ppt") || (!has("campus") && !has("check")))) { for (const n of PPT_NAMES) names.add(n); if (imgs && imgs.length) names.add("photo_to_slide"); }
    if (has("campus") || (!cur && !has("check"))) for (const t of campusTools) names.add(t.name);
    if (has("check")) for (const t of checkTools) names.add(t.name);
    if (has("mindmap")) for (const t of mindmapTools) names.add(t.name);
    if (teamMode || RE_BIG.test(text) || text.length > 120) names.add("team_work");
    if (folder && folder.root()) for (const t of folderTools) names.add(t.name);
    return names;
  }
  const SYS = (names) => {
    const w = campus.who(actor());
    const t = now(), tm = new Date(t); tm.setDate(tm.getDate() + 1);
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const hasEdit = !names || names.has("edit_slide"), hasCampus = !names || campusTools.some((x) => names.has(x.name)), hasCheck = !names || checkTools.some((x) => names.has(x.name));
    // 不变的规则放前面、这一句才有的情况（谁、今天几号、手上的 PPT）放最后：云端模型能缓存前面不变的那一大段，重复的部分便宜几十倍
    const hasTeam = !names || names.has("team_work");
    return `你是「捞小智」，捞捞课程表的校园智能体：会讲题、会做 PPT 和改 PPT、会帮师生办教务的事。

你会${hasCheck ? "四" : "三"}类事，按对方说的挑：
一、讲题和学术问题：直接回答。一步一步讲清楚，每一步说明为什么；算式写清楚，公式用 LaTeX（$...$）；最后给出答案。不知道的就说不知道，不要编。
   · 思维导图（捞捞思维导图）：对方说「我的导图」「那张导图」→ mindmap_list 看有哪些、mindmap_read 读出来再讲 / 出题 / 做 PPT；要把一节课、一份 PPT、一段资料整理成导图 → mindmap_make（缩进大纲，3～4 层，每个节点一句短话）；在已有导图里补内容 → mindmap_add。导图里的内容也会被 answer_from_sources 当资料查。
   · 问的是事实（学校规定、通知、某个知识点的定义和数据、某件事是什么、什么时候、多少）→ 先调用 answer_from_sources：它会查本机知识库（需要时联网，web 填 true）、照资料回答、逐句核对。你只转述它的 answer（可以去掉方括号、说得自然一点），不加资料外的内容，最后说一句来源；它说「资料里没有」就照实说没有，不要自己补答案。讲题、算题、闲聊不用它。
${webTools.length ? `   · 能联网：问到新闻、最近的事、现在的价格 / 排名 / 政策 / 天气、某个人或产品的近况，或者你拿不准的事实 → 先调用 web_search 搜一下（摘要不够再 read_page 读一两个网页），照搜到的回答，最后一行写「来源：网站名」。常识和讲题不用搜。
` : ""}
二、PPT：
   · 对方要「做一份 PPT / 课件」→ 先想好整份怎么讲，再调用 make_ppt 一次做完。一般 8～12 页（对方说了几页就按他说的）：开头一页讲「这节课学什么」，中间按 2～3 个部分讲（每部分可以用 section 开头），结尾一页 summary 小结。
     每一页挑合适的版式，不要整份都是 bullets：并列的几个概念用 cards，有先后的过程用 steps，两样东西比一比用 compare，数据用 table，代码用 code，公式用 formula，最重要的一句话用 statement。
     每页只讲一件事：标题一句话说清结论；要点 3～5 条、每条不超过 25 个字。
     内容要准：概念、公式、代码、数据只写有把握的；拿不准的在回答里告诉对方「第几页的什么请核对」，不要编。
     做完告诉对方一共几页、每页讲什么；工具结果里有 issues（版面问题）就先改掉。
     一页好的样子（照这个写法，换成对方要讲的内容）：
       {"layout":"cards","title":"排序算法看三件事","items":[{"head":"时间复杂度","body":"数据多了以后慢多少"},{"head":"空间复杂度","body":"要额外占多少内存"},{"head":"稳定性","body":"相等的数排完顺序变不变"}],"takeaway":"挑算法先看数据量"}
       {"layout":"steps","title":"冒泡排序一轮怎么走","items":[{"head":"比较","body":"相邻两个数比大小"},{"head":"交换","body":"前面大就换到后面"},{"head":"后移","body":"往后挪一位接着比"},{"head":"冒泡","body":"一轮下来最大的到最后"}]}
       {"layout":"code","title":"冒泡排序的 C 代码","code":"for (i = 0; i < n - 1; i++)\n    for (j = 0; j < n - 1 - i; j++)\n        if (a[j] > a[j + 1]) swap(&a[j], &a[j + 1]);","lang":"C","lines":["外层：一共走 n-1 轮","内层：每轮少比一个"]}
${hasEdit ? `   · 对方要改手上这份 PPT → 用改 PPT 的工具，照他说的改，不要重新做一份（除非他说「重做」）。\n${AGENT.PPT_RULES.split("\n").map((l) => "     " + l).join("\n")}` : "   · 要改 PPT，得先有一份：让对方说要做什么内容的，或者在界面上点「打开 PPT」。"}
${hasCampus ? `三、办教务的事（课表、成绩、考试、请假、调课、借教室、选课、开证明、审批、查规定）：必须调用工具去查、去办，不要凭空回答，也不要编造课程、教室、日期。
   · 日期一律写成 YYYY-MM-DD；「明天」「下周三」先按上面的今天换算好。
   · 要提交申请（请假、调课、借教室）而信息不全（日期、原因、哪门课）时，先问清楚再提交；信息齐了就直接提交，不用反复确认。
   · 提交以后，把申请编号、现在到哪一步（谁审批）、要注意的事（缺哪些课、有没有考试、要补什么材料）告诉对方。
   · 工具报错了，把原因照实告诉对方，再给一个能办成的办法。
   · 只办现在这个人有权限办的事；别人的成绩、别人的申请不能看、不能改。` : "三、办教务的事（课表、成绩、请假、调课、借教室…）：对方问到再办。"}
${hasCheck ? `四、${checkup.profile.name}报告（${checkup.profile.dims.map((d) => d.name).join("、")}）：必须调用工具去查，不要编等级、日期和变化。
   · 问「最近测得怎么样」→ checkup_latest；问「比上周有什么进步 / 要调整什么」→ checkup_compare；问某一项的变化 → checkup_trend；问以前测过几次 → checkup_history。
   · 要自测：先 checkup_quiz 拿题目，一题一题问，答完调 checkup_scan；对方这次发来了头皮照片，也调 checkup_scan。
   · 回答先说结论：哪几项进步了、哪几项要注意；再给一两条日常护理建议（工具结果里有 advice 就照着说）。
   · 结果里有 demo 就说明「这是演示数据」；有 fallback 就照实说这次用的是哪种分析；有 mixed 就提醒两次来源不同、仅供参考。
   · 这是护理参考，不是医学诊断：不要说得了什么病，不要推荐药品；有重度、疼痛或者掉发很多，建议去看皮肤科医生。
` : ""}
回答用简体中文，口语化；不要输出 JSON 和代码（公式的 LaTeX、讲题时的代码除外）。
回答要有内容：讲题、讲知识至少讲清楚一个完整的点——是什么、为什么、举一个具体的例子（五到八句话）。对方说了想学什么就直接讲下去，不要只说一两句就反问「你从哪一步开始」；讲完一个点，最后再问一句要不要接着讲下一步。办事、闲聊照常简短。${hasTeam ? `
大任务（要分别查好几样再对比、分几部分写、出一整套题、整理一学期的安排…）→ 用 team_work 拆成几件互不依赖的小事，交给几个助手同时做，拿到结果再汇总成一个完整的回答；${teamMode ? "对方打开了「多个助手一起做」，能拆就拆。" : "一步就能答的、闲聊、讲一道题不要拆。"}办事（请假、调课、审批）你自己来，不要交给助手。` : ""}

【现在的情况】
现在和你说话的是：${w.role} ${w.name}（${w.role === "学生" ? `学号 ${w.id}，${w.class}` : w.role === "教师" ? `工号 ${w.id}，${w.dept}${w.counselor_of && w.counselor_of.length ? "，" + w.counselor_of.join("、") + "辅导员" : ""}` : "教务处"}）。
今天是 ${w.today} ${w.weekday}，${w.term}第 ${w.week} 周；明天是 ${ymd(tm)}。
这两周每一天的日期（一周从周一开始；说「下周五」就是下面写着「下周五」的那天，直接照抄，不要自己算）：${days2w(t)}
${cur ? `现在手上的 PPT：「${cur.title}」，一共 ${cur.pages} 页（界面上能看到每一页）。对方说「这一页」「改一下」「换个颜色」指的就是它。` : "现在手上还没有 PPT。"}${folder && folder.root() ? `\n对方连着本机文件夹「${require("path").basename(folder.root())}」：说到自己的资料、文件、作业、课件时，先用 folder_find 在里面找、folder_read 读，不要让对方再上传；读到的内容照原文用，标上是哪个文件。` : ""}${voiceMode ? `\n\n${SPOKEN}\n（上面讲题、PPT、教务的规则照旧；只是说的话要按语音通话来：不写 LaTeX、不列条目。讲知识时一次讲完一个完整的点，四到六句，比上面「两三句」可以多一点，讲完再问要不要接着讲；不要每次都反问对方从哪开始。）` : ""}`;
  };
  const campusTools = campus.tools(actor);
  const checkTools = checkup.tools(() => lastImgs);
  // 联网只看国内网站（cnOnly）：搜到的、读的、新闻、图片、视频都是国内媒体的
  const webOpt = { cnOnly: true, ...(o.webOpt || {}) };
  const webTools = o.web === false ? [] : (o.webTools || require("./websearch").tools(webOpt));
  // 先核对再回答：本机知识库（dir/kb 里的 .txt / .md）+ 需要时联网；照资料答、逐句核对（core/ground.js）
  const GROUND = require("./ground");
  const kb = o.kb || GROUND.kb(path.join(dir, "kb"), o.kbOpt || {});
  // 捞捞思维导图（学习捞捞队的模块）：只走它公开的本机接口 / 存下来的 map.json，不改它的代码（core/mindmap.js）
  const mindmap = o.mindmap === false ? null : (o.mindmap || require("./mindmap").create(o.mindmapOpt || {}));
  const mindmapTools = mindmap ? mindmap.tools() : [];
  const ground = o.ground || GROUND.create({ llm: o.llm, kb, sources: mindmap ? [mindmap] : [], web: o.web === false ? null : (() => { const W = require("./websearch"); return { search: (q) => W.search(q, webOpt), read: (u) => W.read(u, webOpt) }; })(), onStep: (m) => { if (o.onEvent) o.onEvent({ type: "note", text: m }); } });
  // 查实了再回答（core/research.js）：云端出主意（只看问题）→ 本机按需联网查、程序把关来源 → 本机照查实的资料写、逐句核对
  //   本机回答的时候（本机模式、混合模式交给本机的那句）用它；整句都交给云端时不用（云端自己带着联网工具答）
  const RESEARCH = require("./research"), SRC = require("./sources");
  const rdir = path.join(dir, "research");
  const reputation = o.reputation || SRC.reputation(path.join(rdir, "reputation.json"));
  const cards = o.cards || RESEARCH.cards(path.join(rdir, "cards.json"));
  const cloudOf0 = () => (o.llm && o.llm.cloud) || null;
  // 云端出主意、判打架、审稿：用这家最便宜的「干活模型」，不开思考
  const rcloud = () => { const c = cloudOf0(); if (!c || !c.active || !c.active()) return null; const wm = c.workerModel ? c.workerModel() : null; return wm && wm !== "local" ? wm : null; };
  const localLlm = { start: (x) => (o.llm.start ? o.llm.start(x) : null), chat: (m, opt) => o.llm.chat(m, { ...opt, model: "local" }) };
  const research = o.web === false ? null : (o.research || RESEARCH.create({
    llm: localLlm, ground: GROUND.create({ llm: localLlm, kb, onStep: (m) => { if (o.onEvent) o.onEvent({ type: "note", text: m }); } }),
    cloud: { ok: () => !!rcloud(), chat: (m, opt) => o.llm.chat(m, { ...opt, model: rcloud() }) },
    web: (() => { const W = o.researchWeb || require("./websearch"); return { search: (q, x) => W.search(q, { ...webOpt, ...(x || {}) }), read: (u) => W.read(u, webOpt) }; })(),
    localMats: async (q) => kb.find(q).slice(0, 3).map((m) => ({ title: m.title || m.src, src: m.src, text: m.text })),
    reputation, cards, now: () => +now(), onStep: (m) => { if (o.onEvent) o.onEvent({ type: "note", text: m }); },
  }));
  const groundTools = ground.tools().map((t) => (t.name !== "answer_from_sources" || !research ? t : { ...t, run: async (a) => {
    if (!a.web) return t.run(a);
    const r = await research.answer(a.question, { force: true });
    return { answer: r.text, abstained: !!r.abstained, sources: (r.sources || []).map((s) => `[${s.n}] ${s.title}${/^https?:/.test(s.src) ? "（" + s.src + "）" : ""}`),
      tip: r.abstained ? "资料里没有：照这句告诉对方，不要自己编答案" : "照 answer 的内容说（可以去掉方括号、说得口语一点，但不要加资料外的内容，「没查到」「说法不一致」的话要原样说），最后说一句来源" };
  } }));
  // 这一句要不要先查实：问的是事实（数字、日期、规定、新闻、知识点的准确说法）、本机来回答、没带图和附件、不是办事
  const CAMPUS_Q = /课表|有什么课|上什么课|请假|销假|借教室|空教室|我的(成绩|绩点|学分|考勤)|考试安排|天气|检测报告|体检报告/;
  let lastQ = "";
  function researchFor(text, images) {
    if (!research || o.research === false || (images && images.length)) return null;
    if (/【附件：|（附：我现在电脑屏幕的截图/.test(text) || CAMPUS_Q.test(text) || text.length > 300) return null;
    const c = cloudOf0();
    if (c && c.active && c.active()) {
      if (!(c.hybrid && c.hybrid())) return null;                              // 整句交给云端：云端自己带工具答
      if (require("./cloud").route([{ role: "user", content: text }], {}, {}).where === "cloud") return null;
    }
    // 接着上一句问（「那去年呢」）：带上上一句，不然搜不准
    const q = text.length < 16 && lastQ && /^(那|这|它|他|她|那么|还有)|呢[？?]?$/.test(text) ? `${lastQ}（接着问：${text}）` : text;
    const rp = RESEARCH.rulePlan(q);
    if (rp.need === "facts") return q;
    // 规则看不出来、但像是在问问题，而且有云端帮着判断：让云端出主意时说要不要查
    return rcloud() && /[？?]$|吗$|是什么|有哪些|为什么|怎么回事/.test(text) ? q : null;
  }
  let rbusy = null;
  async function researchSend(text, images) {
    const q = researchFor(text, images);
    lastQ = text.length >= 16 || !lastQ ? text : lastQ;
    if (!q) return null;
    const me = rbusy = { stopped: false };
    const emit = (e) => { if (o.onEvent) try { o.onEvent(e); } catch (x) {} };
    let r = null;
    try { r = await research.answer(q); }
    catch (e) { emit({ type: "note", text: "查资料没成（" + e.message + "），直接回答" }); return null; }
    finally { rbusy = null; }
    if (me.stopped) { emit({ type: "done", stopped: true }); return true; }
    if (!r || r.skip) return null;
    // 什么都没搜到（多半是没联网）：交给平常的回答，但提醒它拿不准就说不知道
    if (r.abstained && !r.pages && !(r.rejected || []).length && !r.fromCard) return { hint: "（联网没查到资料。拿不准的事实直接说不知道，不要编。）" };
    const src = (r.sources || []).map((s) => `[${s.n}] ${s.title}${/^https?:/.test(s.src) ? "（" + s.src + "）" : ""}`);
    const reply = r.text + (src.length ? "\n\n来源：\n" + src.join("\n") : "");
    emit({ type: "tool", stage: "start", name: "research", args: { q }, say: "查实资料" });
    emit({ type: "tool", stage: "done", name: "research", args: { q }, say: "查实资料", ok: true, result: { research: {
      slots: r.slots, sources: r.sources, fromCard: !!r.fromCard, pages: r.pages || 0, rounds: r.rounds || 0, secs: Math.round((r.ms || 0) / 100) / 10, usage: r.usage,
      rejected: (r.rejected || []).slice(0, 12).map((x) => ({ url: x.url, title: x.title, why: x.why })), plan: r.plan ? { by: r.plan.by, queries: r.plan.queries } : null } } });
    emit({ type: "delta", text: reply });
    agent.load([...agent.history(), { role: "user", content: text }, { role: "assistant", content: reply }]);
    emit({ type: "done", changed: 0 });
    return true;
  }
  // 多个助手一起干活（core/team.js）：助手用「干活模型」（默认这家最便宜的），只能查、不能办
  const TEAM = require("./team");
  const cloudOf = () => (o.llm && o.llm.cloud) || null;
  const team = o.team || TEAM.create({ llm: o.llm, tools: () => tools, onEvent: (e) => { if (o.onEvent) o.onEvent(e); },
    worker: () => (cloudOf() ? cloudOf().workerModel() : null), workerName: () => (cloudOf() ? cloudOf().info().workerName : "本机模型"), concurrency: o.teamConcurrency || 3 });
  // 交文件：做成 Word / 表格 / 代码文件这些，存在 dir/files 里，界面上点开（core/files.js）
  // 本机文件夹（core/folder.js）：选了就带上找、看、读三个工具，文件留在原地，用到再读
  const folder = o.folder || null;
  const folderTools = folder ? folder.tools() : [];
  const fileTool = require("./files").tool({ dir, folder });
  const tools = [
    { name: "make_ppt", desc: "按要求从头做一份新的 PPT（.pptx）。title 整份的标题，subtitle 副标题（课程、章节），theme 配色（" + Object.entries(DECK.THEMES).map(([k, v]) => `${k} ${v.name}`).join(" / ") + "，不写用 blue），slides 每一页（封面不用写，会自动加）",
      params: { title: { type: "string" }, subtitle: { type: "string" }, theme: { type: "string", enum: Object.keys(DECK.THEMES) }, slides: { type: "array", items: { type: "object", properties: AGENT.PAGE } } }, req: ["title", "slides"], changes: true,
      say: (a) => `做一份 PPT「${a.title || ""}」（${Array.isArray(a.slides) ? a.slides.length + 1 : "?"} 页）`, run: makePpt },
    // 拍一张课件 / 投影 / 讲义 → 还原成能改的一页，加进手上这份（训练出来的「眼力」：core/eyes.js）
    { name: "photo_to_slide", desc: "把老师发来的一张 PPT 页面照片（截图、拍的屏幕或投影）还原成能编辑的一页，加到手上这份 PPT 里。after：放在第几页后面（不写就放最后）；image：老师这次发的第几张（默认 1）",
      params: { after: { type: "integer" }, image: { type: "integer" } }, changes: true, say: (a) => "把照片还原成一页" + (a.after != null ? `（放在第 ${a.after} 页后面）` : ""),
      run: async (a) => {
        if (!cur) throw new Error("先做一份或者打开一份 PPT，再把照片还原成一页");
        const u = lastImgs[(+a.image || 1) - 1];
        if (!u) throw new Error("老师还没发照片：把课件的照片发过来");
        const s = await EYES.slideFromImage(o.llm, u);
        const n = await cur.d.count(), after = a.after != null ? Math.max(0, Math.min(n, +a.after)) : n;
        const r = await cur.d.addDesigned(after, s);
        return { ok: true, slide: after + 1, pages: r.pages || 1, layout: s.layout || "", title: s.title, note: "照片上的字是认出来的，请老师核对一遍" };
      } },
    ...campusTools,
    ...checkTools,
    ...webTools,
    ...groundTools,
    ...mindmapTools,
    team.tool,
    fileTool,
    ...folderTools,
  ];
  const isPpt = new Set(PPT_NAMES);
  let tap = null;       // 考试的时候看它调了哪些工具
  const agent = AGENT.create({ llm: o.llm, deck: () => (cur ? cur.d : null), tools, system: SYS, pick, onEvent: (e) => { if (tap) try { tap(e); } catch (x) {} if (o.onEvent) o.onEvent(e); }, maxRounds: o.maxRounds || 10, maxResult: o.maxResult || 3500,
    // 改了手上这份 PPT：马上存盘（界面上的预览跟着变）
    onChanged: async (name) => (isPpt.has(name) && cur ? saveCur() : null) });

  // ---------- 考一考它做 PPT、改 PPT 的本事 ----------
  // 8 道固定的题：真的让现在这版模型去做、去改，做完由程序（版式引擎、大纲、主题）核对，不靠人看。
  //   老师端没法知道一版模型「会不会做 PPT」，这个分数就是答案；以后训练 PPT 的本事，也拿它当考试。
  const EXAM = [
    { q: "做一份讲「冒泡排序」的 PPT，8 页左右，给大一学生上 C 语言课用", what: "从头做一份", ok: async (d, x) => { if (!x.made) return "没有调用 make_ppt"; const ol = await d.outline(), ks = new Set(ol.map((s) => s.layout)), c = await d.check();
      if (ol.length < 6 || ol.length > 12) return `要 8 页左右，做了 ${ol.length} 页`; if (ks.size < 4) return `版式太单一（只用了 ${[...ks].join("、")}）`; if (c.issues.length) return `版面有 ${c.issues.length} 处问题：${c.issues[0].problem}`; return null; } },
    { q: "把第 3 页改成两栏对比", what: "换版式", ok: async (d) => ((await d.outline())[2].layout === "compare" ? null : "第 3 页没有变成两栏对比") },
    { q: "整份换成绿色的", what: "换配色", ok: async (d) => ((await d.theme()).key === "green" ? null : "配色没有换成绿色") },
    { q: "把第 2 页的标题改成「今天学什么」", what: "改标题", ok: async (d) => ((await d.outline())[1].title === "今天学什么" ? null : `第 2 页的标题现在是「${(await d.outline())[1].title}」`) },
    { q: "在最后加一页课后练习，出 3 道题", what: "加一页", ok: async (d, x) => { const ol = await d.outline(); return ol.length <= x.pages0 ? "页数没有变多" : !ol[ol.length - 1].texts.join("").trim() ? "加的那一页是空的" : null; } },
    { q: "给第 2 页写一段讲稿放在备注里", what: "写备注", ok: async (d) => ((await d.notes(2)).trim().length >= 8 ? null : "第 2 页没有备注") },
    { q: "刚才那一步不要了，撤销", what: "撤销", ok: async (d) => ((await d.notes(2)).trim() ? "备注还在，没有撤销" : null) },
    { q: "明天有什么课？", what: "中间问教务的事", ok: async (d, x) => (x.tools.includes("get_timetable") ? null : "没有去查课表（" + (x.tools.join("、") || "没调工具") + "）") },
  ];
  const EXAMF = path.join(dir, "ppt-exam.json");
  const lastExam = () => { try { return JSON.parse(fs.readFileSync(EXAMF, "utf8")); } catch (e) { return null; } };
  async function pptExam() {
    await boot; if (agent.busy()) throw new Error("它正在回答，等它说完再考");
    agent.reset(); cur = null; lastKind = "";
    const items = [], t0 = Date.now();
    try {
      for (const it of EXAM) {
        const x = { tools: [], made: false, pages0: cur ? cur.pages : 0 }, s0 = Date.now();
        tap = (e) => { if (e.type === "tool" && e.stage === "done") { x.tools.push(e.name); if (e.name === "make_ppt" && e.ok) x.made = true; } };
        if (o.onEvent) o.onEvent({ type: "exam", q: it.q, no: items.length + 1, total: EXAM.length });
        let why = null;
        try { await agent.send(it.q, []); why = cur ? await it.ok(cur.d, x) : "没有做出 PPT"; } catch (e) { why = "出错：" + e.message; }
        items.push({ q: it.q, what: it.what, ok: !why, ...(why ? { why } : {}), tools: x.tools, secs: Math.round((Date.now() - s0) / 1000) });
        if (!cur && items.length === 1) break;        // 第一题就没做出来：后面的都是改这一份，考不了
      }
    } finally { tap = null; }
    const st = o.grid ? o.grid.status() : { current: {} }, qa = st.current["qa-lora"];
    const r = { at: now().getTime(), score: items.filter((i) => i.ok).length, total: EXAM.length, secs: Math.round((Date.now() - t0) / 1000), qa: qa ? qa.version : 0, items, file: cur ? path.basename(cur.file) : null };
    try { fs.writeFileSync(EXAMF, JSON.stringify(r)); } catch (e) {}
    return r;
  }

  // ---------- 成品第几版 ----------
  // grid：core/gridmodels.js 的实例。每次看一眼各样的版本；和上次记的不一样就记一笔（哪一样、从第几版到第几版、成绩）
  function product() {
    const st = o.grid ? o.grid.status() : { current: {}, pending: {}, checked: 0 };
    let changed = false;
    const parts = PARTS.map((p) => {
      const c = st.current[p.key] || null, pend = st.pending[p.key] || null;
      const v = c ? c.version : 0, m = (c && c.metrics) || {};
      if (v && hist.seen[p.key] !== v) {
        hist.log.push({ at: now().getTime(), key: p.key, name: p.name, from: hist.seen[p.key] || 0, to: v, ...(p.metric && m[p.metric] != null ? { metric: m[p.metric], base: m[p.base] } : {}) });
        hist.seen[p.key] = v; changed = true;
      }
      return { key: p.key, name: p.name, what: p.what, temp: p.temp, version: v, pending: pend, ready: !!c, ...(p.metric && m[p.metric] != null ? { metricName: p.metricName, metric: m[p.metric], base: m[p.base] != null ? m[p.base] : null } : {}) };
    });
    if (changed) { hist.log = hist.log.slice(-60); try { fs.writeFileSync(HIST, JSON.stringify(hist)); } catch (e) {} }
    // 成品第几版：每样每出一版加一（从记录里数），所以只会往上涨
    return { build: hist.log.length, parts, log: hist.log.slice(-12).reverse(), checked: st.checked || 0 };
  }

  return {
    send: async (text, images) => {
      await boot; lastImgs = Array.isArray(images) ? images.slice(0, 6) : [];
      if (rbusy || agent.busy()) throw new Error("上一句还没说完");
      const t = String(text || "").trim();
      const pre = await researchSend(t, images);
      if (pre === true) return;
      return agent.send(pre && pre.hint ? t + "\n\n" + pre.hint : text, images);
    },
    stop: () => { team.stop(); if (rbusy) { rbusy.stopped = true; return true; } return agent.stop(); },
    // 回答下面的「这个来源不对」：这个网站信誉 -1，用过它的知识卡片作废
    sourceBad: (url) => { reputation.mark(url, false); reputation.flush(); let n = 0; for (const c of cards.list()) if ((c.mats || []).some((m) => m.src === url)) { cards.remove(c.q); n++; } return { ok: true, cards: n, score: reputation.score(url) }; },
    research, reputation, cards, reset: () => agent.reset(), load: (ms) => { lastKind = ""; return agent.load(ms); }, busy: () => !!rbusy || agent.busy(), history: () => agent.history(),
    setRole(r) { if (!["student", "teacher", "staff"].includes(r)) throw new Error("身份只有：学生、教师、教务员"); if (r !== role) { role = r; lastKind = ""; agent.reset(); } return who(); },
    who, product, campus, checkup, kb, ground, mindmap, makePpt, openPpt, lastPpt, slides, pptTheme, pptUndo, pptExam, lastExam, pick, tools, ready: () => boot, deck: () => (cur ? cur.d : null),
    // 打电话模式：开着时每一句都按语音通话的规则说
    setVoice(v) { voiceMode = !!v; return voiceMode; }, voice: () => voiceMode,
    // 「多个助手一起做」：开着时每一句都带上 team_work，提示里让它能拆就拆
    setTeam(v) { teamMode = !!v; return teamMode; }, teamMode: () => teamMode,
  };
  function who() { const I = campus.identities(); return { role, me: campus.who(actor()), roles: ["student", "teacher", "staff"].map((k) => ({ key: k, name: { student: "学生", teacher: "教师（辅导员）", staff: "教务员" }[k], who: I[k].name, note: I[k].note })) }; }
}

module.exports = { create, PARTS, SPOKEN, polish, days2w };
