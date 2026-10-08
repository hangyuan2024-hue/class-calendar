package com.laolao.classcalendar

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import org.json.JSONObject

@Composable
internal fun LaoCalendarStudio(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val motion = LocalMotionEnabled.current
    var selected by rememberSaveable { mutableStateOf(s.a.selectedDay) }
    var monthly by rememberSaveable { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf("全部") }
    val parts = DateMath.parts(selected)
    val courses = CampusCourses.onDay(s.a.store, selected)
    val tasks = visibleTasks(s.a).filter { taskDate(it) == selected }
    val displayedTasks = tasks.filter { CampusSchool.visible(s.a, it) }
    val done = tasks.count { s.a.done(it) }
    val entries =
        (courses.map { Triple(it.optString("t0"), true, it) } +
                displayedTasks.map { Triple(taskClock(it).ifBlank { "00:00" }, false, it) })
            .filter {
                filter == "全部" || (it.second && filter == "课程") || (!it.second && filter == "事项")
            }
            .sortedBy { it.first }
    fun select(day: String) {
        selected = day
        s.a.selectedDay = day
    }
    fun move(n: Int) {
        select(calendarShift(selected, monthly, n))
    }
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "calendar3-heading") {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${parts[1]}月", style = LaoType.headline)
                    Text(
                        "${parts[0]} · 把日子安排明白",
                        style = LaoType.label,
                        color = c.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                LaoIconButton(
                    Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                    if (monthly) "上个月" else "上一周",
                    Modifier.size(40.dp),
                ) {
                    move(-1)
                }
                LaoIconButton(
                    Icons.AutoMirrored.Rounded.KeyboardArrowRight,
                    if (monthly) "下个月" else "下一周",
                    Modifier.size(40.dp),
                ) {
                    move(1)
                }
                Box(
                    Modifier.clip(CircleShape)
                        .background(c.surface.copy(alpha = .75f))
                        .border(1.dp, c.outlineVariant.copy(alpha = .5f), CircleShape)
                        .laoTap(role = Role.Button) { monthly = !monthly }
                        .semantics { contentDescription = if (monthly) "切换周视图" else "切换月视图" }
                        .padding(horizontal = 12.dp, vertical = 12.dp)
                ) {
                    Text(if (monthly) "周视图" else "月历", style = LaoType.caption)
                }
            }
        }
        animatedItem(1, "calendar3-date-window") {
            var distance by remember { mutableFloatStateOf(0f) }
            Column(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(
                        Brush.verticalGradient(
                            listOf(
                                c.surface.copy(alpha = .85f),
                                lerp(c.surface, c.primary, .03f).copy(alpha = .65f),
                            )
                        )
                    )
                    .border(1.dp, c.outlineVariant.copy(alpha = .45f), RoundedCornerShape(24.dp))
                    .pointerInput(monthly, selected) {
                        detectHorizontalDragGestures(
                            onDragStart = { distance = 0f },
                            onDragCancel = { distance = 0f },
                            onDragEnd = {
                                if (kotlin.math.abs(distance) > 56.dp.toPx())
                                    move(if (distance < 0) 1 else -1)
                                distance = 0f
                            },
                            onHorizontalDrag = { change, delta ->
                                change.consume()
                                distance += delta
                            },
                        )
                    }
                    .animateContentSize(
                        if (LocalMotionEnabled.current) spring(.9f, 350f) else snap()
                    )
                    .padding(8.dp)
            ) {
                val window =
                    monthly to
                        if (monthly) selected.take(7) + "-01" else CampusCourses.monday(selected)
                AnimatedContent(
                    window,
                    transitionSpec = {
                        if (motion)
                            (fadeIn(tween(180)) +
                                    slideInHorizontally(spring(.9f, 400f)) { it / 24 })
                                .togetherWith(fadeOut(tween(100)))
                        else EnterTransition.None.togetherWith(ExitTransition.None)
                    },
                    label = "calendar date window",
                ) { target ->
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (target.first)
                            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                                listOf("一", "二", "三", "四", "五", "六", "日").forEach {
                                    Text(
                                        it,
                                        Modifier.weight(1f),
                                        style = LaoType.label,
                                        color = c.onSurfaceVariant,
                                        textAlign = TextAlign.Center,
                                    )
                                }
                            }
                        val dates =
                            if (target.first)
                                DateMath.parts(target.second).let { calendarRows(it[0], it[1]) }
                            else listOf(List(7) { DateMath.plus(target.second, it) })
                        dates.forEach { week ->
                            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                week.forEachIndexed { i, day ->
                                    val hasClass =
                                        day != null &&
                                            CampusCourses.onDay(s.a.store, day).isNotEmpty()
                                    val hasTask =
                                        day != null && visibleTasks(s.a).any { taskDate(it) == day }
                                    DateStudioCell(
                                        day,
                                        selected,
                                        if (target.first) null
                                        else listOf("一", "二", "三", "四", "五", "六", "日")[i],
                                        hasClass,
                                        hasTask,
                                        Modifier.weight(1f),
                                    ) {
                                        select(it)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        animatedItem(2, "calendar3-import") {
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(c.primary.copy(alpha = .065f))
                    .laoTap(role = Role.Button) { CampusSocial.pasteImport(s.a) }
                    .semantics(mergeDescendants = true) { contentDescription = "粘贴导入" }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(Icons.Rounded.ContentPaste, null, Modifier.size(24.dp), tint = c.primary)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text("粘贴导入", style = LaoType.cell, color = c.primary)
                    Text("班群消息，核对后变成日程", style = LaoType.label, color = c.onSurfaceVariant)
                }
                Icon(Icons.Rounded.NorthEast, null, Modifier.size(18.dp), tint = c.primary)
            }
        }
        animatedItem(3, "calendar3-day-summary") {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            if (selected == DateMath.today()) "今天的安排"
                            else "${parts[1]}月${parts[2]}日",
                            style = LaoType.title,
                        )
                        Text(
                            "${courses.size} 节课 · ${tasks.size} 项事项" +
                                if (tasks.isNotEmpty()) " · 完成 $done/${tasks.size}" else "",
                            style = LaoType.label,
                            color = c.onSurfaceVariant,
                            maxLines = 2,
                        )
                    }
                    if (selected != DateMath.today())
                        LaoTextAction("今天") { select(DateMath.today()) }
                    LaoTextAction("完整课表") { s.open("courses") }
                    LaoIconButton(Icons.Rounded.Add, "记一件事", Modifier.size(40.dp)) {
                        s.a.selectedDay = selected
                        CampusSchool.personalForm(s.a, null)
                    }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    listOf(
                            "全部" to courses.size + tasks.size,
                            "课程" to courses.size,
                            "事项" to tasks.size,
                        )
                        .forEach { (label, count) ->
                            val on = label == filter
                            Row(
                                Modifier.weight(1f)
                                    .clip(CircleShape)
                                    .background(
                                        if (on) c.onSurface else c.surface.copy(alpha = .55f)
                                    )
                                    .laoTap(role = Role.Tab) { filter = label }
                                    .semantics {
                                        this.selected = on
                                        contentDescription = "日历筛选：" + label
                                    }
                                    .padding(horizontal = 12.dp, vertical = 10.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement =
                                    Arrangement.spacedBy(4.dp, Alignment.CenterHorizontally),
                                // Equal targets keep the three filters reachable on narrow screens.
                            ) {
                                Text(
                                    label,
                                    style = LaoType.caption,
                                    color = if (on) c.surface else c.onSurfaceVariant,
                                )
                                Text(
                                    count.toString(),
                                    style = LaoType.label.copy(fontFamily = LaoDisplayFont),
                                    color =
                                        if (on) c.surface.copy(alpha = .6f)
                                        else c.onSurfaceVariant.copy(alpha = .65f),
                                )
                            }
                        }
                }
            }
        }
        if (entries.isEmpty())
            animatedItem(4, "calendar3-empty-" + selected + filter) {
                LaoEmpty(
                    if (filter == "课程") "这一天没有课程"
                    else if (filter == "事项") "这一天没有事项" else "给这一天，留一点空白",
                    if (filter == "课程") "添加课程，或导入你的学期课表。" else "记一件事，或粘贴班群消息，让安排有迹可循。",
                    if (filter == "课程") "完整课表" else "记一件事",
                ) {
                    if (filter == "课程") s.open("courses")
                    else {
                        s.a.selectedDay = selected
                        CampusSchool.personalForm(s.a, null)
                    }
                }
            }
        entries.forEachIndexed { index, (clock, course, item) ->
            animatedItem(
                index + 4,
                "calendar3-" +
                    selected +
                    "-" +
                    course +
                    "-" +
                    item.optString("id", index.toString()),
            ) {
                AgendaStudioCell(s, clock, course, item)
            }
        }
        if (entries.isNotEmpty())
            animatedItem(entries.size + 4, "calendar3-tail") {
                Row(
                    Modifier.fillMaxWidth().padding(vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(4.dp).background(c.primary.copy(alpha = .5f), CircleShape))
                    Text("每一件小事，都值得被好好安排。", style = LaoType.label, color = c.onSurfaceVariant)
                }
            }
    }
}

@Composable
private fun RowScope.DateStudioCell(
    day: String?,
    selected: String,
    weekday: String?,
    course: Boolean,
    task: Boolean,
    modifier: Modifier,
    pick: (String) -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val on = day == selected
    val today = day == DateMath.today()
    val background by
        animateColorAsState(
            if (on) c.onSurface else Color.Transparent,
            if (LocalMotionEnabled.current) tween(180) else snap(),
            label = "date selection",
        )
    Column(
        modifier
            .heightIn(min = if (weekday == null) 48.dp else 68.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(background)
            .border(
                1.dp,
                if (today && !on) c.primary.copy(alpha = .4f) else Color.Transparent,
                RoundedCornerShape(16.dp),
            )
            .laoTap(role = Role.RadioButton, enabled = day != null) { day?.let(pick) }
            .semantics {
                this.selected = on
                if (day != null) contentDescription = "选择日期" + day
            }
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (weekday != null)
            Text(
                weekday,
                style = LaoType.label,
                color = if (on) c.surface.copy(alpha = .55f) else c.onSurfaceVariant,
            )
        Text(
            day?.substringAfterLast('-')?.toIntOrNull()?.toString().orEmpty(),
            style = LaoType.cell.copy(fontFamily = LaoDisplayFont),
            color = if (on) c.surface else if (today) c.primary else c.onSurface,
        )
        Row(Modifier.height(4.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            if (course)
                Box(Modifier.size(4.dp).background(if (on) c.surface else c.primary, CircleShape))
            if (task)
                Box(
                    Modifier.size(4.dp)
                        .background(
                            if (on) c.surface.copy(alpha = .5f)
                            else CampusAccent.readable(CampusAccent.berry),
                            CircleShape,
                        )
                )
        }
    }
}

@Composable
private fun AgendaStudioCell(s: CampusSession, clock: String, course: Boolean, item: JSONObject) {
    val c = MaterialTheme.colorScheme
    val completed = !course && s.a.done(item)
    val hue =
        if (course) CampusAccent.readable(CampusAccent.blue)
        else CampusAccent.readable(CampusAccent.berry)
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(
            Modifier.width(44.dp).padding(top = 16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                if (clock == "00:00") "全天" else clock,
                style = LaoType.caption.copy(fontFamily = LaoDisplayFont),
                color = c.onSurface,
            )
            if (course)
                Text(
                    item.optString("t1"),
                    style = LaoType.label.copy(fontFamily = LaoDisplayFont),
                    color = c.onSurfaceVariant,
                )
        }
        Row(
            Modifier.weight(1f)
                .clip(RoundedCornerShape(22.dp))
                .background(c.surface.copy(alpha = if (completed) .55f else .92f))
                .border(1.dp, c.outlineVariant.copy(alpha = .4f), RoundedCornerShape(22.dp))
                .laoTap {
                    if (course) CampusCourses.detail(s.a, item) else CampusSchool.detail(s.a, item)
                }
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Box(
                Modifier.width(3.dp)
                    .height(32.dp)
                    .background(hue.copy(alpha = if (completed) .35f else .8f), CircleShape)
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    if (course) item.optString("name") else taskTitle(item),
                    style =
                        LaoType.cell.copy(
                            textDecoration =
                                if (completed) TextDecoration.LineThrough else TextDecoration.None
                        ),
                    color = if (completed) c.onSurfaceVariant else c.onSurface,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (course) item.optString("location").ifBlank { "教室待确认" }
                    else item.optString("msg_type", "事项") + " · " + if (completed) "已完成" else "待完成",
                    style = LaoType.caption,
                    color = c.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (!course)
                LaoCheck(completed, "完成 " + taskTitle(item)) { s.a.mark(CampusJson.copy(item)) }
            else Icon(Icons.Rounded.NorthEast, null, Modifier.size(16.dp), tint = hue)
        }
    }
}
