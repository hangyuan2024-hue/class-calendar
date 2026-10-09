package com.laolao.classcalendar

import android.provider.Settings
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.*
import androidx.compose.ui.unit.*

internal object Space {
    val unit = 8.dp
    val xs = 8.dp
    val sm = 16.dp
    val md = 24.dp
    val lg = 32.dp
    val xl = 40.dp
}

internal val LocalMotionEnabled = staticCompositionLocalOf { true }

internal data class LaoPalette(
    val id: String,
    val name: String,
    val primary: Color,
    val companion: Color,
    val accent: Color = Color(0xFF7654CB),
)

internal val LaoPalettes =
    listOf(
        LaoPalette("ocean", "默认 · 鸢尾蓝", Color(0xFF5059CC), Color(0xFFD8DFFF), Color(0xFFC65B48)),
        LaoPalette("sky", "晴空蓝", Color(0xFF365BCA), Color(0xFFC6D9FF), Color(0xFFBA3F78)),
        LaoPalette("mint", "薄荷绿", Color(0xFF14795C), Color(0xFFBDEBDD), Color(0xFF6A59C7)),
        LaoPalette("lavender", "暮光紫", Color(0xFF7952B7), Color(0xFFE4D6FF), Color(0xFFAF5D7E)),
        LaoPalette("sakura", "莓果粉", Color(0xFFB83F77), Color(0xFFF8CDDF), Color(0xFF6956C7)),
        LaoPalette("apricot", "日落橙", Color(0xFFA95626), Color(0xFFFFD8B5), Color(0xFF7857BE)),
        LaoPalette("forest", "森野绿", Color(0xFF267661), Color(0xFFBDE2CE)),
        LaoPalette("moon", "月光白", Color(0xFF4B586C), Color(0xFFD4DCE8)),
        LaoPalette("cyber", "深空蓝", Color(0xFF3B5487), Color(0xFFBDCEFA)),
        LaoPalette("graphite", "夜幕黑", Color(0xFF2A2E37), Color(0xFFD4D9EB), Color(0xFFED81AE)),
    )
internal val LaoTypography =
    Typography(
        displaySmall =
            androidx.compose.ui.text.TextStyle(
                fontSize = 40.sp,
                lineHeight = 48.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-1).sp,
            ),
        headlineLarge =
            androidx.compose.ui.text.TextStyle(
                fontSize = 32.sp,
                lineHeight = 40.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-.6).sp,
            ),
        headlineMedium =
            androidx.compose.ui.text.TextStyle(
                fontSize = 28.sp,
                lineHeight = 36.sp,
                fontWeight = FontWeight.Bold,
            ),
        headlineSmall =
            androidx.compose.ui.text.TextStyle(
                fontSize = 24.sp,
                lineHeight = 32.sp,
                fontWeight = FontWeight.Bold,
            ),
        titleLarge =
            androidx.compose.ui.text.TextStyle(
                fontSize = 20.sp,
                lineHeight = 28.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        titleMedium =
            androidx.compose.ui.text.TextStyle(
                fontSize = 16.sp,
                lineHeight = 24.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        titleSmall =
            androidx.compose.ui.text.TextStyle(
                fontSize = 14.sp,
                lineHeight = 20.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        bodyLarge =
            androidx.compose.ui.text.TextStyle(
                fontSize = 16.sp,
                lineHeight = 24.sp,
                fontWeight = FontWeight.Normal,
            ),
        bodyMedium =
            androidx.compose.ui.text.TextStyle(
                fontSize = 14.sp,
                lineHeight = 24.sp,
                fontWeight = FontWeight.Normal,
            ),
        bodySmall =
            androidx.compose.ui.text.TextStyle(
                fontSize = 12.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.Normal,
            ),
        labelLarge =
            androidx.compose.ui.text.TextStyle(
                fontSize = 14.sp,
                lineHeight = 20.sp,
                fontWeight = FontWeight.SemiBold,
            ),
        labelMedium =
            androidx.compose.ui.text.TextStyle(
                fontSize = 12.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.Medium,
            ),
        labelSmall =
            androidx.compose.ui.text.TextStyle(
                fontSize = 11.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.Medium,
            ),
    )

@Composable
internal fun LaoLaoTheme(state: CampusSession, content: @Composable () -> Unit) {
    state.revision
    val saved = state.a.store.`object`("ui_palette_v1")
    val p = LaoPalettes.find { it.id == saved.optString("id") } ?: LaoPalettes.first()
    LaunchedEffect(p.id) {
        if (p.id == "ocean" && saved.optString("p") != "#5059CC") {
            val aligned = org.json.JSONObject(saved.toString()).put("id", p.id).put("p", "#5059CC")
            state.a.store.set("ui_palette_v1", aligned)
        }
    }
    val pref = state.a.store.string("compose_mode_v1", "")
    val legacy = state.a.store.string("ui_skin_v1", "fresh")
    val dark =
        when (pref) {
            "light" -> false
            "dark" -> true
            "system" -> isSystemInDarkTheme()
            else ->
                isSystemInDarkTheme() ||
                    legacy == "cyber" ||
                    legacy == "dark" ||
                    p.id in listOf("cyber", "graphite")
        }
    val nightBase =
        when (p.id) {
            "cyber" -> Color(0xFF10172B)
            "graphite" -> Color(0xFF0D0E13)
            else -> Color(0xFF13141D)
        }
    val nightSurface = lerp(nightBase, p.primary, .08f)
    val background = if (dark) nightBase else Color(0xFFF8F7F4)
    val surface = if (dark) lerp(nightSurface, Color.White, .035f) else Color.White
    val secondary = if (dark) lerp(p.accent, Color.White, .40f) else p.accent
    val scheme =
        if (dark)
            darkColorScheme(
                primary = p.companion,
                onPrimary = Color(0xFF20233A),
                primaryContainer = lerp(surface, p.companion, .16f),
                onPrimaryContainer = p.companion,
                secondary = secondary,
                secondaryContainer = lerp(surface, secondary, .13f),
                onSecondaryContainer = Color(0xFFEEEAF7),
                background = background,
                onBackground = Color(0xFFF0F0F6),
                surface = surface,
                onSurface = Color(0xFFF0F0F6),
                onSurfaceVariant = Color(0xFFB3B4C5),
                surfaceContainerLowest = nightBase,
                surfaceContainerLow = surface,
                surfaceContainer = lerp(surface, Color.White, .045f),
                surfaceContainerHigh = lerp(surface, Color.White, .08f),
                outlineVariant = Color(0xFF343644),
                tertiary = Color(0xFFFFC78E),
                tertiaryContainer = Color(0xFF3D3026),
            )
        else
            lightColorScheme(
                primary = p.primary,
                onPrimary = Color.White,
                primaryContainer = lerp(Color.White, p.companion, .62f),
                onPrimaryContainer = Color(0xFF19232E),
                secondary = secondary,
                secondaryContainer = lerp(Color.White, p.accent, .10f),
                onSecondaryContainer = Color(0xFF29223A),
                background = background,
                onBackground = Color(0xFF252637),
                surface = surface,
                onSurface = Color(0xFF252637),
                onSurfaceVariant = Color(0xFF6B6A76),
                surfaceContainerLowest = Color.White,
                surfaceContainerLow = Color(0xFFF0EFEC),
                surfaceContainer = Color(0xFFEDEBE7),
                surfaceContainerHigh = Color(0xFFE6E4E0),
                outlineVariant = Color(0xFFE2E0DC),
                tertiary = Color(0xFFA36B3D),
                tertiaryContainer = Color(0xFFF6EADC),
            )
    val enabled =
        Settings.Global.getFloat(
            LocalContext.current.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) != 0f && !state.a.store.bool("compose_reduce_motion_v1", false)
    CompositionLocalProvider(LocalMotionEnabled provides enabled) {
        MaterialTheme(
            colorScheme = scheme,
            typography = LaoTypography,
            shapes =
                Shapes(
                    extraSmall = RoundedCornerShape(8.dp),
                    small = RoundedCornerShape(16.dp),
                    medium = RoundedCornerShape(24.dp),
                    large = RoundedCornerShape(32.dp),
                    extraLarge = RoundedCornerShape(32.dp),
                ),
            content = content,
        )
    }
}

@Composable
internal fun Modifier.springPress(source: MutableInteractionSource): Modifier {
    val pressed by source.collectIsPressedAsState()
    val enabled = LocalMotionEnabled.current
    val scale by
        animateFloatAsState(
            if (pressed && enabled) .965f else 1f,
            animationSpec = if (enabled) spring(dampingRatio = .68f, stiffness = 480f) else snap(),
            label = "press scale",
        )
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

@Composable
internal fun Entrance(
    index: Int = 0,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val enabled = LocalMotionEnabled.current
    // A target-visible transition measures content immediately. Initially zero-height list
    // children would make LazyColumn compose an entire large import before the animation starts.
    val state = remember { MutableTransitionState(!enabled).apply { targetState = true } }
    AnimatedVisibility(
        visibleState = state,
        modifier = modifier,
        enter =
            fadeIn(tween(340, delayMillis = (index * 36).coerceAtMost(180))) +
                slideInVertically(spring(dampingRatio = .82f, stiffness = 260f)) {
                    minOf(it / 5, 64)
                } +
                scaleIn(spring(dampingRatio = .86f, stiffness = 280f), initialScale = .985f),
        exit = fadeOut(tween(120)),
    ) {
        content()
    }
}

@Composable
internal fun PremiumCard(
    modifier: Modifier = Modifier,
    tint: Color? = null,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) =
    LaoPanel(
        modifier,
        color = tint ?: MaterialTheme.colorScheme.surface,
        padding = 20.dp,
        onClick = onClick,
        content = content,
    )

@Composable
internal fun PrimaryButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) = LaoPrimaryButton(label, modifier, enabled, onClick)

@Composable
internal fun SoftButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) = LaoSecondaryButton(label, modifier, enabled, onClick)

@Composable
internal fun PressIcon(icon: ImageVector, description: String, onClick: () -> Unit) =
    LaoIconButton(icon, description, click = onClick)

@Composable
internal fun SectionHeading(
    title: String,
    note: String? = null,
    action: String? = null,
    click: () -> Unit = {},
) = LaoSection(title, note = note, action = action, click = click)

internal fun routeIcon(route: String): ImageVector =
    when (route) {
        "home" -> Icons.Rounded.Home
        "calendar",
        "countdown",
        "reminders" -> Icons.Rounded.CalendarMonth
        "homework",
        "wrongbook",
        "cards",
        "review" -> Icons.AutoMirrored.Rounded.MenuBook
        "courses" -> Icons.Rounded.School
        "tools",
        "plugins" -> Icons.Rounded.Widgets
        "growth",
        "rank",
        "report",
        "meta" -> Icons.Rounded.Insights
        "pomo",
        "plan",
        "time-master" -> Icons.Rounded.Timelapse
        "me",
        "class",
        "people" -> Icons.Rounded.PersonOutline
        "farm" -> Icons.Rounded.Cloud
        "ledger" -> Icons.Rounded.AccountBalanceWallet
        "draw" -> Icons.Rounded.Casino
        "diary" -> Icons.AutoMirrored.Rounded.Article
        "appearance" -> Icons.Rounded.Palette
        "voice",
        "recordings" -> Icons.Rounded.MicNone
        "scanner",
        "inbox" -> Icons.Rounded.AddPhotoAlternate
        "places" -> Icons.Rounded.Place
        "contacts" -> Icons.Rounded.Call
        "privacy",
        "security",
        "quiet" -> Icons.Rounded.VerifiedUser
        "ask" -> Icons.Rounded.AutoAwesome
        "wall" -> Icons.AutoMirrored.Rounded.Chat
        "search" -> Icons.Rounded.Search
        else -> Icons.Rounded.Explore
    }

@Composable
internal fun IconTile(route: String, size: Dp = 48.dp) {
    Box(
        Modifier.size(size)
            .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(16.dp)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(routeIcon(route), null, Modifier.size(24.dp), tint = MaterialTheme.colorScheme.primary)
    }
}
