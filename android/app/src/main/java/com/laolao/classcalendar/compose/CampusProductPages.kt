package com.laolao.classcalendar

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
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import java.util.Calendar
import org.json.JSONArray
import org.json.JSONObject

internal fun CampusSession.agent(prompt: String = "") {
    agentPrompt = prompt
    closeSheet()
    open("ask")
}

internal fun visibleTasks(a: CampusActivity) = a.items().filter { !CampusSchool.hidden(a, it) }

internal fun taskTitle(t: JSONObject) =
    t.optString("subject").ifBlank { t.optString("summary", "未命名事项") }

internal fun taskClock(t: JSONObject): String =
    Regex("(?:T|\\s)(\\d{2}:\\d{2})").find(t.optString("event_time"))?.groupValues?.get(1).orEmpty()

internal fun taskDate(t: JSONObject) = CampusJson.date(t.optString("event_time"))

@Composable
internal fun CampusHomePage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val today = DateMath.today()
    val courses = CampusCourses.onDay(a.store, today)
    val tasks = visibleTasks(a)
    val pending = tasks.filter { !a.done(it) }
    val todayTasks = tasks.filter { taskDate(it) == today }
    val next = CampusGuide.nextCourse(a)
    val now =
        Calendar.getInstance().let { it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE) }
    val inClass =
        next != null && next.day == today && (AgentPlanner.minute(next.time) ?: 1440) <= now
    val urgent = CampusGuide.ranked(a).firstOrNull { !it.course }
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val greeting =
        when {
            hour < 6 -> "夜深了"
            hour < 12 -> "早上好"
            hour < 18 -> "下午好"
            else -> "晚上好"
        }
    val name = if (a.api.logged()) a.me.optString("display_name", "同学") else "同学"
    val modules = homeOrder(a).filter { it !in listOf("w:pins", "w:rings") }
    PageList {
        animatedItem(0, "greeting") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.size(6.dp).background(c.primary, CircleShape))
                    Text(
                        dateLabel(today),
                        style = MaterialTheme.typography.labelMedium,
                        color = c.onSurfaceVariant,
                    )
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "$greeting，$name",
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.headlineMedium,
                        maxLines = 2,
                    )
                    IconButton(onClick = { s.sheet = HomeEditorSheet }) {
                        Icon(Icons.Rounded.Tune, "编辑校园主页", tint = c.onSurfaceVariant)
                    }
                }
            }
        }
        animatedItem(1, "agent-digest") {
            AgentDigest(s, courses.size, todayTasks.count { !a.done(it) }, pending.size)
        }
        if (a.loading) animatedItem(0, "cloud-loading") { LoadingLines("正在同步你的校园安排…") }
        else if (a.api.logged() && a.cloudError.isNotBlank())
            animatedItem(0, "cloud-error") {
                ProductState("上次操作暂时未完成", a.cloudError, Icons.Rounded.CloudOff, "重新同步", true) {
                    a.refreshCloud()
                }
            }
        animatedItem(2, "today-priorities") {
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ProductSurface(
                    Modifier.weight(1f).heightIn(min = 160.dp).fillMaxHeight(),
                    color = c.primary,
                    onClick = { s.open("courses") },
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Rounded.School,
                            null,
                            Modifier.size(16.dp),
                            tint = c.onPrimary.copy(alpha = .8f),
                        )
                        Text(
                            if (inClass) "正在上课" else if (next?.day == today) "下一节课" else "接下来的课",
                            style = MaterialTheme.typography.labelMedium,
                            color = c.onPrimary.copy(alpha = .8f),
                        )
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (inClass) next!!.source.optString("t1") else next?.time ?: "自由时间",
                            style = MaterialTheme.typography.headlineSmall,
                            color = c.onPrimary,
                        )
                        Text(
                            next?.title ?: "给自己一点留白",
                            style = MaterialTheme.typography.titleSmall,
                            color = c.onPrimary,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            next?.let {
                                if (it.day == today)
                                    (if (inClass) "下课 · " else "") + it.location.ifBlank { "教室待确认" }
                                else dateLabel(it.day)
                            } ?: "添加课程，捞捞帮你记住",
                            style = MaterialTheme.typography.bodySmall,
                            color = c.onPrimary.copy(alpha = .8f),
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                ProductSurface(
                    Modifier.weight(1f).heightIn(min = 160.dp).fillMaxHeight(),
                    onClick = {
                        if (urgent == null) s.open("homework")
                        else CampusSchool.detail(a, urgent.source)
                    },
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Rounded.Flag,
                            null,
                            Modifier.size(16.dp),
                            tint = CampusStatus.warning(),
                        )
                        Text(
                            "优先处理",
                            style = MaterialTheme.typography.labelMedium,
                            color = c.onSurfaceVariant,
                        )
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            urgent?.title ?: "没有要赶的事",
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            urgent?.reason ?: "保持自己的学习节奏",
                            style = MaterialTheme.typography.bodySmall,
                            color = CampusStatus.warning(),
                            maxLines = 2,
                        )
                        Text(
                            if (urgent == null) "去看看作业 →" else "查看详情 →",
                            style = MaterialTheme.typography.labelMedium,
                            color = c.primary,
                        )
                    }
                }
            }
        }
        animatedItem(3, "day-metrics") {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                ProductMetric(
                    "${courses.size}",
                    "今日课程",
                    Modifier.weight(1f),
                    click = { s.open("courses") },
                )
                ProductMetric(
                    "${pending.size}",
                    "待完成",
                    Modifier.weight(1f),
                    click = { s.open("homework") },
                )
                ProductMetric(
                    "${CampusLearn.habitToday(a.store)} / ${a.store.list("habits_v1").length()}",
                    "今日打卡",
                    Modifier.weight(1f),
                    click = { s.open("growth") },
                )
            }
        }
        animatedItem(4, "campus-shortcuts") {
            ProductSurface(Modifier.fillMaxWidth()) { CampusShortcuts(s) }
        }
        modules.forEachIndexed { i, module ->
            animatedItem(i + 5, "product-home-$module") {
                when (module) {
                    "w:cal",
                    "w:course" -> {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            SectionHeading("今天的时间线", note = "课程与事项，放在同一条节奏里", action = "新增") {
                                s.sheet = QuickAddSheet
                            }
                            AgendaRows(s, today, limit = 4)
                        }
                    }
                    "w:hw" -> {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            SectionHeading("别忘了这些", action = "全部作业") { s.open("homework") }
                            if (pending.isEmpty())
                                ProductState("待办已清空", "有条不紊，也给自己留一点休息时间。", Icons.Rounded.TaskAlt)
                            else
                                ProductSurface(Modifier.fillMaxWidth()) {
                                    pending
                                        .sortedBy { it.optString("event_time", "9999") }
                                        .take(3)
                                        .forEachIndexed { index, t ->
                                            ProductTaskCell(s, t)
                                            if (index < minOf(2, pending.lastIndex))
                                                HorizontalDivider(
                                                    color = c.outlineVariant.copy(alpha = .5f)
                                                )
                                        }
                                }
                        }
                    }
                    "w:quick" -> {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            SectionHeading("我的快捷工具", action = "选择") { s.sheet = ToolPickerSheet }
                            CompactToolGrid(
                                s,
                                (0 until CampusToolbox.pinned(a).length())
                                    .map { CampusToolbox.pinned(a).optString(it) }
                                    .take(6),
                            )
                        }
                    }
                    else -> HomeSection(s, module)
                }
            }
        }
        animatedItem(modules.size + 5) {
            AiAction("让捞捞帮我安排复习", Modifier.fillMaxWidth()) { s.agent("帮我安排复习") }
        }
    }
}

@Composable
internal fun AgentDigest(s: CampusSession, courseCount: Int, todayTasks: Int, pending: Int) {
    val c = MaterialTheme.colorScheme
    val ai = CampusStatus.ai()
    val background = lerp(c.surface, ai, .06f)
    ProductSurface(Modifier.fillMaxWidth(), color = background) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(16.dp), tint = ai)
                    Text("捞捞 · 今日摘要", style = MaterialTheme.typography.titleSmall, color = ai)
                }
                Text(
                    if (courseCount + todayTasks == 0) "导入课表或班群消息，我来帮你安排。"
                    else
                        "$courseCount 节课程 · $todayTasks 项今日待办" +
                            if (pending > todayTasks) "\n还有 ${pending - todayTasks} 项后续安排"
                            else "\n重要的事，我们一起安排。",
                    style = MaterialTheme.typography.bodyMedium,
                    color = c.onSurfaceVariant,
                )
            }
            if (CampusGuide.enabled(s.a))
                LaoMascot(
                    Modifier.size(80.dp).semantics { contentDescription = "和捞捞聊聊" },
                    onTap = { s.agent("你好") },
                )
        }
        AiAction("帮我规划今天", Modifier.fillMaxWidth()) { s.agent("帮我规划今天") }
    }
}

@Composable
internal fun CampusShortcuts(s: CampusSession) {
    listOf(
            listOf("courses" to "课程", "homework" to "作业", "calendar" to "日历"),
            listOf("growth" to "成长", "pomo" to "专注", "tools" to "工具"),
        )
        .forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { (route, label) ->
                    Column(
                        Modifier.weight(1f)
                            .heightIn(min = 72.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .clickable { s.open(route) }
                            .padding(8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            routeIcon(route),
                            null,
                            Modifier.size(24.dp),
                            tint =
                                if (route == "growth") CampusStatus.warning()
                                else MaterialTheme.colorScheme.primary,
                        )
                        Text(label, style = MaterialTheme.typography.labelMedium)
                    }
                }
            }
        }
}

@Composable
internal fun ProductTaskCell(s: CampusSession, t: JSONObject) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val done = a.done(t)
    val due = taskDate(t)
    val urgent = !done && due.isNotBlank() && due <= DateMath.today()
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Checkbox(
            done,
            { a.mark(CampusJson.copy(t)) },
            Modifier.semantics {
                contentDescription = if (done) "取消完成 ${taskTitle(t)}" else "完成 ${taskTitle(t)}"
            },
            colors = CheckboxDefaults.colors(checkedColor = c.primary),
        )
        Column(
            Modifier.weight(1f).clickable { CampusSchool.detail(a, t) },
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                taskTitle(t),
                style = MaterialTheme.typography.titleMedium,
                color = if (done) c.onSurfaceVariant else c.onSurface,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOf(
                        t.optString("msg_type", "事项"),
                        if (due == DateMath.today()) "今天 ${taskClock(t)}"
                        else if (due.isNotBlank()) "${dateLabel(due)} ${taskClock(t)}" else "时间待确认",
                    )
                    .joinToString(" · "),
                style = MaterialTheme.typography.bodySmall,
                color = if (urgent) CampusStatus.warning() else c.onSurfaceVariant,
            )
        }
        IconButton(onClick = { CampusSchool.detail(a, t) }) {
            Icon(Icons.Rounded.MoreHoriz, "事项操作", Modifier.size(20.dp), tint = c.onSurfaceVariant)
        }
    }
}

@Composable
internal fun AgendaRows(
    s: CampusSession,
    day: String,
    limit: Int = Int.MAX_VALUE,
    kind: String = "全部",
) {
    val c = MaterialTheme.colorScheme
    val courses = CampusCourses.onDay(s.a.store, day).takeIf { kind != "事项" }.orEmpty()
    val tasks = visibleTasks(s.a).filter { taskDate(it) == day }.takeIf { kind != "课程" }.orEmpty()
    val entries =
        (courses.map { Triple(it.optString("t0"), true, it) } +
                tasks.map { Triple(taskClock(it).ifBlank { "00:00" }, false, it) })
            .sortedBy { it.first }
            .take(limit)
    if (entries.isEmpty()) {
        ProductState("这一天，暂时没有安排", "记录一件事，或粘贴班群消息，让捞捞帮你整理。", action = "粘贴导入") {
            CampusSocial.pasteImport(s.a)
        }
        return
    }
    ProductSurface(Modifier.fillMaxWidth()) {
        entries.forEachIndexed { i, (clock, course, item) ->
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    Modifier.width(48.dp),
                    horizontalAlignment = Alignment.Start,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        if (clock == "00:00") "全天" else clock,
                        style = MaterialTheme.typography.labelLarge,
                        color = c.primary,
                    )
                    if (course)
                        Text(
                            item.optString("t1"),
                            style = MaterialTheme.typography.bodySmall,
                            color = c.onSurfaceVariant,
                        )
                }
                Box(
                    Modifier.width(3.dp)
                        .height(40.dp)
                        .background(
                            if (course) c.primary.copy(alpha = .5f)
                            else CampusStatus.warning().copy(alpha = .5f),
                            CircleShape,
                        )
                )
                Column(
                    Modifier.weight(1f).padding(start = 8.dp).clickable {
                        if (course) CampusCourses.detail(s.a, item)
                        else CampusSchool.detail(s.a, item)
                    },
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        if (course) item.optString("name") else taskTitle(item),
                        style = MaterialTheme.typography.titleMedium,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        if (course) item.optString("location").ifBlank { "教室待确认" }
                        else
                            "${item.optString("msg_type", "个人")} · ${if (s.a.done(item)) "已完成" else "待完成"}",
                        style = MaterialTheme.typography.bodySmall,
                        color = c.onSurfaceVariant,
                    )
                }
                if (course)
                    Icon(
                        Icons.Rounded.ChevronRight,
                        null,
                        Modifier.size(16.dp),
                        tint = c.onSurfaceVariant,
                    )
                else
                    Checkbox(
                        s.a.done(item),
                        { s.a.mark(CampusJson.copy(item)) },
                        Modifier.size(48.dp).semantics {
                            contentDescription = "切换完成 ${taskTitle(item)}"
                        },
                    )
            }
            if (i < entries.lastIndex)
                HorizontalDivider(
                    Modifier.padding(start = 56.dp),
                    color = c.outlineVariant.copy(alpha = .55f),
                )
        }
    }
}

@Composable
internal fun CampusCalendarPage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    var selected by rememberSaveable { mutableStateOf(s.a.selectedDay) }
    var monthView by rememberSaveable { mutableStateOf(false) }
    var kind by rememberSaveable { mutableStateOf("全部") }
    val parts = DateMath.parts(selected)
    val week = CampusCourses.monday(selected)
    fun move(direction: Int) {
        selected =
            if (monthView) {
                val date =
                    Calendar.getInstance().apply {
                        time = DateMath.parse(selected)
                        add(Calendar.MONTH, direction)
                    }
                DateMath.date(date.get(Calendar.YEAR), date.get(Calendar.MONTH) + 1, 1)
            } else DateMath.plus(selected, direction * 7)
        s.a.selectedDay = selected
    }
    PageList {
        animatedItem(0) { ProductIntro("把日子，安排从容", "课程、作业与校园日程，一眼看清。") }
        animatedItem(1) {
            ProductSurface(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "${parts[0]}.${parts[1].toString().padStart(2, '0')}",
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    PressIcon(
                        Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                        if (monthView) "上个月" else "上一周",
                    ) {
                        move(-1)
                    }
                    PressIcon(
                        Icons.AutoMirrored.Rounded.KeyboardArrowRight,
                        if (monthView) "下个月" else "下一周",
                    ) {
                        move(1)
                    }
                    IconButton(onClick = { monthView = !monthView }) {
                        Icon(
                            if (monthView) Icons.Rounded.ViewWeek else Icons.Rounded.CalendarMonth,
                            if (monthView) "切换周视图" else "切换月视图",
                            tint = c.primary,
                        )
                    }
                    TextButton(
                        onClick = {
                            selected = DateMath.today()
                            s.a.selectedDay = selected
                        },
                        contentPadding = PaddingValues(horizontal = 8.dp),
                    ) {
                        Text("今天")
                    }
                }
                Row {
                    listOf("一", "二", "三", "四", "五", "六", "日").forEach {
                        Text(
                            it,
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.labelSmall,
                            color = c.onSurfaceVariant,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
                val rows =
                    if (monthView) calendarRows(parts[0], parts[1])
                    else listOf(List(7) { DateMath.plus(week, it) })
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    rows.forEach { dates ->
                        Row {
                            dates.forEach { day ->
                                val value = day.orEmpty()
                                val on = value == selected
                                val has =
                                    value.isNotBlank() &&
                                        (visibleTasks(s.a).any { taskDate(it) == value } ||
                                            CampusCourses.onDay(s.a.store, value).isNotEmpty())
                                Column(
                                    Modifier.weight(1f)
                                        .heightIn(min = 48.dp)
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(if (on) c.primary else Color.Transparent)
                                        .clickable(enabled = value.isNotBlank()) {
                                            selected = value
                                            s.a.selectedDay = value
                                        }
                                        .padding(vertical = 8.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(4.dp),
                                ) {
                                    Text(
                                        value
                                            .substringAfterLast('-')
                                            .toIntOrNull()
                                            ?.toString()
                                            .orEmpty(),
                                        style = MaterialTheme.typography.titleSmall,
                                        color =
                                            if (on) c.onPrimary
                                            else if (value == DateMath.today()) c.primary
                                            else c.onSurface,
                                    )
                                    Box(
                                        Modifier.size(4.dp)
                                            .background(
                                                if (has) if (on) c.onPrimary else c.primary
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
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton("粘贴导入", Modifier.weight(1f)) { CampusSocial.pasteImport(s.a) }
                SoftButton("完整课表", Modifier.weight(1f)) { s.open("courses") }
            }
        }
        animatedItem(3) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    dateLabel(selected),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.titleMedium,
                )
                PressIcon(Icons.Rounded.Add, "记一件事") { CampusSchool.personalForm(s.a, null) }
                PressIcon(Icons.Rounded.FilterList, "日历筛选：$kind") {
                    s.sheet =
                        ChoiceSheet("查看哪些安排", listOf("全部", "课程", "事项")) {
                            kind = listOf("全部", "课程", "事项")[it]
                        }
                }
                PressIcon(Icons.Rounded.MoreHoriz, "日历更多选项") { CampusSchool.calendarOptions(s.a) }
            }
        }
        animatedItem(5, "agenda-$selected-$kind") { AgendaRows(s, selected, kind = kind) }
        animatedItem(6) {
            AiAction("问捞捞：${dateLabel(selected)}有什么安排", Modifier.fillMaxWidth()) {
                s.agent("${selected} 有什么安排")
            }
        }
    }
}

@Composable
internal fun CampusHomeworkPage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var filter by rememberSaveable { mutableStateOf("待完成") }
    val mon = DateMath.plus(CampusCourses.monday(DateMath.today()), offset * 7)
    val sun = DateMath.plus(mon, 6)
    val all =
        visibleTasks(s.a)
            .filter { it.optString("msg_type") == "作业" && taskDate(it) in mon..sun }
            .sortedBy { it.optString("event_time") }
    val completed = all.count { s.a.done(it) }
    val pending = all.size - completed
    val selected = all.filter { filter == "全部" || s.a.done(it) == (filter == "已完成") }
    PageList {
        animatedItem(0) { ProductIntro("一件一件，轻松完成", "把截止日期交给捞捞，把注意力留给学习。") }
        animatedItem(1) {
            ProductSurface(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "${if (offset == 0) "本周" else if (offset == -1) "上周" else if (offset == 1) "下周" else "所选周"}作业",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            "${mon.substring(5).replace('-', '.')} — ${sun.substring(5).replace('-', '.')}",
                            style = MaterialTheme.typography.bodySmall,
                            color = c.onSurfaceVariant,
                        )
                    }
                    PressIcon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "上一周") { offset-- }
                    PressIcon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "下一周") { offset++ }
                    PressIcon(Icons.Rounded.Add, "添加作业") {
                        s.a.selectedDay = if (offset == 0) DateMath.today() else mon
                        CampusSchool.personalForm(s.a, null)
                        (s.sheet as? FormSheet)?.initial?.put("msg_type", "作业")
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    ProductMetric(pending.toString(), "待完成", Modifier.weight(1f))
                    ProductMetric(
                        completed.toString(),
                        "已完成",
                        Modifier.weight(1f),
                        color = CampusStatus.success(),
                    )
                    ProductMetric(
                        all.count { !s.a.done(it) && taskDate(it) <= DateMath.today() }.toString(),
                        "需要关注",
                        Modifier.weight(1f),
                        color = CampusStatus.warning(),
                    )
                }
                LinearProgressIndicator(
                    progress = { if (all.isEmpty()) 0f else completed.toFloat() / all.size },
                    Modifier.fillMaxWidth().height(6.dp).clip(CircleShape),
                    trackColor = c.surfaceContainer,
                )
            }
        }
        animatedItem(2) { AiAction("帮我排一下作业优先级", Modifier.fillMaxWidth()) { s.agent("我应该先做哪些作业") } }
        animatedItem(3) { ProductTabs(listOf("待完成", "已完成", "全部"), filter) { filter = it } }
        if (selected.isEmpty())
            animatedItem(4) {
                ProductState(
                    if (all.isEmpty()) "本周还没有作业记录" else "这个筛选下没有作业",
                    "从班群复制消息，粘贴后核对保存。",
                    Icons.Rounded.TaskAlt,
                    "粘贴导入",
                ) {
                    CampusSocial.pasteImport(s.a)
                }
            }
        selected
            .groupBy { taskDate(it) }
            .entries
            .forEachIndexed { index, (day, items) ->
                animatedItem(index + 4, "homework-day-$day-$filter") {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (day == DateMath.today()) "今天截止" else dateLabel(day),
                            style = MaterialTheme.typography.labelLarge,
                            color = c.onSurfaceVariant,
                        )
                        ProductSurface(Modifier.fillMaxWidth()) {
                            items.forEachIndexed { i, item ->
                                ProductTaskCell(s, item)
                                if (i < items.lastIndex)
                                    HorizontalDivider(color = c.outlineVariant.copy(alpha = .5f))
                            }
                        }
                    }
                }
            }
    }
}

@Composable
internal fun CompactToolGrid(s: CampusSession, routes: List<String>) {
    if (routes.isEmpty()) {
        ProductState("选择你的常用工具", "把最常用的几个放在这里。", Icons.Rounded.Widgets, "选择工具") {
            s.sheet = ToolPickerSheet
        }
        return
    }
    val columns = if (routes.size == 4) 2 else 3
    val c = MaterialTheme.colorScheme
    ProductSurface(Modifier.fillMaxWidth(), padding = 12.dp) {
        routes.chunked(columns).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { route ->
                    val source = remember {
                        androidx.compose.foundation.interaction.MutableInteractionSource()
                    }
                    Column(
                        Modifier.weight(1f)
                            .heightIn(min = 64.dp)
                            .springPress(source)
                            .clip(RoundedCornerShape(16.dp))
                            .background(c.primary.copy(alpha = .035f))
                            .clickable(source, null) {
                                s.closeSheet()
                                s.open(route)
                            }
                            .padding(8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Icon(routeIcon(route), null, Modifier.size(24.dp), tint = c.primary)
                        Text(
                            CampusToolbox.name(route),
                            style = MaterialTheme.typography.labelMedium,
                            maxLines = 2,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                }
                repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
internal fun CampusToolsPage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    var search by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("全部") }
    val all = CampusToolbox.ITEMS.toList()
    val shown =
        all.filter {
            (category == "全部" || it[3] == category) &&
                (search.isBlank() || (it[1] + it[2]).contains(search, true))
        }
    PageList {
        animatedItem(0) { ProductIntro("顺手的工具，都在这里", "按学习、规划和生活场景，找到你需要的。") }
        animatedItem(1) {
            OutlinedTextField(
                search,
                { search = it },
                Modifier.fillMaxWidth(),
                placeholder = { Text("搜索工具或功能") },
                leadingIcon = { Icon(Icons.Rounded.Search, null) },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = c.outlineVariant),
            )
        }
        if (search.isBlank() && category == "全部") {
            animatedItem(2) { SectionHeading("常用", action = "编辑") { s.sheet = ToolPickerSheet } }
            animatedItem(3) {
                CompactToolGrid(
                    s,
                    (0 until CampusToolbox.pinned(s.a).length()).map {
                        CampusToolbox.pinned(s.a).optString(it)
                    },
                )
            }
            animatedItem(4) {
                ProductSurface(Modifier.fillMaxWidth()) {
                    ProductLink("成长空间", "习惯、周报与每一次进步", "growth", s)
                    AiAction("让捞捞推荐适合我的工具", Modifier.fillMaxWidth()) { s.agent("我可以用哪些学习工具") }
                }
            }
        }
        animatedItem(5) {
            Row(
                Modifier.horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("全部", "学习", "规划", "生活", "手机", "更多").forEach {
                    FilterChip(
                        category == it,
                        { category = it },
                        label = { Text(it) },
                        shape = CircleShape,
                    )
                }
            }
        }
        val grouped = if (category == "全部") shown.groupBy { it[3] } else mapOf(category to shown)
        grouped.entries.forEachIndexed { groupIndex, (group, tools) ->
            animatedItem(groupIndex + 6, "tool-category-$group") {
                SectionHeading(group, note = "${tools.size} 项工具")
            }
            tools.chunked(2).forEachIndexed { rowIndex, pair ->
                animatedItem(rowIndex + 7, "tool-catalog-$group-${pair.first()[0]}") {
                    Row(
                        Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        pair.forEach { tool ->
                            ToolCatalogTile(s, tool, Modifier.weight(1f).fillMaxHeight())
                        }
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        }
        if (shown.isEmpty())
            animatedItem(6) { ProductState("没有找到这个工具", "换一个关键词，例如课程、错题、记账。", Icons.Rounded.Search) }
    }
}

@Composable
internal fun CampusGrowthPage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val habits = rows(a.store.list("habits_v1"))
    val logs = a.store.`object`("habit_log_v1")
    val week = weekStats(a)
    val focusLogs = rows(a.store.list("native_focus_sessions"))
    val done = a.store.`object`("done_log_v1").length()
    PageList {
        animatedItem(0) { ProductIntro("进步，正在发生", "认真生活的每一天，都值得被记录。") }
        animatedItem(1) { GrowthSummary(s, week, done, focusLogs.size) }
        animatedItem(2) { SectionHeading("坚持的轨迹", action = "学习周报") { s.open("report") } }
        animatedItem(3) { ProductSurface(Modifier.fillMaxWidth()) { TrendChart(a) } }
        animatedItem(4) {
            SectionHeading("今天的小目标", action = "新建习惯") { CampusLearn.habitForm(a, null) }
        }
        if (habits.isEmpty())
            animatedItem(5) {
                ProductState("让坚持，从一件小事开始", "阅读 15 分钟、运动一次，或整理一页笔记。", Icons.Rounded.Spa, "新建习惯") {
                    CampusLearn.habitForm(a, null)
                }
            }
        else
            animatedItem(5) {
                ProductSurface(Modifier.fillMaxWidth()) {
                    habits.forEachIndexed { index, h ->
                        val checked =
                            logs.optJSONObject(h.optString("id"))?.optBoolean(DateMath.today()) ==
                                true
                        Row(
                            Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            Icon(
                                if (checked) Icons.Rounded.CheckCircle
                                else Icons.Rounded.RadioButtonUnchecked,
                                null,
                                tint = if (checked) c.primary else c.onSurfaceVariant,
                            )
                            Column(
                                Modifier.weight(1f).clickable { CampusLearn.habitForm(a, h) },
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    h.optString("name"),
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                Text(
                                    if (checked) "今天已打卡" else "今天还差一点坚持",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = c.onSurfaceVariant,
                                )
                            }
                            Switch(
                                checked,
                                { CampusLearn.habitToggle(a, h, DateMath.today()) },
                                Modifier.semantics {
                                    contentDescription = "打卡 ${h.optString("name")}"
                                },
                            )
                        }
                        if (index < habits.lastIndex)
                            HorizontalDivider(color = c.outlineVariant.copy(alpha = .5f))
                    }
                }
            }
        animatedItem(6) {
            ProductSurface(Modifier.fillMaxWidth()) {
                ProductLink(
                    "小云朵的成长",
                    "${a.store.`object`("farm_v1").optString("name", "小云朵")} · Lv.${a.store.`object`("farm_v1").optInt("level", 1)}",
                    "farm",
                    s,
                )
                ProductLink("成长排行榜", "和同学一起坚持", "rank", s)
                ProductLink("捞捞元宇宙", "你的校园成长空间", "meta", s)
            }
        }
    }
}

@Composable
internal fun CampusProfilePage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val name = if (a.api.logged()) a.me.optString("display_name", "同学") else "同学"
    PageList {
        animatedItem(0) {
            ProductSurface(Modifier.fillMaxWidth()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Box(
                        Modifier.size(56.dp)
                            .clip(RoundedCornerShape(20.dp))
                            .background(
                                Brush.linearGradient(
                                    listOf(c.primaryContainer, c.primary.copy(alpha = .12f))
                                )
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            name.take(1),
                            style = MaterialTheme.typography.headlineSmall,
                            color = c.primary,
                        )
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            if (a.api.logged()) name else "你的校园空间",
                            style = MaterialTheme.typography.headlineSmall,
                        )
                        Text(
                            if (a.api.logged()) CampusActivity.roleName(a.me.optString("role"))
                            else "本机记录随时可用 · 登录连接班级",
                            style = MaterialTheme.typography.bodySmall,
                            color = c.onSurfaceVariant,
                        )
                    }
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    StatusPill(
                        if (a.cid().isNotBlank()) "已连接班级" else "校园记录，随时可用",
                        c.primary,
                        Icons.Rounded.School,
                    )
                    Spacer(Modifier.weight(1f))
                    if (CampusGuide.enabled(a)) LaoMascot(Modifier.size(48.dp))
                }
                SoftButton(if (a.api.logged()) "编辑个人主页" else "登录 / 注册", Modifier.fillMaxWidth()) {
                    if (a.api.logged()) CampusSocial.editProfile(a) else s.open("login")
                }
            }
        }
        animatedItem(1) { SectionHeading("让校园空间，更像你") }
        animatedItem(2) {
            ProductSurface(Modifier.fillMaxWidth()) {
                ProductLink("外观与配色", "默认柔和主题 · 深空蓝 · 10 套配色", "appearance", s)
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable {
                        s.sheet = HomeEditorSheet
                    },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    IconTile("home", 40.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("编辑校园主页", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "模块增减、排列与快捷工具",
                            style = MaterialTheme.typography.bodySmall,
                            color = c.onSurfaceVariant,
                        )
                    }
                    Icon(Icons.Rounded.ChevronRight, null, Modifier.size(20.dp))
                }
                ProductLink("成长空间", "习惯、专注与学习周报", "growth", s)
            }
        }
        animatedItem(3) { SectionHeading("校园连接") }
        animatedItem(4) {
            ProductSurface(Modifier.fillMaxWidth()) {
                ProductLink("我的班级", "加入、分组与成员管理", "class", s)
                ProductLink("班级墙", "通知、交流与同学的动态", "wall", s)
                ProductLink("班级成员", "认识你的校园伙伴", "people", s)
            }
        }
        animatedItem(5) { SectionHeading("偏好与支持") }
        animatedItem(6) {
            ProductSurface(Modifier.fillMaxWidth()) {
                ProductLink("数据与同步", "备份、导入与原账号同步", "backup", s)
                ProductLink("手机专属能力", "扫描、录音、提醒与桌面卡片", "phone", s)
                ProductLink("账号安全", "密码与账户设置", "security", s)
                ProductLink("邮箱通知", "绑定邮箱与通知偏好", "mail", s)
                ProductLink("关于捞捞课程表", "AI Campus Agent", "about", s, BuildConfig.VERSION_NAME)
            }
        }
        animatedItem(7) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton("提示小人设置", Modifier.weight(1f)) { CampusGuide.settings(a) }
                SoftButton("AI 服务设置", Modifier.weight(1f)) { CampusSocial.aiSettings(a) }
            }
        }
        animatedItem(8) {
            ProductSurface(Modifier.fillMaxWidth()) {
                ProductLink("功能介绍", "校园空间的使用方法", "intro", s)
                ProductLink("贡献名单", "一起建设校园的伙伴", "credits", s)
            }
        }
        if (a.staff())
            animatedItem(9) { SoftButton("管理工作台", Modifier.fillMaxWidth()) { s.open("admin") } }
        if (a.api.logged())
            animatedItem(10) {
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
                    Text("退出当前账号", color = c.error)
                }
            }
    }
}

internal val ProductHomeModules =
    listOf(
        "w:cal",
        "w:hw",
        "w:quick",
        "w:wall",
        "w:habits",
        "w:plan",
        "w:farm",
        "w:pomo",
        "w:encourage",
        "w:meta",
        "w:rank",
    )

internal fun productModuleName(id: String): String =
    when (id) {
        "w:cal" -> "今天的时间线"
        "w:hw" -> "作业与待办"
        "w:quick" -> "快捷工具"
        "w:wall" -> "班级墙"
        else -> CampusHome.name(id)
    }

@Composable
internal fun ColumnScope.HomeEditorContent(s: CampusSession) {
    val initial = homeOrder(s.a).filter { it !in listOf("w:pins", "w:rings") }
    var selected by remember { mutableStateOf(initial) }
    val c = MaterialTheme.colorScheme
    SheetHeading("编辑校园主页") { s.closeSheet() }
    Text(
        "首屏保留今日重点与捞捞摘要；下面的模块，由你来安排。",
        style = MaterialTheme.typography.bodyMedium,
        color = c.onSurfaceVariant,
    )
    LazyColumn(Modifier.weight(1f, false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items((selected + ProductHomeModules).distinct(), key = { it }) { id ->
            val on = id in selected
            val index = selected.indexOf(id)
            ProductSurface(
                Modifier.fillMaxWidth(),
                color = c.surfaceContainerLow,
                padding = 16.dp,
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        productModuleName(id),
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.titleSmall,
                    )
                    if (on && selected.size > 1) {
                        IconButton(
                            onClick = {
                                selected =
                                    selected.toMutableList().apply {
                                        add(index - 1, removeAt(index))
                                    }
                            },
                            enabled = index > 0,
                        ) {
                            Icon(
                                Icons.Rounded.KeyboardArrowUp,
                                "上移 ${productModuleName(id)}",
                                Modifier.size(20.dp),
                            )
                        }
                        IconButton(
                            onClick = {
                                selected =
                                    selected.toMutableList().apply {
                                        add(index + 1, removeAt(index))
                                    }
                            },
                            enabled = index < selected.lastIndex,
                        ) {
                            Icon(
                                Icons.Rounded.KeyboardArrowDown,
                                "下移 ${productModuleName(id)}",
                                Modifier.size(20.dp),
                            )
                        }
                    }
                    Switch(
                        on,
                        { selected = if (on) selected.filter { it != id } else selected + id },
                        Modifier.semantics { contentDescription = "显示 ${productModuleName(id)}" },
                    )
                }
            }
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SoftButton("取消", Modifier.weight(1f)) { s.closeSheet() }
        PrimaryButton("保存主页", Modifier.weight(1f)) {
            val config = JSONObject(s.a.store.`object`("native_compose_home_v1").toString())
            config.put(
                "home",
                JSONArray().apply {
                    selected.forEach { put(CampusJson.obj("id", it, "w", 4, "h", 1)) }
                },
            )
            s.a.store.set("native_compose_home_v1", config)
            s.closeSheet()
            s.a.build()
            s.notice = "校园主页已更新"
        }
    }
}
