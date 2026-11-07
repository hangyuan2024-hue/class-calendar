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
import android.widget.TextView
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Growth
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.Sync
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.str

/**
 * 7.x 成长（底部标签）重新设计：以「你自己」为中心，只和昨天的自己比。
 * 从上到下回答四个问题：
 *  ① 今天的我怎么样？（今天完成几件事、打了几个卡、专注了几个番茄 + 一句话 + 开始专注）
 *  ② 我每天要坚持的小习惯（一行一个，右边大圆圈一点就打卡；新习惯从底部弹出来加，不再堆在页面里）
 *  ③ 我这段时间的节奏（这周比上周、三个进度环、14 天趋势、本周复盘）
 *  ④ 我做到了什么（最近完成的事）
 * 等级和班级排行榜合成右上角一个按钮（点开排行榜，里面有本周 / 本月 / 总榜 / 等级）；徽章、云宠、签到在最下面一行。
 */
class GrowthPage(a: Main) : Page(a) {
    private var rankMe: Pair<Int, Int>? = null; private var rankAt = 0L
    private lateinit var body: LinearLayout
    private lateinit var ps: PullScroll
    private var habitsAt: View? = null
    /** 点「今天的我」里的数字：滚到对应的那一块 */
    private fun jump(v: View?) { v ?: return; ps.scroll.smoothScrollTo(0, maxOf(0, v.top - dp(8))) }
    lateinit var fab: Fab
    private val green get() = if (C.dark) C.c("#82bea1") else C.c("#39856a")

    override fun build(): View {
        val f = FrameLayout(ctx).apply { setBackgroundColor(C.bg) }
        ps = PullScroll(ctx) { done -> a.refreshSoon(force = true) { done() } }
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

    private var tab = 0            // 0 我的 / 1 班级
    private var cPeriod = 0        // 班级榜：0 本周 / 1 本月 / 2 总共
    private var board: org.json.JSONObject? = null; private var boardKey = ""; private var boardErr = ""

    override fun render() {
        view
        keepScroll(body)
        topBar()
        if (tab == 1 && Store.cls != null) { classView(); return }
        header()
        checkinBanner()
        today()
        habits()
        rhythm()
        more()
    }

    // ---------- 最上面：我的 / 班级 切换（没加入班级就只有「我的」） ----------
    private fun topBar() {
        if (Store.cls == null) { tab = 0; body.addView(View(ctx), LinearLayout.LayoutParams(MATCH, dp(18))); return }
        val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(0, 22, 0, 4) }
        r.addView(Seg(ctx, listOf("我的", "班级"), tab) { i -> tab = i; render() }.apply {
            for (k in 0 until childCount) (getChildAt(k) as? TextView)?.apply { textSize = 14.5f; pad(22, 7) }
        }, LinearLayout.LayoutParams(WRAP, WRAP))
        body.addView(r)
    }

    // ---------- 班级情况：概况 + 排行 + 班级里的事（签到、课堂互动、班级墙） ----------
    private fun classView() {
        val cls = Store.cls ?: return
        val per = listOf("week", "month", "all"); val P = listOf("本周", "本月", "总共")[cPeriod]
        val key = cls.str("id") + per[cPeriod]
        if (boardKey != key) { boardKey = key; board = null; boardErr = ""
            com.laolao.classcalendar.core.Bg.load({ com.laolao.classcalendar.core.Api.rpcObj("growth_board", com.laolao.classcalendar.core.jsonOf("cid" to cls.str("id"), "period" to per[cPeriod])) }) { d, e ->
                if (boardKey != key) return@load
                if (d == null) boardErr = e?.message ?: "加载失败" else board = d
                if (tab == 1 && view.isAttachedToWindow) render()
            } }
        val x = board
        val cl = x?.optJSONObject("class") ?: org.json.JSONObject()
        // 概况
        val h = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(16, 14, 16, 14) }
        h.layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(10) }
        h.addView(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(ctx.text(cls.str("nickname").ifEmpty { cls.str("name") }, 16f, C.heroText, HEAVY, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(Seg(ctx, listOf("本周", "本月", "总共"), cPeriod) { i -> cPeriod = i; render() }.apply { for (k in 0 until childCount) (getChildAt(k) as? TextView)?.apply { textSize = 12.5f; pad(10, 4) } })
        })
        val stats = ctx.row().apply { margins(t = 12) }
        fun stat(n: String, label: String, color: Int) = stats.addView(ctx.col().apply {
            addView(ctx.text(n, 24f, color, HEAVY)); addView(ctx.text(label, 12f, C.sub))
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        val rate = if (cl.isNull("hw_rate") || !cl.has("hw_rate")) -1 else cl.optInt("hw_rate")
        stat(if (x == null) "–" else "${cl.optInt("points")}", "${P}成长值", C.heroText)
        stat(if (rate >= 0) "$rate%" else "–", "作业完成率", green)
        stat(if (x == null) "–" else "${cl.optInt("active")}/${cl.optInt("members")}", "活跃的人", C.c("#e0603c"))
        h.addView(stats)
        // 班级里的事：一排三个
        val acts = ctx.row().apply { margins(t = 12) }
        fun tile(icon: String, t: String, sub: String, hot: Boolean, go: () -> Unit) = acts.addView(ctx.col().apply {
            gravity = Gravity.CENTER_HORIZONTAL; pad(4, 9); press(if (hot) C.dangerBg else C.alpha(C.card, if (C.dark) 0.6f else 0.85f), 13); tap { go() }
            addView(Ic.tile(ctx, icon, 30), LinearLayout.LayoutParams(dp(30), dp(30)))
            addView(ctx.text(t, 13f, if (hot) C.red else C.text, BOLD, 1).apply { margins(t = 4) })
            addView(ctx.text(sub, 11f, C.sub, lines = 1))
        }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (acts.childCount > 0) leftMargin = dp(8) })
        val ck = com.laolao.classcalendar.core.Checkin.open; val open = ck != null && ck.optJSONObject("mine") == null
        tile("📍", if (open) "去签到" else "签到", if (open) "还剩 " + com.laolao.classcalendar.core.Checkin.leftText(ck!!) else if (ck != null) "已签到" else "现在没有", open) { a.push(CheckinPage(a)) }
        actPeek(); val ac = act
        tile("⚡", if (ac?.third == "rush") "快去抢答" else "课堂互动", ac?.first ?: "抢答 · 评分", ac != null) { a.push(ActPage(a, ac?.third ?: "rush")) }
        if (Store.feat("wall")) tile("💬", "班级墙", "通知和讨论", false) { a.push(WallPage(a)) }
        else tile("👥", "成员", "同学和老师", false) { a.push(PeoplePage(a)) }
        h.addView(acts)
        body.addView(h)
        // 排行
        val hr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(4, 16, 2, 6) }
        hr.addView(ctx.text("${P}排行", 16f, C.text, HEAVY), LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("完整榜单 ›", 13f, C.accent, SEMI).apply { pad(8, 4); tap { a.push(RankPage(a, level = false)) } })
        body.addView(hr)
        val c = ctx.card(4, 18)
        if (!Store.feat("rank")) c.addView(ctx.text("排行榜现在关闭了", 14f, C.sub).apply { pad(14, 16) })
        else if (x == null) c.addView(ctx.text(boardErr.ifEmpty { "加载中…" }, 14f, if (boardErr.isNotEmpty()) C.red else C.sub).apply { pad(14, 16) })
        else {
            val rows = (x.optJSONArray("rows")?.let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } ?: emptyList())
            if (rows.isEmpty()) c.addView(ctx.text("${P}还没有人上榜：完成一项作业、打个卡，就能攒成长值", 14f, C.sub).apply { pad(14, 16) })
            val mine = rows.firstOrNull { it.optBoolean("me") }
            val show = rows.take(8).toMutableList().also { l -> if (mine != null && mine !in l) l += mine }
            val top = maxOf(1, rows.firstOrNull()?.optInt("points") ?: 1)
            show.forEachIndexed { i, r ->
                if (i > 0) c.addView(ctx.hline().apply { (layoutParams as LinearLayout.LayoutParams).leftMargin = dp(56) })
                val anon = r.optBoolean("anon") && !x.optBoolean("teacher") && !r.optBoolean("me")
                val rk = r.optInt("rank")
                c.addView(ctx.row().apply {
                    gravity = Gravity.CENTER_VERTICAL; pad(12, 9); if (r.optBoolean("me")) bg(C.selected, 14)
                    addView(ctx.text(if (rk in 1..3) listOf("🥇", "🥈", "🥉")[rk - 1] else "$rk", if (rk in 1..3) 17f else 15f, C.sub, BOLD).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(28), WRAP))
                    addView(CK.avatar(ctx, r.str("name"), 32, grey = anon), LinearLayout.LayoutParams(dp(32), dp(32)).apply { leftMargin = dp(4) })
                    addView(ctx.col().apply {
                        pad(10, 0)
                        addView(ctx.text(r.str("name") + if (r.optBoolean("me")) "（我）" else "", 14.5f, C.text, SEMI, 1))
                        val bar = FrameLayout(ctx).apply { bg(C.mutedBg, 3) }
                        bar.addView(View(ctx).apply { bg(if (r.optBoolean("me")) C.accent else C.alpha(C.accent, 0.55f), 3) }, FrameLayout.LayoutParams(0, MATCH))
                        addView(bar, LinearLayout.LayoutParams(MATCH, dp(4)).apply { topMargin = dp(5) })
                        bar.post { bar.getChildAt(0).layoutParams = bar.getChildAt(0).layoutParams.apply { width = maxOf(dp(4), bar.width * r.optInt("points") / top) }; bar.requestLayout() }
                    }, LinearLayout.LayoutParams(0, WRAP, 1f))
                    addView(ctx.text("${r.optInt("points")}", 15.5f, C.text, HEAVY))
                })
            }
        }
        body.addView(c)
        body.add(ctx.text("成长值：完成作业、打卡、专注、签到都会攒；在「完整榜单」里能设置实名 / 匿名 / 不参加", 11.5f, C.mutedText).apply { gravity = Gravity.CENTER; setLineSpacing(0f, 1.3f) }, 12)
    }

    /** 今天的一句话（放在最上面，代替原来的标题） */
    private fun say(): String {
        val hs = Growth.habits(); val checked = hs.count { Growth.checked(it.id) }
        val doneN = Growth.trend(1).firstOrNull()?.second ?: 0; val pomo = Plan.today(); val left = hs.size - checked
        val name = Store.name().let { if (it.isNotEmpty()) "$it，" else "" }
        return name + when {
            hs.isNotEmpty() && left == 0 -> "今天的习惯全打卡了"
            hs.isNotEmpty() && left <= 2 && checked > 0 -> "还差 $left 个习惯就全勤了"
            doneN + pomo + checked == 0 -> "从一件小事开始就好"
            pomo == 0 -> "来一个番茄专注一下？"
            else -> "今天专注了 $pomo 个番茄"
        }
    }

    // ---------- 最上面：一句话 + 右边等级和班级名次（点开排行榜） ----------
    private fun header() {
        val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(4, 8, 2, 2) }
        r.addView(ctx.text(say(), 15.5f, C.text, BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
        val l = com.laolao.classcalendar.core.Level.me(); val me = rankMe
        if (Store.me != null) r.addView(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(10, 5); press(C.card, 14, C.line)
            addView(ctx.text(if (l != null) "Lv.${l.level}" else "等级", 13.5f, C.c("#ff7a45"), HEAVY))
            if (me != null && me.second > 0) addView(ctx.text(" · 第 ${me.second} 名", 12.5f, C.text, SEMI, 1))
            addView(ctx.text(" ›", 13f, C.mutedText))
            tap { if (Store.cls != null && Store.feat("rank")) a.push(RankPage(a)) else a.push(MetaPage(a)) }
        })
        body.addView(r)
    }

    // ---------- 正在签到：「今天的我」里的签到按钮会变红，这里只负责及时刷新签到状态 ----------
    private fun checkinBanner() {
        if (Store.cls == null) return
        com.laolao.classcalendar.core.Checkin.peek { render() }
    }

    // ---------- ① 今天：三个数字 + 专注 / 签到 ----------
    private fun today() {
        val h = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(14, 12, 14, 12) }
        h.layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(10) }
        val hs = Growth.habits()
        val checked = hs.count { Growth.checked(it.id) }
        val doneN = Growth.trend(1).firstOrNull()?.second ?: 0
        val pomo = Plan.today()
        val stats = ctx.row()
        fun stat(n: String, unit: String, label: String, color: Int, go: () -> Unit) = stats.addView(ctx.col().apply {
            tap { go() }
            addView(ctx.row().apply {
                gravity = Gravity.BOTTOM
                addView(ctx.text(n, 24f, color, HEAVY))
                addView(ctx.text(unit, 12f, C.sub, SEMI).apply { pad(2, 0, 0, 4) })
            })
            addView(ctx.text(label, 11.5f, C.sub))
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        stat("$doneN", "件", "今天完成 ›", C.heroText) { doneSheet() }
        stat(if (hs.isEmpty()) "–" else "$checked", if (hs.isEmpty()) "" else "/ ${hs.size}", "习惯打卡", green) { jump(habitsAt) }
        stat("$pomo", "个", "专注番茄", C.c("#e0603c")) { a.push(PlanPage(a, pomo = true)) }
        h.addView(stats)
        // 专注 + 位置签到：两个最常点的放在这里，一伸手就够到
        val p = Plan.pomo(); val (rest, _) = Plan.left()
        val focusT = when (p.mode) { "focus" -> "专注中 " + Plan.fmt(rest); "break" -> "休息 " + Plan.fmt(rest); "paused" -> "暂停 " + Plan.fmt(rest); else -> "开始专注" }
        val ck = com.laolao.classcalendar.core.Checkin.open
        val two = ctx.row().apply { margins(t = 10) }
        val three = Store.cls != null
        fun tile(icon: String, title: String, sub: String, hot: Boolean, go: () -> Unit) = two.addView(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(if (three) 6 else 8, 7, 4, 7)
            press(if (hot) C.dangerBg else C.alpha(C.card, if (C.dark) 0.6f else 0.85f), 13); tap { go() }
            addView(Ic.tile(ctx, icon, if (three) 26 else 28), LinearLayout.LayoutParams(dp(if (three) 26 else 28), dp(if (three) 26 else 28)))
            addView(ctx.col().apply {
                addView(ctx.text(title, if (three) 12.5f else 13.5f, if (hot) C.red else C.text, BOLD, 1))
                addView(ctx.text(sub, 10.5f, C.sub, lines = 1))
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(if (three) 6 else 8) })
        }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (two.childCount > 0) leftMargin = dp(if (three) 6 else 8) })
        tile("🍅", focusT, "本周 ${Plan.week()} 个", false) { a.push(PlanPage(a, pomo = true)) }
        if (Store.cls != null) {
            val open = ck != null && ck.optJSONObject("mine") == null
            tile("📍", if (open) "去签到" else "签到", when {
                open -> "还剩 " + com.laolao.classcalendar.core.Checkin.leftText(ck!!)
                ck != null -> "已签到 ✓"
                else -> "现在没有"
            }, open) { a.push(CheckinPage(a)) }
            // 课堂互动：正在抢答 / 有小组评分没评时变红
            actPeek()
            val ac = act
            tile("⚡", if (ac?.third == "rush") "快去抢答" else "课堂互动", ac?.first ?: "抢答 · 小组评分", ac != null) { a.push(ActPage(a, ac?.third ?: "rush")) }
        } else tile("📊", "本周复盘", "看看这周的节奏", false) { a.push(CoachPage(a)) }
        h.addView(two)
        body.addView(h)
    }

    /** 课堂互动的状态（20 秒查一次）：Triple(一句话, 是否要紧, 打开哪一栏) */
    private var act: Triple<String, Boolean, String>? = null; private var actAt = 0L
    private fun actPeek() {
        val cid = Store.cls?.str("id") ?: return
        if (System.currentTimeMillis() - actAt < 20_000) return
        actAt = System.currentTimeMillis()
        com.laolao.classcalendar.core.Bg.load({
            val r = com.laolao.classcalendar.core.Api.rpc("rush_state", com.laolao.classcalendar.core.jsonOf("p_cid" to cid)) as? org.json.JSONObject
            val p = com.laolao.classcalendar.core.Api.rpcArr("peer_todo", com.laolao.classcalendar.core.jsonOf("p_cid" to cid))
            val rushOn = r != null && !r.optBoolean("none") && r.optBoolean("open") && !r.optBoolean("mine") && CK.ms(r.str("ends_at")) > System.currentTimeMillis()
            var todo = 0
            for (i in 0 until p.length()) { val x = p.getJSONObject(i); if (!x.optBoolean("open")) continue
                val ts = x.optJSONArray("targets") ?: continue; for (k in 0 until ts.length()) if (ts.getJSONObject(k).optInt("score") == 0) { todo++; break } }
            if (rushOn) Triple("正在抢答", true, "rush") else if (todo > 0) Triple("$todo 个评分没评", true, "peer") else null
        }) { x, e -> val old = act; act = if (e == null) x else null; if (old?.first != act?.first && view.isAttachedToWindow) render() }
    }

    /** 今天完成了哪些（以及前几天）：从底部弹出来看，不占页面 */
    private fun doneSheet() {
        val rd = Growth.recentDone(40)
        val box = ctx.col().apply { pad(20, 18, 20, 20) }
        box.addView(ctx.text("我做到的", 18f, C.text, HEAVY))
        if (rd.isEmpty()) box.add(ctx.text("还没有完成记录。完成一件事，就会出现在这里。", 13.5f, C.sub), 10)
        val list = ctx.col()
        for ((i, pair) in rd.withIndex()) {
            val (d, items) = pair; val n = T.dayDiff(d)
            list.add(ctx.text(if (n == 0L) "今天" else if (n == -1L) "昨天" else T.md(d) + " " + T.wk(d), 12.5f, C.sub, BOLD), if (i == 0) 0 else 12)
            for (r in items) list.add(ctx.row().apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(ctx.text("✓", 11f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; includeFontPadding = false; background = round(C.alpha(green, 0.85f), dp(8).toFloat()) }, LinearLayout.LayoutParams(dp(16), dp(16)))
                addView(ctx.text(r.title, 14f, C.text, lines = 1).apply { pad(9, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            }, 7)
        }
        box.add(android.widget.ScrollView(ctx).apply { isVerticalScrollBarEnabled = false; addView(list) }, 12)
        Dialogs.show(ctx, box, bottom = true)
    }

    // ---------- ② 每天的小习惯 ----------
    private fun habits() {
        val hs = Growth.habits(); val lg = Growth.log()
        val hr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(4, 14, 2, 6) }
        hr.addView(ctx.text("每天的小习惯", 15.5f, C.text, HEAVY))
        if (hs.isNotEmpty()) {
            val n = hs.count { Growth.checked(it.id) }
            hr.addView(ctx.text("今天 $n/${hs.size}", 12f, if (n == hs.size) Color.WHITE else green, BOLD).apply { pad(8, 2); bg(if (n == hs.size) green else C.alpha(green, 0.12f), 10) },
                LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
        }
        hr.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        hr.addView(ctx.text("＋ 新习惯", 12.5f, C.accent, SEMI).apply { pad(10, 5); press(C.selected, 14); tap { addHabit() } })
        body.addView(hr); habitsAt = hr
        val c = ctx.card(2, 16)
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
            if (i > 0) c.addView(ctx.hline().apply { (layoutParams as LinearLayout.LayoutParams).leftMargin = dp(56) })
            val on = Growth.checked(h.id)
            val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(10, 8, 8, 8); press(C.card, 0); tap { more(h) }; setOnLongClickListener { it.buzz(); more(h); true } }
            r.addView(Ic.tile(ctx, h.icon, 34), LinearLayout.LayoutParams(dp(34), dp(34)))
            val col = ctx.col()
            val nm = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL }
            nm.addView(ctx.text(h.name, 14.5f, C.text, BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f).apply { width = WRAP; weight = 0f })
            Growth.place(h.id)?.let { nm.addView(Ic.plain(ctx, "📍", 13, C.sub), LinearLayout.LayoutParams(dp(13), dp(13)).apply { leftMargin = dp(5) }) }
            val sk = Growth.streak(h.id, lg)
            if (sk > 1) {
                nm.addView(Ic.plain(ctx, "🔥", 13, C.c("#e0603c")), LinearLayout.LayoutParams(dp(13), dp(13)).apply { leftMargin = dp(8) })
                nm.addView(ctx.text("$sk 天", 12.5f, C.c("#e0603c"), BOLD).apply { pad(2, 0, 0, 0) })
            }
            col.addView(nm)
            // 这一周（周一到周日，固定位置）：打了卡的填满，今天带圈，还没到的日子只留个浅框
            val mon = com.laolao.classcalendar.core.Items.weekStart(0)
            val hit = lg.optJSONObject(h.id)
            val dots = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 4) }
            for (k in 0..6) {
                val d = T.addDays(mon, k.toLong()); val yes = hit?.optBoolean(d) == true; val future = d > t0; val today = d == t0
                dots.addView(ctx.text(wk[k], 8.5f, if (yes) Color.WHITE else if (future) C.alpha(C.mutedText, 0.6f) else C.mutedText, BOLD).apply {
                    gravity = Gravity.CENTER; includeFontPadding = false
                    background = round(if (yes) green else if (future) 0 else C.alpha(C.text, 0.06f), dp(8).toFloat(),
                        if (today) green else if (future) C.alpha(C.text, 0.08f) else 0, if (today) ctx.dp(1.5f) else if (future) dp(1) else 0)
                }, LinearLayout.LayoutParams(dp(16), dp(16)).apply { rightMargin = dp(4) })
            }
            col.addView(dots)
            r.addView(col, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(10) })
            // 打卡：右边大圆圈
            r.addView(FrameLayout(ctx).apply {
                background = round(if (on) green else 0, dp(17).toFloat(), if (on) 0 else C.alpha(green, 0.55f), if (on) 0 else dp(2))
                addView(ctx.text("✓", 16f, if (on) Color.WHITE else C.alpha(green, 0.55f), HEAVY).apply { gravity = Gravity.CENTER; includeFontPadding = false }, FrameLayout.LayoutParams(MATCH, MATCH))
                contentDescription = if (on) "取消打卡" else "打卡"
                tap { v -> v.buzz(); v.animate().scaleX(0.85f).scaleY(0.85f).setDuration(90).withEndAction { v.animate().scaleX(1f).scaleY(1f).setDuration(150).start() }.start()
                    HabitPlace.toggle(a, h.id) { now -> if (now) Cheer.show(a, "habit", "「${h.name}」连续 ${Growth.streak(h.id)} 天"); render() } }
            }, LinearLayout.LayoutParams(dp(34), dp(34)).apply { leftMargin = dp(8) })
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

    // ---------- ③ 我的节奏：一行总结 + 14 天柱子（点「复盘」看本周复盘） ----------
    private fun rhythm() {
        val tr = Growth.trend(14)
        val now = tr.takeLast(7).sumOf { it.second + it.third }; val prev = tr.take(7).sumOf { it.second + it.third }
        val hr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(4, 14, 2, 6) }
        hr.addView(ctx.text("我的节奏", 15.5f, C.text, HEAVY))
        val diff = now - prev
        val (txt, fg) = when {
            prev == 0 && now == 0 -> "这周从今天开始" to C.sub
            diff > 0 -> "7 天 $now 次 · 比上周多 $diff" to green
            diff < 0 -> "7 天 $now 次 · 比上周少 ${-diff}" to C.sub
            else -> "7 天 $now 次 · 和上周一样稳" to C.accent
        }
        hr.addView(ctx.text(txt, 12f, fg, SEMI, 1).apply { pad(8, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("复盘 ›", 12.5f, C.accent, SEMI).apply { pad(8, 4); tap { a.push(CoachPage(a)) } })
        body.addView(hr)
        val c = ctx.card(12, 16)
        if (tr.all { it.second + it.third == 0 }) c.addView(ctx.text("这两周还没有记录。完成一件事、打一个卡，这里就会长出第一根柱子。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.3f) })
        else {
            val lg = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL }
            lg.addView(ctx.text("最近 14 天", 11.5f, C.sub, SEMI), LinearLayout.LayoutParams(0, WRAP, 1f))
            lg.addView(View(ctx).apply { bg(C.accent, 2) }, LinearLayout.LayoutParams(dp(8), dp(8)))
            lg.addView(ctx.text("完成", 11f, C.sub).apply { pad(4, 0, 10, 0) })
            lg.addView(View(ctx).apply { bg(green, 2) }, LinearLayout.LayoutParams(dp(8), dp(8)))
            lg.addView(ctx.text("打卡", 11f, C.sub).apply { pad(4, 0, 0, 0) })
            c.addView(lg)
            c.add(BarChart(ctx, tr, C.accent, green), 4)
        }
        body.addView(c)
    }

    // ---------- 更多：徽章、云宠 一行放下（等级和排行榜在右上角，签到在「今天的我」里） ----------
    private fun more() {
        val items = mutableListOf<Triple<String, String, () -> Unit>>()
        items += Triple("🏅", "徽章") { a.push(MetaPage(a)) }
        if (com.laolao.classcalendar.core.Farm.on()) items += Triple("🐣", "云宠 Lv." + com.laolao.classcalendar.core.Farm.state().optInt("level", 1)) { a.push(FarmPage(a)) }
        val r = ctx.row().apply { margins(t = 10) }
        items.forEachIndexed { i, (ic, t, go) ->
            r.addView(ctx.row().apply {
                gravity = Gravity.CENTER; pad(6, 8); press(C.card, 14, C.line); tap { go() }
                addView(Ic.plain(ctx, ic, 15), LinearLayout.LayoutParams(dp(15), dp(15)))
                addView(ctx.text(t, 12.5f, C.text, SEMI, 1).apply { pad(5, 0, 0, 0) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) leftMargin = dp(8) })
        }
        body.addView(r)
        // 班里名次在后台取一下（右上角显示）
        val cls = Store.cls
        if (cls != null && Store.feat("rank") && System.currentTimeMillis() - rankAt > 300_000) { rankAt = System.currentTimeMillis()
            com.laolao.classcalendar.core.Bg.load({ com.laolao.classcalendar.core.Api.rpcObj("growth_board", com.laolao.classcalendar.core.jsonOf("cid" to cls.optString("id"), "period" to "week")) }) { d, _ ->
                val x = d?.optJSONArray("rows")?.let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } }?.firstOrNull { it.optBoolean("me") }
                if (x != null) { rankMe = x.optInt("points") to x.optInt("rank"); com.laolao.classcalendar.core.Island.rankMe = rankMe; render() }
            } }
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

/** 7.x 最近 14 天：每天一根柱子，下面是完成的事、上面摞着打卡；今天那根颜色最深、顶上写总数 */
class BarChart(ctx: Context, private val data: List<Triple<String, Int, Int>>, private val c1: Int, private val c2: Int) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val r = RectF()
    override fun onMeasure(w: Int, h: Int) { setMeasuredDimension(MeasureSpec.getSize(w), (resources.displayMetrics.density * 84).toInt()) }
    override fun onDraw(c: Canvas) {
        val d = resources.displayMetrics.density
        val top = 16 * d; val bottom = height - 18 * d; val n = data.size
        val max = maxOf(3, data.maxOf { it.second + it.third })
        val slot = width / n.toFloat(); val bw = minOf(slot * 0.56f, 16 * d)
        p.color = C.line; p.strokeWidth = maxOf(1f, d * 0.6f); c.drawLine(0f, bottom, width.toFloat(), bottom, p)
        data.forEachIndexed { i, (day, a, b) ->
            val cx = slot * i + slot / 2; val today = i == n - 1
            val fade = if (today) 1f else 0.55f
            val ha = (bottom - top) * a / max; val hb = (bottom - top) * b / max
            if (a + b == 0) { p.color = C.alpha(C.text, 0.07f); r.set(cx - bw / 2, bottom - 3 * d, cx + bw / 2, bottom); c.drawRoundRect(r, 1.5f * d, 1.5f * d, p) }
            else {
                // 先画整根（打卡色），再把下面一段盖成完成色：上面是圆角，下面是平的
                p.color = C.alpha(if (b > 0) c2 else c1, fade)
                r.set(cx - bw / 2, bottom - ha - hb, cx + bw / 2, bottom); c.drawRoundRect(r, bw / 2.6f, bw / 2.6f, p)
                c.drawRect(cx - bw / 2, bottom - minOf(ha + hb, bw / 2.6f), cx + bw / 2, bottom, p)
                if (a > 0 && b > 0) { p.color = C.alpha(c1, fade); c.drawRect(cx - bw / 2, bottom - ha, cx + bw / 2, bottom, p) }
            }
            tp.textSize = 10 * d
            if (today) { tp.color = C.text; tp.typeface = HEAVY; c.drawText("${a + b}", cx, bottom - ha - hb - 5 * d, tp) }
            if (today || i % 7 == 0) { tp.color = if (today) C.text else C.sub; tp.typeface = if (today) HEAVY else null
                c.drawText(if (today) "今天" else "${day.substring(5, 7).toInt()}/${day.substring(8).toInt()}", cx, height - 4 * d, tp) }
        }
    }
}

/** 最近 14 天两条折线（以前的成长页用，留着） */
class TrendChart(ctx: Context, private val data: List<Triple<String, Int, Int>>, private val c1: Int, private val c2: Int) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onMeasure(w: Int, h: Int) { setMeasuredDimension(MeasureSpec.getSize(w), (resources.displayMetrics.density * 120).toInt()) }
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
