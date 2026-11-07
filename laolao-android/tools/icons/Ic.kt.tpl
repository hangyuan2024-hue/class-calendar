package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import com.laolao.classcalendar.R

/**
 * 全 App 的功能图标统一放在这里（7.x）。
 *
 * 以前每个页面直接写表情符号（📚、🎯、⏳…）当图标：不同手机字体画出来大小、风格都不一样，老手机还会显示成空白方块。
 * 现在页面里照旧写原来的表情，当作图标的「名字」；画的时候查下面这张表，换成同一套线条图标（Lucide，ISC 许可，
 * 和底部导航栏是同一个风格）+ 统一的配色小方块。表里没有的，才照旧显示表情。
 *
 * 要换某个图标或颜色：只改这张表。要加新图标：从 https://lucide.dev 挑一个，
 * 把 SVG 转成 res/drawable/ic_l_名字.xml（同目录下的文件都是这么来的），再在表里加一行。
 */
object Ic {
    /** 一类功能一个颜色：B 蓝 · I 主题色 · G 绿 · O 橙 · R 红 · P 粉 · V 紫 · T 青 · A 琥珀 · S 灰 */
    fun color(k: Char): Int = when (k) {
        'B' -> 0xFF3B82F6.toInt(); 'I' -> C.accent; 'G' -> 0xFF16A34A.toInt(); 'O' -> 0xFFF97316.toInt()
        'R' -> 0xFFEF4444.toInt(); 'P' -> 0xFFEC4899.toInt(); 'V' -> 0xFF8B5CF6.toInt(); 'T' -> 0xFF0D9488.toInt()
        'A' -> 0xFFD97706.toInt(); else -> 0xFF64748B.toInt()
    }

    class Def(val emoji: String, val res: Int, val key: Char)

    private val ALL = listOf(
/*@@MAP@@*/
    )
    private fun norm(s: String) = s.replace("️", "").trim()
    private val BY: Map<String, Def> by lazy { ALL.associateBy { norm(it.emoji) } }

    fun find(e: String): Def? = BY[norm(e)]
    fun has(e: String): Boolean = find(e) != null
    /** 深色模式下颜色提亮一点，不然在深色底上发闷 */
    fun tone(c: Int): Int = if (C.dark) C.mix(c, Color.WHITE, 0.22f) else c
    fun colorOf(e: String): Int = find(e)?.let { tone(color(it.key)) } ?: C.sub

    fun drawable(ctx: Context, e: String, tint: Int? = null): Drawable? {
        val d = find(e) ?: return null
        val dr = ctx.getDrawable(d.res)?.mutate() ?: return null
        dr.setTint(tint ?: tone(color(d.key)))
        return dr
    }

    /**
     * 带浅色底的方块图标（工具卡片、设置列表、入口卡片）。调用的地方给它 size × size 的位置。
     * 表里没有的表情：照旧显示表情，大小和以前差不多。
     */
    fun tile(ctx: Context, e: String, size: Int = 36): View {
        val d = find(e) ?: return ctx.text(e, size * 0.52f).apply { gravity = Gravity.CENTER }
        val c = tone(color(d.key))
        return ImageView(ctx).apply {
            setImageDrawable(drawable(ctx, e, c)); scaleType = ImageView.ScaleType.FIT_CENTER
            val p = ctx.dp(size * 0.24f); setPadding(p, p, p, p)
            background = round(C.alpha(c, if (C.dark) 0.2f else 0.12f), ctx.dp(size * 0.3f).toFloat())
            contentDescription = null
        }
    }

    /** 不带底色的图标（菜单、小胶囊、按钮里）。tint 不给就用这个图标自己的颜色 */
    fun plain(ctx: Context, e: String, size: Int = 18, tint: Int? = null): View {
        if (find(e) == null) return ctx.text(e, size * 0.9f).apply { gravity = Gravity.CENTER }
        return ImageView(ctx).apply { setImageDrawable(drawable(ctx, e, tint)); scaleType = ImageView.ScaleType.FIT_CENTER }
    }

    /**
     * 文字最前面的表情换成图标：「📚 今天 3 节课」→ [书] 今天 3 节课。
     * 开头不是表里的表情就什么都不改。tint 不给就和文字同色（胶囊里更协调）；own = true 用图标自己的颜色（标题里）。
     */
    fun lead(tv: TextView, size: Int = 15, tint: Int? = null, own: Boolean = false): TextView {
        val s = tv.text?.toString() ?: return tv
        val sp = s.indexOf(' ')
        if (sp <= 0 || sp > 6) return tv
        val e = s.substring(0, sp)
        val dr = drawable(tv.context, e, tint ?: if (own) null else tv.currentTextColor) ?: return tv
        val px = tv.context.dp(size)
        dr.setBounds(0, 0, px, px)
        tv.text = s.substring(sp + 1)
        tv.setCompoundDrawablesRelative(dr, null, null, null)
        tv.compoundDrawablePadding = tv.context.dp(5)
        tv.gravity = tv.gravity or Gravity.CENTER_VERTICAL
        return tv
    }

    /** 搜索框前面放一个放大镜线条图标（代替以前写在提示文字里的 🔍） */
    fun search(et: TextView, size: Int = 17): TextView {
        val dr = drawable(et.context, "🔍", C.sub) ?: return et
        val px = et.context.dp(size); dr.setBounds(0, 0, px, px)
        et.setCompoundDrawablesRelative(dr, null, null, null); et.compoundDrawablePadding = et.context.dp(8)
        return et
    }
}
