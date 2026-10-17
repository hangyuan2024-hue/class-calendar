package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.T
import java.time.LocalDate

/** 日历：月视图 + 选中那天的安排 */
class CalendarPage(a: Main, private val pushed: Boolean = false) : Page(a) {
    private var month: LocalDate = T.today().withDayOfMonth(1)
    private var sel: String = T.todayKey()
    private var showHidden = false
    private lateinit var body: LinearLayout

    override fun build(): View {
        val f = android.widget.FrameLayout(ctx).apply { setBackgroundColor(C.bg) }
        val ps = PullScroll(ctx) { done -> a.refreshSoon(force = true) { done() } }
        body = ps.content.apply { pad(18, if (pushed) 0 else 14, 18, 110) }
        if (pushed) {
            val col = ctx.col()
            col.addView(header("日历"))
            col.addView(ps, LinearLayout.LayoutParams(MATCH, 0, 1f))
            f.addView(col, android.widget.FrameLayout.LayoutParams(MATCH, MATCH))
        } else f.addView(ps, android.widget.FrameLayout.LayoutParams(MATCH, MATCH))
        Fab(a, f) { listOf(
            FabItem("✏️", "在 ${T.dayName(sel)} 记一件事") { a.push(EditPage(a, null, day = sel)) },
            FabItem("📝", "在 ${T.dayName(sel)} 记作业") { a.push(EditPage(a, null, homework = true, day = sel)) },
        ) }.also { a.fabs += it }
        return f
    }
    fun jump(day: String) { T.date(day)?.let { month = it.withDayOfMonth(1); sel = day } }

    override fun render() {
        view
        keepScroll(body)
        val hr = ctx.row()
        val hc = ctx.col()
        hc.addView(ctx.text("${month.year}年", 12f, C.sub, SEMI))
        hc.addView(ctx.text("${month.monthValue}月", 26f, C.text, HEAVY).apply { margins(t = 2) })
        hr.addView(hc, LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("‹", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { month = month.minusMonths(1); render() } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        hr.addView(ctx.text("今天", 13f, C.accent, BOLD).apply { gravity = Gravity.CENTER; press(C.selected, 12); pad(10, 0); tap { month = T.today().withDayOfMonth(1); sel = T.todayKey(); render() } }, LinearLayout.LayoutParams(WRAP, dp(40)).apply { leftMargin = dp(6) })
        hr.addView(ctx.text("›", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { month = month.plusMonths(1); render() } }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { leftMargin = dp(6) })
        body.addView(hr)

        val start = month.minusDays((month.dayOfWeek.value - 1).toLong())
        val end = start.plusDays(41)
        val all = Items.all(showHidden, T.key(start) to T.key(end))
        val by = Items.byDay(all)
        val card = ctx.card(10, 20).apply { margins(t = 14) }
        val wr = ctx.row()
        for (w in T.WEEK) wr.addView(ctx.text(w, 12f, C.sub, SEMI).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, WRAP, 1f))
        card.addView(wr)
        card.add(MonthGrid(ctx, start, month.monthValue, sel, by) { k ->
            sel = k
            val d = T.date(k)!!
            if (d.monthValue != month.monthValue) month = d.withDayOfMonth(1)
            render()
        }, 6)
        body.addView(card)

        // 选中那天
        val day = T.date(sel)!!
        val list = by[sel] ?: emptyList()
        val dh = ctx.row().apply { gravity = Gravity.BOTTOM; pad(4, 22, 4, 10) }
        dh.addView(ctx.text(T.md(day) + " " + T.wk(day), 17f, C.text, BOLD))
        val note = Courses.dayNote(sel)
        val wk = if (Courses.has()) Courses.weekOf(sel) else 0
        dh.addView(ctx.text(listOf(T.dayName(sel).takeIf { it.length <= 3 && it != T.wk(day) } ?: "", if (wk in 1..Courses.MAX_WEEK) "第 $wk 周" else "", note).filter { it.isNotEmpty() }.joinToString(" · "), 12.5f, C.sub).apply { pad(8, 0, 0, 1) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        dh.addView(ctx.text("＋ 记一件事", 13f, C.accent, BOLD).apply { pad(8, 4); press(0, 8); tap { a.push(EditPage(a, null, day = sel)) } })
        body.addView(dh)
        if (list.isEmpty()) body.addView(ctx.empty("☕", "这天没有安排", if (T.dayDiff(sel) >= 0) "点右上角「＋ 记一件事」可以加" else ""))
        else body.addView(a.group(list))
        val hidden = Items.all(showHidden = true).count { it.hidden }
        if (hidden > 0 || showHidden) body.add(ctx.text(if (showHidden) "不显示隐藏的事项" else "显示隐藏的事项（$hidden）", 13f, C.accent, SEMI).apply {
            gravity = Gravity.CENTER; pad(10); tap { showHidden = !showHidden; render() }
        }, 10)
    }
}

/** 月历格子：6 行 7 列，每天下面最多 4 个小圆点 */
class MonthGrid(ctx: Context, private val start: LocalDate, private val month: Int, private val sel: String,
                private val by: Map<String, List<Item>>, private val pick: (String) -> Unit) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val rowH = ctx.dp(52)
    private val today = T.todayKey()
    override fun onMeasure(w: Int, h: Int) { setMeasuredDimension(MeasureSpec.getSize(w), rowH * 6) }
    override fun onDraw(c: Canvas) {
        val cw = width / 7f; val d = context.resources.displayMetrics.density
        for (i in 0 until 42) {
            val day = start.plusDays(i.toLong()); val k = T.key(day)
            val cx = (i % 7) * cw + cw / 2; val top = (i / 7) * rowH.toFloat()
            val other = day.monthValue != month
            val isSel = k == sel; val isToday = k == today
            if (isSel) { p.color = C.accent; c.drawRoundRect(RectF(cx - 17 * d, top + 4 * d, cx + 17 * d, top + 38 * d), 11 * d, 11 * d, p) }
            else if (isToday) { p.color = C.selected; c.drawRoundRect(RectF(cx - 17 * d, top + 4 * d, cx + 17 * d, top + 38 * d), 11 * d, 11 * d, p) }
            tp.textSize = 15 * d
            tp.typeface = if (isToday || isSel) BOLD else android.graphics.Typeface.DEFAULT
            tp.color = when { isSel -> android.graphics.Color.WHITE; isToday -> C.accent; other -> C.mutedText; day.dayOfWeek.value >= 6 -> C.sub; else -> C.text }
            c.drawText(day.dayOfMonth.toString(), cx, top + 27 * d, tp)
            val items = by[k] ?: emptyList()
            val dots = items.take(4)
            val n = dots.size
            dots.forEachIndexed { j, r ->
                p.color = if (r.course) r.color else C.type(r.type)
                if (r.done) p.color = C.alpha(p.color, 0.35f)
                val x = cx + (j - (n - 1) / 2f) * 7 * d
                c.drawCircle(x, top + 45 * d, 2.6f * d, p)
            }
        }
    }
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (e.action == MotionEvent.ACTION_UP) {
            val col = (e.x / (width / 7f)).toInt().coerceIn(0, 6); val r = (e.y / rowH).toInt().coerceIn(0, 5)
            playSoundEffect(android.view.SoundEffectConstants.CLICK)
            pick(T.key(start.plusDays((r * 7 + col).toLong())))
        }
        return true
    }
}
