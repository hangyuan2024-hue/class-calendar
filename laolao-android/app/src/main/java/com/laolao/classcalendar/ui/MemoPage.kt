package com.laolao.classcalendar.ui

import android.content.ClipboardManager
import android.content.Context
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Memo
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf

/**
 * 从备忘录 / 微信聊天记录导入：一段文字拆成一条条待办。
 * 课代表、班委（有发布权限）可以直接「发布给全班」；作业没写截止时间的，自动填「下次上这门课之前」，每条都能点开改。
 */
class MemoPage(a: Main, private val initial: String) : Page(a) {
    private class R(var subject: String, var day: String, var time: String, val place: String, val note: String, val done: Boolean, var hw: Boolean, var auto: String = "", var on: Boolean = true)
    private lateinit var body: LinearLayout
    private lateinit var box: EditText
    private var rows: MutableList<R> = mutableListOf()
    private var toClass = false
    private var busy = false
    private val canPublish get() = Store.can("can_edit") && Store.cls != null
    override val autoRender = false

    override fun build(): View = scaffold("导入待办 / 作业") { b ->
        body = b
        b.addView(ctx.text("把备忘录、群里老师发的作业粘贴进来：一行一件事，会自动认出「明天」「周三」「10月20日」「下午3点」「下节课前」；单独一行的日期算作下面几行的日期。没写截止时间的作业，自动按课程表填「下次上这门课之前」。", 13.5f, C.sub).apply { setLineSpacing(0f, 1.35f) })
        box = ctx.input("比如：\n数学：练习册 P23-25\n英语：背 Unit3 单词，下节课前\n周三：\n- 下午3点 社团开会", initial, multi = true).apply { minLines = 6; margins(t = 12) }
        b.addView(box)
        val r = ctx.row().apply { margins(t = 10) }
        r.addView(ctx.soft("📋 粘贴") {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val t = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString() ?: ""
            if (t.isBlank()) a.toast("剪贴板是空的") else { box.setText(t); parse() }
        })
        r.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        r.addView(ctx.soft("识别 ›", C.accent, android.graphics.Color.WHITE) { Dialogs.hideKeyboard(box); parse() })
        b.addView(r)
        if (initial.isNotBlank()) b.post { parse() }
    }

    private fun parse() {
        val text = box.text.toString()
        val lines = text.replace("\r", "").split("\n")
        rows = Memo.parse(text).map { m0 ->
            // 原句里写了「下节课前」：按那门课的课表算
            val src = lines.firstOrNull { it.contains(m0.subject.take(6)) } ?: m0.subject
            val m = Items.withLesson(m0, src)
            val r = R(m.subject, m.day, m.time, m.place, m.note, m.done, m.homework || toClass)
            if (m0.day.isEmpty() && m.day.isNotEmpty()) r.auto = "下节课前"
            fillLesson(r)
            r
        }.toMutableList()
        redraw()
    }
    /** 作业没写截止时间：自动填「下次上这门课之前」 */
    private fun fillLesson(r: R) {
        if (!r.hw || r.day.isNotEmpty()) return
        val m = Courses.match(r.subject) ?: return
        val n = Courses.nextOf(m) ?: return
        r.day = n.day; r.time = n.time; r.auto = "下次${m}课前"
    }

    private fun redraw() {
        while (body.childCount > 3) body.removeViewAt(3)
        if (rows.isEmpty()) { body.add(ctx.empty("🤔", "没认出事项", "一行写一件事试试"), 16); return }
        if (canPublish) {
            body.add(Seg(ctx, listOf("存到我自己", "发布给全班（${Store.cls?.optString("name") ?: ""}）"), if (toClass) 1 else 0) { i ->
                toClass = i == 1
                if (toClass) rows.forEach { if (!it.hw) { it.hw = true; fillLesson(it) } }
                redraw()
            }, 14)
        }
        body.addView(ctx.section("认出 ${rows.size} 件", "点一条可以改时间；点方框可以不导入"))
        val c = ctx.card(4, 18)
        rows.forEachIndexed { i, r ->
            if (i > 0) c.addView(ctx.hline())
            val row = ctx.row().apply { pad(8, 10); press(0, 10) }
            row.addView(a.check(r.on) { r.on = !r.on; redraw() }, LinearLayout.LayoutParams(dp(22), dp(22)).apply { rightMargin = dp(10) })
            val cc = ctx.col()
            cc.addView(ctx.text(r.subject, 15f, if (r.on) C.text else C.mutedText, SEMI, 2))
            val wt = if (r.day.isNotEmpty()) T.dayName(r.day) + " " + T.md(r.day) + (if (r.time.isNotEmpty()) " " + r.time else "") + (if (r.hw) " 截止" else "") else "没写日期" + if (toClass) "" else "（放进待办）"
            val meta = ctx.row().apply { margins(t = 3) }
            meta.addView(ctx.chip(if (r.hw) typeName("作业") else if (toClass) "通知" else "待办", if (r.hw) C.red else C.sub, if (r.hw) C.dangerBg else C.mutedBg))
            meta.addView(ctx.text(wt + if (r.auto.isNotEmpty()) " · " + r.auto else "", 12.5f, if (r.auto.isNotEmpty()) C.accent else C.sub, lines = 1).apply { pad(6, 0, 0, 0) })
            cc.addView(meta)
            row.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
            row.addView(ctx.text("改 ›", 13f, C.accent, SEMI).apply { pad(8, 0, 0, 0) })
            row.tap { editTime(r) }
            c.addView(row)
        }
        body.addView(c)
        val n = rows.count { it.on }
        body.add(ctx.button(if (toClass) "发布 $n 条给全班" else "导入 $n 件") { save() }, 16)
        if (toClass) body.add(ctx.text("发布后全班同学都能看到，也会收到推送。", 12.5f, C.sub).apply { gravity = android.view.Gravity.CENTER }, 8)
    }

    /** 改一条的截止时间：下次上哪门课之前 / 今天 / 明天 / 选日期 / 不定 */
    private fun editTime(r: R) {
        val next = Courses.nextChoices(r.subject, 4)
        val opts = next.map { "📚 下次" + it.name + "课前 · " + it.text } + listOf("今天", "明天", "📅 选日期和时间…", "不定日期", if (r.hw) "不是作业" else "标成作业", "✏️ 改标题")
        Dialogs.sheet(ctx, r.subject, opts) { i ->
            val t = T.todayKey()
            when {
                i < next.size -> { r.day = next[i].day; r.time = next[i].time; r.auto = "下次${next[i].name}课前"; r.hw = true }
                else -> when (opts[i]) {
                    "今天" -> { r.day = t; r.auto = "" }
                    "明天" -> { r.day = T.addDays(t, 1); r.auto = "" }
                    "不定日期" -> { r.day = ""; r.time = ""; r.auto = "" }
                    "不是作业" -> r.hw = false
                    "标成作业" -> { r.hw = true; fillLesson(r) }
                    "✏️ 改标题" -> { Dialogs.prompt(ctx, "改标题", r.subject, "") { s -> if (s.isNotBlank()) { r.subject = s; redraw() } }; return@sheet }
                    else -> { Dialogs.pickDate(ctx, r.day) { d -> r.day = d; r.auto = ""; Dialogs.pickTime(ctx, r.time) { tm -> r.time = tm; redraw() }; redraw() }; return@sheet }
                }
            }
            redraw()
        }
    }

    private fun save() {
        val pick = rows.filter { it.on }
        if (pick.isEmpty()) { a.toast("没有要导入的"); return }
        if (toClass) {
            if (busy) return; busy = true
            a.toast("正在发布…")
            val n = java.util.concurrent.atomic.AtomicInteger()
            Bg.load({
                for (r in pick) { Items.publish(null, if (r.hw) "作业" else "通知", r.subject, r.note, r.day, r.time, r.place, ""); n.incrementAndGet() }
            }) { _, e ->
                busy = false
                if (e != null) { a.toast("发布了 ${n.get()} 条，后面的没成功：" + e.message); return@load }
                a.toast("已发布 ${n.get()} 条，全班都能看到 ✓"); close()
            }
            return
        }
        val stamp = System.currentTimeMillis()
        pick.forEachIndexed { i, r ->
            val rec = jsonOf("id" to "p${stamp}_m$i", "subject" to r.subject, "event_time" to if (r.day.isEmpty()) "" else r.day + if (r.time.isNotEmpty()) " " + r.time else "",
                "location" to r.place, "note" to r.note, "done" to r.done, "src" to "memo")
            if (r.hw) rec.put("kind", "作业")
            Items.saveMine(rec)
        }
        a.toast("导入了 ${pick.size} 件 ✓")
        close()
    }
}
