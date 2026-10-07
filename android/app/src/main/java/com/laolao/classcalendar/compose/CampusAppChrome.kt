package com.laolao.classcalendar

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

/** Older fitted Android windows consume IME insets before they reach Compose. */
@Composable
internal fun campusKeyboardVisible(): Boolean {
    val view = LocalView.current
    val density = LocalDensity.current
    var fittedWindowKeyboard by remember(view) { mutableStateOf(false) }
    DisposableEffect(view, density) {
        val visibleFrame = android.graphics.Rect()
        val threshold = with(density) { 144.dp.toPx() }
        val observer =
            android.view.ViewTreeObserver.OnGlobalLayoutListener {
                view.getWindowVisibleDisplayFrame(visibleFrame)
                val height = visibleFrame.height()
                fittedWindowKeyboard =
                    height > 0 && view.resources.displayMetrics.heightPixels - height > threshold
            }
        view.viewTreeObserver.addOnGlobalLayoutListener(observer)
        onDispose {
            if (view.viewTreeObserver.isAlive)
                view.viewTreeObserver.removeOnGlobalLayoutListener(observer)
        }
    }
    return WindowInsets.ime.getBottom(density) > 0 || fittedWindowKeyboard
}

@Composable
internal fun CampusTopBar(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    Column(Modifier.background(c.background).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth()
                .heightIn(min = 64.dp)
                .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (s.route !in MainRoutes)
                PressIcon(Icons.AutoMirrored.Rounded.ArrowBack, "返回") { s.a.onBackPressed() }
            else
                Box(
                    Modifier.size(40.dp).clip(RoundedCornerShape(16.dp)).background(c.surface),
                    contentAlignment = Alignment.Center,
                ) {
                    LaoMascot(Modifier.size(32.dp), expressive = false)
                }
            Column(
                Modifier.weight(1f).padding(start = 8.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    if (s.route == "home") "捞捞课程表"
                    else if (s.route == "ask") "捞捞 AI 助手" else routeTitle(s.route),
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (s.route == "home" || s.route == "ask")
                    Text(
                        "AI Campus Agent",
                        style = MaterialTheme.typography.labelSmall,
                        color = c.onSurfaceVariant,
                    )
            }
            if (s.route != "ask")
                PressIcon(Icons.Rounded.Search, "搜索课程与记录") { s.sheet = SearchSheet }
            if (s.route == "home") {
                val count = CampusGuide.ranked(s.a).count { !it.course && it.minutes <= 24 * 60 }
                Box {
                    PressIcon(Icons.Rounded.NotificationsNone, "查看重要安排") { s.sheet = AlertsSheet }
                    if (count > 0)
                        Box(
                            Modifier.align(Alignment.TopEnd)
                                .padding(top = 10.dp, end = 10.dp)
                                .size(6.dp)
                                .background(CampusStatus.warning(), CircleShape)
                        )
                }
            } else if (s.route == "tools")
                PressIcon(Icons.Rounded.Tune, "快捷选择工具") { s.sheet = ToolPickerSheet }
            else if (s.route == "ask")
                PressIcon(Icons.Rounded.Tune, "AI 服务设置") { CampusSocial.aiSettings(s.a) }
            else PressIcon(Icons.Rounded.AutoAwesome, "打开捞捞助手") { s.agent() }
        }
    }
}

@Composable
internal fun CampusBottomBar(s: CampusSession, current: String, choose: (String) -> Unit) {
    val c = MaterialTheme.colorScheme
    val labels = listOf("首页", "日历", "AI 助手", "工具", "我的")
    Column(Modifier.navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp)) {
        BoxWithConstraints(
            Modifier.fillMaxWidth()
                .campusGlass(c.surface, elevation = 6.dp)
                .padding(horizontal = 8.dp)
        ) {
            val motion = LocalMotionEnabled.current
            val cell = maxWidth / MainRoutes.size
            val selection by
                animateFloatAsState(
                    MainRoutes.indexOf(current).coerceAtLeast(0).toFloat(),
                    if (motion) spring(dampingRatio = .78f, stiffness = 380f) else snap(),
                    label = "navigation selection",
                )
            Box(
                Modifier.offset(x = cell * selection + (cell - 48.dp) / 2, y = 8.dp)
                    .size(width = 48.dp, height = 32.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(c.primaryContainer.copy(alpha = .85f))
            )
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                MainRoutes.forEachIndexed { i, route ->
                    val on = current == route
                    val source = remember { MutableInteractionSource() }
                    val tint by
                        animateColorAsState(
                            if (on) c.primary else c.onSurfaceVariant,
                            if (motion) tween(220) else snap(),
                            label = "navigation tint",
                        )
                    val lift by
                        animateFloatAsState(
                            if (on) 1.05f else 1f,
                            if (motion) spring(dampingRatio = .7f, stiffness = 420f) else snap(),
                            label = "navigation emphasis",
                        )
                    val icon =
                        when (route) {
                            "home" -> if (on) Icons.Rounded.Home else Icons.Outlined.Home
                            "calendar" ->
                                if (on) Icons.Rounded.CalendarMonth
                                else Icons.Outlined.CalendarMonth
                            "ask" -> Icons.Rounded.AutoAwesome
                            "tools" -> if (on) Icons.Rounded.Widgets else Icons.Outlined.Widgets
                            else -> if (on) Icons.Rounded.Person else Icons.Outlined.PersonOutline
                        }
                    Column(
                        Modifier.weight(1f)
                            .heightIn(min = 56.dp)
                            .springPress(source)
                            .clip(RoundedCornerShape(16.dp))
                            .clickable(source, null, role = Role.Tab) { choose(route) }
                            .semantics {
                                selected = on
                                contentDescription = "导航到${labels[i]}"
                            },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Box(
                            Modifier.size(width = 48.dp, height = 32.dp)
                                .graphicsLayer {
                                    scaleX = lift
                                    scaleY = lift
                                }
                                .clip(RoundedCornerShape(12.dp))
                                .background(if (route == "ask") c.primary else Color.Transparent),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                icon,
                                null,
                                Modifier.size(if (route == "ask") 20.dp else 22.dp),
                                tint = if (route == "ask") c.onPrimary else tint,
                            )
                        }
                        Text(
                            labels[i],
                            style = MaterialTheme.typography.labelSmall,
                            color = if (on) c.primary else c.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                }
            }
        }
    }
}
