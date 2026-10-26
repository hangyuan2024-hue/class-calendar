package com.laolao.classcalendar.ui

import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject

/**
 * 6.9.2「班级情况」：老师（建班的）和班委都能看（和网页 teacher.js、小程序 lib/teach.js 一样）
 * 谁作业没做完、谁 7 天没打开、每条事项几个人看了 / 完成了，还能进这个班的签到
 */
class OverviewPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var classes: List<JSONObject>? = null; private var cid = ""; private var ov: JSONObject? = null
    private var err = ""; private var tab = 0; private var filter = 0; private var days = 14; private var loading = false
    // 7.2 找人、排序（完成率低的在前 / 最近打开 / 名字），和小程序 1.18 一样
    private var q = ""; private var sort = 0
    private val qBox by lazy { ctx.input("搜名字", "").apply { addTextChangedListener(object : android.text.TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        override fun afterTextChanged(s: android.text.Editable?) { q = s?.toString()?.trim()?.lowercase() ?: ""; listBox?.let { paintList(it) } }
    }) } }
    private var listBox: LinearLayout? = null
    private var rowsSrc: List<JSONObject> = emptyList(); private var hwNow = 0
    private val since = { t: String -> try { ((System.currentTimeMillis() - java.time.OffsetDateTime.parse(t).toInstant().toEpochMilli()) / 86_400_000L).toInt() } catch (_: Exception) { -1 } }
    override fun build(): View = scaffold("班级情况", pull = { done -> load(true) { done() } }) { body = it }
    override fun onShow() { load(false) }

    private fun load(force: Boolean, done: (() -> Unit)? = null) {
        loading = true
        Bg.load({
            val cl = classes?.takeIf { !force } ?: try { (Api.rpc("manage_classes") as? JSONArray)?.objs() ?: emptyList() }
                catch (e: Exception) {
                    if (!Regex("manage_classes|PGRST202|Could not find").containsMatchIn(e.message ?: "")) throw e
                    ((Api.rpc("teacher_classes") as? JSONArray)?.objs() ?: emptyList()).onEach { it.put("role", "teacher") }
                }
            val list = cl.filter { it.str("kind") != "staff" }
            val pick = cid.takeIf { c -> list.any { it.str("id") == c } } ?: list.firstOrNull { it.str("id") == com.laolao.classcalendar.core.Store.cls?.str("id") }?.str("id") ?: list.firstOrNull()?.str("id") ?: ""
            val o = if (pick.isNotEmpty()) Api.rpcObj("teacher_overview", jsonOf("cid" to pick, "days" to days)) else null
            Triple(cl, pick, o)
        }) { r, e ->
            loading = false; done?.invoke()
            if (r == null) err = e?.message ?: "加载失败" else { classes = r.first; cid = r.second; ov = r.third; err = "" }
            render()
        }
    }

    override fun render() {
        view; keepScroll(body)
        val cl = (classes ?: run { body.add(ctx.text(err.ifEmpty { "加载中…" }, 14f, if (err.isNotEmpty()) C.red else C.sub), 14); return }).filter { it.str("kind") != "staff" }
        if (cl.isEmpty()) { body.addView(ctx.empty("📊", "你还没有能管理的班", "老师建班后，或者被任命为班委（能发布事项 / AI 整理 / 看成员名单），这里就能看全班情况")); return }
        // 班级切换
        val chips = ctx.row()
        for (c in cl) {
            val on = c.str("id") == cid
            chips.addView(ctx.text(c.str("name") + (if (c.str("role") == "monitor") "（班委）" else "") + (if (c.optInt("ck_open") > 0) " · 签到中" else ""), 13.5f, if (on) android.graphics.Color.WHITE else C.text, SEMI).apply {
                pad(14, 8); if (on) bg(C.accent, 16) else bg(C.mutedBg, 16)
                tap { if (!on) { cid = c.str("id"); ov = null; render(); load(false) } }
            }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
        }
        body.add(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(chips) }, 8)
        // 7.3 发布记录（收到情况）：我发的 / 整个院系的
        body.add(ctx.cell("📮", "发布记录 · 收到情况", "每条几个人看了、完成了；同一次发给几个班的合在一起看") { a.push(SentPage(a)) }.apply { bg(C.card, 18) }, 12)
        // 签到入口：一直在上面，最常用
        val ck = ctx.card(14, 18).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; margins(t = 12) }
        ck.addView(ctx.text("📋", 24f))
        ck.addView(ctx.col().apply { pad(12, 0); addView(ctx.text("这个班的签到", 15.5f, C.text, BOLD)); addView(ctx.text("发起动态码 / 位置签到、看谁没签", 12.5f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        ck.addView(ctx.text("›", 20f, C.mutedText))
        ck.press(C.card, 18, C.line); ck.tap { a.push(CheckinPage(a, cidArg = cid)) }
        body.addView(ck)

        val o = ov
        if (o == null) { body.add(ctx.text(if (loading) "加载中…" else err.ifEmpty { "没拿到这个班的情况" }, 14f, if (err.isNotEmpty()) C.red else C.sub), 14); return }
        val st = o.optJSONArray("students")?.objs() ?: emptyList(); val hwN = o.optInt("hw_count")
        val sum = st.sumOf { minOf(it.optInt("hw_done"), if (hwN > 0) hwN else it.optInt("hw_done")) }
        val rate = if (hwN > 0 && st.isNotEmpty()) "${sum * 100 / (hwN * st.size)}%" else "–"
        val kc = ctx.card(14, 18).apply { orientation = LinearLayout.HORIZONTAL; margins(t = 12) }
        fun kpi(n: String, l: String) = ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; addView(ctx.text(n, 22f, C.text, HEAVY)); addView(ctx.text(l, 12f, C.sub)) }
        kc.addView(kpi("${o.optInt("total")}", "学生"), LinearLayout.LayoutParams(0, WRAP, 1f))
        kc.addView(kpi("$hwN", "已到期作业"), LinearLayout.LayoutParams(0, WRAP, 1f))
        kc.addView(kpi(rate, "作业完成率"), LinearLayout.LayoutParams(0, WRAP, 1f))
        kc.addView(kpi("${o.optInt("pending")}", "待审批"), LinearLayout.LayoutParams(0, WRAP, 1f))
        body.addView(kc)
        val lazy = st.filter { hwN > 0 && it.optInt("hw_done") < hwN }
        val quiet = st.filter { val d = since(it.str("last_active")); d < 0 || d >= 7 }
        // 7.2 需要关注：作业没做完、7 天没打开的同学，点一下只看他们
        if (lazy.isNotEmpty() || quiet.isNotEmpty()) {
            val ac = ctx.card(4, 18).apply { margins(t = 12) }
            ac.addView(ctx.text("需要关注", 13f, C.sub, SEMI).apply { pad(14, 10, 14, 2) })
            fun line(ic: String, t: String, who: List<JSONObject>, f: Int) {
                if (who.isEmpty()) return
                val names = who.take(5).joinToString("、") { it.str("name").ifEmpty { it.str("account") } } + if (who.size > 5) " 等" else ""
                ac.addView(ctx.cell(ic, "$t · ${who.size} 人", names, "只看他们 ›") { filter = f; tab = 0; render() })
            }
            line("📝", "作业没做完", lazy, 1); line("💤", "7 天没打开", quiet, 2)
            body.addView(ac)
        }
        body.add(Seg(ctx, listOf("👥 每个同学", "📋 谁看了"), tab) { tab = it; render() }, 12)
        if (tab == 0) {
            body.add(Seg(ctx, listOf("全部 ${st.size}", "作业没做完 ${lazy.size}", "7 天没打开 ${quiet.size}"), filter) { filter = it; render() }, 10)
            val list = when (filter) { 1 -> lazy; 2 -> quiet; else -> st }
            if (filter > 0 && list.isNotEmpty()) body.add(ctx.soft("复制这些名字（发到群里提醒）") {
                (ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("名字", list.joinToString(" ") { "@" + it.str("name").ifEmpty { it.str("account") } })); a.toast("已复制")
            }, 10)
            if (st.size > 6) {
                (qBox.parent as? android.view.ViewGroup)?.removeView(qBox)
                body.add(qBox, 10)
                body.add(Seg(ctx, listOf("完成率低的在前", "最近打开", "名字"), sort) { sort = it; listBox?.let { b -> paintList(b) } }, 8)
            }
            rowsSrc = list; hwNow = hwN
            val lc = ctx.card(4, 18).apply { margins(t = 10) }
            listBox = lc; paintList(lc)
            body.addView(lc)
            body.add(ctx.text("「作业」= 最近 ${o.optInt("days")} 天到期的作业里，同学自己勾了完成的项数；「看过」= 打开过作业页或点开过事项。", 12f, C.sub), 10)
        } else {
            val it0 = o.optJSONArray("items")?.objs() ?: emptyList(); val total = maxOf(1, o.optInt("total"))
            val lc = ctx.card(4, 18).apply { margins(t = 10) }
            if (it0.isEmpty()) lc.addView(ctx.text("最近 ${o.optInt("days")} 天没有事项", 13.5f, C.sub).apply { pad(14, 14) })
            it0.forEachIndexed { i, x ->
                if (i > 0) lc.addView(ctx.hline())
                val c = ctx.col().apply { pad(14, 10) }
                c.addView(ctx.text("[${x.str("type")}] " + x.str("subject").ifEmpty { x.str("summary") }, 14.5f, C.text, SEMI, 2))
                c.addView(ctx.text(x.str("time").take(16) + (if (x.str("by").isNotEmpty()) " · ${x.str("by")} 发布" else ""), 12f, C.sub))
                val tot = if (x.has("aud") && !x.isNull("aud")) x.optInt("aud") else o.optInt("total")   // 7.3 定向的：分母是收件人数
                if (x.str("scope").isNotEmpty()) c.addView(ctx.text("🎯 " + x.str("scope") + "（$tot 人）", 12f, C.accent))
                c.addView(ctx.text("已读 ${x.optInt("views")}/$tot" + if (x.str("type") == "作业") " · 完成 ${x.optInt("done")}/$tot" else "", 12.5f, C.accent, SEMI))
                val bar = FrameLayout(ctx).apply { bg(C.mutedBg, 3) }
                bar.addView(View(ctx).apply { bg(C.accent, 3) }, FrameLayout.LayoutParams(0, MATCH))
                c.addView(bar, LinearLayout.LayoutParams(MATCH, dp(5)).apply { topMargin = dp(4) })
                bar.post { bar.getChildAt(0).layoutParams = bar.getChildAt(0).layoutParams.apply { width = maxOf(dp(3), bar.width * x.optInt("views") / maxOf(1, tot)) }; bar.requestLayout() }
                lc.addView(c)
            }
            body.addView(lc)
        }
    }

    private fun paintList(lc: LinearLayout) {
        lc.removeAllViews()
        val hwN = hwNow
        val zh = java.text.Collator.getInstance(java.util.Locale.CHINA)
        val nm0 = { x: JSONObject -> x.str("name").ifEmpty { x.str("account") } }
        val pOf = { x: JSONObject -> if (hwN > 0) minOf(x.optInt("hw_done"), hwN) * 100 / hwN else 0 }
        val dOf = { x: JSONObject -> since(x.str("last_active")).let { if (it < 0) 9999 else it } }
        val byName = Comparator<JSONObject> { x, y -> zh.compare(nm0(x), nm0(y)) }
        val list = rowsSrc.filter { q.isEmpty() || nm0(it).lowercase().contains(q) }.sortedWith(when (sort) {
            1 -> compareBy<JSONObject> { dOf(it) }.then(byName)
            2 -> byName
            else -> compareBy<JSONObject> { pOf(it) }.thenByDescending { dOf(it) }.then(byName)
        })
        if (list.isEmpty()) lc.addView(ctx.text(if (q.isNotEmpty()) "没有找到「$q」" else if (filter == 0) "还没有同学加入" else "没有 🎉", 13.5f, C.sub).apply { pad(14, 14) })
        list.forEachIndexed { i, s ->
            if (i > 0) lc.addView(ctx.hline())
            val r = ctx.row().apply { pad(14, 10) }
            val nm = s.str("name").ifEmpty { s.str("account") }
            r.addView(CK.avatar(ctx, nm, 34), LinearLayout.LayoutParams(dp(34), dp(34)))
            val d = since(s.str("last_active"))
            r.addView(ctx.col().apply { pad(10, 0)
                addView(ctx.text(nm + if (s.str("role") == "monitor") "（班委）" else "", 14.5f, C.text, SEMI, 1))
                addView(ctx.text((if (d < 0) "还没打开过" else if (d == 0) "今天打开过" else "$d 天前打开过") + " · 看过 ${s.optInt("seen")} 条", 12f, C.sub, lines = 1)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            val p = if (hwN > 0) minOf(s.optInt("hw_done"), hwN) * 100 / hwN else 0
            r.addView(ctx.text("作业 ${s.optInt("hw_done")}" + (if (hwN > 0) "/$hwN" else ""), 13f, if (p >= 80) C.green else if (p < 40 && hwN > 0) C.red else C.text, BOLD))
            lc.addView(r)
        }
    }
}
