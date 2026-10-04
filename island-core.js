// 捞捞岛的「大脑」：智能排序 + 不联网的问答。网页、微信小程序、电脑版共用这一份（同样的输入，到哪都是同样的结果）。
// 只做计算，不碰页面：调用的地方把事项、课程、打卡这些数据整理好传进来。
//
// 智能排序：不是简单按时间排——离截止越近越靠前，作业、考试比通知重要，过期没交的放最前面提醒；
//   快开始的课、正在上的课也会排进来；「待核实」的稍微往前提一点，提醒去群里确认。
// 问答：手机上不能跑大模型，所以按「意图」来回答——听懂「明天有什么课」「这周作业」「最急的是什么」
//   「下节课在哪」「我打了几次卡」这类问题，直接从自己的数据里查出来。电脑上有 AI 时，听不懂的再交给 AI。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.IslandCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var WEEK = ["日", "一", "二", "三", "四", "五", "六"];
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var keyOf = function (d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
  var fromKey = function (k) { var p = String(k).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); };
  var addDays = function (k, n) { var d = fromKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
  var hm = function (d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  var dayDiff = function (a, b) { return Math.round((fromKey(a) - fromKey(b)) / 86400000); };
  var EXAM = /考试|测验|测试|小测|期中|期末|月考|考核|答辩/;

  // ---------- 说日子 ----------
  function dayName(k, now) {
    var t = keyOf(now), n = dayDiff(k, t), d = fromKey(k);
    if (n === 0) return "今天";
    if (n === 1) return "明天";
    if (n === 2) return "后天";
    if (n === -1) return "昨天";
    var wd = "周" + WEEK[d.getDay()];
    var monThis = addDays(t, -((now.getDay() + 6) % 7));
    var diffW = Math.floor(dayDiff(k, monThis) / 7);
    if (diffW === 0) return wd;
    if (diffW === 1) return "下" + wd;
    if (diffW === -1) return "上" + wd;
    return (d.getMonth() + 1) + "月" + d.getDate() + "日";
  }
  function whenText(day, time, now) {
    return day ? dayName(day, now) + (time ? " " + time : "") : "时间待定";
  }
  // 还有多久（给排序后的每一条一个提示）
  function leftText(mins) {
    if (mins < 0) {
      var late = -mins;
      if (late < 60) return "刚过 " + Math.max(1, Math.round(late)) + " 分钟";
      if (late < 1440) return "已过 " + Math.round(late / 60) + " 小时";
      return "过期 " + Math.floor(late / 1440) + " 天";
    }
    if (mins < 60) return "还剩 " + Math.max(1, Math.round(mins)) + " 分钟";
    if (mins < 1440) return "还剩 " + Math.round(mins / 60) + " 小时";
    return "还剩 " + Math.round(mins / 1440) + " 天";
  }

  // ---------- 智能排序 ----------
  // items：[{ key, title, type, day, time, location, done, needConfirm, mine, summary }]
  // courses：今天、明天的课 [{ name, day, t0, t1, location, start, end }]
  function weightOf(it) {
    var text = (it.title || "") + " " + (it.summary || "");
    if (EXAM.test(text)) return 1.7;
    return { "作业": 1.45, "会议": 1.15, "活动": 1.0, "通知": 0.8, "个人": 1.05 }[it.type] || 1;
  }
  function rank(items, courses, now, opts) {
    opts = opts || {};
    var out = [], t = keyOf(now), nowMin = now.getTime() / 60000;
    (items || []).forEach(function (it) {
      if (!it || it.done) return;
      var w = weightOf(it), score, mins = null, level = "normal", reason;
      if (!it.day) { score = 4 * w; reason = "没定日子"; }
      else {
        var due = fromKey(it.day);
        if (it.time) { var p = it.time.split(":"); due.setHours(+p[0], +p[1]); } else due.setHours(23, 59);
        mins = due.getTime() / 60000 - nowMin;
        var hours = mins / 60;
        if (mins < 0) {
          if (dayDiff(t, it.day) > (opts.lateDays || 7)) return;   // 过期太久的不再提醒
          score = (it.type === "作业" ? 150 : 60) - Math.min(-hours / 24, 7) * 8;
          level = it.type === "作业" ? "late" : "past";
        } else {
          score = 100 / (1 + hours / 12);
          level = hours <= 6 ? "urgent" : hours <= 48 ? "soon" : "normal";
        }
        score *= w;
        if (it.type !== "作业" && mins < -120) score *= 0.2;      // 开完的会、过去的活动：基本不用管了
        reason = leftText(mins);
      }
      if (it.needConfirm) score += 3;
      out.push({ kind: "item", key: it.key, title: it.title || "事项", type: it.type, day: it.day || "", time: it.time || "", location: it.location || "",
        mins: mins, level: level, exam: EXAM.test((it.title || "") + (it.summary || "")), score: Math.round(score * 10) / 10,
        when: whenText(it.day, it.time, now), reason: reason, mine: !!it.mine, needConfirm: !!it.needConfirm });
    });
    (courses || []).forEach(function (c) {
      if (!c || !c.t0 || c.day !== t) return;
      var s = c.t0.split(":"), e = (c.t1 || c.t0).split(":"), st = new Date(now), en = new Date(now);
      st.setHours(+s[0], +s[1], 0, 0); en.setHours(+e[0], +e[1], 0, 0);
      var toStart = (st - now) / 60000, toEnd = (en - now) / 60000;
      if (toEnd <= 0) return;
      var on = toStart <= 0, score = on ? 96 : toStart <= 180 ? 110 / (1 + toStart / 60) : 0;
      if (!score) return;
      out.push({ kind: "course", key: "course:" + c.name + c.t0, title: c.name, type: "课程", day: t, time: c.t0, location: c.location || "",
        mins: toStart, level: on ? "now" : toStart <= 20 ? "urgent" : "soon", score: Math.round(score * 10) / 10,
        when: c.t0 + "–" + (c.t1 || ""), reason: on ? "正在上课 · 还有 " + Math.round(toEnd) + " 分钟下课" : Math.round(toStart) + " 分钟后上课" });
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  // ---------- 问候 ----------
  function hello(now) {
    var h = now.getHours();
    return h < 5 ? "夜深了" : h < 9 ? "早上好" : h < 12 ? "上午好" : h < 14 ? "中午好" : h < 18 ? "下午好" : "晚上好";
  }
  function greet(ctx) {
    var now = ctx.now, list = rank(ctx.items, ctx.courses, now), name = ctx.name ? "，" + ctx.name : "";
    var late = list.filter(function (x) { return x.level === "late"; }).length;
    var todayN = list.filter(function (x) { return x.kind === "item" && x.day === keyOf(now); }).length;
    var top = list[0], s = hello(now) + name + "！";
    if (!list.length) return s + "手头没有要赶的事，" + (now.getHours() >= 21 ? "早点休息吧 🌙" : "可以安心学点别的 ☕");
    if (late) s += "有 " + late + " 项作业过期了，先补上吧。";
    else if (todayN) s += "今天有 " + todayN + " 件事。";
    if (top) s += top.kind === "course" ? "「" + top.title + "」" + top.reason + (top.location ? "，在 " + top.location : "") + "。" : "最该先做的是「" + top.title + "」（" + top.reason + "）。";
    return s;
  }

  // ---------- 听懂问题里的日子 ----------
  var CN = { "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7 };
  function parseDay(q, now) {
    var t = keyOf(now), m;
    if (/大后天/.test(q)) return { day: addDays(t, 3), name: "大后天" };
    if (/后天/.test(q)) return { day: addDays(t, 2), name: "后天" };
    if (/明天|明日|明早|明晚/.test(q)) return { day: addDays(t, 1), name: "明天" };
    if (/昨天/.test(q)) return { day: addDays(t, -1), name: "昨天" };
    if ((m = q.match(/(下下|下|上|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天1-7])/))) {
      var mon = addDays(t, -((now.getDay() + 6) % 7)), off = { "下下": 14, "下": 7, "上": -7 }[m[1]] || 0;
      var k = addDays(mon, off + CN[m[2]] - 1);
      return { day: k, name: (m[1] === "下" || m[1] === "上" ? m[1] : "") + "周" + WEEK[fromKey(k).getDay()] };
    }
    if ((m = q.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/))) {
      var d = new Date(now.getFullYear(), +m[1] - 1, +m[2]); if (d < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)) d.setFullYear(d.getFullYear() + 1);
      return { day: keyOf(d), name: (+m[1]) + "月" + (+m[2]) + "日" };
    }
    if ((m = q.match(/(\d{1,2})\s*[日号]/))) {
      var d2 = new Date(now.getFullYear(), now.getMonth(), +m[1]); if (+m[1] < now.getDate() - 7) d2.setMonth(d2.getMonth() + 1);
      return { day: keyOf(d2), name: (d2.getMonth() + 1) + "月" + d2.getDate() + "日" };
    }
    if (/今天|今日|今晚|今早|现在|当下/.test(q)) return { day: t, name: "今天" };
    return null;
  }
  function parseRange(q, now) {
    var t = keyOf(now), mon = addDays(t, -((now.getDay() + 6) % 7));
    if (/下周|下星期|下个星期|下礼拜/.test(q) && !/(下周|下星期|下礼拜)[一二三四五六日天1-7]/.test(q)) return { a: addDays(mon, 7), b: addDays(mon, 13), name: "下周" };
    if (/这周|本周|这星期|这个星期|这礼拜|这几天|最近/.test(q)) return { a: t, b: /这几天|最近/.test(q) ? addDays(t, 6) : addDays(mon, 6), name: /这几天|最近/.test(q) ? "最近一周" : "这周" };
    return null;
  }

  // ---------- 问答 ----------
  // ctx：{ now, name, items, courses(今天明天), coursesOn(dayKey) → 课程列表, weekOf(dayKey) → 第几周（没有就 0）,
  //        stats: { habits: [{name, done, streak}], pomoToday, pomoWeek, food, petName, petLevel, growth, rank } , hasCourses }
  var CHIPS = ["最急的是什么", "今天有什么课", "这周的作业", "明天有什么安排", "下节课在哪", "我今天打卡了吗"];
  function itemsOf(ctx, filter) { return rank(ctx.items, [], ctx.now, { lateDays: 30 }).filter(filter); }
  function listReply(text, list, empty) {
    return list.length ? { text: text, list: list.slice(0, 6), more: list.length > 6 ? list.length - 6 : 0 } : { text: empty };
  }
  function courseLine(c) { return (c.t0 ? c.t0 + (c.t1 ? "–" + c.t1 : "") : "第" + c.start + "节") + " " + c.name + (c.location ? " @" + c.location : ""); }
  function coursesReply(ctx, d) {
    if (!ctx.hasCourses) return { text: "你还没导入课程表。在「工具 → 课程表」里拍一张课表照片就能导入，之后问我哪天有什么课都行 📷", action: "courses" };
    var l = ctx.coursesOn(d.day) || [], wk = ctx.weekOf ? ctx.weekOf(d.day) : 0;
    if (!l.length) return { text: d.name + (wk ? "（第 " + wk + " 周）" : "") + "没有课 🎈" + (d.day === keyOf(ctx.now) ? "可以安排点自己的事。" : "") };
    return { text: d.name + (wk ? "（第 " + wk + " 周 · " + "周" + WEEK[fromKey(d.day).getDay()] + "）" : "") + "有 " + l.length + " 节课：", lines: l.map(courseLine) };
  }
  function nextCourse(ctx) {
    if (!ctx.hasCourses) return null;
    var now = ctx.now, t = keyOf(now), cur = hm(now);
    for (var i = 0; i < 8; i++) {
      var k = addDays(t, i), l = ctx.coursesOn(k) || [];
      for (var j = 0; j < l.length; j++) {
        var c = l[j];
        if (i === 0 && c.t1 && c.t1 <= cur) continue;
        return { c: c, day: k, now: i === 0 && c.t0 && c.t0 <= cur };
      }
    }
    return null;
  }

  function answer(q, ctx) {
    q = String(q || "").trim().replace(/[？?！!。，,、~～\s]+$/g, "");
    var now = ctx.now, t = keyOf(now), st = ctx.stats || {}, m;
    if (!q) return { text: "想问什么都可以，比如：", chips: CHIPS };

    if (/你会|能做什么|能干什么|会干什么|帮助|怎么用|功能|help/i.test(q)) return { text: "我会帮你盯着日程：哪件事最急、哪天有什么课、这周的作业、下节课在哪、考试安排，还能看打卡、番茄和云宠。直接问就行，比如：", chips: CHIPS };
    if (/你是谁|你叫什么|你是什么/.test(q)) return { text: "我是捞捞，住在这个小岛上的学习小助手 🤖 我会把你最该先做的事放在最上面，有问题随时问我。" };
    if (/^(你好|您好|嗨|哈喽|hi|hello|hey|在吗|在不在|早|早上好|早安|中午好|下午好|晚上好|晚安)/i.test(q)) return { text: hello(now) + (ctx.name ? "，" + ctx.name : "") + "！" + (/晚安/.test(q) ? "明天见，好好睡一觉 🌙" : "今天想先搞定哪件事？"), chips: CHIPS.slice(0, 3) };
    if (/谢谢|感谢|辛苦|多谢|thx|thanks/i.test(q)) return { text: "不客气～有事随时叫我 😊" };
    if (/累|烦|压力|不想学|不想写|焦虑|难过|崩溃|好难|学不动|摆烂/.test(q)) {
      var top0 = rank(ctx.items, [], now)[0];
      return { text: "辛苦啦，先深呼吸一下 🌿 " + (top0 ? "不用一口气做完，先只做「" + top0.title + "」的第一步，25 分钟就好，做完奖励自己休息一下。" : "现在手头没有急事，休息一会儿也没关系。") };
    }

    // 时间、日期、第几周
    if (!/课|作业|考/.test(q) && /几点|现在时间|什么时间|几号|日期|星期几|周几|礼拜几|第几周|教学周|今天是/.test(q)) {
      var wk = ctx.weekOf ? ctx.weekOf(t) : 0;
      return { text: "现在是 " + (now.getMonth() + 1) + "月" + now.getDate() + "日 周" + WEEK[now.getDay()] + " " + hm(now) + (wk ? "，第 " + wk + " 教学周" : "") + "。" };
    }

    // 下节课 / 现在在上什么课 / 在哪上课
    if (/下[一节]*节课|下一节|接下来.*课|在哪.*上课|上课.*在哪|哪个教室|现在.*什么课|在上什么|还有课吗|还有几节/.test(q)) {
      if (!ctx.hasCourses) return coursesReply(ctx, { day: t, name: "今天" });
      if (/还有课吗|还有几节/.test(q)) {
        var rest = (ctx.coursesOn(t) || []).filter(function (c) { return !c.t1 || c.t1 > hm(now); });
        return rest.length ? { text: "今天还有 " + rest.length + " 节课：", lines: rest.map(courseLine) } : { text: "今天的课都上完啦 🎉" };
      }
      var nc = nextCourse(ctx);
      if (!nc) return { text: "最近一周都没有课了 🎈" };
      return { text: nc.now ? "现在正在上「" + nc.c.name + "」，" + nc.c.t1 + " 下课" + (nc.c.location ? "，在 " + nc.c.location : "") + "。"
        : "下节课是" + dayName(nc.day, now) + " " + (nc.c.t0 || "第" + nc.c.start + "节") + " 的「" + nc.c.name + "」" + (nc.c.location ? "，在 " + nc.c.location : "") + (nc.c.teacher ? "，" + nc.c.teacher + "老师" : "") + "。" };
    }

    var d = parseDay(q, now), r = parseRange(q, now);

    // 某天的课
    if (/课/.test(q) && !/作业|课后|课程作业/.test(q)) {
      if (r && !d) {
        if (!ctx.hasCourses) return coursesReply(ctx, { day: t, name: "今天" });
        var lines = [];
        for (var k = r.a; k <= r.b; k = addDays(k, 1)) { var l2 = ctx.coursesOn(k) || []; if (l2.length) lines.push(dayName(k, now) + "：" + l2.map(function (c) { return c.name; }).join("、")); }
        return lines.length ? { text: r.name + "的课：", lines: lines } : { text: r.name + "没有课 🎈" };
      }
      return coursesReply(ctx, d || { day: t, name: "今天" });
    }

    // 考试
    if (/考试|测验|测试|小测|期中|期末|月考|答辩/.test(q)) {
      var ex = itemsOf(ctx, function (x) { return x.exam && x.level !== "late"; });
      return listReply("日历里的考试 / 测验：", ex, "日历里还没看到考试安排 👀 有消息记得让班委发到班级里，或者自己「记一件事」。");
    }

    // 作业
    if (/作业|要交|没交|交什么|ddl|DDL|截止/.test(q)) {
      var hw = itemsOf(ctx, function (x) { return x.type === "作业" || /作业|报告|习题|练习|论文|ppt|PPT/.test(x.title); });
      if (/过期|没交|欠|补/.test(q)) { var late = hw.filter(function (x) { return x.level === "late"; }); return listReply("过期还没交的作业有 " + late.length + " 项，抓紧补上：", late, "没有过期的作业，棒 👍"); }
      if (d) { var hd = hw.filter(function (x) { return x.day === d.day; }); return listReply(d.name + "要交 " + hd.length + " 项作业：", hd, d.name + "没有要交的作业 🎉"); }
      if (r) {
        var hr = hw.filter(function (x) { return x.day >= r.a && x.day <= r.b; });
        if (!hr.length && r.name === "这周" && (now.getDay() === 0 || now.getDay() === 6)) {   // 周末问「这周」，多半是想知道接下来要交什么
          var nx = hw.filter(function (x) { return x.day > r.b && x.day <= addDays(r.b, 7); });
          if (nx.length) return listReply("这周的都交完了，下周要交 " + nx.length + " 项：", nx, "");
        }
        return listReply(r.name + "要交 " + hr.length + " 项作业（按急的排）：", hr, r.name + "没有要交的作业 🎉");
      }
      return listReply("还没交的作业有 " + hw.length + " 项，按轻重缓急排好了：", hw, "作业都交完了，太棒了 🎉");
    }

    // 打卡、番茄、成长、云宠
    if (/打卡|习惯/.test(q)) {
      var hs = st.habits || [];
      if (!hs.length) return { text: "你还没有习惯，去「成长」页加一个，比如「背 30 个单词」，每天打卡能攒成长值和养料。", action: "growth" };
      var undone = hs.filter(function (h) { return !h.done; });
      return { text: undone.length ? "今天还差 " + undone.length + " 个没打：" + undone.map(function (h) { return h.name; }).join("、") + "。" : "今天的 " + hs.length + " 个习惯都打卡了 🔥", lines: hs.map(function (h) { return (h.done ? "✅ " : "⬜ ") + h.name + (h.streak ? "（连续 " + h.streak + " 天）" : ""); }) };
    }
    if (/番茄|专注/.test(q)) return { text: "今天专注了 " + (st.pomoToday || 0) + " 个番茄，这周一共 " + (st.pomoWeek || 0) + " 个。" + ((st.pomoToday || 0) < 4 ? "再来一个？" : "很专注 👏"), action: "pomo" };
    if (/成长值|排名|排行|第几名/.test(q)) return { text: st.rank ? "这周你攒了 " + st.growth + " 成长值，班里第 " + st.rank + " 名 🏆" : "这周还没上榜，完成一项作业就能攒成长值。", action: "rank" };
    if (/云宠|宠物|养料|喂/.test(q)) return { text: st.petName ? "「" + st.petName + "」现在 Lv." + st.petLevel + "，你有 " + (st.food || 0) + " 养料" + ((st.food || 0) >= 10 ? "，可以去喂它啦 🥕" : "，完成一件事就能攒养料 🌾") : "去云宠农场领一只云宠吧 🐣", action: "farm" };

    // 某天 / 这周有什么安排、最急的事
    if (d && /安排|计划|事|忙|干什么|做什么|有啥|有什么|日程/.test(q)) {
      var di = itemsOf(ctx, function (x) { return x.day === d.day; });
      var dc = ctx.hasCourses ? (ctx.coursesOn(d.day) || []) : [];
      if (!di.length && !dc.length) return { text: d.name + "没有安排，日历是空的 ☕" };
      return { text: d.name + "有 " + di.length + " 件事" + (dc.length ? "、" + dc.length + " 节课" : "") + "：", list: di.slice(0, 6), lines: dc.length ? ["📚 " + dc.map(function (c) { return (c.t0 || "") + " " + c.name; }).join("；")] : null };
    }
    if (r && /安排|事|忙|计划|日程|有啥|有什么/.test(q)) {
      var ri = itemsOf(ctx, function (x) { return x.day >= r.a && x.day <= r.b; });
      return listReply(r.name + "有 " + ri.length + " 件事，最急的在前面：", ri, r.name + "没有安排 ☕");
    }
    if (/急|先做|优先|接下来|该做|要做什么|做什么|待办|安排|有什么事|忙|任务|干嘛|干啥/.test(q)) {
      var all = rank(ctx.items, ctx.courses, now);
      return listReply(all.length ? "按轻重缓急排好了，从上往下做：" : "", all, "现在没有要赶的事，轻松一下吧 ☕");
    }

    // 最后试试按关键词在事项里找
    var kw = q.replace(/什么时候|什么时间|几点|在哪里?|在哪儿|地点|要带什么|带什么|准备什么|是什么|有没有|吗|呢|呀|啊|吧|的|了|我|请问|告诉我|帮我|查一?下|看看|一下/g, "").trim();
    if (kw.length >= 2) {
      var hit = rank(ctx.items, [], now, { lateDays: 60 }).filter(function (x) { return x.title.indexOf(kw) >= 0 || kw.indexOf(x.title) >= 0; });
      if (hit.length) {
        var h0 = hit[0];
        if (/在哪|地点/.test(q) && h0.location) return { text: "「" + h0.title + "」在 " + h0.location + "，" + h0.when + "。", list: hit.slice(0, 3) };
        return listReply("找到 " + hit.length + " 件跟「" + kw + "」有关的事：", hit, "");
      }
      if (ctx.hasCourses) {
        for (var i = 0; i < 7; i++) {
          var kk = addDays(t, i), cl = (ctx.coursesOn(kk) || []).filter(function (c) { return c.name.indexOf(kw) >= 0 || kw.indexOf(c.name) >= 0; });
          if (cl.length) return { text: "「" + cl[0].name + "」最近一次是" + dayName(kk, now) + " " + (cl[0].t0 || "第" + cl[0].start + "节") + (cl[0].location ? "，在 " + cl[0].location : "") + "。" };
        }
      }
    }
    return null;   // 听不懂：电脑上交给 AI，手机上给建议
  }
  function fallback() { return { text: "这个我还不太会 😅 我能回答日程、课程、作业、考试、打卡这些，试试问：", chips: CHIPS }; }

  return { rank: rank, greet: greet, answer: answer, fallback: fallback, hello: hello, parseDay: parseDay, dayName: dayName, leftText: leftText, keyOf: keyOf, CHIPS: CHIPS };
});
