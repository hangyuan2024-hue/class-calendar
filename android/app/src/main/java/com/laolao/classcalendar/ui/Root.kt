package com.laolao.classcalendar.ui

import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.laolao.classcalendar.data.Repo
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Changes whenever local data changes, so screens re-read the repo. */
val LocalTick = compositionLocalOf { 0 }
val LocalRepo = staticCompositionLocalOf<Repo> { error("no repo") }
val LocalNav = staticCompositionLocalOf<NavHostController> { error("no nav") }
val LocalSnack = staticCompositionLocalOf<(String) -> Unit> { {} }

data class Tab(val route: String, val label: String, val icon: ImageVector)
val TABS = listOf(
    Tab("home", "首页", Icons.Rounded.Home), Tab("calendar", "日历", Icons.Rounded.CalendarMonth),
    Tab("class", "班级", Icons.Rounded.Groups), Tab("tools", "工具", Icons.Rounded.Apps), Tab("me", "我的", Icons.Rounded.Person),
)

val TITLES = mapOf(
    "courses" to "课程表", "todos" to "全部待办", "devices" to "登录设备", "appearance" to "外观与配色",
    "sync" to "数据与同步", "permissions" to "提醒与后台", "pomodoro" to "番茄专注", "countdown" to "倒数日",
    "credits" to "校园共建者", "rank" to "班级排行榜", "about" to "关于捞捞课程表", "account" to "账号与安全",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LaoRoot(repo: Repo) {
    val store by repo.store.collectAsState()
    val tick by store.version.collectAsState()
    val logged by repo.logged.collectAsState()
    val error by repo.error.collectAsState()
    val palId = repo.pref("palette", "web")
    val webPal = store.get("ui_palette_v1")?.toString().orEmpty()
    val palette = PALETTES.firstOrNull { it.id == if (palId == "web") webPal else palId } ?: PALETTES[0]
    val snack = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(error) { error?.let { snack.showSnackbar(it); repo.clearError() } }

    LaoTheme(palette, repo.pref("dark", "system")) {
        CompositionLocalProvider(LocalTick provides tick, LocalRepo provides repo,
            LocalSnack provides { m: String -> scope.launch { snack.showSnackbar(m) } }) {
            if (!logged) { AuthScreen(); SnackbarHost(snack); return@CompositionLocalProvider }
            val nav = rememberNavController()
            val entry by nav.currentBackStackEntryAsState()
            val route = entry?.destination?.route ?: "home"
            val isTab = TABS.any { it.route == route }
            // Quiet auto refresh every minute while visible, so pages never need a manual refresh.
            LifecycleResumeEffect(Unit) {
                val job = scope.launch { while (true) { delay(60_000); repo.refresh(quiet = true) } }
                onPauseOrDispose { job.cancel() }
            }
            CompositionLocalProvider(LocalNav provides nav) {
                Scaffold(
                    containerColor = MaterialTheme.colorScheme.background,
                    snackbarHost = { SnackbarHost(snack) },
                    topBar = {
                        if (!isTab) TopAppBar(
                            title = { Text(TITLES[route] ?: "") },
                            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Rounded.ArrowBack, "返回") } },
                            colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
                        )
                    },
                    bottomBar = {
                        if (isTab) NavigationBar(containerColor = MaterialTheme.colorScheme.surface, tonalElevation = 0.dp) {
                            TABS.forEach { t ->
                                NavigationBarItem(selected = route == t.route, onClick = {
                                    if (route != t.route) nav.navigate(t.route) { popUpTo("home") { saveState = true }; launchSingleTop = true; restoreState = true }
                                }, icon = { Icon(t.icon, null) }, label = { Text(t.label) })
                            }
                        }
                    },
                    floatingActionButton = { QuickFab(route) },
                ) { pad ->
                    NavHost(nav, "home", Modifier.padding(pad).consumeWindowInsets(pad),
                        enterTransition = { fadeIn() }, exitTransition = { fadeOut() }) {
                        composable("home") { HomeScreen() }
                        composable("calendar") { CalendarScreen() }
                        composable("class") { ClassScreen() }
                        composable("tools") { ToolsScreen() }
                        composable("me") { MeScreen() }
                        composable("courses") { CoursesScreen() }
                        composable("todos") { TodosScreen() }
                        composable("devices") { DevicesScreen() }
                        composable("appearance") { AppearanceScreen() }
                        composable("sync") { SyncScreen() }
                        composable("permissions") { PermissionsScreen() }
                        composable("pomodoro") { PomodoroScreen() }
                        composable("countdown") { CountdownScreen() }
                        composable("credits") { CreditsScreen() }
                        composable("rank") { RankScreen() }
                        composable("about") { AboutScreen() }
                        composable("account") { AccountScreen() }
                    }
                }
            }
        }
    }
}

/** Bottom-right "+" whose actions depend on the current page. */
@Composable
fun QuickFab(route: String) {
    var open by remember { mutableStateOf(false) }
    var editor by remember { mutableStateOf<String?>(null) }
    val nav = LocalNav.current
    val actions: List<Pair<String, () -> Unit>> = when (route) {
        "home", "calendar", "todos" -> listOf("新建待办 / 日程" to { editor = "event" }, "添加课程" to { editor = "course" }, "开始专注" to { nav.navigate("pomodoro") })
        "courses" -> listOf("添加课程" to { editor = "course" }, "修改作息时间" to { editor = "meta" })
        "class" -> listOf("创建班级 / 团队" to { editor = "create" }, "用班级码加入" to { editor = "join" })
        "countdown" -> listOf("新建倒数日" to { editor = "event" })
        else -> emptyList()
    }
    if (actions.isEmpty()) return
    FloatingActionButton(onClick = { if (actions.size == 1) actions[0].second() else open = true }, containerColor = MaterialTheme.colorScheme.primary) {
        Icon(Icons.Rounded.Add, "快捷操作")
        DropdownMenu(open, { open = false }) {
            actions.forEach { (label, act) -> DropdownMenuItem(text = { Text(label) }, onClick = { open = false; act() }) }
        }
    }
    when (editor) {
        "event" -> EventEditor(null) { editor = null }
        "course" -> CourseEditor(null) { editor = null }
        "meta" -> MetaEditor { editor = null }
        "create" -> ClassDialog(create = true) { editor = null }
        "join" -> ClassDialog(create = false) { editor = null }
    }
}
