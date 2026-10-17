package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Growth
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.Sync
import com.laolao.classcalendar.core.T

/** 成长（底部标签）：本周进度环、规划与专注入口、最近 14 天趋势、习惯打卡（照小程序「成长」） */
class GrowthPage(a: Main) : Page(a) {
    private var rankMe: Pair<Int, Int>? = null; private var rankAt = 0L
    private lateinit var body: LinearLayout
    private var picked = Growth.EMO[0]
    private var newName = ""
    private var nameBox: EditText? = null
    lateinit var fab: Fab

    override fun build(): View {
        val f = FrameLayout(ctx).apply { setBackgroundColor(C.bg) }
        val ps = PullScroll(ctx) { done -> a.refreshSoon(force = true) { done() } }
        body = ps.content.apply { pad(18, 14, 18, 110) }
        f.addView(ps, FrameLayout.LayoutParams(MATCH, MATCH))
        fab = Fab(a, f) {
            listOf(FabItem("🔥", "添加一个习惯") { nameBox?.let { e -> e.requestFocus(); Dialogs.showKeyboard(e); ps.scroll.smoothScrollTo(0, e.top + 600) } },
                FabItem("🍅", "开始专注") { a.push(PlanPage(a, pomo = true)) },
                FabItem("✏️", "记一件事") { a.push(EditPage(a, null)) })
        }
        a.fabs += fab
        return f
    }

    override fun render() {
        view
        keepScroll(body)
        body.addView(ctx.text("每一天都在变好", 11.5f, C.sub, SEMI).apply { letterSpacing = 0.08f })
        body.addView(ctx.text("成长", 26f, C.text, HEAVY).apply { margins(t = 2) })

        // 本周进度环
        val green = if (C.dark) C.c("#82bea1") else C.c("#39856a")
        val rc = ctx.card(14, 20).apply { orientation = LinearLayout.HORIZONTAL; margins(t = 14) }
        for (r in Growth.rings(C.red, C.accent, green)) {
            val cell = ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL }
            cell.addView(RingView(ctx, r.done, r.total, r.color), LinearLayout.LayoutParams(dp(78), dp(78)))
            cell.addView(ctx.text(r.label, 13f, C.text, BOLD).apply { gravity = Gravity.CENTER; margins(t = 8) })
            cell.addView(ctx.text("${r.done} / ${r.total}", 12f, C.sub).apply { gravity = Gravity.CENTER })
            rc.addView(cell, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        body.addView(rc)

        // 规划与专注入口
        val p = Plan.pomo()
        val pe = ctx.card(16, 18).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; margins(t = 12) }
        pe.addView(ctx.text("🍅", 28f))
        val pc = ctx.col()
        pc.addView(ctx.text("规划与专注", 16f, C.text, BOLD))
        val (left, _) = Plan.left()
        pc.addView(ctx.text(when (p.mode) { "focus" -> "专注中 · 还剩 " + Plan.fmt(left); "break" -> "休息中 · " + Plan.fmt(left); "paused" -> "已暂停 · " + Plan.fmt(left); else -> "今天 ${Plan.today()} 个番茄 · 本周 ${Plan.week()} 个 · 四象限排轻重" }, 12.5f, if (p.mode == "focus") C.accent else C.sub).apply { margins(t = 2) })
        pe.addView(pc, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(12) })
        pe.addView(ctx.text("›", 20f, C.mutedText))
        pe.press(C.card, 18, C.line); pe.tap { a.push(PlanPage(a)) }
        body.addView(pe)

        // 班级成长排行榜（和小程序一样：班里所有人都能看，老师也能看）
        val cls = com.laolao.classcalendar.core.Store.cls
        if (cls != null && com.laolao.classcalendar.core.Store.feat("rank")) {
            val re = ctx.card(16, 18).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; margins(t = 12) }
            re.addView(ctx.text("🏆", 28f))
            val rc2 = ctx.col()
            rc2.addView(ctx.text("班级成长排行榜", 16f, C.text, BOLD))
            val me = rankMe
            rc2.addView(ctx.text(if (me != null && me.second > 0) "这周我第 ${me.second} 名 · ${me.first} 成长值" else "完成作业、打卡、番茄钟都能攒成长值", 12.5f, if (me != null && me.second in 1..3) C.accent else C.sub).apply { margins(t = 2) })
            re.addView(rc2, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(12) })
            re.addView(ctx.text("›", 20f, C.mutedText))
            re.press(C.card, 18, C.line); re.springy(); re.tap { a.push(RankPage(a)) }
            body.addView(re)
            if (System.currentTimeMillis() - rankAt > 300_000) { rankAt = System.currentTimeMillis()
                com.laolao.classcalendar.core.Bg.load({ com.laolao.classcalendar.core.Api.rpcObj("growth_board", com.laolao.classcalendar.core.jsonOf("cid" to cls.optString("id"), "period" to "week")) }) { d, _ ->
                    val r = d?.optJSONArray("rows")?.let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } }?.firstOrNull { it.optBoolean("me") }
                    if (r != null) { rankMe = r.optInt("points") to r.optInt("rank"); com.laolao.classcalendar.core.Island.rankMe = rankMe; render() }
                } }
        }

        // 云宠、等级
        val links = mutableListOf<Triple<String, String, () -> Unit>>()
        if (com.laolao.classcalendar.core.Farm.on()) links += Triple("🐣", "云宠 Lv." + com.laolao.classcalendar.core.Farm.state().optInt("level", 1)) { a.push(FarmPage(a)) }
        links += Triple("🏅", "等级 Lv." + com.laolao.classcalendar.core.Meta.stats().level) { a.push(MetaPage(a)) }
        val lr = ctx.row().apply { margins(t = 12) }
        links.forEachIndexed { i, (ic, t, go) -> lr.addView(ctx.row().apply { gravity = Gravity.CENTER; pad(6, 12); press(C.card, 16, C.line); tap { go() }; addView(ctx.text(ic, 18f)); addView(ctx.text(" $t", 13.5f, C.text, SEMI, 1)) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) leftMargin = dp(8) }) }
        body.addView(lr)

        // 最近 14 天
        body.addView(ctx.section("最近 14 天", "每天完成了多少事、打了多少卡"))
        val tc = ctx.card(14, 18)
        val lg = ctx.row()
        lg.addView(View(ctx).apply { bg(C.accent, 2) }, LinearLayout.LayoutParams(dp(14), dp(4)))
        lg.addView(ctx.text("完成事项", 12f, C.sub).apply { pad(6, 0, 14, 0) })
        lg.addView(View(ctx).apply { bg(green, 2) }, LinearLayout.LayoutParams(dp(14), dp(4)))
        lg.addView(ctx.text("打卡", 12f, C.sub).apply { pad(6, 0, 0, 0) })
        tc.addView(lg)
        tc.add(TrendChart(ctx, Growth.trend(14), C.accent, green), 8)
        body.addView(tc)

        // 习惯打卡
        body.addView(ctx.section("习惯打卡", "小目标，每天勾一下"))
        val hc = ctx.card(6, 18).apply { pad(12, 6, 12, 14) }
        val hs = Growth.habits(); val lg2 = Growth.log()
        if (hs.isEmpty()) hc.addView(ctx.text("还没有习惯。挑一个下面的建议，或者自己写一个。", 13.5f, C.sub).apply { pad(6, 12) })
        hs.forEachIndexed { i, h ->
            if (i > 0) hc.addView(ctx.hline())
            val r = ctx.row().apply { pad(4, 12) }
            r.addView(ctx.text(h.icon, 24f).apply { tap { more(h) } })
            val c = ctx.col().apply { tap { more(h) } }
            val nm = ctx.row()
            nm.addView(ctx.text(h.name, 15f, C.text, BOLD, 1))
            val sk = Growth.streak(h.id, lg2)
            if (sk > 0) nm.addView(ctx.chip("🔥 连续 $sk 天", C.red, C.dangerBg, 11f).apply { margins(l = 0) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) })
            c.addView(nm)
            val dots = ctx.row().apply { margins(t = 6) }
            Growth.cells(h.id, 14, lg2).forEachIndexed { k, on ->
                dots.addView(View(ctx).apply { bg(if (on) green else C.alpha(C.text, 0.09f), 3, if (k == 13) C.accent else 0) }, LinearLayout.LayoutParams(dp(9), dp(9)).apply { rightMargin = dp(3) })
            }
            c.addView(dots)
            r.addView(c, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(10) })
            val on = Growth.checked(h.id)
            r.addView(ctx.text(if (on) "✓ 已打卡" else "打卡", 13.5f, if (on) Color.WHITE else green, BOLD).apply {
                gravity = Gravity.CENTER; pad(12, 7)
                if (on) press(green, 16, ripple = C.alpha(Color.WHITE, 0.3f)) else press(0, 16, green)
                tap { v -> v.buzz(); if (Growth.toggle(h.id)) Cheer.show(a, "habit", "「${h.name}」连续 ${Growth.streak(h.id)} 天"); render() }
            })
            hc.addView(r)
        }
        // 添加
        hc.add(ctx.hline(), 6)
        val emo = ctx.row().apply { margins(t = 10) }
        val hsv = HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(emo) }
        for (e in Growth.EMO.take(10)) emo.addView(ctx.text(e, 20f).apply {
            gravity = Gravity.CENTER; if (e == picked) bg(C.selected, 10, C.accent) else bg(0, 10)
            tap { picked = e; render() }
        }, LinearLayout.LayoutParams(dp(40), dp(40)).apply { rightMargin = dp(4) })
        hc.addView(hsv)
        val ar = ctx.row().apply { margins(t = 8) }
        val box = ctx.input("新习惯，比如：背 30 个单词", newName).apply { filters = arrayOf(android.text.InputFilter.LengthFilter(16)) }
        box.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: android.text.Editable?) { newName = s.toString() }
        })
        nameBox = box
        ar.addView(box, LinearLayout.LayoutParams(0, WRAP, 1f))
        ar.addView(ctx.text("添加", 15f, Color.WHITE, BOLD).apply {
            gravity = Gravity.CENTER; press(C.accent, 12); pad(16, 0)
            tap {
                val n = newName.trim()
                if (n.isEmpty()) { a.toast("写一下新习惯叫什么"); return@tap }
                if (!Growth.add(n, picked)) { a.toast("已经有「$n」了"); return@tap }
                newName = ""; Dialogs.hideKeyboard(box); a.toast("加好了"); render()
            }
        }, LinearLayout.LayoutParams(WRAP, dp(46)).apply { leftMargin = dp(8) })
        hc.addView(ar)
        val sugg = Growth.SUGG.filter { s -> hs.none { it.name == s.second } }
        if (sugg.isNotEmpty()) {
            val sr = ctx.row().apply { margins(t = 10) }
            val shs = HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(sr) }
            for ((e, n) in sugg) sr.addView(ctx.text("＋ $n", 12.5f, C.sub, SEMI).apply { bg(C.mutedBg, 14); pad(10, 6); tap { Growth.add(n, e); render() } },
                LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
            hc.addView(shs)
        }
        body.addView(hc)
        body.add(ctx.text(if (Sync.state != "off") "打卡和完成记录已同步到你的账号，网页、小程序也能看到。" else "打卡和完成记录保存在这台手机上。", 12f, C.sub).apply { gravity = Gravity.CENTER }, 16)

        // 最近完成
        val rd = Growth.recentDone(20)
        if (rd.isNotEmpty()) {
            body.addView(ctx.section("最近完成的", ""))
            val dc = ctx.card(14, 18)
            rd.forEachIndexed { i, (d, list) ->
                val n = T.dayDiff(d)
                dc.add(ctx.text(if (n == 0L) "今天" else if (n == -1L) "昨天" else T.md(d) + " " + T.wk(d), 12.5f, C.sub, BOLD), if (i == 0) 0 else 10)
                for (r in list) dc.add(ctx.text("✓ " + r.title, 14f, C.text, lines = 1), 4)
            }
            body.addView(dc)
        }
    }

    private fun more(h: Growth.Habit) {
        Dialogs.sheet(ctx, h.name, listOf("换个图标", "改名字", "删除这个习惯"), danger = setOf(2)) { i ->
            when (i) {
                0 -> Dialogs.sheet(ctx, "选一个图标", Growth.EMO) { j -> Growth.update(h.id, icon = Growth.EMO[j]) }
                1 -> Dialogs.prompt(ctx, "改名字", h.name, "比如：背 30 个单词") { v -> if (v.isNotBlank()) Growth.update(h.id, name = v) }
                2 -> Dialogs.confirm(ctx, "删除「${h.name}」？", "它的打卡记录也会一起删掉。", "删除", danger = true) { Growth.remove(h.id) }
            }
        }
    }
}

/** 进度环 */
class RingView(ctx: Context, private val done: Int, private val total: Int, private val color: Int) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = HEAVY }
    override fun onDraw(c: Canvas) {
        val d = resources.displayMetrics.density; val w = 7 * d
        val r = RectF(w / 2, w / 2, width - w / 2, height - w / 2)
        p.strokeWidth = w; p.color = C.alpha(C.text, 0.08f); c.drawArc(r, 0f, 360f, false, p)
        if (total > 0 && done > 0) { p.color = color; c.drawArc(r, -90f, 360f * done / total, false, p) }
        tp.textSize = 16 * d; tp.color = C.text
        c.drawText(if (total > 0) "${done * 100 / total}%" else "–", width / 2f, height / 2f + 5.5f * d, tp)
    }
}

/** 最近 14 天两条折线 */
class TrendChart(ctx: Context, private val data: List<Triple<String, Int, Int>>, private val c1: Int, private val c2: Int) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onMeasure(w: Int, h: Int) { setMeasuredDimension(MeasureSpec.getSize(w), (resources.displayMetrics.density * 150).toInt()) }
    override fun onDraw(c: Canvas) {
        val d = resources.displayMetrics.density
        val L = 24 * d; val R = 22 * d; val Tp = 8 * d; val B = 22 * d
        val max = maxOf(4, data.maxOf { maxOf(it.second, it.third) }); val top = (max + 1) / 2 * 2
        val n = data.size
        fun x(i: Int) = L + (width - L - R) * i / (n - 1).toFloat()
        fun y(v: Int) = Tp + (height - Tp - B) * (1 - v / top.toFloat())
        tp.textSize = 10 * d; tp.color = C.sub
        for (v in listOf(0, top / 2, top)) {
            p.color = C.line; p.strokeWidth = 1f; c.drawLine(L, y(v), width - R, y(v), p)
            tp.textAlign = Paint.Align.RIGHT; c.drawText("$v", L - 5 * d, y(v) + 3.5f * d, tp)
        }
        tp.textAlign = Paint.Align.CENTER
        data.forEachIndexed { i, (day, _, _) -> if (i % 3 == 1 || i == n - 1) c.drawText(if (i == n - 1) "今天" else "${day.substring(5, 7).toInt()}/${day.substring(8).toInt()}", x(i), height - 5 * d, tp) }
        for ((col, sel) in listOf(c2 to { t: Triple<String, Int, Int> -> t.third }, c1 to { t: Triple<String, Int, Int> -> t.second })) {
            val path = Path()
            data.forEachIndexed { i, t -> if (i == 0) path.moveTo(x(i), y(sel(t))) else path.lineTo(x(i), y(sel(t))) }
            p.style = Paint.Style.STROKE; p.strokeWidth = 2.2f * d; p.strokeJoin = Paint.Join.ROUND; p.strokeCap = Paint.Cap.ROUND; p.color = col
            c.drawPath(path, p)
            p.style = Paint.Style.FILL; c.drawCircle(x(n - 1), y(sel(data.last())), 4 * d, p)
            tp.textAlign = Paint.Align.LEFT; tp.color = col; c.drawText("${sel(data.last())}", x(n - 1) + 7 * d, y(sel(data.last())) + 3.5f * d, tp); tp.color = C.sub
        }
    }
}
