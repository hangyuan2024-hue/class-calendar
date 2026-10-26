package com.laolao.classcalendar.ui

import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Popup
import com.laolao.classcalendar.core.Memo
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.When
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.newId
import com.laolao.classcalendar.core.str

/**
 * 记一件事 / 编辑我的事项；classMode = 发布或修改班级事项（班委、老师）
 * copyOf = 把班级事项改成「我自己的版本」
 */
class EditPage(a: Main, private val key: String?, private val homework: Boolean = false, private val day: String? = null,
               private val classMode: Boolean = false, private val copyOf: String? = null) : Page(a) {
    private var fDay = ""; private var fTime = ""; private var fHw = homework; private var fLocal = false; private var fType = 0
    // 7.1 我的事项的类型（和网页、小程序一样）："" 普通 / 作业 / 会议 / 活动 / 通知
    private var fKind = if (homework) "作业" else ""
    private var kindSeg: Seg? = null
    private var fPopup = false; private var popup0 = false
    // 7.2 发布班级事项：每种类型的提示不一样，下面实时显示「同学们看到的样子」（和小程序 1.18、网页一样）
    private var fUnsure = false
    private var pv: LinearLayout? = null
    private var dayLabel: TextView? = null
    private class CT(val n: String, val ic: String, val ph: String, val sph: String, val wh: String, val lph: String, val pph: String)
    private val CTS = listOf(
        CT("作业", "📝", "科目，比如：高等数学", "要做什么、交到哪，比如：第三章习题 1-15，交到学习通", "截止", "可不填", "比如：打印纸质版"),
        CT("会议", "👥", "会议名称，比如：班委例会", "议题、要谁参加", "开始", "比如：A201", "比如：笔记本、笔"),
        CT("活动", "🎉", "活动名称，比如：运动会报名", "活动内容、怎么报名、注意事项", "开始", "比如：东区操场", "比如：学生证"),
        CT("通知", "📢", "通知标题，比如：周五停课", "通知的具体内容", "", "可不填", "可不填"))
    private fun ct(): CT = CTS.firstOrNull { it.n == Items.TYPES.getOrNull(fType) } ?: CTS[0]
    private var fRep = ""; private var fPin = false          // 6.2 备忘录：重复、置顶
    private lateinit var listIn: EditText
    private lateinit var title: EditText
    private lateinit var summary: EditText
    private lateinit var place: EditText
    private lateinit var note: EditText
    private lateinit var prep: EditText
    private lateinit var dayBox: LinearLayout
    private lateinit var guess: TextView
    private var editingId: String? = null
    private var typeSeg: Seg? = null
    private var busy = false

    override fun build(): View {
        val src = key?.let { Items.find(it) } ?: copyOf?.let { Items.find(it) }
        val name = when { classMode && key != null -> "修改班级事项"; classMode -> "发布班级事项"; key != null -> "编辑"; fHw -> "记一项作业"; else -> "记一件事" }
        val save = ctx.text("保存", 15f, C.accent, BOLD).apply { pad(12, 8); press(0, 10); tap { save() } }
        return scaffold(name, save) { b ->
            if (src != null) {
                fDay = src.day; fTime = src.time; fHw = src.hw; fKind = if (src.type in Items.MINE_KINDS) src.type else ""
                if (key != null && src.mine) { editingId = src.id; fLocal = src.local; fRep = src.rep; fPin = src.pin }
                if (classMode) { fType = maxOf(0, Items.TYPES.indexOf(src.type)); fUnsure = src.needConfirm && src.day.isNotEmpty() }
            } else { fDay = day ?: if (classMode || fHw) T.todayKey() else T.todayKey() }
            if (classMode) {
                b.addView(ctx.text("👥 " + (Store.cls?.str("name") ?: "本班") + " · 全班同学都会看到", 13f, C.sub).apply { pad(2, 4, 2, 0) })
                b.addView(label("发什么"))
                typeSeg = Seg(ctx, Items.TYPES.map { t -> (CTS.firstOrNull { it.n == t }?.ic?.plus(" ") ?: "") + typeName(t) }, fType) { fType = it; classHints(); paintPreview() }
                b.addView(typeSeg)
            }
            b.addView(label(if (classMode) "科目 / 标题" else "什么事"))
            title = ctx.input(if (classMode) "比如：数学作业" else "比如：明天下午3点交数学作业", src?.title?.removePrefix("⚠ ") ?: "")
            b.addView(title)
            guess = ctx.text("", 13f, C.accent, SEMI).apply { visibility = View.GONE; bg(C.selected, 10); pad(12, 8); margins(t = 8) }
            b.addView(guess)
            if (!classMode) {
                b.addView(label("类型"))
                val names = Items.MINE_KINDS.map { if (it == "作业" && Store.work()) "任务" else it }
                kindSeg = Seg(ctx, listOf("普通") + names, Items.MINE_KINDS.indexOf(fKind) + 1) { i -> fKind = if (i == 0) "" else Items.MINE_KINDS[i - 1]; fHw = fKind == "作业" }
                b.addView(kindSeg)
            }
            if (classMode) { b.addView(label("说明")); summary = ctx.input("作业内容、要求…", src?.summary ?: "", multi = true); b.addView(summary) }
            b.addView(label("日期和时间").also { if (classMode) dayLabel = (it as LinearLayout).getChildAt(0) as TextView })
            dayBox = ctx.col(); b.addView(dayBox); paintDay()
            b.addView(label("地点", true)); place = ctx.input("比如：图书馆三楼", src?.location ?: ""); b.addView(place)
            if (classMode) {
                b.addView(label("要准备", true)); prep = ctx.input("比如：带计算器", src?.prepare ?: ""); b.addView(prep)
                // 5.9.2 重要的事：弹窗提醒全班
                popup0 = Popup.has(src?.id); fPopup = popup0
                val opts = ctx.card(2, 16).apply { margins(t = 16); pad(14, 2) }
                val tg = Toggle(ctx, "📣 重要：弹窗提醒全班", "同学下次打开时弹出来，点「我知道了」才关掉", fPopup) { fPopup = it; paintPreview() }
                opts.addView(tg)
                opts.addView(ctx.hline())
                opts.addView(Toggle(ctx, "⚠ 信息还不确定", "同学会看到「建议去群里核实」；没填日期也会自动标上", fUnsure) { fUnsure = it; paintPreview() })
                b.addView(opts)
                b.addView(ctx.text("同学们看到的样子", 13f, C.sub, SEMI).apply { pad(2, 18, 2, 8) })
                pv = ctx.card(14, 16).also { b.addView(it) }
                classHints(); paintPreview()
                for (e in listOf(title, summary, place, prep)) e.addTextChangedListener(object : TextWatcher {
                    override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                    override fun afterTextChanged(s: Editable?) { paintPreview() }
                })
                if (src != null) Bg.load({ Store.cls?.let { Popup.refresh(it.str("id")) }; Popup.has(src.id) }) { on, _ -> if (on != null && on != popup0) { popup0 = on; fPopup = on; tg.on = on; tg.refresh() } }
            }
            else {
                b.addView(label("备注", true))
                // 7.2 换成全屏备忘录（格式、清单、图片、手写）；有格式的提醒一下在这里改文字会按新文字重排
                val nr = editingId?.let { Items.mineRecord(it) }
                if (nr != null && com.laolao.classcalendar.core.NoteStore.hasRich(nr)) b.addView(ctx.text("这条在全屏备忘录里有格式或图片：在这里改备注 / 清单的文字，格式会按新文字重排（图片不会丢）", 12.5f, C.sub).apply { pad(2, 0, 2, 6) })
                if (copyOf == null) b.addView(ctx.text("📒 换成全屏备忘录：格式、图片、手写 ›", 13.5f, C.accent, SEMI).apply { pad(2, 2, 2, 8); tap { toNote() } })
                // 6.2 改成我自己的版本：带上完整内容，不再只抄被截断的摘要
                note = ctx.input("想写多少写多少（最多 5000 字）", key?.let { Items.mineRecord(src?.id ?: "")?.str("note") } ?: (if (copyOf != null) src?.full ?: "" else ""), multi = true).apply {
                    filters = arrayOf<android.text.InputFilter>(android.text.InputFilter.LengthFilter(5000)) }
                b.addView(note)
                b.addView(label("清单", true))
                listIn = ctx.input("每行一项，可以一项项勾，比如：\n买牛奶\n打印签到表", if (editingId != null) com.laolao.classcalendar.core.MemoCore.listToText(src?.list ?: emptyList()) else "", multi = true)
                b.addView(listIn)
                b.addView(label("重复"))
                val reps = com.laolao.classcalendar.core.MemoCore.REPS
                b.addView(Seg(ctx, reps.map { it.second }, maxOf(0, reps.indexOfFirst { it.first == fRep })) { fRep = reps[it].first })
                val opts = ctx.card(2, 16).apply { margins(t = 16); pad(14, 2) }
                opts.addView(Toggle(ctx, "只存在这台手机", "不同步到网页和小程序", fLocal) { fLocal = it })
                opts.addView(ctx.hline())
                opts.addView(Toggle(ctx, "📌 置顶", "一直显示在首页最上面", fPin) { fPin = it })
                b.addView(opts)
            }
            b.add(ctx.button(if (classMode && key == null) "发布给全班" else "保存") { save() }, 22)
            if (editingId != null) b.add(ctx.text("删除这条", 14f, C.red, SEMI).apply {
                gravity = Gravity.CENTER; pad(12); tap { Dialogs.confirm(ctx, "删除「${title.text}」？", "", "删除", danger = true) { Items.deleteMine(editingId!!); a.toast("已删除"); close() } }
            }, 6)
            title.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { suggest() }
            })
            if (key == null && copyOf == null) { title.requestFocus(); Dialogs.showKeyboard(title) }
        }
    }
    private fun label(t: String, opt: Boolean = false): View = ctx.row().apply {
        pad(2, 18, 2, 8)
        addView(ctx.text(t, 13.5f, C.text, SEMI))
        if (opt) addView(ctx.text("选填", 11.5f, C.mutedText).apply { pad(6, 0) })
    }

    private fun classHints() {
        if (!classMode) return
        val t = ct()
        title.hint = t.ph; summary.hint = t.sph; place.hint = t.lph; prep.hint = t.pph
        dayLabel?.text = if (t.wh.isEmpty()) "日期和时间" else t.wh + "日期和时间"
    }
    private fun paintPreview() {
        val box = pv ?: return
        box.removeAllViews()
        val t = ct(); val col = C.type(t.n); val unsure = fUnsure || fDay.isEmpty()
        val r = ctx.row()
        r.addView(ctx.chip(typeName(t.n), col, C.alpha(col, 0.14f), 12f))
        if (fPopup) r.addView(ctx.text("📣 弹窗提醒", 11.5f, C.red, SEMI).apply { pad(6, 0) })
        r.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        r.addView(ctx.text(if (fDay.isEmpty()) "时间待定" else (if (t.wh.isNotEmpty()) t.wh + " " else "") + T.md(fDay) + (if (fTime.isNotEmpty()) " $fTime" else ""), 12.5f, C.sub))
        box.addView(r)
        val tt = title.text.toString().trim()
        box.add(ctx.text((if (unsure) "⚠ " else "") + tt.ifEmpty { t.ph }, 16f, if (tt.isEmpty()) C.mutedText else C.text, BOLD), 6)
        summary.text.toString().trim().takeIf { it.isNotEmpty() }?.let { box.add(ctx.text(it, 13.5f, C.sub), 3) }
        val lp = listOfNotNull(place.text.toString().trim().takeIf { it.isNotEmpty() }?.let { "📍 $it" }, prep.text.toString().trim().takeIf { it.isNotEmpty() }?.let { "🎒 $it" })
        if (lp.isNotEmpty()) box.add(ctx.text(lp.joinToString("　"), 13.5f, C.sub), 3)
        if (unsure) box.add(ctx.text("⚠ 信息不完整，建议去群里核实" + if (fDay.isEmpty()) "（没填日期会自动标上）" else "", 12.5f, C.red), 6)
    }

    private fun paintDay() {
        paintPreview()
        dayBox.removeAllViews()
        val quick = ctx.row()
        val t = T.todayKey()
        val opts = listOf("今天" to t, "明天" to T.addDays(t, 1), "后天" to T.addDays(t, 2), "不定" to "")
        for ((n, k) in opts) {
            val on = fDay == k
            quick.addView(ctx.text(n, 13.5f, if (on) C.accent else C.sub, SEMI).apply {
                gravity = Gravity.CENTER; bg(if (on) C.selected else C.mutedBg, 12, if (on) C.accent else 0); pad(0, 8)
                tap { fDay = k; if (k.isEmpty()) fTime = ""; paintDay() }
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { rightMargin = dp(8) })
        }
        dayBox.addView(quick)
        // 下次上课前（按课程表算，标题里写了哪门课就排在最前面）
        val next = com.laolao.classcalendar.core.Courses.nextChoices(if (::title.isInitialized) title.text.toString() else "")
        if (next.isNotEmpty()) {
            val hs = android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; margins(t = 10) }
            val cr = ctx.row()
            for (n in next) {
                val on = fDay == n.day && fTime == n.time
                cr.addView(ctx.text("📚 下次" + n.name.take(8) + "课前 · " + n.text, 13f, if (on) C.accent else C.text, SEMI).apply {
                    bg(if (on) C.selected else C.card, 12, if (on) C.accent else C.line); pad(12, 8)
                    tap { fDay = n.day; fTime = n.time; if (classMode) typeSeg?.let { fType = 0; it.pick(0) }; paintDay() }
                }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
            }
            hs.addView(cr)
            dayBox.addView(hs)
        }
        val r = ctx.row().apply { margins(t = 10) }
        val dTxt = if (fDay.isEmpty()) "📅 选日期" else "📅 " + T.md(fDay) + " " + T.wk(fDay)
        r.addView(ctx.text(dTxt, 15f, C.text, SEMI).apply { press(C.card, 12, C.line); pad(14, 11); tap { Dialogs.pickDate(ctx, fDay) { fDay = it; paintDay() } } }, LinearLayout.LayoutParams(0, WRAP, 1.3f))
        r.addView(ctx.text(if (fTime.isEmpty()) "🕐 全天" else "🕐 $fTime", 15f, C.text, SEMI).apply {
            press(C.card, 12, C.line); pad(14, 11)
            tap { Dialogs.pickTime(ctx, fTime) { fTime = it; if (fDay.isEmpty()) fDay = T.todayKey(); paintDay() } }
        }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
        if (fTime.isNotEmpty()) r.addView(ctx.text("✕", 14f, C.sub).apply { gravity = Gravity.CENTER; pad(10, 11); tap { fTime = ""; paintDay() } })
        dayBox.addView(r)
    }

    /** 标题里写了时间（「明天下午3点…」）：提示一键填入 */
    private var lastMatch: String? = null
    private fun suggest() {
        val s = title.text.toString()
        val m = com.laolao.classcalendar.core.Courses.match(s)
        if (m != lastMatch) { lastMatch = m; paintDay() }
        val q = Items.withLesson(Memo.quick(s), s)
        val hasDate = Memo.findDate(s, T.today()) != null || Memo.findTime(s) != null || q.day.isNotEmpty()
        if (!hasDate || (q.day == fDay && q.time == fTime)) { guess.visibility = View.GONE; return }
        guess.visibility = View.VISIBLE
        guess.text = "✨ 认出了：" + (if (q.day.isNotEmpty()) T.dayName(q.day) + " " else "") + q.time + (if (q.place.isNotEmpty()) " · 📍" + q.place else "") + "  点这里填入"
        guess.setOnClickListener {
            fDay = q.day; fTime = q.time
            if (q.place.isNotEmpty() && place.text.isBlank()) place.setText(q.place)
            if (q.homework) { fHw = true; fKind = "作业"; kindSeg?.pick(1) }
            title.setText(q.subject); title.setSelection(title.text.length)
            guess.visibility = View.GONE; paintDay()
        }
    }

    /** 7.2 写了的先存好，再换成全屏备忘录 */
    private fun toNote() {
        val t = title.text.toString().trim(); val n = note.text.toString().trim(); val l = listIn.text.toString().trim()
        if (t.isEmpty() && n.isEmpty() && l.isEmpty()) { close(); a.push(NotePage(a, editingId, fKind)); return }
        if (t.isEmpty()) title.setText((n.lines() + l.lines()).firstOrNull { it.isNotBlank() }?.trim()?.take(60) ?: "")
        save(thenNote = true)
    }

    private fun save(thenNote: Boolean = false) {
        if (busy) return
        var t = title.text.toString().trim()
        if (t.isEmpty()) { a.toast("写一下是什么事"); title.requestFocus(); return }
        Dialogs.hideKeyboard(title)
        if (classMode) {
            busy = true
            val id = key?.let { Items.find(it)?.id }
            val want = fPopup
            var popErr = ""
            Bg.load({
                val nid = Items.publish(id, Items.TYPES[fType], t, summary.text.toString(), fDay, fTime, place.text.toString(), prep.text.toString(), fUnsure)
                // 5.9.2 弹窗提醒：勾了 / 取消了才去改
                if (nid != null && want != popup0) try { Popup.set(Store.cls!!.str("id"), nid, want) } catch (e: Exception) {
                    popErr = if (Regex("popup_set|PGRST202|Could not find", RegexOption.IGNORE_CASE).containsMatchIn(e.message ?: "")) "弹窗提醒没开上：数据库还没执行 5.9.2 的 SQL" else "弹窗提醒没开上：" + e.message
                }
            }) { _, e ->
                busy = false
                if (e != null) a.toast(e.message ?: "保存失败") else { a.toast((if (id == null) "已发布，全班都能看到" else "已保存") + if (popErr.isNotEmpty()) "；$popErr" else if (want && !popup0) "，大家打开时会弹窗提醒" else ""); close() }
            }
            return
        }
        // 只写了一句话、没选时间：顺手认一下
        if (guess.visibility == View.VISIBLE && fTime.isEmpty()) { val q = Items.withLesson(Memo.quick(t), t); if (q.time.isNotEmpty()) { fDay = q.day; fTime = q.time; t = q.subject } }
        val rec = jsonOf("id" to (editingId ?: newId("p")), "subject" to t, "event_time" to When(fDay, fTime).takeIf { fDay.isNotEmpty() }?.toString().orEmpty(),
            "location" to place.text.toString().trim(), "note" to note.text.toString().trim())
        rec.put("kind", fKind)   // 空的在 saveMine 里去掉
        if (fLocal) rec.put("local", true) else rec.put("local", false)
        if (copyOf != null && editingId == null) { rec.put("from", copyOf); Items.setMark(copyOf, jsonOf("hidden" to true)) }
        if (editingId == null) rec.put("done", false)
        // 6.2 清单（原来勾过的保留）；备忘录粘进备注的「□ xxx」多行自动变成清单；重复、置顶
        val MC = com.laolao.classcalendar.core.MemoCore
        var lt = listIn.text.toString()
        if (lt.isBlank() && MC.looksLikeList(rec.str("note"))) { lt = rec.str("note"); rec.put("note", "") }
        val old = editingId?.let { Items.mineRecord(it) }?.let { MC.listOf(it) } ?: emptyList()
        val ls = MC.listFromText(lt, old)
        if (ls.isNotEmpty()) rec.put("list", MC.toJson(ls)) else if (editingId != null) rec.put("list", org.json.JSONArray())
        rec.put("rep", fRep)
        if (fPin) rec.put("pin", true) else rec.put("pin", false)
        if (fRep.isNotEmpty() && rec.str("event_time").isEmpty()) rec.put("event_time", T.todayKey())   // 重复的事要有起始日期
        Items.saveMine(rec)
        if (thenNote) { close(); a.push(NotePage(a, rec.str("id"))); return }
        a.toast(if (editingId != null) "已保存" else "记好了 ✓")
        close()
    }
}
