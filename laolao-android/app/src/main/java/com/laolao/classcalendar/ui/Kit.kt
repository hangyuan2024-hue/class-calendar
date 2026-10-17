package com.laolao.classcalendar.ui

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.text.InputType
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Kv
import org.json.JSONObject

/** 配色：照小程序「清爽」皮肤（夜间跟随系统用「清爽·夜」） */
object C {
    var dark = false; private set
    var bg = 0; var card = 0; var line = 0; var text = 0; var sub = 0; var accent = 0; var red = 0; var green = 0; var gray = 0; var purple = 0
    var hover = 0; var mutedBg = 0; var mutedText = 0; var selected = 0; var dangerBg = 0; var noteBg = 0; var hero = 0; var heroText = 0; var mint = 0; var tab = 0
    var course = 0xFF17A2B8.toInt()

    fun load(ctx: Context) {
        // 「我的 → 外观」：跟随系统 / 总是浅色 / 总是深色（只存在这台手机上）
        dark = when (ctx.getSharedPreferences("app", Context.MODE_PRIVATE).getString("dark_mode", "")) {
            "light" -> false; "dark" -> true
            else -> (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        }
        if (!dark) {
            bg = c("#f6f5f1"); card = c("#ffffff"); line = c("#e4e6e3"); text = c("#172c36"); sub = c("#6d7a80"); accent = c("#5366e8")
            red = c("#bf6650"); green = c("#39856a"); gray = c("#89959b"); purple = c("#8270b7"); hover = c("#f0f1ed"); mutedBg = c("#f5f5f0")
            mutedText = c("#a7afb1"); selected = c("#eef0ff"); dangerBg = c("#fff0ec"); noteBg = c("#fff2e3"); hero = c("#e9ecfc"); heroText = c("#26334d"); mint = c("#cfe9dc"); tab = c("#7d898e")
        } else {
            bg = c("#111c23"); card = c("#1a2932"); line = c("#30404a"); text = c("#e9edf0"); sub = c("#a3b1b8"); accent = c("#9daaff")
            red = c("#e8a18c"); green = c("#82bea1"); gray = c("#89959b"); purple = c("#b3a6e0"); hover = c("#23343e"); mutedBg = c("#21313b")
            mutedText = c("#77878f"); selected = c("#2b3554"); dangerBg = c("#422e2a"); noteBg = c("#413625"); hero = c("#293453"); heroText = c("#f0f2ff"); mint = c("#335449"); tab = c("#8b979d")
        }
        // 「我的 → 外观」里选过主色（和网页、小程序同步的 ui_palette_v1）
        val p = (Kv.get("ui_palette_v1") as? JSONObject)?.optString("p") ?: ""
        if (Regex("^#[0-9a-fA-F]{6}$").matches(p)) {
            val pc = c(p)
            accent = if (dark) mix(pc, Color.WHITE, 0.35f) else pc
            selected = if (dark) mix(pc, Color.BLACK, 0.72f) else mix(pc, Color.WHITE, 0.88f)
            hero = if (dark) mix(pc, Color.BLACK, 0.7f) else mix(pc, Color.WHITE, 0.87f)
        }
    }
    fun c(hex: String): Int = Color.parseColor(hex)
    fun mix(a: Int, b: Int, t: Float): Int = Color.rgb(
        (Color.red(a) * (1 - t) + Color.red(b) * t).toInt(), (Color.green(a) * (1 - t) + Color.green(b) * t).toInt(), (Color.blue(a) * (1 - t) + Color.blue(b) * t).toInt())
    fun alpha(c: Int, a: Float): Int = Color.argb((a * 255).toInt(), Color.red(c), Color.green(c), Color.blue(c))
    /** 事项类型的颜色 */
    fun type(t: String): Int = when (t) { "作业" -> red; "会议" -> accent; "活动" -> green; "个人" -> purple; "课程" -> course; else -> gray }
}

// ---------- 尺寸 ----------
fun Context.dp(v: Float): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()
fun Context.dp(v: Int): Int = dp(v.toFloat())
fun View.dp(v: Int): Int = context.dp(v)

val BOLD: Typeface by lazy { if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, 700, false) else Typeface.DEFAULT_BOLD }
val SEMI: Typeface by lazy { if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, 600, false) else Typeface.DEFAULT_BOLD }
val HEAVY: Typeface by lazy { if (Build.VERSION.SDK_INT >= 28) Typeface.create(Typeface.DEFAULT, 800, false) else Typeface.DEFAULT_BOLD }

// ---------- 背景 ----------
fun round(color: Int, radius: Float, stroke: Int = 0, strokeW: Int = 0): GradientDrawable = GradientDrawable().apply {
    setColor(color); cornerRadius = radius
    if (stroke != 0) setStroke(strokeW, stroke)
}
fun View.bg(color: Int, radiusDp: Int = 0, stroke: Int = 0) { background = round(color, dp(radiusDp).toFloat(), stroke, if (stroke != 0) maxOf(1, dp(1) / 1) else 0) }
/** 能点的东西：按下有水波纹 */
fun View.press(color: Int, radiusDp: Int = 0, stroke: Int = 0, ripple: Int = C.alpha(C.text, 0.08f)) {
    val r = dp(radiusDp).toFloat()
    val content: Drawable = if (color == 0 && stroke == 0) ColorDrawable(Color.TRANSPARENT) else round(color, r, stroke, if (stroke != 0) dp(1) else 0)
    background = RippleDrawable(ColorStateList.valueOf(ripple), content, round(Color.WHITE, r))
    isClickable = true; isFocusable = true
    if (color == C.card) lift(3, C.text)
}
/** 立体感：投影（安卓 9 起影子带一点主题色，不是死灰） */
fun View.lift(e: Int = 6, tint: Int = C.accent): View {
    elevation = dp(e).toFloat()
    if (Build.VERSION.SDK_INT >= 28) { outlineSpotShadowColor = C.mix(tint, Color.BLACK, 0.35f); outlineAmbientShadowColor = C.mix(tint, Color.BLACK, 0.5f) }
    return this
}
fun View.tap(fn: (View) -> Unit) { setOnClickListener { v -> fn(v) } }
fun View.buzz() { performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) }

// ---------- 布局参数 ----------
fun lp(w: Int = ViewGroup.LayoutParams.MATCH_PARENT, h: Int = ViewGroup.LayoutParams.WRAP_CONTENT, weight: Float = 0f) = LinearLayout.LayoutParams(w, h, weight)
const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
fun View.margins(l: Int = 0, t: Int = 0, r: Int = 0, b: Int = 0): View {
    val p = layoutParams as? ViewGroup.MarginLayoutParams ?: LinearLayout.LayoutParams(MATCH, WRAP).also { layoutParams = it }
    p.setMargins(dp(l), dp(t), dp(r), dp(b)); layoutParams = p; return this
}
fun View.pad(l: Int, t: Int = l, r: Int = l, b: Int = t): View { setPadding(dp(l), dp(t), dp(r), dp(b)); return this }

// ---------- 组件 ----------
fun Context.col(): LinearLayout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; clipChildren = false }
fun Context.row(): LinearLayout = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; clipChildren = false }
fun Context.text(s: CharSequence, sp: Float = 15f, color: Int = C.text, face: Typeface? = null, lines: Int = 0): TextView = TextView(this).apply {
    text = s; setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); setTextColor(color); includeFontPadding = true
    if (face != null) typeface = face
    if (lines > 0) { maxLines = lines; ellipsize = TextUtils.TruncateAt.END }
    setLineSpacing(0f, 1.15f)
}
fun Context.space(h: Int): View = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(h)) }
fun Context.hline(): View = View(this).apply { setBackgroundColor(C.line); layoutParams = LinearLayout.LayoutParams(MATCH, maxOf(1, dp(1) / 2)) }
fun Context.icon(res: Int, sizeDp: Int, tint: Int = 0): ImageView = ImageView(this).apply {
    setImageResource(res); scaleType = ImageView.ScaleType.FIT_CENTER
    if (tint != 0) setColorFilter(tint)
    layoutParams = LinearLayout.LayoutParams(dp(sizeDp), dp(sizeDp))
}
/** 白色卡片 */
fun Context.card(padDp: Int = 18, radius: Int = 18): LinearLayout = col().apply {
    bg(C.card, radius, if (C.dark) C.line else C.alpha(C.line, 0.6f))
    pad(padDp)
    lift(3, C.text)      // 轻轻浮起来一点，不再是平贴在页面上
}
/** 主按钮（实心胶囊） */
fun Context.button(s: String, color: Int = C.accent, fg: Int = Color.WHITE, h: Int = 48, fn: (View) -> Unit): TextView = text(s, 16f, fg, BOLD).apply {
    gravity = Gravity.CENTER; press(color, 24, ripple = C.alpha(Color.WHITE, 0.25f)); minHeight = dp(h)
    layoutParams = LinearLayout.LayoutParams(MATCH, dp(h)); tap(fn)
}
/** 次按钮（浅底） */
fun Context.soft(s: String, color: Int = C.selected, fg: Int = C.accent, fn: (View) -> Unit): TextView = text(s, 14f, fg, SEMI).apply {
    gravity = Gravity.CENTER; press(color, 20); pad(14, 8); tap(fn)
}
/** 小标签 */
fun Context.chip(s: String, fg: Int, bgc: Int, sp: Float = 11.5f): TextView = text(s, sp, fg, SEMI).apply { bg(bgc, 6); pad(6, 1) }
/** 输入框 */
fun Context.input(hint: String, value: String = "", multi: Boolean = false, type: Int = InputType.TYPE_CLASS_TEXT): EditText = EditText(this).apply {
    setText(value); this.hint = hint; setTextColor(C.text); setHintTextColor(C.mutedText); setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
    background = round(C.mutedBg, dp(12).toFloat(), C.line, dp(1)); pad(14, 12)
    // 先设单行、再设输入类型（反过来的话，密码框会显示明文）
    if (multi) { inputType = type or InputType.TYPE_TEXT_FLAG_MULTI_LINE; minLines = 3; gravity = Gravity.TOP or Gravity.START }
    else { setSingleLine(true); inputType = type }
    setOnFocusChangeListener { _, f -> background = round(if (f) C.card else C.mutedBg, dp(12).toFloat(), if (f) C.accent else C.line, dp(if (f) 2 else 1)) }
}
/** 分段选择（两三个选项） */
class Seg(ctx: Context, val opts: List<String>, var sel: Int, val onPick: (Int) -> Unit) : LinearLayout(ctx) {
    private val cells = mutableListOf<TextView>()
    init {
        orientation = HORIZONTAL; bg(C.mutedBg, 14); pad(3)
        opts.forEachIndexed { i, s ->
            val t = ctx.text(s, 14f, C.sub, SEMI).apply { gravity = Gravity.CENTER; pad(10, 7); tap { pick(i); onPick(i) } }
            addView(t, LayoutParams(0, WRAP, 1f)); cells += t
        }
        paint()
    }
    fun pick(i: Int) { sel = i; paint() }
    private fun paint() { cells.forEachIndexed { i, t -> if (i == sel) { t.bg(C.card, 11); t.setTextColor(C.accent) } else { t.background = null; t.setTextColor(C.sub) } } }
}
/** 开关行 */
class Toggle(ctx: Context, title: String, desc: String, var on: Boolean, val onChange: (Boolean) -> Unit) : LinearLayout(ctx) {
    private val knob = View(ctx); private val track = FrameLayout(ctx)
    init {
        orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; pad(0, 12)
        val c = ctx.col()
        c.addView(ctx.text(title, 15f, C.text, SEMI))
        if (desc.isNotEmpty()) c.addView(ctx.text(desc, 12.5f, C.sub).apply { margins(t = 2) })
        addView(c, LayoutParams(0, WRAP, 1f))
        track.addView(knob, FrameLayout.LayoutParams(dp(22), dp(22)).apply { gravity = Gravity.CENTER_VERTICAL })
        addView(track, LayoutParams(dp(46), dp(28)).apply { leftMargin = dp(12) })
        knob.bg(Color.WHITE, 11)
        if (Build.VERSION.SDK_INT >= 21) knob.elevation = dp(2).toFloat()
        paint(false)
        tap { on = !on; paint(true); buzz(); onChange(on) }
    }
    private fun paint(anim: Boolean) {
        track.bg(if (on) C.accent else C.line, 14); track.setPadding(dp(3), 0, dp(3), 0)
        val x = if (on) dp(18).toFloat() else 0f
        if (anim) knob.animate().translationX(x).setDuration(150).start() else knob.translationX = x
    }
}
