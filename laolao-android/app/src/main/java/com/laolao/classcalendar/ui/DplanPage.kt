package com.laolao.classcalendar.ui

import android.graphics.Color
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Dplan
import com.laolao.classcalendar.core.DplanCore
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.str
import org.json.JSONObject

/**
 * 7.1 大作业拆解 + 期末复习排期（和网页、小程序一样的规则和数据；排出来的每一步都是普通的「我的事项」）
 * 哪天没做完：下次打开（安卓、网页、小程序都行）会自动顺延到后面几天，不越过截止 / 考试。
 */
class DplanPage(a: Main, private var tab: String = "project") : Page(a) {
    private lateinit var body: LinearLayout
    override val autoRender = false
    private val D = DplanCore
    private val PER = listOf(30, 45, 60, 90, 120, 180); private val RV_PER = listOf(60, 90, 120, 180, 240, 300)
    private val W = listOf("稳了", "一般", "要拼")

    // 大作业表单
    private var title = ""; private var course = ""; private var due = T.addDays(T.todayKey(), 14); private var dueT = "23:59"; private var req = ""
    private var perI = 2; private var time = "20:00"; private val skip = BooleanArray(7)
    private var draft: Dplan.Draft? = null; private var busy = false; private var st = ""; private var stBad = false
    // 复习表单
    private class Ex(var course: String = "", var date: String = "", var time: String = "09:00", var wi: Int = 1)
    private val exams = mutableListOf(Ex()); private var rvPerI = 2; private var rvTime = "19:00"; private var rvStart = Dplan.startDay(); private val rvSkip = BooleanArray(7)
    private var rv: DplanCore.Review? = null; private var rvSt = ""; private var rvBad = false

    override fun build(): View = scaffold("学习计划") { body = it }
    override fun onShow() {
        val cur = Dplan.currentReview()
        if (cur != null && exams.size == 1 && exams[0].course.isEmpty()) {
            exams.clear(); Dplan.examsOf(cur).forEach { exams += Ex(it.course, it.date, it.time, maxOf(0, minOf(2, it.w - 1))) }
            rvPerI = maxOf(0, RV_PER.indexOf(cur.optInt("perDay", 120))); rvTime = cur.str("time").ifEmpty { "19:00" }
        }
        render()
    }

    private fun skipList(b: BooleanArray) = (0..6).filter { b[it] }.map { it + 1 }
    private fun watch(e: EditText, fn: (String) -> Unit): EditText = e.apply {
        addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { fn(s?.toString() ?: "") }
        })
    }
    private fun label(t: String): View = ctx.text(t, 13f, C.sub, SEMI).apply { pad(2, 14, 2, 6) }
    private fun pick(t: String, fn: () -> Unit): View = ctx.row().apply {
        bg(C.mutedBg, 12, C.line); pad(14, 12); tap { fn() }
        addView(ctx.text(t, 15f, C.text), LinearLayout.LayoutParams(0, WRAP, 1f)); addView(ctx.text("⌄", 14f, C.sub))
    }
    private fun bar(pct: Int, color: Int = C.accent): View = ctx.row().apply {
        bg(C.mutedBg, 6); layoutParams = LinearLayout.LayoutParams(MATCH, dp(8))
        val f = View(ctx).apply { bg(color, 6) }
        addView(f, LinearLayout.LayoutParams(0, MATCH, maxOf(0.001f, pct / 100f))); addView(View(ctx), LinearLayout.LayoutParams(0, MATCH, maxOf(0.001f, 1f - pct / 100f)))
    }
    private fun weekRow(b: BooleanArray): View = ctx.row().apply {
        margins(t = 12)
        addView(ctx.text("不排的日子", 12.5f, C.sub).apply { pad(0, 0, 8, 0) })
        for (i in 0..6) addView(ctx.text(D.WD[i].toString(), 13f, if (b[i]) Color.WHITE else C.sub, SEMI).apply {
            gravity = Gravity.CENTER; bg(if (b[i]) C.text else C.mutedBg, 16); tap { b[i] = !b[i]; render() }
        }, LinearLayout.LayoutParams(dp(30), dp(30)).apply { rightMargin = dp(5) })
    }
    private fun status(t: String, bad: Boolean): View = ctx.text(t, 13f, if (bad) C.red else C.sub).apply { margins(t = 10) }

    override fun render() {
        view; keepScroll(body)
        body.addView(Seg(ctx, listOf("🪜 大作业拆解", "🎓 期末复习排期"), if (tab == "review") 1 else 0) { tab = if (it == 1) "review" else "project"; render() })
        if (tab == "review") review() else project()
        body.add(ctx.text("排出来的每一步都是「我的事项」：首页、日历、网页、小程序都能看到；在哪边勾、在哪边改都同步。哪天没做完，下次打开会自动顺延。", 12f, C.sub).apply { pad(4, 0) }, 18)
    }

    // ================= 大作业 =================
    private fun project() {
        val list = Dplan.projects()
        if (list.isNotEmpty()) body.addView(ctx.section("进行中的大作业", "打勾的进度会算进来"))
        for (p in list) {
            val id = p.str("id"); val g = Dplan.progress(id); val left = D.diff(T.todayKey(), p.str("due").take(10))
            val c = ctx.card(16, 18).apply { margins(t = 10) }
            val hr = ctx.row()
            hr.addView(ctx.text(p.str("title"), 16f, C.text, BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
            hr.addView(ctx.chip(if (left < 0) "已截止" else if (left == 0) "今天截止" else "还剩 $left 天", if (left <= 2) Color.parseColor("#c2410c") else C.accent, if (left <= 2) Color.parseColor("#2Eff9a62") else C.selected, 12f))
            c.addView(hr)
            c.add(bar(g.pct), 12)
            val nx = g.next?.let { " · 下一步：" + D.md(it.str("event_time").take(10)) + " " + it.str("subject").substringAfter("｜") } ?: if (g.n > 0) " · 全部完成 🎉" else ""
            c.add(ctx.text("完成 ${g.done}/${g.n} 段 · ${g.pct}%$nx" + (if (p.optInt("shifted") > 0) " · 顺延过 ${p.optInt("shifted")} 次" else ""), 12.5f, C.sub), 8)
            val ops = ctx.row().apply { gravity = Gravity.END; margins(t = 8) }
            ops.addView(ctx.soft("重新排") { Dplan.replanNow(id); a.toast("已按今天重新排好没做的部分 ✓"); render() })
            ops.addView(ctx.soft(if (g.n > 0 && g.done == g.n) "收起" else "删掉", C.mutedBg, C.sub) {
                if (g.n > 0 && g.done == g.n) { Dplan.archive(id); render() }
                else Dialogs.confirm(ctx, "删掉这个计划？", "还没做的步骤会从日程里去掉，已经勾掉的留着。", "删掉", danger = true) { Dplan.archive(id); render() }
            }.apply { margins(l = 8) })
            c.addView(ops)
            body.addView(c)
        }

        body.addView(ctx.section("新的大作业"))
        val f = ctx.card(16, 18)
        f.addView(ctx.text("粘贴老师发的作业要求，捞捞把它拆成几步、倒着排进截止前的每一天。", 13f, C.sub))
        f.addView(label("作业名称")); f.addView(watch(ctx.input("比如：数据库课程设计", title)) { title = it })
        f.addView(label("课程（可不填）")); f.addView(watch(ctx.input("数据库原理", course)) { course = it })
        val dr = ctx.row()
        dr.addView(ctx.col().apply { addView(label("截止日期")); addView(pick(D.md(due)) { Dialogs.pickDate(ctx, due) { due = it; render() } }) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        dr.addView(ctx.col().apply { addView(label("截止时间")); addView(pick(dueT) { Dialogs.pickTime(ctx, dueT) { dueT = it; render() } }) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(10) })
        f.addView(dr)
        f.addView(label("作业要求"))
        f.addView(watch(ctx.input("把群里、学习通里老师发的要求整段粘贴进来：做什么、交什么、字数页数、小组还是个人……", req, multi = true)) { req = it })
        f.addView(label("每天能花"))
        f.addView(Seg(ctx, PER.map { D.mins(it.toDouble()).replace(" 小时", "h").replace(" 分钟", "m").replace("h ", "h") }, perI) { perI = it; if (draft != null) render() })
        f.addView(label("几点开始做")); f.addView(pick(time) { Dialogs.pickTime(ctx, time) { time = it; render() } })
        f.addView(weekRow(skip))
        val br = ctx.row().apply { margins(t = 14) }
        br.addView(ctx.soft("按常见做法拆", C.mutedBg, C.text) { breakDown(false) }, LinearLayout.LayoutParams(0, dp(44), 1f))
        br.addView(ctx.button(if (busy) "AI 拆解中…" else "AI 帮我拆", h = 44) { breakDown(true) }, LinearLayout.LayoutParams(0, dp(44), 1f).apply { leftMargin = dp(10) })
        f.addView(br)
        if (st.isNotEmpty()) f.addView(status(st, stBad))
        body.addView(f)

        val d = draft ?: return
        d.perDay = PER[perI]; d.time = time; d.skip = skipList(skip); d.due = "$due $dueT"
        val res = Dplan.preview(d)
        val c = ctx.card(16, 18).apply { margins(t = 14) }
        val total = d.steps.sumOf { it.m }
        c.addView(ctx.text("拆成 ${d.steps.size} 步", 17f, C.text, BOLD))
        c.add(ctx.text((if (d.src == "ai") "AI 拆的" else "按常见做法拆的") + " · 一共约 " + D.mins(total.toDouble()) + " · 截止 " + D.md(due) + " " + dueT, 12.5f, C.sub), 2)
        d.steps.forEachIndexed { i, s ->
            val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(0, 8) }
            r.addView(ctx.text("${i + 1}", 12f, C.accent, BOLD).apply { gravity = Gravity.CENTER; bg(C.selected, 12) }, LinearLayout.LayoutParams(dp(24), dp(24)))
            r.addView(watch(ctx.input("这一步做什么", s.t)) { s.t = it }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
            r.addView(watch(ctx.input("分钟", s.m.toString(), type = InputType.TYPE_CLASS_NUMBER)) { s.m = it.toIntOrNull()?.coerceIn(5, 900) ?: 30 }.apply { gravity = Gravity.CENTER },
                LinearLayout.LayoutParams(dp(64), WRAP).apply { leftMargin = dp(6) })
            r.addView(ctx.text("×", 20f, C.sub).apply { pad(10, 0); tap { d.steps.removeAt(i); if (d.steps.isEmpty()) d.steps += DplanCore.Step("检查并提交", 15, ""); render() } })
            c.addView(r)
            if (s.d.isNotEmpty()) c.addView(ctx.text(s.d, 12f, C.sub).apply { pad(32, 0, 0, 4) })
        }
        c.addView(ctx.text("＋ 加一步", 14f, C.accent, SEMI).apply { pad(0, 10); tap { d.steps.add(maxOf(0, d.steps.size - 1), DplanCore.Step("新的一步", 30, "")); render() } })
        c.addView(ctx.soft("步骤或分钟改完，点这里重新预览", C.mutedBg, C.sub) { render() })
        c.add(ctx.text("倒排进日程", 15f, C.text, BOLD), 16)
        c.add(ctx.text(if (res.tight) "时间紧：每天要花约 ${D.mins(res.cap)}，比你设的多，可以把截止前的周末也排上" else "每天大约 ${D.mins(minOf(res.cap, d.perDay.toDouble()))}，$time 开始",
            12.5f, if (res.tight) Color.parseColor("#b8650a") else C.sub), 2)
        val byDay = LinkedHashMap<String, MutableList<DplanCore.Seg>>()
        res.segs.forEach { byDay.getOrPut(it.day) { mutableListOf() } += it }
        for ((day, segs) in byDay.toSortedMap()) {
            val r = ctx.row().apply { gravity = Gravity.TOP; pad(0, 6) }
            r.addView(ctx.text(D.md(day) + if (day == T.todayKey()) " · 今天" else "", 12f, C.sub), LinearLayout.LayoutParams(dp(96), WRAP))
            val cc = ctx.col()
            segs.forEach { s -> cc.addView(ctx.text(s.u.subject.substringAfter("｜") + (if (s.part > 0) "（${s.part}/${s.parts}）" else "") + "  " + D.mins(s.min), 13f, C.text).apply { bg(C.selected, 8); pad(8, 4); margins(b = 4) }) }
            r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f)); c.addView(r)
        }
        c.addView(ctx.row().apply { pad(0, 6); addView(ctx.text(D.md(due), 12f, C.sub), LinearLayout.LayoutParams(dp(96), WRAP)); addView(ctx.chip("截止 $dueT", Color.parseColor("#c2410c"), Color.parseColor("#29ff7a45"), 13f)) })
        val ar = ctx.row().apply { margins(t = 12) }
        ar.addView(ctx.soft("算了", C.mutedBg, C.sub) { draft = null; st = ""; render() }, LinearLayout.LayoutParams(0, dp(44), 1f))
        ar.addView(ctx.button("放进我的日程", h = 44) {
            val n = Dplan.saveProject(d)
            draft = null; title = ""; course = ""; req = ""; st = "已放进日程：$n 个时间段 ✓ 首页、日历、网页上都能看到"; stBad = false
            a.toast("已放进日程 ✓"); render()
        }, LinearLayout.LayoutParams(0, dp(44), 1f).apply { leftMargin = dp(10) })
        c.addView(ar)
        c.add(ctx.text("哪天没做完不用管：下次打开捞捞（安卓、网页、小程序都行），没勾的会自动顺延到后面几天，不会越过截止日期。", 12f, C.sub), 10)
        body.addView(c)
    }

    private fun breakDown(useAi: Boolean) {
        if (busy) return
        if (title.isBlank() && req.isBlank()) { st = "先写作业名称，或者把老师的要求粘贴进来"; stBad = true; render(); return }
        if (D.diff(T.todayKey(), due) < 0) { st = "截止日期已经过了"; stBad = true; render(); return }
        val t = title.trim().ifEmpty { req.split(Regex("[\\n，。,.]"))[0].take(20) }
        val daysLeft = maxOf(1, D.diff(Dplan.startDay(), due))
        val per = PER[perI]
        fun done(steps: MutableList<DplanCore.Step>, src: String) {
            draft = Dplan.Draft(t, course.trim(), "$due $dueT", req.trim(), per, time, skipList(skip), steps, src); render()
        }
        if (!useAi) { st = ""; done(D.ruleSteps(t, req, daysLeft, per), "rule"); return }
        if (Store.me == null) { st = "登录后才能用 AI 拆解，先按常见做法拆好了，可以自己改"; stBad = false; done(D.ruleSteps(t, req, daysLeft, per), "rule"); return }
        busy = true; st = "AI 正在拆解（一般 10～30 秒）…"; stBad = false; render()
        val input = jsonOf("title" to t, "requirement" to req.take(5000), "due" to "$due $dueT", "minutes_per_day" to per, "days_left" to daysLeft, "course" to course.trim())
        Bg.load({ Dplan.aiSteps(input) }) { steps, e ->
            busy = false
            if (steps != null && steps.isNotEmpty()) { st = "AI 拆好了，每一步都可以改"; done(steps, "ai") }
            else { st = (e?.message ?: "AI 暂时用不了") + "，先按常见做法拆好了，可以自己改"; stBad = false; done(D.ruleSteps(t, req, daysLeft, per), "rule") }
        }
    }

    // ================= 期末复习 =================
    private fun review() {
        val cur = Dplan.currentReview()
        if (cur != null) {
            val g = Dplan.progress(cur.str("id"))
            val c = ctx.card(16, 18)
            c.addView(ctx.text("现在的复习计划", 16f, C.text, BOLD))
            c.add(ctx.text(Dplan.examsOf(cur).joinToString(" · ") { e -> val l = D.diff(T.todayKey(), e.date); e.course + if (l < 0) " 已考" else if (l == 0) " 今天考" else " $l 天后" }, 12.5f, C.sub), 4)
            c.add(bar(g.pct), 10)
            c.add(ctx.text("完成 ${g.done}/${g.n} 次 · ${g.pct}%" + (g.next?.let { " · 下一次：" + D.md(it.str("event_time").take(10)) + " " + it.str("subject").removePrefix("复习｜") } ?: ""), 12.5f, C.sub), 8)
            val ops = ctx.row().apply { gravity = Gravity.END; margins(t = 8) }
            ops.addView(ctx.soft("重新排") { Dplan.replanNow(cur.str("id")); a.toast("已按今天重新排好没做的部分 ✓"); render() })
            ops.addView(ctx.soft("删掉", C.mutedBg, C.sub) { Dialogs.confirm(ctx, "删掉复习计划？", "还没做的复习从日程里去掉，已经勾掉的留着。", "删掉", danger = true) { Dplan.archive(cur.str("id")); render() } }.apply { margins(l = 8) })
            c.addView(ops); body.add(c, 12)
        }
        val f = ctx.card(16, 18).apply { margins(t = 12) }
        f.addView(ctx.text("填上每门课的考试日期，捞捞排出每天复习什么：先过一遍知识点，再做错题、往年题，考前一天只回顾。几门课交错着来，越急的排得越多。", 13f, C.sub))
        f.add(ctx.text("ℹ️ 安卓 App 读不到网页「课内学习」里的知识框架和错题，这里按通用复习步骤排（梳理框架 → 过课本 → 错题 → 往年题）。在网页的课内学习里建了知识框架、记了错题，用网页生成会按你的知识点排。", 12.5f, C.text).apply { bg(C.selected, 12); pad(12, 10) }, 12)
        val names = try { Courses.list().map { it.optString("name") }.filter { it.isNotBlank() }.distinct() } catch (e: Exception) { emptyList<String>() }
        exams.forEachIndexed { i, e ->
            val box = ctx.col().apply { pad(0, 12, 0, 0) }
            val r1 = ctx.row()
            r1.addView(watch(ctx.input("科目，比如 高等数学", e.course)) { e.course = it }, LinearLayout.LayoutParams(0, WRAP, 1f))
            if (names.isNotEmpty()) r1.addView(ctx.soft("课表", C.mutedBg, C.text) { Dialogs.sheet(ctx, "选科目", names) { k -> e.course = names[k]; render() } }.apply { margins(l = 6) })
            r1.addView(ctx.text("×", 20f, C.sub).apply { pad(10, 0); tap { exams.removeAt(i); if (exams.isEmpty()) exams += Ex(); render() } })
            box.addView(r1)
            val r2 = ctx.row().apply { margins(t = 8) }
            r2.addView(pick(if (e.date.isEmpty()) "考试日期" else D.md(e.date)) { Dialogs.pickDate(ctx, e.date.ifEmpty { T.addDays(T.todayKey(), 7) }) { e.date = it; render() } }, LinearLayout.LayoutParams(0, WRAP, 1.4f))
            r2.addView(pick(e.time) { Dialogs.pickTime(ctx, e.time) { e.time = it; render() } }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
            box.addView(r2)
            box.add(Seg(ctx, W, e.wi) { e.wi = it }, 8)
            f.addView(box)
        }
        f.addView(ctx.text("＋ 再加一门", 14f, C.accent, SEMI).apply { pad(0, 12); tap { exams += Ex(); render() } })
        f.addView(label("每天复习"))
        f.addView(Seg(ctx, RV_PER.map { D.mins(it.toDouble()).replace(" 小时", "h").replace(" 分钟", "m").replace("h ", "h") }, rvPerI) { rvPerI = it; if (rv != null) rvGo() })
        val tr = ctx.row()
        tr.addView(ctx.col().apply { addView(label("几点开始")); addView(pick(rvTime) { Dialogs.pickTime(ctx, rvTime) { rvTime = it; render() } }) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        tr.addView(ctx.col().apply { addView(label("从哪天开始")); addView(pick(D.md(rvStart)) { Dialogs.pickDate(ctx, rvStart) { rvStart = if (D.diff(T.todayKey(), it) >= 0) it else Dplan.startDay(); render() } }) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(10) })
        f.addView(tr)
        f.addView(weekRow(rvSkip))
        f.add(ctx.button("生成复习计划", h = 44) { rvGo() }, 14)
        if (rvSt.isNotEmpty()) f.addView(status(rvSt, rvBad))
        body.addView(f)

        val r = rv ?: return
        val c = ctx.card(16, 18).apply { margins(t = 14) }
        c.addView(ctx.text("${r.days} 天，${r.segs.size} 次复习", 17f, C.text, BOLD))
        c.add(ctx.text(if (r.tight) "有点紧：有几天超过了你设的时长，可以把每天的时间调多一点，或者早点开始" else "每天最多 ${D.mins(RV_PER[rvPerI].toDouble())}，$rvTime 开始", 12.5f, if (r.tight) Color.parseColor("#b8650a") else C.sub), 2)
        val byDay = java.util.TreeMap<String, MutableList<String>>(); val exDay = HashMap<String, MutableList<String>>()
        r.segs.forEach { byDay.getOrPut(it.day) { mutableListOf() } += it.u.subject.removePrefix("复习｜") + "  " + D.mins(it.min) }
        r.exams.forEach { e -> exDay.getOrPut(e.date) { mutableListOf() } += "考试 · ${e.course} ${e.time}"; byDay.getOrPut(e.date) { mutableListOf() } }
        for ((day, lines) in byDay) {
            val row = ctx.row().apply { gravity = Gravity.TOP; pad(0, 6) }
            row.addView(ctx.text(D.md(day), 12f, C.sub), LinearLayout.LayoutParams(dp(96), WRAP))
            val cc = ctx.col()
            lines.forEach { cc.addView(ctx.text(it, 13f, C.text).apply { bg(C.selected, 8); pad(8, 4); margins(b = 4) }) }
            exDay[day]?.forEach { cc.addView(ctx.chip(it, Color.parseColor("#c2410c"), Color.parseColor("#29ff7a45"), 13f).apply { margins(b = 4) }) }
            row.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f)); c.addView(row)
        }
        c.add(ctx.button("放进我的日程", h = 44) {
            val x = Dplan.saveReview(examList(), RV_PER[rvPerI], rvTime, rvStart, skipList(rvSkip)) ?: return@button
            rv = null; rvSt = "已放进日程：${x.first} 次复习、${x.second} 场考试 ✓"; rvBad = false; a.toast("已放进日程 ✓"); render()
        }, 12)
        c.add(ctx.text("考试也会放进日程。哪天没复习完，下次打开捞捞会自动顺延，不会排到考试之后。生成新的计划会替换旧的（已经勾掉的留着）。", 12f, C.sub), 10)
        body.addView(c)
    }
    private fun examList() = exams.map { DplanCore.Exam(it.course.trim(), it.date, it.time, it.wi + 1) }
    private fun rvGo() {
        val start = if (D.diff(T.todayKey(), rvStart) >= 0) rvStart else Dplan.startDay()
        rv = Dplan.buildReview(examList(), RV_PER[rvPerI], start, skipList(rvSkip))
        if (rv == null) { rvSt = "至少填一门还没考的科目和考试日期"; rvBad = true } else { rvSt = ""; rvBad = false }
        render()
    }
}
