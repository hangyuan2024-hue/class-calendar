package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*
import java.util.Calendar
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

private fun webGreeting(hour: Int) =
    when {
        hour < 5 -> "夜深了"
        hour < 9 -> "早上好"
        hour < 12 -> "上午好"
        hour < 14 -> "中午好"
        hour < 18 -> "下午好"
        else -> "晚上好"
    }

private fun webHomeCards(a: CampusActivity): List<String> {
    val custom = a.store.`object`("native_compose_home_v1")
    val source = if (custom.has("home")) custom else CampusHome.layout(a.store)
    val options = a.store.`object`("fun_opts_v1")
    return rows(source.optJSONArray("home") ?: JSONArray())
        .map { it.optString("id") }
        .distinct()
        .filter { id ->
            val option =
                when (id) {
                    "w:rings" -> "rings"
                    "w:habits" -> "habits"
                    "w:plan",
                    "w:pomo" -> "plan"
                    "w:farm" -> "farm"
                    else -> ""
                }
            option.isEmpty() || options.optBoolean(option, true)
        }
}

@Composable
internal fun WebHomePage(s: CampusSession) {
    val a = s.a
    val c = WebDesign.colors()
    val day = DateMath.today()
    val modules = webHomeCards(a)
    val pending = visibleTasks(a).filter { !a.done(it) }
    val stats = weekStats(a)
    LaunchedEffect(a.cid(), a.api.uid()) {
        if (
            a.api.logged() &&
                a.cid().isNotBlank() &&
                a.store.string("cache_wall_class", "") != a.cid()
        )
            CampusSocial.loadWall(a)
    }
    WebPage {
        animatedItem(0, "web-home-heading") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text("每一天都值得认真", style = WebDesign.eyebrow, color = c.sub)
                    Text("学习工作台.", style = WebDesign.headline, color = c.ink)
                }
                WebIconButton(Icons.Rounded.QuestionMark, "首页功能介绍") { s.sheet = GuideSheet }
            }
        }
        if (!a.api.logged())
            animatedItem(1, "web-home-login") {
                WebCard(Modifier.fillMaxWidth()) {
                    Text("登录后可以看到你的捞捞课程表。", style = WebDesign.body, color = c.ink)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "不登录也能使用我的事项和工具",
                            Modifier.weight(1f),
                            style = WebDesign.caption,
                            color = c.sub,
                        )
                        WebButton("登录 / 注册 →", filled = false) { s.open("login") }
                    }
                }
            }
        animatedItem(2, "web-home-hero") { WebGreetingHero(s, pending) }
        if (a.loading)
            animatedItem(3, "web-home-loading") {
                WebCard(Modifier.fillMaxWidth()) {
                    LinearProgressIndicator(
                        Modifier.fillMaxWidth(),
                        color = c.primary,
                        trackColor = c.selected,
                    )
                    Text("正在同步课程与班级…", style = WebDesign.caption, color = c.sub)
                }
            }
        else if (a.api.logged() && a.cloudError.isNotBlank())
            animatedItem(3, "web-home-error") {
                WebCard(Modifier.fillMaxWidth()) {
                    WebEmpty("同步暂未完成", a.cloudError, "重试") { a.refreshCloud() }
                }
            }
        animatedItem(4, "web-home-agenda") { WebUpcomingAgenda(s) }
        animatedItem(5, "web-home-space") {
            WebSectionTitle("我的学习空间", eyebrow = "为今天而安排", action = "⊞ 自定义首页") {
                s.sheet = HomeEditorSheet
            }
        }
        val groups = mutableListOf<List<String>>()
        var i = 0
        while (i < modules.size) {
            val id = modules[i]
            if (
                id in listOf("w:hw", "w:cal") &&
                    i + 1 < modules.size &&
                    modules[i + 1] in listOf("w:hw", "w:cal")
            ) {
                groups.add(listOf(id, modules[i + 1]))
                i += 2
            } else {
                groups.add(listOf(id))
                i++
            }
        }
        groups.forEachIndexed { index, group ->
            if (
                group == listOf("w:pins") &&
                    campusWallRows(a).none {
                        it.optString("pinned_at").isNotBlank() && !it.isNull("pinned_at")
                    }
            )
                return@forEachIndexed
            animatedItem(index + 6, "web-home-module-" + group.joinToString("-")) {
                if (group.size == 2)
                    Row(
                        Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        group.forEach { id ->
                            WebHomeStatTile(s, id, pending, Modifier.weight(1f).fillMaxHeight())
                        }
                    }
                else
                    when (val id = group.first()) {
                        "w:hw",
                        "w:cal" -> WebHomeStatTile(s, id, pending, Modifier.fillMaxWidth())
                        "w:rings" -> WebProgressRings(s, stats)
                        "w:quick" -> WebHomeQuickTools(s)
                        "w:encourage" -> WebDailyQuote(s)
                        "w:plan" -> WebHomeQuadrants(s, pending)
                        "w:farm" -> WebFarmCard(s)
                        "w:wall",
                        "w:pins" -> WebHomeWall(s, pinned = id == "w:pins")
                        "w:rank" -> WebHomeRank(s)
                        "w:habits" -> WebHomeHabits(s)
                        "w:course" -> WebHomeCourses(s, day)
                        else -> {
                            val route = CampusHome.route(id)
                            if (route.isNotBlank())
                                WebCard(Modifier.fillMaxWidth(), onClick = { s.open(route) }) {
                                    WebLinkRow(
                                        CampusHome.name(id),
                                        CampusToolbox.description(route),
                                        routeIcon(route),
                                    ) {
                                        s.open(route)
                                    }
                                }
                        }
                    }
            }
        }
    }
}

@Composable
private fun WebGreetingHero(s: CampusSession, pending: List<JSONObject>) {
    val a = s.a
    val c = WebDesign.colors()
    var tick by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            tick = System.currentTimeMillis()
        }
    }
    val now = Calendar.getInstance().apply { timeInMillis = tick }
    val day = DateMath.today()
    val hour = now.get(Calendar.HOUR_OF_DAY)
    val courses = CampusCourses.onDay(a.store, day)
    val ranked = CampusGuide.ranked(a)
    val next = ranked.firstOrNull() ?: CampusGuide.nextCourse(a)
    val overdue =
        pending.count {
            it.optString("msg_type") == "作业" && taskDate(it).isNotEmpty() && taskDate(it) < day
        }
    val todayTasks = pending.filter { taskDate(it) == day }
    val todayHomework = todayTasks.count { it.optString("msg_type") == "作业" }
    val say =
        when {
            overdue > 0 -> "有 $overdue 项作业已经过期了，快去看看！"
            todayHomework > 0 -> "今天有 $todayHomework 项作业要交，别忘啦～"
            todayTasks.isNotEmpty() -> "今天有 ${todayTasks.size} 件事，一件件来"
            else -> "今天没有要交的作业，喘口气吧～"
        }
    val night = hour >= 23 || hour < 5
    Box(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(c.hero)
            .border(1.dp, c.primary.copy(alpha = .16f), RoundedCornerShape(18.dp))
    ) {
        Canvas(Modifier.matchParentSize()) {
            repeat(3) { ring ->
                drawCircle(
                    c.primary.copy(alpha = .08f),
                    size.width * (.24f + ring * .17f),
                    Offset(size.width * .95f, size.height * .22f),
                    style = Stroke(1.dp.toPx()),
                )
            }
        }
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(
                    dateLabel(day) + " · 第 ${CampusCourses.week(a.store, day)} 周",
                    Modifier.clip(RoundedCornerShape(6.dp))
                        .background(c.card.copy(alpha = .7f))
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    style = WebDesign.eyebrow,
                    color = c.primary,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    "🌐 元宇宙",
                    Modifier.laoTap { s.open("meta") },
                    style = WebDesign.caption,
                    color = c.sub,
                )
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        webGreeting(hour) + if (a.api.logged()) "，${campusName(a)}" else "",
                        style = WebDesign.headline.copy(fontSize = 28.sp, lineHeight = 36.sp),
                        color = c.ink,
                    )
                    Text(say, style = WebDesign.caption, color = c.sub)
                }
                if (CampusGuide.enabled(a))
                    LaoMascot(Modifier.size(80.dp).rotate(8f), onTap = { s.sheet = GuideSheet })
            }
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .background(c.card.copy(alpha = .92f))
                    .laoTap {
                        if (next?.course == true) s.open("courses")
                        else if (next != null) CampusSchool.detail(a, next.source)
                        else s.open("pomo")
                    }
                    .padding(12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (next?.course == true) "下一节"
                    else if (next != null) "接下来" else if (night) "早点睡" else "空闲",
                    Modifier.clip(RoundedCornerShape(5.dp))
                        .background(c.selected)
                        .padding(horizontal = 6.dp, vertical = 5.dp),
                    style = WebDesign.eyebrow,
                    color = c.primary,
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(
                        next?.title ?: if (night) "明天没有要赶的事" else "手头没有要赶的事",
                        style = WebDesign.caption.copy(fontWeight = FontWeight.Bold),
                        color = c.ink,
                        maxLines = 2,
                    )
                    Text(
                        next?.let {
                            listOf(it.time, it.location)
                                .filter(String::isNotBlank)
                                .joinToString(" · ")
                                .ifBlank { it.reason }
                        } ?: if (night) "睡饱了脑子才转得快" else "来一个番茄专注一下？",
                        style = WebDesign.caption,
                        color = c.sub,
                        maxLines = 2,
                    )
                }
                if (next == null && !night)
                    Text("🍅 开始", style = WebDesign.caption, color = c.primary)
                else if (next?.reason?.isNotBlank() == true)
                    Text(
                        next.reason,
                        Modifier.widthIn(max = 65.dp),
                        style = WebDesign.eyebrow,
                        color = c.primary,
                        maxLines = 2,
                    )
            }
            WebDayTrack(s, courses, todayTasks, now)
        }
    }
}

private fun webMinutes(value: String): Int? {
    val match = Regex("(\\d{1,2}):(\\d{2})").find(value) ?: return null
    return (match.groupValues[1].toInt() * 60 + match.groupValues[2].toInt()).takeIf {
        it in 0..1439
    }
}

@Composable
private fun WebDayTrack(
    s: CampusSession,
    courses: List<JSONObject>,
    tasks: List<JSONObject>,
    now: Calendar,
) {
    val c = WebDesign.colors()
    val timed = tasks.filter { webMinutes(it.optString("event_time")) != null }
    val nowMinutes = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("今天", style = WebDesign.caption.copy(fontWeight = FontWeight.Bold), color = c.ink)
            Text(
                if (courses.isEmpty() && tasks.isEmpty()) "没有课，也没有要做的事"
                else "${courses.size} 节课 · ${tasks.size} 件事",
                style = WebDesign.caption,
                color = c.sub,
            )
        }
        Canvas(
            Modifier.fillMaxWidth()
                .height(24.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(c.card.copy(alpha = .55f))
                .laoTap { s.open("calendar") }
        ) {
            val start =
                minOf(480, courses.mapNotNull { webMinutes(it.optString("t0")) }.minOrNull() ?: 480)
            val end =
                maxOf(
                    1320,
                    courses.mapNotNull { webMinutes(it.optString("t1")) }.maxOrNull() ?: 1320,
                )
            fun x(minutes: Int) =
                ((minutes - start).toFloat() / (end - start)).coerceIn(0f, 1f) * size.width
            courses.forEach { course ->
                val from = webMinutes(course.optString("t0")) ?: return@forEach
                val to = webMinutes(course.optString("t1")) ?: (from + 45)
                drawRoundRect(
                    c.primary.copy(alpha = if (to < nowMinutes) .28f else .7f),
                    Offset(x(from), 3.dp.toPx()),
                    Size(maxOf(4.dp.toPx(), x(to) - x(from)), size.height - 6.dp.toPx()),
                    CornerRadius(4.dp.toPx()),
                )
            }
            timed.forEach { task ->
                val minute = webMinutes(task.optString("event_time")) ?: return@forEach
                drawCircle(
                    if (task.optString("msg_type") == "作业") Color(0xFFBF6650) else c.primary,
                    3.dp.toPx(),
                    Offset(x(minute), size.height / 2),
                )
            }
            if (nowMinutes >= start)
                drawLine(
                    c.primary,
                    Offset(x(nowMinutes), 0f),
                    Offset(x(nowMinutes), size.height),
                    1.dp.toPx(),
                )
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("8:00", "12:00", "18:00", "22:00").forEach {
                Text(it, style = WebDesign.caption.copy(fontSize = 10.sp), color = c.sub)
            }
        }
    }
}

@Composable
private fun WebUpcomingAgenda(s: CampusSession) {
    val a = s.a
    val c = WebDesign.colors()
    val today = DateMath.today()
    val limit = DateMath.plus(today, 13)
    val tasks = visibleTasks(a).filter { taskDate(it) in today..limit }.groupBy { taskDate(it) }
    val days =
        (listOf(today) +
                tasks.keys +
                (0..13)
                    .map { DateMath.plus(today, it) }
                    .filter { CampusCourses.onDay(a.store, it).isNotEmpty() })
            .distinct()
            .sorted()
    WebCard(Modifier.fillMaxWidth(), padding = 18.dp) {
        WebSectionTitle("接下来的安排", eyebrow = "即将到来")
        HorizontalDivider(Modifier.padding(vertical = 6.dp), color = c.line)
        days.take(6).forEach { day ->
            Row(
                Modifier.padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    when (day) {
                        today -> "今天"
                        DateMath.plus(today, 1) -> "明天"
                        else -> dateLabel(day).substringAfter(" ")
                    },
                    style = WebDesign.body.copy(fontWeight = FontWeight.Bold),
                    color = c.ink,
                )
                Text(dateLabel(day), style = WebDesign.caption, color = c.sub)
            }
            val dayCourses = CampusCourses.onDay(a.store, day)
            val dayTasks = tasks[day].orEmpty()
            if (dayCourses.isEmpty() && dayTasks.isEmpty()) WebEmpty("今天没有安排，轻松一下 ☕")
            else {
                dayCourses.forEach { course ->
                    Row(
                        Modifier.fillMaxWidth()
                            .laoTap { CampusCourses.detail(a, course) }
                            .padding(vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(Modifier.size(6.dp).clip(CircleShape).background(c.primary))
                        Text(
                            course.optString("name"),
                            Modifier.weight(1f),
                            style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
                            color = c.ink,
                            maxLines = 2,
                        )
                        Text(course.optString("t0"), style = WebDesign.caption, color = c.sub)
                    }
                }
                dayTasks.forEach { WebLearningTaskCell(s, it, showDeadline = false) }
            }
        }
        if (days.size > 6)
            WebButton("查看全部 ${days.size} 天的安排 →", filled = false) { s.open("calendar") }
        Text(
            "只显示今天起两周内的安排，更早或更晚的去日历里看",
            Modifier.padding(top = 8.dp),
            style = WebDesign.caption,
            color = c.sub,
        )
    }
}

@Composable
private fun WebHomeStatTile(
    s: CampusSession,
    id: String,
    pending: List<JSONObject>,
    modifier: Modifier,
) {
    val c = WebDesign.colors()
    val today = DateMath.today()
    val end = DateMath.plus(today, 13)
    val homework = id == "w:hw"
    val count =
        pending.count {
            if (homework) it.optString("msg_type") == "作业" && taskDate(it) in today..end
            else taskDate(it) == today
        }
    WebCard(
        modifier,
        color = if (homework) c.apricot else c.sage,
        onClick = { s.open(if (homework) "homework" else "calendar") },
    ) {
        Text(if (homework) "作业" else "日历", style = WebDesign.title, color = c.ink)
        Text(if (homework) "两周内要交" else dateLabel(today), style = WebDesign.caption, color = c.sub)
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                count.toString(),
                fontSize = 32.sp,
                lineHeight = 40.sp,
                fontWeight = FontWeight.Bold,
                color = c.ink,
            )
            Text(
                if (homework) "项没交" else "今天待办",
                Modifier.padding(bottom = 5.dp),
                style = WebDesign.caption,
                color = c.sub,
            )
        }
        Text(
            if (homework) "去完成 ▶" else "打开 ▶",
            Modifier.align(Alignment.End),
            style = WebDesign.caption,
            color = c.ink,
        )
    }
}

@Composable
private fun WebProgressRings(s: CampusSession, stats: IntArray) {
    val c = WebDesign.colors()
    WebCard(Modifier.fillMaxWidth(), padding = 20.dp, onClick = { s.open("growth") }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("本周作业", "本周事项", "今日打卡").forEachIndexed { index, label ->
                val done = stats[index * 2]
                val total = stats[index * 2 + 1]
                Column(
                    Modifier.weight(1f),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Box(Modifier.size(46.dp), contentAlignment = Alignment.Center) {
                        Canvas(Modifier.matchParentSize()) {
                            drawCircle(c.line, style = Stroke(4.dp.toPx()))
                            if (total > 0)
                                drawArc(
                                    c.primary,
                                    -90f,
                                    360f * done / total,
                                    false,
                                    style = Stroke(4.dp.toPx(), cap = StrokeCap.Round),
                                )
                        }
                        Text(
                            if (total == 0) "–" else "${done * 100 / total}%",
                            style = WebDesign.eyebrow,
                            color = c.sub,
                        )
                    }
                    Text(label, style = WebDesign.eyebrow, color = c.ink)
                    Text("$done / $total", style = WebDesign.caption, color = c.sub)
                }
            }
        }
    }
}

private fun webToolName(route: String) =
    when (route) {
        "study" -> "课内学习"
        "mindmap" -> "捞捞思维导图"
        "lan" -> "局域网传输"
        "plan" -> "规划"
        "meta" -> "元宇宙空间"
        else -> CampusToolbox.name(route)
    }

private fun webToolEmoji(route: String) =
    when (route) {
        "study" -> "📖"
        "mindmap" -> "🧠"
        "lan" -> "📡"
        "growth" -> "📈"
        "plan" -> "🎯"
        "farm" -> "🐣"
        "meta" -> "🪐"
        "courses" -> "📚"
        "wrongbook" -> "📒"
        "ledger" -> "💰"
        "countdown" -> "⏳"
        "diary" -> "📔"
        "pomo" -> "🍅"
        "draw" -> "🎲"
        "phone" -> "📱"
        "tools" -> "🧩"
        "wall" -> "💬"
        "rank" -> "🏆"
        "intro" -> "📖"
        "calendar" -> "🗓️"
        else -> "✦"
    }

@Composable
private fun WebHomeQuickTools(s: CampusSession) {
    val chosen = CampusToolbox.pinned(s.a).let { (0 until it.length()).map(it::optString) }
    val base =
        listOf(
            "note",
            "plan",
            "growth",
            "farm",
            "pomo",
            "courses",
            "study",
            "calendar",
            "tools",
            "intro",
            "lan",
            "choose",
        )
    val routes = (base.take(8) + chosen.filter { it !in base } + base.drop(8)).distinct()
    val c = WebDesign.colors()
    WebCard(Modifier.fillMaxWidth(), padding = 8.dp) {
        routes.chunked(4).forEach { group ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                group.forEach { route ->
                    Column(
                        Modifier.weight(1f)
                            .heightIn(min = 72.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .laoTap {
                                when (route) {
                                    "note" -> {
                                        s.a.selectedDay = DateMath.today()
                                        CampusSchool.personalForm(s.a, null)
                                    }
                                    "choose" -> s.sheet = ToolPickerSheet
                                    else -> s.open(route)
                                }
                            }
                            .padding(vertical = 6.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            if (route == "choose") "＋"
                            else if (route == "note") "✏️" else webToolEmoji(route),
                            Modifier.clip(RoundedCornerShape(8.dp)).background(c.bg).padding(6.dp),
                            fontSize = 18.sp,
                        )
                        Text(
                            when (route) {
                                "note" -> "记一件事"
                                "choose" -> "自选"
                                "growth" -> "打卡成长"
                                "tools" -> "全部工具"
                                else -> webToolName(route)
                            },
                            style = WebDesign.caption.copy(fontSize = 11.sp),
                            color = c.ink,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                        )
                    }
                }
                repeat(4 - group.size) { Spacer(Modifier.weight(1f)) }
            }
        }
    }
}

@Composable
private fun WebDailyQuote(s: CampusSession) {
    val c = WebDesign.colors()
    val index =
        Math.floorMod(
            s.a.store.number("native_quote", DateMath.today().hashCode()),
            CampusHome.QUOTES.size,
        )
    WebCard(Modifier.fillMaxWidth(), padding = 0.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.width(58.dp)
                    .height(100.dp)
                    .background(
                        Brush.horizontalGradient(
                            listOf(c.primary.copy(alpha = .7f), c.primary.copy(alpha = .03f))
                        )
                    ),
                contentAlignment = Alignment.Center,
            ) {
                Text("🌟", fontSize = 27.sp)
            }
            Column(
                Modifier.weight(1f).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("🌱 每日一句", style = WebDesign.caption, color = c.sub)
                Text(
                    CampusHome.QUOTES[index],
                    style = WebDesign.body.copy(fontWeight = FontWeight.Bold),
                    color = c.ink,
                )
                Text("慢慢来，认真过好今天。", style = WebDesign.caption, color = c.sub)
            }
            Text(
                "↻",
                Modifier.size(40.dp)
                    .laoTap {
                        s.a.store.set("native_quote", index + 1)
                        s.a.build()
                    }
                    .wrapContentSize(),
                fontSize = 20.sp,
                color = c.sub,
            )
        }
    }
}

@Composable
private fun WebHomeQuadrants(s: CampusSession, pending: List<JSONObject>) {
    val c = WebDesign.colors()
    val quad = s.a.store.`object`("quad_v1")
    WebCard(Modifier.fillMaxWidth()) {
        WebSectionTitle("🎯 规划", action = "打开 ›") { s.open("plan") }
        Text("四象限 · ${pending.size} 件待办", style = WebDesign.caption, color = c.sub)
        listOf("重要且紧急", "重要不紧急", "紧急不重要", "不重要不紧急").chunked(2).forEachIndexed { row, labels ->
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                labels.forEachIndexed { col, label ->
                    val q = row * 2 + col + 1
                    val selected =
                        pending.filter {
                            quad.optInt(
                                it.optString("_key", it.optString("id")),
                                CampusPlanner.defaultQuad(it),
                            ) == q
                        }
                    val hue = listOf(Color(0xFFBF6650), c.primary, Color(0xFFA8934C), c.sub)[q - 1]
                    Column(
                        Modifier.weight(1f)
                            .fillMaxHeight()
                            .heightIn(min = 84.dp)
                            .clip(RoundedCornerShape(9.dp))
                            .background(hue.copy(alpha = .045f))
                            .border(1.dp, hue.copy(alpha = .2f), RoundedCornerShape(9.dp))
                            .laoTap { s.open("plan") }
                            .padding(10.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(label, style = WebDesign.eyebrow, color = hue)
                        Text(
                            selected
                                .take(2)
                                .joinToString("\n") {
                                    it.optString("subject").ifBlank { it.optString("summary") }
                                }
                                .ifBlank { if (q == 1) "没有急事 👍" else "空" },
                            style = WebDesign.caption,
                            color = c.sub,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun WebFarmCard(s: CampusSession) {
    val c = WebDesign.colors()
    val farm = s.a.store.`object`("farm_v1")
    WebCard(Modifier.fillMaxWidth(), onClick = { s.open("farm") }) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("☁️", fontSize = 36.sp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    farm.optString("name", "小云朵") + "  Lv.${farm.optInt("level", 1)}",
                    style = WebDesign.body.copy(fontWeight = FontWeight.Bold),
                    color = c.ink,
                )
                Text(
                    "💧 养料 ${maxOf(0L, CampusLearn.food(s.a) - farm.optLong("spent"))}",
                    style = WebDesign.caption,
                    color = c.sub,
                )
            }
            Text("喂养 ›", style = WebDesign.caption, color = c.sub)
        }
    }
}

@Composable
private fun WebHomeWall(s: CampusSession, pinned: Boolean) {
    val c = WebDesign.colors()
    val posts =
        campusWallRows(s.a)
            .filter {
                !pinned || (it.optString("pinned_at").isNotBlank() && !it.isNull("pinned_at"))
            }
            .take(if (pinned) 1 else 2)
    WebCard(Modifier.fillMaxWidth()) {
        WebSectionTitle(if (pinned) "📌 置顶通知" else "班级墙", action = "全部 ›") { s.open("wall") }
        if (posts.isEmpty())
            WebEmpty(if (s.a.cid().isBlank()) "找到班级，和同学一起捞捞" else "还没有班级动态", action = "打开班级墙") {
                s.open("wall")
            }
        posts.forEach { post ->
            Column(
                Modifier.fillMaxWidth()
                    .laoTap { CampusSocial.comments(s.a, post) }
                    .padding(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(post.optString("author_name", "同学"), style = WebDesign.eyebrow, color = c.sub)
                Text(
                    listOf(post.optString("title"), post.optString("body"))
                        .filter(String::isNotBlank)
                        .joinToString("\n"),
                    style = WebDesign.body,
                    color = c.ink,
                    maxLines = 4,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

@Composable
private fun WebHomeRank(s: CampusSession) {
    val c = WebDesign.colors()
    val cached = s.a.store.get("cache_rank", null)
    val data = CampusJson.`object`(cached)
    val ranks =
        if (
            s.a.api.logged() &&
                s.a.cid().isNotBlank() &&
                s.a.store.string("native_rank_class", s.a.cid()) == s.a.cid()
        )
            rows(data.optJSONArray("rows") ?: CampusJson.arr(cached)).take(3)
        else emptyList()
    LaunchedEffect(s.a.cid(), s.a.api.uid()) {
        if (s.a.api.logged() && s.a.cid().isNotBlank() && cached == null)
            CampusLearn.loadRank(s.a, "week")
    }
    WebCard(Modifier.fillMaxWidth()) {
        WebSectionTitle("🏆 本周排行", action = "全部 ›") { s.open("rank") }
        if (ranks.isEmpty()) WebEmpty("完成任务，就能留下真实的成长记录", action = "班级成长榜") { s.open("rank") }
        ranks.forEachIndexed { i, person ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(listOf("🥇", "🥈", "🥉")[i], fontSize = 18.sp)
                Text(
                    person.optString("name", "同学"),
                    Modifier.weight(1f),
                    style = WebDesign.body,
                    color = c.ink,
                )
                Text(
                    person.optString("points", "0"),
                    style = WebDesign.body.copy(fontWeight = FontWeight.Bold),
                    color = c.primary,
                )
            }
        }
    }
}

@Composable
private fun WebHomeHabits(s: CampusSession) {
    val c = WebDesign.colors()
    val habits = rows(s.a.store.list("habits_v1"))
    val log = s.a.store.`object`("habit_log_v1")
    WebCard(Modifier.fillMaxWidth()) {
        WebSectionTitle("🔥 今日打卡", action = "全部 ›") { s.open("growth") }
        if (habits.isEmpty()) WebEmpty("还没有习惯", action = "去添加") { s.open("growth") }
        habits.take(3).forEach { habit ->
            val done =
                log.optJSONObject(habit.optString("id"))?.optBoolean(DateMath.today(), false) ==
                    true
            Row(
                Modifier.fillMaxWidth().laoTap { s.open("growth") }.padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    habit.optString("icon", "🌱") + " " + habit.optString("name"),
                    Modifier.weight(1f),
                    style = WebDesign.body,
                    color = c.ink,
                )
                Text(if (done) "✓ 已打卡" else "去打卡", style = WebDesign.caption, color = c.primary)
            }
        }
    }
}

@Composable
private fun WebHomeCourses(s: CampusSession, day: String) {
    val c = WebDesign.colors()
    WebCard(Modifier.fillMaxWidth()) {
        WebSectionTitle("📚 今日课程", action = "课表 ›") { s.open("courses") }
        val courses = CampusCourses.onDay(s.a.store, day)
        if (courses.isEmpty()) WebEmpty("今天没有课，留一点时间给自己")
        courses.forEach { course ->
            WebLinkRow(
                course.optString("name"),
                course.optString("t0") + " · " + course.optString("location"),
                Icons.Rounded.School,
            ) {
                CampusCourses.detail(s.a, course)
            }
        }
    }
}

@Composable
internal fun WebToolsPage(s: CampusSession) {
    val c = WebDesign.colors()
    var query by rememberSaveable { mutableStateOf("") }
    val pinned = CampusToolbox.pinned(s.a).let { (0 until it.length()).map(it::optString) }
    val installed = (listOf("growth", "plan", "farm", "meta") + pinned).distinct()
    val catalog =
        (listOf(
                arrayOf("study", "课内学习", "资料、笔记、考核、错题和知识框架，按课程整理", "学习"),
                arrayOf("mindmap", "捞捞思维导图", "把知识点、问题和计划整理成一张图；支持粘贴 AI 内容", "学习"),
                arrayOf("lan", "局域网传输", "同账号、同一局域网，与网页和电脑版加密直连同步", "手机"),
            ) + CampusToolbox.ITEMS.toList())
            .distinctBy { it[0] }
    val shown = catalog.filter { (it[1] + it[2]).contains(query, true) }
    WebPage(spacing = 12.dp) {
        animatedItem(0, "web-tools-heading") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("工具", Modifier.weight(1f), style = WebDesign.headline, color = c.ink)
                WebButton("＋ 添加工具") { s.sheet = ToolPickerSheet }
                Spacer(Modifier.width(8.dp))
                WebIconButton(Icons.Rounded.QuestionMark, "工具功能介绍") { s.open("intro") }
            }
        }
        listOf("mindmap", "study").forEachIndexed { index, route ->
            animatedItem(index + 1, "web-tools-feature-$route") {
                val entry = catalog.first { it[0] == route }
                WebCatalogRow(s, entry, openOnly = true)
            }
        }
        animatedItem(3, "web-tools-mine-title") {
            WebSectionTitle("我的工具")
            Text("常用工具都在这里，点「⋯」可以放到首页或移出常用", style = WebDesign.caption, color = c.sub)
        }
        (installed + "choose").chunked(3).forEachIndexed { index, group ->
            animatedItem(index + 4, "web-tools-grid-$index") {
                Row(
                    Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    group.forEach { route ->
                        WebCard(
                            Modifier.weight(1f).fillMaxHeight().heightIn(min = 116.dp),
                            padding = 10.dp,
                            onClick = {
                                if (route == "choose") s.sheet = ToolPickerSheet else s.open(route)
                            },
                        ) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                if (route != "choose")
                                    Text(
                                        "⋯",
                                        Modifier.size(24.dp)
                                            .laoTap {
                                                s.a.ui.choose(
                                                    webToolName(route),
                                                    arrayOf(
                                                        "打开工具",
                                                        if (route in pinned) "移出常用" else "添加到首页快捷工具",
                                                    ),
                                                ) { choice ->
                                                    if (choice == 0) s.open(route)
                                                    else {
                                                        val next =
                                                            if (route in pinned)
                                                                pinned.filterNot { it == route }
                                                            else pinned + route
                                                        s.a.store.set(
                                                            "native_home_tools",
                                                            JSONArray(next),
                                                        )
                                                        s.a.build()
                                                    }
                                                }
                                            }
                                            .wrapContentSize(),
                                        style = WebDesign.body,
                                        color = c.sub,
                                    )
                                else Spacer(Modifier.height(24.dp))
                            }
                            Text(
                                if (route == "choose") "＋" else webToolEmoji(route),
                                Modifier.align(Alignment.CenterHorizontally)
                                    .clip(RoundedCornerShape(10.dp))
                                    .background(c.bg)
                                    .padding(8.dp),
                                fontSize = 22.sp,
                            )
                            Text(
                                if (route == "choose") "添加工具" else webToolName(route),
                                Modifier.fillMaxWidth(),
                                style = WebDesign.caption.copy(fontWeight = FontWeight.SemiBold),
                                color = c.ink,
                                textAlign = TextAlign.Center,
                                maxLines = 2,
                            )
                        }
                    }
                    repeat(3 - group.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        animatedItem(8, "web-tools-catalog-title") {
            WebSectionTitle("添加工具")
            Text("所有工具都由原生 App 运行，收藏后从首页快速打开", style = WebDesign.caption, color = c.sub)
            WebInput(query, { query = it }, "搜索工具、功能或关键词", Modifier.fillMaxWidth())
        }
        if (shown.isEmpty())
            animatedItem(9, "web-tools-no-results") {
                WebEmpty("没有找到这个工具", "换一个关键词试试看", "清空搜索") { query = "" }
            }
        shown.forEachIndexed { index, entry ->
            animatedItem(index + 9, "web-catalog-" + entry[0]) { WebCatalogRow(s, entry) }
        }
    }
}

@Composable
private fun WebCatalogRow(s: CampusSession, entry: Array<String>, openOnly: Boolean = false) {
    val c = WebDesign.colors()
    val route = entry[0]
    val pinned = CampusToolbox.pinned(s.a).let { (0 until it.length()).map(it::optString) }
    WebCard(Modifier.fillMaxWidth(), padding = 16.dp) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                webToolEmoji(route),
                Modifier.size(44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(c.bg)
                    .wrapContentSize(),
                fontSize = 25.sp,
            )
            Column(
                Modifier.weight(1f).laoTap { s.open(route) },
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(
                    if (route == "courses") "课程表" else entry[1],
                    style = WebDesign.title,
                    color = c.ink,
                )
                Text(
                    entry[2],
                    style = WebDesign.caption,
                    color = c.sub,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                WebButton("打开 ›", filled = false) { s.open(route) }
                if (!openOnly)
                    Text(
                        if (route in pinned) "已收藏" else "＋ 收藏",
                        Modifier.laoTap {
                                val next =
                                    if (route in pinned) pinned.filterNot { it == route }
                                    else pinned + route
                                s.a.store.set("native_home_tools", JSONArray(next))
                                s.a.build()
                            }
                            .padding(vertical = 6.dp),
                        style = WebDesign.eyebrow,
                        color = c.sub,
                    )
            }
        }
    }
}

@Composable
internal fun WebProfilePage(s: CampusSession) {
    val a = s.a
    val c = WebDesign.colors()
    val logged = a.api.logged()
    val palette = a.store.`object`("ui_palette_v1").optString("id", "ocean")
    WebPage {
        animatedItem(0, "web-me-heading") { Text("我的", style = WebDesign.headline, color = c.ink) }
        animatedItem(1, "web-me-account") {
            WebCard(Modifier.fillMaxWidth(), padding = 18.dp) {
                if (logged) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        CampusAvatar(campusName(a), a.me.optString("gender"), Modifier.size(64.dp))
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text(campusName(a), style = WebDesign.headline, color = c.ink)
                            Text(
                                CampusActivity.roleName(a.me.optString("role")) +
                                    " · @" +
                                    a.me.optString("account"),
                                style = WebDesign.caption,
                                color = c.sub,
                            )
                            if (a.me.optString("org_name").isNotBlank())
                                Text(
                                    a.me.optString("org_name"),
                                    style = WebDesign.caption,
                                    color = c.sub,
                                )
                        }
                    }
                    Text(
                        a.me.optString("bio").ifBlank { "还没有个性签名，写一句介绍自己吧" },
                        style = WebDesign.body,
                        color = c.sub,
                    )
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        WebButton("编辑资料", filled = false) { s.sheet = ProfileEditorSheet }
                        WebButton("我的主页 ›") { CampusSocial.loadUser(a, a.api.uid()) }
                    }
                } else {
                    Box(
                        Modifier.size(64.dp).clip(RoundedCornerShape(13.dp)).background(c.selected),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("?", fontSize = 30.sp, fontWeight = FontWeight.Bold, color = c.primary)
                    }
                    Text(
                        "还没登录",
                        Modifier.padding(top = 8.dp),
                        style = WebDesign.headline,
                        color = c.ink,
                    )
                    Text("登录后能看捞捞课程表，我的事项不登录也能用", style = WebDesign.body, color = c.sub)
                    WebButton("登录", Modifier.align(Alignment.End)) { s.open("login") }
                }
            }
        }
        animatedItem(2, "web-me-data-heading") { WebSectionTitle("我的数据", eyebrow = "存在哪里，你说了算") }
        animatedItem(3, "web-me-storage") {
            WebCard(Modifier.fillMaxWidth()) {
                WebLinkRow(
                    "保存位置 · ${if (a.store.bool("native_sync_local", false)) "本机" else "云端同步"}",
                    if (!logged) "登录后可以同步到云端，换手机也能看到"
                    else if (a.store.bool("native_sync_local", false)) "只保存在这台设备上"
                    else "${a.store.pending()} 条等待同步 · 登录同一账号可继续学习",
                    Icons.Rounded.Cloud,
                ) {
                    s.open("backup")
                }
                HorizontalDivider(color = c.line)
                WebLinkRow("局域网传输", "同账号设备，与网页和电脑版直接同步", Icons.Rounded.Wifi) { s.open("lan") }
            }
        }
        animatedItem(4, "web-me-campus") {
            WebSectionTitle("班级与校园")
            WebCard(Modifier.fillMaxWidth()) {
                WebLinkRow(
                    "我的班级",
                    a.currentClass.optString("name").ifBlank { "加入班级，同步课程与作业" },
                    Icons.Rounded.Groups,
                ) {
                    s.open("class")
                }
                HorizontalDivider(color = c.line)
                WebLinkRow("班级墙", "通知、同学动态与讨论", Icons.Rounded.Forum) { s.open("wall") }
                HorizontalDivider(color = c.line)
                WebLinkRow("班级排行榜", "看见每一点真实进步", Icons.Rounded.EmojiEvents) { s.open("rank") }
            }
        }
        animatedItem(5, "web-me-appearance") {
            WebSectionTitle("外观", eyebrow = "只对这台设备生效", action = "全部外观 ›") { s.open("appearance") }
            WebCard(Modifier.fillMaxWidth()) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    listOf(
                            LaoPalettes.first { it.id == "ocean" },
                            LaoPalettes.first { it.id == "cyber" },
                        )
                        .forEach { p ->
                            Column(
                                Modifier.weight(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .border(
                                        if (palette == p.id) 2.dp else 1.dp,
                                        if (palette == p.id) c.primary else c.line,
                                        RoundedCornerShape(12.dp),
                                    )
                                    .laoTap {
                                        a.store.set(
                                            "ui_palette_v1",
                                            CampusJson.obj(
                                                "id",
                                                p.id,
                                                "p",
                                                CampusTheme.hex(p.primary.toArgb()),
                                            ),
                                        )
                                        a.store.set(
                                            "compose_mode_v1",
                                            if (p.id == "cyber") "dark" else "light",
                                        )
                                        a.store.set(
                                            "ui_skin_v1",
                                            if (p.id == "cyber") "cyber" else "fresh",
                                        )
                                        a.build()
                                        a.syncSoon()
                                    }
                                    .padding(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Box(
                                    Modifier.fillMaxWidth()
                                        .height(68.dp)
                                        .clip(RoundedCornerShape(8.dp))
                                        .background(
                                            if (p.id == "cyber") Color(0xFF111C23)
                                            else Color(0xFFE9ECFC)
                                        )
                                ) {
                                    Column(
                                        Modifier.padding(8.dp),
                                        verticalArrangement = Arrangement.spacedBy(6.dp),
                                    ) {
                                        Box(
                                            Modifier.width(44.dp)
                                                .height(6.dp)
                                                .clip(CircleShape)
                                                .background(
                                                    if (p.id == "cyber") Color(0xFFE9EDF0)
                                                    else Color(0xFF172C36)
                                                )
                                        )
                                        Box(
                                            Modifier.fillMaxWidth()
                                                .height(24.dp)
                                                .clip(RoundedCornerShape(6.dp))
                                                .background(p.primary.copy(alpha = .25f))
                                        )
                                        Box(
                                            Modifier.fillMaxWidth(.65f)
                                                .height(6.dp)
                                                .clip(CircleShape)
                                                .background(p.primary.copy(alpha = .5f))
                                        )
                                    }
                                }
                                Text(
                                    if (p.id == "ocean") "默认 · 柔和" else "深空蓝",
                                    Modifier.fillMaxWidth(),
                                    style = WebDesign.caption,
                                    color = c.ink,
                                    textAlign = TextAlign.Center,
                                )
                            }
                        }
                }
                WebLinkRow("配色与显示模式", "十种配色 · 深浅模式 · 动效设置", Icons.Rounded.Palette) {
                    s.open("appearance")
                }
            }
        }
        animatedItem(6, "web-me-settings") {
            WebSectionTitle("设置", eyebrow = "按分类整理，也可以直接搜索")
            WebCard(Modifier.fillMaxWidth()) {
                WebLinkRow("全部设置", "账号 · 外观 · 学习 · 提醒 · 数据", Icons.Rounded.Tune) {
                    s.open("settings")
                }
                HorizontalDivider(color = c.line)
                WebLinkRow("手机工具", "录音、扫描、语音、桌面卡片与系统提醒", Icons.Rounded.PhoneAndroid) {
                    s.open("phone")
                }
                HorizontalDivider(color = c.line)
                WebLinkRow("首次使用引导", "重新认识两套界面与校园功能", Icons.Rounded.Explore) {
                    ComposeEntry.onboarding(a)
                }
            }
        }
        animatedItem(7, "web-me-about") {
            WebSectionTitle("关于")
            WebCard(Modifier.fillMaxWidth()) {
                WebLinkRow("功能介绍", "每个功能怎么用", Icons.Rounded.MenuBook) { s.open("intro") }
                HorizontalDivider(color = c.line)
                WebLinkRow("贡献名单", "一起建设校园空间的伙伴", Icons.Rounded.FavoriteBorder) {
                    s.open("credits")
                }
            }
        }
    }
}
