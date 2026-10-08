package com.laolao.classcalendar

import androidx.compose.animation.*
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
internal fun LaoTopBar(s: CampusSession, scrolled: Boolean) {
    val c = MaterialTheme.colorScheme
    val auth = s.route in listOf("login", "register")
    val small by
        animateDpAsState(
            if (scrolled) 28.dp else 36.dp,
            if (LocalMotionEnabled.current) spring(.9f, 400f) else snap(),
            label = "scrolling brand",
        )
    Column(
        Modifier.fillMaxWidth().background(c.background.copy(alpha = .98f)).statusBarsPadding()
    ) {
        Row(
            Modifier.heightIn(min = 56.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (s.route !in MainRoutes)
                LaoIconButton(Icons.AutoMirrored.Rounded.ArrowBack, "返回") { s.a.onBackPressed() }
            else
                LaoMascot(
                    Modifier.size(small),
                    expressive = false,
                    onTap = { s.sheet = GuideSheet },
                )
            Column(
                Modifier.weight(1f).padding(start = 8.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    if (auth || s.route == "home") "捞捞课程表" else routeTitle(s.route),
                    style = LaoType.cell,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                AnimatedVisibility(
                    !scrolled && s.route == "home",
                    enter = fadeIn(),
                    exit = fadeOut(),
                ) {
                    Text("把校园日常，安排刚刚好", style = LaoType.label, color = c.onSurfaceVariant)
                }
            }
            if (!auth) {
                LaoIconButton(Icons.Rounded.Search, "搜索课程与记录") { s.sheet = SearchSheet }
                when (s.route) {
                    "home" -> {
                        val count =
                            CampusGuide.ranked(s.a).count { !it.course && it.minutes <= 24 * 60 }
                        Box {
                            LaoIconButton(Icons.Rounded.NotificationsNone, "查看重要安排") {
                                s.sheet = AlertsSheet
                            }
                            if (count > 0)
                                Box(
                                    Modifier.align(Alignment.TopEnd)
                                        .padding(top = 10.dp, end = 10.dp)
                                        .size(6.dp)
                                        .background(CampusStatus.warning(), CircleShape)
                                )
                        }
                    }
                    "tools" ->
                        LaoIconButton(Icons.Rounded.Tune, "快捷选择工具") { s.sheet = ToolPickerSheet }
                    "calendar" ->
                        LaoIconButton(Icons.Rounded.MoreHoriz, "日历更多选项") {
                            CampusSchool.calendarOptions(s.a)
                        }
                    "wall" -> LaoIconButton(Icons.Rounded.Settings, "我的班级与成员管理") { s.open("class") }
                    "me" -> LaoIconButton(Icons.Rounded.Settings, "账号与外观设置") { s.open("settings") }
                    "phone" -> LaoIconButton(Icons.Rounded.Tune, "打开设置") { s.open("settings") }
                    "credits" ->
                        LaoIconButton(Icons.Rounded.Refresh, "刷新贡献名单") { refreshCredits(s) }
                    "settings",
                    "permissions" ->
                        LaoIconButton(Icons.Rounded.PersonOutline, "返回我的") { s.open("me") }
                    else ->
                        LaoMascot(
                            Modifier.size(36.dp),
                            expressive = false,
                            onTap = { s.sheet = GuideSheet },
                        )
                }
            }
        }
        val line by
            animateFloatAsState(
                if (scrolled) .65f else 0f,
                if (LocalMotionEnabled.current) tween(180) else snap(),
                label = "scroll separator",
            )
        Box(Modifier.fillMaxWidth().height(1.dp).background(c.outlineVariant.copy(alpha = line)))
    }
}

@Composable
internal fun LaoNavigationDock(
    s: CampusSession,
    current: String,
    scrolled: Boolean,
    choose: (String) -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val motion = LocalMotionEnabled.current
    val labels = listOf("首页", "日历", "班级", "工具", "我的")
    val dark = c.background.luminance() < .3f
    val sourceAlpha by
        animateFloatAsState(
            if (scrolled) .64f else .79f,
            if (motion) tween(200) else snap(),
            label = "dock glass",
        )
    BoxWithConstraints(
        Modifier.navigationBarsPadding()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .widthIn(max = 600.dp)
            .fillMaxWidth()
            .shadow(
                12.dp,
                CircleShape,
                false,
                ambientColor = Color.Black.copy(alpha = .06f),
                spotColor = c.onSurface.copy(alpha = .12f),
            )
            .clip(CircleShape)
            .background(
                Brush.verticalGradient(
                    listOf(
                        c.surface.copy(alpha = sourceAlpha),
                        c.surface.copy(alpha = sourceAlpha - .15f),
                    )
                )
            )
            .border(
                1.dp,
                Brush.verticalGradient(
                    listOf(
                        Color.White.copy(alpha = if (dark) .22f else .95f),
                        c.outlineVariant.copy(alpha = .35f),
                    )
                ),
                CircleShape,
            )
            .semantics { contentDescription = "通透圆角导航" }
    ) {
        val cell = maxWidth / MainRoutes.size
        val position by
            animateFloatAsState(
                MainRoutes.indexOf(current).coerceAtLeast(0).toFloat(),
                if (motion) spring(.86f, 380f) else snap(),
                label = "custom dock spring",
            )
        Box(
            Modifier.offset(x = cell * position + (cell - 42.dp) / 2, y = 8.dp)
                .size(42.dp)
                .background(c.primary.copy(alpha = if (dark) .24f else .09f), CircleShape)
        )
        Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
            MainRoutes.forEachIndexed { i, route ->
                val on = route == current
                val source = remember { MutableInteractionSource() }
                val tint by
                    animateColorAsState(
                        if (on) c.onSurface else c.onSurfaceVariant,
                        if (motion) tween(160) else snap(),
                        label = "dock icon",
                    )
                Column(
                    Modifier.weight(1f)
                        .heightIn(min = 56.dp)
                        .springPress(source)
                        .clip(CircleShape)
                        .clickable(source, null, role = Role.Tab) { choose(route) }
                        .semantics {
                            selected = on
                            contentDescription = "导航到" + labels[i]
                        },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                        LaoGlyph(route, on, tint, Modifier.size(24.dp))
                    }
                    Text(labels[i], style = LaoType.label, color = tint)
                }
            }
        }
    }
}

@Composable
internal fun LaoFloatingTools(s: CampusSession, modifier: Modifier = Modifier) {
    val c = MaterialTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    val haptic = androidx.compose.ui.platform.LocalHapticFeedback.current
    Box(
        modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            .padding(start = 16.dp, end = 24.dp, bottom = 112.dp)
    ) {
        Box(
            Modifier.align(Alignment.CenterEnd)
                .size(56.dp)
                .springPress(source)
                .shadow(8.dp, CircleShape, false)
                .clip(CircleShape)
                .background(
                    Brush.linearGradient(listOf(c.onSurface, lerp(c.onSurface, c.primary, .32f)))
                )
                .border(1.dp, Color.White.copy(alpha = .2f), CircleShape)
                .clickable(source, null, role = Role.Button) {
                    haptic.performHapticFeedback(
                        androidx.compose.ui.hapticfeedback.HapticFeedbackType.TextHandleMove
                    )
                    s.sheet = QuickAddSheet
                }
                .semantics { contentDescription = "打开快捷操作" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Add, null, Modifier.size(28.dp), tint = c.surface)
        }
        if (s.route !in listOf("home", "ask") && CampusGuide.enabled(s.a))
            LaoMascot(
                Modifier.align(Alignment.CenterStart).size(48.dp).semantics {
                    contentDescription = "查看捞捞提醒"
                },
                onTap = { s.sheet = GuideSheet },
            )
    }
}
