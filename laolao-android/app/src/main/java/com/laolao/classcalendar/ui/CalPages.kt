package com.laolao.classcalendar.ui

import android.app.Activity
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Bus
import com.laolao.classcalendar.core.Cfg
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** 页面顶上的说明卡：大图标 + 标题 + 一句话（设置类页面共用） */
fun Context.introCard(icon: String, title: String, sub: String): View = HeroBox(this).apply {
    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; pad(18, 18)
    addView(text(icon, 30f).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(C.alpha(Color.WHITE, if (C.dark) 0.12f else 0.75f)) } }, LinearLayout.LayoutParams(dp(56), dp(56)))
    addView(col().apply { pad(14, 0, 0, 0); addView(text(title, 18f, C.heroText, HEAVY)); addView(text(sub, 12.5f, C.alpha(C.heroText, 0.72f)).apply { setLineSpacing(0f, 1.3f); margins(t = 3) }) }, LinearLayout.LayoutParams(0, WRAP, 1f))
}
/** 一排可以多选的小胶囊 */
fun Context.chipRow(list: List<Pair<String, Boolean>>, onTap: (Int) -> Unit): View {
    val wrap = FlowRow(this, dp(8), dp(8))
    list.forEachIndexed { i, (t, on) ->
        wrap.addView(text(t, 13f, if (on) Color.WHITE else C.text, SEMI).apply { pad(13, 7); background = round(if (on) C.accent else C.mutedBg, dp(16).toFloat(), if (on) 0 else C.line, if (on) 0 else 1); if (on) lift(3); tap { it.buzz(); onTap(i) } })
    }
    return wrap
}
/** 自动换行的一排 */
class FlowRow(ctx: Context, private val hGap: Int, private val vGap: Int) : android.view.ViewGroup(ctx) {
    init { clipChildren = false }
    override fun onMeasure(ws: Int, hs: Int) {
        val maxW = MeasureSpec.getSize(ws) - paddingLeft - paddingRight
        var x = 0; var y = 0; var rowH = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i); measureChild(c, MeasureSpec.makeMeasureSpec(maxW, MeasureSpec.AT_MOST), MeasureSpec.UNSPECIFIED)
            if (x > 0 && x + c.measuredWidth > maxW) { x = 0; y += rowH + vGap; rowH = 0 }
            x += c.measuredWidth + hGap; rowH = maxOf(rowH, c.measuredHeight)
        }
        setMeasuredDimension(MeasureSpec.getSize(ws), y + rowH + paddingTop + paddingBottom)
    }
    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val maxW = r - l - paddingLeft - paddingRight
        var x = 0; var y = 0; var rowH = 0
        for (i in 0 until childCount) {
            val c = getChildAt(i)
            if (x > 0 && x + c.measuredWidth > maxW) { x = 0; y += rowH + vGap; rowH = 0 }
            c.layout(paddingLeft + x, paddingTop + y, paddingLeft + x + c.measuredWidth, paddingTop + y + c.measuredHeight)
            x += c.measuredWidth + hGap; rowH = maxOf(rowH, c.measuredHeight)
        }
    }
}

// =====================================================================
/**
 * 加到手机日历（照网页「加到手机日历」+ 小程序「提醒设置 / 数据」）：
 * 订阅链接（推荐，自动更新）、订阅里放什么 + 提前多久提醒（ics_prefs，和网页、小程序同一份）、一次性导入、各种手机怎么添加
 */
class FeedPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var feed: JSONObject? = null; private var url = ""; private var err = ""; private var busy = false
    private var prefs: JSONObject? = null; private var prefErr = ""
    private var os = 0
    private val once = booleanArrayOf(true, true, false, true)      // 班级事项、我的事项、包括已完成、只要今天及以后
    override fun build(): View = scaffold("加到手机日历") { body = it }
    override fun onShow() { if (url.isEmpty() && !busy) load(false); if (prefs == null) loadPrefs() }

    private fun load(reset: Boolean) {
        busy = true; render()
        Bg.load({ Api.rpcObj("ics_my_feed", jsonOf("reset" to reset)) }) { f, e ->
            busy = false
            if (f == null) err = e?.message ?: "" else { feed = f; url = Cfg.BASE + "/rest/v1/rpc/ics_feed?t=" + Uri.encode(f.str("token")) + "&apikey=" + Uri.encode(Cfg.ANON); err = ""; if (reset) a.toast("已换成新链接，旧的马上失效") }
            render()
        }
    }
    private fun loadPrefs() {
        Bg.load({ Api.rpcObj("ics_prefs_get") }) { p, e ->
            if (p != null) { prefs = p; prefErr = "" } else prefErr = if (Regex("ics_prefs|PGRST202|Could not find", RegexOption.IGNORE_CASE).containsMatchIn(e?.message ?: "")) "后台还没升级到 5.5.0，暂时不能自定义" else (e?.message ?: "读取失败")
            render()
        }
    }
    private fun savePrefs(next: JSONObject) {
        next.remove("courses_effective")
        Bg.load({ Api.rpcObj("ics_prefs_set", jsonOf("p" to next)) }) { p, e ->
            if (p != null) { prefs = p; a.toast("已保存，订阅的日历下次刷新时生效") } else Dialogs.alert(ctx, "没保存上", e?.message ?: "")
            render()
        }
    }

    override fun render() {
        view; keepScroll(body)
        body.addView(ctx.introCard("📲", "加到手机日历", "作业、通知、课程放进手机自带的日历，到点由系统提醒；班委新发的也会自动出现。"))

        // ---------- 订阅 ----------
        body.addView(ctx.section("订阅捞捞课程表", "推荐 · 自动更新"))
        val c = ctx.card(18, 20)
        when {
            busy && url.isEmpty() -> c.addView(ctx.text("正在准备你的专属订阅链接…", 14f, C.sub))
            url.isEmpty() -> { c.addView(ctx.text("拿不到订阅链接", 15f, C.text, BOLD)); c.add(ctx.text(err, 12.5f, C.sub), 4); c.add(ctx.soft("重试") { load(false) }, 10) }
            else -> {
                if (feed?.optInt("classes", 1) == 0) c.add(ctx.text("⚠ 你还没有加入班级，订阅后暂时是空的，入班后会自动出现。", 12.5f, 0xFFC27803.toInt()).apply { bg(C.alpha(0xFFC27803.toInt(), 0.1f), 10); pad(10, 8) }, 0)
                c.add(ctx.text(url, 11.5f, C.sub, lines = 2).apply { bg(C.mutedBg, 12); pad(12, 10); tap { CK.copy(ctx, url, "订阅链接已复制") } }, if (c.childCount > 0) 10 else 0)
                val r = ctx.row().apply { margins(t = 12) }
                r.addView(ctx.button("复制订阅链接", h = 44) { CK.copy(ctx, url, "已复制，按下面的方法粘贴到日历 App") }, LinearLayout.LayoutParams(0, dp(44), 1f))
                r.addView(ctx.soft("用日历 App 打开") { openWebcal() }, LinearLayout.LayoutParams(WRAP, dp(44)).apply { leftMargin = dp(8) })
                c.addView(r)
                c.add(ctx.row().apply {
                    addView(ctx.text("这个链接相当于你的身份，别发到群里。", 12f, C.sub), LinearLayout.LayoutParams(0, WRAP, 1f))
                    addView(ctx.text("重置链接", 12.5f, C.red, SEMI).apply { pad(8, 4); tap { Dialogs.confirm(ctx, "重置订阅链接？", "旧链接马上失效，已经订阅的设备需要重新订阅。", "重置", danger = true) { load(true) } } })
                }, 10)
            }
        }
        body.addView(c)

        // ---------- 订阅里放什么、提前多久提醒 ----------
        body.addView(ctx.section("订阅里放什么", "和网页、小程序同一份设置"))
        val p = prefs
        if (p == null) body.addView(ctx.card(18, 20).apply { addView(ctx.text(prefErr.ifEmpty { "正在读取…" }, 13.5f, C.sub)) })
        else prefsUi(p)

        // ---------- 怎么添加 ----------
        body.addView(ctx.section("怎么添加到日历"))
        val h = ctx.card(16, 20)
        h.addView(Seg(ctx, listOf("安卓", "iPhone", "电脑"), os) { os = it; render() })
        val steps = when (os) {
            0 -> listOf("安卓自带的日历一般不能直接填网址订阅。去应用商店装免费的「ICSx⁵」（也叫 ICSx5）。",
                "打开 ICSx⁵ → 右下角 ＋ → 粘贴刚才复制的订阅链接 → 下一步 → 保存。",
                "回到手机自带的「日历」，就能看到捞捞课程表；ICSx⁵ 会定时自动更新。",
                "只想加一两件：在事项详情里点「加到手机日历」，或用下面的「一次性导入」。")
            1 -> listOf("用 Safari 打开网页版，点「订阅到苹果日历」→「订阅」，最省事。",
                "或者：设置 → 日历（iOS 17 以上是 设置 → App → 日历）→ 账户 → 添加账户 → 其他 → 添加已订阅的日历 → 粘贴链接 → 存储。",
                "想收到提醒：在同一个地方点开这个订阅，关掉「移除提醒」。")
            else -> listOf("Outlook：添加日历 → 从 Internet 订阅 → 粘贴链接。",
                "Mac：日历 App → 文件 → 新建日历订阅 → 粘贴链接。",
                "Google 日历：其他日历旁的 ＋ → 通过网址添加 → 粘贴链接；手机登录同一个 Google 账号也能看到。",
                "Windows 自带的「日历」不支持订阅，用一次性导入即可。")
        }
        steps.forEachIndexed { i, s ->
            h.add(ctx.row().apply { gravity = Gravity.TOP
                addView(ctx.text("${i + 1}", 12f, Color.WHITE, BOLD).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(C.accent) } }, LinearLayout.LayoutParams(dp(22), dp(22)))
                addView(ctx.text(s, 13.5f, C.text).apply { setLineSpacing(0f, 1.35f); pad(10, 1, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f)) }, if (i == 0) 14 else 10)
        }
        if (os == 0) h.add(ctx.soft("去应用商店找 ICSx⁵") { try { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=at.bitfire.icsdroid"))) } catch (_: Exception) { a.toast("没找到应用商店，在商店里搜「ICSx5」") } }, 14)
        body.addView(h)

        // ---------- 一次性导入 ----------
        body.addView(ctx.section("一次性导入", "复制一份进日历，以后不自动更新"))
        val o = ctx.card(16, 20)
        o.addView(ctx.chipRow(listOf("班级事项", "我的事项", "包括已完成的", "只要今天及以后").mapIndexed { i, t -> t to once[i] }) { i -> once[i] = !once[i]; render() })
        val n = onceItems().size
        o.add(ctx.button(if (n > 0) "导入 $n 个事项到日历" else "没有可以导入的事项", if (n > 0) C.accent else C.mutedBg, if (n > 0) Color.WHITE else C.sub, h = 46) { if (n > 0) importOnce() }, 14)
        o.add(ctx.text("会生成一个日历文件，在弹出的列表里选「日历」就能一次导入；没有日期的事项不会放进去。", 12f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 8)
        body.addView(o)
        body.add(ctx.text("也可以在「我的 → 提醒与通知」里让这台手机直接提醒，不用日历。", 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 16)
    }

    private val TYPES = listOf("作业" to "✏️", "通知" to "📢", "会议" to "🗣", "活动" to "🎈", "我的事项" to "📝")
    private val OPT = mapOf(
        "course" to listOf<Pair<Any?, String>>(null to "不提醒", 0 to "上课时", 5 to "5 分钟前", 10 to "10 分钟前", 15 to "15 分钟前", 30 to "30 分钟前", 60 to "1 小时前"),
        "item" to listOf<Pair<Any?, String>>(null to "不提醒", 0 to "开始时", 15 to "15 分钟前", 30 to "30 分钟前", 60 to "1 小时前", 120 to "2 小时前", "prev20" to "前一天晚上 8 点"),
        "allday" to listOf<Pair<Any?, String>>(null to "不提醒", "prev20" to "前一天晚上 8 点", "prev9" to "前一天上午 9 点", "day8" to "当天早上 8 点"),
        "hw" to listOf<Pair<Any?, String>>(0 to "截止时", 30 to "30 分钟前", 60 to "1 小时前", 180 to "3 小时前", "prev20" to "前一天晚上 8 点", "day8" to "当天早上 8 点"))
    private fun first(p: JSONObject, k: String): String? = p.optJSONArray(k)?.takeIf { it.length() > 0 }?.opt(0)?.toString()

    private fun prefsUi(p: JSONObject) {
        val types = p.optJSONObject("types") ?: JSONObject()
        val c = ctx.card(16, 20)
        c.addView(ctx.text("放进日历的内容", 14.5f, C.text, BOLD))
        val list = TYPES.map { (t, ic) -> "$ic $t" to (types.opt(t) != false) } + ("📚 课程" to p.optBoolean("courses_effective", p.optBoolean("courses", true)))
        c.add(ctx.chipRow(list) { i ->
            val next = JSONObject(p.toString()); val ty = next.optJSONObject("types") ?: JSONObject().also { next.put("types", it) }
            if (i < TYPES.size) ty.put(TYPES[i].first, !list[i].second) else next.put("courses", !list[i].second)
            savePrefs(next)
        }, 10)
        c.add(Toggle(ctx, "已经完成的就不放进日历", "", p.optBoolean("hide_done")) { v -> savePrefs(JSONObject(p.toString()).put("hide_done", v)) }, 6)
        body.addView(c)

        val g = ctx.card(4, 20).apply { margins(t = 12) }
        fun pick(k: String, ic: String, t: String, s: String) {
            val opts = OPT[k]!!; val cur = first(p, k)
            val label = opts.firstOrNull { (v, _) -> if (v == null) cur == null else v.toString() == cur }?.second ?: "不提醒"
            if (g.childCount > 0) g.addView(ctx.hline())
            g.addView(ctx.cell(ic, t, s, "$label ›") {
                Dialogs.sheet(ctx, t + "：提前多久提醒", opts.map { it.second }) { i -> val v = opts[i].first; savePrefs(JSONObject(p.toString()).put(k, if (v == null) JSONArray() else JSONArray().put(v))) }
            })
        }
        g.addView(ctx.text("提前多久提醒", 14.5f, C.text, BOLD).apply { pad(12, 12, 12, 2) })
        pick("course", "📚", "课程", "")
        pick("item", "📢", "通知 / 会议 / 活动 / 我的事项", "有具体时间的")
        pick("allday", "🗓", "全天的事", "只写了日期、没写时间的")
        body.addView(g)

        val hc = ctx.card(16, 20).apply { margins(t = 12) }
        hc.addView(ctx.row().apply { addView(ctx.text("作业提醒", 14.5f, C.text, BOLD)); addView(ctx.text("  可以选几个，最多 3 个", 12f, C.sub)) })
        val hw = p.optJSONArray("hw") ?: JSONArray(); val on = (0 until hw.length()).map { hw.opt(it).toString() }
        val ho = OPT["hw"]!!
        hc.add(ctx.chipRow(ho.map { (v, t) -> t to (v.toString() in on) }) { i ->
            val v = ho[i].first.toString()
            val next = if (v in on) on - v else on + v
            if (next.size > 3) { a.toast("作业提醒最多选 3 个"); return@chipRow }
            savePrefs(JSONObject(p.toString()).put("hw", JSONArray().apply { next.forEach { x -> put(x.toIntOrNull() ?: x) } }))
        }, 10)
        if (on.isEmpty()) hc.add(ctx.text("不选就不提醒", 12f, C.sub), 6)
        hc.add(ctx.text("改完自动保存，已经订阅的日历下次自动刷新时生效（一般 1 小时内）。", 12f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 10)
        body.addView(hc)
    }

    private fun openWebcal() {
        val wc = url.replace(Regex("^https?://"), "webcal://")
        try { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(wc))) }
        catch (_: Exception) { CK.copy(ctx, url, "这台手机没有能直接订阅的日历 App，链接已复制，按下面「安卓」的方法添加"); os = 0; render() }
    }

    private fun onceItems(): List<Item> {
        val t = T.todayKey()
        return Items.all().filter { it.dated && !it.course && !it.hidden && (if (it.mine) once[1] else once[0]) && (once[2] || !it.done) && (!once[3] || it.day >= t) }
    }
    private fun importOnce() {
        val list = onceItems()
        val f = File(File(ctx.cacheDir, "att").apply { mkdirs() }, "捞捞课程表-" + T.todayKey() + ".ics")
        f.writeText(Ics.build(list, "捞捞课程表"))
        val u = Uri.parse("content://" + a.packageName + ".photo/att/" + Uri.encode(f.name))
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(u, "text/calendar").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { a.startActivity(Intent.createChooser(i, "选「日历」导入 ${list.size} 个事项")) }
        catch (_: Exception) { a.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/calendar").putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION), "发送日历文件")) }
    }
}

/** 生成日历文件（和网页 ICS.build 一样的写法） */
object Ics {
    private const val NL = "\r\n"
    private fun esc(s: String) = s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace(Regex("\r\n|\r|\n"), "\\\\n")
    private fun fold(line: String): String {
        val b = StringBuilder(); var n = 0; var lim = 75
        for (ch in line) { val w = ch.toString().toByteArray().size; if (n + w > lim) { b.append(NL).append(' '); n = 0; lim = 74 }; b.append(ch); n += w }
        return b.toString()
    }
    private fun utc(ms: Long) = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).let { String.format("%04d%02d%02dT%02d%02d%02dZ", it.year, it.monthValue, it.dayOfMonth, it.hour, it.minute, it.second) }
    private fun ymd(day: String, add: Long = 0) = T.date(day)!!.plusDays(add).let { String.format("%04d%02d%02d", it.year, it.monthValue, it.dayOfMonth) }
    fun build(items: List<Item>, name: String): String {
        val stamp = utc(System.currentTimeMillis())
        val out = StringBuilder()
        listOf("BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//xinxi-laolao//class-calendar//CN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:" + esc(name), "X-WR-TIMEZONE:Asia/Shanghai").forEach { out.append(fold(it)).append(NL) }
        for (r in items) {
            if (r.day.isEmpty() || T.date(r.day) == null) continue
            val typ = r.type.ifEmpty { "通知" }
            val title = (if (r.needConfirm) "【需确认】" else "") + "[$typ] " + r.title.ifEmpty { r.summary.ifEmpty { typ } } + if (typ == "作业" && r.time.isNotEmpty()) "（截止）" else ""
            val descr = listOf(if (r.summary != r.title) r.summary else "", if (r.prepare.isNotEmpty()) "需准备：" + r.prepare else "", if (r.note.isNotEmpty()) "备注：" + r.note else "",
                if (r.original.isNotEmpty() && r.original != r.summary) "原文：" + r.original.take(300) else "").filter { it.isNotBlank() }.joinToString("\n")
            val L = mutableListOf("BEGIN:VEVENT", "UID:" + (if (r.mine) "mine-" else "class-") + r.id + "@class-calendar", "DTSTAMP:$stamp")
            val m = T.min(r.time)
            if (m != null) { val st = T.epoch(r.day, m); val mid = T.epoch(r.day, 0) + 86_400_000L; L += "DTSTART:" + utc(st); L += "DTEND:" + utc(minOf(st + 3_600_000L, mid)) }
            else { L += "DTSTART;VALUE=DATE:" + ymd(r.day); L += "DTEND;VALUE=DATE:" + ymd(r.day, 1); L += "TRANSP:TRANSPARENT" }
            L += "SUMMARY:" + esc(title)
            if (descr.isNotEmpty()) L += "DESCRIPTION:" + esc(descr)
            if (r.location.isNotEmpty()) L += "LOCATION:" + esc(r.location)
            L += "END:VEVENT"
            L.forEach { out.append(fold(it)).append(NL) }
        }
        return out.append("END:VCALENDAR").append(NL).toString()
    }
}

// =====================================================================
/** 备份与恢复：「我的事项」和完成 / 备注标记（格式和网页、小程序一样，可以互相导） */
class BackupPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    override fun build(): View = scaffold("备份与恢复") { body = it }
    private fun text(): String = JSONObject().put("version", 1).put("mine", Kv.arr(Items.MINE)).put("marks", Kv.obj(Items.MARK)).toString(2)
    override fun render() {
        view; keepScroll(body)
        body.addView(ctx.introCard("🗄", "备份与恢复", "备份里是你自己的「我的事项」和完成、备注标记；班级事项在云端，不用备份。格式和网页、小程序一样，可以互相导。"))
        val nMine = Kv.arr(Items.MINE).length(); val nMarks = Kv.obj(Items.MARK).length()
        body.addView(ctx.section("现在有", "$nMine 条我的事项 · $nMarks 条标记"))
        fun tile(ic: String, t: String, s: String, fn: () -> Unit) = ctx.col().apply { pad(14, 16); press(C.card, 18, C.line); springy(); tap { fn() }
            addView(ctx.text(ic, 26f)); addView(ctx.text(t, 15f, C.text, BOLD).apply { margins(t = 8) }); addView(ctx.text(s, 12f, C.sub, lines = 2).apply { margins(t = 2) }) }
        fun two(x: View, y: View) = body.add(ctx.row().apply { gravity = Gravity.TOP; addView(x, LinearLayout.LayoutParams(0, WRAP, 1f)); addView(y, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(10) }) }, 10)
        two(tile("📤", "存成文件", "发到微信、QQ 或存到手机") { exportFile() }, tile("📋", "复制内容", "粘贴到备忘录里保存") { CK.copy(ctx, text(), "备份内容已复制") })
        body.addView(ctx.section("恢复"))
        two(tile("📥", "从文件恢复", "选之前存的备份文件") { importFile() }, tile("📝", "从剪贴板恢复", "先复制备份内容再点") { importPaste() })
        body.add(ctx.text("恢复会覆盖这台手机上的「我的事项」和标记，然后自动同步到账号。背景图片不在备份里。", 12f, C.sub).apply { setLineSpacing(0f, 1.3f); gravity = Gravity.CENTER }, 16)
    }
    private fun exportFile() {
        val f = File(File(ctx.cacheDir, "att").apply { mkdirs() }, "我的日历备份-" + T.todayKey() + ".json")
        f.writeText(text())
        val u = Uri.parse("content://" + a.packageName + ".photo/att/" + Uri.encode(f.name))
        val i = Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM, u).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { a.startActivity(Intent.createChooser(i, "把备份文件发到…")) } catch (_: Exception) { a.toast("这台手机上没有能接收文件的应用") }
    }
    private fun importFile() {
        val i = Intent(Intent.ACTION_GET_CONTENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE)
        a.startForResult(Intent.createChooser(i, "选备份文件")) { res, data ->
            val u = data?.data
            if (res != Activity.RESULT_OK || u == null) return@startForResult
            val t = try { a.contentResolver.openInputStream(u)?.bufferedReader()?.readText() ?: "" } catch (e: Exception) { a.toast("没读到文件：" + e.message); return@startForResult }
            restore(t)
        }
    }
    private fun importPaste() {
        val t = (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(ctx)?.toString() ?: ""
        if (!t.contains("\"mine\"")) { Dialogs.alert(ctx, "剪贴板里不是备份内容", "先把之前复制的备份内容再复制一次，然后点这里。"); return }
        restore(t)
    }
    private fun restore(text: String) {
        val d = try { JSONObject(text.trimStart('\uFEFF')).also { if (it.optJSONArray("mine") == null || it.optJSONObject("marks") == null) throw Exception("格式不对") } }
            catch (e: Exception) { Dialogs.alert(ctx, "恢复失败", "这不是捞捞课程表的备份文件（" + (e.message ?: "") + "）"); return }
        val mine = d.getJSONArray("mine")
        Dialogs.confirm(ctx, "恢复 ${mine.length()} 条我的事项？", "会覆盖这台手机上的数据。", "恢复") {
            Kv.set(Items.MINE, mine); Kv.set(Items.MARK, d.getJSONObject("marks")); Bus.emit("data")
            a.toast("恢复完成"); render()
        }
    }
}
