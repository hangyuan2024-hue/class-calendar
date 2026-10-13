package com.laolao.classcalendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laolao.classcalendar.R

/** Website palettes (same values as the site's CSS --accent / --bg2 / --line). */
data class Palette(val id: String, val label: String, val accent: Color, val accent2: Color, val bg: Color, val tint: Color)

val PALETTES = listOf(
    Palette("blue", "天空蓝（网站默认）", Color(0xFF1E8CFF), Color(0xFFFF7B2E), Color(0xFFF3FBFF), Color(0xFFCDEEFF)),
    Palette("pink", "樱花粉", Color(0xFFFF5F8F), Color(0xFFFFB03B), Color(0xFFFFF6F9), Color(0xFFFFE1EC)),
    Palette("navy", "学院蓝", Color(0xFF2457D6), Color(0xFFFFB020), Color(0xFFF4F7FF), Color(0xFFD6E2FF)),
)

data class LaoColors(val accent: Color, val accent2: Color, val bg: Color, val tint: Color, val card: Color, val line: Color, val ink: Color, val muted: Color, val dark: Boolean)

val LocalLao = staticCompositionLocalOf { LaoColors(Color(0xFF1E8CFF), Color(0xFFFF7B2E), Color(0xFFF3FBFF), Color(0xFFCDEEFF), Color.White, Color(0xFFDFE9F3), Color(0xFF14202E), Color(0xFF6B7A90), false) }

val Display = FontFamily(Font(R.font.laolao_display_regular), Font(R.font.laolao_display_bold, FontWeight.Bold))

@Composable
fun LaoTheme(palette: Palette, darkPref: String, content: @Composable () -> Unit) {
    val dark = when (darkPref) { "on" -> true; "off" -> false; else -> isSystemInDarkTheme() }
    val c = if (dark) LaoColors(palette.accent, palette.accent2, Color(0xFF0B0F1A), Color(0xFF10182B), Color(0xFF1A1D27), Color(0xFF2B2F3D), Color(0xFFEAF0F8), Color(0xFF8E9AAD), true)
    else LaoColors(palette.accent, palette.accent2, palette.bg, palette.tint, Color.White, Color(0xFFDFE9F3), Color(0xFF14202E), Color(0xFF6B7A90), false)
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = c.accent, onPrimary = Color.White, secondary = c.accent2, background = c.bg, surface = c.card,
        surfaceVariant = c.tint, onBackground = c.ink, onSurface = c.ink, onSurfaceVariant = c.muted, outline = c.line,
        primaryContainer = c.tint, onPrimaryContainer = c.ink, surfaceContainer = c.card, surfaceContainerHigh = c.card,
        surfaceContainerLow = c.card, surfaceContainerHighest = c.tint,
    )
    CompositionLocalProvider(LocalLao provides c) {
        MaterialTheme(colorScheme = scheme, typography = Typography(
            headlineMedium = TextStyleDefaults.h1, titleLarge = TextStyleDefaults.h2,
        ), content = content)
    }
}

private object TextStyleDefaults {
    val h1 = androidx.compose.ui.text.TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 32.sp)
    val h2 = androidx.compose.ui.text.TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp)
}

// ---------- shared building blocks ----------

@Composable
fun Card0(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val c = LocalLao.current
    Surface(
        modifier = modifier.fillMaxWidth().then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        shape = RoundedCornerShape(20.dp), color = c.card, border = BorderStroke(1.dp, c.line),
    ) { Column(Modifier.padding(16.dp), content = content) }
}

@Composable
fun SectionTitle(text: String, action: String? = null, onAction: () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        if (action != null) TextButton(onClick = onAction) { Text(action) }
    }
}

@Composable
fun Pill(text: String, color: Color = LocalLao.current.accent) {
    Text(text, fontSize = 11.sp, color = color, fontWeight = FontWeight.Bold,
        modifier = Modifier.background(color.copy(alpha = .12f), RoundedCornerShape(50)).padding(horizontal = 8.dp, vertical = 2.dp))
}

@Composable
fun Empty(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(body, color = LocalLao.current.muted, fontSize = 13.sp)
    }
}
