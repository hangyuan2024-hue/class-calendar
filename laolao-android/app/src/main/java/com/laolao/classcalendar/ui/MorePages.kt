package com.laolao.classcalendar.ui

import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Cfg
import com.laolao.classcalendar.core.Island
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject

/** 邮箱通知：绑定邮箱（验证码）、按类型订阅、测试邮件、换邮箱 */
class MailPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var m: JSONObject? = null; private var err = ""; private var msg = ""; private var busy = ""
    private var addr = ""; private var code = ""
    override val autoRender = false
    private val KINDS = listOf(listOf("new_items", "📣", "班级发布新事项", "班委、老师发布作业和通知时"), listOf("due", "⏰", "作业截止前一晚提醒", "每天晚上 7 点后，明天要交还没勾完成的作业"),
        listOf("wall", "📌", "班级墙通知", "老师、班委在班级墙发的通知"), listOf("report", "🚩", "有人举报", "班级墙有新举报时（老师）"), listOf("course", "📚", "明天的课", "每天晚上 7 点后，把明天的课发给你"))
    companion object { var cooldown = 0L }
    override fun build(): View = scaffold("邮箱通知") { body = it }
    override fun onShow() { if (m == null) load() }
    private fun load() { Bg.load({ Api.rpcObj("mail_my") }) { r, e -> if (r == null) err = e?.message ?: "加载失败" else { m = r; err = "" }; render() } }
    private fun run(key: String, work: () -> Any?, ok: String) {
        if (busy.isNotEmpty()) return; busy = key; msg = ""; render()
        Bg.load(work) { r, e -> busy = ""; if (e != null) msg = "没成功：" + e.message else { (r as? JSONObject)?.let { m = it }; msg = ok }; render() }
    }
    override fun render() {
        view; keepScroll(body)
        if (!Store.feat("mail")) { body.addView(ctx.empty("⏸", "邮箱通知暂时关闭了", Store.feats.optJSONObject("mail")?.str("note") ?: "")); return }
        val x = m ?: run { body.add(ctx.text(err.ifEmpty { "加载中…" }, 14f, if (err.isNotEmpty()) C.red else C.sub), 10); return }
        body.addView(ctx.text("重要的事发到邮箱，不怕漏看群消息；绑定后忘记密码也能自己用邮箱找回。", 13.5f, C.sub).apply { pad(4, 0, 4, 10) })
        if (!x.optBoolean("configured")) { body.addView(ctx.empty("📭", "管理员还没开通邮件发送", "开通后就能绑定邮箱")); return }
        if (msg.isNotEmpty()) body.add(ctx.text(msg, 13.5f, if (msg.startsWith("没成功")) C.red else C.accent).apply { bg(if (msg.startsWith("没成功")) C.dangerBg else C.selected, 10); pad(12, 8) }, 4)
        if (x.str("email").isNotEmpty()) {
            val c = ctx.card(18, 20).apply { margins(t = 10) }
            c.addView(ctx.text("📧 " + x.str("email"), 17f, C.text, BOLD))
            c.add(ctx.text("✓ 已绑定", 13f, C.green, SEMI), 4)
            val r = ctx.row().apply { margins(t = 12) }
            r.addView(ctx.soft(if (busy == "test") "发送中…" else "发一封测试邮件") { run("test", { Api.rpcObj("mail_test") }, "测试邮件已交给发信服务，一两分钟内到") }, LinearLayout.LayoutParams(0, dp(40), 1f))
            r.addView(ctx.soft("解绑 / 换邮箱", C.dangerBg, C.red) {
                Dialogs.confirm(ctx, "解绑邮箱？", "解绑后不会再收到邮件，也不能用邮箱找回密码；可以重新绑定别的邮箱。", "解绑", danger = true) { run("unbind", { Api.rpcObj("mail_unbind") }, "已解绑，可以绑定新的邮箱") }
            }, LinearLayout.LayoutParams(0, dp(40), 1f).apply { leftMargin = dp(10) })
            c.addView(r); body.addView(c)
            body.addView(ctx.section("收哪些邮件"))
            val p = x.optJSONObject("prefs") ?: JSONObject()
            val kc = ctx.card(10, 18)
            KINDS.filter { (it[0] != "report" || x.optBoolean("is_teacher")) && (it[0] != "course" || Store.feat("courses")) }.forEachIndexed { i, k ->
                if (i > 0) kc.addView(ctx.hline())
                val on = if (k[0] == "course") p.optBoolean(k[0]) else p.opt(k[0]) != false
                kc.addView(Toggle(ctx, k[1] + " " + k[2], k[3], on) { v ->
                    Bg.load({ Api.rpcObj("mail_set_prefs", jsonOf("p" to jsonOf(k[0] to v))) }) { r, e -> if (r == null) { a.toast("保存失败：" + (e?.message ?: "")); render() } else { m = r; a.toast("已保存") } }
                }.apply { pad(6, 6) })
            }
            body.addView(kc)
            val recent = x.optJSONArray("recent")?.objs() ?: emptyList()
            if (recent.isNotEmpty()) {
                body.addView(ctx.section("最近发出的邮件"))
                val rc = ctx.card(4, 18)
                recent.forEachIndexed { i, y ->
                    if (i > 0) rc.addView(ctx.hline())
                    val st = when (y.str("status")) { "sent" -> "✓ 已发出"; "failed" -> "✗ 没发出去" + if (y.str("error").isNotEmpty()) "（${y.str("error")}）" else ""; else -> "发送中…" }
                    rc.addView(ctx.col().apply { pad(14, 10); addView(ctx.text(y.str("subject"), 14f, C.text, lines = 1)); addView(ctx.text(CK.ago(y.str("at")) + " · " + st, 12f, if (y.str("status") == "failed") C.red else C.sub)) })
                }
                body.addView(rc)
            }
        } else {
            val c = ctx.card(18, 20).apply { margins(t = 10) }
            c.addView(ctx.text("绑定邮箱", 17f, C.text, BOLD))
            val ad = ctx.input("比如 123456@qq.com", addr.ifEmpty { x.str("pending") }, type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS)
            c.add(ad, 12)
            val cd = maxOf(0L, (cooldown - System.currentTimeMillis()) / 1000)
            c.add(ctx.button(if (busy == "send") "发送中…" else if (cd > 0) "${cd} 秒后可以重发" else "发验证码", if (cd > 0) C.mutedBg else C.accent, if (cd > 0) C.sub else Color.WHITE) {
                if (cd > 0) return@button
                addr = ad.text.toString().trim()
                if (!Regex("^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$", RegexOption.IGNORE_CASE).matches(addr)) { msg = "没成功：邮箱格式不对，比如 123456@qq.com"; render(); return@button }
                run("send", { Api.rpc("mail_bind_start", jsonOf("addr" to addr)); cooldown = System.currentTimeMillis() + 60_000; Api.rpcObj("mail_my") }, "验证码已发送，去邮箱看看")
            }, 10)
            if (x.str("pending").isNotEmpty() || addr.isNotEmpty()) {
                val cc = ctx.input("6 位验证码", code, type = InputType.TYPE_CLASS_NUMBER).apply { filters = arrayOf(android.text.InputFilter.LengthFilter(6)) }
                c.add(cc, 14)
                c.add(ctx.button(if (busy == "confirm") "验证中…" else "确认绑定") {
                    code = cc.text.toString().trim()
                    if (!Regex("^\\d{6}$").matches(code)) { msg = "没成功：验证码是 6 位数字"; render(); return@button }
                    run("confirm", { val r = Api.rpcObj("mail_bind_confirm", jsonOf("c" to code)); if (r.has("ok") && !r.optBoolean("ok")) throw com.laolao.classcalendar.core.ApiError(0, r.str("why").ifEmpty { "验证码不对" }); code = ""; addr = ""; r }, "绑定成功 🎉 以后重要的事会发到这里")
                }, 10)
            }
            body.addView(c)
        }
    }
}

// =====================================================================
/** 班级成长排行榜：本周 / 本月 / 总榜，领奖台，我的名次，实名 / 匿名 / 不参加 */
class RankPage(a: Main, level: Boolean = false) : Page(a) {
    private lateinit var body: LinearLayout
    private var period = if (level) 3 else 0; private var d: JSONObject? = null; private var err = ""; private var synced = false
    private val PER = listOf("week", "month", "all", "level")
    override fun build(): View = scaffold("排行榜", pull = { done -> load { done() } }) { body = it }
    override fun onShow() { load() }
    private fun load(done: (() -> Unit)? = null) {
        val c = Store.cls ?: run { render(); done?.invoke(); return }
        val p = PER[period]
        Bg.load({
            if (!synced && !c.optBoolean("is_teacher")) {
                synced = true; val mk = Items.marks()
                val ids = Store.items.filter { mk.optJSONObject("c" + it.opt("id"))?.optBoolean("done") == true }.map { it.opt("id") }
                if (ids.isNotEmpty()) try { Api.rpc("growth_sync_done", jsonOf("cid" to c.str("id"), "ids" to JSONArray(ids))) } catch (_: Exception) {}
            }
            // 6.9 等级榜：账号总经验
            if (p == "level") com.laolao.classcalendar.core.Level.board(c.str("id")).put("_p", p)
            else Api.rpcObj("growth_board", jsonOf("cid" to c.str("id"), "period" to p)).put("_p", p)
        }) { r, e -> done?.invoke(); if (r == null) err = e?.message?.let { if (p == "level" && Regex("xp_board|PGRST202|Could not find").containsMatchIn(it)) "服务器还没升级（需要执行 level.sql）" else it } ?: "加载失败" else if (r.str("_p") == PER[period]) { d = r; err = "" }; render() }
    }
    private fun stat(r: JSONObject) = listOf(if (r.optInt("hw") > 0) "✓ 作业 ${r.optInt("hw")}" else "", if (r.optInt("done") - r.optInt("hw") > 0) "✓ 其它 ${r.optInt("done") - r.optInt("hw")}" else "",
        if (r.optInt("habits") > 0) "🔥 打卡 ${r.optInt("habits")}" else "", if (r.optInt("pomos") > 0) "🍅 ${r.optInt("pomos")}" else "").filter { it.isNotEmpty() }.joinToString(" · ").ifEmpty { "刚刚起步" }
    override fun render() {
        view; keepScroll(body)
        if (CK.gate(this, body)) return
        if (!Store.feat("rank")) { body.addView(ctx.empty("⏸", "排行榜现在关闭了")); return }
        body.addView(Seg(ctx, listOf("本周", "本月", "总榜", "⭐ 等级"), period) { period = it; d = null; err = ""; render(); load() })
        val x = d?.takeIf { it.str("_p") == PER[period] } ?: run { body.add(ctx.text(err.ifEmpty { "加载中…" }, 14f, if (err.isNotEmpty()) C.red else C.sub), 14); return }
        if (PER[period] == "level") { LevelUi.board(a, body, x); return }
        val rows = x.optJSONArray("rows")?.objs() ?: emptyList(); val cl = x.optJSONObject("class") ?: JSONObject()
        val P = listOf("本周", "本月", "总共")[period]
        // 班级概况
        val hc = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(20, 18); margins(t = 12) }
        hc.addView(ctx.text((Store.cls!!.str("nickname").ifEmpty { Store.cls!!.str("name") }) + " · ${P}成长值", 12.5f, C.sub, SEMI))
        hc.addView(ctx.text("${cl.optInt("points")}", 34f, C.heroText, HEAVY))
        val rate = if (cl.isNull("hw_rate")) -1 else cl.optInt("hw_rate")
        hc.addView(ctx.text((if (rate >= 0) "作业完成率 $rate% · " else "") + "${cl.optInt("active")}/${cl.optInt("members")} 人活跃", 13f, C.sub))
        body.addView(hc)
        if (rows.isEmpty()) { body.addView(ctx.empty("🏆", "${P}还没有人上榜", "完成一项作业、打个卡，就能攒成长值")); return }
        // 领奖台
        val pod = ctx.row().apply { gravity = Gravity.BOTTOM; margins(t = 16) }
        for ((idx, place) in listOf(1 to 2, 0 to 1, 2 to 3)) {
            val r = rows.getOrNull(idx)
            val col = ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL }
            if (r == null) col.addView(ctx.text("虚位以待", 12f, C.mutedText))
            else {
                val anon = r.optBoolean("anon") && !x.optBoolean("teacher") && !r.optBoolean("me")
                col.addView(ctx.text(listOf("🥇", "🥈", "🥉")[place - 1], 26f))
                col.addView(CK.avatar(ctx, r.str("name"), if (place == 1) 56 else 46, grey = anon), LinearLayout.LayoutParams(dp(if (place == 1) 56 else 46), dp(if (place == 1) 56 else 46)))
                col.addView(ctx.text(r.str("name") + if (r.optBoolean("me")) "（我）" else "", 13f, C.text, BOLD, 1).apply { gravity = Gravity.CENTER; margins(t = 4) })
                col.addView(ctx.text("${r.optInt("points")}", 15f, C.accent, HEAVY))
            }
            col.addView(View(ctx).apply { bg(C.alpha(C.accent, if (place == 1) 0.25f else 0.13f), 10) }, LinearLayout.LayoutParams(MATCH, dp(if (place == 1) 54 else if (place == 2) 38 else 26)).apply { topMargin = dp(6) })
            pod.addView(col, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(4); rightMargin = dp(4) })
        }
        body.addView(pod)
        // 名单
        if (rows.size > 3) {
            val top = maxOf(1, rows[0].optInt("points"))
            val lc = ctx.card(4, 18).apply { margins(t = 14) }
            rows.drop(3).forEachIndexed { i, r ->
                if (i > 0) lc.addView(ctx.hline())
                val anon = r.optBoolean("anon") && !x.optBoolean("teacher") && !r.optBoolean("me")
                val row = ctx.row().apply { pad(14, 10); if (r.optBoolean("me")) bg(C.selected, 14) }
                row.addView(ctx.text("${r.optInt("rank")}", 15f, C.sub, BOLD).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(28), WRAP))
                row.addView(CK.avatar(ctx, r.str("name"), 34, grey = anon), LinearLayout.LayoutParams(dp(34), dp(34)))
                val cc = ctx.col().apply { pad(10, 0) }
                cc.addView(ctx.text(r.str("name") + if (r.optBoolean("me")) "（我）" else "", 14.5f, C.text, SEMI, 1))
                cc.addView(ctx.text(stat(r), 11.5f, C.sub, lines = 1))
                val bar = FrameLayout(ctx).apply { bg(C.mutedBg, 3) }
                bar.addView(View(ctx).apply { bg(C.accent, 3) }, FrameLayout.LayoutParams(0, MATCH))
                cc.addView(bar, LinearLayout.LayoutParams(MATCH, dp(5)).apply { topMargin = dp(4) })
                bar.post { bar.getChildAt(0).layoutParams = bar.getChildAt(0).layoutParams.apply { width = maxOf(dp(4), bar.width * r.optInt("points") / top) }; bar.requestLayout() }
                row.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
                row.addView(ctx.text("${r.optInt("points")}", 15f, C.text, HEAVY))
                lc.addView(row)
            }
            body.addView(lc)
        }
        // 我的名次 + 设置
        if (x.optBoolean("member")) {
            val mine = rows.firstOrNull { it.optBoolean("me") }
            val mc = ctx.card(16, 18).apply { margins(t = 14) }
            mc.addView(ctx.text(when { x.str("my_mode") == "off" -> "你没有参加排行，成长值照样会记着"; mine != null -> "我：第 ${mine.optInt("rank")} 名 · ${mine.optInt("points")} 成长值"; else -> "你${P}还没有攒成长值，完成一项作业试试？" }, 15f, C.text, BOLD))
            if (mine != null) mc.addView(ctx.text(stat(mine), 12.5f, C.sub).apply { margins(t = 2) })
            mc.add(ctx.text("在排行榜上怎么显示我", 12.5f, C.sub), 12)
            val modes = listOf("show", "anon", "off")
            mc.add(Seg(ctx, listOf("实名", "匿名", "不参加"), maxOf(0, modes.indexOf(x.str("my_mode").ifEmpty { "show" }))) { i ->
                Bg.load({ Api.rpc("rank_set_pref", jsonOf("cid" to Store.cls!!.str("id"), "m" to modes[i])) }) { _, e ->
                    if (e != null) Dialogs.alert(ctx, "设置失败", e.message ?: "") else { a.toast(listOf("已改成实名上榜", "已改成匿名，同学看到的是「匿名同学」", "已退出排行，成长值照样会记着")[i]); load() }
                }
            }, 6)
            body.addView(mc)
        }
        body.add(ctx.text("成长值：完成作业 +10，完成其它事项 +5，打卡 +3，专注一个番茄 +2。老师不参加排名。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 12)
    }
}

// =====================================================================
/** 感谢名单 */
class CreditsPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var rows: List<JSONObject>? = null; private var err = ""
    override fun build(): View = scaffold("感谢名单") { body = it }
    override fun onShow() { if (rows == null) load() }
    private fun load() { Bg.load({ (Api.rpc("credit_list") as? JSONArray)?.objs() ?: emptyList() }) { r, e -> if (r == null) err = e?.message ?: "" else rows = r; render() } }
    private val admin get() = Store.me?.str("role") == "admin"
    override fun render() {
        view; keepScroll(body)
        body.addView(ctx.text("捞捞课程表是同学们一起做出来的。谢谢每一位帮过忙的人 💛", 13.5f, C.sub).apply { pad(4, 0, 4, 10) })
        val l = rows ?: run { body.add(ctx.text(err.ifEmpty { "加载中…" }, 14f, C.sub), 10); return }
        val c = ctx.card(4, 18)
        l.forEachIndexed { i, x ->
            if (i > 0) c.addView(ctx.hline())
            val r = ctx.row().apply { pad(14, 12); if (admin) { press(0, 14); tap { edit(x) } } }
            r.addView(CK.avatar(ctx, x.str("name"), 38), LinearLayout.LayoutParams(dp(38), dp(38)))
            val cc = ctx.col().apply { pad(12, 0) }
            cc.addView(ctx.text(x.str("name"), 15f, C.text, BOLD)); if (x.str("contribution").isNotEmpty()) cc.addView(ctx.text(x.str("contribution"), 13f, C.sub))
            r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f)); c.addView(r)
        }
        body.addView(c)
        if (admin) body.add(ctx.button("＋ 添加") { edit(null) }, 14)
    }
    private fun edit(x: JSONObject?) {
        Dialogs.prompt(ctx, if (x == null) "名字" else "改名字", x?.str("name") ?: "", "名字") { n ->
            if (n.isBlank()) return@prompt
            Dialogs.prompt(ctx, "做了什么", x?.str("contribution") ?: "", "比如：画了云宠形象") { w ->
                Bg.load({ Api.rpc("credit_save", jsonOf("cid" to x?.opt("id"), "cname" to n, "contrib" to w, "csort" to x?.opt("sort"))) }) { _, e -> if (e != null) a.toast("保存失败：" + e.message) else { a.toast("已保存"); load() } }
            }
        }
    }
}

// =====================================================================
/** 趣味与效率：完成时的鼓励、进度环、打卡、规划、云宠（fun_opts_v1，和网页、小程序同步） */
class FunPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    override fun build(): View = scaffold("趣味与效率") { body = it }
    private fun o(): JSONObject = jsonOf("cheer" to "mascot", "confetti" to true, "rings" to true, "habits" to true, "plan" to true, "farm" to true, "hideDone" to false).also { d -> val x = Kv.obj("fun_opts_v1"); for (k in x.keys()) d.put(k, x.get(k)) }
    private fun set(k: String, v: Any) { val x = Kv.obj("fun_opts_v1"); x.put(k, v); Kv.set("fun_opts_v1", x); com.laolao.classcalendar.core.Bus.emit("data") }
    override fun render() {
        view; keepScroll(body)
        val x = o()
        body.addView(ctx.text("需要哪个开哪个，设置会同步到网页和小程序。", 13.5f, C.sub).apply { pad(4, 0, 4, 10) })
        val c = ctx.card(10, 18)
        c.addView(ctx.text("完成时的鼓励", 15f, C.text, SEMI).apply { pad(6, 6) })
        val cv = listOf("mascot", "text", "off")
        c.addView(Seg(ctx, listOf("捞捞跳出来", "只提示文字", "关掉"), maxOf(0, cv.indexOf(x.str("cheer").let { if (it == "sticker") "mascot" else it }))) { i -> set("cheer", cv[i]); if (i == 0) Cheer.show(a, "item") }.apply { margins(6, 0, 6, 8) })
        for ((k, t, d) in listOf(Triple("confetti", "✨ 撒花动画", "完成作业、打卡时撒一把彩纸"), Triple("rings", "⭕ 首页显示本周进度环", ""), Triple("habits", "🔥 习惯打卡", ""), Triple("plan", "🎯 规划（时间管理法、番茄钟）", ""), Triple("farm", "🐣 云宠农场", "完成任务攒养料喂云宠"))) {
            c.addView(ctx.hline()); c.addView(Toggle(ctx, t, d, x.optBoolean(k, true)) { v -> set(k, v) }.apply { pad(6, 6) })
        }
        body.addView(c)
        val l = ctx.card(10, 18).apply { margins(t = 12) }
        l.addView(Toggle(ctx, "🤖 捞捞助手", "标签页左下角的捞捞：显示最急的一件事，按住可以拖到别处", Lao.on()) { v -> Lao.setOn(v); render() }.apply { pad(6, 6) })
        if (Lao.on()) {
            l.addView(ctx.hline()); l.addView(Toggle(ctx, "📺 举着小屏幕", "关掉就只留捞捞", Lao.opt("screen")) { v -> Lao.setOpt("screen", v) }.apply { pad(6, 6) })
            l.addView(ctx.hline()); l.addView(Toggle(ctx, "💬 到点冒泡泡提醒", "作业快截止、过期时说一声（一件事一天只说一次）", Lao.opt("remind")) { v -> Lao.setOpt("remind", v) }.apply { pad(6, 6) })
            l.addView(ctx.hline()); l.addView(Toggle(ctx, "👋 打开时打招呼", "", Lao.opt("greet")) { v -> Lao.setOpt("greet", v) }.apply { pad(6, 6) })
        }
        body.addView(l)
    }
}

// =====================================================================
/** 问答：问问捞捞（不联网，按意图从自己的数据里查：最急的、今天的课、这周作业、下节课在哪…） */
class AskPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private lateinit var scroll: android.widget.ScrollView
    private lateinit var input: EditText
    private class Msg(val me: Boolean, val text: String, val ans: Island.Answer? = null)
    private val msgs = mutableListOf<Msg>()
    override val autoRender = false
    private val CHIPS = listOf("这周有哪些作业还没交？", "明天要干什么？", "最近哪件事最急？", "下节课在哪", "我今天打卡了吗")
    override fun build(): View {
        val root = ctx.col().apply { setBackgroundColor(C.bg) }
        root.addView(header("问问捞捞", ctx.text("清空", 14f, C.sub).apply { pad(12, 8); tap { msgs.clear(); render() } }))
        scroll = android.widget.ScrollView(ctx).apply { isFillViewport = true }
        body = ctx.col().apply { pad(16, 4, 16, 20) }
        scroll.addView(body)
        root.addView(scroll, LinearLayout.LayoutParams(MATCH, 0, 1f))
        val bar = ctx.row().apply { pad(12, 8); setBackgroundColor(C.card) }
        input = ctx.input("问点什么，比如：明天有什么课").apply { imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEND; setOnEditorActionListener { _, _, _ -> send(text.toString()); true } }
        bar.addView(input, LinearLayout.LayoutParams(0, WRAP, 1f))
        bar.addView(ctx.text("发送", 15f, Color.WHITE, BOLD).apply { gravity = Gravity.CENTER; pad(16, 0); press(C.accent, 12); tap { send(input.text.toString()) } }, LinearLayout.LayoutParams(WRAP, dp(46)).apply { leftMargin = dp(8) })
        root.addView(bar)
        Bg.run { loadRank() }
        return root
    }
    private fun loadRank() {
        val c = Store.cls ?: return; if (c.optBoolean("is_teacher") || !Store.feat("rank")) return
        try { val d = Api.rpcObj("growth_board", jsonOf("cid" to c.str("id"), "period" to "week")); d.optJSONArray("rows")?.objs()?.firstOrNull { it.optBoolean("me") }?.let { Island.rankMe = it.optInt("points") to it.optInt("rank") } } catch (_: Exception) {}
    }
    private fun send(q0: String) {
        val q = q0.trim(); if (q.isEmpty()) return
        input.setText(""); msgs += Msg(true, q)
        val a0 = try { Island.answer(q, Island.ctx()) ?: Island.fallback() } catch (e: Exception) { Island.Answer("出错了：" + e.message) }
        msgs += Msg(false, a0.text, a0)
        while (msgs.size > 24) msgs.removeAt(0)
        render(); scroll.post { scroll.fullScroll(View.FOCUS_DOWN) }
    }
    private fun rowView(r: Island.Row): View = ctx.row().apply {
        pad(12, 9); bg(C.card, 12, C.line); margins(t = 6)
        val lv = when (r.level) { "late" -> "过期" to C.red; "urgent" -> "很急" to C.red; "now" -> "进行中" to C.green; "soon" -> "快到了" to C.accent; else -> "" to C.sub }
        val cc = ctx.col()
        cc.addView(ctx.text((if (r.exam) "📝 " else "") + r.title, 14.5f, C.text, SEMI, 1))
        cc.addView(ctx.text(r.type + " · " + r.whenText + (if (r.location.isNotEmpty()) " · " + r.location else "") + " · " + r.reason, 12f, C.sub, lines = 1))
        addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
        if (lv.first.isNotEmpty()) addView(ctx.chip(lv.first, lv.second, C.alpha(lv.second, 0.12f)))
        tap { if (r.kind == "course") a.push(CoursePage(a)) else a.push(ItemPage(a, r.key)) }
    }
    override fun render() {
        view; body.removeAllViews()
        val c = Island.ctx()
        // 问候 + 最急的几件
        val hero = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(18, 16) }
        val hr = ctx.row(); hr.addView(android.widget.ImageView(ctx).apply { setImageResource(com.laolao.classcalendar.R.drawable.mascot) }, LinearLayout.LayoutParams(dp(48), dp(48)))
        hr.addView(ctx.text(Island.greet(c), 14.5f, C.heroText).apply { pad(10, 0); setLineSpacing(0f, 1.3f) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        hero.addView(hr)
        val top = Island.rank(c.items, c.courses, c.now).take(if (msgs.isEmpty()) 5 else 3)
        top.forEach { hero.addView(rowView(it)) }
        body.addView(hero)
        if (msgs.isEmpty()) {
            body.add(ctx.text("试试问：", 13f, C.sub), 14)
            val wrap = ctx.col()
            CHIPS.forEach { q -> wrap.addView(ctx.text(q, 14f, C.accent, SEMI).apply { pad(14, 9); bg(C.selected, 16); margins(t = 8); tap { send(q) } }, LinearLayout.LayoutParams(WRAP, WRAP)) }
            body.addView(wrap)
        }
        for (m in msgs) {
            if (m.me) body.addView(ctx.text(m.text, 15f, Color.WHITE).apply { pad(14, 10); bg(C.accent, 16) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.END; topMargin = dp(14); leftMargin = dp(40) })
            else {
                val b = ctx.col().apply { pad(14, 12); bg(C.card, 16, C.line) }
                if (m.text.isNotEmpty()) b.addView(ctx.text(m.text, 15f, C.text).apply { setLineSpacing(0f, 1.3f) })
                val an = m.ans
                if (an != null) {
                    an.list.forEach { b.addView(rowView(it)) }
                    if (an.more > 0) b.add(ctx.text("还有 ${an.more} 件", 12.5f, C.sub), 6)
                    an.lines.forEach { b.add(ctx.text(it, 14f, C.text), 4) }
                    if (an.chips.isNotEmpty()) { val cw = ctx.col(); an.chips.forEach { q -> cw.addView(ctx.text(q, 13.5f, C.accent, SEMI).apply { pad(12, 7); bg(C.selected, 14); margins(t = 6); tap { send(q) } }, LinearLayout.LayoutParams(WRAP, WRAP)) }; b.addView(cw) }
                    val act = when (an.action) { "farm" -> "🐣 去喂云宠" to { a.push(FarmPage(a)) }; "growth" -> "🔥 去打卡" to { a.selectTab(2); a.onBackPressed() }; "pomo" -> "🍅 开始专注" to { a.push(PlanPage(a)) }; "rank" -> "🏆 看排行榜" to { a.push(RankPage(a)) }; "courses" -> "📷 导入课程表" to { a.push(CourseImportPage(a)) }; else -> null }
                    if (act != null) b.add(ctx.soft(act.first) { act.second() }, 10)
                }
                body.add(b, 10)
            }
        }
    }
}
