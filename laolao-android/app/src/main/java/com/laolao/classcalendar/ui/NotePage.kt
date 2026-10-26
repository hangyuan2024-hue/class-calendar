package com.laolao.classcalendar.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Typeface
import android.text.Editable
import android.text.InputType
import android.text.Spannable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextWatcher
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StrikethroughSpan
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import android.view.Gravity
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputConnection
import android.view.inputmethod.InputConnectionWrapper
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.NoteCore
import com.laolao.classcalendar.core.NoteStore
import com.laolao.classcalendar.core.newId
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject

/** 7.2 备忘录列表（和小程序、网页的备忘录是同一批「我的事项」） */
class NoteListPage(a: Main) : Page(a) {
    private lateinit var listBox: LinearLayout
    private var q = ""
    override val autoRender = false
    override fun build(): View {
        val add = ctx.text("＋ 新备忘", 15f, C.accent, BOLD).apply { pad(12, 8); press(0, 10); tap { a.push(NotePage(a, null)) } }
        return scaffold("备忘录", add) { b ->
            val qb = ctx.input("搜索备忘录", "")
            qb.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { q = s?.toString()?.trim()?.lowercase() ?: ""; render() }
            })
            b.addView(qb)
            listBox = ctx.col(); b.add(listBox, 12)
        }
    }
    override fun onShow() { render() }
    override fun render() {
        view; listBox.removeAllViews()
        val MC = com.laolao.classcalendar.core.MemoCore
        val all = NoteStore.memos()
        val rows = all.filter { r -> q.isEmpty() || (r.str("subject") + "\n" + r.str("note") + "\n" + MC.listOf(r).joinToString("\n") { it.t }).lowercase().contains(q) }
            .sortedWith(compareByDescending<JSONObject> { it.optBoolean("pin") }.thenByDescending { NoteStore.madeAt(it) })
        if (rows.isEmpty()) { listBox.addView(ctx.empty("🗒", if (q.isNotEmpty()) "没有找到" else "还没有备忘", if (q.isEmpty()) "点右上角「＋ 新备忘」写一条：格式、清单、图片、手写都可以" else "")); return }
        val c = ctx.card(4, 18)
        rows.forEachIndexed { i, r ->
            if (i > 0) c.addView(ctx.hline())
            val ls = MC.listOf(r)
            val body = r.str("note").split("\n").map { it.trim() }.firstOrNull { it.isNotEmpty() && it != r.str("subject") }
                ?: if (ls.isNotEmpty()) ls.take(2).joinToString("  ") { (if (it.d) "✓ " else "○ ") + it.t } else ""
            val et = r.str("event_time")
            val m = mutableListOf(if (et.length >= 10) "${et.substring(5, 7).toInt()}月${et.substring(8, 10).toInt()}日" else whenOf(NoteStore.madeAt(r)))
            if (ls.isNotEmpty()) m += "☑ " + MC.statText(ls)
            NoteStore.imgCount(r).let { if (it > 0) m += "🖼 $it" }
            if (r.str("kind").isNotEmpty()) m += r.str("kind")
            if (r.optBoolean("done")) m += "已完成"
            val row = ctx.col().apply { pad(14, 12); press(0, 12); tap { a.push(NotePage(a, r.str("id"))) } }
            row.addView(ctx.text((if (r.optBoolean("pin")) "📌 " else "") + r.str("subject").ifEmpty { "无标题备忘" }, 15.5f, C.text, SEMI, 1))
            if (body.isNotEmpty()) row.addView(ctx.text(body.take(80), 13f, C.sub, lines = 1).apply { margins(t = 2) })
            row.addView(ctx.text(m.filter { it.isNotEmpty() }.joinToString(" · "), 12f, C.mutedText, lines = 1).apply { margins(t = 3) })
            c.addView(row)
        }
        listBox.addView(c)
    }
    companion object {
        fun whenOf(t: Long): String {
            if (t <= 0) return ""
            val z = java.time.ZoneId.of("Asia/Shanghai")
            val d = java.time.Instant.ofEpochMilli(t).atZone(z).toLocalDateTime(); val now = java.time.LocalDate.now(z)
            if (d.toLocalDate() == now) return String.format("%02d:%02d", d.hour, d.minute)
            if (d.toLocalDate() == now.minusDays(1)) return "昨天"
            return (if (d.year == now.year) "" else "${d.year}/") + "${d.monthValue}月${d.dayOfMonth}日"
        }
    }
}

/**
 * 7.2 全屏备忘录（和小程序 1.18、网页同一份数据）：一行一块，文字里可以加粗、斜体、下划线、删除线、颜色、高亮；
 * 每行可以是大标题、小标题、清单（一项项勾）、圆点、编号、缩进；中间可以插图片、手写、分割线。
 */
class NotePage(a: Main, id0: String?, private val kind0: String = "") : Page(a) {
    override val autoRender = false
    private val id: String = id0 ?: newId("p")
    private var isNew = id0 == null || Items.mineRecord(id0) == null
    private var kind = ""
    private val fmap = LinkedHashMap<String, String>()
    private var dirty = false
    private lateinit var titleIn: EditText
    private lateinit var metaRow: LinearLayout
    private lateinit var savedTv: TextView
    private lateinit var box: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var bar: LinearLayout
    private lateinit var panel: LinearLayout
    private val blocks = mutableListOf<Blk>()
    private var focused: Blk? = null
    private val undo = ArrayList<String>(); private val redo = ArrayList<String>()
    private val pending = HashMap<String, Any?>()
    private var expectCursor = -1
    private var muting = false
    private val files = mutableListOf<JSONObject>()
    private val saveRun = Runnable { flush() }
    private val snapRun = Runnable { snap() }

    companion object {
        val COLORS = listOf("" to "默认", "#e5484d" to "红", "#f76b15" to "橙", "#2f9e44" to "绿", "#3e63dd" to "蓝", "#8e4ec6" to "紫")
        val HL = listOf("" to "无", "#fff3a3" to "黄", "#d3f9d8" to "绿", "#d0ebff" to "蓝", "#ffdeeb" to "粉")
        val KINDS = listOf("", "作业", "会议", "活动", "通知"); val KIND_N = listOf("普通", "作业", "会议", "活动", "通知")
    }

    // ---------- 一块 ----------
    private inner class Blk(val type: String) {   // "t" 文字 / "img" 图片 / "hr" 分割线
        var h = 0; var list = ""; var ind = 0
        var extra: Map<String, Any?> = emptyMap()   // 别的端写的、这里不认识的行格式：原样留着
        var op: NoteCore.Op? = null
        lateinit var view: LinearLayout
        var et: BlockEdit? = null; var mark: TextView? = null
    }
    // 文字格式用自己的 span 类（输入法加的下划线等不算进去）
    private class FB : StyleSpan(Typeface.BOLD)
    private class FI : StyleSpan(Typeface.ITALIC)
    private class FU : UnderlineSpan()
    private class FS : StrikethroughSpan()
    private class FC(val hex: String) : ForegroundColorSpan(Color.parseColor(hex))
    private class FH(val hex: String) : BackgroundColorSpan(Color.parseColor(hex))
    private val KEYS = listOf("bold", "italic", "underline", "strike", "color", "backgroundColor")
    @Suppress("UNCHECKED_CAST")
    private fun clsOf(k: String): Class<Any> = (when (k) { "bold" -> FB::class.java; "italic" -> FI::class.java; "underline" -> FU::class.java; "strike" -> FS::class.java; "color" -> FC::class.java; else -> FH::class.java }) as Class<Any>
    private fun valOf(s: Any): Any? = when (s) { is FC -> s.hex; is FH -> s.hex; else -> true }
    private fun newSpan(k: String, v: Any?): Any? {
        if (v == null || v == false) return null
        return try { when (k) { "bold" -> FB(); "italic" -> FI(); "underline" -> FU(); "strike" -> FS(); "color" -> FC(norm(v.toString())); "backgroundColor" -> FH(norm(v.toString())); else -> null } } catch (e: Exception) { null }
    }
    private fun norm(c: String): String { val s = c.trim().lowercase(); return if (Regex("^#[0-9a-f]{3}$").matches(s)) "#" + s.drop(1).map { "$it$it" }.joinToString("") else s }

    class BlockEdit(ctx: Context) : EditText(ctx) {
        var onBackAtStart: (() -> Unit)? = null
        var onSel: (() -> Unit)? = null
        override fun onSelectionChanged(s: Int, e: Int) { super.onSelectionChanged(s, e); onSel?.invoke() }
        override fun onCreateInputConnection(o: EditorInfo): InputConnection? {
            val ic = super.onCreateInputConnection(o) ?: return null
            return object : InputConnectionWrapper(ic, true) {
                override fun deleteSurroundingText(before: Int, after: Int): Boolean {
                    if (before > 0 && selectionStart == 0 && selectionEnd == 0) { onBackAtStart?.invoke(); return true }
                    return super.deleteSurroundingText(before, after)
                }
                override fun sendKeyEvent(ev: KeyEvent): Boolean {
                    if (ev.keyCode == KeyEvent.KEYCODE_DEL && selectionStart == 0 && selectionEnd == 0) { if (ev.action == KeyEvent.ACTION_DOWN) onBackAtStart?.invoke(); return true }
                    return super.sendKeyEvent(ev)
                }
            }
        }
    }

    // ================= 页面 =================
    override fun build(): View {
        val rec = Items.mineRecord(id)
        kind = rec?.str("kind") ?: kind0.takeIf { it in KINDS } ?: ""
        fmap.putAll(NoteStore.fmap(rec))
        val root = ctx.col().apply { setBackgroundColor(C.card) }
        val head = ctx.row().apply { pad(6, 6, 8, 6); minimumHeight = dp(52) }
        head.addView(ctx.text("‹", 30f, C.text).apply { gravity = Gravity.CENTER; press(0, 20); tap { a.onBackPressed() } }, LinearLayout.LayoutParams(dp(44), dp(44)))
        head.addView(ctx.text("备忘录", 18f, C.text, BOLD, 1).apply { pad(4, 0) })
        savedTv = ctx.text("", 12f, C.sub).apply { pad(8, 0) }
        head.addView(savedTv, LinearLayout.LayoutParams(0, WRAP, 1f))
        head.addView(ctx.text("⚡ 快速记", 14f, C.accent, SEMI).apply { pad(10, 8); press(0, 10); tap { toQuick() } })
        head.addView(ctx.text("⋯", 22f, C.text, BOLD).apply { gravity = Gravity.CENTER; pad(10, 2); press(0, 10); tap { more() } })
        root.addView(head)
        root.addView(ctx.hline())
        scroll = ScrollView(ctx).apply { isFillViewport = true; isVerticalScrollBarEnabled = false }
        val body = ctx.col().apply { pad(18, 6, 18, 120) }
        titleIn = EditText(ctx).apply {
            hint = "标题（不写就用第一行）"; setText(if (rec != null && !rec.optBoolean("tAuto")) rec.str("subject") else "")
            textSize = 22f; typeface = BOLD; setTextColor(C.text); setHintTextColor(C.mutedText); background = null; setPadding(0, dp(10), 0, dp(4))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES; imeOptions = EditorInfo.IME_ACTION_NEXT; isSingleLine = true
            filters = arrayOf<android.text.InputFilter>(android.text.InputFilter.LengthFilter(60))
            setOnEditorActionListener { _, _, _ -> blocks.firstOrNull { it.type == "t" }?.let { focusAt(it, 0) }; true }
            addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun afterTextChanged(s: Editable?) { if (!muting) changed(false) }
            })
        }
        body.addView(titleIn)
        metaRow = ctx.row().apply { pad(0, 2, 0, 8) }
        body.addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(metaRow) })
        box = ctx.col()
        body.addView(box)
        // 点下面空白的地方：接着最后一行写
        val tail = View(ctx).apply { minimumHeight = dp(240); setOnClickListener { focusEnd() } }
        body.addView(tail, LinearLayout.LayoutParams(MATCH, dp(240)))
        scroll.addView(body)
        root.addView(scroll, LinearLayout.LayoutParams(MATCH, 0, 1f))
        panel = ctx.row().apply { pad(12, 8); visibility = View.GONE; setBackgroundColor(C.mutedBg) }
        root.addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(panel) })
        root.addView(ctx.hline())
        bar = ctx.row().apply { pad(6, 4) }
        root.addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; setBackgroundColor(C.card); addView(bar) }, LinearLayout.LayoutParams(MATCH, WRAP))
        buildBar()
        val L = NoteStore.load(rec)
        setOps(L.ops)
        if (L.fresh) a.toast("这条在别的地方改过文字，已按新内容显示（图片还在）")
        snap(true); paintMeta()
        if (isNew) { titleIn.requestFocus(); Dialogs.showKeyboard(titleIn) }
        return root
    }
    override fun onHide() { flush() }
    override fun onAppPause() { flush() }
    override fun onBack(): Boolean { flush(); return false }
    override fun onShow() {
        // 从「记一件事」表单改完回来：文字或清单变了就重新载入
        val rec = Items.mineRecord(id) ?: return
        val s = rec.optJSONObject("rich")?.str("s")
        if (lastSig != null && NoteStore.sig(rec) != lastSig && s != NoteStore.sig(rec)) { setOps(NoteStore.load(rec).ops); snap(true) }
        kind = rec.str("kind"); paintMeta()
    }
    private var lastSig: String? = null

    private fun paintMeta() {
        metaRow.removeAllViews()
        val rec = Items.mineRecord(id)
        fun chip(t: String, on: Boolean, fn: () -> Unit) = metaRow.addView(ctx.text(t, 12.5f, if (on) C.accent else C.sub, SEMI).apply {
            bg(if (on) C.selected else C.mutedBg, 12); pad(10, 4); tap { fn() }
        }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6) })
        chip((if (kind.isEmpty()) "类型：普通" else KIND_N[maxOf(0, KINDS.indexOf(kind))]) + " ▾", kind.isNotEmpty()) {
            Dialogs.sheet(ctx, "类型", KIND_N) { i ->
                kind = KINDS[i]
                if (Items.mineRecord(id) != null) NoteStore.patch(id) { if (kind.isEmpty()) it.remove("kind") else it.put("kind", kind) } else changed(false)
                if (kind == "作业") a.toast("会显示在作业页"); paintMeta()
            }
        }
        val et = rec?.str("event_time") ?: ""
        chip(if (et.length >= 10) "📅 ${et.substring(5, 7).toInt()}月${et.substring(8, 10).toInt()}日" + (if (et.length >= 16) " " + et.substring(11, 16) else "") else "📅 加日期 / 提醒", et.isNotEmpty()) { toQuick() }
        if (rec != null) chip(if (rec.optBoolean("pin")) "📌 已置顶" else "📌 置顶", rec.optBoolean("pin")) { NoteStore.patch(id) { if (it.optBoolean("pin")) it.remove("pin") else it.put("pin", true) }; paintMeta() }
        val p = mutableListOf<String>()
        val upd = rec?.optLong("upd", 0L) ?: 0L
        p += if (upd > 0) NoteListPage.whenOf(upd) + " 编辑过" else if (isNew) "新备忘" else ""
        val ls = com.laolao.classcalendar.core.MemoCore.listOf(rec ?: JSONObject())
        if (ls.isNotEmpty()) p += "清单 " + com.laolao.classcalendar.core.MemoCore.statText(ls)
        metaRow.addView(ctx.text(p.filter { it.isNotEmpty() }.joinToString(" · "), 12f, C.mutedText).apply { pad(4, 0) })
    }
    private fun more() {
        val rec = Items.mineRecord(id)
        val opts = mutableListOf("⚡ 换成「记一件事」（改日期、提醒、重复、地点）")
        if (rec != null) opts += "删除这条备忘"
        Dialogs.sheet(ctx, "", opts, if (rec != null) setOf(1) else emptySet()) { i ->
            if (i == 0) toQuick()
            if (i == 1) Dialogs.confirm(ctx, "删除「${rec?.str("subject") ?: "这条备忘"}」？", "", "删除", danger = true) { dirty = false; Items.deleteMine(id); a.toast("已删除"); a.pop(this) }
        }
    }
    private fun toQuick() {
        dirty = true; flush()
        val rec = Items.mineRecord(id)
        dirty = false
        a.pop(this)
        if (rec != null) a.push(EditPage(a, id)) else a.push(EditPage(a, null, homework = kind == "作业"))
    }

    // ================= 保存 =================
    private fun changed(struct: Boolean) {
        dirty = true; savedTv.text = ""
        Bg.main.removeCallbacks(saveRun); Bg.main.postDelayed(saveRun, 800)
        Bg.main.removeCallbacks(snapRun); Bg.main.postDelayed(snapRun, if (struct) 0 else 500)
    }
    private fun flush() {
        Bg.main.removeCallbacks(saveRun)
        if (!dirty) return
        val ops = opsNow(); val p = NoteCore.toPlain(ops)
        var title = titleIn.text.toString().trim(); var auto = false
        if (title.isEmpty()) { auto = true; title = p.note.split("\n").map { it.trim() }.firstOrNull { it.isNotEmpty() && it != "[图片]" } ?: p.list.firstOrNull()?.t ?: if (p.imgs.isNotEmpty()) "手写备忘" else "" }
        if (isNew && title.isEmpty() && p.note.isEmpty() && p.list.isEmpty()) return   // 空白的新备忘不存
        val f = JSONObject().put("subject", title.take(60).ifEmpty { "无标题备忘" })
        if (auto) f.put("tAuto", true)
        f.put("note", p.note)
        if (p.list.isNotEmpty()) f.put("list", JSONArray().apply { p.list.forEach { put(JSONObject().put("t", it.t).put("d", it.d)) } })
        f.put("upd", System.currentTimeMillis())
        val sig = NoteCore.sigOf(p.note, p.list)
        val rich = JSONObject().put("d", NoteStore.toJson(ops)).put("s", sig)
        if (fmap.isNotEmpty()) rich.put("f", JSONObject().apply { fmap.forEach { (k, v) -> put(k, v) } })
        f.put("rich", rich)
        NoteStore.save(id, f, if (isNew) kind else null)
        isNew = false; dirty = false; lastSig = sig
        savedTv.text = "已保存"; paintMeta()
    }

    // ================= 内容 ↔ delta =================
    private fun runsOf(e: Spanned, from: Int = 0, to: Int = e.length): List<Pair<String, Map<String, Any?>>> {
        val cuts = sortedSetOf(from, to)
        for (k in KEYS) for (s in e.getSpans(from, to, clsOf(k))) { cuts += e.getSpanStart(s).coerceIn(from, to); cuts += e.getSpanEnd(s).coerceIn(from, to) }
        val c = cuts.toList(); val out = mutableListOf<Pair<String, Map<String, Any?>>>()
        for (i in 0 until c.size - 1) {
            val s = c[i]; val t = c[i + 1]; if (s >= t) continue
            val at = LinkedHashMap<String, Any?>()
            for (k in KEYS) e.getSpans(s, t, clsOf(k)).firstOrNull { e.getSpanStart(it) <= s && e.getSpanEnd(it) >= t }?.let { at[k] = valOf(it) }
            val txt = e.subSequence(s, t).toString().replace("\n", " ")
            if (out.isNotEmpty() && out.last().second == at) out[out.size - 1] = (out.last().first + txt) to at else out += txt to at
        }
        return out
    }
    private fun lineAttrs(b: Blk): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        if (b.h > 0) m["header"] = b.h
        if (b.list.isNotEmpty()) m["list"] = b.list
        if (b.ind > 0) m["indent"] = b.ind
        for ((k, v) in b.extra) if (k !in m) m[k] = v
        return m
    }
    private fun opsNow(): List<NoteCore.Op> {
        val ops = mutableListOf<NoteCore.Op>()
        fun push(t: String, at: Map<String, Any?>) {
            val last = ops.lastOrNull()
            if (last?.text != null && last.attrs == at) ops[ops.size - 1] = NoteCore.Op(last.text + t, null, at) else ops += NoteCore.Op(t, null, at)
        }
        for (b in blocks) when (b.type) {
            "img" -> { ops += b.op!!; push("\n", emptyMap()) }
            "hr" -> { ops += NoteCore.Op(null, mapOf("divider" to true)); push("\n", emptyMap()) }
            else -> { for ((t, at) in runsOf(b.et!!.text)) if (t.isNotEmpty()) push(t, at); push("\n", lineAttrs(b)) }
        }
        if (ops.isEmpty()) ops += NoteCore.Op("\n")
        return ops
    }
    private fun spanned(runs: List<NoteCore.Run>): SpannableStringBuilder {
        val sb = SpannableStringBuilder()
        for (r in runs) {
            val s = sb.length; sb.append(r.t)
            r.a?.forEach { (k, v) -> newSpan(k, v)?.let { sb.setSpan(it, s, sb.length, Spanned.SPAN_EXCLUSIVE_INCLUSIVE) } }
        }
        return sb
    }
    private fun setOps(ops: List<NoteCore.Op>) {
        muting = true
        blocks.clear(); box.removeAllViews(); focused = null
        for (ln in NoteCore.lines(ops)) {
            val at = ln.attrs
            var buf = mutableListOf<NoteCore.Run>(); var hadEmbed = false
            fun flushText(force: Boolean) {
                if (buf.isEmpty() && !force) return
                val b = textBlock(spanned(buf)); applyLine(b, at); addBlock(b); buf = mutableListOf()
            }
            for (r in ln.runs) when {
                r.img != null -> { flushText(false); hadEmbed = true; addBlock(imgBlock(r.img)) }
                r.hr -> { flushText(false); hadEmbed = true; addBlock(hrBlock()) }
                else -> buf += r
            }
            if (buf.isNotEmpty() || !hadEmbed) flushText(true)
        }
        if (blocks.lastOrNull()?.type != "t") addBlock(textBlock(SpannableStringBuilder()))
        muting = false
        renumber()
    }
    private fun applyLine(b: Blk, at: Map<String, Any?>) {
        b.h = (at["header"] as? Number)?.toInt() ?: at["header"]?.toString()?.toIntOrNull() ?: 0
        b.list = at["list"]?.toString()?.takeIf { it in setOf("bullet", "ordered", "checked", "unchecked") } ?: ""
        b.ind = (at["indent"] as? Number)?.toInt() ?: at["indent"]?.toString()?.toIntOrNull() ?: 0
        b.extra = at.filterKeys { it !in setOf("header", "list", "indent") }
        paintLine(b)
    }

    // ================= 块 =================
    private fun addBlock(b: Blk, at: Int = blocks.size) { blocks.add(at, b); box.addView(b.view, at, LinearLayout.LayoutParams(MATCH, WRAP)); if (b.type == "t") paintLine(b) }
    private fun removeBlock(b: Blk) { val i = blocks.indexOf(b); if (i >= 0) { blocks.removeAt(i); box.removeView(b.view) } }
    @SuppressLint("ClickableViewAccessibility")
    private fun textBlock(text: CharSequence): Blk {
        val b = Blk("t")
        val row = ctx.row().apply { gravity = Gravity.TOP }
        val mark = ctx.text("", 16f, C.sub, SEMI).apply { gravity = Gravity.CENTER; visibility = View.GONE }
        row.addView(mark, LinearLayout.LayoutParams(dp(26), dp(30)).apply { rightMargin = dp(4) })
        val et = BlockEdit(ctx).apply {
            background = null; setPadding(0, dp(3), 0, dp(3)); textSize = 16f; setTextColor(C.text); setLineSpacing(0f, 1.25f)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            isSingleLine = false; setHorizontallyScrolling(false); maxLines = Int.MAX_VALUE
            setText(text, android.widget.TextView.BufferType.EDITABLE)
        }
        row.addView(et, LinearLayout.LayoutParams(0, WRAP, 1f))
        b.view = row; b.et = et; b.mark = mark
        mark.setOnClickListener { if (b.list == "checked" || b.list == "unchecked") { snap(); b.list = if (b.list == "checked") "unchecked" else "checked"; paintLine(b); changed(true) } }
        et.setOnFocusChangeListener { _, has -> if (has) { focused = b; pending.clear(); syncBar() } }
        et.onSel = { if (focused == b) { if (et.selectionStart != expectCursor) pending.clear(); syncBar() } }
        et.onBackAtStart = { backAtStart(b) }
        et.setOnKeyListener { _, code, ev -> if (code == KeyEvent.KEYCODE_DEL && ev.action == KeyEvent.ACTION_DOWN && et.selectionStart == 0 && et.selectionEnd == 0) { backAtStart(b); true } else false }
        et.addTextChangedListener(object : TextWatcher {
            var st = 0; var cnt = 0
            override fun beforeTextChanged(s: CharSequence?, a: Int, c: Int, d: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { st = start; cnt = count }
            override fun afterTextChanged(e: Editable) {
                if (muting) return
                if (cnt > 0 && pending.isNotEmpty()) { muting = true; for ((k, v) in pending) setAttr(e, st, minOf(e.length, st + cnt), k, v); muting = false }
                expectCursor = st + cnt
                if (e.indexOf('\n') >= 0) et.post { split(b) } else changed(false)
            }
        })
        return b
    }
    private fun imgBlock(op: NoteCore.Op): Blk {
        val b = Blk("img"); b.op = op
        val k = NoteCore.imgKey(op)
        val wrap = ctx.col().apply { pad(0, 6) }
        val iv = ImageView(ctx).apply { adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_START; clipToOutline = true; background = round(C.mutedBg, dp(10).toFloat()) }
        val tip = ctx.text("图片加载中…", 13f, C.sub).apply { gravity = Gravity.CENTER; pad(12, 22); bg(C.mutedBg, 10) }
        wrap.addView(iv, LinearLayout.LayoutParams(MATCH, WRAP)); wrap.addView(tip, LinearLayout.LayoutParams(MATCH, WRAP))
        iv.visibility = View.GONE
        b.view = wrap
        wrap.setOnClickListener { imgMenu(b, iv) }
        iv.setOnClickListener { imgMenu(b, iv) }
        loadImg(k, iv, tip)
        return b
    }
    private fun hrBlock(): Blk {
        val b = Blk("hr")
        val wrap = ctx.col().apply { pad(0, 12); setOnLongClickListener { Dialogs.sheet(ctx, "分割线", listOf("删除"), setOf(0)) { snap(); removeBlock(b); ensureTail(); changed(true) }; true } }
        wrap.addView(View(ctx).apply { setBackgroundColor(C.line) }, LinearLayout.LayoutParams(MATCH, maxOf(1, dp(1))))
        b.view = wrap
        return b
    }
    private fun paintLine(b: Blk) {
        val et = b.et ?: return; val mark = b.mark ?: return
        et.textSize = when (b.h) { 1 -> 22f; 2 -> 18.5f; else -> 16f }
        et.typeface = if (b.h > 0) BOLD else Typeface.DEFAULT
        val chk = b.list == "checked"
        et.paintFlags = if (chk) et.paintFlags or Paint.STRIKE_THRU_TEXT_FLAG else et.paintFlags and Paint.STRIKE_THRU_TEXT_FLAG.inv()
        et.setTextColor(if (chk) C.sub else C.text)
        when (b.list) {
            "" -> mark.visibility = View.GONE
            "bullet" -> { mark.visibility = View.VISIBLE; mark.text = "•"; mark.textSize = 20f; mark.background = null; mark.setTextColor(C.sub) }
            "ordered" -> { mark.visibility = View.VISIBLE; mark.textSize = 15f; mark.background = null; mark.setTextColor(C.sub) }
            else -> {
                mark.visibility = View.VISIBLE; mark.textSize = 13f
                mark.text = if (chk) "✓" else ""; mark.setTextColor(Color.WHITE)
                mark.background = android.graphics.drawable.InsetDrawable(round(if (chk) C.accent else 0, dp(5).toFloat(), if (chk) C.accent else C.gray, dp(2)), dp(4), dp(6), dp(4), dp(6))
            }
        }
        (b.view.layoutParams as? LinearLayout.LayoutParams)?.let { it.leftMargin = dp(22) * b.ind; b.view.layoutParams = it }
    }
    private fun renumber() {
        var n = 0
        for (b in blocks) { if (b.type == "t" && b.list == "ordered") { n++; b.mark?.text = "$n." } else n = 0 }
    }
    private fun ensureTail() { if (blocks.lastOrNull()?.type != "t") addBlock(textBlock(SpannableStringBuilder())) }
    private fun focusAt(b: Blk, pos: Int) { val et = b.et ?: return; et.requestFocus(); et.setSelection(pos.coerceIn(0, et.text.length)); Dialogs.showKeyboard(et) }
    private fun focusEnd() { ensureTail(); val b = blocks.last(); focusAt(b, b.et!!.text.length) }

    /** 回车：后半段变成新的一行（清单接着是清单；空的清单行再回车就退出清单） */
    private fun split(b: Blk) {
        val et = b.et ?: return; val e = et.text; val i = e.indexOf('\n'); if (i < 0) return
        snap()
        muting = true
        val headEmpty = e.subSequence(0, i).isBlank()
        val tail = SpannableStringBuilder(e.subSequence(i + 1, e.length)).also { t -> for (k in KEYS) for (s in t.getSpans(0, t.length, clsOf(k))) { val ss = t.getSpanStart(s); val se = t.getSpanEnd(s); t.removeSpan(s); newSpan(k, valOf(s))?.let { t.setSpan(it, ss, se, Spanned.SPAN_EXCLUSIVE_INCLUSIVE) } } }
        e.delete(i, e.length)
        muting = false
        if (b.list.isNotEmpty() && headEmpty && tail.isEmpty()) { b.list = ""; paintLine(b); renumber(); changed(true); return }
        val nb = textBlock(SpannableStringBuilder())
        nb.list = if (b.list == "checked") "unchecked" else b.list; nb.ind = b.ind
        if (i == 0 && tail.isNotEmpty()) { nb.h = b.h; b.h = 0; paintLine(b) }
        addBlock(nb, blocks.indexOf(b) + 1); paintLine(nb)
        nb.et!!.setText(tail)   // 粘贴进来的多行：新的这块里还有回车，会接着拆
        renumber()
        focusAt(nb, 0)
        changed(true)
    }
    /** 行首按退格：先去掉清单 / 标题 / 缩进，再和上一行合并 */
    private fun backAtStart(b: Blk) {
        snap()
        when {
            b.list.isNotEmpty() -> { b.list = ""; paintLine(b) }
            b.h > 0 -> { b.h = 0; paintLine(b) }
            b.ind > 0 -> { b.ind--; paintLine(b) }
            else -> {
                val i = blocks.indexOf(b); if (i <= 0) return
                val prev = blocks[i - 1]
                if (prev.type != "t") { removeBlock(prev); renumber(); changed(true); return }
                val pe = prev.et!!; val at = pe.text.length
                val add = SpannableStringBuilder(b.et!!.text)
                removeBlock(b)
                muting = true; pe.text.append(add); muting = false
                focusAt(prev, at)
            }
        }
        renumber(); changed(true)
    }
    /** 在光标那一行后面插入（图片、分割线）；光标那行是空的就替换掉；后面留一行空的接着写 */
    private fun insertBlocks(nb: List<Blk>) {
        snap()
        val f = focused?.takeIf { it in blocks }
        var at = if (f != null) blocks.indexOf(f) + 1 else blocks.size
        if (f != null && f.type == "t" && f.et!!.text.isBlank() && f.list.isEmpty()) { at--; removeBlock(f) }
        for (x in nb) addBlock(x, at++)
        if (blocks.getOrNull(at)?.type != "t") addBlock(textBlock(SpannableStringBuilder()), at)
        renumber()
        focusAt(blocks[at], 0)
        changed(true)
    }

    // ================= 文字格式 =================
    private fun setAttr(e: Spannable, s: Int, t: Int, k: String, v: Any?) {
        if (s >= t) return
        for (sp in e.getSpans(s, t, clsOf(k))) {
            val ss = e.getSpanStart(sp); val se = e.getSpanEnd(sp); val old = valOf(sp)
            if (se <= s && se != t || ss >= t) continue
            e.removeSpan(sp)
            if (ss < s) newSpan(k, old)?.let { e.setSpan(it, ss, s, Spanned.SPAN_EXCLUSIVE_INCLUSIVE) }
            if (se > t) newSpan(k, old)?.let { e.setSpan(it, t, se, Spanned.SPAN_EXCLUSIVE_INCLUSIVE) }
        }
        newSpan(k, v)?.let { e.setSpan(it, s, t, Spanned.SPAN_EXCLUSIVE_INCLUSIVE) }
    }
    private fun attrAt(e: Spanned, s: Int, t: Int, k: String): Any? {
        if (s == t) { if (s == 0) return null; return e.getSpans(s - 1, s, clsOf(k)).firstOrNull()?.let { valOf(it) } }
        return e.getSpans(s, t, clsOf(k)).firstOrNull { e.getSpanStart(it) <= s && e.getSpanEnd(it) >= t }?.let { valOf(it) }
    }
    private fun curAttr(k: String): Any? {
        val et = focused?.et ?: return null
        if (pending.containsKey(k) && et.selectionStart == et.selectionEnd) return pending[k]
        return attrAt(et.text, et.selectionStart, et.selectionEnd, k)
    }
    private fun inline(k: String, v: Any?) {
        val b = focused ?: return; val et = b.et ?: return
        val s = minOf(et.selectionStart, et.selectionEnd); val t = maxOf(et.selectionStart, et.selectionEnd); if (s < 0) return
        val nv: Any? = if (v == null && k in setOf("bold", "italic", "underline", "strike")) (curAttr(k) == null) else v?.takeIf { it.toString().isNotEmpty() }
        if (s == t) { pending[k] = if (nv == false) null else nv; expectCursor = s; syncBar(); return }
        snap(); muting = true; setAttr(et.text, s, t, k, if (nv == false) null else nv); muting = false
        changed(true); syncBar()
    }
    private fun lineFmt(fn: (Blk) -> Unit) {
        val b = focused?.takeIf { it.type == "t" } ?: blocks.lastOrNull { it.type == "t" } ?: return
        snap(); fn(b); paintLine(b); renumber(); changed(true); syncBar()
    }

    // ================= 工具栏 =================
    private val barBtns = HashMap<String, TextView>()
    private fun buildBar() {
        fun btn(k: String, label: CharSequence, fn: () -> Unit) {
            val v = ctx.text(label, 16f, C.text, SEMI).apply {
                gravity = Gravity.CENTER; minWidth = dp(40); pad(8, 8); press(0, 10)
                tap { fn() }
            }
            barBtns[k] = v; bar.addView(v, LinearLayout.LayoutParams(WRAP, dp(42)))
        }
        fun sep() = bar.addView(View(ctx).apply { setBackgroundColor(C.line) }, LinearLayout.LayoutParams(dp(1), dp(20)).apply { leftMargin = dp(4); rightMargin = dp(4) })
        fun styled(t: String, sp: Any) = SpannableStringBuilder(t).apply { setSpan(sp, 0, t.length, 0) }
        btn("undo", "↶") { undo() }; btn("redo", "↷") { redo() }; sep()
        btn("check", "☑") { lineFmt { b -> b.list = if (b.list == "checked" || b.list == "unchecked") "" else "unchecked"; if (b.list.isNotEmpty()) b.h = 0 } }
        btn("img", "🖼") { pickImg() }; btn("draw", "✍️") { DrawPad(a) { png -> addImage(png, "png") }.show() }; sep()
        btn("h1", styled("H1", StyleSpan(Typeface.BOLD))) { lineFmt { b -> b.h = if (b.h == 1) 0 else 1; if (b.h > 0) b.list = "" } }
        btn("h2", styled("H2", StyleSpan(Typeface.BOLD))) { lineFmt { b -> b.h = if (b.h == 2) 0 else 2; if (b.h > 0) b.list = "" } }
        btn("bold", styled("B", StyleSpan(Typeface.BOLD))) { inline("bold", null) }
        btn("italic", styled("I", StyleSpan(Typeface.ITALIC))) { inline("italic", null) }
        btn("underline", styled("U", UnderlineSpan())) { inline("underline", null) }
        btn("strike", styled("S", StrikethroughSpan())) { inline("strike", null) }
        btn("color", styled("A", ForegroundColorSpan(Color.parseColor("#e5484d")))) { togglePanel("color") }
        btn("hl", styled(" A ", BackgroundColorSpan(Color.parseColor("#fff3a3")))) { togglePanel("hl") }; sep()
        btn("bullet", "•≡") { lineFmt { b -> b.list = if (b.list == "bullet") "" else "bullet"; if (b.list.isNotEmpty()) b.h = 0 } }
        btn("ordered", "1.") { lineFmt { b -> b.list = if (b.list == "ordered") "" else "ordered"; if (b.list.isNotEmpty()) b.h = 0 } }
        btn("outdent", "⇤") { lineFmt { b -> b.ind = maxOf(0, b.ind - 1) } }
        btn("indent", "⇥") { lineFmt { b -> b.ind = minOf(6, b.ind + 1) } }; sep()
        btn("hr", "―") { insertBlocks(listOf(hrBlock())) }
        btn("stamp", "🕒") {
            val et = focused?.et ?: return@btn; val n = java.time.LocalDateTime.now(java.time.ZoneId.of("Asia/Shanghai"))
            val s = "${n.monthValue}月${n.dayOfMonth}日 " + String.format("%02d:%02d ", n.hour, n.minute)
            et.text.replace(minOf(et.selectionStart, et.selectionEnd).coerceAtLeast(0), maxOf(et.selectionStart, et.selectionEnd).coerceAtLeast(0), s)
        }
        btn("clear", "⌫") {
            val b = focused?.takeIf { it.type == "t" } ?: return@btn; val et = b.et!!
            snap(); val s = minOf(et.selectionStart, et.selectionEnd); val t = maxOf(et.selectionStart, et.selectionEnd)
            muting = true; if (s < t) for (k in KEYS) setAttr(et.text, s, t, k, null) else for (k in KEYS) pending[k] = null; muting = false
            b.h = 0; b.list = ""; b.ind = 0; paintLine(b); renumber(); changed(true); syncBar()
        }
        btn("kb", "⌨") { focused?.et?.let { Dialogs.hideKeyboard(it) }; panel.visibility = View.GONE }
        syncBar()
    }
    private var panelKey = ""
    private fun togglePanel(k: String) {
        if (panel.visibility == View.VISIBLE && panelKey == k) { panel.visibility = View.GONE; return }
        panelKey = k; panel.removeAllViews(); panel.visibility = View.VISIBLE
        panel.addView(ctx.text(if (k == "color") "文字颜色" else "高亮", 13f, C.sub).apply { pad(0, 0, 8, 0) })
        for ((c, n) in if (k == "color") COLORS else HL) {
            val v = ctx.text(if (c.isEmpty()) n else "", 11f, C.sub).apply {
                gravity = Gravity.CENTER
                background = round(if (c.isEmpty()) C.card else Color.parseColor(c), dp(15).toFloat(), C.line, dp(1))
                tap { inline(if (k == "color") "color" else "backgroundColor", c); panel.visibility = View.GONE }
            }
            panel.addView(v, LinearLayout.LayoutParams(dp(30), dp(30)).apply { rightMargin = dp(10) })
        }
    }
    private fun syncBar() {
        if (barBtns.isEmpty()) return
        val b = focused
        fun on(k: String, v: Boolean) { barBtns[k]?.let { it.background = if (v) round(C.selected, dp(10).toFloat()) else null; it.setTextColor(if (v) C.accent else C.text) } }
        for (k in listOf("bold", "italic", "underline", "strike")) on(k, b?.type == "t" && curAttr(k) != null)
        on("h1", b?.h == 1); on("h2", b?.h == 2); on("bullet", b?.list == "bullet"); on("ordered", b?.list == "ordered")
        on("check", b?.list == "checked" || b?.list == "unchecked")
        barBtns["undo"]?.alpha = if (undo.size > 1) 1f else 0.35f; barBtns["redo"]?.alpha = if (redo.isNotEmpty()) 1f else 0.35f
    }

    // ================= 撤销 =================
    private fun snap(reset: Boolean = false) {
        Bg.main.removeCallbacks(snapRun)
        val v = NoteStore.toJson(opsNow()).toString()
        if (reset) { undo.clear(); redo.clear(); undo += v; lastSig = NoteStore.sig(Items.mineRecord(id)); syncBar(); return }
        if (undo.lastOrNull() == v) return
        undo += v; if (undo.size > 100) undo.removeAt(0); redo.clear(); syncBar()
    }
    private fun restore(v: String) {
        val keepAt = focused?.let { blocks.indexOf(it) } ?: -1
        setOps(NoteStore.opsOf(JSONArray(v)))
        dirty = true; Bg.main.removeCallbacks(saveRun); Bg.main.postDelayed(saveRun, 800)
        blocks.getOrNull(keepAt)?.takeIf { it.type == "t" }?.let { focusAt(it, it.et!!.text.length) } ?: focusEnd()
        syncBar()
    }
    private fun undo() { snap(); if (undo.size < 2) return; redo += undo.removeAt(undo.size - 1); restore(undo.last()) }
    private fun redo() { if (redo.isEmpty()) return; val v = redo.removeAt(redo.size - 1); undo += v; restore(v) }

    // ================= 图片 =================
    private fun loadImg(k: String, iv: ImageView, tip: TextView) {
        val maxW = ctx.resources.displayMetrics.widthPixels
        fun show(bytes: ByteArray?) {
            val bm = bytes?.let { decode(it, maxW) }
            if (bm != null) { iv.setImageBitmap(bm); iv.visibility = View.VISIBLE; tip.visibility = View.GONE }
            else { tip.text = if (fmap[k] != null) "图片没下载下来（联网、登录后再打开试试）" else "图片在另一台设备上，这里没有"; tip.visibility = View.VISIBLE }
        }
        val local = NoteStore.localFile(ctx, k)
        if (local != null) { Bg.load({ local.readBytes() }) { b, _ -> show(b) }; return }
        val fid = fmap[k]
        if (fid == null || Api.uid == null) { show(null); return }
        Bg.load({
            val got = synchronized(files) { NoteStore.download(id, fid, files) } ?: return@load null
            val ext = if (got.second.contains("png")) "png" else "jpg"
            NoteStore.keep(ctx, k, ext, got.first); got.first
        }) { b, _ -> show(b) }
    }
    private fun decode(b: ByteArray, maxW: Int): Bitmap? = try {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(b, 0, b.size, o)
        var s = 1; while (o.outWidth / s > maxW * 1.5) s *= 2
        BitmapFactory.decodeByteArray(b, 0, b.size, BitmapFactory.Options().apply { inSampleSize = s })
    } catch (e: Throwable) { null }
    private fun imgMenu(b: Blk, iv: ImageView) {
        Dialogs.sheet(ctx, "图片", listOf("看大图", "删除这张图"), setOf(1)) { i ->
            if (i == 0) { val f = NoteStore.localFile(ctx, NoteCore.imgKey(b.op!!)) ?: return@sheet; Media.preview(a, "data:image/jpeg;base64," + android.util.Base64.encodeToString(f.readBytes(), android.util.Base64.NO_WRAP)) }
            if (i == 1) { snap(); removeBlock(b); ensureTail(); changed(true) }
        }
    }
    private fun pickImg() {
        Media.pickImages(a, true) { us ->
            if (us.isEmpty()) return@pickImages
            a.toast("正在加图片…")
            Bg.load({ us.mapNotNull { u -> try { Media.jpeg(ctx, u, 1800, 85) } catch (e: Exception) { null } } }) { list, e ->
                if (list.isNullOrEmpty()) { a.toast("读不了这张图片" + (e?.message?.let { "：$it" } ?: "")); return@load }
                list.forEach { addImage(it, "jpg") }
            }
        }
    }
    private fun addImage(bytes: ByteArray, ext: String) {
        val k = java.lang.Long.toString(System.currentTimeMillis(), 36) + java.lang.Long.toString((Math.random() * 1679616).toLong(), 36)
        NoteStore.keep(ctx, k, ext, bytes)
        val op = NoteCore.Op(null, mapOf("image" to "app:$k"), linkedMapOf("data-custom" to "k=$k", "width" to "100%"))
        insertBlocks(listOf(imgBlock(op)))
        dirty = true; flush()
        upload(k, bytes, ext)
    }
    private var warned = false
    /** 登录了、这条不是「只存这台手机」：传成附件，换手机、网页也能看 */
    private fun upload(k: String, bytes: ByteArray, ext: String) {
        val rec = Items.mineRecord(id)
        if (Api.uid == null || rec?.optBoolean("local") == true) { if (!warned) { warned = true; a.toast("图片先存在这台手机上（登录并开云端同步后，网页、小程序也能看到）") }; return }
        savedTv.text = "正在上传图片…"
        Bg.load({
            val thumb = try { val bm = decode(bytes, 360); bm?.let { b -> val s = minOf(1f, 360f / maxOf(b.width, b.height)); val sc = Bitmap.createScaledBitmap(b, maxOf(1, (b.width * s).toInt()), maxOf(1, (b.height * s).toInt()), true); java.io.ByteArrayOutputStream().also { sc.compress(Bitmap.CompressFormat.JPEG, 55, it) }.toByteArray() } } catch (e: Throwable) { null }
            NoteStore.upload(id, (if (ext == "png") "手写" else "图片") + "_" + k + "." + ext, if (ext == "png") "image/png" else "image/jpeg", bytes, thumb)
        }) { fid, e ->
            if (fid.isNullOrEmpty()) { savedTv.text = "图片没传上去" + (e?.message?.let { "：$it" } ?: ""); return@load }
            fmap[k] = fid
            if (view.parent != null) { dirty = true; flush() }
            else NoteStore.patch(id) { r -> val rich = r.optJSONObject("rich") ?: return@patch; val f = rich.optJSONObject("f") ?: JSONObject().also { rich.put("f", it) }; f.put(k, fid) }
        }
    }
}

/** 7.2 手写 / 画图：钢笔、马克笔、荧光笔、橡皮，几种颜色，空白 / 横线 / 方格纸；插进备忘录是一张 PNG */
class DrawPad(private val a: Main, private val done: (ByteArray) -> Unit) {
    private val ctx: Context = a
    private class Stroke(val pen: String, val color: Int, val w: Float, val alpha: Int) { val pts = ArrayList<FloatArray>() }
    private val PENS = listOf(arrayOf("pen", "钢笔", 2.4f, 1f), arrayOf("marker", "马克笔", 6f, 1f), arrayOf("hl", "荧光笔", 18f, 0.32f), arrayOf("eraser", "橡皮", 22f, 1f))
    private val INKS = listOf("#1f2328", "#3e63dd", "#e5484d", "#2f9e44", "#f76b15", "#8e4ec6", "#f5c400")
    private val PAPERS = listOf("plain" to "空白", "line" to "横线", "grid" to "方格")
    private val PAPER_BG = Color.parseColor("#fffdf8")
    private var pen = "pen"; private var ink = INKS[0]; private var paper = "line"
    private val strokes = ArrayList<Stroke>(); private val redo = ArrayList<Stroke>()
    private lateinit var padV: View
    private lateinit var d: android.app.Dialog
    private val penBtns = HashMap<String, TextView>(); private val inkBtns = HashMap<String, View>(); private val paperBtns = HashMap<String, TextView>()

    private fun dp(v: Float) = v * ctx.resources.displayMetrics.density
    private fun drawPaper(c: Canvas, w: Int, h: Int) {
        c.drawColor(PAPER_BG)
        if (paper == "plain") return
        val p = Paint().apply { color = if (paper == "line") Color.argb(46, 62, 99, 221) else Color.argb(20, 0, 0, 0); strokeWidth = maxOf(1f, dp(0.75f)) }
        val step = dp(if (paper == "line") 32f else 24f)
        var y = step; while (y < h) { c.drawLine(0f, y, w.toFloat(), y, p); y += step }
        if (paper == "grid") { var x = step; while (x < w) { c.drawLine(x, 0f, x, h.toFloat(), p); x += step } }
    }
    private fun drawStrokes(c: Canvas, w: Int, h: Int) {
        val layer = c.saveLayer(0f, 0f, w.toFloat(), h.toFloat(), null)
        for (s in strokes) {
            val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                style = Paint.Style.STROKE; strokeWidth = dp(s.w); strokeJoin = Paint.Join.ROUND; strokeCap = if (s.pen == "hl") Paint.Cap.BUTT else Paint.Cap.ROUND
                color = s.color; alpha = s.alpha
                if (s.pen == "eraser") xfermode = PorterDuffXfermode(PorterDuff.Mode.CLEAR)
            }
            if (s.pts.size == 1) { p.style = Paint.Style.FILL; c.drawCircle(s.pts[0][0], s.pts[0][1], dp(s.w) / 2, p); continue }
            val path = Path(); path.moveTo(s.pts[0][0], s.pts[0][1])
            for (i in 1 until s.pts.size - 1) { val mx = (s.pts[i][0] + s.pts[i + 1][0]) / 2; val my = (s.pts[i][1] + s.pts[i + 1][1]) / 2; path.quadTo(s.pts[i][0], s.pts[i][1], mx, my) }
            path.lineTo(s.pts.last()[0], s.pts.last()[1])
            c.drawPath(path, p)
        }
        c.restoreToCount(layer)
    }
    @SuppressLint("ClickableViewAccessibility")
    fun show() {
        val root = ctx.col().apply { setBackgroundColor(C.card); pad(12, 10, 12, 12) }
        val top = ctx.row()
        top.addView(ctx.text("取消", 15f, C.sub, SEMI).apply { pad(10, 8); press(0, 10); tap { if (strokes.isEmpty()) d.dismiss() else Dialogs.confirm(ctx, "不插入这张手写了？", "", "不要了", danger = true) { d.dismiss() } } })
        top.addView(ctx.text("手写", 17f, C.text, BOLD).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, WRAP, 1f))
        top.addView(ctx.text("插入备忘", 15f, C.accent, BOLD).apply { pad(10, 8); press(0, 10); tap { finish() } })
        root.addView(top)
        val r1 = ctx.row().apply { pad(0, 8, 0, 4) }
        for (p in PENS) {
            val k = p[0] as String
            val v = ctx.text(p[1] as String, 13.5f, C.text, SEMI).apply { pad(12, 6); tap { pen = k; paint() } }
            penBtns[k] = v; r1.addView(v, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6f).toInt() })
        }
        r1.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        r1.addView(ctx.text("↶", 18f, C.text).apply { pad(10, 4); press(0, 10); tap { if (strokes.isNotEmpty()) { redo += strokes.removeAt(strokes.size - 1); padV.invalidate() } } })
        r1.addView(ctx.text("↷", 18f, C.text).apply { pad(10, 4); press(0, 10); tap { if (redo.isNotEmpty()) { strokes += redo.removeAt(redo.size - 1); padV.invalidate() } } })
        root.addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(r1) })
        val r2 = ctx.row().apply { pad(0, 4, 0, 8) }
        for (c in INKS) {
            val v = View(ctx).apply { tap { ink = c; if (pen == "eraser") pen = "pen"; paint() } }
            inkBtns[c] = v; r2.addView(v, LinearLayout.LayoutParams(dp(28f).toInt(), dp(28f).toInt()).apply { rightMargin = dp(8f).toInt() })
        }
        r2.addView(View(ctx), LinearLayout.LayoutParams(dp(8f).toInt(), 1))
        for ((k, n) in PAPERS) { val v = ctx.text(n, 13f, C.text, SEMI).apply { pad(10, 5); tap { paper = k; paint(); padV.invalidate() } }; paperBtns[k] = v; r2.addView(v, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(4f).toInt() }) }
        r2.addView(ctx.text("清空", 13f, C.red, SEMI).apply { pad(10, 5); tap { if (strokes.isNotEmpty()) Dialogs.confirm(ctx, "清空这张？", "", "清空", danger = true) { redo.clear(); redo.addAll(strokes.reversed()); strokes.clear(); padV.invalidate() } } })
        root.addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(r2) })
        padV = object : View(ctx) {
            var cur: Stroke? = null
            override fun onDraw(c: Canvas) { drawPaper(c, width, height); drawStrokes(c, width, height) }
            override fun onTouchEvent(e: MotionEvent): Boolean {
                parent?.requestDisallowInterceptTouchEvent(true)
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        val p = PENS.first { it[0] == pen }
                        cur = Stroke(pen, if (pen == "eraser") Color.BLACK else Color.parseColor(ink), p[2] as Float, ((p[3] as Float) * 255).toInt()).also { strokes += it; redo.clear() }
                        cur!!.pts += floatArrayOf(e.x, e.y); invalidate()
                    }
                    MotionEvent.ACTION_MOVE -> { val s = cur ?: return true; for (h in 0 until e.historySize) s.pts += floatArrayOf(e.getHistoricalX(h), e.getHistoricalY(h)); s.pts += floatArrayOf(e.x, e.y); invalidate() }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> cur = null
                }
                return true
            }
        }.apply { setLayerType(View.LAYER_TYPE_SOFTWARE, null) }
        val frame = FrameLayout(ctx).apply { background = round(PAPER_BG, dp(10f), C.line, maxOf(1, dp(1f).toInt())); clipToOutline = true }
        frame.addView(padV, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(frame, LinearLayout.LayoutParams(MATCH, 0, 1f))
        root.addView(ctx.text("用手指或手写笔写；双指不会画上去", 12f, C.mutedText).apply { gravity = Gravity.CENTER; pad(0, 8, 0, 0) })
        d = android.app.Dialog(ctx, android.R.style.Theme_DeviceDefault_Light_NoActionBar)
        d.setContentView(root)
        d.window?.setLayout(MATCH, MATCH)
        paint(); d.show()
    }
    private fun paint() {
        penBtns.forEach { (k, v) -> v.background = round(if (k == pen) C.accent else C.mutedBg, dp(14f)); v.setTextColor(if (k == pen) Color.WHITE else C.text) }
        inkBtns.forEach { (c, v) -> v.background = round(Color.parseColor(c), dp(14f), if (c == ink && pen != "eraser") C.text else Color.parseColor(c), dp(2.5f).toInt()) }
        paperBtns.forEach { (k, v) -> v.background = round(if (k == paper) C.selected else 0, dp(12f)); v.setTextColor(if (k == paper) C.accent else C.sub) }
    }
    private fun finish() {
        if (strokes.isEmpty()) { d.dismiss(); return }
        val w = padV.width; val h = padV.height
        val bm = Bitmap.createBitmap(maxOf(1, w), maxOf(1, h), Bitmap.Config.ARGB_8888)
        val c = Canvas(bm); drawPaper(c, w, h); drawStrokes(c, w, h)
        // 太大的缩到长边 1600
        val k = minOf(1f, 1600f / maxOf(w, h)); val out = if (k < 1f) Bitmap.createScaledBitmap(bm, (w * k).toInt(), (h * k).toInt(), true) else bm
        val bytes = java.io.ByteArrayOutputStream().also { out.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        d.dismiss(); done(bytes)
    }
}
