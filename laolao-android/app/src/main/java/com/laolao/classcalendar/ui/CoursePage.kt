package com.laolao.classcalendar.ui

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Cfg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Lesson
import com.laolao.classcalendar.core.T
import java.time.LocalDate

/** 课程表：一周的格子（第几周可以切换） */
class CoursePage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var week = 0

    override fun build(): View {
        val imp = ctx.text("📷 导入", 14f, C.accent, BOLD).apply { pad(12, 8); press(0, 10); tap { a.push(CourseImportPage(a)) } }
        return scaffold("课程表", imp, pull = { done -> Bg.load({ Courses.pull(force = true) }) { _, e -> done(); if (e != null) a.toast(e.message ?: "") } }) { body = it }
    }
    override fun onShow() { if (System.currentTimeMillis() - Courses.syncedAt() > 60_000) Bg.load({ Courses.pull(force = true) }) { ch, _ -> if (ch == true) render() } }

    override fun render() {
        view
        keepScroll(body)
        if (!Courses.has()) {
            body.addView(ctx.empty("📚", "还没有课程表", "拍一张教务系统的课表截图，自动识别成课程表；网页、小程序导入过的也会自动出现在这里"))
            body.add(ctx.button("📷 拍照 / 选截图导入") { a.push(CourseImportPage(a)) }, 16)
            return
        }
        if (week == 0) week = Courses.weekNow().takeIf { it > 0 } ?: 1
        val monday = Courses.week1().plusWeeks((week - 1).toLong())
        val hr = ctx.row()
        val hc = ctx.col()
        hc.addView(ctx.text(T.md(monday) + " – " + T.md(monday.plusDays(6)), 12f, C.sub, SEMI))
        hc.addView(ctx.text("第 $week 周" + if (week == Courses.weekNow()) "（本周）" else "", 22f, C.text, HEAVY).apply { margins(t = 2) })
        hr.addView(hc, LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("‹", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { if (week > 1) { week--; render() } } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        hr.addView(ctx.text("›", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { if (week < Courses.MAX_WEEK) { week++; render() } } }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { leftMargin = dp(6) })
        body.addView(hr)
        val days = (0 until 7).map { monday.plusDays(it.toLong()) }
        val lessons = days.map { Courses.on(T.key(it)) }
        val card = ctx.card(6, 18).apply { margins(t = 12) }
        card.addView(CourseGrid(ctx, days, lessons, Courses.times()) { d, l ->
            Dialogs.alert(ctx, l.name, listOf(T.md(d) + " " + T.wk(d) + " 第${l.start}-${l.end}节", if (l.t0.isNotEmpty()) l.t0 + " - " + l.t1 else "", if (l.location.isNotEmpty()) "📍 " + l.location else "", if (l.teacher.isNotEmpty()) "👤 " + l.teacher else "", if (l.add) "（临时加的课）" else if (l.from.isNotEmpty()) "（调课：上 ${T.md(l.from)} 的课）" else "").filter { it.isNotEmpty() }.joinToString("\n"))
        })
        body.addView(card)
        val notes = days.mapNotNull { d -> Courses.dayNote(T.key(d)).takeIf { it.isNotEmpty() }?.let { T.wk(d) + "：" + it } }
        if (notes.isNotEmpty()) body.add(ctx.text("🔁 " + notes.joinToString("；"), 13f, C.accent).apply { bg(C.selected, 12); pad(12, 9) }, 12)
        body.add(ctx.text("☁ 课表存在云端，网页、小程序、这里看到的是同一份" + (if (Courses.syncedAt() > 0) " · " + T.ago(Courses.syncedAt()) + "更新" else "") + "\n改课程、记调课调休请在网页或小程序的「课程表」里操作，改完下拉刷新这里", 12f, C.sub).apply {
            setLineSpacing(0f, 1.4f); tap { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Cfg.SITE))) }
        }, 14)
    }
}

/** 一周课表格子 */
class CourseGrid(ctx: Context, private val days: List<LocalDate>, private val lessons: List<List<Lesson>>, private val times: List<String>, private val pick: (LocalDate, Lesson) -> Unit) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
    private val d = ctx.resources.displayMetrics.density
    private val n = maxOf(times.size, lessons.flatten().maxOfOrNull { it.end } ?: 0, 8)
    private val headH = 40 * d; private val leftW = 30 * d; private val rowH = 54 * d
    private val boxes = mutableListOf<Triple<RectF, LocalDate, Lesson>>()
    override fun onMeasure(w: Int, h: Int) { setMeasuredDimension(MeasureSpec.getSize(w), (headH + rowH * n).toInt()) }
    override fun onDraw(c: Canvas) {
        boxes.clear()
        val cw = (width - leftW) / 7f
        val today = T.today()
        tp.textAlign = Paint.Align.CENTER
        days.forEachIndexed { i, day ->
            val cx = leftW + cw * i + cw / 2
            val isT = day == today
            if (isT) { p.color = C.selected; c.drawRoundRect(RectF(leftW + cw * i + 2 * d, 2 * d, leftW + cw * (i + 1) - 2 * d, headH - 4 * d), 8 * d, 8 * d, p) }
            tp.textSize = 12 * d; tp.color = if (isT) C.accent else C.text; tp.typeface = BOLD
            c.drawText(T.wk(day).substring(1), cx, 17 * d, tp)
            tp.textSize = 10 * d; tp.color = if (isT) C.accent else C.sub; tp.typeface = android.graphics.Typeface.DEFAULT
            c.drawText("${day.monthValue}/${day.dayOfMonth}", cx, 31 * d, tp)
        }
        for (k in 0 until n) {
            val top = headH + rowH * k
            tp.textSize = 11 * d; tp.color = C.text; tp.typeface = BOLD
            c.drawText("${k + 1}", leftW / 2, top + 20 * d, tp)
            times.getOrNull(k)?.let { t ->
                tp.textSize = 8 * d; tp.color = C.sub; tp.typeface = android.graphics.Typeface.DEFAULT
                c.drawText(t.substringBefore("-"), leftW / 2, top + 32 * d, tp)
                c.drawText(t.substringAfter("-"), leftW / 2, top + 42 * d, tp)
            }
            if (k > 0) { p.color = C.alpha(C.line, 0.6f); c.drawRect(leftW, top, width.toFloat(), top + 1, p) }
        }
        tp.textAlign = Paint.Align.LEFT
        lessons.forEachIndexed { i, list ->
            for (l in list) {
                val col = Courses.color(l.name)
                val r = RectF(leftW + cw * i + 1.5f * d, headH + rowH * (l.start - 1) + 1.5f * d, leftW + cw * (i + 1) - 1.5f * d, headH + rowH * l.end - 1.5f * d)
                p.color = if (C.dark) C.mix(col, Color.BLACK, 0.55f) else C.mix(col, Color.WHITE, 0.82f)
                c.drawRoundRect(r, 7 * d, 7 * d, p)
                p.color = col; c.drawRoundRect(RectF(r.left, r.top, r.left + 3 * d, r.bottom), 2 * d, 2 * d, p)
                tp.textSize = 10.5f * d; tp.color = if (C.dark) Color.WHITE else C.mix(col, Color.BLACK, 0.45f); tp.typeface = BOLD
                val text = l.name + if (l.location.isNotEmpty()) "\n@" + l.location else ""
                val sl = StaticLayout.Builder.obtain(text, 0, text.length, tp, maxOf(10, (r.width() - 7 * d).toInt())).setAlignment(Layout.Alignment.ALIGN_NORMAL)
                    .setMaxLines(((r.height() - 6 * d) / (13 * d)).toInt().coerceAtLeast(1)).setEllipsize(android.text.TextUtils.TruncateAt.END).build()
                c.save(); c.translate(r.left + 5 * d, r.top + 4 * d); c.clipRect(0f, 0f, r.width() - 6 * d, r.height() - 5 * d); sl.draw(c); c.restore()
                boxes += Triple(r, days[i], l)
            }
        }
    }
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.action == MotionEvent.ACTION_UP) boxes.firstOrNull { it.first.contains(e.x, e.y) }?.let { pick(it.second, it.third) }
        return true
    }
}
