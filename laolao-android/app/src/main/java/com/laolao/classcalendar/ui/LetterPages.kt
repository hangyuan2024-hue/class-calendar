package com.laolao.classcalendar.ui

import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject

/**
 * 7.7 信箱（和网页、电脑版同一套接口：7.7-mailbox.sql 的 letter_*）
 * - 站内信（7.7.1）：默认不开放；管理员打开后也只能写给同班同学和老师，每封先审后发
 * - 写给捞捞团队：举报、建议、开源合作、安全问题、其他
 * - 全程 HTTPS，服务器上加密保存；用户之间的信先审后发，被举报的信由管理员处理；至少保存 180 天
 */
object Letters {
    val KIND = linkedMapOf("report" to "举报", "suggest" to "建议", "opensource" to "开源合作", "security" to "安全问题", "other" to "其他", "user" to "私信")
    val TEAM_KINDS = listOf("report", "suggest", "opensource", "security", "other")
    val TIP = mapOf(
        "report" to "举报违法违规内容、骚扰、侵权等。请写清楚是哪里（班级、账号、页面）、什么时间、什么内容。",
        "suggest" to "功能建议、体验问题、发现的错误都可以。",
        "opensource" to "想参与开发、设计、文档，或者想在自己学校使用、二次开发。请说说你会什么、想做什么。",
        "security" to "发现安全漏洞请写在这里，不要公开发布。我们会尽快修复。",
        "other" to "其他想对捞捞团队说的话。")
    const val NOTICE = "🔒 信件全程加密传输（HTTPS），在服务器上加密保存。为遵守《网络安全法》等法律法规，用户之间的信先审后发、被举报的信由管理员处理，信件记录至少保存 180 天。请勿发送违法违规、侵犯他人权益或骚扰他人的内容。"
    fun who(o: JSONObject?): String {
        if (o == null) return ""
        val n = o.str("name"); val acc = o.str("account")
        return if (acc.isNotEmpty() && acc != n) "$n（$acc）" else n
    }
    fun err(e: Throwable?): String = (e?.message ?: "出错了").let {
        if (Regex("letter_|PGRST202|Could not find").containsMatchIn(it)) "服务器还没开通信箱（数据库要执行 7.7-mailbox.sql）" else it
    }
    fun ago(at: String): String = try { CK.ago(at) } catch (_: Exception) { at.take(16).replace('T', ' ') }
}

/** 信箱首页：收件箱 / 已发送 /（管理员）团队信箱、待审核 */
class LetterBoxPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var box = 0; private var admin = false
    private var unread: JSONObject = JSONObject()
    private val lists = HashMap<String, List<JSONObject>>(); private var err = ""
    override val autoRender = false
    private fun boxes() = if (admin) listOf("in" to "收件箱", "out" to "已发送", "team" to "团队信箱", "review" to "待审核") else listOf("in" to "收件箱", "out" to "已发送")
    override fun build(): View = scaffold("信箱", ctx.text("⚙", 20f, C.sub).apply { gravity = Gravity.CENTER; press(0, 20); tap { a.push(LetterSettingsPage(a)) } }
        .also { it.layoutParams = LinearLayout.LayoutParams(dp(44), dp(44)) }, pull = { done -> load { done() } }) { body = it }
    override fun onShow() { load() }
    private fun load(done: (() -> Unit)? = null) {
        Bg.load({
            val u = Api.rpcObj("letter_unread")
            val adm = u.has("team") && !u.isNull("team")
            val k = (if (adm) listOf("in", "out", "team", "review") else listOf("in", "out")).getOrElse(box) { "in" }
            Triple(u, adm, k to ((Api.rpc("letter_list", jsonOf("p_box" to k)) as? JSONArray)?.objs() ?: emptyList()))
        }) { r, e ->
            done?.invoke()
            if (r == null) err = Letters.err(e) else { unread = r.first; admin = r.second; lists[r.third.first] = r.third.second; err = "" }
            render()
        }
    }
    override fun render() {
        view; keepScroll(body)
        val b = boxes(); if (box >= b.size) box = 0
        body.add(ctx.button("✉️ 写信") { a.push(LetterComposePage(a, userOn = admin || unread.optBoolean("u"))) }, 4)
        body.add(Seg(ctx, b.map { (k, t) -> val n = unread.optInt(k); if (n > 0) "$t $n" else t }, box) { box = it; render(); load() }, 12)
        if (err.isNotEmpty()) { body.add(ctx.text(err, 14f, C.red), 14); return }
        val k = b[box].first
        val l = lists[k] ?: run { body.add(ctx.text("加载中…", 14f, C.sub), 14); return }
        if (l.isEmpty()) {
            body.add(ctx.empty(if (k == "review") "✅" else "📭", when (k) { "in" -> "还没有收到信"; "out" -> "还没写过信"; "team" -> "团队信箱是空的"; else -> "没有待审核的信" },
                if (k == "in") "有事想对捞捞团队说（举报、建议、开源合作），点上面「写信」" else ""), 12)
            return
        }
        val c = ctx.card(4, 18).apply { margins(t = 12) }
        l.forEachIndexed { i, x ->
            if (i > 0) c.addView(ctx.hline())
            val peer = if (k == "out") "写给 " + Letters.who(x.optJSONObject("to")) else Letters.who(x.optJSONObject("from"))
            val r = ctx.col().apply { pad(14, 12) }
            val h = ctx.row()
            val unreadDot = k == "in" && !x.optBoolean("read")
            h.addView(ctx.text((if (unreadDot) "● " else "") + peer, 14.5f, if (unreadDot) C.accent else C.text, BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
            h.addView(ctx.text(Letters.ago(x.str("at")), 12f, C.sub))
            r.addView(h)
            val tags = ctx.row().apply { margins(t = 4) }
            fun tag(s: String, col: Int) = tags.addView(ctx.chip(s, col, C.alpha(col, 0.12f), 11.5f).apply { pad(6, 1) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(6) })
            if (x.optBoolean("to_team") || x.str("kind") != "user") tag(Letters.KIND[x.str("kind")] ?: x.str("kind"), if (x.str("kind") == "report") C.red else C.accent)
            if (x.str("status") == "held") tag("审核中", C.c("#b45309"))
            if (x.str("status") == "removed") tag("已删除", C.red)
            if (x.optBoolean("reported")) tag("被举报", C.red)
            if (x.optBoolean("team_done")) tag("已处理", C.green)
            if (tags.childCount > 0) r.addView(tags)
            r.addView(ctx.text(x.str("subject").ifEmpty { "（无标题）" }, 15f, C.text, SEMI, 1).apply { margins(t = 4) })
            r.addView(ctx.text(x.str("snippet"), 13f, C.sub, lines = 1).apply { margins(t = 2) })
            r.press(0, 0); r.tap { a.push(LetterPage(a, x.optLong("id"))) }
            c.addView(r)
        }
        body.addView(c)
        body.add(ctx.text(Letters.NOTICE, 11.5f, C.mutedText), 14)
    }
}

/** 看一封信（和往来的回复） */
class LetterPage(a: Main, private val id: Long) : Page(a) {
    private lateinit var body: LinearLayout
    private var data: JSONObject? = null; private var err = ""
    override val autoRender = false
    override fun build(): View = scaffold("信", pull = { done -> load { done() } }) { body = it }
    override fun onShow() { load() }
    private fun load(done: (() -> Unit)? = null) {
        Bg.load({ Api.rpcObj("letter_get", jsonOf("p_id" to id)) }) { r, e -> done?.invoke(); if (r == null) err = Letters.err(e) else { data = r; err = "" }; render() }
    }
    private fun act(fn: String, args: JSONObject, ok: String, after: () -> Unit = { load() }) {
        Bg.load({ Api.rpc(fn, args) }) { _, e -> if (e != null) a.toast(Letters.err(e)) else { a.toast(ok); after() } }
    }
    private fun letterCard(x: JSONObject, cur: Boolean): View = ctx.card(16, 18).apply {
        margins(t = 10); if (!cur) alpha = 0.8f
        val h = ctx.row()
        h.addView(ctx.text(Letters.who(x.optJSONObject("from")) + if (x.optJSONObject("from")?.optBoolean("team") == true) " · 捞捞团队" else "", 14f, C.text, BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
        h.addView(ctx.text(Letters.ago(x.str("at")), 12f, C.sub))
        addView(h)
        addView(ctx.text("写给 " + Letters.who(x.optJSONObject("to")) + (if (x.str("kind") != "user") " · " + (Letters.KIND[x.str("kind")] ?: "") else "") +
            (if (x.str("status") == "held") " · 审核中" else "") + (if (x.str("flag").isNotEmpty()) "（${x.str("flag")}）" else ""), 12f, C.sub).apply { margins(t = 2) })
        if (x.str("subject").isNotEmpty()) addView(ctx.text(x.str("subject"), 17f, C.text, BOLD).apply { margins(t = 8) })
        addView(ctx.text(x.str("body"), 15f, C.text).apply { margins(t = 6); setTextIsSelectable(true) })
        if (x.str("report_reason").isNotEmpty()) addView(ctx.text("举报理由：" + x.str("report_reason"), 13f, C.red).apply { margins(t = 8) })
    }
    override fun render() {
        view; keepScroll(body)
        if (err.isNotEmpty()) { body.add(ctx.text(err, 14f, C.red), 14); return }
        val d = data ?: run { body.add(ctx.text("加载中…", 14f, C.sub), 14); return }
        val l = d.optJSONObject("letter") ?: return
        val admin = d.optBoolean("admin")
        val meId = com.laolao.classcalendar.core.Store.me?.str("id") ?: ""
        val from = l.optJSONObject("from"); val fromMe = from?.str("id") == meId
        (d.optJSONArray("thread")?.objs() ?: emptyList()).filter { it.optLong("id") < id }.forEach { body.addView(letterCard(it, false)) }
        body.addView(letterCard(l, true))
        (d.optJSONArray("thread")?.objs() ?: emptyList()).filter { it.optLong("id") > id }.forEach { body.addView(letterCard(it, false)) }

        val acts = ctx.row().apply { margins(t = 14) }
        fun btn(s: String, fg: Int = C.accent, fn: () -> Unit) = acts.addView(ctx.soft(s, if (fg == C.red) C.alpha(C.red, 0.1f) else C.selected, fg) { fn() }, LinearLayout.LayoutParams(0, dp(42), 1f).apply { rightMargin = dp(8) })
        val toMe = l.optJSONObject("to")?.str("id") == meId
        val canReply = !fromMe && from?.str("id")?.isNotEmpty() == true && l.str("status") == "ok" && (toMe || (admin && l.optBoolean("to_team")))
        if (canReply) btn(if (toMe) "回复" else "以团队身份回复") { a.push(LetterComposePage(a, replyTo = l)) }
        if (toMe && !fromMe) {
            btn("举报", C.red) { Dialogs.prompt(ctx, "举报这封信", "", "举报理由（必填），比如：骚扰、诈骗、违法内容") { why -> if (why.isNotEmpty()) act("letter_report", jsonOf("p_id" to id, "p_reason" to why), "已举报，管理员会处理") } }
            if (from?.str("account")?.isNotEmpty() == true) btn("拉黑") {
                Dialogs.confirm(ctx, "拉黑 ${Letters.who(from)}？", "拉黑后对方不能再给你写信，可以在信箱设置里取消。", "拉黑", true) { act("letter_block", jsonOf("p_account" to (from?.str("account") ?: ""), "p_on" to true), "已拉黑") } }
        }
        btn("删除", C.red) { Dialogs.confirm(ctx, "删除这封信？", "只从你这边删除。按规定平台会保留记录 180 天后再彻底清除。", "删除", true) { act("letter_delete", jsonOf("p_id" to id), "已删除") { close() } } }
        body.addView(acts)
        if (admin) {
            val ad = ctx.row().apply { margins(t = 10) }
            fun abtn(s: String, what: String, fg: Int = C.accent) = ad.addView(ctx.soft(s, if (fg == C.red) C.alpha(C.red, 0.1f) else C.selected, fg) { act("letter_admin_act", jsonOf("p_id" to id, "p_act" to what), "好了") }, LinearLayout.LayoutParams(0, dp(42), 1f).apply { rightMargin = dp(8) })
            if (l.optBoolean("to_team")) { if (l.optBoolean("team_done")) abtn("标为未处理", "undone") else abtn("标为已处理", "done") }
            if (l.str("status") == "held") { abtn("审核通过", "approve"); abtn("删除违规信", "remove", C.red) }
            if (l.optBoolean("reported") && l.str("status") == "ok") { abtn("举报不成立", "dismiss"); abtn("删除违规信", "remove", C.red) }
            if (ad.childCount > 0) body.addView(ad)
        }
        body.add(ctx.text("遇到骚扰、诈骗、违法内容，点「举报」，管理员会处理；「拉黑」后对方就不能再给你写信。", 12f, C.sub), 12)
    }
}

/** 写信：写给捞捞团队（举报、建议、开源合作、安全问题、其他）或其他用户（填账号） */
class LetterComposePage(a: Main, private val replyTo: JSONObject? = null, private val kind0: String = "suggest", private val userOn: Boolean = false) : Page(a) {
    private lateinit var body: LinearLayout
    private var toTeam = replyTo == null; private var kind = kind0
    private lateinit var acc: EditText; private lateinit var subj: EditText; private lateinit var text: EditText
    private var sending = false
    override val autoRender = false
    override fun build(): View = scaffold(if (replyTo != null) "回信" else "写信") { body = it }
    override fun onShow() { if (!::text.isInitialized) render() }
    override fun render() {
        view; body.removeAllViews()
        val keepAcc = if (::acc.isInitialized) acc.text.toString() else ""; val keepSubj = if (::subj.isInitialized) subj.text.toString() else ""; val keepText = if (::text.isInitialized) text.text.toString() else ""
        acc = ctx.input("对方的账号", keepAcc); subj = ctx.input("标题（可以不填，最多 80 字）", keepSubj.ifEmpty { replyTo?.str("subject")?.takeIf { it.isNotEmpty() }?.let { if (it.startsWith("回复：")) it else "回复：$it" }?.take(80) ?: "" })
        text = ctx.input("写下你想说的…（最多 5000 字）", keepText, multi = true).apply { minLines = 8 }
        if (replyTo != null) {
            body.add(ctx.text("回复 " + Letters.who(replyTo.optJSONObject("from")), 14f, C.sub), 4)
        } else {
            if (!userOn) toTeam = true
            if (userOn) body.add(Seg(ctx, listOf("写给捞捞团队", "写给同学 / 老师"), if (toTeam) 0 else 1) { toTeam = it == 0; render() }, 4)
            else body.add(ctx.text("写给捞捞团队", 16f, C.text, BOLD), 4)
            if (toTeam) {
                val ks = Letters.TEAM_KINDS
                val kc = ctx.card(4, 18).apply { margins(t = 12) }
                kc.addView(ctx.cell("🏷", "类型：" + (Letters.KIND[kind] ?: kind), "", "更换 ›") { Dialogs.sheet(ctx, "写信给捞捞团队：选类型", ks.map { Letters.KIND[it] ?: it }) { i -> kind = ks[i]; render() } })
                body.addView(kc)
                body.add(ctx.text(Letters.TIP[kind] ?: "", 13f, C.sub), 8)
            } else {
                body.add(acc, 12)
                body.add(ctx.text("只能写给同班同学和老师。为了防止骚扰和违规信息，每封信都要先经过管理员审核，通过后对方才会收到。", 12f, C.sub), 6)
            }
        }
        body.add(subj, 12)
        body.add(text, 10)
        body.add(ctx.button(if (sending) "发送中…" else "发送") { send() }, 16)
        body.add(ctx.text(Letters.NOTICE, 11.5f, C.mutedText), 14)
    }
    private fun send() {
        if (sending) return
        val b = text.text.toString().trim(); val s = subj.text.toString().trim()
        if (b.isEmpty()) { a.toast("内容不能为空"); return }
        if (b.length > 5000) { a.toast("内容最多 5000 字"); return }
        val to = when { replyTo != null -> ""; toTeam -> "team"; else -> acc.text.toString().trim() }
        if (replyTo == null && to.isEmpty()) { a.toast("填一下对方的账号"); return }
        val k = if (replyTo != null) replyTo.str("kind").ifEmpty { "user" } else if (toTeam) kind else "user"
        sending = true; render()
        Bg.load({ Api.rpcObj("letter_send", jsonOf("p_to" to to, "p_kind" to k, "p_subject" to s, "p_body" to b, "p_reply" to replyTo?.optLong("id"))) }) { r, e ->
            sending = false
            if (r == null) { a.toast(Letters.err(e)); render(); return@load }
            Dialogs.hideKeyboard(text)
            if (r.str("msg").isNotEmpty()) Dialogs.alert(ctx, "已提交", r.str("msg")) else a.toast(if (to == "team") "已发送，我们会尽快回复你" else "已发送")
            close()
        }
    }
}

/** 信箱设置：谁可以给我写信、新信邮件提醒、黑名单；管理员：用户间写信开关、敏感词 */
class LetterSettingsPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var s: JSONObject? = null; private var words: List<JSONObject>? = null; private var err = ""
    override val autoRender = false
    override fun build(): View = scaffold("信箱设置") { body = it }
    override fun onShow() { load() }
    private fun load() {
        Bg.load({ val x = Api.rpcObj("letter_settings"); x to (if (x.optBoolean("admin")) (Api.rpc("letter_words") as? JSONArray)?.objs() else null) }) { r, e ->
            if (r == null) err = Letters.err(e) else { s = r.first; words = r.second; err = "" }; render()
        }
    }
    private fun save(fn: String, args: JSONObject) {
        Bg.load({ Api.rpc(fn, args) }) { r, e -> if (e != null) a.toast(Letters.err(e)) else { if (r is JSONObject && fn in setOf("letter_settings_set", "letter_block")) s = r; a.toast("已保存"); load() } }
    }
    override fun render() {
        view; keepScroll(body)
        if (err.isNotEmpty()) { body.add(ctx.text(err, 14f, C.red), 14); return }
        val x = s ?: run { body.add(ctx.text("加载中…", 14f, C.sub), 14); return }
        if (x.optBoolean("user_letters") || x.optBoolean("admin")) {
            body.addView(ctx.section("谁可以给我写信"))
            val opts = listOf("class" to "同班同学和老师（每封都经管理员审核）", "none" to "不接收（只收捞捞团队的回复和别人对我来信的回复）")
            body.addView(Seg(ctx, listOf("同班同学和老师", "不接收"), maxOf(0, opts.indexOfFirst { it.first == x.str("accept") })) { save("letter_settings_set", jsonOf("p_accept" to opts[it].first)) })
            body.add(ctx.text((opts.firstOrNull { it.first == x.str("accept") }?.second ?: "") + "。写信给捞捞团队不受这个限制。", 12.5f, C.sub), 6)
        } else {
            body.addView(ctx.section("信箱"))
            body.add(ctx.text("目前信箱只用于和捞捞团队联系（举报、建议、开源合作、安全问题），用户之间暂不开放写信。", 13f, C.sub), 2)
        }

        body.addView(ctx.section("新信提醒"))
        val mc = ctx.card(4, 18)
        if (x.str("email").isNotEmpty()) mc.addView(Toggle(ctx, "收到新信时发邮件提醒", "发到 ${x.str("email")}，邮件里不显示信的内容", x.optBoolean("notify", true)) { v -> save("letter_settings_set", jsonOf("p_notify" to v)) }.apply { pad(6, 6) })
        mc.addView(ctx.cell("📧", if (x.str("email").isNotEmpty()) "更换邮箱" else "绑定我的邮箱", if (x.str("email").isNotEmpty()) "已绑定 ${x.str("email")}" else "绑定后，收到新信、作业快截止等会发邮件提醒你") { a.push(MailPage(a)) })
        body.addView(mc)

        body.addView(ctx.section("黑名单"))
        val bl = x.optJSONArray("blocks")?.objs() ?: emptyList()
        if (bl.isEmpty()) body.add(ctx.text("没有拉黑任何人。在收到的信里点「拉黑」，对方就不能再给你写信。", 13f, C.sub), 2)
        else { val bc = ctx.card(4, 18); bl.forEachIndexed { i, b -> if (i > 0) bc.addView(ctx.hline()); bc.addView(ctx.cell("🚫", Letters.who(b), "", "取消拉黑") { save("letter_block", jsonOf("p_account" to b.str("account"), "p_on" to false)) }) }; body.addView(bc) }

        if (x.optBoolean("admin")) {
            body.addView(ctx.section("管理员"))
            val ac = ctx.card(4, 18)
            ac.addView(Toggle(ctx, "允许同班同学、老师之间写信", "默认关闭。开启后每封信都要你在「待审核」里通过才送达（先审后发）", x.optBoolean("user_letters", true)) { v -> save("letter_admin_switch", jsonOf("p_on" to v)) }.apply { pad(6, 6) })
            ac.addView(ctx.hline())
            val wm = listOf("review" to "先审后发（推荐）：学生发帖要老师审核通过才显示，学生暂不能评论", "off" to "只有老师能发帖和评论，学生只能看", "open" to "直接发布：发了马上显示，事后举报处理")
            val wi = maxOf(0, wm.indexOfFirst { it.first == x.str("wall_mode").ifEmpty { "review" } })
            ac.addView(ctx.col().apply {
                pad(14, 10)
                addView(ctx.text("班级墙和评论（全站）", 15f, C.text, SEMI))
                addView(Seg(ctx, listOf("先审后发", "只有老师", "直接发布"), wi) { i -> save("wall_mode_set", jsonOf("p_mode" to wm[i].first)) }.apply { margins(t = 8) })
                addView(ctx.text(wm[wi].second, 12.5f, C.sub).apply { margins(t = 6) })
            })
            ac.addView(ctx.hline())
            ac.addView(ctx.cell("➕", "添加敏感词", "「拦截」发不出去；「审核」先进待审核") {
                Dialogs.prompt(ctx, "添加敏感词", "", "词语") { w -> if (w.isNotEmpty()) Dialogs.sheet(ctx, "「$w」", listOf("拦截", "审核")) { i -> save("letter_words", jsonOf("p_word" to w, "p_level" to if (i == 0) "block" else "hold")) } }
            })
            body.addView(ac)
            val ws = words ?: emptyList()
            if (ws.isNotEmpty()) {
                val wc = ctx.card(4, 18).apply { margins(t = 10) }
                ws.forEachIndexed { i, w -> if (i > 0) wc.addView(ctx.hline()); wc.addView(ctx.cell("", w.str("word"), if (w.str("level") == "block") "拦截" else "审核", "删除") { save("letter_words", jsonOf("p_word" to w.str("word"), "p_level" to "delete")) }) }
                body.addView(wc)
            }
        }
        body.add(ctx.text(Letters.NOTICE, 11.5f, C.mutedText), 16)
    }
}
