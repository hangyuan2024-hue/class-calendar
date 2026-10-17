package com.laolao.classcalendar.ui

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Island
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import org.json.JSONObject

/**
 * 捞捞助手（照小程序 lib/laomix.js / 网页 island.js）：
 * · 捞捞待在屏幕角落，举着一块小屏幕，显示最急的一件事（排序规则和网页、小程序同一套）；
 * · 打开时打个招呼；有事快到点 / 过期了冒个泡泡提醒（同一件事一天只提醒一次）；
 * · 点捞捞弹出小窗口：先做这几件（可以直接打勾）+ 问它一句；
 * · 按住捞捞拖到左边或右边、上下挪，松手自动贴边；位置只记在这台手机上。
 */
class Lao(private val a: Main, private val host: FrameLayout) {
    companion object {
        const val POS = "lao_pos_android_v1"      // 位置、开关：只记在这台手机上
        const val LS = "island_v1"                // 小屏幕、招呼、提醒：和网页、小程序同一个设置
        private const val SAID = "lao_said_v1"
        private var greeted = false
        fun pos(): JSONObject = Kv.obj(POS)
        fun on(): Boolean = !pos().optBoolean("off")
        fun setOn(v: Boolean) { val p = pos(); if (v) p.remove("off") else p.put("off", true); Kv.setQuiet(POS, p) }
        fun opt(k: String): Boolean = Kv.obj(LS).optBoolean(k, true)
        fun setOpt(k: String, v: Boolean) { val o = Kv.obj(LS); o.put(k, v); Kv.set(LS, o) }
    }

    private val d = a.resources.displayMetrics.density
    private fun px(v: Int) = (v * d).toInt()
    private val box = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; clipChildren = false; clipToPadding = false; setPadding(0, px(8), 0, px(4)) }
    private val dock = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.BOTTOM; clipChildren = false; clipToPadding = false }
    private val botBox = FrameLayout(a).apply { clipChildren = false }
    private val shadow = View(a)
    private val bot = ImageView(a).apply { scaleType = ImageView.ScaleType.FIT_CENTER }
    private val scr = LinearLayout(a).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    private val scrIc = a.text("", 16f)
    private val scrT = a.text("", 13f, Color.WHITE, BOLD, 1)
    private val scrS = a.text("", 11f, Color.WHITE, null, 1)
    private val fold = a.text("‹", 16f, C.alpha(Color.WHITE, 0.55f))
    private val tab = a.text("›", 14f, C.alpha(Color.WHITE, 0.7f)).apply { gravity = Gravity.CENTER }
    private var bub: View? = null
    private var veil: View? = null
    private var win: View? = null
    private var go: (() -> Unit)? = null
    private var bob: ObjectAnimator? = null
    private var right = false
    private var dragging = false
    private val tick = Runnable { paint(true); loop() }
    private val BOT = 62

    init {
        // 捞捞脚下一块柔和的影子 + 上下轻轻晃：站在屏幕上的感觉
        shadow.background = GradientDrawable().apply { shape = GradientDrawable.OVAL; gradientType = GradientDrawable.RADIAL_GRADIENT; gradientRadius = px(24).toFloat(); colors = intArrayOf(C.alpha(Color.BLACK, if (C.dark) 0.5f else 0.28f), Color.TRANSPARENT) }
        botBox.addView(shadow, FrameLayout.LayoutParams(px(48), px(12)).apply { gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL })
        botBox.addView(bot, FrameLayout.LayoutParams(px(BOT), px(BOT)).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL })
        drag()
        // 小屏幕：深色，带投影
        scr.background = round(if (C.dark) 0xF522343E.toInt() else 0xF5172C36.toInt(), px(16).toFloat(), if (C.dark) C.alpha(Color.WHITE, 0.08f) else 0, if (C.dark) 1 else 0)
        scr.lift(10, 0xFF172C36.toInt())
        val tx = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; addView(scrT); addView(scrS) }
        scr.addView(scrIc); scr.addView(tx, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = px(8); rightMargin = px(4) }); scr.addView(fold)
        scr.isClickable = true; scr.setOnClickListener { it.buzz(); go?.invoke() ?: toggle() }
        fold.setPadding(px(6), px(2), px(4), px(2)); fold.setOnClickListener { fold() }
        tab.background = round(if (C.dark) 0xFF22343E.toInt() else 0xFF172C36.toInt(), px(10).toFloat()); tab.lift(6, 0xFF172C36.toInt()); tab.setOnClickListener { fold() }
        box.addView(dock, LinearLayout.LayoutParams(WRAP, WRAP))
    }

    // ---------- 放到页面上（每次切标签都会把内容清掉，再放回来） ----------
    fun attach() {
        Bg.main.removeCallbacks(hideBub)
        bub?.let { box.removeView(it) }; win?.let { host.removeView(it) }; veil?.let { host.removeView(it) }
        win = null; veil = null; bub = null
        (box.parent as? android.view.ViewGroup)?.removeView(box)
        if (!on()) { stop(); return }
        host.addView(box, place())
        paint(true)
        bob?.cancel()
        bob = ObjectAnimator.ofFloat(bot, "translationY", 0f, -px(4).toFloat()).apply { duration = 1800; repeatCount = ValueAnimator.INFINITE; repeatMode = ValueAnimator.REVERSE; start() }
        loop()
    }
    fun stop() { bob?.cancel(); Bg.main.removeCallbacks(tick) }
    private fun loop() { Bg.main.removeCallbacks(tick); if (box.parent != null) Bg.main.postDelayed(tick, 60_000) }

    private fun place(): FrameLayout.LayoutParams {
        val p = pos(); right = p.optString("side") == "r"
        val maxY = maxOf(0, host.height - a.underBar - px(220))
        var y = p.optInt("y", px(14)).coerceAtMost(if (host.height > 0) maxY else Int.MAX_VALUE)
        if (right) y = maxOf(y, px(92))                       // 右边别挡住「＋」
        return FrameLayout.LayoutParams(WRAP, WRAP).apply {
            gravity = Gravity.BOTTOM or if (right) Gravity.END else Gravity.START
            leftMargin = px(8); rightMargin = px(8); bottomMargin = y + a.underBar
        }
    }

    // ---------- 画：捞捞 + 小屏幕 ----------
    fun paint(talk: Boolean = false) {
        if (!on()) { if (box.parent != null) { (box.parent as android.view.ViewGroup).removeView(box); stop() }; return }
        if (box.parent == null || dragging) return
        val c = try { Island.ctx() } catch (_: Exception) { return }
        val list = try { Island.rank(c.items, c.courses, c.now).filter { it.level != "past" } } catch (_: Exception) { emptyList() }
        val h = c.now.hour; val night = h >= 23 || h < 5
        bot.setImageResource(if (night) R.drawable.mascot_sleep else R.drawable.mascot)
        val top = list.firstOrNull()
        val level: String
        if (top != null) {
            scrIc.text = if (top.kind == "course") "📚" else if (top.exam) "📝" else if (top.type == "作业") "✏️" else "📌"
            scrT.text = top.title; scrS.text = top.reason; level = top.level
            go = { open(top) }
        } else {
            scrIc.text = if (night) "🌙" else "☕"
            scrT.text = if (night) "夜深了，早点睡" else "手头没有要赶的事"
            scrS.text = if (night) "睡饱了脑子才转得快" else "来一个番茄专注一下？"
            level = "calm"; go = if (night) null else ({ a.push(PlanPage(a)) })
        }
        scrS.setTextColor(when (level) { "late", "now" -> 0xFFFF9B8A.toInt(); "urgent" -> 0xFFFFC46B.toInt(); "calm" -> 0xFFA8E6C6.toInt(); else -> 0xFF9FD0FF.toInt() })
        scrS.visibility = if (scrS.text.isNullOrEmpty()) View.GONE else View.VISIBLE
        layoutDock()
        if (!talk || win != null) return
        var say = ""
        if (!greeted && opt("greet")) { greeted = true; say = try { Island.greet(c) } catch (_: Exception) { "" } }
        else if (opt("remind") && top != null && top.kind == "item" && top.level in setOf("late", "now", "urgent") && once("r:" + top.key + ":" + top.level))
            say = when { top.level == "late" -> "「${top.title}」已经过期了，先补上吧！"; top.level == "now" -> "「${top.title}」已经开始了" + (if (top.location.isNotEmpty()) "，在 ${top.location}" else "") + "，快去吧！"; else -> "「${top.title}」${top.reason.ifEmpty { "快到了" }}" + (if (top.type == "作业") "，别忘了哦" else if (top.location.isNotEmpty()) "，在 ${top.location}" else "，提前准备一下") }
        if (say.isNotEmpty()) say(say)
    }
    private fun layoutDock() {
        val screen = opt("screen")
        val side: View? = if (dragging) null else if (screen) scr else tab
        if (botBox.parent == null) dock.addView(botBox, LinearLayout.LayoutParams(px(BOT + 4), px(BOT + 6)))
        val cur = (0 until dock.childCount).map { dock.getChildAt(it) }
        val want = if (side == null) listOf(botBox) else if (right) listOf(side, botBox) else listOf(botBox, side)
        if (cur == want) return
        val showScr = side == scr && scr.parent == null
        // 只增删小屏幕，捞捞本身一直留着（正被按住时拿掉它，拖动就断了）
        for (v in cur) if (v !== botBox) dock.removeView(v)
        if (side != null) {
            val lp = if (side == scr) LinearLayout.LayoutParams(WRAP, WRAP).apply { bottomMargin = px(12); if (right) rightMargin = -px(10) else leftMargin = -px(10) }
                     else LinearLayout.LayoutParams(px(20), px(30)).apply { bottomMargin = px(20); if (right) rightMargin = -px(6) else leftMargin = -px(6) }
            if (side == scr) { scr.minimumWidth = px(150); scr.setPadding(if (right) px(12) else px(18), px(8), if (right) px(18) else px(8), px(8)); fold.text = if (right) "›" else "‹" }
            if (side == tab) tab.text = if (right) "‹" else "›"
            dock.addView(side, if (right) 0 else 1, lp)
        }
        scrT.maxWidth = px(190); scrS.maxWidth = px(190)
        // 捞捞画在小屏幕上面（不改顺序，用高度）
        botBox.translationZ = px(12).toFloat()
        if (showScr) { scr.alpha = 0f; scr.translationY = px(8).toFloat(); scr.animate().alpha(1f).translationY(0f).setDuration(300).setInterpolator(OvershootInterpolator(1.4f)).start() }
    }
    private fun fold() { setOpt("screen", !opt("screen")); bub?.let { box.removeView(it) }; bub = null; layoutDock() }

    private fun once(key: String): Boolean {
        val said = Kv.obj(SAID); val t = T.todayKey()
        if (said.optString(key) == t) return false
        val old = T.addDays(t, -3); for (k in said.keys().asSequence().toList()) if (said.optString(k) < old) said.remove(k)
        said.put(key, t); Kv.setQuiet(SAID, said); return true
    }

    // ---------- 泡泡 ----------
    private val hideBub = Runnable { bub?.let { dismissBub(it) } }
    private fun dismissBub(v: View) { if (bub === v) bub = null; v.isClickable = false; v.animate().alpha(0f).scaleX(0.9f).scaleY(0.9f).setDuration(180).withEndAction { (v.parent as? android.view.ViewGroup)?.removeView(v) }.start() }
    fun say(text: String) {
        bub?.let { box.removeView(it) }
        val b = FrameLayout(a)
        val t = a.text(text, 13f, C.text).apply { setLineSpacing(0f, 1.35f); setPadding(px(13), px(10), px(30), px(10)) }
        b.background = GradientDrawable().apply { setColor(C.card); setStroke(1, C.line)
            cornerRadii = if (right) floatArrayOf(14f, 14f, 14f, 14f, 4f, 4f, 14f, 14f).map { it * d }.toFloatArray() else floatArrayOf(14f, 14f, 14f, 14f, 14f, 14f, 4f, 4f).map { it * d }.toFloatArray() }
        b.lift(8, C.text)
        b.addView(t, FrameLayout.LayoutParams(WRAP, WRAP))
        b.addView(a.text("×", 18f, C.sub).apply { gravity = Gravity.CENTER; setOnClickListener { it.buzz(); Bg.main.removeCallbacks(hideBub); dismissBub(b) } }, FrameLayout.LayoutParams(px(36), px(36)).apply { gravity = Gravity.END or Gravity.TOP })
        b.setOnClickListener { Bg.main.removeCallbacks(hideBub); dismissBub(b); toggle() }
        t.maxWidth = minOf(px(270), host.width - px(40))
        box.addView(b, 0, LinearLayout.LayoutParams(WRAP, WRAP).apply { bottomMargin = px(6); gravity = if (right) Gravity.END else Gravity.START; leftMargin = px(6); rightMargin = px(6) })
        box.gravity = if (right) Gravity.END else Gravity.START
        bub = b
        b.alpha = 0f; b.scaleX = 0.9f; b.scaleY = 0.9f; b.pivotX = if (right) px(260).toFloat() else 0f; b.pivotY = px(40).toFloat()
        b.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(260).setInterpolator(OvershootInterpolator(1.5f)).start()
        // 说话时蹦两下
        ObjectAnimator.ofFloat(bot, "rotation", 0f, 6f, -4f, 3f, 0f).apply { duration = 700; start() }
        Bg.main.removeCallbacks(hideBub); Bg.main.postDelayed(hideBub, 7000)
    }

    // ---------- 拖动：按住捞捞挪，松手贴到最近的一边 ----------
    @SuppressLint("ClickableViewAccessibility")
    private fun drag() {
        var x0 = 0f; var y0 = 0f; var moved = false
        botBox.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { x0 = e.rawX; y0 = e.rawY; moved = false; bot.animate().scaleX(0.94f).scaleY(0.94f).setDuration(80).start(); true }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - x0; val dy = e.rawY - y0
                    if (!moved && Math.abs(dx) + Math.abs(dy) < px(8)) return@setOnTouchListener true
                    if (!moved) {
                        moved = true; dragging = true; botBox.buzz(); botBox.parent.requestDisallowInterceptTouchEvent(true)
                        Bg.main.removeCallbacks(hideBub); bub?.let { box.removeView(it) }; bub = null; close()
                        // 只留捞捞，跟着手指走；拿起来时放大一点、影子变大
                        val before = IntArray(2); botBox.getLocationInWindow(before)
                        layoutDock(); box.translationX = 0f; box.translationY = 0f
                        box.post { val now = IntArray(2); botBox.getLocationInWindow(now); x0 -= (before[0] - now[0]); y0 -= (before[1] - now[1]) }
                        bob?.pause(); bot.animate().scaleX(1.15f).scaleY(1.15f).setDuration(150).start()
                        shadow.animate().scaleX(1.4f).alpha(0.6f).translationY(px(6).toFloat()).setDuration(150).start()
                    }
                    val minX = -box.left.toFloat(); val maxX = (host.width - box.right).toFloat()
                    val minY = -box.top.toFloat(); val maxY = (host.height - a.underBar - box.bottom).toFloat()
                    box.translationX = (e.rawX - x0).coerceIn(minX, maxX); box.translationY = (e.rawY - y0).coerceIn(minY, maxY)
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    bot.animate().scaleX(1f).scaleY(1f).setDuration(160).start()
                    if (!moved) { if (e.actionMasked == MotionEvent.ACTION_UP) { botBox.buzz(); toggle() }; return@setOnTouchListener true }
                    shadow.animate().scaleX(1f).alpha(1f).translationY(0f).setDuration(200).start(); bob?.resume()
                    val vx = box.left + box.translationX; val vy = box.top + box.translationY
                    val side = if (vx + box.width / 2f > host.width / 2f) "r" else "l"
                    val y = (host.height - a.underBar - (vy + box.height)).toInt().coerceIn(0, maxOf(0, host.height - a.underBar - px(220)))
                    Kv.setQuiet(POS, pos().put("side", side).put("y", y))
                    box.layoutParams = place()
                    box.post {
                        box.translationX = vx - box.left; box.translationY = vy - box.top
                        box.animate().translationX(0f).translationY(0f).setDuration(320).setInterpolator(OvershootInterpolator(1.1f)).withEndAction { dragging = false; layoutDock() }.start()
                    }
                    true
                }
                else -> false
            }
        }
    }

    // ---------- 小窗口：先做这几件 + 问一句 ----------
    private var ans: Island.Answer? = null
    private var askQ = ""
    private fun toggle() { if (win != null) close() else panel() }
    fun close() {
        win?.let { v -> host.removeView(v) }; veil?.let { v -> host.removeView(v) }; win = null; veil = null; ans = null
        Dialogs.hideKeyboard(host)
    }
    val isOpen: Boolean get() = win != null
    val isAttached: Boolean get() = box.parent != null
    private fun open(r: Island.Row) {
        close()
        when {
            r.kind == "course" -> a.push(CoursePage(a))
            r.type == "作业" -> a.selectTab(1)
            r.key.isNotEmpty() -> a.push(ItemPage(a, r.key))
        }
    }
    private fun panel() {
        val c = try { Island.ctx() } catch (_: Exception) { return }
        val list = Island.rank(c.items, c.courses, c.now).filter { it.level != "past" }
        win?.let { host.removeView(it) }
        if (veil == null) {
            veil = View(a).apply { setBackgroundColor(C.alpha(0xFF080E20.toInt(), 0.14f)); isClickable = true; setOnClickListener { close() }; alpha = 0f; animate().alpha(1f).setDuration(180).start() }
            host.addView(veil, host.indexOfChild(box).coerceAtLeast(0), FrameLayout.LayoutParams(MATCH, MATCH))
        }
        val w = LinearLayout(a).apply { orientation = LinearLayout.VERTICAL; setPadding(px(16), px(14), px(16), px(12)); isClickable = true }
        w.background = round(C.card, px(22).toFloat(), C.line, 1); w.lift(14, C.text)
        val h = a.row()
        h.addView(a.text(hello(c.now.hour) + (if (c.name.isNotEmpty()) "，" + c.name else "") + " 👋", 16f, C.text, HEAVY, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
        h.addView(a.text("×", 22f, C.sub).apply { setPadding(px(12), 0, px(4), 0); setOnClickListener { close() } })
        w.addView(h)
        w.addView(a.text("先做这些", 11.5f, C.sub, SEMI).apply { letterSpacing = 0.1f; setPadding(0, px(10), 0, px(2)) })
        if (list.isEmpty()) w.addView(a.text("手头没有要赶的事，去专注一会儿或者早点休息吧 ☕", 13f, C.sub).apply { setPadding(0, px(6), 0, px(6)) })
        list.take(4).forEachIndexed { i, r ->
            if (i > 0) w.addView(a.hline())
            val row = a.row().apply { setPadding(0, px(9), 0, px(9)) }
            if (r.kind == "item") row.addView(View(a).apply { background = round(Color.TRANSPARENT, px(6).toFloat(), C.accent, px(2))
                setOnClickListener { v -> v.buzz(); Items.toggleDone(r.key); com.laolao.classcalendar.core.Bus.emit("data"); Cheer.show(a, "item"); Bg.main.postDelayed({ if (win != null) { ans = null; panel() } }, 60) } },
                LinearLayout.LayoutParams(px(20), px(20)).apply { rightMargin = px(10) })
            else row.addView(a.text("📚", 16f).apply { setPadding(0, 0, px(10), 0) })
            val m = a.col().apply { addView(a.text((if (r.exam) "📝 " else "") + r.title, 14f, C.text, SEMI, 1)); addView(a.text(r.type + " · " + r.whenText + (if (r.location.isNotEmpty()) " · " + r.location else ""), 11.5f, C.sub, null, 1)); setOnClickListener { open(r) } }
            row.addView(m, LinearLayout.LayoutParams(0, WRAP, 1f))
            row.addView(a.text(r.reason, 11.5f, when (r.level) { "late", "now" -> C.red; "urgent" -> 0xFFC27803.toInt(); else -> C.sub }, SEMI, 2).apply { gravity = Gravity.END; maxWidth = px(92); setPadding(px(8), 0, 0, 0) })
            w.addView(row)
        }
        if (list.size > 4) w.addView(a.text("还有 ${list.size - 4} 件 ›", 12f, C.accent).apply { setPadding(0, px(2), 0, px(2)); setOnClickListener { close(); a.push(AskPage(a)) } })
        val an = ans
        if (an != null) {
            val ab = a.col().apply { bg(C.mutedBg, 14); pad(12, 10) }
            ab.addView(a.text(askQ, 11.5f, C.sub))
            ab.addView(a.text(an.text, 13.5f, C.text).apply { setLineSpacing(0f, 1.35f); setPadding(0, px(3), 0, 0) })
            (an.lines.take(5) + an.list.take(4).map { it.title + if (it.reason.isNotEmpty()) " · " + it.reason else "" }).forEach { ab.addView(a.text("· $it", 12.5f, C.text)) }
            w.addView(ab, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = px(10) })
        } else {
            val chips = a.row()
            listOf("最近哪件事最急？", "明天要干什么？", "今天有什么课？").forEach { q -> chips.addView(a.text(q, 12f, C.accent, SEMI, 1).apply { setPadding(px(10), px(5), px(10), px(5)); bg(C.selected, 14); setOnClickListener { ask(q) } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = px(6) }) }
            w.addView(android.widget.HorizontalScrollView(a).apply { isHorizontalScrollBarEnabled = false; addView(chips) }, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = px(10) })
        }
        val inRow = a.row().apply { bg(C.mutedBg, 14, C.line); setPadding(px(12), 0, px(4), 0) }
        val inp = a.input("问捞捞，比如：明天有什么课").apply { background = null; setPadding(0, px(9), 0, px(9)); textSize = 13.5f; imeOptions = EditorInfo.IME_ACTION_SEND; setSingleLine(true)
            setOnEditorActionListener { v, _, _ -> ask(v.text.toString()); true } }
        inRow.addView(inp, LinearLayout.LayoutParams(0, WRAP, 1f))
        inRow.addView(a.text("问", 13f, Color.WHITE, BOLD).apply { setPadding(px(14), px(6), px(14), px(6)); bg(C.accent, 10); setOnClickListener { ask(inp.text.toString()) } })
        w.addView(inRow, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = px(12) })
        val f = a.row().apply { setPadding(0, px(12), 0, 0) }
        f.addView(a.text("打开完整问答 ›", 12f, C.accent, SEMI).apply { setOnClickListener { close(); a.push(AskPage(a)) } })
        f.addView(View(a), LinearLayout.LayoutParams(0, 1, 1f))
        f.addView(a.text(if (opt("screen")) "收起小屏幕" else "显示小屏幕", 12f, C.sub).apply { setOnClickListener { fold(); panel() } })
        f.addView(a.text("  ·  ", 12f, C.mutedText))
        f.addView(a.text("让捞捞休息", 12f, C.sub).apply { setOnClickListener { close()
            Dialogs.confirm(a, "让捞捞休息？", "只在这台手机上；以后在「我的 → 趣味与效率」里可以再叫它出来。", "休息") { setOn(false); paint() } } })
        w.addView(f)
        // 开在捞捞上面还是下面：哪边地方大开在哪边
        val loc = IntArray(2); botBox.getLocationInWindow(loc); val hl = IntArray(2); host.getLocationInWindow(hl)
        val botTop = loc[1] - hl[1]; val botBottom = botTop + botBox.height
        val above = botTop - px(16); val below = host.height - a.underBar - botBottom - px(16)
        val up = above >= below
        val sv = ScrollView(a).apply { isVerticalScrollBarEnabled = false; clipToPadding = false; setPadding(px(4), px(4), px(4), px(16)); addView(w) }
        val lp = FrameLayout.LayoutParams(minOf(px(320), host.width - px(24)), WRAP).apply {
            gravity = (if (up) Gravity.BOTTOM else Gravity.TOP) or if (right) Gravity.END else Gravity.START
            leftMargin = px(8); rightMargin = px(8)
            if (up) bottomMargin = host.height - botTop - px(8) else topMargin = botBottom - px(4)
        }
        host.addView(sv, lp)
        sv.post { val avail = if (up) above else below; if (sv.height > avail) sv.layoutParams = (sv.layoutParams as FrameLayout.LayoutParams).apply { height = maxOf(px(240), avail) } }
        win = sv
        w.pivotY = if (up) px(400).toFloat() else 0f; w.pivotX = if (right) px(300).toFloat() else 0f
        w.alpha = 0f; w.scaleX = 0.92f; w.scaleY = 0.92f
        w.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(240).setInterpolator(OvershootInterpolator(1.2f)).start()
        box.bringToFront()
    }
    private fun ask(q0: String) {
        val q = q0.trim(); if (q.isEmpty()) return
        askQ = q
        ans = try { Island.answer(q, Island.ctx()) ?: Island.fallback() } catch (e: Exception) { Island.Answer("我这会儿有点懵，换个问法试试？") }
        Dialogs.hideKeyboard(host)
        val keep = ans; panel(); ans = keep
    }
    private fun hello(h: Int) = if (h < 5) "夜深了" else if (h < 9) "早上好" else if (h < 12) "上午好" else if (h < 14) "中午好" else if (h < 18) "下午好" else "晚上好"
}
