package com.laolao.classcalendar.ui

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Lesson
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.str
import org.json.JSONObject
import java.io.File
import java.time.LocalDate

/**
 * 课程表（照小程序「课程表」：周视图 + 今天 / 某一天的时间线、加课改课删课、调课调休、作息时间、第 1 周、班级课表、存成图片）
 * 课表存在云端，在这里改完马上同步到网页、小程序、邮件提醒和手机日历订阅
 */
class CoursePage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var week = 0
    private var dayView = false
    private var dayIdx = -1
    private var src = "mine"                 // mine / class
    private var cls: JSONObject? = null; private var clsErr = ""; private var clsLoaded = false
    private var busy = false
    private var slide = 0                    // 换周时的滑动方向（动画）
    override val autoRender = false

    override fun build(): View = scaffold("课程表", ctx.text("⋯", 22f, C.text, BOLD).apply { gravity = Gravity.CENTER; press(0, 12); tap { more() } }.also { it.layoutParams = LinearLayout.LayoutParams(dp(44), dp(40)) },
        pull = { done -> Bg.load({ Courses.pull(force = true) }) { _, e -> done(); if (e != null) a.toast(e.message ?: "") else render() } }) { body = it }
    override fun onShow() { if (System.currentTimeMillis() - Courses.syncedAt() > 60_000) Bg.load({ Courses.pull(force = true) }) { ch, _ -> if (ch == true) render() } }

    private val clsId: String? get() = Store.cls?.str("id")
    private val canPublish: Boolean get() = Store.isTeacher || Store.can("can_edit")
    private fun courses(): List<JSONObject> = if (src == "class") cls?.let { Courses.classCourses(it) } ?: emptyList() else Courses.list()
    private fun w1(): LocalDate = if (src == "class") cls?.optJSONObject("meta")?.str("week1")?.let { T.date(it) }?.let { it.minusDays((it.dayOfWeek.value - 1).toLong()) } ?: Courses.week1() else Courses.week1()
    private fun tms(): List<String> = if (src == "class") cls?.optJSONObject("meta")?.optJSONArray("times")?.let { t -> (0 until t.length()).map { t.optString(it) } }?.takeIf { it.size >= 4 } ?: Courses.times() else Courses.times()
    private fun lessonsOn(k: String): List<Lesson> = if (src == "class") Courses.onFor(courses(), k, w1(), tms()) else Courses.on(k)
    private fun curWeek(): Int { val w = Math.floorDiv(java.time.temporal.ChronoUnit.DAYS.between(w1(), T.today()), 7L).toInt() + 1; return if (w in 1..Courses.MAX_WEEK) w else 0 }

    override fun render() {
        view
        keepScroll(body)
        // 我的课表 / 班级课表
        if (clsId != null) {
            body.addView(Seg(ctx, listOf("我的课表", "班级课表"), if (src == "class") 1 else 0) { i -> src = if (i == 1) "class" else "mine"; week = 0; if (i == 1 && !clsLoaded) loadClass(); render() }.apply { margins(b = 12) })
        }
        if (src == "class") { classBar(); if (cls == null) return }
        else if (!Courses.has()) { start(); return }
        if (week == 0) week = curWeek().takeIf { it > 0 } ?: 1
        hero()
        if (src == "mine") actions()
        body.add(Seg(ctx, listOf("整周", "按天看"), if (dayView) 1 else 0) { i -> dayView = i == 1; render() }, 12)
        val monday = w1().plusWeeks((week - 1).toLong())
        val days = (0 until 7).map { monday.plusDays(it.toLong()) }
        if (dayView) dayList(days) else grid(days)
        // 这周的调课
        val notes = if (src == "mine") days.mapNotNull { d -> Courses.dayNote(T.key(d)).takeIf { it.isNotEmpty() }?.let { T.wk(d) + "：" + it } } else emptyList()
        if (notes.isNotEmpty()) body.add(ctx.row().apply { pad(14, 11); bg(C.selected, 14); tap { adjust() }
            addView(ctx.text("🔁", 15f)); addView(ctx.text(notes.joinToString("；"), 13f, C.accent, SEMI).apply { pad(8, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f)); addView(ctx.text("›", 16f, C.accent)) }, 12)
        // 底部
        val n = courses().size
        val shown = days.sumOf { lessonsOn(T.key(it)).size }
        body.add(ctx.text("共 $n 门课 · 这周 $shown 节" + if (src == "mine") "\n☁ 课表存在云端，网页、小程序、这里是同一份" + (if (Courses.syncedAt() > 0) " · " + T.ago(Courses.syncedAt()) + "同步" else "") else "", 12f, C.sub).apply { gravity = Gravity.CENTER; setLineSpacing(0f, 1.4f) }, 14)
        if (src == "mine") body.add(ctx.text("⚙ 作息时间、第 1 周、学期 ›", 13f, C.accent, SEMI).apply { gravity = Gravity.CENTER; pad(0, 10); tap { settings() } }, 4)
    }

    // ---------- 还没有课：三个清楚的入口 ----------
    private fun start() {
        val c = ctx.card(16, 20)
        c.addView(ctx.text("还没有课程，选一种方式开始", 16f, C.text, BOLD))
        fun opt(ic: String, t: String, s: String, pri: Boolean, fn: () -> Unit) = c.add(ctx.row().apply {
            pad(14, 14); if (pri) background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(C.mix(C.accent, Color.WHITE, 0.15f), C.accent)).apply { cornerRadius = dp(16).toFloat() } else bg(C.mutedBg, 16)
            springy(); tap { fn() }
            addView(ctx.text(ic, 24f)); addView(ctx.col().apply { pad(12, 0); addView(ctx.text(t, 15f, if (pri) Color.WHITE else C.text, BOLD)); addView(ctx.text(s, 12f, if (pri) C.alpha(Color.WHITE, 0.85f) else C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(ctx.text("›", 18f, if (pri) Color.WHITE else C.sub)) }, 12)
        opt("📷", "拍照 / 截图导入", "教务系统、课表 App 截图都行，自动识别", true) { a.push(CourseImportPage(a)) }
        if (clsId != null) opt("🏫", "用班级课表", "老师或班委发布过的话，一键套用", false) { src = "class"; if (!clsLoaded) loadClass(); render() }
        opt("✍️", "手动添加", "一门一门填，也可以长按表格空白处", false) { form(null, 0, 1) }
        body.addView(c)
    }

    // ---------- 顶部：第几周 + 周次条 ----------
    private fun hero() {
        val monday = w1().plusWeeks((week - 1).toLong())
        val cur = curWeek(); val isCur = week == cur
        val h = FrameLayout(ctx).apply { background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(C.mix(C.accent, Color.WHITE, 0.12f), C.mix(C.accent, Color.BLACK, 0.15f))).apply { cornerRadius = dp(22).toFloat() }; clipToOutline = true }
        h.addView(object : View(ctx) { val pt = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = ctx.dp(1).toFloat() }
            override fun onDraw(c: Canvas) { pt.color = C.alpha(Color.WHITE, 0.18f); c.drawCircle(width + dp(20).toFloat(), dp(10).toFloat(), dp(110).toFloat(), pt); pt.color = C.alpha(Color.WHITE, 0.12f); c.drawCircle(width - dp(10).toFloat(), dp(30).toFloat(), dp(60).toFloat(), pt) } }, FrameLayout.LayoutParams(MATCH, MATCH))
        val c = ctx.col().apply { pad(18, 16, 18, 14) }
        val top = ctx.row()
        val tc = ctx.col()
        val sem = if (src == "class") cls?.str("title")?.ifEmpty { null } ?: "班级课表" else Courses.semester().ifEmpty { "本学期" }
        tc.addView(ctx.text(sem + "  ·  " + T.md(monday) + " – " + T.md(monday.plusDays(6)), 12f, C.alpha(Color.WHITE, 0.85f), SEMI, 1).apply { if (src == "mine") tap { semester() } })
        tc.addView(ctx.text("第 $week 周", 30f, Color.WHITE, HEAVY).apply { margins(t = 2) })
        val today = T.todayKey(); val tl = lessonsOn(today)
        val nowM = T.now().hour * 60 + T.now().minute
        val next = tl.firstOrNull { (it.m1 ?: 0) > nowM }
        tc.addView(ctx.text(when {
            !isCur -> if (cur == 0) "现在不在学期内" else if (week < cur) "已经过去 ${cur - week} 周" else "还有 ${week - cur} 周"
            tl.isEmpty() -> "今天没课，好好安排自己的时间 ☕"
            next == null -> "今天的 ${tl.size} 节课都上完啦 🎉"
            (next.m0 ?: 0) <= nowM -> "正在上「${next.name}」" + (if (next.location.isNotEmpty()) " · " + next.location else "")
            else -> "下节「${next.name}」" + ((next.m0 ?: 0) - nowM).let { m -> if (m < 60) " · $m 分钟后" else " · " + next.t0 } + if (next.location.isNotEmpty()) " · " + next.location else ""
        }, 13f, Color.WHITE).apply { margins(t = 4) })
        top.addView(tc, LinearLayout.LayoutParams(0, WRAP, 1f))
        fun nav(t: String, fn: () -> Unit) = top.addView(ctx.text(t, 20f, Color.WHITE, BOLD).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(C.alpha(Color.WHITE, 0.2f)) }; tap { it.buzz(); fn() } }, LinearLayout.LayoutParams(dp(38), dp(38)).apply { leftMargin = dp(8) })
        nav("‹") { go(week - 1) }; nav("›") { go(week + 1) }
        c.addView(top)
        // 周次条
        val hs = HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; margins(t = 12) }
        val r = ctx.row()
        var selV: View? = null
        for (w in 1..Courses.MAX_WEEK) {
            val on = w == week
            val v = ctx.col().apply { gravity = Gravity.CENTER; pad(0, 5)
                background = round(if (on) Color.WHITE else C.alpha(Color.WHITE, 0.14f), dp(12).toFloat())
                addView(ctx.text("$w", 15f, if (on) C.accent else Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER })
                addView(ctx.text(if (w == cur) "本周" else "周", 9.5f, if (on) C.accent else C.alpha(Color.WHITE, 0.8f)).apply { gravity = Gravity.CENTER })
                tap { go(w) } }
            if (on) { selV = v; v.lift(4, Color.BLACK) }
            r.addView(v, LinearLayout.LayoutParams(dp(42), WRAP).apply { rightMargin = dp(6) })
        }
        r.clipChildren = false; r.setPadding(0, dp(2), 0, dp(6)); hs.clipToPadding = false
        hs.addView(r); c.addView(hs)
        selV?.let { sv -> hs.post { hs.scrollTo(maxOf(0, sv.left - hs.width / 2 + sv.width / 2), 0) } }
        if (isCur.not() && cur > 0) c.addView(ctx.text("回到本周", 12.5f, Color.WHITE, BOLD).apply { pad(12, 5); background = round(C.alpha(Color.WHITE, 0.2f), dp(12).toFloat()); tap { go(cur) } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(10) })
        h.addView(c, FrameLayout.LayoutParams(MATCH, WRAP))
        h.lift(14)
        body.addView(h, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dp(4) })
    }
    private fun go(w: Int) { if (w < 1 || w > Courses.MAX_WEEK || w == week) return; slide = if (w > week) 1 else -1; week = w; render() }

    // ---------- 常用操作 ----------
    private fun actions() {
        val r = ctx.row().apply { margins(t = 10); clipChildren = false; clipToPadding = false; setPadding(dp(2), dp(4), dp(2), dp(8)) }
        val nAdj = Courses.adjList().count { it.str("date") >= T.todayKey() }
        listOf(Triple("📷", "导入") { a.push(CourseImportPage(a)) }, Triple("＋", "加课") { form(null, 0, 1) }, Triple("🔁", "调课调休") { adjust() }, Triple("🖼", "存图片") { shareImage() }).forEachIndexed { i, (ic, t, fn) ->
            val f = FrameLayout(ctx)
            f.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; pad(4, 10); bg(C.card, 16, C.line); springy(); tap { fn() }
                addView(ctx.text(ic, 19f, if (ic == "＋") C.accent else C.text, BOLD).apply { gravity = Gravity.CENTER }); addView(ctx.text(t, 12f, C.text, SEMI, 1).apply { gravity = Gravity.CENTER; margins(t = 2) }); lift(3, C.text) }, FrameLayout.LayoutParams(MATCH, WRAP))
            if (i == 2 && nAdj > 0) f.addView(ctx.text("$nAdj", 10.5f, Color.WHITE, BOLD).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(C.red) } }, FrameLayout.LayoutParams(dp(18), dp(18)).apply { gravity = Gravity.END or Gravity.TOP; topMargin = dp(4); rightMargin = dp(6) })
            f.clipChildren = false; f.clipToPadding = false
            r.addView(f, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) leftMargin = dp(8) })
        }
        body.addView(r)
    }

    // ---------- 整周格子 ----------
    private fun grid(days: List<LocalDate>) {
        val lessons = days.map { lessonsOn(T.key(it)) }
        // 周末没课就不占地方，五天的格子更宽、字更清楚
        val showWeekend = lessons[5].isNotEmpty() || lessons[6].isNotEmpty()
        val n = if (showWeekend) 7 else 5
        val card = ctx.card(4, 20).apply { margins(t = 12, b = 4); lift(5, C.text) }
        val g = WeekGrid(ctx, days.take(n), lessons.take(n), tms(), week == curWeek(), { d, l -> detail(d, l) }, { d, p -> if (src == "mine") form(null, d.dayOfWeek.value - 1, p) })
        g.onSwipe = { dir -> go(week + dir) }
        card.addView(g)
        body.addView(card)
        if (slide != 0) { g.translationX = slide * dp(60).toFloat(); g.alpha = 0f; g.animate().translationX(0f).alpha(1f).setDuration(220).start(); slide = 0 }
        body.add(ctx.text(if (src == "class") "班级课表只能查看；点「用到我的课表」后可以自己改" else "点课程看详情 · 长按空白格子加课 · 左右滑动换周" + if (!showWeekend) " · 这周周末没课" else "", 11.5f, C.mutedText).apply { gravity = Gravity.CENTER }, 8)
    }

    // ---------- 按天看：时间线 ----------
    private fun dayList(days: List<LocalDate>) {
        if (dayIdx !in 0..6) dayIdx = if (week == curWeek()) T.today().dayOfWeek.value - 1 else 0
        val r = ctx.row().apply { margins(t = 12) }
        days.forEachIndexed { i, d ->
            val on = i == dayIdx; val n = lessonsOn(T.key(d)).size
            r.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; pad(0, 8); bg(if (on) C.accent else C.card, 14, if (on) 0 else C.line); tap { dayIdx = i; render() }
                addView(ctx.text(T.wk(d).substring(1), 13f, if (on) Color.WHITE else C.text, BOLD)); addView(ctx.text("${d.dayOfMonth}", 11f, if (on) C.alpha(Color.WHITE, 0.85f) else C.sub))
                addView(View(ctx).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (n == 0) Color.TRANSPARENT else if (on) Color.WHITE else C.accent) } }, LinearLayout.LayoutParams(dp(5), dp(5)).apply { topMargin = dp(3) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) leftMargin = dp(5) })
        }
        body.addView(r)
        val d = days[dayIdx]; val k = T.key(d); val l = lessonsOn(k)
        val isToday = d == T.today(); val nowM = T.now().hour * 60 + T.now().minute
        val note = if (src == "mine") Courses.dayNote(k) else ""
        if (note.isNotEmpty()) body.add(ctx.text("🔁 $note", 13f, C.accent, SEMI).apply { bg(C.selected, 12); pad(12, 8) }, 10)
        if (l.isEmpty()) { body.addView(ctx.empty("☕", T.dayName(k) + "没有课", "可以好好安排自己的时间")); return }
        var prevEnd = -1
        for (x in l) {
            val m0 = x.m0 ?: 0; val m1 = x.m1 ?: 0
            if (prevEnd > 0 && m0 - prevEnd >= 60) body.add(ctx.text(if (prevEnd < 13 * 60 && m0 >= 13 * 60) "🍱 午休 ${(m0 - prevEnd) / 60} 小时${if ((m0 - prevEnd) % 60 > 0) " ${(m0 - prevEnd) % 60} 分" else ""}" else "空 ${(m0 - prevEnd) / 60} 小时${if ((m0 - prevEnd) % 60 > 0) " ${(m0 - prevEnd) % 60} 分" else ""}", 12f, C.mutedText).apply { gravity = Gravity.CENTER; pad(0, 4) }, 8)
            prevEnd = m1
            val past = isToday && m1 <= nowM; val now = isToday && m0 <= nowM && nowM < m1
            val col = Courses.color(x.name)
            val row = ctx.row().apply { gravity = Gravity.TOP; margins(t = 10); alpha = if (past) 0.6f else 1f; clipChildren = false; clipToPadding = false; setPadding(0, 0, dp(2), dp(4)) }
            row.addView(ctx.col().apply { gravity = Gravity.END
                addView(ctx.text(x.t0, 14f, C.text, BOLD)); addView(ctx.text(x.t1, 11.5f, C.sub)); addView(ctx.text("${x.start}-${x.end} 节", 10.5f, C.mutedText).apply { margins(t = 2) }) }, LinearLayout.LayoutParams(dp(52), WRAP))
            val card = ctx.col().apply { pad(14, 12)
                background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(C.alpha(col, if (C.dark) 0.35f else 0.18f), C.alpha(col, if (C.dark) 0.18f else 0.07f))).apply { cornerRadius = dp(16).toFloat(); if (now) setStroke(dp(2), col) }
                springy(); tap { detail(d, x) }; lift(if (now) 8 else 3, col) }
            val nr = ctx.row()
            nr.addView(ctx.text(x.name, 16f, C.text, BOLD, 2), LinearLayout.LayoutParams(0, WRAP, 1f))
            if (now) nr.addView(ctx.text("上课中", 11f, Color.WHITE, BOLD).apply { pad(8, 2); bg(col, 8) })
            else if (isToday && !past && m0 - nowM in 0..180) nr.addView(ctx.text("${m0 - nowM} 分钟后", 11f, col, BOLD).apply { pad(8, 2); bg(C.alpha(col, 0.15f), 8) })
            if (x.add) nr.addView(ctx.text("加课", 11f, C.green, BOLD).apply { pad(6, 2) })
            if (x.from.isNotEmpty()) nr.addView(ctx.text("调课", 11f, C.accent, BOLD).apply { pad(6, 2) })
            card.addView(nr)
            val meta = listOf(if (x.location.isNotEmpty()) "📍 " + x.location else "", if (x.teacher.isNotEmpty()) "👤 " + x.teacher else "").filter { it.isNotEmpty() }.joinToString("    ")
            if (meta.isNotEmpty()) card.add(ctx.text(meta, 13f, C.sub), 4)
            if (now) { val bx = FrameLayout(ctx).apply { bg(C.alpha(col, 0.2f), 3) }; bx.addView(View(ctx).apply { bg(col, 3) }, FrameLayout.LayoutParams(0, MATCH)); card.addView(bx, LinearLayout.LayoutParams(MATCH, dp(5)).apply { topMargin = dp(8) })
                bx.post { bx.getChildAt(0).layoutParams = bx.getChildAt(0).layoutParams.apply { width = bx.width * (nowM - m0) / maxOf(1, m1 - m0) }; bx.requestLayout() } }
            row.addView(View(ctx).apply { bg(col, 2) }, LinearLayout.LayoutParams(dp(3), MATCH).apply { leftMargin = dp(10); rightMargin = dp(10) })
            row.addView(card, LinearLayout.LayoutParams(0, WRAP, 1f))
            body.addView(row)
        }
    }

    // ---------- 一节课：详情 ----------
    private fun detail(d: LocalDate, l: Lesson) {
        val day = d.dayOfWeek.value - 1
        val rec = if (src == "mine") Courses.courseOf(l, day) else null
        val col = Courses.color(l.name)
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var dlg: android.app.Dialog
        val hr = ctx.row()
        hr.addView(View(ctx).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(col) } }, LinearLayout.LayoutParams(dp(12), dp(12)))
        hr.addView(ctx.text(l.name, 20f, C.text, HEAVY).apply { pad(10, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        c.addView(hr)
        val cells = ctx.card(4, 16).apply { margins(t = 14); bg(C.mutedBg, 16) }
        fun cell(ic: String, t: String, s: String) { if (t.isBlank()) return; if (cells.childCount > 0) cells.addView(ctx.hline()); cells.addView(ctx.row().apply { pad(12, 10); addView(ctx.text(ic, 17f)); addView(ctx.col().apply { pad(12, 0); addView(ctx.text(t, 14.5f, C.text, SEMI)); if (s.isNotEmpty()) addView(ctx.text(s, 11.5f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f)) }) }
        cell("🕘", T.md(d) + " " + T.wk(d) + " · 第${l.start}-${l.end}节", if (l.t0.isNotEmpty()) l.t0 + " – " + l.t1 else "")
        rec?.let { val ws = Courses.parseWeeks(it.str("weeks")); cell("📅", it.str("weeks").ifEmpty { "1-16" } + " 周", "共 ${ws.size} 周") }
        cell("📍", l.location, "上课地点"); cell("👤", l.teacher, "教师")
        if (l.add) cell("➕", "临时加的课", "")
        if (l.from.isNotEmpty()) cell("🔁", "调课：上 ${T.md(l.from)} 的课", "")
        c.addView(cells)
        if (src == "mine") {
            val br = ctx.row().apply { margins(t = 14) }
            if (rec != null) {
                br.addView(ctx.button("这一次不上", C.mutedBg, C.sub) { dlg.dismiss(); Dialogs.confirm(ctx, "${T.md(d)} 的「${l.name}」不上？", "只影响这一天，记在「调课调休」里，随时可以删掉。", "不上") {
                    run({ Courses.addAdj(jsonOf("date" to T.key(d), "type" to "cancel", "name" to l.name, "start" to l.start)) }, "已记下") } }, LinearLayout.LayoutParams(0, dp(44), 1f))
                br.addView(ctx.button("编辑") { dlg.dismiss(); form(rec, day, l.start) }, LinearLayout.LayoutParams(0, dp(44), 1f).apply { leftMargin = dp(10) })
                c.addView(br)
                c.add(ctx.text("删除这门课", 13.5f, C.red, SEMI).apply { gravity = Gravity.CENTER; pad(0, 10); tap { dlg.dismiss(); Dialogs.confirm(ctx, "删除「${l.name}」？", "这门课在周${"一二三四五六日"[day]}第${l.start}节的安排会从所有周删掉。", "删除", danger = true) { run({ Courses.deleteCourse(rec.str("id")) }, "已删除") } } }, 6)
            } else c.add(ctx.text(if (l.add) "这是「调课调休」里加的课，去那里可以删掉" else "", 12.5f, C.sub), 10)
        }
        dlg = Dialogs.show(ctx, c, bottom = true)
    }
    private fun run(work: () -> Unit, ok: String, after: (() -> Unit)? = null) {
        if (busy) return; busy = true
        Bg.load({ work() }) { _, e -> busy = false; if (e != null) Dialogs.alert(ctx, "没保存上", e.message ?: "") else { a.toast(ok); after?.invoke(); render() } }
    }

    // ---------- 加课 / 改课 ----------
    private fun form(rec: JSONObject?, day0: Int, start0: Int) {
        val tm = Courses.times()
        var day = rec?.optInt("day") ?: day0; var st = rec?.optInt("start") ?: start0; var en = rec?.optInt("end") ?: minOf(tm.size, start0 + 1)
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var dlg: android.app.Dialog
        c.addView(ctx.text(if (rec != null) "编辑课程" else "添加课程", 18f, C.text, BOLD))
        val name = ctx.input("课程名称，如：高等数学", rec?.str("name") ?: ""); c.add(name, 12)
        val names = Courses.names().filter { it != rec?.str("name") }.take(10)
        if (rec == null && names.isNotEmpty()) { val nr = ctx.row(); names.forEach { n -> nr.addView(ctx.text(n, 12.5f, C.text).apply { pad(10, 5); bg(C.mutedBg, 12); tap { name.setText(n); Courses.list().firstOrNull { it.str("name") == n }?.let { x -> tch.setText(x.str("teacher")); loc.setText(x.str("location")) } } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6) }) }; c.add(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(nr) }, 8) }
        val two = ctx.row().apply { margins(t = 10) }
        tch = ctx.input("教师", rec?.str("teacher") ?: ""); loc = ctx.input("上课地点", rec?.str("location") ?: "")
        two.addView(tch, LinearLayout.LayoutParams(0, WRAP, 1f)); two.addView(loc, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
        c.addView(two)
        c.add(ctx.text("星期", 13f, C.sub, SEMI), 12)
        c.add(Seg(ctx, listOf("一", "二", "三", "四", "五", "六", "日"), day) { day = it }, 6)
        val pr = ctx.row().apply { margins(t = 10) }
        val labels = tm.mapIndexed { i, t -> "第${i + 1}节 ${t.substringBefore("-")}" }
        val stTv = ctx.text("", 14.5f, C.text, SEMI).apply { pad(14, 11); bg(C.mutedBg, 12) }; val enTv = ctx.text("", 14.5f, C.text, SEMI).apply { pad(14, 11); bg(C.mutedBg, 12) }
        fun paint() { stTv.text = "从 第${st}节 ⌄"; enTv.text = "到 第${en}节 ⌄" }
        paint()
        stTv.setOnClickListener { Dialogs.sheet(ctx, "第几节开始", labels) { i -> st = i + 1; if (en < st) en = st; paint() } }
        enTv.setOnClickListener { Dialogs.sheet(ctx, "第几节结束", labels) { i -> en = maxOf(st, i + 1); paint() } }
        pr.addView(stTv, LinearLayout.LayoutParams(0, WRAP, 1f)); pr.addView(enTv, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
        c.addView(pr)
        c.add(ctx.text("上课周次", 13f, C.sub, SEMI), 12)
        val wk = ctx.input("如：1-16、1-8单、2-16双、1,3,5,7", rec?.str("weeks") ?: "1-16"); c.add(wk, 6)
        val chips = ctx.row(); listOf("1-16", "1-8", "9-16", "1-16单", "2-16双", "1-18").forEach { w -> chips.addView(ctx.text(w, 12.5f, C.accent, SEMI).apply { pad(10, 5); bg(C.selected, 12); tap { wk.setText(w) } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6) }) }
        c.add(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(chips) }, 8)
        val err = ctx.text("", 13f, C.red).apply { visibility = View.GONE }; c.add(err, 8)
        c.add(ctx.button("保存课程") {
            val x = JSONObject(rec?.toString() ?: "{}").put("name", name.text.toString().trim()).put("teacher", tch.text.toString().trim()).put("location", loc.text.toString().trim())
                .put("day", day).put("start", st).put("end", en).put("weeks", wk.text.toString().trim())
            if (x.str("name").isEmpty()) { err.text = "请填写课程名称"; err.visibility = View.VISIBLE; return@button }
            if (Courses.parseWeeks(x.str("weeks")).isEmpty()) { err.text = "上课周次不对，比如 1-16、1-8单、1,3,5"; err.visibility = View.VISIBLE; return@button }
            Dialogs.hideKeyboard(c); dlg.dismiss(); run({ Courses.saveCourse(x) }, if (rec != null) "已保存" else "已添加「${x.str("name")}」")
        }, 12)
        dlg = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
        if (rec == null) { name.requestFocus(); Dialogs.showKeyboard(name) }
    }
    private lateinit var tch: EditText
    private lateinit var loc: EditText

    // ---------- 6.3 晚自习：哪几天、几点到几点、在哪（跟着账号同步，键 evening_v1） ----------
    // 6.5 早自习：同一张表，键 morning_v1
    private fun evening(morningKind: Boolean = false) {
        val key = if (morningKind) "morning_v1" else "evening_v1"; val nm = if (morningKind) "早自习" else "晚自习"; val icon = if (morningKind) "🌅" else "🌙"
        val ev0 = com.laolao.classcalendar.core.Kv.get(key) as? org.json.JSONObject
        var on = ev0?.optBoolean("on") ?: true
        var study = ev0?.optBoolean("study", true) ?: true
        var t0 = ev0?.str("t0")?.ifEmpty { null } ?: if (morningKind) "07:20" else "18:30"; var t1 = ev0?.str("t1")?.ifEmpty { null } ?: if (morningKind) "07:55" else "21:00"
        val days = mutableSetOf<Int>().apply { val a = ev0?.optJSONArray("days"); if (a == null) addAll(0..4) else for (i in 0 until a.length()) add(a.optInt(i)) }
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var dlg: android.app.Dialog
        c.addView(ctx.text("$icon ${nm}时间", 18f, C.text, BOLD))
        c.add(ctx.text("设好以后，${nm}会显示在首页「接下来的安排」、时间轴和日历里，到点算「上课中」。放假、调休跟着「调课 / 调休」走。网页、电脑、小程序一起生效。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 4)
        c.add(Toggle(ctx, "开启", "", on) { on = it }, 10)
        val nameIn = ctx.input("名称", ev0?.str("name")?.ifEmpty { null } ?: nm); c.add(nameIn, 10)
        val W = listOf("一", "二", "三", "四", "五", "六", "日")
        val dr = ctx.row(); c.add(dr, 12)
        fun paintDays() { dr.removeAllViews(); W.forEachIndexed { i, w -> val sel = i in days
            dr.addView(ctx.text(w, 14f, if (sel) C.accent else C.sub, SEMI).apply { gravity = Gravity.CENTER; bg(if (sel) C.selected else C.mutedBg, 10, if (sel) C.accent else 0); pad(0, 8)
                tap { if (i in days) days.remove(i) else days.add(i); paintDays() } }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { rightMargin = dp(4) }) } }
        paintDays()
        val tr = ctx.row(); c.add(tr, 12)
        fun paintT() { tr.removeAllViews()
            tr.addView(ctx.text("开始 $t0  ⌄", 14.5f, C.text, SEMI).apply { pad(14, 11); bg(C.mutedBg, 12); tap { Dialogs.pickTime(ctx, t0) { t0 = it; paintT() } } }, LinearLayout.LayoutParams(0, WRAP, 1f))
            tr.addView(ctx.text("结束 $t1  ⌄", 14.5f, C.text, SEMI).apply { pad(14, 11); bg(C.mutedBg, 12); tap { Dialogs.pickTime(ctx, t1) { t1 = it; paintT() } } }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) }) }
        paintT()
        val locIn = ctx.input("地点（可不填），例如 教二 305", ev0?.str("location") ?: ""); c.add(locIn, 12)
        c.add(Toggle(ctx, "📚 ${nm}时催我写作业 / 复习", "打开：教练照样推荐，作业排最前；关掉：当成上课（比如早读），教练和捞捞都不提醒", study) { study = it }, 10)
        c.add(ctx.button("保存") {
            if (on && days.isEmpty()) { a.toast("至少选一天"); return@button }
            if (on && t1 <= t0) { a.toast("结束时间要晚于开始时间"); return@button }
            val v = org.json.JSONObject().put("on", on).put("study", study).put("name", nameIn.text.toString().trim().ifEmpty { nm }).put("days", org.json.JSONArray(days.sorted()))
                .put("t0", t0).put("t1", t1).put("location", locIn.text.toString().trim())
            com.laolao.classcalendar.core.Kv.set(key, v); com.laolao.classcalendar.core.Bus.emit("data")
            Dialogs.hideKeyboard(c); dlg.dismiss(); a.toast(if (on) "${nm}时间已保存" else "已关闭$nm"); render()
        }, 16)
        dlg = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }

    // ---------- 调课 / 调休 ----------
    private fun adjust(tab0: Int = 0) {
        var tab = tab0
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var dlg: android.app.Dialog
        c.addView(ctx.text("调课 / 调休", 18f, C.text, BOLD))
        c.add(ctx.text("学校临时换课、补课、放假、加课，在这里记一下，课表、首页、日历、提醒都会跟着变（网页、小程序也一样）", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 4)
        val box = ctx.col()
        var A = ""; var B = T.todayKey(); var Aoff = true; var D = T.todayKey(); var D2 = ""; var st = 1; var en = 2
        val nameIn = ctx.input("课程名"); val locIn = ctx.input("地点（可不填）"); val noteIn = ctx.input("说明，如 国庆放假、运动会停课（可不填）")
        fun pick(label: String, v: String, fn: (String) -> Unit) = ctx.text("$label  " + (if (v.isEmpty()) "选日期" else T.md(v) + " " + T.wk(v)) + "  ⌄", 14.5f, C.text, SEMI).apply { pad(14, 11); bg(C.mutedBg, 12); tap { Dialogs.pickDate(ctx, v.ifEmpty { T.todayKey() }) { fn(it) } } }
        lateinit var paint: () -> Unit
        paint = {
            box.removeAllViews()
            when (tab) {
                0 -> {
                    box.add(pick("哪天上课", B) { B = it; paint() }, 10)
                    box.add(pick("上哪天的课", A) { A = it; paint() }, 8)
                    box.add(Toggle(ctx, "课被挪走的那天放假", "比如国庆调休：周日上周四的课，周四放假", Aoff) { Aoff = it }, 6)
                }
                1 -> {
                    box.add(pick("从", D) { D = it; paint() }, 10)
                    box.add(pick("到（放好几天时选）", D2) { D2 = it; paint() }, 8)
                    box.add(noteIn, 8)
                }
                else -> {
                    box.add(pick("日期", D) { D = it; paint() }, 10)
                    box.add(nameIn, 8)
                    val names = Courses.names().take(10)
                    if (names.isNotEmpty()) { val nr = ctx.row(); names.forEach { n -> nr.addView(ctx.text(n, 12.5f, C.text).apply { pad(10, 5); bg(C.mutedBg, 12); tap { nameIn.setText(n) } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6) }) }; box.add(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(nr) }, 6) }
                    val tm = Courses.times(); val labels = tm.mapIndexed { i, t -> "第${i + 1}节 ${t.substringBefore("-")}" }
                    val pr = ctx.row().apply { margins(t = 8) }
                    pr.addView(ctx.text("第${st}节开始 ⌄", 14f, C.text, SEMI).apply { pad(12, 10); bg(C.mutedBg, 12); tap { Dialogs.sheet(ctx, "开始", labels) { i -> st = i + 1; if (en < st) en = st; paint() } } }, LinearLayout.LayoutParams(0, WRAP, 1f))
                    pr.addView(ctx.text("到第${en}节 ⌄", 14f, C.text, SEMI).apply { pad(12, 10); bg(C.mutedBg, 12); tap { Dialogs.sheet(ctx, "结束", labels) { i -> en = maxOf(st, i + 1); paint() } } }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
                    box.addView(pr); box.add(locIn, 8)
                }
            }
        }
        c.add(Seg(ctx, listOf("🔁 换课", "🏖 放假", "➕ 加课"), tab) { tab = it; paint() }, 12)
        c.addView(box); paint()
        c.add(ctx.button("记下来") {
            val list = mutableListOf<JSONObject>()
            when (tab) {
                0 -> { if (A.isEmpty() || A == B) { a.toast("选好「哪天上课」和「上哪天的课」，两天不能一样"); return@button }
                    list += jsonOf("date" to B, "type" to "swap", "from" to A); if (Aoff) list += jsonOf("date" to A, "type" to "off", "note" to "调休") }
                1 -> { var k = D; val end = if (D2.isNotEmpty() && D2 >= D) D2 else D; var g = 0
                    while (k <= end && g++ < 60) { list += jsonOf("date" to k, "type" to "off", "note" to noteIn.text.toString().trim()); k = T.addDays(k, 1) } }
                else -> { if (nameIn.text.isBlank()) { a.toast("写一下课程名"); return@button }
                    list += jsonOf("date" to D, "type" to "add", "name" to nameIn.text.toString().trim(), "start" to st, "end" to en, "location" to locIn.text.toString().trim(), "teacher" to "") }
            }
            Dialogs.hideKeyboard(c); dlg.dismiss()
            run({ list.forEach { it.put("id", com.laolao.classcalendar.core.newId("a")) }; Courses.setAdj(Courses.adjList() + list) }, "已记下，课表跟着变了")
        }, 14)
        // 已经记下的
        val all = Courses.adjList(); val coming = all.filter { it.str("date") >= T.todayKey() }; val past = all.size - coming.size
        c.add(ctx.text("已经记下的" + if (coming.isNotEmpty()) "（${coming.size}）" else "", 14f, C.text, BOLD), 18)
        if (coming.isEmpty()) c.add(ctx.text("还没有。比如「国庆调休：10月11日（周日）上 10月8日（周四）的课」", 12.5f, C.sub), 6)
        for (x in coming) c.add(ctx.row().apply { pad(12, 9); bg(C.mutedBg, 12)
            addView(ctx.text(T.md(x.str("date")) + " " + T.wk(x.str("date")), 13f, C.text, BOLD), LinearLayout.LayoutParams(dp(92), WRAP))
            addView(ctx.text(Courses.adjText(x), 13f, C.sub), LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(ctx.text("删除", 12.5f, C.red).apply { pad(8, 2); tap { dlg.dismiss(); run({ Courses.delAdj(x.str("id")) }, "已删除") } }) }, 6)
        if (past > 0) c.add(ctx.text("清掉已经过去的 $past 条", 12.5f, C.accent).apply { pad(0, 8); tap { dlg.dismiss(); run({ Courses.setAdj(coming) }, "已清掉") } }, 6)
        dlg = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }

    // ---------- 更多 ----------
    private fun more() {
        val opts = mutableListOf<Pair<String, () -> Unit>>()
        if (src == "mine") {
            opts += "📷 拍照导入课表" to { a.push(CourseImportPage(a)) }
            opts += "＋ 添加课程" to { form(null, 0, 1) }
            opts += "🔁 调课 / 调休" to { adjust() }
            opts += "🌅 早自习时间" to { evening(morningKind = true) }
            opts += "🌙 晚自习时间" to { evening() }
            opts += "🖼 存成图片 / 分享这周课表" to { shareImage() }
            if (clsId != null && canPublish && Courses.has()) opts += "📤 发布到班级（全班都能看到）" to { publish() }
            opts += "⚙ 作息时间、第 1 周、学期" to { settings() }
            opts += "☁ 立即同步" to { Bg.load({ Courses.pull(force = true) }) { _, e -> a.toast(if (e != null) "没同步上：" + e.message else "已同步"); render() } }
        } else {
            opts += "🖼 存成图片 / 分享" to { shareImage() }
            if (cls != null) opts += "📥 用到我的课表" to { useClass() }
            if (canPublish) opts += "📤 用我的课表更新班级课表" to { publish() }
        }
        Dialogs.sheet(ctx, "", opts.map { it.first }) { opts[it].second() }
    }
    private fun semester() = Dialogs.prompt(ctx, "学期名称", Courses.semester(), "如：2026-2027学年第一学期") { s -> run({ Courses.setSemester(s) }, "已保存") }
    private fun settings() {
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var dlg: android.app.Dialog
        c.addView(ctx.text("课程表设置", 18f, C.text, BOLD))
        val g = ctx.card(4, 16).apply { margins(t = 12); bg(C.mutedBg, 16) }
        g.addView(ctx.cell("📘", "学期", Courses.semester().ifEmpty { "还没填" }) { dlg.dismiss(); semester() })
        g.addView(ctx.hline())
        val w1 = Courses.week1()
        g.addView(ctx.cell("🗓", "第 1 周的周一", T.md(w1) + " " + T.wk(w1) + " · 现在是第 ${Courses.weekNow().takeIf { it > 0 } ?: "—"} 周") { dlg.dismiss(); Dialogs.pickDate(ctx, T.key(w1)) { d -> run({ Courses.setWeek1(T.date(d)!!) }, "已保存，周次重新算好了") } })
        c.addView(g)
        c.add(ctx.text("作息时间", 14f, C.text, BOLD), 16)
        val modes = listOf("winter", "summer", "custom"); val cur = Courses.mode()
        c.add(Seg(ctx, listOf("冬春季", "夏秋季", "自定义"), modes.indexOf(cur)) { i ->
            when (i) { 0 -> { dlg.dismiss(); run({ Courses.setTimes(Courses.WINTER_T) }, "已换成冬春季作息") }; 1 -> { dlg.dismiss(); run({ Courses.setTimes(Courses.SUMMER_T) }, "已换成夏秋季作息") }; else -> { dlg.dismiss(); customTimes() } }
        }, 8)
        val tw = ctx.col().apply { margins(t = 8) }
        Courses.times().chunked(2).forEachIndexed { r, pair -> tw.addView(ctx.row().apply { pair.forEachIndexed { k, t -> addView(ctx.text("第${r * 2 + k + 1}节  $t", 12.5f, C.sub).apply { pad(10, 5) }, LinearLayout.LayoutParams(0, WRAP, 1f)) } }) }
        c.addView(tw)
        c.add(ctx.soft("✏️ 自己改每一节的时间") { dlg.dismiss(); customTimes() }, 8)
        c.add(ctx.text("清空课表", 14f, C.red, SEMI).apply { gravity = Gravity.CENTER; pad(0, 14); tap { dlg.dismiss(); Dialogs.confirm(ctx, "清空课表？", "所有课程都会删掉（网页、小程序上也一样），调课记录保留。", "清空", danger = true) { run({ Courses.clearAll() }, "已清空") } } }, 12)
        dlg = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }
    private fun customTimes() {
        val rows = Courses.times().toMutableList()
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var dlg: android.app.Dialog
        c.addView(ctx.text("自定义作息时间", 18f, C.text, BOLD))
        val box = ctx.col()
        lateinit var paint: () -> Unit
        paint = {
            box.removeAllViews()
            rows.forEachIndexed { i, t ->
                val r = ctx.row().apply { margins(t = 6) }
                r.addView(ctx.text("第${i + 1}节", 14f, C.text, SEMI), LinearLayout.LayoutParams(dp(56), WRAP))
                for (part in 0..1) r.addView(ctx.text(t.split("-")[part], 15f, C.accent, BOLD).apply { gravity = Gravity.CENTER; pad(0, 8); bg(C.selected, 10)
                    tap { Dialogs.pickTime(ctx, t.split("-")[part]) { v -> val p = rows[i].split("-").toMutableList(); p[part] = v; rows[i] = p.joinToString("-"); paint() } } }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(if (part == 0) 0 else 8) })
                box.addView(r)
            }
        }
        paint(); c.add(box, 8)
        val br = ctx.row().apply { margins(t = 10) }
        br.addView(ctx.soft("＋ 加一节") { val last = rows.last().substringAfter("-"); val m = T.min(last) ?: 1200; rows += String.format("%02d:%02d-%02d:%02d", (m + 10) / 60 % 24, (m + 10) % 60, (m + 55) / 60 % 24, (m + 55) % 60); paint() }, LinearLayout.LayoutParams(0, dp(40), 1f))
        br.addView(ctx.soft("－ 去掉最后一节", C.mutedBg, C.sub) { if (rows.size > 4) { rows.removeAt(rows.size - 1); paint() } }, LinearLayout.LayoutParams(0, dp(40), 1f).apply { leftMargin = dp(8) })
        c.addView(br)
        c.add(ctx.button("保存") {
            if (rows.any { (T.min(it.substringBefore("-")) ?: 0) >= (T.min(it.substringAfter("-")) ?: 0) }) { a.toast("每一节的结束时间要晚于开始时间"); return@button }
            dlg.dismiss(); run({ Courses.setTimes(rows) }, "作息时间已保存")
        }, 14)
        dlg = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }

    // ---------- 班级课表 ----------
    private fun loadClass() {
        val cid = clsId ?: return
        clsLoaded = true; clsErr = ""
        Bg.load({ Courses.classGet(cid) }) { r, e ->
            cls = r; clsErr = if (e != null) (if (Regex("class_schedule|PGRST202|404").containsMatchIn(e.message ?: "")) "后台还没升级，暂时不能用班级课表" else e.message ?: "") else ""
            render()
        }
    }
    private fun classBar() {
        val name = Store.cls?.str("name") ?: "班级"
        val c = ctx.card(16, 20).apply { margins(b = 12) }
        when {
            !clsLoaded || (cls == null && clsErr.isEmpty() && busy) -> c.addView(ctx.text("正在读取班级课表…", 14f, C.sub))
            clsErr.isNotEmpty() -> { c.addView(ctx.text("读不到班级课表", 15f, C.text, BOLD)); c.add(ctx.text(clsErr, 13f, C.sub), 4); c.add(ctx.soft("重试") { loadClass() }, 10) }
            cls == null -> {
                c.addView(ctx.text("「$name」还没有班级课表", 15f, C.text, BOLD))
                c.add(ctx.text(if (canPublish) "把你的课表发布到班级后，全班同学打开「课程表 → 班级课表」就能看到，还能一键用到自己的课表里。" else "老师或有「增改事项」权限的班委可以发布。发布后你可以一键套用，不用自己导入。", 13f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 6)
                if (canPublish) c.add(ctx.button(if (Courses.has()) "📤 把我的课表发布到班级" else "先在「我的课表」里导入课程", if (Courses.has()) C.accent else C.mutedBg, if (Courses.has()) Color.WHITE else C.sub) { if (Courses.has()) publish() }, 12)
            }
            else -> {
                val x = cls!!
                c.addView(ctx.row().apply { addView(ctx.text("🏫", 22f)); addView(ctx.col().apply { pad(12, 0)
                    addView(ctx.text(x.str("title").ifEmpty { name }, 15f, C.text, BOLD))
                    addView(ctx.text(listOf(x.str("by_name").let { if (it.isNotEmpty()) "$it 发布" else "" }, CK.ago(x.str("updated_at")), "共 ${Courses.classCourses(x).size} 门").filter { it.isNotEmpty() }.joinToString(" · "), 12f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f)) })
                val br = ctx.row().apply { margins(t = 12) }
                br.addView(ctx.button("📥 用到我的课表") { useClass() }, LinearLayout.LayoutParams(0, dp(42), 1f))
                if (canPublish) br.addView(ctx.button("更新", C.selected, C.accent) { publish() }, LinearLayout.LayoutParams(dp(72), dp(42)).apply { leftMargin = dp(8) })
                if (canPublish) br.addView(ctx.button("撤下", C.mutedBg, C.sub) { Dialogs.confirm(ctx, "撤下班级课表？", "同学们已经套用到自己课表里的不受影响。", "撤下", danger = true) { run({ Courses.classClear(clsId!!) }, "已撤下") { cls = null; loadClass() } } }, LinearLayout.LayoutParams(dp(72), dp(42)).apply { leftMargin = dp(8) })
                c.addView(br)
            }
        }
        body.addView(c)
    }
    private fun publish() {
        val cid = clsId ?: return
        Dialogs.prompt(ctx, "发布到「${Store.cls?.str("name")}」", cls?.str("title")?.ifEmpty { null } ?: (Store.cls?.str("name") + " 课程表"), "课表名称") { t ->
            run({ Courses.classPublish(cid, t) }, "已发布，全班同学都能看到了") { src = "class"; loadClass() }
        }
    }
    private fun useClass() {
        val r = cls ?: return
        val n = Courses.classCourses(r).size
        Dialogs.sheet(ctx, "「${r.str("title").ifEmpty { "班级课表" }}」共 $n 门课", if (Courses.has()) listOf("换成班级课表（我现在的 ${Courses.list().size} 门课会被替换）", "合并：保留我的课，只加上我还没有的") else listOf("用到我的课表")) { i ->
            run({ Courses.useClass(r, i == 1) }, "套用好了，首页、日历、提醒都会出现这些课") { src = "mine" }
        }
    }

    // ---------- 存成图片 / 分享 ----------
    private fun shareImage() {
        val monday = w1().plusWeeks((week - 1).toLong())
        val days = (0 until 7).map { monday.plusDays(it.toLong()) }
        val lessons = days.map { lessonsOn(T.key(it)) }
        val n = if (lessons[5].isNotEmpty() || lessons[6].isNotEmpty()) 7 else 5
        val w = 1080; val g = WeekGrid(ctx, days.take(n), lessons.take(n), tms(), false, { _, _ -> }, { _, _ -> }).apply { forImage = true }
        g.measure(View.MeasureSpec.makeMeasureSpec(w - 80, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED))
        val head = 170
        val bm = Bitmap.createBitmap(w, g.measuredHeight + head + 80, Bitmap.Config.ARGB_8888)
        val cv = Canvas(bm); cv.drawColor(if (C.dark) C.bg else Color.WHITE)
        val tp = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = C.text; textSize = 56f; typeface = HEAVY }
        cv.drawText((if (src == "class") cls?.str("title")?.ifEmpty { null } ?: "班级课表" else Courses.semester().ifEmpty { "我的课程表" }), 40f, 90f, tp)
        tp.textSize = 32f; tp.color = C.sub; tp.typeface = android.graphics.Typeface.DEFAULT
        cv.drawText("第 $week 周 · " + T.md(monday) + " – " + T.md(monday.plusDays(6)) + "   捞捞课程表", 40f, 140f, tp)
        g.layout(0, 0, g.measuredWidth, g.measuredHeight)
        cv.save(); cv.translate(40f, head.toFloat()); g.draw(cv); cv.restore()
        val dir = File(ctx.cacheDir, "att").apply { mkdirs() }
        val f = File(dir, "课程表_第${week}周.png"); f.outputStream().use { bm.compress(Bitmap.CompressFormat.PNG, 100, it) }
        val u = android.net.Uri.parse("content://" + a.packageName + ".photo/att/" + android.net.Uri.encode(f.name))
        val i = Intent(Intent.ACTION_SEND).setType("image/png").putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { a.startActivity(Intent.createChooser(i, "保存或发送课表图片")) } catch (e: Exception) { a.toast("这台手机上没有能接收图片的应用") }
    }
}

/**
 * 一周课表格子：今天那一列高亮、红色的「现在」线、正在上的课描边带「上课中」、上过的课变淡；
 * 点课看详情，长按空白格子加课，左右滑换周
 */
class WeekGrid(ctx: Context, private val days: List<LocalDate>, private val lessons: List<List<Lesson>>, private val times: List<String>, private val isCurWeek: Boolean,
               private val pick: (LocalDate, Lesson) -> Unit, private val addAt: (LocalDate, Int) -> Unit) : View(ctx) {
    var onSwipe: ((Int) -> Unit)? = null
    var forImage = false
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val d = ctx.resources.displayMetrics.density
    private val n = maxOf(times.size, lessons.flatten().maxOfOrNull { it.end } ?: 0, 8)
    private val headH get() = (if (forImage) 64f else 46 * d)
    private val leftW get() = (if (forImage) 70f else 34 * d)
    private val rowH get() = (if (forImage) 120f else if (days.size == 5) 60 * d else 58 * d)
    private val s get() = if (forImage) 2.2f else d
    private val boxes = mutableListOf<Triple<RectF, LocalDate, Lesson>>()
    override fun onMeasure(w: Int, h: Int) { setMeasuredDimension(MeasureSpec.getSize(w), (headH + rowH * n + 4 * s).toInt()) }
    private fun colW() = (width - leftW) / days.size
    override fun onDraw(c: Canvas) {
        boxes.clear()
        val cw = colW(); val today = T.today()
        val nowM = T.now().hour * 60 + T.now().minute
        val ti = if (isCurWeek && !forImage) days.indexOf(today) else -1
        // 今天那一列淡淡的底色
        if (ti >= 0) { p.color = C.alpha(C.accent, if (C.dark) 0.12f else 0.06f); c.drawRoundRect(RectF(leftW + cw * ti + 1 * s, 2 * s, leftW + cw * (ti + 1) - 1 * s, height.toFloat()), 12 * s, 12 * s, p) }
        // 表头
        tp.textAlign = Paint.Align.CENTER
        days.forEachIndexed { i, day ->
            val cx = leftW + cw * i + cw / 2; val isT = i == ti
            if (isT) { p.color = C.accent; c.drawRoundRect(RectF(cx - 17 * s, 5 * s, cx + 17 * s, headH - 5 * s), 11 * s, 11 * s, p) }
            tp.textSize = 13 * s; tp.color = if (isT) Color.WHITE else C.text; tp.typeface = BOLD
            c.drawText("一二三四五六日"[day.dayOfWeek.value - 1].toString(), cx, headH / 2 - 1 * s, tp)
            tp.textSize = 9.5f * s; tp.color = if (isT) C.alpha(Color.WHITE, 0.85f) else C.sub; tp.typeface = android.graphics.Typeface.DEFAULT
            c.drawText("${day.monthValue}/${day.dayOfMonth}", cx, headH / 2 + 12 * s, tp)
        }
        // 节次 + 横线（午饭、晚饭前加粗一点，分出上午 / 下午 / 晚上）
        for (k in 0 until n) {
            val top = headH + rowH * k
            tp.textSize = 12 * s; tp.color = C.text; tp.typeface = BOLD
            c.drawText("${k + 1}", leftW / 2, top + rowH / 2 - 3 * s, tp)
            times.getOrNull(k)?.let { t -> tp.textSize = 8.5f * s; tp.color = C.mutedText; tp.typeface = android.graphics.Typeface.DEFAULT; c.drawText(t.substringBefore("-"), leftW / 2, top + rowH / 2 + 9 * s, tp) }
            if (k > 0) {
                val prevEnd = T.min(times.getOrNull(k - 1)?.substringAfter("-")); val st = T.min(times.getOrNull(k)?.substringBefore("-"))
                val gap = if (prevEnd != null && st != null) st - prevEnd else 0
                p.color = if (gap >= 60) C.alpha(C.accent, 0.25f) else C.alpha(C.line, 0.55f)
                if (gap >= 60) { p.pathEffect = android.graphics.DashPathEffect(floatArrayOf(4 * s, 4 * s), 0f); p.strokeWidth = 1.2f * s; p.style = Paint.Style.STROKE; c.drawLine(leftW, top, width.toFloat(), top, p); p.pathEffect = null; p.style = Paint.Style.FILL }
                else c.drawRect(leftW + 4 * s, top, width.toFloat() - 4 * s, top + 0.8f * s, p)
            }
        }
        // 课
        tp.textAlign = Paint.Align.LEFT
        lessons.forEachIndexed { i, list ->
            for (l in list) {
                val col = Courses.color(l.name)
                val r = RectF(leftW + cw * i + 2.5f * s, headH + rowH * (l.start - 1) + 2.5f * s, leftW + cw * (i + 1) - 2.5f * s, headH + rowH * l.end - 4.5f * s)
                val isToday = i == ti
                val now = isToday && (l.m0 ?: 9999) <= nowM && nowM < (l.m1 ?: 0)
                val past = isToday && (l.m1 ?: 9999) <= nowM || (isCurWeek && !forImage && days[i].isBefore(today))
                val a = if (past) 0.62f else 1f
                // 立体的小方块：底下一道深一点的「厚度」+ 渐变面 + 顶上一道高光 + 左边一条课程色
                val lip = RectF(r.left, r.top + 2.5f * s, r.right, r.bottom + 2.5f * s)
                p.color = C.alpha(C.mix(col, Color.BLACK, if (C.dark) 0.55f else 0.15f), (if (C.dark) 0.9f else 0.55f) * a); c.drawRoundRect(lip, 10 * s, 10 * s, p)
                p.shader = LinearGradient(r.left, r.top, r.left, r.bottom, if (C.dark) C.mix(col, Color.BLACK, 0.35f) else C.mix(col, Color.WHITE, 0.62f), if (C.dark) C.mix(col, Color.BLACK, 0.55f) else C.mix(col, Color.WHITE, 0.80f), Shader.TileMode.CLAMP)
                p.alpha = (255 * a).toInt(); c.drawRoundRect(r, 10 * s, 10 * s, p); p.shader = null; p.alpha = 255
                p.style = Paint.Style.STROKE; p.strokeWidth = 1f * s; p.color = C.alpha(Color.WHITE, (if (C.dark) 0.12f else 0.7f) * a)
                c.drawRoundRect(RectF(r.left + 0.5f * s, r.top + 0.5f * s, r.right - 0.5f * s, r.bottom - 0.5f * s), 9.5f * s, 9.5f * s, p); p.style = Paint.Style.FILL
                p.color = C.alpha(col, a); c.save(); c.clipRect(r.left, r.top, r.left + 3.5f * s, r.bottom); c.drawRoundRect(r, 10 * s, 10 * s, p); c.restore()
                if (now) { p.style = Paint.Style.STROKE; p.strokeWidth = 2.2f * s; p.color = col; c.drawRoundRect(r, 10 * s, 10 * s, p); p.style = Paint.Style.FILL }
                val fg = if (C.dark) Color.WHITE else C.mix(col, Color.BLACK, 0.62f)
                val wText = maxOf(10, (r.width() - 11 * s).toInt())
                tp.textSize = (if (days.size == 5) 12.5f else 11.5f) * s; tp.color = fg; tp.typeface = BOLD; tp.alpha = (255 * a).toInt()
                val nameMax = maxOf(1, ((r.height() - 10 * s - (if (l.location.isNotEmpty()) 24 * s else 0f)) / (tp.textSize * 1.18f)).toInt())
                val sl = StaticLayout.Builder.obtain(l.name, 0, l.name.length, tp, wText).setMaxLines(nameMax).setEllipsize(android.text.TextUtils.TruncateAt.END).setLineSpacing(0f, 1.05f).build()
                c.save(); c.translate(r.left + 7 * s, r.top + 5 * s); sl.draw(c); c.restore()
                var y = r.top + 5 * s + sl.height + 3 * s
                if (l.location.isNotEmpty() && y < r.bottom - 12 * s) {
                    tp.textSize = (if (days.size == 5) 10.5f else 9.5f) * s; tp.typeface = android.graphics.Typeface.DEFAULT; tp.color = C.alpha(fg, 0.8f * a)
                    val ll = StaticLayout.Builder.obtain(l.location, 0, l.location.length, tp, wText).setMaxLines(maxOf(1, ((r.bottom - y - 4 * s) / (tp.textSize * 1.2f)).toInt())).setEllipsize(android.text.TextUtils.TruncateAt.END).build()
                    c.save(); c.translate(r.left + 7 * s, y); c.clipRect(0f, 0f, r.width(), r.bottom - y); ll.draw(c); c.restore()
                }
                if (now) { tp.textSize = 9 * s; tp.typeface = BOLD; val t = "上课中"; val tw = tp.measureText(t)
                    p.color = col; c.drawRoundRect(RectF(r.right - tw - 10 * s, r.bottom - 17 * s, r.right - 3 * s, r.bottom - 4 * s), 6 * s, 6 * s, p); tp.color = Color.WHITE; c.drawText(t, r.right - tw - 6.5f * s, r.bottom - 7.5f * s, tp) }
                if (l.add || l.from.isNotEmpty()) { tp.textSize = 8.5f * s; tp.typeface = BOLD; tp.color = if (l.add) C.green else C.accent; c.drawText(if (l.add) "加" else "调", r.right - 12 * s, r.top + 12 * s, tp) }
                tp.alpha = 255
                boxes += Triple(r, days[i], l)
            }
        }
        // 「现在」线
        if (ti >= 0) {
            var y = -1f
            for (k in 0 until n) { val t = times.getOrNull(k) ?: continue; val a0 = T.min(t.substringBefore("-")) ?: continue; val a1 = T.min(t.substringAfter("-")) ?: continue
                if (nowM in a0 until a1) { y = headH + rowH * k + rowH * (nowM - a0) / (a1 - a0); break }
                val nx = times.getOrNull(k + 1)?.let { T.min(it.substringBefore("-")) }
                if (nx != null && nowM in a1 until nx) { y = headH + rowH * (k + 1); break } }
            if (y > 0) { p.color = C.red; c.drawRect(leftW + cw * ti, y - 1 * s, leftW + cw * (ti + 1), y + 1 * s, p); c.drawCircle(leftW + cw * ti + 2 * s, y, 4 * s, p) }
        }
    }
    private val gd = GestureDetector(ctx, object : GestureDetector.SimpleOnGestureListener() {
        override fun onDown(e: MotionEvent) = true
        override fun onSingleTapUp(e: MotionEvent): Boolean { boxes.firstOrNull { it.first.contains(e.x, e.y) }?.let { pick(it.second, it.third) }; return true }
        override fun onLongPress(e: MotionEvent) {
            if (boxes.any { it.first.contains(e.x, e.y) } || e.x < leftW || e.y < headH) return
            val i = ((e.x - leftW) / colW()).toInt().coerceIn(0, days.size - 1); val k = ((e.y - headH) / rowH).toInt() + 1
            performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS); addAt(days[i], k.coerceIn(1, n))
        }
        override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
            val dx = e2.x - (e1?.x ?: e2.x); val dy = e2.y - (e1?.y ?: e2.y)
            if (Math.abs(dx) > 80 * d && Math.abs(dx) > Math.abs(dy) * 1.5f) { onSwipe?.invoke(if (dx < 0) 1 else -1); return true }
            return false
        }
    })
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.actionMasked == MotionEvent.ACTION_DOWN) parent?.requestDisallowInterceptTouchEvent(false)
        return gd.onTouchEvent(e)
    }
}
