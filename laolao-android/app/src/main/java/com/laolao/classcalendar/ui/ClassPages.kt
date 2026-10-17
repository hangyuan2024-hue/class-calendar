package com.laolao.classcalendar.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.ApiError
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

// ---------- 班级页面共用的小东西 ----------
object CK {
    private val AV = listOf("#ff8a5b", "#4f9dff", "#34c38f", "#a66cff", "#ff5d8f", "#f5a623", "#22b8cf", "#7c8cff")
    fun avColor(name: String): Int { var s = 0; for (ch in name) s += ch.code; return C.c(AV[s % AV.size]) }
    /** 圆角头像（名字第一个字） */
    fun avatar(ctx: Context, name: String, sizeDp: Int, gender: String = "", grey: Boolean = false): View = ctx.text(name.take(1).ifEmpty { "?" }, sizeDp * 0.42f, Color.WHITE, BOLD).apply {
        gravity = Gravity.CENTER
        val c = when { grey -> C.c("#9aa5b5"); gender == "f" -> C.c("#ff6f9a"); gender == "m" -> C.c("#4f8dff"); else -> avColor(name) }
        background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(C.mix(c, Color.WHITE, 0.25f), c)).apply { cornerRadius = ctx.dp(sizeDp * 0.36f).toFloat() }
    }
    fun ms(ts: String): Long = try { java.time.OffsetDateTime.parse(ts.replace(" ", "T").let { if (Regex("[+-]\\d\\d$").containsMatchIn(it)) "$it:00" else it }).toInstant().toEpochMilli() }
        catch (e: Exception) { try { java.time.Instant.parse(ts).toEpochMilli() } catch (x: Exception) { 0 } }
    /** 「3 分钟前」「4 小时前」「2 天前」「10月1日」 */
    fun ago(ts: String): String {
        val t = ms(ts); if (t == 0L) return ""
        val s = (System.currentTimeMillis() - t) / 1000
        return when { s < 60 -> "刚刚"; s < 3600 -> "${s / 60} 分钟前"; s < 86400 -> "${s / 3600} 小时前"; s < 86400 * 7 -> "${s / 86400} 天前"
            else -> java.time.Instant.ofEpochMilli(t).atZone(T.BJ).toLocalDate().let { "${it.monthValue}月${it.dayOfMonth}日" } }
    }
    val ROLE = mapOf("teacher" to "老师", "monitor" to "班委", "admin" to "管理员")
    fun myRole(): String { val c = Store.cls ?: return ""; return if (c.optBoolean("is_teacher")) "teacher" else if (c.str("member_role") == "monitor") "monitor" else if (Store.me?.str("role") == "admin") "admin" else "student" }
    fun canPin() = myRole() in setOf("teacher", "monitor", "admin")
    fun canModerate() = Store.cls != null && (Store.isTeacher || Store.me?.str("role") == "admin")
    fun copy(ctx: Context, s: String, msg: String) { (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("laolao", s)); ctx.toast(msg) }
    /** 主页封面（和网页、数据库约束一致） */
    val COVERS = linkedMapOf("sky" to Triple("天空", "#7cc8ff", "#6a5cff"), "sakura" to Triple("樱花", "#ffd1dc", "#ff5f8f"), "ocean" to Triple("深海", "#5ee7df", "#1d4fb8"),
        "sunset" to Triple("落日", "#ffd27a", "#e8487a"), "forest" to Triple("森林", "#c6f1a8", "#1f8a6e"), "galaxy" to Triple("星空", "#a18cff", "#1d1660"),
        "peach" to Triple("蜜桃", "#ffe3c2", "#ff7a8a"), "mono" to Triple("素白", "#f3f5f9", "#d9dee8"))
    fun defaultCover(g: String) = if (g == "f") "sakura" else if (g == "m") "sky" else "ocean"
    fun cover(c: String, g: String): GradientDrawable { val x = COVERS[c] ?: COVERS[defaultCover(g)]!!; return GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(C.c(x.second), C.c(x.third))) }
    /** 没登录 / 没班级时的提示 */
    fun gate(page: Page, body: LinearLayout): Boolean {
        val w = if (Store.work()) "团队" else "班级"
        if (Store.cls == null) {
            body.addView(page.ctx.empty("🏫", if (Store.pending.isNotEmpty()) "等老师批准中" else "还没加入$w", if (Store.pending.isNotEmpty()) "批准后就能看到" else "输入${w}码加入后就能用"))
            body.add(page.ctx.button("去加入$w") { page.a.push(ClassPage(page.a)) }, 14)
            return true
        }
        return false
    }
}

// =====================================================================
/** 班级墙：发言 / 文章 / 通知、置顶、评论回复、举报和老师处理（和网页、小程序同一套数据库函数） */
class WallPage(a: Main, private val focus: Long = 0) : Page(a) {
    private lateinit var body: LinearLayout
    private var posts: List<JSONObject>? = null
    private var mine = setOf<String>()
    private var reports: List<JSONObject> = emptyList()
    private var comments: List<JSONObject> = emptyList()
    private var err = ""; private var busy = false
    private var filter = 0
    private val open = HashSet<Long>(); private val expand = HashSet<Long>(); private val unfold = HashSet<Long>()
    private var loadedFor = ""
    override val autoRender = false
    private val REASONS = listOf("不友善 / 人身攻击", "广告 / 刷屏", "信息不实", "泄露他人隐私", "其他")

    override fun build(): View {
        val f = FrameLayout(ctx).apply { setBackgroundColor(C.bg) }
        val col = ctx.col()
        col.addView(header("班级墙", ctx.text("👥 成员", 14f, C.accent, SEMI).apply { pad(12, 8); press(C.selected, 12); tap { a.push(PeoplePage(a)) } }))
        val ps = PullScroll(ctx) { done -> load { done() } }
        body = ps.content.apply { pad(16, 4, 16, 110) }
        col.addView(ps, LinearLayout.LayoutParams(MATCH, 0, 1f))
        f.addView(col, FrameLayout.LayoutParams(MATCH, MATCH))
        a.fabs += Fab(a, f) {
            if (Store.cls == null) emptyList() else listOfNotNull(FabItem("💬", "说点什么") { compose(null, false, false) }, FabItem("📝", "写一篇文章") { compose(null, true, false) },
                if (CK.canPin()) FabItem("📢", "发布通知") { compose(null, false, true) } else null)
        }
        return f
    }
    override fun onShow() { if (posts == null || loadedFor != Store.cls?.str("id")) load() }

    private fun load(done: (() -> Unit)? = null) {
        val c = Store.cls ?: run { render(); done?.invoke(); return }
        if (busy) { done?.invoke(); return }
        busy = true; val cid = c.str("id")
        Bg.load({
            val p = (Api.rest("wall_posts?select=id,class_id,author_id,author_name,author_role,title,body,is_notice,pinned_at,hidden,report_count,reviewed,created_at,edited_at&class_id=eq.$cid&order=created_at.desc&limit=300") as? JSONArray)?.objs() ?: emptyList()
            val m = (Api.rpc("wall_my_reports", jsonOf("cid" to cid)) as? JSONArray)?.let { x -> (0 until x.length()).map { x.opt(it).toString() } } ?: emptyList()
            val r = if (CK.canModerate()) (Api.rpc("wall_report_list", jsonOf("cid" to cid)) as? JSONArray)?.objs() ?: emptyList() else emptyList()
            val cm = try { (Api.rpc("wall_comments_get", jsonOf("cid" to cid)) as? JSONArray)?.objs() ?: emptyList() } catch (_: Exception) { emptyList() }
            arrayOf(p, m, r, cm)
        }) { res, e ->
            busy = false; done?.invoke()
            if (res == null) { err = "班级墙加载失败：" + (e?.message ?: "") ; render(); return@load }
            @Suppress("UNCHECKED_CAST")
            posts = res[0] as List<JSONObject>; mine = (res[1] as List<String>).toSet(); reports = res[2] as List<JSONObject>; comments = res[3] as List<JSONObject>
            err = ""; loadedFor = cid
            if (focus > 0) unfold += focus
            render()
        }
    }

    override fun render() {
        view
        keepScroll(body)
        if (!Store.feat("wall")) { body.addView(ctx.empty("⏸", "班级墙暂时用不了", Store.feats.optJSONObject("wall")?.str("note") ?: "")); return }
        if (CK.gate(this, body)) return
        val c = Store.cls!!
        body.addView(ctx.text((c.str("nickname").ifEmpty { c.str("name") }) + " · " + (CK.ROLE[CK.myRole()] ?: "同学"), 12.5f, C.sub, SEMI).apply { pad(4, 4, 4, 8) })
        // 发言框（点了弹出编辑）
        val me = Store.me
        val box = ctx.row().apply { pad(12, 12); bg(C.card, 18, C.line); tap { compose(null, false, false) } }
        box.addView(CK.avatar(ctx, Store.name(), 36, me?.str("gender") ?: ""), LinearLayout.LayoutParams(dp(36), dp(36)))
        box.addView(ctx.text(if (CK.myRole() == "student") "想对全班说点什么？" else "发通知、发文章，或者随便聊聊", 14.5f, C.mutedText).apply { pad(12, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        body.addView(box)
        body.add(Seg(ctx, listOf("全部", "通知", "我发的"), filter) { filter = it; render() }, 12)
        if (err.isNotEmpty()) body.add(ctx.text(err, 13f, C.red).apply { bg(C.dangerBg, 10); pad(12, 8) }, 10)
        // 老师：待处理的举报
        if (CK.canModerate() && reports.isNotEmpty()) {
            body.addView(ctx.section("待处理的举报", "${reports.size} 条", C.red))
            for (x in reports) {
                val rc = ctx.card(14, 16).apply { margins(t = 8) }
                rc.addView(ctx.text(x.str("author_name") + "：" + (if (x.str("title").isNotEmpty()) "「${x.str("title")}」" else "内容") + if (x.optBoolean("hidden")) "（已隐藏）" else "", 14f, C.text, BOLD))
                rc.add(ctx.text(x.str("body").take(120), 13f, C.sub), 4)
                x.optJSONArray("reports")?.objs()?.forEach { y -> rc.add(ctx.text("· " + y.str("by").ifEmpty { "同学" } + "：" + y.str("reason"), 12.5f, C.red), 4) }
                val br = ctx.row().apply { margins(t = 10) }
                val id = x.optLong("id")
                br.addView(ctx.soft("保留") { mod(id, "dismiss", "已保留，举报已处理") }, LinearLayout.LayoutParams(0, dp(38), 1f))
                br.addView(ctx.soft(if (x.optBoolean("hidden")) "恢复显示" else "隐藏", C.dangerBg, C.red) { mod(id, if (x.optBoolean("hidden")) "unhide" else "hide", if (x.optBoolean("hidden")) "已恢复显示" else "已隐藏") }, LinearLayout.LayoutParams(0, dp(38), 1f).apply { leftMargin = dp(8) })
                br.addView(ctx.soft("看原帖") { unfold += id; filter = 0; render() }, LinearLayout.LayoutParams(0, dp(38), 1f).apply { leftMargin = dp(8) })
                rc.addView(br); body.addView(rc)
            }
        }
        val ps = posts
        if (ps == null) { body.add(ctx.text(if (busy) "加载中…" else "", 14f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 30) }, 10); if (!busy) load(); return }
        val uid = Api.uid ?: ""
        var list = ps
        if (filter == 1) list = list.filter { it.optBoolean("is_notice") }
        if (filter == 2) list = list.filter { it.str("author_id") == uid }
        val pinned = list.filter { it.str("pinned_at").isNotEmpty() && !it.optBoolean("hidden") }.sortedByDescending { it.str("pinned_at") }
        val rest = list.filter { !(it.str("pinned_at").isNotEmpty() && !it.optBoolean("hidden")) }
        val all = pinned + rest
        if (all.isEmpty()) { body.addView(ctx.empty("✍️", when (filter) { 1 -> "还没有通知"; 2 -> "你还没发过内容"; else -> "还没有人发言，来发第一条吧" })); return }
        val cm = comments.groupBy { it.optLong("post_id") }
        for (p in all) body.add(post(p, uid, cm[p.optLong("id")] ?: emptyList()), 12)
    }

    private fun post(p: JSONObject, uid: String, cs: List<JSONObject>): View {
        val id = p.optLong("id"); val mineP = p.str("author_id") == uid; val mod = CK.canModerate()
        val c = ctx.card(14, 18)
        val pinned = p.str("pinned_at").isNotEmpty() && !p.optBoolean("hidden")
        if (pinned || p.optBoolean("is_notice")) {
            val fr = ctx.row()
            if (pinned) fr.addView(ctx.chip("📌 置顶", C.accent, C.selected, 12f).apply { pad(8, 2) })
            if (p.optBoolean("is_notice")) fr.addView(ctx.chip("📢 通知", C.red, C.dangerBg, 12f).apply { pad(8, 2) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = if (pinned) dp(6) else 0 })
            c.addView(fr); c.addView(ctx.space(8))
        }
        val hr = ctx.row()
        hr.addView(CK.avatar(ctx, p.str("author_name"), 36).apply { tap { if (p.str("author_id").isNotEmpty()) a.push(UserPage(a, p.str("author_id"))) } }, LinearLayout.LayoutParams(dp(36), dp(36)))
        val nc = ctx.col().apply { pad(10, 0) }
        val nr = ctx.row()
        nr.addView(ctx.text(p.str("author_name"), 14.5f, C.text, BOLD, 1))
        CK.ROLE[p.str("author_role")]?.let { nr.addView(ctx.chip(it, C.accent, C.selected, 11f), LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) }) }
        nc.addView(nr)
        nc.addView(ctx.text(CK.ago(p.str("created_at")) + if (p.str("edited_at").isNotEmpty()) "（已编辑）" else "", 12f, C.sub))
        hr.addView(nc, LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("⋯", 20f, C.sub).apply { pad(10, 0); tap { more(p, mineP) } })
        c.addView(hr)
        val folded = p.optInt("report_count") >= 3 && !p.optBoolean("reviewed") && !mineP && !mod && id !in unfold
        if (folded) { c.add(ctx.text("这条被多位同学举报，等老师处理中。点这里仍然查看", 13f, C.sub).apply { bg(C.mutedBg, 10); pad(12, 8); tap { unfold += id; render() } }, 10); return c }
        if (p.optBoolean("hidden")) c.add(ctx.text(if (mod) "已被隐藏，只有你们能看到" else "已被老师隐藏，只有你能看到", 12.5f, C.red).apply { bg(C.dangerBg, 8); pad(10, 5) }, 10)
        if (p.str("title").isNotEmpty()) c.add(ctx.text(p.str("title"), 17f, C.text, HEAVY), 10)
        val bodyT = p.str("body"); val long = bodyT.length > 280 || bodyT.lines().size > 7
        val shortT = long && id !in expand
        var txt = bodyT; if (shortT) { txt = bodyT.lines().take(7).joinToString("\n"); if (txt.length > 280) txt = txt.take(280); txt += "…" }
        c.add(ctx.text(md(txt), 15f, C.text).apply { setLineSpacing(0f, 1.3f); setTextIsSelectable(true) }, 8)
        if (shortT) c.add(ctx.text("展开全文", 13.5f, C.accent, SEMI).apply { tap { expand += id; render() } }, 4)
        if (mod && p.optInt("report_count") > 0) c.add(ctx.text("🚩 被举报 ${p.optInt("report_count")} 次", 12f, C.red), 6)
        // 评论
        val canCmt = !(p.optBoolean("hidden") && !mod)
        if (canCmt) {
            val isOpen = id in open
            val shown = if (isOpen) cs else cs.takeLast(2)
            if (shown.isNotEmpty()) {
                val cc = ctx.col().apply { bg(C.mutedBg, 12); pad(12, 8); margins(t = 10) }
                if (!isOpen && cs.size > 2) cc.addView(ctx.text("查看全部 ${cs.size} 条评论", 13f, C.accent, SEMI).apply { pad(0, 2, 0, 6); tap { open += id; render() } })
                for (x in shown) {
                    val t = android.text.SpannableStringBuilder()
                    val n0 = t.length; t.append(x.str("author_name")); t.setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), n0, t.length, 0)
                    if (x.str("reply_name").isNotEmpty()) t.append(" 回复 ").append(x.str("reply_name"))
                    t.append("：").append(x.str("body"))
                    val line = ctx.text(t, 14f, C.text).apply { pad(0, 4) }
                    val cmine = x.str("author_id") == uid
                    line.setOnClickListener {
                        val opts = mutableListOf<String>(); if (!cmine) opts += "回复 ${x.str("author_name")}"; if (cmine || mineP || mod) opts += "删除评论"
                        if (opts.isNotEmpty()) Dialogs.sheet(ctx, CK.ago(x.str("created_at")), opts, danger = setOf(opts.size - 1).filter { opts.last() == "删除评论" }.toSet()) { i ->
                            if (opts[i].startsWith("回复")) comment(id, x.str("author_name")) else Dialogs.confirm(ctx, "删除这条评论？", "", "删除", danger = true) {
                                Bg.load({ Api.rpc("wall_comment_delete", jsonOf("cmid" to x.optLong("id"))) }) { _, e -> if (e != null) a.toast("删除失败：" + e.message) else { comments = comments.filter { it.optLong("id") != x.optLong("id") }; render() } }
                            }
                        }
                    }
                    cc.addView(line)
                }
                c.addView(cc)
            }
            c.add(ctx.text("💬 " + if (cs.isEmpty()) "评论" else "评论 ${cs.size}", 13.5f, C.sub, SEMI).apply { pad(0, 6, 12, 0); tap { comment(id, "") } }, 6)
        }
        return c
    }
    /** **粗体**、`代码`（和网页 mdLite 一样的简单格式） */
    private fun md(s: String): CharSequence {
        val b = android.text.SpannableStringBuilder(); var i = 0
        val re = Regex("\\*\\*(.+?)\\*\\*|`([^`]+)`")
        for (m in re.findAll(s)) {
            b.append(s.substring(i, m.range.first))
            val st = b.length
            if (m.groupValues[1].isNotEmpty()) { b.append(m.groupValues[1]); b.setSpan(android.text.style.StyleSpan(android.graphics.Typeface.BOLD), st, b.length, 0) }
            else { b.append(m.groupValues[2]); b.setSpan(android.text.style.BackgroundColorSpan(C.mutedBg), st, b.length, 0); b.setSpan(android.text.style.TypefaceSpan("monospace"), st, b.length, 0) }
            i = m.range.last + 1
        }
        b.append(s.substring(i)); return b
    }
    private fun more(p: JSONObject, mineP: Boolean) {
        val id = p.optLong("id"); val mod = CK.canModerate(); val opts = mutableListOf<String>()
        if (CK.canPin() && !p.optBoolean("hidden")) opts += if (p.str("pinned_at").isNotEmpty()) "取消置顶" else "置顶（首页也会显示）"
        if (mineP) opts += "编辑"
        opts += "复制内容"
        if (!mineP && !mod) opts += if (p.opt("id").toString() in mine) "已举报" else "举报"
        if (mod) opts += if (p.optBoolean("hidden")) "恢复显示" else "隐藏"
        if (mineP || mod) opts += "删除"
        Dialogs.sheet(ctx, "", opts, danger = opts.indices.filter { opts[it] == "删除" || opts[it] == "隐藏" }.toSet()) { i ->
            when (opts[i]) {
                "取消置顶", "置顶（首页也会显示）" -> act({ Api.rpc("wall_pin", jsonOf("pid" to id, "on_top" to p.str("pinned_at").isEmpty())) }, if (p.str("pinned_at").isEmpty()) "已置顶，首页也会显示" else "已取消置顶")
                "编辑" -> compose(p, p.str("title").isNotEmpty(), false)
                "复制内容" -> CK.copy(ctx, (if (p.str("title").isNotEmpty()) p.str("title") + "\n" else "") + p.str("body"), "已复制")
                "举报" -> report(p)
                "已举报" -> a.toast("你已经举报过了，老师会尽快处理")
                "隐藏" -> Dialogs.confirm(ctx, "隐藏这条？", "隐藏后全班都看不到这条，作者自己还能看到。", "隐藏", danger = true) { mod(id, "hide", "已隐藏") }
                "恢复显示" -> mod(id, "unhide", "已恢复显示")
                "删除" -> Dialogs.confirm(ctx, "删除这条内容？", "删除后不能恢复。", "删除", danger = true) { act({ Api.rpc("wall_delete", jsonOf("pid" to id)) }, "已删除") }
            }
        }
    }
    private fun mod(id: Long, action: String, ok: String) = act({ Api.rpc("wall_moderate", jsonOf("pid" to id, "action" to action)) }, ok)
    private fun act(work: () -> Any?, ok: String) { Bg.load(work) { _, e -> if (e != null) Dialogs.alert(ctx, "操作失败", e.message ?: "") else { a.toast(ok); load() } } }

    private fun report(p: JSONObject) {
        Dialogs.sheet(ctx, "举报的原因", REASONS) { i ->
            Dialogs.prompt(ctx, "补充说明（可不填）", "", "比如哪里不实") { note ->
                val reason = REASONS[i] + if (note.isNotBlank()) "：" + note.trim() else ""
                Bg.load({ Api.rpc("wall_report", jsonOf("pid" to p.optLong("id"), "p_reason" to reason)) }) { _, e ->
                    if (e != null) Dialogs.alert(ctx, "举报失败", e.message ?: "") else { mine = mine + p.opt("id").toString(); Dialogs.alert(ctx, "已提交举报", "老师会尽快处理") }
                }
            }
        }
    }
    private fun comment(pid: Long, reply: String) {
        Dialogs.prompt(ctx, if (reply.isNotEmpty()) "回复 $reply" else "写评论", "", "友善发言，理性讨论", multi = true) { s ->
            if (s.isBlank()) return@prompt
            Bg.load({ Api.rpc("wall_comment_add", jsonOf("pid" to pid, "p_body" to s.trim(), "p_reply" to reply.ifEmpty { null })) }) { r, e ->
                if (e != null) Dialogs.alert(ctx, "评论失败", e.message ?: "") else { (r as? JSONObject)?.let { comments = comments + it }; open += pid; render() }
            }
        }
    }
    /** 发帖 / 编辑：底部表单 */
    private fun compose(edit: JSONObject?, article0: Boolean, notice0: Boolean) {
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var d: android.app.Dialog
        var article = article0; var notice = notice0
        c.addView(ctx.text(if (edit != null) "编辑" else "发到班级墙", 18f, C.text, BOLD))
        val title = ctx.input("标题", edit?.str("title") ?: "").apply { visibility = if (article) View.VISIBLE else View.GONE }
        val bd = ctx.input("想说点什么？支持 **粗体**、- 列表", edit?.str("body") ?: "", multi = true).apply { minLines = 5; maxLines = 12 }
        if (edit == null) {
            val tr = ctx.row().apply { margins(t = 12) }
            tr.addView(Toggle(ctx, "写成文章（带标题）", "", article) { v -> article = v; title.visibility = if (v) View.VISIBLE else View.GONE }, LinearLayout.LayoutParams(MATCH, WRAP))
            c.addView(tr)
            if (CK.canPin()) c.addView(Toggle(ctx, "作为通知（会标红）", "", notice) { v -> notice = v })
        }
        c.add(title, 10); c.add(bd, 10)
        val err = ctx.text("", 13f, C.red).apply { visibility = View.GONE }; c.add(err, 8)
        var sending = false
        c.add(ctx.button(if (edit != null) "保存" else "发布") {
            val b = bd.text.toString().trim()
            if (b.isEmpty()) { err.text = "写点内容再发吧"; err.visibility = View.VISIBLE; return@button }
            if (b.length > 5000) { err.text = "内容太长了，最多 5000 字"; err.visibility = View.VISIBLE; return@button }
            if (sending) return@button; sending = true
            val t = if (article) title.text.toString().trim() else ""
            Bg.load({
                if (edit != null) Api.rpc("wall_edit", jsonOf("pid" to edit.optLong("id"), "p_title" to t, "p_body" to b))
                else Api.rpc("wall_post", jsonOf("cid" to Store.cls!!.str("id"), "p_title" to t, "p_body" to b, "p_notice" to (notice && CK.canPin())))
            }) { _, e ->
                sending = false
                if (e != null) { err.text = (if (edit != null) "保存失败：" else "发布失败：") + e.message; err.visibility = View.VISIBLE }
                else { Dialogs.hideKeyboard(c); d.dismiss(); a.toast(if (edit != null) "已保存" else "已发布"); filter = 0; load() }
            }
        }, 12)
        d = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
        bd.requestFocus(); Dialogs.showKeyboard(bd)
    }
}

// =====================================================================
/** 班级成员（同学录）：老师 / 班委 / 同学，能搜索，点进个人主页 */
class PeoplePage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var list: List<JSONObject>? = null
    private var full = true; private var err = ""; private var q = ""
    override val autoRender = false
    override fun build(): View = scaffold("班级成员", pull = { done -> load { done() } }) { body = it }
    override fun onShow() { if (list == null) load() }
    private fun load(done: (() -> Unit)? = null) {
        val c = Store.cls ?: run { render(); done?.invoke(); return }
        Bg.load({ Api.rpcObj("class_people", jsonOf("cid" to c.str("id"))) }) { r, e ->
            done?.invoke()
            if (r == null) err = "加载失败：" + (e?.message ?: "") else { list = r.optJSONArray("people")?.objs() ?: emptyList(); full = r.optBoolean("full", true); err = "" }
            render()
        }
    }
    override fun render() {
        view
        keepScroll(body)
        if (CK.gate(this, body)) return
        val search = ctx.input("搜名字或签名", q).apply {
            addTextChangedListener(object : android.text.TextWatcher {
                override fun afterTextChanged(s: android.text.Editable?) { q = s.toString(); Bg.main.removeCallbacks(rr); Bg.main.postDelayed(rr, 250) }
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
        }
        body.addView(search)
        listBox = ctx.col(); body.addView(listBox)
        fill()
    }
    private var listBox: LinearLayout? = null
    private val rr = Runnable { fill() }
    private fun fill() {
        val box = listBox ?: return; box.removeAllViews()
        if (err.isNotEmpty()) box.add(ctx.text(err, 13f, C.red), 10)
        val l = list ?: run { box.add(ctx.text("加载中…", 14f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 30) }, 10); return }
        val show = if (q.isBlank()) l else l.filter { (it.str("name") + it.str("bio")).contains(q.trim()) }
        if (show.isEmpty()) { box.addView(ctx.empty("🔍", if (q.isNotBlank()) "没有找到「$q」" else "班里还没有人")); return }
        val me = Api.uid
        for ((title, k) in listOf("老师" to "teacher", "班委" to "monitor", "同学" to "student")) {
            val g = show.filter { it.str("role") == k }; if (g.isEmpty()) continue
            box.addView(ctx.section(title, "${g.size} 人"))
            val c = ctx.card(4, 18)
            g.forEachIndexed { i, p ->
                if (i > 0) c.addView(ctx.hline())
                val r = ctx.row().apply { pad(14, 10); press(0, 14); tap { a.push(UserPage(a, p.str("id"))) } }
                r.addView(CK.avatar(ctx, p.str("name"), 40, p.str("gender")), LinearLayout.LayoutParams(dp(40), dp(40)))
                val cc = ctx.col().apply { pad(12, 0) }
                cc.addView(ctx.text(p.str("name") + (if (p.str("id") == me) "（我）" else "") + when (p.str("gender")) { "m" -> " ♂"; "f" -> " ♀"; else -> "" }, 15f, C.text, SEMI, 1))
                if (p.str("bio").isNotEmpty()) cc.addView(ctx.text(p.str("bio"), 12.5f, C.sub, lines = 1))
                r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f)); r.addView(ctx.text("›", 18f, C.mutedText))
                c.addView(r)
            }
            box.addView(c)
        }
        if (!full) box.add(ctx.text("你只能看到老师、班委和自己。老师给你开了「看成员名单」权限后能看到全班。", 12.5f, C.sub), 12)
    }
}

// =====================================================================
/** 个人主页：封面、签名、统计、成长足迹、TA 的班级墙；自己能编辑资料，老师能给学生重置临时密码 */
class UserPage(a: Main, private val uid: String? = null) : Page(a) {
    private lateinit var body: LinearLayout
    private var d: JSONObject? = null; private var err = ""
    override val autoRender = false
    override fun build(): View = scaffold("个人主页", pull = { done -> load { done() } }) { body = it }
    override fun onShow() { if (d == null) load() }
    private fun load(done: (() -> Unit)? = null) {
        Bg.load({ Api.rpcObj("user_page", jsonOf("uid" to (uid ?: Api.uid), "cid" to Store.cls?.str("id"))) }) { r, e ->
            done?.invoke(); if (r == null) err = "打不开这个主页：" + (e?.message ?: "") else { d = r; err = "" }; render()
        }
    }
    override fun render() {
        view
        keepScroll(body)
        val x = d ?: run { body.addView(ctx.text(err.ifEmpty { "加载中…" }, 14f, if (err.isNotEmpty()) C.red else C.sub).apply { gravity = Gravity.CENTER; pad(0, 40) }); return }
        val g = x.str("gender"); val me = x.optBoolean("me"); val isT = x.str("class_role") == "teacher"
        // 封面 + 头像
        val hero = ctx.col().apply { bg(C.card, 22, C.line); clipToOutline = true }
        val cv = FrameLayout(ctx).apply { background = CK.cover(x.str("cover"), g) }
        if (me) cv.addView(ctx.text("🎨 装扮主页", 12.5f, Color.WHITE, SEMI).apply { pad(10, 5); bg(C.alpha(Color.BLACK, 0.25f), 12); tap { editProfile(x) } }, FrameLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.END or Gravity.TOP; topMargin = dp(10); rightMargin = dp(10) })
        // 封面 + 压在封面边上的头像：用 FrameLayout 摆绝对位置，不靠负边距（负边距会被裁掉一半）
        val top = FrameLayout(ctx)
        top.addView(cv, FrameLayout.LayoutParams(MATCH, dp(96)))
        top.addView(CK.avatar(ctx, x.str("name"), 68, g).apply { elevation = dp(4).toFloat(); background = (background as GradientDrawable).apply { setStroke(dp(3), C.card) } }, FrameLayout.LayoutParams(dp(68), dp(68)).apply { leftMargin = dp(16); topMargin = dp(62) })
        val hc = ctx.col()
        hc.addView(ctx.text(x.str("name") + when (g) { "m" -> " ♂"; "f" -> " ♀"; else -> "" }, 19f, C.text, HEAVY, 1))
        val role = when (x.str("class_role")) { "teacher" -> "老师"; "monitor" -> "班委"; "student" -> "同学"; else -> "" }
        val joined = CK.ms(x.str("joined")).takeIf { it > 0 } ?: System.currentTimeMillis()
        top.addView(hc, FrameLayout.LayoutParams(MATCH, WRAP).apply { leftMargin = dp(96); rightMargin = dp(16); topMargin = dp(102) })
        hero.addView(top, LinearLayout.LayoutParams(MATCH, WRAP))
        hero.addView(ctx.text(listOf(role, x.str("class_name").let { if (it.isNotEmpty()) "🏫 $it" else "" }, if (x.str("account").isNotEmpty()) "@" + x.str("account") else "", "加入 ${maxOf(1, (System.currentTimeMillis() - joined) / 86400000)} 天").filter { it.isNotEmpty() }.joinToString(" · "), 12.5f, C.sub, lines = 2).apply { pad(16, 14, 16, 0) })
        hero.addView(ctx.text("“ " + x.str("bio").ifEmpty { if (me) "写一句个性签名，让同学更了解你 ✍️" else "这个人很低调，还没有写签名" }, 14f, if (x.str("bio").isEmpty()) C.mutedText else C.text).apply { pad(16, 12, 16, 4) })
        val ops = ctx.row().apply { pad(16, 8, 16, 16) }
        if (me) ops.addView(ctx.soft("✏️ 编辑资料") { editProfile(x) }, LinearLayout.LayoutParams(0, dp(40), 1f))
        if (x.optBoolean("can_reset")) ops.addView(ctx.soft("🔑 重置密码", C.dangerBg, C.red) { resetPw(x) }, LinearLayout.LayoutParams(0, dp(40), 1f).apply { if (me) leftMargin = dp(10) })
        if (ops.childCount > 0) hero.addView(ops) else hero.addView(ctx.space(12))
        body.addView(hero)
        // 统计
        if (!isT) {
            fun v(k: String) = if (x.isNull(k) || !x.has(k)) "—" else x.opt(k).toString()
            val st = listOf("⚡" to (v("week_points") to "本周成长值"), "🏆" to (v("total_points") to "累计成长值"), "🔥" to ((if (x.optBoolean("show_points")) v("streak") else "—") to "连续活跃天"), "💬" to ("${x.optInt("post_count") + x.optInt("comment_count")}" to "发言和评论"))
            for (rowI in 0..1) {
                val r = ctx.row().apply { margins(t = 10) }
                for (k in 0..1) { val (ic, p) = st[rowI * 2 + k]
                    r.addView(ctx.col().apply { pad(14, 12); bg(C.card, 16, C.line); addView(ctx.text(ic, 18f)); addView(ctx.text(p.first, 20f, C.text, HEAVY)); addView(ctx.text(p.second, 12f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (k == 1) leftMargin = dp(10) })
                }
                body.addView(r)
            }
            if (x.optBoolean("show_points")) {
                body.addView(ctx.section("成长足迹", "最近 16 周"))
                val hc2 = ctx.card(14, 18)
                hc2.addView(HeatMap(ctx, x.optJSONObject("days") ?: JSONObject()), LinearLayout.LayoutParams(MATCH, dp(120)))
                hc2.add(ctx.text("完成 ${x.optInt("done")} 件事 · 打卡 ${x.optInt("habits")} 次 · 专注 ${x.optInt("pomos")} 个番茄", 12.5f, C.sub), 8)
                body.addView(hc2)
            } else body.add(ctx.text("TA 在排行榜里设置了不公开，成长记录只有自己和老师能看到 🔒", 13f, C.sub).apply { bg(C.mutedBg, 12); pad(14, 10) }, 14)
        }
        // TA 的班级墙
        val posts = x.optJSONArray("posts")?.objs() ?: emptyList()
        body.addView(ctx.section((if (me) "我" else if (isT) "老师" else "TA") + "的班级墙", "${x.optInt("post_count")} 条发言"))
        if (posts.isEmpty()) body.addView(ctx.text(if (me) "你还没在班级墙发过言，去打个招呼吧 👋" else "还没有发过言", 13.5f, C.sub).apply { bg(C.card, 14, C.line); pad(14, 14); tap { a.push(WallPage(a)) } })
        for (p in posts) {
            val c = ctx.card(14, 16).apply { margins(t = 8); tap { a.push(WallPage(a, p.optLong("id"))) } }
            if (p.optBoolean("is_notice") || p.str("title").isNotEmpty()) c.addView(ctx.text((if (p.optBoolean("is_notice")) "📢 " else "") + p.str("title"), 15f, C.text, BOLD, 1))
            c.addView(ctx.text(p.str("body"), 14f, C.text, lines = 4).apply { margins(t = 4) })
            c.addView(ctx.text(CK.ago(p.str("created_at")) + if (p.optInt("comments") > 0) " · 💬 ${p.optInt("comments")}" else "", 12f, C.sub).apply { margins(t = 6) })
            body.addView(c)
        }
    }
    private fun editProfile(x: JSONObject) = ProfileSheet.open(a, x.str("gender"), x.str("cover"), x.str("bio")) { d = null; load() }
    private fun resetPw(x: JSONObject) {
        Dialogs.confirm(ctx, "给「${x.str("name")}」重置密码？", "会生成一个临时密码，TA 用临时密码登录后必须马上改成自己的新密码。原来的密码立刻失效。", "重置", danger = true) {
            Bg.load({ Api.rpcObj("pw_reset_by_staff", jsonOf("uid" to x.str("id"))) }) { r, e ->
                if (r == null) { Dialogs.alert(ctx, "重置失败", e?.message ?: ""); return@load }
                val txt = "账号 ${r.str("account")}　临时密码 ${r.str("temp")}"
                Dialogs.confirm(ctx, "临时密码", "已重置。把账号和临时密码告诉 ${r.str("name")}：\n\n$txt", "复制", cancel = "关闭") { CK.copy(ctx, txt, "已复制") }
            }
        }
    }
}

/** 编辑资料：性别、主页封面、个性签名（「我的」和个人主页共用） */
object ProfileSheet {
    fun open(a: Main, g0: String, cover0: String, bio0: String, done: () -> Unit) {
        val c = a.col().apply { pad(20, 18, 20, 18) }
        lateinit var d: android.app.Dialog
        var g = if (g0 == "m" || g0 == "f") g0 else "x"; var cover = cover0; var pal = true
        c.addView(a.text("编辑资料", 18f, C.text, BOLD))
        c.add(a.text("姓名：${Store.name()}（姓名要改的话请找老师）", 13f, C.sub), 4)
        c.add(a.text("性别", 14f, C.text, SEMI), 14)
        val covers = a.row()
        fun paintCovers() {
            covers.removeAllViews()
            val sel = cover.ifEmpty { CK.defaultCover(g) }
            for ((k, v) in CK.COVERS) covers.addView(a.text(v.first, 11.5f, Color.WHITE, BOLD).apply {
                gravity = Gravity.CENTER; background = CK.cover(k, "").apply { cornerRadius = a.dp(10).toFloat(); if (k == sel) setStroke(a.dp(3), C.text) }
                tap { cover = k; paintCovers() }
            }, LinearLayout.LayoutParams(a.dp(58), a.dp(40)).apply { rightMargin = a.dp(8) })
        }
        c.add(Seg(a, listOf("👦 男生", "👧 女生", "🤫 保密"), listOf("m", "f", "x").indexOf(g)) { i -> g = listOf("m", "f", "x")[i]; paintCovers() }, 8)
        c.add(Toggle(a, "改了性别顺便换成对应的配色", "", pal) { pal = it }, 6)
        c.add(a.text("主页封面", 14f, C.text, SEMI), 12)
        paintCovers()
        c.add(android.widget.HorizontalScrollView(a).apply { isHorizontalScrollBarEnabled = false; addView(covers) }, 8)
        c.add(a.text("个性签名（最多 60 字）", 14f, C.text, SEMI), 14)
        val bio = a.input("比如：今日事今日毕 ✨", bio0).apply { filters = arrayOf(android.text.InputFilter.LengthFilter(60)) }
        c.add(bio, 8)
        val err = a.text("", 13f, C.red).apply { visibility = View.GONE }; c.add(err, 8)
        var busy = false
        c.add(a.button("保存") {
            if (busy) return@button; busy = true
            val args = jsonOf("p_gender" to g, "p_bio" to bio.text.toString().trim()); if (cover.isNotEmpty()) args.put("p_cover", cover)
            Bg.load({ Api.rpcObj("profile_update", args) }) { r, e ->
                busy = false
                if (r == null) { err.text = "保存失败：" + (e?.message ?: ""); err.visibility = View.VISIBLE; return@load }
                Store.me?.let { m -> m.put("gender", r.str("gender")); m.put("bio", r.str("bio")); m.put("cover", r.str("cover")) }
                if ((g == "m" || g == "f") && g != g0 && pal) {
                    Kv.set("ui_palette_v1", if (g == "f") jsonOf("id" to "sakura", "p" to "#ff5f8f", "s" to "#ffb03b") else jsonOf("id" to "navy", "p" to "#2457d6", "s" to "#ffb020"))
                    Bg.later(300) { a.recreate() }
                }
                Dialogs.hideKeyboard(c); d.dismiss(); a.toast("已保存"); done()
            }
        }, 12)
        d = Dialogs.show(a, android.widget.ScrollView(a).apply { addView(c) }, bottom = true)
    }
    private val Kv = com.laolao.classcalendar.core.Kv
}

/** 成长足迹热力图：最近 16 周，一列一周（周一到周日） */
class HeatMap(ctx: Context, private val days: JSONObject) : View(ctx) {
    private val p = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG)
    private val tp = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { color = C.sub; textSize = ctx.dp(10).toFloat() }
    override fun onDraw(c: android.graphics.Canvas) {
        val t = T.today(); val end = t.plusDays((7 - t.dayOfWeek.value).toLong()); val start = end.minusDays(16 * 7 - 1L)
        var max = 1; for (k in days.keys()) max = maxOf(max, days.optInt(k))
        val top = dp(14).toFloat(); val gap = dp(3).toFloat()
        val cell = minOf((width - 15 * gap) / 16f, (height - top - 6 * gap) / 7f)
        var lastM = -1
        for (col in 0 until 16) for (r in 0 until 7) {
            val d = start.plusDays(col * 7L + r)
            val x = col * (cell + gap); val y = top + r * (cell + gap)
            if (r == 0 && d.monthValue != lastM) { c.drawText("${d.monthValue}月", x, top - dp(4), tp); lastM = d.monthValue }
            val v = days.optInt(T.key(d))
            p.color = when { d.isAfter(t) -> C.alpha(C.line, 0.4f); v == 0 -> C.mutedBg; else -> C.alpha(C.green, 0.25f + 0.75f * minOf(4, Math.ceil(v * 4.0 / max).toInt()) / 4f) }
            c.drawRoundRect(x, y, x + cell, y + cell, cell * 0.25f, cell * 0.25f, p)
        }
    }
}

// =====================================================================
/** 已读名单：谁看过、谁还没看、谁完成了（发布人、老师、班委能看） */
class ViewersPage(a: Main, private val itemId: String, private val title: String) : Page(a) {
    private lateinit var body: LinearLayout
    private var all: List<JSONObject>? = null; private var err = ""; private var tab = 0
    override fun build(): View = scaffold("已读名单", pull = { done -> load { done() } }) { body = it }
    override fun onShow() { if (all == null) load() }
    private fun load(done: (() -> Unit)? = null) {
        val cid = Store.cls?.str("id") ?: return
        Bg.load({ (Api.rpc("item_viewers", jsonOf("cid" to cid, "iid" to itemId.toLong())) as? JSONArray)?.objs() ?: emptyList() }) { l, e -> done?.invoke(); if (l == null) err = e?.message ?: "加载失败" else all = l; render() }
    }
    override fun render() {
        view; keepScroll(body)
        body.addView(ctx.text(title, 17f, C.text, BOLD, 2))
        val l = all ?: run { body.add(ctx.text(err.ifEmpty { "加载中…" }, 14f, if (err.isNotEmpty()) C.red else C.sub), 14); return }
        val no = l.filter { it.str("seen_at").isEmpty() }; val seen = l.filter { it.str("seen_at").isNotEmpty() && !it.optBoolean("done") }; val done = l.filter { it.optBoolean("done") }
        body.add(ctx.text("共 ${l.size} 人 · ${l.size - no.size} 人看过", 13f, C.sub), 4)
        body.add(Seg(ctx, listOf("没看 ${no.size}", "看过 ${seen.size}", "完成 ${done.size}"), tab) { tab = it; render() }, 12)
        val cur = listOf(no, seen, done)[tab]
        if (cur.isEmpty()) { body.addView(ctx.empty("🎉", if (tab == 0) "全都看过了" else "暂时没有")); return }
        val c = ctx.card(4, 18).apply { margins(t = 12) }
        cur.forEachIndexed { i, x ->
            if (i > 0) c.addView(ctx.hline())
            val name = x.str("name").ifEmpty { x.str("account") }
            val r = ctx.row().apply { pad(14, 10) }
            r.addView(CK.avatar(ctx, name, 34), LinearLayout.LayoutParams(dp(34), dp(34)))
            r.addView(ctx.text(name + if (x.str("role") == "monitor") "（班委）" else "", 15f, C.text).apply { pad(12, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            if (x.str("seen_at").isNotEmpty()) r.addView(ctx.text(CK.ago(x.str("seen_at")), 12f, C.sub))
            c.addView(r)
        }
        body.addView(c)
        if (tab == 0) body.add(ctx.button("复制名单，去群里 @ 提醒") { CK.copy(ctx, no.joinToString(" ") { "@" + it.str("name").ifEmpty { it.str("account") } }, "已复制，去群里粘贴提醒") }, 14)
    }
}

// =====================================================================
/** 事项的附件：看图片、用别的 App 打开文档；老师、班委、发布人（自己的事项是自己）可以加、删（每块 600KB 分块上传下载） */
class FilesPage(a: Main, private val key: String) : Page(a) {
    private lateinit var body: LinearLayout
    private var list: List<JSONObject>? = null; private var err = ""; private var status = ""; private var busy = false
    private val CH = 600 * 1024
    override val autoRender = false
    override fun build(): View = scaffold("附件") { body = it }
    override fun onShow() { if (list == null) load() }
    private val cid: String? get() = if (key.startsWith("c")) Store.cls?.str("id") else null
    private val itemRef: String get() = if (key.startsWith("c")) key.substring(1) else key
    private fun canWrite(): Boolean { val r = Items.find(key) ?: return false; if (r.mine) return true; return Store.can("can_edit") || Store.items.any { it.opt("id").toString() == r.id && it.str("created_by") == Api.uid } }
    private fun load() {
        Bg.load({ (Api.rpc("file_list", jsonOf("cid" to cid, "item" to itemRef)) as? JSONArray)?.objs() ?: emptyList() }) { l, e -> if (l == null) err = e?.message ?: "加载失败" else { list = l; err = "" }; render() }
    }
    override fun render() {
        view; keepScroll(body)
        val r = Items.find(key)
        body.addView(ctx.text(r?.title ?: "附件", 17f, C.text, BOLD, 2))
        body.add(ctx.text(if (cid != null) "全班都能看到" else "只有你自己能看到", 12.5f, C.sub), 4)
        if (status.isNotEmpty()) body.add(ctx.text(status, 13f, C.accent).apply { bg(C.selected, 10); pad(12, 8) }, 10)
        if (err.isNotEmpty()) body.add(ctx.text(err, 13f, C.red), 10)
        val l = list ?: run { body.add(ctx.text("加载中…", 14f, C.sub), 14); return }
        if (l.isEmpty()) body.addView(ctx.empty("📎", "还没有附件", if (canWrite()) "可以加图片、PDF、Word、Excel、PPT，单个最多 20MB" else ""))
        else {
            val c = ctx.card(4, 18).apply { margins(t = 12) }
            l.forEachIndexed { i, f ->
                if (i > 0) c.addView(ctx.hline())
                val m = f.str("mime")
                val icon = if (m.startsWith("image/")) "🖼" else if (m.contains("pdf")) "📕" else if (m.contains("word") || m.contains("document")) "📘" else if (m.contains("sheet") || m.contains("excel")) "📗" else if (m.contains("presentation") || m.contains("powerpoint")) "📙" else "📄"
                c.addView(ctx.cell(icon, f.str("name"), Media.size(f.optLong("size")) + if (f.str("by_name").isNotEmpty()) " · " + f.str("by_name") else "", "打开") { open(f) }.apply {
                    setOnLongClickListener { if (canWrite()) Dialogs.confirm(ctx, "删除附件「${f.str("name")}」？", "", "删除", danger = true) { Bg.load({ Api.rpc("file_del", jsonOf("fid" to f.str("id"))) }) { _, e -> if (e != null) a.toast(e.message ?: "") else { a.toast("已删除"); load() } } }; true }
                })
            }
            body.addView(c)
            if (canWrite()) body.add(ctx.text("长按附件可以删除", 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 8)
        }
        if (canWrite()) body.add(ctx.button(if (busy) "正在上传…" else "📎 添加图片 / 文件") { if (!busy) Media.pickFiles(a) { us -> upload(us) } }, 16)
    }
    private fun upload(us: List<Uri>) {
        if (us.isEmpty()) return
        busy = true; render()
        Bg.run {
            var ok = 0
            for (u in us) {
                val name = Media.name(ctx, u).let { if (it == "文件" || !it.contains('.')) "图片${T.todayKey().replace("-", "")}_${System.currentTimeMillis() % 10000}.jpg" else it }
                fun say(s: String) = Bg.ui { status = s; render() }
                try {
                    val isImg = Media.mimeOf(name).startsWith("image/") || ctx.contentResolver.getType(u)?.startsWith("image/") == true
                    val buf = if (isImg && !name.endsWith(".gif")) Media.jpeg(ctx, u, 2400, 85) else Media.bytes(ctx, u)
                    if (buf.size > 20 * 1024 * 1024) { say("「$name」太大了（单个最多 20MB）"); continue }
                    val n = maxOf(1, (buf.size + CH - 1) / CH)
                    say("正在上传「$name」…")
                    val fname = if (isImg && !name.lowercase().matches(Regex(".*\\.(jpe?g)$"))) name.substringBeforeLast('.') + ".jpg" else name
                    val id = Api.rpcObj("file_begin", jsonOf("cid" to cid, "item" to itemRef, "fname" to fname, "fmime" to Media.mimeOf(fname), "fsize" to buf.size, "nparts" to n)).str("id")
                    for (i in 0 until n) {
                        Api.rpc("file_part", jsonOf("fid" to id, "n" to i, "b64" to android.util.Base64.encodeToString(buf.copyOfRange(i * CH, minOf(buf.size, (i + 1) * CH)), android.util.Base64.NO_WRAP)))
                        say("正在上传「$fname」… ${(i + 1) * 100 / n}%")
                    }
                    Api.rpc("file_end", jsonOf("fid" to id))
                    if (isImg) try { Api.rpc("file_thumb", jsonOf("fid" to id, "b64" to android.util.Base64.encodeToString(Media.jpeg(ctx, u, 360, 55), android.util.Base64.NO_WRAP))) } catch (_: Exception) {}
                    ok++; say("「$fname」上传好了 ✓")
                } catch (e: Exception) { say("「$name」上传失败：" + e.message) }
            }
            Bg.ui { busy = false; if (ok > 0) load() else render() }
        }
    }
    private val cache = HashMap<String, File>()
    private fun open(f: JSONObject) {
        a.toast("正在打开…")
        Bg.load({
            cache[f.str("id")]?.takeIf { it.exists() } ?: run {
                val out = java.io.ByteArrayOutputStream()
                for (i in 0 until maxOf(1, f.optInt("parts"))) {
                    var r = Api.rpc("file_get", jsonOf("fid" to f.str("id"), "n" to i))
                    if (r is JSONArray) r = r.opt(0)
                    if (r is JSONObject && !r.has("data") && r.has("file_get")) r = r.opt("file_get")
                    val b64 = (if (r is String) r else (r as? JSONObject)?.let { it.optString("data").ifEmpty { it.optString("b64") } }) ?: ""
                    if (b64.isEmpty()) throw ApiError(0, "附件第 ${i + 1} 段没有下载到，请重试")
                    out.write(android.util.Base64.decode(b64.replace(Regex("[^A-Za-z0-9+/=]"), ""), android.util.Base64.DEFAULT))
                }
                if (out.size() == 0) throw ApiError(0, "附件是空的，请上传者重新上传")
                val dir = File(ctx.cacheDir, "att").apply { mkdirs() }
                val file = File(dir, f.str("id").take(8) + "_" + f.str("name").replace(Regex("[\\\\/:*?\"<>|\\s]+"), "_"))
                file.writeBytes(out.toByteArray()); cache[f.str("id")] = file; file
            }
        }) { file, e ->
            if (file == null) { Dialogs.alert(ctx, "打开失败", e?.message ?: ""); return@load }
            val mime = f.str("mime").ifEmpty { Media.mimeOf(f.str("name")) }
            if (mime.startsWith("image/")) Media.preview(a, "data:" + mime + ";base64," + android.util.Base64.encodeToString(file.readBytes(), android.util.Base64.NO_WRAP))
            else Media.open(a, file, mime)
        }
    }
}
private typealias Uri = android.net.Uri

// =====================================================================
/** 整理群消息：粘贴或截图识别，交给云端 AI 整理成班级事项；没有整理权限的同学整理成「我的事项」 */
class IngestPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var input: EditText? = null
    private var status = ""; private var bad = false; private var busy = ""
    override val autoRender = false
    override fun build(): View = scaffold("整理群消息") { body = it }
    private val personal: Boolean get() = !Store.can("can_ingest")
    override fun render() {
        view; keepScroll(body)
        if (CK.gate(this, body)) return
        val text = input?.text?.toString() ?: ""
        val cloud = !personal && Store.feat("ingest_cloud")
        body.addView(ctx.text(if (personal) "整理到你自己的「我的事项」，只有你自己看得到" else "交给 AI 整理成「${Store.cls!!.str("name")}」的班级事项，全班都能看到", 13.5f, C.sub).apply { pad(4, 0, 4, 10) })
        val inp = ctx.input("把群里的消息粘贴到这里（可以一次贴很多条）", text, multi = true).apply { minLines = 8; maxLines = 16 }
        input = inp; body.addView(inp)
        val r = ctx.row().apply { margins(t = 10) }
        r.addView(ctx.soft("📋 粘贴") {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val s = cm.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString() ?: ""
            if (s.isBlank()) a.toast("剪贴板是空的") else inp.setText((inp.text.toString().trim() + "\n\n" + s).trim())
        }, LinearLayout.LayoutParams(0, dp(42), 1f))
        r.addView(ctx.soft(if (busy == "ocr") "识别中…" else "📷 截图识别") { if (busy.isEmpty()) Media.pickImages(a, true) { ocr(it) } }, LinearLayout.LayoutParams(0, dp(42), 1f).apply { leftMargin = dp(10) })
        body.addView(r)
        if (status.isNotEmpty()) body.add(ctx.text(status, 13.5f, if (bad) C.red else C.accent).apply { bg(if (bad) C.dangerBg else C.selected, 10); pad(12, 8) }, 12)
        if (cloud) body.add(ctx.button(if (busy == "cloud") "AI 正在整理…" else "✨ 交给 AI 整理成班级事项") { cloudRun() }, 14)
        body.add(ctx.button(if (cloud) "先在手机上拆一拆，自己确认" else "拆成待办，自己确认", if (cloud) C.selected else C.accent, if (cloud) C.accent else Color.WHITE) {
            val t = inp.text.toString().trim(); if (t.isEmpty()) { say("先粘贴群消息", true); return@button }
            a.push(MemoPage(a, t))
        }, 10)
        body.add(ctx.text("截图识别要联网，AI 整理大约半分钟到一分钟。整理好的事项会出现在首页和日历里。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 12)
    }
    private fun say(s: String, b: Boolean = false) { status = s; bad = b; render() }
    private fun ocr(us: List<Uri>) {
        if (us.isEmpty()) return
        busy = "ocr"; say("正在识别 ${us.size} 张截图…")
        Bg.run {
            val got = mutableListOf<String>(); var lastErr = ""
            us.forEachIndexed { i, u ->
                try {
                    val b64 = android.util.Base64.encodeToString(Media.jpeg(ctx, u, 1800, 85), android.util.Base64.NO_WRAP)
                    val j = Api.rpcObj("chat_ocr_start", jsonOf("img" to b64)); val t0 = System.currentTimeMillis()
                    while (System.currentTimeMillis() - t0 < 150_000) {
                        Thread.sleep(1200)
                        val r = try { Api.rpcObj("course_ocr_status", jsonOf("jid" to j.str("job_id"))) } catch (_: Exception) { null } ?: continue
                        if (r.str("status") == "done") { val t = r.optJSONObject("result")?.optString("text") ?: ""; if (t.isNotBlank()) got += t.trim(); break }
                        if (r.str("status") == "failed") throw ApiError(0, r.str("message").ifEmpty { "识别失败" })
                        Bg.ui { say("正在识别第 ${i + 1}/${us.size} 张截图… ${r.optInt("progress")}%") }
                    }
                } catch (e: Exception) { lastErr = if (Regex("chat_ocr|PGRST202|Could not find").containsMatchIn(e.message ?: "")) "后台还没升级，暂时不能识别截图" else (e.message ?: "") }
            }
            Bg.ui {
                busy = ""
                if (got.isEmpty()) say(if (lastErr.isNotEmpty()) "没认出来：$lastErr" else "没认出文字，换一张清晰些的截图试试", true)
                else { input?.setText(((input?.text?.toString()?.trim() ?: "") + "\n\n" + got.joinToString("\n\n")).trim().take(8000)); say("认出 ${got.joinToString("\n").lines().count { it.isNotBlank() }} 行文字，检查一下再整理") }
            }
        }
    }
    private fun cloudRun() {
        val text = input?.text?.toString()?.trim() ?: ""
        if (busy.isNotEmpty()) return
        if (text.isEmpty()) { say("先粘贴群消息", true); return }
        busy = "cloud"; say("已提交，AI 正在整理，大约需要半分钟到一分钟…")
        val cid = Store.cls!!.str("id")
        Bg.run {
            try {
                val job = Api.rpcObj("ingest_class_messages", jsonOf("cid" to cid, "msg" to text, "pub_date" to T.todayKey()))
                val t0 = System.currentTimeMillis(); var res: JSONObject? = null
                while (System.currentTimeMillis() - t0 < 450_000) {
                    Thread.sleep(3000)
                    val s = Api.rpcObj("ingest_job_status", jsonOf("jid" to job.str("job_id")))
                    if (s.str("status") == "done") { res = s; break }
                    if (s.str("status") == "failed") throw ApiError(0, s.str("message").ifEmpty { "整理失败" })
                    val sec = (System.currentTimeMillis() - t0) / 1000
                    Bg.ui { status = "AI 正在整理，已等待 $sec 秒…"; render() }
                }
                if (res == null) throw ApiError(0, "等太久了，稍后下拉刷新看看是否已加入日历")
                try { Store.loadItems() } catch (_: Exception) {}
                val added = res.optInt("added")
                Bg.ui { busy = ""; input?.setText(""); say(if (added > 0) "整理完成，新增 $added 条事项 ✓" else "整理完成，没有发现需要记录的事项") }
            } catch (e: Exception) { Bg.ui { busy = ""; say("整理失败：" + e.message, true) } }
        }
    }
}

// =====================================================================
/** 班级管理（老师 / 管理者）：审批入班、成员和班委权限、本班功能开关、班级码、昵称口号 */
class ClassManagePage(a: Main, private val cid: String) : Page(a) {
    private lateinit var body: LinearLayout
    private var roster: List<JSONObject>? = null; private var feats: List<JSONObject>? = null; private var mce: Boolean? = null; private var err = ""
    override val autoRender = false
    private val PERMS = listOf(Triple("can_edit", "增改事项", "发布、修改班级事项，给班级起昵称"), Triple("can_delete", "删除事项", "删掉发错的班级事项"),
        Triple("can_ingest", "AI 整理", "把群消息整理成班级事项"), Triple("can_view_members", "看成员名单", "查看本班已入班的同学"))
    private val cls: JSONObject? get() = Store.classes.firstOrNull { it.str("id") == cid }
    override fun build(): View = scaffold("班级管理", pull = { done -> load { done() } }) { body = it }
    override fun onShow() { if (roster == null) load() }
    private fun load(done: (() -> Unit)? = null) {
        Bg.load({
            val r = (Api.rpc("class_roster", jsonOf("cid" to cid)) as? JSONArray)?.objs() ?: emptyList()
            val f = try { (Api.rpc("class_features_get", jsonOf("cid" to cid)) as? JSONArray)?.objs() } catch (_: Exception) { null }
            val m = try { (Api.rest("classes?select=id,members_can_edit&id=eq.$cid") as? JSONArray)?.optJSONObject(0)?.let { if (it.has("members_can_edit")) it.optBoolean("members_can_edit") else null } } catch (_: Exception) { null }
            Triple(r, f, m)
        }) { r, e -> done?.invoke(); if (r == null) err = e?.message ?: "加载失败" else { roster = r.first; feats = r.second; mce = r.third; err = "" }; render() }
    }
    private fun after(msg: String) { a.toast(msg); Bg.load({ Store.refresh() }) { _, _ -> load() } }
    override fun render() {
        view; keepScroll(body)
        val c = cls ?: run { body.addView(ctx.empty("🏫", "找不到这个班级")); return }
        // 班级卡
        val hc = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(20, 18) }
        hc.addView(ctx.text(c.str("name") + if (c.str("nickname").isNotEmpty()) "（${c.str("nickname")}）" else "", 19f, C.heroText, HEAVY))
        if (c.str("motto").isNotEmpty()) hc.add(ctx.text("“${c.str("motto")}”", 13f, C.sub), 4)
        hc.add(ctx.text("班级码", 12f, C.sub), 12)
        hc.addView(ctx.text(c.str("code"), 30f, C.accent, HEAVY).apply { letterSpacing = 0.2f })
        val br = ctx.row().apply { margins(t = 10) }
        br.addView(ctx.soft("复制班级码") { CK.copy(ctx, c.str("code"), "班级码 ${c.str("code")} 已复制") }, LinearLayout.LayoutParams(0, dp(38), 1f))
        br.addView(ctx.soft("复制邀请语") { CK.copy(ctx, "请用「捞捞课程表」加入「${c.str("name")}」：下载安卓 App 或打开微信小程序 / 网页版注册（选“学生”，填真实姓名），在「我的 → 班级」输入班级码 ${c.str("code")} 申请加入。", "邀请语已复制，发到班群就行") }, LinearLayout.LayoutParams(0, dp(38), 1f).apply { leftMargin = dp(8) })
        hc.addView(br)
        val br2 = ctx.row().apply { margins(t = 8) }
        br2.addView(ctx.soft("起昵称 / 口号") { identity(c) }, LinearLayout.LayoutParams(0, dp(38), 1f))
        br2.addView(ctx.soft("换一个班级码", C.mutedBg, C.sub) {
            Dialogs.confirm(ctx, "重新生成班级码？", "旧班级码立即失效；已入班的同学不受影响。", "重新生成") {
                Bg.load({ Api.rpc("regenerate_class_code", jsonOf("cid" to cid)) }) { r, e -> if (e != null) a.toast("没成功：" + e.message) else after("新班级码 $r") }
            }
        }, LinearLayout.LayoutParams(0, dp(38), 1f).apply { leftMargin = dp(8) })
        hc.addView(br2)
        body.addView(hc)
        if (err.isNotEmpty()) body.add(ctx.text(err, 13f, C.red), 10)
        val r = roster ?: run { body.add(ctx.text("加载中…", 14f, C.sub), 14); return }
        // 待审批
        val pend = r.filter { it.str("status") == "pending" }
        if (pend.isNotEmpty()) {
            body.addView(ctx.section("等你批准", "${pend.size} 人", C.red))
            val pc = ctx.card(4, 18)
            pend.forEachIndexed { i, m ->
                if (i > 0) pc.addView(ctx.hline())
                val row = ctx.row().apply { pad(14, 10) }
                row.addView(CK.avatar(ctx, m.str("name"), 36), LinearLayout.LayoutParams(dp(36), dp(36)))
                val cc = ctx.col().apply { pad(10, 0) }
                cc.addView(ctx.text(m.str("name"), 15f, C.text, SEMI, 1)); cc.addView(ctx.text("@" + m.str("account"), 12f, C.sub, lines = 1))
                row.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
                row.addView(ctx.text("拒绝", 13.5f, C.red, SEMI).apply { pad(12, 7); press(C.dangerBg, 10); tap { Dialogs.confirm(ctx, "拒绝 ${m.str("name")} 的申请？", "", "拒绝", danger = true) { review(m, false) } } })
                row.addView(ctx.text("批准", 13.5f, Color.WHITE, BOLD).apply { pad(14, 7); press(C.accent, 10); tap { review(m, true) } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
                pc.addView(row)
            }
            body.addView(pc)
            if (pend.size > 1) body.add(ctx.button("全部批准（${pend.size} 人）") {
                Dialogs.confirm(ctx, "批准全部 ${pend.size} 个申请？", "", "全部批准") {
                    Bg.load({ var n = 0; var er = ""; for (m in pend) try { Api.rpc("review_member", jsonOf("cid" to cid, "uid" to m.str("user_id"), "approve" to true)); n++ } catch (e: Exception) { er = e.message ?: "" }; n to er }) { x, _ ->
                        after(if (x?.second?.isNotEmpty() == true) "批准了 ${x.first} 个，有的没成功：${x.second}" else "已批准 ${x?.first} 位同学")
                    }
                }
            }, 10)
        }
        // 成员
        val ok = r.filter { it.str("status") == "approved" }
        body.addView(ctx.section("成员", "${ok.size} 人 · 班委 ${ok.count { it.str("member_role") == "monitor" }} 人"))
        if (ok.isEmpty()) body.addView(ctx.text("还没有同学入班，把班级码发到班群吧", 13.5f, C.sub).apply { bg(C.card, 14, C.line); pad(14, 14) })
        else {
            val mc = ctx.card(4, 18)
            ok.sortedWith(compareBy({ it.str("member_role") != "monitor" }, { it.str("name") })).forEachIndexed { i, m ->
                if (i > 0) mc.addView(ctx.hline())
                val mon = m.str("member_role") == "monitor"
                val perms = PERMS.filter { m.optBoolean(it.first) }.joinToString(" · ") { it.second }
                val row = ctx.row().apply { pad(14, 10); press(0, 14); tap { member(m) } }
                row.addView(CK.avatar(ctx, m.str("name"), 36), LinearLayout.LayoutParams(dp(36), dp(36)))
                val cc = ctx.col().apply { pad(10, 0) }
                cc.addView(ctx.text(m.str("name") + if (mon) "  · 班委" else "", 15f, C.text, SEMI, 1))
                cc.addView(ctx.text(if (mon) perms.ifEmpty { "还没开权限" } else "@" + m.str("account"), 12f, if (mon) C.accent else C.sub, lines = 1))
                row.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f)); row.addView(ctx.text("›", 18f, C.mutedText))
                mc.addView(row)
            }
            body.addView(mc)
        }
        // 全班可改事项
        mce?.let { on ->
            body.add(Toggle(ctx, "全班同学都能添加、修改事项", "关掉后只有你、班委和组长能改", on) { v ->
                Bg.load({ Api.rpc("class_set_members_can_edit", jsonOf("cid" to cid, "p_on" to v)) }) { _, e -> if (e != null) { a.toast("没成功：" + e.message); render() } else { mce = v; a.toast(if (v) "已打开" else "已关闭") } }
            }.apply { bg(C.card, 16, C.line); pad(14, 8) }, 14)
        }
        // 本班功能开关
        val f = feats
        if (f != null && f.isNotEmpty()) {
            body.addView(ctx.section("本班功能开关", "决定学生、班委能用哪些功能"))
            val fc = ctx.card(14, 18)
            f.forEachIndexed { i, x ->
                if (i > 0) fc.add(ctx.hline(), 10)
                fc.add(ctx.text(x.str("name") + if (!x.optBoolean("site_on", true)) "（全站暂停：${x.str("site_note")}）" else "", 15f, C.text, SEMI), if (i > 0) 10 else 0)
                if (x.str("descr").isNotEmpty()) fc.addView(ctx.text(x.str("descr"), 12f, C.sub))
                val tr = ctx.row().apply { margins(t = 6) }
                if (x.optBoolean("student_ok")) tr.addView(Toggle(ctx, "学生", "", x.optBoolean("student")) { v -> x.put("student", v); setFeat(x) }, LinearLayout.LayoutParams(0, WRAP, 1f))
                tr.addView(Toggle(ctx, "班委", "", x.optBoolean("monitor")) { v -> x.put("monitor", v); setFeat(x) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (tr.childCount > 0) leftMargin = dp(12) })
                fc.addView(tr)
            }
            body.addView(fc)
        }
    }
    private fun review(m: JSONObject, ok: Boolean) {
        Bg.load({ Api.rpc("review_member", jsonOf("cid" to cid, "uid" to m.str("user_id"), "approve" to ok)) }) { _, e ->
            if (e != null) a.toast("没成功：" + e.message) else after(if (ok) "已批准，${m.str("name")} 现在能看到班级日历了" else "已拒绝")
        }
    }
    private fun setFeat(x: JSONObject) {
        Bg.load({ Api.rpc("class_set_feature", jsonOf("cid" to cid, "k" to x.str("key"), "stu" to if (x.optBoolean("student_ok")) x.optBoolean("student") else null, "mon" to x.optBoolean("monitor"))) }) { _, e ->
            if (e != null) { a.toast("没成功：" + e.message); load() } else a.toast("「${x.str("name")}」已保存")
        }
    }
    /** 成员：设班委、开权限、移出、看主页 */
    private fun member(m: JSONObject) {
        val mon = m.str("member_role") == "monitor"
        val opts = mutableListOf(if (mon) "设为普通学生" else "设为班委")
        if (mon) PERMS.forEach { opts += (if (m.optBoolean(it.first)) "✓ " else "○ ") + it.second + "（" + it.third + "）" }
        opts += "看 TA 的主页"; opts += "移出班级"
        Dialogs.sheet(ctx, m.str("name"), opts, danger = setOf(opts.size - 1)) { i ->
            val o = opts[i]
            when {
                o == "设为班委" -> saveMember(m, true, PERMS.associate { it.first to (it.first == "can_edit") })
                o == "设为普通学生" -> saveMember(m, false, emptyMap())
                o == "看 TA 的主页" -> a.push(UserPage(a, m.str("user_id")))
                o == "移出班级" -> Dialogs.confirm(ctx, "把 ${m.str("name")} 移出班级？", "TA 将看不到这个班的事项，需要的话可以重新申请加入。", "移出", danger = true) {
                    Bg.load({ Api.rest("class_members?class_id=eq.$cid&user_id=eq.${m.str("user_id")}", "DELETE") }) { _, e -> if (e != null) a.toast("没成功：" + e.message) else after("已把 ${m.str("name")} 移出班级") }
                }
                else -> { val p = PERMS[i - 1]; saveMember(m, true, PERMS.associate { it.first to if (it == p) !m.optBoolean(it.first) else m.optBoolean(it.first) }) }
            }
        }
    }
    private fun saveMember(m: JSONObject, mon: Boolean, p: Map<String, Boolean>) {
        Bg.load({ Api.rpc("set_member", jsonOf("cid" to cid, "uid" to m.str("user_id"), "mrole" to if (mon) "monitor" else "student", "p_ingest" to (p["can_ingest"] ?: false), "p_edit" to (p["can_edit"] ?: false), "p_delete" to (p["can_delete"] ?: false), "p_view" to (p["can_view_members"] ?: false))) }) { _, e ->
            if (e != null) a.toast("没成功：" + e.message) else { a.toast(if (mon) "${m.str("name")} 的班委权限已更新" else "${m.str("name")} 已设为普通学生"); load() }
        }
    }
    private val NICK_A = listOf("星河", "元气", "追光", "代码", "晨曦", "破晓", "极客", "向阳", "逐梦", "萤火", "满格", "满分", "不熬夜", "早八", "像素", "电波", "宇宙", "捞捞", "奔跑", "银河")
    private val NICK_B = listOf("小分队", "联盟", "研究所", "工作室", "战队", "俱乐部", "梦之队", "号", "补给站", "实验室", "特攻队", "大家庭")
    private val MOTTOS = listOf("今日事，今日毕", "早八不迟到，作业不拖延", "一起把日子过成想要的样子", "代码写得好，bug 跑不了", "不负韶华，不负自己", "每一个 ddl 都会被我们温柔地拿下")
    private fun identity(c: JSONObject) {
        val v = a.col().apply { pad(20, 18, 20, 18) }
        lateinit var d: android.app.Dialog
        v.addView(a.text("给班级起名字", 18f, C.text, BOLD))
        val name = a.input("正式名称", c.str("name")); val nick = a.input("昵称（比如 星河小分队）", c.str("nickname")); val motto = a.input("口号", c.str("motto"))
        v.add(name, 12)
        val nr = a.row().apply { margins(t = 10) }; nr.addView(nick, LinearLayout.LayoutParams(0, WRAP, 1f)); nr.addView(a.text("🎲", 22f).apply { pad(10, 0); tap { nick.setText(NICK_A.random() + NICK_B.random()) } }); v.addView(nr)
        val mr = a.row().apply { margins(t = 10) }; mr.addView(motto, LinearLayout.LayoutParams(0, WRAP, 1f)); mr.addView(a.text("🎲", 22f).apply { pad(10, 0); tap { motto.setText(MOTTOS.random()) } }); v.addView(mr)
        v.add(a.button("保存") {
            if (name.text.isBlank()) { a.toast("正式名称不能为空"); return@button }
            Bg.load({ Api.rpcObj("set_class_identity", jsonOf("cid" to cid, "cname" to name.text.toString().trim(), "nick" to nick.text.toString().trim(), "mot" to motto.text.toString().trim())) }) { r, e ->
                if (r == null) a.toast("保存失败：" + (e?.message ?: "")) else { Dialogs.hideKeyboard(v); d.dismiss(); after(if (r.str("nickname").isNotEmpty()) "以后大家都叫「${r.str("nickname")}」啦" else "已保存") }
            }
        }, 14)
        d = Dialogs.show(a, v, bottom = true)
    }
}
