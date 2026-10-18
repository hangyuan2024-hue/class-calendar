package com.laolao.classcalendar.ui

import android.graphics.Color
import android.graphics.Paint
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.T
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
    val title = text((if (r.needConfirm) "⚠ " else "") + (if (r.pin && !r.done) "📌 " else "") + r.title, 15f, if (r.done) C.mutedText else C.text, SEMI, 2)
    if (r.done) title.paintFlags = title.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
    body.addView(title)
    val meta = row().apply { margins(t = 4) }
    val tn = if (r.course) "课程" else if (r.mine && !r.hw) "我的" else typeName(r.type)
    meta.addView(chip(tn, C.type(r.type), if (r.hw) C.dangerBg else if (r.type == "会议") C.selected else C.mutedBg))
    // 6.2 清单进度、重复
    if (r.list.isNotEmpty()) meta.addView(chip("☑ " + com.laolao.classcalendar.core.MemoCore.statText(r.list), if (r.list.all { it.d }) C.green else C.sub, C.mutedBg), LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) })
    if (r.rep.isNotEmpty()) meta.addView(chip("🔁 " + com.laolao.classcalendar.core.MemoCore.repName(r.rep), C.sub, C.mutedBg), LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) })
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
    } else if (Items.state(r) != null) {
        // 已完成 / 已上完 / 已结束；会议、活动、课：进行中、还有多久开始
        val (t, lv) = Items.state(r)!!
        val fg = when (lv) { 3, 2 -> Color.WHITE; 1 -> C.accent; -1 -> C.mutedText; else -> C.sub }
        val bgc = when (lv) { 3 -> C.green; 2 -> C.accent; 1 -> C.selected; -1 -> Color.TRANSPARENT; else -> C.mutedBg }
        row.addView(col().apply { gravity = Gravity.END
            addView(chip(t, fg, bgc, 11.5f).apply { pad(if (lv == -1) 0 else 8, 3) })
            if (lv in 0..1 && r.time.isNotEmpty()) addView(text(r.time, 11.5f, C.mutedText).apply { margins(t = 3); gravity = Gravity.END })
        }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
        if (lv == -1 && !r.done) row.alpha = 0.55f        // 上完的课、开完的会：变淡
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
    Items.lastRoll = ""
    val on = Items.toggleDone(r.key)
    // 6.2 重复的事项：排到下一次
    if (on && Items.lastRoll.isNotEmpty()) { toast("✓ 已完成，下次是 " + T.md(Items.lastRoll) + " " + T.wk(Items.lastRoll)); Items.lastRoll = ""; return }
    if (on) {
        val left = Items.pendingHomework().count { it.dated && it.day == r.day }
        // 作业：捞捞跳出来鼓励一下（照小程序）；其它事项轻提示
        if (r.hw) Cheer.show(this, if (left == 0) "allhw" else "homework", if (left == 0) "" else "${T.dayName(r.day)}还有 $left 项") else toast("完成 ✓")
    }
}

/** 长按：常用操作 */
fun Main.quickActions(r: Item) {
    if (r.course) return
    val opts = mutableListOf(if (r.done) "取消完成" else "✓ 完成", "查看详情")
    if (r.mine) { opts += "编辑"; opts += if (r.pin) "取消置顶" else "📌 置顶"; opts += "删除" } else { opts += if (r.hidden) "取消隐藏" else "隐藏（只是自己看不到）" }
    Dialogs.sheet(this, r.title, opts, danger = if (r.mine) setOf(4) else emptySet()) { i ->
        when (opts[i]) {
            "取消完成", "✓ 完成" -> toggle(r)
            "查看详情" -> push(ItemPage(this, r.key))
            "编辑" -> push(EditPage(this, r.key))
            "取消置顶", "📌 置顶" -> toast(if (Items.togglePin(r.id)) "已置顶，首页最上面一直能看到" else "已取消置顶")
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
