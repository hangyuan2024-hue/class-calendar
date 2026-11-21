// 捞小智 · 先核对再回答（grounded answering）
//   小模型不可能什么都答对，所以回答质量不押在模型身上，押在这条流水线上：
//   1. 找资料：本机知识库（老师 / 学校放进来的讲义、规定、通知）+ 需要时联网读一两个网页 → 切成段、按问题排序，挑最相关的几段，编号 [1] [2]…
//   2. 照资料回答：每句话后面标出处 [n]；资料里没有的，开头说「资料里没有」，不编
//   3. 说出口之前逐句核对：每一句「有据 / 无据 / 矛盾」（训练出来的核对 LoRA：ground-lora；没训练好时用底子自己核对）
//      再加一道程序检查：句子里的数字必须在资料里出现过
//   4. 有问题的句子：带着「哪句不对」让它改一遍，再核对；还不对的句子直接删掉；全删光了 → 老实说不确定，告诉对方去哪查
//   回答、核对用的说法（ANSWER_SYS、CHECK_SYS、ABSTAIN）和训练时（grid/recipes/ground_gen.py、qa_train.py exam=ground）一字不差，测试里核对。
"use strict";
const fs = require("fs");
const path = require("path");

const ABSTAIN = "资料里没有";
const ANSWER_SYS = `你是「捞小智」，只根据下面给的资料回答问题。
· 每句话后面用方括号标出依据是第几段资料，比如 [2]；一句话用到两段就写 [1][3]。
· 资料里没写的内容一句也不要加，不要用自己的印象补充；数字、名字、日期照资料抄，不要改。
· 资料里找不到答案：第一句就说「资料里没有」并说清楚缺的是什么，然后建议去哪里查，不要猜。
· 用简体中文，先直接回答，再补充一两句资料里的相关细节。`;
const CHECK_SYS = `你是核对员。下面有几段资料和一个回答，回答已经按句编了号。逐句判断：
· 有据：这句话的意思资料里明确写了，写成「第N句：有据[资料编号]」
· 无据：资料里找不到这句话说的内容（哪怕它可能是对的），写成「第N句：无据」
· 矛盾：这句话和资料说的不一样（数字、名字、日期、因果不对），写成「第N句：矛盾[资料编号]」
每句一行，不要写别的。`;

// ---------------- 切词、切段、排序（BM25；中文按单字 + 相邻两字，英文、数字按词） ----------------
function toks(s) {
  const out = [];
  for (const m of String(s || "").toLowerCase().matchAll(/[a-z0-9][a-z0-9.+#-]*|[一-鿿]+/g)) {
    const w = m[0];
    if (/^[a-z0-9]/.test(w)) { out.push(w); continue; }
    for (let i = 0; i < w.length; i++) { out.push(w[i]); if (i + 1 < w.length) out.push(w.slice(i, i + 2)); }
  }
  return out;
}
const STOP = new Set("的了是在和有我你他她它们这那就也都而及与或一个吗呢吧啊什么怎么为什么如何多少哪".split("").concat(["什么", "怎么", "如何", "多少", "哪些", "哪个", "为什", "么呢"]));
function chunks(text, { size = 260, overlap = 40 } = {}) {
  const paras = String(text || "").replace(/\r/g, "").split(/\n{1,}/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  let buf = "";
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ""; };
  for (const p of paras) {
    if (buf && buf.length + p.length > size) { const tail = buf.slice(-overlap); flush(); buf = tail.length < overlap ? "" : tail; }
    if (p.length > size * 1.5) { for (let i = 0; i < p.length; i += size - overlap) { buf += p.slice(i, i + size); flush(); } continue; }
    buf += (buf ? "\n" : "") + p;
  }
  flush();
  return out;
}
function rank(query, docs, { k1 = 1.4, b = 0.75 } = {}) {
  const q = [...new Set(toks(query))].filter((t) => !STOP.has(t));
  if (!q.length || !docs.length) return docs.map((d, i) => ({ i, score: 0 }));
  const tf = docs.map((d) => { const m = new Map(); for (const t of toks(d.text)) m.set(t, (m.get(t) || 0) + 1); return m; });
  const len = tf.map((m) => [...m.values()].reduce((a, c) => a + c, 0));
  const avg = len.reduce((a, c) => a + c, 0) / docs.length || 1;
  const df = new Map(q.map((t) => [t, tf.filter((m) => m.has(t)).length]));
  return tf.map((m, i) => {
    let s = 0, big = 0;
    for (const t of q) {
      const f = m.get(t) || 0; if (!f) continue;
      if (t.length > 1) big++;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len[i] / avg)) * (t.length > 1 ? 1.6 : 1);
    }
    return { i, score: s, big };
  }).sort((a, c) => c.score - a.score);
}

// ---------------- 本机知识库：一个文件夹，放学校自己的资料 ----------------
//   .txt .md .docx .pptx .pdf .html，视频和录音（听写成带时间的文字稿）；校规按条切（core/kbfiles.js）
//   读出来的文字缓存在 .cache 里；「资料说明.json」可以写每份资料的日期、是否废止、来源
function kb(dir, opt = {}) {
  const KF = require("./kbfiles");
  const CACHE = path.join(dir, ".cache"), META = path.join(dir, "资料说明.json");
  const files = () => { try { return fs.readdirSync(dir).filter((f) => !f.startsWith(".") && f !== "资料说明.json" && KF.SUPPORTED(f)).sort(); } catch (e) { return []; } };
  const sigOf = (f) => { try { const st = fs.statSync(path.join(dir, f)); return st.size + ":" + Math.round(st.mtimeMs); } catch (e) { return ""; } };
  // 缓存文件名用哈希（中文文件名转出来很长，Windows 上整条路径超过 260 个字符会出问题）
  const cf = (f) => path.join(CACHE, require("crypto").createHash("sha1").update(f).digest("hex") + ".json");
  const readCache = (f) => { try { const c = JSON.parse(fs.readFileSync(cf(f), "utf8")); return c.sig === sigOf(f) ? c : null; } catch (e) { return null; } };
  const meta = () => { try { return JSON.parse(fs.readFileSync(META, "utf8")) || {}; } catch (e) { return {}; } };
  // 读还没读过的文件（视频、录音只在 media: true 时听写，慢）→ { done, pending: [没听写的视频], errors: [{ file, error }] }
  let busy = null;
  async function refresh({ media = false, say = () => {} } = {}) {
    if (busy) return busy;
    busy = (async () => {
      const out = { done: 0, pending: [], errors: [] };
      for (const f of files()) {
        if (readCache(f)) continue;
        if (KF.AV.test(f) && !media) { out.pending.push(f); continue; }
        try {
          say(`读「${f}」`);
          const x = await KF.extract(path.join(dir, f), { transcribe: opt.transcribe, say });
          fs.mkdirSync(CACHE, { recursive: true });
          fs.writeFileSync(cf(f), JSON.stringify({ sig: sigOf(f), file: f, ...x }));
          out.done++;
        } catch (e) { out.errors.push({ file: f, error: e.message }); }
      }
      return out;
    })();
    try { return await busy; } finally { busy = null; }
  }
  let cache = null, csig = "";
  function load() {
    const cst = (f) => { try { return Math.round(fs.statSync(cf(f)).mtimeMs); } catch (e) { return 0; } };
    const fl = files(), m = meta(), s = fl.map((f) => f + ":" + sigOf(f) + ":" + cst(f)).join("|") + "|" + JSON.stringify(m);
    if (cache && s === csig) return cache;
    const out = [];
    for (const f of fl) {
      // .txt / .md 不用等「读一遍」：直接读（也按条切）
      let c = readCache(f);
      if (!c && /\.(txt|md)$/i.test(f)) { try { const t = fs.readFileSync(path.join(dir, f), "utf8"), arts = KF.byArticle(t); c = { title: f.replace(/\.(txt|md)$/i, ""), segs: arts || [{ text: t }], kind: arts ? "rules" : "text" }; } catch (e) {} }
      const info = m[f] || {};
      if (!c || info.abolished) continue;
      const title = c.title || f.replace(/\.[^.]+$/, ""), date = info.date || c.date || null;
      for (const sg of c.segs) {
        const parts = c.kind === "video" || /^rules/.test(c.kind) ? [sg.text] : chunks(sg.text);
        parts.forEach((text, j) => out.push({ title: title + (sg.loc ? " " + sg.loc : ""), src: "知识库：" + f + (sg.loc ? " " + sg.loc : ""), text, j, date, kind: c.kind, ...(sg.t != null ? { t: sg.t } : {}), ...(info.source ? { by: info.source } : {}) }));
      }
    }
    cache = out; csig = s;
    return out;
  }
  return {
    dir,
    list: () => files(),
    status: () => { const fl = files(); return { files: fl.length, read: fl.filter((f) => readCache(f)).length, media: fl.filter((f) => KF.AV.test(f) && !readCache(f)) }; },
    refresh,
    add(name, text) { fs.mkdirSync(dir, { recursive: true }); const f = String(name || "资料").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) + (/\.(txt|md)$/i.test(name) ? "" : ".txt"); fs.writeFileSync(path.join(dir, f), String(text || "")); return f; },
    remove(name) { const f = path.join(dir, path.basename(String(name || ""))); if (fs.existsSync(f)) fs.unlinkSync(f); },
    // 至少对上两个词（相邻两字 / 英文词），只对上零散的单字不算相关；日期新的稍微靠前
    find(q, n = 4) {
      const all = load(), now = Date.now();
      return rank(q, all).filter((r) => r.score > 0.5 && r.big >= 2)
        .map((r) => { const d = all[r.i].date ? Date.parse(all[r.i].date) : NaN; return { ...r, score: r.score * (isNaN(d) ? 1 : 1 + 0.15 * Math.max(0, 1 - (now - d) / (3 * 365 * 864e5))) }; })
        .sort((a, b) => b.score - a.score).slice(0, n).map((r) => all[r.i]);
    },
  };
}

// ---------------- 读回答：分句、出处、核对结果 ----------------
function sentences(s) {
  const t = String(s || "").replace(/\r/g, "").replace(/\n+/g, "\n").trim();
  const out = [];
  for (const m of t.matchAll(/[^。！？!?\n]+(?:[。！？!?]+|$)(?:\s*(?:\[\d+\])+)?/g)) { const x = m[0].trim(); if (x.replace(/(\[\d+\])+/g, "").trim().length >= 2) out.push(x); }
  return out;
}
const citesOf = (s) => [...String(s).matchAll(/\[(\d+)\]/g)].map((m) => +m[1]);
const abstained = (s) => String(s || "").trim().replace(/^[「“"]/, "").startsWith(ABSTAIN);
function parseCheck(s, n) {
  const out = new Array(n).fill(null);
  for (const m of String(s || "").matchAll(/第\s*(\d+)\s*句\s*[：:]\s*(有据|无据|矛盾)\s*((?:\[\d+\]\s*)*)/g)) {
    const i = +m[1] - 1; if (i >= 0 && i < n) out[i] = { verdict: m[2], cites: citesOf(m[3]) };
  }
  return out;
}
const nums = (s) => (String(s).replace(/\[\d+\]/g, "").match(/\d+(?:\.\d+)?/g) || []);
// 程序检查：句子里的数字资料里都有；标的出处存在
function ruleCheck(sent, mats) {
  const all = mats.map((m) => m.text).join("\n");
  for (const x of nums(sent)) if (!all.includes(x)) return `数字 ${x} 资料里没有`;
  for (const c of citesOf(sent)) if (c < 1 || c > mats.length) return `标的出处 [${c}] 不存在`;
  return null;
}
const matText = (mats) => mats.map((m, i) => `[${i + 1}] ${m.title ? "（" + m.title + (m.date ? "，" + m.date : "") + "）" : ""}${m.text}`).join("\n\n");
const numbered = (ss) => ss.map((s, i) => `第${i + 1}句：${s}`).join("\n");

// ---------------- 流水线 ----------------
// o.llm：chat(messages, { mode: "ground" | "check", temperature, maxTokens }) → { content }
// o.kb：上面的 kb(dir)；o.web：{ search(q), read(url) }（core/websearch.js）
function create(o) {
  const say = (m) => { try { o.onStep && o.onStep(m); } catch (e) {} };
  const ask = async (mode, sys, user, maxTokens) => {
    if (o.llm.start) await o.llm.start();
    const r = await o.llm.chat([{ role: "system", content: sys }, { role: "user", content: user }], { mode, temperature: 0, maxTokens });
    return String((r && r.content) || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  };

  async function gather(q, { web } = {}) {
    if (o.kb && o.kb.refresh) { try { await o.kb.refresh({ say }); } catch (e) {} }   // 新放进来的文件先读一遍（视频除外）
    const mats = o.kb ? o.kb.find(q, 4) : [];
    // 别的本机资料（思维导图……）：{ chunks: async () => [{ title, src, text }] }，和知识库一起按问题排，挑最相关的
    for (const so of o.sources || []) {
      try {
        const cs = await so.chunks();
        rank(q, cs).filter((r) => r.score > 0.5 && r.big >= 2).slice(0, 3).forEach((r) => mats.push(cs[r.i]));
      } catch (e) { say("读资料没成：" + e.message); }
    }
    if (mats.length > 5) { const r = rank(q, mats); mats.splice(0, mats.length, ...r.slice(0, 5).map((x) => mats[x.i])); }
    if (web && o.web && mats.length < 3) {
      say("联网找资料");
      try {
        const rs = (await o.web.search(q)).slice(0, 4);
        const pages = [];
        // 前三个网页一起读，每个最多等 o.readMs（默认 8 秒），超时的跳过
        const lim = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("太慢")), ms))]);
        const got = await Promise.allSettled(rs.slice(0, 3).map((r) => lim(o.web.read(r.url), o.readMs || 8000).then((p) => ({ r, p }))));
        for (const g of got) if (g.status === "fulfilled") { const { r, p } = g.value; pages.push(...chunks(p.text).map((text) => ({ title: p.title || r.title, src: r.url, text, ...(p.date ? { date: p.date } : {}) }))); }
        for (const r of rs) if (r.snippet) pages.push({ title: r.title, src: r.url, text: r.snippet });
        rank(q, pages).slice(0, 5 - mats.length).forEach((r) => r.score > 0 && mats.push(pages[r.i]));
      } catch (e) { say("联网没成：" + e.message); }
    }
    return mats;
  }

  async function check(q, mats, ss) {
    const raw = await ask("check", CHECK_SYS, `资料：\n${matText(mats)}\n\n问题：${q}\n\n回答：\n${numbered(ss)}`, 60 + ss.length * 24);
    const v = parseCheck(raw, ss.length);
    return ss.map((s, i) => {
      const why = ruleCheck(s, mats);
      if (why) return { s, ok: false, why };
      const x = v[i];
      if (!x) return { s, ok: false, why: "核对时没给结论" };
      if (x.verdict === "有据") return { s, ok: true };
      return { s, ok: false, why: x.verdict === "矛盾" ? "和资料说的不一样" : "资料里没有依据" };
    });
  }

  // → { text, abstained, sources:[{n,title,src}], dropped:[{s,why}], checked:true, mats }
  async function answer(q, opt = {}) {
    q = String(q || "").trim();
    if (!q) throw new Error("要问什么（question）");
    say("找资料");
    const mats = await gather(q, opt);
    const nothing = () => ({ text: `${ABSTAIN}能回答「${q.slice(0, 40)}」的内容。${o.kb ? "可以把相关的讲义、通知放进知识库，" : ""}${opt.web ? "" : "或者让我联网查一下，"}也可以去问老师或看官方通知。`, abstained: true, sources: [], dropped: [], checked: true, mats });
    if (!mats.length) return nothing();
    say("照资料回答");
    const user = `资料：\n${matText(mats)}\n\n问题：${q}`;
    let reply = await ask("ground", ANSWER_SYS, user, 700);
    if (abstained(reply)) return { text: reply, abstained: true, sources: [], dropped: [], checked: true, mats };
    let ss = sentences(reply), res = [];
    for (let round = 0; round < 2; round++) {
      say(round ? "改完再核对一遍" : "逐句核对");
      res = await check(q, mats, ss);
      const bad = res.map((r, i) => (r.ok ? null : `第${i + 1}句「${r.s}」：${r.why}`)).filter(Boolean);
      if (!bad.length || round === 1) break;
      say("有 " + bad.length + " 句不对，改一遍");
      reply = await ask("ground", ANSWER_SYS, `${user}\n\n你上一次的回答：\n${numbered(ss)}\n\n核对发现这些句子有问题：\n${bad.join("\n")}\n请只根据资料重写回答：有问题的句子按资料改对，资料里没有的就删掉。`, 700);
      if (abstained(reply)) return { text: reply, abstained: true, sources: [], dropped: [], checked: true, mats };
      ss = sentences(reply);
    }
    const keep = res.filter((r) => r.ok), dropped = res.filter((r) => !r.ok).map((r) => ({ s: r.s, why: r.why }));
    if (!keep.length) return { ...nothing(), dropped };
    const used = [...new Set(keep.flatMap((r) => citesOf(r.s)))].sort((a, c) => a - c);
    return { text: keep.map((r) => r.s).join(""), abstained: false, sources: used.map((n) => ({ n, title: mats[n - 1].title || "", src: mats[n - 1].src || "" })), dropped, checked: true, mats };
  }

  // 给捞小智的工具
  function tools() {
    return [{
      name: "answer_from_sources", desc: "查资料并核对后回答：知识、规定、通知、事实类的问题（课程知识点、学校规定、某件事是什么、数据是多少）先用它。它会在本机知识库里找资料（需要时联网），照资料回答、逐句核对，返回核对过的回答和出处。你只能转述它给的回答，不要自己添内容",
      params: { question: { type: "string", description: "对方的问题，补全成完整的一句" }, web: { type: "boolean", description: "要不要联网找资料（新闻、最近的事、本机资料里没有的）" } }, req: ["question"],
      say: (a) => `查资料核对后回答「${String(a.question || "").slice(0, 24)}」`,
      run: async (a) => {
        const r = await answer(a.question, { web: !!a.web });
        return { answer: r.text, abstained: r.abstained, sources: r.sources.map((s) => `[${s.n}] ${s.title}${s.src && /^https?:/.test(s.src) ? "（" + s.src + "）" : ""}`), dropped: r.dropped.length,
          tip: r.abstained ? "资料里没有：照这句告诉对方，不要自己编答案" : "照 answer 的内容说（可以去掉方括号、说得口语一点，但不要加资料外的内容），最后说一句来源" };
      },
    }];
  }
  return { answer, gather, check, tools };
}

module.exports = { create, kb, toks, chunks, rank, sentences, parseCheck, ruleCheck, abstained, citesOf, ABSTAIN, ANSWER_SYS, CHECK_SYS };
