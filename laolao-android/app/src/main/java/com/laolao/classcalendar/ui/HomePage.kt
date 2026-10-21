package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Lesson
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Popup
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.str

/** 首页：标题 → 班级 → 问候卡（下一件事 + 今天的时间轴）→ 接下来的安排 */
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
        head(); classBar()
        if (Store.error.isNotEmpty() && Store.itemsAt > 0) body.add(notice("网络不太好，显示的是上次的数据：" + Store.error), 4)
        else if (Store.error.isNotEmpty() && Store.me == null) body.add(notice("连不上服务器：" + Store.error + "。下拉可以重试"), 4)
        hero()
        checkinBanner()
        CoachCard.build(a, body) { render() }      // 5.9.3 捞捞教练：现在最适合做什么
        val A = Items.agenda()
        agenda(A)
        cards.build(body, A)
    }
    private val cards = HomeCards(this)
    // 6.9 正在进行的位置签到：首页提醒一下
    private var lvAt = 0L
    private fun checkinBanner() {
        com.laolao.classcalendar.core.Checkin.peek { render() }
        if (Store.me != null && System.currentTimeMillis() - lvAt > 300_000) { lvAt = System.currentTimeMillis(); com.laolao.classcalendar.core.Level.refresh { com.laolao.classcalendar.core.Bus.emit("xp") } }
        val o = com.laolao.classcalendar.core.Checkin.open ?: return
        val mine = o.optJSONObject("mine") != null
        val c = ctx.row().apply { pad(14, 12); margins(t = 12)
            background = round(if (mine) C.alpha(C.green, 0.1f) else C.alpha(C.c("#ff7a45"), 0.1f), dp(16).toFloat(), if (mine) C.alpha(C.green, 0.45f) else C.alpha(C.c("#ff7a45"), 0.5f), dp(1)) }
        c.addView(ctx.text("📍", 22f))
        c.addView(ctx.col().apply { pad(10, 0); addView(ctx.text(o.str("title").ifEmpty { "位置签到" }, 15f, C.text, BOLD, 1)); addView(ctx.text(o.str("place") + " · 还剩 " + com.laolao.classcalendar.core.Checkin.leftText(o), 12.5f, C.sub, lines = 1)) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        c.addView(ctx.text(if (mine) "✓ 已签到" else "去签到 ›", 13.5f, if (mine) C.green else C.c("#d4561e"), BOLD))
        c.tap { a.push(CheckinPage(a)) }
        body.addView(c)
    }
    private var shown = 0; private var capped = false


    private fun notice(s: String, warn: Boolean = true): TextView = ctx.text(s, 13.5f, if (warn) C.red else C.accent).apply { bg(if (warn) C.dangerBg else C.selected, 14); pad(14, 11); margins(b = 12) }

    // ---------- 标题区 ----------
    private fun head() {
        val r = ctx.row().apply { pad(2, 6, 2, 8) }
        val c = ctx.col()
        c.addView(ctx.text(if (Store.work()) "高效工作，也好好生活" else "每一天都值得认真", 11.5f, C.sub, SEMI).apply { letterSpacing = 0.08f })
        val t = ctx.text("", 26f, C.text, HEAVY)
        val s = android.text.SpannableString((if (Store.work()) "工作台" else "学习工作台") + ".")
        s.setSpan(android.text.style.ForegroundColorSpan(C.accent), s.length - 1, s.length, 0)
        t.text = s
        c.addView(t.apply { margins(t = 4) })
        com.laolao.classcalendar.core.Level.me()?.let { l -> c.addView(LevelUi.chip(ctx, l.level).apply { tap { a.selectTab(2) } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(4) }) }   // 6.9 账号等级
        r.addView(c, LinearLayout.LayoutParams(0, WRAP, 1f))
        val name = Store.name()
        val av = ctx.text(name.take(1).ifEmpty { "?" }, 15f, Color.WHITE, BOLD).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (Store.me?.str("gender") == "f") intArrayOf(C.c("#ff9ac1"), C.c("#ff5f8f")) else intArrayOf(C.mix(C.accent, Color.WHITE, 0.25f), C.accent)).apply { cornerRadius = dp(11).toFloat() }
            tap { a.selectTab(4) }
        }
        r.addView(av, LinearLayout.LayoutParams(dp(38), dp(38)))
        body.addView(r)
    }

    // ---------- 班级 ----------
    private fun classBar() {
        val cls = Store.cls
        if (cls == null) {
            val c = ctx.card(16, 18).apply { margins(t = 6, b = 16) }
            if (Store.pending.isNotEmpty()) {
                c.addView(ctx.text("⏳ 已申请加入「${Store.pending[0].str("name")}」", 15f, C.text, BOLD))
                c.addView(ctx.text("等老师批准后，这里就会显示班级的作业和通知。先用右下角「＋」记自己的事吧。", 13f, C.sub).apply { margins(t = 4) })
            } else if (Store.me != null) {
                c.addView(ctx.text(if (Store.work()) "还没加入团队" else "还没加入班级", 16f, C.text, BOLD))
                c.addView(ctx.text(if (Store.isTeacherRole()) "创建一个班级，把班级码发给学生就能用了" else "问老师或班委要 6 位班级码，加入后作业、通知自动出现在这里", 13f, C.sub).apply { margins(t = 4) })
                c.addView(ctx.soft(if (Store.isTeacherRole()) "创建 / 加入班级 ›" else "输入班级码 ›") { a.push(ClassPage(a)) }.apply { margins(t = 12) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(12) })
            } else return
            body.addView(c); return
        }
        val r = ctx.row().apply { margins(t = 2, b = 16) }
        val nm = cls.str("name")
        r.addView(ctx.text(nm.take(1), 18f, C.text, HEAVY).apply { gravity = Gravity.CENTER; bg(C.mint, 12) }, LinearLayout.LayoutParams(dp(44), dp(44)))
        val c = ctx.col()
        val tl = ctx.row()
        tl.addView(ctx.text(nm, 17f, C.text, HEAVY, 1))
        if (Store.classes.size > 1) tl.addView(ctx.text(" ⇅", 13f, C.sub))
        if (Store.classes.size > 1) tl.tap { switchClass() }
        c.addView(tl)
        val meta = ctx.row().apply { margins(t = 4) }
        meta.addView(ctx.chip(Store.role(), C.sub, C.hover, 11.5f).apply { pad(8, 2) })
        if (cls.str("nickname").isNotEmpty()) meta.addView(ctx.text("「${cls.str("nickname")}」", 12.5f, C.sub, lines = 1))
        meta.addView(ctx.text("👥 成员", 12.5f, C.sub, SEMI).apply { pad(8, 2); tap { a.push(PeoplePage(a)) } })
        meta.addView(ctx.text(if (Store.work()) "团队管理" else "班级管理", 12.5f, C.accent, SEMI).apply { pad(6, 2); tap { a.push(if (Store.isTeacher) ClassManagePage(a, cls.str("id")) else ClassPage(a)) } })
        c.addView(meta)
        if (cls.str("motto").isNotEmpty()) c.addView(ctx.text("“${cls.str("motto")}”", 12.5f, C.sub, lines = 1).apply { margins(t = 4) })
        r.addView(c, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(12) })
        body.addView(r)
    }
    private fun switchClass() {
        val list = Store.classes
        Dialogs.sheet(ctx, "切换班级", list.map { (if (it.str("id") == Store.cls?.str("id")) "✓ " else "") + it.str("name") }) { i ->
            com.laolao.classcalendar.core.Bg.load({ Store.switchClass(list[i].str("id")) }) { _, e -> if (e != null) a.toast(e.message ?: "切换失败") }
        }
    }

    // ---------- 问候卡 ----------
    private fun hero() {
        val h = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(20, 22, 20, 20) }
        heroBox = h
        body.addView(h)
        fillHero()
    }
    private fun fillHero() {
        val h = heroBox ?: return
        h.removeAllViews()
        val d = T.today()
        val wk = Courses.weekNow()
        val top = ctx.row()
        top.addView(ctx.text("${d.monthValue}月${d.dayOfMonth}日 ${T.wk(d)}" + if (wk > 0) " · 第 $wk 周" else "", 12.5f, C.accent, SEMI).apply { bg(C.alpha(C.card, 0.6f), 8); pad(9, 4) })
        h.addView(top)
        val mid = ctx.row().apply { gravity = Gravity.TOP; margins(t = 18) }
        val tc = ctx.col()
        val name = Store.name()
        tc.addView(ctx.text(T.greet() + if (name.isNotEmpty()) "，$name" else "", 28f, C.heroText, BOLD, 2))
        val ag = try { Items.agenda() } catch (e: Exception) { null }
        tc.addView(ctx.text(ag?.say ?: "", 13f, C.alpha(C.heroText, 0.72f)).apply { margins(t = 8) })
        mid.addView(tc, LinearLayout.LayoutParams(0, WRAP, 1f))
        val night = T.now().hour >= 23 || T.now().hour < 5
        mid.addView(ImageView(ctx).apply { setImageResource(if (night) R.drawable.mascot_sleep else R.drawable.mascot); rotation = 8f; tap { it.animate().rotationBy(-16f).setDuration(160).withEndAction { it.animate().rotation(8f).setDuration(160).start() }.start() } },
            LinearLayout.LayoutParams(dp(84), dp(84)).apply { leftMargin = dp(6) })
        h.addView(mid)
        Items.next()?.let { n -> h.add(nextCard(n), 18) }
        h.add(timeline(), 20)
    }
    private fun nextCard(n: Items.Next): View {
        val c = ctx.row().apply { gravity = Gravity.TOP; bg(C.card, 14, C.alpha(C.accent, 0.16f)); pad(12, 12, 12, 12) }
        val hot = n.hot; val sleep = n.label == "早点睡"
        c.addView(ctx.text(n.label, 12f, if (hot) C.red else if (sleep) C.c("#4338ca") else C.accent, BOLD).apply {
            bg(if (hot) C.dangerBg else if (sleep) C.c("#ebeaff") else C.selected, 7); pad(7, 4)
        })
        val t = ctx.col()
        t.addView(ctx.text(n.title, 14.5f, C.text, BOLD, 1))
        if (n.sub.isNotEmpty()) t.addView(ctx.text(n.sub, 12.5f, C.sub, lines = 1).apply { margins(t = 3) })
        if (n.at > 0) {
            val left = n.at - System.currentTimeMillis()
            t.addView(ctx.text(if (n.live) "还有 " + T.left(left).replace("后", "下课") else T.left(left), 13f, C.accent, BOLD).apply { margins(t = 4) })
        }
        c.addView(t, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(10) })
        if (n.key.isNotEmpty()) {
            c.addView(ctx.text("✓", 16f, Color.WHITE, HEAVY).apply {
                gravity = Gravity.CENTER; press(C.accent, 9, ripple = C.alpha(Color.WHITE, 0.3f))
                tap { v -> v.buzz(); Items.find(n.key)?.let { a.toggle(it) } }
            }, LinearLayout.LayoutParams(dp(32), dp(32)).apply { gravity = Gravity.CENTER_VERTICAL })
            c.tap { a.push(ItemPage(a, n.key)) }
        } else c.tap { if (n.cday.isNotEmpty()) CourseView.open(a, n.cday, n.title, n.cstart) else a.push(CoursePage(a)) }
        return c
    }

    /** 今天（晚上 9 点以后、今天的事都完了就看明天）的时间轴 */
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
        val hr = ctx.row().apply { gravity = Gravity.BOTTOM }
        hr.addView(ctx.text(if (tomorrow) "明天" else "今天", 13f, if (tomorrow) C.accent else C.heroText, BOLD))
        val sub = listOf(if (lessons.isNotEmpty()) "${lessons.size} 节课" else "", if (its.isNotEmpty()) "${its.size} 件有时间点的事" else "", if (loose > 0) "$loose 件全天的事" else "").filter { it.isNotEmpty() }.joinToString(" · ")
        hr.addView(ctx.text(sub.ifEmpty { "没有课，也没有要做的事" }, 12f, C.alpha(C.heroText, 0.68f)).apply { pad(8, 0, 0, 0) })
        box.addView(hr)
        box.add(Timeline(ctx, lessons, its, if (tomorrow) -1 else nowMin, { l -> if (l.evening) a.push(CoursePage(a)) else CourseView.open(a, T.date(day)!!, l) }) { go -> if (go == "course") a.push(CoursePage(a)) else a.push(CalendarPage(a, pushed = true)) }, 10)
        return box
    }

    // ---------- 接下来的安排 ----------
    // 做完的、上完的课留在列表里标「已完成 / 已上完」；默认翻到第一件还没做的事；手动翻走了，底部有按钮一键回来
    private var agManual = false; private var agY = 0; private var agAuto = 0L
    private var agQ = ""
    private var nextRow: View? = null
    private fun agenda(A: Items.Agenda) {
        val c = ctx.card(18, 22).apply { margins(t = 16) }
        val hr = ctx.row()
        val hc = ctx.col()
        hc.addView(ctx.text("即将到来", 11.5f, C.sub, SEMI))
        hc.addView(ctx.text("接下来的安排", 18f, C.text, BOLD).apply { margins(t = 2) })
        hr.addView(hc, LinearLayout.LayoutParams(0, WRAP, 1f))
        if (A.doneCount > 0) {
            val hide = Items.hideDone()
            hr.addView(ctx.text(if (hide) "显示已完成" else "隐藏已完成（${A.doneCount}）", 12f, C.accent, SEMI).apply {
                pad(8, 6); press(0, 8)
                tap { com.laolao.classcalendar.core.Kv.setQuiet("app_hide_done", !hide); agManual = false; render() }
            })
        }
        c.addView(hr)
        c.add(ctx.hline(), 12)
        // 6.2 搜索：标题、备注、清单、地点、原文都能搜（打字时只刷新结果，不重画整页）
        val sIn = ctx.input("🔍 搜索事项、备注、清单", agQ).apply { setSingleLine(true); textSize = 14f }
        c.add(sIn, 0)
        val res = ctx.col()
        c.add(res, 4)
        // 列表放在一个最高 440dp 的框里，超出在框里滚
        val list = ctx.col()
        nextRow = null
        val now = System.currentTimeMillis()
        if (A.pins.isNotEmpty()) { dayBlock(list, "📌 置顶", "${A.pins.size} 项", A.pins, now, showDate = true); nextRow = null }   // 置顶的不算「接下来」
        if (A.overdue.isNotEmpty()) dayBlock(list, "已过期", "还没标记完成的作业", A.overdue, now, late = true, showDate = true)
        for (d in A.days) {
            if (d.items.isEmpty()) {
                dayHead(list, d.label, d.sub, false)
                list.addView(ctx.col().apply {
                    gravity = Gravity.CENTER; pad(12, 18); bg(C.mutedBg, 12)
                    addView(ctx.text("✓", 16f, C.green, BOLD).apply { gravity = Gravity.CENTER; bg(0, 16, C.green) }, LinearLayout.LayoutParams(dp(30), dp(30)))
                    addView(ctx.text("今天没有安排，轻松一下 ☕", 13f, C.sub).apply { margins(t = 8) })
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
            hits.forEachIndexed { i, r -> if (i > 0) res.addView(ctx.hline()); res.addView(a.itemRow(r, showDate = true)) }
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
        val r = ctx.row().apply { gravity = Gravity.BOTTOM; margins(t = 16, b = 2) }
        r.addView(ctx.text(label, 14f, if (late) C.red else C.text, BOLD))
        r.addView(ctx.text(sub, 12f, C.sub).apply { pad(8, 0, 0, 0) })
        c.addView(r)
        return r
    }
    private fun dayBlock(c: LinearLayout, label: String, sub: String, list: List<Item>, now: Long, late: Boolean = false, showDate: Boolean = false) {
        dayHead(c, label, sub, late)
        list.forEachIndexed { i, r ->
            if (i > 0) c.addView(ctx.hline())
            val v = a.itemRow(r, showDate)
            c.addView(v)
            if (nextRow == null && Items.pending(r, now)) {
                nextRow = v
                // 这一天的第一件就是「接下来」：把日期标题也露出来；不是第一件：露出上一件已经完成的一点点
                v.setTag(R_HEAD, if (i == 0) dp(46) else dp(28))
            }
        }
        shown += list.size
    }

    // ---------- 右下角「＋」（照小程序：一串胶囊按钮） ----------
    private fun addMenu(): List<FabItem> {
        val l = mutableListOf(
            FabItem("✏️", "记一件事") { a.push(EditPage(a, null)) },
            FabItem("💬", "一句话记事") { QuickAdd.open(a) },
            FabItem("📋", "导入备忘录 / 聊天记录") { a.push(MemoPage(a, "")) },
            FabItem("📷", "拍课表导入") { a.push(CourseImportPage(a)) },
        )
        if (Store.can("can_edit")) l += FabItem("📢", "发布班级事项") { a.push(EditPage(a, null, classMode = true)) }
        if (Store.cls != null && (Store.can("can_ingest") || Store.feat("ingest_local"))) l += FabItem("✨", "整理群消息") { a.push(IngestPage(a)) }
        if (Store.cls != null && Store.feat("wall")) l += FabItem("📌", "发到班级墙") { a.push(WallPage(a)) }
        l += FabItem("🔥", "今日打卡") { a.selectTab(2) }
        return l
    }
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
    override fun onMeasure(w: Int, h: Int) { setMeasuredDimension(MeasureSpec.getSize(w), context.dp(52)) }
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
            p.color = C.heroText
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
