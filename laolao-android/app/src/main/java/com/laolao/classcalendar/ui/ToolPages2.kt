package com.laolao.classcalendar.ui

import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Diary
import com.laolao.classcalendar.core.ErrBook
import com.laolao.classcalendar.core.Farm
import com.laolao.classcalendar.core.Growth
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Meta
import com.laolao.classcalendar.core.Oracle
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.TimeMaster
import com.laolao.classcalendar.core.Words
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONObject

/** 工具页统一的头：小字 + 大标题 + 一句介绍 */
private fun Page.toolHead(body: LinearLayout, kicker: String, lead: String) {
    body.addView(ctx.text(kicker, 12f, C.accent, SEMI))
    body.addView(ctx.text(lead, 13.5f, C.sub).apply { margins(t = 4); setLineSpacing(0f, 1.3f) })
}
private fun Page.err(body: LinearLayout, e: Throwable) { body.add(ctx.text(e.message ?: "出错了", 13.5f, C.red).apply { bg(C.dangerBg, 10); pad(12, 8) }, 10) }

// =====================================================================
/** 个人日记：每天一页，心情、天气、照片，正文加密只存在这台手机上 */
class DiaryPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var day = T.todayKey()
    private var e: Diary.Entry? = null
    private var dirty = false
    private var editor: EditText? = null
    private var stateTv: TextView? = null
    override val autoRender = false
    override fun build(): View = scaffold("个人日记") { body = it }
    override fun onHide() { flush() }
    override fun onBack(): Boolean { flush(); return false }
    private val saver = Runnable { flush() }
    private fun flush() {
        val x = e ?: return; if (!dirty) return
        x.text = editor?.text?.toString() ?: x.text
        try { Diary.save(x); dirty = false; stateTv?.text = "内容已保存" } catch (ex: Exception) { stateTv?.text = ex.message }
    }
    private fun markDirty() { dirty = true; stateTv?.text = "正在记录…"; Bg.main.removeCallbacks(saver); Bg.main.postDelayed(saver, 800) }
    private fun go(d: String) { flush(); day = d; e = null; render() }
    override fun render() {
        view; keepScroll(body)
        toolHead(body, "只属于你的，一页校园日常", "记录小事、收藏照片，让每一天都有自己的温度。")
        val x = try { e ?: Diary.read(day).also { e = it } } catch (ex: Exception) { err(body, ex); return }
        // 日期
        val dr = ctx.row().apply { margins(t = 14) }
        dr.addView(ctx.text("‹", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { go(T.addDays(day, -1)) } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        dr.addView(ctx.text(T.md(day) + " " + T.wk(day) + "（" + T.dayName(day) + "）", 16f, C.text, BOLD).apply { gravity = Gravity.CENTER; tap { Dialogs.pickDate(ctx, day) { go(it) } } }, LinearLayout.LayoutParams(0, WRAP, 1f))
        dr.addView(ctx.text("›", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { go(T.addDays(day, 1)) } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        body.addView(dr)
        // 心情
        val ms = android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; margins(t = 12) }
        val mr = ctx.row()
        for (m in Diary.MOODS) mr.addView(ctx.text(m.emoji + " " + m.label, 13.5f, if (x.mood == m.key) Color.WHITE else C.text, SEMI).apply {
            pad(12, 7); bg(if (x.mood == m.key) C.accent else C.card, 16, if (x.mood == m.key) 0 else C.line); tap { x.mood = if (x.mood == m.key) "" else m.key; markDirty(); flush(); render() }
        }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
        ms.addView(mr); body.addView(ms)
        // 纸
        val paper = ctx.card(16, 20).apply { margins(t = 12) }
        val tr = ctx.row()
        tr.addView(ctx.text(x.city.ifEmpty { "我的手帐" } + if (x.temp.isNotEmpty()) " · ${x.temp}℃" else "", 13f, C.sub), LinearLayout.LayoutParams(0, WRAP, 1f))
        tr.addView(ctx.text("记录天气", 13f, C.accent, SEMI).apply { tap {
            Dialogs.prompt(ctx, "城市（选填）", x.city, "你所在的城市") { c -> Dialogs.prompt(ctx, "气温 ℃（选填）", x.temp, "比如：22") { t -> x.city = c; x.temp = t.filter { it.isDigit() || it == '-' || it == '.' }; markDirty(); flush(); render() } }
        } })
        paper.addView(tr)
        val ed = EditText(ctx).apply {
            setText(x.text); hint = "今天有什么想记住的？哪怕是一件很小的事…"; setTextColor(C.text); setHintTextColor(C.mutedText); textSize = 16f
            background = null; gravity = Gravity.TOP; minLines = 8; setLineSpacing(0f, 1.45f); inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            addTextChangedListener(object : android.text.TextWatcher {
                override fun afterTextChanged(s: android.text.Editable?) { markDirty() }
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
        }
        editor = ed; paper.add(ed, 8)
        // 照片
        if (x.photos.isNotEmpty()) {
            val pr = android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false }
            val row = ctx.row()
            for (p in x.photos) {
                val iv = ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP; bg(C.mutedBg, 12); clipToOutline = true }
                if (p.data.isNotEmpty()) Media.show(iv, p.data, 400)
                iv.setOnClickListener { if (p.data.isNotEmpty()) Media.preview(a, p.data) }
                iv.setOnLongClickListener { Dialogs.confirm(ctx, "移除这张照片？", "", "移除", danger = true) { x.photos.remove(p); markDirty(); flush(); render() }; true }
                row.addView(iv, LinearLayout.LayoutParams(dp(110), dp(110)).apply { rightMargin = dp(8) })
            }
            pr.addView(row); paper.add(pr, 10)
        }
        val ar = ctx.row().apply { margins(t = 10) }
        ar.addView(ctx.soft("＋ 添加照片") {
            if (x.photos.size >= 12) { a.toast("每天最多 12 张照片"); return@soft }
            Media.pickImages(a, false) { us -> val u = us.firstOrNull() ?: return@pickImages
                Bg.load({ Media.dataUrl(ctx, u) }) { d, er -> if (d == null) a.toast(er?.message ?: "照片读取失败") else { x.text = ed.text.toString(); x.photos += Diary.Photo(com.laolao.classcalendar.core.Local.id("photo"), "日记照片", d); markDirty(); flush(); render() } }
            }
        })
        ar.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        stateTv = ctx.text(if (x.updated.isNotEmpty()) "内容已保存" else "给今天留下一点记录", 12.5f, C.sub); ar.addView(stateTv)
        paper.addView(ar)
        body.addView(paper)
        if (x.updated.isNotEmpty()) body.add(ctx.text("删除这一天", 13f, C.red).apply { gravity = Gravity.END; tap { Dialogs.confirm(ctx, "删除 $day 的日记？", "日记、心情和照片都会删掉。", "删除", danger = true) { dirty = false; Diary.remove(day); e = null; render() } } }, 8)
        // 历史
        val h = Diary.history().filter { it.first != day }
        body.addView(ctx.section("翻翻以前的日子", "${h.size} 天"))
        if (h.isEmpty()) body.addView(ctx.text("写下第一句话，从今天开始留住生活。", 13.5f, C.sub).apply { bg(C.card, 14, C.line); pad(14, 14) })
        else { val hc = ctx.card(4, 18); h.take(60).forEachIndexed { i, (d, m, n) -> if (i > 0) hc.addView(ctx.hline()); hc.addView(ctx.cell(m.take(2).trim(), T.md(d) + " " + T.wk(d), m.drop(2).trim() + if (n > 0) " · $n 张照片" else "") { go(d) }) }; body.addView(hc) }
        body.add(ctx.text("正文加密保存在这台手机上，不会上传。照片长按可以移除。", 12f, C.mutedText), 12)
    }
}

// =====================================================================
/** 错题本：按学科分本子，题目图片、答案、错因、解析，标记掌握 */
class ErrBookPage(a: Main, private val bookId: String? = null) : Page(a) {
    private lateinit var body: LinearLayout
    private var filter = 0; private var q = ""
    override fun build(): View = scaffold(if (bookId == null) "错题本" else "错题本", right = ctx.text("＋ 收录", 14f, C.accent, BOLD).apply { pad(12, 8); press(C.selected, 12); tap { edit(null) } }) { body = it }
    override fun render() {
        view; keepScroll(body)
        try { if (bookId == null) shelf() else book() } catch (e: Exception) { err(body, e) }
    }
    private fun shelf() {
        toolHead(body, "错过的题，是最好的老师", "按学科整理错题，题目可以直接拍照，复习时一道道标记掌握。")
        val all = ErrBook.books(); val notes = ErrBook.notes()
        val vis = all.filter { it.str("id") != ErrBook.UNFILED || notes.any { n -> n.str("bookId") == ErrBook.UNFILED } }
        body.add(ctx.text("${vis.size} 本 · ${notes.size} 道错题 · 待复习 ${notes.count { !it.optBoolean("mastered") }} 道", 13f, C.sub), 10)
        var row: LinearLayout? = null
        vis.forEachIndexed { i, b ->
            if (i % 2 == 0) { row = ctx.row(); body.addView(row, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(10) }) }
            val has = notes.filter { it.str("bookId") == b.str("id") }; val m = has.count { it.optBoolean("mastered") }
            val c = ctx.col().apply {
                pad(14, 14); press(C.c(ErrBook.colour(b)), 16); tap { a.push(ErrBookPage(a, b.str("id"))) }
                addView(ctx.text(b.str("subject"), 12f, C.c("#3c4650"), SEMI)); addView(ctx.text(b.str("name"), 16f, C.c("#1e2a32"), BOLD, 2).apply { margins(t = 4) })
                addView(ctx.text("${has.size} 道 · 待复习 ${has.size - m}", 12f, C.c("#4b5660")).apply { margins(t = 8) })
            }
            row!!.addView(c, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i % 2 == 1) leftMargin = dp(10) })
        }
        if (vis.size % 2 == 1) row?.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f).apply { leftMargin = dp(10) })
        body.add(ctx.button("＋ 新建一本错题本", C.selected, C.accent) { bookEdit(null) }, 16)
        body.add(ctx.text("错题和图片只保存在这台手机上。", 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 10)
    }
    private fun book() {
        val b = ErrBook.books().firstOrNull { it.str("id") == bookId } ?: run { body.addView(ctx.empty("📚", "这本错题本不在了")); return }
        val all = ErrBook.notes().filter { it.str("bookId") == bookId }
        val hc = ctx.col().apply { pad(16, 14); bg(C.c(ErrBook.colour(b)), 16) }
        hc.addView(ctx.text(b.str("subject"), 12f, C.c("#3c4650"), SEMI)); hc.addView(ctx.text(b.str("name"), 19f, C.c("#1e2a32"), HEAVY))
        hc.addView(ctx.text("收录 ${all.size} 道 · 已掌握 ${all.count { it.optBoolean("mastered") }} 道", 12.5f, C.c("#4b5660")).apply { margins(t = 4) })
        if (bookId != ErrBook.UNFILED) hc.add(ctx.text("整理这本 ›", 13f, C.c("#2d3a8c"), SEMI).apply { tap { bookEdit(b) } }, 6)
        body.addView(hc)
        val s = ctx.input("搜题干、答案、错因", q).apply { setOnEditorActionListener { v, _, _ -> q = v.text.toString(); render(); true }; imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH }
        body.add(s, 12)
        body.add(Seg(ctx, listOf("全部", "待复习", "已掌握"), filter) { filter = it; render() }, 10)
        val list = all.filter { (filter == 0 || (filter == 2) == it.optBoolean("mastered")) && listOf("question", "answer", "reason", "analysis").joinToString(" ") { k -> it.str(k) }.lowercase().contains(q.trim().lowercase()) }.reversed()
        if (list.isEmpty()) { body.addView(ctx.empty("📝", if (all.isEmpty()) "这本还等着第一道题" else "没有匹配的错题", if (all.isEmpty()) "点右上角「收录」，题目照片也能直接放进来。" else "")); return }
        for (x in list.take(60)) {
            val c = ctx.card(14, 18).apply { margins(t = 10) }
            val hr = ctx.row()
            hr.addView(ctx.chip(if (x.optBoolean("mastered")) "已掌握" else "待复习", if (x.optBoolean("mastered")) C.green else C.red, C.alpha(if (x.optBoolean("mastered")) C.green else C.red, 0.12f), 12f).apply { pad(8, 2) })
            hr.addView(ctx.text(x.str("createTime"), 12f, C.sub).apply { pad(8, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            hr.addView(ctx.text("⋯", 20f, C.sub).apply { pad(8, 0); tap {
                Dialogs.sheet(ctx, "", listOf(if (x.optBoolean("mastered")) "改为待复习" else "标记掌握", "编辑", "删除"), danger = setOf(2)) { i ->
                    when (i) { 0 -> { ErrBook.toggleMastered(x.opt("id").toString()); render() }; 1 -> edit(x); else -> Dialogs.confirm(ctx, "删除这道错题和它的图片？", "", "删除", danger = true) { ErrBook.delNote(x.opt("id").toString()); render() } }
                }
            } })
            c.addView(hr)
            c.add(ctx.text(x.str("question").ifEmpty { "图片错题" }, 15.5f, C.text, SEMI).apply { setTextIsSelectable(true) }, 8)
            val imgs = x.optJSONArray("images")?.objs() ?: emptyList()
            if (imgs.isNotEmpty()) {
                val r = ctx.row()
                for (p in imgs.take(6)) { val d = ErrBook.photo(p.str("id")); if (d.isEmpty()) continue
                    r.addView(ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP; bg(C.mutedBg, 10); clipToOutline = true; Media.show(this, d, 400); setOnClickListener { Media.preview(a, d) } }, LinearLayout.LayoutParams(dp(88), dp(88)).apply { rightMargin = dp(6) }) }
                c.add(android.widget.HorizontalScrollView(ctx).apply { addView(r) }, 8)
            }
            for ((k, n) in listOf("answer" to "答案", "reason" to "错误原因", "analysis" to "解析与笔记")) if (x.str(k).isNotEmpty())
                c.add(ctx.text(android.text.SpannableStringBuilder().apply { append(n + "：", android.text.style.StyleSpan(android.graphics.Typeface.BOLD), 0); append(x.str(k)) }, 14f, C.text).apply { setTextIsSelectable(true) }, 6)
            body.addView(c)
        }
    }
    private fun edit(x: JSONObject?) {
        val books = ErrBook.books()
        var bi = maxOf(0, books.indexOfFirst { it.str("id") == (x?.str("bookId") ?: bookId ?: books[0].str("id")) })
        var mastered = x?.optBoolean("mastered") ?: false
        val photos = (x?.optJSONArray("images")?.objs() ?: emptyList()).map { it.str("id") to ErrBook.photo(it.str("id")) }.toMutableList()
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var d: android.app.Dialog
        c.addView(ctx.text(if (x == null) "收录一道错题" else "编辑这道错题", 18f, C.text, BOLD))
        val bk = ctx.text("", 15f, C.text, SEMI).apply { pad(14, 12); bg(C.mutedBg, 12) }
        fun paintBk() { bk.text = "📚 " + books[bi].str("name") + "  ⌄" }
        paintBk(); bk.setOnClickListener { Dialogs.sheet(ctx, "放进哪本", books.map { it.str("name") }) { bi = it; paintBk() } }
        c.add(bk, 12)
        val qd = ctx.input("题干（也可以只放图片）", x?.str("question") ?: "", multi = true)
        val an = ctx.input("答案", x?.str("answer") ?: "", multi = true).apply { minLines = 2 }
        val rs = ctx.input("错误原因", x?.str("reason") ?: "").apply { }
        val al = ctx.input("解析与笔记", x?.str("analysis") ?: "", multi = true).apply { minLines = 2 }
        c.add(qd, 10)
        val pr = ctx.row()
        fun paintPhotos() {
            pr.removeAllViews()
            for (p in photos) pr.addView(ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP; bg(C.mutedBg, 10); clipToOutline = true; Media.show(this, p.second, 300); setOnClickListener { Dialogs.confirm(ctx, "移除这张图片？", "", "移除", danger = true) { photos.remove(p); paintPhotos() } } }, LinearLayout.LayoutParams(dp(70), dp(70)).apply { rightMargin = dp(6) })
            pr.addView(ctx.text("＋\n图片", 13f, C.accent, SEMI).apply { gravity = Gravity.CENTER; bg(C.selected, 10); tap {
                if (photos.size >= 6) { a.toast("一题最多 6 张图片"); return@tap }
                Media.pickImages(a, true) { us -> Bg.load({ us.take(6 - photos.size).map { com.laolao.classcalendar.core.Local.id("img") to Media.dataUrl(ctx, it) } }) { l, e -> if (l == null) a.toast(e?.message ?: "") else { photos += l; paintPhotos() } } }
            } }, LinearLayout.LayoutParams(dp(70), dp(70)))
        }
        paintPhotos(); c.add(android.widget.HorizontalScrollView(ctx).apply { addView(pr) }, 10)
        c.add(an, 10); c.add(rs, 10); c.add(al, 10)
        c.add(Toggle(ctx, "已经掌握", "", mastered) { mastered = it }, 6)
        val er = ctx.text("", 13f, C.red).apply { visibility = View.GONE }; c.add(er, 6)
        c.add(ctx.button("保存") {
            try { ErrBook.saveNote(x?.opt("id")?.toString(), books[bi].str("id"), qd.text.toString(), an.text.toString(), rs.text.toString(), al.text.toString(), mastered, photos); Dialogs.hideKeyboard(c); d.dismiss(); a.toast("保存好了"); render() }
            catch (e: Exception) { er.text = e.message; er.visibility = View.VISIBLE }
        }, 10)
        d = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }
    private fun bookEdit(b: JSONObject?) {
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var d: android.app.Dialog
        var color = b?.str("color")?.ifEmpty { null } ?: "sky"
        c.addView(ctx.text(if (b == null) "新建一本错题本" else "整理这本错题本", 18f, C.text, BOLD))
        val sub = ctx.input("学科，比如 数学", b?.str("subject") ?: ""); val nm = ctx.input("本子名称（可不填）", b?.str("name") ?: "")
        c.add(sub, 12)
        val chips = ctx.row(); ErrBook.SUBJECTS.forEach { s -> chips.addView(ctx.text(s, 13f, C.text).apply { pad(10, 6); bg(C.mutedBg, 12); tap { sub.setText(s) } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6) }) }
        c.add(android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(chips) }, 8)
        c.add(nm, 10)
        val cr = ctx.row()
        fun paint() { cr.removeAllViews(); for ((k, n, v) in ErrBook.COLOURS) cr.addView(ctx.text(if (k == color) "✓" else "", 14f, C.c("#1e2a32"), BOLD).apply { gravity = Gravity.CENTER; background = round(C.c(v), dp(18).toFloat(), if (k == color) C.text else 0, dp(2)); tap { color = k; paint() } }, LinearLayout.LayoutParams(dp(36), dp(36)).apply { rightMargin = dp(8) }) }
        paint(); c.add(cr, 12)
        val er = ctx.text("", 13f, C.red).apply { visibility = View.GONE }; c.add(er, 6)
        c.add(ctx.button("保存") {
            try { val id = ErrBook.saveBook(b?.str("id"), sub.text.toString(), nm.text.toString(), color); Dialogs.hideKeyboard(c); d.dismiss(); a.toast("本子保存好了"); if (b == null) a.push(ErrBookPage(a, id)) else render() }
            catch (e: Exception) { er.text = e.message; er.visibility = View.VISIBLE }
        }, 10)
        if (b != null) c.add(ctx.text("移走这本（错题会转入「未分类」）", 13.5f, C.red).apply { gravity = Gravity.CENTER; pad(0, 12); tap { Dialogs.confirm(ctx, "移走「${b.str("name")}」？", "其中的错题会转入「未分类」，图片保留。", "移走", danger = true) { ErrBook.removeBook(b.str("id")); d.dismiss(); close() } } }, 4)
        d = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }
}

// =====================================================================
/** 时间管理大师：每日 / 每周三只青蛙 + 番茄任务 + 专注记录 */
class TimeMasterPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var tab = 0; private var day = T.todayKey()
    private var clock: TextView? = null; private var bar: View? = null; private var barBox: FrameLayout? = null
    private val tick = object : Runnable { override fun run() {
        try { if (TimeMaster.reconcile()) { a.toast("这一段计时已完成"); clock?.buzz(); render() } else paint() } catch (_: Exception) {}
        Bg.main.postDelayed(this, 1000)
    } }
    override fun build(): View = scaffold("时间管理大师") { body = it }
    override fun onShow() { Bg.main.removeCallbacks(tick); Bg.main.post(tick) }
    override fun onHide() { Bg.main.removeCallbacks(tick); a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    private fun paint() {
        val st = TimeMaster.timer(); val left = Math.ceil(TimeMaster.remaining(st)).toInt()
        clock?.text = String.format("%02d:%02d", left / 60, left % 60)
        val box = barBox; val b = bar
        if (box != null && b != null && box.width > 0) b.layoutParams = b.layoutParams.apply { width = (box.width * (1 - left / maxOf(1.0, st.optDouble("duration")))).toInt() }.also { b.requestLayout() }
    }
    override fun render() {
        view; keepScroll(body)
        toolHead(body, "少一点拖延，多一点掌控", "先吃掉最重要的三只青蛙，再用一个番茄，认真做好一件事。")
        body.add(Seg(ctx, listOf("三只青蛙", "番茄专注", "专注记录"), tab) { tab = it; render() }, 12)
        try { when (tab) { 0 -> frogs(); 1 -> focus(); else -> stats() } } catch (e: Exception) { err(body, e) }
    }
    private fun frogs() {
        val dr = ctx.row().apply { margins(t = 12) }
        dr.addView(ctx.text("📅 " + T.md(day) + " " + T.wk(day), 15f, C.text, SEMI).apply { pad(12, 8); bg(C.card, 12, C.line); tap { Dialogs.pickDate(ctx, day) { day = it; render() } } })
        if (day != T.todayKey()) dr.addView(ctx.text("回到今天", 13f, C.accent, SEMI).apply { pad(12, 8); tap { day = T.todayKey(); render() } })
        body.addView(dr)
        for (weekly in listOf(false, true)) {
            body.addView(ctx.section(if (weekly) "本周的三件大事" else "今天，先做这三件事", if (weekly) "让每天的努力有方向" else ""))
            TimeMaster.frogs(day, weekly).forEachIndexed { i, f ->
                val c = ctx.card(14, 16).apply { margins(t = if (i == 0) 0 else 8); if (f.optBoolean("done")) alpha = 0.6f }
                val r = ctx.row()
                r.addView(ctx.text("${i + 1}", 14f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; bg(if (weekly) C.purple else C.green, 9) }, LinearLayout.LayoutParams(dp(26), dp(26)))
                val cc = ctx.col().apply { pad(10, 0) }
                cc.addView(ctx.text(f.str("title").ifEmpty { if (weekly) "给这一周一个方向" else "写下最重要的一件事" }, 15f, if (f.str("title").isEmpty()) C.mutedText else C.text, SEMI))
                cc.addView(ctx.text(if (weekly) (if (f.str("due").isNotEmpty()) "截止 " + f.str("due") else "尚未设置截止日期") else "计划 ${f.optInt("planMin")} 分钟 · 已专注 ${Math.round(f.optDouble("actualMin"))} 分钟" + if (f.optInt("stars") > 0) " · " + "★".repeat(f.optInt("stars")) else "", 12f, C.sub))
                r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
                r.addView(a.check(f.optBoolean("done")) { try { TimeMaster.toggleFrog(day, weekly, i); render() } catch (e: Exception) { a.toast(e.message ?: "") } }, LinearLayout.LayoutParams(dp(24), dp(24)))
                c.addView(r)
                if (f.str("note").isNotEmpty()) c.add(ctx.text(f.str("note"), 12.5f, C.sub), 6)
                val br = ctx.row().apply { margins(t = 8) }
                br.addView(ctx.text(if (f.str("title").isEmpty()) "填写" else "编辑", 13f, C.accent, SEMI).apply { pad(10, 5); bg(C.selected, 10); tap { frogEdit(weekly, i, f) } })
                if (!weekly && f.str("title").isNotEmpty()) br.addView(ctx.text("🍅 专注这件事", 13f, C.red, SEMI).apply { pad(10, 5); bg(C.dangerBg, 10); layoutParams = LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) }; tap {
                    try { TimeMaster.assign(null, f.str("title"), org.json.JSONObject().put("day", day).put("id", f.str("id")).put("title", f.str("title"))); tab = 1; render() } catch (e: Exception) { a.toast(e.message ?: "") }
                } })
                c.addView(br)
                body.addView(c)
            }
        }
    }
    private fun frogEdit(weekly: Boolean, i: Int, f: JSONObject) {
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var d: android.app.Dialog
        var stars = f.optInt("stars"); var prio = f.str("priority"); var due = f.str("due")
        c.addView(ctx.text("安排这只青蛙", 18f, C.text, BOLD))
        val t = ctx.input("最重要的事，比如：完成实验报告", f.str("title")); c.add(t, 12)
        val sr = ctx.row(); fun ps() { sr.removeAllViews(); sr.addView(ctx.text("重要程度  ", 14f, C.sub)); for (k in 1..5) sr.addView(ctx.text(if (k <= stars) "★" else "☆", 24f, C.c("#e0a526")).apply { pad(4, 0); tap { stars = k; ps() } }) }
        ps(); c.add(sr, 10)
        val pr = ctx.row(); fun pp() { pr.removeAllViews(); for ((k, n) in TimeMaster.PRIOS) pr.addView(ctx.text(n, 12.5f, if (k == prio) Color.WHITE else C.text).apply { pad(10, 6); bg(if (k == prio) C.accent else C.mutedBg, 12); tap { prio = k; pp() } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6) }) }
        pp(); c.add(android.widget.HorizontalScrollView(ctx).apply { addView(pr) }, 10)
        val pm = ctx.input("计划时长（分钟）", if (f.optInt("planMin") > 0) "${f.optInt("planMin")}" else "", type = InputType.TYPE_CLASS_NUMBER)
        val dueTv = ctx.text("", 15f, C.text).apply { pad(14, 12); bg(C.mutedBg, 12) }
        fun pd() { dueTv.text = "截止日期：" + due.ifEmpty { "点这里选（可不填）" } }
        if (weekly) { pd(); dueTv.setOnClickListener { Dialogs.pickDate(ctx, due.ifEmpty { T.todayKey() }) { due = it; pd() } }; c.add(dueTv, 10) } else c.add(pm, 10)
        val note = ctx.input("行动备注：把第一步写得具体一点…", f.str("note"), multi = true).apply { minLines = 2 }; c.add(note, 10)
        val er = ctx.text("", 13f, C.red).apply { visibility = View.GONE }; c.add(er, 6)
        c.add(ctx.button("保存") {
            try { TimeMaster.saveFrog(day, weekly, i, t.text.toString(), stars, prio, pm.text.toString().toIntOrNull() ?: 0, due, note.text.toString(), f.optBoolean("done")); Dialogs.hideKeyboard(c); d.dismiss(); render() }
            catch (e: Exception) { er.text = e.message; er.visibility = View.VISIBLE }
        }, 10)
        d = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }
    private fun focus() {
        val st = TimeMaster.timer(); val opts = TimeMaster.settings()
        if (st.optBoolean("isRunning") && opts.optBoolean("keepScreenOn")) a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val c = ctx.card(18, 22).apply { gravity = Gravity.CENTER_HORIZONTAL; margins(t = 12) }
        c.addView(ctx.text((TimeMaster.PHASE[st.str("phase")] ?: "专注") + " · " + if (st.optBoolean("isRunning")) "进行中" else "准备好了", 13.5f, C.sub, SEMI).apply { gravity = Gravity.CENTER })
        clock = ctx.text("", 52f, C.text, HEAVY).apply { gravity = Gravity.CENTER; typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD) }
        c.addView(clock)
        c.addView(ctx.text(st.str("currentTaskTitle").ifEmpty { "一次只专注一件事" }, 14f, C.text).apply { gravity = Gravity.CENTER })
        val bx = FrameLayout(ctx).apply { bg(C.mutedBg, 4) }; val b = View(ctx).apply { bg(if (st.str("phase") == "focus") C.red else C.green, 4) }
        bx.addView(b, FrameLayout.LayoutParams(0, MATCH)); barBox = bx; bar = b
        c.addView(bx, LinearLayout.LayoutParams(MATCH, dp(8)).apply { topMargin = dp(14) })
        bx.post { paint() }
        val br = ctx.row().apply { margins(t = 16) }
        br.addView(ctx.button(if (st.optBoolean("isRunning")) "暂停" else "开始 / 继续", if (st.optBoolean("isRunning")) C.selected else C.red, if (st.optBoolean("isRunning")) C.accent else Color.WHITE) {
            try { if (TimeMaster.timer().optBoolean("isRunning")) TimeMaster.pause() else TimeMaster.start(); com.laolao.classcalendar.work.Background.pomoAlarm(a); render() } catch (e: Exception) { a.toast(e.message ?: "") }
        }, LinearLayout.LayoutParams(0, dp(46), 1f))
        br.addView(ctx.button("重置", C.mutedBg, C.sub) { Dialogs.confirm(ctx, "重置当前计时？", "未完成的这一段不会计入专注记录。", "重置") { TimeMaster.reset(); com.laolao.classcalendar.work.Background.pomoAlarm(a); render() } }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { leftMargin = dp(10) })
        c.addView(br, LinearLayout.LayoutParams(MATCH, WRAP))
        val ar = ctx.row().apply { margins(t = 10) }
        ar.addView(ctx.text("本轮已完成 ${st.optInt("completedInCycle")} 个番茄", 12.5f, C.sub), LinearLayout.LayoutParams(0, WRAP, 1f))
        ar.addView(ctx.text("切换阶段", 13f, C.accent, SEMI).apply { tap { Dialogs.confirm(ctx, "切换到下一阶段？", "未完成的这一段不会计入记录。", "切换") { TimeMaster.skip(); render() } } })
        ar.addView(ctx.text("计时设置", 13f, C.accent, SEMI).apply { tap { settings() } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(14) })
        c.addView(ar, LinearLayout.LayoutParams(MATCH, WRAP))
        body.addView(c)
        body.addView(ctx.section("专注任务", "").apply { addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f)); addView(ctx.text("＋ 添加", 14f, C.accent, BOLD).apply { tap { addTask() } }) })
        val ts = TimeMaster.tasks()
        if (ts.isEmpty()) body.addView(ctx.text("添加一个任务，把番茄用在真正重要的事上。", 13.5f, C.sub).apply { bg(C.card, 14, C.line); pad(14, 14) })
        val tc = ctx.card(4, 18)
        ts.forEachIndexed { i, x ->
            if (i > 0) tc.addView(ctx.hline())
            val cur = st.opt("currentTaskId")?.toString() == x.opt("id").toString()
            val r = ctx.row().apply { pad(14, 10); if (cur) bg(C.selected, 14) }
            r.addView(a.check(x.optBoolean("done")) { TimeMaster.toggleTask(x.opt("id").toString()); render() }, LinearLayout.LayoutParams(dp(22), dp(22)))
            val cc = ctx.col().apply { pad(10, 0); tap { try { TimeMaster.assign(x.opt("id").toString(), x.str("title"), null); a.toast("已选择专注任务"); render() } catch (e: Exception) { a.toast(e.message ?: "") } } }
            cc.addView(ctx.text(x.str("title") + if (cur) "  · 当前" else "", 15f, C.text, SEMI)); cc.addView(ctx.text("🍅 ${x.optInt("pomodoros")} / ${x.optInt("estimate")} 个番茄 · 点一下选它", 12f, C.sub))
            r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
            r.addView(ctx.text("删除", 12.5f, C.mutedText).apply { pad(8, 4); tap { Dialogs.confirm(ctx, "删除这个番茄任务？", "已完成的专注记录保留。", "删除", danger = true) { try { TimeMaster.deleteTask(x.opt("id").toString()); render() } catch (e: Exception) { a.toast(e.message ?: "") } } } })
            tc.addView(r)
        }
        if (ts.isNotEmpty()) body.addView(tc)
        body.add(ctx.text("离开页面或锁屏后，剩余时间按真实时间计算，到点会提醒你。", 12f, C.mutedText), 10)
    }
    private fun addTask() {
        Dialogs.prompt(ctx, "添加专注任务", "", "这一轮，要做好什么？") { t ->
            if (t.isBlank()) return@prompt
            Dialogs.sheet(ctx, "预计需要几个番茄", (1..8).map { "$it 个" }) { i -> try { TimeMaster.addTask(t, i + 1); render() } catch (e: Exception) { a.toast(e.message ?: "") } }
        }
    }
    private fun settings() {
        val o = TimeMaster.settings()
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var d: android.app.Dialog
        c.addView(ctx.text("计时设置", 18f, C.text, BOLD))
        fun num(label: String, k: String): EditText { c.add(ctx.text(label, 13f, C.sub), 10); return ctx.input("", "${o.optInt(k)}", type = InputType.TYPE_CLASS_NUMBER).also { c.add(it, 4) } }
        val f = num("专注（1 至 180 分钟）", "focusMin"); val s = num("短休息（1 至 60 分钟）", "shortMin"); val l = num("长休息（1 至 120 分钟）", "longMin"); val e = num("每完成几个番茄长休息（2 至 12）", "longEvery")
        var ab = o.optBoolean("autoBreak"); var an = o.optBoolean("autoNext"); var so = o.optBoolean("sound"); var ko = o.optBoolean("keepScreenOn")
        c.add(Toggle(ctx, "自动开始休息", "", ab) { ab = it }, 8); c.addView(Toggle(ctx, "休息后自动专注", "", an) { an = it })
        c.addView(Toggle(ctx, "结束时振动提醒", "", so) { so = it }); c.addView(Toggle(ctx, "计时期间保持亮屏", "", ko) { ko = it })
        val er = ctx.text("", 13f, C.red).apply { visibility = View.GONE }; c.add(er, 6)
        c.add(ctx.button("保存") {
            try { TimeMaster.saveSettings(f.text.toString().toIntOrNull() ?: 0, s.text.toString().toIntOrNull() ?: 0, l.text.toString().toIntOrNull() ?: 0, e.text.toString().toIntOrNull() ?: 0, ab, an, so, ko); Dialogs.hideKeyboard(c); d.dismiss(); render() }
            catch (x: Exception) { er.text = x.message; er.visibility = View.VISIBLE }
        }, 10)
        d = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }
    private fun stats() {
        val sr = ctx.row().apply { margins(t = 12) }
        val focus = TimeMaster.sessions().filter { it.str("phase") == "focus" }
        for ((n, l) in listOf("${TimeMaster.focusMinutes(1)}" to "今天 · 分钟", "${TimeMaster.focusMinutes(7)}" to "近 7 天 · 分钟", "${focus.size}" to "完成的番茄"))
            sr.addView(ctx.col().apply { pad(12, 12); bg(C.card, 14, C.line); gravity = Gravity.CENTER_HORIZONTAL; addView(ctx.text(n, 22f, C.text, HEAVY)); addView(ctx.text(l, 11.5f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (sr.childCount > 0) leftMargin = dp(8) })
        body.addView(sr)
        val h = TimeMaster.sessions().takeLast(30).reversed()
        if (h.isEmpty()) { body.addView(ctx.empty("🍅", "还没有记录", "完成第一个专注时段，这里就会留下你的真实记录。")); return }
        val c = ctx.card(4, 18).apply { margins(t = 12) }
        h.forEachIndexed { i, x -> if (i > 0) c.addView(ctx.hline()); c.addView(ctx.cell(if (x.str("phase") == "focus") "🍅" else "☕", x.str("taskTitle").ifEmpty { if (x.str("phase") == "focus") "专注时段" else "休息时段" }, x.str("date") + " · ${Math.round(x.optDouble("minutes"))} 分钟", "") {}) }
        body.addView(c)
    }
}

// =====================================================================
/** 神谕阁：答案之书、卡牌指引、历史 */
class OraclePage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var tab = 0; private var result: JSONObject? = null; private var reading: List<Oracle.Card>? = null; private var spread = 0; private var domain = 0; private var question = ""
    override val autoRender = false
    override fun build(): View = scaffold("神谕阁") { body = it }
    override fun render() {
        view; keepScroll(body)
        try { Oracle.load(ctx) } catch (e: Exception) { err(body, e); return }
        toolHead(body, "为日常思考，留一点灵感", "翻开答案之书，或者从一组卡牌里，看看问题的另一面。")
        body.add(Seg(ctx, listOf("答案之书", "卡牌指引", "历史"), tab) { tab = it; render() }, 12)
        when (tab) {
            0 -> {
                val c = ctx.card(16, 18).apply { margins(t = 12) }
                val q = ctx.input("把想问的问题放在这里（选填）", question, multi = true).apply { minLines = 2 }
                c.addView(q)
                val br = ctx.row().apply { margins(t = 12) }
                br.addView(ctx.button("翻开一页") { question = q.text.toString(); result = Oracle.answer(question); Dialogs.hideKeyboard(q); render() }, LinearLayout.LayoutParams(0, dp(46), 1f))
                br.addView(ctx.button("指定页码", C.selected, C.accent) { question = q.text.toString(); Dialogs.prompt(ctx, "想翻到哪一页？", "", "1 到 ${Oracle.answerCount}") { p -> try { result = Oracle.answer(question, p.toIntOrNull() ?: -1); render() } catch (e: Exception) { a.toast(e.message ?: "") } } }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { leftMargin = dp(10) })
                c.addView(br); body.addView(c)
                val r = result
                if (r != null) {
                    val rc = ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; pad(20, 22); background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR, intArrayOf(C.c("#2a2350"), C.c("#4b3a8c"))).apply { cornerRadius = dp(20).toFloat() }; margins(t = 14) }
                    rc.addView(ctx.text("✦", 26f, C.c("#ffd27a")).apply { gravity = Gravity.CENTER })
                    rc.addView(ctx.text("第 ${r.optInt("p")} 页 / ${Oracle.answerCount} 页", 12f, C.c("#c9c3f0")).apply { gravity = Gravity.CENTER })
                    rc.addView(ctx.text(r.str("a"), 22f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; margins(t = 10) })
                    if (r.str("q").isNotEmpty()) rc.addView(ctx.text("你刚刚问：" + r.str("q"), 12.5f, C.c("#c9c3f0")).apply { gravity = Gravity.CENTER; margins(t = 10) })
                    body.addView(rc)
                } else body.add(ctx.text("在心里想一想问题。准备好时，翻开属于你的这一页。", 13.5f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 20) }, 6)
            }
            1 -> {
                body.addView(ctx.section("今日指引", "同一天保持一致"))
                body.addView(cardView(Oracle.daily()))
                body.addView(ctx.section("梳理一个具体问题"))
                val sp = Oracle.spreads(); val dm = Oracle.domains()
                val pr = ctx.row()
                pr.addView(ctx.text("🃏 " + (sp.getOrNull(spread)?.str("name") ?: "") + " ⌄", 14f, C.text, SEMI).apply { pad(12, 10); bg(C.card, 12, C.line); tap { Dialogs.sheet(ctx, "选牌阵", sp.map { it.str("name") + " · " + it.str("desc") }) { spread = it; render() } } }, LinearLayout.LayoutParams(0, WRAP, 1f))
                pr.addView(ctx.text("🧭 " + (dm.getOrNull(domain)?.second ?: "") + " ⌄", 14f, C.text, SEMI).apply { pad(12, 10); bg(C.card, 12, C.line); tap { Dialogs.sheet(ctx, "问的是哪方面", dm.map { it.second }) { domain = it; render() } } }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
                body.addView(pr)
                body.add(ctx.button("翻开这个牌阵") { try { reading = Oracle.spread(sp[spread].str("id"), dm[domain].first); render() } catch (e: Exception) { a.toast(e.message ?: "") } }, 12)
                reading?.forEachIndexed { i, c -> body.add(ctx.text("${i + 1} · ${c.position}", 13f, C.accent, SEMI), 14); body.add(cardView(c), 6) }
            }
            else -> {
                val h = Oracle.history()
                body.addView(ctx.section("${h.size} 条思考记录", "").apply { if (h.isNotEmpty()) { addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f)); addView(ctx.text("清空", 13f, C.red).apply { tap { Dialogs.confirm(ctx, "清空历史记录？", "今日指引保留。", "清空", danger = true) { Oracle.clear(); render() } } }) } })
                if (h.isEmpty()) body.addView(ctx.empty("✦", "这里会留下你翻过的答案和牌阵"))
                for (x in h.take(60)) {
                    val c = ctx.card(14, 16).apply { margins(t = 8) }
                    val r = ctx.row(); r.addView(ctx.text(x.str("title"), 14.5f, C.text, SEMI, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
                    r.addView(ctx.text("删除", 12.5f, C.mutedText).apply { tap { Oracle.remove(x.str("type"), x.optInt("i")); render() } }); c.addView(r)
                    c.addView(ctx.text(x.str("label") + " · " + com.laolao.classcalendar.core.T.ago(x.optLong("t")), 12f, C.sub)); c.add(ctx.text(x.str("body"), 13.5f, C.text), 6)
                    body.addView(c)
                }
            }
        }
        body.add(ctx.text("把答案当作思考的起点，把决定留给自己。记录只保存在这台手机上。", 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 16)
    }
    private fun cardView(c: Oracle.Card): View {
        val v = ctx.card(16, 18)
        val cv = ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; pad(14, 16); background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR, intArrayOf(C.c("#2a2350"), C.c("#6b4fb8"))).apply { cornerRadius = dp(14).toFloat() }; if (c.reversed) rotation = 0f }
        cv.addView(ctx.text(c.roman, 13f, C.c("#ffd27a"), BOLD)); cv.addView(ctx.text(if (c.reversed) "✧ 逆位" else "✧", 18f, C.c("#ffd27a")))
        cv.addView(ctx.text(c.name, 20f, Color.WHITE, HEAVY)); cv.addView(ctx.text(c.en, 10.5f, C.c("#c9c3f0")))
        v.addView(cv, LinearLayout.LayoutParams(dp(160), WRAP).apply { gravity = Gravity.CENTER_HORIZONTAL })
        v.add(ctx.text(c.keywords.joinToString(" · "), 12.5f, C.accent, SEMI).apply { gravity = Gravity.CENTER }, 10)
        v.add(ctx.text(c.core, 14f, C.text).apply { setLineSpacing(0f, 1.35f) }, 8)
        if (c.advice.isNotEmpty()) v.add(ctx.text("💡 " + c.advice, 13f, C.sub).apply { bg(C.mutedBg, 10); pad(12, 8) }, 8)
        return v
    }
}

// =====================================================================
/** 单词搭子：七本词书，学新词、间隔复习、小测、收藏、薄弱词 */
class WordsPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var tab = 0; private var mode = "search"; private var q = ""
    private var queue: List<String> = emptyList(); private var pos = 0; private var sMode = ""; private var revealed = false; private var correct = 0
    private var quiz: List<Pair<String, String>>? = null; private var chosen = ""
    private var loading = true; private var loadErr = ""
    override val autoRender = false
    override fun build(): View = scaffold("单词搭子") { body = it }
    override fun onShow() { if (!Words.loaded) Bg.load({ Words.load(ctx) }) { _, e -> loading = false; loadErr = e?.message ?: ""; render() } else { loading = false; render() } }
    override fun onBack(): Boolean { if (queue.isNotEmpty()) { queue = emptyList(); render(); return true }; return false }
    override fun render() {
        view; keepScroll(body)
        toolHead(body, "每天一点点，积累会发生", "七本完整词书，学新词，也按自己的记忆节奏复习（3、7、15、30 天）。")
        if (loading) { body.add(ctx.text("正在准备词库…", 14f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 40) }, 10); return }
        if (loadErr.isNotEmpty()) { body.add(ctx.text("词库准备失败：$loadErr", 13.5f, C.red), 10); return }
        try { if (queue.isNotEmpty()) session() else home() } catch (e: Exception) { err(body, e) }
    }
    private fun home() {
        val o = Words.overview()
        body.add(ctx.text(o.book.str("ico") + " " + o.book.str("name") + " · ${o.count} 词  ⌄", 15f, C.text, SEMI).apply { pad(14, 11); bg(C.card, 14, C.line); tap {
            val bs = Words.books(); Dialogs.sheet(ctx, "换一本词书", bs.map { it.str("ico") + " " + it.str("name") + " · " + it.optInt("count") + " 词" }) { i -> Words.setBook(bs[i].str("id")); render() }
        } }, 12)
        body.add(Seg(ctx, listOf("今天", "词库", "成长"), tab) { tab = it; render() }, 12)
        when (tab) {
            0 -> {
                val h = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(20, 18); margins(t = 12) }
                h.addView(ctx.text("今天的新词计划", 12.5f, C.sub, SEMI))
                h.addView(ctx.text("${o.dailyDone} / ${o.dailyTotal}", 32f, C.heroText, HEAVY))
                h.addView(ctx.text(if (o.dailyTotal - o.dailyDone > 0) "还有 ${o.dailyTotal - o.dailyDone} 个新词，慢慢来就好" else "今天的新词清单已完成，也可以做一轮复习", 13f, C.sub))
                val br = ctx.row().apply { margins(t = 12) }
                br.addView(ctx.button("开始学新词") { start("new") }, LinearLayout.LayoutParams(0, dp(46), 1f))
                br.addView(ctx.button("复习 ${o.due} 词", C.card, C.accent) { start("review") }.apply { background = round(C.card, dp(14).toFloat(), C.line, dp(1)) }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { leftMargin = dp(10) })
                h.addView(br); body.addView(h)
                val sr = ctx.row().apply { margins(t = 12) }
                for ((n, l) in listOf("${o.learned}" to "当前词书已学", "${o.mastered}" to "已经掌握", "${o.stats.optInt("streak")}" to "连续学习 · 天"))
                    sr.addView(ctx.col().apply { pad(12, 12); bg(C.card, 14, C.line); gravity = Gravity.CENTER_HORIZONTAL; addView(ctx.text(n, 22f, C.text, HEAVY)); addView(ctx.text(l, 11.5f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (sr.childCount > 0) leftMargin = dp(8) })
                body.addView(sr)
                val c = ctx.card(4, 18).apply { margins(t = 12) }
                c.addView(ctx.cell("📝", "来一轮 10 题小测", "从已学和今日词汇中练习，答错的进入薄弱词") { start("quiz") }); c.addView(ctx.hline())
                c.addView(ctx.cell("🩹", "薄弱词", "${o.weak} 个，需要再认识一次") { mode = "weak"; tab = 1; render() }); c.addView(ctx.hline())
                c.addView(ctx.cell("⭐", "我的收藏", "${o.favs} 个") { mode = "favorites"; tab = 1; render() })
                body.addView(c)
            }
            1 -> {
                val mr = ctx.row()
                for ((k, n) in listOf("search" to "全部", "favorites" to "收藏", "weak" to "薄弱词", "review" to "到期复习")) mr.addView(ctx.text(n, 13.5f, if (mode == k) Color.WHITE else C.text, SEMI).apply { pad(12, 6); bg(if (mode == k) C.accent else C.card, 14, if (mode == k) 0 else C.line); tap { mode = k; render() } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6) })
                body.add(mr, 12)
                body.add(ctx.input("搜索英文或中文释义，回车搜索", q).apply { imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH; setOnEditorActionListener { v, _, _ -> q = v.text.toString(); render(); true } }, 10)
                val rows = Words.rows(mode, q)
                if (rows.isEmpty()) body.addView(ctx.empty("🔍", "没有找到匹配的词"))
                else { val c = ctx.card(4, 18).apply { margins(t = 10) }
                    rows.forEachIndexed { i, w -> if (i > 0) c.addView(ctx.hline())
                        val r = ctx.row().apply { pad(14, 10); press(0, 14); tap { detail(w.word) } }
                        val cc = ctx.col(); cc.addView(ctx.text(w.word + "  ", 16f, C.text, BOLD).apply { append(android.text.SpannableString(w.stage).apply { setSpan(android.text.style.ForegroundColorSpan(C.sub), 0, length, 0); setSpan(android.text.style.RelativeSizeSpan(0.75f), 0, length, 0) }) })
                        cc.addView(ctx.text(w.cn.lines().firstOrNull() ?: "", 13f, C.sub, lines = 1))
                        r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
                        r.addView(ctx.text(if (w.fav) "★" else "☆", 22f, C.c("#e0a526")).apply { pad(10, 0); tap { Words.favorite(w.word); render() } })
                        c.addView(r) }
                    body.addView(c) }
                body.add(ctx.text("每次显示前 40 条，输入关键词可以更快定位。", 12f, C.mutedText), 8)
            }
            else -> {
                val h = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(20, 18); margins(t = 12) }
                h.addView(ctx.text("累积学习经验", 12.5f, C.sub, SEMI)); h.addView(ctx.text("${o.stats.optInt("xpTotal")} XP", 32f, C.heroText, HEAVY))
                body.addView(h)
                val c = ctx.card(4, 18).apply { margins(t = 12) }
                for ((k, v) in listOf("当前词书已学" to "${o.learned} / ${o.count}", "复习反馈" to "${o.stats.optInt("reviews")} 次", "测验答对" to "${o.stats.optInt("quizCorrect")} / ${o.stats.optInt("quizTotal")}", "已经掌握" to "${o.mastered} 词")) { if (c.childCount > 0) c.addView(ctx.hline()); c.addView(ctx.cell("", k, "", v) {}) }
                body.addView(c)
            }
        }
    }
    private fun start(m: String) {
        val ids = Words.session(m)
        if (ids.isEmpty()) { a.toast(if (m == "review") "当前词书没有到期的词，去学几个新词吧" else "这份学习清单已经完成，可以查看词库或换一本词书"); return }
        queue = ids; pos = 0; sMode = m; correct = 0; revealed = false; quiz = null; chosen = ""; render()
    }
    private fun next() { pos++; revealed = false; quiz = null; chosen = ""; if (pos >= queue.size) { val r = if (sMode == "quiz") "本轮测验：$correct / ${queue.size} 题答对" else "这一轮已完成，好好休息一下"; queue = emptyList(); a.toast(r) }; render() }
    private fun session() {
        val w = queue[pos]; val c = Words.meaning(w)
        val hr = ctx.row()
        hr.addView(ctx.chip(when (sMode) { "quiz" -> "小测验"; "review" -> "到期复习"; else -> "学习时间" }, C.accent, C.selected, 12f).apply { pad(8, 3) })
        hr.addView(ctx.text("  ${pos + 1} / ${queue.size}", 13f, C.sub), LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("退出", 14f, C.accent, SEMI).apply { tap { queue = emptyList(); render() } })
        body.add(hr, 12)
        val face = ctx.card(20, 22).apply { gravity = Gravity.CENTER_HORIZONTAL; margins(t = 10) }
        face.addView(ctx.text(c.word, 34f, C.text, HEAVY).apply { gravity = Gravity.CENTER })
        face.addView(ctx.text("/" + c.pron.ifEmpty { "暂无音标" } + "/", 14f, C.sub).apply { gravity = Gravity.CENTER })
        face.add(ctx.text(if (c.fav) "★ 已收藏" else "☆ 收藏", 14f, C.c("#e0a526"), SEMI).apply { gravity = Gravity.CENTER; tap { Words.favorite(w); render() } }, 8)
        body.addView(face)
        if (sMode == "quiz") {
            val qz = quiz ?: Words.quiz(w).also { quiz = it }
            for ((id, cn) in qz) {
                val right = id == w; val ans = chosen.isNotEmpty()
                body.add(ctx.text(cn.lines().take(2).joinToString("；"), 14.5f, C.text).apply {
                    pad(14, 12); bg(when { ans && right -> C.alpha(C.green, 0.18f); ans && id == chosen -> C.dangerBg; else -> C.card }, 14, C.line)
                    tap { if (chosen.isEmpty()) { chosen = id; Words.recordQuiz(w, right); if (right) correct++; render() } }
                }, 8)
            }
            if (chosen.isNotEmpty()) { body.add(ctx.text(if (chosen == w) "答对了，继续保持" else "再记一次，下次就更熟悉了", 13.5f, if (chosen == w) C.green else C.red).apply { gravity = Gravity.CENTER }, 10); body.add(ctx.button("下一题") { next() }, 8) }
        } else if (!revealed) body.add(ctx.button("我想好了 · 查看释义") { revealed = true; render() }, 14)
        else {
            val m = ctx.card(16, 18).apply { margins(t = 12) }
            m.addView(ctx.text(c.cn, 15f, C.text).apply { setLineSpacing(0f, 1.3f) })
            if (c.en.isNotEmpty()) m.add(ctx.text(c.en, 12.5f, C.sub), 6)
            c.examples.take(3).forEach { (en, cn) -> m.add(ctx.text(en + "\n" + cn, 13f, C.text).apply { bg(C.mutedBg, 10); pad(12, 8) }, 8) }
            body.addView(m)
            val rr = ctx.row().apply { margins(t = 12) }
            for ((g, t, s) in listOf(Triple("again", "没记住", "10 分钟"), Triple("hard", "有点难", "明天复习"), Triple("good", "记住了", "下一阶段")))
                rr.addView(ctx.col().apply { gravity = Gravity.CENTER; pad(8, 12); press(if (g == "good") C.accent else C.card, 14, if (g == "good") 0 else C.line); tap { Words.rate(w, g); it.buzz(); next() }
                    addView(ctx.text(t, 15f, if (g == "good") Color.WHITE else C.text, BOLD)); addView(ctx.text(s, 11.5f, if (g == "good") C.alpha(Color.WHITE, 0.8f) else C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (g != "again") leftMargin = dp(8) })
            body.addView(rr)
        }
    }
    private fun detail(w: String) {
        val c = Words.meaning(w)
        Dialogs.confirm(ctx, c.word + "  /" + c.pron + "/", c.stage + "\n\n" + c.cn + (if (c.en.isNotEmpty()) "\n\n" + c.en else "") + c.examples.take(3).joinToString("") { "\n\n" + it.first + "\n" + it.second } + c.phrases.take(4).joinToString("") { "\n· " + it.first + " " + it.second },
            if (c.fav) "取消收藏" else "☆ 收藏", cancel = "关闭") { Words.favorite(w); render() }
    }
}

// =====================================================================
/** 云宠农场：完成任务攒养料，喂云宠长大（和网页、小程序是同一只） */
class FarmPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    override fun build(): View = scaffold("云宠农场") { body = it }
    private fun img(pet: String, lv: Int): Int = a.resources.getIdentifier(Farm.img(pet, lv), "drawable", com.laolao.classcalendar.R::class.java.`package`!!.name)
    override fun render() {
        view; keepScroll(body)
        if (!Farm.on()) { body.addView(ctx.empty("🐣", "云宠农场关掉了", "在「我的 → 趣味与效率」里可以打开")); body.add(ctx.button("去打开") { a.push(FunPage(a)) }, 12); return }
        val s = Farm.state(); val L = Farm.ledger(); val left = Farm.left(L); val lv = s.optInt("level", 1); val sg = Farm.stage(lv); val need = Farm.expNeed(lv)
        val hero = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; pad(18, 16) }
        hero.addView(ctx.text("💬 " + Farm.hello(), 13f, C.sub).apply { gravity = Gravity.CENTER; bg(C.card, 14); pad(12, 6) })
        hero.addView(ImageView(ctx).apply { setImageResource(img(s.str("pet"), lv)); tap { it.animate().scaleX(1.08f).scaleY(1.08f).setDuration(120).withEndAction { it.animate().scaleX(1f).scaleY(1f).setDuration(160).start() }.start(); it.buzz() } }, LinearLayout.LayoutParams(dp(170), dp(170)))
        hero.addView(ctx.text(s.str("name") + "  Lv.$lv", 21f, C.heroText, HEAVY).apply { gravity = Gravity.CENTER; tap { Dialogs.prompt(ctx, "给云宠起个名字", s.str("name"), "最多 12 个字") { n -> Farm.rename(n); render() } } })
        hero.addView(ctx.text((Farm.PETS.firstOrNull { it.id == s.str("pet") }?.name ?: "") + " · " + Farm.STAGE[sg], 13f, C.sub).apply { gravity = Gravity.CENTER })
        val bx = FrameLayout(ctx).apply { bg(C.alpha(C.accent, 0.15f), 5) }
        bx.addView(View(ctx).apply { bg(C.accent, 5) }, FrameLayout.LayoutParams(0, MATCH))
        hero.addView(bx, LinearLayout.LayoutParams(MATCH, dp(10)).apply { topMargin = dp(12) })
        bx.post { bx.getChildAt(0).layoutParams = bx.getChildAt(0).layoutParams.apply { width = bx.width * minOf(100, s.optInt("exp") * 100 / need) / 100 }; bx.requestLayout() }
        hero.addView(ctx.text("经验 ${s.optInt("exp")} / $need · " + (Farm.EVO.firstOrNull { it.first > lv }?.let { "再升到 Lv.${it.first} 进化成「${it.second}」" } ?: "已经是传说形态啦 ✨"), 12f, C.sub).apply { gravity = Gravity.CENTER; margins(t = 6) })
        val br = ctx.row().apply { margins(t = 14) }
        br.addView(ctx.button("🥕 喂一次 −${Farm.FEED_COST}", if (left >= Farm.FEED_COST) C.accent else C.mutedBg, if (left >= Farm.FEED_COST) Color.WHITE else C.sub) { v -> val (ok, m) = Farm.feed(false); a.toast(m); if (ok) { v.buzz(); render() } }, LinearLayout.LayoutParams(0, dp(46), 1f))
        br.addView(ctx.button("一直喂到升级", C.selected, C.accent) { val (ok, m) = Farm.feed(true); a.toast(m); if (ok) render() }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { leftMargin = dp(8) })
        hero.addView(br, LinearLayout.LayoutParams(MATCH, WRAP))
        body.addView(hero)
        // 养料
        val sr = ctx.row().apply { margins(t = 12) }
        for ((n, l) in listOf("$left" to "现有养料", "+${L.today}" to "今天攒到", "${s.optInt("fed")}" to "喂过次数", "${L.streak} 天" to "连续活跃"))
            sr.addView(ctx.col().apply { pad(8, 12); bg(C.card, 14, C.line); gravity = Gravity.CENTER_HORIZONTAL; addView(ctx.text(n, 18f, C.text, HEAVY)); addView(ctx.text(l, 11f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (sr.childCount > 0) leftMargin = dp(6) })
        body.addView(sr)
        // 最近 7 天
        val t = T.todayKey(); val days = (6 downTo 0).map { T.addDays(t, -it.toLong()) }; val mx = maxOf(10, days.maxOf { L.days[it]?.food ?: 0 })
        val hc = ctx.card(14, 18).apply { margins(t = 12) }
        hc.addView(ctx.text("最近 7 天的养料", 14f, C.text, SEMI))
        val bars = ctx.row().apply { gravity = Gravity.BOTTOM; margins(t = 8) }
        for (d in days) { val f = L.days[d]?.food ?: 0
            bars.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL or Gravity.BOTTOM
                addView(ctx.text(if (f > 0) "$f" else "", 10.5f, C.sub).apply { gravity = Gravity.CENTER })
                addView(View(ctx).apply { bg(if (d == t) C.green else C.alpha(C.green, 0.4f), 4) }, LinearLayout.LayoutParams(dp(14), maxOf(dp(3), dp(56) * f / mx)))
                addView(ctx.text(if (d == t) "今天" else T.wk(d), 10.5f, C.sub).apply { gravity = Gravity.CENTER })
            }, LinearLayout.LayoutParams(0, dp(92), 1f)) }
        hc.addView(bars); body.addView(hc)
        // 现在就能攒养料
        body.addView(ctx.section("现在就能攒养料"))
        val todo = Items.all().filter { !it.course && !it.done && !it.hidden && (!it.dated || T.dayDiff(it.day) in -3..7) }.sortedBy { it.day.ifEmpty { "9" } + it.time }.take(8)
        val tc = ctx.card(4, 18)
        todo.forEachIndexed { i, r -> if (i > 0) tc.addView(ctx.hline())
            val row = ctx.row().apply { pad(14, 10) }
            row.addView(a.check(false) { a.toggle(r); render() }, LinearLayout.LayoutParams(dp(22), dp(22)))
            row.addView(ctx.col().apply { pad(10, 0); addView(ctx.text(r.title, 14.5f, C.text, lines = 1)); addView(ctx.text(if (r.dated) Items.due(r).first else "没定日子", 12f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            row.addView(ctx.text("+${if (r.hw) 10 else 5}", 14f, C.green, BOLD)); tc.addView(row) }
        val hs = Growth.habits().filter { !Growth.checked(it.id) }
        hs.forEach { h -> if (tc.childCount > 0) tc.addView(ctx.hline())
            val row = ctx.row().apply { pad(14, 10) }
            row.addView(a.check(false) { Growth.toggle(h.id); render() }, LinearLayout.LayoutParams(dp(22), dp(22)))
            row.addView(ctx.text(h.icon + " " + h.name + " · 今天还没打卡", 14.5f, C.text, lines = 1).apply { pad(10, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            row.addView(ctx.text("+3", 14f, C.green, BOLD)); tc.addView(row) }
        if (tc.childCount == 0) tc.addView(ctx.text("手头的事都做完了 🎉 专注一个番茄也能攒 2 养料", 13.5f, C.sub).apply { pad(14, 14) })
        body.addView(tc)
        // 换云宠
        body.addView(ctx.section("换一只云宠", "等级跟着走"))
        val pr = ctx.row()
        for (p in Farm.PETS) pr.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; pad(6, 8); bg(if (p.id == s.str("pet")) C.selected else C.card, 14, if (p.id == s.str("pet")) C.accent else C.line); tap { Farm.pick(p.id); render() }
            addView(ImageView(ctx).apply { setImageResource(img(p.id, maxOf(2, lv))) }, LinearLayout.LayoutParams(dp(64), dp(64))); addView(ctx.text(p.name, 12f, C.text, SEMI)) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
        body.add(android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(pr) }, 0)
        body.add(ctx.text("养料怎么来：完成作业 +10，其它事项 +5，打卡 +3（每天最多 5 次），番茄 +2（每天最多 12 个），一天完成 3 件以上 +5，连续 3 天以上每天 +3。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 12)
    }
}

// =====================================================================
/** 等级与徽章：经验、今日任务、成就徽章、小百科 */
class MetaPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var wiki = -1
    override fun build(): View = scaffold("等级与徽章") { body = it }
    override fun onShow() { Meta.visit() }
    override fun render() {
        view; keepScroll(body)
        val s = Meta.stats()
        val card = ctx.col().apply { pad(20, 20); background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR, intArrayOf(C.c("#1b1640"), C.c("#3b2a8c"))).apply { cornerRadius = dp(22).toFloat() } }
        val r = ctx.row()
        r.addView(ctx.text(when (com.laolao.classcalendar.core.Store.me?.str("gender")) { "f" -> "👩‍🚀"; "m" -> "🧑‍🚀"; else -> "🤖" }, 40f))
        val cc = ctx.col().apply { pad(14, 0) }
        cc.addView(ctx.text(com.laolao.classcalendar.core.Store.name().ifEmpty { "访客" }, 19f, Color.WHITE, HEAVY))
        cc.addView(ctx.text("Lv.${s.level} · ${s.title}", 14f, C.c("#ffd27a"), BOLD))
        r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f)); card.addView(r)
        val bx = FrameLayout(ctx).apply { bg(C.alpha(Color.WHITE, 0.15f), 5) }
        bx.addView(View(ctx).apply { bg(C.c("#7ee8fa"), 5) }, FrameLayout.LayoutParams(0, MATCH))
        card.addView(bx, LinearLayout.LayoutParams(MATCH, dp(10)).apply { topMargin = dp(14) })
        bx.post { bx.getChildAt(0).layoutParams = bx.getChildAt(0).layoutParams.apply { width = bx.width * s.pct / 100 }; bx.requestLayout() }
        card.addView(ctx.text("经验 ${s.exp} · 距离 Lv.${s.level + 1} 还差 ${s.hi - s.exp}", 12.5f, C.c("#c9c3f0")).apply { margins(t = 6) })
        val sr = ctx.row().apply { margins(t = 12) }
        for ((n, l) in listOf("${s.doneAll}" to "完成的事", "${s.checks}" to "打卡", "${s.pomos}" to "番茄")) sr.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; addView(ctx.text(n, 20f, Color.WHITE, HEAVY)); addView(ctx.text(l, 11.5f, C.c("#c9c3f0"))) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        card.addView(sr); body.addView(card)
        // 今日任务
        val qs = listOf(Triple("完成 1 件事", s.doneToday, 10) to { a.selectTab(0); close() }, Triple("打卡 1 个习惯", s.checksToday, 5) to { a.selectTab(2); close() }, Triple("专注 1 个番茄", s.pomosToday, 15) to { a.push(PlanPage(a)) })
        body.addView(ctx.section("今日任务", "${qs.count { it.first.second >= 1 }} / 3"))
        val qc = ctx.card(4, 18)
        qs.forEachIndexed { i, (q, go) -> if (i > 0) qc.addView(ctx.hline()); qc.addView(ctx.cell(if (q.second >= 1) "✅" else "⬜", q.first, "+${q.third} 经验", if (q.second >= 1) "完成" else "去做") { if (q.second < 1) go() }) }
        body.addView(qc)
        // 徽章
        val bs = Meta.badges(s)
        body.addView(ctx.section("成就徽章", "${bs.count { it.on }} / ${bs.size}"))
        var row: LinearLayout? = null
        bs.forEachIndexed { i, b ->
            if (i % 3 == 0) { row = ctx.row().apply { gravity = Gravity.TOP }; body.addView(row, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = if (i == 0) 0 else dp(8) }) }
            row!!.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; pad(6, 12); bg(C.card, 14, C.line); alpha = if (b.on) 1f else 0.4f; tap { a.toast(b.name + "：" + b.desc + if (b.on) " ✓" else "") }
                addView(ctx.text(b.icon, 28f)); addView(ctx.text(b.name, 12.5f, C.text, BOLD, 1)); addView(ctx.text(b.desc, 10.5f, C.sub, lines = 2).apply { gravity = Gravity.CENTER }) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i % 3 > 0) leftMargin = dp(8) })
        }
        // 小百科
        body.addView(ctx.section("元宇宙小百科"))
        val wc = ctx.card(4, 18)
        Meta.WIKI.forEachIndexed { i, (e, t, d) ->
            if (i > 0) wc.addView(ctx.hline())
            wc.addView(ctx.cell(e, t, "", if (wiki == i) "⌃" else "⌄") { wiki = if (wiki == i) -1 else i; render() })
            if (wiki == i) wc.addView(ctx.text(d, 13.5f, C.sub).apply { pad(18, 0, 18, 14); setLineSpacing(0f, 1.35f) })
        }
        body.addView(wc)
        body.add(ctx.text("经验和徽章由你的完成记录、打卡、番茄钟、目标自动计算，跟着账号同步。", 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 12)
    }
}
