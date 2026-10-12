package com.laolao.classcalendar

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import kotlin.math.*
import org.json.JSONObject

/** The mobile site's actual month, homework sections and growth layouts, drawn with Compose. */
@Composable
internal fun WebCalendarPage(s: CampusSession) {
    val c = WebDesign.colors()
    var selected by rememberSaveable { mutableStateOf(s.a.selectedDay) }
    var month by rememberSaveable { mutableStateOf(selected.take(7) + "-01") }
    val parts = DateMath.parts(month)
    val prefs = s.a.store.`object`("fun_opts_v1")
    val hideDone = prefs.optBoolean("hideDone")
    val tasks = visibleTasks(s.a).filter { !hideDone || !s.a.done(it) }
    val dayTasks = tasks.filter { taskDate(it) == selected && CampusSchool.visible(s.a, it) }
    val undated = tasks.filter { taskDate(it).isBlank() }
    val courses = CampusCourseAdjust.onDay(s.a.store, selected)
    LaunchedEffect(s.a.store, s.a.cid()) { CampusItemExtras.refresh(s.a) }
    fun select(day: String) {
        selected = day
        s.a.selectedDay = day
    }
    fun move(delta: Int) {
        month = calendarShift(month, true, delta).take(7) + "-01"
    }
    WebPage(12.dp) {
        item("web-calendar-head") {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 38.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    Modifier.weight(1f).laoTap(role = Role.Button) {
                        s.a.ui.form(
                            "跳转到日期",
                            CampusJson.obj("date", selected),
                            { value ->
                                val day = value.optString("date")
                                DateMath.parse(day)
                                select(day)
                                month = day.take(7) + "-01"
                            },
                            CampusUi.f("date", "日期", "date"),
                        )
                    },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "${parts[0]}年${parts[1]}月",
                        style = WebDesign.headline.copy(fontSize = 21.sp),
                        color = c.ink,
                    )
                    Text(" ▾", style = WebDesign.caption, color = c.sub)
                }
                LearningWeekControls(
                    "今天",
                    { move(-1) },
                    {
                        select(DateMath.today())
                        month = selected.take(7) + "-01"
                    },
                    { move(1) },
                )
                Spacer(Modifier.width(10.dp))
                WebButton("?", Modifier.width(34.dp), filled = false) { CampusGuide.open(s.a) }
            }
        }
        item("web-calendar-legend") {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 5.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                listOf("作业", "会议", "活动", "通知", "我的").forEach { type ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        Box(Modifier.size(8.dp).background(learningTypeColor(type, c), CircleShape))
                        Text(type, style = WebDesign.caption, color = c.sub)
                    }
                }
            }
        }
        item("web-calendar-retention") { LearningRetentionBar(s) }
        if (tasks.any { CampusItemExtras.daysLeft(s.a, it)?.let { left -> left <= 3 } == true })
            item("web-calendar-expiring") { LearningExpiringItems(s, tasks) }
        item("web-calendar-month") {
            var drag by remember { mutableFloatStateOf(0f) }
            WebCard(
                Modifier.fillMaxWidth().pointerInput(month) {
                    detectHorizontalDragGestures(
                        onDragStart = { drag = 0f },
                        onDragCancel = { drag = 0f },
                        onDragEnd = {
                            if (abs(drag) > 56.dp.toPx()) move(if (drag < 0) 1 else -1)
                            drag = 0f
                        },
                    ) { change, amount ->
                        change.consume()
                        drag += amount
                    }
                },
                padding = 4.dp,
            ) {
                Column(Modifier.padding(bottom = 4.dp)) {
                    Row(Modifier.fillMaxWidth().height(44.dp).background(c.bg)) {
                        listOf("一", "二", "三", "四", "五", "六", "日").forEach {
                            Box(
                                Modifier.weight(1f).fillMaxHeight(),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(it, style = WebDesign.caption, color = c.sub)
                            }
                        }
                    }
                    webCalendarDays(month).chunked(7).forEach { week ->
                        Row(Modifier.fillMaxWidth()) {
                            week.forEach { day ->
                                val entries =
                                    tasks.filter {
                                        taskDate(it) == day && CampusSchool.visible(s.a, it)
                                    }
                                LearningDateCell(
                                    s.a,
                                    day,
                                    selected,
                                    month.take(7),
                                    entries,
                                    CampusCourseAdjust.onDay(s.a.store, day).size,
                                    Modifier.weight(1f),
                                    { select(day) },
                                    {
                                        select(day)
                                        CampusSchool.personalForm(s.a, null)
                                    },
                                )
                            }
                        }
                    }
                }
            }
        }
        item("web-calendar-selected") {
            Column(
                Modifier.padding(top = 16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        dateLabel(selected),
                        style = WebDesign.body.copy(fontWeight = FontWeight.Bold),
                        color = c.ink,
                        modifier = Modifier.weight(1f),
                    )
                    LearningCheckbox(hideDone, "隐藏已完成") {
                        val next = CampusJson.copy(prefs)
                        CampusJson.put(next, "hideDone", !hideDone)
                        s.a.store.set("fun_opts_v1", next)
                        s.a.build()
                    }
                }
                WebCard(Modifier.fillMaxWidth(), padding = 0.dp) {
                    if (dayTasks.isEmpty() && courses.isEmpty())
                        Column(
                            Modifier.fillMaxWidth().padding(20.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text("这天没有安排", style = WebDesign.body, color = c.sub)
                            Text(
                                "点右下角「＋」记一件事，会记在这天",
                                style = WebDesign.caption,
                                color = c.sub,
                                textAlign = TextAlign.Center,
                            )
                        }
                    else
                        Column {
                            courses.forEachIndexed { index, course ->
                                if (index > 0) HorizontalDivider(color = c.line)
                                LearningCourseCell(s, course)
                            }
                            dayTasks.forEachIndexed { index, task ->
                                if (index > 0 || courses.isNotEmpty())
                                    HorizontalDivider(color = c.line)
                                WebLearningTaskCell(
                                    s,
                                    task,
                                    showDeadline = false,
                                    alwaysOpen = true,
                                )
                            }
                        }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WebButton("粘贴导入", Modifier.weight(1f)) { CampusSocial.pasteImport(s.a) }
                    WebButton("完整课程表", Modifier.weight(1f), filled = false) { s.open("courses") }
                }
            }
        }
        item("web-calendar-undated-title") { LearningSectionHeading("时间待定", "请去群里核实") }
        item("web-calendar-undated") {
            WebCard(Modifier.fillMaxWidth(), padding = 0.dp) {
                if (undated.isEmpty())
                    Text("暂无", Modifier.padding(18.dp), style = WebDesign.body, color = c.sub)
                else
                    undated.forEachIndexed { index, task ->
                        if (index > 0) HorizontalDivider(color = c.line)
                        WebLearningTaskCell(s, task, showDeadline = false)
                    }
            }
        }
    }
}

/** Exact 42-day Monday-first grid, including dates in neighbouring months like the website. */
internal fun webCalendarDays(month: String): List<String> {
    val first = month.take(7) + "-01"
    val start = CampusCourses.monday(first)
    return List(42) { DateMath.plus(start, it) }
}

@Composable
private fun LearningDateCell(
    a: CampusActivity,
    day: String,
    selected: String,
    month: String,
    entries: List<JSONObject>,
    courseCount: Int,
    modifier: Modifier,
    onSelect: () -> Unit,
    onAdd: () -> Unit,
) {
    val c = WebDesign.colors()
    val picked = day == selected
    val today = day == DateMath.today()
    val sameMonth = day.take(7) == month
    Column(
        modifier
            .height(68.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (picked) c.selected.copy(alpha = .55f) else Color.Transparent)
            .border(0.5.dp, c.line.copy(alpha = .55f), RoundedCornerShape(14.dp))
            .pointerInput(day) {
                detectTapGestures(
                    onTap = { onSelect() },
                    onDoubleTap = { onAdd() },
                    onLongPress = { onAdd() },
                )
            }
            .semantics {
                role = Role.Button
                this.selected = picked
                contentDescription = "$day，${entries.size + courseCount}项安排"
                onClick(label = "选择日期") {
                    onSelect()
                    true
                }
                onLongClick(label = "记一件事") {
                    onAdd()
                    true
                }
            }
            .padding(top = 6.dp, start = 2.dp, end = 2.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier.size(30.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(if (today) c.primary else Color.Transparent)
                .then(
                    if (today && picked)
                        Modifier.border(
                            2.dp,
                            c.primary.copy(alpha = .25f),
                            RoundedCornerShape(8.dp),
                        )
                    else Modifier
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                DateMath.parts(day)[2].toString(),
                style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
                color =
                    if (today) Color.White else if (sameMonth) c.ink else c.sub.copy(alpha = .38f),
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            entries.take(4).forEach { task ->
                Box(
                    Modifier.size(5.dp)
                        .background(
                            learningTypeColor(
                                    if (task.optBoolean("_mine")) "我的"
                                    else task.optString("msg_type"),
                                    c,
                                )
                                .copy(alpha = if (a.done(task)) .3f else 1f),
                            CircleShape,
                        )
                )
            }
            if (entries.size < 4 && courseCount > 0)
                Box(Modifier.size(5.dp).background(c.primary, CircleShape))
        }
        if (entries.size + courseCount > 4)
            Text(
                "+${entries.size + courseCount - 4}",
                style = WebDesign.caption.copy(fontSize = 9.sp, lineHeight = 10.sp),
                color = c.sub,
            )
    }
}

@Composable
internal fun WebHomeworkPage(s: CampusSession) {
    val c = WebDesign.colors()
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var filter by rememberSaveable { mutableStateOf("全部") }
    val groups = webHomeworkGroups(s.a, offset)
    LaunchedEffect(s.a.store, s.a.cid()) { CampusItemExtras.refresh(s.a) }
    WebPage(16.dp) {
        item("web-homework-help") {
            Row(Modifier.fillMaxWidth().height(34.dp), horizontalArrangement = Arrangement.End) {
                WebButton("?", Modifier.width(34.dp), filled = false) { CampusGuide.open(s.a) }
            }
        }
        item("web-homework-head") {
            Row(
                Modifier.fillMaxWidth().padding(bottom = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        when (offset) {
                            0 -> "本周作业"
                            1 -> "下周作业"
                            -1 -> "上周作业"
                            else -> "${dateLabel(groups.monday).substringBefore(" ")}这周"
                        },
                        style = WebDesign.headline.copy(fontSize = 21.sp),
                        color = c.ink,
                    )
                    Text(
                        learningRange(groups.monday, DateMath.plus(groups.monday, 6)),
                        Modifier.weight(1f),
                        style = WebDesign.caption.copy(fontSize = 11.sp),
                        color = c.sub,
                        maxLines = 2,
                    )
                }
                LearningWeekControls("本周", { offset-- }, { offset = 0 }, { offset++ })
            }
        }
        item("web-homework-progress") {
            WebCard(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                color = c.hero,
                padding = 20.dp,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    LearningRing(
                        groups.done.size,
                        groups.week.size,
                        c.primary,
                        Modifier.size(76.dp),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(verticalAlignment = Alignment.Bottom) {
                            Text(
                                (groups.todo.size + groups.overdue.size).toString(),
                                style =
                                    WebDesign.headline.copy(
                                        fontSize = 29.sp,
                                        lineHeight = 35.sp,
                                        fontWeight = FontWeight.Medium,
                                    ),
                                color = c.ink,
                            )
                            Text(
                                " 项没完成",
                                Modifier.padding(bottom = 4.dp),
                                style = WebDesign.caption,
                                color = c.ink,
                            )
                        }
                        Text(
                            "${if (offset == 0) "本周" else "这周"}已完成 ${groups.done.size} / ${groups.week.size}" +
                                if (groups.week.isNotEmpty() && groups.todo.isEmpty()) "，全部搞定 🎉"
                                else "",
                            style = WebDesign.caption,
                            color = c.ink,
                        )
                        if (groups.overdue.isNotEmpty())
                            Text(
                                "含 ${groups.overdue.size} 项过期",
                                style = WebDesign.caption,
                                color = learningTypeColor("作业", c),
                            )
                    }
                }
            }
        }
        if (groups.all.isNotEmpty())
            item("web-homework-filter") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("全部", "待完成", "已完成").forEach { label ->
                        WebPill(label, filter == label, Modifier.weight(1f)) { filter = label }
                    }
                }
            }
        if (
            groups.all.any { CampusItemExtras.daysLeft(s.a, it)?.let { left -> left <= 3 } == true }
        )
            item("web-homework-expiring") { LearningExpiringItems(s, groups.all) }
        if (filter != "已完成" && groups.overdue.isNotEmpty()) {
            item("web-homework-overdue-heading") {
                LearningSectionHeading("之前没交的", "过期但还没标记完成", warning = true)
            }
            item("web-homework-overdue") { LearningTaskGroup(s, groups.overdue) }
        }
        if (filter != "已完成") {
            item("web-homework-todo-heading") { LearningSectionHeading("待完成", "按截止时间排序") }
            item("web-homework-todo") {
                if (groups.todo.isNotEmpty()) LearningTaskGroup(s, groups.todo)
                else
                    WebCard(Modifier.fillMaxWidth(), padding = 18.dp) {
                        Text(
                            if (groups.week.isNotEmpty()) "这周的作业都做完了 🎉" else "这周没有作业 🎉",
                            style = WebDesign.body,
                            color = c.sub,
                        )
                    }
            }
            if (groups.undated.isNotEmpty()) {
                item("web-homework-undated-heading") { LearningSectionHeading("截止时间待定", "请去群里核实") }
                item("web-homework-undated") { LearningTaskGroup(s, groups.undated) }
            }
        }
        if (filter != "待完成" && groups.done.isNotEmpty()) {
            item("web-homework-done-heading") {
                LearningSectionHeading("已完成", "${groups.done.size} 项")
            }
            item("web-homework-done") { LearningTaskGroup(s, groups.done) }
        }
        if (filter == "已完成" && groups.done.isEmpty())
            item("web-homework-no-done") {
                WebCard(Modifier.fillMaxWidth()) {
                    Text("完成一项作业，就会出现在这里。", style = WebDesign.body, color = c.sub)
                }
            }
        item("web-homework-footnote") {
            Text(
                (if (s.a.api.logged()) "完成勾选会同步到你的账号；" else "勾选只记在这台设备上；") + "作业由班委整理发布，有出入以群里为准。",
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                style = WebDesign.caption,
                color = c.sub,
                textAlign = TextAlign.Center,
            )
        }
        item("web-homework-import") {
            WebButton("粘贴导入班群作业", Modifier.fillMaxWidth(), filled = false) {
                CampusSocial.pasteImport(s.a)
            }
        }
    }
}

internal data class WebHomeworkGroups(
    val monday: String,
    val all: List<JSONObject>,
    val week: List<JSONObject>,
    val todo: List<JSONObject>,
    val done: List<JSONObject>,
    val overdue: List<JSONObject>,
    val undated: List<JSONObject>,
)

internal fun webHomeworkGroups(a: CampusActivity, offset: Int): WebHomeworkGroups {
    return webHomeworkGroups(visibleTasks(a), DateMath.today(), offset) { a.done(it) }
}

/** Mirrors renderHomework(), independent of Activity for deadline-boundary regression checks. */
internal fun webHomeworkGroups(
    records: List<JSONObject>,
    today: String,
    offset: Int,
    isDone: (JSONObject) -> Boolean,
): WebHomeworkGroups {
    val monday = DateMath.plus(CampusCourses.monday(today), offset * 7)
    val sunday = DateMath.plus(monday, 6)
    val all =
        records
            .filter { it.optString("msg_type") == "作业" }
            .sortedWith(
                compareBy<JSONObject> { taskDate(it) }.thenBy { taskClock(it).ifBlank { "99:99" } }
            )
    val week = all.filter { taskDate(it).isNotBlank() && taskDate(it) in monday..sunday }
    val overdue =
        if (offset != 0) emptyList()
        else
            all.filter {
                !isDone(it) &&
                    taskDate(it).isNotBlank() &&
                    taskDate(it) < monday &&
                    taskDate(it) >= DateMath.plus(today, -30)
            }
    return WebHomeworkGroups(
        monday,
        all,
        week,
        week.filterNot(isDone),
        week.filter(isDone),
        overdue,
        if (offset == 0) all.filter { taskDate(it).isBlank() } else emptyList(),
    )
}

@Composable
private fun LearningTaskGroup(s: CampusSession, tasks: List<JSONObject>) {
    val c = WebDesign.colors()
    WebCard(Modifier.fillMaxWidth(), padding = 0.dp) {
        Column {
            tasks.forEachIndexed { index, task ->
                if (index > 0) HorizontalDivider(color = c.line)
                key(task.optString("_key").ifBlank { task.optString("id") }) {
                    WebLearningTaskCell(s, task)
                }
            }
        }
    }
}

@Composable
internal fun WebLearningTaskCell(
    s: CampusSession,
    task: JSONObject,
    showDeadline: Boolean = true,
    alwaysOpen: Boolean = false,
) {
    val c = WebDesign.colors()
    val done = s.a.done(task)
    var expanded by rememberSaveable(task.optString("_key")) { mutableStateOf(alwaysOpen) }
    val date = taskDate(task)
    val due = learningDueLabel(date, done)
    val warning = !done && date.isNotBlank() && date <= DateMath.today()
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 15.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(
                Modifier.size(28.dp)
                    .clip(CircleShape)
                    .background(if (done) c.primary else c.card)
                    .border(1.5.dp, if (done) c.primary else c.line, CircleShape)
                    .laoTap(role = Role.Checkbox) { s.a.mark(CampusJson.copy(task)) }
                    .semantics {
                        toggleableState = ToggleableState(done)
                        contentDescription =
                            if (done) "标记未完成 ${taskTitle(task)}" else "完成 ${taskTitle(task)}"
                    },
                contentAlignment = Alignment.Center,
            ) {
                if (done) Icon(Icons.Rounded.Check, null, Modifier.size(18.dp), tint = Color.White)
            }
            Column(
                Modifier.weight(1f).laoTap(role = Role.Button) { expanded = !expanded },
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    (if (task.optBoolean("need_confirm")) "⚠ " else "") + taskTitle(task),
                    style =
                        WebDesign.body.copy(
                            fontWeight = FontWeight.SemiBold,
                            textDecoration =
                                if (done) TextDecoration.LineThrough else TextDecoration.None,
                        ),
                    color = if (done) c.sub else c.ink,
                )
                if (
                    task.optString("subject").isNotBlank() && task.optString("summary").isNotBlank()
                )
                    Text(
                        task.optString("summary"),
                        style = WebDesign.caption,
                        color = c.sub,
                        maxLines = if (expanded) 10 else 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                if (!showDeadline && taskClock(task).isNotBlank())
                    Text(
                        taskClock(task) + " · " + task.optString("msg_type", "事项"),
                        style = WebDesign.caption,
                        color = c.sub,
                    )
            }
            if (showDeadline)
                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        due,
                        style = WebDesign.caption.copy(fontWeight = FontWeight.SemiBold),
                        color = if (warning) learningTypeColor("作业", c) else c.sub,
                    )
                    if (date.isNotBlank())
                        Text(
                            date.substring(5).replace('-', '/') +
                                if (taskClock(task).isNotBlank()) "\n${taskClock(task)}" else "",
                            style = WebDesign.caption.copy(fontSize = 11.sp),
                            color = c.sub,
                            textAlign = TextAlign.End,
                        )
                }
        }
        AnimatedVisibility(
            expanded,
            enter =
                if (LocalMotionEnabled.current) fadeIn() + expandVertically(spring(.9f, 450f))
                else androidx.compose.animation.EnterTransition.None,
            exit =
                if (LocalMotionEnabled.current) fadeOut() + shrinkVertically(spring(.9f, 450f))
                else androidx.compose.animation.ExitTransition.None,
        ) {
            Column(
                Modifier.padding(start = 38.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                listOf("location" to "地点", "prepare" to "准备", "note" to "备注").forEach { (key, title)
                    ->
                    if (task.optString(key).isNotBlank())
                        Text(
                            "$title：${task.optString(key)}",
                            style = WebDesign.caption,
                            color = c.sub,
                        )
                }
                val count = CampusItemExtras.fileCount(s.a, task)
                if (count > 0) Text("📎 $count 个附件", style = WebDesign.caption, color = c.sub)
                val left = CampusItemExtras.daysLeft(s.a, task)
                if (left != null && left <= 3) {
                    Text(
                        "🗑 ${if (left <= 0) "今天过后" else "$left 天后"}自动删除",
                        style = WebDesign.caption,
                        color = learningTypeColor("作业", c),
                    )
                    WebButton("推迟删除，多留 3 天", filled = false) { CampusItemExtras.keep(s.a, task) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    WebButton("详情 / 编辑", filled = false) { CampusSchool.detail(s.a, task) }
                    if (task.has("_study")) WebButton("考核附件", filled = false) {
                        CampusStudy.openItem(s.a, task.optLong("_study"))
                    } else WebButton("图片 / 文件", filled = false) { CampusItemExtras.openFiles(s.a, task) }
                }
            }
        }
    }
}

@Composable
private fun LearningCourseCell(s: CampusSession, course: JSONObject) {
    val c = WebDesign.colors()
    Row(
        Modifier.fillMaxWidth().padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            course.optString("t0"),
            style = WebDesign.caption.copy(fontWeight = FontWeight.SemiBold),
            color = c.primary,
        )
        Column(
            Modifier.weight(1f).laoTap(role = Role.Button) { CampusCourses.detail(s.a, course) },
            verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                course.optString("name"),
                style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
                color = c.ink,
            )
            Text(
                listOf(
                        course.optString("location"),
                        course.optString("teacher"),
                        course.optString("t1"),
                    )
                    .filter { it.isNotBlank() }
                    .joinToString(" · "),
                style = WebDesign.caption,
                color = c.sub,
            )
        }
        WebButton("调课", filled = false) { CampusCourseAdjust.open(s.a, course) }
    }
}

@Composable
internal fun WebGrowthPage(s: CampusSession) {
    val c = WebDesign.colors()
    val a = s.a
    val stats = weekStats(a)
    val habits = rows(a.store.list("habits_v1"))
    val pet = a.store.`object`("farm_v1")
    val prefs = a.store.`object`("fun_opts_v1")
    val showHabits = prefs.optBoolean("habits", true)
    WebPage(12.dp) {
        item("web-growth-heading") {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 42.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Rounded.KeyboardArrowLeft,
                    "返回首页",
                    Modifier.size(32.dp).laoTap(role = Role.Button) { s.a.tab("home") },
                    tint = c.ink,
                )
                Text("成长", style = WebDesign.headline, color = c.ink)
            }
        }
        item("web-growth-rings") {
            WebCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp), padding = 18.dp) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LearningStatRing(
                        stats[0],
                        stats[1],
                        "本周作业",
                        learningTypeColor("作业", c),
                        Modifier.weight(1f),
                    )
                    LearningStatRing(stats[2], stats[3], "本周事项", c.primary, Modifier.weight(1f))
                    if (showHabits)
                        LearningStatRing(
                            stats[4],
                            stats[5],
                            "今日打卡",
                            learningTypeColor("活动", c),
                            Modifier.weight(1f),
                        )
                }
            }
        }
        if (prefs.optBoolean("farm", true))
            item("web-growth-farm") {
                WebCard(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    padding = 16.dp,
                    onClick = { s.open("farm") },
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text("☁️", fontSize = 32.sp)
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(3.dp),
                        ) {
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    pet.optString("name", "小云朵"),
                                    style = WebDesign.title,
                                    color = c.ink,
                                )
                                Text(
                                    "Lv.${pet.optInt("level", 1)}",
                                    style = WebDesign.caption.copy(fontWeight = FontWeight.Bold),
                                    color = c.primary,
                                )
                            }
                            Text(
                                "💧 养料 ${max(0, CampusLearn.food(a) - pet.optLong("spent"))}",
                                style = WebDesign.caption,
                                color = c.sub,
                            )
                        }
                        Text("›", color = c.sub, fontSize = 24.sp)
                    }
                }
            }
        item("web-growth-rank") {
            WebCard(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                padding = 16.dp,
                onClick = { CampusLearn.loadRank(a, "week") },
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text("🏆", fontSize = 28.sp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                        Text("班级成长排行榜", style = WebDesign.title, color = c.ink)
                        Text("完成作业、打卡、番茄钟都能攒成长值", style = WebDesign.caption, color = c.sub)
                    }
                    Text("›", color = c.sub, fontSize = 24.sp)
                }
            }
        }
        item("web-growth-trend-heading") {
            LearningSectionHeading("最近 14 天", "每天完成了多少事、打了多少卡", Modifier.padding(top = 14.dp))
        }
        item("web-growth-trend") {
            WebCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                LearningTrend(a, showHabits)
            }
        }
        if (showHabits) {
            item("web-growth-habit-heading") {
                LearningSectionHeading("习惯打卡", "小目标，每天勾一下", Modifier.padding(top = 14.dp))
            }
            item("web-growth-habits") {
                WebCard(Modifier.fillMaxWidth().padding(horizontal = 12.dp), padding = 16.dp) {
                    if (habits.isEmpty())
                        Text("还没有习惯。挑一个下面的建议，或者自己写一个。", style = WebDesign.body, color = c.sub)
                    else
                        habits.forEachIndexed { index, habit ->
                            if (index > 0) HorizontalDivider(color = c.line)
                            LearningHabitCell(s, habit)
                        }
                    LearningHabitComposer(s, habits)
                }
            }
        }
        item("web-growth-footnote") {
            Text(
                if (a.api.logged()) "打卡和完成记录会同步到你的账号。" else "打卡和完成记录只保存在这台设备上。",
                Modifier.fillMaxWidth().padding(vertical = 16.dp),
                style = WebDesign.caption,
                color = c.sub,
                textAlign = TextAlign.Center,
            )
        }
    }
}

@Composable
private fun LearningStatRing(
    done: Int,
    total: Int,
    label: String,
    color: Color,
    modifier: Modifier,
) {
    val c = WebDesign.colors()
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        LearningRing(done, total, color, Modifier.size(60.dp))
        Text(label, style = WebDesign.caption.copy(fontWeight = FontWeight.Bold), color = c.ink)
        Text("$done / $total", style = WebDesign.caption, color = c.sub)
    }
}

@Composable
private fun LearningRing(done: Int, total: Int, color: Color, modifier: Modifier = Modifier) {
    val c = WebDesign.colors()
    val target = if (total == 0) 0f else done.toFloat() / total
    val progress by
        animateFloatAsState(
            target.coerceIn(0f, 1f),
            if (LocalMotionEnabled.current) spring(.85f, 120f) else snap(),
            label = "web completion ring",
        )
    Box(
        modifier.semantics { contentDescription = "完成 $done / $total" },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val stroke = size.minDimension * .095f
            val inset = stroke / 2 + size.minDimension * .075f
            val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
            drawArc(
                if (color == c.primary) color.copy(alpha = .12f) else c.line,
                0f,
                360f,
                false,
                topLeft = Offset(inset, inset),
                size = arcSize,
                style = Stroke(stroke),
            )
            if (progress > 0)
                drawArc(
                    color,
                    -90f,
                    progress * 360f,
                    false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(stroke, cap = StrokeCap.Round),
                )
        }
        Text(
            if (total == 0) "–" else "${(progress * 100).roundToInt()}%",
            style = WebDesign.body,
            color = c.ink,
        )
    }
}

@Composable
private fun LearningTrend(a: CampusActivity, showHabits: Boolean) {
    val c = WebDesign.colors()
    val days = List(14) { DateMath.plus(DateMath.today(), it - 13) }
    val doneLog = a.store.`object`("done_log_v1")
    val habitLog = a.store.`object`("habit_log_v1")
    val habits = rows(a.store.list("habits_v1"))
    val completed =
        days.map { day -> CampusJson.keys(doneLog).count { doneLog.optString(it) == day } }
    val checked =
        days.map { day ->
            habits.count { habitLog.optJSONObject(it.optString("id"))?.optBoolean(day) == true }
        }
    val ceiling =
        (max(4, max(completed.maxOrNull() ?: 0, if (showHabits) checked.maxOrNull() ?: 0 else 0)) +
            1) / 2 * 2
    var selected by remember { mutableIntStateOf(-1) }
    var numbers by rememberSaveable { mutableStateOf(false) }
    val success = learningTypeColor("活动", c)
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        LearningLegend("完成事项", c.primary)
        if (showHabits) LearningLegend("打卡", success)
    }
    Box(Modifier.fillMaxWidth().height(100.dp)) {
        Canvas(
            Modifier.fillMaxSize()
                .pointerInput(completed, checked) {
                    detectTapGestures(
                        onTap = {
                            selected =
                                ((it.x - 20.dp.toPx()) / (size.width - 44.dp.toPx()) * 13)
                                    .roundToInt()
                                    .coerceIn(0, 13)
                        }
                    )
                }
                .semantics { contentDescription = "最近14天完成事项和习惯打卡的趋势" }
        ) {
            val left = 20.dp.toPx()
            val right = size.width - 24.dp.toPx()
            val top = 12.dp.toPx()
            val bottom = size.height - 22.dp.toPx()
            fun point(index: Int, value: Int) =
                Offset(
                    left + (right - left) * index / 13,
                    bottom - (bottom - top) * value / ceiling,
                )
            listOf(0, ceiling / 2, ceiling).forEach {
                drawLine(
                    c.line.copy(alpha = .7f),
                    Offset(left, point(0, it).y),
                    Offset(right, point(0, it).y),
                    1.dp.toPx(),
                )
            }
            fun series(data: List<Int>, color: Color) {
                val path = Path()
                data.forEachIndexed { index, value ->
                    val p = point(index, value)
                    if (index == 0) path.moveTo(p.x, p.y) else path.lineTo(p.x, p.y)
                }
                drawPath(
                    path,
                    color,
                    style = Stroke(1.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
                )
                drawCircle(color, 2.5.dp.toPx(), point(13, data.last()))
            }
            series(completed, c.primary)
            if (showHabits) series(checked, success)
            if (selected >= 0)
                drawLine(
                    c.sub.copy(alpha = .5f),
                    point(selected, ceiling),
                    point(selected, 0),
                    1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(5f, 5f)),
                )
        }
        Column(
            Modifier.fillMaxHeight().padding(vertical = 5.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            listOf(ceiling, ceiling / 2, 0).forEach {
                Text(
                    it.toString(),
                    style = WebDesign.caption.copy(fontSize = 8.sp, lineHeight = 10.sp),
                    color = c.sub,
                )
            }
        }
        Row(
            Modifier.align(Alignment.BottomCenter)
                .fillMaxWidth()
                .padding(start = 20.dp, end = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            listOf(1, 4, 7, 10, 13).forEach { index ->
                Text(
                    if (index == 13) "今天" else days[index].substring(5).replace('-', '/'),
                    style = WebDesign.caption.copy(fontSize = 8.sp, lineHeight = 10.sp),
                    color = c.sub,
                )
            }
        }
    }
    if (selected >= 0)
        Text(
            "${dateLabel(days[selected])}：完成 ${completed[selected]} 项" +
                if (showHabits) " · 打卡 ${checked[selected]} 次" else "",
            style = WebDesign.caption,
            color = c.sub,
        )
    Text(
        if (numbers) "▾ 收起具体数字" else "▸ 看具体数字",
        Modifier.laoTap(role = Role.Button) { numbers = !numbers },
        style = WebDesign.caption,
        color = c.sub,
    )
    AnimatedVisibility(numbers) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            days.forEachIndexed { index, day ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(dateLabel(day), style = WebDesign.caption, color = c.sub)
                    Text(
                        "完成 ${completed[index]}" +
                            if (showHabits) " · 打卡 ${checked[index]}" else "",
                        style = WebDesign.caption,
                        color = c.ink,
                    )
                }
            }
        }
    }
}

@Composable
private fun LearningLegend(label: String, color: Color) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(Modifier.width(14.dp).height(3.dp).background(color, CircleShape))
        Text(label, style = WebDesign.caption, color = WebDesign.colors().sub)
    }
}

@Composable
private fun LearningHabitCell(s: CampusSession, habit: JSONObject) {
    val c = WebDesign.colors()
    val log =
        s.a.store.`object`("habit_log_v1").optJSONObject(habit.optString("id")) ?: JSONObject()
    val checked = log.optBoolean(DateMath.today())
    Row(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(habit.optString("icon", "📖"), fontSize = 24.sp)
        Column(
            Modifier.weight(1f).laoTap(role = Role.Button) { CampusLearn.habitForm(s.a, habit) },
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                habit.optString("name"),
                style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
                color = c.ink,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                List(14) { DateMath.plus(DateMath.today(), it - 13) }
                    .forEach { day ->
                        Box(
                            Modifier.size(7.dp)
                                .clip(RoundedCornerShape(2.dp))
                                .background(if (log.optBoolean(day)) c.primary else c.line)
                        )
                    }
            }
            val streak = CampusLearn.streak(log, DateMath.today())
            if (streak > 0) Text("🔥 连续 $streak 天", style = WebDesign.caption, color = c.sub)
        }
        WebButton(if (checked) "✓ 已打卡" else "打卡", filled = checked) {
            CampusLearn.habitToggle(s.a, habit, DateMath.today())
        }
        Icon(
            Icons.Rounded.Close,
            "删除习惯",
            Modifier.size(24.dp).laoTap(role = Role.Button) {
                s.a.ui.confirm("删除「${habit.optString("name")}」？", "删除这个习惯，历史记录仍会保留在备份中。") {
                    s.a.store.replace("habits_v1", habit.optString("id"), null)
                    CampusLearn.changed(s.a)
                }
            },
            tint = c.sub,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LearningHabitComposer(s: CampusSession, habits: List<JSONObject>) {
    val c = WebDesign.colors()
    var icon by rememberSaveable { mutableStateOf("📖") }
    var name by rememberSaveable { mutableStateOf("") }
    fun add(title: String, symbol: String) {
        val clean = title.trim()
        if (clean.isBlank()) return
        val id = "h" + System.currentTimeMillis()
        s.a.store.replace("habits_v1", id, CampusJson.obj("id", id, "name", clean, "icon", symbol))
        name = ""
        CampusLearn.changed(s.a)
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        listOf("📖", "🏃", "💧", "🧘", "✍️", "🎹", "😴", "🍎", "🗣️", "💪").forEach { emoji ->
            Box(
                Modifier.size(38.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(c.bg)
                    .border(
                        if (icon == emoji) 2.dp else 0.dp,
                        if (icon == emoji) c.primary else Color.Transparent,
                        RoundedCornerShape(12.dp),
                    )
                    .laoTap(role = Role.RadioButton) { icon = emoji },
                contentAlignment = Alignment.Center,
            ) {
                Text(emoji, fontSize = 22.sp)
            }
        }
    }
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        WebInput(name, { name = it }, "新习惯，比如：背30个单词", Modifier.weight(1f))
        WebButton("添加") { add(name, icon) }
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        listOf(
                "📖" to "阅读 30 分钟",
                "🗣️" to "背 30 个单词",
                "🏃" to "跑步 / 阳光跑",
                "😴" to "12 点前睡觉",
                "💧" to "喝够 8 杯水",
            )
            .filter { (_, title) -> habits.none { it.optString("name") == title } }
            .forEach { (emoji, title) -> WebPill("＋ $title") { add(title, emoji) } }
    }
}

@Composable
private fun LearningWeekControls(
    label: String,
    previous: () -> Unit,
    current: () -> Unit,
    next: () -> Unit,
) {
    val c = WebDesign.colors()
    Row(
        Modifier.clip(RoundedCornerShape(10.dp))
            .background(c.card)
            .border(1.dp, c.line, RoundedCornerShape(10.dp)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "‹",
            Modifier.width(28.dp)
                .heightIn(min = 34.dp)
                .laoTap(role = Role.Button) { previous() }
                .wrapContentHeight(Alignment.CenterVertically)
                .semantics { contentDescription = "上一${if (label == "今天") "个月" else "周"}" },
            color = c.ink,
            textAlign = TextAlign.Center,
            fontSize = 16.sp,
        )
        Box(Modifier.width(1.dp).height(32.dp).background(c.line))
        Text(
            label,
            Modifier.heightIn(min = 34.dp)
                .laoTap(role = Role.Button) { current() }
                .padding(horizontal = 10.dp)
                .wrapContentHeight(Alignment.CenterVertically),
            style = WebDesign.caption.copy(fontWeight = FontWeight.Bold),
            color = c.ink,
        )
        Box(Modifier.width(1.dp).height(32.dp).background(c.line))
        Text(
            "›",
            Modifier.width(28.dp)
                .heightIn(min = 34.dp)
                .laoTap(role = Role.Button) { next() }
                .wrapContentHeight(Alignment.CenterVertically)
                .semantics { contentDescription = "下一${if (label == "今天") "个月" else "周"}" },
            color = c.ink,
            textAlign = TextAlign.Center,
            fontSize = 16.sp,
        )
    }
}

@Composable
private fun LearningSectionHeading(
    title: String,
    note: String,
    modifier: Modifier = Modifier,
    warning: Boolean = false,
) {
    val c = WebDesign.colors()
    Row(
        modifier.fillMaxWidth(),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            title,
            style = WebDesign.title,
            color = if (warning) learningTypeColor("作业", c) else c.ink,
        )
        Text(
            note,
            Modifier.weight(1f).padding(bottom = 2.dp),
            style = WebDesign.caption,
            color = c.sub,
        )
    }
}

@Composable
private fun LearningCheckbox(checked: Boolean, label: String, onChange: () -> Unit) {
    val c = WebDesign.colors()
    Row(
        Modifier.heightIn(min = 36.dp)
            .laoTap(role = Role.Checkbox) { onChange() }
            .semantics { toggleableState = ToggleableState(checked) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            Modifier.size(14.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(if (checked) c.primary else c.card)
                .border(1.dp, if (checked) c.primary else c.sub, RoundedCornerShape(3.dp)),
            contentAlignment = Alignment.Center,
        ) {
            if (checked) Icon(Icons.Rounded.Check, null, Modifier.size(12.dp), tint = Color.White)
        }
        Text(label, style = WebDesign.caption, color = c.ink)
    }
}

private fun learningTypeColor(type: String, c: WebColors): Color =
    when (type) {
        "作业" -> if (c.bg.luminance() < .3f) Color(0xFFE59980) else Color(0xFFBF6650)
        "会议" -> c.primary
        "活动" -> if (c.bg.luminance() < .3f) Color(0xFF83C1A6) else Color(0xFF39856A)
        "我的" -> if (c.bg.luminance() < .3f) Color(0xFFB5A2DB) else Color(0xFF8270B7)
        else -> c.sub.copy(alpha = .8f)
    }

private fun learningDueLabel(day: String, done: Boolean): String {
    if (done) return "已完成"
    if (day.isBlank()) return "时间待定"
    val diff = DateMath.days(day)
    return when {
        diff < 0 -> "已过期 ${-diff} 天"
        diff == 0L -> "今天截止"
        diff == 1L -> "明天截止"
        else -> "还剩 $diff 天"
    }
}

private fun learningRange(start: String, end: String): String {
    val a = DateMath.parts(start)
    val b = DateMath.parts(end)
    return "${a[1]}月${a[2]}日 – ${b[1]}月${b[2]}日"
}

@Composable
@OptIn(ExperimentalLayoutApi::class)
private fun LearningRetentionBar(s: CampusSession) {
    val c = WebDesign.colors()
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        FlowRow(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Box(Modifier.heightIn(min = 36.dp), contentAlignment = Alignment.CenterStart) {
                Text(
                    "🗑 过期 2 周自动删除",
                    style = WebDesign.caption.copy(fontWeight = FontWeight.Bold),
                    color = c.ink,
                )
            }
            Box(Modifier.heightIn(min = 36.dp), contentAlignment = Alignment.CenterStart) {
                Text("作业：总是", style = WebDesign.caption, color = c.sub)
            }
            LearningCheckbox(CampusItemExtras.personalAutodelete(s.a), "我自己记的") {
                CampusItemExtras.setPersonalAutodelete(
                    s.a,
                    !CampusItemExtras.personalAutodelete(s.a),
                )
            }
        }
        if (s.a.cid().isNotBlank()) {
            LearningCheckbox(CampusItemExtras.classAutodelete(s.a), "本班其它事项") {
                if (CampusItemExtras.canSetClassAutodelete(s.a))
                    CampusItemExtras.setClassAutodelete(s.a, !CampusItemExtras.classAutodelete(s.a))
                else s.a.toast("老师和有编辑权限的班委可以修改")
            }
        }
        Text("最后 3 天会提醒，点「推迟删除」多留 3 天", style = WebDesign.caption, color = c.sub)
        val error = CampusItemExtras.error(s.a)
        if (error.isNotBlank())
            Text(error, style = WebDesign.caption, color = learningTypeColor("作业", c))
    }
}

@Composable
private fun LearningExpiringItems(s: CampusSession, tasks: List<JSONObject>) {
    val c = WebDesign.colors()
    val expiring =
        tasks
            .filter { CampusItemExtras.daysLeft(s.a, it)?.let { left -> left <= 3 } == true }
            .sortedBy { CampusItemExtras.expiry(s.a, it) }
            .take(20)
    WebCard(Modifier.fillMaxWidth(), color = c.apricot, padding = 12.dp) {
        Text(
            "🗑 ${expiring.size} 项快要自动删除了",
            style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
            color = c.ink,
        )
        Text("日期过去 2 周，想留着就点「推迟删除」。", style = WebDesign.caption, color = c.sub)
        expiring.forEach { task ->
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        taskTitle(task),
                        style = WebDesign.caption.copy(fontWeight = FontWeight.SemiBold),
                        color = c.ink,
                        maxLines = 2,
                    )
                    val left = CampusItemExtras.daysLeft(s.a, task) ?: 0
                    Text(
                        if (left <= 0) "今天过后" else "$left 天后",
                        style = WebDesign.caption,
                        color = c.sub,
                    )
                }
                WebButton("推迟删除", filled = false) { CampusItemExtras.keep(s.a, task) }
            }
        }
    }
}
