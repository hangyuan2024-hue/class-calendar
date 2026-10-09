package com.laolao.classcalendar

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
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
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*

@Composable internal fun LaoCalendarPage(s: CampusSession) = LaoCalendarStudio(s)

@Composable
internal fun LaoHomeworkPage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    var offset by rememberSaveable { mutableIntStateOf(0) }
    var filter by rememberSaveable { mutableStateOf("待完成") }
    val mon = DateMath.plus(CampusCourses.monday(DateMath.today()), offset * 7)
    val all =
        visibleTasks(s.a)
            .filter {
                it.optString("msg_type") == "作业" && taskDate(it) in mon..DateMath.plus(mon, 6)
            }
            .sortedBy { it.optString("event_time") }
    val done = all.count { s.a.done(it) }
    val selected = all.filter { filter == "全部" || s.a.done(it) == (filter == "已完成") }
    LaoPage {
        animatedItem(0) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoEyebrow("学业清单")
                    Text(if (offset == 0) "本周作业" else "所选周作业", style = LaoType.headline)
                    Text(
                        mon.substring(5) + " — " + DateMath.plus(mon, 6).substring(5),
                        style = LaoType.caption,
                        color = c.onSurfaceVariant,
                    )
                }
                LaoIconButton(Icons.Rounded.Add, "添加作业") {
                    s.a.selectedDay = if (offset == 0) DateMath.today() else mon
                    CampusSchool.personalForm(s.a, null)
                    (s.sheet as? FormSheet)?.initial?.put("msg_type", "作业")
                }
            }
        }
        animatedItem(1) {
            Row(
                Modifier.fillMaxWidth()
                    .clip(LaoCorners.paper)
                    .background(LaoArt.soft())
                    .padding(24.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        (all.size - done).toString(),
                        style = LaoType.display.copy(fontSize = 56.sp, lineHeight = 64.sp),
                    )
                    Text("件作业，等你完成", style = LaoType.caption, color = c.onSurfaceVariant)
                }
                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    LaoChip("${done}/${all.size} 已完成", c.primary)
                    Row {
                        LaoIconButton(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "上一周") {
                            offset--
                        }
                        LaoIconButton(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "下一周") {
                            offset++
                        }
                    }
                }
            }
        }
        animatedItem(2) { LaoTabs(listOf("待完成", "已完成", "全部"), filter) { filter = it } }
        if (selected.isEmpty())
            animatedItem(3) {
                LaoEmpty(
                    if (all.isEmpty()) "还没有这一周的作业" else "这一栏，已经清空",
                    "复制班群消息，粘贴后核对保存。",
                    "粘贴导入",
                ) {
                    CampusSocial.pasteImport(s.a)
                }
            }
        selected
            .groupBy { taskDate(it) }
            .entries
            .forEachIndexed { i, (day, tasks) ->
                animatedItem(i + 3, "homework2-" + day + filter) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LaoChip(
                            if (day == DateMath.today()) "今天截止" else dateLabel(day),
                            if (day <= DateMath.today()) CampusStatus.warning() else c.primary,
                        )
                        tasks.forEach { LaoTaskCell(s, it) }
                    }
                }
            }
    }
}

@Composable internal fun LaoToolsPage(s: CampusSession) = LaoToolsStudio(s)

@Composable
internal fun LaoGrowthPage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val stats = weekStats(a)
    val habits = rows(a.store.list("habits_v1"))
    val logs = a.store.`object`("done_log_v1")
    val focus = rows(a.store.list("native_focus_sessions")).count { !it.optBoolean("cancelled") }
    val fraction = if (stats[3] == 0) 0f else stats[2].toFloat() / stats[3]
    val progress by
        animateFloatAsState(
            fraction,
            if (LocalMotionEnabled.current) spring(.85f, 100f) else snap(),
            label = "growth2 arc",
        )
    LaoPage {
        animatedItem(0) {
            LaoPageHeading("每一步，都算进步。", "从完成一件小事，到看见自己的成长。", "成长档案", Icons.Rounded.Insights)
        }
        animatedItem(1) {
            LaoPanel(Modifier.fillMaxWidth(), color = LaoArt.soft(), padding = 24.dp) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        LaoEyebrow("本周的你")
                        Text(
                            if (stats[3] == 0) "—" else "${(fraction * 100).toInt()}%",
                            style = LaoType.display.copy(fontSize = 56.sp, lineHeight = 64.sp),
                            color = c.primary,
                        )
                        Text(
                            "${stats[2]} / ${stats[3]} 项安排已完成",
                            style = LaoType.caption,
                            color = c.onSurfaceVariant,
                        )
                    }
                    Box(Modifier.size(72.dp), contentAlignment = Alignment.Center) {
                        LaoPaperArt(Modifier.matchParentSize(), c.primary)
                        LaoMascot(Modifier.size(56.dp))
                    }
                }
                Box(
                    Modifier.fillMaxWidth()
                        .height(4.dp)
                        .clip(CircleShape)
                        .background(c.primary.copy(alpha = .12f))
                ) {
                    Box(
                        Modifier.fillMaxWidth(progress.coerceIn(0f, 1f))
                            .fillMaxHeight()
                            .background(c.primary, CircleShape)
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    LaoStat(logs.length().toString(), "累计完成", Modifier.weight(1f))
                    LaoStat(
                        "${stats[4]}/${stats[5]}",
                        "今日打卡",
                        Modifier.weight(1f),
                        CampusAccent.readable(LaoArt.coral),
                    )
                    LaoStat(focus.toString(), "专注记录", Modifier.weight(1f), c.primary)
                }
                LaoTextAction("查看学习周报 ↗") { s.open("report") }
            }
        }
        animatedItem(2) { LaoSection("坚持的轨迹", note = "来自你的实际完成与打卡记录") }
        animatedItem(3) { LaoPanel(Modifier.fillMaxWidth(), glass = true) { TrendChart(a) } }
        animatedItem(4) { LaoSection("今天的小目标", action = "＋ 新建") { CampusLearn.habitForm(a, null) } }
        if (habits.isEmpty())
            animatedItem(5) {
                LaoEmpty("从一件小事开始", "阅读 15 分钟、运动一次，或整理一页笔记。", "新建习惯") {
                    CampusLearn.habitForm(a, null)
                }
            }
        else animatedItem(5) { Column { habits.forEach { LaoHabitCell(s, it) } } }
        animatedItem(6) {
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                CampusRankPreview(s)
                LaoFeatureNote(
                    s,
                    "farm",
                    "小云朵的成长",
                    a.store.`object`("farm_v1").optString("name", "小云朵") +
                        " · Lv." +
                        a.store.`object`("farm_v1").optInt("level", 1),
                )
                LaoFeatureNote(s, "meta", "捞捞元宇宙", "用每一次真实进步，点亮你的校园星系")
            }
        }
    }
}
