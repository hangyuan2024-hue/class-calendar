package com.laolao.classcalendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laolao.classcalendar.model.AgendaItem
import com.laolao.classcalendar.model.AgendaModel
import com.laolao.classcalendar.model.Kind
import com.laolao.classcalendar.model.fmt
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.LocalTime

@Composable
fun kindColor(k: Kind): Color = when (k) { Kind.COURSE -> LocalLao.current.accent; Kind.EVENT -> LocalLao.current.accent2; Kind.CLASS -> Color(0xFF22A06B) }

@Composable
fun nowMinutes(): Int {
    var now by remember { mutableIntStateOf(LocalTime.now().let { it.hour * 60 + it.minute }) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = LocalTime.now().let { it.hour * 60 + it.minute } } }
    return now
}

data class Shortcut(val label: String, val icon: ImageVector, val route: String)

fun shortcutsFor(identity: String) = when (identity) {
    "teacher" -> listOf(Shortcut("我的班级", Icons.Rounded.Groups, "class"), Shortcut("授课表", Icons.Rounded.TableChart, "courses"),
        Shortcut("学生排行", Icons.Rounded.Leaderboard, "rank"), Shortcut("待办", Icons.Rounded.Checklist, "todos"))
    "other" -> listOf(Shortcut("日程", Icons.Rounded.Event, "todos"), Shortcut("倒数日", Icons.Rounded.HourglassBottom, "countdown"),
        Shortcut("专注", Icons.Rounded.Timer, "pomodoro"), Shortcut("团队", Icons.Rounded.Groups, "class"))
    else -> listOf(Shortcut("课程表", Icons.Rounded.TableChart, "courses"), Shortcut("待办", Icons.Rounded.Checklist, "todos"),
        Shortcut("番茄钟", Icons.Rounded.Timer, "pomodoro"), Shortcut("班级", Icons.Rounded.Groups, "class"))
}

@Composable
fun HomeScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    val nav = LocalNav.current
    val busy by repo.busy.collectAsState()
    val p = repo.profile()
    val now = nowMinutes()
    val today = LocalDate.now()
    // After 21:00 with nothing left today, show tomorrow (same rule as the website).
    val todayItems = repo.agenda(today)
    val lastToday = todayItems.mapNotNull { it.end ?: it.start }.maxOrNull() ?: 0
    val showTomorrow = now >= 21 * 60 && lastToday <= now
    val day = if (showTomorrow) today.plusDays(1) else today
    val all = if (showTomorrow) repo.agenda(day) else todayItems
    var filter by remember { mutableStateOf(repo.pref("home_filter", "all")) }
    val items = when (filter) { "course" -> all.filter { it.kind == Kind.COURSE }; "other" -> all.filter { it.kind != Kind.COURSE }; else -> all }
    var collapsed by remember { mutableStateOf(repo.pref("timeline_collapsed", "no") == "yes") }
    var edit by remember { mutableStateOf<AgendaItem?>(null) }
    var board by remember { mutableStateOf(false) }
    val (cur, next) = AgendaModel.current(if (showTomorrow) emptyList() else all, now)

    Box(Modifier.fillMaxSize()) {
        LazyColumn(contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(greeting(now) + "，" + p.name, style = MaterialTheme.typography.headlineMedium)
                        Text("${today.monthValue}月${today.dayOfMonth}日 ${com.laolao.classcalendar.model.WEEKDAYS[today.dayOfWeek.value - 1]} · 第${repo.meta().week(today)}周 · ${p.identityLabel}",
                            color = c.muted, fontSize = 13.sp)
                    }
                    if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                }
            }
            item {
                Card0 {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (showTomorrow) "明日时间轴" else "今日时间轴", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        TextButton(onClick = { collapsed = !collapsed; repo.setPref("timeline_collapsed", if (collapsed) "yes" else "no") }) {
                            Text(if (collapsed) "展开" else "收起")
                        }
                    }
                    if (collapsed) {
                        val left = items.count { !it.done && (it.start == null || (it.end ?: it.start) > now || showTomorrow) }
                        Text("共 ${items.size} 项 · 待完成 $left 项" + (next?.let { " · 下一项 ${fmt(it.start!!)} ${it.title}" } ?: ""),
                            color = c.muted, fontSize = 13.sp, modifier = Modifier.clickable { collapsed = false; repo.setPref("timeline_collapsed", "no") })
                    } else TimelineBar(items, if (showTomorrow) -1 else now)
                }
            }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("all" to "全部", "course" to "只看课程", "other" to "只看其他事项").forEach { (id, l) ->
                        FilterChip(filter == id, { filter = id; repo.setPref("home_filter", id) }, label = { Text(l) })
                    }
                }
            }
            if (items.isEmpty()) item { Card0 { Empty(if (showTomorrow) "明天还没有安排" else "今天没有安排", "点右下角 + 新建待办或添加课程") } }
            items(items, key = { it.id + it.kind }) { a -> AgendaRow(a, a == cur, onClick = { edit = a }) }
            item {
                Card0 {
                    val courses = all.count { it.kind == Kind.COURSE }
                    val label = when (p.identity) { "teacher" -> "节授课"; "other" -> "项日程"; else -> "节课" }
                    Text("汇总", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        Stat("${if (p.identity == "other") all.size else courses}", label)
                        Stat("${all.count { it.kind == Kind.EVENT }}", "个人事项")
                        Stat("${all.count { it.kind == Kind.CLASS }}", "班级事项")
                        Stat("${all.count { it.done }}", "已完成")
                    }
                    cur?.let { Text("正在进行：${it.title}（${it.timeText}）", color = c.accent, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
                    if (cur == null) next?.let { Text("下一项：${fmt(it.start!!)} ${it.title}，还有 ${it.start - now} 分钟", color = c.accent, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
                }
            }
            item { SectionTitle("常用") }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    shortcutsFor(p.identity).forEach { s ->
                        Card0(Modifier.weight(1f), onClick = { nav.navigate(s.route) }) {
                            Icon(s.icon, null, tint = c.accent); Spacer(Modifier.height(6.dp)); Text(s.label, fontSize = 13.sp, maxLines = 1)
                        }
                    }
                }
            }
        }
        Companion(Modifier.align(Alignment.BottomStart).padding(16.dp)) { board = true }
    }
    edit?.let { a -> if (a.kind == Kind.EVENT) EventEditor(a) { edit = null } else ItemDetail(a) { edit = null } }
    if (board) Blackboard(next ?: cur) { board = false }
}

fun greeting(m: Int) = when { m < 5 * 60 -> "夜深了"; m < 11 * 60 -> "早上好"; m < 13 * 60 -> "中午好"; m < 18 * 60 -> "下午好"; else -> "晚上好" }

@Composable
private fun Stat(n: String, l: String) = Column {
    Text(n, fontSize = 22.sp, fontWeight = FontWeight.Bold, fontFamily = Display)
    Text(l, fontSize = 11.sp, color = LocalLao.current.muted)
}

/** Horizontal day bar: each item drawn at its time, labels in lanes so simultaneous events never overlap. */
@Composable
fun TimelineBar(items: List<AgendaItem>, now: Int) {
    val c = LocalLao.current
    val timed = items.filter { it.start != null }
    val from = minOf(7 * 60, (timed.minOfOrNull { it.start!! } ?: 480) / 60 * 60)
    val to = maxOf(22 * 60, ((timed.maxOfOrNull { it.end ?: it.start!! } ?: 1200) + 59) / 60 * 60)
    val pxPerMin = 1.4f
    val width = ((to - from) * pxPerMin).dp
    // lane assignment
    val lanes = mutableListOf<Int>()
    val laneOf = timed.associateWith { a ->
        val s = a.start!!; val e = maxOf(a.end ?: s, s + 50)
        val i = lanes.indexOfFirst { it <= s }
        if (i >= 0) { lanes[i] = e; i } else { lanes += e; lanes.size - 1 }
    }
    val laneCount = maxOf(1, lanes.size)
    val colors = timed.associateWith { kindColor(it.kind) }
    Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState(((maxOf(now, from) - from - 60).coerceAtLeast(0) * pxPerMin * 2.6f).toInt())).padding(vertical = 6.dp)) {
        Column(Modifier.width(width)) {
            Canvas(Modifier.width(width).height(18.dp)) {
                drawRoundRect(c.tint, size = Size(size.width, 10.dp.toPx()), topLeft = Offset(0f, 4.dp.toPx()), cornerRadius = CornerRadius(20f))
                timed.forEach { a ->
                    val x0 = (a.start!! - from) * pxPerMin * density; val x1 = ((a.end ?: (a.start + 30)) - from) * pxPerMin * density
                    drawRoundRect(colors[a]!!.copy(alpha = if (a.done) .35f else .9f), topLeft = Offset(x0, 4.dp.toPx()), size = Size(maxOf(6f, x1 - x0), 10.dp.toPx()), cornerRadius = CornerRadius(20f))
                }
                if (now in from..to) {
                    val x = (now - from) * pxPerMin * density
                    drawLine(Color(0xFFE5484D), Offset(x, 0f), Offset(x, size.height), strokeWidth = 2.dp.toPx())
                    drawCircle(Color(0xFFE5484D), 4.dp.toPx(), Offset(x, 2.dp.toPx()))
                }
            }
            Box(Modifier.width(width).height(16.dp)) {
                for (h in from / 60..to / 60) Text("$h", fontSize = 10.sp, color = c.muted, modifier = Modifier.offset(x = ((h * 60 - from) * pxPerMin).dp - 4.dp))
            }
            Box(Modifier.width(width).height((laneCount * 44).dp)) {
                timed.forEach { a ->
                    val x = ((a.start!! - from) * pxPerMin).dp
                    Column(Modifier.offset(x = x, y = (laneOf[a]!! * 44).dp).widthIn(max = 150.dp)
                        .background(colors[a]!!.copy(alpha = .12f), RoundedCornerShape(8.dp)).padding(horizontal = 6.dp, vertical = 3.dp)) {
                        Text(fmt(a.start), fontSize = 10.sp, color = colors[a]!!, fontWeight = FontWeight.Bold)
                        Text(a.title, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, color = c.ink)
                    }
                }
            }
        }
    }
    val allDay = items.filter { it.start == null }
    if (allDay.isNotEmpty()) Text("全天：" + allDay.joinToString("、") { it.title }, fontSize = 12.sp, color = c.muted)
}

@Composable
fun AgendaRow(a: AgendaItem, active: Boolean, onClick: () -> Unit) {
    val c = LocalLao.current
    val repo = LocalRepo.current
    Card0(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.width(4.dp).height(40.dp).clip(RoundedCornerShape(4.dp)).background(kindColor(a.kind)))
            Spacer(Modifier.width(12.dp))
            Column(Modifier.width(78.dp)) {
                Text(a.timeText, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                if (active) Pill("进行中", Color(0xFFE5484D))
            }
            Column(Modifier.weight(1f)) {
                Text(a.title, fontWeight = FontWeight.SemiBold, color = if (a.done) c.muted else c.ink,
                    textDecoration = if (a.done) androidx.compose.ui.text.style.TextDecoration.LineThrough else null)
                val sub = listOf(a.kind.label, a.place, if (a.kind == Kind.COURSE) a.note else "").filter { it.isNotBlank() }.joinToString(" · ")
                Text(sub, fontSize = 12.sp, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            if (a.kind != Kind.COURSE) Checkbox(a.done, { repo.toggleDone(a.id) })
        }
    }
}

/** The blackboard companion carried over from the old app. */
@Composable
fun Companion(modifier: Modifier, onClick: () -> Unit) {
    val c = LocalLao.current
    Box(modifier.size(52.dp).clip(CircleShape).background(c.card).clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Text("🧑‍🏫", fontSize = 26.sp)
    }
}

@Composable
fun Blackboard(focus: AgendaItem?, onClose: () -> Unit) {
    val nav = LocalNav.current
    val tips = listOf("把大任务拆成 25 分钟一段，用番茄钟更容易开始。", "课前 10 分钟会收到提醒；如果收不到，去「我的 → 提醒与后台」检查。",
        "在网站或小程序里改过的待办，这里会自动同步。", "点首页时间轴右上角「收起」可以只看一行摘要。")
    AlertDialog(onDismissRequest = onClose, confirmButton = { TextButton(onClick = onClose) { Text("知道了") } },
        title = { Text("小黑板") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Surface(color = Color(0xFF26453A), shape = RoundedCornerShape(12.dp)) {
                    Text(focus?.let { "接下来：${it.timeText} ${it.title}" + if (it.place.isNotBlank()) "\n地点：${it.place}" else "" } ?: "接下来没有安排，休息一下吧",
                        color = Color.White, modifier = Modifier.padding(14.dp).fillMaxWidth())
                }
                Text("💡 " + tips[(System.currentTimeMillis() / 60000 % tips.size).toInt()], fontSize = 13.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip({ onClose(); nav.navigate("pomodoro") }, { Text("开始专注") })
                    AssistChip({ onClose(); nav.navigate("todos") }, { Text("看待办") })
                    AssistChip({ onClose(); nav.navigate("courses") }, { Text("课程表") })
                }
            }
        })
}

@Composable
fun ItemDetail(a: AgendaItem, onClose: () -> Unit) {
    AlertDialog(onDismissRequest = onClose, confirmButton = { TextButton(onClick = onClose) { Text("关闭") } }, title = { Text(a.title) },
        text = { Text(listOf("${a.kind.label} · ${a.date} ${a.timeText}", a.place.let { if (it.isBlank()) "" else "地点：$it" }, a.note).filter { it.isNotBlank() }.joinToString("\n")) })
}
