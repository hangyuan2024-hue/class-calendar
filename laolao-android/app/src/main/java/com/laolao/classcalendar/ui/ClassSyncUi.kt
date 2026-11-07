package com.laolao.classcalendar.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.StyleSpan
import android.util.Base64
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.ClassAct
import com.laolao.classcalendar.core.Gesture
import com.laolao.classcalendar.core.HwProof
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONObject
import java.io.File

// 7.55 把小程序里做过的功能同步到安卓：手势签到九宫格、交作业证明、课堂互动、用户协议和隐私政策

/** 手势九宫格：按住拖动连线，松手时连了 4 个点以上就回调；show 不为空时只是展示（投屏给同学看） */
@SuppressLint("ViewConstructor")
class GesturePad(ctx: Context, private val show: String? = null, private val onDone: ((String) -> Unit)? = null) : View(ctx) {
    private val seq = mutableListOf<Int>()
    private var fx = -1f; private var fy = -1f
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG)
    private val ln = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND }
    private val num = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = android.graphics.Color.WHITE; textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD }
    init { if (show != null) seq.addAll(show.mapNotNull { it.toString().toIntOrNull() }.filter { it in 1..9 }) }
    private fun cx(i: Int) = width * (((i - 1) % 3) * 2 + 1) / 6f
    private fun cy(i: Int) = height * (((i - 1) / 3) * 2 + 1) / 6f
    fun clear() { if (show == null) { seq.clear(); fx = -1f; invalidate() } }
    override fun onMeasure(w: Int, h: Int) { val s = minOf(MeasureSpec.getSize(w), context.dp(260)); setMeasuredDimension(s, s) }
    override fun onDraw(c: Canvas) {
        val r = width / 18f
        ln.color = C.accent; ln.strokeWidth = r * 0.55f
        for (k in 1 until seq.size) c.drawLine(cx(seq[k - 1]), cy(seq[k - 1]), cx(seq[k]), cy(seq[k]), ln)
        if (show == null && seq.isNotEmpty() && fx >= 0) c.drawLine(cx(seq.last()), cy(seq.last()), fx, fy, ln)
        num.textSize = r * 1.1f
        for (i in 1..9) {
            val on = i in seq
            dot.color = if (on) C.accent else C.alpha(C.sub, 0.35f)
            c.drawCircle(cx(i), cy(i), if (on) r * 1.35f else r * 0.7f, dot)
            if (on && show != null) c.drawText((seq.indexOf(i) + 1).toString(), cx(i), cy(i) + num.textSize * 0.36f, num)
        }
    }
    private fun hitAt(x: Float, y: Float): Int {
        for (i in 1..9) { val dx = x - cx(i); val dy = y - cy(i); if (dx * dx + dy * dy < (width / 9f) * (width / 9f)) return i }
        return 0
    }
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        if (show != null) return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { InnerScroll.busy = true; parent?.requestDisallowInterceptTouchEvent(true); seq.clear(); add(hitAt(e.x, e.y)) }
            MotionEvent.ACTION_MOVE -> { add(hitAt(e.x, e.y)); fx = e.x; fy = e.y }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                InnerScroll.busy = false; parent?.requestDisallowInterceptTouchEvent(false); fx = -1f
                if (seq.size >= 4) onDone?.invoke(seq.joinToString("")) else if (seq.isNotEmpty()) { context.toast("至少连 4 个点"); seq.clear() }
            }
        }
        invalidate(); return true
    }
    private fun add(i: Int) {
        if (i == 0 || i in seq) return
        if (seq.isNotEmpty()) { val m = Gesture.mid(seq.last(), i); if (m != 0 && m !in seq) seq += m }   // 连线经过中间的点会被一起算上
        seq += i; performHapticFeedback(android.view.HapticFeedbackConstants.VIRTUAL_KEY)
    }
}

// 7.x 课堂互动页在 ActPage.kt（抢答、小组评分；老师 / 班委也能在手机上发起、加分、看结果）

/** 开着 App 时：老师 / 班委一发起抢答或小组互评就提醒一次（同一轮只提醒一次）；首页每次显示时看一眼 */
object ActWatch {
    private var at = 0L; private var busy = false
    fun check(a: Main) {
        val c = Store.cls?.str("id") ?: return
        if (busy || !Api.loggedIn || System.currentTimeMillis() - at < 20_000L) return
        busy = true; at = System.currentTimeMillis()
        Bg.load({
            val r = ClassAct.rush(c)
            val end = try { java.time.OffsetDateTime.parse(r.str("ends_at")).toInstant().toEpochMilli() } catch (_: Exception) { 0L }
            if (!r.optBoolean("none") && r.has("id") && r.optBoolean("open") && ClassAct.canHit(r) && end > System.currentTimeMillis() + 3000 && !ClassAct.seen("r" + r.optLong("id"))) jsonOf("k" to "rush", "r" to r)
            else ClassAct.peers(c).firstOrNull { p -> p.optBoolean("open") && !ClassAct.seen("p" + p.optLong("id")) && (p.optJSONArray("targets")?.objs() ?: emptyList()).any { it.optInt("score") == 0 } }?.let { jsonOf("k" to "peer", "r" to it) }
        }) { x, _ ->
            busy = false
            if (x == null) return@load
            val r = x.optJSONObject("r") ?: return@load
            if (x.str("k") == "rush") {
                ClassAct.markSeen("r" + r.optLong("id"))
                Dialogs.confirm(a, "抢答开始", r.str("title").ifEmpty { "抢答" } + "（前 ${r.optInt("top_n", 3)} 名）", "去抢", cancel = "不抢") { a.push(ActPage(a, "rush")) }
            } else {
                ClassAct.markSeen("p" + r.optLong("id"))
                Dialogs.confirm(a, "小组评分", "「${r.str("title")}」开始了，" + (if (r.str("kind") == "cross") "给别的小组" else "给同组的组员") + "打个分吧", "去评", cancel = "稍后") { a.push(ActPage(a, "peer")) }
            }
        }
    }
}

/** 交作业：这个班要求交证明（7.35 SQL）—— 拍照 / 交文件 → 待审核；被退回的改好再交 */
class HwSubmitPage(a: Main, private val item: Long, private val onSubmitted: (() -> Unit)? = null) : Page(a) {
    private lateinit var body: LinearLayout
    private var s: JSONObject? = null; private var err = ""; private var busy = false; private var prog = ""; private var note = ""
    private val ST = mapOf("draft" to "还没交", "pending" to "已交，等老师审核", "approved" to "老师已通过 ✓", "rejected" to "被退回了，改好再交")
    override val autoRender: Boolean = false
    override fun build(): View = scaffold("交作业", pull = { done -> load(done) }) { body = it }
    override fun onShow() { if (s == null) load() }
    private fun load(done: (() -> Unit)? = null) {
        Bg.load({ Api.rpcObj("hw_sub_open", jsonOf("p_item" to item)) }) { r, e ->
            done?.invoke()
            if (r == null) { err = e?.message ?: "打不开"; render(); return@load }
            if (r.str("mode").ifEmpty { "off" } == "off") { close(); onSubmitted?.invoke(); return@load }   // 班里没开：直接打勾
            s = r; note = r.str("note"); err = ""; render()
        }
    }
    override fun render() {
        if (!::body.isInitialized) return
        body.removeAllViews()
        if (err.isNotEmpty()) { body.add(ctx.text(err, 14f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 30) }, 10); return }
        val x = s ?: run { body.add(ctx.text("加载中…", 14f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 30) }, 10); return }
        val st = x.str("status").ifEmpty { "draft" }; val lock = st == "approved"; val photo = x.str("mode") == "photo"
        val files = x.optJSONArray("files")?.objs() ?: emptyList()
        val hc = ctx.card(18, 18).apply { margins(t = 8) }
        hc.addView(ctx.text(x.str("title").ifEmpty { "作业" }, 18f, C.text, BOLD))
        hc.add(ctx.text(ST[st] ?: "还没交", 15f, when (st) { "approved" -> C.green; "rejected" -> C.red; "pending" -> C.accent; else -> C.sub }, BOLD), 6)
        if (x.str("review_note").isNotEmpty()) hc.add(ctx.text("老师说：" + x.str("review_note"), 14f, C.text).apply { pad(10, 8); bg(if (st == "approved") C.mint else C.dangerBg, 10) }, 8)
        if (x.optBoolean("late")) hc.add(ctx.text("已经过了截止时间，现在交会标记为「迟交」，老师照样能审核。", 13f, C.sub), 8)
        hc.add(ctx.text((if (photo) "拍照交：拍下写好的作业，或从相册选" else "照片和文件都可以，混着交也行（照片、PDF、Word…）") + "。交上去后老师审核，通过了才算完成。", 13f, C.sub), 10)
        body.addView(hc)
        val fc = ctx.card(14, 18).apply { margins(t = 12) }
        if (files.isEmpty()) fc.addView(ctx.text("还没有上传", 13.5f, C.sub))
        for (f in files) {
            val rw = ctx.row().apply { pad(2, 8) }
            if (f.str("thumb").isNotEmpty()) rw.addView(ImageView(ctx).apply { scaleType = ImageView.ScaleType.CENTER_CROP; Media.show(this, "data:image/jpeg;base64," + f.str("thumb"), 200) }, LinearLayout.LayoutParams(dp(48), dp(48)))
            else rw.addView(ctx.text("文件", 12f, C.accent, BOLD).apply { gravity = Gravity.CENTER; bg(C.selected, 10) }, LinearLayout.LayoutParams(dp(48), dp(48)))
            rw.addView(ctx.col().apply { pad(10, 0); addView(ctx.text(f.str("name"), 14f, C.text, lines = 1)); addView(ctx.text(Media.size(f.optLong("size")), 12f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            rw.press(0, 10); rw.tap { openFile(f) }
            if (!lock) rw.addView(ctx.text("删除", 13f, C.red, SEMI).apply { pad(10, 6); press(0, 10); tap { del(f) } })
            fc.addView(rw)
        }
        if (prog.isNotEmpty()) fc.add(ctx.text(prog, 13f, C.accent), 6)
        if (!lock && files.size < 9) fc.add(ctx.soft(if (photo) "＋ 拍照 / 从相册选" else "＋ 照片 / 文件") { if (!busy) pick(photo, 9 - files.size) }, 10)
        body.addView(fc)
        if (!lock) {
            val ni = ctx.input("想跟老师说的话（可以不填）", note).apply { margins(t = 14) }
            ni.addTextChangedListener(object : android.text.TextWatcher { override fun beforeTextChanged(q: CharSequence?, a: Int, b: Int, c: Int) {}; override fun onTextChanged(q: CharSequence?, a: Int, b: Int, c: Int) {}; override fun afterTextChanged(q: android.text.Editable?) { note = q.toString() } })
            body.addView(ni)
            body.add(ctx.button(when (st) { "pending" -> "重新提交"; "rejected" -> "改好了，再交一次"; else -> "交给老师" }) { submit(files.size) }.apply { alpha = if (busy || files.isEmpty()) 0.5f else 1f }, 16)
        }
    }
    private fun pick(photo: Boolean, room: Int) {
        val got = { us: List<android.net.Uri> -> upload(us.take(room)) }
        if (photo) Media.pickImages(a, true, got) else Media.pickFiles(a, got)
    }
    private fun upload(us: List<android.net.Uri>) {
        val sid = s?.optLong("id") ?: return; if (us.isEmpty()) return
        busy = true
        Bg.load({
            var ok = 0; val bad = mutableListOf<String>()
            us.forEachIndexed { i, u ->
                var name = Media.name(ctx, u)
                try {
                    var mime = Media.mimeOf(name).ifEmpty { ctx.contentResolver.getType(u) ?: "application/octet-stream" }
                    val img = mime.startsWith("image/") && !mime.contains("gif")
                    var data = if (img) Media.jpeg(ctx, u, 1600, 80) else Media.bytes(ctx, u)
                    if (img) { mime = "image/jpeg"; if (!name.lowercase().endsWith(".jpg") && !name.lowercase().endsWith(".jpeg")) name = name.substringBeforeLast('.', name) + ".jpg" }
                    val thumb = if (img) try { Base64.encodeToString(Media.jpeg(ctx, u, 360, 55), Base64.NO_WRAP).takeIf { it.length < 150_000 } } catch (_: Exception) { null } else null
                    HwProof.upload(sid, name, mime, data, thumb) { p -> Bg.ui { prog = "正在上传 ${i + 1}/${us.size} · $p%"; render() } }
                    ok++
                } catch (e: Exception) { bad += "「$name」" + (e.message ?: "没传上") }
            }
            val r = Api.rpcObj("hw_sub_open", jsonOf("p_item" to item))
            Triple(ok, bad, r)
        }) { r, e ->
            busy = false; prog = ""
            if (r != null) { s = r.third; if (r.second.isNotEmpty()) Dialogs.alert(ctx, "有的没传上", r.second.joinToString("\n")) }
            else Dialogs.alert(ctx, "没传上", e?.message ?: "")
            render()
        }
    }
    private fun del(f: JSONObject) = Dialogs.confirm(ctx, "删掉「${f.str("name")}」？", "", "删除", danger = true) {
        Bg.load({ Api.rpc("hw_file_del", jsonOf("fid" to f.str("id"))); Api.rpcObj("hw_sub_open", jsonOf("p_item" to item)) }) { r, e -> if (r != null) { s = r; render() } else a.toast(e?.message ?: "没删掉") }
    }
    private fun openFile(f: JSONObject) {
        a.toast("正在打开…")
        Bg.load({
            val dir = File(a.cacheDir, "att").apply { mkdirs() }
            val out = File(dir, "hw_" + f.str("id").take(8) + "_" + f.str("name").replace(Regex("[\\\\/:*?\"<>|\\s]+"), "_"))
            if (!out.exists() || out.length() != f.optLong("size")) out.writeBytes(HwProof.pull(f))
            out
        }) { file, e -> if (file == null) a.toast(e?.message ?: "打不开") else Media.open(a, file, f.str("mime")) }
    }
    private fun submit(n: Int) {
        val sid = s?.optLong("id") ?: return; if (busy) return
        if (n == 0) { a.toast(if (s?.str("mode") == "photo") "先拍一张作业照片" else "先上传照片或文件"); return }
        busy = true; render()
        Bg.load({ Api.rpc("hw_sub_submit", jsonOf("p_sid" to sid, "p_note" to note)); true }) { ok, e ->
            busy = false
            if (ok == null) { render(); Dialogs.alert(ctx, "没交上", e?.message ?: ""); return@load }
            Store.cls?.str("id")?.let { HwProof.setSub(it, item.toString(), "pending") }
            a.toast("已交，等老师审核"); close(); onSubmitted?.invoke()
        }
    }
}

/** 打勾前：这个班的作业要先交证明 → 打开交作业页，返回 true（这次先不打勾） */
fun Main.hwGuard(r: Item, then: () -> Unit): Boolean {
    if (r.done || r.type != "作业" || !Regex("^c\\d+$").matches(r.key)) return false
    val c = Store.cls ?: return false
    if (!HwProof.mustSubmit(c)) return false
    val cid = c.str("id"); val id = r.key.substring(1)
    val go = { push(HwSubmitPage(this, id.toLong()) { if (Items.find(r.key)?.done == false) { Items.toggleDone(r.key); then() } }) }
    when (HwProof.need(cid, id)) {
        false -> return false
        true -> go()
        null -> Bg.load({ HwProof.refresh(cid); HwProof.need(cid, id) }) { need, _ -> if (need == true) go() else { if (Items.find(r.key)?.done == false) { Items.toggleDone(r.key); then() } } }
    }
    return true
}

/** 用户协议、隐私政策（文字和官网 terms.html / privacy.html 一样：assets/legal.json 由 tools/legal2mini.py 生成） */
class LegalPage(a: Main, private var tab: Int = 0) : Page(a) {
    private lateinit var body: LinearLayout
    private val doc: JSONObject? by lazy { try { JSONObject(a.assets.open("legal.json").bufferedReader().use { it.readText() }) } catch (_: Exception) { null } }
    override fun build(): View = scaffold("用户协议与隐私政策") { body = it }
    override fun onShow() { render() }
    private fun spans(g: org.json.JSONArray?): CharSequence {
        val sb = SpannableStringBuilder()
        for (x in g?.objs() ?: emptyList()) { val st = sb.length; sb.append(x.str("s")); if (x.optBoolean("b")) sb.setSpan(StyleSpan(Typeface.BOLD), st, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        return sb
    }
    override fun render() {
        if (!::body.isInitialized) return
        body.removeAllViews()
        body.addView(Seg(ctx, listOf("用户协议", "隐私政策"), tab) { i -> tab = i; render() }.apply { margins(t = 4) })
        val d = doc?.optJSONObject(if (tab == 1) "privacy" else "terms")
        if (d == null) { body.add(ctx.text("打不开，请在官网查看：" + com.laolao.classcalendar.core.Cfg.SITE + (if (tab == 1) "privacy.html" else "terms.html"), 14f, C.sub), 16); return }
        val cd = ctx.card(18, 18).apply { margins(t = 12) }
        cd.addView(ctx.text(d.str("title"), 19f, C.text, HEAVY))
        cd.add(ctx.text("更新日期：" + (doc?.str("updated") ?: ""), 12f, C.sub), 4)
        for (b in d.optJSONArray("blocks")?.objs() ?: emptyList()) {
            when (b.str("t")) {
                "h" -> cd.add(ctx.text(spans(b.optJSONArray("g")), 16.5f, C.text, BOLD), 18)
                "h3" -> cd.add(ctx.text(spans(b.optJSONArray("g")), 15f, C.text, SEMI), 12)
                "li" -> cd.add(ctx.row().apply { gravity = Gravity.TOP; addView(ctx.text("•", 14f, C.sub).apply { pad(0, 0, 8, 0) }); addView(ctx.text(spans(b.optJSONArray("g")), 14f, C.text).apply { setLineSpacing(0f, 1.25f) }, LinearLayout.LayoutParams(0, WRAP, 1f)) }, 6)
                "row" -> cd.add(ctx.col().apply { pad(10, 8); bg(C.mutedBg, 10); addView(ctx.text(spans(b.optJSONArray("k")), 13.5f, C.text, SEMI)); addView(ctx.text(spans(b.optJSONArray("v")), 13f, C.sub).apply { margins(t = 2) }) }, 6)
                else -> cd.add(ctx.text(spans(b.optJSONArray("g")), 14f, C.text).apply { setLineSpacing(0f, 1.25f) }, 8)
            }
        }
        body.addView(cd)
        body.add(ctx.text("网页版：" + com.laolao.classcalendar.core.Cfg.SITE + (if (tab == 1) "privacy.html" else "terms.html"), 12f, C.sub).apply { gravity = Gravity.CENTER }, 12)
    }
}

/** 7.55 入班申请（7.28 SQL，小程序 1.24.5）：老师、能审批的班委看到等批准的人，批准 / 拒绝 */
class JoinReqPage(a: Main, private val cid: String, private val cname: String) : Page(a) {
    private lateinit var body: LinearLayout
    private var list: List<JSONObject>? = null; private var err = ""
    override fun build(): View = scaffold("入班申请", pull = { done -> load(done) }) { body = it }
    override fun onShow() { load() }
    private fun load(done: (() -> Unit)? = null) {
        Bg.load({ Api.rpcArr("class_pending", jsonOf("p_cid" to cid)).objs() }) { l, e -> done?.invoke(); if (l == null) err = e?.message ?: "加载失败" else { err = ""; list = l }; render() }
    }
    override fun render() {
        if (!::body.isInitialized) return
        body.removeAllViews()
        body.addView(ctx.text(cname, 13f, C.sub, SEMI).apply { pad(4, 4, 4, 8) })
        if (err.isNotEmpty()) { body.add(ctx.text(err, 14f, C.red), 10); return }
        val l = list ?: run { body.add(ctx.text("加载中…", 14f, C.sub), 10); return }
        if (l.isEmpty()) { body.add(ctx.text("没有等批准的人了 🎉", 14f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 30) }, 10); return }
        val c = ctx.card(6, 18)
        l.forEachIndexed { i, m ->
            if (i > 0) c.addView(ctx.hline())
            val r = ctx.row().apply { pad(12, 10) }
            r.addView(ctx.col().apply { addView(ctx.text(m.str("name"), 15f, C.text, BOLD)); addView(ctx.text(m.str("account") + " · " + m.str("joined_at").take(10) + " 申请", 12f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            r.addView(ctx.soft("拒绝", C.dangerBg, C.red) { review(m, false) })
            r.addView(ctx.soft("批准") { review(m, true) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
            c.addView(r)
        }
        body.addView(c)
    }
    private fun review(m: JSONObject, ok: Boolean) {
        val go = { Bg.load({ Api.rpc("review_member", jsonOf("cid" to cid, "uid" to m.str("user_id"), "approve" to ok)) }) { _, e -> if (e != null) a.toast(e.message ?: "没成功") else { a.toast(if (ok) "已批准" else "已拒绝"); load() } } }
        if (ok) go() else Dialogs.confirm(ctx, "拒绝「${m.str("name")}」的申请？", "", "拒绝", danger = true) { go() }
    }
}

/** 首页显示时看一眼：我能审批的班里有人在等（30 分钟内只提醒一次） */
object JoinWatch {
    private var at = 0L; private var busy = false
    fun check(a: Main) {
        if (busy || !Api.loggedIn || System.currentTimeMillis() - at < 30 * 60_000L) return
        busy = true
        Bg.load({ Api.rpcArr("my_join_requests").objs() }) { l, _ ->
            busy = false
            if (l == null) return@load
            val x = l.firstOrNull { it.optInt("n") > 0 } ?: return@load
            at = System.currentTimeMillis()
            Dialogs.confirm(a, "入班申请", l.filter { it.optInt("n") > 0 }.joinToString("、") { it.str("name") + " " + it.optInt("n") + " 人" } + "在等你批准", "去审批", cancel = "稍后") {
                a.push(JoinReqPage(a, x.str("class_id"), x.str("name")))
            }
        }
    }
}
