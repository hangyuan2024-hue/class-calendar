// 6.2 备忘录：我的事项里的「清单、重复、置顶、搜索」规则。网页、电脑版、小程序共用这一份（安卓 App 的 MemoCore.kt 是同一套规则）。
// 我的事项（personal_events_v1）里多了几个字段，和原来的字段一起同步，旧版本会原样保留不认识的字段：
//   list: [{ t: "买牛奶", d: true }]   清单（每一项可以单独勾）
//   rep:  "day" | "weekday" | "week" | "month" | "year"   重复：勾完成时自动排到下一次，不会消失
//   pin:  true   置顶：首页「接下来的安排」最上面一直显示
//   reps: 已经按时完成过几次（重复的事项用）
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MemoCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var keyOf = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var fromKey = function (k) { var p = String(k).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };

  // ---------- 重复 ----------
  var REPS = [["", "不重复"], ["day", "每天"], ["weekday", "工作日"], ["week", "每周"], ["month", "每月"], ["year", "每年"]];
  function repName(rep) { for (var i = 1; i < REPS.length; i++) if (REPS[i][0] === rep) return REPS[i][1]; return ""; }
  function nextDay(day, rep) {
    var d = fromKey(day), y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
    if (rep === "day") d.setDate(dd + 1);
    else if (rep === "weekday") { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    else if (rep === "week") d.setDate(dd + 7);
    else if (rep === "month" || rep === "year") {
      var ny = rep === "year" ? y + 1 : y + (m === 11 ? 1 : 0), nm = rep === "year" ? m : (m + 1) % 12;
      var last = new Date(ny, nm + 1, 0).getDate();   // 31 号 → 下个月没有 31 号就排到月底
      d = new Date(ny, nm, Math.min(dd, last));
    } else return "";
    return keyOf(d);
  }
  // 勾完成：重复的事项排到下一次（今天之后的第一次），清单清空重来；返回要合并进记录的字段，不重复的返回 null
  function complete(rec, today) {
    if (!rec || !rec.rep || !repName(rec.rep)) return null;
    var et = String(rec.event_time || ""), day = et.slice(0, 10), time = et.slice(11, 16);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    var n = nextDay(day, rec.rep), guard = 0;
    while (n && n <= today && guard++ < 800) n = nextDay(n, rec.rep);
    if (!n) return null;
    return { event_time: n + (time ? " " + time : ""), done: false, reps: (+rec.reps || 0) + 1,
      list: listOf(rec).map(function (x) { return { t: x.t, d: false }; }) };
  }

  // ---------- 清单 ----------
  var MARK_DONE = /^\s*(\[[xX✓√]\]|☑|✅|✓|√)\s*/, MARK_TODO = /^\s*(\[\s?\]|☐|□|○|[-*•·]|\d+[.、)）])\s*/;
  function listOf(rec) {
    var a = rec && Array.isArray(rec.list) ? rec.list : [];
    return a.filter(function (x) { return x && String(x.t || "").trim(); }).slice(0, 100).map(function (x) { return { t: String(x.t).trim().slice(0, 200), d: !!x.d }; });
  }
  // 编辑框里每行一项；行首写 ✓ / [x] 表示已经做完；原来勾过的同名项保留勾
  function listFromText(text, old) {
    var was = {}; (old || []).forEach(function (x) { if (x && x.d) was[String(x.t).trim()] = true; });
    var out = [];
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var d = MARK_DONE.test(line), t = line.replace(MARK_DONE, "").replace(MARK_TODO, "").trim();
      if (t && out.length < 100) out.push({ t: t.slice(0, 200), d: d || !!was[t] });
    });
    return out;
  }
  function listToText(list) { return (list || []).map(function (x) { return (x.d ? "✓ " : "") + x.t; }).join("\n"); }
  function listStat(rec) {
    var a = listOf(rec), d = a.filter(function (x) { return x.d; }).length;
    return { n: a.length, d: d, all: a.length > 0 && d === a.length, text: a.length ? d + "/" + a.length : "" };
  }
  function toggleItem(rec, i) {
    var a = listOf(rec);
    if (i < 0 || i >= a.length) return a;
    a[i].d = !a[i].d;
    return a;
  }
  // 手机备忘录粘贴过来的「□ xxx」多行：自动变成清单
  function looksLikeList(text) {
    var lines = String(text || "").split(/\r?\n/).filter(function (l) { return l.trim(); });
    return lines.length >= 2 && lines.filter(function (l) { return MARK_TODO.test(l) || MARK_DONE.test(l); }).length >= Math.ceil(lines.length * 0.6);
  }

  // ---------- 搜索 ----------
  function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, ""); }
  function hay(r) {
    return [r.subject, r.summary, r.note, r._note, r.location, r.prepare, r.original, r.msg_type, r.kind].concat(listOf(r).map(function (x) { return x.t; })).join(" ");
  }
  // 空格分开的几个词都要出现（不分大小写、不管空格）
  function match(r, q) {
    var words = String(q || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return false;
    var h = norm(hay(r));
    return words.every(function (w) { return h.indexOf(norm(w)) >= 0; });
  }
  // 命中的那一小段，给搜索结果当副标题
  function snippet(r, q, max) {
    max = max || 40;
    var w = String(q || "").trim().split(/\s+/)[0] || "";
    var srcs = [r.note || r._note, r.summary, listOf(r).map(function (x) { return x.t; }).join("；"), r.original, r.location];
    for (var i = 0; i < srcs.length; i++) {
      var s = String(srcs[i] || "").replace(/\s+/g, " "), at = s.toLowerCase().indexOf(w.toLowerCase());
      if (w && at >= 0) { var a = Math.max(0, at - 12); return (a > 0 ? "…" : "") + s.slice(a, a + max) + (a + max < s.length ? "…" : ""); }
    }
    return "";
  }

  // ---------- 置顶 ----------
  function pinned(list) { return (list || []).filter(function (r) { return r && r.pin && !r.done; }); }

  return { REPS: REPS, repName: repName, nextDay: nextDay, complete: complete,
    listOf: listOf, listFromText: listFromText, listToText: listToText, listStat: listStat, toggleItem: toggleItem, looksLikeList: looksLikeList,
    match: match, snippet: snippet, pinned: pinned, NOTE_MAX: 5000 };
});
