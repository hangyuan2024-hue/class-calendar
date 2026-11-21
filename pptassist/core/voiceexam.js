// 捞捞 · 声音自动考试（不用人听）：合成一句 → 本机听写回来 → 和原文比
//   · 错字率：去掉数字和标点后逐字比（编辑距离 ÷ 字数），多音字、术语念错了听写回来就对不上
//   · 数字念对没有：原文里的每个数，听写回来的文字里要能找到（「302」「三零二」「三百零二」都算）
//   不看声音好不好听（那一项以后用自然度打分模型），先把「念得对不对」管住
"use strict";
const SENTENCES = [
  "你好，我是捞小智，很高兴见到你。",
  "明天上午第 3 节课在 302 教室，别迟到。",
  "银行的行长今天在行政楼开会。",
  "重庆的天气和重新开始是两回事。",
  "二分查找每次把查找范围缩小一半。",
  "请假三天以内由学院副书记批准。",
  "冒泡排序的时间复杂度是 n 的平方。",
  "期末考试在 2027 年 1 月 12 日举行。",
];
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }, UNIT = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
function cnNum(s) { let total = 0, sec = 0, num = 0; for (const ch of s) { if (ch in CN) num = CN[ch]; else if (ch in UNIT) { const u = UNIT[ch]; if (u === 10000) { total += (sec + num) * u; sec = 0; num = 0; } else { sec += (num || 1) * u; num = 0; } } } return total + sec + num; }
// 一句话里的数：阿拉伯数字原样；中文数字既算数值，也算一位一位念的写法（「三零二」= 302）
function numbersIn(s) {
  const out = new Set();
  for (const m of String(s).matchAll(/\d+/g)) out.add(String(+m[0]));
  for (const m of String(s).matchAll(/[零〇一二两三四五六七八九十百千万]+/g)) {
    const w = m[0];
    out.add(String(cnNum(w)));
    if (!/[十百千万]/.test(w)) out.add(String(+[...w].map((c) => CN[c]).join("")));
  }
  return out;
}
const strip = (s) => String(s).replace(/[\d零〇一二两三四五六七八九十百千万]+/g, "").replace(/[^一-鿿a-zA-Z]/g, "").toLowerCase();
function dist(a, b) { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; }

// o.synth(text) → wav Buffer；o.hear(wav) → 文字；o.say(text) → 合成时真正念的文字（数字念法处理过的；不给就用原文）
async function run(o) {
  const items = [];
  for (const t of o.sentences || SENTENCES) {
    const said = o.say ? o.say(t) : t;
    let heard = "", err = null;
    try { heard = await o.hear(await o.synth(t)); } catch (e) { err = e.message; }
    const a = strip(said), b = strip(heard), cer = a.length ? Math.min(1, dist(a, b) / a.length) : 0;
    const want = [...String(t).matchAll(/\d+/g)].map((m) => String(+m[0])), got = numbersIn(heard);
    const numOk = want.every((n) => got.has(n));
    items.push({ text: t, heard, cer: Math.round(cer * 1000) / 1000, nums: want.length ? numOk : null, ...(err ? { error: err } : {}) });
  }
  const ok = items.filter((x) => !x.error), numbered = ok.filter((x) => x.nums != null);
  return { total: items.length, cer: ok.length ? Math.round((ok.reduce((a, x) => a + x.cer, 0) / ok.length) * 1000) / 1000 : 1,
    numOk: numbered.length ? Math.round((numbered.filter((x) => x.nums).length / numbered.length) * 1000) / 1000 : null, failed: items.length - ok.length, items };
}
module.exports = { run, SENTENCES, numbersIn, cnNum, dist };
