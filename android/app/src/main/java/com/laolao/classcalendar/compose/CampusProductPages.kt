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
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
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

@Composable internal fun CampusHomePage(s: CampusSession) = CampusDailyHomePage(s)

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
        LaoSelection(
            done,
            { a.mark(CampusJson.copy(t)) },
            Modifier.semantics {
                contentDescription = if (done) "取消完成 ${taskTitle(t)}" else "完成 ${taskTitle(t)}"
            },
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
                    LaoSelection(
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

@Composable internal fun CampusCalendarPage(s: CampusSession) = LaoCalendarPage(s)

@Composable internal fun CampusHomeworkPage(s: CampusSession) = LaoHomeworkPage(s)

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

@Composable internal fun CampusToolsPage(s: CampusSession) = LaoToolsPage(s)

@Composable internal fun CampusGrowthPage(s: CampusSession) = LaoGrowthPage(s)

@Composable internal fun CampusProfilePage(s: CampusSession) = CampusPersonalPage(s)

internal val ProductHomeModules =
    listOf(
        "w:cal",
        "w:hw",
        "w:pins",
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
        "w:pins" -> "我的快捷工具"
        "w:quick" -> "校园快捷入口"
        "w:wall" -> "班级墙"
        else -> CampusHome.name(id)
    }

@Composable internal fun ColumnScope.HomeEditorContent(s: CampusSession) = LaoHomeEditor(s)
