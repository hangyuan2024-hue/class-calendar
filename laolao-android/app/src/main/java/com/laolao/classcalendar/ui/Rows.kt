package com.laolao.classcalendar.ui

import android.graphics.Color
import android.graphics.Paint
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store

/** 打勾的小方框 */
fun Main.check(done: Boolean, onToggle: (View) -> Unit): View = text(if (done) "✓" else "", 13f, Color.WHITE, HEAVY).apply {
    gravity = Gravity.CENTER
    bg(if (done) C.accent else Color.TRANSPARENT, 7, if (done) C.accent else C.mutedText)
    layoutParams = LinearLayout.LayoutParams(dp(22), dp(22))
    tap { v -> v.buzz(); onToggle(v) }
}

/** 名字的叫法：职场人员把「作业」叫「任务」 */
fun typeName(t: String): String = if (Store.work()) when (t) { "作业" -> "任务"; "个人" -> "我的"; else -> t } else if (t == "个人") "我的" else t

/**
 * 一条事项（首页、作业页、日历共用）
 * side：右边显示什么（时间 / 截止标签）
 */
fun Main.itemRow(r: Item, showDate: Boolean = false, dueTag: Boolean = false): View {
    val row = row().apply { gravity = Gravity.TOP; pad(4, 13, 4, 13) }
    if (r.course) {
        row.addView(View(this).apply { bg(r.color, 3) }, LinearLayout.LayoutParams(dp(6), dp(22)).apply { rightMargin = dp(8); leftMargin = dp(8); topMargin = dp(1) })
    } else {
        val box = check(r.done) { toggle(r) }
        row.addView(box, (box.layoutParams as LinearLayout.LayoutParams).apply { rightMargin = dp(12); topMargin = dp(1) })
    }
    val body = col()
    val title = text((if (r.needConfirm) "⚠ " else "") + r.title, 15f, if (r.done) C.mutedText else C.text, SEMI, 2)
    if (r.done) title.paintFlags = title.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
    body.addView(title)
    val meta = row().apply { margins(t = 4) }
    val tn = if (r.course) "课程" else if (r.mine && !r.hw) "我的" else typeName(r.type)
    meta.addView(chip(tn, C.type(r.type), if (r.hw) C.dangerBg else if (r.type == "会议") C.selected else C.mutedBg))
    val subText = (if (showDate && r.dated) com.laolao.classcalendar.core.T.dayName(r.day) + (if (r.time.isNotEmpty()) " " + r.time else "") + "  " else "") + r.sub
    if (subText.isNotBlank()) meta.addView(text(subText.trim(), 12.5f, C.sub, lines = 1).apply { pad(6, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
    body.addView(meta)
    if (r.note.isNotBlank()) body.addView(text("📝 " + r.note, 12.5f, C.sub, lines = 2).apply { margins(t = 4) })
    row.addView(body, LinearLayout.LayoutParams(0, WRAP, 1f))
    if (dueTag && r.hw) {
        val (t, lv) = Items.due(r)
        val fg = when (lv) { 3 -> C.red; 2 -> C.accent; 1 -> C.accent; else -> C.sub }
        val bgc = when (lv) { 3 -> C.dangerBg; 2, 1 -> C.selected; else -> C.mutedBg }
        row.addView(chip(t, fg, bgc, 12f).apply { pad(8, 3) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
    } else {
        val t = if (!r.dated) "待定" else if (r.time.isEmpty()) "全天" else r.time + if (r.hw && !r.done) " 截止" else ""
        row.addView(text(t, 12.5f, if (r.hw && !r.done && r.time.isNotEmpty()) C.accent else C.sub, SEMI).apply { pad(8, 2, 0, 0) })
    }
    row.press(0, 12)
    row.tap { if (!r.course) push(ItemPage(this, r.key)) else push(CoursePage(this)) }
    row.setOnLongClickListener { v -> v.buzz(); quickActions(r); true }
    return row
}

/** 打勾 / 取消 */
fun Main.toggle(r: Item) {
    val on = Items.toggleDone(r.key)
    if (on) {
        val left = Items.pendingHomework().count { it.dated && it.day == r.day }
        toast(if (r.hw && left == 0) "这天的作业全做完了 🎉" else if (r.hw) "又完成一项 💪" else "完成 ✓")
    }
}

/** 长按：常用操作 */
fun Main.quickActions(r: Item) {
    if (r.course) return
    val opts = mutableListOf(if (r.done) "取消完成" else "✓ 完成", "查看详情")
    if (r.mine) { opts += "编辑"; opts += "删除" } else { opts += if (r.hidden) "取消隐藏" else "隐藏（只是自己看不到）" }
    Dialogs.sheet(this, r.title, opts, danger = if (r.mine) setOf(3) else emptySet()) { i ->
        when (opts[i]) {
            "取消完成", "✓ 完成" -> toggle(r)
            "查看详情" -> push(ItemPage(this, r.key))
            "编辑" -> push(EditPage(this, r.key))
            "删除" -> Dialogs.confirm(this, "删除「${r.title}」？", "", "删除", danger = true) { Items.deleteMine(r.id); toast("已删除") }
            else -> { Items.setMark(r.key, com.laolao.classcalendar.core.jsonOf("hidden" to !r.hidden)); toast(if (r.hidden) "已恢复显示" else "已隐藏，可以在日历里点「显示隐藏的」找回") }
        }
    }
}

/** 一组事项放在一张卡片里，中间细线隔开 */
fun Main.group(list: List<Item>, showDate: Boolean = false, dueTag: Boolean = false): LinearLayout = card(4, 18).apply {
    pad(10, 2, 12, 2)
    list.forEachIndexed { i, r -> if (i > 0) addView(hline()); addView(itemRow(r, showDate, dueTag)) }
}
