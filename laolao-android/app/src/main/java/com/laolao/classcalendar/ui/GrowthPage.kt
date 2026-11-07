package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Growth
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.Sync
import com.laolao.classcalendar.core.T

/**
 * 7.x 成长（底部标签）重新设计：以「你自己」为中心，只和昨天的自己比。
 * 从上到下回答四个问题：
 *  ① 今天的我怎么样？（今天完成几件事、打了几个卡、专注了几个番茄 + 一句话 + 开始专注）
 *  ② 我每天要坚持的小习惯（一行一个，右边大圆圈一点就打卡；新习惯从底部弹出来加，不再堆在页面里）
 *  ③ 我这段时间的节奏（这周比上周、三个进度环、14 天趋势、本周复盘）
 *  ④ 我做到了什么（最近完成的事）
 * 等级、徽章、云宠、班级排行榜、位置签到收进最下面「更多」：想看再点，不抢你的注意力。
 */
class GrowthPage(a: Main) : Page(a) {
    private var rankMe: Pair<Int, Int>? = null; private var rankAt = 0L
    private lateinit var body: LinearLayout
    private var allDone = false
    lateinit var fab: Fab
    private val green get() = if (C.dark) C.c("#82bea1") else C.c("#39856a")

    override fun build(): View {
        val f = FrameLayout(ctx).apply { setBackgroundColor(C.bg) }
        val ps = PullScroll(ctx) { done -> a.refreshSoon(force = true) { done() } }
        body = ps.content.apply { pad(18, 14, 18, 110) }
        f.addView(ps, FrameLayout.LayoutParams(MATCH, MATCH))
        fab = Fab(a, f) {
            listOf(FabItem("🔥", "添加一个习惯") { addHabit() },
                FabItem("🍅", "开始专注") { a.push(PlanPage(a, pomo = true)) },
                FabItem("✏️", "记一件事") { a.push(EditPage(a, null)) })
        }
        a.fabs += fab
        return f
    }

    override fun render() {
        view
        keepScroll(body)
        header()
        checkinBanner()
        today()
        habits()
        rhythm()
        done()
        more()
        body.add(ctx.text(if (Sync.state != "off") "打卡和完成记录已同步到你的账号，网页、小程序也能看到" else "打卡和完成记录保存在这台手机上", 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 18)
    }

    // ---------- 标题：成长 + 一句话，右上角等级 ----------
    private fun header() {
        val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(4, 8, 2, 4) }
        val name = Store.name()
        r.addView(ctx.col().apply {
            addView(ctx.text("成长", 27f, C.text, HEAVY))
            addView(ctx.text((if (name.isNotEmpty()) "$name，" else "") + "只和昨天的自己比", 13f, C.sub).apply { margins(t = 4) })
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        com.laolao.classcalendar.core.Level.me()?.let { l ->
            r.addView(ctx.row().apply {
                gravity = Gravity.CENTER_VERTICAL; pad(12, 7); press(C.card, 18, C.line)
                addView(ctx.text("Lv.${l.level}", 14f, C.c("#ff7a45"), HEAVY))
                addView(ctx.text(" " + l.title, 13f, C.sub, SEMI, 1))
                tap { a.push(MetaPage(a)) }
            })
        }
        body.addView(r)
    }

    // ---------- 正在签到：只有在签到时才出现 ----------
    private fun checkinBanner() {
        if (Store.cls == null) return
        com.laolao.classcalendar.core.Checkin.peek { render() }
        val o = com.laolao.classcalendar.core.Checkin.open ?: return
        if (o.optJSONObject("mine") != null) return
        body.add(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(14, 12); press(C.dangerBg, 16)
            addView(Ic.tile(ctx, "📍", 36), LinearLayout.LayoutParams(dp(36), dp(36)))
            addView(ctx.col().apply {
                addView(ctx.text("正在签到：" + o.optString("title").ifEmpty { "位置签到" }, 15f, C.red, BOLD, 1))
                addView(ctx.text("还剩 " + com.laolao.classcalendar.core.Checkin.leftText(o) + " · 到了现场点这里签到", 12.5f, C.sub, lines = 1))
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(12) })
            addView(ctx.text("›", 20f, C.red))
            tap { a.push(CheckinPage(a)) }
        }, 12)
    }

    // ---------- ① 今天的我 ----------
    private fun today() {
        val h = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(20, 18, 20, 16) }
        h.layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(14) }
        h.addView(ctx.text("今天的我", 13f, C.accent, BOLD))
        val hs = Growth.habits(); val lg = Growth.log()
        val checked = hs.count { Growth.checked(it.id) }
        val doneN = Growth.trend(1).firstOrNull()?.second ?: 0
        val pomo = Plan.today()
        val stats = ctx.row().apply { margins(t = 12) }
        fun stat(n: String, unit: String, label: String, color: Int) = stats.addView(ctx.col().apply {
            addView(ctx.row().apply {
                gravity = Gravity.BOTTOM
                addView(ctx.text(n, 30f, color, HEAVY))
                addView(ctx.text(unit, 13f, C.sub, SEMI).apply { pad(3, 0, 0, 5) })
            })
            addView(ctx.text(label, 12.5f, C.sub))
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        stat("$doneN", "件", "完成的事", C.heroText)
        stat(if (hs.isEmpty()) "–" else "$checked", if (hs.isEmpty()) "" else "/ ${hs.size}", "习惯打卡", green)
        stat("$pomo", "个", "专注番茄", C.c("#e0603c"))
        h.addView(stats)
        val left = hs.size - checked
        val say = when {
            hs.isNotEmpty() && left == 0 -> "今天的习惯全部打卡了，给自己点个赞"
            hs.isNotEmpty() && left <= 2 && checked > 0 -> "还差 $left 个习惯，今天就全勤了"
            doneN + pomo + checked == 0 -> "从一件小事开始就好，不用一下子做很多"
            pomo == 0 -> "做得不错。想更专注一点，可以来一个 25 分钟番茄"
            else -> "今天已经专注了 $pomo 个番茄，记得起来走走"
        }
        h.add(ctx.text(say, 14f, C.alpha(C.heroText, 0.75f)).apply { setLineSpacing(0f, 1.3f) }, 12)
        // 专注：正在专注就显示还剩多久，没在专注就是一个「开始」
        val p = Plan.pomo(); val (rest, _) = Plan.left()
        val fr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 14); pad(12, 10, 10, 10); press(C.alpha(C.card, if (C.dark) 0.6f else 0.85f), 16) }
        fr.addView(Ic.tile(ctx, "🍅", 36), LinearLayout.LayoutParams(dp(36), dp(36)))
        fr.addView(ctx.col().apply {
            addView(ctx.text(when (p.mode) { "focus" -> "专注中 · 还剩 " + Plan.fmt(rest); "break" -> "休息一下 · " + Plan.fmt(rest); "paused" -> "专注暂停了 · " + Plan.fmt(rest); else -> "专注一会儿" }, 15f, if (p.mode == "focus") C.accent else C.text, BOLD, 1))
            addView(ctx.text("本周 ${Plan.week()} 个番茄 · 点开排四象限", 12.5f, C.sub, lines = 1).apply { margins(t = 1) })
        }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(11) })
        if (p.mode == "idle" || p.mode.isEmpty()) fr.addView(ctx.text("开始", 14f, Color.WHITE, BOLD).apply {
            gravity = Gravity.CENTER; pad(16, 8); press(C.accent, 18, ripple = C.alpha(Color.WHITE, 0.3f)); tap { a.push(PlanPage(a, pomo = true)) }
        }) else fr.addView(ctx.text("›", 20f, C.mutedText))
        fr.tap { a.push(PlanPage(a, pomo = p.mode != "idle" && p.mode.isNotEmpty())) }
        h.addView(fr)
        body.addView(h)
    }

    // ---------- ② 每天的小习惯 ----------
    private fun habits() {
        val hr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(4, 26, 2, 10) }
        hr.addView(ctx.col().apply {
            addView(ctx.text("每天的小习惯", 19f, C.text, HEAVY))
            addView(ctx.text("一点一点来，坚持比完美重要", 12.5f, C.sub).apply { margins(t = 2) })
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("＋ 新习惯", 13f, C.accent, SEMI).apply { pad(12, 7); press(C.selected, 16); tap { addHabit() } })
        body.addView(hr)
        val hs = Growth.habits(); val lg = Growth.log()
        val c = ctx.card(4, 20)
        if (hs.isEmpty()) {
            c.addView(ctx.text("还没有习惯。挑一个开始吧：", 14f, C.sub).apply { pad(14, 14, 14, 4) })
            val fl = FlowRow(ctx, dp(8), dp(8)).apply { pad(14, 6, 14, 14) }
            for ((e, n) in Growth.SUGG) fl.addView(ctx.row().apply {
                gravity = Gravity.CENTER_VERTICAL; pad(10, 7); press(C.mutedBg, 16)
                addView(Ic.plain(ctx, e, 15), LinearLayout.LayoutParams(dp(15), dp(15)).apply { rightMargin = dp(6) })
                addView(ctx.text(n, 13.5f, C.text, SEMI))
                tap { Growth.add(n, e); render() }
            })
            c.addView(fl)
        }
        val wk = listOf("一", "二", "三", "四", "五", "六", "日")
        val t0 = T.todayKey()
        hs.forEachIndexed { i, h ->
            if (i > 0) c.addView(ctx.hline().apply { (layoutParams as LinearLayout.LayoutParams).leftMargin = dp(66) })
            val on = Growth.checked(h.id)
            val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(12, 12, 10, 12); press(C.card, 0); tap { more(h) }; setOnLongClickListener { it.buzz(); more(h); true } }
            r.addView(Ic.tile(ctx, h.icon, 42), LinearLayout.LayoutParams(dp(42), dp(42)))
            val col = ctx.col()
            val nm = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL }
            nm.addView(ctx.text(h.name, 15.5f, C.text, BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f).apply { width = WRAP; weight = 0f })
            Growth.place(h.id)?.let { nm.addView(Ic.plain(ctx, "📍", 13, C.sub), LinearLayout.LayoutParams(dp(13), dp(13)).apply { leftMargin = dp(5) }) }
            col.addView(nm)
            // 这一周（周一到周日）每天打没打：小圆点，今天带圈
            val cells = Growth.cells(h.id, 7, lg)
            val week = (0..6).map { k -> T.addDays(t0, (k - 6).toLong()) }
            val dots = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 6) }
            week.forEachIndexed { k, d ->
                val hit = cells[k]
                dots.addView(ctx.text(wk[((T.date(d)?.dayOfWeek?.value ?: 1) - 1)], 9.5f, if (hit) Color.WHITE else C.mutedText, BOLD).apply {
                    gravity = Gravity.CENTER; includeFontPadding = false
                    background = round(if (hit) green else C.alpha(C.text, 0.06f), dp(9).toFloat(), if (d == t0) C.alpha(green, 0.9f) else 0, if (d == t0) dp(1) else 0)
                }, LinearLayout.LayoutParams(dp(18), dp(18)).apply { rightMargin = dp(4) })
            }
            val sk = Growth.streak(h.id, lg)
            dots.addView(ctx.text(if (sk > 1) "连续 $sk 天" else if (on) "今天打卡了" else "", 12f, if (sk > 1) C.c("#e0603c") else C.sub, SEMI).apply { pad(4, 0, 0, 0) })
            col.addView(dots)
            r.addView(col, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(12) })
            // 打卡：右边大圆圈
            r.addView(FrameLayout(ctx).apply {
                background = round(if (on) green else 0, dp(21).toFloat(), if (on) 0 else C.alpha(green, 0.55f), if (on) 0 else dp(2))
                addView(ctx.text("✓", 19f, if (on) Color.WHITE else C.alpha(green, 0.55f), HEAVY).apply { gravity = Gravity.CENTER; includeFontPadding = false }, FrameLayout.LayoutParams(MATCH, MATCH))
                contentDescription = if (on) "取消打卡" else "打卡"
                tap { v -> v.buzz(); v.animate().scaleX(0.85f).scaleY(0.85f).setDuration(90).withEndAction { v.animate().scaleX(1f).scaleY(1f).setDuration(150).start() }.start()
                    HabitPlace.toggle(a, h.id) { now -> if (now) Cheer.show(a, "habit", "「${h.name}」连续 ${Growth.streak(h.id)} 天"); render() } }
            }, LinearLayout.LayoutParams(dp(42), dp(42)).apply { leftMargin = dp(8) })
            c.addView(r)
        }
        body.addView(c)
    }

    /** 加新习惯：从底部弹出来（名字、图标、建议） */
    private fun addHabit() {
        var icon = Growth.EMO[0]
        val box = ctx.col().apply { pad(20, 18, 20, 22) }
        box.addView(ctx.text("新习惯", 18f, C.text, HEAVY))
        box.addView(ctx.text("小一点更容易坚持，比如「背 10 个单词」", 12.5f, C.sub).apply { margins(t = 3) })
        val ed = ctx.input("习惯叫什么", "").apply { filters = arrayOf(android.text.InputFilter.LengthFilter(16)); setSingleLine(true) }
        box.add(ed, 14)
        box.add(ctx.text("选个图标", 13f, C.sub, SEMI), 14)
        val grid = FlowRow(ctx, dp(8), dp(8)).apply { margins(t = 8) }
        val tiles = mutableListOf<View>()
        fun paint() { tiles.forEachIndexed { k, v -> v.background = round(if (Growth.EMO[k] == icon) C.selected else C.mutedBg, dp(12).toFloat(), if (Growth.EMO[k] == icon) C.accent else 0, if (Growth.EMO[k] == icon) dp(2) else 0) } }
        for (e in Growth.EMO) {
            val f = FrameLayout(ctx).apply { addView(Ic.plain(ctx, e, 20), FrameLayout.LayoutParams(dp(20), dp(20), Gravity.CENTER)); tap { icon = e; paint() } }
            tiles += f; grid.addView(f, android.view.ViewGroup.LayoutParams(dp(42), dp(42)))
        }
        paint(); box.addView(grid)
        val hs = Growth.habits()
        val sugg = Growth.SUGG.filter { s -> hs.none { it.name == s.second } }
        if (sugg.isNotEmpty()) {
            box.add(ctx.text("或者直接选一个", 13f, C.sub, SEMI), 16)
            val sr = ctx.row().apply { margins(t = 8) }
            for ((e, n) in sugg) sr.addView(ctx.text(n, 13f, C.text, SEMI).apply { pad(11, 7); press(C.mutedBg, 16); tap { ed.setText(n); ed.setSelection(n.length); icon = e; paint() } },
                LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
            box.addView(HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(sr) })
        }
        lateinit var d: android.app.Dialog
        box.add(ctx.button("加上") {
            val n = ed.text.toString().trim()
            if (n.isEmpty()) { a.toast("写一下新习惯叫什么"); return@button }
            if (!Growth.add(n, icon)) { a.toast("已经有「$n」了"); return@button }
            Dialogs.hideKeyboard(ed); d.dismiss(); a.toast("加好了，今天就开始吧"); render()
        }, 20)
        d = Dialogs.show(ctx, box, bottom = true)
        ed.requestFocus(); Dialogs.showKeyboard(ed)
    }

    // ---------- ③ 我的节奏 ----------
    private fun rhythm() {
        body.addView(ctx.col().apply {
            pad(4, 26, 2, 10)
            addView(ctx.text("我的节奏", 19f, C.text, HEAVY))
            addView(ctx.text("最近两周，每天完成的事和打卡", 12.5f, C.sub).apply { margins(t = 2) })
        })
        val c = ctx.card(16, 20)
        val tr = Growth.trend(14)
        val now = tr.takeLast(7).sumOf { it.second + it.third }; val prev = tr.take(7).sumOf { it.second + it.third }
        val top = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(ctx.col().apply {
            addView(ctx.row().apply {
                gravity = Gravity.BOTTOM
                addView(ctx.text("$now", 28f, C.text, HEAVY))
                addView(ctx.text("次", 13f, C.sub, SEMI).apply { pad(3, 0, 0, 5) })
            })
            addView(ctx.text("最近 7 天完成 + 打卡", 12.5f, C.sub))
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        val diff = now - prev
        val (txt, fg, bgc) = when {
            prev == 0 && now == 0 -> Triple("这周从今天开始", C.sub, C.mutedBg)
            diff > 0 -> Triple("比上周多 $diff 次", green, C.alpha(green, 0.12f))
            diff < 0 -> Triple("比上周少 ${-diff} 次，没关系", C.sub, C.mutedBg)
            else -> Triple("和上周一样稳", C.accent, C.selected)
        }
        top.addView(ctx.text(txt, 12.5f, fg, BOLD).apply { pad(10, 5); bg(bgc, 12) })
        c.addView(top)
        // 三个进度环（本周作业 / 本周事项 / 今日打卡）
        val rr = ctx.row().apply { margins(t = 16) }
        for (r in Growth.rings(C.red, C.accent, green)) {
            rr.addView(ctx.row().apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(RingView(ctx, r.done, r.total, r.color, small = true), LinearLayout.LayoutParams(dp(40), dp(40)))
                addView(ctx.col().apply {
                    addView(ctx.text(r.label.replace("本周", "").replace("今日", ""), 12.5f, C.text, BOLD, 1))
                    addView(ctx.text("${r.done}/${r.total}", 11.5f, C.sub))
                }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(7) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        c.addView(rr)
        c.add(ctx.hline(), 16)
        val lg = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 12) }
        lg.addView(View(ctx).apply { bg(C.accent, 2) }, LinearLayout.LayoutParams(dp(12), dp(4)))
        lg.addView(ctx.text("完成的事", 12f, C.sub).apply { pad(6, 0, 14, 0) })
        lg.addView(View(ctx).apply { bg(green, 2) }, LinearLayout.LayoutParams(dp(12), dp(4)))
        lg.addView(ctx.text("打卡", 12f, C.sub).apply { pad(6, 0, 0, 0) })
        c.addView(lg)
        c.add(TrendChart(ctx, tr, C.accent, green), 6)
        c.add(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(0, 10, 0, 0)
            addView(Ic.plain(ctx, "📊", 15, C.accent), LinearLayout.LayoutParams(dp(15), dp(15)))
            addView(ctx.text("看看本周复盘", 13.5f, C.accent, SEMI).apply { pad(7, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(ctx.text("›", 18f, C.accent))
            tap { a.push(CoachPage(a)) }
        }, 4)
        body.addView(c)
    }

    // ---------- ④ 我做到的 ----------
    private fun done() {
        val rd = Growth.recentDone(30)
        if (rd.isEmpty()) return
        val total = rd.sumOf { it.second.size }
        body.addView(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(4, 26, 2, 10)
            addView(ctx.col().apply {
                addView(ctx.text("我做到的", 19f, C.text, HEAVY))
                addView(ctx.text("最近完成了 $total 件事", 12.5f, C.sub).apply { margins(t = 2) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f))
        })
        val c = ctx.card(16, 20)
        var shown = 0
        for ((i, pair) in rd.withIndex()) {
            val (d, list) = pair
            if (!allDone && (i >= 3 || shown >= 8)) break
            val n = T.dayDiff(d)
            c.add(ctx.text(if (n == 0L) "今天" else if (n == -1L) "昨天" else T.md(d) + " " + T.wk(d), 12.5f, C.sub, BOLD), if (i == 0) 0 else 14)
            for (r in list) {
                if (!allDone && shown >= 8) break
                c.add(ctx.row().apply {
                    gravity = Gravity.CENTER_VERTICAL
                    addView(ctx.text("✓", 12f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; includeFontPadding = false; background = round(C.alpha(green, 0.85f), dp(9).toFloat()) }, LinearLayout.LayoutParams(dp(18), dp(18)))
                    addView(ctx.text(r.title, 14.5f, C.text, lines = 1).apply { pad(10, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
                }, 8)
                shown++
            }
        }
        if (total > shown || allDone) c.add(ctx.text(if (allDone) "收起" else "查看全部 $total 件", 13.5f, C.accent, SEMI).apply { pad(0, 6); tap { allDone = !allDone; render() } }, 10)
        body.addView(c)
    }

    // ---------- 更多：等级、徽章、云宠、排行榜、签到（想看再点） ----------
    private fun more() {
        body.addView(ctx.text("更多", 15f, C.sub, BOLD).apply { pad(6, 26, 2, 10) })
        val c = ctx.card(4, 20)
        fun row(icon: String, title: String, sub: String, go: () -> Unit) {
            if (c.childCount > 0) c.addView(ctx.hline().apply { (layoutParams as LinearLayout.LayoutParams).leftMargin = dp(60) })
            c.addView(ctx.row().apply {
                gravity = Gravity.CENTER_VERTICAL; pad(12, 12); press(C.card, 0); tap { go() }
                addView(Ic.tile(ctx, icon, 36), LinearLayout.LayoutParams(dp(36), dp(36)))
                addView(ctx.col().apply {
                    addView(ctx.text(title, 15f, C.text, SEMI, 1))
                    if (sub.isNotEmpty()) addView(ctx.text(sub, 12.5f, C.sub, lines = 1).apply { margins(t = 1) })
                }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(12) })
                addView(ctx.text("›", 20f, C.mutedText))
            })
        }
        val l = com.laolao.classcalendar.core.Level.me()
        if (Store.me != null) row("⭐", if (l != null) "等级 Lv.${l.level} · ${l.title}" else "账号等级", if (l != null) "今天 +${com.laolao.classcalendar.core.Level.today()} 经验 · 再攒 ${l.need} 升级" else "完成事项、打卡、专注都能攒经验") {
            if (Store.cls != null) a.push(RankPage(a, level = true)) else a.push(MetaPage(a))
        }
        row("🏅", "徽章", "解锁了哪些成就") { a.push(MetaPage(a)) }
        if (com.laolao.classcalendar.core.Farm.on()) row("🐣", "云宠 Lv." + com.laolao.classcalendar.core.Farm.state().optInt("level", 1), "用打卡攒的养料喂它") { a.push(FarmPage(a)) }
        val cls = Store.cls
        if (cls != null && Store.feat("rank")) {
            val me = rankMe
            row("🏆", "班级排行榜", if (me != null && me.second > 0) "这周第 ${me.second} 名 · ${me.first} 成长值" else "想和同学比一比时再来看") { a.push(RankPage(a)) }
            if (System.currentTimeMillis() - rankAt > 300_000) { rankAt = System.currentTimeMillis()
                com.laolao.classcalendar.core.Bg.load({ com.laolao.classcalendar.core.Api.rpcObj("growth_board", com.laolao.classcalendar.core.jsonOf("cid" to cls.optString("id"), "period" to "week")) }) { d, _ ->
                    val r = d?.optJSONArray("rows")?.let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } }?.firstOrNull { it.optBoolean("me") }
                    if (r != null) { rankMe = r.optInt("points") to r.optInt("rank"); com.laolao.classcalendar.core.Island.rankMe = rankMe; render() }
                } }
        }
        if (cls != null) row("📍", "班级位置签到", "班委发起，到了现场才能签") { a.push(CheckinPage(a)) }
        body.addView(c)
    }

    private fun more(h: Growth.Habit) {
        val pl = Growth.place(h.id)
        Dialogs.sheet(ctx, h.name, listOf("换个图标", "改名字", if (pl != null) "打卡地点：${pl.optString("name")}（改 / 解除）" else "绑定打卡地点（到了才能打卡）", "删除这个习惯"), danger = setOf(3)) { i ->
            when (i) {
                0 -> Dialogs.sheet(ctx, "选一个图标", Growth.EMO) { j -> Growth.update(h.id, icon = Growth.EMO[j]); render() }
                1 -> Dialogs.prompt(ctx, "改名字", h.name, "比如：背 30 个单词") { v -> if (v.isNotBlank()) { Growth.update(h.id, name = v); render() } }
                2 -> HabitPlace.menu(a, h)
                3 -> Dialogs.confirm(ctx, "删除「${h.name}」？", "它的打卡记录也会一起删掉。", "删除", danger = true) { Growth.remove(h.id); render() }
            }
        }
    }
}

/** 进度环 */
class RingView(ctx: Context, private val done: Int, private val total: Int, private val color: Int, private val small: Boolean = false) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = HEAVY }
    override fun onDraw(c: Canvas) {
        val d = resources.displayMetrics.density; val w = (if (small) 4.5f else 7f) * d
        val r = RectF(w / 2, w / 2, width - w / 2, height - w / 2)
        p.strokeWidth = w; p.color = C.alpha(C.text, 0.08f); c.drawArc(r, 0f, 360f, false, p)
        if (total > 0 && done > 0) { p.color = color; c.drawArc(r, -90f, 360f * done / total, false, p) }
        tp.textSize = (if (small) 10.5f else 16f) * d; tp.color = C.text
        c.drawText(if (total > 0) "${done * 100 / total}%" else "–", width / 2f, height / 2f + (if (small) 3.7f else 5.5f) * d, tp)
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
