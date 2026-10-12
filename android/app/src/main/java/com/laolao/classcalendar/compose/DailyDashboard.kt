package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import org.json.JSONObject

@Composable
internal fun DailyDashboard(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val now = rememberAgendaNow()
    val today = DateMath.today()
    val courses = CampusCourses.onDay(a.store, today)
    val tasks = visibleTasks(a)
    val todayTasks = tasks.filter { taskDate(it) == today }
    val completed = todayTasks.count { a.done(it) }
    val overdue = tasks.filter { isOverdueTask(it, today, a.done(it)) }.sortedBy { taskDate(it) }
    val undated = tasks.filter { !a.done(it) && taskDate(it).isBlank() }
    val agenda = dailyAgenda(courses, todayTasks)
    val habits = rows(a.store.list("habits_v1"))
    var filter by rememberSaveable { mutableStateOf("全部") }
    val shown = agenda.filter {
        when (filter) {
            "只看课程" -> it.course
            "只看其他事项" -> !it.course
            "待完成" -> !it.course && !a.done(it.item)
            "已完成" -> !it.course && a.done(it.item)
            else -> true
        }
    }
    val optional = laoHomeOrder(a).filter { it !in listOf("w:cal", "w:course", "w:hw", "w:pins", "w:rings", "w:quick", "w:habits") }
    LaoPage(spacing = 12.dp) {
        animatedItem(0, "daily-title") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(dateLabel(today), style = LaoType.caption, color = c.onSurfaceVariant)
                    Text(when (LocalLaoStyle.current.id) { "mentor" -> "教学日"; "business" -> "工作日"; else -> "今天" }, style = LaoType.headline)
                }
                LaoIconButton(Icons.Rounded.Tune, "自选首页模块") { s.sheet = HomeEditorSheet }
                LaoIconButton(Icons.Rounded.Add, "添加今天的事项") {
                    a.selectedDay = today
                    CampusSchool.personalForm(a, null)
                }
            }

        }
        if (a.loading) animatedItem(0, "dashboard-sync") { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (a.api.logged() && a.cloudError.isNotBlank()) animatedItem(0, "dashboard-error") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.CloudOff, null, tint = c.error)
                Text("同步未完成，本机安排仍可查看", Modifier.weight(1f).padding(horizontal = 8.dp), style = LaoType.caption, color = c.error)
                LaoTextAction("重试") { a.refreshCloud() }
            }
        }
        animatedItem(1, "daily-filters") {
            LaoTabs(listOf("全部", "只看课程", "只看其他事项", "待完成", "已完成"), filter) { filter = it }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("今日安排", Modifier.weight(1f), style = LaoType.cell)
                Text("${shown.size} 项", style = LaoType.caption, color = c.onSurfaceVariant)
                LaoTextAction("日历") { s.open("calendar") }
            }
        }
        animatedItem(2, "complete-day-timeline") { DayTimeline(s, shown, now) }
        animatedItem(3, "daily-summary") {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DailyMetric(courses.size.toString(), "课程", c.primary, Modifier.weight(1f)) { s.open("courses") }
                DailyMetric((todayTasks.size - completed).toString(), "待完成", c.secondary, Modifier.weight(1f)) { filter = "待完成" }
                DailyMetric(completed.toString(), "已完成", c.tertiary, Modifier.weight(1f)) { filter = "已完成" }
            }
            if (todayTasks.isNotEmpty()) {
                LinearProgressIndicator(
                    progress = { completed.toFloat() / todayTasks.size },
                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(CircleShape),
                    color = c.primary,
                    trackColor = c.primaryContainer,
                )
            }
        }
        animatedItem(3, "audience-workspace") { AudienceWorkspace(s, courses, todayTasks) }
        if (overdue.isNotEmpty()) {
            animatedItem(3, "overdue-heading") {
                LaoSection("逾期未完成", note = "${overdue.size} 项", action = "全部待办") { s.open("homework") }
            }
            overdue.forEachIndexed { index, task -> animatedItem(index + 4, "overdue-$index-${task.optString("_key")}") { LaoTaskCell(s, task) } }
        }
        if (undated.isNotEmpty()) {
            animatedItem(4, "undated-heading") { LaoSection("未定日期", note = "${undated.size} 项") }
            undated.forEachIndexed { index, task -> animatedItem(index + 5, "undated-$index-${task.optString("_key")}") { LaoTaskCell(s, task) } }
        }
        if (habits.isNotEmpty() && a.store.`object`("fun_opts_v1").optBoolean("habits", true)) {
            animatedItem(5, "habit-heading") { LaoSection("今日习惯", action = "管理") { s.open("growth") } }
            habits.forEachIndexed { index, habit -> animatedItem(index + 6, "daily-habit-$index") { LaoHabitCell(s, habit) } }
        }
        animatedItem(6, "daily-shortcuts") {
            DailyAudienceTools(s)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LaoSecondaryButton("粘贴导入", Modifier.weight(1f)) { CampusSocial.pasteImport(a) }
                LaoSecondaryButton("开始专注", Modifier.weight(1f)) { s.open("pomo") }
            }
            LaoPinnedTools(s)
        }
        optional.forEachIndexed { index, id -> animatedItem(index + 7, "optional-$id") { HomeSection(s, id) } }
    }
}

@Composable
private fun DailyMetric(value: String, label: String, hue: Color, modifier: Modifier, click: () -> Unit) {
    Column(
        modifier.clip(LocalLaoStyle.current.card).background(hue.copy(alpha = .07f))
            .laoTap(role = Role.Button, action = click).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(value, style = LaoType.headline.copy(fontSize = 28.sp, lineHeight = 34.sp), color = hue)
        Text(label, style = LaoType.caption, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun DailyAgendaRow(s: CampusSession, entry: DailyAgendaEntry) {
    val c = MaterialTheme.colorScheme
    val item = entry.item
    val done = !entry.course && s.a.done(item)
    val hue = if (entry.course) c.primary else c.secondary
    Row(
        Modifier.fillMaxWidth().clip(LocalLaoStyle.current.card)
            .background(if (entry.course) c.primaryContainer.copy(alpha = .45f) else c.surface)
            .border(1.dp,c.outlineVariant.copy(alpha=.65f),LocalLaoStyle.current.card)
            .padding(horizontal=12.dp,vertical=12.dp),
        verticalAlignment=Alignment.CenterVertically,
        horizontalArrangement=Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.width(48.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
            Text(entry.clock.ifBlank { "全天" },style=LaoType.caption,color=hue)
            if(entry.course) Text(item.optString("t1"),style=LaoType.label,color=c.onSurfaceVariant)
        }
            Column(
                Modifier.weight(1f).clickable {
                    if (entry.course) CampusCourses.detail(s.a, item) else CampusSchool.detail(s.a, item)
                }, verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    if (entry.course) item.optString("name") else taskTitle(item),
                    style = LaoType.cell, color = if (done) c.onSurfaceVariant else c.onSurface,
                    textDecoration = if (done) TextDecoration.LineThrough else null,
                )
                Text(
                    listOf(
                        if (entry.course) "课程" else item.optString("msg_type", "事项"),
                        item.optString("location"),
                        if (done) "已完成" else if (!entry.course) "待完成" else item.optString("teacher"),
                    ).filter { it.isNotBlank() }.joinToString(" · "),
                    style = LaoType.caption, color = c.onSurfaceVariant,
                )
                val summary = if (entry.course) "" else item.optString("summary", item.optString("note"))
                if (summary.isNotBlank()) Text(summary, style = LaoType.body, color = c.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (!entry.course) LaoCheck(done, "完成 ${taskTitle(item)}") { s.a.mark(CampusJson.copy(item)) }
            else LaoIconButton(Icons.Rounded.ChevronRight, "查看课程 ${item.optString("name")}", Modifier.size(40.dp)) { CampusCourses.detail(s.a, item) }
    }
}