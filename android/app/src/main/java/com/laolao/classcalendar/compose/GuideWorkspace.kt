package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.*

@Composable
internal fun GuidePage(s: CampusSession) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        GuideWorkspace(s, Modifier.weight(1f))
    }
}

@Composable
internal fun ColumnScope.GuideWorkspace(s: CampusSession, modifier: Modifier = Modifier) {
    var query by rememberSaveable { mutableStateOf("") }
    var question by rememberSaveable { mutableStateOf("") }
    var tab by rememberSaveable { mutableStateOf("黑板") }
    val a = s.a
    val now = rememberAgendaNow()
    val c = MaterialTheme.colorScheme
    val ranked = CampusGuide.ranked(a)
    val reply = if (question.isBlank()) null else CampusGuide.answer(a, question)
    fun ask(text: String) { if (text.isNotBlank()) { question = text; query = ""; tab = "问捞捞" } }
    LazyColumn(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(14.dp), contentPadding = PaddingValues(bottom = 8.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LaoMascot(Modifier.size(52.dp))
                Column { Text("捞捞的黑板", style = LaoType.title); Text(dateLabel(DateMath.today()), style = LaoType.caption, color = c.onSurfaceVariant) }
            }
            LaoTabs(listOf("黑板", "问捞捞", "工具"), tab) { tab = it }
        }
        if (tab == "黑板") {
            item {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(c.inverseSurface).border(3.dp, c.outlineVariant, RoundedCornerShape(8.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("今日备忘", style = LaoType.title, color = c.inverseOnSurface)
                    val tasks = visibleTasks(a).filter { taskDate(it) == DateMath.today() }
                    Text("${CampusCourses.onDay(a.store, DateMath.today()).size} 节课 · ${tasks.count { !a.done(it) }} 项待办 · ${tasks.count { a.done(it) }} 项完成", style = LaoType.caption, color = c.inverseOnSurface)
                    if (ranked.isEmpty()) Text("暂时没有要赶的事", style = LaoType.body, color = c.inverseOnSurface)
                    ranked.take(3).forEach { entry ->
                        Text("${entry.time.ifBlank { if (entry.day.isBlank()) "待定" else "全天" }}  ${entry.title}", style = LaoType.cell, color = c.inverseOnSurface)
                        Text(listOf(entry.reason, entry.location).filter { it.isNotBlank() }.joinToString(" · "), style = LaoType.caption, color = c.inverseOnSurface)
                    }
                }
            }
            item { UpcomingAgenda(s, now) }
            item { LaoSection("优先事项", note = "${ranked.size} 项") }
            itemsIndexed(ranked) { _, entry ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f).clickable { s.closeSheet(); if (entry.course) CampusCourses.detail(a, entry.source) else CampusSchool.detail(a, entry.source) }) {
                        Text(entry.title, style = LaoType.cell)
                        Text(listOf(entry.day, entry.time.ifBlank { "全天" }, entry.reason).filter { it.isNotBlank() }.joinToString(" · "), style = LaoType.caption, color = c.onSurfaceVariant)
                    }
                    if (!entry.course) LaoCheck(a.done(entry.source), "完成 ${entry.title}") { a.mark(CampusJson.copy(entry.source)) }
                }
            }
            item { LaoSecondaryButton("全部安排", Modifier.fillMaxWidth()) { s.open("homework") } }
        }
        if (tab == "问捞捞") {
            item {
                audienceQuestions(LocalLaoStyle.current.id).chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        pair.forEach { text -> LaoSecondaryButton(text, Modifier.weight(1f)) { ask(text) } }
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }
            reply?.let { answer ->
                item { Text(question, style = LaoType.cell, color = c.primary); Text(answer.text, style = LaoType.body) }
                itemsIndexed(answer.entries) { _, entry ->
                    LaoSecondaryButton("${entry.day} ${entry.time.ifBlank { "全天" }} · ${entry.title}", Modifier.fillMaxWidth()) { s.closeSheet(); if (entry.course) CampusCourses.detail(a, entry.source) else CampusSchool.detail(a, entry.source) }
                }
                if (answer.action.isNotBlank()) item {
                    LaoPrimaryButton(if (answer.action == "paste") "粘贴导入" else routeTitle(answer.action), Modifier.fillMaxWidth()) {
                        s.closeSheet(); if (answer.action == "paste") CampusSocial.pasteImport(a) else s.open(answer.action)
                    }
                }
            }
        }
        if (tab == "工具") {
            item { AudienceWorkspace(s, CampusCourses.onDay(a.store, DateMath.today()), visibleTasks(a).filter { taskDate(it) == DateMath.today() }) }
            item {
                LaoSecondaryButton("粘贴消息到日历", Modifier.fillMaxWidth()) { s.closeSheet(); CampusSocial.pasteImport(a) }
                LaoSecondaryButton("习惯打卡", Modifier.fillMaxWidth()) { s.open("growth") }
                LaoSecondaryButton("自定义提醒", Modifier.fillMaxWidth()) { s.closeSheet(); CampusPhone.reminderForm(a, null) }
                LaoSecondaryButton("助手显示设置", Modifier.fillMaxWidth()) { s.closeSheet(); CampusGuide.settings(a) }
            }
        }
    }
    if (tab == "问捞捞") Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LaoInput(value = query, onValue = { query = it }, label = "", modifier = Modifier.weight(1f), placeholder = "问捞捞：明天有什么安排？")
        FilledIconButton(onClick = { ask(query) }, modifier = Modifier.size(48.dp), enabled = query.isNotBlank()) { Icon(Icons.AutoMirrored.Rounded.Send, "发送") }
    }
}