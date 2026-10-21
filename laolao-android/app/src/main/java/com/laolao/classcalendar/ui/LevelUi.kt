package com.laolao.classcalendar.ui

import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Checkin
import com.laolao.classcalendar.core.CourseShot
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Growth
import com.laolao.classcalendar.core.Lesson
import com.laolao.classcalendar.core.Level
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONObject
import java.time.LocalDate

private val ORANGE get() = Color.parseColor("#ff7a45")

/** 6.9 账号等级：成长页的等级卡、排行榜「等级」那一栏 */
object LevelUi {
    private var refreshedAt = 0L
    fun chip(ctx: android.content.Context, level: Int): View = ctx.text("Lv.$level ${Level.title(level)}", 11f, Color.parseColor("#a34a12"), BOLD).apply {
        background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.parseColor("#ffe7c7"), Color.parseColor("#ffd9e2"))).apply { cornerRadius = ctx.dp(9).toFloat() }
        pad(7, 1)
    }
    private fun bar(ctx: android.content.Context, pct: Int): View {
        val f = FrameLayout(ctx).apply { bg(C.mutedBg, 4) }
        val fill = View(ctx).apply { background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(Color.parseColor("#ffb35c"), ORANGE)).apply { cornerRadius = ctx.dp(4).toFloat() } }
        f.addView(fill, FrameLayout.LayoutParams(0, MATCH))
        f.post { fill.layoutParams = fill.layoutParams.apply { width = maxOf(ctx.dp(6), f.width * pct / 100) }; f.requestLayout() }
        return f
    }
    /** 成长页顶上的等级卡 */
    fun card(a: Main): View {
        val ctx: android.content.Context = a
        if (Store.me != null && System.currentTimeMillis() - refreshedAt > 60_000) { refreshedAt = System.currentTimeMillis(); Level.refresh { com.laolao.classcalendar.core.Bus.emit("xp") } }
        val c = ctx.card(16, 18).apply { margins(t = 14) }
        val l = Level.me()
        if (l == null) {
            c.addView(ctx.text("⭐ 账号等级", 16f, C.text, BOLD))
            c.addView(ctx.text("完成事项、打卡、专注都能攒经验升级，在排行榜「等级」里和同学比一比。", 12.5f, C.sub).apply { margins(t = 2) })
        } else {
            val r = ctx.row()
            r.addView(ctx.text("Lv.${l.level}", 30f, ORANGE, HEAVY))
            val cc = ctx.col().apply { pad(12, 0) }
            cc.addView(ctx.text(l.title, 16f, C.text, BOLD))
            cc.addView(ctx.text("今天 +${Level.today()} 经验 · 一共 ${l.xp}", 12.5f, C.sub))
            r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
            r.addView(ctx.text("🏆 等级榜 ›", 13f, C.sub, SEMI))
            c.addView(r)
            c.add(bar(ctx, l.pct), 12).layoutParams = (c.getChildAt(c.childCount - 1).layoutParams as LinearLayout.LayoutParams).apply { height = ctx.dp(8) }
            c.add(ctx.text("${l.xp} / ${l.to} · 再攒 ${l.need} 经验升到 Lv.${l.level + 1}", 12f, C.sub), 6)
        }
        c.add(ctx.text("完成班级作业 +10、其它班级事项 +5、自己的事 +2、打卡 +3、番茄 +2、位置签到 +5；同一件事只算一次，取消完成会扣回来。", 11.5f, C.mutedText).apply { setLineSpacing(0f, 1.25f) }, 8)
        c.press(C.card, 18, C.line); c.tap { if (Store.cls != null) a.push(RankPage(a, level = true)) else a.toast("加入班级后就能和同学比等级") }
        return c
    }
    /** 排行榜「等级」那一栏 */
    fun board(a: Main, body: LinearLayout, x: JSONObject) {
        val ctx: android.content.Context = a
        Level.parse(x.optJSONObject("me")?.optJSONObject("level"))?.let { l ->
            val mc = ctx.card(16, 18).apply { margins(t = 14) }
            val r = ctx.row()
            r.addView(ctx.text("Lv.${l.level}", 28f, ORANGE, HEAVY))
            r.addView(ctx.col().apply { pad(12, 0); addView(ctx.text("我 · ${l.title}", 15f, C.text, BOLD)); addView(ctx.text("一共 ${l.xp} 经验 · 再攒 ${l.need} 升级", 12.5f, C.sub)) })
            mc.addView(r)
            mc.add(bar(ctx, l.pct), 10).layoutParams = (mc.getChildAt(mc.childCount - 1).layoutParams as LinearLayout.LayoutParams).apply { height = ctx.dp(8) }
            body.addView(mc)
        }
        val rows = x.optJSONArray("rows")?.objs() ?: emptyList()
        if (rows.isEmpty()) { body.addView(ctx.empty("⭐", "班里还没有人攒经验", "完成一项作业就能上榜")); return }
        val lc = ctx.card(4, 18).apply { margins(t = 14) }
        rows.forEachIndexed { i, r ->
            if (i > 0) lc.addView(ctx.hline())
            val anon = r.optBoolean("anon") && !x.optBoolean("teacher") && !r.optBoolean("me")
            val row = ctx.row().apply { pad(14, 10); if (r.optBoolean("me")) bg(C.selected, 14) }
            val rk = r.optInt("rank")
            row.addView(ctx.text(if (rk in 1..3) listOf("🥇", "🥈", "🥉")[rk - 1] else "$rk", if (rk in 1..3) 18f else 15f, C.sub, BOLD).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(a, 30), WRAP))
            row.addView(CK.avatar(ctx, r.str("name"), 34, grey = anon), LinearLayout.LayoutParams(dp(a, 34), dp(a, 34)))
            val cc = ctx.col().apply { pad(10, 0) }
            cc.addView(ctx.text(r.str("name") + if (r.optBoolean("me")) "（我）" else "", 14.5f, C.text, SEMI, 1))
            cc.addView(chip(ctx, r.optInt("level", 1)), LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(a, 3) })
            row.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
            row.addView(ctx.text("${r.optInt("xp")}", 15f, C.text, HEAVY)); row.addView(ctx.text(" 经验", 11.5f, C.sub))
            lc.addView(row)
        }
        body.addView(lc)
        body.add(ctx.text("等级跟着账号走（换班、换设备都在），按账号总经验排；在「本周」那页选了匿名 / 不参加，这里也一样。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f) }, 12)
    }
    private fun dp(a: Main, v: Int) = a.dp(v)
}

/** 6.9 习惯绑地点：绑在现在的位置；以后要在范围里才能打卡（取消打卡不用定位） */
object HabitPlace {
    /** 打卡按钮：done(打上了没有) */
    fun toggle(a: Main, id: String, done: (Boolean) -> Unit) {
        val p = Growth.place(id)
        if (p == null || Growth.checked(id)) { done(Growth.toggle(id)); return }
        a.locate { pos ->
            val d = com.laolao.classcalendar.core.Geo.dist(pos.lat, pos.lng, p.optDouble("lat"), p.optDouble("lng"))
            val slack = minOf(100, pos.acc)
            if (d <= p.optInt("r", 200) + slack) done(Growth.toggle(id))
            else Dialogs.alert(a, "还没到打卡地点", "你离「${p.str("name")}」还有 ${Math.round(d - p.optInt("r", 200))} 米，到了再打卡吧")
        }
    }
    fun menu(a: Main, h: Growth.Habit) {
        val p = Growth.place(h.id)
        if (p != null) Dialogs.sheet(a, "「${h.name}」要在「${p.str("name")}」${p.optInt("r")} 米内打卡", listOf("改成我现在的位置", "解除地点（在哪都能打卡）")) { i -> if (i == 0) bind(a, h, p.str("name")) else { Growth.setPlace(h.id, null); a.toast("已解除") } }
        else bind(a, h, "")
    }
    private fun bind(a: Main, h: Growth.Habit, old: String) {
        Dialogs.prompt(a, "把「${h.name}」绑在你现在的位置", old, "给这个地点起个名字，比如：图书馆") { name ->
            val rs = listOf(100, 200, 500, 1000)
            Dialogs.sheet(a, "多大范围内能打卡？", rs.map { if (it >= 1000) "1 公里内" else "$it 米内" }) { k ->
                a.locate { pos ->
                    val pl = jsonOf("name" to name.ifBlank { "打卡地点" }.take(20), "lat" to Math.round(pos.lat * 1e6) / 1e6, "lng" to Math.round(pos.lng * 1e6) / 1e6, "r" to rs[k])
                    Growth.setPlace(h.id, pl)
                    Dialogs.alert(a, "绑好了", "以后「${h.name}」要在「${pl.str("name")}」${rs[k]} 米内才能打卡。")
                }
            }
        }
    }
}

/** 6.9 班级位置签到页：班委 / 老师用自己现在的位置发起，同学到了现场才能签（+5 经验） */
class CheckinPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var list: List<JSONObject>? = null; private var err = ""; private var busy = false
    private val names = mutableMapOf<Long, JSONObject>()
    override fun build(): View = scaffold("位置签到", pull = { done -> load { done() } }) { body = it }
    override fun onShow() { load() }
    private fun load(done: (() -> Unit)? = null) {
        val c = Store.cls ?: run { render(); done?.invoke(); return }
        Bg.load({ Checkin.list(c.str("id")) }) { r, e -> done?.invoke(); if (r == null) err = e?.message?.let { if (Regex("checkin_list|PGRST202|Could not find").containsMatchIn(it)) "服务器还没升级（需要执行 level.sql）" else it } ?: "加载失败" else { list = r; err = "" }; render() }
    }
    override fun render() {
        view; keepScroll(body)
        if (CK.gate(this, body)) return
        if (Checkin.mgr()) {
            val nc = ctx.card(16, 18).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; margins(t = 12) }
            nc.addView(ctx.text("📍", 26f))
            nc.addView(ctx.col().apply { pad(12, 0); addView(ctx.text("发起位置签到", 16f, C.text, BOLD)); addView(ctx.text("用你现在的位置当签到点，同学到了现场才能签", 12.5f, C.sub)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            nc.addView(ctx.text("›", 20f, C.mutedText))
            nc.press(C.card, 18, C.line); nc.tap { create() }
            body.addView(nc)
        }
        val l = list ?: run { body.add(ctx.text(err.ifEmpty { "加载中…" }, 14f, if (err.isNotEmpty()) C.red else C.sub), 14); return }
        if (err.isNotEmpty()) body.add(ctx.text(err, 13f, C.red), 10)
        if (l.isEmpty()) body.addView(ctx.empty("📍", "班里还没有位置签到", if (Checkin.mgr()) "点上面「发起位置签到」" else "班委或老师发起后，这里会出现"))
        for (x in l) {
            val id = x.optLong("id"); val open = x.optBoolean("open"); val mine = x.optJSONObject("mine")
            val c = ctx.card(16, 18).apply { margins(t = 12) }
            if (open) c.background = round(C.card, dp(18).toFloat(), C.alpha(ORANGE, 0.55f), dp(1))
            val h = ctx.row()
            h.addView(ctx.text(x.str("title").ifEmpty { "位置签到" }, 16f, C.text, BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
            h.addView(ctx.chip(if (open) "进行中 · 还剩 ${Checkin.leftText(x)}" else "已结束", if (open) ORANGE else C.sub, if (open) C.alpha(ORANGE, 0.14f) else C.mutedBg))
            c.addView(h)
            c.add(ctx.text("📍 ${x.str("place")} · ${x.optInt("radius")} 米内 · ${Checkin.hm(x.str("starts_at"))}" + if (x.optBoolean("can_manage")) " · 已签 ${x.optInt("signed")}/${x.optInt("members")}" else "", 12.5f, C.sub), 4)
            c.add(ctx.text(if (mine != null) "✓ ${Checkin.hm(mine.str("at")).takeLast(5)} 签到了（离 ${mine.optInt("dist")} 米）" else if (open) "我还没签到" else "我没签到", 13.5f, if (mine != null) C.green else C.sub, SEMI), 6)
            val br = ctx.row().apply { margins(t = 10) }
            if (open && mine == null) br.addView(ctx.soft("📍 我到了，签到", C.accent, Color.WHITE) { sign(id) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
            if (x.optBoolean("can_manage")) {
                br.addView(ctx.soft(if (names.containsKey(id)) "收起名单" else "名单") { if (names.remove(id) == null) detail(id) else render() }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
                if (open) br.addView(ctx.soft("结束", C.dangerBg, C.red) { Dialogs.confirm(ctx, "结束这次签到？", "结束后同学就不能再签了。", "结束", danger = true) { Bg.load({ Checkin.close(id) }) { _, e -> if (e != null) a.toast(e.message ?: "没结束成功") else a.toast("已结束"); load() } } })
            }
            if (br.childCount > 0) c.addView(br)
            names[id]?.let { d ->
                val sg = d.optJSONArray("signed")?.objs() ?: emptyList(); val ms = d.optJSONArray("missing")?.let { m -> (0 until m.length()).map { m.optString(it) } } ?: emptyList()
                val nb = ctx.col().apply { bg(C.mutedBg, 12); pad(12, 10); margins(t = 10) }
                nb.addView(ctx.text("已签 ${sg.size} 人：" + sg.joinToString("、") { s -> s.str("name") + "（" + Checkin.hm(s.str("at")).takeLast(5) + " · " + s.optInt("dist") + "米）" }.ifEmpty { "还没有" }, 13f, C.text))
                nb.add(ctx.text("没签 ${ms.size} 人：" + ms.joinToString("、").ifEmpty { "全到了 🎉" }, 13f, C.text), 6)
                if (ms.isNotEmpty()) nb.add(ctx.text("复制没签的名单", 13f, C.accent, SEMI).apply { tap {
                    (ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("没签到", ms.joinToString("、"))); a.toast("已复制") } }, 6)
                c.addView(nb)
            }
            body.addView(c)
        }
        body.add(ctx.text("位置只在你点「签到」那一下取一次，不会一直跟踪。签到成功 +5 经验。", 12f, C.sub).apply { gravity = Gravity.CENTER }, 14)
    }
    private fun sign(id: Long) {
        if (busy) return
        a.locate { pos ->
            busy = true
            Bg.load({ Checkin.sign(id, pos) }) { r, e ->
                busy = false
                when {
                    r == null -> Dialogs.alert(ctx, "没签上", e?.message ?: "")
                    !r.optBoolean("ok", true) -> Dialogs.alert(ctx, "还不能签到", r.str("why").ifEmpty { "没签上" })
                    r.optBoolean("already") -> a.toast("你已经签过了")
                    else -> { a.toast("✓ 签到成功，离签到点 ${r.optInt("dist")} 米" + if (r.optInt("points") > 0) "，经验 +${r.optInt("points")}" else ""); Level.refresh { com.laolao.classcalendar.core.Bus.emit("xp") } }
                }
                load()
            }
        }
    }
    private fun detail(id: Long) { Bg.load({ Checkin.detail(id) }) { r, e -> if (r == null) a.toast(e?.message ?: "名单打不开") else { names[id] = r; render() } } }
    private fun create() {
        val cid = Store.cls?.str("id") ?: return
        Dialogs.prompt(ctx, "签到地点", "", "比如：操场、B302") { place ->
            if (place.isBlank()) { a.toast("写一下签到地点"); return@prompt }
            val rs = listOf(50, 100, 200, 500, 1000); val ms = listOf(5, 10, 15, 30, 60, 120)
            Dialogs.sheet(ctx, "多大范围内能签？", rs.map { "$it 米内" }) { ri ->
                Dialogs.sheet(ctx, "签到开多久？", ms.map { if (it >= 60) "${it / 60} 小时" else "$it 分钟" }) { mi ->
                    Dialogs.confirm(ctx, "在这里发起？", "签到点就是你【现在所在的位置】，同学要在 ${rs[ri]} 米内才能签到。你现在在「$place」吗？", "就在这里") {
                        a.locate { pos ->
                            Bg.load({ Checkin.create(cid, place + "签到", place, pos, rs[ri], ms[mi]) }) { _, e -> if (e != null) Dialogs.alert(ctx, "没发起成功", e.message ?: "") else a.toast("已发起，同学打开「位置签到」就能签"); load() }
                        }
                    }
                }
            }
        }
    }
}

/** 6.9 首页点课程：这周课表里标出这门课 / 截图导入时的原图（框出这门课） */
object CourseView {
    fun open(a: Main, d: LocalDate, l: Lesson) {
        val ctx: android.content.Context = a
        val day = d.dayOfWeek.value - 1
        val monday = d.minusDays(day.toLong())
        val days = (0 until 7).map { monday.plusDays(it.toLong()) }
        val lessons = days.map { Courses.on(T.key(it)).filter { x -> !x.evening } }
        val n = if (lessons[5].isNotEmpty() || lessons[6].isNotEmpty() || day >= 5) 7 else 5
        val c = ctx.col().apply { pad(18, 18, 18, 12) }
        lateinit var dlg: android.app.Dialog
        val hr = ctx.row()
        hr.addView(View(ctx).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Courses.color(l.name)) } }, LinearLayout.LayoutParams(a.dp(12), a.dp(12)))
        hr.addView(ctx.text(l.name, 19f, C.text, HEAVY, 1).apply { pad(10, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        c.addView(hr)
        c.add(ctx.text(listOf(T.md(d) + " " + T.wk(d) + " 第${l.start}" + (if (l.end > l.start) "-${l.end}" else "") + "节" + (if (l.t0.isNotEmpty()) "（${l.t0}–${l.t1}）" else ""), if (l.location.isNotEmpty()) "📍 " + l.location else "", if (l.teacher.isNotEmpty()) "👤 " + l.teacher else "").filter { it.isNotEmpty() }.joinToString("  "), 12.5f, C.sub), 4)
        val box = FrameLayout(ctx)
        fun table() {
            box.removeAllViews()
            val sv = ScrollView(ctx)
            val g = WeekGrid(ctx, days.take(n), lessons.take(n), Courses.times(), days.contains(T.today()), { _, _ -> }, { _, _ -> }).apply { hl = Triple(l.name, day, l.start) }
            sv.addView(g, FrameLayout.LayoutParams(MATCH, WRAP))
            box.addView(sv, FrameLayout.LayoutParams(MATCH, MATCH))
            g.post { val k = (l.start - 2).coerceAtLeast(0); sv.scrollTo(0, (g.height * k / maxOf(1, Courses.times().size + 1))) }
        }
        fun shot() {
            box.removeAllViews()
            val msg = ctx.text("正在取原图…", 13.5f, C.sub).apply { gravity = Gravity.CENTER; pad(16, 40) }
            box.addView(msg, FrameLayout.LayoutParams(MATCH, WRAP))
            Bg.load({
                val r = CourseShot.get() ?: return@load null
                val bytes = Base64.decode(r.str("img").substringAfter(","), Base64.DEFAULT)
                Triple(BitmapFactory.decodeByteArray(bytes, 0, bytes.size), CourseShot.boxOf(r, l.name), r.optLong("at"))
            }) { t, _ ->
                if (t?.first == null) { msg.text = "还没有课表原图。用「拍照 / 截图导入」导入课表后，这里就能看原图，还会框出这门课。"; return@load }
                val (bm, b, at) = t
                box.removeAllViews()
                val sv = ScrollView(ctx); val col = ctx.col()
                val fr = FrameLayout(ctx)
                val iv = ImageView(ctx).apply { setImageBitmap(bm); adjustViewBounds = true; scaleType = ImageView.ScaleType.FIT_CENTER }
                fr.addView(iv, FrameLayout.LayoutParams(MATCH, WRAP))
                if (b != null) {
                    val mark = View(ctx).apply { background = round(Color.TRANSPARENT, a.dp(6).toFloat(), ORANGE, a.dp(3)) }
                    fr.addView(mark, FrameLayout.LayoutParams(0, 0))
                    fr.post {
                        val w = fr.width.toFloat(); val h = w * bm.height / maxOf(1, bm.width)
                        mark.layoutParams = FrameLayout.LayoutParams(((b[2] - b[0]) * w).toInt(), ((b[3] - b[1]) * h).toInt()).apply { leftMargin = (b[0] * w).toInt(); topMargin = (b[1] * h).toInt() }
                        mark.requestLayout()
                    }
                }
                col.addView(fr)
                col.add(ctx.text((if (at > 0) java.time.Instant.ofEpochMilli(at).atZone(T.BJ).toLocalDate().let { T.md(it) } + " " else "") + "导入时的原图" + if (b != null) "，橙色框出来的就是这门课" else "", 12f, C.sub), 6)
                sv.addView(col)
                box.addView(sv, FrameLayout.LayoutParams(MATCH, MATCH))
                if (b != null) sv.post { sv.scrollTo(0, maxOf(0, ((b[1] * fr.height) - a.dp(80)).toInt())) }
            }
        }
        c.add(Seg(ctx, listOf("在课表里", "📷 截图原图"), 0) { if (it == 0) table() else shot() }, 12)
        c.addView(box, LinearLayout.LayoutParams(MATCH, (a.resources.displayMetrics.heightPixels * 0.55).toInt()).apply { topMargin = a.dp(10) })
        val br = ctx.row().apply { gravity = Gravity.END; margins(t = 8) }
        br.addView(ctx.text("打开课程表", 15f, C.sub, SEMI).apply { pad(16, 10); press(0, 10); tap { dlg.dismiss(); a.push(CoursePage(a)) } })
        br.addView(ctx.text("关闭", 15f, C.accent, BOLD).apply { pad(16, 10); press(0, 10); tap { dlg.dismiss() } })
        c.addView(br)
        table()
        dlg = Dialogs.show(ctx, c)
        dlg.window?.setLayout((a.resources.displayMetrics.widthPixels * 0.94).toInt(), WRAP)
    }
    /** 首页的课：按名字、日子、第几节找到那一节 */
    fun open(a: Main, dayKey: String, name: String, start: Int?) {
        val d = T.date(dayKey) ?: return
        val l = Courses.on(dayKey).firstOrNull { it.name == name && (start == null || it.start == start) } ?: Courses.on(dayKey).firstOrNull { it.name == name }
        if (l == null || l.evening) { a.push(CoursePage(a)); return }
        open(a, d, l)
    }
}
