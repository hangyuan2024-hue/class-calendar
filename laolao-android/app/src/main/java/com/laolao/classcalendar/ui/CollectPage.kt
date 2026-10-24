package com.laolao.classcalendar.ui

import android.content.Intent
import android.graphics.Typeface
import android.provider.Settings
import android.text.SpannableString
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Bus
import com.laolao.classcalendar.core.Collect
import com.laolao.classcalendar.core.Memo
import com.laolao.classcalendar.core.T

/**
 * 7.1 群消息自动收集：开关、授权、待确认清单。
 * 每条都把原消息放在上面、把时间 / 地点 / 关键词标出来，下面是捞捞认出的事项——核对只要扫一眼。
 */
class CollectPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout

    override fun build(): View = scaffold("群消息自动收集") { b -> body = b; draw() }
    override fun render() { if (::body.isInitialized) draw() }
    override fun onShow() { Bus.on(this) { if (it == "collect") Bg.main.post { render() } }; render() }
    override fun onHide() { Bus.off(this) }
    override fun onAppResume() { render() }

    private fun draw() {
        keepScroll(body)
        body.removeAllViews()
        val on = Collect.on(ctx); val ok = Collect.granted(ctx)

        // ---------- 说明 + 开关 ----------
        val intro = ctx.card(16)
        intro.addView(ctx.text("不用复制粘贴：微信、QQ 群里来了像作业、截止、考试、开会、签到的消息，捞捞自动收进下面的清单，你点「记下」才会变成事项。", 14f, C.text).apply { setLineSpacing(0f, 1.35f) })
        intro.addView(ctx.text("🔒 只在这台手机上识别：消息不上传、不进账号同步，别的 App 的通知一律不看。随时可以关。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f); margins(t = 8) })
        intro.addView(Toggle(ctx, "打开自动收集", if (on && !ok) "还差一步：去系统设置里给「捞捞 · 群消息收集」打开通知使用权" else "", on) { v ->
            Collect.set(ctx, "on", v)
            if (v && !Collect.granted(ctx)) openGrant()
            render()
        }.apply { margins(t = 6) })
        if (on && !ok) intro.addView(ctx.button("去打开通知使用权") { openGrant() }.apply { margins(t = 4) })
        if (on && ok) {
            intro.addView(ctx.hline())
            intro.addView(Toggle(ctx, "微信", "", Collect.wxOn(ctx)) { v -> Collect.set(ctx, "wx", v) })
            intro.addView(Toggle(ctx, "QQ / TIM", "", Collect.qqOn(ctx)) { v -> Collect.set(ctx, "qq", v) })
            val g = Collect.groups(ctx)
            val gr = ctx.row().apply { pad(0, 12); press(0, 8) }
            val gc = ctx.col()
            gc.addView(ctx.text("只看这些群", 15f, C.text, SEMI))
            gc.addView(ctx.text(if (g.isEmpty()) "不限：所有群和私聊都看（只收像通知的）" else "群名里带：$g", 12.5f, C.sub).apply { margins(t = 2) })
            gr.addView(gc, LinearLayout.LayoutParams(0, WRAP, 1f))
            gr.addView(ctx.text("改 ›", 13f, C.accent, SEMI))
            gr.tap { Dialogs.prompt(ctx, "只看名字里带这些字的群", g, "比如：2605 班 学院（空格隔开，留空 = 不限）") { s -> Collect.set(ctx, "groups", s.trim()); render() } }
            intro.addView(gr)
        }
        body.addView(intro)

        // ---------- 待确认 ----------
        val list = Collect.inbox()
        body.addView(ctx.section("待确认 ${list.size} 条", if (list.isEmpty()) "" else "核对一下，点「记下」才保存"))
        if (list.isEmpty()) {
            body.add(ctx.empty("📭", if (on && ok) "暂时没有新发现" else "打开后，群里的作业和通知会出现在这里", if (on && ok) "群里有新的作业、通知时会提醒你" else "微信、QQ 要允许弹通知才收得到"), 4)
            return
        }
        for (h in list) body.add(card(h), 10)
        val r = ctx.row().apply { margins(t = 14) }
        r.addView(ctx.soft("全部清空") { Collect.clear() })
        r.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        r.addView(ctx.soft("一起导入（可逐条改）", C.accent, android.graphics.Color.WHITE) {
            a.push(MemoPage(a, list.joinToString("\n") { it.text.replace("\n", " ") }))
        })
        body.addView(r)
    }

    private fun card(h: Collect.Hit): View {
        val c = ctx.card(14)
        val top = ctx.row()
        top.addView(ctx.chip(h.app, if (h.app == "微信") C.green else C.accent, C.mutedBg))
        top.addView(ctx.text(" " + h.group + (if (h.sender.isNotEmpty()) " · " + h.sender else ""), 12.5f, C.sub, lines = 1), LinearLayout.LayoutParams(0, WRAP, 1f))
        top.addView(ctx.text(ago(h.at), 12f, C.sub))
        c.addView(top)
        // 原消息：时间、日期、地点、关键词标出来
        c.addView(ctx.text(mark(h.text), 14.5f, C.text).apply { setLineSpacing(0f, 1.35f); margins(t = 8); setTextIsSelectable(true) })
        // 捞捞认出来的
        val row = Collect.toRow(h.text)
        val res = ctx.col().apply { bg(C.selected, 12); pad(12, 10); margins(t = 10) }
        res.addView(ctx.text("捞捞认出", 11.5f, C.accent, SEMI))
        res.addView(ctx.text(row.subject, 15f, C.text, SEMI, 2).apply { margins(t = 2) })
        val when0 = if (row.day.isNotEmpty()) T.dayName(row.day) + " " + T.md(row.day) + (if (row.time.isNotEmpty()) " " + row.time else "") + (if (row.homework) " 截止" else "") else "没写日期（放进待办）"
        res.addView(ctx.text(when0 + (if (row.place.isNotEmpty()) " · " + row.place else "") + if (row.homework) " · 作业" else "", 12.5f, C.sub).apply { margins(t = 3) })
        c.addView(res)
        val acts = ctx.row().apply { margins(t = 10) }
        acts.addView(ctx.soft("忽略", C.mutedBg, C.sub) { Collect.remove(h.id) })
        acts.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        acts.addView(ctx.soft("改一改") { Collect.remove(h.id); a.push(MemoPage(a, h.text)) })
        acts.addView(ctx.soft("✓ 记下", C.accent, android.graphics.Color.WHITE) { Collect.keep(h, row); a.toast("记下了 ✓") }.apply { margins(l = 8) })
        c.addView(acts)
        return c
    }

    /** 原消息里把日期、时间、地点、关键词标颜色 */
    private fun mark(t: String): CharSequence {
        val s = SpannableString(t)
        fun paint(start: Int, end: Int, fg: Int, bgc: Int, bold: Boolean) {
            if (start < 0 || end > t.length || start >= end) return
            s.setSpan(ForegroundColorSpan(fg), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (bgc != 0) s.setSpan(BackgroundColorSpan(bgc), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (bold) s.setSpan(StyleSpan(Typeface.BOLD), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        val today = T.today()
        Memo.findDate(t, today)?.let { m -> val i = t.indexOf(m.re); paint(i, i + m.re.length, C.accent, C.selected, true) }
        Memo.findTime(t)?.let { m -> val i = t.indexOf(m.re); paint(i, i + m.re.length, C.accent, C.selected, true) }
        Regex("[A-Za-z]?\\d{3,4}(?:教室|室)?|[一-龥]{1,6}(?:楼|馆|教室|报告厅|操场)[A-Za-z]?\\d{0,4}").findAll(t).take(4).forEach { paint(it.range.first, it.range.last + 1, C.green, 0, true) }
        Collect.KEY.findAll(t).take(8).forEach { paint(it.range.first, it.range.last + 1, C.red, 0, true) }
        return s
    }

    private fun ago(at: Long): String {
        val m = (System.currentTimeMillis() - at) / 60000
        return when { m < 1 -> "刚刚"; m < 60 -> "$m 分钟前"; m < 60 * 24 -> "${m / 60} 小时前"; else -> "${m / 1440} 天前" }
    }

    private fun openGrant() {
        try { a.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
        catch (_: Exception) { a.toast("在系统设置里搜「通知使用权」，打开「捞捞课程表」") }
    }
}
