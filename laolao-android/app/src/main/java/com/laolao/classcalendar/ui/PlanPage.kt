package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.str
import com.laolao.classcalendar.work.Background

/** 规划与专注：番茄钟（App 关着到点也会提醒）+ 四象限 */
class PlanPage(a: Main, private val pomo: Boolean = false) : Page(a) {
    private lateinit var body: LinearLayout
    private var clock: TextView? = null
    private var ring: TimerRing? = null
    private var modeTv: TextView? = null
    private var lastMode = ""
    private val tick = object : Runnable {
        override fun run() {
            val ended = Plan.tick()
            if (ended == "focus") { Cheer.show(a, "pomo", "今天已经 ${Plan.today()} 个番茄"); Background.pomoAlarm(a) }
            val p = Plan.pomo()
            if (p.mode != lastMode || ended.isNotEmpty()) render() else paintClock()
            Bg.main.postDelayed(this, 1000)
        }
    }

    override fun build(): View = scaffold("规划与专注") { body = it }
    override fun onShow() { Bg.main.removeCallbacks(tick); Bg.main.post(tick) }
    override fun onHide() { Bg.main.removeCallbacks(tick); a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }

    private fun paintClock() {
        val (left, total) = Plan.left()
        clock?.text = Plan.fmt(left)
        ring?.let { it.frac = if (total > 0) left.toFloat() / total else 1f; it.invalidate() }
    }

    override fun render() {
        view
        keepScroll(body)
        val p = Plan.pomo(); lastMode = p.mode
        if (p.mode == "focus") a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        // ---- 番茄钟 ----
        val pc = ctx.card(18, 22).apply { gravity = Gravity.CENTER_HORIZONTAL }
        pc.addView(ctx.text("🍅 番茄钟", 16f, C.text, BOLD).apply { gravity = Gravity.CENTER })
        val col = when (p.mode) { "break" -> C.green; "paused" -> C.gray; else -> C.red }
        val box = android.widget.FrameLayout(ctx)
        val r = TimerRing(ctx, col); ring = r
        box.addView(r, android.widget.FrameLayout.LayoutParams(dp(200), dp(200)))
        val inner = ctx.col().apply { gravity = Gravity.CENTER }
        clock = ctx.text("", 40f, C.text, HEAVY).apply { gravity = Gravity.CENTER; typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD) }
        inner.addView(clock)
        modeTv = ctx.text(when (p.mode) { "focus" -> if (p.task.isNotEmpty()) "专注：" + p.task else "专注中"; "break" -> "休息一下"; "paused" -> "已暂停"; else -> "准备开始" }, 13f, C.sub, lines = 1).apply { gravity = Gravity.CENTER; pad(16, 0) }
        inner.addView(modeTv)
        box.addView(inner, android.widget.FrameLayout.LayoutParams(dp(200), dp(200)))
        pc.add(box, 14)
        paintClock()
        if (p.mode == "idle") {
            pc.add(Seg(ctx, listOf("15 分钟", "25 分钟", "45 分钟"), listOf(15, 25, 45).indexOf(p.len)) { i -> Plan.setLen(listOf(15, 25, 45)[i]); render() }, 16)
            val task = ctx.input("这个番茄做什么？（可不填）", p.task).apply { margins(t = 10) }
            pc.addView(task, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(10) })
            pc.add(ctx.button("开始专注 ${p.len} 分钟", C.red) { Dialogs.hideKeyboard(task); Plan.start(task.text.toString().trim()); Background.pomoAlarm(a); render() }, 14)
        } else {
            val br = ctx.row().apply { margins(t = 16) }
            when (p.mode) {
                "focus" -> br.addView(ctx.button("暂停", C.selected, C.accent) { Plan.pause(); Background.pomoAlarm(a); render() }, LinearLayout.LayoutParams(0, dp(46), 1f))
                "paused" -> br.addView(ctx.button("继续", C.red) { Plan.start(null); Background.pomoAlarm(a); render() }, LinearLayout.LayoutParams(0, dp(46), 1f))
                "break" -> br.addView(ctx.button("跳过休息", C.selected, C.accent) { Plan.start(null); Background.pomoAlarm(a); render() }, LinearLayout.LayoutParams(0, dp(46), 1f))
            }
            br.addView(ctx.button("结束", C.mutedBg, C.sub) {
                Dialogs.confirm(ctx, "结束这个番茄？", if (p.mode == "focus") "还没到点，这个番茄不算数。" else "", "结束", danger = true) { Plan.stop(); Background.pomoAlarm(a); render() }
            }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { leftMargin = dp(10) })
            pc.addView(br, LinearLayout.LayoutParams(MATCH, WRAP))
        }
        // 最近 7 天
        val log = Plan.log(); val t = T.todayKey()
        val days = (6 downTo 0).map { T.addDays(t, -it.toLong()) }
        val mx = maxOf(4, days.maxOf { log.optInt(it) })
        val bars = ctx.row().apply { gravity = Gravity.BOTTOM; margins(t = 18) }
        for (d in days) {
            val c = ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL or Gravity.BOTTOM }
            val n = log.optInt(d)
            c.addView(ctx.text(if (n > 0) "$n" else "", 11f, C.sub).apply { gravity = Gravity.CENTER })
            c.addView(View(ctx).apply { bg(if (d == t) C.red else C.alpha(C.red, 0.35f), 4) }, LinearLayout.LayoutParams(dp(16), maxOf(dp(3), dp(56) * n / mx)))
            c.addView(ctx.text(if (d == t) "今" else T.wk(d).substring(1), 11f, if (d == t) C.text else C.sub).apply { gravity = Gravity.CENTER; margins(t = 3) })
            bars.addView(c, LinearLayout.LayoutParams(0, dp(90), 1f))
        }
        pc.addView(bars, LinearLayout.LayoutParams(MATCH, WRAP))
        pc.add(ctx.text("今天 ${Plan.today()} 个番茄 · 最近 7 天 ${Plan.week()} 个", 12.5f, C.sub).apply { gravity = Gravity.CENTER }, 6)
        body.addView(pc)
        body.add(ctx.text("番茄工作法：选一件事，专注 25 分钟不看手机，然后休息 5 分钟。App 关着到点也会提醒你。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.35f); pad(4, 0) }, 10)

        // ---- 时间管理方法：四象限 / PDCA / SMART / 六件事（和网页、小程序同步） ----
        val cur = Plan.cur(); val mi = Plan.METHODS.indexOfFirst { it.id == cur }
        body.addView(ctx.section("时间管理方法", Plan.METHODS[mi].tag))
        body.addView(Seg(ctx, Plan.METHODS.map { it.name }, mi) { i -> Plan.setCur(Plan.METHODS[i].id); render() })
        body.add(ctx.text(Plan.METHODS[mi].intro, 12.5f, C.sub).apply { setLineSpacing(0f, 1.35f); bg(C.mutedBg, 12); pad(12, 10) }, 10)
        when (cur) { "pdca" -> { pdca(); return }; "smart" -> { smart(); return }; "ivy" -> { ivy(); return } }
        body.addView(ctx.space(10))
        val qs = Plan.quads()
        val qc = listOf(C.red, C.accent, C.c("#d4a017"), C.gray)
        Plan.QUADS.forEachIndexed { i, (name, act, desc) ->
            val c = ctx.card(14, 18).apply { margins(t = if (i == 0) 0 else 10) }
            val h = ctx.row()
            h.addView(ctx.text("${i + 1}", 13f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; bg(qc[i], 7) }, LinearLayout.LayoutParams(dp(22), dp(22)))
            h.addView(ctx.text(name, 15f, C.text, BOLD).apply { pad(8, 0) })
            h.addView(ctx.chip(act, qc[i], C.alpha(qc[i], 0.12f), 11.5f).apply { pad(7, 2) })
            h.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
            h.addView(ctx.text("＋", 18f, C.accent, BOLD).apply { pad(10, 0, 4, 0); tap { Dialogs.prompt(ctx, "加到「$name」", "", "要做的事") { s -> if (s.isNotBlank()) Plan.addTodo(s, i + 1) } } })
            c.addView(h)
            c.addView(ctx.text(desc, 12f, C.sub).apply { margins(t = 4) })
            val list = qs[i]
            if (list.isEmpty()) c.add(ctx.text("暂时没有", 13f, C.mutedText), 8)
            for (r in list.take(12)) {
                val row = ctx.row().apply { pad(0, 8, 0, 0) }
                row.addView(a.check(r.done) { a.toggle(r) }, LinearLayout.LayoutParams(dp(20), dp(20)).apply { rightMargin = dp(10) })
                row.addView(ctx.text(r.title, 14f, if (r.done) C.mutedText else C.text, lines = 1), LinearLayout.LayoutParams(0, WRAP, 1f))
                if (r.dated) row.addView(ctx.text(T.dayName(r.day).let { s -> if (T.dayDiff(r.day) < 0 && !r.done) "已过期" else s }, 12f, if (T.dayDiff(r.day) < 0 && !r.done) C.red else C.sub))
                row.tap { Dialogs.sheet(ctx, r.title, Plan.QUADS.mapIndexed { k, q -> (if (k == i) "✓ " else "放到 ") + "${k + 1} ${q.first}" } + "查看详情") { k -> if (k < 4) Plan.move(r.key, k + 1) else a.push(ItemPage(a, r.key)) } }
                c.addView(row)
            }
            if (list.size > 12) c.add(ctx.text("还有 ${list.size - 12} 项", 12f, C.sub), 6)
            body.addView(c)
        }
        body.add(ctx.text("点一项可以换象限；放进哪个象限会同步到网页和小程序。", 12f, C.sub).apply { gravity = Gravity.CENTER }, 12)
    }

    // ---------- PDCA ----------
    private fun pdca() {
        body.add(ctx.button("＋ 新的 PDCA 计划", C.selected, C.accent) { Dialogs.prompt(ctx, "想改进的一件事", "", "比如：四级听力提到 150 分") { t -> if (t.isNotBlank()) { Plan.pdcaAdd(t); render() } } }, 12)
        val l = Plan.notesOf("pdca:")
        if (l.isEmpty()) body.addView(ctx.empty("🔄", "还没有 PDCA 计划", "适合备考、学技能、准备比赛这类需要反复改进的事"))
        for ((k, x) in l) {
            val c = ctx.card(14, 18).apply { margins(t = 10) }
            val hr = ctx.row()
            hr.addView(ctx.text(x.str("title"), 16f, C.text, BOLD), LinearLayout.LayoutParams(0, WRAP, 1f))
            hr.addView(ctx.chip("第 ${x.optInt("round", 1)} 轮", C.accent, C.selected, 12f).apply { pad(8, 2) })
            hr.addView(ctx.text("⋯", 20f, C.sub).apply { pad(10, 0, 0, 0); tap { Dialogs.sheet(ctx, x.str("title"), listOf("改名字", "删除"), danger = setOf(1)) { i -> if (i == 0) Dialogs.prompt(ctx, "改名字", x.str("title"), "") { t -> if (t.isNotBlank()) { Plan.patch(k, "title", t); render() } } else Dialogs.confirm(ctx, "删除这个计划？", "", "删除", danger = true) { Plan.setNote(k, null); render() } } } })
            c.addView(hr)
            val stage = x.optInt("stage")
            val sr = ctx.row().apply { margins(t = 10) }
            Plan.PD.forEachIndexed { i, (_, n, _) -> sr.addView(ctx.text(n, 12.5f, if (i <= stage) Color.WHITE else C.sub, SEMI).apply { gravity = Gravity.CENTER; pad(0, 6); bg(if (i == stage) C.accent else if (i < stage) C.alpha(C.accent, 0.55f) else C.mutedBg, 10) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) leftMargin = dp(4) }) }
            c.addView(sr)
            Plan.PD.forEachIndexed { i, (f, n, h) ->
                if (i > stage) return@forEachIndexed
                c.add(ctx.text(n, 13f, C.text, BOLD), 10)
                c.add(ctx.text(x.str(f).ifEmpty { "点这里写：$h" }, 14f, if (x.str(f).isEmpty()) C.mutedText else C.text).apply { bg(C.mutedBg, 10); pad(12, 9); tap { Dialogs.prompt(ctx, n, x.str(f), h, multi = true) { v -> Plan.patch(k, f, v); render() } } }, 4)
            }
            val br = ctx.row().apply { margins(t = 12) }
            if (stage < 3) br.addView(ctx.soft("进入下一步：" + Plan.PD[stage + 1].second) { Plan.pdcaNext(k); render() }, LinearLayout.LayoutParams(0, dp(40), 1f))
            else br.addView(ctx.soft("开始第 ${x.optInt("round", 1) + 1} 轮") { Plan.pdcaRound(k); a.toast("新一轮开始，上一轮的改进已经带过来了"); render() }, LinearLayout.LayoutParams(0, dp(40), 1f))
            c.addView(br)
            body.addView(c)
        }
    }

    // ---------- SMART ----------
    private fun smart() {
        body.add(ctx.button("＋ 新的 SMART 目标", C.selected, C.accent) { Dialogs.prompt(ctx, "想达成的目标", "", "比如：学好英语") { t -> if (t.isNotBlank()) { Plan.smartAdd(t); render() } } }, 12)
        val l = Plan.notesOf("smart:")
        if (l.isEmpty()) body.addView(ctx.empty("🏹", "还没有目标", "把模糊的愿望变成能落地的目标"))
        for ((k, x) in l) {
            val c = ctx.card(14, 18).apply { margins(t = 10) }
            val hr = ctx.row()
            hr.addView(a.check(x.optBoolean("done")) { val d = Plan.smartDone(k); if (d) Cheer.show(a, "item", "目标达成 🎯"); render() }, LinearLayout.LayoutParams(dp(22), dp(22)))
            hr.addView(ctx.text(x.str("title"), 16f, if (x.optBoolean("done")) C.mutedText else C.text, BOLD).apply { pad(10, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            hr.addView(ctx.text("⋯", 20f, C.sub).apply { tap { Dialogs.sheet(ctx, x.str("title"), listOf("改名字", "删除"), danger = setOf(1)) { i -> if (i == 0) Dialogs.prompt(ctx, "改名字", x.str("title"), "") { t -> if (t.isNotBlank()) { Plan.patch(k, "title", t); render() } } else Dialogs.confirm(ctx, "删除这个目标？", "", "删除", danger = true) { Plan.setNote(k, null); render() } } } })
            c.addView(hr)
            val miss = Plan.smartMissing(x)
            c.add(ctx.text(if (miss.isEmpty()) "✓ 五点都写清楚了" else "还差：" + miss.joinToString("、"), 12.5f, if (miss.isEmpty()) C.green else C.red), 6)
            for ((f, n, h) in Plan.SM) {
                c.add(ctx.text(n, 13f, C.text, BOLD), 8)
                c.add(ctx.text(x.str(f).ifEmpty { "点这里写：$h" }, 14f, if (x.str(f).isEmpty()) C.mutedText else C.text).apply { bg(C.mutedBg, 10); pad(12, 9); tap { Dialogs.prompt(ctx, n, x.str(f), h, multi = true) { v -> Plan.patch(k, f, v); render() } } }, 4)
            }
            c.add(ctx.text("T 有时限", 13f, C.text, BOLD), 8)
            c.add(ctx.text(if (x.str("t").isNotEmpty()) "截止 " + T.md(x.str("t")) + " " + T.wk(x.str("t")) else "点这里选截止日期", 14f, if (x.str("t").isEmpty()) C.mutedText else C.text).apply { bg(C.mutedBg, 10); pad(12, 9); tap { Dialogs.pickDate(ctx, x.str("t")) { d -> Plan.patch(k, "t", d); render() } } }, 4)
            if (x.str("t").isNotEmpty()) c.add(ctx.soft(if (Plan.inCal(k)) "已放进日历 · 点这里更新" else "📅 放进日历（到期提醒）") { Plan.smartToCal(k); a.toast("已放进「我的事项」"); render() }, 10)
            body.addView(c)
        }
    }

    // ---------- 六件事 ----------
    private var ivyDay = ""
    private fun ivy() {
        val t = T.todayKey(); if (ivyDay.isEmpty()) ivyDay = t
        val dr = ctx.row().apply { margins(t = 12) }
        for ((d, n) in listOf(t to "今天", T.addDays(t, 1) to "明天")) dr.addView(ctx.text(n + " " + T.md(d), 14f, if (ivyDay == d) Color.WHITE else C.text, SEMI).apply { gravity = Gravity.CENTER; pad(0, 9); bg(if (ivyDay == d) C.accent else C.card, 12, if (ivyDay == d) 0 else C.line); tap { ivyDay = d; render() } }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (dr.childCount > 0) leftMargin = dp(8) })
        body.addView(dr)
        val l = Plan.ivy(ivyDay)
        val c = ctx.card(4, 18).apply { margins(t = 10) }
        l.forEachIndexed { i, x ->
            if (i > 0) c.addView(ctx.hline())
            val r = ctx.row().apply { pad(14, 10) }
            r.addView(ctx.text("${i + 1}", 13f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; bg(if (i == 0) C.red else C.accent, 7) }, LinearLayout.LayoutParams(dp(22), dp(22)))
            r.addView(ctx.text(x.str("text").ifEmpty { "写下第 ${i + 1} 重要的事" }, 15f, if (x.str("text").isEmpty()) C.mutedText else if (x.optBoolean("done")) C.mutedText else C.text).apply { pad(10, 0); if (x.optBoolean("done")) paintFlags = paintFlags or android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
                tap { Dialogs.prompt(ctx, "第 ${i + 1} 件事", x.str("text"), "按重要程度排，第 1 件最重要") { v -> l[i] = org.json.JSONObject().put("text", v.trim()).put("done", x.optBoolean("done") && v.isNotBlank()); Plan.ivySet(ivyDay, l); render() } } }, LinearLayout.LayoutParams(0, WRAP, 1f))
            if (x.str("text").isNotEmpty()) r.addView(a.check(x.optBoolean("done")) { l[i].put("done", !x.optBoolean("done")); Plan.ivySet(ivyDay, l); render() }, LinearLayout.LayoutParams(dp(22), dp(22)))
            c.addView(r)
        }
        body.addView(c)
        if (ivyDay == t && l.any { it.str("text").isNotEmpty() && !it.optBoolean("done") })
            body.add(ctx.soft("没做完的挪到明天") { val n = Plan.ivyMoveLeft(); a.toast("挪了 $n 件到明天"); render() }, 12)
        body.add(ctx.text("一次只做一件：从第 1 件开始，做完再做下一件。", 12.5f, C.sub).apply { gravity = Gravity.CENTER }, 10)
    }
}

/** 番茄钟的圆环（剩下的部分） */
class TimerRing(ctx: Context, private val color: Int) : View(ctx) {
    var frac = 1f
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    override fun onDraw(c: Canvas) {
        val d = resources.displayMetrics.density; val w = 10 * d
        val r = RectF(w / 2, w / 2, width - w / 2, height - w / 2)
        p.strokeWidth = w; p.color = C.alpha(color, 0.13f); c.drawArc(r, 0f, 360f, false, p)
        p.color = color; c.drawArc(r, -90f, 360f * frac.coerceIn(0f, 1f), false, p)
    }
}
