package com.laolao.classcalendar.ui

import android.app.DatePickerDialog
import android.app.Dialog
import android.app.TimePickerDialog
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.laolao.classcalendar.core.T

/** 一个页面（首页、作业、事项详情……）。主界面用一个 Activity，页面像小程序那样一层层叠上去 */
abstract class Page(val a: Main) {
    val ctx: Context get() = a
    private var built: View? = null
    val view: View get() = built ?: build().also { built = it }
    protected abstract fun build(): View
    /** 数据变了：重画内容 */
    open fun render() {}
    /** 有输入框的页面：数据变了不自动重画（不然正在打的字会没了） */
    open val autoRender: Boolean = true
    open fun onShow() {}
    open fun onHide() {}
    /** 返回 true 表示自己处理了返回键 */
    open fun onBack(): Boolean = false
    fun close() = a.pop(this)
    fun dp(v: Int): Int = ctx.dp(v)
}

/** 下拉刷新的滚动区 */
class PullScroll(ctx: Context, private val onRefresh: ((() -> Unit) -> Unit)?) : FrameLayout(ctx) {
    val content: LinearLayout = ctx.col()
    private val hint = ctx.text("下拉刷新", 12.5f, C.sub).apply { gravity = Gravity.CENTER }
    private var refreshing = false
    val scroll: ScrollView = object : ScrollView(ctx) {
        var y0 = 0f; var pulling = false
        override fun dispatchTouchEvent(e: MotionEvent): Boolean {
            if (onRefresh != null && !refreshing) when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { y0 = e.rawY; pulling = false }
                MotionEvent.ACTION_MOVE -> {
                    val dy = e.rawY - y0
                    if (scrollY == 0 && dy > 0) { pulling = true; drag(dy * 0.45f) }
                    else if (pulling) { drag(0f); pulling = false }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (pulling) { pulling = false; release() }
            }
            return super.dispatchTouchEvent(e)
        }
    }
    init {
        addView(hint, LayoutParams(MATCH, dp(48)))
        scroll.overScrollMode = View.OVER_SCROLL_NEVER
        scroll.isVerticalScrollBarEnabled = false
        scroll.addView(content, LayoutParams(MATCH, WRAP))
        addView(scroll, LayoutParams(MATCH, MATCH))
        hint.alpha = 0f
    }
    private fun drag(d: Float) {
        val v = minOf(d, dp(120).toFloat())
        content.translationY = v
        hint.alpha = minOf(1f, v / dp(56))
        hint.text = if (v > dp(64)) "松开刷新" else "下拉刷新"
    }
    private fun release() {
        if (content.translationY > dp(64)) {
            refreshing = true; hint.text = "正在刷新…"
            content.animate().translationY(dp(44).toFloat()).setDuration(150).start()
            onRefresh?.invoke { done() }
        } else done()
    }
    private fun done() {
        refreshing = false
        content.animate().translationY(0f).setDuration(200).start()
        hint.animate().alpha(0f).setDuration(200).start()
    }
}

// ---------- 页头：‹ 标题 [右边按钮] ----------
fun Page.header(title: String, right: View? = null): LinearLayout = ctx.row().apply {
    pad(6, 6, 12, 6); minimumHeight = dp(52)
    addView(ctx.text("‹", 30f, C.text).apply { gravity = Gravity.CENTER; press(0, 20); tap { a.onBackPressed() } }, LinearLayout.LayoutParams(dp(44), dp(44)))
    addView(ctx.text(title, 18f, C.text, BOLD, 1).apply { pad(4, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
    if (right != null) addView(right)
}
/** 子页面的骨架：页头 + 可滚动内容 */
fun Page.scaffold(title: String, right: View? = null, pull: ((() -> Unit) -> Unit)? = null, body: (LinearLayout) -> Unit): View {
    val root = ctx.col().apply { setBackgroundColor(C.bg) }
    root.addView(header(title, right))
    val ps = PullScroll(ctx, pull)
    ps.content.pad(16, 4, 16, 40)
    body(ps.content)
    root.addView(ps, LinearLayout.LayoutParams(MATCH, 0, 1f))
    return root
}
/** 分组标题 */
fun Context.section(t: String, s: String = "", color: Int = C.text): LinearLayout = row().apply {
    gravity = Gravity.BOTTOM; pad(4, 22, 4, 10)
    addView(text(t, 17f, color, BOLD))
    if (s.isNotEmpty()) addView(text(s, 12.5f, C.sub).apply { pad(8, 0, 0, 1) })
}

// ---------- 提示、对话框 ----------
fun Context.toast(s: String) = Toast.makeText(this, s, if (s.length > 14) Toast.LENGTH_LONG else Toast.LENGTH_SHORT).show()

object Dialogs {
    /** 一个圆角卡片对话框；bottom = 从底部弹出 */
    fun show(ctx: Context, content: View, bottom: Boolean = false): Dialog {
        val d = Dialog(ctx)
        d.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val wrap = FrameLayout(ctx)
        content.background = if (bottom) android.graphics.drawable.GradientDrawable().apply {
            setColor(C.card); val r = ctx.dp(22).toFloat(); cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
        } else round(C.card, ctx.dp(22).toFloat())
        wrap.addView(content, FrameLayout.LayoutParams(MATCH, WRAP))
        d.setContentView(wrap)
        if (bottom) d.window?.setWindowAnimations(android.R.style.Animation_InputMethod)
        d.show()
        d.window?.let { w ->
            w.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            w.setLayout(if (bottom) MATCH else (ctx.resources.displayMetrics.widthPixels * 0.88).toInt(), WRAP)
            if (bottom) w.setGravity(Gravity.BOTTOM)
            w.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        }
        return d
    }
    fun confirm(ctx: Context, title: String, msg: String, ok: String = "确定", danger: Boolean = false, cancel: String? = "取消", fn: () -> Unit) {
        val c = ctx.col().apply { pad(22, 22, 22, 14) }
        lateinit var d: Dialog
        if (title.isNotEmpty()) c.addView(ctx.text(title, 18f, C.text, BOLD))
        if (msg.isNotEmpty()) c.addView(ctx.text(msg, 15f, C.sub).apply { margins(t = if (title.isEmpty()) 0 else 8) })
        val btns = ctx.row().apply { gravity = Gravity.END; margins(t = 16) }
        if (cancel != null) btns.addView(ctx.text(cancel, 15f, C.sub, SEMI).apply { pad(16, 10); press(0, 10); tap { d.dismiss() } })
        btns.addView(ctx.text(ok, 15f, if (danger) C.red else C.accent, BOLD).apply { pad(16, 10); press(0, 10); tap { d.dismiss(); fn() } })
        c.addView(btns)
        d = show(ctx, c)
    }
    fun alert(ctx: Context, title: String, msg: String) = confirm(ctx, title, msg, "知道了", cancel = null) {}
    /** 底部菜单 */
    fun sheet(ctx: Context, title: String, opts: List<String>, danger: Set<Int> = emptySet(), fn: (Int) -> Unit) {
        val c = ctx.col().apply { pad(8, 14, 8, 20) }
        lateinit var d: Dialog
        if (title.isNotEmpty()) c.addView(ctx.text(title, 13f, C.sub).apply { gravity = Gravity.CENTER; pad(12, 4, 12, 10) })
        opts.forEachIndexed { i, s ->
            c.addView(ctx.text(s, 16f, if (i in danger) C.red else C.text, SEMI).apply { gravity = Gravity.CENTER; pad(12, 14); press(0, 12); tap { d.dismiss(); fn(i) } })
        }
        c.addView(ctx.text("取消", 16f, C.sub).apply { gravity = Gravity.CENTER; pad(12, 14); press(C.mutedBg, 14); tap { d.dismiss() }; margins(8, 8, 8, 0) })
        d = show(ctx, c, bottom = true)
    }
    /** 输入一段文字 */
    fun prompt(ctx: Context, title: String, value: String, hint: String, multi: Boolean = false, fn: (String) -> Unit) {
        val c = ctx.col().apply { pad(22, 22, 22, 14) }
        lateinit var d: Dialog
        c.addView(ctx.text(title, 18f, C.text, BOLD))
        val e = ctx.input(hint, value, multi).apply { margins(t = 14) }
        c.addView(e)
        val btns = ctx.row().apply { gravity = Gravity.END; margins(t = 12) }
        btns.addView(ctx.text("取消", 15f, C.sub, SEMI).apply { pad(16, 10); press(0, 10); tap { d.dismiss() } })
        btns.addView(ctx.text("确定", 15f, C.accent, BOLD).apply { pad(16, 10); press(0, 10); tap { d.dismiss(); fn(e.text.toString().trim()) } })
        c.addView(btns)
        d = show(ctx, c)
        e.requestFocus(); showKeyboard(e)
    }
    fun showKeyboard(e: EditText) { e.postDelayed({ (e.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(e, 0) }, 150) }
    fun hideKeyboard(v: View) { (v.context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(v.windowToken, 0) }

    fun pickDate(ctx: Context, cur: String, fn: (String) -> Unit) {
        val d = T.date(cur) ?: T.today()
        val theme = if (C.dark) android.R.style.Theme_DeviceDefault_Dialog_Alert else android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
        DatePickerDialog(ctx, theme, { _, y, m, day -> fn(String.format("%04d-%02d-%02d", y, m + 1, day)) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
    }
    fun pickTime(ctx: Context, cur: String, fn: (String) -> Unit) {
        val m = T.min(cur) ?: (T.now().hour * 60 + 60).coerceAtMost(23 * 60)
        val theme = if (C.dark) android.R.style.Theme_DeviceDefault_Dialog_Alert else android.R.style.Theme_DeviceDefault_Light_Dialog_Alert
        TimePickerDialog(ctx, theme, { _, h, mi -> fn(String.format("%02d:%02d", h, mi)) }, m / 60, m % 60, true).show()
    }
}

/** 空状态 */
fun Context.empty(icon: String, t: String, s: String = ""): LinearLayout = col().apply {
    gravity = Gravity.CENTER_HORIZONTAL; pad(16, 26)
    bg(C.mutedBg, 14)
    addView(text(icon, 26f).apply { gravity = Gravity.CENTER })
    addView(text(t, 14.5f, C.sub, SEMI).apply { gravity = Gravity.CENTER; margins(t = 8) })
    if (s.isNotEmpty()) addView(text(s, 12.5f, C.mutedText).apply { gravity = Gravity.CENTER; margins(t = 4) })
}
/** 设置列表里的一行：图标 标题 说明 › */
fun Context.cell(icon: String, title: String, desc: String = "", right: String = "›", fn: (View) -> Unit): LinearLayout = row().apply {
    pad(14, 13); press(0, 12); tap(fn)
    if (icon.isNotEmpty()) addView(text(icon, 18f).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(30), WRAP))
    val c = col()
    c.addView(text(title, 15.5f, C.text, SEMI, 1))
    if (desc.isNotEmpty()) c.addView(text(desc, 12.5f, C.sub, lines = 2).apply { margins(t = 2) })
    addView(c, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(6) })
    if (right.isNotEmpty()) addView(text(right, if (right == "›") 20f else 13f, C.mutedText).apply { pad(8, 0, 0, 0) })
}
fun ViewGroup.add(v: View, top: Int = 0): View { addView(v); if (top != 0) v.margins(t = top); return v }

/** 重画页面内容前：记住滚到哪了，画完回到原来的位置（不然打个勾就跳回顶部） */
fun keepScroll(body: LinearLayout) {
    var p = body.parent
    while (p != null && p !is ScrollView) p = p.parent
    val sv = p as? ScrollView
    val y = sv?.scrollY ?: 0
    body.removeAllViews()
    if (sv != null && y > 0) sv.post { sv.scrollTo(0, y) }
}
