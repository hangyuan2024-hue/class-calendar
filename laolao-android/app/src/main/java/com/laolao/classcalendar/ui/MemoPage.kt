package com.laolao.classcalendar.ui

import android.content.ClipboardManager
import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Memo
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf

/** 从备忘录 / 微信聊天记录导入：一段文字拆成一条条待办 */
class MemoPage(a: Main, private val initial: String) : Page(a) {
    private lateinit var body: LinearLayout
    private lateinit var box: EditText
    private var rows: List<Memo.Row> = emptyList()
    private val off = HashSet<Int>()

    override fun build(): View = scaffold("导入待办") { b ->
        body = b
        b.addView(ctx.text("把备忘录、聊天记录里的文字粘贴进来：一行一件事，会自动认出「明天」「周三」「10月20日」「下午3点」；单独一行的日期算作下面几行的日期。", 13.5f, C.sub).apply { setLineSpacing(0f, 1.35f) })
        box = ctx.input("比如：\n周三：\n- 交英语作文\n- 下午3点 社团开会\n10月20日 数学小测", initial, multi = true).apply { minLines = 6; margins(t = 12) }
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
        rows = Memo.parse(box.text.toString()); off.clear()
        redraw()
    }
    private fun redraw() {
        while (body.childCount > 3) body.removeViewAt(3)
        if (rows.isEmpty()) { body.add(ctx.empty("🤔", "没认出事项", "一行写一件事试试"), 16); return }
        body.addView(ctx.section("认出 ${rows.size} 件事", "点方框可以不导入"))
        val c = ctx.card(4, 18)
        rows.forEachIndexed { i, r ->
            if (i > 0) c.addView(ctx.hline())
            val row = ctx.row().apply { pad(8, 10) }
            row.addView(a.check(i !in off) { if (!off.remove(i)) off += i; redraw() }, LinearLayout.LayoutParams(dp(22), dp(22)).apply { rightMargin = dp(10) })
            val cc = ctx.col()
            cc.addView(ctx.text(r.subject, 15f, if (i in off) C.mutedText else C.text, SEMI, 2))
            cc.addView(ctx.text((if (r.day.isNotEmpty()) T.dayName(r.day) + " " + T.md(r.day) + " " + r.time else "没写日期（放进待办）") + if (r.homework) " · 作业" else "", 12.5f, C.sub))
            row.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
            c.addView(row)
        }
        body.addView(c)
        body.add(ctx.button("导入 ${rows.size - off.size} 件") { save() }, 16)
    }
    private fun save() {
        val pick = rows.filterIndexed { i, _ -> i !in off }
        if (pick.isEmpty()) { a.toast("没有要导入的"); return }
        val stamp = System.currentTimeMillis()
        pick.forEachIndexed { i, r ->
            val rec = jsonOf("id" to "p${stamp}_m$i", "subject" to r.subject, "event_time" to if (r.day.isEmpty()) "" else r.day + if (r.time.isNotEmpty()) " " + r.time else "",
                "location" to r.place, "note" to r.note, "done" to r.done, "src" to "memo")
            if (r.homework) rec.put("kind", "作业")
            Items.saveMine(rec)
        }
        a.toast("导入了 ${pick.size} 件 ✓")
        close()
    }
}
