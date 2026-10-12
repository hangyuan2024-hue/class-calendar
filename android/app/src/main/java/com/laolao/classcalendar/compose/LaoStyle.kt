package com.laolao.classcalendar

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Identity styles: one layout system, three personalities. A style changes shape, density,
 * paper colour, default palette and feature priority, never permissions.
 */
internal data class LaoStyle(
    val id: String,
    val name: String,
    val summary: String,
    val corner: Dp,
    val control: Dp,
    val gutter: Dp,
    val gap: Dp,
    val paper: Color,
    val paperDark: Color,
    val defaultPalette: String,
    val backdrop: Boolean,
) {
    val card get() = RoundedCornerShape(corner)
    val button get() = RoundedCornerShape(control)
}

internal val LaoStyles =
    listOf(
        LaoStyle("campus", "学生 · 清爽", "明快清晰，突出今天的安排", 12.dp, 10.dp, 16.dp, 10.dp,
            Color(0xFFF5F7FA), Color(0xFF12141C), "sky", false),
        LaoStyle("mentor", "老师 · 稳重", "克制有序，课程与协作并重", 10.dp, 8.dp, 16.dp, 12.dp,
            Color(0xFFF5F7F6), Color(0xFF121714), "forest", false),
        LaoStyle("business", "职场 · 简洁", "紧凑高效，商务中性色", 8.dp, 8.dp, 16.dp, 8.dp,
            Color(0xFFF3F4F6), Color(0xFF0F1115), "moon", false),
    )

internal val LocalLaoStyle = staticCompositionLocalOf { LaoStyles.first() }

internal object LaoStylePrefs {
    const val CLOUD = "ui_style_v1"
    const val MOBILE = "mobile_style_v1"

    fun key(store: CampusStore) = if (store.bool("appearance_sync_v1", true)) CLOUD else MOBILE

    /** "auto" follows the account identity; teachers get mentor, workplace users business. */
    fun resolve(a: CampusActivity): LaoStyle {
        val saved = a.store.string(key(a.store), "auto")
        LaoStyles.firstOrNull { it.id == saved }?.let { return it }
        return LaoStyles.first { it.id == autoId(a) }
    }

    fun autoId(a: CampusActivity): String {
        val identity = a.me.optString("identity", a.me.optString("role"))
        return when (identity) {
            "teacher", "admin" -> "mentor"
            "other", "work", "business", "personal" -> "business"
            else -> "campus"
        }
    }
}
