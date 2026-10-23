// 6.16 本地整理准确率基准：node test/parse-bench.js [--v]
// 每条消息按「条数、类型、日期、时间、地点、标题」打分，最后输出各项准确率；--v 打印每条没对上的
const P = require("../parse.js");
const cases = require("./bench-cases.js");
const PUB = "2026-10-23", V = process.argv.includes("--v");
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
const tot = { n: 0, type: 0, date: 0, time: 0, loc: 0, sub: 0 }, cnt = { n: 0, type: 0, date: 0, time: 0, loc: 0, sub: 0 };
const fails = [];
for (const [text, e] of cases) {
  const r = P.parse(text, PUB), items = r.items, want = e.n == null ? [1] : [].concat(e.n), bad = [];
  cnt.n++; if (want.includes(items.length)) tot.n++; else bad.push(`条数 ${items.length}≠${want.join("/")}`);
  if (want.includes(1) && items.length >= 1) {
    const x = items[0];
    if (e.type) { cnt.type++; if (x.msg_type === e.type) tot.type++; else bad.push(`类型 ${x.msg_type}≠${e.type}`); }
    if (e.time !== null && e.time !== undefined) {
      const [wd, wt] = e.time.split(" "), [gd, gt] = String(x.event_time || "").split(" ");
      cnt.date++; if ((wd || "") === (gd || "")) tot.date++; else bad.push(`日期 ${gd || "无"}≠${wd || "无"}`);
      if (wt) { cnt.time++; if (gt === wt) tot.time++; else bad.push(`时间 ${gt || "无"}≠${wt}`); }
    }
    if (e.loc !== undefined) {
      cnt.loc++;
      const ok = e.loc === "" ? !x.location : norm(x.location).includes(norm(e.loc)) || (norm(e.loc).includes(norm(x.location)) && norm(x.location).length >= norm(e.loc).length - 2);
      if (ok) tot.loc++; else bad.push(`地点 「${x.location || ""}」≠「${e.loc}」`);
    }
    if (e.sub) { cnt.sub++; if (e.sub.some((k) => norm(x.subject).includes(norm(k)))) tot.sub++; else bad.push(`标题 「${x.subject}」 应含 ${e.sub.join("/")}`); }
  }
  if (bad.length) fails.push(text.replace(/\n/g, "⏎").slice(0, 50) + "\n    " + bad.join("；"));
}
const pct = (k) => cnt[k] ? Math.round(tot[k] / cnt[k] * 100) + "%" : "-";
const all = Object.keys(tot).reduce((a, k) => a + tot[k], 0), allc = Object.keys(cnt).reduce((a, k) => a + cnt[k], 0);
console.log(`条数 ${pct("n")}  类型 ${pct("type")}  日期 ${pct("date")}  时间 ${pct("time")}  地点 ${pct("loc")}  标题 ${pct("sub")}  · 总体 ${Math.round(all / allc * 100)}%（${cases.length} 条消息，${fails.length} 条有错）`);
if (V) for (const f of fails) console.log("✗ " + f);
module.exports = { score: all / allc, fails: fails.length };
