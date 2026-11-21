// 先核对再回答（core/ground.js）：找资料（知识库 + 联网）→ 照资料回答 → 逐句核对 → 有错的改一遍 → 还错就删 → 全删光就老实说不确定
"use strict";
const assert = require("assert");
const fs = require("fs"), os = require("os"), path = require("path");
const G = require("../core/ground");
const ok = (m) => console.log("✓", m);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ground-"));
  const kb = G.kb(path.join(dir, "kb"));
  kb.add("学生手册", "第十二条 学生请假一天以内由辅导员批准，三天以内由学院副书记批准，超过三天报学生处备案。\n第十三条 病假需附校医院证明。");
  kb.add("食堂通知.md", "二食堂周末营业时间为早上7点到晚上8点。\n一食堂周末不营业。");
  kb.add("图书馆", "图书馆开放时间：周一到周日 8:00-22:00，每人最多借 10 本书，借期 30 天。");

  // ---------- 找资料：中文按字和相邻两字排序 ----------
  const f = kb.find("请假三天要谁批准");
  assert.ok(f.length && /三天以内由学院副书记批准/.test(f[0].text) && f[0].src === "知识库：学生手册.txt");
  assert.ok(/二食堂/.test(kb.find("周末二食堂几点开门")[0].text));
  assert.equal(kb.find("量子力学的薛定谔方程").length, 0, "没关系的资料不硬凑");
  assert.deepEqual(G.sentences("请假三天由副书记批准。[1]病假要附证明。[1]\n要不要我帮你请？"), ["请假三天由副书记批准。[1]", "病假要附证明。[1]", "要不要我帮你请？"]);
  assert.equal(G.ruleCheck("借期 60 天。[1]", [{ text: "借期 30 天" }]), "数字 60 资料里没有");
  assert.equal(G.ruleCheck("借期 30 天。[3]", [{ text: "借期 30 天" }]), "标的出处 [3] 不存在");
  ok("知识库：放进 .txt / .md 就能查；中文问题找到对的那段；不相关的不硬凑；句子里的数字、出处程序再核一遍");

  // ---------- 流水线（假模型：第一次答多编了一句，核对抓出来，改一遍就对了） ----------
  const seen = [];
  let round = 0;
  const llm = { chat: async (ms, opt) => {
    seen.push({ mode: opt.mode, sys: ms[0].content, user: ms[1].content });
    if (opt.mode === "ground") {
      round++;
      if (/借书/.test(ms[1].content)) return { content: "每人最多借 10 本书。[1]借期是 60 天。[1]" };   // 数字编错：程序就能抓
      if (/宿舍/.test(ms[1].content)) return { content: "宿舍晚上11点关门。[1]" };
      return round === 1 ? { content: "请假三天以内由学院副书记批准。[1]另外请假需要家长签字。[1]" } : { content: "请假三天以内由学院副书记批准。[1]超过三天要报学生处备案。[1]" };
    }
    const n = (ms[1].content.match(/^第\d+句/gm) || []).length;
    if (/宿舍/.test(ms[1].content)) return { content: "第1句：无据" };
    return { content: Array.from({ length: n }, (_, i) => /家长签字/.test(ms[1].content.split("\n").filter((l) => l.startsWith(`第${i + 1}句`))[0]) ? `第${i + 1}句：无据` : `第${i + 1}句：有据[1]`).join("\n") };
  } };
  const steps = [];
  const g = G.create({ llm, kb, onStep: (m) => steps.push(m) });
  const r = await g.answer("请假三天要谁批准？");
  assert.equal(r.abstained, false);
  assert.equal(r.text, "请假三天以内由学院副书记批准。[1]超过三天要报学生处备案。[1]");
  assert.ok(!/家长/.test(r.text), "编的那句没说出去");
  assert.deepEqual(r.sources.map((s) => s.src), ["知识库：学生手册.txt"]);
  assert.ok(seen[0].sys === G.ANSWER_SYS && seen[1].sys === G.CHECK_SYS && seen[1].user.includes("第2句：另外请假需要家长签字。[1]"));
  assert.ok(seen[2].user.includes("核对发现这些句子有问题") && seen[2].user.includes("家长签字") && seen[2].user.includes("资料里没有依据"), "带着哪句不对去改");
  assert.ok(steps.includes("逐句核对") && steps.includes("改完再核对一遍"));
  ok("照资料回答 → 逐句核对：多编的一句被抓出来，带着「哪句不对」改一遍，再核对通过；回答带出处");

  const r2 = await g.answer("图书馆借书能借多久");
  assert.equal(r2.text, "每人最多借 10 本书。[1]", "数字编错的那句（60 天）改了还错 → 删掉，只说核对过的");
  assert.equal(r2.dropped.length, 1); assert.ok(/60/.test(r2.dropped[0].why));
  const r3 = await g.answer("宿舍几点关门");
  assert.ok(r3.abstained && r3.text.startsWith(G.ABSTAIN), "资料里没有、编的又被核对挡掉 → 老实说没有");
  const r4 = await g.answer("量子力学是什么");
  assert.ok(r4.abstained && /知识库/.test(r4.text), "一段资料都没找到：不问模型，直接说没有、告诉对方怎么办");
  ok("改了还错的句子直接删；全删光或者没资料 → 说「资料里没有」，告诉对方去哪查，不编");

  // ---------- 联网：本机资料不够时读网页，网页段落和问题一起排序 ----------
  const web = { search: async () => [{ title: "某大学新闻", url: "https://news.example.edu/a", snippet: "2026 年校运会定在 11 月 28 日举行。" }], read: async () => ({ title: "校运会通知", text: "经研究，2026 年秋季校运会定于 11 月 28 日在东区田径场举行。\n请各学院做好准备。" }) };
  const g2 = G.create({ llm: { chat: async (ms, opt) => (opt.mode === "ground" ? { content: "校运会在 11 月 28 日举行。[1]" } : { content: "第1句：有据[1]" }) }, kb, web });
  const r5 = await g2.answer("今年校运会是哪天", { web: true });
  assert.equal(r5.text, "校运会在 11 月 28 日举行。[1]"); assert.ok(/^https:/.test(r5.sources[0].src));
  const t = g2.tools()[0];
  assert.equal(t.name, "answer_from_sources");
  const tr = await t.run({ question: "今年校运会是哪天", web: true });
  assert.ok(tr.answer && tr.sources[0].includes("news.example.edu") || tr.sources[0].includes("校运会"));
  ok("联网找资料：读网页、挑最相关的段，照样核对；给捞小智的工具 answer_from_sources 返回核对过的回答和出处");

  fs.rmSync(dir, { recursive: true, force: true });
  console.log("先核对再回答：全部通过");
})().catch((e) => { console.error(e); process.exit(1); });
