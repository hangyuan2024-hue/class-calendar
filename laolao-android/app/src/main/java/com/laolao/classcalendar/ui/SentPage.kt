package com.laolao.classcalendar.ui

import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject

/**
 * 7.3 发布记录（收到情况）：我发过的班级事项（或者我管的整个院系的），每条几个人看了、几个人完成；
 * 同一次发给几个班的合成一条，点开看每个班，再点进「已读名单」看谁没看。和网页、小程序一样（接口在 7.3 SQL：sent_items dept_mine）
 */
class SentPage(a: Main, private val didArg: String = "") : Page(a) {
    private lateinit var body: LinearLayout
    private var list: List<JSONObject>? = null; private var err = ""
    private var depts: List<JSONObject> = emptyList(); private var scope = 0; private var di = 1
    private val open = HashSet<String>()
    private val DAYS = listOf(7, 30, 90)
    override val autoRender = false
    override fun build(): View = scaffold("发布记录", pull = { done -> load { done() } }) { body = it }
    override fun onShow() {
        if (list != null) return
        Bg.load({ (Api.rpc("dept_mine") as? JSONArray)?.objs() ?: emptyList() }) { d, _ ->
            depts = d ?: emptyList(); scope = maxOf(0, depts.indexOfFirst { it.str("id") == didArg } + 1); load()
        }
    }
    private fun load(done: (() -> Unit)? = null) {
        val did = if (scope > 0) depts[scope - 1].str("id") else null
        Bg.load({ (Api.rpc("sent_items", jsonOf("days" to DAYS[di], "did" to did)) as? JSONArray)?.objs() ?: emptyList() }) { l, e ->
            done?.invoke()
            if (l == null) err = (e?.message ?: "加载失败").let { if (Regex("sent_items|PGRST202|Could not find").containsMatchIn(it)) "数据库还没执行 7.3 的 SQL（7.3-dept-audience.sql）" else it } else { list = l; err = "" }
            render()
        }
    }
    private fun pct(a: Int, b: Int) = if (b > 0) a * 100 / b else 0
    private fun bar(label: String, v: Int, n: Int, color: Int): View = ctx.row().apply {
        margins(t = 6)
        addView(ctx.text(label, 12.5f, C.sub), LinearLayout.LayoutParams(dp(34), WRAP))
        val f = FrameLayout(ctx).apply { bg(C.mutedBg, 4) }
        f.addView(View(ctx).apply { bg(color, 4) }, FrameLayout.LayoutParams(0, MATCH))
        f.post { f.getChildAt(0).layoutParams = f.getChildAt(0).layoutParams.apply { width = maxOf(if (v > 0) dp(4) else 0, f.width * pct(v, n) / 100) }; f.requestLayout() }
        addView(f, LinearLayout.LayoutParams(0, dp(7), 1f))
        addView(ctx.text("$v/$n", 12.5f, C.sub).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(dp(64), WRAP))
    }
    override fun render() {
        view; keepScroll(body)
        if (depts.isNotEmpty()) body.add(Seg(ctx, listOf("我发的") + depts.map { "🏛 " + it.str("name") }, scope) { scope = it; list = null; render(); load() }, 4)
        body.add(Seg(ctx, listOf("最近 7 天", "最近 30 天", "最近 90 天"), di) { di = it; load() }, 8)
        if (err.isNotEmpty()) { body.add(ctx.text(err, 14f, C.red), 14); return }
        val l = list ?: run { body.add(ctx.text("加载中…", 14f, C.sub), 14); return }
        if (l.isEmpty()) { body.add(ctx.empty("📮", "还没发过班级事项", "最近 ${DAYS[di]} 天" + if (scope > 0) "这个院系没有发布" else "你没有发布"), 12); return }
        val aud = l.sumOf { it.optInt("aud") }; val v = l.sumOf { it.optInt("views") }
        val hw = l.filter { it.str("type") == "作业" }; val ha = hw.sumOf { it.optInt("aud") }; val hd = hw.sumOf { it.optInt("done") }
        val kc = ctx.card(14, 18).apply { orientation = LinearLayout.HORIZONTAL; margins(t = 12) }
        fun kpi(n: String, t: String) = ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; addView(ctx.text(n, 22f, C.text, HEAVY)); addView(ctx.text(t, 12f, C.sub)) }
        kc.addView(kpi("${l.size}", "条事项"), LinearLayout.LayoutParams(0, WRAP, 1f))
        kc.addView(kpi("${pct(v, aud)}%", "看过"), LinearLayout.LayoutParams(0, WRAP, 1f))
        kc.addView(kpi(if (hw.isEmpty()) "–" else "${pct(hd, ha)}%", "作业完成率"), LinearLayout.LayoutParams(0, WRAP, 1f))
        body.addView(kc)
        for (x in l) {
            val k = x.str("key"); val cls = x.optJSONArray("classes")?.objs() ?: emptyList(); val isHw = x.str("type") == "作业"
            val c = ctx.card(14, 18).apply { margins(t = 10) }
            val h = ctx.row()
            val tc = C.type(x.str("type"))
            h.addView(ctx.chip(x.str("type").ifEmpty { "通知" }, tc, C.alpha(tc, 0.14f), 12f).apply { pad(7, 1) })
            h.addView(ctx.text(x.str("subject").ifEmpty { x.str("summary") }.ifEmpty { "事项" }, 15.5f, C.text, BOLD, 1).apply { pad(8, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            h.addView(ctx.text(if (cls.size > 1) (if (open.contains(k)) "收起" else "${cls.size} 个班 ›") else "名单 ›", 13f, C.accent, SEMI))
            c.addView(h)
            val et = x.str("time")
            c.add(ctx.text((if (et.length >= 10) "${et.substring(5, 7).toInt()}月${et.substring(8, 10).toInt()}日" + (if (et.length >= 16) " " + et.substring(11, 16) else "") else "时间待定") +
                " · " + com.laolao.classcalendar.core.Checkin.hm(x.str("at")) + " 发布" + (if (scope > 0 && x.str("by").isNotEmpty()) " · " + x.str("by") else "") + (if (cls.size == 1) " · " + cls[0].str("cname") else ""), 12.5f, C.sub), 3)
            if (x.str("scope").isNotEmpty()) c.add(ctx.text("🎯 " + x.str("scope"), 12.5f, C.accent), 2)
            c.addView(bar("看过", x.optInt("views"), x.optInt("aud"), C.accent))
            if (isHw) c.addView(bar("完成", x.optInt("done"), x.optInt("aud"), C.green))
            if (open.contains(k)) {
                c.add(ctx.hline(), 8)
                for (cl in cls) c.addView(ctx.cell("", cl.str("cname"), "看过 ${cl.optInt("views")}/${cl.optInt("aud")}" + if (isHw) " · 完成 ${cl.optInt("done")}" else "", "名单 ›") {
                    a.push(ViewersPage(a, cl.opt("id").toString(), x.str("subject"), cl.str("cid"))) })
            }
            c.press(C.card, 18, C.line)
            c.tap { if (cls.size == 1) a.push(ViewersPage(a, cls[0].opt("id").toString(), x.str("subject"), cls[0].str("cid"))) else { if (!open.add(k)) open.remove(k); render() } }
            body.addView(c)
        }
        body.add(ctx.text("「看过」= 打开过作业页或点开过这条；勾了完成也算看过。只统计这条真正发给了的人。", 12f, C.sub), 12)
    }
}
