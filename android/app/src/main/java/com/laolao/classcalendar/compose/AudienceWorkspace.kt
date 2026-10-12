package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import org.json.JSONObject

/** Audience changes emphasis, never access rights or the completeness of today's agenda. */
internal fun audienceTools(id: String): List<String> = when (id) {
    "mentor" -> listOf("class", "courses", "homework", "study", "reminders", "pomo")
    "business" -> listOf("homework", "calendar", "pomo", "class", "lan", "ledger")
    else -> listOf("courses", "homework", "pomo", "wrongbook", "countdown", "class")
}

internal fun audienceTitle(id: String) = when (id) {
    "mentor" -> "教学与协作"
    "business" -> "日程与行动"
    else -> "学习与成长"
}

@Composable
internal fun AudienceShortcuts(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val style = LocalLaoStyle.current
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        audienceTools(style.id).take(4).forEach { route ->
            Column(Modifier.weight(1f).clip(style.button).background(c.surface)
                .laoTap(role = Role.Button) { s.open(route) }.padding(vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(routeIcon(route), null, tint = c.primary, modifier = Modifier.size(22.dp))
                Text(when(route) { "class" -> if(style.id == "business") "团队" else "班级"; "homework" -> "待办"; "courses" -> "课表"; "wrongbook" -> "错题"; "pomo" -> "专注"; else -> routeTitle(route) },
                    style = LaoType.label, maxLines = 1)
            }
        }
    }
}

/** Audience shortcuts follow the complete agenda, never replace it. */
@Composable
internal fun DailyAudienceTools(s: CampusSession) {
    Column(Modifier.fillMaxWidth(), verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text(audienceTitle(LocalLaoStyle.current.id),style=LaoType.cell)
        AudienceShortcuts(s)
    }
}

/** Different work surfaces backed by the same records and permission checks. */
@Composable
internal fun AudienceWorkspace(s: CampusSession, courses: List<JSONObject>, tasks: List<JSONObject>) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val id = LocalLaoStyle.current.id
    val pending = tasks.filter { !a.done(it) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(audienceTitle(id), style = LaoType.cell)
        when (id) {
            "mentor" -> {
                Text("今日授课 ${courses.size} 节 · ${rows(a.store.list("cache_classes")).size} 个空间", style = LaoType.caption, color = c.onSurfaceVariant)
                Text(a.currentClass.optString("name").ifBlank { "尚未选择班级" }, style = LaoType.title)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoSecondaryButton("教学课表", Modifier.weight(1f)) { s.open("courses") }
                    LaoSecondaryButton("班级协作", Modifier.weight(1f)) { s.open("class") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoSecondaryButton("发布事项", Modifier.weight(1f)) {
                        when { !a.api.logged() -> s.open("login"); a.cid().isBlank() -> s.open("class"); a.can("can_ingest") -> CampusSchool.classForm(a, null); else -> s.notice = "当前空间没有发布事项权限" }
                    }
                    LaoSecondaryButton(if (a.teacher()) "成员审批" else "班级消息", Modifier.weight(1f)) {
                        if (a.cid().isBlank()) s.open("class") else s.open(if (a.teacher()) "members" else "wall")
                    }
                }
            }
            "business" -> {
                Text("今日行动 ${pending.size} 项 · 协作空间 ${rows(a.store.list("cache_classes")).size} 个", style = LaoType.caption, color = c.onSurfaceVariant)
                val meetingCount = pending.count { (taskTitle(it) + it.optString("msg_type")).contains(Regex("会议|讨论|会面|汇报")) }
                Text("会议与讨论 $meetingCount 项", style = LaoType.title)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoPrimaryButton("新建日程", Modifier.weight(1f)) { a.selectedDay = DateMath.today(); CampusSchool.personalForm(a, null) }
                    LaoSecondaryButton("团队协作", Modifier.weight(1f)) { s.open("class") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoSecondaryButton("行动清单", Modifier.weight(1f)) { s.open("homework") }
                    LaoSecondaryButton("专注时段", Modifier.weight(1f)) { s.open("pomo") }
                }
            }
            else -> {
                val homework = pending.count { it.optString("msg_type") == "作业" }
                Text("今日课程 ${courses.size} 节 · 待交作业 $homework 项", style = LaoType.caption, color = c.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoPrimaryButton("课程与资料", Modifier.weight(1f)) { s.open("study") }
                    LaoSecondaryButton("作业清单", Modifier.weight(1f)) { s.open("homework") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoSecondaryButton("错题复习", Modifier.weight(1f)) { s.open("wrongbook") }
                    LaoSecondaryButton("学习专注", Modifier.weight(1f)) { s.open("pomo") }
                }
            }
        }
    }
}
