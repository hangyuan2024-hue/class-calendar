package com.laolao.classcalendar.ui

import android.graphics.Color
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import com.laolao.classcalendar.core.Checkin
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.str

/**
 * 7.x 侧边栏：常用入口一处放齐（右下角「＋」只管新建）。
 * 打开：任何页面从屏幕左边缘往右滑；或者点各个标签页左上角的 ☰。
 * 关闭：点外面、往左滑、按返回键，或者点了某个入口。
 */
object Drawer {
    private var scrim: View? = null
    private var panel: LinearLayout? = null
    val isOpen get() = panel != null

    /** 标签页标题左边的 ☰ 按钮 */
    fun button(a: Main): View = FrameLayout(a).apply {
        background = round(C.card, a.dp(20).toFloat(), C.line, a.dp(1)); contentDescription = "打开侧边栏"
        addView(Ic.plain(a, "☰", 19, C.text), FrameLayout.LayoutParams(a.dp(19), a.dp(19), Gravity.CENTER))
        layoutParams = LinearLayout.LayoutParams(a.dp(40), a.dp(40)).apply { rightMargin = a.dp(12) }
        tap { it.buzz(); open(a) }
    }

    fun open(a: Main) {
        if (isOpen) return
        val root = a.findViewById<FrameLayout>(android.R.id.content) ?: return
        a.fabs.forEach { it.close() }
        val w = minOf((a.resources.displayMetrics.widthPixels * 0.82f).toInt(), a.dp(330))
        val sc = View(a).apply { setBackgroundColor(Color.BLACK); alpha = 0f; isClickable = true; setOnClickListener { close() } }
        root.addView(sc, FrameLayout.LayoutParams(MATCH, MATCH))
        val pn = a.col().apply {
            isClickable = true; elevation = a.dp(16).toFloat()
            background = android.graphics.drawable.GradientDrawable().apply { setColor(C.bg); val r = a.dp(24).toFloat(); cornerRadii = floatArrayOf(0f, 0f, r, r, r, r, 0f, 0f) }
        }
        val sv = ScrollView(a).apply { isVerticalScrollBarEnabled = false; overScrollMode = View.OVER_SCROLL_NEVER }
        val body = a.col().apply { pad(16, 0, 16, 20) }
        sv.addView(body); pn.addView(sv, LinearLayout.LayoutParams(MATCH, 0, 1f))
        root.addView(pn, FrameLayout.LayoutParams(w, MATCH, Gravity.START))
        body.setPadding(body.paddingLeft, a.dp(22), body.paddingRight, a.dp(22))   // 页面本来就在状态栏下面，不用再让
        fill(a, body)
        // 往左滑关掉
        var x0 = 0f; var dragging = false
        val swipe = View.OnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { x0 = e.rawX; dragging = false }
                MotionEvent.ACTION_MOVE -> { val dx = e.rawX - x0; if (dx < -a.dp(12)) dragging = true; if (dragging) { pn.translationX = minOf(0f, dx); sc.alpha = 0.38f * (1 + pn.translationX / w) } }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (dragging) { if (pn.translationX < -w * 0.3f) close() else { pn.animate().translationX(0f).setDuration(160).start(); sc.animate().alpha(0.38f).setDuration(160).start() } }
            }
            false
        }
        sv.setOnTouchListener(swipe)
        scrim = sc; panel = pn
        pn.translationX = -w.toFloat()
        pn.animate().translationX(0f).setDuration(240).setInterpolator(android.view.animation.DecelerateInterpolator(2f)).start()
        sc.animate().alpha(0.38f).setDuration(240).start()
    }

    fun close(anim: Boolean = true) {
        val pn = panel ?: return; val sc = scrim
        panel = null; scrim = null
        val root = pn.parent as? FrameLayout ?: return
        if (!anim) { root.removeView(pn); sc?.let { root.removeView(it) }; return }
        pn.animate().translationX(-pn.width.toFloat()).setDuration(200).withEndAction { root.removeView(pn) }.start()
        sc?.animate()?.alpha(0f)?.setDuration(200)?.withEndAction { root.removeView(sc) }?.start()
    }

    private fun go(a: Main, fn: () -> Unit) { close(); a.window.decorView.postDelayed({ fn() }, 120) }

    private fun fill(a: Main, body: LinearLayout) {
        val ctx = a
        // 头部：头像、名字、班级
        val me = Store.me; val cls = Store.cls
        body.addView(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(6, 4, 6, 14); tap { go(a) { a.selectTab(4) } }
            addView(Avatar.view(ctx, Store.name(), me?.str("gender") ?: "", 24), LinearLayout.LayoutParams(ctx.dp(48), ctx.dp(48)))
            addView(ctx.col().apply {
                addView(ctx.text(Store.name().ifEmpty { "我" }, 18f, C.text, HEAVY, 1))
                addView(ctx.text(cls?.str("name") ?: "还没加入班级", 13f, C.sub, lines = 1).apply { margins(t = 2) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = ctx.dp(12) })
        })
        // 正在签到：最显眼
        Checkin.open?.takeIf { cls != null && it.optJSONObject("mine") == null }?.let { o ->
            body.addView(ctx.row().apply {
                gravity = Gravity.CENTER_VERTICAL; pad(12, 11); press(C.dangerBg, 16); margins(b = 12)
                addView(Ic.tile(ctx, "📍", 34), LinearLayout.LayoutParams(ctx.dp(34), ctx.dp(34)))
                addView(ctx.col().apply {
                    addView(ctx.text("正在签到：" + o.optString("title").ifEmpty { "位置签到" }, 14.5f, C.red, BOLD, 1))
                    addView(ctx.text("还剩 " + Checkin.leftText(o) + " · 点这里去签", 12f, C.sub, lines = 1))
                }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = ctx.dp(10) })
                tap { go(a) { a.push(CheckinPage(a)) } }
            })
        }
        // 常用：三列小方块
        fun safe(f: () -> Boolean) = try { f() } catch (_: Exception) { false }
        val p = Plan.pomo()
        val items = listOfNotNull(
            if (cls != null) Triple("📍", "位置签到") { a.push(CheckinPage(a)) } else null,
            Triple("🔥", "今日打卡") { a.selectTab(2) },
            Triple("🍅", if (p.mode == "focus") "专注中" else "开始专注") { a.push(PlanPage(a, pomo = true)) },
            if (safe { Store.feat("homework") }) Triple("📝", if (Store.work()) "任务" else "作业") { a.selectTab(1) } else null,
            if (safe { Store.feat("courses") }) Triple("📚", "课表") { a.push(CoursePage(a)) } else null,
            Triple("🗓", "日历") { a.push(CalendarPage(a, pushed = true)) },
            Triple("📒", "备忘录") { a.push(NoteListPage(a)) },
            if (cls != null && safe { Store.can("can_ingest") || Store.feat("ingest_local") }) Triple("✨", "整理群消息") { a.push(IngestPage(a)) } else null,
            if (cls != null) Triple("🏫", "班级") { a.push(ClassPage(a)) } else null,
            if (cls != null && safe { Store.feat("rank") }) Triple("🏆", "排行榜") { a.push(RankPage(a)) } else null,
            Triple("📖", "背单词") { a.push(WordsPage(a)) },
            Triple("🧰", "全部工具") { a.selectTab(3) },
        )
        body.addView(ctx.text("常用", 13f, C.sub, BOLD).apply { pad(6, 4, 0, 8) })
        val grid = ctx.col().apply { bg(C.card, 20, C.line); pad(6, 10) }
        items.chunked(3).forEach { rowItems ->
            val r = ctx.row()
            rowItems.forEach { (ic, t, fn) ->
                r.addView(ctx.col().apply {
                    gravity = Gravity.CENTER_HORIZONTAL; pad(2, 8); press(C.card, 14); tap { go(a) { fn() } }
                    addView(Ic.tile(ctx, ic, 40), LinearLayout.LayoutParams(ctx.dp(40), ctx.dp(40)))
                    addView(ctx.text(t, 12.5f, C.text, SEMI, 1).apply { gravity = Gravity.CENTER; margins(t = 6) })
                }, LinearLayout.LayoutParams(0, WRAP, 1f))
            }
            repeat(3 - rowItems.size) { r.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f)) }
            grid.addView(r)
        }
        body.addView(grid)
        // 底部：设置
        body.add(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(14, 13); press(C.card, 16, C.line); tap { go(a) { a.push(SettingsPage(a)) } }
            addView(Ic.plain(ctx, "⚙️", 18, C.text), LinearLayout.LayoutParams(ctx.dp(18), ctx.dp(18)))
            addView(ctx.text("设置", 15f, C.text, SEMI).apply { pad(12, 0, 0, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(ctx.text("›", 18f, C.mutedText))
        }, 12)
        body.add(ctx.text("从屏幕左边缘往右滑，随时打开这里", 11.5f, C.mutedText).apply { gravity = Gravity.CENTER }, 14)
    }
}
