package com.laolao.classcalendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laolao.classcalendar.model.AgendaItem
import com.laolao.classcalendar.model.Kind
import com.laolao.classcalendar.model.WEEKDAYS
import com.laolao.classcalendar.model.parseEventTime
import com.laolao.classcalendar.model.parseHm
import java.time.LocalDate
import java.time.YearMonth
import java.time.temporal.ChronoUnit

@Composable
fun CalendarScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    var month by remember { mutableStateOf(YearMonth.now()) }
    var sel by remember { mutableStateOf(LocalDate.now()) }
    var edit by remember { mutableStateOf<AgendaItem?>(null) }
    val now = nowMinutes()
    val items = repo.agenda(sel)
    LazyColumn(contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Card0 {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton({ month = month.minusMonths(1) }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "上个月") }
                    Text("${month.year}年${month.monthValue}月", fontWeight = FontWeight.Bold, fontSize = 18.sp, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                    IconButton({ month = month.plusMonths(1) }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "下个月") }
                }
                Row { WEEKDAYS.forEach { Text(it.drop(1), Modifier.weight(1f), textAlign = TextAlign.Center, fontSize = 12.sp, color = c.muted) } }
                val first = month.atDay(1)
                val offset = first.dayOfWeek.value - 1
                val cells = (0 until ((offset + month.lengthOfMonth() + 6) / 7) * 7).map { first.plusDays((it - offset).toLong()) }
                cells.chunked(7).forEach { week ->
                    Row {
                        week.forEach { d ->
                            val inMonth = d.month == month.month
                            val n = if (inMonth) repo.agenda(d).size else 0
                            val isSel = d == sel; val isToday = d == LocalDate.now()
                            Column(Modifier.weight(1f).aspectRatio(1f).padding(2.dp).clip(RoundedCornerShape(12.dp))
                                .background(if (isSel) c.accent else androidx.compose.ui.graphics.Color.Transparent)
                                .then(if (isToday && !isSel) Modifier.border(1.dp, c.accent, RoundedCornerShape(12.dp)) else Modifier)
                                .clickable { sel = d }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                                Text("${d.dayOfMonth}", color = when { isSel -> c.card; inMonth -> c.ink; else -> c.muted.copy(alpha = .4f) }, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal)
                                if (n > 0) Box(Modifier.size(5.dp).background(if (isSel) c.card else c.accent2, CircleShape))
                            }
                        }
                    }
                }
                TextButton({ month = YearMonth.now(); sel = LocalDate.now() }) { Text("回到今天") }
            }
        }
        item { SectionTitle("${sel.monthValue}月${sel.dayOfMonth}日 ${WEEKDAYS[sel.dayOfWeek.value - 1]} · ${items.size} 项") }
        if (items.isEmpty()) item { Card0 { Empty("这天没有安排", "点右下角 + 新建") } }
        items(items, key = { it.id + it.kind }) { a ->
            AgendaRow(a, sel == LocalDate.now() && a.start != null && a.start <= now && (a.end ?: a.start) > now) { edit = a }
        }
    }
    edit?.let { a -> if (a.kind == Kind.EVENT) EventEditor(a) { edit = null } else ItemDetail(a) { edit = null } }
}

@Composable
fun TodosScreen() {
    val repo = LocalRepo.current; LocalTick.current
    var showDone by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf<AgendaItem?>(null) }
    val all = repo.allItems().sortedWith(compareBy({ it.date }, { it.start ?: Int.MAX_VALUE }))
    val list = all.filter { showDone || !it.done }
    LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!showDone, { showDone = false }, label = { Text("未完成 ${all.count { !it.done }}") })
                FilterChip(showDone, { showDone = true }, label = { Text("全部 ${all.size}") })
            }
        }
        if (list.isEmpty()) item { Card0 { Empty("没有待办", "点右下角 + 新建") } }
        list.groupBy { it.date }.forEach { (d, rows) ->
            item(key = "h$d") { SectionTitle(dayTitle(d)) }
            items(rows, key = { it.id + it.kind }) { a -> AgendaRow(a, false) { edit = a } }
        }
    }
    edit?.let { a -> if (a.kind == Kind.EVENT) EventEditor(a) { edit = null } else ItemDetail(a) { edit = null } }
}

fun dayTitle(d: LocalDate): String = when (d) {
    LocalDate.MAX -> "未定日期"
    LocalDate.now() -> "今天"
    LocalDate.now().plusDays(1) -> "明天"
    else -> "${d.monthValue}月${d.dayOfMonth}日 ${WEEKDAYS[d.dayOfWeek.value - 1]}"
}

@Composable
fun CountdownScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    val today = LocalDate.now()
    val list = repo.personal().mapNotNull { e -> parseEventTime(e.optString("event_time"))?.first?.takeIf { !it.isBefore(today) }?.let { it to e.optString("subject") } }.sortedBy { it.first }
    LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("所有未来的个人事项都会在这里倒数。点 + 新建一个日期。", color = c.muted, fontSize = 13.sp) }
        if (list.isEmpty()) item { Card0 { Empty("还没有倒数日", "新建一个带日期的事项") } }
        items(list) { (d, t) ->
            Card0 {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text(t, fontWeight = FontWeight.Bold); Text(d.toString(), color = c.muted, fontSize = 12.sp) }
                    val n = ChronoUnit.DAYS.between(today, d)
                    Text(if (n == 0L) "就是今天" else "还有 $n 天", color = c.accent, fontWeight = FontWeight.Bold, fontSize = 18.sp, fontFamily = Display)
                }
            }
        }
    }
}

/** 新建 / 编辑自己的事项（和网站、小程序同步：personal_events_v1）。日期时间用系统的选择器，不用手打 */
@Composable
fun EventEditor(item: AgendaItem?, homework: Boolean = false, onClose: () -> Unit) {
    val repo = LocalRepo.current
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var title by remember { mutableStateOf(item?.title ?: "") }
    var date by remember { mutableStateOf<LocalDate?>(if (item == null) LocalDate.now() else item.date.takeIf { it != LocalDate.MAX }) }
    var time by remember { mutableStateOf(item?.start?.let { com.laolao.classcalendar.model.fmt(it) } ?: "") }
    var place by remember { mutableStateOf(item?.place ?: "") }
    var note by remember { mutableStateOf(item?.note ?: "") }
    var hw by remember { mutableStateOf(item?.isHomework ?: homework) }
    var err by remember { mutableStateOf<String?>(null) }
    fun pickDate() {
        val d = date ?: LocalDate.now()
        android.app.DatePickerDialog(ctx, { _, y, m, dd -> date = LocalDate.of(y, m + 1, dd) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
    }
    fun pickTime() {
        val m = parseHm(time) ?: (8 * 60)
        android.app.TimePickerDialog(ctx, { _, h, mi -> time = "%02d:%02d".format(h, mi) }, m / 60, m % 60, true).show()
    }
    AlertDialog(onDismissRequest = onClose, title = { Text(if (item == null) (if (homework) "记一项作业" else "新建待办 / 日程") else "编辑事项") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(title, { title = it.take(60) }, label = { Text(if (hw) "作业内容" else "事项名称") }, singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton({ pickDate() }, Modifier.weight(1.3f)) {
                        Text(date?.let { "${it.monthValue}月${it.dayOfMonth}日 ${WEEKDAYS[it.dayOfWeek.value - 1]}" } ?: "选日期", maxLines = 1)
                    }
                    OutlinedButton({ pickTime() }, Modifier.weight(1f)) { Text(time.ifBlank { "全天" }, maxLines = 1) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("今天" to 0L, "明天" to 1L, "后天" to 2L).forEach { (l, n) ->
                        AssistChip({ date = LocalDate.now().plusDays(n) }, { Text(l, fontSize = 12.sp) })
                    }
                    if (time.isNotBlank()) AssistChip({ time = "" }, { Text("改成全天", fontSize = 12.sp) })
                    if (date != null) AssistChip({ date = null; time = "" }, { Text("不定日期", fontSize = 12.sp) })
                }
                OutlinedTextField(place, { place = it.take(40) }, label = { Text("地点（可选）") }, singleLine = true)
                OutlinedTextField(note, { note = it.take(300) }, label = { Text("备注（可选）") })
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(hw, { hw = it })
                    Text("这是作业（截止前提醒，显示在作业页）", fontSize = 13.sp)
                }
                err?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton({
                when {
                    title.isBlank() -> err = "请填写" + (if (hw) "作业内容" else "事项名称")
                    else -> { repo.saveEvent(item?.id, title, date, if (date == null) "" else time.trim(), place, note, homework = hw); onClose() }
                }
            }) { Text("保存") }
        },
        dismissButton = {
            Row {
                if (item != null) TextButton({ repo.deleteEvent(item.id); onClose() }) { Text("删除", color = MaterialTheme.colorScheme.error) }
                TextButton(onClose) { Text("取消") }
            }
        })
}
