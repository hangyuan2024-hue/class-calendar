package com.laolao.classcalendar

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.unit.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import java.util.Calendar
import java.util.TimeZone

@Composable
internal fun rememberAgendaNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { now = System.currentTimeMillis(); delay(30000) }
        }
    }
    return now
}

@Composable
internal fun UpcomingAgenda(s: CampusSession, now: Long) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val wall = Calendar.getInstance(TimeZone.getTimeZone("Asia/Shanghai")).apply { timeInMillis = now }
    val day = DateMath.date(wall.get(Calendar.YEAR), wall.get(Calendar.MONTH) + 1, wall.get(Calendar.DAY_OF_MONTH))
    val minute = agendaMinute(day, String.format(java.util.Locale.US, "%02d:%02d", wall.get(Calendar.HOUR_OF_DAY), wall.get(Calendar.MINUTE))) ?: return
    val tasks = visibleTasks(a)
    val slots = (0..7).flatMap { offset ->
        val date = DateMath.plus(day, offset)
        upcomingSlots(date, CampusCourses.onDay(a.store, date), tasks, a::done)
    }
    val state = nextAgenda(slots, minute)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Rounded.Schedule, null, tint = c.primary, modifier = Modifier.size(18.dp))
            Text(if (state?.live == true) "正在进行" else "接下来", Modifier.weight(1f).padding(start = 8.dp), style = LaoType.cell)
            LaoTextAction("日历") { s.open("calendar") }
        }
        if (state == null) {
            Text("未来 7 天没有定时安排", style = LaoType.body, color = c.onSurfaceVariant)
            LaoSecondaryButton("安排一件事", Modifier.fillMaxWidth()) { a.selectedDay = day; CampusSchool.personalForm(a, null) }
        } else {
            val slot = state.slot
            val entry = slot.entry
            Text(if (entry.course) entry.item.optString("name") else taskTitle(entry.item), style = LaoType.title)
            Text(listOf(if (slot.day == day) "今天" else dateLabel(slot.day), entry.clock + if (entry.course) "–${entry.item.optString("t1")}" else "", entry.item.optString("location")).filter { it.isNotBlank() }.joinToString(" · "), style = LaoType.caption, color = c.onSurfaceVariant)
            LinearProgressIndicator(progress = { state.progress }, modifier = Modifier.fillMaxWidth().height(8.dp), color = c.primary, trackColor = c.primaryContainer)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (state.live) "已上课 ${minute - slot.start} 分钟" else "现在 ${String.format(java.util.Locale.US, "%02d:%02d", wall.get(Calendar.HOUR_OF_DAY), wall.get(Calendar.MINUTE))}", Modifier.weight(1f), style = LaoType.caption, color = c.onSurfaceVariant)
                Text(if (state.minutes == 0L) "就是现在" else "${if (state.minutes >= 60) "${state.minutes / 60} 小时 ${state.minutes % 60} 分钟" else "${state.minutes} 分钟"}${if (state.live) "后结束" else "后开始"}", style = LaoType.caption, color = c.primary)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LaoSecondaryButton("查看详情", Modifier.weight(1f)) { if (entry.course) CampusCourses.detail(a, entry.item) else CampusSchool.detail(a, entry.item) }
                if (!entry.course) LaoSecondaryButton("标记完成", Modifier.weight(1f)) { a.mark(CampusJson.copy(entry.item)) }
            }
        }
    }
}