package com.laolao.classcalendar.ui

import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store

/** 作业：按周看，进度条 + 过期 / 待完成 / 已完成 */
class HomeworkPage(a: Main) : Page(a) {
    private var week = 0
    private var showDone = false
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
        val W = Items.homework(week)
        // 标题 + 切换周
        val hr = ctx.row()
        val hc = ctx.col()
        hc.addView(ctx.text(W.range, 12f, C.sub, SEMI))
        hc.addView(ctx.text(W.title.replace("作业", hw), 26f, C.text, HEAVY).apply { margins(t = 2) })
        hr.addView(hc, LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("‹", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { week--; render() } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        if (week != 0) hr.addView(ctx.text("本周", 13f, C.accent, BOLD).apply { gravity = Gravity.CENTER; press(C.selected, 12); pad(10, 0); tap { week = 0; render() } }, LinearLayout.LayoutParams(WRAP, dp(40)).apply { leftMargin = dp(6) })
        hr.addView(ctx.text("›", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { week++; render() } }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { leftMargin = dp(6) })
        body.addView(hr)

        // 进度
        val total = W.todo.size + W.done.size
        val pc = ctx.card(16, 18).apply { margins(t = 14) }
        val pr = ctx.row()
        val left = W.todo.size + W.overdue.size
        pr.addView(ctx.text(if (total == 0 && W.overdue.isEmpty()) "这周没有$hw" else if (left == 0) "全部完成啦 🎉" else "还有 $left 项没做完", 16f, C.text, BOLD), LinearLayout.LayoutParams(0, WRAP, 1f))
        pr.addView(ctx.text("${W.done.size}/$total", 14f, C.accent, BOLD))
        pc.addView(pr)
        val bar = FrameLayout(ctx).apply { bg(C.mutedBg, 5) }
        val fill = View(ctx).apply { bg(C.accent, 5) }
        bar.addView(fill, FrameLayout.LayoutParams(0, MATCH))
        pc.add(bar, 12); (bar.layoutParams as LinearLayout.LayoutParams).height = dp(10)
        bar.post { fill.layoutParams = FrameLayout.LayoutParams(if (total == 0) 0 else bar.width * W.done.size / total, MATCH) }
        if (W.overdue.isNotEmpty()) pc.add(ctx.text("另外有 ${W.overdue.size} 项之前的${hw}过期了还没做", 12.5f, C.red), 10)
        body.addView(pc)

        if (W.overdue.isNotEmpty()) { body.addView(ctx.section("已过期", "之前没做完的", C.red)); body.addView(a.group(W.overdue, showDate = true, dueTag = true)) }
        body.addView(ctx.section("待完成", if (W.todo.isEmpty()) "" else "${W.todo.size} 项"))
        if (W.todo.isEmpty()) body.addView(ctx.empty("✅", if (total == 0) "这周还没有$hw" else "这周的${hw}都做完了", "老师、班委发布的${hw}会自动出现在这里；也可以点「＋」自己记"))
        else body.addView(a.group(W.todo, showDate = true, dueTag = true))
        if (W.undated.isNotEmpty()) { body.addView(ctx.section("时间待定", "去群里核实一下截止时间")); body.addView(a.group(W.undated)) }
        if (W.done.isNotEmpty()) {
            val h = ctx.section("已完成", "${W.done.size} 项 · " + if (showDone) "点这里收起" else "点这里展开")
            h.tap { showDone = !showDone; render() }
            body.addView(h)
            if (showDone) body.addView(a.group(W.done, showDate = true))
        }
    }
}
