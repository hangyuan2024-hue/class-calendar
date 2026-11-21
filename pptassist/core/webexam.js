// 捞小智 · 联网考试：固定的一套题，网页存成快照，以后都考同一份快照（网上的内容会变，不存快照分数没法比）
//   · record：真的上网做一遍，把搜到的结果和读过的网页都存进快照文件夹
//   · replay：只读快照、不上网（考试、比较两版模型用这个）
//   四项成绩：答对（标准答案在回答里、没说「资料里没有」）、出处对（答案出现在它标的那段资料里）、说没有的比例、平均多久答完
//   题目可以换：快照文件夹里放 questions.json（[{ q, a: ["答案", "别的说法"] }]），不放就用下面这套不太会变的题
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

async function run(o) {
  const dir = o.dir, mode = o.mode === "record" ? "record" : "replay";
  fs.mkdirSync(dir, { recursive: true });
  let qs = o.questions || QUESTIONS;
  try { const f = path.join(dir, "questions.json"); if (!o.questions && fs.existsSync(f)) qs = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
  const wo = { ...(o.webOpt || {}), snapshot: { dir: path.join(dir, "pages"), mode }, cacheMs: 0, perMin: 1e9 };
  let searches = 0;
  const web = { search: (q) => { searches++; return W.search(q, wo); }, read: (u) => W.read(u, wo) };
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

module.exports = { run, QUESTIONS };
