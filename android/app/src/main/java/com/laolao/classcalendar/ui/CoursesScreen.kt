package com.laolao.classcalendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laolao.classcalendar.model.Course
import com.laolao.classcalendar.model.CourseMeta
import com.laolao.classcalendar.model.WEEKDAYS
import com.laolao.classcalendar.model.parseHm
import com.laolao.classcalendar.model.parseWeeks
import kotlinx.coroutines.launch
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import java.util.UUID

@Composable
fun CoursesScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    val meta = repo.meta()
    var week by remember { mutableIntStateOf(meta.week(LocalDate.now()).coerceAtLeast(1)) }
    var edit by remember { mutableStateOf<Course?>(null) }
    val courses = repo.courses().filter { week in parseWeeks(it.weeks) }
    val colors = listOf(c.accent, c.accent2, androidx.compose.ui.graphics.Color(0xFF22A06B), androidx.compose.ui.graphics.Color(0xFF8B5CF6), androidx.compose.ui.graphics.Color(0xFFE5484D))
    val monday = meta.week1.plusWeeks((week - 1).toLong())
    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton({ if (week > 1) week-- }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowLeft, "上一周") }
            Text("第 $week 周", fontWeight = FontWeight.Bold, fontSize = 17.sp, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
            IconButton({ week++ }) { Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, "下一周") }
        }
        if (repo.coursesDirty()) Card0 {
            Text("课程表有修改还没上传到网站", fontSize = 13.sp)
            Button({ scope.launch { runCatching { repo.uploadCourses() }.onSuccess { snack("已同步到网站和小程序") }.onFailure { snack(it.message ?: "上传失败") } } }) { Text("立即上传") }
        }
        Row(Modifier.fillMaxWidth().padding(start = 34.dp, top = 6.dp)) {
            (0..6).forEach { d -> val date = monday.plusDays(d.toLong())
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(WEEKDAYS[d].drop(1), fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (date == LocalDate.now()) c.accent else c.ink)
                    Text("${date.monthValue}/${date.dayOfMonth}", fontSize = 10.sp, color = c.muted)
                }
            }
        }
        val rowH = 58.dp
        Row(Modifier.fillMaxWidth().weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 90.dp)) {
            Column(Modifier.width(34.dp)) {
                meta.times.forEachIndexed { i, t ->
                    Column(Modifier.height(rowH), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("${i + 1}", fontSize = 12.sp, fontWeight = FontWeight.Bold); Text(t.substringBefore('-'), fontSize = 9.sp, color = c.muted)
                    }
                }
            }
            (0..6).forEach { d ->
                Box(Modifier.weight(1f).height(rowH * meta.times.size)) {
                    courses.filter { it.day == d }.forEach { co ->
                        val col = colors[(co.name.hashCode() and 0x7fffffff) % colors.size]
                        Column(Modifier.offset(y = rowH * (co.start - 1)).height(rowH * (co.end - co.start + 1)).fillMaxWidth().padding(1.5.dp)
                            .background(col.copy(alpha = .16f), RoundedCornerShape(8.dp)).clickable { edit = co }.padding(3.dp)) {
                            Text(co.name, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = col, maxLines = 3, overflow = TextOverflow.Ellipsis, lineHeight = 13.sp)
                            if (co.location.isNotBlank()) Text("@" + co.location, fontSize = 9.sp, color = c.muted, maxLines = 2, lineHeight = 11.sp)
                        }
                    }
                }
            }
        }
    }
    edit?.let { CourseEditor(it) { edit = null } }
}

@Composable
fun CourseEditor(course: Course?, onClose: () -> Unit) {
    val repo = LocalRepo.current
    val n = repo.meta().times.size
    var name by remember { mutableStateOf(course?.name ?: "") }
    var day by remember { mutableIntStateOf(course?.day ?: (LocalDate.now().dayOfWeek.value - 1)) }
    var start by remember { mutableStateOf((course?.start ?: 1).toString()) }
    var end by remember { mutableStateOf((course?.end ?: 2).toString()) }
    var weeks by remember { mutableStateOf(course?.weeks ?: "1-16") }
    var loc by remember { mutableStateOf(course?.location ?: "") }
    var teacher by remember { mutableStateOf(course?.teacher ?: "") }
    var err by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onClose, title = { Text(if (course == null) "添加课程" else "编辑课程") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(name, { name = it.take(60) }, label = { Text("课程名称") }, singleLine = true)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    WEEKDAYS.forEachIndexed { i, w -> FilterChip(day == i, { day = i }, label = { Text(w.drop(1)) }) }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(start, { start = it.filter(Char::isDigit).take(2) }, label = { Text("第几节起") }, singleLine = true, modifier = Modifier.weight(1f))
                    OutlinedTextField(end, { end = it.filter(Char::isDigit).take(2) }, label = { Text("到第几节") }, singleLine = true, modifier = Modifier.weight(1f))
                }
                OutlinedTextField(weeks, { weeks = it.take(40) }, label = { Text("周次（例 1-16、1-16单）") }, singleLine = true)
                OutlinedTextField(loc, { loc = it.take(60) }, label = { Text("教室") }, singleLine = true)
                OutlinedTextField(teacher, { teacher = it.take(40) }, label = { Text("老师") }, singleLine = true)
                err?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton({
                val s = start.toIntOrNull() ?: 0; val e = end.toIntOrNull() ?: 0
                when {
                    name.isBlank() -> err = "请填写课程名称"
                    s < 1 || e < s || e > n -> err = "节次应在 1—$n 之间，且结束不早于开始"
                    parseWeeks(weeks).isEmpty() -> err = "周次格式不对"
                    else -> { repo.saveCourse(Course(course?.id ?: UUID.randomUUID().toString().take(12), name.trim(), day, s, e, weeks.trim(), loc.trim(), teacher.trim())); onClose() }
                }
            }) { Text("保存") }
        },
        dismissButton = {
            Row {
                if (course != null) TextButton({ repo.deleteCourse(course.id); onClose() }) { Text("删除", color = MaterialTheme.colorScheme.error) }
                TextButton(onClose) { Text("取消") }
            }
        })
}

@Composable
fun MetaEditor(onClose: () -> Unit) {
    val repo = LocalRepo.current
    val m = repo.meta()
    var week1 by remember { mutableStateOf(m.week1.toString()) }
    var times by remember { mutableStateOf(m.times.joinToString("\n")) }
    var err by remember { mutableStateOf<String?>(null) }
    AlertDialog(onDismissRequest = onClose, title = { Text("作息时间") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(week1, { week1 = it }, label = { Text("第一周的周一（例 2026-09-14）") }, singleLine = true)
                OutlinedTextField(times, { times = it }, label = { Text("每节课时间，一行一节，例 08:00-08:50") }, minLines = 5)
                err?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 12.sp) }
            }
        },
        confirmButton = {
            TextButton({
                val d = runCatching { LocalDate.parse(week1.trim()) }.getOrNull()
                val t = times.lines().map { it.trim() }.filter { it.isNotEmpty() }
                var prev = -1; var ok = t.size in 1..16
                for (x in t) { val a = parseHm(x.substringBefore('-')); val b = parseHm(x.substringAfter('-', "")); if (a == null || b == null || a < prev || b <= a) ok = false else prev = b }
                if (d == null) err = "日期格式不对" else if (!ok) err = "每行格式 08:00-08:50，按时间顺序，最多16节"
                else { repo.saveMeta(CourseMeta(d.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)), t)); onClose() }
            }) { Text("保存") }
        }, dismissButton = { TextButton(onClose) { Text("取消") } })
}
