package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.*
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

@Composable
internal fun DayTimeline(s: CampusSession, entries: List<DailyAgendaEntry>, now: Long) {
    val c = MaterialTheme.colorScheme
    val wall = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai")).apply { timeInMillis = now }
    val clock = String.format(Locale.US, "%02d:%02d", wall.get(Calendar.HOUR_OF_DAY), wall.get(Calendar.MINUTE))
    Column(Modifier.fillMaxWidth().border(1.dp, c.outlineVariant, RoundedCornerShape(8.dp)).padding(horizontal = 10.dp)) {
        var collapsed by rememberSaveable { mutableStateOf(false) }
        Row(Modifier.fillMaxWidth().padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("今日时间轴", Modifier.weight(1f), style = LaoType.cell)
            Text("00:00 — 24:00", style = LaoType.caption, color = c.onSurfaceVariant)
            LaoTextAction(if (collapsed) "展开" else "收起") { collapsed = !collapsed }
        }
        if (collapsed) {
            val pending = entries.count { !it.course && !s.a.done(it.item) }
            val upcoming = entries.filter { it.clock.isNotBlank() && it.clock > clock }.minByOrNull { it.clock } ?: entries.lastOrNull()
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                    .laoTap(role = Role.Button, action = { collapsed = false }).padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("${entries.size} 项安排" + if (pending > 0) " · 待完成 $pending 项" else "", style = LaoType.cell)
                    if (upcoming != null) Text(
                        upcoming.clock.ifBlank { "全天" } + " " +
                            (if (upcoming.course) upcoming.item.optString("name") else taskTitle(upcoming.item)) +
                            " · 点击展开",
                        style = LaoType.caption, color = c.onSurfaceVariant,
                    )
                }
                LaoTextAction("展开") { collapsed = false }
            }
        } else {
            if (entries.isEmpty()) Text("没有匹配的安排", Modifier.padding(vertical = 16.dp), style = LaoType.body, color = c.onSurfaceVariant)
            entries.filter { it.clock.isBlank() }.forEach { TimelineEvent(s, it, clock) }
            val timed = entries.filter { it.clock.isNotBlank() }.sortedBy { it.clock }
            timed.filter { it.clock <= clock }.forEach { TimelineEvent(s, it, clock) }
            Row(Modifier.fillMaxWidth().padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(clock, Modifier.width(46.dp), style = LaoType.caption, color = c.primary)
                Box(Modifier.width(22.dp), contentAlignment = Alignment.Center) { Box(Modifier.size(9.dp).background(c.primary, CircleShape)) }
                HorizontalDivider(Modifier.width(16.dp), color = c.primary)
                Text("现在", Modifier.padding(start = 6.dp), style = LaoType.caption, color = c.primary)
                HorizontalDivider(Modifier.weight(1f).padding(start = 8.dp), color = c.primary.copy(alpha = .35f))
            }
            timed.filter { it.clock > clock }.forEach { TimelineEvent(s, it, clock) }
            Row(Modifier.fillMaxWidth().padding(vertical = 14.dp)) {
                Text("24:00", Modifier.width(68.dp), style = LaoType.caption, color = c.onSurfaceVariant)
                Text("今日结束", style = LaoType.caption, color = c.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun TimelineEvent(s: CampusSession, entry: DailyAgendaEntry, clock: String) {
    val c = MaterialTheme.colorScheme
    val hue = if (entry.course) c.primary else c.secondary
    val done = !entry.course && s.a.done(entry.item)
    val end = entry.item.optString("t1")
    val live = entry.course && entry.clock <= clock && end > clock
    val title = if (entry.course) entry.item.optString("name") else taskTitle(entry.item)
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), verticalAlignment = Alignment.Top) {
        Column(Modifier.width(46.dp).padding(top = 15.dp)) {
            Text(entry.clock.ifBlank { "全天" }, style = LaoType.caption, color = hue)
            if (entry.course) Text(end, style = LaoType.label, color = c.onSurfaceVariant)
        }
        Box(Modifier.width(22.dp).fillMaxHeight().drawBehind {
            drawLine(c.outlineVariant, Offset(size.width / 2, 0f), Offset(size.width / 2, size.height), 1.dp.toPx())
        }.padding(top = 19.dp), contentAlignment = Alignment.TopCenter) {
            Box(Modifier.size(8.dp).background(if (done) c.outline else hue, CircleShape))
        }
        Column(Modifier.weight(1f).clickable {
            if (entry.course) CampusCourses.detail(s.a, entry.item) else CampusSchool.detail(s.a, entry.item)
        }.padding(start = 6.dp, top = 12.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = LaoType.cell, color = if (done) c.onSurfaceVariant else c.onSurface, textDecoration = if (done) TextDecoration.LineThrough else null)
            Text(listOf(if (entry.course) "课程" else entry.item.optString("msg_type", "事项"), entry.item.optString("location"), if (entry.course) entry.item.optString("teacher") else "").filter { it.isNotBlank() }.joinToString(" · "), style = LaoType.caption, color = c.onSurfaceVariant)
            val note = if (entry.course) "" else entry.item.optString("summary", entry.item.optString("note"))
            if (note.isNotBlank()) Text(note, style = LaoType.body, color = c.onSurfaceVariant)
            if (live) Text("正在进行 · $end 结束", style = LaoType.caption, color = c.primary)
            if (done) Text("已完成", style = LaoType.caption, color = c.onSurfaceVariant)
        }
        Box(Modifier.padding(top = 6.dp)) {
            if (entry.course) LaoIconButton(Icons.Rounded.ChevronRight, "查看$title", Modifier.size(36.dp)) { CampusCourses.detail(s.a, entry.item) }
            else LaoCheck(done, "完成$title") { s.a.mark(CampusJson.copy(entry.item)) }
        }
    }
}