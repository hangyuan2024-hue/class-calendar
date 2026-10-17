/* =========================================================================
 * 捞捞课程表 · 「下次上课前」和作业分组（5.9.0）—— 网页和小程序共用这一份（小程序在 lib/nextclass.js）
 *   交作业最常见的截止时间是「下次上这门课之前」：按课程表算出那门课下一次上课的日期和时间。
 *   match(text, names)          「数学作业」→「高等数学」（课名里有两个字以上对得上）
 *   nextOf(name, ctx)           这门课下一次上课 { name, day: "2026-10-20", time: "08:00" }
 *   choices(text, ctx, max)     截止时间候选：对得上的那门课排第一，其它按时间先后
 *   resolve(text, ctx)          一句话里写了「下节课前 / 下次上课前」→ 那门课下次上课
 *   strip(text)                 去掉「下节课前」这几个字（当标题用）
 *   groups(list, today, now)    作业按截止时间分组：已过期 / 今天 / 明天 / 这周 / 下周 / 以后 / 时间待定
 *   ctx = { names: [课名], coursesOn: function (dayKey) → [{ name, t0 }], now: Date（北京钟面） }
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CCNext = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var WEEK = ["日", "一", "二", "三", "四", "五", "六"];
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var keyOf = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var dateOf = function (k) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(k || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  var addDays = function (k, n) { var d = dateOf(k); d.setDate(d.getDate() + n); return keyOf(d); };
  var diff = function (k, base) { return Math.round((dateOf(k) - dateOf(base)) / 86400000); };
  var hm2min = function (t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };

  // 「今天 / 明天 / 后天 / 周三 / 下周三 / 10月20日」
  function dayName(k, now) {
    var t = keyOf(now), n = diff(k, t), d = dateOf(k);
    if (n === 0) return "今天"; if (n === 1) return "明天"; if (n === 2) return "后天";
    var mon = addDays(t, -((now.getDay() + 6) % 7)), w = Math.floor(diff(k, mon) / 7);
    if (w === 0 && n > 0) return "周" + WEEK[d.getDay()];
    if (w === 1) return "下周" + WEEK[d.getDay()];
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }

  var STRIP = /作业|练习|习题|报告|预习|复习|课前|上课|下次|下节|交/g;
  function common(a, b) {
    var best = 0;
    for (var i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) {
      var k = 0; while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k] && !/\s/.test(a[i + k])) k++;
      if (k > best) best = k;
    }
    return best;
  }
  // 简称：「线代」→「线性代数」、「高数」→「高等数学」（第一个字一样，后面的字按顺序出现在课名里）
  function abbr(tx, core) {
    var best = 0;
    for (var i = 0; i < tx.length; i++) {
      if (tx[i] !== core[0]) continue;
      for (var len = 2; len <= 4 && i + len <= tx.length; len++) {
        var sub = tx.slice(i, i + len), p = 0;
        if (/\s/.test(sub)) break;
        for (var j = 0; j < core.length && p < sub.length; j++) if (core[j] === sub[p]) p++;
        if (p === sub.length && len > best) best = len;
      }
    }
    return best ? best + 0.5 : 0;
  }
  function match(text, names) {
    var tx = String(text || "").replace(STRIP, " "), best = null, score = 1;
    (names || []).forEach(function (n) {
      var core = String(n).replace(/[（(].*?[)）]|[A-Za-z0-9ⅠⅡⅢⅣ]+$/g, "").trim();
      var sc = core.length >= 2 && tx.indexOf(core) >= 0 ? 100 + core.length : Math.max(common(tx, core), abbr(tx, core));
      if (sc > score) { score = sc; best = n; }
    });
    return best;
  }
  function nextOf(name, ctx) {
    var now = ctx.now || new Date(), t = keyOf(now), nowMin = now.getHours() * 60 + now.getMinutes();
    for (var i = 0; i <= 14; i++) {
      var k = addDays(t, i), best = null;
      (ctx.coursesOn(k) || []).forEach(function (c) {
        var m = hm2min(c.t0);
        if (c.name !== name || m == null || (i === 0 && m <= nowMin)) return;
        if (!best || m < hm2min(best.t0)) best = c;
      });
      if (best) return { name: name, day: k, time: best.t0, text: dayName(k, now) + " " + best.t0 };
    }
    return null;
  }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function choices(text, ctx, max) {
    var names = uniq(ctx.names || []), m = match(text, names);
    var all = names.map(function (n) { return nextOf(n, ctx); }).filter(Boolean).sort(function (a, b) { return (a.day + a.time).localeCompare(b.day + b.time); });
    return all.filter(function (x) { return x.name === m; }).concat(all.filter(function (x) { return x.name !== m; })).slice(0, max || 6);
  }
  var NEXT_RE = /下(节|次|一节|一次)(课|上课)?(前|之前|以前)?|(上课|课)(前|之前)|下节|下次课/;
  function resolve(text, ctx) {
    if (!NEXT_RE.test(text || "")) return null;
    var m = match(text, uniq(ctx.names || []));
    return m ? nextOf(m, ctx) : null;
  }
  function strip(s) { return String(s || "").replace(new RegExp(NEXT_RE.source, "g"), " ").replace(/\s+/g, " ").replace(/^[\s,，:：]+|[\s,，:：]+$/g, "").trim(); }

  // 作业按截止时间分组。item 要有 day（"2026-10-20" 或 ""）、time、done、at（截止时刻毫秒，可选）
  function groups(list, now) {
    var t = keyOf(now), tm = addDays(t, 1), mon = addDays(t, -((now.getDay() + 6) % 7)), sun = addDays(mon, 6), nsun = addDays(sun, 7);
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var md = function (k) { var d = dateOf(k); return (d.getMonth() + 1) + "月" + d.getDate() + "日"; };
    var todo = list.filter(function (r) { return !r.done && (!r.day || diff(r.day, t) >= -30); });
    var late = function (r) { return r.day < t || (r.day === t && hm2min(r.time) != null && hm2min(r.time) < nowMin); };
    var by = function (a, b) { return (a.day + (a.time || "99")).localeCompare(b.day + (b.time || "99")); };
    var G = [
      ["late", "已过期", "还没做完的", function (r) { return late(r); }],
      ["today", "今天截止", md(t) + " 周" + WEEK[dateOf(t).getDay()], function (r) { return r.day === t && !late(r); }],
      ["tomorrow", "明天截止", md(tm) + " 周" + WEEK[dateOf(tm).getDay()], function (r) { return r.day === tm; }],
      ["week", "这周", "到 " + md(sun) + " 周日", function (r) { return r.day > tm && r.day <= sun; }],
      ["next", "下周", md(addDays(sun, 1)) + " – " + md(nsun), function (r) { return r.day > sun && r.day <= nsun; }],
      ["later", "以后", "下周之后", function (r) { return r.day > nsun; }],
    ];
    var out = [];
    G.forEach(function (g) {
      var l = todo.filter(function (r) { return r.day && g[3](r); }).sort(by);
      if (l.length) out.push({ key: g[0], title: g[1], sub: g[2], items: l });
    });
    var und = todo.filter(function (r) { return !r.day; });
    if (und.length) out.push({ key: "undated", title: "时间待定", sub: "去群里核实一下截止时间", items: und });
    return out;
  }

  return { match: match, nextOf: nextOf, choices: choices, resolve: resolve, strip: strip, groups: groups, dayName: dayName, NEXT_RE: NEXT_RE };
});
