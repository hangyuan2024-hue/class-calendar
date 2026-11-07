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
    val tn = if (r.course) "课程" else if (r.mine && !r.hw) (if (r.type in Items.MINE_KINDS) "我的" + typeName(r.type) else "我的") else typeName(r.type)
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

// =====================================================================
// 7.x 时间线的一行（照小程序 1.22「接下来」）：左边时间 | 色条 | 标题、类型、说明、附件小图 | 右边状态或圆圈打勾。
// 点一下在原地展开（时间地点、要带的、清单、全文、备注、附件、操作按钮），再点收起；不再跳到另一页。长按照旧出常用操作。
// 展开了哪几条记在 RowOpen 里：数据刷新、整页重画后照样是展开的。
object RowOpen { val keys = HashSet<String>() }

fun Main.timeRow(r: Item, showDate: Boolean = false): View {
    val now = System.currentTimeMillis(); val today = T.todayKey()
    val row = row().apply { gravity = Gravity.TOP; pad(2, 13, 2, 13) }
    val late = r.hw && !r.done && r.dated && r.at() < now
    val soon = r.hw && !r.done && r.dated && !late && r.day == today
    val gT = when { !r.dated -> "待定"; showDate -> if (r.day == today) "今天" else if (T.dayDiff(r.day) == 1L) "明天" else T.md(r.day).replace("月", "/").removeSuffix("日"); else -> r.time.ifEmpty { "全天" } }
    val gD = when { showDate && r.time.isNotEmpty() -> r.time; r.course && r.endTime.isNotEmpty() -> "–" + r.endTime; r.hw && r.time.isNotEmpty() -> "截止"; r.endTime.isNotEmpty() -> "–" + r.endTime; else -> "" }
    val ended = Items.state(r)?.second == -1
    row.addView(col().apply {
        addView(text(gT, 13.5f, if (r.done || ended) C.mutedText else if (late) C.red else if (soon) C.accent else C.text, BOLD, 1))
        if (gD.isNotEmpty()) addView(text(gD, 11f, C.sub, lines = 1).apply { margins(t = 1) })
    }, LinearLayout.LayoutParams(dp(46), WRAP))
    // 色条：课用课的颜色
    row.addView(View(this).apply { if (r.course) background = round(r.color, dp(2).toFloat()) }, LinearLayout.LayoutParams(dp(3), LinearLayout.LayoutParams.MATCH_PARENT).apply { leftMargin = dp(2); rightMargin = dp(10); topMargin = dp(2); bottomMargin = dp(2) })
    val body = col()
    val tl = text((if (r.needConfirm) "⚠ " else "") + r.title, 15f, if (r.done || ended) C.mutedText else C.text, SEMI, 2)
    if (r.done || ended) tl.paintFlags = tl.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG
    val tr = row().apply { gravity = Gravity.CENTER_VERTICAL }
    if (r.pin && !r.done) tr.addView(Ic.plain(this, "📌", 14), LinearLayout.LayoutParams(dp(14), dp(14)).apply { rightMargin = dp(4) })
    tr.addView(tl, LinearLayout.LayoutParams(0, WRAP, 1f))
    val nf = HwPlus.count(r.key)
    if (nf > 0) tr.addView(row().apply { gravity = Gravity.CENTER_VERTICAL; addView(Ic.plain(this@timeRow, "📎", 13, C.sub), LinearLayout.LayoutParams(dp(13), dp(13))); addView(text("$nf", 11.5f, C.sub).apply { pad(2, 0, 0, 0) }) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) })
    body.addView(tr)
    // 小字一行：类型（作业红、会议蓝、活动绿）· 说明 · 清单进度 · 已读
    val tn = if (r.course) "课程" else if (r.mine && !r.hw) (if (r.type in Items.MINE_KINDS) "我的" + typeName(r.type) else "我的") else typeName(r.type)
    val gs = row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 3) }
    gs.addView(text(tn, 11.5f, when (r.type) { "作业" -> C.red; "会议" -> C.accent; "活动" -> C.green; else -> C.sub }, BOLD))
    val subs = listOfNotNull(r.sub.ifBlank { null }, if (r.list.isNotEmpty()) "清单 " + com.laolao.classcalendar.core.MemoCore.statText(r.list) else null, HwPlus.read(r).ifEmpty { null }).joinToString(" · ")
    if (subs.isNotEmpty()) gs.addView(text(subs, 12f, C.sub, lines = 1).apply { pad(6, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
    body.addView(gs)
    HwPlus.strip(this, r)?.let { body.add(it, 8) }
    val extra = col()
    body.addView(extra)
    row.addView(body, LinearLayout.LayoutParams(0, WRAP, 1f))
    // 右边：会议、课「进行中 / 还有多久」；能完成的是圆圈
    val st = if (r.hw) null else Items.state(r)
    if (st != null && st.second != -1 && st.first != "已完成") {
        val (t, lv) = st
        row.addView(chip(t, if (lv >= 2) Color.WHITE else C.accent, if (lv == 3) C.green else if (lv == 2) C.accent else C.selected, 11.5f).apply { pad(8, 3) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
    } else if (!r.course) row.addView(text(if (r.done) "✓" else "", 12f, Color.WHITE, HEAVY).apply {
        gravity = Gravity.CENTER
        background = round(if (r.done) C.green else 0, dp(12).toFloat(), if (r.done) C.green else C.line, dp(2))
        contentDescription = if (r.done) "取消完成" else "标记完成"
        tap { v -> v.buzz(); toggle(r) }
    }, LinearLayout.LayoutParams(dp(24), dp(24)).apply { leftMargin = dp(10) })
    if (ended && !r.done) row.alpha = 0.55f
    fun paint() { extra.removeAllViews(); if (r.key in RowOpen.keys) itemExtra(r, extra) }
    paint()
    row.press(0, 12)
    row.tap { if (r.course) push(CoursePage(this)) else { if (!RowOpen.keys.remove(r.key)) RowOpen.keys += r.key; paint() } }
    row.setOnLongClickListener { v -> v.buzz(); quickActions(r); true }
    return row
}

/** 展开后的内容：详细信息 + 一排操作按钮 */
fun Main.itemExtra(r: Item, box: LinearLayout) {
    box.setPadding(0, dp(10), 0, 0)
    fun line(icon: String, s: String, color: Int = C.text) {
        if (s.isBlank()) return
        box.add(row().apply {
            gravity = Gravity.TOP
            addView(Ic.plain(this@itemExtra, icon, 15, C.sub), LinearLayout.LayoutParams(dp(15), dp(15)).apply { rightMargin = dp(8); topMargin = dp(2) })
            addView(text(s, 13.5f, color).apply { setLineSpacing(0f, 1.25f) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        }, 6)
    }
    if (r.dated) line("🗓", T.md(r.day) + " " + T.wk(r.day) + (if (r.time.isNotEmpty()) " " + r.time + (if (r.endTime.isNotEmpty()) "–" + r.endTime else "") + (if (r.hw) " 截止" else "") else " 全天"))
    if (r.hw && !r.done && r.dated) { val (t, lv) = Items.due(r); line("⏳", t, if (lv >= 2) C.red else C.accent) }
    line("📍", r.location)
    line("🎒", if (r.prepare.isNotBlank()) "要准备：" + r.prepare else "")
    if (r.needConfirm) box.add(text("信息不完整，建议去群里核实", 12.5f, C.red).apply { bg(C.dangerBg, 8); pad(10, 5) }, 8)
    if (r.list.isNotEmpty()) r.list.forEachIndexed { i, li ->
        box.add(row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(0, 5, 0, 5)
            addView(check(li.d) { _ -> val l = Items.toggleListItem(r.id, i); if (l.isNotEmpty() && l.all { it.d } && !r.done) toast("清单都勾完了 🎉") }, LinearLayout.LayoutParams(dp(20), dp(20)).apply { rightMargin = dp(10) })
            addView(text(li.t, 14f, if (li.d) C.mutedText else C.text), LinearLayout.LayoutParams(0, WRAP, 1f))
        }, 2)
    }
    if (r.rep.isNotEmpty()) line("🔁", com.laolao.classcalendar.core.MemoCore.repName(r.rep) + "重复" + if (r.reps > 0) " · 已完成 ${r.reps} 次" else "", C.sub)
    if (r.summary.isNotBlank() && r.summary != r.title) box.add(col().apply {
        bg(C.mutedBg, 12); pad(12, 10)
        addView(text(r.summary, 13.5f, C.text, lines = 6).apply { setLineSpacing(0f, 1.3f) })
        addView(text("全屏查看 ›", 12f, C.accent, SEMI).apply { margins(t = 6) })
        tap { push(ItemPage(this@itemExtra, r.key)) }
    }, 8)
    if (r.note.isNotBlank()) box.add(text("备注：" + r.note, 13.5f, C.text).apply { bg(C.noteBg, 10); pad(12, 8) }, 8)
    // 操作
    val ops = FlowRow(this, dp(8), dp(8))
    fun op(t: String, on: Boolean = false, danger: Boolean = false, fn: () -> Unit) = ops.addView(text(t, 13f, if (on) Color.WHITE else if (danger) C.red else C.text, SEMI).apply {
        gravity = Gravity.CENTER; pad(13, 7); bg(if (on) C.accent else if (danger) C.dangerBg else C.mutedBg, 16); tap { it.buzz(); fn() }
    })
    op(if (r.done) "取消完成" else "✓ 完成", on = !r.done) { toggle(r) }
    if (r.mine) {
        op("编辑") { push(EditPage(this, r.key)) }
        op(if (r.pin) "取消置顶" else "置顶") { toast(if (Items.togglePin(r.id)) "已置顶" else "已取消置顶") }
    } else {
        op(if (r.note.isBlank()) "加备注" else "改备注") { Dialogs.prompt(this, "备注", r.note, "比如：做到第几题了", multi = true) { s -> Items.setMark(r.key, com.laolao.classcalendar.core.jsonOf("note" to s)) } }
        op(if (r.hidden) "取消隐藏" else "隐藏") { Items.setMark(r.key, com.laolao.classcalendar.core.jsonOf("hidden" to !r.hidden)); toast(if (r.hidden) "已恢复显示" else "已隐藏") }
    }
    val nf = HwPlus.count(r.key)
    if (r.mine || Store.cls != null) op(if (nf > 0) "附件（$nf）" else "加图片 / 文件") { push(FilesPage(this, r.key)) }
    op("更多 ›") { push(ItemPage(this, r.key)) }
    if (r.mine) op("删除", danger = true) { Dialogs.confirm(this, "删除「${r.title}」？", "", "删除", danger = true) { RowOpen.keys.remove(r.key); Items.deleteMine(r.id); toast("已删除") } }
    box.add(ops, 10)
}
