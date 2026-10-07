package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import org.json.JSONObject


@Composable
internal fun CampusPage2026(s: CampusSession, route: String) {
    when (route) {
        "home" -> CampusHomePage2026(s)
        "me" -> CampusProfilePage2026(s)
        "wall" -> CampusWallPage2026(s)
        "rank" -> CampusRankPage2026(s)
        "login",
        "register" -> CampusAuthPage2026(s)
        else -> ModernPages.Page(s, route)
    }
}

/**
 * Modern mobile experience for LaoLao Course Schedule.
 * AI is an assistant/mascot, not a primary navigation destination.
 */
@Composable
internal fun CampusBottomBar2026(
    s: CampusSession,
    current: String,
    choose: (String) -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val routes = listOf("home", "calendar", "wall", "tools", "me")
    val labels = listOf("首页", "日历", "班级", "工具", "我的")
    val icons =
        listOf(
            Icons.Outlined.Home,
            Icons.Outlined.CalendarMonth,
            Icons.AutoMirrored.Rounded.Chat,
            Icons.Outlined.Widgets,
            Icons.Outlined.PersonOutline,
        )
    val activeIcons =
        listOf(
            Icons.Rounded.Home,
            Icons.Rounded.CalendarMonth,
            Icons.AutoMirrored.Rounded.Chat,
            Icons.Rounded.Widgets,
            Icons.Rounded.Person,
        )

    Box(
        Modifier.fillMaxWidth()
            .navigationBarsPadding()
            .height(96.dp)
            .padding(horizontal = 12.dp)
    ) {
        Surface(
            modifier =
                Modifier.align(Alignment.BottomStart)
                    .fillMaxWidth()
                    .padding(end = 68.dp)
                    .height(66.dp),
            shape = RoundedCornerShape(33.dp),
            color = c.surface.copy(alpha = .86f),
            contentColor = c.onSurface,
            tonalElevation = 0.dp,
            shadowElevation = 14.dp,
            border = BorderStroke(1.dp, c.outlineVariant.copy(alpha = .55f)),
        ) {
            Row(
                Modifier.fillMaxSize().padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                routes.forEachIndexed { index, route ->
                    val selected = current == route
                    val source = remember { MutableInteractionSource() }
                    Column(
                        Modifier.weight(1f)
                            .fillMaxHeight()
                            .springPress(source)
                            .clickable(source, null, role = Role.Tab) { choose(route) }
                            .semantics {
                                this.selected = selected
                                contentDescription = "导航到${labels[index]}"
                            },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Surface(
                            modifier = Modifier.size(38.dp),
                            shape = CircleShape,
                            color =
                                if (selected) c.primary.copy(alpha = .12f)
                                else Color.Transparent,
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(
                                    if (selected) activeIcons[index] else icons[index],
                                    null,
                                    Modifier.size(21.dp),
                                    tint = if (selected) c.primary else c.onSurfaceVariant,
                                )
                            }
                        }
                        Spacer(Modifier.height(2.dp))
                        Text(
                            labels[index],
                            style = MaterialTheme.typography.labelSmall,
                            color = if (selected) c.primary else c.onSurfaceVariant,
                            maxLines = 1,
                        )
                    }
                }
            }
        }

        FloatingActionButton(
            onClick = { s.sheet = QuickAddSheet },
            modifier = Modifier.align(Alignment.BottomEnd).size(56.dp),
            shape = CircleShape,
            containerColor = c.primary,
            contentColor = c.onPrimary,
            elevation =
                FloatingActionButtonDefaults.elevation(
                    defaultElevation = 10.dp,
                    pressedElevation = 4.dp,
                ),
        ) {
            Icon(Icons.Rounded.Add, "快捷操作", Modifier.size(26.dp))
        }
    }
}

@Composable
internal fun CampusHomePage2026(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val today = DateMath.today()
    val courses = CampusCourses.onDay(a.store, today)
    val pending =
        visibleTasks(a)
            .filter { !a.done(it) }
            .sortedBy { it.optString("event_time", "9999") }
    val todayTasks = pending.filter { taskDate(it) == today }
    val next = CampusGuide.nextCourse(a)
    val ranked = CampusGuide.ranked(a)
    val nudge = ranked.firstOrNull()
    val wall =
        CampusJson.rows(a.store.list("cache_wall"))
            .filter {
                !it.optBoolean("hidden") ||
                    CampusSocial.moderator(a) ||
                    it.optString("author_id") == a.api.uid()
            }
            .sortedWith(
                compareByDescending<JSONObject> {
                    !it.isNull("pinned_at") && it.optString("pinned_at").isNotBlank()
                }.thenByDescending { it.optString("created_at") }
            )
    val rankRows = rankRows2026(a)
    val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
    val greeting =
        when {
            hour < 6 -> "夜深了"
            hour < 12 -> "早上好"
            hour < 18 -> "下午好"
            else -> "晚上好"
        }
    val name = if (a.api.logged()) a.me.optString("display_name", "同学") else "同学"

    PageList {
        animatedItem(0, "modern-greeting") {
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        dateLabel(today),
                        style = MaterialTheme.typography.labelMedium,
                        color = c.onSurfaceVariant,
                    )
                    Text(
                        "$greeting，$name",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                Surface(
                    modifier = Modifier.size(44.dp).clickable { s.open("me") },
                    shape = CircleShape,
                    color = c.primaryContainer.copy(alpha = .7f),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            name.take(1),
                            style = MaterialTheme.typography.titleMedium,
                            color = c.primary,
                        )
                    }
                }
            }
        }

        animatedItem(1, "mascot-nudge") {
            ProductSurface(
                Modifier.fillMaxWidth(),
                color = c.surfaceContainerLow.copy(alpha = .88f),
                padding = 12.dp,
                onClick = { s.sheet = GuideSheet },
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    LaoMascot(
                        Modifier.size(48.dp).semantics { contentDescription = "捞捞提醒小人" },
                        expressive = false,
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            "捞捞提醒",
                            style = MaterialTheme.typography.labelMedium,
                            color = CampusStatus.ai(),
                        )
                        Text(
                            nudge?.let { "${it.title} · ${it.reason}" }
                                ?: next?.let { "${it.title} · ${it.time} ${it.location}" }
                                ?: "今天节奏很轻松，有事随时叫我。",
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Icon(
                        Icons.Rounded.ChevronRight,
                        null,
                        Modifier.size(20.dp),
                        tint = c.onSurfaceVariant,
                    )
                }
            }
        }

        animatedItem(2, "today-snapshot") {
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ProductSurface(
                    Modifier.weight(1f).fillMaxHeight(),
                    color = c.primary,
                    padding = 16.dp,
                    onClick = { s.open("courses") },
                ) {
                    Text(
                        if (next?.day == today) "下一节课" else "课程",
                        style = MaterialTheme.typography.labelMedium,
                        color = c.onPrimary.copy(alpha = .74f),
                    )
                    Text(
                        next?.time ?: "${courses.size} 节",
                        style = MaterialTheme.typography.headlineSmall,
                        color = c.onPrimary,
                    )
                    Text(
                        next?.title ?: if (courses.isEmpty()) "今天无课" else "查看今日课表",
                        style = MaterialTheme.typography.titleSmall,
                        color = c.onPrimary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        next?.location?.ifBlank { "教室待确认" }
                            ?: "给自己留一点自由时间",
                        style = MaterialTheme.typography.bodySmall,
                        color = c.onPrimary.copy(alpha = .72f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                ProductSurface(
                    Modifier.weight(1f).fillMaxHeight(),
                    color = c.tertiaryContainer.copy(alpha = .82f),
                    padding = 16.dp,
                    onClick = { s.open("homework") },
                ) {
                    Text(
                        "待办",
                        style = MaterialTheme.typography.labelMedium,
                        color = c.onSurfaceVariant,
                    )
                    Text(
                        "${pending.size}",
                        style = MaterialTheme.typography.headlineSmall,
                        color = c.onSurface,
                    )
                    Text(
                        if (todayTasks.isEmpty()) "今天没有截止项"
                        else "${todayTasks.size} 项今天要处理",
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 2,
                    )
                    Text(
                        pending.firstOrNull()?.let { taskTitle(it) } ?: "保持这个节奏",
                        style = MaterialTheme.typography.bodySmall,
                        color = c.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }

        animatedItem(3, "agenda") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading(
                    "接下来的安排",
                    note = "${courses.size} 节课 · ${todayTasks.size} 项今日待办",
                    action = "日历",
                ) { s.open("calendar") }
                AgendaRows(s, today, limit = 4)
            }
        }

        animatedItem(4, "quick-entry") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading("常用入口", action = "全部工具") { s.open("tools") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ModernQuick("作业", "homework", s, Modifier.weight(1f))
                    ModernQuick("班级墙", "wall", s, Modifier.weight(1f))
                    ModernQuick("成长榜", "rank", s, Modifier.weight(1f))
                    ModernQuick("专注", "pomo", s, Modifier.weight(1f))
                }
            }
        }

        animatedItem(5, "wall-preview") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading(
                    "班级墙",
                    note =
                        if (a.cid().isBlank()) "加入班级后看到同学动态"
                        else a.currentClass.optString("name"),
                    action = "进入",
                ) { s.open("wall") }
                if (a.cid().isBlank()) {
                    ProductState(
                        "还没有连接班级",
                        "登录并加入班级后，通知、讨论和同学动态会出现在这里。",
                        Icons.AutoMirrored.Rounded.Chat,
                        "去连接",
                    ) {
                        s.open(if (a.api.logged()) "class" else "login")
                    }
                } else if (wall.isEmpty()) {
                    ProductSurface(
                        Modifier.fillMaxWidth(),
                        onClick = { CampusSocial.loadWall(a) },
                    ) {
                        Text("班级墙暂时安静", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "点这里刷新，或用右下角 + 发布第一条动态。",
                            style = MaterialTheme.typography.bodySmall,
                            color = c.onSurfaceVariant,
                        )
                    }
                } else {
                    ProductSurface(Modifier.fillMaxWidth()) {
                        wall.take(2).forEachIndexed { index, post ->
                            WallPreviewRow2026(s, post)
                            if (index == 0 && wall.size > 1)
                                HorizontalDivider(color = c.outlineVariant.copy(alpha = .55f))
                        }
                    }
                }
            }
        }

        animatedItem(6, "rank-preview") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading(
                    "班级成长榜",
                    note = "完成、打卡与专注都会留下成长",
                    action = "完整榜单",
                ) { s.open("rank") }
                if (rankRows.isEmpty()) {
                    ProductSurface(
                        Modifier.fillMaxWidth(),
                        color = c.primaryContainer.copy(alpha = .36f),
                        onClick = {
                            if (a.cid().isNotBlank()) CampusLearn.loadRank(a, "week")
                            else s.open(if (a.api.logged()) "class" else "login")
                        },
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Rounded.Leaderboard, null, tint = c.primary)
                            Spacer(Modifier.width(10.dp))
                            Column {
                                Text("看看班级里的坚持", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "加载本周真实成长记录",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = c.onSurfaceVariant,
                                )
                            }
                        }
                    }
                } else {
                    ProductSurface(Modifier.fillMaxWidth(), padding = 12.dp) {
                        rankRows.take(3).forEachIndexed { i, item ->
                            RankMiniRow2026(i, item)
                        }
                    }
                }
            }
        }

        animatedItem(7, "home-tail") {
            TextButton(
                onClick = { s.open("home-layout") },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(Icons.Rounded.Tune, null, Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text("调整首页内容")
            }
        }
    }
}

@Composable
private fun ModernQuick(
    label: String,
    route: String,
    s: CampusSession,
    modifier: Modifier = Modifier,
) {
    val c = MaterialTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    Column(
        modifier.springPress(source)
            .clip(RoundedCornerShape(18.dp))
            .background(c.surface)
            .border(1.dp, c.outlineVariant.copy(alpha = .7f), RoundedCornerShape(18.dp))
            .clickable(source, null) { s.open(route) }
            .padding(vertical = 12.dp, horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Surface(
            modifier = Modifier.size(36.dp),
            shape = CircleShape,
            color = c.primary.copy(alpha = .09f),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(routeIcon(route), null, Modifier.size(18.dp), tint = c.primary)
            }
        }
        Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1)
    }
}

@Composable
private fun WallPreviewRow2026(s: CampusSession, post: JSONObject) {
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().clickable { s.open("wall") }.padding(vertical = 6.dp),
        verticalAlignment = Alignment.Top,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Surface(
            modifier = Modifier.size(36.dp),
            shape = CircleShape,
            color = c.primaryContainer.copy(alpha = .65f),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text(post.optString("author_name", "同学").take(1), color = c.primary)
            }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    post.optString("author_name", "同学"),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                )
                if (post.optBoolean("is_notice"))
                    StatusPill("通知", CampusStatus.warning())
            }
            Text(
                post.optString("title").ifBlank { post.optString("body") },
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun RankMiniRow2026(index: Int, item: JSONObject) {
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            modifier = Modifier.size(30.dp),
            shape = CircleShape,
            color =
                when (index) {
                    0 -> Color(0xFFFFD66B).copy(alpha = .28f)
                    1 -> c.surfaceContainerHigh
                    2 -> Color(0xFFC8875B).copy(alpha = .18f)
                    else -> Color.Transparent
                },
        ) {
            Box(contentAlignment = Alignment.Center) {
                Text("${index + 1}", style = MaterialTheme.typography.labelMedium)
            }
        }
        Spacer(Modifier.width(10.dp))
        Text(
            item.optString("name", item.optString("display_name", "同学")),
            Modifier.weight(1f),
            style = MaterialTheme.typography.titleSmall,
        )
        Text(
            "${item.optInt("score", item.optInt("points"))}",
            style = MaterialTheme.typography.titleMedium,
            color = c.primary,
        )
    }
}

private fun rankRows2026(a: CampusActivity): List<JSONObject> {
    val cached = a.store.get("cache_rank", null)
    val obj = CampusJson.object(cached)
    val arr = obj.optJSONArray("rows")
    return if (arr != null) CampusJson.rows(arr) else CampusJson.rows(CampusJson.arr(cached))
}

@Composable
internal fun CampusProfilePage2026(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val logged = a.api.logged()
    val name = if (logged) a.me.optString("display_name", "同学") else "还没有登录"
    val account = a.me.optString("account")
    val role = if (logged) CampusActivity.roleName(a.me.optString("role")) else "本机校园空间"
    val bio =
        if (logged) a.me.optString("bio", "记录、交流、成长。")
        else "登录后连接班级、班级墙和成长榜。"
    val cover = a.me.optString("cover", "sky")
    val stats = weekStats(a)

    PageList {
        animatedItem(0, "profile-cover") {
            Box(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(30.dp))
                    .background(profileCover2026(cover))
                    .padding(22.dp)
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Surface(
                            Modifier.size(64.dp),
                            shape = CircleShape,
                            color = Color.White.copy(alpha = .9f),
                            shadowElevation = 3.dp,
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    if (logged) name.take(1) else "捞",
                                    style = MaterialTheme.typography.headlineSmall,
                                    color = c.primary,
                                )
                            }
                        }
                        Spacer(Modifier.width(14.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                name,
                                style = MaterialTheme.typography.headlineSmall,
                                color = Color(0xFF13243A),
                            )
                            Text(
                                buildString {
                                    append(role)
                                    if (account.isNotBlank()) append(" · @$account")
                                },
                                style = MaterialTheme.typography.bodySmall,
                                color = Color(0xFF31445E).copy(alpha = .78f),
                            )
                        }
                    }
                    Text(
                        bio,
                        style = MaterialTheme.typography.bodyMedium,
                        color = Color(0xFF21354D),
                    )
                    if (logged) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SoftButton("编辑主页", Modifier.weight(1f)) { CampusSocial.editProfile(a) }
                            SoftButton("我的班级", Modifier.weight(1f)) { s.open("class") }
                        }
                    } else {
                        PrimaryButton("登录 / 注册", Modifier.fillMaxWidth()) { s.open("login") }
                    }
                }
            }
        }

        if (logged)
            animatedItem(1, "profile-stats") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ProfileStat2026("本周作业", "${stats[0]}/${stats[1]}", Modifier.weight(1f))
                    ProfileStat2026("本周事项", "${stats[2]}/${stats[3]}", Modifier.weight(1f))
                    ProfileStat2026("今日打卡", "${stats[4]}/${stats[5]}", Modifier.weight(1f))
                }
            }

        animatedItem(2, "campus-social") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading("校园连接")
                ProductSurface(Modifier.fillMaxWidth()) {
                    ProductLink("班级墙", "通知、交流、同学动态", "wall", s)
                    HorizontalDivider(color = c.outlineVariant.copy(alpha = .55f))
                    ProductLink("班级成长榜", "和同学一起坚持", "rank", s)
                    HorizontalDivider(color = c.outlineVariant.copy(alpha = .55f))
                    ProductLink("我的班级", "加入、分组与成员管理", "class", s)
                    HorizontalDivider(color = c.outlineVariant.copy(alpha = .55f))
                    ProductLink("班级成员", "查看同学主页", "people", s)
                }
            }
        }

        animatedItem(3, "profile-style") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading("把 App 调成你喜欢的样子")
                ProductSurface(Modifier.fillMaxWidth()) {
                    ProductLink("外观与皮肤", "更年轻的颜色、深色模式与动效", "appearance", s)
                    HorizontalDivider(color = c.outlineVariant.copy(alpha = .55f))
                    ProductLink("编辑校园主页", "首页模块与快捷入口", "home-layout", s)
                    HorizontalDivider(color = c.outlineVariant.copy(alpha = .55f))
                    ProductLink("成长空间", "习惯、专注与学习周报", "growth", s)
                }
            }
        }

        animatedItem(4, "profile-settings") {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                SectionHeading("账号与设备")
                ProductSurface(Modifier.fillMaxWidth()) {
                    ProductLink("数据与同步", "备份、导入与账号同步", "backup", s)
                    ProductLink("手机专属能力", "扫描、录音、提醒与桌面卡片", "phone", s)
                    ProductLink("账号安全", "密码和安全设置", "security", s)
                    ProductLink("关于捞捞课程表", "AI Campus Agent", "about", s, BuildConfig.VERSION_NAME)
                }
            }
        }

        if (logged)
            animatedItem(5, "logout") {
                TextButton(
                    modifier = Modifier.fillMaxWidth(),
                    onClick = {
                        a.ui.confirm("退出账号？", "本机记录会按账号保留。") {
                            a.background(
                                "退出登录",
                                {
                                    a.api.logout()
                                    null
                                },
                                { a.recreate() },
                            )
                        }
                    },
                ) {
                    Text("退出当前账号", color = MaterialTheme.colorScheme.error)
                }
            }
    }
}

@Composable
private fun ProfileStat2026(label: String, value: String, modifier: Modifier = Modifier) {
    val c = MaterialTheme.colorScheme
    ProductSurface(modifier, color = c.surfaceContainerLow, padding = 12.dp) {
        Text(value, style = MaterialTheme.typography.titleLarge, color = c.primary)
        Text(label, style = MaterialTheme.typography.labelSmall, color = c.onSurfaceVariant)
    }
}

private fun profileCover2026(id: String): Brush =
    when (id) {
        "sakura" -> Brush.linearGradient(listOf(Color(0xFFFFD6E5), Color(0xFFFF8FB9)))
        "ocean" -> Brush.linearGradient(listOf(Color(0xFFBCEFE9), Color(0xFF8DC9FF)))
        "sunset" -> Brush.linearGradient(listOf(Color(0xFFFFE09A), Color(0xFFFFA4B7)))
        "forest" -> Brush.linearGradient(listOf(Color(0xFFCDEFC7), Color(0xFF80D1B0)))
        "galaxy" -> Brush.linearGradient(listOf(Color(0xFFD9D0FF), Color(0xFFA5B9FF)))
        "peach" -> Brush.linearGradient(listOf(Color(0xFFFFE0C2), Color(0xFFFFB4B9)))
        "mono" -> Brush.linearGradient(listOf(Color(0xFFF0F2F5), Color(0xFFDDE3EC)))
        else -> Brush.linearGradient(listOf(Color(0xFFBEE8FF), Color(0xFFC8C7FF)))
    }

@Composable
internal fun CampusAuthPage2026(s: CampusSession) {
    val a = s.a
    val signup = s.route == "register"
    val c = MaterialTheme.colorScheme
    var account by rememberSaveable(signup) { mutableStateOf("") }
    var password by rememberSaveable(signup) { mutableStateOf("") }
    var name by rememberSaveable(signup) { mutableStateOf("") }
    var role by rememberSaveable(signup) { mutableStateOf("student") }
    var gender by rememberSaveable(signup) { mutableStateOf("") }
    var showPassword by rememberSaveable { mutableStateOf(false) }

    fun submit() {
        a.background(
            if (signup) "注册" else "登录",
            {
                if (signup) {
                    a.api.register(account, password, name, role, gender)
                    null
                } else a.api.login(account, password)
            },
            { a.recreate() },
        )
    }

    PageList {
        animatedItem(0, "auth-hero") {
            Column(
                Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Surface(
                    Modifier.size(78.dp),
                    shape = CircleShape,
                    color = c.primaryContainer.copy(alpha = .5f),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        LaoMascot(Modifier.size(64.dp), expressive = false)
                    }
                }
                Text(
                    if (signup) "加入你的校园空间" else "欢迎回来",
                    style = MaterialTheme.typography.headlineMedium,
                )
                Text(
                    if (signup) "一个账号连接网页、Android 与班级数据。"
                    else "课程、作业、班级墙和成长记录都在这里。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.onSurfaceVariant,
                )
            }
        }

        animatedItem(1, "auth-tabs") {
            ProductTabs(
                listOf("登录", "注册"),
                if (signup) "注册" else "登录",
            ) { s.open(if (it == "注册") "register" else "login") }
        }

        animatedItem(2, "auth-form") {
            ProductSurface(Modifier.fillMaxWidth(), padding = 18.dp) {
                OutlinedTextField(
                    value = account,
                    onValueChange = {
                        account =
                            it.lowercase()
                                .filter { ch -> ch.isLetterOrDigit() || ch == '_' }
                                .take(20)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("账号") },
                    placeholder = { Text("3–20 位小写字母 / 数字 / _") },
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Rounded.AlternateEmail, null) },
                    shape = RoundedCornerShape(18.dp),
                )
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("密码") },
                    placeholder = { Text(if (signup) "至少 8 位" else "输入密码") },
                    singleLine = true,
                    visualTransformation =
                        if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    leadingIcon = { Icon(Icons.Rounded.Lock, null) },
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }) {
                            Icon(
                                if (showPassword) Icons.Rounded.VisibilityOff
                                else Icons.Rounded.Visibility,
                                if (showPassword) "隐藏密码" else "显示密码",
                            )
                        }
                    },
                    shape = RoundedCornerShape(18.dp),
                )

                if (signup) {
                    OutlinedTextField(
                        value = name,
                        onValueChange = { name = it.take(30) },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("姓名") },
                        singleLine = true,
                        leadingIcon = { Icon(Icons.Rounded.Badge, null) },
                        shape = RoundedCornerShape(18.dp),
                    )

                    Text("身份", style = MaterialTheme.typography.labelLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ChoiceChip2026("学生", role == "student", Modifier.weight(1f)) {
                            role = "student"
                        }
                        ChoiceChip2026("老师", role == "teacher", Modifier.weight(1f)) {
                            role = "teacher"
                        }
                    }

                    Text("性别显示", style = MaterialTheme.typography.labelLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        ChoiceChip2026("保密", gender.isBlank(), Modifier.weight(1f)) { gender = "" }
                        ChoiceChip2026("男", gender == "m", Modifier.weight(1f)) { gender = "m" }
                        ChoiceChip2026("女", gender == "f", Modifier.weight(1f)) { gender = "f" }
                    }
                }

                PrimaryButton(
                    if (signup) "创建账号" else "登录",
                    Modifier.fillMaxWidth(),
                    enabled =
                        account.length >= 3 &&
                            password.length >= if (signup) 8 else 1 &&
                            (!signup || name.isNotBlank()),
                ) { submit() }

                Text(
                    if (signup) "注册后可使用同一账号连接网页、班级和云端记录。"
                    else "账号与网页版相同，不需要重新注册。",
                    style = MaterialTheme.typography.bodySmall,
                    color = c.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ChoiceChip2026(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    click: () -> Unit,
) {
    FilterChip(
        selected = selected,
        onClick = click,
        label = { Text(label) },
        modifier = modifier.heightIn(min = 44.dp),
        leadingIcon =
            if (selected) {
                { Icon(Icons.Rounded.Check, null, Modifier.size(16.dp)) }
            } else null,
        shape = RoundedCornerShape(16.dp),
    )
}

@Composable
internal fun CampusWallPage2026(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    if (!a.api.logged() || a.cid().isBlank()) {
        PageList {
            animatedItem(0) { ProductIntro("班级墙", "通知、讨论和同学动态，重新回到主导航。") }
            animatedItem(1) {
                ProductState(
                    "先连接你的班级",
                    "登录并加入班级后，这里会显示原有班级墙的真实内容。",
                    Icons.AutoMirrored.Rounded.Chat,
                    "登录 / 班级管理",
                ) {
                    s.open(if (a.api.logged()) "class" else "login")
                }
            }
        }
        return
    }

    val posts =
        CampusJson.rows(a.store.list("cache_wall"))
            .filter {
                !it.optBoolean("hidden") ||
                    CampusSocial.moderator(a) ||
                    it.optString("author_id") == a.api.uid()
            }
            .sortedWith(
                compareByDescending<JSONObject> {
                    !it.isNull("pinned_at") && it.optString("pinned_at").isNotBlank()
                }.thenByDescending { it.optString("created_at") }
            )

    LaunchedEffect(a.cid()) {
        if (posts.isEmpty()) CampusSocial.loadWall(a)
    }

    PageList {
        animatedItem(0, "wall-heading") {
            ProductIntro(
                "班级墙",
                a.currentClass.optString("name", "你的班级动态"),
                action = "刷新",
            ) { CampusSocial.loadWall(a) }
        }
        animatedItem(1, "wall-actions") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("发布动态", Modifier.weight(1f)) { CampusSocial.post(a, null) }
                SoftButton("成长榜", Modifier.weight(1f)) { s.open("rank") }
            }
        }

        if (posts.isEmpty()) {
            animatedItem(2) {
                ProductState(
                    "这里还很安静",
                    "发一条通知、分享一段校园日常，或者刷新读取已有消息。",
                    Icons.AutoMirrored.Rounded.Chat,
                    "发布第一条",
                ) { CampusSocial.post(a, null) }
            }
        } else {
            posts.forEachIndexed { index, post ->
                animatedItem(index + 2, "wall-${post.optString("id")}") {
                    WallCard2026(s, post)
                }
            }
        }
    }
}

@Composable
private fun WallCard2026(s: CampusSession, post: JSONObject) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    ProductSurface(Modifier.fillMaxWidth(), padding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                modifier =
                    Modifier.size(40.dp).clickable {
                        CampusSocial.loadUser(a, post.optString("author_id"))
                    },
                shape = CircleShape,
                color = c.primaryContainer.copy(alpha = .58f),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(
                        post.optString("author_name", "同学").take(1),
                        style = MaterialTheme.typography.titleSmall,
                        color = c.primary,
                    )
                }
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(post.optString("author_name", "同学"), style = MaterialTheme.typography.titleSmall)
                Text(
                    CampusActivity.roleName(post.optString("author_role")) +
                        " · " +
                        post.optString("created_at").replace('T', ' ').take(16),
                    style = MaterialTheme.typography.bodySmall,
                    color = c.onSurfaceVariant,
                )
            }
            if (!post.isNull("pinned_at") && post.optString("pinned_at").isNotBlank())
                StatusPill("置顶", c.primary)
        }

        if (post.optBoolean("is_notice")) StatusPill("班级通知", CampusStatus.warning())
        if (post.optString("title").isNotBlank())
            Text(post.optString("title"), style = MaterialTheme.typography.titleLarge)
        Text(post.optString("body"), style = MaterialTheme.typography.bodyLarge)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = { CampusSocial.comments(a, post) }) {
                Icon(Icons.AutoMirrored.Rounded.Chat, null, Modifier.size(17.dp))
                Spacer(Modifier.width(6.dp))
                Text("评论 / 回复")
            }
            TextButton(onClick = { CampusSocial.postMore(a, post) }) {
                Icon(Icons.Rounded.MoreHoriz, null, Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("更多")
            }
        }
    }
}

@Composable
internal fun CampusRankPage2026(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val period = a.store.string("native_rank_period", "week")
    val rows = rankRows2026(a)

    LaunchedEffect(a.cid(), period) {
        if (a.cid().isNotBlank() && rows.isEmpty()) CampusLearn.loadRank(a, period)
    }

    PageList {
        animatedItem(0) {
            ProductIntro(
                "班级成长榜",
                "不是卷分数，而是看见每一份完成、坚持和专注。",
                action = "刷新",
            ) { CampusLearn.loadRank(a, period) }
        }
        animatedItem(1) {
            ProductTabs(listOf("本周", "全部"), if (period == "all") "全部" else "本周") {
                CampusLearn.loadRank(a, if (it == "全部") "all" else "week")
            }
        }
        if (rows.isEmpty()) {
            animatedItem(2) {
                ProductState(
                    "暂时没有成长记录",
                    "完成作业、习惯和专注后再来看看。",
                    Icons.Rounded.Leaderboard,
                    "刷新榜单",
                ) { CampusLearn.loadRank(a, period) }
            }
        } else {
            animatedItem(2, "podium") {
                Row(
                    Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    listOf(1, 0, 2).forEach { pos ->
                        if (pos < rows.size) {
                            val item = rows[pos]
                            val height = if (pos == 0) 150.dp else 128.dp
                            ProductSurface(
                                Modifier.weight(1f).height(height),
                                color =
                                    if (pos == 0) c.primaryContainer.copy(alpha = .52f)
                                    else c.surface,
                                padding = 12.dp,
                            ) {
                                Text(
                                    when (pos) {
                                        0 -> "🥇"
                                        1 -> "🥈"
                                        else -> "🥉"
                                    },
                                    style = MaterialTheme.typography.headlineSmall,
                                )
                                Text(
                                    item.optString("name", item.optString("display_name", "同学")),
                                    style = MaterialTheme.typography.titleSmall,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    "${item.optInt("score", item.optInt("points"))}",
                                    style = MaterialTheme.typography.headlineSmall,
                                    color = c.primary,
                                )
                                Text(
                                    "成长值",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = c.onSurfaceVariant,
                                )
                            }
                        } else Spacer(Modifier.weight(1f))
                    }
                }
            }
            rows.drop(3).forEachIndexed { index, item ->
                animatedItem(index + 3, "rank-${index + 4}") {
                    ProductSurface(Modifier.fillMaxWidth(), padding = 12.dp) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                "${index + 4}",
                                Modifier.width(36.dp),
                                style = MaterialTheme.typography.titleMedium,
                                color = c.onSurfaceVariant,
                            )
                            Text(
                                item.optString("name", item.optString("display_name", "同学")),
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                "${item.optInt("score", item.optInt("points"))}",
                                style = MaterialTheme.typography.titleMedium,
                                color = c.primary,
                            )
                        }
                    }
                }
            }
        }
        animatedItem(1000) {
            TextButton(
                modifier = Modifier.fillMaxWidth(),
                onClick = {
                    a.ui.choose(
                        "我的成长榜展示",
                        arrayOf("显示姓名", "匿名显示", "不参与排名"),
                    ) { index ->
                        a.rpc(
                            "rank_set_pref",
                            CampusJson.obj(
                                "cid",
                                a.cid(),
                                "m",
                                arrayOf("show", "anon", "off")[index],
                            ),
                        ) { CampusLearn.loadRank(a, period) }
                    }
                },
            ) {
                Icon(Icons.Rounded.Visibility, null, Modifier.size(17.dp))
                Spacer(Modifier.width(6.dp))
                Text("设置我的榜单展示")
            }
        }
    }
}
