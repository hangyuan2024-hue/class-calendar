// 捞小智 · 联网考试：固定的一套题，网页存成快照，以后都考同一份快照（网上的内容会变，不存快照分数没法比）
//   · record：真的上网做一遍，把搜到的结果和读过的网页都存进快照文件夹
//   · replay：只读快照、不上网（考试、比较两版模型用这个）
//   四项成绩：答对（标准答案在回答里、没说「资料里没有」）、出处对（答案出现在它标的那段资料里）、说没有的比例、平均多久答完
//   题目可以换：快照文件夹里放 questions.json（[{ q, a: ["答案", "别的说法"] }]），不放就用下面这套不太会变的题
//   o.engine = "research"：考「查实了再回答」（core/research.js）。另外再算三项：
//     来源有效（标的出处里权威 / 可靠来源占多少）、该说没有时说了没有（a 为空的题：网上查不到的，要老实说没查到）、
//     答错还说得很肯定（最要紧：发版前这一项必须够低）。云端出的主意也存进快照（plans.json），重考不花云端、结果能比
//   gate：发版门槛（答对、来源有效够高，答错够低）—— 没过就不发
"use strict";
const fs = require("fs");
const path = require("path");
const GROUND = require("./ground");
const W = require("./websearch");

const QUESTIONS = [
  { q: "《中华人民共和国民法典》是哪一年通过的？", a: ["2020"] },
  { q: "嫦娥四号着陆在月球的正面还是背面？", a: ["背面"] },
  { q: "中国恢复高考是在哪一年？", a: ["1977"] },
  { q: "万维网是谁发明的？", a: ["伯纳斯", "Berners"] },
  { q: "Python 编程语言的创造者是谁？", a: ["吉多", "Guido", "范罗苏姆", "Rossum"] },
  { q: "浙江工业大学的主校区在哪个城市？", a: ["杭州"] },
  { q: "天和核心舱是哪一年发射的？", a: ["2021"] },
  { q: "第一届现代夏季奥运会在哪个城市举办？", a: ["雅典"] },
  { q: "元素周期表里原子序数是 79 的元素是什么？", a: ["金", "Au"] },
  { q: "《红楼梦》的作者是谁？", a: ["曹雪芹"] },
];
// 查实考试多出来的几道：要看来源新不新、权威不权威；最后两道网上没有答案，要老实说没查到
const RESEARCH_QUESTIONS = [
  ...QUESTIONS,
  { q: "中华人民共和国的法定退休年龄改革从哪一年开始实施？", a: ["2025"] },
  { q: "我国第一艘电磁弹射型航空母舰叫什么名字？", a: ["福建"] },
  { q: "2035 年全国高考报名人数是多少？", a: [] },
  { q: "月球背面第一家火锅店叫什么名字？", a: [] },
];
const GATE = { acc: 0.6, wrong: 0.1, src: 0.6, honest: 0.5 };

async function run(o) {
  const dir = o.dir, mode = o.mode === "record" ? "record" : "replay";
  fs.mkdirSync(dir, { recursive: true });
  let qs = o.questions || QUESTIONS;
  try { const f = path.join(dir, "questions.json"); if (!o.questions && fs.existsSync(f)) qs = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
  const wo = { ...(o.webOpt || {}), snapshot: { dir: path.join(dir, "pages"), mode }, cacheMs: 0, perMin: 1e9 };
  let searches = 0;
  const web = { search: (q) => { searches++; return W.search(q, wo); }, read: (u) => W.read(u, wo) };
  const research = o.engine === "research";
  if (research) return runResearch(o, dir, mode, wo, qs === QUESTIONS ? RESEARCH_QUESTIONS : qs);
  const g = GROUND.create({ llm: o.llm, web, readMs: o.readMs });
  const items = [];
  for (const [i, it] of qs.entries()) {
    const t0 = Date.now(), s0 = searches;
    let r = null, err = null;
    try { r = await g.answer(it.q, { web: true }); } catch (e) { err = e.message; }
    const text = r ? r.text : "", has = (s) => it.a.some((a) => String(s || "").toLowerCase().includes(String(a).toLowerCase()));
    const right = !!r && !r.abstained && has(text);
    const cited = right && r.sources.some((s) => r.mats[s.n - 1] && has(r.mats[s.n - 1].text));
    items.push({ q: it.q, right, cited, abstained: !!(r && r.abstained), searches: searches - s0, secs: Math.round((Date.now() - t0) / 100) / 10, ...(err ? { error: err } : {}), answer: text.slice(0, 200) });
    if (o.onProgress) try { o.onProgress(i + 1, qs.length); } catch (e) {}
  }
  const n = items.length || 1, pct = (k) => Math.round((items.filter((x) => x[k]).length / n) * 1000) / 1000;
  const res = { mode, at: Date.now(), total: items.length, acc: pct("right"), cite: pct("cited"), abstain: pct("abstained"), secs: Math.round((items.reduce((a, x) => a + x.secs, 0) / n) * 10) / 10, items };
  fs.writeFileSync(path.join(dir, mode === "record" ? "record.json" : "last.json"), JSON.stringify(res, null, 1));
  return res;
}

// 查实考试：一样的快照，走 research.answer
async function runResearch(o, dir, mode, wo, qs) {
  const RESEARCH = require("./research"), SRC = require("./sources");
  const pf = path.join(dir, "plans.json");
  let plans = {}; try { plans = JSON.parse(fs.readFileSync(pf, "utf8")) || {}; } catch (e) {}
  // 考试时出主意只认快照里的（重考不花云端）；录快照时没有的才去问
  const planCache = { get: (q) => plans[q] || null, set: (q, p) => { if (mode === "record") plans[q] = p; } };
  let searches = 0;
  const web = { search: (q, x) => { searches++; return W.search(q, { ...wo, ...(x || {}) }); }, read: (u) => W.read(u, wo) };
  const rs = RESEARCH.create({ llm: o.llm, cloud: mode === "record" ? o.cloud : null, web, planCache, reputation: SRC.reputation(null), now: o.now, readMs: o.readMs });
  const items = [];
  for (const [i, it] of qs.entries()) {
    const t0 = Date.now(), s0 = searches;
    let r = null, err = null;
    try { r = await rs.answer(it.q, { force: true }); } catch (e) { err = e.message; }
    const text = r ? r.text || "" : "", has = (s) => it.a.some((a) => String(s || "").toLowerCase().includes(String(a).toLowerCase()));
    const none = !it.a.length;
    // 说没有：整句弃答，或者程序写的「没查到 / 说法不一致 / 只在一家查到」
    const saidNo = !!r && (r.abstained || /没查到|说法不一致|没找到第二个来源/.test(text));
    const right = !none && !!r && !r.abstained && has(text);
    const wrong = !!r && !saidNo && !right && text.length > 0;      // 说得很肯定，但不对（没答案的题答出了东西也算）
    const cited = right && (r.sources || []).some((s) => r.mats && r.mats[s.n - 1] && has(r.mats[s.n - 1].text));
    const srcs = (r && r.sources) || [], good = srcs.filter((s) => s.tier === 1 || s.tier === 2).length;
    items.push({ q: it.q, none, right, wrong, cited, abstained: saidNo, honest: none && saidNo, srcs: srcs.length, goodSrcs: good, searches: searches - s0, cloud: r && r.usage ? r.usage.in + r.usage.out : 0,
      secs: Math.round((Date.now() - t0) / 100) / 10, ...(err ? { error: err } : {}), answer: text.slice(0, 240), sources: srcs.map((s) => `${SRC.TIER_NAME[s.tier] || ""} ${s.src}`) });
    if (o.onProgress) try { o.onProgress(i + 1, qs.length); } catch (e) {}
  }
  if (mode === "record") fs.writeFileSync(pf, JSON.stringify(plans, null, 1));
  const ans = items.filter((x) => !x.none), non = items.filter((x) => x.none), r3 = (x) => Math.round(x * 1000) / 1000;
  const allSrc = items.reduce((a, x) => a + x.srcs, 0);
  const res = { mode, engine: "research", at: Date.now(), total: items.length,
    acc: r3(ans.filter((x) => x.right).length / (ans.length || 1)), cite: r3(ans.filter((x) => x.cited).length / (ans.length || 1)),
    wrong: r3(items.filter((x) => x.wrong).length / (items.length || 1)), honest: r3(non.filter((x) => x.honest).length / (non.length || 1)),
    src: allSrc ? r3(items.reduce((a, x) => a + x.goodSrcs, 0) / allSrc) : 0, abstain: r3(items.filter((x) => x.abstained).length / (items.length || 1)),
    secs: Math.round((items.reduce((a, x) => a + x.secs, 0) / (items.length || 1)) * 10) / 10, cloudTokens: items.reduce((a, x) => a + x.cloud, 0), items };
  res.gate = gate(res, o.gate);
  fs.writeFileSync(path.join(dir, mode === "record" ? "record-research.json" : "last-research.json"), JSON.stringify(res, null, 1));
  return res;
}
// 发版门槛：答对 ≥ 6 成、来源有效 ≥ 6 成、该说没有时说没有 ≥ 5 成、答错还很肯定 ≤ 1 成
function gate(r, g = {}) {
  const G = { ...GATE, ...g }, why = [];
  if (r.acc < G.acc) why.push(`答对 ${Math.round(r.acc * 100)}%，要 ${Math.round(G.acc * 100)}% 以上`);
  if (r.wrong > G.wrong) why.push(`答错还说得很肯定 ${Math.round(r.wrong * 100)}%，要 ${Math.round(G.wrong * 100)}% 以下`);
  if (r.src < G.src) why.push(`来源有效 ${Math.round(r.src * 100)}%，要 ${Math.round(G.src * 100)}% 以上`);
  if (r.honest < G.honest) why.push(`查不到的题老实说没有 ${Math.round(r.honest * 100)}%，要 ${Math.round(G.honest * 100)}% 以上`);
  return { pass: !why.length, why };
}

module.exports = { run, gate, QUESTIONS, RESEARCH_QUESTIONS, GATE };
