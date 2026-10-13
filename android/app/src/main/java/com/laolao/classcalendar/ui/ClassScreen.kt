package com.laolao.classcalendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laolao.classcalendar.model.parseEventTime
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun ClassScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    val clip = LocalClipboardManager.current
    val classes = repo.classes()
    val cur = repo.currentClass()
    var dialog by remember { mutableStateOf<Boolean?>(null) }
    LazyColumn(contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 96.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("班级与团队", style = MaterialTheme.typography.headlineMedium) }
        if (classes.isEmpty()) item {
            Card0 {
                Empty("还没有加入班级或团队", "任何身份都可以创建，创建者自动成为管理者")
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.align(Alignment.CenterHorizontally)) {
                    Button({ dialog = true }) { Text("创建") }; OutlinedButton({ dialog = false }) { Text("用班级码加入") }
                }
            }
        }
        if (cur.length() > 0) item {
            Card0 {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(cur.optString("name", cur.optString("cname")), style = MaterialTheme.typography.titleLarge)
                        Text((if (cur.optBoolean("is_teacher")) "我是管理者" else "成员") + " · 班级码 " + cur.optString("code", cur.optString("ccode")), color = c.muted, fontSize = 13.sp)
                    }
                    TextButton({ clip.setText(AnnotatedString(cur.optString("code", cur.optString("ccode")))); snack("班级码已复制，发给同学即可加入") }) { Text("复制班级码") }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistChip({ nav.navigate("rank") }, { Text("排行榜") })
                    AssistChip({ nav.navigate("todos") }, { Text("班级事项") })
                }
            }
        }
        val items = repo.classItems()
        if (cur.length() > 0) {
            item { SectionTitle("班级事项 · ${items.size}") }
            if (items.isEmpty()) item { Card0 { Empty("暂无班级事项", "管理者在网站或小程序发布后会自动出现在这里") } }
            items(items.sortedByDescending { it.optString("event_time") }.take(200), key = { it.optString("id") }) { e -> ClassItemCard(e) }
        }
        if (classes.size > 1 || classes.any { it.optString("status") == "pending" }) {
            item { SectionTitle("我的全部班级") }
            items(classes, key = { it.optString("id") }) { k ->
                val usable = k.optBoolean("is_teacher") || k.optString("status") == "approved"
                Card0(onClick = if (usable) ({ scope.launch { repo.selectClass(k.optString("id")) } }) else null) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(k.optString("name", k.optString("cname")), fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        when {
                            k.optString("id") == cur.optString("id") -> Pill("当前")
                            !usable -> Pill("等待审批", c.accent2)
                        }
                    }
                }
            }
        }
        item { Text("页面每分钟自动刷新，回到 App 时也会刷新。", color = c.muted, fontSize = 12.sp) }
    }
    dialog?.let { ClassDialog(it) { dialog = null } }
}

@Composable
private fun ClassItemCard(e: JSONObject) {
    val c = LocalLao.current
    Card0 {
        Text(e.optString("subject").ifBlank { "班级通知" }, fontWeight = FontWeight.SemiBold)
        val t = parseEventTime(e.optString("event_time"))
        Text(listOfNotNull(t?.let { "${it.first} " + (it.second?.let { m -> com.laolao.classcalendar.model.fmt(m) } ?: "") }, e.optString("location").takeIf { it.isNotBlank() }).joinToString(" · "),
            color = c.muted, fontSize = 12.sp)
        e.optString("summary").takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 13.sp, modifier = Modifier.padding(top = 4.dp)) }
    }
}

@Composable
fun ClassDialog(create: Boolean, onClose: () -> Unit) {
    val repo = LocalRepo.current
    val scope = rememberCoroutineScope()
    val snack = LocalSnack.current
    var text by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    AlertDialog(onDismissRequest = onClose, title = { Text(if (create) "创建班级 / 团队" else "加入班级") },
        text = {
            Column {
                if (create) Text("任何身份都能创建，你会成为管理者。", fontSize = 13.sp)
                OutlinedTextField(text, { text = if (create) it.take(30) else it.take(6) }, label = { Text(if (create) "名称" else "6 位班级码") }, singleLine = true)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && text.isNotBlank(), onClick = {
                busy = true
                scope.launch {
                    runCatching { if (create) repo.createClass(text) else repo.joinClass(text) }
                        .onSuccess { snack(if (create) "创建成功，你已成为管理者" else "申请已提交，等待管理者审批"); onClose() }
                        .onFailure { snack(it.message ?: "操作失败") }
                    busy = false
                }
            }) { Text(if (create) "创建" else "加入") }
        }, dismissButton = { TextButton(onClose) { Text("取消") } })
}

@Composable
fun RankScreen() {
    val repo = LocalRepo.current
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    LaunchedEffect(Unit) { rows = repo.leaderboard() }
    ListOf(rows, "暂无排行数据", "完成待办和专注会获得成长值") { i, r ->
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("${i + 1}", fontWeight = FontWeight.Bold, fontSize = 18.sp, modifier = Modifier.width(36.dp))
            Text(r.optString("name", "同学"), modifier = Modifier.weight(1f))
            Text("${r.optInt("score", r.optInt("points", r.optInt("xp")))}", fontWeight = FontWeight.Bold, color = LocalLao.current.accent)
        }
    }
}

@Composable
fun CreditsScreen() {
    val repo = LocalRepo.current
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    LaunchedEffect(Unit) { rows = repo.credits() }
    ListOf(rows, "名单加载中或暂无", "感谢每一位参与共建的同学") { _, r ->
        Text(r.optString("name", r.optString("nick")), fontWeight = FontWeight.SemiBold)
        r.optString("note", r.optString("contribution")).takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = LocalLao.current.muted) }
    }
}

@Composable
fun ListOf(rows: List<JSONObject>?, emptyTitle: String, emptyBody: String, row: @Composable ColumnScope.(Int, JSONObject) -> Unit) {
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (rows == null) item { Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() } }
        else if (rows.isEmpty()) item { Card0 { Empty(emptyTitle, emptyBody) } }
        else items(rows.size) { i -> Card0 { row(i, rows[i]) } }
    }
}
