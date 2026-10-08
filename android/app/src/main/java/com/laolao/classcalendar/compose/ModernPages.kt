package com.laolao.classcalendar

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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.unit.*
import java.util.Calendar
import java.util.TimeZone
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject

internal object ModernPages {
    val routes =
        setOf(
            "home",
            "calendar",
            "homework",
            "tools",
            "growth",
            "me",
            "appearance",
            "ask",
            "wrongbook",
            "courses",
            "pomo",
            "draw",
            "home-layout",
            "parse-review",
            "search",
            "login",
            "register",
            "wall",
            "rank",
            "user",
            "settings",
            "permissions",
            "phone",
            "credits",
        )

    @Composable
    fun Page(state: CampusSession, route: String) {
        state.revision
        when (route) {
            "home" -> CampusHomePage(state)
            "calendar" -> CampusCalendarPage(state)
            "homework" -> CampusHomeworkPage(state)
            "tools" -> CampusToolsPage(state)
            "growth" -> CampusGrowthPage(state)
            "me" -> CampusProfilePage(state)
            "appearance" -> CampusAppearancePage(state)
            "ask" -> CampusAgentPage(state)
            "search" -> CampusSearchPage(state)
            "login" -> CampusAuthPage(state, false)
            "register" -> CampusAuthPage(state, true)
            "wall" -> CampusClassWallPage(state)
            "rank" -> CampusRankPage(state)
            "user" -> CampusPublicProfilePage(state)
            "settings" -> CampusSettingsPage(state)
            "permissions" -> CampusPermissionsPage(state)
            "phone" -> CampusPhonePage(state)
            "credits" -> CampusCreditsPage(state)
            "wrongbook" -> BooksPage(state)
            "courses" -> CoursesPage(state)
            "pomo" -> FocusPage(state)
            "draw" -> DrawPage(state)
            "home-layout" -> CampusHomeLayoutPage(state)
            "parse-review" -> ImportReviewPage(state)
            else -> FeaturePage(state)
        }
    }
}

internal fun rows(array: JSONArray) =
    (0 until array.length()).mapNotNull { array.optJSONObject(it) }

internal fun weekStats(a: CampusActivity): IntArray {
    val mon = CampusCourses.monday(DateMath.today())
    val sun = DateMath.plus(mon, 6)
    val week =
        a.items().filter {
            CampusJson.date(it.optString("event_time")) in mon..sun && !CampusSchool.hidden(a, it)
        }
    val homework = week.filter { it.optString("msg_type") == "作业" }
    return intArrayOf(
        homework.count { a.done(it) },
        homework.size,
        week.count { a.done(it) },
        week.size,
        CampusLearn.habitToday(a.store),
        a.store.list("habits_v1").length(),
    )
}

internal fun dateLabel(day: String): String {
    val p = DateMath.parts(day)
    val c = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = DateMath.parse(day) }
    return "${p[1]}月${p[2]}日  周${"日一二三四五六"[c.get(Calendar.DAY_OF_WEEK)-1]}"
}

@Composable internal fun HomePage(s: CampusSession) = ModernHomePage(s)

@Composable
internal fun CourseRow(s: CampusSession, c: JSONObject) {
    Row(
        Modifier.fillMaxWidth().clickable { CampusCourses.detail(s.a, c) }.padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.width(56.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                c.optString("t0"),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                c.optString("t1"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Box(
            Modifier.width(4.dp)
                .height(40.dp)
                .background(MaterialTheme.colorScheme.primary.copy(alpha = .5f), CircleShape)
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(c.optString("name"), style = MaterialTheme.typography.titleMedium)
            Text(
                c.optString("location").ifBlank { "教室待定" },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(Icons.Rounded.ChevronRight, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun TaskRow(s: CampusSession, task: JSONObject) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        LaoSelection(checked = a.done(task), onCheckedChange = { a.mark(CampusJson.copy(task)) })
        Column(
            Modifier.weight(1f).clickable { CampusSchool.detail(a, task) },
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                task.optString("subject", "未命名事项"),
                style = MaterialTheme.typography.titleMedium,
                color = if (a.done(task)) colors.onSurfaceVariant else colors.onSurface,
            )
            Text(
                listOf(
                        task.optString("msg_type", "事项"),
                        task.optString("event_time").ifBlank { "时间待定" },
                        task.optString("location"),
                    )
                    .filter { it.isNotBlank() }
                    .joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant,
            )
            val note = task.optString("summary", task.optString("note"))
            if (note.isNotBlank())
                Text(
                    note,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant,
                    maxLines = 2,
                )
        }
        PressIcon(Icons.Rounded.MoreHoriz, "事项操作") { CampusSchool.detail(a, task) }
    }
}

@Composable
internal fun ProgressOverview(stats: IntArray) {
    PremiumCard(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("本周作业", "本周事项", "今日打卡").forEachIndexed { index, label ->
                Column(
                    Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val done = stats[index * 2]
                    val total = stats[index * 2 + 1]
                    val value by
                        animateFloatAsState(
                            if (total == 0) 0f else done.toFloat() / total,
                            spring(dampingRatio = 1f, stiffness = 160f),
                            label = "progress $label",
                        )
                    Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(
                            progress = { value },
                            modifier = Modifier.fillMaxSize(),
                            strokeWidth = 4.dp,
                            trackColor = MaterialTheme.colorScheme.surfaceContainerHigh,
                        )
                        Text(
                            if (total == 0) "—" else "${(value*100).roundToInt()}%",
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                    Text(label, style = MaterialTheme.typography.labelMedium)
                    Text(
                        "$done / $total",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
internal fun CalendarPage(s: CampusSession) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    var selected by remember { mutableStateOf(a.selectedDay) }
    val p = DateMath.parts(selected)
    val first = DateMath.date(p[0], p[1], 1)
    val cal =
        Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = DateMath.parse(first) }
    val monthRows = calendarRows(p[0], p[1])
    val tasks =
        a.items().filter {
            CampusJson.date(it.optString("event_time")) == selected && !CampusSchool.hidden(a, it)
        }
    val courses = CampusCourses.onDay(a.store, selected)
    fun month(n: Int) {
        cal.add(Calendar.MONTH, n)
        selected = DateMath.date(cal.get(Calendar.YEAR), cal.get(Calendar.MONTH) + 1, 1)
        a.selectedDay = selected
    }
    PageList {
        animatedItem(0) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton("粘贴导入", Modifier.weight(1f)) { CampusSocial.pasteImport(a) }
                SoftButton("完整课表", Modifier.weight(1f)) { s.open("courses") }
            }
        }
        animatedItem(1) {
            PremiumCard(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${p[0]}年${p[1]}月",
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.titleLarge,
                    )
                    PressIcon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "上个月") { month(-1) }
                    TextButton(
                        onClick = {
                            selected = DateMath.today()
                            a.selectedDay = selected
                        }
                    ) {
                        Text("今天")
                    }
                    PressIcon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "下个月") { month(1) }
                }
                Row(Modifier.fillMaxWidth()) {
                    listOf("一", "二", "三", "四", "五", "六", "日").forEach {
                        Text(
                            it,
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.labelMedium,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            color = colors.onSurfaceVariant,
                        )
                    }
                }
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (dates in monthRows) Row(Modifier.fillMaxWidth()) {
                        for (column in 0..6) {
                            val date = dates[column].orEmpty()
                            val valid = date.isNotEmpty()
                            val day = date.substringAfterLast('-').toIntOrNull() ?: 0
                            val on = date == selected && valid
                            val count =
                                if (valid)
                                    a.items().count {
                                        CampusJson.date(it.optString("event_time")) == date &&
                                            !CampusSchool.hidden(a, it)
                                    } + CampusCourses.onDay(a.store, date).size
                                else 0
                            Column(
                                Modifier.weight(1f)
                                    .height(48.dp)
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(if (on) colors.primary else Color.Transparent)
                                    .clickable(enabled = valid) {
                                        selected = date
                                        a.selectedDay = date
                                    },
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center,
                            ) {
                                if (valid) {
                                    Text(
                                        day.toString(),
                                        style = MaterialTheme.typography.titleSmall,
                                        color =
                                            if (on) colors.onPrimary
                                            else if (date == DateMath.today()) colors.primary
                                            else colors.onSurface,
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    Box(
                                        Modifier.size(4.dp)
                                            .background(
                                                if (count > 0)
                                                    if (on) colors.onPrimary else colors.primary
                                                else Color.Transparent,
                                                CircleShape,
                                            )
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
        animatedItem(2) {
            SectionHeading(
                dateLabel(selected),
                note = "${courses.size} 节课程 · ${tasks.size} 项事项",
                action = "导出",
            ) {
                CampusSchool.calendarOptions(a)
            }
        }
        if (courses.isNotEmpty())
            animatedItem(3) {
                PremiumCard(Modifier.fillMaxWidth()) { courses.forEach { CourseRow(s, it) } }
            }
        tasks.forEachIndexed { i, t ->
            animatedItem(i + 4, "cal-${t.optString("_key")}") {
                PremiumCard(Modifier.fillMaxWidth()) { TaskRow(s, t) }
            }
        }
        if (courses.isEmpty() && tasks.isEmpty())
            animatedItem(4) {
                EmptyState("这一天没有安排", "点加号记一件事，日期会自动选为这一天。", "记一件事") {
                    CampusSchool.personalForm(a, null)
                }
            }
        animatedItem(5) {
            PremiumCard(Modifier.fillMaxWidth(), onClick = { s.sheet = GuideSheet }) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    LaoMascot(Modifier.size(48.dp))
                    Column {
                        Text("捞捞帮你看看安排", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "询问课程、截止时间和习惯进度",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

@Composable
internal fun HomeworkPage(s: CampusSession) {
    var offset by remember { mutableIntStateOf(0) }
    var filter by remember { mutableStateOf("待完成") }
    val a = s.a
    val mon = DateMath.plus(CampusCourses.monday(DateMath.today()), offset * 7)
    val sun = DateMath.plus(mon, 6)
    val all =
        a.items()
            .filter {
                it.optString("msg_type") == "作业" &&
                    CampusJson.date(it.optString("event_time")) in mon..sun &&
                    !CampusSchool.hidden(a, it)
            }
            .sortedBy { it.optString("event_time") }
    val selected = all.filter { filter == "全部" || a.done(it) == (filter == "已完成") }
    PageList {
        animatedItem(0) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("本周作业", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        "${dateLabel(mon)} – ${dateLabel(sun)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                PressIcon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "上一周") { offset-- }
                PressIcon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "下一周") { offset++ }
            }
        }
        animatedItem(1) {
            PremiumCard(
                Modifier.fillMaxWidth(),
                tint = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Text(
                    "${all.count{!a.done(it)}} 项待完成",
                    style = MaterialTheme.typography.headlineMedium,
                )
                Text(
                    "已完成 ${all.count{a.done(it)}} / ${all.size}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                LinearProgressIndicator(
                    progress = {
                        if (all.isEmpty()) 0f else all.count { a.done(it) }.toFloat() / all.size
                    },
                    modifier = Modifier.fillMaxWidth().height(8.dp).clip(CircleShape),
                )
            }
        }
        animatedItem(2) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("待完成", "已完成", "全部").forEach {
                    FilterChip(
                        selected = filter == it,
                        onClick = { filter = it },
                        label = { Text(it) },
                    )
                }
            }
        }
        selected.forEachIndexed { i, t ->
            animatedItem(i + 3, t.optString("_key")) {
                PremiumCard(Modifier.fillMaxWidth()) { TaskRow(s, t) }
            }
        }
        if (selected.isEmpty())
            animatedItem(3) {
                EmptyState("这里暂时没有作业", "切换周次或筛选状态，查看其他记录。", "粘贴导入") { CampusSocial.pasteImport(a) }
            }
    }
}

@Composable
internal fun ToolsPage(s: CampusSession) {
    var search by rememberSaveable { mutableStateOf("") }
    var category by remember { mutableStateOf("全部") }
    val a = s.a
    val all = CampusToolbox.ITEMS.toList()
    val shown =
        all.filter {
            (category == "全部" || it[3] == category) &&
                (search.isBlank() || it[1].contains(search, true) || it[2].contains(search, true))
        }
    PageList {
        animatedItem(0) {
            LaoInput(
                search,
                { search = it },
                "",
                Modifier.fillMaxWidth(),
                placeholder = "搜索工具、功能",
                leading = Icons.Rounded.Search,
            )
        }
        animatedItem(1) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("全部", "学习", "规划", "生活", "手机", "更多").forEach {
                    FilterChip(
                        selected = it == category,
                        onClick = { category = it },
                        label = { Text(it) },
                    )
                }
            }
        }
        if (search.isBlank() && category == "全部") {
            animatedItem(2) { SectionHeading("常用工具", action = "自选") { s.sheet = ToolPickerSheet } }
            animatedItem(3) {
                ToolGrid(
                    s,
                    CampusToolbox.pinned(a).let { arr ->
                        (0 until arr.length()).map { arr.optString(it) }
                    },
                )
            }
            animatedItem(4) { SectionHeading("所有工具", note = "${all.size} 项校园工具，按需打开") }
        }
        shown.chunked(2).forEachIndexed { i, pair ->
            animatedItem(i + 5, "tools-row-$i-$category-${search.hashCode()}") {
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    pair.forEach { x ->
                        PremiumCard(Modifier.weight(1f), onClick = { s.open(x[0]) }) {
                            IconTile(x[0])
                            Text(x[1], style = MaterialTheme.typography.titleMedium)
                            Text(
                                x[2],
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                minLines = 2,
                                maxLines = 3,
                            )
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        if (shown.isEmpty()) animatedItem(4) { EmptyState("没有匹配的工具", "试试搜索“课程”“图片”或“记账”。") }
    }
}

@Composable
internal fun ToolGrid(s: CampusSession, routes: List<String>) {
    if (routes.isEmpty()) {
        EmptyState("选几个常用工具", "自选的工具会同时出现在首页和工具页。", "选择工具") { s.sheet = ToolPickerSheet }
        return
    }
    val columns = if (routes.size == 4 || routes.size == 8) 2 else 3
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        routes.chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { route ->
                    PremiumCard(Modifier.weight(1f), onClick = { s.open(route) }) {
                        Column(
                            Modifier.fillMaxWidth(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            IconTile(route, 40.dp)
                            Text(
                                CampusToolbox.name(route),
                                style = MaterialTheme.typography.labelMedium,
                                maxLines = 2,
                                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                    }
                }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
internal fun GrowthPage(s: CampusSession) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    val habits = rows(a.store.list("habits_v1"))
    val logs = a.store.`object`("habit_log_v1")
    PageList {
        animatedItem(0) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("每一天，都在成长", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "把小小的坚持，积累成看得见的进步。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.onSurfaceVariant,
                )
            }
        }
        animatedItem(1) { ProgressOverview(weekStats(a)) }
        animatedItem(2) {
            PremiumCard(Modifier.fillMaxWidth(), onClick = { s.open("farm") }) {
                val pet = a.store.`object`("farm_v1")
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    IconTile("farm")
                    Column(Modifier.weight(1f)) {
                        Text(
                            "${pet.optString("name","小云朵")} · Lv.${pet.optInt("level",1)}",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            "养料 ${max(0,CampusLearn.food(a)-pet.optLong("spent"))}",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant,
                        )
                    }
                    Icon(Icons.Rounded.ChevronRight, null)
                }
            }
        }
        animatedItem(3) { SectionHeading("最近 14 天", action = "学习周报") { s.open("report") } }
        animatedItem(4) { PremiumCard(Modifier.fillMaxWidth()) { TrendChart(a) } }
        animatedItem(5) {
            SectionHeading("习惯打卡", note = "小目标，每天完成一点", action = "新建") {
                CampusLearn.habitForm(a, null)
            }
        }
        habits.forEachIndexed { i, h ->
            animatedItem(i + 6, "habit-${h.optString("id")}") {
                PremiumCard(Modifier.fillMaxWidth()) {
                    val checked =
                        logs.optJSONObject(h.optString("id"))?.optBoolean(DateMath.today()) == true
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                "${h.optString("icon","📖")} ${h.optString("name")}",
                                style = MaterialTheme.typography.titleMedium,
                            )
                            Text(
                                if (checked) "今天已打卡，做得不错" else "从今天开始，留下一次坚持",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.onSurfaceVariant,
                            )
                        }
                        LaoSelection(
                            checked,
                            onCheckedChange = { CampusLearn.habitToggle(a, h, DateMath.today()) },
                        )
                    }
                    TextButton(onClick = { CampusLearn.habitForm(a, h) }) { Text("编辑习惯") }
                }
            }
        }
        if (habits.isEmpty())
            animatedItem(6) {
                EmptyState("从一个小习惯开始", "阅读、运动、复习或早睡，选一件今天能完成的事。", "新建习惯") {
                    CampusLearn.habitForm(a, null)
                }
            }
        animatedItem(7) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton("成长排行榜", Modifier.weight(1f)) { s.open("rank") }
                SoftButton("捞捞元宇宙", Modifier.weight(1f)) { s.open("meta") }
            }
        }
    }
}

@Composable
internal fun TrendChart(a: CampusActivity) {
    val colors = MaterialTheme.colorScheme
    val done = a.store.`object`("done_log_v1")
    val habits = rows(a.store.list("habits_v1"))
    val logs = a.store.`object`("habit_log_v1")
    val days = List(14) { DateMath.plus(DateMath.today(), it - 13) }
    val completed = days.map { day -> CampusJson.keys(done).count { done.optString(it) == day } }
    val checked =
        days.map { day ->
            habits.count { logs.optJSONObject(it.optString("id"))?.optBoolean(day) == true }
        }
    val max = (completed + checked).maxOrNull()?.coerceAtLeast(4) ?: 4
    val motion = LocalMotionEnabled.current
    var ready by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { ready = true }
    val reveal =
        animateFloatAsState(
            if (ready || !motion) 1f else 0f,
            if (motion) spring(dampingRatio = .88f, stiffness = 110f) else snap(),
            label = "growth trend",
        )
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("● 完成事项", style = MaterialTheme.typography.labelMedium, color = colors.primary)
        Text("● 习惯打卡", style = MaterialTheme.typography.labelMedium, color = colors.tertiary)
    }
    Canvas(Modifier.fillMaxWidth().height(112.dp)) {
        for (i in 0..3) {
            val y = size.height * i / 3
            drawLine(colors.outlineVariant, Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
        }
        val width = size.width / 14
        completed.forEachIndexed { i, value ->
            val h = (size.height - 8.dp.toPx()) * value / max * reveal.value.coerceIn(0f, 1f)
            drawRoundRect(
                colors.primary.copy(alpha = .72f),
                Offset(width * i + width * .15f, size.height - h),
                Size(width * .3f, h),
                CornerRadius(4.dp.toPx()),
            )
        }
        checked.forEachIndexed { i, value ->
            val h = (size.height - 8.dp.toPx()) * value / max * reveal.value.coerceIn(0f, 1f)
            drawRoundRect(
                colors.tertiary.copy(alpha = .72f),
                Offset(width * i + width * .55f, size.height - h),
                Size(width * .3f, h),
                CornerRadius(4.dp.toPx()),
            )
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(
            dateLabel(days.first()),
            style = MaterialTheme.typography.bodySmall,
            color = colors.onSurfaceVariant,
        )
        Text("今天", style = MaterialTheme.typography.bodySmall, color = colors.onSurfaceVariant)
    }
}

@Composable
internal fun ProfilePage(s: CampusSession) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    PageList {
        animatedItem(0) {
            PremiumCard(Modifier.fillMaxWidth(), tint = colors.primaryContainer) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    LaoMascot(Modifier.size(64.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (a.api.logged()) a.me.optString("display_name", "同学") else "你的校园空间",
                            style = MaterialTheme.typography.headlineSmall,
                        )
                        Text(
                            if (a.api.logged()) CampusActivity.roleName(a.me.optString("role"))
                            else "本机记录随时可用\n登录后连接你的班级",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant,
                        )
                    }
                }
                PrimaryButton(if (a.api.logged()) "编辑个人主页" else "登录 / 注册") {
                    if (a.api.logged()) CampusSocial.editProfile(a) else s.open("login")
                }
            }
        }
        animatedItem(1) { SectionHeading("外观与使用习惯") }
        animatedItem(2) {
            SettingsGroup(
                s,
                listOf(
                    Triple("appearance", "外观与配色", "${LaoPalettes.size} 套配色，明亮、深色与跟随系统"),
                    Triple("phone", "手机专属能力", "录音、提醒、扫描、桌面卡片等 10 项能力"),
                ),
            )
        }
        animatedItem(3) { SectionHeading("账号与班级") }
        animatedItem(4) {
            SettingsGroup(
                s,
                listOf(
                    Triple("class", "我的班级", "加入班级、分组与成员管理"),
                    Triple("wall", "班级墙", "交流、通知与班级动态"),
                    Triple("people", "班级成员", "同学资料与个人主页"),
                    Triple("mail", "邮箱通知", "绑定邮箱、通知偏好与测试邮件"),
                    Triple("security", "账号安全", "密码与账户安全设置"),
                ),
            )
        }
        animatedItem(5) { SectionHeading("记录与支持") }
        animatedItem(6) {
            SettingsGroup(
                s,
                listOf(
                    Triple("backup", "数据与同步", "导入、导出、备份与原账号同步"),
                    Triple("intro", "功能介绍", "校园功能说明与使用方法"),
                    Triple("credits", "贡献名单", "一起建设校园空间的伙伴"),
                    Triple("about", "关于捞捞课程表", "版本 ${BuildConfig.VERSION_NAME}"),
                ),
            )
        }
        animatedItem(7) {
            SoftButton("提示小人设置", Modifier.fillMaxWidth()) { CampusGuide.settings(a) }
        }
        if (a.staff())
            animatedItem(8) { SoftButton("打开管理工作台", Modifier.fillMaxWidth()) { s.open("admin") } }
        if (a.api.logged())
            animatedItem(9) {
                TextButton(
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
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("退出当前账号", color = colors.error)
                }
            }
    }
}

@Composable
internal fun SettingsGroup(s: CampusSession, entries: List<Triple<String, String, String>>) {
    PremiumCard(Modifier.fillMaxWidth()) {
        entries.forEachIndexed { index, entry ->
            Row(
                Modifier.fillMaxWidth().clickable { s.open(entry.first) },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                IconTile(entry.first, 40.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(entry.second, style = MaterialTheme.typography.titleMedium)
                    Text(
                        entry.third,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(
                    Icons.Rounded.ChevronRight,
                    null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (index < entries.lastIndex)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
internal fun AppearancePage(s: CampusSession) {
    val a = s.a
    val chosen = a.store.`object`("ui_palette_v1").optString("id", "ocean")
    val mode = a.store.string("compose_mode_v1", "system")
    PageList {
        animatedItem(0) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("你的校园，你的颜色", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "整套界面即时切换，文字、卡片与弹窗保持统一。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        animatedItem(1) {
            PremiumCard(Modifier.fillMaxWidth()) {
                Text("显示模式", style = MaterialTheme.typography.titleMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("light" to "明亮", "dark" to "深色", "system" to "跟随系统").forEach {
                        (id, label) ->
                        FilterChip(
                            selected = mode == id,
                            onClick = {
                                a.store.set("compose_mode_v1", id)
                                a.store.set("ui_skin_v1", if (id == "dark") "cyber" else "fresh")
                                a.build()
                                a.syncSoon()
                            },
                            label = { Text(label) },
                        )
                    }
                }
            }
        }
        LaoPalettes.chunked(2).forEachIndexed { index, pair ->
            animatedItem(index + 2, "palette-$index") {
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    pair.forEach { p ->
                        PremiumCard(
                            Modifier.weight(1f),
                            onClick = {
                                a.store.set(
                                    "ui_palette_v1",
                                    CampusJson.obj(
                                        "id",
                                        p.id,
                                        "p",
                                        CampusTheme.hex(p.primary.toArgb()),
                                    ),
                                )
                                a.build()
                                a.syncSoon()
                            },
                        ) {
                            Box(
                                Modifier.fillMaxWidth()
                                    .height(80.dp)
                                    .clip(RoundedCornerShape(16.dp))
                                    .background(
                                        Brush.linearGradient(listOf(p.primary, p.companion))
                                    )
                            ) {
                                if (chosen == p.id)
                                    Icon(
                                        Icons.Rounded.CheckCircle,
                                        "当前使用",
                                        Modifier.align(Alignment.TopEnd).padding(8.dp),
                                        tint = Color.White,
                                    )
                                Row(
                                    Modifier.align(Alignment.BottomStart).padding(16.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    repeat(3) {
                                        Box(
                                            Modifier.size(16.dp)
                                                .background(
                                                    Color.White.copy(alpha = 1f - it * .25f),
                                                    CircleShape,
                                                )
                                        )
                                    }
                                }
                            }
                            Text(p.name, style = MaterialTheme.typography.titleMedium)
                        }
                    }
                }
            }
        }
        animatedItem(7) {
            PremiumCard(Modifier.fillMaxWidth()) {
                Text("首页与快捷工具", style = MaterialTheme.typography.titleMedium)
                SoftButton("选择首页常用工具", Modifier.fillMaxWidth()) { s.sheet = ToolPickerSheet }
                SoftButton("首页卡片与顺序", Modifier.fillMaxWidth()) { s.open("home-layout") }
            }
        }
        animatedItem(8) {
            Text(
                "关闭系统动画时，页面会自动停止入场和按压缩放。",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun BooksPage(s: CampusSession) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    var subject by remember { mutableStateOf(a.store.string("native_wrong_subject", "全部")) }
    var mode by remember { mutableStateOf("全部") }
    val all = rows(a.store.list("native_wrong"))
    val groups = all.groupBy { it.optString("subject").ifBlank { "未分类" } }
    val notebook =
        if (subject == "全部") all
        else all.filter { it.optString("subject").ifBlank { "未分类" } == subject }
    val shown =
        all.filter {
            (subject == "全部" || it.optString("subject").ifBlank { "未分类" } == subject) &&
                (mode == "全部" ||
                    if (mode == "已掌握") it.optBoolean("mastered")
                    else
                        !it.optBoolean("mastered") &&
                            DateMath.days(it.optString("due", DateMath.today())) <= 0)
        }
    PageList {
        animatedItem(0) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("记录错题", Modifier.weight(1f)) { CampusLearn.wrongForm(a, null, "") }
                SoftButton("拍照录入", Modifier.weight(1f)) {
                    CampusPhone.photo(a) { id -> CampusLearn.wrongForm(a, null, id) }
                }
            }
        }
        animatedItem(1) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("全部", "到期复习", "已掌握").forEach {
                    FilterChip(selected = mode == it, onClick = { mode = it }, label = { Text(it) })
                }
            }
        }
        animatedItem(2) {
            SectionHeading(
                if (subject == "全部") "我的学科书架" else "$subject 错题本",
                note = "${notebook.size} 道错题 · ${notebook.count{it.optBoolean("mastered")}} 道已掌握",
                action = if (subject != "全部") "全部书架" else null,
            ) {
                subject = "全部"
            }
        }
        if (subject == "全部")
            groups.toList().chunked(2).forEachIndexed { i, pair ->
                animatedItem(i + 3, "book-row-$i") {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        pair.forEach { (name, notes) ->
                            val tint = LaoPalettes[abs(name.hashCode() % LaoPalettes.size)].primary
                            PremiumCard(Modifier.weight(1f), onClick = { subject = name }) {
                                Box(
                                    Modifier.fillMaxWidth()
                                        .height(144.dp)
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(
                                            Brush.linearGradient(
                                                listOf(tint, tint.copy(alpha = .72f))
                                            )
                                        )
                                        .padding(8.dp)
                                ) {
                                    Box(
                                        Modifier.width(4.dp)
                                            .fillMaxHeight()
                                            .background(Color.White.copy(alpha = .22f), CircleShape)
                                    )
                                    Column(
                                        Modifier.padding(start = 8.dp),
                                        verticalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Text(
                                            name,
                                            style = MaterialTheme.typography.titleMedium,
                                            color = Color.White,
                                            maxLines = 2,
                                            overflow =
                                                androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                        )
                                        Text(
                                            "错题记录本",
                                            style = MaterialTheme.typography.bodySmall,
                                            color = Color.White.copy(alpha = .8f),
                                        )
                                    }
                                    Icon(
                                        Icons.AutoMirrored.Rounded.MenuBook,
                                        null,
                                        Modifier.align(Alignment.BottomEnd).size(32.dp),
                                        tint = Color.White.copy(alpha = .6f),
                                    )
                                }
                                Text(
                                    "${notes.size} 道 · ${notes.count{it.optBoolean("mastered")}} 道已掌握",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.onSurfaceVariant,
                                )
                            }
                        }
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        val showQuestions = subject != "全部" || mode != "全部"
        if (showQuestions)
            animatedItem(4) { SectionHeading(if (subject == "全部") "待复习错题" else "本册错题") }
        (if (showQuestions) shown else emptyList()).forEachIndexed { i, x ->
            animatedItem(i + 5, "wrong-${x.optString("id")}") {
                PremiumCard(Modifier.fillMaxWidth()) {
                    Text(
                        x.optString("subject") +
                            " · " +
                            if (x.optBoolean("mastered")) "已掌握"
                            else "下次复习 ${x.optString("due",DateMath.today())}",
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.primary,
                    )
                    Text(x.optString("title"), style = MaterialTheme.typography.titleLarge)
                    RecordImage(a, x.optString("photo"))
                    Text(
                        x.optString("question"),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.onSurfaceVariant,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PrimaryButton("解析 / 复习", Modifier.weight(1f)) {
                            CampusLearn.wrongReview(a, x)
                        }
                        SoftButton("编辑", Modifier.weight(1f)) {
                            CampusLearn.wrongForm(a, x, x.optString("photo"))
                        }
                    }
                    TextButton(
                        onClick = {
                            a.ui.choose(x.optString("title"), arrayOf("更换照片", "删除错题")) { index ->
                                if (index == 0)
                                    CampusPhone.photo(a) { id ->
                                        CampusJson.put(x, "photo", id)
                                        a.store.replace("native_wrong", x.optString("id"), x)
                                        a.build()
                                        a.syncSoon()
                                    }
                                else
                                    a.ui.confirm("删除错题？", x.optString("title")) {
                                        a.store.replace("native_wrong", x.optString("id"), null)
                                        a.build()
                                        a.syncSoon()
                                    }
                            }
                        }
                    ) {
                        Text("更多")
                    }
                }
            }
        }
        if ((showQuestions && shown.isEmpty()) || all.isEmpty())
            animatedItem(5) {
                EmptyState("这本书还没有错题", "为每个学科建立错题记录，可拍照或从相册添加图片。", "记录错题") {
                    CampusLearn.wrongForm(a, null, "")
                }
            }
    }
}

@Composable
internal fun RecordImage(a: CampusActivity, id: String) {
    if (id.isBlank() || !CampusPhone.validId(id)) return
    val bitmap = rememberRecordBitmap(a, id) ?: return
    Image(
        bitmap.asImageBitmap(),
        "记录照片",
        Modifier.fillMaxWidth().heightIn(max = 240.dp).clip(RoundedCornerShape(16.dp)).clickable {
            ComposeEntry.photo(a, id)
        },
        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
    )
}

@Composable internal fun CoursesPage(s: CampusSession) = ModernCoursesPage(s)
