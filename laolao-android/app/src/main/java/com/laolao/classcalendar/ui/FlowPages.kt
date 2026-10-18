package com.laolao.classcalendar.ui

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.BlurMaskFilter
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.SweepGradient
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Coach
import com.laolao.classcalendar.core.Flow
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.str
import org.json.JSONObject

/**
 * 5.9.4 刷任务：全屏一张张小卡，上划下一张（规则在 core/Flow.kt，和网页、小程序、电脑版同一套）。
 *  · 每张卡要真的计时走完才算数、才有机会掉东西；离开 App 30 分钟以内（手机放下做题）算到这张卡剩下的时间为止，离开太久这张重来
 *  · 一轮 50 分钟就停：刷完了就去玩
 *  · 上面一行显示「班里现在 N 人在专注」（只有数字，接口在 5.9.4 的 SQL）
 */
class FlowPage(a: Main, private val onlyBook: Boolean = false) : Page(a) {
    private val BG0 = 0xFF1E1B4B.toInt(); private val BG1 = 0xFF0B1020.toInt(); private val BG2 = 0xFF05070F.toInt()
    private val PINK = 0xFFF472B6.toInt(); private val VIOLET = 0xFFA78BFA.toInt(); private val GOLD = 0xFFFBBF24.toInt()
    private lateinit var root: FrameLayout
    private lateinit var stage: FrameLayout
    private lateinit var prog: ProgBar
    private lateinit var bagBtn: TextView
    private lateinit var roomTv: TextView
    private lateinit var sparks: SparkView
    private var cardView: View? = null
    private var ring: FlowRing? = null
    private var noteTv: TextView? = null
    private var overlay: View? = null

    private var cards = ArrayList<Flow.Card>()
    private var i = 0
    private var acc = 0L; private var last = 0L; private var hiddenAt = 0L
    private var done = false; private var work = 0; private var got = 0
    private var note = ""
    private val tick = object : Runnable { override fun run() { step(); Bg.main.postDelayed(this, 250) } }
    private val roomTick = object : Runnable { override fun run() { room(null, 0); Bg.main.postDelayed(this, 60_000) } }

    override val autoRender = false
    override fun build(): View {
        root = object : FrameLayout(ctx) {
            var y0 = 0f; var dragging = false
            override fun onInterceptTouchEvent(e: MotionEvent): Boolean {
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { y0 = e.y; dragging = false }
                    MotionEvent.ACTION_MOVE -> if (!dragging && y0 - e.y > dp(14) && overlay == null) { dragging = true; return true }
                }
                return false
            }
            override fun onTouchEvent(e: MotionEvent): Boolean {
                val cv = cardView
                when (e.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { y0 = e.y; return true }
                    MotionEvent.ACTION_MOVE -> { val dy = minOf(0f, e.y - y0); cv?.translationY = dy * 0.5f; cv?.rotationX = (-dy / height * 30f).coerceAtMost(18f) }
                    MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                        val dy = y0 - e.y; dragging = false
                        if (dy > dp(80)) swipe() else cv?.animate()?.translationY(0f)?.rotationX(0f)?.setDuration(220)?.setInterpolator(OvershootInterpolator())?.start()
                    }
                }
                return true
            }
        }
        root.background = GradientDrawable().apply {
            gradientType = GradientDrawable.RADIAL_GRADIENT; colors = intArrayOf(BG0, BG1, BG2)
            gradientRadius = ctx.resources.displayMetrics.heightPixels * 0.9f; setGradientCenter(0.5f, 0f)
        }
        root.clipChildren = false
        val col = ctx.col()
        // 顶栏
        val top = ctx.row().apply { pad(16, 12, 16, 6) }
        top.addView(circle("✕") { close() }, LinearLayout.LayoutParams(dp(38), dp(38)))
        prog = ProgBar(ctx)
        top.addView(prog, LinearLayout.LayoutParams(0, dp(6), 1f).apply { leftMargin = dp(12); rightMargin = dp(12) })
        bagBtn = ctx.text("🎁", 13f, Color.WHITE, SEMI).apply { gravity = Gravity.CENTER; pad(12, 7); background = round(0x1AFFFFFF, dp(18).toFloat()); tap { book() } }
        top.addView(bagBtn)
        col.addView(top)
        roomTv = ctx.text("", 12.5f, 0xFFC4B5FD.toInt()).apply { gravity = Gravity.CENTER; pad(16, 2) }
        col.addView(roomTv, LinearLayout.LayoutParams(MATCH, WRAP))
        stage = FrameLayout(ctx).apply { clipChildren = false; cameraDistance = 12000 * ctx.resources.displayMetrics.density }
        col.addView(stage, LinearLayout.LayoutParams(MATCH, 0, 1f))
        col.addView(ctx.text("上划：下一张 · 每张都要真的计时走完才算", 11.5f, 0xFF64748B.toInt()).apply { gravity = Gravity.CENTER; pad(0, 6, 0, 16) }, LinearLayout.LayoutParams(MATCH, WRAP))
        root.addView(col, FrameLayout.LayoutParams(MATCH, MATCH))
        sparks = SparkView(ctx); root.addView(sparks, FrameLayout.LayoutParams(MATCH, MATCH))
        return root
    }

    override fun onShow() {
        a.immersive(true, BG0, BG2)
        a.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (cards.isEmpty()) {
            if (onlyBook) { book(); return }
            val d = Flow.deckNow()
            if (d.cards.isEmpty()) { a.toast(d.say); Bg.main.post { close() }; return }
            cards = ArrayList(d.cards); i = 0
            paint(true)
            Bg.main.post(tick); Bg.main.post(roomTick)
        }
    }
    override fun onHide() {
        a.immersive(false)
        a.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        Bg.main.removeCallbacks(tick); Bg.main.removeCallbacks(roomTick)
        Store.cls?.str("id")?.let { cid -> Bg.run { try { Api.rpc("study_leave", jsonOf("p_cid" to cid)) } catch (_: Exception) {} } }
        if (work > 0) a.toast("这次专注了 $work 分钟" + (if (got > 0) "，掉了 $got 样东西" else "") + " 👏")
    }
    // 切到别的 App / 锁屏
    override fun onAppPause() { hiddenAt = SystemClock.elapsedRealtime(); last = 0 }
    override fun onAppResume() {
        if (hiddenAt == 0L) return
        val away = SystemClock.elapsedRealtime() - hiddenAt; hiddenAt = 0
        val c = cards.getOrNull(i) ?: return
        if (c.min <= 0 || done) return
        val cr = Flow.awayCredit(away, c.min * 60_000L - acc)
        if (cr < 0) { acc = 0; note = "刚才离开太久了，这张从头开始"; paint(false, same = true) } else acc += cr
    }
    override fun onBack(): Boolean { overlay?.let { removeOverlay(); return true }; return false }

    private fun circle(s: String, fn: () -> Unit) = ctx.text(s, 16f, Color.WHITE, BOLD).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0x1AFFFFFF) }; tap { fn() } }
    private fun pill(s: String, kind: String, fn: () -> Unit): TextView = ctx.text(s, if (kind == "sm") 13f else 15f, if (kind == "sm") 0xFF94A3B8.toInt() else Color.WHITE, if (kind == "sm") SEMI else BOLD).apply {
        gravity = Gravity.CENTER; pad(18, if (kind == "sm") 9 else 12)
        background = when (kind) {
            "go" -> GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF8B5CF6.toInt(), 0xFFEC4899.toInt())).apply { cornerRadius = dp(16).toFloat() }
            "ok" -> GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF10B981.toInt(), 0xFF06B6D4.toInt())).apply { cornerRadius = dp(16).toFloat() }
            "sm" -> null
            else -> round(0x1FFFFFFF, dp(16).toFloat())
        }
        if (kind == "go" || kind == "ok") { elevation = dp(6).toFloat(); if (Build.VERSION.SDK_INT >= 28) { outlineSpotShadowColor = if (kind == "go") 0xFFEC4899.toInt() else 0xFF06B6D4.toInt() } }
        tap { it.buzz(); fn() }
    }

    // ---------- 计时 ----------
    private fun step() {
        val c = cards.getOrNull(i) ?: return
        if (done || c.min <= 0 || hiddenAt != 0L) return
        val now = SystemClock.elapsedRealtime()
        if (last > 0) acc += minOf(2000L, now - last)
        last = now
        if (acc >= c.min * 60_000L) finish() else ring?.set(acc.toFloat() / (c.min * 60_000f), left(c))
    }
    private fun left(c: Flow.Card): String { val s = ((c.min * 60_000L - acc + 999) / 1000).coerceAtLeast(0); return "${s / 60}:${(s % 60).toString().padStart(2, '0')}" }

    // ---------- 画一张卡 ----------
    private val KIND = mapOf("start" to "🚀 开头", "work" to "⏱ 专注", "review" to "📖 复习", "check" to "✅ 确认", "break" to "🍵 休息", "end" to "🎉 收工")
    private fun paint(first: Boolean, same: Boolean = false) {
        val c = cards.getOrNull(i) ?: return
        prog.set(cards.size, i)
        bagBtn.text = "🎁 ${Flow.fullBag().owned()}/${Flow.LOOT.size}"
        val card = ctx.col().apply {
            gravity = Gravity.CENTER_HORIZONTAL; pad(22, 26, 22, 20)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0x24FFFFFF, 0x0AFFFFFF)).apply { cornerRadius = dp(28).toFloat(); setStroke(dp(1), 0x2EFFFFFF) }
            elevation = dp(18).toFloat(); if (Build.VERSION.SDK_INT >= 28) { outlineSpotShadowColor = VIOLET; outlineAmbientShadowColor = Color.BLACK }
        }
        card.addView(ctx.text((KIND[c.kind] ?: "") + if (c.min > 0) " · ${c.min} 分钟" else "", 12f, 0xFFE9D5FF.toInt(), SEMI).apply { pad(10, 4); background = round(0x1FFFFFFF, dp(12).toFloat()) })
        card.addView(ctx.text(c.title, 22f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; pad(0, 12, 0, 6) })
        val stepText = if (c.kind == "end") "这一轮专注了 $work 分钟" + (if (got > 0) "，掉了 $got 样东西" else "") + " 🎉 去玩吧，想继续可以再来一轮" else c.step
        card.addView(ctx.text(stepText, 15f, 0xFFCBD5E1.toInt()).apply { gravity = Gravity.CENTER; setLineSpacing(0f, 1.4f) })
        ring = null
        when {
            c.min > 0 -> {
                val r = FlowRing(ctx).apply { label = if (done) "完成 ✓" else if (c.kind == "break") "休息" else "计时中" }
                r.set(if (done) 1f else acc.toFloat() / (c.min * 60_000f), if (done) "0:00" else left(c))
                card.addView(r, LinearLayout.LayoutParams(dp(196), dp(196)).apply { topMargin = dp(18); bottomMargin = dp(6) })
                ring = r
                val br = ctx.row().apply { gravity = Gravity.CENTER }
                if (done) br.addView(pill("继续 ↑", "go") { next() }) else br.addView(pill("跳过这张（不计时）", "sm") { next() })
                card.addView(br, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(10) })
            }
            c.kind == "check" -> {
                val br = ctx.row().apply { gravity = Gravity.CENTER }
                br.addView(pill("✓ 做完了", "ok") { yes(c) })
                br.addView(pill("还没，再来 10 分钟", "go") { cards.add(i + 1, Flow.more(c)); next() }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(10) })
                card.addView(br, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(20) })
                card.addView(pill("先放一放，换下一件", "sm") { Coach.skip(c.key); dropKey(c.key); next() }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(6) })
            }
            c.kind == "end" -> {
                card.addView(ctx.text("🎉", 60f).apply { gravity = Gravity.CENTER; pad(0, 12) })
                val br = ctx.row().apply { gravity = Gravity.CENTER }
                br.addView(pill("收工，去玩！", "ok") { close() })
                br.addView(pill("再来一轮", "") { again() }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(10) })
                card.addView(br, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(8) })
            }
        }
        noteTv = ctx.text(note, 12.5f, GOLD).apply { gravity = Gravity.CENTER; pad(0, 8, 0, 0) }
        card.addView(noteTv)
        val lp = FrameLayout.LayoutParams(minOf(ctx.resources.displayMetrics.widthPixels - dp(32), dp(420)), WRAP, Gravity.CENTER)
        val old = cardView
        if (old != null && !first && !same) {
            old.animate().translationY(-stage.height * 0.9f).rotationX(25f).scaleX(0.9f).scaleY(0.9f).alpha(0f).setDuration(380).withEndAction { stage.removeView(old) }.start()
        } else if (old != null) stage.removeView(old)
        stage.addView(card, lp); cardView = card
        if (!same) {
            card.translationY = stage.height * 0.4f + dp(120); card.rotationX = -20f; card.scaleX = 0.92f; card.scaleY = 0.92f; card.alpha = 0f
            card.animate().translationY(0f).rotationX(0f).scaleX(1f).scaleY(1f).alpha(1f).setDuration(460).setInterpolator(OvershootInterpolator(1.1f)).start()
        }
    }
    private fun setNote(s: String) { note = s; noteTv?.text = s }

    // ---------- 一张卡走完 ----------
    private fun finish() {
        val c = cards[i]; done = true; note = ""
        paint(false, same = true)
        if (c.kind == "break") { Chime.play(ctx, 0); buzz(longArrayOf(0, 60)); return }
        work += c.min
        Coach.record(Coach.Ev(System.currentTimeMillis(), "flow", if (c.key == "review") "" else c.key, m = c.min))
        val nx = cards.getOrNull(i + 1); room(if (nx != null && nx.min > 0) nx.min else 0, c.min)
        val r = Flow.roll(Flow.myBag(), c.min); Flow.save(r.bag)
        if (r.got != null) { got++; reveal(r) }
        else { Chime.play(ctx, 0); buzz(longArrayOf(0, 80)); sparks.burst(14, intArrayOf(VIOLET, PINK, GOLD)); if (r.cap) setNote("今天的掉落已经满了，明天再来；专注照样算数") }
    }
    private fun reveal(r: Flow.Roll) {
        val g = r.got ?: return; val rc = Flow.RC[g.r]
        Chime.play(ctx, g.r + 1); buzz(if (g.r >= 2) longArrayOf(0, 60, 40, 60, 40, 160) else longArrayOf(0, 60, 40, 100))
        val ov = FrameLayout(ctx).apply { setBackgroundColor(0xE605070F.toInt()); isClickable = true; clipChildren = false }
        if (g.r >= 2) {
            val rays = RaysView(ctx, rc)
            ov.addView(rays, FrameLayout.LayoutParams(dp(420), dp(420), Gravity.CENTER))
            rays.animate().rotation(360f * 4).setDuration(32_000).setInterpolator(null).start()
        }
        val bx = ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL }
        val em = ctx.text(g.e, 92f).apply { gravity = Gravity.CENTER; setShadowLayer(dp(18).toFloat(), 0f, 0f, rc) }
        bx.addView(em)
        bx.addView(ctx.text(g.name, 22f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; pad(0, 6, 0, 0) })
        bx.addView(ctx.text(Flow.RARITY[g.r], 13f, 0xFF0B1020.toInt(), BOLD).apply { pad(12, 3); background = round(rc, dp(12).toFloat()) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(6) })
        val sub = (if (r.first) "今天第一张，必掉！" else "") + (if (r.dup) "已经有了 → 碎片 +${r.shard}" else "新收藏！") + (if (g.wear && !r.dup) " · 捞捞可以戴上它" else "")
        bx.addView(ctx.text(sub, 13f, 0xFFCBD5E1.toInt()).apply { gravity = Gravity.CENTER; pad(0, 10, 0, 0) })
        val br = ctx.row().apply { gravity = Gravity.CENTER }
        if (g.wear && !r.dup) br.addView(pill("给捞捞戴上", "") { val b = Flow.myBag(); b.wear = g.id; Flow.save(b); a.toast("捞捞戴上了 ${g.e}"); next() }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(10) })
        br.addView(pill("好耶 ↑", "go") { next() })
        bx.addView(br, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(16) })
        ov.addView(bx, FrameLayout.LayoutParams(MATCH, WRAP, Gravity.CENTER))
        root.addView(ov, root.indexOfChild(sparks), FrameLayout.LayoutParams(MATCH, MATCH))
        overlay = ov
        bx.scaleX = 0.3f; bx.scaleY = 0.3f; bx.alpha = 0f
        bx.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(600).setInterpolator(OvershootInterpolator(2.2f)).start()
        em.cameraDistance = 8000 * ctx.resources.displayMetrics.density; em.rotationY = 540f
        em.animate().rotationY(0f).setDuration(1100).setInterpolator(android.view.animation.DecelerateInterpolator(2f)).start()
        sparks.burst(if (g.r >= 2) 60 else 30, intArrayOf(rc, Color.WHITE, PINK, GOLD))
        if (g.r >= 3) Confetti.burst(root)
    }
    private fun removeOverlay() { overlay?.let { root.removeView(it) }; overlay = null }

    // ---------- 操作 ----------
    private fun next() {
        removeOverlay()
        if (i >= cards.size - 1) return
        i++; acc = 0; last = 0; done = false; note = ""
        val c = cards[i]; if (c.min > 0 && c.kind != "break") room(c.min, 0)
        paint(false)
    }
    private fun swipe() {
        if (overlay != null) { next(); return }
        val c = cards.getOrNull(i) ?: return
        if (done || c.kind == "break") { next(); return }
        cardView?.animate()?.translationY(0f)?.rotationX(0f)?.setDuration(220)?.start()
        if (c.min > 0) setNote("这张还没走完；不想做可以点「跳过这张」")
    }
    private fun dropKey(k: String) { val keep = cards.filterIndexed { j, x -> j <= i || x.key != k }; cards = ArrayList(keep) }
    private fun yes(c: Flow.Card) {
        Items.find(c.key)?.let { if (!it.done) Items.toggleDone(it.key) }
        Chime.play(ctx, 2); buzz(longArrayOf(0, 40, 30, 80)); sparks.burst(40, intArrayOf(0xFF10B981.toInt(), 0xFF06B6D4.toInt(), GOLD, PINK))
        dropKey(c.key); next()
    }
    private fun again() {
        val d = Flow.deckNow()
        if (d.cards.isEmpty()) { a.toast(d.say); close(); return }
        cards = ArrayList(d.cards); i = 0; acc = 0; last = 0; done = false; work = 0; got = 0; note = ""
        paint(false)
    }
    private fun buzz(p: LongArray) {
        try {
            val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(p, -1)) else @Suppress("DEPRECATION") v.vibrate(p, -1)
        } catch (_: Exception) {}
    }

    // ---------- 班级同步自习 ----------
    private fun room(until: Int?, add: Int) {
        val cid = Store.cls?.str("id") ?: return
        Bg.load({
            if (until == null) Api.rpc("study_room", jsonOf("p_cid" to cid)) as? JSONObject
            else Api.rpc("study_ping", jsonOf("p_cid" to cid, "p_until_min" to until, "p_add" to add)) as? JSONObject
        }) { r, _ ->
            roomTv.text = if (r == null) "" else "● " + Flow.roomLine(r.optInt("now"), r.optInt("today_min"), r.optInt("streak"))
            if (r != null && r.optInt("now") > 0) { val sp = android.text.SpannableString(roomTv.text); sp.setSpan(android.text.style.ForegroundColorSpan(0xFF34D399.toInt()), 0, 1, 0); roomTv.text = sp }
        }
    }

    // ---------- 图鉴 ----------
    fun book() {
        removeOverlay()
        val b = Flow.fullBag()
        val ov = FrameLayout(ctx).apply { setBackgroundColor(0xB305070F.toInt()); tap { if (onlyBook) close() else removeOverlay() } }
        val sheet = ctx.col().apply {
            pad(16, 18, 16, 18); isClickable = true
            background = GradientDrawable().apply { setColor(0xFF111827.toInt()); val r = dp(24).toFloat(); cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f) }
        }
        val h = ctx.row()
        h.addView(ctx.text("🎁 捞捞的收藏", 18f, Color.WHITE, HEAVY))
        h.addView(ctx.text("  ${b.owned()}/${Flow.LOOT.size}", 13f, 0xFF94A3B8.toInt()), LinearLayout.LayoutParams(0, WRAP, 1f))
        h.addView(pill("关闭", "sm") { if (onlyBook) close() else removeOverlay() })
        sheet.addView(h)
        sheet.addView(ctx.text("在「刷任务」里每走完一张卡都有机会掉一样（今天已掉 ${b.dn}/${Flow.DAY_CAP}）。重复的变成碎片 🧩 ${b.sh}，攒够了点灰色的格子就能换。带 👕 的可以给捞捞戴上。", 12.5f, 0xFF94A3B8.toInt()).apply { setLineSpacing(0f, 1.4f); pad(0, 4, 0, 12) })
        val grid = android.widget.GridLayout(ctx).apply { columnCount = 4 }
        val cw = (minOf(ctx.resources.displayMetrics.widthPixels, dp(560)) - dp(32) - dp(8) * 3) / 4
        Flow.LOOT.forEachIndexed { k, l ->
            val n = b.own[l.id] ?: 0
            val cell = ctx.col().apply {
                gravity = Gravity.CENTER_HORIZONTAL; pad(4, 10, 4, 8)
                background = round(0x0DFFFFFF, dp(16).toFloat(), if (b.wear == l.id) PINK else C.alpha(Flow.RC[l.r], 0.6f), dp(if (b.wear == l.id) 2 else 1))
                addView(ctx.text(l.e, 28f).apply { gravity = Gravity.CENTER; if (n == 0) { alpha = 0.25f; val m = android.graphics.ColorMatrix(); m.setSaturation(0f); setLayerType(View.LAYER_TYPE_HARDWARE, Paint().apply { colorFilter = android.graphics.ColorMatrixColorFilter(m) }) } })
                addView(ctx.text(if (n > 0) l.name + (if (n > 1) " ×$n" else "") else "${Flow.RARITY[l.r]} · ${Flow.COST[l.r]}🧩", 10.5f, if (n > 0) 0xFFCBD5E1.toInt() else 0xFF64748B.toInt(), lines = 1).apply { gravity = Gravity.CENTER; pad(0, 3, 0, 0) })
                if (l.wear) addView(ctx.text(if (b.wear == l.id) "戴着" else "👕", 9.5f, 0xFF94A3B8.toInt()).apply { gravity = Gravity.CENTER })
                tap { v -> v.buzz(); tapLoot(l) }
            }
            grid.addView(cell, android.widget.GridLayout.LayoutParams().apply { width = cw; height = WRAP; if (k % 4 != 0) leftMargin = dp(8); topMargin = dp(8) })
        }
        val sc = ScrollView(ctx).apply { addView(grid) }
        sheet.addView(sc, LinearLayout.LayoutParams(MATCH, minOf(dp(460), (ctx.resources.displayMetrics.heightPixels * 0.62).toInt())))
        ov.addView(sheet, FrameLayout.LayoutParams(minOf(ctx.resources.displayMetrics.widthPixels, dp(560)), WRAP, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL))
        root.addView(ov, FrameLayout.LayoutParams(MATCH, MATCH)); overlay = ov
        sheet.translationY = dp(400).toFloat(); sheet.animate().translationY(0f).setDuration(260).setInterpolator(android.view.animation.DecelerateInterpolator()).start()
    }
    private fun tapLoot(l: Flow.Loot) {
        val b = Flow.fullBag()
        if ((b.own[l.id] ?: 0) > 0) {
            if (!l.wear) { a.toast("${l.e} ${l.name}（${Flow.RARITY[l.r]}）"); return }
            b.wear = if (b.wear == l.id) "" else l.id; Flow.save(b); a.toast(if (b.wear.isNotEmpty()) "捞捞戴上了 ${l.e}" else "摘下来了"); book()
        } else {
            if (!Flow.redeem(b, l.id)) { a.toast("还差 ${Flow.COST[l.r] - b.sh} 片碎片才能换「${l.name}」"); return }
            Flow.save(b); Chime.play(ctx, l.r + 1); a.toast("换到了 ${l.e} ${l.name}"); book()
        }
    }
}

/** 顶上的进度：一格一张卡 */
class ProgBar(ctx: Context) : View(ctx) {
    private var n = 0; private var cur = 0
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    fun set(n: Int, cur: Int) { this.n = n; this.cur = cur; invalidate() }
    override fun onDraw(c: Canvas) {
        if (n <= 0) return
        val gap = 4 * resources.displayMetrics.density; val w = (width - gap * (n - 1)) / n; val r = height / 2f
        for (k in 0 until n) {
            val x = k * (w + gap)
            p.shader = if (k == cur) LinearGradient(x, 0f, x + w, 0f, 0xFFA78BFA.toInt(), 0xFFF472B6.toInt(), Shader.TileMode.CLAMP) else null
            p.color = if (k < cur) 0xFFA78BFA.toInt() else if (k == cur) Color.WHITE else 0x26FFFFFF
            c.drawRoundRect(RectF(x, 0f, x + w, height.toFloat()), r, r, p)
        }
    }
}

/** 计时圆环：渐变 + 发光，中间是剩下的时间 */
class FlowRing(ctx: Context) : View(ctx) {
    var label = ""
    private var p = 0f; private var txt = ""
    private val d = ctx.resources.displayMetrics.density
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 12 * d; color = 0x1AFFFFFF }
    private val fg = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 12 * d; strokeCap = Paint.Cap.ROUND }
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 16 * d; strokeCap = Paint.Cap.ROUND; maskFilter = BlurMaskFilter(10 * d, BlurMaskFilter.Blur.NORMAL) }
    private val big = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textAlign = Paint.Align.CENTER; textSize = 42 * d; typeface = HEAVY; fontFeatureSettings = "tnum" }
    private val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF94A3B8.toInt(); textAlign = Paint.Align.CENTER; textSize = 12 * d }
    init { setLayerType(LAYER_TYPE_SOFTWARE, null) }
    fun set(p: Float, txt: String) { this.p = p.coerceIn(0f, 1f); this.txt = txt; invalidate() }
    override fun onDraw(c: Canvas) {
        val s = minOf(width, height).toFloat(); val r = s / 2 - 14 * d; val cx = width / 2f; val cy = height / 2f
        val o = RectF(cx - r, cy - r, cx + r, cy + r)
        c.drawCircle(cx, cy, r, bg)
        val sh = SweepGradient(cx, cy, intArrayOf(0xFFA78BFA.toInt(), 0xFFF472B6.toInt(), 0xFFA78BFA.toInt()), null)
        val m = android.graphics.Matrix(); m.setRotate(-90f, cx, cy); sh.setLocalMatrix(m)
        fg.shader = sh; glow.shader = sh; glow.alpha = 140
        if (p > 0) { c.drawArc(o, -90f, 360f * p, false, glow); c.drawArc(o, -90f, 360f * p, false, fg) }
        c.drawText(txt, cx, cy + 14 * d, big)
        c.drawText(label, cx, cy + 36 * d, small)
    }
}

/** 稀有掉落背后转的光芒 */
class RaysView(ctx: Context, private val color: Int) : View(ctx) {
    private val p = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(c: Canvas) {
        val cx = width / 2f; val cy = height / 2f; val r = minOf(width, height) / 2f
        p.shader = android.graphics.RadialGradient(cx, cy, r, intArrayOf(C.alpha(color, 0.55f), Color.TRANSPARENT), null, Shader.TileMode.CLAMP)
        for (k in 0 until 12) { c.save(); c.rotate(k * 30f, cx, cy); val path = android.graphics.Path(); path.moveTo(cx, cy); path.lineTo(cx - r * 0.07f, cy - r); path.lineTo(cx + r * 0.07f, cy - r); path.close(); c.drawPath(path, p); c.restore() }
    }
}

/** 从中间炸开的小方块 */
class SparkView(ctx: Context) : View(ctx) {
    private class S(var x: Float, var y: Float, val vx: Float, var vy: Float, var rot: Float, val vr: Float, val color: Int)
    private val ps = ArrayList<S>(); private val p = Paint(Paint.ANTI_ALIAS_FLAG); private var t0 = 0L
    private val d = ctx.resources.displayMetrics.density
    init { isClickable = false; isFocusable = false }
    fun burst(n: Int, colors: IntArray) {
        val r = java.util.Random()
        repeat(n) { val a = r.nextDouble() * Math.PI * 2; val sp = (4 + r.nextFloat() * 9) * d; ps += S(width / 2f, height * 0.45f, (Math.cos(a) * sp).toFloat(), (Math.sin(a) * sp).toFloat() - 3 * d, r.nextFloat() * 360, (r.nextFloat() - 0.5f) * 24, colors[it % colors.size]) }
        t0 = SystemClock.uptimeMillis(); invalidate()
    }
    override fun onDraw(c: Canvas) {
        if (ps.isEmpty()) return
        val life = (SystemClock.uptimeMillis() - t0) / 1300f
        if (life >= 1f) { ps.clear(); return }
        val al = (255 * (1f - life)).toInt().coerceIn(0, 255)
        for (s in ps) {
            s.x += s.vx; s.y += s.vy; s.vy += 0.35f * d; s.rot += s.vr
            p.color = s.color; p.alpha = al
            c.save(); c.translate(s.x, s.y); c.rotate(s.rot); c.drawRect(-4 * d, -4 * d, 4 * d, 4 * d, p); c.restore()
        }
        postInvalidateOnAnimation()
    }
}

/** 叮——：自己合成的几声三角波（不用音频文件）；手机静音 / 震动时不响 */
object Chime {
    fun play(ctx: Context, n: Int) {
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (am.ringerMode != AudioManager.RINGER_MODE_NORMAL) return
        } catch (_: Exception) { return }
        Bg.run {
            try {
                val rate = 22050; val notes = doubleArrayOf(523.0, 659.0, 784.0, 1047.0, 1319.0).take(2 + n.coerceIn(0, 3))
                val step = (rate * 0.09).toInt(); val len = (rate * 0.35).toInt(); val total = step * (notes.size - 1) + len
                val buf = ShortArray(total)
                notes.forEachIndexed { k, f ->
                    for (t in 0 until len) {
                        val x = t.toDouble() / rate; val ph = (x * f) % 1.0; val tri = 4 * Math.abs(ph - 0.5) - 1
                        val env = if (t < rate * 0.02) t / (rate * 0.02) else Math.exp(-(x - 0.02) * 9)
                        val idx = k * step + t; buf[idx] = (buf[idx] + tri * env * 5000).toInt().coerceIn(-32000, 32000).toShort()
                    }
                }
                val tr = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(buf.size * 2).setTransferMode(AudioTrack.MODE_STATIC).build()
                tr.write(buf, 0, buf.size); tr.play()
                Thread.sleep((total * 1000L / rate) + 100); tr.release()
            } catch (_: Exception) {}
        }
    }
}
