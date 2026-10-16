package com.laolao.classcalendar.ui

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import com.laolao.classcalendar.LaoApp
import com.laolao.classcalendar.model.AgendaItem
import com.laolao.classcalendar.model.Course
import com.laolao.classcalendar.model.Kind
import com.laolao.classcalendar.model.Memo
import com.laolao.classcalendar.model.MemoRow
import com.laolao.classcalendar.model.WEEKDAYS
import com.laolao.classcalendar.model.fmt
import com.laolao.classcalendar.model.parseWeeks
import com.laolao.classcalendar.work.HomeworkWidgetReceiver
import com.laolao.classcalendar.work.NextClassWidgetReceiver
import com.laolao.classcalendar.work.QuickWidgetReceiver
import com.laolao.classcalendar.work.TodayWidgetReceiver
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.time.LocalDate
import java.util.UUID

// ============================== 作业 ==============================

/** 作业页：班级发的作业 + 自己记的作业。过期 / 待完成 / 已完成三段；班级作业显示已读人数，发布人和班委能看名单 */
@Composable
fun HomeworkScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    val today = LocalDate.now()
    val nowMin = nowMinutes()
    val all = repo.homework()
    var counts by remember { mutableStateOf<JSONObject?>(null) }
    var showDone by remember { mutableStateOf(false) }
    var edit by remember { mutableStateOf<AgendaItem?>(null) }
    var add by remember { mutableStateOf(false) }
    var viewersOf by remember { mutableStateOf<AgendaItem?>(null) }
    val serverIds = all.mapNotNull { it.serverId.ifBlank { null } }
    LaunchedEffect(serverIds.joinToString(",")) {
        if (serverIds.isNotEmpty()) { repo.markSeen(serverIds); counts = repo.viewCounts() }
    }
    fun overdue(a: AgendaItem) = !a.done && a.date != LocalDate.MAX && (a.date.isBefore(today) || (a.date == today && a.start != null && a.start < nowMin))
    val late = all.filter { overdue(it) }
    val todo = all.filter { !it.done && !overdue(it) }
    val done = all.filter { it.done }.sortedByDescending { it.date.takeIf { d -> d != LocalDate.MAX } ?: LocalDate.MIN }
    LazyColumn(contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("作业", style = MaterialTheme.typography.headlineMedium)
                    Text(if (todo.isEmpty() && late.isEmpty()) "全部搞定 🎉" else "还有 ${todo.size + late.size} 项没完成" + if (late.isNotEmpty()) "，其中 ${late.size} 项已过截止时间" else "",
                        color = if (late.isNotEmpty()) Color(0xFFE5484D) else c.muted, fontSize = 13.sp)
                }
                FilledTonalButton({ add = true }) { Icon(Icons.Rounded.Add, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("记作业") }
            }
        }
        if (all.isEmpty()) item {
            Card0 { Empty("还没有作业", "老师在班级里发的作业会自动出现在这里；自己的作业点右上角「记作业」，或在桌面「一键记事」里勾「这是作业」") }
        }
        if (late.isNotEmpty()) {
            item(key = "h_late") { SectionTitle("⚠️ 已过截止时间 · ${late.size}") }
            items(late, key = { "l" + it.id }) { a -> HomeworkRow(a, counts, true, { edit = a }, { viewersOf = a }) }
        }
        if (todo.isNotEmpty()) {
            item(key = "h_todo") { SectionTitle("待完成 · ${todo.size}") }
            items(todo, key = { "t" + it.id }) { a -> HomeworkRow(a, counts, false, { edit = a }, { viewersOf = a }) }
        }
        if (done.isNotEmpty()) {
            item(key = "h_done") { SectionTitle("已完成 · ${done.size}", if (showDone) "收起" else "展开") { showDone = !showDone } }
            if (showDone) items(done.take(100), key = { "d" + it.id }) { a -> HomeworkRow(a, counts, false, { edit = a }, { viewersOf = a }) }
        }
        item { Text("💡 把「作业清单」小组件放到桌面，不用打开 App 也能看、能直接勾完成。", color = c.muted, fontSize = 12.sp) }
    }
    if (add) EventEditor(null, homework = true) { add = false }
    edit?.let { a -> if (a.kind == Kind.EVENT) EventEditor(a) { edit = null } else ItemDetail(a) { edit = null } }
    viewersOf?.let { a -> ViewersDialog(a) { viewersOf = null } }
}

fun dueText(a: AgendaItem, today: LocalDate = LocalDate.now()): String {
    if (a.date == LocalDate.MAX) return "没定截止时间"
    val d = when (a.date) {
        today -> "今天"
        today.plusDays(1) -> "明天"
        today.plusDays(2) -> "后天"
        today.minusDays(1) -> "昨天"
        else -> "${a.date.monthValue}月${a.date.dayOfMonth}日 ${WEEKDAYS[a.date.dayOfWeek.value - 1]}"
    }
    return "截止 $d" + (a.start?.let { " " + fmt(it) } ?: "")
}

@Composable
fun HomeworkRow(a: AgendaItem, counts: JSONObject?, late: Boolean, onClick: () -> Unit, onViewers: () -> Unit) {
    val c = LocalLao.current
    val repo = LocalRepo.current
    Card0(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Checkbox(a.done, { repo.toggleDone(a) })
            Column(Modifier.weight(1f)) {
                Text(a.title, fontWeight = FontWeight.SemiBold, color = if (a.done) c.muted else c.ink,
                    textDecoration = if (a.done) TextDecoration.LineThrough else null, maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(listOf(dueText(a), if (a.kind == Kind.CLASS) "班级" else "自己记的", a.place).filter { it.isNotBlank() }.joinToString(" · "),
                    fontSize = 12.sp, color = if (late) Color(0xFFE5484D) else c.muted)
                if (a.summary.isNotBlank()) Text(a.summary, fontSize = 12.sp, color = c.muted, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (a.serverId.isNotBlank() && counts != null) {
                    val v = counts.optJSONObject("views")?.optInt(a.serverId) ?: 0
                    val dn = counts.optJSONObject("done")?.optInt(a.serverId) ?: 0
                    val total = counts.optInt("total")
                    val mine = counts.optJSONArray("mine")
                    val can = counts.optBoolean("can_list") || (mine != null && (0 until mine.length()).any { mine.optString(it) == a.serverId })
                    if (total > 0) Text("👀 已读 $v/$total" + (if (dn > 0) " · ✓ 完成 $dn" else "") + if (can) "  查看名单 ›" else "",
                        fontSize = 12.sp, color = c.accent, modifier = if (can) Modifier.clickable(onClick = onViewers).padding(top = 2.dp) else Modifier.padding(top = 2.dp))
                }
            }
        }
    }
}

@Composable
fun ViewersDialog(a: AgendaItem, onClose: () -> Unit) {
    val repo = LocalRepo.current
    val c = LocalLao.current
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    var err by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableIntStateOf(0) }
    LaunchedEffect(a.serverId) { runCatching { repo.viewers(a.serverId) }.onSuccess { rows = it }.onFailure { err = it.message ?: "读取失败"; rows = emptyList() } }
    AlertDialog(onDismissRequest = onClose, confirmButton = { TextButton(onClose) { Text("关闭") } },
        title = { Text(a.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        text = {
            Column(Modifier.heightIn(max = 420.dp)) {
                val list = rows
                if (list == null) CircularProgressIndicator() else {
                    err?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp) }
                    val seen = list.filter { !it.isNull("seen_at") && it.optString("seen_at").isNotBlank() }
                    val unseen = list.filter { it.isNull("seen_at") || it.optString("seen_at").isBlank() }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(tab == 0, { tab = 0 }, label = { Text("没看 ${unseen.size}") })
                        FilterChip(tab == 1, { tab = 1 }, label = { Text("看过 ${seen.size}") })
                    }
                    Spacer(Modifier.height(6.dp))
                    LazyColumn {
                        items(if (tab == 0) unseen else seen) { p ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(p.optString("name").ifBlank { p.optString("account", "同学") }, Modifier.weight(1f))
                                if (p.optBoolean("done")) Pill("已完成", Color(0xFF22A06B))
                                else if (tab == 1) Pill("未完成", c.muted)
                            }
                        }
                    }
                }
            }
        })
}

// ============================== 导入备忘录 ==============================

private data class MemoEdit(val on: Boolean, val row: MemoRow)

/** 把手机备忘录里的一段文字变成一条条事项。也可以在备忘录 / 微信里选中文字 →「分享」→ 捞捞课程表 */
@Composable
fun MemoImportScreen() {
    val repo = LocalRepo.current
    val c = LocalLao.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val clip = LocalClipboardManager.current
    var text by remember { mutableStateOf(LaoApp.sharedText.orEmpty().also { LaoApp.sharedText = null }) }
    var rows by remember { mutableStateOf<List<MemoEdit>?>(null) }
    var editIdx by remember { mutableStateOf<Int?>(null) }
    LaunchedEffect(Unit) { if (text.isNotBlank()) rows = Memo.parse(text).map { MemoEdit(true, it) } }
    LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text("把备忘录里的待办、作业、日程整段复制过来，一行一条。会自动认出「明天」「周三」「10月20日」「下午3点」这样的时间，带「作业」「交」「提交」的会算成作业。",
                color = c.muted, fontSize = 13.sp)
        }
        item {
            OutlinedTextField(text, { text = it.take(20000); rows = null }, Modifier.fillMaxWidth().heightIn(min = 160.dp),
                placeholder = { Text("例如：\n周三\n☐ 交高数作业\n☑ 买实验服\n10月20日 下午2点 班会 @B302") })
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ clip.getText()?.text?.let { text = it.take(20000); rows = Memo.parse(text).map { r -> MemoEdit(true, r) } } ?: snack("剪贴板是空的") }) {
                    Icon(Icons.Rounded.ContentPaste, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("粘贴")
                }
                Button({ rows = Memo.parse(text).map { MemoEdit(true, it) }; if (rows.isNullOrEmpty()) snack("没有认出事项，一行写一条试试") }, enabled = text.isNotBlank()) { Text("识别") }
                if (text.isNotBlank()) TextButton({ text = ""; rows = null }) { Text("清空") }
            }
        }
        rows?.let { list ->
            if (list.isNotEmpty()) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("认出 ${list.size} 条，选中 ${list.count { it.on }} 条", fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                        TextButton({ val all = list.all { it.on }; rows = list.map { it.copy(on = !all) } }) { Text(if (list.all { it.on }) "全不选" else "全选") }
                    }
                }
                itemsIndexed(list) { i, e ->
                    val r = e.row
                    Card0(onClick = { editIdx = i }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(e.on, { v -> rows = list.toMutableList().also { it[i] = e.copy(on = v) } })
                            Column(Modifier.weight(1f)) {
                                Text(r.subject, fontWeight = FontWeight.SemiBold, textDecoration = if (r.done) TextDecoration.LineThrough else null, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text(listOf(r.date?.let { "${it.monthValue}月${it.dayOfMonth}日 ${WEEKDAYS[it.dayOfWeek.value - 1]}" } ?: "不定日期", r.time, r.place,
                                    if (r.done) "已完成" else "").filter { it.isNotBlank() }.joinToString(" · "), fontSize = 12.sp, color = c.muted)
                            }
                            FilterChip(r.homework, { rows = list.toMutableList().also { it[i] = e.copy(row = r.copy(homework = !r.homework)) } }, label = { Text("作业", fontSize = 12.sp) })
                        }
                    }
                }
                item {
                    Button({
                        val pick = list.filter { it.on }
                        pick.forEach { e -> val r = e.row; repo.saveEvent(null, r.subject, r.date, if (r.date == null) "" else r.time, r.place, r.note, homework = r.homework, done = r.done, src = "memo") }
                        snack("已导入 ${pick.size} 条，网站和小程序也能看到")
                        rows = null; text = ""
                        nav.navigate(if (pick.isNotEmpty() && pick.all { it.row.homework }) "homework" else "todos") { popUpTo("home") }
                    }, Modifier.fillMaxWidth(), enabled = list.any { it.on }) { Text("导入选中的 ${list.count { it.on }} 条") }
                }
            }
        }
    }
    val ei = editIdx
    val elist = rows
    val e0 = if (ei != null && elist != null) elist.getOrNull(ei) else null
    if (ei != null && elist != null && e0 != null)
        MemoRowEditor(e0.row, { nr -> rows = elist.toMutableList().also { it[ei] = e0.copy(row = nr) }; editIdx = null }) { editIdx = null }
}

@Composable
private fun MemoRowEditor(r: MemoRow, onSave: (MemoRow) -> Unit, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var subject by remember { mutableStateOf(r.subject) }
    var date by remember { mutableStateOf(r.date) }
    var time by remember { mutableStateOf(r.time) }
    var place by remember { mutableStateOf(r.place) }
    AlertDialog(onDismissRequest = onClose, title = { Text("改一下这条") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(subject, { subject = it.take(60) }, label = { Text("内容") })
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton({
                        val d = date ?: LocalDate.now()
                        android.app.DatePickerDialog(ctx, { _, y, m, dd -> date = LocalDate.of(y, m + 1, dd) }, d.year, d.monthValue - 1, d.dayOfMonth).show()
                    }, Modifier.weight(1f)) { Text(date?.let { "${it.monthValue}月${it.dayOfMonth}日" } ?: "选日期") }
                    OutlinedButton({
                        val m = com.laolao.classcalendar.model.parseHm(time) ?: (8 * 60)
                        android.app.TimePickerDialog(ctx, { _, h, mi -> time = "%02d:%02d".format(h, mi) }, m / 60, m % 60, true).show()
                    }, Modifier.weight(1f)) { Text(time.ifBlank { "全天" }) }
                }
                if (date != null) TextButton({ date = null; time = "" }) { Text("改成不定日期") }
                OutlinedTextField(place, { place = it.take(40) }, label = { Text("地点（可选）") }, singleLine = true)
            }
        },
        confirmButton = { TextButton({ if (subject.isNotBlank()) onSave(r.copy(subject = subject.trim(), date = date, time = if (date == null) "" else time, place = place.trim())) }) { Text("好") } },
        dismissButton = { TextButton(onClose) { Text("取消") } })
}

// ============================== 拍课表导入 ==============================

private data class OcrRow(val on: Boolean, val name: String, val day: Int, val start: Int, val end: Int, val weeks: String, val location: String, val teacher: String, val unsure: Boolean)

private val TIME_RE = Regex("^\\d{2}:\\d{2}-\\d{2}:\\d{2}$")

/** 拍照 / 选截图 / 从别的 App 分享课表图片 → 服务器识别 → 逐门核对 → 存进课程表（网站、小程序同步） */
@Composable
fun CourseImportScreen() {
    val repo = LocalRepo.current
    val c = LocalLao.current
    val ctx = LocalContext.current
    val nav = LocalNav.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var rows by remember { mutableStateOf<List<OcrRow>?>(null) }
    var times by remember { mutableStateOf<List<String>?>(null) }
    var useTimes by remember { mutableStateOf(true) }
    var replace by remember { mutableStateOf(true) }
    var week1 by remember { mutableStateOf(repo.meta().week1) }
    var warn by remember { mutableStateOf("") }
    var editIdx by remember { mutableStateOf<Int?>(null) }
    val have = repo.courses().size

    fun startOcr(uri: Uri) {
        if (busy) return
        busy = true; rows = null; status = "正在压缩图片…"
        scope.launch {
            try {
                val b64 = withContext(Dispatchers.IO) { compressImage(ctx, uri) }
                status = "上传中…"
                val res = repo.ocrCourses(b64) { p, sec -> status = "识别中… ${if (p > 0) "$p%，" else ""}$sec 秒（一般 5~15 秒）" }
                val list = res.optJSONArray("courses")
                val parsed = (0 until (list?.length() ?: 0)).mapNotNull { i ->
                    val o = list!!.optJSONObject(i) ?: return@mapNotNull null
                    OcrRow(true, o.optString("name"), o.optInt("day", 0).coerceIn(0, 6), o.optInt("start", 1).coerceAtLeast(1), o.optInt("end", o.optInt("start", 1)).coerceAtLeast(1),
                        o.optString("weeks"), o.optString("location"), o.optString("teacher"), o.has("conf") && o.optDouble("conf", 1.0) < 0.9)
                }
                val maxW = maxOf(16, parsed.flatMap { parseWeeks(it.weeks.ifBlank { "1-16" }) }.maxOrNull() ?: 16)
                val noWeeks = parsed.count { it.weeks.isBlank() }
                rows = parsed.map { if (it.weeks.isBlank()) it.copy(weeks = "1-$maxW", unsure = true) else it }
                val t = res.optJSONObject("times")
                val nper = maxOf(res.optInt("periods"), parsed.maxOfOrNull { it.end } ?: 0)
                val full = mutableListOf<String>()
                if (t != null) for (i in 1..nper) { val v = t.optString(i.toString()); if (!TIME_RE.matches(v)) { full.clear(); break }; full += v }
                times = if (full.size >= 4) full else null
                val ws = res.optJSONArray("warnings")
                warn = listOfNotNull(
                    if (parsed.isEmpty()) "没认出课程。换一张更清楚、更完整的截图试试（教务系统里的整周课表最好）。" else "认出 ${parsed.size} 门课，点一门可以改；标黄的是不太确定的。",
                    if (noWeeks > 0) "有 $noWeeks 门课没认出周次，先按「1-$maxW」填了，请核对。" else null,
                ).plus((0 until (ws?.length() ?: 0)).map { ws!!.optString(it) }).joinToString("\n")
                status = ""
            } catch (e: Exception) {
                status = "没成功：" + (e.message ?: "请重试")
            } finally { busy = false }
        }
    }

    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) startOcr(uri) }
    var shot by remember { mutableStateOf<Uri?>(null) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok -> val u = shot; if (ok && u != null) startOcr(u) }
    LaunchedEffect(Unit) { LaoApp.sharedImage?.let { LaoApp.sharedImage = null; startOcr(it) } }

    LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Card0 {
                Text("拍一张课表，自动变成课程表", fontWeight = FontWeight.Bold)
                Text("在教务系统 / 学校 App 里打开整周课表截图，或者直接拍纸质课表。认出来的课会和网站、小程序同步。", color = c.muted, fontSize = 13.sp)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button({ pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !busy, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Rounded.Image, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("选截图")
                    }
                    OutlinedButton({
                        runCatching {
                            val dir = File(ctx.cacheDir, "shots").apply { mkdirs() }
                            val f = File(dir, "course.jpg")
                            val u = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)
                            shot = u; camera.launch(u)
                        }.onFailure { snack("打不开相机：" + (it.message ?: "")) }
                    }, enabled = !busy, modifier = Modifier.weight(1f)) {
                        Icon(Icons.Rounded.PhotoCamera, null, Modifier.size(18.dp)); Spacer(Modifier.width(4.dp)); Text("拍照")
                    }
                }
                if (status.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (busy) { CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp); Spacer(Modifier.width(8.dp)) }
                        Text(status, fontSize = 13.sp, color = if (status.startsWith("没成功")) MaterialTheme.colorScheme.error else c.ink)
                    }
                }
                Text("💡 在相册或微信里长按课表图片 →「分享」→ 捞捞课程表，也能直接识别。", color = c.muted, fontSize = 12.sp, modifier = Modifier.padding(top = 8.dp))
            }
        }
        rows?.let { list ->
            item { Text(warn, fontSize = 13.sp, color = c.muted) }
            itemsIndexed(list) { i, r ->
                Card0(onClick = { editIdx = i }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(r.on, { v -> rows = list.toMutableList().also { it[i] = r.copy(on = v) } })
                        Column(Modifier.weight(1f)) {
                            Text(r.name.ifBlank { "（没认出名字）" }, fontWeight = FontWeight.SemiBold, color = if (r.unsure) Color(0xFFB7791F) else c.ink)
                            Text("${WEEKDAYS[r.day]} 第${r.start}" + (if (r.end != r.start) "-${r.end}" else "") + "节 · ${r.weeks}周" +
                                listOf(r.location, r.teacher).filter { it.isNotBlank() }.joinToString("") { " · $it" }, fontSize = 12.sp, color = c.muted)
                        }
                        Icon(Icons.Rounded.Edit, "修改", tint = c.muted, modifier = Modifier.size(18.dp))
                    }
                }
            }
            if (list.isNotEmpty()) item {
                Card0 {
                    val ctx2 = LocalContext.current
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("第 1 周的星期一", Modifier.weight(1f))
                        OutlinedButton({
                            android.app.DatePickerDialog(ctx2, { _, y, m, d -> week1 = LocalDate.of(y, m + 1, d).with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY)) },
                                week1.year, week1.monthValue - 1, week1.dayOfMonth).show()
                        }) { Text(week1.toString()) }
                    }
                    times?.let { t ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(useTimes, { useTimes = it })
                            Text("同时用截图里的上课时间（${t.size} 节，第1节 ${t[0]}）", fontSize = 13.sp)
                        }
                    }
                    if (have > 0) Row(verticalAlignment = Alignment.CenterVertically) {
                        RadioButton(replace, { replace = true }); Text("替换原来的 $have 门课", fontSize = 13.sp)
                        Spacer(Modifier.width(8.dp))
                        RadioButton(!replace, { replace = false }); Text("合并", fontSize = 13.sp)
                    }
                    Spacer(Modifier.height(8.dp))
                    Button({
                        val pickRows = list.filter { it.on && it.name.isNotBlank() }
                        scope.launch {
                            busy = true
                            runCatching {
                                repo.importCourses(pickRows.map { r ->
                                    Course(UUID.randomUUID().toString().replace("-", "").take(12), r.name.trim(), r.day, r.start, maxOf(r.start, r.end), r.weeks.trim(), r.location.trim(), r.teacher.trim())
                                }, replace || have == 0, if (useTimes) times else null, week1)
                            }.onSuccess { snack("已导入 ${pickRows.size} 门课，网站和小程序也同步了"); nav.navigate("courses") { popUpTo("home") } }
                                .onFailure { snack("已存在本机，上传没成功：" + (it.message ?: "") + "。联网后会再试"); nav.navigate("courses") { popUpTo("home") } }
                            busy = false
                        }
                    }, Modifier.fillMaxWidth(), enabled = !busy && list.any { it.on && it.name.isNotBlank() }) { Text("导入选中的 ${list.count { it.on }} 门课") }
                }
            }
        }
    }
    val oi = editIdx
    val olist = rows
    val r0 = if (oi != null && olist != null) olist.getOrNull(oi) else null
    if (oi != null && olist != null && r0 != null)
        OcrRowEditor(r0, { nr -> rows = olist.toMutableList().also { it[oi] = nr.copy(unsure = false) }; editIdx = null }) { editIdx = null }
}

@Composable
private fun OcrRowEditor(r: OcrRow, onSave: (OcrRow) -> Unit, onClose: () -> Unit) {
    var name by remember { mutableStateOf(r.name) }
    var day by remember { mutableIntStateOf(r.day) }
    var start by remember { mutableStateOf(r.start.toString()) }
    var end by remember { mutableStateOf(r.end.toString()) }
    var weeks by remember { mutableStateOf(r.weeks) }
    var loc by remember { mutableStateOf(r.location) }
    var teacher by remember { mutableStateOf(r.teacher) }
    AlertDialog(onDismissRequest = onClose, title = { Text("核对这门课") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                OutlinedTextField(name, { name = it.take(40) }, label = { Text("课程名") }, singleLine = true)
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    WEEKDAYS.forEachIndexed { i, w ->
                        Text(w.drop(1), Modifier.weight(1f).clickable { day = i }.padding(vertical = 6.dp),
                            color = if (day == i) LocalLao.current.accent else LocalLao.current.muted, fontWeight = if (day == i) FontWeight.Bold else FontWeight.Normal,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(start, { start = it.filter(Char::isDigit).take(2) }, Modifier.weight(1f), label = { Text("第几节起") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                    OutlinedTextField(end, { end = it.filter(Char::isDigit).take(2) }, Modifier.weight(1f), label = { Text("到第几节") }, singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                }
                OutlinedTextField(weeks, { weeks = it.take(40) }, label = { Text("周次（例 1-16 或 1-8,10）") }, singleLine = true)
                OutlinedTextField(loc, { loc = it.take(40) }, label = { Text("教室") }, singleLine = true)
                OutlinedTextField(teacher, { teacher = it.take(20) }, label = { Text("老师") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton({
                val s = start.toIntOrNull() ?: r.start
                val e = end.toIntOrNull() ?: s
                onSave(r.copy(name = name.trim(), day = day, start = maxOf(1, s), end = maxOf(maxOf(1, s), e), weeks = weeks.trim().ifBlank { "1-16" }, location = loc.trim(), teacher = teacher.trim()))
            }) { Text("好") }
        },
        dismissButton = { TextButton(onClose) { Text("取消") } })
}

/** 读图（自动转正方向）→ 长边最多 2200 → JPEG base64，太大就再缩（和网站一样的规则） */
fun compressImage(ctx: android.content.Context, uri: Uri): String {
    val src: Bitmap = if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ctx.contentResolver, uri)) { dec, info, _ ->
            val big = maxOf(info.size.width, info.size.height)
            if (big > 3000) { val k = 3000f / big; dec.setTargetSize((info.size.width * k).toInt().coerceAtLeast(1), (info.size.height * k).toInt().coerceAtLeast(1)) }
            dec.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 2200) sample *= 2
        ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: throw IllegalStateException("图片打不开，请换成 JPG 或 PNG")
    }
    var max = 2200
    var q = 90
    var out = ""
    repeat(4) {
        val s = minOf(1f, max.toFloat() / maxOf(src.width, src.height))
        val w = maxOf(1, (src.width * s).toInt()); val h = maxOf(1, (src.height * s).toInt())
        val scaled = if (s < 1f) Bitmap.createScaledBitmap(src, w, h, true) else src
        // 透明的 PNG 截图先铺白底，不然识别会看到黑底
        val flat = Bitmap.createBitmap(scaled.width, scaled.height, Bitmap.Config.ARGB_8888)
        android.graphics.Canvas(flat).apply { drawColor(android.graphics.Color.WHITE); drawBitmap(scaled, 0f, 0f, null) }
        val bos = ByteArrayOutputStream()
        flat.compress(Bitmap.CompressFormat.JPEG, q, bos)
        out = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
        if (out.length < 4_000_000) return out
        max = (max * 0.8).toInt(); q -= 8
    }
    return out
}

// ============================== 桌面小组件 ==============================

private data class WidgetInfo(val title: String, val desc: String, val size: String, val cls: Class<*>)

/** 小组件说明页：一键把小组件放到桌面（安卓 8 以上的大部分桌面支持），也教怎么手动加 */
@Composable
fun WidgetsScreen() {
    val c = LocalLao.current
    val ctx = LocalContext.current
    val snack = LocalSnack.current
    val mgr = remember { AppWidgetManager.getInstance(ctx) }
    val canPin = Build.VERSION.SDK_INT >= 26 && mgr.isRequestPinAppWidgetSupported
    val list = listOf(
        WidgetInfo("今天的课和事", "今天的课程、待办、班级通知，按时间排好", "4×2", TodayWidgetReceiver::class.java),
        WidgetInfo("下节课倒计时", "还有几分钟上课、在哪个教室；上课中显示还有多久下课", "2×2", NextClassWidgetReceiver::class.java),
        WidgetInfo("作业清单", "没交的作业和截止时间，点圆圈直接勾完成", "4×2", HomeworkWidgetReceiver::class.java),
        WidgetInfo("一键记事 / 拍课表", "一句话记事、拍课表、导入备忘录，不用先打开 App", "4×1", QuickWidgetReceiver::class.java),
    )
    LazyColumn(contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Text(if (canPin) "点「放到桌面」，在弹出的窗口里确认就行。" else "你的桌面不支持一键添加：回到桌面，长按空白处 →「小组件 / 窗口小工具」→ 找到「捞捞课程表」，拖到桌面。",
                color = c.muted, fontSize = 13.sp)
        }
        items(list) { w ->
            Card0 {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) { Text(w.title, fontWeight = FontWeight.Bold); Spacer(Modifier.width(6.dp)); Pill(w.size) }
                        Text(w.desc, fontSize = 12.sp, color = c.muted)
                    }
                    if (canPin) FilledTonalButton({
                        runCatching { mgr.requestPinAppWidget(ComponentName(ctx, w.cls), null, null) }.onFailure { snack("没放成功，请手动添加") }
                    }) { Text("放到桌面") }
                }
            }
        }
        item { SectionTitle("更多快捷入口") }
        item { Card0 { Text("📌 长按桌面上的捞捞图标：记一件事、作业、导入备忘录、拍课表", fontSize = 13.sp) } }
        item { Card0 { Text("🔽 下拉通知栏 → 编辑（铅笔图标）→ 把「记一件事」拖进开关区，随时下拉就能记", fontSize = 13.sp) } }
        item { Card0 { Text("📤 在备忘录、微信里选中文字 → 分享 → 捞捞课程表：一次导入好多条", fontSize = 13.sp) } }
        item { Card0 { Text("🔔 通知里直接点「✓ 完成」就能勾掉，不用打开 App", fontSize = 13.sp) } }
    }
}
