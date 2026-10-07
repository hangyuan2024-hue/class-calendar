package com.laolao.classcalendar

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.*
import androidx.core.view.WindowCompat
import kotlinx.coroutines.launch

internal val MainRoutes = listOf("home", "calendar", "growth", "tools", "me")

private val LocalPageListState = staticCompositionLocalOf<LazyListState?> { null }

private fun mainDestination(route: String) =
    when (route) {
        "home" -> "home"
        "calendar",
        "homework",
        "courses",
        "ocr-review",
        "parse-review" -> "calendar"
        "growth",
        "farm",
        "meta",
        "rank",
        "report",
        "cards",
        "review" -> "growth"
        "me",
        "appearance",
        "home-layout",
        "backup",
        "security",
        "mail",
        "login",
        "register",
        "about",
        "intro",
        "credits",
        "class",
        "groups",
        "members",
        "people",
        "user",
        "class-features",
        "admin",
        "admin-users",
        "admin-plugins",
        "admin-features",
        "admin-perms",
        "intro-edit",
        "draft-code" -> "me"
        else -> "tools"
    }

internal fun routeTitle(route: String): String =
    when (route) {
        "home" -> "捞捞课程表"
        "calendar" -> "日历"
        "homework" -> "我的作业"
        "tools" -> "工具"
        "me" -> "我的"
        "growth" -> "成长"
        "wall" -> "班级墙"
        "appearance" -> "外观与配色"
        "home-layout" -> "首页卡片"
        "class" -> "我的班级"
        "parse-review" -> "核对导入内容"
        "login" -> "登录"
        "register" -> "注册"
        "backup" -> "数据与同步"
        "security" -> "账号安全"
        "mail" -> "邮箱通知"
        "about" -> "关于捞捞课程表"
        "people" -> "班级成员"
        else ->
            CampusToolbox.ITEMS.find { it[0] == route }?.get(1)
                ?: when (route) {
                    "groups" -> "班级分组"
                    "members" -> "成员管理"
                    "class-features" -> "班级功能"
                    "ocr-review" -> "核对课程识别"
                    "admin" -> "管理工作台"
                    "admin-users" -> "用户管理"
                    "admin-features" -> "功能管理"
                    "admin-perms" -> "权限管理"
                    "admin-plugins" -> "插件管理"
                    "intro-edit" -> "编辑介绍"
                    "draft-code" -> "插件代码"
                    "user" -> "同学主页"
                    else -> "捞捞课程表"
                }
    }

@OptIn(ExperimentalMaterial3Api::class, ExperimentalAnimationApi::class)
@Composable
internal fun LaoLaoApp(state: CampusSession) {
    LaoLaoTheme(state) {
        val colors = MaterialTheme.colorScheme
        val motionEnabled = LocalMotionEnabled.current
        val savedPages = rememberSaveableStateHolder()
        val listStates = remember { mutableMapOf<String, LazyListState>() }
        val scope = rememberCoroutineScope()
        SideEffect {
            state.a.window.statusBarColor = colors.background.toArgb()
            state.a.window.navigationBarColor = colors.surface.toArgb()
            WindowCompat.getInsetsController(state.a.window, state.a.window.decorView).apply {
                isAppearanceLightStatusBars = colors.background.luminance() > .5f
                isAppearanceLightNavigationBars = colors.surface.luminance() > .5f
            }
        }
        val snackbar = remember { SnackbarHostState() }
        LaunchedEffect(state.notice) {
            if (state.notice.isNotBlank()) {
                val text = state.notice
                snackbar.showSnackbar(text)
                if (state.notice == text) state.notice = ""
            }
        }
        BackHandler { if (state.sheet != null) state.closeSheet() else state.a.onBackPressed() }
        Scaffold(
            containerColor = colors.background,
            topBar = {
                Column(Modifier.background(colors.background).statusBarsPadding()) {
                    Row(
                        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (state.route !in MainRoutes)
                            PressIcon(Icons.AutoMirrored.Rounded.ArrowBack, "返回") {
                                state.a.onBackPressed()
                            }
                        else if (state.route == "home") LaoMascot(Modifier.size(48.dp))
                        Column(
                            Modifier.weight(1f).padding(start = 8.dp),
                            verticalArrangement = Arrangement.spacedBy(0.dp),
                        ) {
                            Text(
                                routeTitle(state.route),
                                style = MaterialTheme.typography.titleLarge,
                            )
                            if (state.route == "home")
                                Text(
                                    "把校园日常，安排从容。",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.onSurfaceVariant,
                                )
                        }
                        PressIcon(Icons.Rounded.Search, "搜索课程与记录") { state.open("search") }
                        if (state.route == "home")
                            PressIcon(Icons.Rounded.AutoAwesome, "打开捞捞助手") {
                                state.sheet = GuideSheet
                            }
                        else {
                            val interaction = remember {
                                androidx.compose.foundation.interaction.MutableInteractionSource()
                            }
                            IconButton(
                                onClick = { state.sheet = GuideSheet },
                                interactionSource = interaction,
                                modifier =
                                    Modifier.size(48.dp).springPress(interaction).semantics {
                                        contentDescription = "打开捞捞助手"
                                    },
                            ) {
                                LaoMascot(Modifier.size(32.dp))
                            }
                        }
                    }
                }
            },
            bottomBar = {
                if (state.route == "parse-review") ImportReviewActions(state)
                else
                    NavigationBar(containerColor = colors.surface, tonalElevation = 0.dp) {
                        MainRoutes.forEachIndexed { index, route ->
                            val selected = mainDestination(state.route) == route
                            val interaction = remember {
                                androidx.compose.foundation.interaction.MutableInteractionSource()
                            }
                            NavigationBarItem(
                                selected = selected,
                                onClick = {
                                    if (state.route == route)
                                        scope.launch { listStates[route]?.animateScrollToItem(0) }
                                    else state.a.tab(route)
                                },
                                interactionSource = interaction,
                                modifier = Modifier.springPress(interaction),
                                icon = { Icon(routeIcon(route), null, Modifier.size(24.dp)) },
                                label = { Text(listOf("首页", "日历", "成长", "工具", "我的")[index]) },
                                colors =
                                    NavigationBarItemDefaults.colors(
                                        indicatorColor = colors.primaryContainer
                                    ),
                            )
                        }
                    }
            },
            floatingActionButton = {
                if (state.route == "home" || state.route == "calendar") {
                    val source = remember {
                        androidx.compose.foundation.interaction.MutableInteractionSource()
                    }
                    FloatingActionButton(
                        onClick = {
                            if (state.route == "calendar") CampusSchool.personalForm(state.a, null)
                            else state.sheet = QuickAddSheet
                        },
                        interactionSource = source,
                        modifier = Modifier.springPress(source),
                        containerColor = colors.primary,
                        contentColor = colors.onPrimary,
                        shape = RoundedCornerShape(24.dp),
                    ) {
                        Icon(Icons.Rounded.Add, "记一件事")
                    }
                } else if (state.route == "tools")
                    FloatingActionButton(
                        onClick = { state.sheet = ToolPickerSheet },
                        containerColor = colors.primaryContainer,
                        shape = RoundedCornerShape(24.dp),
                    ) {
                        Icon(Icons.Rounded.FavoriteBorder, "选择常用工具")
                    }
            },
            snackbarHost = { SnackbarHost(snackbar) },
        ) { padding ->
            AnimatedContent(
                targetState = state.route,
                modifier = Modifier.padding(padding).fillMaxSize(),
                label = "page transition",
                transitionSpec = {
                    val direction =
                        if (targetState in MainRoutes && initialState !in MainRoutes) -1
                        else if (
                            targetState in MainRoutes &&
                                initialState in MainRoutes &&
                                MainRoutes.indexOf(targetState) < MainRoutes.indexOf(initialState)
                        )
                            -1
                        else 1
                    if (motionEnabled)
                        (fadeIn(tween(220)) +
                                slideInHorizontally(spring(dampingRatio = .9f, stiffness = 360f)) {
                                    direction * it / 12
                                })
                            .togetherWith(fadeOut(tween(100)))
                    else EnterTransition.None.togetherWith(ExitTransition.None)
                },
            ) { route ->
                // Skip obsolete outgoing snapshots; each route has an independent scroll state.
                savedPages.SaveableStateProvider(route) {
                    CompositionLocalProvider(
                        LocalPageListState provides listStates.getOrPut(route) { LazyListState() }
                    ) {
                        key(route) { ModernPages.Page(state, route) }
                    }
                }
            }
        }
        CampusSheets(state)
    }
}

internal fun LazyListScope.animatedItem(
    index: Int = 0,
    key: String? = null,
    content: @Composable () -> Unit,
) {
    item(key = key) { Entrance(index) { content() } }
}

@Composable
internal fun PageList(content: LazyListScope.() -> Unit) {
    val gutter = if (LocalConfiguration.current.screenWidthDp < 360) 16.dp else 24.dp
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        state = LocalPageListState.current ?: rememberLazyListState(),
        contentPadding = PaddingValues(start = gutter, end = gutter, top = 16.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        content = content,
    )
}

@Composable
internal fun EmptyState(
    title: String,
    body: String,
    action: String? = null,
    onClick: () -> Unit = {},
) {
    PremiumCard(Modifier.fillMaxWidth(), tint = MaterialTheme.colorScheme.surfaceContainerLow) {
        Icon(
            Icons.Rounded.CheckCircleOutline,
            null,
            Modifier.size(32.dp),
            tint = MaterialTheme.colorScheme.primary,
        )
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(
            body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (action != null) SoftButton(action, onClick = onClick)
    }
}
