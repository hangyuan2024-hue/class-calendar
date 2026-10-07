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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
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
)

internal val LaoPalettes =
    listOf(
        LaoPalette("ocean", "海盐青", Color(0xFF246C70), Color(0xFFA6D4C3)),
        LaoPalette("sky", "晴空蓝", Color(0xFF3E5EBB), Color(0xFFB9D5EF)),
        LaoPalette("mint", "薄荷绿", Color(0xFF356752), Color(0xFFBFE2CE)),
        LaoPalette("lavender", "鸢尾紫", Color(0xFF7258A8), Color(0xFFD9C9EA)),
        LaoPalette("sakura", "樱花粉", Color(0xFFA4456C), Color(0xFFF1CCD9)),
        LaoPalette("apricot", "暖杏橙", Color(0xFF945F36), Color(0xFFF3D9B8)),
        LaoPalette("forest", "森野绿", Color(0xFF267661), Color(0xFFBDE2CE)),
        LaoPalette("moon", "月光白", Color(0xFF4B586C), Color(0xFFD4DCE8)),
        LaoPalette("cyber", "深海赛博", Color(0xFF286E72), Color(0xFF9AE0D5)),
        LaoPalette("graphite", "石墨灰", Color(0xFF555C70), Color(0xFFD8DCE6)),
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
    val pref = state.a.store.string("compose_mode_v1", "system")
    val legacy = state.a.store.string("ui_skin_v1", "fresh")
    val dark =
        if (pref == "system")
            isSystemInDarkTheme() || legacy == "cyber" || legacy == "dark" || p.id == "cyber"
        else pref == "dark"
    val scheme =
        if (dark)
            darkColorScheme(
                primary = p.companion,
                onPrimary = Color(0xFF123033),
                primaryContainer = p.primary.copy(alpha = .42f),
                onPrimaryContainer = Color(0xFFE5F4F0),
                secondary = Color(0xFFB9C9CC),
                secondaryContainer = Color(0xFF2A3B42),
                onSecondaryContainer = Color(0xFFE9EEF1),
                background = Color(0xFF10191E),
                onBackground = Color(0xFFE9EEF1),
                surface = Color(0xFF18232A),
                onSurface = Color(0xFFE9EEF1),
                surfaceContainer = Color(0xFF203039),
                surfaceContainerLow = Color(0xFF1C2931),
                surfaceContainerHigh = Color(0xFF293A44),
                surfaceContainerLowest = Color(0xFF131D23),
                onSurfaceVariant = Color(0xFFA3B5BD),
                outlineVariant = Color(0xFF354750),
                tertiary = Color(0xFFFFC5A8),
                tertiaryContainer = Color(0xFF47372E),
            )
        else
            lightColorScheme(
                primary = p.primary,
                onPrimary = Color.White,
                primaryContainer = p.companion.copy(alpha = .52f),
                onPrimaryContainer = Color(0xFF18363C),
                secondary = Color(0xFF637A83),
                secondaryContainer = Color(0xFFE8EFF0),
                onSecondaryContainer = Color(0xFF182E38),
                background = Color(0xFFF6F8F8),
                onBackground = Color(0xFF182E38),
                surface = Color.White,
                onSurface = Color(0xFF182E38),
                surfaceContainer = Color(0xFFEDF2F3),
                surfaceContainerLow = Color(0xFFF2F6F6),
                surfaceContainerHigh = Color(0xFFE6EDEF),
                surfaceContainerLowest = Color.White,
                onSurfaceVariant = Color(0xFF617580),
                outlineVariant = Color(0xFFE2E9EA),
                tertiary = Color(0xFF9C6545),
                tertiaryContainer = Color(0xFFFFEBD9),
            )
    val enabled =
        Settings.Global.getFloat(
            LocalContext.current.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        ) != 0f
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
            if (pressed && enabled) .972f else 1f,
            animationSpec = spring(dampingRatio = .74f, stiffness = 520f),
            label = "press scale",
        )
    return graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}

@Composable
internal fun Entrance(index: Int = 0, content: @Composable () -> Unit) {
    val enabled = LocalMotionEnabled.current
    // A target-visible transition measures content immediately. Initially zero-height list
    // children would make LazyColumn compose an entire large import before the animation starts.
    val state = remember { MutableTransitionState(!enabled).apply { targetState = true } }
    AnimatedVisibility(
        visibleState = state,
        enter =
            fadeIn(tween(240, delayMillis = (index * 40).coerceAtMost(240))) +
                slideInVertically(spring(dampingRatio = .88f, stiffness = 300f)) { it / 8 },
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
) {
    val colors = MaterialTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    val shape = RoundedCornerShape(24.dp)
    val base = tint ?: colors.surface
    val touch =
        if (onClick == null) Modifier else Modifier.clickable(source, null, onClick = onClick)
    Column(
        modifier
            .springPress(source)
            .shadow(
                3.dp,
                shape,
                ambientColor = colors.primary.copy(alpha = .10f),
                spotColor = colors.primary.copy(alpha = .08f),
            )
            .clip(shape)
            .background(Brush.linearGradient(listOf(base, base.copy(alpha = .98f))))
            .border(1.dp, colors.outlineVariant.copy(alpha = .55f), shape)
            .then(touch)
            .padding(Space.md),
        verticalArrangement = Arrangement.spacedBy(Space.sm),
        content = content,
    )
}

@Composable
internal fun PrimaryButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.springPress(interaction).heightIn(min = 48.dp),
        interactionSource = interaction,
        shape = RoundedCornerShape(16.dp),
        contentPadding = PaddingValues(horizontal = 24.dp, vertical = 16.dp),
    ) {
        Text(label)
    }
}

@Composable
internal fun SoftButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    FilledTonalButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.springPress(interaction).heightIn(min = 48.dp),
        interactionSource = interaction,
        shape = RoundedCornerShape(16.dp),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
    ) {
        Text(label)
    }
}

@Composable
internal fun PressIcon(icon: ImageVector, description: String, onClick: () -> Unit) {
    val interaction = remember { MutableInteractionSource() }
    IconButton(
        onClick = onClick,
        interactionSource = interaction,
        modifier = Modifier.size(48.dp).springPress(interaction),
    ) {
        Icon(icon, description, Modifier.size(24.dp))
    }
}

@Composable
internal fun SectionHeading(
    title: String,
    note: String? = null,
    action: String? = null,
    click: () -> Unit = {},
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge)
            if (!note.isNullOrEmpty())
                Text(
                    note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
        }
        if (action != null) TextButton(onClick = click) { Text(action) }
    }
}

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

@Composable
internal fun LaoMascot(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val sx = size.width / 120f
        val sy = size.height / 120f
        with(drawContext.canvas) {
            save()
            scale(sx, sy)
            val navy = Color(0xFF142C48)
            val orange = Color(0xFFFF9B56)
            drawOval(Color(0x18213B50), topLeft = Offset(28f, 106f), size = Size(72f, 10f))
            drawPath(
                Path().apply {
                    moveTo(95f, 74f)
                    quadraticBezierTo(110f, 70f, 113f, 53f)
                },
                navy,
                style = androidx.compose.ui.graphics.drawscope.Stroke(5f, cap = StrokeCap.Round),
            )
            drawCircle(Color.White, 6f, Offset(113f, 50f))
            drawCircle(
                navy,
                6f,
                Offset(113f, 50f),
                style = androidx.compose.ui.graphics.drawscope.Stroke(4f),
            )
            drawPath(
                Path().apply {
                    moveTo(24f, 78f)
                    quadraticBezierTo(12f, 84f, 12f, 96f)
                },
                navy,
                style = androidx.compose.ui.graphics.drawscope.Stroke(5f, cap = StrokeCap.Round),
            )
            drawRoundRect(
                Color.White,
                Offset(22f, 28f),
                Size(76f, 78f),
                androidx.compose.ui.geometry.CornerRadius(24f),
            )
            drawPath(
                Path().apply {
                    moveTo(22f, 54f)
                    lineTo(22f, 52f)
                    cubicTo(22f, 38f, 32f, 28f, 46f, 28f)
                    lineTo(74f, 28f)
                    cubicTo(88f, 28f, 98f, 38f, 98f, 52f)
                    lineTo(98f, 54f)
                    close()
                },
                orange,
            )
            drawRoundRect(
                navy,
                Offset(22f, 28f),
                Size(76f, 78f),
                androidx.compose.ui.geometry.CornerRadius(24f),
                style = androidx.compose.ui.graphics.drawscope.Stroke(5f),
            )
            listOf(40f, 80f).forEach { x ->
                drawLine(navy, Offset(x, 20f), Offset(x, 36f), 6f, StrokeCap.Round)
            }
            listOf(43f, 76f).forEach { x ->
                drawOval(navy, Offset(x, 65f), Size(8f, 12f))
                drawCircle(Color.White, 1.8f, Offset(x + 2f, 68f))
            }
            drawOval(Color(0xFFFFC4CC), Offset(32f, 79f), Size(12f, 7f))
            drawOval(Color(0xFFFFC4CC), Offset(76f, 79f), Size(12f, 7f))
            drawPath(
                Path().apply {
                    moveTo(53f, 84f)
                    quadraticBezierTo(60f, 92f, 67f, 84f)
                },
                navy,
                style = androidx.compose.ui.graphics.drawscope.Stroke(4f, cap = StrokeCap.Round),
            )
            drawPath(
                Path().apply {
                    moveTo(104f, 16f)
                    lineTo(107f, 22f)
                    lineTo(113f, 25f)
                    lineTo(107f, 28f)
                    lineTo(104f, 34f)
                    lineTo(101f, 28f)
                    lineTo(95f, 25f)
                    lineTo(101f, 22f)
                    close()
                },
                Color(0xFFFFCF62),
            )
            restore()
        }
    }
}
