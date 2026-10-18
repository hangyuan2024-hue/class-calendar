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
    private var fPopup = false; private var popup0 = false
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
                fDay = src.day; fTime = src.time; fHw = src.hw
                if (key != null && src.mine) { editingId = src.id; fLocal = src.local; fRep = src.rep; fPin = src.pin }
                if (classMode) fType = maxOf(0, Items.TYPES.indexOf(src.type))
            } else { fDay = day ?: if (classMode || fHw) T.todayKey() else T.todayKey() }
            if (classMode) {
                b.addView(label("类型"))
                typeSeg = Seg(ctx, Items.TYPES.map { typeName(it) }, fType) { fType = it }
                b.addView(typeSeg)
            }
            b.addView(label(if (classMode) "科目 / 标题" else "什么事"))
            title = ctx.input(if (classMode) "比如：数学作业" else "比如：明天下午3点交数学作业", src?.title?.removePrefix("⚠ ") ?: "")
            b.addView(title)
            guess = ctx.text("", 13f, C.accent, SEMI).apply { visibility = View.GONE; bg(C.selected, 10); pad(12, 8); margins(t = 8) }
            b.addView(guess)
            if (classMode) { b.addView(label("说明")); summary = ctx.input("作业内容、要求…", src?.summary ?: "", multi = true); b.addView(summary) }
            b.addView(label("日期和时间"))
            dayBox = ctx.col(); b.addView(dayBox); paintDay()
            b.addView(label("地点", true)); place = ctx.input("比如：图书馆三楼", src?.location ?: ""); b.addView(place)
            if (classMode) {
                b.addView(label("要准备", true)); prep = ctx.input("比如：带计算器", src?.prepare ?: ""); b.addView(prep)
                // 5.9.2 重要的事：弹窗提醒全班
                popup0 = Popup.has(src?.id); fPopup = popup0
                val opts = ctx.card(2, 16).apply { margins(t = 16); pad(14, 2) }
                val tg = Toggle(ctx, "📣 重要：弹窗提醒全班", "同学下次打开时弹出来，点「我知道了」才关掉", fPopup) { fPopup = it }
                opts.addView(tg); b.addView(opts)
                if (src != null) Bg.load({ Store.cls?.let { Popup.refresh(it.str("id")) }; Popup.has(src.id) }) { on, _ -> if (on != null && on != popup0) { popup0 = on; fPopup = on; tg.on = on; tg.refresh() } }
            }
            else {
                b.addView(label("备注", true))
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
                opts.addView(Toggle(ctx, if (Store.work()) "这是一项任务" else "这是一项作业", "会出现在「${if (Store.work()) "任务" else "作业"}」里，截止前提醒你", fHw) { fHw = it })
                opts.addView(ctx.hline())
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

    private fun paintDay() {
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
            if (q.homework) fHw = true
            title.setText(q.subject); title.setSelection(title.text.length)
            guess.visibility = View.GONE; paintDay()
        }
    }

    private fun save() {
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
                val nid = Items.publish(id, Items.TYPES[fType], t, summary.text.toString(), fDay, fTime, place.text.toString(), prep.text.toString())
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
        if (fHw) rec.put("kind", "作业") else rec.put("kind", "")
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
        a.toast(if (editingId != null) "已保存" else "记好了 ✓")
        close()
    }
}
