package com.laolao.classcalendar.ui

import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.Store

/**
 * 作业：所有没做完的按截止时间排（已过期 / 今天 / 明天 / 这周 / 下周 / 以后），
 * 不按周切开——下周一要交的，这周就能看到。图片附件直接显示小图（HwPlus）。
 */
class HomeworkPage(a: Main) : Page(a) {
    private var week = 0         // 按周看：0 本周
    /** 显示方式跟着账号同步（网页、小程序一样）：due 按截止时间 / week 按周看 */
    private fun mode(): String = if (com.laolao.classcalendar.core.Kv.str("hw_view_v1", "due") == "week") "week" else "due"
    private val folded = HashSet<String>()
    private lateinit var body: LinearLayout

    override fun build(): View {
        val f = FrameLayout(ctx).apply { setBackgroundColor(C.bg) }
        val ps = PullScroll(ctx) { done -> a.refreshSoon(force = true) { done() } }
        body = ps.content.apply { pad(18, 14, 18, 110) }
        f.addView(ps, FrameLayout.LayoutParams(MATCH, MATCH))
        a.fabs += Fab(a, f) {
            val hw = if (Store.work()) "任务" else "作业"
            val l = mutableListOf(FabItem("📝", "记一项$hw") { a.push(EditPage(a, null, homework = true)) })
            if (Store.can("can_edit")) l += FabItem("📢", "发布班级$hw") { a.push(EditPage(a, null, homework = true, classMode = true)) }
            l += FabItem("📋", "粘贴一段$hw 自动拆分") { a.push(MemoPage(a, "")) }
            l
        }
        return f
    }

    private var selDay = ""          // 上面一周小日历点了哪天（只看这天）
    private var showDone = false

    /**
     * 7.x 重新排（照小程序 1.29.1 作业页）：
     * 标题 + 按截止 / 按周 → 一张概览卡（还有几项、几项过期 + 未来 7 天每天几项，点某天只看那天）
     * → 按截止分组（已过期 / 今天 / 明天 / 这周 / 下周 / 以后，点标题收起）→ 最下面「已完成 N」点开才显示。
     * 每一行：左边截止日期和时间 | 标题、说明、附件小图（点开看原图）、已读人数 | 右边圆圈打勾。
     */
    override fun render() {
        view
        keepScroll(body)
        val hw = if (Store.work()) "任务" else "作业"
        val H = Items.homeworkAll()
        val hr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(2, 6, 0, 0) }
        hr.addView(ctx.text(hw, 26f, C.text, HEAVY), LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(Seg(ctx, listOf("按截止", "按周"), if (mode() == "week") 1 else 0) { i ->
            com.laolao.classcalendar.core.Kv.set("hw_view_v1", if (i == 1) "week" else "due"); week = 0; selDay = ""; render()
        }, LinearLayout.LayoutParams(dp(140), WRAP))
        body.addView(hr)
        if (mode() == "week") { weekView(hw); HwPlus.load(ctx, Items.all().filter { it.hw }) { if (view.isAttachedToWindow) render() }; return }

        val late = H.groups.firstOrNull { it.key == "late" }?.items?.size ?: 0
        body.addView(summary(H.left, late, H.groups.flatMap { it.items }))

        if (selDay.isNotEmpty()) {
            val l = H.groups.flatMap { it.items }.filter { it.day == selDay }
            val sh = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 18, b = 8) }
            sh.addView(ctx.text("只看 " + T.md(selDay) + " " + T.wk(selDay), 15f, C.text, BOLD), LinearLayout.LayoutParams(0, WRAP, 1f))
            sh.addView(ctx.text("看全部", 13f, C.accent, SEMI).apply { pad(10, 4); tap { selDay = ""; render() } })
            body.addView(sh)
            if (l.isEmpty()) body.addView(ctx.empty("✅", "这天没有要做的$hw")) else body.addView(card(l))
        } else if (H.groups.isEmpty()) {
            body.add(ctx.empty("✅", "没有要做的$hw", "老师、班委发布的${hw}会自动出现在这里；也可以点「＋」自己记"), 14)
        } else for (g in H.groups) {
            val fold = g.key in folded
            val sh = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 18, b = 8); tap { if (!folded.remove(g.key)) folded += g.key; render() } }
            sh.addView(ctx.text(g.title, 15f, if (g.key == "late") C.red else C.text, BOLD))
            sh.addView(ctx.text("${g.items.size} 项", 12.5f, C.sub).apply { pad(8, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            sh.addView(ctx.text(if (fold) "展开 ▾" else "收起 ▴", 12f, C.sub, SEMI))
            body.addView(sh)
            if (!fold) body.addView(card(g.items))
        }
        // 已完成：放在最下面，点开才显示
        if (H.done.isNotEmpty()) {
            body.add(ctx.text("已完成 ${H.done.size}  " + if (showDone) "▴" else "▾", 13f, C.sub, SEMI).apply {
                gravity = Gravity.CENTER; pad(12, 10); tap { showDone = !showDone; render() }
            }, 16)
            if (showDone) body.addView(card(H.done.take(60)))
        }
        if (HwPlus.lastErr.isNotEmpty()) body.add(ctx.text(HwPlus.lastErr, 11.5f, C.mutedText).apply { gravity = Gravity.CENTER }, 10)
        HwPlus.load(ctx, H.groups.flatMap { it.items } + H.done.take(60)) { if (view.isAttachedToWindow) render() }
    }

    /** 概览：还有几项（过期的红字）+ 未来 7 天每天几项（小圆点），点某天只看那天 */
    private fun summary(left: Int, late: Int, todo: List<Item>): View {
        val c = ctx.card(16, 18).apply { margins(t = 14) }
        val top = ctx.row().apply { gravity = Gravity.BOTTOM }
        top.addView(ctx.text("$left", 30f, if (left > 0) C.text else C.green, HEAVY))
        top.addView(ctx.text(if (left > 0) "项待完成" else "都做完了", 13.5f, C.sub, SEMI).apply { pad(6, 0, 0, 6) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        if (late > 0) top.addView(ctx.text("$late 项过期", 12.5f, C.red, BOLD).apply { bg(C.dangerBg, 10); pad(9, 3); tap { selDay = ""; folded.remove("late"); render() } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { bottomMargin = dp(6) })
        c.addView(top)
        val strip = ctx.row().apply { margins(t = 10) }
        val t0 = T.todayKey()
        for (i in 0..6) {
            val k = T.addDays(t0, i.toLong()); val n = todo.count { it.day == k }; val sel = selDay == k
            strip.addView(ctx.col().apply {
                gravity = Gravity.CENTER_HORIZONTAL; pad(0, 6, 0, 6)
                background = round(if (sel) C.accent else if (i == 0) C.selected else 0, dp(12).toFloat())
                addView(ctx.text(if (i == 0) "今" else T.wk(k).removePrefix("周"), 11.5f, if (sel) Color.WHITE else C.sub, SEMI).apply { gravity = Gravity.CENTER })
                addView(ctx.text(k.takeLast(2).trimStart('0'), 15f, if (sel) Color.WHITE else C.text, BOLD).apply { gravity = Gravity.CENTER; margins(t = 1) })
                val dots = ctx.row().apply { gravity = Gravity.CENTER }
                repeat(minOf(3, n)) { dots.addView(View(ctx).apply { background = round(if (sel) Color.WHITE else C.accent, dp(2).toFloat()) }, LinearLayout.LayoutParams(dp(4), dp(4)).apply { leftMargin = dp(1); rightMargin = dp(1) }) }
                addView(dots, LinearLayout.LayoutParams(MATCH, dp(8)).apply { topMargin = dp(3) })
                tap { selDay = if (sel) "" else k; render() }
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) leftMargin = dp(4) })
        }
        c.addView(strip)
        return c
    }

    private fun card(list: List<Item>): LinearLayout = ctx.card(4, 18).apply {
        pad(12, 2, 12, 2)
        list.forEachIndexed { i, r -> if (i > 0) addView(ctx.hline()); addView(hwRow(r)) }
    }

    /** 作业页的一行：截止 | 标题、说明、附件小图、已读 | 打勾 */
    private fun hwRow(r: Item): View {
        val row = ctx.row().apply { gravity = Gravity.TOP; pad(2, 14, 2, 14) }
        val (dueT, lv) = Items.due(r)
        val tone = if (r.done) C.mutedText else when (lv) { 3 -> C.red; 2 -> C.accent; else -> C.text }
        val t0 = T.todayKey(); val dd = if (r.dated) T.dayDiff(r.day) else 99L
        val dayT = when { !r.dated -> "待定"; dd == 0L -> "今天"; dd == 1L -> "明天"; dd in 2..6 -> T.wk(r.day); else -> T.md(r.day).replace("月", "/").removeSuffix("日") }
        row.addView(ctx.col().apply {
            addView(ctx.text(dayT, 13f, tone, BOLD, 1))
            addView(ctx.text(if (!r.dated) "" else r.time.ifEmpty { "全天" }, 11.5f, C.sub, lines = 1).apply { margins(t = 2) })
        }, LinearLayout.LayoutParams(dp(50), WRAP))
        val b = ctx.col()
        val title = ctx.text((if (r.needConfirm) "⚠ " else "") + r.title, 15.5f, if (r.done) C.mutedText else C.text, SEMI, 2)
        if (r.done) title.paintFlags = title.paintFlags or android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
        b.addView(title)
        if (r.sub.isNotBlank()) b.addView(ctx.text(r.sub, 12.5f, C.sub, lines = 2).apply { margins(t = 3); setLineSpacing(0f, 1.2f) })
        // 小字一行：过期多久（只在已过期里）、已读、我的备注
        val meta = listOfNotNull(if (lv == 3 && !r.done) dueT else null, HwPlus.read(r).ifEmpty { null }, if (r.note.isNotBlank()) "备注：" + r.note else null)
        if (meta.isNotEmpty()) b.addView(ctx.text(meta.joinToString(" · "), 12f, if (lv == 3 && !r.done) C.red else C.mutedText, lines = 1).apply { margins(t = 4) })
        // 附件：图片直接显示小图，点开看原图；文档显示名字
        HwPlus.strip(a, r)?.let { b.add(it, 8) }
        // 点一下在原地展开（和首页一样），不再跳到另一页
        val extra = ctx.col(); b.addView(extra)
        fun paint() { extra.removeAllViews(); if (r.key in RowOpen.keys) a.itemExtra(r, extra) }
        paint()
        row.addView(b, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(6) })
        // 打勾：右边的圆圈
        row.addView(ctx.text(if (r.done) "✓" else "", 13f, Color.WHITE, HEAVY).apply {
            gravity = Gravity.CENTER
            background = round(if (r.done) C.accent else 0, dp(13).toFloat(), if (r.done) C.accent else C.mutedText, dp(2))
            contentDescription = if (r.done) "取消完成" else "标记完成"
            tap { v -> v.buzz(); a.toggle(r) }
        }, LinearLayout.LayoutParams(dp(26), dp(26)).apply { leftMargin = dp(10); topMargin = dp(1) })
        row.press(0, 12)
        row.tap { if (!RowOpen.keys.remove(r.key)) RowOpen.keys += r.key; paint() }
        row.setOnLongClickListener { v -> v.buzz(); a.quickActions(r); true }
        return row
    }

    /** 按周看（以前的样子，可以切上一周 / 下一周） */
    private fun weekView(hw: String) {
        val W = Items.homework(week)
        val nav = ctx.row().apply { margins(t = 14) }
        nav.addView(ctx.col().apply {
            addView(ctx.text(W.title.replace("作业", hw), 18f, C.text, BOLD))
            addView(ctx.text(W.range, 12f, C.sub))
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        nav.addView(ctx.text("‹", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { week--; render() } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        if (week != 0) nav.addView(ctx.text("本周", 13f, C.accent, BOLD).apply { gravity = Gravity.CENTER; press(C.selected, 12); pad(10, 0); tap { week = 0; render() } }, LinearLayout.LayoutParams(WRAP, dp(40)).apply { leftMargin = dp(6) })
        nav.addView(ctx.text("›", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { week++; render() } }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { leftMargin = dp(6) })
        body.addView(nav)
        val total = W.todo.size + W.done.size
        val later = Items.all().count { it.hw && !it.done && it.dated && it.day > Items.weekStart(week).let { a -> com.laolao.classcalendar.core.T.addDays(a, 6) } }
        val pc = ctx.card(16, 18).apply { margins(t = 12) }
        pc.addView(ctx.text("这周完成了 ${W.done.size} / $total" + if (W.overdue.isNotEmpty()) " · 之前还有 ${W.overdue.size} 项过期" else "", 15f, C.text, BOLD))
        if (later > 0) pc.add(ctx.text("以后还有 $later 项没做 ›", 13f, C.accent, SEMI).apply { tap { week++; render() } }, 6)
        body.addView(pc)
        if (W.overdue.isNotEmpty()) { body.addView(ctx.section("之前没交的", "过期但还没标记完成", C.red)); body.addView(card(W.overdue)) }
        body.addView(ctx.section("待完成", "按截止时间排序"))
        if (W.todo.isEmpty()) body.addView(ctx.empty("✅", if (total == 0) "这周没有$hw" else "这周的${hw}都做完了"))
        else body.addView(card(W.todo))
        if (W.undated.isNotEmpty()) { body.addView(ctx.section("截止时间待定", "请去群里核实")); body.addView(card(W.undated)) }
        if (W.done.isNotEmpty()) { body.addView(ctx.section("已完成", "${W.done.size} 项")); body.addView(card(W.done)) }
    }
}
