package com.laolao.classcalendar.ui

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laolao.classcalendar.BuildConfig
import com.laolao.classcalendar.work.Reminders
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun MenuRow(icon: ImageVector, title: String, sub: String = "", onClick: () -> Unit) {
    val c = LocalLao.current
    Card0(onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, tint = c.accent); Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.SemiBold); if (sub.isNotBlank()) Text(sub, fontSize = 12.sp, color = c.muted) }
            Icon(Icons.AutoMirrored.Rounded.KeyboardArrowRight, null, tint = c.muted)
        }
    }
}

@Composable
fun MeScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    val nav = LocalNav.current
    val p = repo.profile()
    LazyColumn(contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Card0 {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(56.dp).background(c.tint, CircleShape), contentAlignment = Alignment.Center) {
                        Text(p.name.take(1), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = c.accent)
                    }
                    Spacer(Modifier.width(14.dp))
                    Column {
                        Text(p.name, style = MaterialTheme.typography.titleLarge)
                        Text(listOf(p.identityLabel, p.org).filter { it.isNotBlank() }.joinToString(" · "), color = c.muted, fontSize = 13.sp)
                    }
                }
            }
        }
        item { MenuRow(Icons.Rounded.Widgets, "桌面小组件", "今天的课、下节课倒计时、作业清单、一键记事") { nav.navigate("widgets") } }
        item { MenuRow(Icons.Rounded.Apps, "工具箱", "番茄专注、倒数日、课程表、导入备忘录、拍课表") { nav.navigate("tools") } }
        item { MenuRow(Icons.Rounded.Shield, "账号与安全", "登录设备、退出登录") { nav.navigate("account") } }
        item { MenuRow(Icons.Rounded.Devices, "登录设备", "查看已登录的设备，踢出其他设备") { nav.navigate("devices") } }
        item { MenuRow(Icons.Rounded.Palette, "外观与配色", "跟随网站配色或自选，深色模式") { nav.navigate("appearance") } }
        item { MenuRow(Icons.Rounded.Sync, "数据与同步", "和网站、小程序的同步状态") { nav.navigate("sync") } }
        item { MenuRow(Icons.Rounded.NotificationsActive, "提醒与后台", "收不到提醒时按这里设置") { nav.navigate("permissions") } }
        item { MenuRow(Icons.Rounded.Info, "关于", "版本 " + BuildConfig.VERSION_NAME) { nav.navigate("about") } }
    }
}

@Composable
fun AccountScreen() {
    val repo = LocalRepo.current
    val nav = LocalNav.current
    val scope = rememberCoroutineScope()
    var confirm by remember { mutableStateOf(false) }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { MenuRow(Icons.Rounded.Devices, "登录设备", "查看 / 踢出其他设备") { nav.navigate("devices") } }
        item { MenuRow(Icons.Rounded.Key, "修改密码", "在网站「我的 → 账号安全」中修改") { openSite(nav.context) } }
        item { OutlinedButton({ confirm = true }, Modifier.fillMaxWidth()) { Text("退出登录", color = MaterialTheme.colorScheme.error) } }
    }
    if (confirm) AlertDialog({ confirm = false }, confirmButton = { TextButton({ scope.launch { repo.logout() } }) { Text("退出") } },
        dismissButton = { TextButton({ confirm = false }) { Text("取消") } }, title = { Text("退出登录？") }, text = { Text("本机未上传的修改会保留，下次登录同一账号继续上传。") })
}

@Composable
fun DevicesScreen() {
    val repo = LocalRepo.current
    val c = LocalLao.current
    val snack = LocalSnack.current
    val scope = rememberCoroutineScope()
    var rows by remember { mutableStateOf<List<JSONObject>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var err by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(reload) { runCatching { repo.touchDevice(); repo.devices() }.onSuccess { rows = it; err = null }.onFailure { err = it.message; rows = emptyList() } }
    val fmt = remember { SimpleDateFormat("M月d日 HH:mm", Locale.CHINA) }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text("同一账号在手机、网页、小程序登录的设备都会列在这里。踢出后，那台设备下次打开或刷新时会被要求重新登录。", color = c.muted, fontSize = 13.sp) }
        err?.let { item { Card0 { Text("读取失败：$it", color = MaterialTheme.colorScheme.error); Text("如果是第一次使用，请确认扣子后台已执行「设备管理-一键安装命令」。", fontSize = 12.sp, color = c.muted) } } }
        if (rows == null) item { CircularProgressIndicator() }
        rows?.let { list ->
            items(list, key = { it.optString("id") }) { d ->
                Card0 {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(when (d.optString("platform")) { "web" -> Icons.Rounded.Computer; "wechat", "miniprogram" -> Icons.Rounded.Chat; else -> Icons.Rounded.PhoneAndroid }, null, tint = c.accent)
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Row { Text(d.optString("name").ifBlank { "未知设备" }, fontWeight = FontWeight.SemiBold); if (d.optBoolean("current")) { Spacer(Modifier.width(6.dp)); Pill("本机") } }
                            val seen = d.optString("last_seen", d.optString("seen"))
                            Text("最近使用 " + (runCatching { fmt.format(Date(java.time.OffsetDateTime.parse(seen).toInstant().toEpochMilli())) }.getOrDefault(seen)), fontSize = 12.sp, color = c.muted)
                        }
                        if (!d.optBoolean("current")) TextButton({
                            scope.launch { runCatching { repo.revoke(d.optString("id"), false) }.onSuccess { snack("已踢出"); reload++ }.onFailure { snack(it.message ?: "操作失败") } }
                        }) { Text("踢出", color = MaterialTheme.colorScheme.error) }
                    }
                }
            }
            if (list.count { !it.optBoolean("current") } > 1) item {
                OutlinedButton({ scope.launch { runCatching { repo.revoke(null, true) }.onSuccess { snack("已踢出全部其他设备"); reload++ }.onFailure { snack(it.message ?: "操作失败") } } }, Modifier.fillMaxWidth()) {
                    Text("踢出全部其他设备")
                }
            }
        }
    }
}

@Composable
fun AppearanceScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    var pal by remember { mutableStateOf(repo.pref("palette", "web")) }
    var dark by remember { mutableStateOf(repo.pref("dark", "system")) }
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { SectionTitle("配色") }
        item {
            Card0 {
                listOf("web" to "跟随网站（在网站换配色，这里自动同步）") + PALETTES.map { it.id to it.label }
                    .let { it }.forEach { (id, label) ->
                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                            RadioButton(pal == id, { pal = id; repo.setPref("palette", id) })
                            PALETTES.firstOrNull { it.id == id }?.let { Box(Modifier.size(16.dp).background(it.accent, CircleShape)); Spacer(Modifier.width(8.dp)) }
                            Text(label, fontSize = 14.sp)
                        }
                    }
                Text("选择具体颜色 = 不同步，只在这台手机生效。", fontSize = 12.sp, color = c.muted)
            }
        }
        item { SectionTitle("深色模式") }
        item {
            Card0 {
                listOf("system" to "跟随系统", "off" to "浅色", "on" to "深色").forEach { (id, l) ->
                    Row(verticalAlignment = Alignment.CenterVertically) { RadioButton(dark == id, { dark = id; repo.setPref("dark", id) }); Text(l) }
                }
            }
        }
    }
}

@Composable
fun SyncScreen() {
    val repo = LocalRepo.current; LocalTick.current
    val c = LocalLao.current
    val busy by repo.busy.collectAsState()
    val scope = rememberCoroutineScope()
    val last = repo.s.cache("last_sync") as? Long ?: (repo.s.cache("last_sync") as? Number)?.toLong()
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Card0 {
                Text("上次同步：" + (last?.let { SimpleDateFormat("M月d日 HH:mm:ss", Locale.CHINA).format(Date(it)) } ?: "还没有同步过"))
                Text("待上传的修改：${repo.s.pendingCount()} 条" + if (repo.coursesDirty()) "，课程表有修改待上传" else "", color = c.muted, fontSize = 13.sp)
                Spacer(Modifier.height(10.dp))
                Button({ scope.launch { if (repo.coursesDirty()) runCatching { repo.uploadCourses() }; repo.refresh() } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                    Text(if (busy) "同步中…" else "立即同步")
                }
            }
        }
        item {
            Text("• 没网时修改会先存在手机里，联网后自动上传，不会丢。\n• 同一条记录在两处同时修改时，以较晚的修改为准（时间按服务器时钟计算，手机时间不准也没关系）。\n• App 在后台时每 30 分钟自动同步一次。",
                fontSize = 13.sp, color = c.muted)
        }
    }
}

@Composable
fun PermissionsScreen() {
    val ctx = LocalContext.current
    val c = LocalLao.current
    val repo = LocalRepo.current
    var on by remember { mutableStateOf(repo.pref("remind", "on") == "on") }
    var hwOn by remember { mutableStateOf(repo.pref("remind_hw", "on") == "on") }
    var newsOn by remember { mutableStateOf(repo.pref("notify_news", "on") == "on") }
    var lead by remember { mutableStateOf(repo.pref("remind_lead", "10")) }
    var tick by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) { while (true) { delay(2000); tick++ } }
    tick
    fun go(i: Intent) = runCatching { ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure {
        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    val notif = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled()
    val exact = Reminders.exactAllowed(ctx)
    val pm = ctx.getSystemService(android.os.PowerManager::class.java)
    val battery = pm.isIgnoringBatteryOptimizations(ctx.packageName)
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item {
            Card0 {
                Text("这些提醒都由手机系统按时弹出：App 没打开、被划掉、手机重启后都照样会响。", fontSize = 12.sp, color = c.muted)
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("上课 / 日程开始前提醒", modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    Switch(on, { on = it; repo.setPref("remind", if (it) "on" else "off"); Reminders.schedule(ctx) })
                }
                if (on) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("5", "10", "15", "30").forEach { m ->
                        FilterChip(lead == m, { lead = m; repo.setPref("remind_lead", m); Reminders.schedule(ctx) }, label = { Text("提前${m}分", fontSize = 12.sp) })
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("作业截止提醒", fontWeight = FontWeight.SemiBold)
                        Text("前一天 20:00、截止前 1 小时；通知上能直接点「完成」", fontSize = 12.sp, color = c.muted)
                    }
                    Switch(hwOn, { hwOn = it; repo.setPref("remind_hw", if (it) "on" else "off"); Reminders.schedule(ctx) })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("班级新消息通知", fontWeight = FontWeight.SemiBold)
                        Text("老师、班委发了新作业或通知时提醒（后台约 15 分钟检查一次）", fontSize = 12.sp, color = c.muted)
                    }
                    Switch(newsOn, { newsOn = it; repo.setPref("notify_news", if (it) "on" else "off") })
                }
            }
        }
        item { Check("通知权限", notif, "允许 App 弹出提醒") { go(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)) } }
        if (Build.VERSION.SDK_INT >= 31) item { Check("准时提醒（闹钟权限）", exact, "关闭时提醒可能晚几分钟") { go(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx.packageName))) } }
        item { Check("不限制后台耗电", battery, "防止系统把 App 冻结导致收不到提醒") { go(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.packageName))) } }
        item {
            Card0 {
                Text("国产手机额外设置", fontWeight = FontWeight.Bold)
                Text(when (Build.MANUFACTURER.lowercase()) {
                    "xiaomi", "redmi" -> "小米/红米：设置 → 应用设置 → 应用管理 → 捞捞课程表 → 省电策略选「无限制」，并打开「自启动」。"
                    "huawei", "honor" -> "华为/荣耀：设置 → 电池 → 启动管理 → 捞捞课程表 → 改为手动管理，三个开关都打开。"
                    "oppo", "realme", "oneplus" -> "OPPO/一加/真我：设置 → 电池 → 应用耗电管理 → 捞捞课程表 → 允许后台运行、允许自动启动。"
                    "vivo", "iqoo" -> "vivo/iQOO：设置 → 电池 → 后台耗电管理 → 捞捞课程表 → 允许后台高耗电。"
                    else -> "在系统设置的「电池」或「应用管理」中，允许捞捞课程表后台运行和自启动。"
                }, fontSize = 13.sp, color = c.muted)
                TextButton({ go(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))) }) { Text("打开本应用设置") }
            }
        }
    }
}

@Composable
private fun Check(title: String, ok: Boolean, sub: String, fix: () -> Unit) {
    val c = LocalLao.current
    Card0 {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (ok) Icons.Rounded.CheckCircle else Icons.Rounded.Error, null, tint = if (ok) androidx.compose.ui.graphics.Color(0xFF22A06B) else MaterialTheme.colorScheme.error)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.SemiBold); Text(sub, fontSize = 12.sp, color = c.muted) }
            if (!ok) TextButton(fix) { Text("去开启") }
        }
    }
}

@Composable
fun AboutScreen() {
    val nav = LocalNav.current
    val c = LocalLao.current
    LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Card0 { Text("捞捞课程表", style = MaterialTheme.typography.titleLarge); Text("版本 " + BuildConfig.VERSION_NAME + "（全新原生版）", color = c.muted); Text("与网站、微信小程序共用一个账号和数据。", fontSize = 13.sp) } }
        item { MenuRow(Icons.Rounded.Favorite, "校园共建者", "") { nav.navigate("credits") } }
    }
}

// ---------- tools ----------

data class Tool(val title: String, val icon: ImageVector, val route: String?, val sub: String)

@Composable
fun ToolsScreen() {
    val nav = LocalNav.current
    val ctx = LocalContext.current
    val c = LocalLao.current
    val native = listOf(
        Tool("课程表", Icons.Rounded.TableChart, "courses", "周视图、添加课程"), Tool("全部待办", Icons.Rounded.Checklist, "todos", "个人与班级事项"),
        Tool("番茄专注", Icons.Rounded.Timer, "pomodoro", "25 分钟专注"), Tool("倒数日", Icons.Rounded.HourglassBottom, "countdown", "重要日子倒计时"),
        Tool("拍课表导入", Icons.Rounded.PhotoCamera, "course_import", "截图自动认出课程"), Tool("导入备忘录", Icons.Rounded.ContentPaste, "memo", "一段文字变成待办"),
        Tool("班级排行", Icons.Rounded.Leaderboard, "rank", "成长值排行"), Tool("桌面小组件", Icons.Rounded.Widgets, "widgets", "放到桌面随时看"),
        Tool("校园共建者", Icons.Rounded.Favorite, "credits", "贡献名单"),
    )
    val web = listOf("思维导图", "局域网传输", "课内学习", "记账", "日记", "习惯打卡", "四象限", "AI 助手")
    LazyColumn(contentPadding = PaddingValues(16.dp, 12.dp, 16.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        native.chunked(2).forEach { row ->
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    row.forEach { t ->
                        Card0(Modifier.weight(1f), onClick = { nav.navigate(t.route!!) }) {
                            Icon(t.icon, null, tint = c.accent); Spacer(Modifier.height(8.dp))
                            Text(t.title, fontWeight = FontWeight.SemiBold); Text(t.sub, fontSize = 12.sp, color = c.muted)
                        }
                    }
                }
            }
        }
        item { SectionTitle("网站工具") }
        item { Text("以下工具暂时在网站上使用，点击用浏览器打开（同一账号登录即可）。", fontSize = 12.sp, color = c.muted) }
        item {
            Card0 {
                web.chunked(4).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { AssistChip({ openSite(ctx) }, { Text(it, fontSize = 12.sp) }, modifier = Modifier.weight(1f)) }
                    }
                }
            }
        }
    }
}

fun openSite(ctx: android.content.Context) = runCatching {
    ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SITE_URL)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

@Composable
fun PomodoroScreen() {
    val c = LocalLao.current
    var total by remember { mutableIntStateOf(25 * 60) }
    var left by remember { mutableIntStateOf(total) }
    var running by remember { mutableStateOf(false) }
    LaunchedEffect(running) { while (running && left > 0) { delay(1000); left-- }; if (left == 0) running = false }
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(contentAlignment = Alignment.Center) {
            CircularProgressIndicator(progress = { left / total.toFloat() }, modifier = Modifier.size(240.dp), strokeWidth = 12.dp, trackColor = c.tint)
            Text("%02d:%02d".format(left / 60, left % 60), fontSize = 52.sp, fontFamily = Display, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(24.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(15, 25, 45).forEach { m -> FilterChip(total == m * 60, { if (!running) { total = m * 60; left = total } }, label = { Text("$m 分钟") }) }
        }
        Spacer(Modifier.height(16.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Button({ running = !running }) { Text(if (running) "暂停" else if (left == total) "开始" else "继续") }
            OutlinedButton({ running = false; left = total }) { Text("重置") }
        }
        if (left == 0) Text("完成一次专注，休息 5 分钟吧", color = c.accent, modifier = Modifier.padding(top = 16.dp))
    }
}
