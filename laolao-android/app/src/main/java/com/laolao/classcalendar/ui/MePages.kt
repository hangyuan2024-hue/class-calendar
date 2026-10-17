package com.laolao.classcalendar.ui

import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject

/** 外观：主题色（和网页、小程序同步）+ 深色模式（只管这台手机） */
class LookPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    class Pal(val id: String, val name: String, val p: String, val s: String)
    companion object {
        /** 和小程序 lib/look.js 的 PALETTES 一样 */
        val PALETTES = listOf(
            Pal("sky", "天空蓝", "#1ea0ff", "#ff7b2e"), Pal("sakura", "樱花粉", "#ff5f8f", "#ffb03b"),
            Pal("peach", "蜜桃", "#ff7a6b", "#ffc24b"), Pal("lavender", "薰衣草", "#8c6bff", "#ff7bc0"),
            Pal("grape", "葡萄紫", "#a03fd8", "#22c3a6"), Pal("mint", "薄荷绿", "#17b890", "#ff8a3d"),
            Pal("matcha", "抹茶", "#5f9e45", "#e0a526"), Pal("ocean", "深海", "#0f8bb5", "#ff6a5c"),
            Pal("navy", "海军蓝", "#2457d6", "#ffb020"), Pal("galaxy", "星空", "#5b5bd6", "#ff5fa2"),
            Pal("sunset", "落日", "#f25c54", "#f7b267"), Pal("orange", "活力橙", "#ff8a1f", "#1ea0ff"),
            Pal("lemon", "柠檬", "#e0b000", "#3c8dff"), Pal("cocoa", "可可", "#a0703f", "#e8a33d"),
            Pal("rose", "玫瑰", "#e0457b", "#8c6bff"), Pal("graphite", "石墨", "#3d4b5c", "#ff7b2e"),
        )
    }
    override fun build(): View = scaffold("外观") { body = it }

    override fun render() {
        view
        keepScroll(body)
        val cur = (Kv.get("ui_palette_v1") as? JSONObject)?.str("id") ?: ""
        // 预览
        val pv = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(20, 18) }
        pv.addView(ctx.text("预览", 12.5f, C.sub, SEMI))
        pv.addView(ctx.text("今天还有 2 件事", 20f, C.heroText, HEAVY).apply { margins(t = 4) })
        val pr = ctx.row().apply { margins(t = 12) }
        pr.addView(ctx.text("主按钮", 14f, Color.WHITE, BOLD).apply { gravity = Gravity.CENTER; bg(C.accent, 12); pad(16, 8) }, LinearLayout.LayoutParams(WRAP, WRAP))
        pr.addView(ctx.text("次按钮", 14f, C.accent, SEMI).apply { gravity = Gravity.CENTER; bg(C.selected, 12); pad(16, 8) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(10) })
        pv.addView(pr)
        body.addView(pv)

        body.addView(ctx.section("主题色", "网页、小程序会一起换"))
        val c = ctx.card(12, 18)
        var row: LinearLayout? = null
        val all = listOf(Pal("", "清爽（默认）", "#5366e8", "#bf6650")) + PALETTES.drop(1)
        all.forEachIndexed { i, p ->
            if (i % 4 == 0) { row = ctx.row().apply { gravity = Gravity.TOP }; c.addView(row, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = if (i == 0) 0 else dp(12) }) }
            val on = p.id == cur || (p.id == "" && cur.isEmpty())
            val cell = ctx.col().apply {
                gravity = Gravity.CENTER_HORIZONTAL; pad(2, 6); press(if (on) C.selected else 0, 14)
                tap { pick(p) }
                val dot = android.widget.FrameLayout(ctx)
                dot.addView(View(ctx).apply { background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR, intArrayOf(C.c(p.p), C.c(p.s))).apply { shape = android.graphics.drawable.GradientDrawable.OVAL } }, android.widget.FrameLayout.LayoutParams(dp(40), dp(40)))
                if (on) dot.addView(ctx.text("✓", 18f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER }, android.widget.FrameLayout.LayoutParams(dp(40), dp(40)))
                addView(dot)
                addView(ctx.text(p.name.replace("（默认）", ""), 12f, if (on) C.accent else C.sub, if (on) BOLD else null, 1).apply { gravity = Gravity.CENTER; margins(t = 5) })
            }
            row!!.addView(cell, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        val rest = all.size % 4
        if (rest != 0) repeat(4 - rest) { row!!.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f)) }
        body.addView(c)

        body.addView(ctx.section("深色模式", "只改这台手机"))
        val pref = a.getSharedPreferences("app", android.content.Context.MODE_PRIVATE)
        val modes = listOf("" to "跟随系统", "light" to "总是浅色", "dark" to "总是深色")
        body.addView(Seg(ctx, modes.map { it.second }, modes.indexOfFirst { it.first == (pref.getString("dark_mode", "") ?: "") }.coerceAtLeast(0)) { i ->
            pref.edit().putString("dark_mode", modes[i].first).apply()
            Bg.later(150) { a.recreate() }
        })
        body.add(ctx.text("桌面小组件的深浅跟着系统设置走。", 12.5f, C.sub).apply { pad(4, 0) }, 10)
    }

    private fun pick(p: Pal) {
        if (p.id.isEmpty()) Kv.set("ui_palette_v1", null) else Kv.set("ui_palette_v1", jsonOf("id" to p.id, "p" to p.p, "s" to p.s))
        Bg.run { try { com.laolao.classcalendar.core.Sync.finish() } catch (_: Exception) {} }
        a.toast("已换成「${p.name.replace("（默认）", "")}」")
        Bg.later(200) { a.recreate() }
    }
}

/** 账号安全：改密码 + 登录过的设备（踢出） */
class SecurityPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var devs: List<JSONObject>? = null
    private var devErr = ""
    private var busy = false
    override val autoRender = false
    override fun build(): View = scaffold("账号与安全") { body = it }
    override fun onShow() { if (devs == null) load() }

    private fun load() {
        Bg.load({ (Api.rpc("device_list", jsonOf("p_device" to Store.deviceId())) as? JSONArray)?.objs() ?: emptyList() }) { l, e ->
            devs = l ?: emptyList()
            devErr = if (e == null) "" else if (Regex("device_list|function|404", RegexOption.IGNORE_CASE).containsMatchIn(e.message ?: "")) "后台还没开通设备管理" else (e.message ?: "加载失败")
            render()
        }
    }
    private fun seen(s: String): String = try { com.laolao.classcalendar.core.T.ago(java.time.OffsetDateTime.parse(s).toInstant().toEpochMilli()) } catch (e: Exception) { try { com.laolao.classcalendar.core.T.ago(java.time.Instant.parse(s).toEpochMilli()) } catch (x: Exception) { s.take(16).replace("T", " ") } }

    override fun render() {
        view
        keepScroll(body)
        val me = Store.me
        val ac = ctx.card(4, 18)
        ac.addView(ctx.cell("👤", "账号", (me?.str("account") ?: "") + " · " + Store.name(), "") {})
        ac.addView(ctx.hline())
        ac.addView(ctx.cell("🔑", "修改密码", "至少 8 位；改了以后别的设备不会被退出") { changePw() })
        body.addView(ac)

        body.addView(ctx.section("登录过的设备", "不认识的设备可以踢出"))
        val dc = ctx.card(4, 18)
        val l = devs
        when {
            l == null -> dc.addView(ctx.text("加载中…", 14f, C.sub).apply { pad(16, 14) })
            devErr.isNotEmpty() -> dc.addView(ctx.text(devErr, 14f, C.sub).apply { pad(16, 14) })
            l.isEmpty() -> dc.addView(ctx.text("只有这台手机", 14f, C.sub).apply { pad(16, 14) })
            else -> {
                val mine = Store.deviceId()
                l.forEachIndexed { i, d ->
                    if (i > 0) dc.addView(ctx.hline())
                    val cur = d.optBoolean("current") || d.str("device") == mine || d.str("id") == mine
                    val r = ctx.row().apply { pad(14, 12) }
                    r.addView(ctx.text(when (d.str("platform")) { "web" -> "💻"; "wechat" -> "💬"; else -> "📱" }, 20f))
                    val cc = ctx.col().apply { pad(10, 0) }
                    cc.addView(ctx.text(d.str("name").ifEmpty { "未知设备" } + if (cur) " · 本机" else "", 14.5f, C.text, SEMI, 2))
                    cc.addView(ctx.text("最近使用 " + seen(d.str("last_seen")), 12.5f, C.sub).apply { margins(t = 2) })
                    r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
                    if (!cur) r.addView(ctx.text("踢出", 13.5f, C.red, SEMI).apply { pad(12, 6); press(C.dangerBg, 10); tap { kick(d) } })
                    dc.addView(r)
                }
                if (l.size > 1) { dc.addView(ctx.hline()); dc.addView(ctx.cell("🚪", "退出其他所有设备", "", "") { kickAll() }) }
            }
        }
        body.addView(dc)
        body.add(ctx.text("被踢出的设备下一次联网就会退出登录，需要重新输入密码。如果看到不认识的设备，踢出后请马上改密码。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f); pad(4, 0) }, 10)
    }

    private fun kick(d: JSONObject) {
        if (busy) return
        Dialogs.confirm(ctx, "踢出「${d.str("name")}」？", "对方需要重新输入密码才能再登录。", "踢出", danger = true) {
            busy = true
            Bg.load({ Api.rpc("device_revoke", jsonOf("p_id" to d.opt("id").toString(), "p_all" to false, "p_device" to Store.deviceId())) }) { _, e ->
                busy = false
                if (e != null) Dialogs.alert(ctx, "没踢出", e.message ?: "") else after("「${d.str("name")}」已退出登录。")
                load()
            }
        }
    }
    private fun kickAll() {
        if (busy) return
        Dialogs.confirm(ctx, "退出其他所有设备？", "除了这台手机，其它地方的登录全部作废。", "全部踢出", danger = true) {
            busy = true
            Bg.load({ Api.rpc("device_revoke", jsonOf("p_id" to null, "p_all" to true, "p_device" to Store.deviceId())) }) { r, e ->
                busy = false
                if (e != null) Dialogs.alert(ctx, "没踢出", e.message ?: "") else after("已让其它 ${(r as? JSONObject)?.optInt("n") ?: 0} 处登录全部退出。")
                load()
            }
        }
    }
    private fun after(msg: String) = Dialogs.confirm(ctx, "好了", "$msg\n\n如果那不是你的设备，说明密码可能被别人知道了，建议现在就改密码。", "去改密码", cancel = "不用") { changePw() }

    private fun changePw() {
        val c = ctx.col().apply { pad(22, 22, 22, 14) }
        lateinit var d: android.app.Dialog
        c.addView(ctx.text("修改密码", 18f, C.text, BOLD))
        val pw = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        val o = ctx.input("原密码", type = pw); val n1 = ctx.input("新密码（至少 8 位）", type = pw); val n2 = ctx.input("再输一次新密码", type = pw)
        for (e in listOf(o, n1, n2)) c.add(e, 12)
        val msg = ctx.text("", 13f, C.red).apply { visibility = View.GONE }
        c.add(msg, 8)
        val btns = ctx.row().apply { gravity = Gravity.END; margins(t = 12) }
        btns.addView(ctx.text("取消", 15f, C.sub, SEMI).apply { pad(16, 10); press(0, 10); tap { d.dismiss() } })
        btns.addView(ctx.text("保存", 15f, C.accent, BOLD).apply { pad(16, 10); press(0, 10); tap {
            val err = when {
                o.text.isEmpty() -> "请输入原密码"
                n1.text.length < 8 -> "新密码至少 8 位"
                n1.text.toString() != n2.text.toString() -> "两次输入的新密码不一样"
                else -> ""
            }
            if (err.isNotEmpty()) { msg.text = err; msg.visibility = View.VISIBLE; return@tap }
            if (busy) return@tap
            busy = true; msg.visibility = View.GONE
            Bg.load({ Api.rpc("pw_change", jsonOf("oldpw" to o.text.toString(), "newpw" to n1.text.toString())) }) { _, e ->
                busy = false
                if (e != null) { msg.text = "没改成：" + (e.message ?: ""); msg.visibility = View.VISIBLE }
                else { Dialogs.hideKeyboard(c); d.dismiss(); a.toast("密码已修改") }
            }
        } })
        c.addView(btns)
        d = Dialogs.show(ctx, c)
        o.requestFocus(); Dialogs.showKeyboard(o)
    }
}
