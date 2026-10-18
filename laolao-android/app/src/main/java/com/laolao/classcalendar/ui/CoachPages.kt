package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Coach
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.work.Background

/**
 * 捞捞教练（5.9.3）：首页「今日教练」卡片 + 教练页（每周复盘、你的节奏、设置）
 * 规则在 core/Coach.kt，全部在本机算；同步的只有统计数字
 */
object CoachCard {
    private fun fmt(x: Double): String { val v = Math.round(x * 10) / 10.0; return if (v == Math.floor(v)) v.toLong().toString() else v.toString() }

    /** 提示出现过一次就记一下（同一件事、同一种说法 3 小时内只记一次），用来学哪种说法有用 */
    private fun shown(key: String, style: String) {
        if (style.isEmpty()) return
        val o = Kv.obj("coach_shown_v1"); val k = "$key|$style"; val now = System.currentTimeMillis()
        if (now - o.optLong(k) < 3 * 3_600_000L) return
        o.keys().asSequence().toList().forEach { if (now - o.optLong(it) > 86_400_000L) o.remove(it) }
        o.put(k, now); Kv.setQuiet("coach_shown_v1", o)
        Coach.record(Coach.Ev(now, "show", key, s = style))
    }
    private fun accept(key: String, style: String) { if (style.isNotEmpty()) Coach.record(Coach.Ev(System.currentTimeMillis(), "acc", key, s = style)) }

    fun build(a: Main, body: LinearLayout, refresh: () -> Unit) {
        val ctx: Context = a
        fun dp(v: Int) = a.dp(v)
        if (!Coach.on()) {
            // 还没问过：先征得同意，说清楚记什么、存在哪
            if (Coach.opt("asked", false)) return
            val c = ctx.card(18, 22).apply { margins(t = 14) }
            c.addView(ctx.text("🧭 要不要试试捞捞教练？", 16f, C.text, HEAVY))
            c.add(ctx.text("开启后，捞捞会在这台手机上记下你几点完成了事、专注了多久，慢慢学会你的节奏：推荐现在最适合做的事、定一个够得着的小目标、在你状态最好的时候提醒、每周给你复盘。\n原始记录只存在本机；同步到账号的只有统计数字，没有标题和内容。随时可以关掉、清空。", 13f, C.sub).apply { setLineSpacing(0f, 1.4f) }, 6)
            val br = ctx.row().apply { margins(t = 12) }
            br.addView(ctx.button("开启", h = 42) { Coach.setOpt("asked", true); Coach.setOpt("on", true); Background.coach(a); a.toast("捞捞教练开始学你的节奏啦，用几天会越来越准"); refresh() }, LinearLayout.LayoutParams(0, dp(42), 1f))
            br.addView(ctx.soft("不用了", C.mutedBg, C.sub) { Coach.setOpt("asked", true); a.toast("以后可以在「我的 → 捞捞教练」里打开"); refresh() }, LinearLayout.LayoutParams(WRAP, dp(42)).apply { leftMargin = dp(8) })
            c.addView(br)
            body.addView(c)
            return
        }
        val s = try { Coach.now() } catch (e: Exception) { return }
        val c = ctx.col().apply {
            pad(18, 16, 18, 14)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(C.mix(C.card, C.accent, if (C.dark) 0.16f else 0.07f), C.card)).apply { cornerRadius = dp(22).toFloat(); setStroke(1, C.alpha(C.accent, 0.18f)) }
            lift(4, C.accent); margins(t = 14)
        }
        // 标题行：今日教练 · 连续天数 · 今天的小目标
        val hr = ctx.row()
        hr.addView(ctx.text("🧭 今日教练", 12.5f, C.accent, BOLD), LinearLayout.LayoutParams(0, WRAP, 1f))
        if (s.streak.days > 0) hr.addView(ctx.chip("🔥 ${s.streak.days} 天", if (s.streak.atRisk) C.red else 0xFFE8590C.toInt(), if (s.streak.atRisk) C.dangerBg else C.alpha(0xFFE8590C.toInt(), 0.12f), 12f).apply { pad(8, 3) })
        hr.addView(ctx.chip(if (s.goal.met) "今日目标 ✓" else "今日 ${fmt(s.goal.done)}/${s.goal.target}", if (s.goal.met) C.green else C.accent, if (s.goal.met) C.alpha(C.green, 0.12f) else C.selected, 12f).apply { pad(8, 3) },
            LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) })
        c.addView(hr)
        // 进度条
        val bar = android.widget.FrameLayout(ctx).apply { background = round(C.alpha(C.accent, 0.12f), dp(3).toFloat()) }
        val fill = View(ctx).apply { background = round(if (s.goal.met) C.green else C.accent, dp(3).toFloat()) }
        bar.addView(fill, android.widget.FrameLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.MATCH_PARENT))
        c.addView(bar, LinearLayout.LayoutParams(MATCH, dp(5)).apply { topMargin = dp(10) })
        bar.post { fill.layoutParams = fill.layoutParams.apply { width = (bar.width * minOf(1.0, s.goal.done / maxOf(1, s.goal.target))).toInt() }; fill.requestLayout() }
        // 一句话
        c.add(ctx.text(s.say, 17f, C.text, HEAVY).apply { setLineSpacing(0f, 1.3f) }, 12)
        val top = s.top
        if (top != null && top.kind != "course") {
            val tile = ctx.col().apply { pad(14, 12); bg(C.alpha(C.card, if (C.dark) 0.6f else 0.85f), 16, C.line) }
            tile.addView(ctx.text(top.title, 15.5f, C.text, BOLD, 2))
            val sub = listOf(top.reason, top.step).filter { it.isNotEmpty() }.joinToString(" · ")
            if (sub.isNotEmpty()) tile.add(ctx.text(sub, 12.5f, C.sub, lines = 2), 3)
            c.add(tile, 12)
            shown(top.key, s.style)
            val br = ctx.row().apply { margins(t = 12) }
            br.addView(ctx.button("▶ 开始 25 分钟", h = 42) {
                accept(top.key, s.style)
                Plan.start(if (top.kind == "pomo") "" else top.title)
                Background.pomoAlarm(a); a.push(PlanPage(a))
            }, LinearLayout.LayoutParams(0, dp(42), 1f))
            if (top.kind == "item") br.addView(ctx.soft("✓ 做完了") {
                accept(top.key, s.style); a.toggle(Items.find(top.key) ?: return@soft); refresh()
            }, LinearLayout.LayoutParams(WRAP, dp(42)).apply { leftMargin = dp(8) })
            if (top.kind == "item") br.addView(ctx.text("换一个", 13.5f, C.sub, SEMI).apply { gravity = Gravity.CENTER; pad(10, 0); tap { it.buzz(); Coach.skip(top.key); refresh() } },
                LinearLayout.LayoutParams(WRAP, dp(42)))
            c.addView(br)
        } else if (s.mode == "sleep" || s.mode == "rest") {
            c.add(ctx.text(if (s.mode == "sleep") "🌙 明天的事明天再说" else "🍵 休息也是计划的一部分", 13f, C.sub), 8)
        }
        // 5.9.4 刷任务：一张张小卡，上划下一张
        if (s.mode != "class" && s.mode != "sleep") c.add(ctx.col().apply {
            pad(16, 12)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF7C3AED.toInt(), 0xFFDB2777.toInt())).apply { cornerRadius = dp(16).toFloat() }
            lift(6, 0xFFDB2777.toInt())
            addView(ctx.text("🔥 刷任务", 16f, Color.WHITE, HEAVY))
            addView(ctx.text("一张张小卡，上划下一张 · 走完有机会掉宝贝", 12f, 0xD9FFFFFF.toInt()).apply { margins(t = 2) })
            springy(); tap { it.buzz(); a.push(FlowPage(a)) }
        }, 12)
        c.add(ctx.row().apply {
            addView(ctx.text("📊 本周复盘 · 你的节奏", 13f, C.accent, SEMI), LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(ctx.text("›", 18f, C.accent))
            pad(0, 10, 0, 0); tap { a.push(CoachPage(a)) }
        }, 4)
        body.addView(c)
    }
}

/** 教练页：每周复盘 + 你的节奏（几点状态最好）+ 设置和隐私 */
class CoachPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private fun guard() = guardSection(a, body) { render() }
    override fun onShow() { render() }     // 从系统设置里给完权限回来，刷新一下
    override fun build(): View = scaffold("捞捞教练") { body = it }
    private fun fmt(x: Double): String { val v = Math.round(x * 10) / 10.0; return if (v == Math.floor(v)) v.toLong().toString() else v.toString() }
    override fun render() {
        view; keepScroll(body)
        val now = System.currentTimeMillis()
        val m = Coach.model(); val r = Coach.weekly(m, now); val g = Coach.goal(m, now)
        body.addView(ctx.introCard("🧭", "捞捞教练", "在这台手机上学你的节奏：几点状态最好、作业习惯提前还是拖到最后、哪种提醒对你有用，然后推荐现在最适合做的事。"))
        // 本周
        body.addView(ctx.section("本周复盘", "和上周比"))
        val wk = ctx.row().apply { clipChildren = false }
        fun stat(n: String, unit: String, label: String, color: Int) = ctx.col().apply {
            gravity = Gravity.CENTER_HORIZONTAL; pad(8, 14); bg(C.card, 18, C.line); lift(3, C.text)
            addView(ctx.row().apply { gravity = Gravity.BOTTOM; addView(ctx.text(n, 26f, color, HEAVY)); addView(ctx.text(unit, 12f, C.sub).apply { pad(3, 0, 0, 4) }) })
            addView(ctx.text(label, 12f, C.sub).apply { margins(t = 2) })
        }
        wk.addView(stat(fmt(r.thisWeek.done), "件", "这周完成", C.accent), LinearLayout.LayoutParams(0, WRAP, 1f))
        wk.addView(stat(fmt(r.lastWeek.done), "件", "上周", C.sub), LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
        wk.addView(stat("${r.streak}", "天", "连续坚持", 0xFFE8590C.toInt()), LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
        body.addView(wk)
        if (r.highlights.isNotEmpty() || r.next.isNotEmpty()) {
            val c = ctx.card(16, 20).apply { margins(t = 12) }
            r.highlights.forEach { c.addView(ctx.text("✨ $it", 14.5f, C.text, SEMI).apply { setLineSpacing(0f, 1.35f); pad(0, 4) }) }
            if (r.next.isNotEmpty()) c.add(ctx.text("下周可以试试", 12.5f, C.sub, SEMI), if (r.highlights.isEmpty()) 0 else 10)
            r.next.forEach { c.addView(ctx.text("· $it", 14f, C.text).apply { setLineSpacing(0f, 1.35f); pad(0, 4) }) }
            body.addView(c)
        }
        // 你的节奏
        body.addView(ctx.section("你的节奏", "最近 60 天，越近的越算数"))
        val rc = ctx.card(16, 20)
        rc.addView(ctx.text(if (r.best.isNotEmpty()) "状态最好的时候：" + r.best.joinToString("、") { "$it:00" } else "再用几天，捞捞就能看出你几点状态最好", 14.5f, C.text, BOLD))
        rc.addView(HourBars(ctx, m.h, r.best), LinearLayout.LayoutParams(MATCH, dp(110)).apply { topMargin = dp(12) })
        rc.add(ctx.text("每天的小目标：${g.target} 件（最近每天一般完成 ${fmt(g.cap)} 件，目标只比它高一点点）", 12.5f, C.sub).apply { setLineSpacing(0f, 1.35f) }, 10)
        r.lead?.let { rc.add(ctx.text(if (it < 3) "⏰ 作业一般在截止前 ${fmt(it)} 小时才做完，试试提前一天开始" else "👍 作业一般提前 ${fmt(it)} 小时做完", 12.5f, C.sub), 6) }
        if (m.sus > 0) rc.add(ctx.text("🧐 最近有 ${m.sus} 次一口气勾了好几件、或者勾了又马上取消，这些只算了一部分。做完一件勾一件，记录才准，目标和连续天数也更有意义。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.35f) }, 6)
        body.addView(rc)
        // 5.9.4 收藏
        val bag = com.laolao.classcalendar.core.Flow.fullBag()
        body.addView(ctx.card(16, 20).apply {
            margins(t = 12)
            addView(ctx.row().apply {
                addView(ctx.text("🎁 捞捞的收藏", 15f, C.text, BOLD), LinearLayout.LayoutParams(0, WRAP, 1f))
                addView(ctx.text("${bag.owned()}/${com.laolao.classcalendar.core.Flow.LOOT.size} ›", 13.5f, C.accent, SEMI))
            })
            addView(ctx.text("在「刷任务」里每走完一张卡都有机会掉一样，有些能给捞捞戴上", 12.5f, C.sub).apply { margins(t = 4) })
            tap { a.push(FlowPage(a, onlyBook = true)) }
        })
        // 设置
        body.addView(ctx.section("设置"))
        val sc = ctx.card(10, 18)
        sc.addView(Toggle(ctx, "打开捞捞教练", "关掉后不再记录，首页也不显示教练卡片", Coach.on()) { v -> Coach.setOpt("asked", true); Coach.setOpt("on", v); Background.coach(a); render() }.apply { pad(6, 6) })
        if (Coach.on()) {
            sc.addView(ctx.hline()); sc.addView(Toggle(ctx, "到合适的时候提醒我", "状态最好的钟点、连续天数快断了、周日晚上复盘；一天最多 3 条，23 点到 7 点不打扰", Coach.opt("notify")) { v -> Coach.setOpt("notify", v); Background.coach(a) }.apply { pad(6, 6) })
            sc.addView(ctx.hline()); sc.addView(Toggle(ctx, "让捞捞说教练的话", "左下角的捞捞偶尔冒泡泡提醒现在适合做什么", Coach.opt("lao")) { v -> Coach.setOpt("lao", v) }.apply { pad(6, 6) })
        }
        body.addView(sc)
        guard()
        // 隐私
        body.addView(ctx.section("数据怎么用"))
        val pc = ctx.card(16, 20)
        listOf("🔒 几点完成了哪件事这些原始记录只存在这台手机，最多保留 60 天，不上传。",
            "☁ 跟着账号同步的只有统计数字（每个钟点的活跃度、每天完成几件、哪种提醒有用），没有标题和内容，换手机不用重新学。",
            "👥 「刷任务」时班里只能看到有几个人在专注、全班专注了多少分钟，看不到是谁、在做什么。",
            "🎮 「游戏前先做 5 分钟」只在手机上判断你打开了哪个 App，不记录、不上传你用了什么 App。",
            "🧠 所有计算都在手机上完成，不用大模型，不发给任何第三方。",
            "🗑 随时可以清空，清空后从头开始学。").forEach { pc.addView(ctx.text(it, 13f, C.sub).apply { setLineSpacing(0f, 1.4f); pad(0, 4) }) }
        pc.add(ctx.soft("清空学到的数据", C.dangerBg, C.red) { Dialogs.confirm(ctx, "清空捞捞教练学到的数据？", "这台手机的记录和云端的统计数字都会清掉，教练从头开始学。", "清空", danger = true) { Coach.clear(); a.toast("已清空"); render() } }, 12)
        body.addView(pc)
    }
}

/** 5.9.4「游戏前先做 5 分钟」的设置：开关 + 两个权限 + 选哪些 App */
private fun CoachPage.guardSection(a: Main, body: LinearLayout, again: () -> Unit) {
    val ctx: Context = a
    fun dp(v: Int) = a.dp(v)
    val G = com.laolao.classcalendar.work.Guard
    body.addView(ctx.section("游戏前先做 5 分钟", "只有安卓 App 能做"))
    val c = ctx.card(10, 18)
    c.addView(Toggle(ctx, "打开游戏时问我一句", "打开你选的 App 时，捞捞跳出来问「先做 5 分钟再玩？」。不锁游戏、不拦截，选「这次先玩」就 30 分钟内不再问", G.on()) { v ->
        G.setOn(a, v); if (v && (!G.hasUsage(a) || !G.hasOverlay(a))) a.toast("还要给下面两个权限才能用"); again()
    }.apply { pad(6, 6) })
    if (G.on()) {
        fun perm(title: String, sub: String, ok: Boolean, open: () -> Unit) {
            c.addView(ctx.hline())
            c.addView(ctx.row().apply {
                pad(6, 12)
                addView(ctx.col().apply {
                    addView(ctx.text(title, 14.5f, C.text, SEMI))
                    addView(ctx.text(sub, 12f, C.sub).apply { setLineSpacing(0f, 1.3f); margins(t = 2) })
                }, LinearLayout.LayoutParams(0, WRAP, 1f))
                addView(if (ok) ctx.chip("✓ 已允许", C.green, C.alpha(C.green, 0.12f), 12f).apply { pad(8, 4) }
                        else ctx.soft("去允许", C.selected, C.accent) { open() }, LinearLayout.LayoutParams(WRAP, if (ok) WRAP else dp(36)).apply { leftMargin = dp(8) })
            })
        }
        perm("使用情况访问权限", "知道你打开了哪个 App（只在手机上判断，不记录、不上传）", G.hasUsage(a)) { G.openUsage(a) }
        perm("显示在其他应用上层", "才能在游戏上面弹出那一句", G.hasOverlay(a)) { G.openOverlay(a) }
        val chosen = G.apps(a)
        c.addView(ctx.hline())
        c.addView(ctx.row().apply {
            pad(6, 12)
            addView(ctx.col().apply {
                addView(ctx.text("哪些 App 打开时问", 14.5f, C.text, SEMI))
                addView(ctx.text(if (chosen.isEmpty()) "还没选（手机没认出游戏）" else chosen.take(4).joinToString("、") { G.label(a, it) } + if (chosen.size > 4) " 等 ${chosen.size} 个" else "", 12f, C.sub, lines = 2).apply { margins(t = 2) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(ctx.text("选择 ›", 13.5f, C.accent, SEMI).apply { pad(8, 0, 0, 0) })
            tap { pickApps(a, again) }
        })
        val (ask, yes) = G.stat()
        if (ask > 0) { c.addView(ctx.hline()); c.addView(ctx.text("今天问了 $ask 次，$yes 次你选了先做事 👍", 12.5f, C.sub).apply { pad(6, 10) }) }
        G.ensure(a)
    }
    body.addView(c)
}

private fun pickApps(a: Main, done: () -> Unit) {
    val G = com.laolao.classcalendar.work.Guard
    Bg.load({ G.launchable(a).map { Triple(it.first, G.label(a, it.first), it.second) }.sortedWith(compareBy<Triple<String, String, Boolean>>({ !it.third }, { it.second })) }) { list, _ ->
        val sel = G.apps(a).toMutableSet()
        val ctx: Context = a
        val box = ctx.col().apply { pad(18, 18, 18, 10) }
        box.addView(ctx.text("打开哪些 App 时问一句", 17f, C.text, HEAVY))
        box.addView(ctx.text("标了 🎮 的是手机认出来的游戏。改完点外面就保存。", 12.5f, C.sub).apply { pad(0, 4, 0, 8) })
        val lst = ctx.col()
        (list ?: emptyList()).forEach { (p, name, game) ->
            lst.addView(Toggle(ctx, (if (game) "🎮 " else "") + name, "", p in sel) { v -> if (v) sel += p else sel -= p; G.setApps(sel) }.apply { pad(4, 2) })
        }
        box.addView(InnerScroll(ctx, a.dp(420)).apply { addView(lst) })
        Dialogs.show(a, box, bottom = true).setOnDismissListener { G.setApps(sel); done() }
    }
}

/** 24 小时的活跃度柱子（7 点到 23 点），状态最好的两个钟点高亮 */
class HourBars(ctx: Context, private val h: DoubleArray, private val best: List<Int>) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG); private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    override fun onDraw(c: Canvas) {
        val d = resources.displayMetrics.density; val hours = (7..23).toList()
        val max = maxOf(0.0001, hours.maxOf { h[it] }); val bw = width.toFloat() / hours.size; val base = height - 16 * d
        tp.textSize = 9.5f * d; tp.color = C.sub
        hours.forEachIndexed { i, hr ->
            val v = (h[hr] / max).toFloat(); val top = base - maxOf(2 * d, v * (base - 4 * d))
            p.color = if (hr in best) C.accent else C.alpha(C.accent, 0.28f)
            c.drawRoundRect(RectF(i * bw + bw * 0.18f, top, (i + 1) * bw - bw * 0.18f, base), 3 * d, 3 * d, p)
            if (hr % 3 == 0 || hr in best) c.drawText("$hr", i * bw + bw / 2, height - 3 * d, tp)
        }
    }
}
