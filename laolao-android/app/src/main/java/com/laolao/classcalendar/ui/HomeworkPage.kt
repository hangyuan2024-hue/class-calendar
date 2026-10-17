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
        body.addView(ctx.text(if (H.left == 0) "都做完了 🎉" else "还有 ${H.left} 项没做", 12f, C.sub, SEMI))
        body.addView(ctx.text(hw, 26f, C.text, HEAVY).apply { margins(t = 2) })

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
}
