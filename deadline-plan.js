/* deadline-plan.js —— 7.1 两个「手机待办做不到」的功能
 *   1. 大作业倒排拆解：粘贴作业要求 + 截止日期 → 拆成几步（平台 AI 或本地规则）→ 倒着排进每天的日程
 *   2. 期末复习排期：填几门考试的日期 → 按课内学习里的知识点、错题，生成每天的复习清单放进日程
 * 两个共用一套「没做完自动顺延」：哪天的步骤过了还没勾，打开捞捞时把剩下的重新往后排，不越过截止 / 考试。
 * 排出来的每一步都是普通的「我的事项」（personal_events_v1），首页、日历、手机 App、小程序、日历订阅都能看到。
 * 依赖 app.js 的全局：mine、save、load、LS_MINE、renderAll、esc、$、keyOf、ccDate、showView、CCAuth、currentUser */
(function () {
  "use strict";
  var LS = "deadline_plans_v1";            // { 计划id: 计划 }，跟着账号同步（app.js SYNC_KINDS）
  var WD = "一二三四五六日";

  // ---------- 日期小工具（都用 YYYY-MM-DD） ----------
  function today() { return keyOf(ccDate()); }
  function nowHour() { return ccDate().getHours(); }
  function dt(k) { var p = String(k).split("-"); return new Date(+p[0], +p[1] - 1, +p[2], 12); }
  function add(k, n) { var d = dt(k); d.setDate(d.getDate() + n); return keyOf(d); }
  function wd(k) { return ((dt(k).getDay() + 6) % 7) + 1; }          // 1 = 周一
  function diff(a, b) { return Math.round((dt(b) - dt(a)) / 86400000); }
  function md(k) { var d = dt(k); return (d.getMonth() + 1) + "月" + d.getDate() + "日 周" + WD[wd(k) - 1]; }
  function hm(t, plus) { var p = String(t || "20:00").split(":"), m = (+p[0]) * 60 + (+p[1] || 0) + (plus || 0); m = Math.min(m, 23 * 60 + 30); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function startDay() { return nowHour() >= 21 ? add(today(), 1) : today(); }
  function plans() { return load(LS, {}) || {}; }
  function savePlans(p) { save(LS, p); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function mins(m) { m = Math.round(m); return m >= 60 ? (Math.floor(m / 60) + " 小时" + (m % 60 ? " " + (m % 60) + " 分钟" : "")) : m + " 分钟"; }

  // 可用的日子：from..to（含），跳过勾掉的星期几
  function daysBetween(from, to, skip) {
    var out = []; if (diff(from, to) < 0) return out;
    for (var k = from, i = 0; diff(k, to) >= 0 && i < 400; k = add(k, 1), i++) if (!skip || skip.indexOf(wd(k)) < 0) out.push(k);
    return out;
  }

  // ---------- 排期：一串「单元」（有先后、有分钟数、有最晚日期）放进日子里 ----------
  // units: [{min, before(这天之前做完，不含), ...}]；返回同样的单元，带上 day、min（拆开的会变成几段）
  function place(units, opt) {
    var total = units.reduce(function (s, u) { return s + u.min; }, 0);
    var last = units.reduce(function (m, u) { return !m || diff(u.before, m) > 0 ? u.before : m; }, "");
    var days = daysBetween(opt.start, add(last, -1), opt.skip);
    if (!days.length) days = [diff(opt.start, last) > 0 ? add(last, -1) : opt.start];
    // 平均摊开：每天至少做一点（不全挤到前几天，也不拖到最后）
    var cap = Math.max(Math.ceil(total / days.length), Math.min(opt.perDay, 30));
    var tight = cap > opt.perDay;
    if (!tight) cap = Math.min(opt.perDay, Math.max(cap, Math.min(opt.perDay, 40)));
    var out = [], di = 0, left = cap;
    units.forEach(function (u) {
      var r = u.min, parts = [];
      // 这个单元最晚能排到哪一天
      var lim = days.length - 1; while (lim > 0 && diff(days[lim], u.before) <= 0) lim--;
      while (r > 0) {
        if (di > lim) { di = lim; left = Math.max(left, r); tight = true; }
        var take = Math.min(r, left);
        if (take < 15 && r > take && di < lim) { di++; left = cap; continue; }
        parts.push({ day: days[di], min: take });
        r -= take; left -= take;
        if (left < 15 && di < lim) { di++; left = cap; }
      }
      parts.forEach(function (p, i) { out.push(Object.assign({}, u, { day: p.day, min: p.min, part: parts.length > 1 ? i + 1 : 0, parts: parts.length })); });
    });
    return { segs: out, tight: tight, cap: cap, days: days.length, total: total };
  }

  // 排好的单元 → 我的事项；同一天的按顺序往后错开时间
  function toItems(plan, segs) {
    var at = {}, list = [];
    segs.forEach(function (s, i) {
      var start = hm(plan.time, at[s.day] || 0); at[s.day] = (at[s.day] || 0) + s.min;
      list.push({ id: "dp_" + plan.id + "_" + Date.now().toString(36) + "_" + i, subject: s.subject + (s.part ? "（" + s.part + "/" + s.parts + "）" : ""),
        event_time: s.day + " " + start, location: "", note: s.note + "\n约 " + mins(s.min) + (plan.kind === "project" ? " · 大作业「" + plan.title + "」截止 " + md(plan.due.slice(0, 10)) : " · 期末复习排期"),
        dplan: plan.id, ord: s.ord, est: Math.round(s.min), before: s.before, unit: s.unit });
    });
    return list;
  }
  function planItems(id) { return mine.filter(function (r) { return r.dplan === id; }); }
  function writeItems(id, keep, add0) {
    mine = mine.filter(function (r) { return r.dplan !== id || keep.indexOf(r) >= 0; }).concat(add0);
    save(LS_MINE, mine);
  }

  // ---------- 没做完自动顺延 ----------
  function replan(plan, force) {
    var its = planItems(plan.id).filter(function (r) { return !r.fixed; });
    var t = today(), st = startDay();
    var late = its.filter(function (r) { return !r.done && String(r.event_time).slice(0, 10) < t; });
    if (!late.length && !force) return 0;
    var undone = its.filter(function (r) { return !r.done; }).sort(function (a, b) { return (a.ord || 0) - (b.ord || 0) || String(a.event_time).localeCompare(String(b.event_time)); });
    // 同一个单元拆成几段的，合成一个再排
    var units = [], byUnit = {};
    undone.forEach(function (r) {
      var key = r.unit || r.id;
      if (byUnit[key]) { byUnit[key].min += r.est || 30; return; }
      byUnit[key] = { unit: key, ord: r.ord || 0, min: r.est || 30, before: r.before || plan.due.slice(0, 10), subject: String(r.subject).replace(/（\d+\/\d+）$/, ""), note: String(r.note || "").split("\n")[0] };
      units.push(byUnit[key]);
    });
    var res = place(units, { start: st, perDay: plan.perDay, skip: plan.skip });
    writeItems(plan.id, its.filter(function (r) { return r.done; }).concat(planItems(plan.id).filter(function (r) { return r.fixed; })), toItems(plan, res.segs));
    return late.length;
  }
  function replanAll() {
    var ps = plans(), msgs = [];
    Object.keys(ps).forEach(function (id) {
      var p = ps[id]; if (!p || p.archived) return;
      if (diff(today(), String(p.due || p.end || "").slice(0, 10)) < 0) return;      // 已经过了截止 / 考试
      var n = replan(p, false);
      if (n) { p.shifted = (p.shifted || 0) + n; msgs.push((p.kind === "project" ? "「" + p.title + "」" : "期末复习") + "有 " + n + " 步没做完"); }
    });
    if (msgs.length) {
      savePlans(ps);
      try { renderAll(); } catch (e) {}
      toast(msgs.join("，") + "，已经帮你顺延到后面几天，不会越过截止日期 ✓");
    }
  }
  function toast(s) {
    var t = document.createElement("div"); t.className = "dp-toast"; t.textContent = s; document.body.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 5200); setTimeout(function () { t.remove(); }, 5800);
  }

  // ---------- 大作业：拆步骤 ----------
  var TPL = [
    { re: /数据库|sql|可视化|系统|程序|代码|编程|开发|网站|网页|app|小程序|爬虫|算法|python|java|c\+\+|前端|后端|接口/i, steps: [
      ["读懂要求，列出要交的东西", 20, "评分点、提交格式、截止时间列成一张清单"], ["设计方案", 60, "表结构 / 模块划分 / 页面草图先画出来"],
      ["搭环境、准备数据", 60, "建库建表、导入测试数据，或把开发环境跑起来"], ["实现核心功能", 150, "先把最主要的功能跑通，别急着美化"],
      ["做可视化 / 界面", 90, "图表或页面，能拿出来演示"], ["测试、修 bug", 60, "对照清单逐条自测"],
      ["写文档 / 报告", 60, "设计思路、运行截图、遇到的问题"], ["检查并提交", 20, "对照第一步的清单逐项打勾后提交"]] },
    { re: /ppt|汇报|展示|答辩|演讲|presentation|路演/i, steps: [
      ["读懂要求，定主题", 20, "时长、页数、评分点"], ["收集素材", 60, "数据、图片、案例"], ["定大纲", 30, "每页讲什么先写成提纲"],
      ["做 PPT", 120, "先把内容放上去，再统一样式"], ["写讲稿", 45, "每页 2～3 句要说的话"], ["排练两遍", 40, "掐时间，卡壳的地方改"], ["检查并提交", 15, "文件名、格式按要求"]] },
    { re: /实验|实训|测量|上机/i, steps: [
      ["预习实验原理", 40, "看懂步骤和要记录的数据"], ["整理实验数据", 60, "数据表、单位、有效数字"], ["处理数据、画图", 60, "计算、误差分析、图表"],
      ["写实验报告", 90, "目的、原理、步骤、结果、讨论"], ["检查并提交", 15, "格式、签名、截图"]] },
    { re: /论文|报告|综述|调研|读书|心得|小论文|文章|essay|作文|案例分析|策划/i, steps: [
      ["读懂要求，定题目", 30, "字数、格式、评分点，定一个能写的题目"], ["查资料", 90, "找 5～8 篇能引用的资料，记下出处"], ["列提纲", 40, "每一部分要说什么写成一句话"],
      ["写初稿（上）", 120, "先写完前一半，不求完美"], ["写初稿（下）", 120, "写完剩下的部分和结尾"], ["修改", 60, "逻辑、例子、错别字"],
      ["格式和参考文献", 40, "按要求排版，参考文献格式统一"], ["检查并提交", 15, "查重 / 文件名 / 提交方式"]] },
    { re: /习题|作业|练习|题|卷/i, steps: [
      ["先过一遍题目", 15, "标出会的、不会的"], ["做完会的", 60, "先拿下能拿的分"], ["攻克不会的", 60, "翻书、看例题、问同学"], ["订正、整理", 25, "错的地方记到错题本"], ["检查并提交", 10, "拍照 / 上传 / 交到哪里"]] },
  ];
  var DEF = [["读懂要求，列出要交的东西", 20, "评分点、格式、截止时间"], ["收集材料", 60, "需要的资料、数据、工具"], ["完成主体", 150, "最主要的部分先做出来"], ["完善细节", 60, "补全、修改、润色"], ["检查并提交", 15, "对照要求逐条检查后提交"]];
  function ruleSteps(title, req, daysLeft, perDay) {
    var text = title + " " + req, t = TPL.filter(function (x) { return x.re.test(text); })[0];
    var steps = (t ? t.steps : DEF).map(function (s) { return { t: s[0], m: s[1], d: s[2] }; });
    if (/小组|组队|分组|团队|组员/.test(text)) steps.splice(1, 0, { t: "小组分工", m: 20, d: "谁做哪部分、什么时候汇总，在群里定下来" });
    // 按字数 / 页数稍微放大一点
    var big = /(\d{4,5})\s*字/.exec(text), pages = /(\d{2,3})\s*页/.exec(text), k = 1;
    if (big) k = Math.min(3, Math.max(1, +big[1] / 3000)); else if (pages) k = Math.min(2.5, Math.max(1, +pages[1] / 15));
    if (k !== 1) steps.forEach(function (s, i) { if (i > 0 && i < steps.length - 1) s.m = Math.round(s.m * k / 5) * 5; });
    // 时间特别紧：等比例压缩，但每步至少 15 分钟
    var cap = Math.max(1, daysLeft) * perDay * 1.3, total = steps.reduce(function (a, s) { return a + s.m; }, 0);
    if (total > cap) steps.forEach(function (s) { s.m = Math.max(15, Math.round(s.m * cap / total / 5) * 5); });
    return steps;
  }
  // 平台 AI（和课内学习同一条路：数据库 → 扣子），不行就用规则
  async function aiSteps(input) {
    if (typeof CCAuth === "undefined" || !currentUser) throw new Error("登录后才能用 AI 拆解");
    var started = await CCAuth.rpc("learn_ai_start", { p_path: "plan-steps", p_body: { provider: "platform", confirm_cost: true, input: input } });
    var t0 = Date.now();
    for (;;) {
      await new Promise(function (r) { setTimeout(r, Date.now() - t0 < 6000 ? 900 : 1600); });
      var st = await CCAuth.rpc("learn_ai_status", { jid: started.job_id });
      if (st && st.status !== "running") {
        var b = (st.result || {}).b || {};
        if (b.result && Array.isArray(b.result.steps)) return b.result.steps.map(function (s) { return { t: s.title, m: s.minutes, d: s.detail || "" }; });
        throw new Error(b.error === "AI_SERVICE_NOT_DEPLOYED" ? "AI 服务还没部署" : "AI 暂时用不了");
      }
      if (Date.now() - t0 > 160000) throw new Error("AI 太久没回应");
    }
  }

  // ---------- 大作业页 ----------
  var draft = null;     // 正在编辑的拆解：{ title, course, due, req, perDay, time, skip, steps, src }
  function pv(id) { return document.getElementById(id); }
  function readForm() {
    var d = pv("dpDue").value, tm = pv("dpDueT").value || "23:59";
    var skip = []; document.querySelectorAll("#dpSkip input:checked").forEach(function (c) { skip.push(+c.value); });
    return { title: pv("dpTitle").value.trim(), course: pv("dpCourse").value.trim(), due: d ? d + " " + tm : "", req: pv("dpReq").value.trim(),
      perDay: +pv("dpPer").value || 60, time: pv("dpTime").value || "20:00", skip: skip };
  }
  function checkForm(f) {
    if (!f.title && !f.req) return "先写作业名称，或者把老师的要求粘贴进来";
    if (!f.due) return "选一下截止日期";
    if (diff(today(), f.due.slice(0, 10)) < 0) return "截止日期已经过了";
    return "";
  }
  async function breakDown(useAi) {
    var f = readForm(), err = checkForm(f), st = pv("dpStatus");
    if (err) { st.className = "dp-st err"; st.textContent = err; return; }
    if (!f.title) f.title = f.req.split(/[\n，。,.]/)[0].slice(0, 20);
    var daysLeft = Math.max(1, diff(startDay(), f.due.slice(0, 10)));
    st.className = "dp-st"; st.textContent = useAi ? "AI 正在拆解（一般 10～30 秒）…" : "";
    var steps = null, src = "rule";
    if (useAi) {
      try { steps = await aiSteps({ title: f.title, requirement: f.req.slice(0, 5000), due: f.due, minutes_per_day: f.perDay, days_left: daysLeft, course: f.course }); src = "ai"; st.textContent = "AI 拆好了，每一步都可以改"; }
      catch (e) { st.className = "dp-st warn"; st.textContent = e.message + "，先按常见做法拆好了，可以自己改"; }
    }
    if (!steps) steps = ruleSteps(f.title, f.req, daysLeft, f.perDay);
    draft = Object.assign(f, { steps: steps, src: src });
    drawDraft();
  }
  function draftUnits(d) {
    var due = d.due.slice(0, 10), lastDay = /^(0\d|1[01]):/.test(d.due.slice(11)) ? due : add(due, 1);   // 上午截止的，当天不排
    return d.steps.map(function (s, i) {
      return { unit: "s" + i, ord: i, min: Math.max(10, +s.m || 30), before: i === d.steps.length - 1 ? lastDay : due,
        subject: d.title + "｜" + (i + 1) + ". " + s.t, note: s.d || "" };
    });
  }
  function drawDraft() {
    var box = pv("dpDraft");
    if (!draft) { box.classList.add("hidden"); box.innerHTML = ""; return; }
    box.classList.remove("hidden");
    var res = place(draftUnits(draft), { start: startDay(), perDay: draft.perDay, skip: draft.skip });
    var byDay = {}; res.segs.forEach(function (s) { (byDay[s.day] = byDay[s.day] || []).push(s); });
    var total = draft.steps.reduce(function (a, s) { return a + (+s.m || 0); }, 0);
    box.innerHTML = '<div class="dp-h"><b>拆成 ' + draft.steps.length + ' 步</b><span>' + (draft.src === "ai" ? "AI 拆的" : "按常见做法拆的") + ' · 一共约 ' + mins(total) + ' · 截止 ' + esc(md(draft.due.slice(0, 10))) + ' ' + esc(draft.due.slice(11)) + '</span></div>' +
      '<ol class="dp-steps">' + draft.steps.map(function (s, i) {
        return '<li data-i="' + i + '"><input class="dp-st-t" value="' + esc(s.t) + '" aria-label="第 ' + (i + 1) + ' 步"><input class="dp-st-m" type="number" min="10" max="900" step="5" value="' + (+s.m || 30) + '" aria-label="分钟"><span class="dp-u">分钟</span>' +
          '<button type="button" class="dp-x" data-del="' + i + '" title="删掉这一步">×</button><small>' + esc(s.d || "") + '</small></li>';
      }).join("") + '</ol><button type="button" class="dp-add" id="dpAddStep">＋ 加一步</button>' +
      '<div class="dp-h" style="margin-top:14px"><b>倒排进日程</b><span>' + (res.tight ? '<em class="dp-warn">时间紧：每天要花约 ' + mins(res.cap) + '，比你设的多，可以把截止前的周末也排上</em>' : '每天大约 ' + mins(Math.min(res.cap, draft.perDay)) + '，' + esc(draft.time) + ' 开始') + '</span></div>' +
      '<div class="dp-tl">' + Object.keys(byDay).sort().map(function (k) {
        return '<div class="dp-day"><span class="dp-d">' + esc(md(k)) + (k === today() ? " · 今天" : "") + '</span>' + byDay[k].map(function (s) { return '<span class="dp-chip">' + esc(s.subject.split("｜")[1] || s.subject) + (s.part ? "（" + s.part + "/" + s.parts + "）" : "") + ' <i>' + mins(s.min) + '</i></span>'; }).join("") + '</div>';
      }).join("") + '<div class="dp-day due"><span class="dp-d">' + esc(md(draft.due.slice(0, 10))) + '</span><span class="dp-chip due">截止 ' + esc(draft.due.slice(11)) + '</span></div></div>' +
      '<div class="dp-act"><button type="button" class="btn sm" id="dpCancel">算了</button><button type="button" class="btn ink sm" id="dpSave">放进我的日程</button></div>' +
      '<p class="dp-note">哪天没做完不用管：下次打开捞捞，没勾的会自动顺延到后面几天，不会越过截止日期。</p>';
  }
  function saveDraft() {
    var d = draft; if (!d) return;
    var id = uid(), plan = { id: id, kind: "project", title: d.title, course: d.course, due: d.due, req: d.req.slice(0, 2000), perDay: d.perDay, time: d.time, skip: d.skip, steps: d.steps, src: d.src, created: today(), shifted: 0 };
    var res = place(draftUnits(d), { start: startDay(), perDay: d.perDay, skip: d.skip });
    var items = toItems(plan, res.segs);
    // 截止那一刻也放进去（作业）
    items.push({ id: "dp_" + id + "_due", subject: d.title + (d.course ? "（" + d.course + "）" : ""), event_time: d.due, location: "", note: (d.req ? d.req.slice(0, 400) + "\n" : "") + "大作业截止 · 已拆成 " + d.steps.length + " 步排进日程", kind: "作业", dplan: id, fixed: true });
    mine = mine.concat(items); save(LS_MINE, mine);
    var ps = plans(); ps[id] = plan; savePlans(ps);
    draft = null; drawDraft();
    ["dpTitle", "dpCourse", "dpReq"].forEach(function (k) { pv(k).value = ""; });
    pv("dpStatus").className = "dp-st"; pv("dpStatus").textContent = "已放进日程：" + (items.length - 1) + " 个时间段 ✓ 首页、日历、手机上都能看到";
    try { renderAll(); } catch (e) {}
    drawList();
  }
  function progress(id) {
    var its = planItems(id).filter(function (r) { return !r.fixed; });
    var done = its.filter(function (r) { return r.done; }), next = its.filter(function (r) { return !r.done; }).sort(function (a, b) { return String(a.event_time).localeCompare(String(b.event_time)); })[0];
    var tot = its.reduce(function (a, r) { return a + (r.est || 0); }, 0), got = done.reduce(function (a, r) { return a + (r.est || 0); }, 0);
    return { n: its.length, done: done.length, pct: tot ? Math.round(got * 100 / tot) : 0, next: next };
  }
  function drawList() {
    var box = pv("dpList"); if (!box) return;
    var ps = plans(), ids = Object.keys(ps).filter(function (id) { return ps[id] && ps[id].kind === "project" && !ps[id].archived; })
      .sort(function (a, b) { return String(ps[a].due).localeCompare(String(ps[b].due)); });
    pv("dpListH").classList.toggle("hidden", !ids.length);
    box.innerHTML = ids.map(function (id) {
      var p = ps[id], g = progress(id), left = diff(today(), p.due.slice(0, 10));
      return '<div class="dp-card surface" data-pid="' + esc(id) + '"><div class="dp-card-h"><b>' + esc(p.title) + '</b>' + (p.course ? '<small>' + esc(p.course) + '</small>' : "") +
        '<span class="dp-left' + (left <= 2 ? " hot" : "") + '">' + (left < 0 ? "已截止" : left === 0 ? "今天截止" : "还剩 " + left + " 天") + '</span></div>' +
        '<div class="dp-bar"><i style="width:' + g.pct + '%"></i></div>' +
        '<div class="dp-card-m">完成 ' + g.done + '/' + g.n + ' 段 · ' + g.pct + '%' + (g.next ? ' · 下一步：' + esc(md(String(g.next.event_time).slice(0, 10))) + ' ' + esc(String(g.next.subject).split("｜")[1] || g.next.subject) : g.n ? " · 全部完成 🎉" : "") + (p.shifted ? ' · 顺延过 ' + p.shifted + ' 次' : "") + '</div>' +
        '<div class="dp-card-a"><button type="button" class="small" data-re="' + esc(id) + '">重新排</button><button type="button" class="small" data-arch="' + esc(id) + '">' + (g.n && g.done === g.n ? "收起" : "删掉") + '</button></div></div>';
    }).join("");
  }

  // ---------- 期末复习 ----------
  var exams = null;
  function examRows() {
    if (!exams) {
      var ps = plans(), cur = Object.keys(ps).map(function (k) { return ps[k]; }).filter(function (p) { return p && p.kind === "review" && !p.archived; })[0];
      exams = cur ? cur.exams.map(function (e) { return Object.assign({}, e); }) : [];
      // 课内学习里标成考试的考核，先填进来
      if (!exams.length && typeof studyItems === "function") studyItems().forEach(function (it) {
        if (/考试|期末|期中|测验|exam/i.test(it.subject) && diff(today(), it.event_time) > 0) exams.push({ course: it._studyCourse || it.subject.split(" · ")[0], date: it.event_time, time: "09:00", w: 2 });
      });
      if (!exams.length) exams.push({ course: "", date: "", time: "09:00", w: 2 });
    }
    return exams;
  }
  function courseNames() {
    var s = {}; (typeof studyCourses === "function" ? studyCourses() : []).forEach(function (c) { s[c.name] = 1; });
    try { var cd = ck && ck().data; ((cd && cd.courses) || []).forEach(function (c) { if (c.name) s[c.name] = 1; }); } catch (e) {}
    return Object.keys(s);
  }
  function outlineOf(name) {
    var list = typeof studyCourses === "function" ? studyCourses() : [], n = String(name || "").trim();
    return list.filter(function (c) { return c.name === n; })[0] || list.filter(function (c) { return n && (c.name.indexOf(n) >= 0 || n.indexOf(c.name) >= 0); })[0] || null;
  }
  function drawExams() {
    var box = pv("rvExams"); if (!box) return;
    var names = courseNames();
    pv("rvCourseList").innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
    box.innerHTML = examRows().map(function (e, i) {
      var o = outlineOf(e.course);
      return '<div class="rv-row" data-i="' + i + '"><input class="rv-c" list="rvCourseList" value="' + esc(e.course) + '" placeholder="科目，比如 高等数学"><input class="rv-d" type="date" value="' + esc(e.date) + '"><input class="rv-t" type="time" value="' + esc(e.time || "09:00") + '">' +
        '<select class="rv-w" title="这门课要花多少力气"><option value="1"' + (e.w == 1 ? " selected" : "") + '>稳了</option><option value="2"' + (e.w == 2 || !e.w ? " selected" : "") + '>一般</option><option value="3"' + (e.w == 3 ? " selected" : "") + '>要拼</option></select>' +
        '<button type="button" class="dp-x" data-rvdel="' + i + '" title="去掉">×</button>' +
        '<small>' + (o && o.topics.length ? "课内学习里有 " + o.topics.length + " 个知识点" + (o.mistakes ? "、" + o.mistakes + " 道没复习的错题" : "") + "，按它们排" : o ? "课内学习里这门课还没建知识框架，先按通用复习步骤排" : e.course ? "课内学习里还没有这门课，按通用复习步骤排（建了知识框架会更准）" : "") + '</small></div>';
    }).join("");
  }
  function readExams() {
    document.querySelectorAll("#rvExams .rv-row").forEach(function (r) {
      var e = exams[+r.dataset.i]; if (!e) return;
      e.course = r.querySelector(".rv-c").value.trim(); e.date = r.querySelector(".rv-d").value; e.time = r.querySelector(".rv-t").value || "09:00"; e.w = +r.querySelector(".rv-w").value || 2;
    });
  }
  // 一门课的复习单元：第一轮按知识框架过一遍 → 错题 → 模拟 / 往年题 → 考前一天回顾
  function courseUnits(e, block) {
    var o = outlineOf(e.course), units = [], w = +e.w || 2;
    var topics = o ? o.topics.filter(function (t) { return t.k; }) : [];
    if (o && topics.length < 3) topics = o.topics.filter(function (t) { return t.d === 0; });
    if (!topics.length) topics = ["梳理整本书的知识框架", "过一遍课件 / 课本（前半）", "过一遍课件 / 课本（后半）", "重点公式、概念整理成一页"].map(function (t) { return { t: t }; });
    // 知识点太多：几个合成一次
    var rounds = Math.max(2, Math.min(topics.length, 3 + w * 3)), per = Math.ceil(topics.length / rounds);
    for (var i = 0; i < topics.length; i += per) {
      var grp = topics.slice(i, i + per).map(function (t) { return t.t; });
      units.push({ subject: "复习｜" + e.course + "：" + grp.join("、").slice(0, 28) + (grp.join("、").length > 28 ? "…" : ""), note: "过一遍：" + grp.join("、") + "。合上书能讲出来才算过", min: block * (w >= 3 ? 1.5 : 1) });
    }
    var mis = o ? o.mistakes : 0;
    units.push({ subject: "复习｜" + e.course + "：" + (mis ? "错题 " + mis + " 道" : "整理错题和易错点"), note: mis ? "课内学习里还没复习的 " + mis + " 道错题，重做一遍" : "把作业、练习里错过的再做一遍", min: block * (mis > 15 ? 2 : 1) });
    for (var k = 0; k < Math.max(1, w - 1); k++) units.push({ subject: "复习｜" + e.course + "：做一套往年题 / 模拟题" + (w > 2 ? "（" + (k + 1) + "）" : ""), note: "限时做，做完对答案，错的记下来", min: Math.max(block, 90) });
    return units;
  }
  function buildReview(opt) {
    var es = examRows().filter(function (e) { return e.course && e.date && diff(today(), e.date) > 0; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    if (!es.length) return null;
    var block = opt.perDay >= 120 ? 60 : 45;
    // 每门课的单元在「开始 ~ 考前两天」之间均匀摊开（隔几天复习一次，比一口气看完记得牢），
    // 同一天放不下就往后挪，不越过考前一天；考前一天固定是这门课的考前回顾
    var queues = es.map(function (e, i) { return { e: e, i: i, units: courseUnits(e, block).map(function (u, j) { return Object.assign(u, { before: e.date, ord: i * 100 + j, unit: "e" + i + "u" + j }); }) }; });
    var allDays = daysBetween(opt.start, add(es[es.length - 1].date, -1), opt.skip), used = {}, segs = [], tight = false;
    var put = function (day, min, u) { used[day] = (used[day] || 0) + min; segs.push({ day: day, min: min, subject: u.subject, note: u.note, ord: u.ord, before: u.before, unit: u.unit }); };
    queues.forEach(function (q) {
      var last = add(q.e.date, -1);
      if (allDays.indexOf(last) >= 0 || diff(opt.start, last) >= 0) put(last, Math.min(60, block), { subject: "复习｜" + q.e.course + "：考前回顾", note: "只看知识框架、公式和错题，不做新题，早点睡", ord: q.i * 100 + 99, before: q.e.date, unit: "e" + q.i + "last" });
    });
    var wish = [];
    queues.forEach(function (q) {
      var win = allDays.filter(function (d) { return diff(d, q.e.date) >= 2; });
      if (!win.length) win = allDays.filter(function (d) { return diff(d, q.e.date) >= 1; });
      if (!win.length) { tight = true; return; }
      q.units.forEach(function (u, j) { wish.push({ u: u, at: Math.floor(j * win.length / q.units.length), win: win }); });
    });
    wish.sort(function (a, b) { return a.win[a.at].localeCompare(b.win[b.at]) || a.u.ord - b.u.ord; });
    var rest = 0;
    wish.forEach(function (w) {
      var left = w.u.min, k = w.at;
      while (left > 0) {
        if (k >= w.win.length) { tight = true; put(w.win[w.win.length - 1], left, w.u); left = 0; break; }
        var d = w.win[k], room = opt.perDay - (used[d] || 0);
        if (room >= Math.min(25, left)) { var take = Math.min(room, left); put(d, take, w.u); left -= take; }
        k++;
      }
    });
    segs.sort(function (a, b) { return a.day.localeCompare(b.day) || a.ord - b.ord; });
    return { exams: es, segs: segs, tight: tight, rest: rest, days: allDays.length };
  }
  function drawReview() {
    var box = pv("rvDraft"); if (!box) return;
    readExams();
    var opt = rvOpt(), r = buildReview(opt);
    if (!r) { box.classList.add("hidden"); pv("rvStatus").textContent = "至少填一门还没考的科目和考试日期"; pv("rvStatus").className = "dp-st err"; return; }
    pv("rvStatus").textContent = ""; box.classList.remove("hidden");
    var byDay = {}; r.segs.forEach(function (s) { (byDay[s.day] = byDay[s.day] || []).push(s); });
    var ex = {}; r.exams.forEach(function (e) { (ex[e.date] = ex[e.date] || []).push(e); });
    var keys = Object.keys(byDay).concat(Object.keys(ex)).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort();
    box.innerHTML = '<div class="dp-h"><b>' + r.days + ' 天，' + r.segs.length + ' 次复习</b><span>' + (r.tight ? '<em class="dp-warn">有点紧：有几天超过了你设的时长，可以把每天的时间调多一点，或者早点开始</em>' : '每天最多 ' + mins(opt.perDay) + '，' + esc(opt.time) + ' 开始') + '</span></div>' +
      '<div class="dp-tl">' + keys.map(function (k) {
        return '<div class="dp-day' + (ex[k] ? " due" : "") + '"><span class="dp-d">' + esc(md(k)) + '</span>' + (byDay[k] || []).map(function (s) { return '<span class="dp-chip">' + esc(s.subject.replace(/^复习｜/, "")) + ' <i>' + mins(s.min) + '</i></span>'; }).join("") +
          (ex[k] || []).map(function (e) { return '<span class="dp-chip due">考试 · ' + esc(e.course) + ' ' + esc(e.time) + '</span>'; }).join("") + '</div>';
      }).join("") + '</div>' +
      '<div class="dp-act"><button type="button" class="btn ink sm" id="rvSave">放进我的日程</button></div>' +
      '<p class="dp-note">考试也会放进日程。哪天没复习完，下次打开捞捞会自动顺延，不会排到考试之后。</p>';
  }
  function rvOpt() {
    var skip = []; document.querySelectorAll("#rvSkip input:checked").forEach(function (c) { skip.push(+c.value); });
    return { perDay: +pv("rvPer").value || 120, time: pv("rvTime").value || "19:00", start: pv("rvStart").value && diff(today(), pv("rvStart").value) >= 0 ? pv("rvStart").value : startDay(), skip: skip };
  }
  function saveReview() {
    readExams();
    var opt = rvOpt(), r = buildReview(opt); if (!r) return;
    var ps = plans();
    // 只留一份期末复习计划：旧的没做的删掉，做过的留着
    Object.keys(ps).forEach(function (k) { if (ps[k] && ps[k].kind === "review" && !ps[k].archived) { mine = mine.filter(function (x) { return x.dplan !== k || x.done; }); ps[k].archived = true; } });
    var id = uid(), last = r.exams[r.exams.length - 1].date;
    var plan = { id: id, kind: "review", title: "期末复习", exams: r.exams, due: last, perDay: opt.perDay, time: opt.time, skip: opt.skip, created: today(), shifted: 0 };
    var items = toItems(plan, r.segs);
    r.exams.forEach(function (e, i) { items.push({ id: "dp_" + id + "_exam" + i, subject: "考试：" + e.course, event_time: e.date + " " + (e.time || "09:00"), location: "", note: "期末复习排期 · 考前一天只回顾，不做新题", dplan: id, fixed: true }); });
    mine = mine.concat(items); save(LS_MINE, mine);
    ps[id] = plan; savePlans(ps);
    pv("rvStatus").className = "dp-st"; pv("rvStatus").textContent = "已放进日程：" + r.segs.length + " 次复习、" + r.exams.length + " 场考试 ✓";
    pv("rvDraft").classList.add("hidden");
    try { renderAll(); } catch (e) {}
    drawRvCur();
  }
  function drawRvCur() {
    var box = pv("rvCur"); if (!box) return;
    var ps = plans(), p = Object.keys(ps).map(function (k) { return ps[k]; }).filter(function (p) { return p && p.kind === "review" && !p.archived; })[0];
    if (!p) { box.innerHTML = ""; box.classList.add("hidden"); return; }
    var g = progress(p.id); box.classList.remove("hidden");
    box.innerHTML = '<div class="dp-card-h"><b>现在的复习计划</b><span class="dp-left">' + p.exams.map(function (e) { var l = diff(today(), e.date); return esc(e.course) + (l < 0 ? " 已考" : l === 0 ? " 今天考" : " " + l + " 天后"); }).join(" · ") + '</span></div>' +
      '<div class="dp-bar"><i style="width:' + g.pct + '%"></i></div><div class="dp-card-m">完成 ' + g.done + '/' + g.n + ' 次 · ' + g.pct + '%' + (g.next ? " · 下一次：" + esc(md(String(g.next.event_time).slice(0, 10))) + " " + esc(String(g.next.subject).replace(/^复习｜/, "")) : "") + (p.shifted ? " · 顺延过 " + p.shifted + " 次" : "") + '</div>' +
      '<div class="dp-card-a"><button type="button" class="small" data-re="' + esc(p.id) + '">重新排</button><button type="button" class="small" data-arch="' + esc(p.id) + '">删掉</button></div>';
  }

  // ---------- 事件 ----------
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t.closest("#dpAi")) { breakDown(true); return; }
    if (t.closest("#dpRule")) { breakDown(false); return; }
    if (t.closest("#dpCancel")) { draft = null; drawDraft(); return; }
    if (t.closest("#dpSave")) { syncDraft(); saveDraft(); return; }
    if (t.closest("#dpAddStep")) { syncDraft(); draft.steps.splice(draft.steps.length - 1, 0, { t: "新的一步", m: 30, d: "" }); drawDraft(); return; }
    var dl = t.closest("[data-del]"); if (dl && draft) { syncDraft(); draft.steps.splice(+dl.dataset.del, 1); drawDraft(); return; }
    var re = t.closest("[data-re]");
    if (re) { var ps = plans(), p = ps[re.dataset.re]; if (p) { replan(p, true); savePlans(ps); try { renderAll(); } catch (e2) {} drawList(); drawRvCur(); toast("已按今天重新排好没做的部分 ✓"); } return; }
    var ar = t.closest("[data-arch]");
    if (ar) {
      var ps2 = plans(), p2 = ps2[ar.dataset.arch]; if (!p2) return;
      var g = progress(p2.id), all = g.n && g.done === g.n;
      if (!all && !confirm("删掉这个计划？还没做的步骤会从日程里去掉，已经勾掉的留着。")) return;
      mine = mine.filter(function (x) { return x.dplan !== p2.id || x.done || (all && x.fixed); }); save(LS_MINE, mine);
      p2.archived = true; savePlans(ps2); try { renderAll(); } catch (e3) {} drawList(); drawRvCur(); return;
    }
    if (t.closest("#rvAdd")) { readExams(); exams.push({ course: "", date: "", time: "09:00", w: 2 }); drawExams(); return; }
    var rd = t.closest("[data-rvdel]"); if (rd) { readExams(); exams.splice(+rd.dataset.rvdel, 1); if (!exams.length) exams.push({ course: "", date: "", time: "09:00", w: 2 }); drawExams(); return; }
    if (t.closest("#rvGo")) { drawReview(); return; }
    if (t.closest("#rvSave")) { saveReview(); return; }
    if (t.closest("#rvSync")) { var b = t.closest("#rvSync"); b.disabled = true; Promise.resolve(window.studyRefresh && studyRefresh()).then(function () { b.disabled = false; exams = null; drawExams(); }); return; }
  });
  document.addEventListener("input", function (e) {
    if (e.target.closest("#dpDraft") && draft) { syncDraft(); clearTimeout(drawT); drawT = setTimeout(function () { var a = document.activeElement, sel = a && a.closest && a.closest("[data-i]") ? [a.closest("[data-i]").dataset.i, a.className] : null; drawDraft(); if (sel) { var n = document.querySelector('#dpDraft [data-i="' + sel[0] + '"] .' + sel[1].split(" ")[0]); if (n) n.focus(); } }, 600); }
    if (e.target.closest("#rvExams") && e.target.classList.contains("rv-c")) { clearTimeout(drawT); drawT = setTimeout(function () { readExams(); var a = document.activeElement, i = a && a.closest(".rv-row") ? a.closest(".rv-row").dataset.i : null; drawExams(); if (i != null) { var n = document.querySelector('#rvExams [data-i="' + i + '"] .rv-c'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } } }, 700); }
  });
  var drawT = 0;
  function syncDraft() {
    if (!draft) return;
    document.querySelectorAll("#dpDraft .dp-steps li").forEach(function (li) {
      var s = draft.steps[+li.dataset.i]; if (!s) return;
      s.t = li.querySelector(".dp-st-t").value.trim() || s.t; s.m = Math.max(10, Math.min(900, +li.querySelector(".dp-st-m").value || s.m));
    });
  }

  // ---------- 页面 ----------
  function skipHtml(id) { return '<div class="dp-skip" id="' + id + '"><span>不排的日子</span>' + WD.split("").map(function (c, i) { return '<label><input type="checkbox" value="' + (i + 1) + '"><b>' + c + '</b></label>'; }).join("") + '</div>'; }
  function perHtml(id, def, list) { return '<select id="' + id + '">' + list.map(function (m) { return '<option value="' + m + '"' + (m === def ? " selected" : "") + '>' + mins(m) + '</option>'; }).join("") + '</select>'; }
  function mount() {
    var pj = document.querySelector('.view[data-view="project"]');
    if (pj && !pj.dataset.built) {
      pj.dataset.built = "1";
      pj.insertAdjacentHTML("beforeend",
        '<div class="dp-wrap"><div class="dp-form surface">' +
        '<p class="dp-lead">粘贴老师发的作业要求，捞捞把它拆成几步、倒着排进截止前的每一天。哪天没做完，会自动往后顺延。</p>' +
        '<div class="dp-grid"><label>作业名称<input id="dpTitle" placeholder="比如：数据库课程设计"></label><label>课程（可不填）<input id="dpCourse" list="rvCourseList" placeholder="数据库原理"></label>' +
        '<label>截止日期<input id="dpDue" type="date"></label><label>截止时间<input id="dpDueT" type="time" value="23:59"></label></div>' +
        '<label class="dp-full">作业要求<textarea id="dpReq" rows="5" placeholder="把群里、学习通里老师发的要求整段粘贴进来：做什么、交什么、字数页数、小组还是个人……"></textarea></label>' +
        '<div class="dp-grid"><label>每天能花<span>' + perHtml("dpPer", 60, [30, 45, 60, 90, 120, 180]) + '</span></label><label>几点开始做<input id="dpTime" type="time" value="20:00"></label></div>' +
        skipHtml("dpSkip") +
        '<div class="dp-act"><button type="button" class="btn sm" id="dpRule" title="不联网，按常见做法拆">按常见做法拆</button><button type="button" class="btn ink sm" id="dpAi">AI 帮我拆</button></div><div id="dpStatus" class="dp-st"></div></div>' +
        '<div id="dpDraft" class="dp-draft surface hidden"></div>' +
        '<div class="sec-h hidden" id="dpListH"><b>进行中的大作业</b><span>打勾的进度会算进来</span></div><div id="dpList"></div></div>');
      var due = pv("dpDue"); due.min = today(); due.value = add(today(), 14);
    }
    var rv = document.querySelector('.view[data-view="review"]');
    if (rv && !rv.dataset.built) {
      rv.dataset.built = "1";
      rv.insertAdjacentHTML("beforeend",
        '<div class="dp-wrap"><div id="rvCur" class="dp-card surface hidden"></div><div class="dp-form surface">' +
        '<p class="dp-lead">填上每门课的考试日期，捞捞按课内学习里的知识框架和错题，排出每天复习什么；考前一天只回顾。几门课交错着来，越急的排得越多。</p>' +
        '<datalist id="rvCourseList"></datalist><div id="rvExams"></div><div class="dp-act left"><button type="button" class="small" id="rvAdd">＋ 再加一门</button><button type="button" class="small" id="rvSync" title="重新读一遍课内学习里的知识点和错题">刷新课内学习的知识点</button></div>' +
        '<div class="dp-grid"><label>每天复习<span>' + perHtml("rvPer", 120, [60, 90, 120, 180, 240, 300]) + '</span></label><label>几点开始<input id="rvTime" type="time" value="19:00"></label><label>从哪天开始<input id="rvStart" type="date"></label></div>' +
        skipHtml("rvSkip") +
        '<div class="dp-act"><button type="button" class="btn ink sm" id="rvGo">生成复习计划</button></div><div id="rvStatus" class="dp-st"></div></div>' +
        '<div id="rvDraft" class="dp-draft surface hidden"></div></div>');
      pv("rvStart").value = startDay(); pv("rvStart").min = today();
    }
  }
  function onShow(v) {
    mount();
    var dl = pv("rvCourseList"); if (dl) dl.innerHTML = courseNames().map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
    if (v === "project") drawList();
    if (v === "review") { exams = null; drawExams(); drawRvCur(); }
  }
  ["project", "review"].forEach(function (v) {
    var sec = document.querySelector('.view[data-view="' + v + '"]'); if (!sec) return;
    new MutationObserver(function () { if (sec.classList.contains("on") || sec.classList.contains("v9-float")) onShow(v); }).observe(sec, { attributes: true, attributeFilter: ["class"] });
  });
  window.DeadlinePlan = { replanAll: replanAll, place: place, ruleSteps: ruleSteps, buildReview: buildReview, plans: plans };

  // 打开时、回到页面时：没做完的顺延
  setTimeout(function () { try { replanAll(); } catch (e) { console.warn("[deadline-plan]", e); } }, 2500);
  var lastDay = today();
  document.addEventListener("visibilitychange", function () { if (!document.hidden && today() !== lastDay) { lastDay = today(); try { replanAll(); } catch (e) {} } });
})();
