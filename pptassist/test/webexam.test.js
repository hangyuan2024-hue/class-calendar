// 联网考试（core/webexam.js）+ 联网搜索的加固（core/websearch.js）：
//   录一遍存快照 → 断网也能按快照考、分数一样；四项成绩；必应不行换下一家；搜索词里的手机号、学号抹掉；限速；网页几个一起读、慢的跳过
"use strict";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const W = require("../core/websearch");
const EX = require("../core/webexam");
const G = require("../core/ground");
const ok = (m) => console.log("✓", m);

const bing = (items) => `<html><body><ol>${items.map((x) => `<li class="b_algo"><h2><a href="${x.url}">${x.title}</a></h2><div class="b_caption"><p>${x.snippet}</p></div></li>`).join("")}</ol></body></html>`;
const page = (title, body) => `<html><head><title>${title}</title></head><body><nav>首页 导航</nav><article><p>发布时间：2025-03-01</p><p>${body}</p></article></body></html>`;
const resp = (html, status = 200) => ({ ok: status === 200, status, url: "", headers: { get: () => "text/html; charset=utf-8" }, arrayBuffer: async () => Buffer.from(html) });

(async () => {
  // ---------- 搜索的加固 ----------
  assert.equal(W.scrub("我手机 13812345678 学号 202312345678 查一下 a.b@c.com 奖学金"), "我手机 学号 查一下 奖学金");
  const asked = [];
  const r = await W.search("奖学金 13812345678", { cacheMs: 0, fetch: async (u) => { asked.push(u); if (/bing/.test(u)) return resp("", 503); return resp(`<h3 class="res-title"><a href="https://news.example.edu/a">奖学金评定办法</a></h3><p class="res-desc">每年 10 月评定</p>`); } });
  assert.ok(/360 搜索/.test(r[0].engine)); assert.ok(asked.some((u) => /so\.com/.test(u)) && asked.some((u) => /baidu\.com/.test(u)), "几家一起搜：必应不行，360 的结果照样用");
  assert.ok(asked.every((u) => !/13812345678/.test(decodeURIComponent(u))), "手机号没发出去");
  W._recent.length = 0;
  let n = 0; const quick = { cacheMs: 0, perMin: 3, fetch: async () => { n++; return resp(bing([{ url: "https://a.example.com/", title: "t", snippet: "s" }])); } };
  for (let i = 0; i < 3; i++) await W.search("限速 " + i, quick);
  await assert.rejects(W.search("限速 4", quick), /太频繁/);
  ok("搜索：必应不行自动换 360 / 搜狗；手机号、学号、邮箱不发出去；同一台电脑每分钟有上限");

  // ---------- 网页几个一起读、慢的跳过 ----------
  const g = G.create({ readMs: 300, llm: { chat: async (ms, o) => (o.mode === "ground" ? { content: "答案在第二个网页。[1]" } : { content: "第1句：有据[1]" }) },
    web: { search: async () => [{ title: "慢", url: "https://slow.example.com/" }, { title: "快", url: "https://fast.example.com/" }],
      read: async (u) => (/slow/.test(u) ? new Promise(() => {}) : { title: "快的网页", text: "答案在第二个网页，这是快的那个网页里的内容。" }) } });
  const t0 = Date.now(); const a = await g.answer("答案在哪个网页", { web: true });
  assert.ok(Date.now() - t0 < 2000, "慢的网页不等"); assert.ok(a.mats.every((m) => /fast/.test(m.src)));
  ok("网页几个一起读，等不及的跳过（不卡住回答）");

  // ---------- 联网考试：录快照 → 断网照样考，分数一样 ----------
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "webexam-"));
  const qs = [{ q: "嫦娥四号着陆在月球的正面还是背面？", a: ["背面"] }, { q: "中国恢复高考是在哪一年？", a: ["1977"] }];
  const net = async (u) => {
    if (/bing\.com/.test(u)) return resp(bing(/%E5%AB%A6/.test(u) || /嫦娥/.test(decodeURIComponent(u)) ? [{ url: "https://space.example.cn/ce4", title: "嫦娥四号", snippet: "着陆月球背面" }] : [{ url: "https://edu.example.cn/gk", title: "恢复高考", snippet: "1977 年恢复高考" }]));
    if (/ce4/.test(u)) return resp(page("嫦娥四号", "2019 年 1 月，嫦娥四号在月球背面南极艾特肯盆地着陆，是人类第一次在月球背面软着陆。"));
    if (/gk/.test(u)) return resp(page("恢复高考", "1977 年冬天，中断十年的高考恢复，570 万人走进考场。"));
    return resp("", 404);
  };
  const llm = { chat: async (ms, o) => {
    const u = ms[1].content;
    if (o.mode === "ground") return { content: /嫦娥/.test(u) ? "嫦娥四号着陆在月球背面。[1]" : "中国在 1977 年恢复高考。[1]" };
    return { content: "第1句：有据[1]" };
  } };
  const rec = await EX.run({ dir, mode: "record", questions: qs, llm, webOpt: { fetch: net } });
  assert.equal(rec.acc, 1); assert.equal(rec.cite, 1); assert.equal(rec.total, 2);
  assert.ok(fs.readdirSync(path.join(dir, "pages")).length >= 4, "搜索结果和网页都存进了快照");
  W._cache.clear();
  const rep = await EX.run({ dir, mode: "replay", questions: qs, llm, webOpt: { fetch: async () => { throw new Error("断网了"); } } });
  assert.equal(rep.acc, rec.acc); assert.equal(rep.cite, rec.cite);
  assert.ok(fs.existsSync(path.join(dir, "last.json")));
  // 编的答案：出处里没有 → 出处那一项不算对；答错 → 答对那一项不算
  const bad = await EX.run({ dir, mode: "replay", questions: qs, webOpt: {}, llm: { chat: async (ms, o) => (o.mode === "ground" ? { content: "答案是 1966 年。[1]" } : { content: "第1句：有据[1]" }) } });
  assert.equal(bad.acc, 0);
  assert.ok(EX.QUESTIONS.length >= 10);
  ok(`联网考试：录一遍存快照（${rec.total} 道，答对 ${rec.acc}、出处对 ${rec.cite}），断网按快照再考分数一样；编的答案判错`);

  // ---------- 查实考试（engine = research）：多算来源有效、该说没有时说没有、答错还肯定；过不了门槛不发版 ----------
  const R = require("../core/research");
  const rdir = fs.mkdtempSync(path.join(os.tmpdir(), "webexam-r-"));
  const rqs = [{ q: "嫦娥四号着陆在月球的正面还是背面？", a: ["背面"] }, { q: "中国恢复高考是在哪一年？", a: ["1977"] }, { q: "月球背面第一家火锅店叫什么名字？", a: [] }];
  const net2 = async (u) => {
    if (/bing\.com/.test(u)) return resp(bing(/高考/.test(decodeURIComponent(u)) ? [{ url: "https://www.moe.gov.cn/gk", title: "恢复高考", snippet: "1977 年恢复高考" }] : [{ url: "https://www.cnsa.gov.cn/ce4", title: "嫦娥四号", snippet: "着陆月球背面" }]));
    if (/ce4/.test(u)) return resp(page("嫦娥四号", "2019 年 1 月，嫦娥四号在月球背面南极艾特肯盆地着陆，是人类第一次在月球背面软着陆。着陆后，着陆器和巡视器分离，玉兔二号月球车开始在月面巡视探测，开展科学研究。"));
    if (/gk/.test(u)) return resp(page("恢复高考", "1977 年冬天，中断十年的高考恢复，570 万人走进考场。这一年的考试由各省自行命题，录取了二十七万多名新生，改变了一代人的命运。"));
    return resp("", 404);
  };
  let planAsked = 0;
  const cloud = { chat: async (ms) => { if (!ms[0].content.startsWith("你是查资料的策划")) return { content: "[]", usage: { prompt_tokens: 20, completion_tokens: 2 } }; planAsked++; return { content: JSON.stringify({ need: "facts", type: "general", queries: [ms[1].content], sites: [], slots: [{ key: "答案", ask: ms[1].content }], outline: [] }), usage: { prompt_tokens: 50, completion_tokens: 30 } }; } };
  const llmR = (lie) => ({ chat: async (ms) => {
    const sys = ms[0].content, u = ms[1].content;
    if (sys === R.QUOTE_SYS) { const m = /嫦娥四号在月球背面[^，。]*着陆|1977 年冬天，中断十年的高考恢复/.exec(u.split("问题：")[0]); return { content: m && !/火锅/.test(u.split("问题：")[1]) ? m[0] : "没有" }; }
    if (sys === G.ANSWER_SYS) return { content: /火锅/.test(u) ? "第一家火锅店叫嫦娥火锅。[1]" : /嫦娥/.test(u) ? (lie ? "嫦娥四号着陆在月球正面。[1]" : "嫦娥四号着陆在月球背面。[1]") : "中国在 1977 年恢复高考。[1]" };
    if (sys === G.CHECK_SYS) return { content: /火锅/.test(u) ? "第1句：无据" : "第1句：有据[1]" };
    return { content: "" };
  } });
  W._cache.clear();
  const rr = await EX.run({ dir: rdir, mode: "record", engine: "research", questions: rqs, llm: llmR(false), cloud, webOpt: { fetch: net2 }, now: () => Date.parse("2026-11-27") });
  assert.equal(rr.acc, 1, JSON.stringify(rr.items, null, 1)); assert.equal(rr.honest, 1, "查不到的火锅店：老实说没查到"); assert.equal(rr.wrong, 0); assert.equal(rr.src, 1, "用的都是权威来源");
  assert.ok(rr.gate.pass, rr.gate.why.join("；")); assert.equal(planAsked, 3); assert.ok(rr.cloudTokens > 0);
  assert.ok(fs.existsSync(path.join(rdir, "plans.json")), "云端出的主意存进快照");
  W._cache.clear();
  const rp2 = await EX.run({ dir: rdir, mode: "replay", engine: "research", questions: rqs, llm: llmR(false), cloud, webOpt: { fetch: async () => { throw new Error("断网了"); } }, now: () => Date.parse("2026-11-27") });
  assert.equal(planAsked, 3, "重考不再问云端"); assert.equal(rp2.acc, rr.acc); assert.equal(rp2.honest, rr.honest);
  const lie = await EX.run({ dir: rdir, mode: "replay", engine: "research", questions: rqs, llm: llmR(true), webOpt: {}, now: () => Date.parse("2026-11-27") });
  assert.ok(lie.wrong > 0.1 && !lie.gate.pass && lie.gate.why.some((w) => /答错还说得很肯定/.test(w)), "模型说错了还核对成有据：门槛拦下");
  assert.ok(EX.RESEARCH_QUESTIONS.some((x) => !x.a.length));
  ok(`查实考试：答对 ${rr.acc}、来源有效 ${rr.src}、查不到老实说 ${rr.honest}、答错还肯定 ${rr.wrong}；云端主意存快照、重考不花云端；答错的版本过不了发版门槛`);
  fs.rmSync(rdir, { recursive: true, force: true });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("联网考试：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
