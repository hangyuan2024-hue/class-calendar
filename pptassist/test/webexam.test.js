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
  assert.equal(r[0].engine, "360 搜索"); assert.equal(asked.length, 3, "必应两个地址都不行，换 360");
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

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("联网考试：全部通过");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
