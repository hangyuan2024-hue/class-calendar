// 捞捞教练（5.9.3）：在本机学你的节奏，推荐「现在最适合做的事」、定一个够得着的小目标、挑合适的时间提醒、每周复盘。
// 网页、微信小程序、电脑版共用这一份；安卓 App 是同一套规则的 Kotlin 版（core/Coach.kt），测试用同样的例子。
//
// 隐私：
//   · 原始记录（哪天几点完成了哪件事）只存在这台设备（coach_log_v1），最多留 60 天，不上传；
//   · 跟着账号同步的只有统计数字（coach_v1，每台设备一条）：每个小时 / 星期几的活跃度、每天的有效完成数、
//     作业提前多久做完、哪种提示对你有用。没有标题、没有内容；
//   · 用户在设置里随时可以关掉教练、一键清空（本机 + 云端）。
// 防「假完成」：一口气连着勾很多、勾了又马上取消、把过期很久的一次性勾掉——这些只算一部分或不算，
//   连续天数、每日小目标只看「可信的」完成（番茄钟是真的计时，最可信）。不指责，只是不算进去。
// 健康：深夜不推任务（劝睡觉）；连着专注了很久会劝休息；小目标按你最近的水平只往上加一点点。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.CoachCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var DAY = 86400000, H = 3600000, MIN = 60000;
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var keyOf = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var fromKey = function (k) { var p = String(k).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var addDays = function (k, n) { var d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  var EXAM = /考试|测验|测试|小测|期中|期末|月考|考核|答辩/;
  var STYLES = ["step", "deadline", "streak", "progress"];
  var LOG_DAYS = 60;

  // ---------- 1. 可信度：每条「完成」算几分 ----------
  // log：[{ t 毫秒, e: done|undo|pomo|habit|open|show|acc|skip, k 事项, y 类型, d 截止毫秒, m 分钟, s 提示风格 }]
  function credible(log) {
    var out = [], sorted = (log || []).slice().sort(function (a, b) { return a.t - b.t; });
    for (var i = 0; i < sorted.length; i++) {
      var x = sorted[i];
      if (x.e === "pomo") { out.push({ t: x.t, k: x.k || "", y: "pomo", w: (x.m || 0) >= 10 ? Math.min(2, (x.m || 25) / 25) : 0, d: 0, m: x.m || 0 }); continue; }
      if (x.e === "habit") { out.push({ t: x.t, k: x.k || "", y: "habit", w: 0.5, d: 0 }); continue; }
      if (x.e !== "done") continue;
      var w = 1, why = "";
      // 勾了又在 30 分钟内取消：不算
      for (var j = i + 1; j < sorted.length && sorted[j].t - x.t <= 30 * MIN; j++) if (sorted[j].e === "undo" && sorted[j].k === x.k) { w = 0; why = "undo"; break; }
      // 过期一周以上才勾（多半是在清理）：算一半
      if (w && x.d && x.t - x.d > 7 * DAY) { w = 0.5; why = "late"; }
      out.push({ t: x.t, k: x.k || "", y: x.y || "", w: w, d: x.d || 0, why: why });
    }
    // 一口气连着勾：90 秒里勾了 4 件以上，前 2 件照算，后面的每件只算 0.3
    var dones = out.filter(function (r) { return r.y !== "pomo" && r.y !== "habit" && r.w > 0; });
    for (var a = 0; a < dones.length; a++) {
      var n = 0;
      for (var b = a; b < dones.length && dones[b].t - dones[a].t <= 90000; b++) n++;
      if (n >= 4) for (var c = a + 2; c < a + n; c++) if (dones[c].w > 0.3) { dones[c].w = 0.3; dones[c].why = "burst"; }
    }
    return out;
  }

  // ---------- 2. 学习：这台设备的统计数字（只有数字，会同步） ----------
  function learn(log, now) {
    var t = keyOf(now), cut = now.getTime() - LOG_DAYS * DAY;
    var m = { v: 1, at: now.getTime(), h: zeros(24), w: zeros(7), day: {}, lead: [], sty: {}, sus: 0, n: 0 };
    var cr = credible((log || []).filter(function (x) { return x.t >= cut; }));
    cr.forEach(function (r) {
      var d = new Date(r.t), age = (now.getTime() - r.t) / DAY, decay = Math.pow(0.97, Math.max(0, age));
      if (r.why === "burst" || r.why === "undo") { if (age <= 14) m.sus++; }
      if (r.w <= 0) return;
      m.h[d.getHours()] += r.w * decay; m.w[d.getDay()] += r.w * decay; m.n += r.w;
      var k = keyOf(d); if (k >= addDays(t, -27)) m.day[k] = round1((m.day[k] || 0) + r.w);
      // 作业提前多少小时做完（负数 = 拖过了截止）
      if (r.y === "作业" && r.d && r.w >= 1 && age <= 30) m.lead.push(round1((r.d - r.t) / H));
    });
    (log || []).forEach(function (x) {
      if (x.t < cut || !x.s || STYLES.indexOf(x.s) < 0) return;
      var s = m.sty[x.s] || (m.sty[x.s] = [0, 0]);
      if (x.e === "show") s[0]++; else if (x.e === "acc") s[1]++;
    });
    m.h = m.h.map(round1); m.w = m.w.map(round1); m.lead = m.lead.slice(-30);
    return m;
  }
  // 几台设备的统计合在一起（同一个账号的网页、手机、电脑）
  function combine(models) {
    var out = { v: 1, h: zeros(24), w: zeros(7), day: {}, lead: [], sty: {}, sus: 0, n: 0 };
    (models || []).forEach(function (m) {
      if (!m || m.v !== 1) return;
      for (var i = 0; i < 24; i++) out.h[i] += +(m.h && m.h[i]) || 0;
      for (var j = 0; j < 7; j++) out.w[j] += +(m.w && m.w[j]) || 0;
      for (var k in m.day || {}) out.day[k] = round1((out.day[k] || 0) + (+m.day[k] || 0));
      out.lead = out.lead.concat(m.lead || []);
      for (var s in m.sty || {}) { var a = out.sty[s] || (out.sty[s] = [0, 0]); a[0] += m.sty[s][0] || 0; a[1] += m.sty[s][1] || 0; }
      out.sus += m.sus || 0; out.n += m.n || 0;
    });
    return out;
  }

  // ---------- 3. 连续天数、每日小目标 ----------
  function streak(model, now) {
    var t = keyOf(now), day = (model && model.day) || {}, n = 0, k = (day[t] || 0) >= 1 ? t : addDays(t, -1);
    while ((day[k] || 0) >= 1 && n < 400) { n++; k = addDays(k, -1); }
    return { days: n, today: day[t] || 0, atRisk: n >= 2 && (day[t] || 0) < 1 && now.getHours() >= 19 };
  }
  // 最近 14 天里有活动的日子，每天有效完成数的中位数 × 1.1，至少 2、最多 8
  function goal(model, now) {
    var t = keyOf(now), day = (model && model.day) || {}, xs = [];
    for (var i = 1; i <= 14; i++) { var v = day[addDays(t, -i)] || 0; if (v > 0) xs.push(v); }
    var cap = xs.length >= 3 ? median(xs) : 2.5;   // 刚开始用：先定 3 件
    var target = Math.max(2, Math.min(8, Math.ceil(cap * 1.1)));
    return { target: target, done: round1(day[t] || 0), cap: round1(cap), met: (day[t] || 0) >= target };
  }
  function bestHours(model) {
    var h = (model && model.h) || zeros(24), idx = [];
    for (var i = 7; i <= 23; i++) idx.push(i);
    idx.sort(function (a, b) { return h[b] - h[a]; });
    var total = h.reduce(function (s, x) { return s + x; }, 0);
    return total < 5 ? [] : idx.slice(0, 2).filter(function (i) { return h[i] > 0; });
  }

  // ---------- 4. 选一种说法：哪种提示对你最管用（越用越准） ----------
  function pickStyle(model, cands, rnd) {
    cands = cands && cands.length ? cands : STYLES;
    var sty = (model && model.sty) || {};
    if ((rnd == null ? Math.random() : rnd) < 0.15) return cands[Math.floor(((rnd == null ? Math.random() : rnd) * 100) % cands.length)];   // 偶尔试试别的说法
    var best = cands[0], bv = -1;
    cands.forEach(function (s) { var a = sty[s] || [0, 0], v = (a[1] + 1) / (a[0] + 2); if (v > bv) { bv = v; best = s; } });
    return best;
  }

  // ---------- 5. 现在最适合做什么 ----------
  // ctx：{ now, ranked（IslandCore.rank 的结果）, model（combine 后的）, log, pomoToday, skip: {key: 到期毫秒}, rnd }
  function suggest(ctx) {
    var now = ctx.now, h = now.getHours(), mm = now.getMinutes(), model = ctx.model || combine([]);
    var st = streak(model, now), g = goal(model, now), best = bestHours(model);
    var night = h >= 23 || h < 5, late = h >= 22;
    var recent = credible(ctx.log || []).filter(function (r) { return r.y === "pomo" && now.getTime() - r.t < 2 * H; });
    var focusMin = recent.reduce(function (s, r) { return s + (r.m || 25); }, 0);
    var skip = ctx.skip || {};
    var base = { streak: st, goal: g, best: best, sus: model.sus || 0 };
    // 正在上课
    var live = (ctx.ranked || []).filter(function (x) { return x.kind === "course" && x.level === "now"; })[0];
    if (live) return mix(base, { mode: "class", top: { kind: "course", key: live.key, title: live.title, reason: live.reason, step: "专心听讲，有作业记得随手记下来" }, say: "正在上「" + live.title + "」，手机先放一放 📚" });
    // 深夜：只有真的急（已过期 / 几小时内截止）才提，否则劝睡觉
    var cands = (ctx.ranked || []).filter(function (x) {
      if (x.kind !== "item" || x.level === "past") return false;
      if (skip[x.key] && skip[x.key] > now.getTime()) return false;
      return true;
    });
    if (night && !cands.some(function (x) { return x.level === "late" || x.level === "urgent"; })) {
      return mix(base, { mode: "sleep", top: null, say: st.today >= 1 ? "今天已经完成 " + fmt(st.today) + " 件，够了！早点睡，明天接着来 🌙" : "夜深了，明天再做，睡饱了效率更高 🌙" });
    }
    // 连着专注 75 分钟以上：劝休息
    if (focusMin >= 75 && !cands.some(function (x) { return x.level === "late" || x.level === "now"; })) {
      return mix(base, { mode: "rest", top: null, say: "已经专注 " + focusMin + " 分钟了，起来走走、喝口水，10 分钟后再继续 🍵" });
    }
    if (!cands.length) {
      var idle = g.met ? "今天的小目标完成了 🎉 剩下的时间留给自己" : "手头没有要赶的事，来一个番茄，预习或者复习一下？";
      return mix(base, { mode: "free", top: { kind: "pomo", key: "pomo", title: "专注 25 分钟", reason: "没有急事的时候最适合提前学", step: "挑一门最近吃力的课，复习 25 分钟" }, say: idle });
    }
    // 打分：本来的紧急程度 × 这个钟点你的状态；深夜只要短平快的
    var maxH = Math.max.apply(null, model.h.slice(7, 24).concat([0.0001]));
    var fit = model.n >= 8 ? 0.8 + 0.4 * (model.h[h] || 0) / maxH : 1;
    var scored = cands.map(function (x) {
      var s = x.score * fit;
      if (late && !(x.level === "late" || x.level === "urgent")) s *= 0.4;
      if (x.exam) s *= 1.1;
      return { x: x, s: s };
    }).sort(function (a, b) { return b.s - a.s; });
    var top = scored[0].x;
    // 说法：按哪种提示对你有用来选
    var styles = ["step"];
    if (top.level === "late" || top.level === "urgent") styles.push("deadline");
    if (st.days >= 2) styles.push("streak");
    if (g.done > 0 && !g.met) styles.push("progress");
    var style = pickStyle(model, styles, ctx.rnd);
    var reason = top.reason || "";
    var say = sayFor(style, top, st, g, best, h);
    return mix(base, {
      mode: "go", style: style,
      top: { kind: "item", key: top.key, title: top.title, type: top.type, reason: reason, step: stepFor(top), level: top.level },
      alts: scored.slice(1, 3).map(function (a) { return { key: a.x.key, title: a.x.title, reason: a.x.reason }; }),
      say: say,
    });
  }
  function stepFor(x) {
    if (x.exam) return "先花 15 分钟把重点过一遍";
    if (x.type === "作业") return x.level === "late" ? "先补上最简单的那部分，开个番茄 25 分钟" : "先做 25 分钟，开个番茄，做多少算多少";
    if (x.type === "会议" || x.type === "活动") return x.level === "now" ? "已经开始了，现在过去" : "提前把要带的东西准备好" + (x.location ? "，地点 " + x.location : "");
    return "现在花 5 分钟处理掉它";
  }
  function sayFor(style, x, st, g, best, h) {
    var name = "「" + x.title + "」";
    if (style === "deadline") return x.level === "late" ? name + "已经过期了，现在补上还来得及 💪" : name + x.reason + "，先把它拿下！";
    if (style === "streak") return "已经连续 " + st.days + " 天了 🔥 今天做完" + name + "就能续上";
    if (style === "progress") return "今天完成 " + fmt(g.done) + "/" + g.target + "，再做" + name + "就更近一步";
    if (best.length && best.indexOf(h) >= 0) return "这个点通常是你状态最好的时候，先做" + name;
    return "一次只做一件：先把" + name + "拿下";
  }

  // ---------- 6. 今天什么时候提醒（每天最多 3 条，避开 23:00–7:00、避开上课） ----------
  // 返回 [{ at 毫秒, kind, title, body }]；调用方到点前再确认一下还要不要发（比如已经完成了就不发）
  function nudges(ctx) {
    var now = ctx.now, t = keyOf(now), model = ctx.model || combine([]), out = [];
    var st = streak(model, now), g = goal(model, now), best = bestHours(model);
    var at = function (hh, mi) { var d = fromKey(t); d.setHours(hh, mi || 0, 0, 0); return d.getTime(); };
    var busy = function (ms) { return (ctx.courses || []).some(function (c) { var a = hm(c.t0), b = hm(c.t1 || c.t0); var m = new Date(ms).getHours() * 60 + new Date(ms).getMinutes(); return a != null && b != null && m >= a - 5 && m < b; }); };
    var pending = (ctx.ranked || []).filter(function (x) { return x.kind === "item" && x.level !== "past"; });
    // ① 你效率最高的那个钟点（今天还没到、还有事要做、今天的小目标还没完成）
    best.forEach(function (bh) {
      var ms = at(bh, 0);
      if (out.length || ms <= now.getTime() + 10 * MIN || bh >= 23 || bh < 7 || !pending.length || g.met || busy(ms)) return;
      out.push({ at: ms, kind: "best", title: "现在是你状态最好的时候", body: "先做「" + pending[0].title + "」吧，开个番茄 25 分钟" });
    });
    // ② 连续天数快断了（20:30 还没有可信的完成）
    if (st.days >= 2 && st.today < 1 && now.getTime() < at(20, 30)) out.push({ at: at(20, 30), kind: "streak", title: "🔥 连续 " + st.days + " 天，今天还差一点", body: "做完一件事或者专注一个番茄，就能续上" });
    // ③ 周日晚上：这周的复盘
    if (now.getDay() === 0 && now.getTime() < at(20, 0)) out.push({ at: at(20, 0), kind: "weekly", title: "📊 这周的复盘出来了", body: "看看这周进步在哪，定一下下周的小目标" });
    return out.filter(function (x) { var hh = new Date(x.at).getHours(); return hh >= 7 && hh < 23; }).slice(0, 3);
  }

  // ---------- 7. 每周复盘 ----------
  function weekly(model, now) {
    var t = keyOf(now), mon = addDays(t, -((now.getDay() + 6) % 7)), day = (model && model.day) || {};
    var sum = function (a, n) { var s = 0, d = 0; for (var i = 0; i < n; i++) { var v = day[addDays(a, i)] || 0; s += v; if (v >= 1) d++; } return { done: round1(s), days: d }; };
    var thisW = sum(mon, 7), lastW = sum(addDays(mon, -7), 7);
    var best = bestHours(model), lead = (model && model.lead) || [];
    var leadMed = lead.length >= 3 ? median(lead) : null;
    var hi = [], next = [];
    if (thisW.done > lastW.done) hi.push("比上周多完成了 " + fmt(round1(thisW.done - lastW.done)) + " 件 👏");
    else if (lastW.done > 0) hi.push("这周完成 " + fmt(thisW.done) + " 件，上周 " + fmt(lastW.done) + " 件，下周加把劲");
    if (thisW.days >= 5) hi.push("这周有 " + thisW.days + " 天都在坚持，很自律！");
    var st = streak(model, now); if (st.days >= 3) hi.push("连续 " + st.days + " 天 🔥");
    if (best.length) next.push("把最难的事放在 " + best[0] + ":00 左右做，那是你状态最好的时候");
    if (leadMed != null) next.push(leadMed < 3 ? "作业常常拖到最后几个小时才做完，下周试试提前一天开始" : "作业平均提前 " + Math.round(leadMed) + " 小时做完，保持！");
    if ((model && model.sus) > 3) next.push("有几次一口气勾了很多件，捞捞没全算进去；做完一件勾一件，记录才准");
    var g = goal(model, now);
    next.push("下周每天的小目标：" + g.target + " 件");
    return { thisWeek: thisW, lastWeek: lastW, best: best, lead: leadMed, highlights: hi, next: next, streak: st.days };
  }

  // ---------- 小工具 ----------
  function zeros(n) { var a = []; for (var i = 0; i < n; i++) a.push(0); return a; }
  function round1(x) { return Math.round(x * 10) / 10; }
  function median(xs) { var s = xs.slice().sort(function (a, b) { return a - b; }), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function fmt(x) { return String(Math.round(x * 10) / 10); }
  function hm(s) { var m = /^(\d{1,2}):(\d{2})/.exec(s || ""); return m ? +m[1] * 60 + +m[2] : null; }
  function mix(a, b) { var o = {}; for (var k in a) o[k] = a[k]; for (var j in b) o[j] = b[j]; return o; }
  // 本机记录：加一条、只留 60 天、最多 3000 条
  function append(log, ev, nowMs) {
    var cut = nowMs - LOG_DAYS * DAY, out = (log || []).filter(function (x) { return x && x.t >= cut; });
    out.push(ev);
    return out.length > 3000 ? out.slice(out.length - 3000) : out;
  }
  return { credible: credible, learn: learn, combine: combine, streak: streak, goal: goal, bestHours: bestHours, pickStyle: pickStyle,
    suggest: suggest, nudges: nudges, weekly: weekly, append: append, STYLES: STYLES, LOG: "coach_log_v1", SYNC: "coach_v1", OPTS: "coach_opts_v1" };
});
