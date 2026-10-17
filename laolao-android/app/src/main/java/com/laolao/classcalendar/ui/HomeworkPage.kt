package com.laolao.classcalendar.ui

import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store

/**
 * 作业：所有没做完的按截止时间排（已过期 / 今天 / 明天 / 这周 / 下周 / 以后），
 * 不按周切开——下周一要交的，这周就能看到。
 */
class HomeworkPage(a: Main) : Page(a) {
    private var tab = 0          // 0 待完成 1 已完成
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
        val fab = ctx.text("+", 30f, Color.WHITE).apply {
            gravity = Gravity.CENTER; press(C.accent, 20, ripple = C.alpha(Color.WHITE, 0.3f)); elevation = dp(6).toFloat()
            tap { a.push(EditPage(a, null, homework = true)) }
        }
        f.addView(fab, FrameLayout.LayoutParams(dp(58), dp(58)).apply { gravity = Gravity.BOTTOM or Gravity.END; rightMargin = dp(20); bottomMargin = dp(20) })
        return f
    }

    override fun render() {
        view
        keepScroll(body)
        val hw = if (Store.work()) "任务" else "作业"
        val H = Items.homeworkAll()
        val hr = ctx.row()
        val hc = ctx.col()
        hc.addView(ctx.text(if (H.left == 0) "都做完了 🎉" else "还有 ${H.left} 项没做", 12f, C.sub, SEMI))
        hc.addView(ctx.text(hw, 26f, C.text, HEAVY).apply { margins(t = 2) })
        hr.addView(hc, LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(Seg(ctx, listOf("按截止时间", "按周看"), if (mode() == "week") 1 else 0) { i ->
            com.laolao.classcalendar.core.Kv.set("hw_view_v1", if (i == 1) "week" else "due"); week = 0; render()
        }, LinearLayout.LayoutParams(dp(196), WRAP))
        body.addView(hr)
        if (mode() == "week") { weekView(hw); return }

        // 本周进度
        val pc = ctx.card(16, 18).apply { margins(t = 14) }
        val pr = ctx.row()
        val late = H.groups.firstOrNull { it.key == "late" }?.items?.size ?: 0
        pr.addView(ctx.text(when { H.weekTotal == 0 -> "这周没有要交的$hw"; H.weekDone == H.weekTotal -> "这周的${hw}全部完成 🎉"; else -> "这周完成了 ${H.weekDone} / ${H.weekTotal}" }, 15.5f, C.text, BOLD), LinearLayout.LayoutParams(0, WRAP, 1f))
        if (late > 0) pr.addView(ctx.chip("$late 项过期", C.red, C.dangerBg, 12f).apply { pad(8, 3) })
        pc.addView(pr)
        val bar = FrameLayout(ctx).apply { bg(C.mutedBg, 5) }
        val fill = View(ctx).apply { bg(C.accent, 5) }
        bar.addView(fill, FrameLayout.LayoutParams(0, MATCH))
        pc.addView(bar, LinearLayout.LayoutParams(MATCH, dp(10)).apply { topMargin = dp(12) })
        bar.post { fill.layoutParams = FrameLayout.LayoutParams(if (H.weekTotal == 0) 0 else bar.width * H.weekDone / H.weekTotal, MATCH) }
        body.addView(pc)

        body.addView(Seg(ctx, listOf("待完成 ${H.left}", "已完成 ${H.done.size}"), tab) { tab = it; render() }.apply { margins(t = 14) })

        if (tab == 1) {
            if (H.done.isEmpty()) body.add(ctx.empty("📭", "最近 30 天还没有完成的$hw"), 14)
            else { body.addView(ctx.section("最近完成的", "点方框可以改回没做")); body.addView(a.group(H.done.take(60), showDate = true)) }
            return
        }
        if (H.groups.isEmpty()) {
            body.add(ctx.empty("✅", "没有要做的$hw", "老师、班委发布的${hw}会自动出现在这里；也可以点「＋」自己记"), 14)
            return
        }
        for (g in H.groups) {
            val fold = g.key in folded
            val h = ctx.section(g.title, "${g.items.size} 项 · " + g.sub + if (fold) " · 已收起" else "", if (g.key == "late") C.red else C.text)
            h.tap { if (!folded.remove(g.key)) folded += g.key; render() }
            body.addView(h)
            if (!fold) body.addView(a.group(g.items, showDate = g.key != "today" && g.key != "tomorrow", dueTag = true))
        }
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
        if (W.overdue.isNotEmpty()) { body.addView(ctx.section("之前没交的", "过期但还没标记完成", C.red)); body.addView(a.group(W.overdue, showDate = true, dueTag = true)) }
        body.addView(ctx.section("待完成", "按截止时间排序"))
        if (W.todo.isEmpty()) body.addView(ctx.empty("✅", if (total == 0) "这周没有$hw" else "这周的${hw}都做完了"))
        else body.addView(a.group(W.todo, showDate = true, dueTag = true))
        if (W.undated.isNotEmpty()) { body.addView(ctx.section("截止时间待定", "请去群里核实")); body.addView(a.group(W.undated)) }
        if (W.done.isNotEmpty()) { body.addView(ctx.section("已完成", "${W.done.size} 项")); body.addView(a.group(W.done, showDate = true)) }
    }
}
