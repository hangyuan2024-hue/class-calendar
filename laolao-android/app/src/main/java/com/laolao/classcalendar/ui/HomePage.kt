package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Day
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Lesson
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Popup
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.str

/** 首页（7.x 重新排）：问候 + 班级 → 今日概览 → 「现在」看板 → 今天的时间轴 → 接下来的安排 → 教练 → 卡片 */
class HomePage(a: Main) : Page(a) {
    private lateinit var ps: PullScroll
    private lateinit var body: LinearLayout
    private var heroBox: LinearLayout? = null
    private var ticks = 0
    // 每 30 秒挪「现在」；每分钟整页重画一次：「还有多久开始」「上课中」「已上完」跟着变（手指在列表里时不打断）
    private val tick = object : Runnable { override fun run() { if (++ticks % 2 == 0 && !InnerScroll.busy) render() else fillHero(); com.laolao.classcalendar.core.Bg.main.postDelayed(this, 30_000) } }

    override fun build(): View {
        val f = FrameLayout(ctx).apply { setBackgroundColor(C.bg) }
        ps = PullScroll(ctx) { done -> a.refreshSoon(force = true) { done(); a.toast(if (Store.error.isEmpty()) "已更新" else "刷新失败：" + Store.error) } }
        body = ps.content.apply { pad(18, 10, 18, 110) }
        f.addView(ps, FrameLayout.LayoutParams(MATCH, MATCH))
        // 右下角「＋」
        a.fabs += Fab(a, f) { addMenu() }
        return f
    }
    fun scrollTop() { ps.scroll.smoothScrollTo(0, 0) }
    /** 5.9.2 重要事项弹窗：老师、班委勾了「弹窗提醒全班」的，打开首页时弹出来 */
    private var popping = false
    private fun popups() {
        if (popping) return
        Bg.load({ Popup.pending() }) { list, _ -> if (!list.isNullOrEmpty()) { popping = true; showPop(list, 0) } }
    }
    private fun showPop(list: List<org.json.JSONObject>, i: Int) {
        if (i >= list.size || a.isFinishing) { popping = false; return }
        val r = list[i]; val id = r.opt("id").toString().toLong()
        val c = ctx.col().apply { pad(22, 22, 22, 16) }
        c.addView(ctx.text("📣 重要" + r.str("msg_type").ifEmpty { "通知" }, 13f, C.red, HEAVY).apply { pad(12, 4); background = round(C.dangerBg, dp(14).toFloat()) }, LinearLayout.LayoutParams(WRAP, WRAP))
        c.add(ctx.text(r.str("subject").ifEmpty { r.str("summary").ifEmpty { "通知" } }, 20f, C.text, HEAVY).apply { setLineSpacing(0f, 1.25f) }, 12)
        val et = r.str("event_time"); val day = et.take(10); val tm = if (et.length >= 16) et.substring(11, 16) else ""
        val meta = listOf(if (day.length == 10) "🕘 " + T.dayName(day) + (if (tm.isNotEmpty()) " $tm" else "") else "", if (r.str("location").isNotEmpty()) "📍 " + r.str("location") else "", if (r.str("prepare").isNotEmpty()) "🎒 " + r.str("prepare") else "").filter { it.isNotEmpty() }.joinToString("　")
        if (meta.isNotEmpty()) c.add(ctx.text(meta, 13.5f, C.sub), 6)
        if (r.str("summary").isNotEmpty() && r.str("summary") != r.str("subject")) c.add(android.widget.ScrollView(ctx).apply { addView(ctx.text(r.str("summary"), 15f, C.text).apply { setLineSpacing(0f, 1.45f) }) }, 12)
        lateinit var d: android.app.Dialog
        var done = false
        val next = { ok: Boolean -> if (!done) { done = true; Bg.run { if (ok) Popup.ack(id) else Popup.later(id) }; d.dismiss(); Bg.main.postDelayed({ showPop(list, i + 1) }, 250) } }
        val br = ctx.row().apply { margins(t = 20) }
        br.addView(ctx.text((Store.cls?.str("name") ?: "") + if (list.size > 1) " · ${i + 1}/${list.size}" else "", 12f, C.sub, lines = 1), LinearLayout.LayoutParams(0, WRAP, 1f))
        br.addView(ctx.text("稍后再看", 14f, C.sub, SEMI).apply { pad(12, 10); tap { next(false) } })
        br.addView(ctx.button("我知道了", h = 42) { next(true) }, LinearLayout.LayoutParams(WRAP, dp(42)).apply { leftMargin = dp(6) })
        c.addView(br)
        d = Dialogs.show(ctx, c)
        d.setOnDismissListener { next(false) }
    }

    override fun onShow() {
        Bg.main.postDelayed({ popups() }, 1200); com.laolao.classcalendar.core.Bg.main.removeCallbacks(tick); com.laolao.classcalendar.core.Bg.main.postDelayed(tick, 30_000) }
    override fun onHide() { com.laolao.classcalendar.core.Bg.main.removeCallbacks(tick) }

    override fun render() {
        view
        keepScroll(body)
        head()
        if (Store.error.isNotEmpty() && Store.itemsAt > 0) body.add(notice("网络不太好，显示的是上次的数据：" + Store.error), 10)
        else if (Store.error.isNotEmpty() && Store.me == null) body.add(notice("连不上服务器：" + Store.error + "。下拉可以重试"), 10)
        classBar()
        hero()
        checkinBanner()
        val A = Items.agenda()
        agenda(A)
        HwPlus.load(ctx, (A.pins + A.overdue + A.days.flatMap { it.items } + A.undatedMine + A.undatedCls).filter { !it.course }) { if (view.isAttachedToWindow && !InnerScroll.busy) render() }
        CoachCard.build(a, body) { render() }      // 5.9.3 捞捞教练（和小程序 1.22 一样放在「接下来的安排」下面，默认收起成一行）
        cards.build(body, A)
    }
    private val cards = HomeCards(this)
    // 6.9 正在进行的位置签到：首页提醒一下
    private var lvAt = 0L
    private fun checkinBanner() {
        com.laolao.classcalendar.core.Checkin.peek { render() }
        if (Store.me != null && System.currentTimeMillis() - lvAt > 300_000) { lvAt = System.currentTimeMillis(); com.laolao.classcalendar.core.Level.refresh { com.laolao.classcalendar.core.Bus.emit("xp") } }
        val o = com.laolao.classcalendar.core.Checkin.open ?: return
        InAlert.checkin(a, o)   // 7.x 签到开始：提示音 + 横幅（每次签到只响一次）
        val mine = o.optJSONObject("mine") != null
        val c = ctx.row().apply { pad(14, 12); margins(t = 12)
            background = round(if (mine) C.alpha(C.green, 0.1f) else C.alpha(C.c("#ff7a45"), 0.1f), dp(16).toFloat(), if (mine) C.alpha(C.green, 0.45f) else C.alpha(C.c("#ff7a45"), 0.5f), dp(1)) }
        c.addView(Ic.tile(ctx, "📍", 38), LinearLayout.LayoutParams(dp(38), dp(38)))
        c.addView(ctx.col().apply { pad(10, 0); addView(ctx.text(o.str("title").ifEmpty { "位置签到" }, 15f, C.text, BOLD, 1)); addView(ctx.text(o.str("place") + " · 还剩 " + com.laolao.classcalendar.core.Checkin.leftText(o), 12.5f, C.sub, lines = 1)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        c.addView(ctx.text(if (mine) "✓ 已签到" else "去签到 ›", 13.5f, if (mine) C.green else C.c("#d4561e"), BOLD))
        c.tap { a.push(CheckinPage(a, o.optLong("id"))) }
        body.addView(c)
    }
    private var shown = 0; private var capped = false


    private fun notice(s: String, warn: Boolean = true): TextView = ctx.text(s, 13.5f, if (warn) C.red else C.accent).apply { bg(if (warn) C.dangerBg else C.selected, 14); pad(14, 11); margins(b = 12) }

    // ---------- 7.x 首页照小程序首页排 ----------
    // 学习工作台 + 头像 → 班级卡（口号、切换）→ 问候卡（日期、问候、一句话、捞捞、「接下来做啥」看板 + 小圆点、今天的时间条）
    // → 接下来（全部 / 事项 / 课程、放大镜搜索、大号时间的时间线）→ 教练 → 卡片
    /** 标题（和小程序首页一样）：学习工作台 / 每一天都值得认真 · 右边圆形头像 */
    private fun head() {
        val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(4, 2, 2, 10) }
        r.addView(ctx.col().apply {
            addView(ctx.text(if (Store.work()) "工作台" else "学习工作台", 21f, C.text, HEAVY, 1))
            addView(ctx.text("每一天都值得认真", 12f, C.sub).apply { letterSpacing = 0.08f; margins(t = 1) })
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        r.addView(android.widget.FrameLayout(ctx).apply {
            setPadding(dp(2), dp(2), dp(2), dp(2)); background = round(C.card, dp(22).toFloat(), C.line, dp(1))
            addView(Avatar.view(ctx, Store.name(), Store.me?.str("gender") ?: "", 19), android.widget.FrameLayout.LayoutParams(dp(38), dp(38)))
            tap { a.selectTab(4) }
        }, LinearLayout.LayoutParams(dp(42), dp(42)))
        body.addView(r)
    }

    // ---------- 班级卡：加入了显示班级名和口号，没加入显示加入入口 ----------
    private fun classBar() {
        Store.cls?.let { cls ->
            val c = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; bg(C.card, 18, C.line); pad(12, 10, 12, 10); tap { a.push(ClassPage(a)) } }
            c.addView(ctx.text(cls.str("name").take(1), 16f, Color.WHITE, HEAVY).apply {
                gravity = Gravity.CENTER
                background = android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.TL_BR, intArrayOf(C.mix(C.accent, Color.WHITE, 0.2f), C.accent)).apply { cornerRadius = dp(11).toFloat() }
            }, LinearLayout.LayoutParams(dp(38), dp(38)))
            c.addView(ctx.col().apply {
                addView(ctx.text(cls.str("name"), 15.5f, C.text, HEAVY, 1))
                val motto = cls.str("motto").ifEmpty { cls.str("slogan") }
                addView(ctx.text(motto.ifEmpty { Store.role().ifEmpty { "点这里看班级" } }, 12f, C.sub, lines = 1).apply { margins(t = 1) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(11) })
            // 加了好几个班：右边圆按钮切换班级；只有一个班：一个「›」，点整张卡进班级页
            if (Store.classes.size > 1) c.addView(FrameLayout(ctx).apply {
                background = round(C.mutedBg, dp(17).toFloat()); contentDescription = "切换班级"
                addView(Ic.plain(ctx, "⇅", 16, C.sub), FrameLayout.LayoutParams(dp(16), dp(16), Gravity.CENTER))
                tap { switchClass() }
            }, LinearLayout.LayoutParams(dp(34), dp(34)).apply { leftMargin = dp(8) })
            else c.addView(ctx.text("›", 22f, C.mutedText), LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
            body.addView(c)
            return
        }
        val c = ctx.card(16, 18).apply { margins(t = 10) }
        if (Store.pending.isNotEmpty()) {
            c.addView(ctx.text("⏳ 已申请加入「${Store.pending[0].str("name")}」", 15f, C.text, BOLD))
            c.addView(ctx.text("等老师批准后，这里就会显示班级的作业和通知。先用右下角「＋」记自己的事吧。", 13f, C.sub).apply { margins(t = 4) })
        } else if (Store.me != null) {
            c.addView(ctx.text(if (Store.work()) "还没加入团队" else "还没加入班级", 16f, C.text, BOLD))
            c.addView(ctx.text(if (Store.isTeacherRole()) "创建一个班级，把班级码发给学生就能用了" else "问老师或班委要 6 位班级码，加入后作业、通知自动出现在这里", 13f, C.sub).apply { margins(t = 4) })
            c.addView(ctx.soft(if (Store.isTeacherRole()) "创建 / 加入班级 ›" else "输入班级码 ›") { a.push(ClassPage(a)) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(12) })
        } else return
        body.addView(c)
    }
    private fun switchClass() {
        val list = Store.classes
        Dialogs.sheet(ctx, "切换班级", list.map { (if (it.str("id") == Store.cls?.str("id")) "✓ " else "") + it.str("name") }) { i ->
            com.laolao.classcalendar.core.Bg.load({ Store.switchClass(list[i].str("id")) }) { _, e -> if (e != null) a.toast(e.message ?: "切换失败") }
        }
    }

    // ---------- 今日概览：三个数字，点了去对应的页 ----------
    private fun stats() {
        val c = ctx.row().apply { bg(C.card, 18, C.line); pad(4, 12); margins(t = 14) }
        fun cell(n: String, label: String, color: Int, fn: () -> Unit) {
            if (c.childCount > 0) c.addView(View(ctx).apply { setBackgroundColor(C.line) }, LinearLayout.LayoutParams(dp(1), dp(28)).apply { gravity = Gravity.CENTER_VERTICAL })
            c.addView(ctx.col().apply {
                gravity = Gravity.CENTER; press(C.card, 12)
                addView(ctx.text(n, 22f, color, HEAVY, 1).apply { gravity = Gravity.CENTER })
                addView(ctx.text(label, 12f, C.sub, SEMI, 1).apply { gravity = Gravity.CENTER; margins(t = 1) })
                tap { fn() }
            }, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        val hwName = if (Store.work()) "任务" else "作业"
        val H = try { Items.homeworkAll() } catch (_: Exception) { null }
        val left = H?.left ?: 0
        val late = H?.groups?.firstOrNull { it.key == "late" }?.items?.size ?: 0
        val ag = try { Items.agenda() } catch (_: Exception) { null }
        val hasCourse = Store.feat("courses") && try { Courses.has() } catch (_: Exception) { false }
        if (hasCourse) { val n = try { Courses.on(T.todayKey()).size } catch (_: Exception) { 0 }; cell("$n", "今天的课", C.text) { a.push(CoursePage(a)) } }
        else cell("${ag?.todayCount ?: 0}", "今天的事", C.text) { a.push(CalendarPage(a, pushed = true)) }
        if (Store.feat("homework")) {
            cell("${left - late}", "${hwName}待做", if (left - late > 0) C.accent else C.text) { a.selectTab(1) }
            cell("$late", "已过期", if (late > 0) C.red else C.text) { a.selectTab(1) }
        } else cell("📅", "日历", C.text) { a.push(CalendarPage(a, pushed = true)) }
        body.addView(c)
    }

    // ---------- 「现在」：看板 + 今天的时间轴（每 30 秒刷新这一块） ----------
    private fun hero() {
        val h = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(16, 14, 16, 12) }
        h.layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(10) }
        heroBox = h
        body.addView(h)
        fillHero()
    }
    /**
     * 问候卡（展示板）：日期 · 第几周 → 问候 + 今天三个数字（点了去对应的页）+ 捞捞
     * → 捞捞推荐（按现在几点推荐，长按不喜欢）→「现在」看板（左右滑）→ 今天的时间轴。
     * 每 30 秒刷新这一块。
     */
    private fun fillHero() {
        val h = heroBox ?: return
        h.removeAllViews()
        val d = T.today(); val wk = Courses.weekNow()
        h.addView(ctx.text("${d.monthValue}月${d.dayOfMonth}日 ${T.wk(d)}" + (if (wk > 0) " · 第 $wk 周" else "") + " ›", 12f, C.accent, BOLD).apply {
            bg(C.alpha(C.card, 0.7f), 9); pad(9, 4); tap { a.push(CalendarPage(a, pushed = true)) }
        }, LinearLayout.LayoutParams(WRAP, WRAP))
        val mid = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 8) }
        val tc = ctx.col()
        val name = Store.name()
        tc.addView(ctx.text(T.greet() + if (name.isNotEmpty()) "，$name" else "", 21f, C.heroText, HEAVY, 2))
        val ag = try { Items.agenda() } catch (_: Exception) { null }
        if (!ag?.say.isNullOrBlank()) tc.addView(ctx.text(ag!!.say, 13f, C.alpha(C.heroText, 0.72f)).apply {
            margins(t = 4); setLineSpacing(0f, 1.3f)
            if (android.os.Build.VERSION.SDK_INT >= 23) breakStrategy = android.text.Layout.BREAK_STRATEGY_BALANCED
        })
        mid.addView(tc, LinearLayout.LayoutParams(0, WRAP, 1f))
        val night = T.now().hour >= 23 || T.now().hour < 5
        mid.addView(ImageView(ctx).apply { setImageResource(if (night) R.drawable.mascot_sleep else R.drawable.mascot); rotation = 8f; tap { it.animate().rotationBy(-16f).setDuration(160).withEndAction { it.animate().rotation(8f).setDuration(160).start() }.start() } },
            LinearLayout.LayoutParams(dp(60), dp(60)).apply { leftMargin = dp(6) })
        h.addView(mid)
        // 接下来做啥：要做的事和捞捞的建议一起打分排序（NextAI），左右滑；长按「2 小时后再说」「少推荐这类」
        val cards = try { NextAI.rank() } catch (e: Exception) { emptyList() }
        if (cards.isNotEmpty()) {
            h.add(deckView(cards), 12)
            if (cards.size > 1) h.add(deckDots, 8)
        }
        h.add(timeline(), 12)
    }
    // 1.33 看板：几张卡左右滑（和小程序一样），右上角「2 / 5」；右边露出下一张一小截一直到屏幕边，提示还能滑；每分钟刷新、做完一件都停在原来那张
    private var deckAt = ""
    private val deckDots by lazy { ctx.row().apply { gravity = Gravity.CENTER } }
    private fun deckView(cards: List<NextAI.Card>): View {
        var last = -1
        deckDots.removeAllViews()
        (deckDots.parent as? android.view.ViewGroup)?.removeView(deckDots)
        cards.indices.forEach { _ -> deckDots.addView(View(ctx), LinearLayout.LayoutParams(dp(6), dp(6)).apply { leftMargin = dp(3); rightMargin = dp(3) }) }
        fun paint(i: Int) {
            if (last in 0 until i) cards.getOrNull(last)?.let { NextAI.skip(it) }   // 划过去没理：这类在这个时段稍微往后排
            last = i; deckAt = cards.getOrNull(i)?.id ?: ""
            for (j in 0 until deckDots.childCount) deckDots.getChildAt(j).apply {
                background = round(C.alpha(C.accent, if (j == i) 0.9f else 0.25f), dp(3).toFloat())
                layoutParams = (layoutParams as LinearLayout.LayoutParams).apply { width = dp(if (j == i) 18 else 6) }
            }
        }
        heroBox?.let { it.clipToPadding = false; it.clipChildren = false }
        val edge = dp(16)   // 问候卡左右留白：看板往右伸到问候卡边上（露出下一张一截，被卡片圆角裁掉）
        val dv = DeckView(ctx, if (cards.size > 1) edge + dp(24) else edge, dp(10)) { paint(it) }
        cards.forEach { dv.add(aiCard(it)) }
        dv.page = maxOf(0, cards.indexOfFirst { it.id == deckAt })
        last = dv.page; paint(dv.page)
        dv.clipToPadding = false
        return dv.apply { layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).apply { rightMargin = -edge } }
    }
    /** 「接下来做啥」的一张卡（要做的事、建议同一个样子）：左边图标 | 小字「类别 · 还剩多久」、标题、说明 | 右边 ✓ / 去处理 / › */
    private fun aiCard(c: NextAI.Card): View {
        val n = c.next; val r = c.rec
        val hot = n?.hot == true; val sleep = c.cat == "sleep" || r?.id == "sleep"
        val tone = if (hot) C.red else if (sleep) C.c(if (C.dark) "#c7c3ff" else "#4338ca") else C.accent
        val v = ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(14, 11, 12, 11)
            background = round(C.card, dp(16).toFloat(), C.line, dp(1))
        }
        val t = ctx.col()
        val label = n?.label ?: "捞捞建议"
        val cd = if (n == null) "" else if (n.at > 0) { val left = n.at - System.currentTimeMillis(); if (n.live) "还有 " + T.left(left).replace("后", "下课") else T.left(left) }
            else if (n.reason.isNotEmpty() && n.reason != n.label) n.reason else ""
        t.addView(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(View(ctx).apply { background = round(tone, dp(4).toFloat()) }, LinearLayout.LayoutParams(dp(7), dp(7)).apply { rightMargin = dp(7) })
            addView(ctx.text(label, 12f, tone, BOLD, 1))
            val extra = listOf(cd, c.why).filter { it.isNotEmpty() }.joinToString(" · ")
            if (extra.isNotEmpty()) addView(ctx.text(" · $extra", 12f, C.sub, lines = 1))
        })
        t.addView(ctx.text(n?.title ?: r!!.title, 15.5f, C.text, HEAVY, 1).apply { margins(t = 3) })
        val sub = n?.sub ?: r?.sub ?: ""
        if (sub.isNotEmpty()) t.addView(ctx.text(sub, 12.5f, C.sub, lines = 1).apply { margins(t = 2) })
        v.addView(t, LinearLayout.LayoutParams(0, WRAP, 1f))
        // 右边的动作
        if (n != null && n.key.isNotEmpty()) {
            v.addView(ctx.text("✓", 16f, C.accent, HEAVY).apply {
                gravity = Gravity.CENTER; background = round(0, dp(16).toFloat(), C.alpha(C.accent, 0.55f), dp(2)); contentDescription = "标记完成"
                tap { x -> x.buzz(); NextAI.act(c); Items.find(n.key)?.let { a.toggle(it) } }
            }, LinearLayout.LayoutParams(dp(32), dp(32)).apply { leftMargin = dp(10) })
        } else if (n != null && n.go.isNotEmpty()) {
            v.addView(ctx.text(if (n.go == "homework") "去处理" else "开始专注", 12f, tone, BOLD).apply {
                gravity = Gravity.CENTER; pad(9, 5); bg(if (hot) C.dangerBg else C.selected, 9)
                tap { NextAI.act(c); if (n.go == "homework") a.selectTab(1) else a.push(PlanPage(a)) }
            }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
        } else if (!sleep) v.addView(ctx.text("›", 20f, C.sub), LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
        v.tap {
            NextAI.act(c)
            when {
                r != null -> r.go(a)
                n == null -> {}
                n.open.isNotEmpty() -> a.push(ItemPage(a, n.open))
                n.go == "homework" -> a.selectTab(1)
                n.cday.isNotEmpty() -> CourseView.open(a, n.cday, n.title, n.cstart)
                c.cat == "class" || c.cat == "live" -> a.push(CoursePage(a))
            }
        }
        v.setOnLongClickListener { x ->
            x.buzz()
            val opts = mutableListOf("2 小时后再说", "这个时段少推荐这类")
            if (r != null) opts += listOf("今天先不显示", "以后都不推荐这个")
            Dialogs.sheet(ctx, "「${n?.title ?: r!!.title}」", opts) { k ->
                when (k) { 0 -> NextAI.snooze(c); 1 -> { NextAI.less(c); r?.let { Rec.dislike(it.id, 0) } }; 2 -> Rec.dislike(r!!.id, 1); else -> Rec.dislike(r!!.id, 2) }
                a.toast(if (k == 0) "好的，2 小时后再提醒" else "好的，捞捞记住了"); fillHero()
            }
            true
        }
        return v
    }

    /** 看板里的一张卡：小字「● 类别 · 还有多久」→ 标题 → 时间地点；右边 ✓（能直接做完的）/ 去处理 / 开始专注 / › */
    private fun nextCard(n: Items.Next): View {
        val hot = n.hot; val sleep = n.label == "早点睡"
        val tone = if (hot) C.red else if (sleep) C.c(if (C.dark) "#c7c3ff" else "#4338ca") else C.accent
        val c = ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(16, 14, 14, 14)
            background = round(C.card, dp(18).toFloat(), if (hot) C.alpha(C.red, 0.28f) else C.line, dp(1))
        }
        val t = ctx.col()
        val tr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL }
        tr.addView(View(ctx).apply { background = round(tone, dp(3).toFloat()) }, LinearLayout.LayoutParams(dp(6), dp(6)))
        tr.addView(ctx.text(n.label, 12.5f, tone, BOLD, 1).apply { pad(6, 0, 0, 0) })
        val cd = if (n.at > 0) { val left = n.at - System.currentTimeMillis(); if (n.live) "还有 " + T.left(left).replace("后", "下课") else T.left(left) }
            else if (n.reason.isNotEmpty() && n.reason != n.label) n.reason else ""
        if (cd.isNotEmpty()) tr.addView(ctx.text("· $cd", 12.5f, C.sub, lines = 1).apply { pad(6, 0, 0, 0) })
        t.addView(tr)
        t.addView(ctx.text(n.title, 16.5f, C.text, BOLD, 1).apply { margins(t = 5) })
        if (n.sub.isNotEmpty()) t.addView(ctx.text(n.sub, 12.5f, C.sub, lines = 1).apply { margins(t = 2) })
        c.addView(t, LinearLayout.LayoutParams(0, WRAP, 1f))
        if (n.key.isNotEmpty()) {
            c.addView(ctx.text("✓", 16f, C.accent, HEAVY).apply {
                gravity = Gravity.CENTER; background = round(0, dp(16).toFloat(), C.alpha(C.accent, 0.55f), dp(2)); contentDescription = "标记完成"
                tap { v -> v.buzz(); Items.find(n.key)?.let { a.toggle(it) } }
            }, LinearLayout.LayoutParams(dp(38), dp(38)).apply { leftMargin = dp(10) })
        } else if (n.go.isNotEmpty()) {
            c.addView(ctx.text(if (n.go == "homework") "去处理" else "开始专注", 13f, tone, BOLD).apply {
                gravity = Gravity.CENTER; pad(13, 7); bg(if (hot) C.dangerBg else C.selected, 10)
                tap { if (n.go == "homework") a.selectTab(1) else a.push(PlanPage(a)) }
            }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(10) })
        } else if (n.open.isNotEmpty() || n.cday.isNotEmpty() || n.label == "下一节" || n.label == "正在上" || n.label == "明天") {
            c.addView(ctx.text("›", 20f, C.sub), LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
        }
        when {
            n.open.isNotEmpty() -> c.tap { a.push(ItemPage(a, n.open)) }
            n.go == "homework" -> c.tap { a.selectTab(1) }
            n.cday.isNotEmpty() -> c.tap { CourseView.open(a, n.cday, n.title, n.cstart) }
            n.label == "下一节" || n.label == "正在上" || n.label == "明天" -> c.tap { a.push(CoursePage(a)) }
        }
        return c
    }

    /** 今天（晚上 9 点以后、今天的事都完了就看明天）的时间进度条：课是一段段的条，有时间点的事是小圆点，竖线是「现在」 */
    private fun timeline(): View {
        val now = T.now(); val nowMin = now.hour * 60 + now.minute; val t = T.todayKey()
        val items = Items.all().filter { !it.done && T.min(it.time) != null }
        val todayCourses = if (Store.feat("courses")) Courses.on(t) else emptyList()
        val last = (todayCourses.mapNotNull { it.m1 } + items.filter { it.day == t }.mapNotNull { T.min(it.time) }).maxOrNull() ?: -1
        val tomorrow = nowMin >= 21 * 60 && last <= nowMin
        val day = if (tomorrow) T.addDays(t, 1) else t
        val lessons = if (tomorrow) (if (Store.feat("courses")) Courses.on(day) else emptyList()) else todayCourses
        val its = items.filter { it.day == day }
        val loose = Items.all().count { it.day == day && !it.done && it.time.isEmpty() }
        val box = ctx.col()
        val hr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL }
        hr.addView(ctx.text(if (tomorrow) "明天" else "今天", 13f, if (tomorrow) C.accent else C.heroText, BOLD))
        val sub = listOf(if (lessons.isNotEmpty()) "${lessons.size} 节课" else "", if (its.isNotEmpty()) "${its.size} 件有时间点的事" else "", if (loose > 0) "$loose 件全天的事" else "").filter { it.isNotEmpty() }.joinToString(" · ")
        hr.addView(ctx.text(sub.ifEmpty { "没有课，也没有要做的事" }, 12f, C.alpha(C.heroText, 0.68f), lines = 1).apply { pad(8, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        box.addView(hr)
        box.add(Timeline(ctx, lessons, its, if (tomorrow) -1 else nowMin, { l -> if (l.evening) a.push(CoursePage(a)) else CourseView.open(a, T.date(day)!!, l) }) { go -> if (go == "course") a.push(CoursePage(a)) else a.push(CalendarPage(a, pushed = true)) }, 8)
        return box
    }

    // ---------- 接下来的安排 ----------
    // 做完的、上完的课留在列表里标「已完成 / 已上完」；默认翻到第一件还没做的事；手动翻走了，底部有按钮一键回来
    private var agManual = false; private var agY = 0; private var agAuto = 0L
    private var agQ = ""
    private var agKind = 0          // 0 全部 / 1 事项 / 2 课程（和小程序「接下来」一样）
    private var agFind = false      // 搜索框点了放大镜才出来
    private var nextRow: View? = null
    private fun agenda(A0: Items.Agenda) {
        val c = ctx.card(14, 18).apply { margins(t = 10) }
        // 标题行：接下来 · 全部 / 事项 / 课程 · 放大镜（和小程序一样）
        val hr = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL }
        hr.addView(ctx.text("接下来", 17f, C.text, HEAVY), LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(Seg(ctx, listOf("全部", "事项", "课程"), agKind) { agKind = it; agManual = false; render() }.apply {
            for (i in 0 until childCount) (getChildAt(i) as TextView).apply { textSize = 12.5f; pad(10, 4) }
        }, LinearLayout.LayoutParams(WRAP, WRAP))
        val sIn = ctx.input("搜索事项、备注、清单", agQ).apply { setSingleLine(true); textSize = 14f; Ic.search(this); visibility = if (agFind || agQ.isNotEmpty()) View.VISIBLE else View.GONE }
        hr.addView(android.widget.FrameLayout(ctx).apply {
            background = round(if (agFind) C.selected else C.mutedBg, dp(19).toFloat())
            addView(Ic.plain(ctx, "🔍", 17, if (agFind) C.accent else C.sub), android.widget.FrameLayout.LayoutParams(dp(17), dp(17), Gravity.CENTER))
            contentDescription = "搜索"
            tap {
                agFind = !agFind
                background = round(if (agFind) C.selected else C.mutedBg, dp(19).toFloat())
                sIn.visibility = if (agFind) View.VISIBLE else View.GONE
                val im = ctx.getSystemService(android.content.Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager
                if (agFind) { sIn.requestFocus(); im.showSoftInput(sIn, 0) } else { sIn.setText(""); im.hideSoftInputFromWindow(sIn.windowToken, 0) }
            }
        }, LinearLayout.LayoutParams(dp(38), dp(38)).apply { leftMargin = dp(8) })
        c.addView(hr)
        // 6.2 搜索：标题、备注、清单、地点、原文都能搜（打字时只刷新结果，不重画整页）
        c.add(sIn, 12)
        val res = ctx.col()
        c.add(res, 4)
        // 列表放在一个最高 440dp 的框里，超出在框里滚
        val list = ctx.col()
        nextRow = null
        val now = System.currentTimeMillis()
        fun keep(l: List<Item>) = when (agKind) { 1 -> l.filter { !it.course }; 2 -> l.filter { it.course }; else -> l }
        val A = if (agKind == 0) A0 else Items.Agenda(keep(A0.overdue), A0.days.mapNotNull { d -> val k = keep(d.items); if (k.isEmpty() && d.key != T.todayKey()) null else Day(d.key, d.label, d.sub.substringBefore(" · ") + if (k.isNotEmpty()) " · ${k.size} 项" else "", k) },
            keep(A0.undatedMine), keep(A0.undatedCls), A0.todayCount, A0.hwLeft, A0.say, A0.doneCount, keep(A0.pins))
        if (A.pins.isNotEmpty()) { dayBlock(list, "📌 置顶", "${A.pins.size} 项", A.pins, now, showDate = true); nextRow = null }   // 置顶的不算「接下来」
        if (A.overdue.isNotEmpty()) dayBlock(list, "已过期", "还没标记完成的作业", A.overdue, now, late = true, showDate = true)
        for (d in A.days) {
            if (d.items.isEmpty()) {
                dayHead(list, d.label, d.sub, false)
                if (d.key == T.todayKey()) list.addView(nowLine())
                list.addView(ctx.col().apply {
                    gravity = Gravity.CENTER; pad(12, 18); bg(C.mutedBg, 12)
                    addView(ctx.text("✓", 16f, C.green, BOLD).apply { gravity = Gravity.CENTER; bg(0, 16, C.green) }, LinearLayout.LayoutParams(dp(30), dp(30)))
                    addView(ctx.text(when (agKind) { 1 -> "今天没有别的事了"; 2 -> "今天没有课了"; else -> "今天没有别的安排了" } + "，轻松一下", 13f, C.sub).apply { margins(t = 8) })
                })
                continue
            }
            dayBlock(list, d.label, d.sub, d.items, now)
        }
        if (A.undatedMine.isNotEmpty()) dayBlock(list, "待办", "没定日期的事 · ${A.undatedMine.count { !it.done }} 项", A.undatedMine, now)
        if (A.undatedCls.isNotEmpty()) dayBlock(list, "时间待定", "请去群里核实", A.undatedCls, now)
        list.setPadding(0, 0, 0, dp(12))
        val back = ctx.text("回到接下来", 13f, C.accent, BOLD).apply {
            gravity = Gravity.CENTER; pad(16, 7); background = round(C.selected, dp(16).toFloat()); visibility = View.GONE
        }
        val box = FrameLayout(ctx)
        val sc = InnerScroll(ctx, dp(440)).apply { addView(list) }
        box.addView(sc, FrameLayout.LayoutParams(MATCH, WRAP))
        back.tap { agManual = false; goNext(sc, true) }
        c.add(box, 2)
        fun paintSearch() {
            res.removeAllViews()
            val q = agQ.trim()
            box.visibility = if (q.isEmpty()) View.VISIBLE else View.GONE
            if (q.isEmpty()) return
            val hits = Items.search(q)
            if (hits.isEmpty()) { res.add(ctx.text("没有找到「$q」相关的事项", 13.5f, C.sub).apply { pad(4, 14) }, 4); return }
            dayHead(res, "搜索结果", "${hits.size} 条", false)
            hits.forEachIndexed { i, r -> if (i > 0) res.addView(ctx.hline()); res.addView(a.timeRow(r, showDate = true)) }
        }
        sIn.addTextChangedListener(object : android.text.TextWatcher {
            override fun beforeTextChanged(x: CharSequence?, st: Int, n: Int, af: Int) {}
            override fun onTextChanged(x: CharSequence?, st: Int, b: Int, n: Int) {}
            override fun afterTextChanged(e: android.text.Editable?) { agQ = e?.toString() ?: ""; paintSearch() }
        })
        paintSearch()
        // 「回到接下来」：列表下面一条（不盖住列表、也不离得太远），翻走了、看不到「接下来」那件事才出现
        c.addView(back, LinearLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(8) })
        sc.setOnScrollChangeListener { _, _, y, _, _ ->
            if (System.currentTimeMillis() - agAuto > 500) { agManual = true; agY = y }
            paintBack(sc, back)
        }
        sc.post { if (!agManual) goNext(sc, false) else sc.scrollTo(0, agY); paintBack(sc, back) }
        val foot = "只显示今天起两周内的安排，更早或更晚的去「日历」里看" + if (Store.itemsAt > 0) "\n班级数据更新于 " + T.ago(Store.itemsAt) + " · 下拉可以刷新" else ""
        c.add(ctx.hline(), 8)
        if (A.doneCount > 0) {
            val hide = Items.hideDone()
            c.add(ctx.text(if (hide) "显示已完成的" else "隐藏已完成的（${A.doneCount}）", 13f, C.accent, SEMI).apply {
                pad(0, 4); tap { com.laolao.classcalendar.core.Kv.setQuiet("app_hide_done", !hide); agManual = false; render() }
            }, 10)
        }
        c.add(ctx.text(foot, 12f, C.sub).apply { setLineSpacing(0f, 1.4f); tap { a.push(CalendarPage(a, pushed = true)) } }, 10)
        body.addView(c)
    }
    /** 翻到第一件还没做的事（连同那一天的标题一起露出来） */
    private fun goNext(sc: InnerScroll, smooth: Boolean) {
        val r = nextRow ?: return
        var y = 0; var v: View? = r
        while (v != null && v !== sc) { y += v.top; v = v.parent as? View }
        val target = maxOf(0, y - (r.getTag(R_HEAD) as? Int ?: dp(10)))
        agAuto = System.currentTimeMillis()
        if (smooth) sc.smoothScrollTo(0, target) else sc.scrollTo(0, target)
        agY = target
    }
    private fun paintBack(sc: InnerScroll, back: TextView) {
        val r = nextRow
        if (r == null || !sc.scrollable) { back.visibility = View.GONE; return }
        var y = 0; var v: View? = r
        while (v != null && v !== sc) { y += v.top; v = v.parent as? View }
        val rel = y - sc.scrollY
        val off = rel + r.height < 0 || rel > sc.height - dp(30)
        if (off) { back.text = if (rel < 0) "↑ 回到接下来" else "↓ 回到接下来"; if (back.visibility != View.VISIBLE) { back.visibility = View.VISIBLE; back.alpha = 0f; back.animate().alpha(1f).setDuration(160).start() } }
        else back.visibility = View.GONE
    }
    private val R_HEAD = 0x7f0a1001
    private fun dayHead(c: LinearLayout, label: String, sub: String, late: Boolean): View {
        val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; margins(t = 18, b = 4) }
        r.addView(Ic.lead(ctx.text(label, 16f, if (late) C.red else C.text, HEAVY), 15, if (late) C.red else C.text))
        r.addView(ctx.text(sub, 13f, C.sub, lines = 1).apply { pad(10, 0, 0, 0) })
        c.addView(r)
        return r
    }
    private fun dayBlock(c: LinearLayout, label: String, sub: String, list: List<Item>, now: Long, late: Boolean = false, showDate: Boolean = false) {
        dayHead(c, label, sub, late)
        val today = !late && !showDate && (label == "今天" || list.firstOrNull()?.day == T.todayKey())
        var nowShown = false
        list.forEachIndexed { i, r ->
            // 今天的列表里画一条红线「现在 14:05」（和小程序一样）
            if (today && !nowShown && r.dated && r.time.isNotEmpty() && r.at() > now) { nowShown = true; c.addView(nowLine()) }
            else if (i > 0) c.addView(ctx.hline())
            val v = a.timeRow(r, showDate)
            c.addView(v)
            if (nextRow == null && Items.pending(r, now)) {
                nextRow = v
                // 这一天的第一件就是「接下来」：把日期标题也露出来；不是第一件：露出上一件已经完成的一点点
                v.setTag(R_HEAD, if (i == 0) dp(46) else dp(28))
            }
        }
        if (today && !nowShown && list.isNotEmpty() && list.all { !it.dated || it.time.isEmpty() || it.at() <= now }) c.addView(nowLine())
        shown += list.size
    }
    private fun nowLine(): View = android.widget.FrameLayout(ctx).apply {
        val red = C.c(if (C.dark) "#ff8a66" else "#e0603c")   // 和问候卡时间条上「现在」同一个颜色
        addView(View(ctx).apply { setBackgroundColor(red) }, android.widget.FrameLayout.LayoutParams(MATCH, dp(1).coerceAtLeast(2), Gravity.CENTER_VERTICAL))
        addView(View(ctx).apply { background = round(red, dp(4).toFloat()) }, android.widget.FrameLayout.LayoutParams(dp(8), dp(8), Gravity.CENTER_VERTICAL))
        val nw = T.now()
        addView(ctx.text("现在 %02d:%02d".format(nw.hour, nw.minute), 10.5f, Color.WHITE, BOLD).apply { bg(red, 9); pad(7, 1) }, android.widget.FrameLayout.LayoutParams(WRAP, WRAP, Gravity.CENTER_VERTICAL).apply { leftMargin = dp(14) })
        layoutParams = LinearLayout.LayoutParams(MATCH, dp(20)).apply { topMargin = dp(2); bottomMargin = dp(2) }
    }

    // ---------- 右下角「＋」（照小程序：一串胶囊按钮） ----------
    private fun addMenu(): List<FabItem> = FabCfg.items(a)   // 7.x 放哪些、什么顺序：我的 → 设置 → 首页快捷菜单
}

/** 问候卡背景：浅色底 + 右上两个圆圈 */
class HeroBox(ctx: Context) : LinearLayout(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = ctx.dp(1).toFloat() }
    init {
        setWillNotDraw(false)
        background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(C.mix(C.hero, Color.WHITE, if (C.dark) 0.04f else 0.45f), C.hero, C.mix(C.hero, C.accent, 0.08f))).apply { cornerRadius = ctx.dp(22).toFloat(); setStroke(ctx.dp(1), C.alpha(C.accent, if (C.dark) 0.25f else 0.2f)) }
        clipToOutline = true
        lift(10, C.accent)
    }
    override fun onDraw(c: Canvas) {
        super.onDraw(c)
        p.color = C.alpha(C.accent, 0.12f)
        c.drawCircle(width + dp(30f).toFloat(), dp(70f).toFloat(), dp(115f).toFloat(), p)
        p.color = C.alpha(C.accent, 0.18f)
        c.drawCircle(width + dp(15f).toFloat(), dp(66f).toFloat(), dp(70f).toFloat(), p)
    }
    private fun dp(v: Float) = context.dp(v)
}

/** 时间轴：课是一段段的条，有时间点的事是小圆点，竖线是「现在」 */
class Timeline(ctx: Context, private val lessons: List<Lesson>, private val items: List<Item>, private val nowMin: Int, private val onLesson: ((Lesson) -> Unit)? = null, private val go: (String) -> Unit) : View(ctx) {
    private var downX = -1f
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    private val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = ctx.dp(10).toFloat(); typeface = BOLD }
    private val a: Int; private val z: Int
    init {
        val pts = lessons.flatMap { listOfNotNull(it.m0, it.m1) } + items.mapNotNull { T.min(it.time) }
        a = (listOf(8 * 60) + pts.map { it / 60 * 60 }).min()
        z = (listOf(22 * 60) + pts.map { (it + 59) / 60 * 60 }).max()
        minimumHeight = ctx.dp(52)
        // 6.9 点到哪节课就看哪节课的课表截图；点空白处照旧
        setOnTouchListener { _, e -> if (e.actionMasked == android.view.MotionEvent.ACTION_DOWN) downX = e.x; false }
        setOnClickListener {
            val d = context.resources.displayMetrics.density
            val hit = if (downX >= 0) lessons.firstOrNull { l -> val s = l.m0 ?: return@firstOrNull false; val e = l.m1 ?: (s + 45); downX >= x(s) - 4 * d && downX <= maxOf(x(e), x(s) + 6 * d) + 4 * d } else null
            if (hit != null && onLesson != null) onLesson.invoke(hit) else go(if (lessons.isNotEmpty()) "course" else "calendar")
        }
    }
    override fun onMeasure(w: Int, h: Int) { setMeasuredDimension(MeasureSpec.getSize(w), context.dp(44)) }
    private fun x(m: Int): Float = (maxOf(a, minOf(z, m)) - a).toFloat() / (z - a) * width
    override fun onDraw(c: Canvas) {
        val d = context.resources.displayMetrics.density
        val top = 6 * d; val bot = 28 * d
        p.style = Paint.Style.FILL
        p.color = C.alpha(if (C.dark) Color.WHITE else Color.WHITE, if (C.dark) 0.1f else 0.55f)
        c.drawRoundRect(RectF(0f, top, width.toFloat(), bot), 7 * d, 7 * d, p)
        for (l in lessons) {
            val s = l.m0 ?: continue; val e = l.m1 ?: (s + 45)
            val past = nowMin >= 0 && e <= nowMin
            p.color = if (past) C.alpha(C.heroText, 0.18f) else C.accent
            val r = RectF(x(s), top + 3 * d, maxOf(x(e), x(s) + 6 * d), bot - 3 * d)
            c.drawRoundRect(r, 5 * d, 5 * d, p)
            if (r.width() > 26 * d) {
                tp.color = if (past) C.alpha(C.heroText, 0.55f) else Color.WHITE
                val txt = android.text.TextUtils.ellipsize(l.name, android.text.TextPaint(tp), r.width() - 8 * d, android.text.TextUtils.TruncateAt.END).toString()
                c.drawText(txt, r.left + 4 * d, r.centerY() + 3.5f * d, tp)
            }
        }
        for (it in items) {
            val m = T.min(it.time) ?: continue
            val cx = x(m); val cy = (top + bot) / 2
            p.color = if (C.dark) C.card else Color.WHITE
            c.drawCircle(cx, cy, 6 * d, p)
            p.color = if (it.hw) C.red else C.accent
            c.drawCircle(cx, cy, 4 * d, p)
        }
        if (nowMin in a..z) {
            p.color = C.c(if (C.dark) "#ff8a66" else "#e0603c")
            val nx = x(nowMin)
            c.drawRect(nx - 1 * d, top - 4 * d, nx + 1 * d, bot + 3 * d, p)
            c.drawCircle(nx, top - 4 * d, 4 * d, p)
        }
        tp.color = C.alpha(C.heroText, 0.6f); tp.typeface = android.graphics.Typeface.DEFAULT
        val ticks = listOf(a) + listOf(12 * 60, 18 * 60).filter { it > a + 90 && it < z - 90 } + listOf(z)
        ticks.forEachIndexed { i, m ->
            val s = "${m / 60}:00"; val w = tp.measureText(s)
            val tx = when (i) { 0 -> 0f; ticks.size - 1 -> width - w; else -> x(m) - w / 2 }
            c.drawText(s, tx, bot + 16 * d, tp)
        }
        tp.typeface = BOLD
    }
}

/**
 * 1.33 首页看板的横向翻页：每张卡宽 = 屏宽 − 露出下一张的一小截；松手自动对齐到最近一张（滑得够远就翻一张），不会停在两张中间。
 */
class DeckView(ctx: Context, private val peek: Int, private val gap: Int, private val onPage: (Int) -> Unit) : android.widget.HorizontalScrollView(ctx) {
    private val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
    var page = 0
    private var downX = 0f; private var downPage = 0; private var moved = false
    private val slop = android.view.ViewConfiguration.get(ctx).scaledTouchSlop
    init { isHorizontalScrollBarEnabled = false; overScrollMode = OVER_SCROLL_NEVER; clipToPadding = false; addView(row, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT)) }
    fun add(v: View) { row.addView(v, LinearLayout.LayoutParams(1, LinearLayout.LayoutParams.MATCH_PARENT).apply { if (row.childCount > 0) leftMargin = gap }) }   // 一样高
    private fun cw() = width - peek   // peek：右边留出来的宽度（露出下一张 / 首页伸到屏幕边的那段）
    // 卡片宽度在测量时就定好（以前是量完再改，刚打开那一下卡片只有 1 像素宽，会显示成一排竖线）
    override fun onMeasure(wSpec: Int, hSpec: Int) {
        val w = MeasureSpec.getSize(wSpec)
        if (w > 0) for (i in 0 until row.childCount) (row.getChildAt(i).layoutParams as LinearLayout.LayoutParams).let { lp -> if (lp.width != w - peek) lp.width = w - peek }
        super.onMeasure(wSpec, hSpec)
    }
    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
        super.onSizeChanged(w, h, ow, oh)
        if (w > 0 && w != ow) post { go(page, false) }
    }
    fun go(i: Int, smooth: Boolean = true) {
        val p = i.coerceIn(0, maxOf(0, row.childCount - 1)); val x = p * (cw() + gap)
        if (smooth) smoothScrollTo(x, 0) else scrollTo(x, 0)
        page = p; onPage(p)
    }
    override fun dispatchTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> { downX = e.x; downPage = page; moved = false }
            MotionEvent.ACTION_MOVE -> if (Math.abs(e.x - downX) > slop) moved = true
        }
        val r = super.dispatchTouchEvent(e)
        if ((e.actionMasked == MotionEvent.ACTION_UP || e.actionMasked == MotionEvent.ACTION_CANCEL) && moved) {
            val dx = e.x - downX; val step = cw() + gap
            val target = if (Math.abs(dx) > step * 0.18f) (if (dx < 0) downPage + 1 else downPage - 1) else Math.round(scrollX.toFloat() / step)
            post { go(target) }
        }
        return r
    }
    override fun fling(velocityX: Int) { }   // 一次只翻一张
}
