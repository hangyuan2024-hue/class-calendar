package com.laolao.classcalendar.ui

import android.content.Intent
import android.graphics.Color
import android.provider.CalendarContract
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.str
import org.json.JSONArray

/** 事项详情：完成、备注、隐藏、编辑、加到手机日历、分享 */
class ItemPage(a: Main, private val key: String) : Page(a) {
    private lateinit var body: LinearLayout
    private var seen = false
    private var showOrig = false

    override fun build(): View = scaffold("事项详情") { body = it }

    override fun render() {
        view
        keepScroll(body)
        val r = Items.find(key)
        if (r == null) { body.addView(ctx.empty("🔍", "这条事项不在了", "可能已经被删除，或者换了班级")); return }
        if (!seen && !r.mine && Store.cls != null) {
            seen = true
            Bg.run { try { Api.rpc("item_seen", jsonOf("cid" to Store.cls!!.str("id"), "ids" to JSONArray().put(r.id.toLong()))) } catch (_: Exception) {} }
        }
        val c = ctx.card(20, 22)
        val tr = ctx.row()
        tr.addView(ctx.chip(if (r.mine && !r.hw) "我的" else typeName(r.type), C.type(r.type), if (r.hw) C.dangerBg else C.mutedBg, 12.5f).apply { pad(8, 2) })
        tr.addView(ctx.text(if (r.mine) (if (r.local) "🔒 只存在这台手机" else "仅自己可见") else (Store.cls?.str("name") ?: "班级"), 12.5f, C.sub).apply { pad(8, 0) })
        c.addView(tr)
        c.add(ctx.text(r.title, 21f, C.text, HEAVY), 10)
        if (r.needConfirm) c.add(ctx.text("⚠ 信息不完整，建议去群里核实", 13f, C.red).apply { bg(C.dangerBg, 8); pad(10, 6) }, 10)
        fun line(icon: String, s: String, color: Int = C.text) { if (s.isNotBlank()) c.add(ctx.row().apply { gravity = Gravity.TOP; addView(ctx.text(icon, 15f), LinearLayout.LayoutParams(dp(26), WRAP)); addView(ctx.text(s, 15f, color), LinearLayout.LayoutParams(0, WRAP, 1f)) }, 10) }
        if (r.dated) {
            val d = T.date(r.day)!!
            line("🗓", T.md(d) + " " + T.wk(d) + (if (r.time.isNotEmpty()) " " + r.time + (if (r.hw) " 截止" else "") else " 全天") + "（" + T.dayName(r.day) + "）")
        } else line("🗓", "时间待定", C.sub)
        if (r.hw && !r.done && r.dated) { val (t, lv) = Items.due(r); line("⏳", t, if (lv >= 2) C.red else C.accent) }
        line("📍", r.location)
        line("🎒", if (r.prepare.isNotBlank()) "要准备：" + r.prepare else "")
        line("📄", if (r.summary.isNotBlank() && r.summary != r.title) r.summary else "")
        if (r.note.isNotBlank()) c.add(ctx.text("📝 " + r.note, 14.5f, C.text).apply { bg(C.noteBg, 10); pad(12, 9) }, 12)
        body.addView(c)

        // 完成
        body.add(ctx.button(if (r.done) "已完成 · 点这里取消" else "✓ 完成", if (r.done) C.mutedBg else C.accent, if (r.done) C.sub else Color.WHITE) { v ->
            v.buzz(); a.toggle(r); render()
        }, 14)

        // 操作
        val ops = ctx.card(4, 18).apply { margins(t = 14) }
        if (r.mine) {
            ops.addView(ctx.cell("✏️", "编辑") { a.push(EditPage(a, r.key)) })
            ops.addView(ctx.cell("🗑", "删除") { Dialogs.confirm(ctx, "删除「${r.title}」？", "", "删除", danger = true) { Items.deleteMine(r.id); a.toast("已删除"); close() } })
        } else {
            ops.addView(ctx.cell("📝", if (r.note.isBlank()) "加备注" else "改备注", "只有自己看得到") {
                Dialogs.prompt(ctx, "备注", r.note, "比如：做到第几题了", multi = true) { s -> Items.setMark(r.key, jsonOf("note" to s)) }
            })
            ops.addView(ctx.cell("🙈", if (r.hidden) "取消隐藏" else "隐藏", "只是自己看不到，不影响别人") {
                Items.setMark(r.key, jsonOf("hidden" to !r.hidden)); a.toast(if (r.hidden) "已恢复显示" else "已隐藏"); if (!r.hidden) close()
            })
            if (Store.can("can_edit")) ops.addView(ctx.cell("✏️", "修改（全班都会看到）") { a.push(EditPage(a, r.key, classMode = true)) })
            else ops.addView(ctx.cell("✏️", "改成我自己的版本", "原来那条隐藏，换成一条只有你能看到的") { a.push(EditPage(a, null, copyOf = r.key)) })
            if (Store.can("can_delete")) ops.addView(ctx.cell("🗑", "删除（全班）") {
                Dialogs.confirm(ctx, "删除「${r.title}」？", "全班都会看不到这条事项。", "删除", danger = true) {
                    Bg.load({ Items.deleteClassItem(r.id) }) { _, e -> if (e != null) a.toast(e.message ?: "删除失败") else { a.toast("已删除"); close() } }
                }
            })
        }
        if (!r.course && (r.mine || Store.cls != null)) ops.addView(ctx.cell("📎", "附件", if (r.mine) "图片、文件，只有自己能看到" else "老师、班委发的图片和文件") { a.push(FilesPage(a, r.key)) })
        if (!r.mine && !r.course && (Store.isTeacher || Store.cls?.str("member_role") == "monitor" || Store.items.any { it.opt("id").toString() == r.id && it.str("created_by") == com.laolao.classcalendar.core.Api.uid }))
            ops.addView(ctx.cell("👀", "已读名单", "谁看过、谁还没看、谁完成了") { a.push(ViewersPage(a, r.id, r.title)) })
        if (r.dated) ops.addView(ctx.cell("📅", "加到手机日历", "到时候手机日历也会提醒") { toCalendar(r) })
        ops.addView(ctx.cell("↗", "分享给同学") {
            val s = "【${typeName(r.type)}】${r.title}" + (if (r.dated) "\n时间：" + T.md(r.day) + " " + T.wk(r.day) + " " + r.time else "") + (if (r.location.isNotBlank()) "\n地点：" + r.location else "") + (if (r.summary.isNotBlank() && r.summary != r.title) "\n" + r.summary else "") + "\n—— 来自捞捞课程表"
            a.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, s), "分享到"))
        })
        body.addView(ops)

        if (r.original.isNotBlank() && !r.original.startsWith("（由")) {
            body.addView(ctx.section("原文", if (showOrig) "点这里收起" else "老师 / 群里的原话，点这里展开").apply { tap { showOrig = !showOrig; render() } })
            if (showOrig) body.addView(ctx.text(r.original.take(2000), 14f, C.sub).apply { bg(C.card, 14, C.line); pad(14, 12); setTextIsSelectable(true) })
        }
    }

    private fun toCalendar(r: com.laolao.classcalendar.core.Item) {
        val i = Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI)
            .putExtra(CalendarContract.Events.TITLE, r.title)
            .putExtra(CalendarContract.Events.EVENT_LOCATION, r.location)
            .putExtra(CalendarContract.Events.DESCRIPTION, listOf(r.summary, if (r.prepare.isNotBlank()) "要准备：" + r.prepare else "").filter { it.isNotBlank() }.joinToString("\n"))
        val m = T.min(r.time)
        if (m == null) {
            i.putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true).putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, T.epoch(r.day, 0))
        } else {
            i.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, T.epoch(r.day, m)).putExtra(CalendarContract.EXTRA_EVENT_END_TIME, T.epoch(r.day, m + if (r.hw) 15 else 60))
        }
        try { a.startActivity(i) } catch (e: Exception) { a.toast("没找到手机日历") }
    }
}
