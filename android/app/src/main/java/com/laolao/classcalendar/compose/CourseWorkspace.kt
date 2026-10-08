package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.*
import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ModernCoursesPage(s: CampusSession) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    val currentWeek = CampusCourses.week(a.store, DateMath.today()).coerceIn(1, 20)
    var week by rememberSaveable { mutableIntStateOf(currentWeek) }
    var day by rememberSaveable {
        mutableIntStateOf(
            java.util.Calendar.getInstance().let {
                (it.get(java.util.Calendar.DAY_OF_WEEK) + 5) % 7
            }
        )
    }
    var wholeWeek by rememberSaveable { mutableStateOf(false) }
    val meta = CampusCourses.meta(a.store)
    val times = meta.optJSONArray("times") ?: JSONArray()
    val all = rows(a.store.list(CampusCourses.COURSES))
    val selected = all.filter { CampusCourses.weeks(it.optString("weeks")).contains(week) }
    val first = DateMath.plus(CampusCourses.monday(meta.optString("week1")), (week - 1) * 7)
    val date = DateMath.plus(first, day)
    val daily = CampusCourses.onDay(a.store, date)
    PageList {
        animatedItem(0) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("第 $week 周", style = MaterialTheme.typography.headlineMedium)
                    Text(
                        "${first.substring(5)} — ${DateMath.plus(first,6).substring(5)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant,
                    )
                }
                PressIcon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "上一周") {
                    week = maxOf(1, week - 1)
                }
                PressIcon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "下一周") {
                    week = minOf(20, week + 1)
                }
            }
        }
        animatedItem(1) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("添加课程", Modifier.weight(1f)) { CampusCourses.form(a, null) }
                SoftButton("导入课表", Modifier.weight(1f)) { importCourses(s) }
            }
        }
        animatedItem(2) {
            LaoTabs(listOf("当天安排", "整周课表"), if (wholeWeek) "整周课表" else "当天安排") {
                wholeWeek = it == "整周课表"
            }
        }
        if (!wholeWeek) {
            animatedItem(3) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(7) { index ->
                        val on = day == index
                        val source = remember {
                            androidx.compose.foundation.interaction.MutableInteractionSource()
                        }
                        Column(
                            Modifier.weight(1f)
                                .height(64.dp)
                                .springPress(source)
                                .clip(RoundedCornerShape(16.dp))
                                .background(if (on) colors.primary else colors.surfaceContainerLow)
                                .clickable(source, null) { day = index },
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                "一二三四五六日"[index].toString(),
                                style = MaterialTheme.typography.labelMedium,
                                color = if (on) colors.onPrimary else colors.onSurfaceVariant,
                            )
                            Spacer(Modifier.height(8.dp))
                            Text(
                                DateMath.parts(DateMath.plus(first, index))[2].toString(),
                                style = MaterialTheme.typography.titleSmall,
                                color = if (on) colors.onPrimary else colors.onSurface,
                            )
                        }
                    }
                }
            }
            animatedItem(4) {
                SectionHeading(dateLabel(date), note = "${daily.size} 节课程 · 点击课程查看或编辑")
            }
            daily.forEachIndexed { index, course ->
                animatedItem(index + 5, "day-course-${course.optString("id")}") {
                    PremiumCard(Modifier.fillMaxWidth()) {
                        CourseRow(s, course)
                        val teacher = course.optString("teacher")
                        if (teacher.isNotBlank())
                            Text(
                                "授课教师 · $teacher",
                                style = MaterialTheme.typography.bodySmall,
                                color = colors.onSurfaceVariant,
                            )
                    }
                }
            }
            if (daily.isEmpty()) animatedItem(5) { EmptyState("这一天没有课程", "换个日期看看，或者给课表添加一节新课。") }
        } else {
            animatedItem(3) {
                PremiumCard(Modifier.fillMaxWidth()) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("周课表", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "左右滑动查看全周",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant,
                        )
                    }
                    WeeklyTimetable(s, selected, times, first, day)
                }
            }
            animatedItem(4) { SectionHeading("本周课程", note = "${selected.size} 门课程，点击可编辑") }
            selected.forEachIndexed { index, course ->
                animatedItem(index + 5, "week-course-${course.optString("id")}") {
                    PremiumCard(
                        Modifier.fillMaxWidth(),
                        onClick = { CampusCourses.detail(a, course) },
                    ) {
                        Text(course.optString("name"), style = MaterialTheme.typography.titleLarge)
                        Text(
                            "周${"一二三四五六日"[course.optInt("day").coerceIn(0,6)]} · ${course.optInt("start")}-${course.optInt("end")} 节 · ${course.optString("location")}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.onSurfaceVariant,
                        )
                    }
                }
            }
        }
        animatedItem(all.size + 10) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton("课表设置", Modifier.weight(1f)) { CampusCourses.settings(a) }
                if (week != currentWeek)
                    SoftButton("回到本周", Modifier.weight(1f)) { week = currentWeek }
            }
            Text(
                "课表支持周次、单双周和课程冲突检查。",
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant,
            )
        }
    }
}

private fun importCourses(s: CampusSession) {
    val a = s.a
    a.ui.choose("导入课程", arrayOf("拍照 / 截图识别", "导入 JSON 文件", "粘贴 JSON")) { index ->
        when (index) {
            0 -> CampusCourses.ocr(a)
            1 -> CampusPhone.json(a, "courses")
            else ->
                a.ui.form(
                    "粘贴课表 JSON",
                    JSONObject(),
                    { value ->
                        CampusCourses.importJson(a, value.optString("json"))
                        a.build()
                    },
                    CampusUi.f("json", "课程 JSON", "multiline"),
                )
        }
    }
}

@Composable
private fun WeeklyTimetable(
    s: CampusSession,
    courses: List<JSONObject>,
    times: JSONArray,
    first: String,
    initialDay: Int,
) {
    val colors = MaterialTheme.colorScheme
    val column = 96.dp
    val row = 64.dp
    val header = 56.dp
    val density = androidx.compose.ui.platform.LocalDensity.current
    val scroll = rememberScrollState(initial = with(density) { (column * initialDay).roundToPx() })
    Row {
        Column(Modifier.width(48.dp)) {
            Spacer(Modifier.height(header))
            repeat(times.length()) { index ->
                Column(Modifier.height(row), verticalArrangement = Arrangement.Center) {
                    Text("${index+1}", style = MaterialTheme.typography.labelLarge)
                    Text(
                        times.optString(index).take(5),
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant,
                    )
                }
            }
        }
        Box(Modifier.weight(1f).horizontalScroll(scroll)) {
            Box(Modifier.width(column * 7).height(header + row * times.length())) {
                Column {
                    Row(Modifier.height(header)) {
                        repeat(7) { index ->
                            Column(
                                Modifier.width(column),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    "周${"一二三四五六日"[index]}",
                                    style = MaterialTheme.typography.labelLarge,
                                )
                                Text(
                                    DateMath.plus(first, index).substring(5),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    repeat(times.length()) {
                        Box(Modifier.fillMaxWidth().height(row)) {
                            Box(
                                Modifier.fillMaxWidth()
                                    .height(1.dp)
                                    .background(colors.outlineVariant)
                            )
                        }
                    }
                }
                courses.forEach { course ->
                    val tint =
                        LaoPalettes[abs(course.optString("name").hashCode() % LaoPalettes.size)]
                            .primary
                    Column(
                        Modifier.offset(
                                column * course.optInt("day"),
                                header + row * (course.optInt("start") - 1),
                            )
                            .width(column)
                            .height(row * (course.optInt("end") - course.optInt("start") + 1))
                            .padding(4.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(tint.copy(alpha = .12f))
                            .clickable { CampusCourses.detail(s.a, course) }
                            .padding(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            course.optString("name"),
                            style = MaterialTheme.typography.labelLarge,
                            color = colors.primary,
                            maxLines = 3,
                        )
                        Text(
                            course.optString("location"),
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant,
                            maxLines = 2,
                        )
                    }
                }
            }
        }
    }
}
