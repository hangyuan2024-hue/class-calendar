package com.laolao.classcalendar

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.*
import org.json.JSONObject

internal fun laoHomeOrder(a: CampusActivity): List<String> {
    val order = homeOrder(a).filterNot { it == "w:rings" }
    val configured =
        a.store.`object`("native_compose_home_v1").has("home") ||
            a.store.`object`("home_layout_v1").has("home")
    return if (configured) order
    else
        order.sortedBy {
            when (it) {
                "w:cal" -> 0
                "w:hw" -> 1
                "w:pins" -> 2
                else -> 3
            }
        }
}

@Composable
internal fun LaoCampusHome(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val day = DateMath.today()
    val next = CampusGuide.nextCourse(a)
    val courses = CampusCourses.onDay(a.store, day)
    val stats = weekStats(a)
    val pending =
        visibleTasks(a).filter { !a.done(it) }.sortedBy { it.optString("event_time", "9999") }
    val displayOptions = a.store.`object`("fun_opts_v1")
    val modules =
        laoHomeOrder(a).filter { id ->
            val option =
                when (id) {
                    "w:habits" -> "habits"
                    "w:plan",
                    "w:pomo" -> "plan"
                    "w:farm" -> "farm"
                    else -> null
                }
            option == null || displayOptions.optBoolean(option, true)
        }
    val rich = a.store.string("native_home_density_v2", "rich") == "rich"
    LaunchedEffect(a.cid(), a.api.uid()) {
        if (
            a.api.logged() &&
                a.cid().isNotBlank() &&
                a.store.string("cache_wall_class", "") != a.cid()
        )
            CampusSocial.loadWall(a)
    }
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "workspace-heading") {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        dateLabel(day) + " · " + campusName(a),
                        Modifier.weight(1f),
                        style = LaoType.caption,
                        color = c.onSurfaceVariant,
                    )
                    LaoIconButton(Icons.Rounded.Tune, "编辑校园主页", Modifier.size(40.dp)) {
                        s.sheet = HomeEditorSheet
                    }
                }
                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(
                        buildAnnotatedString {
                            append("学习工作台")
                            withStyle(SpanStyle(color = c.primary)) { append(".") }
                        },
                        Modifier.weight(1f),
                        style = LaoType.headline,
                    )
                    LaoTextAction("开始专注 ↗") { s.open("pomo") }
                }
            }
        }
        animatedItem(1, "workspace-core") {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                LaoCourseSpotlight(s, next, courses.size)
                if (CampusGuide.enabled(a)) LaoNudge(s)
                if (displayOptions.optBoolean("rings", true))
                    Row(
                        Modifier.fillMaxWidth().padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        LaoStat(
                            "${stats[0]}/${stats[1]}",
                            "本周作业",
                            Modifier.weight(1f),
                            CampusAccent.readable(CampusAccent.blue),
                        ) {
                            s.open("homework")
                        }
                        LaoStat("${stats[2]}/${stats[3]}", "本周事项", Modifier.weight(1f)) {
                            s.open("calendar")
                        }
                        LaoStat(
                            "${stats[4]}/${stats[5]}",
                            "今日打卡",
                            Modifier.weight(1f),
                            CampusAccent.readable(CampusAccent.berry),
                        ) {
                            s.open("growth")
                        }
                    }
                HorizontalDivider(color = c.outlineVariant.copy(alpha = .5f))
            }
        }
        if (a.loading) animatedItem(0, "native-sync") { LoadingLines("正在同步课程与班级…") }
        else if (a.api.logged() && a.cloudError.isNotBlank())
            animatedItem(0, "native-sync-error") {
                LaoEmpty("同步暂未完成", a.cloudError, "重试") { a.refreshCloud() }
            }
        modules.forEachIndexed { index, id ->
            animatedItem(index + 2, "workspace2-" + id) {
                when (id) {
                    "w:cal",
                    "w:course" ->
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            LaoSection(
                                "今天的时间线",
                                note =
                                    "${courses.size} 节课 · ${visibleTasks(a).count { taskDate(it) == day }} 项安排",
                            )
                            LaoTimeline(s, day, limit = if (rich) 4 else 2)
                        }
                    "w:hw" ->
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            LaoSection("手头要做的事", note = "${pending.size} 项待完成", action = "全部") {
                                s.open("homework")
                            }
                            if (pending.isEmpty()) LaoEmpty("给今天留一点空白", "记一件事，或从日历粘贴导入。")
                            else Column { pending.take(3).forEach { LaoTaskCell(s, it) } }
                        }
                    "w:pins" ->
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text("我的快捷工具", Modifier.weight(1f), style = LaoType.title)
                                LaoIconButton(Icons.Rounded.Add, "选择首页快捷工具") {
                                    s.sheet = ToolPickerSheet
                                }
                            }
                            LaoPinnedTools(s)
                        }
                    "w:quick" -> {
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            LaoSection("校园快捷入口")
                            LaoEntryStrip(
                                s,
                                listOf(
                                    "homework" to "作业",
                                    "growth" to "成长",
                                    "wall" to "班级墙",
                                    "rank" to "排行榜",
                                ),
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                LaoSecondaryButton("粘贴导入", Modifier.weight(1f)) {
                                    CampusSocial.pasteImport(a)
                                }
                                LaoSecondaryButton("记一件事", Modifier.weight(1f)) {
                                    a.selectedDay = day
                                    CampusSchool.personalForm(a, null)
                                }
                            }
                        }
                    }
                    "w:wall" -> CampusHomeWallPreview(s)
                    "w:rank" -> CampusRankPreview(s)
                    "w:habits" ->
                        Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            LaoSection("今天的小目标", action = "成长 ↗") { s.open("growth") }
                            rows(a.store.list("habits_v1")).take(3).forEach { LaoHabitCell(s, it) }
                        }
                    "w:encourage" ->
                        LaoPanel(
                            Modifier.fillMaxWidth(),
                            color = lerp(c.surface, c.secondary, .05f),
                        ) {
                            LaoChip("每日一句", c.secondary, Icons.Rounded.WbSunny)
                            Text("你比想象中更强大。", style = LaoType.title)
                            Text("慢慢来，认真过好今天。", style = LaoType.caption, color = c.onSurfaceVariant)
                        }
                    "w:pomo" -> LaoFeatureNote(s, "pomo", "给注意力留一块安静的地方", "番茄专注 · 暂停与休息 · 真实记录")
                    "w:plan" ->
                        LaoFeatureNote(
                            s,
                            "plan",
                            "先做重要的事",
                            "${pending.size} 项待办 · 四象限、PDCA 与 SMART",
                        )
                    "w:farm" ->
                        LaoFeatureNote(
                            s,
                            "farm",
                            a.store.`object`("farm_v1").optString("name", "小云朵"),
                            "Lv.${a.store.`object`("farm_v1").optInt("level", 1)} · 用真实成长喂养云宠",
                        )
                    "w:meta" -> LaoFeatureNote(s, "meta", "捞捞元宇宙", "学习星系 · 成长徽章 · 校园探索")
                    else -> {
                        val route = CampusHome.route(id)
                        if (route.isNotBlank())
                            LaoFeatureNote(
                                s,
                                route,
                                CampusHome.name(id),
                                CampusToolbox.description(route),
                            )
                    }
                }
            }
        }
    }
}

@Composable
private fun LaoCourseSpotlight(s: CampusSession, next: CampusGuide.Entry?, count: Int) {
    val c = MaterialTheme.colorScheme
    val ink = Color(0xFF173C43)
    Row(
        Modifier.fillMaxWidth()
            .clip(LaoCorners.paper)
            .background(Brush.linearGradient(listOf(ink, lerp(ink, c.primary, .25f))))
            .laoTap { s.open("courses") }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (next == null) "把这个学期，安排明白" else "接下来的课程",
                style = LaoType.label,
                color = Color(0xFFC3E7D9),
            )
            Text(
                next?.title ?: "添加你的第一张课表",
                style = LaoType.title,
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                next?.location?.ifBlank { "教室待确认" } ?: "拍照或粘贴导入，轻松开始",
                style = LaoType.caption,
                color = Color.White.copy(alpha = .72f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text("今天 ${count} 节课", style = LaoType.label, color = Color.White.copy(alpha = .5f))
        }
        Box(Modifier.size(88.dp), contentAlignment = Alignment.Center) {
            Canvas(Modifier.matchParentSize()) {
                drawCircle(
                    Color.White.copy(alpha = .12f),
                    size.minDimension / 2 - 1.dp.toPx(),
                    style = Stroke(1.dp.toPx()),
                )
                drawArc(
                    Color(0xFFC9E7D6).copy(alpha = .8f),
                    -100f,
                    56f,
                    false,
                    Offset(1.dp.toPx(), 1.dp.toPx()),
                    androidx.compose.ui.geometry.Size(
                        size.width - 2.dp.toPx(),
                        size.height - 2.dp.toPx(),
                    ),
                    style = Stroke(2.dp.toPx(), cap = StrokeCap.Round),
                )
            }
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    next?.time ?: "＋",
                    style = LaoType.title.copy(fontFamily = LaoDisplayFont),
                    color = Color.White,
                )
                Text(
                    if (next == null) "导入课表"
                    else if (next.day == DateMath.today()) "今天"
                    else dateLabel(next.day).substringAfter("  "),
                    style = LaoType.label,
                    color = Color.White.copy(alpha = .6f),
                )
            }
        }
    }
}

@Composable
internal fun LaoNudge(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val next = CampusGuide.ranked(s.a).firstOrNull()
    Row(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(c.primary.copy(alpha = .055f))
            .clickable { s.sheet = GuideSheet }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        LaoMascot(
            Modifier.size(44.dp).semantics { contentDescription = "查看捞捞提醒" },
            onTap = { s.sheet = GuideSheet },
        )
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                next?.let { it.time + " · " + it.title } ?: "嗨，我是捞捞。重要的事，我来提醒你。",
                style = LaoType.caption,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                next?.reason ?: "点我查看提醒，或粘贴整理班群消息",
                style = LaoType.label,
                color = c.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Icon(Icons.Rounded.ChevronRight, null, Modifier.size(16.dp), tint = c.onSurfaceVariant)
    }
}

@Composable
private fun LaoEntryStrip(s: CampusSession, entries: List<Pair<String, String>>) {
    val c = MaterialTheme.colorScheme
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        entries.forEachIndexed { index, (route, title) ->
            val hue =
                CampusAccent.readable(
                    listOf(
                        CampusAccent.blue,
                        CampusAccent.berry,
                        CampusAccent.violet,
                        CampusAccent.amber,
                    )[index % 4]
                )
            Column(
                Modifier.weight(1f)
                    .clip(LaoCorners.control)
                    .clickable { s.open(route) }
                    .padding(vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(
                    Modifier.size(40.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(hue.copy(alpha = .08f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(routeIcon(route), null, Modifier.size(22.dp), tint = hue)
                }
                Text(title, style = LaoType.caption, color = c.onSurface, maxLines = 1)
            }
        }
    }
}

@Composable
internal fun LaoPinnedTools(s: CampusSession) {
    val pinned = CampusToolbox.pinned(s.a)
    val routes = (0 until pinned.length()).map { pinned.optString(it) }
    if (routes.isEmpty())
        LaoEmpty("常用工具，由你来选", "把常用的课程表、错题本、记账和倒计时放在这里。", "选择工具") { s.sheet = ToolPickerSheet }
    else
        routes.chunked(4).forEach { group ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                group.forEach { route ->
                    Column(
                        Modifier.weight(1f)
                            .clip(LaoCorners.control)
                            .clickable { s.open(route) }
                            .padding(vertical = 8.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            routeIcon(route),
                            null,
                            Modifier.size(24.dp),
                            tint = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            CampusToolbox.name(route),
                            style = LaoType.caption,
                            maxLines = 2,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                repeat(4 - group.size) { Spacer(Modifier.weight(1f)) }
            }
        }
}

@Composable
internal fun LaoFeatureNote(s: CampusSession, route: String, title: String, note: String) {
    LaoPanel(Modifier.fillMaxWidth(), glass = true, onClick = { s.open(route) }) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Icon(
                routeIcon(route),
                null,
                Modifier.size(28.dp),
                tint = MaterialTheme.colorScheme.secondary,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(title, style = LaoType.cell)
                Text(
                    note,
                    style = LaoType.caption,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(Icons.Rounded.NorthEast, null, Modifier.size(16.dp))
        }
    }
}

@Composable
internal fun LaoTimeline(
    s: CampusSession,
    day: String,
    limit: Int = Int.MAX_VALUE,
    kind: String = "全部",
) {
    val c = MaterialTheme.colorScheme
    val classes = CampusCourses.onDay(s.a.store, day).takeIf { kind != "事项" }.orEmpty()
    val tasks = visibleTasks(s.a).filter { taskDate(it) == day }.takeIf { kind != "课程" }.orEmpty()
    val entries =
        (classes.map { Triple(it.optString("t0"), true, it) } +
                tasks.map { Triple(taskClock(it).ifBlank { "00:00" }, false, it) })
            .sortedBy { it.first }
            .take(limit)
    if (entries.isEmpty()) {
        LaoEmpty("这一天，安排从容", "粘贴班群消息，核对后加入日历。", "粘贴导入") { CampusSocial.pasteImport(s.a) }
        return
    }
    Column {
        entries.forEachIndexed { i, (clock, course, item) ->
            val hue = if (course) c.primary else CampusAccent.readable(CampusAccent.berry)
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(
                    Modifier.width(44.dp).padding(top = 12.dp),
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
                Box(Modifier.width(8.dp).fillMaxHeight()) {
                    if (i != entries.lastIndex)
                        Box(
                            Modifier.align(Alignment.TopCenter)
                                .padding(top = 20.dp)
                                .width(1.dp)
                                .fillMaxHeight()
                                .background(c.outlineVariant)
                        )
                    Box(Modifier.padding(top = 20.dp).size(7.dp).background(hue, CircleShape))
                }
                Row(
                    Modifier.weight(1f)
                        .padding(bottom = 8.dp)
                        .clip(RoundedCornerShape(20.dp))
                        .background(if (course) c.primary.copy(alpha = .06f) else Color.Transparent)
                        .clickable {
                            if (course) CampusCourses.detail(s.a, item)
                            else CampusSchool.detail(s.a, item)
                        }
                        .padding(horizontal = 12.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            if (course) item.optString("name") else taskTitle(item),
                            style = LaoType.cell,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            if (course) item.optString("location").ifBlank { "教室待确认" }
                            else
                                item.optString("msg_type", "个人") +
                                    " · " +
                                    if (s.a.done(item)) "已完成" else "待完成",
                            style = LaoType.caption,
                            color = c.onSurfaceVariant,
                        )
                    }
                    if (course)
                        Icon(Icons.Rounded.NorthEast, null, Modifier.size(16.dp), tint = hue)
                    else
                        LaoCheck(s.a.done(item), "切换完成 " + taskTitle(item)) {
                            s.a.mark(CampusJson.copy(item))
                        }
                }
            }
        }
    }
}

@Composable
internal fun LaoCheck(
    checked: Boolean,
    label: String,
    enabled: Boolean = true,
    change: (Boolean) -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val progress by
        animateFloatAsState(
            if (checked) 1f else 0f,
            if (LocalMotionEnabled.current) spring(.85f, 430f) else snap(),
            label = "task mark",
        )
    Box(
        Modifier.size(44.dp)
            .clip(CircleShape)
            .toggleable(checked, enabled = enabled, role = Role.Checkbox, onValueChange = change)
            .semantics { if (label.isNotBlank()) contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(22.dp)) {
            drawCircle(lerp(c.surface, c.primary, progress), size.width / 2 - 1.dp.toPx())
            drawCircle(
                if (checked) c.primary else c.outline,
                size.width / 2 - 1.dp.toPx(),
                style = Stroke(1.5.dp.toPx()),
            )
            if (progress > 0f) {
                val p =
                    Path().apply {
                        moveTo(size.width * .28f, size.height * .51f)
                        lineTo(size.width * .44f, size.height * .68f)
                        lineTo(size.width * .75f, size.height * .33f)
                    }
                drawPath(
                    p,
                    c.onPrimary.copy(alpha = progress),
                    style = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round),
                )
            }
        }
    }
}

@Composable
internal fun LaoTaskCell(s: CampusSession, item: JSONObject) {
    val c = MaterialTheme.colorScheme
    val done = s.a.done(item)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        LaoCheck(done, "完成 " + taskTitle(item)) { s.a.mark(CampusJson.copy(item)) }
        Column(
            Modifier.weight(1f).clickable { CampusSchool.detail(s.a, item) },
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                taskTitle(item),
                style = LaoType.cell,
                color = if (done) c.onSurfaceVariant else c.onSurface,
                textDecoration = if (done) TextDecoration.LineThrough else null,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                listOf(
                        item.optString("msg_type", "事项"),
                        item.optString("event_time"),
                        item.optString("location"),
                    )
                    .filter { it.isNotBlank() }
                    .joinToString(" · "),
                style = LaoType.caption,
                color = c.onSurfaceVariant,
                maxLines = 2,
            )
        }
        LaoIconButton(Icons.Rounded.MoreHoriz, "事项操作") { CampusSchool.detail(s.a, item) }
    }
    HorizontalDivider(Modifier.padding(start = 52.dp), color = c.outlineVariant.copy(alpha = .5f))
}

@Composable
internal fun LaoHabitCell(s: CampusSession, h: JSONObject) {
    val checked =
        s.a.store
            .`object`("habit_log_v1")
            .optJSONObject(h.optString("id"))
            ?.optBoolean(DateMath.today()) == true
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LaoCheck(checked, "打卡 " + h.optString("name")) {
            CampusLearn.habitToggle(s.a, h, DateMath.today())
        }
        Column(
            Modifier.weight(1f).clickable { CampusLearn.habitForm(s.a, h) },
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(h.optString("name"), style = LaoType.cell)
            Text(
                if (checked) "今天的小目标，已完成" else "让今天再好一点点",
                style = LaoType.caption,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        LaoIconButton(Icons.Rounded.MoreHoriz, "编辑习惯 " + h.optString("name")) {
            CampusLearn.habitForm(s.a, h)
        }
    }
}
