package com.laolao.classcalendar.ui

import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.R

/** 右下角「＋」弹出的一项：图标、文字、点了做什么 */
class FabItem(val icon: String, val text: String, val run: () -> Unit)

/**
 * 右下角「＋」（照小程序）：只有一个动作直接做；多个动作时，背景变暗，按钮上方弹出一串胶囊按钮
 */
class Fab(private val a: Main, host: FrameLayout, private val items: () -> List<FabItem>) {
    private val btn: TextView = a.text("+", 30f, Color.WHITE).apply {
        gravity = Gravity.CENTER; press(C.accent, 18, ripple = C.alpha(Color.WHITE, 0.3f)); elevation = dp(6).toFloat()
        tap { toggle() }
    }
    private var mask: View? = null
    private var menu: LinearLayout? = null
    init {
        host.addView(btn, FrameLayout.LayoutParams(a.dp(58), a.dp(58)).apply { gravity = Gravity.BOTTOM or Gravity.END; rightMargin = a.dp(20); bottomMargin = a.dp(20) })
        // 在标签页里：底栏是半透明浮在上面的，按钮抬到底栏上面
        btn.post { var p = host.parent; while (p != null && p !== a.tabArea) p = p.parent; if (p != null) btn.translationY = -a.underBar.toFloat() }
    }
    val open: Boolean get() = menu != null

    fun toggle() { if (open) close() else show() }
    private fun show() {
        val list = items()
        if (list.isEmpty()) return
        if (list.size == 1) { list[0].run(); return }
        btn.buzz()
        val root = a.rootView
        val m = View(a).apply { setBackgroundColor(if (C.dark) 0x8C000000.toInt() else 0x73080E20); alpha = 0f; isClickable = true; setOnClickListener { close() } }
        root.addView(m, FrameLayout.LayoutParams(MATCH, MATCH))
        m.animate().alpha(1f).setDuration(180).start()
        // 菜单放在按钮正上方（按钮在页面里的位置换算到整个窗口）
        val loc = IntArray(2); btn.getLocationInWindow(loc); val rl = IntArray(2); root.getLocationInWindow(rl)
        val bottom = root.height - (loc[1] - rl[1]) + a.dp(14)
        val col = a.col().apply { gravity = Gravity.END }
        list.forEachIndexed { i, it ->
            val pill = a.row().apply {
                pad(14, 10, 18, 10)
                background = round(C.card, a.dp(24).toFloat(), C.line, a.dp(1)); elevation = a.dp(4).toFloat()
                addView(a.text(it.icon, 18f))
                addView(a.text(it.text, 15f, C.text, BOLD).apply { pad(8, 0, 0, 0) })
                isClickable = true
                setOnClickListener { _ -> close(); it.run() }
                alpha = 0f; translationY = a.dp(14).toFloat(); scaleX = 0.92f; scaleY = 0.92f
            }
            col.addView(pill, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = a.dp(if (i == 0) 0 else 10) })
            pill.animate().alpha(1f).translationY(0f).scaleX(1f).scaleY(1f).setStartDelay(i * 35L).setDuration(220).setInterpolator(OvershootInterpolator(1.3f)).start()
        }
        root.addView(col, FrameLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.BOTTOM or Gravity.END; rightMargin = a.dp(20); bottomMargin = bottom })
        mask = m; menu = col
        btn.animate().rotation(45f).setDuration(180).start()
        btn.bringToFront()
    }
    fun close() {
        val m = mask ?: return; val c = menu
        mask = null; menu = null
        btn.animate().rotation(0f).setDuration(160).start()
        m.animate().alpha(0f).setDuration(150).withEndAction { a.rootView.removeView(m) }.start()
        c?.animate()?.alpha(0f)?.setDuration(120)?.withEndAction { a.rootView.removeView(c) }?.start()
    }
}

/** 完成作业、打卡、番茄结束时：捞捞跳出来鼓励一下 */
object Cheer {
    private val SAY = mapOf(
        "homework" to listOf("又搞定一项作业！", "效率真高 💪", "离周末又近了一步"),
        "allhw" to listOf("这天的作业全做完了 🎉", "今天可以安心休息啦"),
        "item" to listOf("完成 ✓", "又少了一件事"),
        "habit" to listOf("打卡成功 🔥", "坚持就是胜利"),
        "pomo" to listOf("一个番茄完成 🍅", "专注力满分！休息 5 分钟吧"),
    )
    fun show(a: Main, kind: String, extra: String = "") {
        val root = a.rootView
        // 「我的 → 趣味与效率」：鼓励方式、撒花（fun_opts_v1，和网页、小程序同一份）
        val o = com.laolao.classcalendar.core.Kv.obj("fun_opts_v1")
        if (o.optBoolean("confetti", true)) Confetti.burst(root)
        when (o.optString("cheer", "mascot")) {
            "off" -> return
            "text" -> { a.toast((SAY[kind] ?: SAY["item"]!!).random()); return }
        }
        val veil = View(a).apply { setBackgroundColor(0x33080E20); alpha = 0f; isClickable = true }
        val card = a.col().apply {
            gravity = Gravity.CENTER_HORIZONTAL; background = round(C.card, a.dp(26).toFloat()); elevation = a.dp(10).toFloat(); pad(22, 16, 22, 18)
            addView(ImageView(a).apply { setImageResource(R.drawable.mascot) }, LinearLayout.LayoutParams(a.dp(86), a.dp(86)))
            val s = SAY[kind] ?: SAY["item"]!!
            addView(a.text(s.random(), 17f, C.text, HEAVY).apply { gravity = Gravity.CENTER; margins(t = 6) })
            if (extra.isNotEmpty()) addView(a.text(extra, 13f, C.sub).apply { gravity = Gravity.CENTER; margins(t = 4) })
            scaleX = 0.6f; scaleY = 0.6f; alpha = 0f
        }
        root.addView(veil, FrameLayout.LayoutParams(MATCH, MATCH))
        root.addView(card, FrameLayout.LayoutParams(a.dp(250), WRAP).apply { gravity = Gravity.CENTER })
        veil.animate().alpha(1f).setDuration(150).start()
        card.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(320).setInterpolator(OvershootInterpolator(1.6f)).start()
        val gone = { veil.animate().alpha(0f).setDuration(200).withEndAction { root.removeView(veil) }.start(); card.animate().alpha(0f).scaleX(0.9f).scaleY(0.9f).setDuration(200).withEndAction { root.removeView(card) }.start() }
        veil.setOnClickListener { gone() }
        card.postDelayed({ if (card.parent != null) gone() }, 1500)
        card.performHapticFeedback(android.view.HapticFeedbackConstants.CONFIRM)
    }
}

/** 撒花：从上面落下一把彩纸，1.6 秒后自己消失 */
object Confetti {
    private class P(var x: Float, var y: Float, val vx: Float, var vy: Float, var rot: Float, val vr: Float, val w: Float, val h: Float, val color: Int)
    fun burst(root: FrameLayout) {
        val ctx = root.context
        val colors = intArrayOf(C.accent, 0xFFFF8A5B.toInt(), 0xFFFFC94D.toInt(), 0xFF34C38F.toInt(), 0xFFFF5D8F.toInt(), 0xFF4F9DFF.toInt(), 0xFFA66CFF.toInt())
        val d = ctx.resources.displayMetrics.density
        val v = object : View(ctx) {
            val ps = mutableListOf<P>(); val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG); var t0 = 0L
            override fun onDraw(c: android.graphics.Canvas) {
                if (ps.isEmpty()) { val r = java.util.Random(); repeat(70) { ps += P(width * r.nextFloat(), -r.nextFloat() * height * 0.3f, (r.nextFloat() - 0.5f) * 4 * d, (2 + r.nextFloat() * 4) * d, r.nextFloat() * 360, (r.nextFloat() - 0.5f) * 20, (5 + r.nextFloat() * 5) * d, (8 + r.nextFloat() * 6) * d, colors[r.nextInt(colors.size)]) }; t0 = System.currentTimeMillis() }
                val life = (System.currentTimeMillis() - t0) / 1600f
                val al = (255 * (1f - maxOf(0f, life - 0.7f) / 0.3f)).toInt().coerceIn(0, 255)
                for (p in ps) {
                    p.x += p.vx; p.y += p.vy; p.vy += 0.12f * d; p.rot += p.vr
                    paint.color = p.color; paint.alpha = al
                    c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1f, Math.abs(Math.cos(Math.toRadians(p.rot.toDouble() * 2)).toFloat()) + 0.2f)
                    c.drawRoundRect(-p.w / 2, -p.h / 2, p.w / 2, p.h / 2, 2 * d, 2 * d, paint); c.restore()
                }
                if (life < 1f) postInvalidateOnAnimation() else (parent as? android.view.ViewGroup)?.removeView(this)
            }
        }
        root.addView(v, FrameLayout.LayoutParams(MATCH, MATCH))
    }
}
