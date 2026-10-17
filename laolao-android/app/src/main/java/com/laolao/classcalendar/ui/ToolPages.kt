package com.laolao.classcalendar.ui

import android.app.Dialog
import android.graphics.Color
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.Tools
import com.laolao.classcalendar.core.str
import org.json.JSONObject
import java.time.LocalDate

/** 底部弹出的表单：标题 + 内容 + 保存（保存出错就留在表单里显示原因） */
private fun formSheet(a: Main, title: String, fill: (LinearLayout) -> Unit, del: (() -> Unit)? = null, save: () -> Unit) {
    val c = a.col().apply { pad(20, 18, 20, 18) }
    lateinit var d: Dialog
    val hr = a.row()
    hr.addView(a.text(title, 18f, C.text, BOLD), LinearLayout.LayoutParams(0, WRAP, 1f))
    if (del != null) hr.addView(a.text("删除", 14f, C.red, SEMI).apply { pad(10, 6); press(0, 10); tap { d.dismiss(); del() } })
    c.addView(hr)
    fill(c)
    val err = a.text("", 13f, C.red).apply { visibility = View.GONE }
    c.add(err, 8)
    c.add(a.button("保存") {
        try { save(); Dialogs.hideKeyboard(c); d.dismiss() } catch (e: Exception) { err.text = e.message ?: "没保存上"; err.visibility = View.VISIBLE }
    }, 12)
    d = Dialogs.show(a, c, bottom = true)
}
/** 表单里的「标签 + 值」一行（点了选日期之类） */
private fun pickRow(a: Main, label: String, value: String, fn: (TextView) -> Unit): LinearLayout = a.row().apply {
    pad(14, 0); bg(C.mutedBg, 12); minimumHeight = a.dp(48)
    addView(a.text(label, 14.5f, C.sub), LinearLayout.LayoutParams(0, WRAP, 1f))
    val v = a.text(value, 14.5f, C.text, SEMI)
    addView(v); addView(a.text("  ›", 16f, C.mutedText))
    tap { fn(v) }
}

// =====================================================================
/** 考试倒计时（数据和网页、小程序的「考试倒计时」插件同一个键） */
class CountdownPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var showPast = false
    override fun build(): View = scaffold("考试倒计时", ctx.text("＋ 添加", 14f, C.accent, BOLD).apply { pad(12, 8); press(C.selected, 12); tap { edit(null) } }) { body = it }

    override fun render() {
        view
        keepScroll(body)
        val all = Tools.exams()
        val future = all.filter { T.dayDiff(it.str("date")) >= 0 }
        val past = all.filter { T.dayDiff(it.str("date")) < 0 }.reversed()
        if (all.isEmpty()) {
            body.addView(ctx.empty("⏳", "还没有考试", "把期中、期末、四六级加进来，每天打开就能看到还剩几天"))
            body.add(ctx.button("添加第一场考试") { edit(null) }, 16)
            return
        }
        future.firstOrNull()?.let { e ->
            val n = T.dayDiff(e.str("date"))
            val hero = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(22, 20); tap { edit(e) } }
            hero.addView(ctx.text("最近的一场", 12.5f, C.sub, SEMI))
            hero.addView(ctx.text(e.str("subject"), 22f, C.heroText, HEAVY, 2).apply { margins(t = 4) })
            val nr = ctx.row().apply { gravity = Gravity.BOTTOM; margins(t = 10) }
            nr.addView(ctx.text(if (n == 0L) "就是今天" else "$n", if (n == 0L) 34f else 54f, C.accent, HEAVY))
            if (n > 0) nr.addView(ctx.text(" 天", 17f, C.sub, BOLD).apply { pad(0, 0, 0, 10) })
            hero.addView(nr)
            hero.addView(ctx.text(T.md(e.str("date")) + " " + T.wk(e.str("date")) + (if (e.str("note").isNotBlank()) " · " + e.str("note") else ""), 13f, C.sub, lines = 2).apply { margins(t = 2) })
            body.addView(hero)
        }
        if (future.size > 1) {
            body.addView(ctx.section("接下来", "${future.size} 场"))
            val c = ctx.card(4, 18)
            future.drop(1).forEachIndexed { i, e -> if (i > 0) c.addView(ctx.hline()); c.addView(row(e)) }
            body.addView(c)
        } else if (future.isEmpty()) body.addView(ctx.empty("🎉", "考完啦", "没有还没到的考试了"))
        if (past.isNotEmpty()) {
            body.addView(ctx.section("已经考过", "${past.size} 场").apply { tap { showPast = !showPast; render() }; addView(ctx.text(if (showPast) "收起" else "展开", 13f, C.accent, SEMI)) })
            if (showPast) {
                val c = ctx.card(4, 18)
                past.forEachIndexed { i, e -> if (i > 0) c.addView(ctx.hline()); c.addView(row(e)) }
                body.addView(c)
            }
        }
    }
    private fun row(e: JSONObject): View = ctx.row().apply {
        pad(14, 12); press(0, 14); tap { edit(e) }
        val n = T.dayDiff(e.str("date"))
        val cc = ctx.col()
        cc.addView(ctx.text(e.str("subject"), 15.5f, if (n < 0) C.mutedText else C.text, BOLD, 1))
        cc.addView(ctx.text(T.md(e.str("date")) + " " + T.wk(e.str("date")) + (if (e.str("note").isNotBlank()) " · " + e.str("note") else ""), 12.5f, C.sub, lines = 1).apply { margins(t = 2) })
        addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
        addView(ctx.text(when { n < 0 -> "已考"; n == 0L -> "今天"; else -> "$n 天" }, 16f, if (n in 0..7) C.red else if (n < 0) C.mutedText else C.accent, HEAVY))
    }
    private fun edit(e: JSONObject?) {
        var date = e?.str("date") ?: T.addDays(T.todayKey(), 14)
        lateinit var subj: EditText; lateinit var note: EditText
        formSheet(a, if (e == null) "添加考试" else "修改考试", { c ->
            subj = ctx.input("考试科目，比如：高数期中", e?.str("subject") ?: "")
            c.add(subj, 14)
            c.add(pickRow(a, "考试日期", T.md(date) + " " + T.wk(date)) { tv -> Dialogs.pickDate(ctx, date) { d -> date = d; tv.text = T.md(d) + " " + T.wk(d) } }, 10)
            note = ctx.input("备注（考场、范围…可不填）", e?.str("note") ?: "")
            c.add(note, 10)
            if (e == null) Dialogs.showKeyboard(subj.also { it.requestFocus() })
        }, e?.let { x -> { Dialogs.confirm(ctx, "删除「${x.str("subject")}」？", "", "删除", danger = true) { Tools.delExam(x.opt("id").toString()); render() } } }) {
            Tools.saveExam(e?.opt("id")?.toString(), subj.text.toString(), date, note.text.toString()); render()
        }
    }
}

// =====================================================================
/** 校园记账本（和网页、小程序的「校园记账本」插件同一个键） */
class LedgerPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var month: LocalDate = T.today().withDayOfMonth(1)
    override fun build(): View = scaffold("校园记账本", ctx.text("＋ 记一笔", 14f, C.accent, BOLD).apply { pad(12, 8); press(C.selected, 12); tap { edit(null) } }) { body = it }

    private fun money(v: Double): String = if (v == Math.floor(v)) String.format("%.0f", v) else String.format("%.2f", v)

    override fun render() {
        view
        keepScroll(body)
        val ym = String.format("%04d-%02d", month.year, month.monthValue)
        val list = Tools.book().filter { Tools.dayOf(it).startsWith(ym) }.sortedWith(compareByDescending<JSONObject> { Tools.dayOf(it) }.thenByDescending { it.str("time") })
        val out = list.filter { it.str("type") != "in" }.sumOf { it.optDouble("money", 0.0) }
        val inc = list.filter { it.str("type") == "in" }.sumOf { it.optDouble("money", 0.0) }
        // 月份切换
        val hr = ctx.row()
        hr.addView(ctx.text("‹", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { month = month.minusMonths(1); render() } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        hr.addView(ctx.text("${month.year}年${month.monthValue}月", 17f, C.text, BOLD).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(0, WRAP, 1f))
        hr.addView(ctx.text("›", 22f, C.text).apply { gravity = Gravity.CENTER; press(C.card, 12, C.line); tap { month = month.plusMonths(1); render() } }, LinearLayout.LayoutParams(dp(40), dp(40)))
        body.addView(hr)
        // 汇总
        val sc = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; pad(20, 18); margins(t = 12) }
        sc.addView(ctx.text("本月支出", 12.5f, C.sub, SEMI))
        sc.addView(ctx.text("¥ " + money(out), 32f, C.heroText, HEAVY).apply { margins(t = 2) })
        val sr = ctx.row().apply { margins(t = 8) }
        sr.addView(ctx.text("收入 ¥" + money(inc), 13.5f, C.green, SEMI), LinearLayout.LayoutParams(0, WRAP, 1f))
        sr.addView(ctx.text("结余 ¥" + money(inc - out), 13.5f, if (inc - out < 0) C.red else C.sub, SEMI))
        sc.addView(sr)
        body.addView(sc)
        if (list.isEmpty()) {
            body.addView(ctx.empty("💳", "这个月还没记账", "点右上角「记一笔」，吃饭、买书、车费都可以记"))
            return
        }
        // 支出分类
        val byCat = list.filter { it.str("type") != "in" }.groupBy { it.str("category").ifEmpty { "其他" } }.mapValues { (_, v) -> v.sumOf { it.optDouble("money", 0.0) } }.toList().sortedByDescending { it.second }
        if (byCat.isNotEmpty()) {
            body.addView(ctx.section("花在哪了"))
            val c = ctx.card(16, 18)
            val mx = byCat.first().second
            byCat.forEachIndexed { i, (cat, v) ->
                val r = ctx.row().apply { margins(t = if (i == 0) 0 else 10) }
                r.addView(ctx.text(cat, 13.5f, C.text), LinearLayout.LayoutParams(dp(56), WRAP))
                val track = android.widget.FrameLayout(ctx).apply { bg(C.mutedBg, 5) }
                track.addView(View(ctx).apply { bg(C.accent, 5) }, android.widget.FrameLayout.LayoutParams(0, MATCH))
                r.addView(track, LinearLayout.LayoutParams(0, dp(10), 1f))
                track.post { track.getChildAt(0).layoutParams = (track.getChildAt(0).layoutParams).apply { width = maxOf(dp(4), (track.width * (v / mx)).toInt()) }; track.requestLayout() }
                r.addView(ctx.text("¥" + money(v) + "  " + (if (out > 0) "${Math.round(v * 100 / out)}%" else ""), 12.5f, C.sub).apply { gravity = Gravity.END }, LinearLayout.LayoutParams(dp(96), WRAP))
                c.addView(r)
            }
            body.addView(c)
        }
        // 明细（按天）
        body.addView(ctx.section("明细", "${list.size} 笔"))
        for ((day, l) in list.groupBy { Tools.dayOf(it) }) {
            val dOut = l.filter { it.str("type") != "in" }.sumOf { it.optDouble("money", 0.0) }
            val h = ctx.row().apply { pad(4, 10, 4, 6) }
            h.addView(ctx.text(T.dayName(day), 13f, C.sub, SEMI), LinearLayout.LayoutParams(0, WRAP, 1f))
            if (dOut > 0) h.addView(ctx.text("支出 ¥" + money(dOut), 12.5f, C.sub))
            body.addView(h)
            val c = ctx.card(4, 16)
            l.forEachIndexed { i, x ->
                if (i > 0) c.addView(ctx.hline())
                val r = ctx.row().apply { pad(14, 11); press(0, 14); tap { edit(x) } }
                val isIn = x.str("type") == "in"
                r.addView(ctx.text(x.str("category").take(1).ifEmpty { "其" }, 14f, Color.WHITE, BOLD).apply { gravity = Gravity.CENTER; bg(if (isIn) C.green else C.mix(C.accent, C.gray, 0.3f), 10) }, LinearLayout.LayoutParams(dp(34), dp(34)))
                val cc = ctx.col().apply { pad(10, 0) }
                cc.addView(ctx.text(x.str("category").ifEmpty { "其他" }, 14.5f, C.text, SEMI))
                if (x.str("remark").isNotBlank()) cc.addView(ctx.text(x.str("remark"), 12.5f, C.sub, lines = 1))
                r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
                r.addView(ctx.text((if (isIn) "+" else "-") + money(x.optDouble("money", 0.0)), 16f, if (isIn) C.green else C.text, BOLD))
                c.addView(r)
            }
            body.addView(c)
        }
    }

    private fun edit(x: JSONObject?) {
        var type = if (x?.str("type") == "in") "in" else "out"
        var cat = x?.str("category")?.ifEmpty { null } ?: "餐饮"
        var date = x?.let { Tools.dayOf(it) }?.ifEmpty { null } ?: T.todayKey()
        lateinit var amt: EditText; lateinit var rem: EditText
        formSheet(a, if (x == null) "记一笔" else "修改这笔", { c ->
            c.add(Seg(ctx, listOf("支出", "收入"), if (type == "in") 1 else 0) { i -> type = if (i == 1) "in" else "out" }, 14)
            amt = ctx.input("金额（元）", x?.let { money(it.optDouble("money", 0.0)) } ?: "", type = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL).apply { textSize = 22f }
            c.add(amt, 10)
            val chips = android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false }
            val cr = ctx.row()
            val tvs = mutableListOf<TextView>()
            fun paint() { tvs.forEach { t -> val on = t.text == cat; t.setTextColor(if (on) Color.WHITE else C.text); t.bg(if (on) C.accent else C.mutedBg, 16) } }
            for (k in Tools.CATS) {
                val t = ctx.text(k, 14f, C.text, SEMI).apply { pad(14, 7); tap { cat = k; paint() } }
                tvs += t; cr.addView(t, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) })
            }
            paint()
            chips.addView(cr); c.add(chips, 12)
            c.add(pickRow(a, "日期", T.dayName(date)) { tv -> Dialogs.pickDate(ctx, date) { d -> date = d; tv.text = T.dayName(d) } }, 12)
            rem = ctx.input("备注（可不填）", x?.str("remark") ?: "")
            c.add(rem, 10)
            if (x == null) Dialogs.showKeyboard(amt.also { it.requestFocus() })
        }, x?.let { b -> { Dialogs.confirm(ctx, "删除这笔记录？", "", "删除", danger = true) { Tools.delBill(b.opt("id").toString()); render() } } }) {
            val m = amt.text.toString().trim().toDoubleOrNull() ?: throw IllegalArgumentException("请输入金额")
            Tools.saveBill(x?.opt("id")?.toString(), type, m, cat, rem.text.toString(), date); render()
        }
    }
}

// =====================================================================
/** 随机抽签：点名、抽奖、随机分组 */
class DrawPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var n = 1
    private var noRepeat = true
    private var result: List<String> = emptyList()
    private var groups: List<List<String>> = emptyList()
    override fun build(): View = scaffold("随机抽签") { body = it }

    override fun render() {
        view
        keepScroll(body)
        val names = Tools.drawNames(); val picked = Tools.drawPicked()
        val nc = ctx.card(16, 18)
        val nh = ctx.row()
        nh.addView(ctx.text("名单 · ${names.size} 人", 15.5f, C.text, BOLD), LinearLayout.LayoutParams(0, WRAP, 1f))
        nh.addView(ctx.text(if (names.isEmpty()) "填写名单" else "修改", 13.5f, C.accent, SEMI).apply { pad(10, 6); press(C.selected, 10); tap { editNames() } })
        nc.addView(nh)
        nc.add(ctx.text(if (names.isEmpty()) "把全班名字粘贴进来，一行一个，或者用逗号、顿号隔开" else names.take(40).joinToString("、") + if (names.size > 40) " …" else "", 13f, C.sub, lines = 3), 6)
        body.addView(nc)
        if (names.isEmpty()) { body.add(ctx.button("填写名单") { editNames() }, 16); return }

        // 结果
        val rc = HeroBox(ctx).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL; pad(20, 24); margins(t = 14) }
        if (groups.isNotEmpty()) {
            rc.addView(ctx.text("分好了 · ${groups.size} 组", 13f, C.sub, SEMI))
            groups.forEachIndexed { i, g -> rc.add(ctx.text("第 ${i + 1} 组：" + g.joinToString("、"), 14.5f, C.heroText, SEMI).apply { gravity = Gravity.START }, 8) }
        } else {
            rc.addView(ctx.text(if (result.isEmpty()) "准备好了吗？" else "抽中了", 13f, C.sub, SEMI))
            rc.add(ctx.text(if (result.isEmpty()) "🎲" else result.joinToString("  "), if (result.isEmpty()) 44f else if (result.size > 3) 22f else 32f, C.heroText, HEAVY).apply { gravity = Gravity.CENTER }, 8)
        }
        body.addView(rc)
        body.add(Seg(ctx, listOf("抽 1 个", "抽 2 个", "抽 3 个", "抽 5 个"), listOf(1, 2, 3, 5).indexOf(n)) { i -> n = listOf(1, 2, 3, 5)[i] }, 14)
        body.add(Toggle(ctx, "抽过的不再抽", if (noRepeat) "已抽 ${picked.size} / ${names.size}，全抽完自动重新开始" else "每次都从全部名单里抽", noRepeat) { v -> noRepeat = v; render() }, 10)
        body.add(ctx.button("开始抽签") { v -> roll(v) }, 14)
        val br = ctx.row().apply { margins(t = 10) }
        br.addView(ctx.soft("随机分组") { pickGroups() }, LinearLayout.LayoutParams(0, dp(44), 1f))
        br.addView(ctx.soft("重新开始", C.mutedBg, C.sub) { Tools.resetDraw(); result = emptyList(); groups = emptyList(); a.toast("已清空抽过的记录"); render() }, LinearLayout.LayoutParams(0, dp(44), 1f).apply { leftMargin = dp(10) })
        body.addView(br)
        if (picked.isNotEmpty() && noRepeat) body.add(ctx.text("已抽过：" + picked.takeLast(60).joinToString("、"), 12.5f, C.sub), 14)
    }
    /** 滚动几下再停下，像真的在抽 */
    private fun roll(v: View) {
        groups = emptyList()
        val names = Tools.drawNames()
        var k = 0
        val final = Tools.draw(n, noRepeat)
        val step = object : Runnable {
            override fun run() {
                if (k++ < 9) { result = names.shuffled().take(final.size); render(); v.buzz(); com.laolao.classcalendar.core.Bg.main.postDelayed(this, 60L + k * 12) }
                else { result = final; render(); v.performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM) }
            }
        }
        step.run()
    }
    private fun pickGroups() {
        val names = Tools.drawNames()
        Dialogs.sheet(ctx, "分成几组？", listOf(2, 3, 4, 5, 6, 8, 10).map { "$it 组（每组约 ${(names.size + it - 1) / it} 人）" }) { i ->
            val g = listOf(2, 3, 4, 5, 6, 8, 10)[i]
            val s = names.shuffled(java.util.Random(java.security.SecureRandom().nextLong()))
            groups = (0 until g).map { k -> s.filterIndexed { j, _ -> j % g == k } }.filter { it.isNotEmpty() }
            result = emptyList(); render()
        }
    }
    private fun editNames() = Dialogs.prompt(ctx, "名单", Tools.drawNames().joinToString("\n"), "一行一个名字，也可以用逗号隔开", multi = true) { s -> Tools.setNames(s); result = emptyList(); groups = emptyList(); render() }
}
