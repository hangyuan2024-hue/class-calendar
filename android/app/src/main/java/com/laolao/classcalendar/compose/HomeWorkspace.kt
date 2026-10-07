package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.unit.*
import java.util.Calendar
import org.json.JSONArray
import org.json.JSONObject

private val DefaultHome = listOf("w:pins", "w:rings", "w:cal", "w:hw", "w:quick", "w:wall")
private val HomeCards =
    DefaultHome +
        listOf("w:encourage", "w:plan", "w:farm", "w:habits", "w:pomo", "w:meta", "w:rank")

internal fun homeOrder(a: CampusActivity): List<String> {
    val native = a.store.`object`("native_compose_home_v1")
    val config = if (native.has("home")) native else a.store.`object`("home_layout_v1")
    val saved = config.optJSONArray("home") ?: return DefaultHome
    return rows(saved)
        .map { it.optString("id") }
        .map { if (it == "w:course") "w:cal" else it }
        .distinct()
}

private fun homeCardName(id: String) =
    when (id) {
        "w:pins" -> "下一节课与专注"
        "w:cal" -> "今天的安排"
        "w:hw" -> "接下来的待办"
        "w:quick" -> "常用工具"
        "w:wall" -> "班级墙"
        else -> CampusHome.name(id)
    }

@Composable
internal fun ModernHomePage(s: CampusSession) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    val today = DateMath.today()
    val options = a.store.`object`("fun_opts_v1")
    val cards =
        homeOrder(a).filter { id ->
            val key =
                when (id) {
                    "w:rings" -> "rings"
                    "w:habits" -> "habits"
                    "w:plan",
                    "w:pomo" -> "plan"
                    "w:farm" -> "farm"
                    else -> ""
                }
            key.isBlank() || options.optBoolean(key, true)
        }
    val name = if (a.api.logged()) a.me.optString("display_name", "同学") else "同学"
    val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
    val greeting = if (hour < 12) "早上好" else if (hour < 18) "下午好" else "晚上好"
    PageList {
        animatedItem(0, "welcome") {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        dateLabel(today),
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant,
                    )
                    Text("$greeting，$name", style = MaterialTheme.typography.headlineMedium)
                }
                Surface(color = colors.primaryContainer, shape = CircleShape) {
                    IconButton(onClick = { s.open("me") }) {
                        Icon(Icons.Rounded.PersonOutline, "我的账号", tint = colors.primary)
                    }
                }
            }
        }
        cards.forEachIndexed { index, id ->
            animatedItem(index + 1, "home-$id") { HomeSection(s, id) }
        }
        val rail = a.store.`object`("home_layout_v1").optJSONArray("rail")
        if (rail != null && rail.length() > 0)
            animatedItem(cards.size + 1, "rail") {
                ToolGrid(
                    s,
                    (0 until rail.length())
                        .map { CampusHome.route(rail.optString(it)) }
                        .filter { it.isNotEmpty() }
                        .distinct(),
                )
            }
        animatedItem(cards.size + 2, "edit-home") {
            TextButton(onClick = { s.open("home-layout") }, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Rounded.Tune, null, Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Text("调整首页卡片")
            }
        }
    }
}

@Composable
private fun HomeSection(s: CampusSession, id: String) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    val today = DateMath.today()
    val tasks =
        a.items()
            .filter { !a.done(it) && !CampusSchool.hidden(a, it) }
            .sortedBy { it.optString("event_time", "9999") }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        when (id) {
            "w:pins" -> {
                val next = CampusGuide.nextCourse(a)
                PremiumCard(Modifier.fillMaxWidth(), tint = colors.primary) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                if (next == null) "今天，也值得认真"
                                else
                                    "${next.time} · ${if(next.day == today) "接下来" else dateLabel(next.day)}",
                                style = MaterialTheme.typography.labelMedium,
                                color = colors.onPrimary.copy(alpha = .72f),
                            )
                            Text(
                                next?.title ?: "给重要的事留点时间",
                                style = MaterialTheme.typography.headlineSmall,
                                color = colors.onPrimary,
                            )
                            Text(
                                next?.location?.ifBlank { "教室待确认" }
                                    ?: "${CampusCourses.onDay(a.store, today).size} 节课程 · ${tasks.count { CampusJson.date(it.optString("event_time")) == today }} 项待办",
                                style = MaterialTheme.typography.bodyMedium,
                                color = colors.onPrimary.copy(alpha = .8f),
                            )
                        }
                        if (CampusGuide.enabled(a)) LaoMascot(Modifier.size(72.dp))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        val interaction = remember {
                            androidx.compose.foundation.interaction.MutableInteractionSource()
                        }
                        Button(
                            onClick = { s.open(if (next == null) "pomo" else "courses") },
                            colors =
                                ButtonDefaults.buttonColors(
                                    containerColor = colors.onPrimary,
                                    contentColor = colors.primary,
                                ),
                            shape = RoundedCornerShape(16.dp),
                            interactionSource = interaction,
                            modifier = Modifier.springPress(interaction),
                        ) {
                            Text(if (next == null) "开始专注" else "查看课表")
                            Spacer(Modifier.width(8.dp))
                            Icon(
                                Icons.AutoMirrored.Rounded.ArrowForward,
                                null,
                                Modifier.size(16.dp),
                            )
                        }
                        if (CampusGuide.enabled(a))
                            TextButton(
                                onClick = { s.sheet = GuideSheet },
                                colors =
                                    ButtonDefaults.textButtonColors(contentColor = colors.onPrimary),
                            ) {
                                Text("问问捞捞")
                            }
                    }
                }
            }
            "w:rings" -> ProgressOverview(weekStats(a))
            "w:cal" -> {
                SectionHeading("今天的安排", action = "日历") { s.open("calendar") }
                val courses = CampusCourses.onDay(a.store, today)
                val selected =
                    tasks.filter { CampusJson.date(it.optString("event_time")) == today }.take(3)
                if (courses.isEmpty() && selected.isEmpty())
                    EmptyState("今天没有安排", "留一点空白，给新的计划和好心情。", "粘贴导入群消息") {
                        CampusSocial.pasteImport(a)
                    }
                else
                    PremiumCard(Modifier.fillMaxWidth()) {
                        courses.forEachIndexed { i, c ->
                            CourseRow(s, c)
                            if (i < courses.lastIndex)
                                HorizontalDivider(color = colors.outlineVariant)
                        }
                        if (courses.isNotEmpty() && selected.isNotEmpty())
                            HorizontalDivider(color = colors.outlineVariant)
                        selected.forEach { TaskRow(s, it) }
                    }
            }
            "w:hw" -> {
                SectionHeading("接下来的待办", note = "按时间排序，完成后计入成长", action = "全部") {
                    s.open("homework")
                }
                tasks.take(3).forEach { task ->
                    PremiumCard(Modifier.fillMaxWidth()) { TaskRow(s, task) }
                }
                if (tasks.isEmpty()) EmptyState("手头没有要赶的事", "点右下角的加号记一件事，或从日历粘贴导入。")
            }
            "w:quick" -> {
                SectionHeading("常用工具", action = "自选") { s.sheet = ToolPickerSheet }
                ToolGrid(
                    s,
                    CampusToolbox.pinned(a)
                        .let { list -> (0 until list.length()).map { list.optString(it) } }
                        .take(6),
                )
            }
            "w:wall" ->
                HomeLink(
                    s,
                    "班级墙",
                    if (a.cid().isEmpty()) "连接班级，分享校园日常"
                    else a.currentClass.optString("name", "看看同学们的新动态"),
                    "wall",
                )
            "w:encourage" -> {
                val at =
                    Math.floorMod(
                        a.store.number("native_quote", today.hashCode()),
                        CampusHome.QUOTES.size,
                    )
                PremiumCard(Modifier.fillMaxWidth(), tint = colors.primaryContainer) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.WbSunny, null, tint = colors.primary)
                        Spacer(Modifier.width(8.dp))
                        Text("每日鼓励", style = MaterialTheme.typography.labelLarge)
                    }
                    Text(CampusHome.QUOTES[at], style = MaterialTheme.typography.headlineSmall)
                    TextButton(
                        onClick = {
                            a.store.set("native_quote", at + 1)
                            a.build()
                        }
                    ) {
                        Text("换一句")
                    }
                }
            }
            "w:habits" -> {
                SectionHeading("今日打卡", action = "管理") { s.open("growth") }
                val habits = rows(a.store.list("habits_v1"))
                PremiumCard(Modifier.fillMaxWidth()) {
                    if (habits.isEmpty()) SoftButton("添加一个小习惯") { CampusLearn.habitForm(a, null) }
                    habits.forEach { h ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(
                                a.store
                                    .`object`("habit_log_v1")
                                    .optJSONObject(h.optString("id"))
                                    ?.optBoolean(today) == true,
                                onCheckedChange = { CampusLearn.habitToggle(a, h, today) },
                            )
                            Text(
                                h.optString("name"),
                                Modifier.weight(1f),
                                style = MaterialTheme.typography.titleMedium,
                            )
                        }
                    }
                }
            }
            "w:farm" -> {
                val pet = a.store.`object`("farm_v1")
                HomeLink(
                    s,
                    "${pet.optString("name", "小云朵")} · Lv.${pet.optInt("level", 1)}",
                    "养料 ${maxOf(0, CampusLearn.food(a) - pet.optLong("spent"))} · 用每一步成长照顾它",
                    "farm",
                )
            }
            "w:plan" -> {
                SectionHeading("四象限规划", action = "打开") { s.open("plan") }
                PremiumCard(Modifier.fillMaxWidth()) {
                    val quadrants =
                        tasks.groupBy {
                            a.store
                                .`object`("quad_v1")
                                .optInt(it.optString("_key"), CampusPlanner.defaultQuad(it))
                        }
                    listOf("重要且紧急", "重要不紧急", "紧急不重要", "不重要不紧急").forEachIndexed { i, label ->
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            Text(label, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                "${quadrants[i+1]?.size ?: 0} 项",
                                style = MaterialTheme.typography.titleSmall,
                                color = colors.primary,
                            )
                        }
                    }
                }
            }
            "w:pomo" -> {
                val clock = rememberFocusClock(s)
                HomeLink(
                    s,
                    "番茄专注 · ${CampusPlanner.duration(clock.remaining)}",
                    if (clock.running) "正在计时，暂停与休息都在这里" else "一次只做一件事",
                    "pomo",
                )
            }
            "w:meta" ->
                HomeLink(
                    s,
                    "捞捞元宇宙",
                    "已完成 ${a.store.`object`("done_log_v1").length()} 项 · ${a.store.list("native_cards").length()} 张记忆晶片",
                    "meta",
                )
            "w:rank" -> HomeLink(s, "班级成长榜", "看见每一份坚持，也为同学的进步鼓掌", "rank")
            else -> HomeLink(s, homeCardName(id), "打开你的校园工具", CampusHome.route(id))
        }
    }
}

@Composable
private fun HomeLink(s: CampusSession, title: String, note: String, route: String) {
    PremiumCard(Modifier.fillMaxWidth(), onClick = { s.open(route) }) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            IconTile(route)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Text(
                    note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                Icons.Rounded.ChevronRight,
                null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun HomeLayoutPage(s: CampusSession) {
    val order = homeOrder(s.a)
    fun save(ids: List<String>) {
        val config = JSONObject(s.a.store.`object`("native_compose_home_v1").toString())
        config.put(
            "home",
            JSONArray().apply { ids.forEach { put(CampusJson.obj("id", it, "w", 4, "h", 1)) } },
        )
        s.a.store.set("native_compose_home_v1", config)
        s.a.build()
    }
    PageList {
        animatedItem(0) {
            Text("只留你常用的", style = MaterialTheme.typography.headlineMedium)
            Text(
                "显示哪些卡片、先看到哪一张，由你决定。修改后立即生效。",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        order.forEachIndexed { index, id ->
            animatedItem(index + 1, "layout-$id") {
                PremiumCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${index+1}",
                            Modifier.width(32.dp),
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Text(
                            homeCardName(id),
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        IconButton(onClick = { save(order.filter { it != id }) }) {
                            Icon(Icons.Rounded.Close, "隐藏 ${homeCardName(id)}")
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (index > 0)
                            SoftButton("上移", Modifier.weight(1f)) {
                                save(
                                    order.toMutableList().apply { add(index - 1, removeAt(index)) }
                                )
                            }
                        if (index < order.lastIndex)
                            SoftButton("下移", Modifier.weight(1f)) {
                                save(
                                    order.toMutableList().apply { add(index + 1, removeAt(index)) }
                                )
                            }
                    }
                }
            }
        }
        animatedItem(order.size + 1) {
            PrimaryButton("添加首页卡片", Modifier.fillMaxWidth()) {
                val available = HomeCards.filter { it !in order }
                if (available.isEmpty()) s.notice = "所有卡片都已经添加"
                else
                    s.sheet =
                        ChoiceSheet("添加首页卡片", available.map { homeCardName(it) }) {
                            save(order + available[it])
                        }
            }
            TextButton(onClick = { save(DefaultHome) }, modifier = Modifier.fillMaxWidth()) {
                Text("恢复默认顺序")
            }
        }
    }
}
