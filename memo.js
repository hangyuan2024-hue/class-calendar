/* =========================================================================
 * 捞捞课程表 · 导入手机备忘录（5.8.0）—— 网页和小程序共用这一份（小程序在 lib/memo.js）
 *   把备忘录里的文字拆成一条条事项：一行一条；认出日期、时间、勾选状态；
 *   「周三：」「10月20日」这种单独一行的日期，算作下面几行的日期。
 *   parse(text, today) → [{ subject, event_time, note, done, kind, src }]
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CCMemo = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var keyOf = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var addDays = function (d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
  var CN = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "十": 10 };
  function cnNum(s) {
    if (/^\d+$/.test(s)) return +s;
    if (s === "十") return 10;
    var m = /^([一二三四五六七八九两]?)十([一二三四五六七八九]?)$/.exec(s);
    if (m) return (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0);
    return s.length === 1 && CN[s] != null ? CN[s] : NaN;
  }
  var WD = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 0, "天": 0, "末": 6 };
  var NUM = "(\\d{1,2}|[一二三四五六七八九十两]{1,3})";

  // 找日期：返回 { day: Date, re: 匹配到的文字 } 或 null
  function findDate(t, today) {
    var m, y = today.getFullYear();
    if ((m = /(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})[日号]?/.exec(t))) return { day: new Date(+m[1], +m[2] - 1, +m[3]), re: m[0] };
    if ((m = new RegExp(NUM + "\\s*月\\s*" + NUM + "\\s*[日号]?").exec(t))) {
      var mo = cnNum(m[1]), d = cnNum(m[2]);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) { var dt = new Date(y, mo - 1, d); if (dt < addDays(today, -60)) dt = new Date(y + 1, mo - 1, d); return { day: dt, re: m[0] }; }
    }
    // 10.20 / 10/20（不要把 3.5 小时、版本号 1.2.3 当日期：前后不能紧挨数字或点）
    if ((m = /(^|[^\d.\/])(\d{1,2})[./](\d{1,2})(?![\d./])(?!\s*(?:小时|分钟|天|元|块|个|%|倍|斤|公里|米|km|kg|h\b|g\b))/i.exec(t))) {
      var mo2 = +m[2], d2 = +m[3];
      if (mo2 >= 1 && mo2 <= 12 && d2 >= 1 && d2 <= 31) { var dt2 = new Date(y, mo2 - 1, d2); if (dt2 < addDays(today, -60)) dt2 = new Date(y + 1, mo2 - 1, d2); return { day: dt2, re: m[0].slice(m[1].length) }; }
    }
    if ((m = /大后天/.exec(t))) return { day: addDays(today, 3), re: m[0] };
    if ((m = /后天/.exec(t))) return { day: addDays(today, 2), re: m[0] };
    if ((m = /明天|明日|明早|明晚/.exec(t))) return { day: addDays(today, 1), re: m[0] };
    if ((m = /今天|今日|今晚|今早/.exec(t))) return { day: today, re: m[0] };
    if ((m = /(下下|下|这|本)?\s*(?:周|星期|礼拜)([一二三四五六日天末])/.exec(t))) {
      var want = WD[m[2]], cur = today.getDay(), base = (want - cur + 7) % 7;
      var pre = m[1] || "";
      var nCur = (cur + 6) % 7, nWant = (want + 6) % 7;   // 周一 = 0
      var diff = nWant - nCur;
      if (pre === "下") diff += 7; else if (pre === "下下") diff += 14; else if (pre === "这" || pre === "本") { /* 本周 */ } else diff = base;
      return { day: addDays(today, diff), re: m[0] };
    }
    return null;
  }
  // 找时间：返回 { time: "HH:MM", re } 或 null
  function findTime(t) {
    var m, h, mi = 0;
    if ((m = /(上午|早上|早晨|中午|下午|傍晚|晚上|晚)?\s*(\d{1,2})[:：](\d{2})/.exec(t))) { h = +m[2]; mi = +m[3]; return fix(m[1], h, mi, m[0]); }
    if ((m = new RegExp("(上午|早上|早晨|中午|下午|傍晚|晚上|晚)?\\s*" + NUM + "\\s*[点時时](半|一刻|三刻|" + NUM + "\\s*分?)?").exec(t))) {
      h = cnNum(m[2]);
      if (m[3] === "半") mi = 30; else if (m[3] === "一刻") mi = 15; else if (m[3] === "三刻") mi = 45; else if (m[3]) mi = cnNum(m[4]);
      if (!isNaN(h) && !isNaN(mi)) return fix(m[1], h, mi, m[0]);
    }
    if ((m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t))) { h = +m[1]; mi = +(m[2] || 0); if (/pm/i.test(m[3]) && h < 12) h += 12; if (/am/i.test(m[3]) && h === 12) h = 0; return { time: pad(h) + ":" + pad(mi), re: m[0] }; }
    return null;
    function fix(p, hh, mm, re) {
      if (/下午|傍晚|晚/.test(p || "") && hh < 12) hh += 12;
      if (p === "中午" && hh < 6) hh += 12;
      if (hh > 23 || mm > 59) return null;
      return { time: pad(hh) + ":" + pad(mm), re: re };
    }
  }
  var BULLET = /^\s*(?:[-*•·◦●○▪▫■□☐☑✅✔✓√×✗]|\[\s?[xX✓ ]?\s?\]|\d{1,3}[.、)）](?!\d)|[（(]\d{1,3}[)）])\s*/;
  var DONE = /^\s*(?:[-*]?\s*\[[xX✓]\]|☑|✅|✔|✓|√)/;
  function cleanTitle(s) {
    return s.replace(/^[\s,，;；:：、\-–—]+|[\s,，;；:：、\-–—]+$/g, "").replace(/\s{2,}/g, " ");
  }

  function parse(text, today) {
    today = today ? new Date(today.getFullYear(), today.getMonth(), today.getDate()) : (function () { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); })();
    var lines = String(text || "").replace(/\r/g, "").split("\n");
    var out = [], ctx = null, seen = {};
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (!raw.trim()) { ctx = null; continue; }   // 空一行：上面那个日期标题就不管下面了
      var done = DONE.test(raw);
      var t = raw;
      for (var b = 0; b < 3 && BULLET.test(t); b++) t = t.replace(BULLET, "");
      t = t.trim();
      if (!t) continue;
      var dm = findDate(t, today), tm = findTime(t);
      var rest = t;
      if (tm) rest = rest.replace(tm.re, " ");
      if (dm) rest = rest.indexOf(dm.re) >= 0 ? rest.replace(dm.re, " ") : rest.replace(/(^|\s)[明今]\s/, " ");   // 「明晚8点」：时间先拿走了「晚8点」，剩下的「明」也去掉
      rest = cleanTitle(rest.replace(/[（(]\s*[)）]/g, "").replace(/^\s*(之前|以前|前)(?=\S)/, ""));
      // 只有日期的一行（「周三：」「10月20日」）：下面几行都算这一天
      if (dm && (!rest || /^(要做的|待办|安排|计划|事项|todo)$/i.test(rest))) { ctx = { day: dm.day, time: tm ? tm.time : "" }; continue; }
      // 「## 标题」「【学习】」这种分组标题：不当事项
      if (/^#{1,6}\s/.test(raw.trim()) || /^【[^】]{1,12}】$/.test(t) || (/[:：]$/.test(t) && !dm && t.length <= 12)) { ctx = null; continue; }
      var day = dm ? dm.day : ctx ? ctx.day : null;
      var time = tm ? tm.time : (!dm && ctx ? ctx.time : "");
      var subject = rest || t;
      var note = "";
      if (subject.length > 40) { note = subject; subject = subject.slice(0, 30) + "…"; }
      var sig = subject + "|" + (day ? keyOf(day) : "");
      if (seen[sig]) continue;
      seen[sig] = 1;
      out.push({
        subject: subject, note: note, done: done, src: t,
        event_time: day ? keyOf(day) + (time ? " " + time : "") : "",
        kind: /作业|习题|练习册|报告|论文|提交|交到|上交|ddl|截止/i.test(t) ? "作业" : undefined,
      });
      if (out.length >= 300) break;
    }
    return out;
  }
  return { parse: parse, findDate: findDate, findTime: findTime };
});
