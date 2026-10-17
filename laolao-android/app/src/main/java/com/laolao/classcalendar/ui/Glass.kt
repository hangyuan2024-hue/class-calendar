package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.view.View
import android.view.ViewOutlineProvider
import android.view.ViewTreeObserver
import android.widget.FrameLayout

/**
 * 毛玻璃：把压在下面的内容缩小画一份、模糊，再盖一层半透明的底色。
 * 内容没变就不重画（不会一直占用 CPU），滚动时跟着变。
 * 安卓 8 起都能用，不靠 RenderEffect（那个只能模糊自己，模糊不了下面的东西）。
 */
class GlassBar(ctx: Context, private val src: View, private val tintAlpha: Float = 0.72f) : FrameLayout(ctx) {
    private val scale = 6
    private var bmp: Bitmap? = null
    private var scratch: Bitmap? = null
    private var last: IntArray? = null
    private var busy = false
    private val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val tint = Paint()
    private val dst = Rect()
    private val me = IntArray(2); private val them = IntArray(2)
    private val pre = ViewTreeObserver.OnPreDrawListener { capture(); true }

    init {
        setWillNotDraw(false)
        outlineProvider = ViewOutlineProvider.BOUNDS
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); viewTreeObserver.addOnPreDrawListener(pre) }
    override fun onDetachedFromWindow() { viewTreeObserver.removeOnPreDrawListener(pre); super.onDetachedFromWindow() }

    private var at = 0L; private var pending = false
    private fun capture() {
        if (busy || width == 0 || height == 0 || src.width == 0) return
        val now = android.os.SystemClock.uptimeMillis()
        if (now - at < 40) { if (!pending) { pending = true; postDelayed({ pending = false; capture() }, 50) }; return }
        at = now
        busy = true
        try {
            val w = maxOf(1, width / scale); val h = maxOf(1, height / scale)
            val b = scratch?.takeIf { it.width == w && it.height == h } ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { scratch = it; last = null }
            b.eraseColor(C.bg)
            val c = Canvas(b)
            c.scale(1f / scale, 1f / scale)
            getLocationInWindow(me); src.getLocationInWindow(them)
            val dx = (me[0] - them[0]).toFloat(); val dy = (me[1] - them[1]).toFloat()
            c.translate(-dx, -dy)
            c.clipRect(dx, dy, dx + width, dy + height)     // 只画压在下面的那一条，其它卡片直接跳过
            src.draw(c)
            val px = IntArray(w * h); b.getPixels(px, 0, w, 0, 0, w, h)
            blur(px, w, h, 2); blur(px, w, h, 2)
            if (last?.contentEquals(px) == true) return
            last = px
            // 画在草稿上，变了才拷到显示用的那张（不然显示的会是没模糊的半成品）
            val shown = bmp?.takeIf { it.width == w && it.height == h } ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { bmp = it }
            shown.setPixels(px, 0, w, 0, 0, w, h)
            invalidate()
        } catch (_: Throwable) {
        } finally { busy = false }
    }

    override fun onDraw(c: Canvas) {
        bmp?.let { dst.set(0, 0, width, height); c.drawBitmap(it, null, dst, paint) }
        tint.color = C.alpha(C.card, if (C.dark) tintAlpha + 0.08f else tintAlpha)
        c.drawRect(0f, 0f, width.toFloat(), height.toFloat(), tint)
        super.onDraw(c)
    }

    /** 横竖各做一遍盒式模糊 */
    private fun blur(p: IntArray, w: Int, h: Int, r: Int) {
        val tmp = IntArray(maxOf(w, h))
        for (y in 0 until h) { pass(p, y * w, 1, w, r, tmp) }
        for (x in 0 until w) { pass(p, x, w, h, r, tmp) }
    }
    private fun pass(p: IntArray, start: Int, step: Int, n: Int, r: Int, tmp: IntArray) {
        var a = 0; var rr = 0; var g = 0; var bb = 0
        val win = 2 * r + 1
        fun at(i: Int) = p[start + i.coerceIn(0, n - 1) * step]
        for (i in -r..r) { val v = at(i); a += v ushr 24; rr += (v shr 16) and 255; g += (v shr 8) and 255; bb += v and 255 }
        for (i in 0 until n) {
            tmp[i] = ((a / win) shl 24) or ((rr / win) shl 16) or ((g / win) shl 8) or (bb / win)
            val o = at(i - r); val ni = at(i + r + 1)
            a += (ni ushr 24) - (o ushr 24); rr += ((ni shr 16) and 255) - ((o shr 16) and 255); g += ((ni shr 8) and 255) - ((o shr 8) and 255); bb += (ni and 255) - (o and 255)
        }
        for (i in 0 until n) p[start + i * step] = tmp[i]
    }
}
