package com.laolao.classcalendar.ui

import android.content.Context

/** 7.x 界面大小（只存这台手机）：紧凑 90%（默认）/ 标准 100% / 大一点 108% */
object UiScale {
    val OPTS = listOf("紧凑" to 0.9f, "标准" to 1f, "大一点" to 1.08f)
    private fun p(ctx: Context) = ctx.getSharedPreferences("ui", Context.MODE_PRIVATE)
    fun get(ctx: Context): Float = p(ctx).getFloat("scale", 0.9f)
    fun set(ctx: Context, v: Float) { p(ctx).edit().putFloat("scale", v).apply() }
}
