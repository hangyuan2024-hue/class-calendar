package com.laolao.classcalendar

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.*
import androidx.core.view.WindowCompat
import kotlinx.coroutines.launch

internal val MainRoutes = listOf("home", "calendar", "wall", "tools", "me")

internal val LocalPageListState = staticCompositionLocalOf<LazyListState?> { null }

private fun mainDestination(route: String) =
    when (route) {
        "ask" -> "home"
        "wall",
        "rank",
        "class",
        "groups",
        "members",
        "people",
        "class-features" -> "wall"
        "home" -> "home"
        "calendar",
        "homework",
        "courses",
        "ocr-review",
        "parse-review" -> "calendar"
        "growth",
        "farm",
        "meta",
        "report",
        "cards",
        "review" -> "tools"
        "me",
        "appearance",
        "home-layout",
        "backup",
        "security",
        "settings",
        "permissions",
        "mail",
        "login",
        "register",
        "about",
        "intro",
        "credits",
        "user",
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
        "settings" -> "设置"
        "permissions" -> "应用权限"
        "phone" -> "手机助手"
        "credits" -> "校园共建者"
        "growth" -> "成长"
        "ask" -> "AI 助手"
        "wall" -> "班级墙"
        "rank" -> "班级排行榜"
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
        val keyboardVisible = campusKeyboardVisible()
        val savedPages = rememberSaveableStateHolder()
        val listStates = remember { mutableMapOf<String, LazyListState>() }
        val activeList = listStates.getOrPut(state.route) { LazyListState() }
        val scrolled by
            remember(activeList) {
                derivedStateOf {
                    activeList.firstVisibleItemIndex > 0 ||
                        activeList.firstVisibleItemScrollOffset > 32
                }
            }
        val scope = rememberCoroutineScope()
        LaoWindowAppearance(state, colors)
        val snackbar = remember { SnackbarHostState() }
        LaunchedEffect(state.notice) {
            if (state.notice.isNotBlank()) {
                val text = state.notice
                snackbar.showSnackbar(text)
                if (state.notice == text) state.notice = ""
            }
        }
        BackHandler { if (state.sheet != null) state.closeSheet() else state.a.onBackPressed() }
        Box(Modifier.fillMaxSize().background(colors.background)) {
            Box(
                Modifier.matchParentSize()
                    .then(if (state.sheet != null) Modifier.clearAndSetSemantics {} else Modifier)
            ) {
                CampusBackdrop(Modifier.matchParentSize())
                Scaffold(
                    containerColor = Color.Transparent,
                    contentColor = colors.onBackground,
                    topBar = { LaoTopBar(state, scrolled) },
                    bottomBar = { if (state.route == "parse-review") ImportReviewActions(state) },
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
                                        MainRoutes.indexOf(targetState) <
                                            MainRoutes.indexOf(initialState)
                                )
                                    -1
                                else 1
                            if (motionEnabled)
                                (fadeIn(tween(280)) +
                                        slideInHorizontally(
                                            spring(dampingRatio = .86f, stiffness = 320f)
                                        ) {
                                            direction * it / 18
                                        } +
                                        scaleIn(
                                            spring(dampingRatio = .9f, stiffness = 340f),
                                            initialScale = .992f,
                                        ))
                                    .togetherWith(fadeOut(tween(130)))
                            else EnterTransition.None.togetherWith(ExitTransition.None)
                        },
                    ) { route ->
                        // Skip obsolete outgoing snapshots; each route has an independent scroll
                        // state.
                        savedPages.SaveableStateProvider(route) {
                            CompositionLocalProvider(
                                LocalPageListState provides
                                    listStates.getOrPut(route) { LazyListState() }
                            ) {
                                Box(
                                    Modifier.fillMaxSize(),
                                    contentAlignment = Alignment.TopCenter,
                                ) {
                                    Box(Modifier.widthIn(max = 680.dp).fillMaxSize()) {
                                        key(route) { ModernPages.Page(state, route) }
                                    }
                                }
                            }
                        }
                    }
                }
                // This layer overlays the actual scroll content. No Scaffold bottom-bar slot
                // or opaque wrapper remains behind the pill, so its corners stay transparent.
                val chrome =
                    state.route !in listOf("login", "register", "parse-review", "ask") &&
                        !keyboardVisible
                if (chrome)
                    Box(
                        Modifier.align(Alignment.BottomCenter)
                            .fillMaxWidth()
                            .height(176.dp)
                            .background(
                                Brush.verticalGradient(
                                    listOf(
                                        Color.Transparent,
                                        colors.background.copy(alpha = .62f),
                                        colors.background.copy(alpha = .95f),
                                    )
                                )
                            )
                    )
                AnimatedVisibility(
                    visible = chrome,
                    modifier = Modifier.align(Alignment.BottomCenter),
                    enter =
                        if (motionEnabled)
                            fadeIn(tween(180)) +
                                slideInVertically(spring(dampingRatio = .9f, stiffness = 420f)) {
                                    it / 2
                                }
                        else EnterTransition.None,
                    exit =
                        if (motionEnabled)
                            fadeOut(tween(100)) + slideOutVertically(tween(160)) { it / 2 }
                        else ExitTransition.None,
                ) {
                    LaoNavigationDock(state, mainDestination(state.route), scrolled) { route ->
                        if (state.route == route)
                            scope.launch { listStates[route]?.animateScrollToItem(0) }
                        else state.a.tab(route)
                    }
                }
                if (chrome) LaoFloatingTools(state, Modifier.align(Alignment.BottomEnd))
            }
            CampusSheets(state)
        }
    }
}

/** The page and its sheets share one native edge-to-edge canvas on every API level. */
@Composable
private fun LaoWindowAppearance(state: CampusSession, colors: ColorScheme) {
    SideEffect {
        val window = state.a.window
        if (
            window.attributes.flags and
                android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS == 0
        ) {
            window.addFlags(
                android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS
            )
        }
        window.decorView.setBackgroundColor(colors.background.toArgb())
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = colors.background.luminance() > .5f
            isAppearanceLightNavigationBars = colors.background.luminance() > .5f
        }
    }
}

internal fun LazyListScope.animatedItem(
    index: Int = 0,
    key: String? = null,
    content: @Composable () -> Unit,
) {
    item(key = key) {
        Entrance(
            index,
            if (LocalMotionEnabled.current)
                Modifier.animateItem(placementSpec = spring(dampingRatio = .88f, stiffness = 340f))
            else Modifier,
        ) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                content()
            }
        }
    }
}

@Composable
internal fun PageList(content: LazyListScope.() -> Unit) =
    LaoPage(spacing = 16.dp, content = content)

@Composable
internal fun EmptyState(
    title: String,
    body: String,
    action: String? = null,
    onClick: () -> Unit = {},
) = LaoEmpty(title, body, action, onClick)
