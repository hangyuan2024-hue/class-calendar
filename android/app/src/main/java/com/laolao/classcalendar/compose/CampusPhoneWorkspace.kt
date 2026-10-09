package com.laolao.classcalendar

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

private data class PhoneAbility(
    val route: String,
    val name: String,
    val note: String,
    val group: String,
)

private val phoneAbilities =
    listOf(
        PhoneAbility("inbox", "跨应用收件箱", "收下文字和图片，整理成自己的安排", "捕捉灵感"),
        PhoneAbility("scanner", "资料扫描", "拍照、裁边，导出多页 PDF", "捕捉灵感"),
        PhoneAbility("recordings", "课堂录音", "后台录制、命名、播放与分享", "捕捉灵感"),
        PhoneAbility("voice", "语音速记", "说一句，变成可核对的待办", "捕捉灵感"),
        PhoneAbility("widget", "桌面学习卡片", "不打开 App，也能看到今日课程", "学习节奏"),
        PhoneAbility("reminders", "系统提醒", "课前、作业与自己设置的提醒", "学习节奏"),
        PhoneAbility("quiet", "上课自动勿扰", "按课表安静，结束后恢复", "学习节奏"),
        PhoneAbility("privacy", "日记设备验证", "用指纹、面容或设备密码保护日记", "校园生活"),
        PhoneAbility("places", "校园位置书签", "保存常去的地方，查看距离与导航", "校园生活"),
        PhoneAbility("contacts", "校园快捷联系", "收好联系人，需要时准备拨号", "校园生活"),
    )

private fun phoneState(s: CampusSession, route: String) =
    when (route) {
        "inbox" -> "${s.a.store.list("native_inbox").length()} 条已收下"
        "scanner" -> "${s.a.store.list("native_scan_pages").length()} 页扫描资料"
        "recordings" -> "${s.a.store.list("native_recordings").length()} 段课堂录音"
        "places" -> "${s.a.store.list("native_places").length()} 个地点书签"
        "contacts" -> "${s.a.store.list("native_contacts").length()} 位快捷联系人"
        "quiet" -> if (s.a.store.bool("native_quiet", false)) "自动勿扰已开启" else "未开启自动勿扰"
        "privacy" -> if (s.a.store.bool("native_diary_lock", false)) "设备验证已开启" else "由你选择保护方式"
        "reminders" -> "${s.a.store.list("native_reminders").length()} 个自定义提醒"
        "widget" -> "课程与待办，一眼看到"
        else -> "识别后核对，再保存"
    }

@Composable
internal fun CampusPhonePage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "phone-heading") {
            LaoPageHeading(
                "手机，也是学习搭子。",
                "10 项手机专属能力，随手记下，随时用上。",
                "随身工具",
                Icons.Rounded.PhoneAndroid,
            )
        }
        animatedItem(1, "phone-settings-link") {
            Row(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(c.primary.copy(alpha = .06f))
                    .laoTap { s.open("settings") }
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Icon(Icons.Rounded.Tune, null, Modifier.size(20.dp), tint = c.primary)
                Text("权限、提醒与隐私设置", Modifier.weight(1f), style = LaoType.caption, color = c.primary)
                Icon(Icons.Rounded.NorthEast, null, Modifier.size(16.dp), tint = c.primary)
            }
        }
        var order = 2
        phoneAbilities
            .groupBy { it.group }
            .forEach { (group, items) ->
                animatedItem(order++, "phone-section-" + group) {
                    LaoSection(
                        group,
                        note =
                            when (group) {
                                "捕捉灵感" -> "让重要的内容，不再散落。"
                                "学习节奏" -> "把提醒和安静，交给手机。"
                                else -> "自己的校园，随手就能找到。"
                            },
                    )
                }
                items.forEach { ability ->
                    animatedItem(order++, "phone-ability-" + ability.route) {
                        PhoneAbilityCard(s, ability, Modifier.fillMaxWidth())
                    }
                }
            }
    }
}

@Composable
private fun PhoneAbilityCard(s: CampusSession, ability: PhoneAbility, modifier: Modifier) {
    val c = MaterialTheme.colorScheme
    val hue =
        CampusAccent.readable(
            when (ability.group) {
                "捕捉灵感" -> CampusAccent.violet
                "学习节奏" -> CampusAccent.blue
                else -> LaoArt.coral
            }
        )
    Row(
        modifier
            .clip(RoundedCornerShape(22.dp))
            .background(c.surface.copy(alpha = .86f))
            .border(1.dp, c.outlineVariant.copy(alpha = .3f), RoundedCornerShape(22.dp))
            .laoTap(role = androidx.compose.ui.semantics.Role.Button) { s.open(ability.route) }
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(
            Modifier.size(48.dp).background(hue.copy(alpha = .1f), RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(routeIcon(ability.route), null, Modifier.size(25.dp), tint = hue)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(ability.name, style = LaoType.cell)
            Text(
                ability.note,
                style = LaoType.caption,
                color = c.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(phoneState(s, ability.route), style = LaoType.label, color = hue)
        }
        Icon(Icons.Rounded.NorthEast, null, Modifier.size(18.dp), tint = hue)
    }
}

@Composable
private fun PhoneSketch(modifier: Modifier) {
    val c = MaterialTheme.colorScheme
    Canvas(modifier) {
        val scale = size.width / 72f
        drawContext.canvas.save()
        drawContext.canvas.scale(scale, scale)
        drawCircle(c.primary.copy(alpha = .07f), 35f, Offset(36f, 36f))
        drawRoundRect(c.surface, Offset(19f, 8f), Size(34f, 56f), CornerRadius(9f))
        drawRoundRect(
            c.primary.copy(alpha = .6f),
            Offset(19f, 8f),
            Size(34f, 56f),
            CornerRadius(9f),
            style = Stroke(1.5f),
        )
        drawLine(
            c.primary.copy(alpha = .4f),
            Offset(31f, 14f),
            Offset(41f, 14f),
            2f,
            StrokeCap.Round,
        )
        drawRoundRect(
            c.primary.copy(alpha = .12f),
            Offset(25f, 23f),
            Size(22f, 15f),
            CornerRadius(4f),
        )
        drawLine(c.primary, Offset(29f, 29f), Offset(41f, 29f), 2f, StrokeCap.Round)
        drawLine(
            c.primary.copy(alpha = .4f),
            Offset(29f, 34f),
            Offset(36f, 34f),
            2f,
            StrokeCap.Round,
        )
        drawCircle(CampusAccent.berry.copy(alpha = .7f), 3f, Offset(29f, 46f))
        drawCircle(CampusAccent.violet.copy(alpha = .7f), 3f, Offset(42f, 46f))
        drawCircle(c.primary.copy(alpha = .3f), 2f, Offset(36f, 58f))
        drawContext.canvas.restore()
    }
}

@Composable
internal fun CampusPermissionsPage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    var refresh by remember { mutableIntStateOf(0) }
    refresh
    DisposableEffect(s.a) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refresh++
        }
        s.a.lifecycle.addObserver(observer)
        onDispose { s.a.lifecycle.removeObserver(observer) }
    }
    val entries =
        listOf(
            Triple("麦克风", "课堂录音和语音记录", Manifest.permission.RECORD_AUDIO),
            Triple("位置", "保存校园地点和查看附近距离", Manifest.permission.ACCESS_FINE_LOCATION),
            Triple("通知", "课程、事项与专注完成提醒", Manifest.permission.POST_NOTIFICATIONS),
        )
    LaoPage(spacing = 16.dp) {
        animatedItem(0) {
            Text("需要时，再授权。", style = LaoType.headline)
            Text("你可以随时管理手机能力的使用范围。", style = LaoType.caption, color = c.onSurfaceVariant)
        }
        entries.forEachIndexed { i, (name, purpose, permission) ->
            val allowed =
                when (name) {
                    "通知" -> NotificationManagerCompat.from(s.a).areNotificationsEnabled()
                    "位置" ->
                        s.a.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED ||
                            s.a.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) ==
                                PackageManager.PERMISSION_GRANTED
                    else -> s.a.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
                }
            animatedItem(i + 1, "permission-" + name) {
                LaoPanel(Modifier.fillMaxWidth()) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(
                            when (name) {
                                "麦克风" -> Icons.Rounded.MicNone
                                "位置" -> Icons.Rounded.LocationOn
                                else -> Icons.Rounded.NotificationsNone
                            },
                            null,
                            Modifier.size(24.dp),
                            tint = c.primary,
                        )
                        Text(name, Modifier.weight(1f), style = LaoType.cell)
                        LaoChip(
                            if (allowed) "已允许" else "未开启",
                            if (allowed) c.primary else c.onSurfaceVariant,
                        )
                    }
                    Text(purpose, style = LaoType.caption, color = c.onSurfaceVariant)
                    LaoSecondaryButton(
                        if (allowed) "管理权限" else "开启" + name,
                        Modifier.fillMaxWidth(),
                    ) {
                        if (allowed || (name == "通知" && Build.VERSION.SDK_INT < 33))
                            openAppPermissions(s)
                        else
                            s.invoke {
                                s.a.request(permission) {
                                    refresh++
                                    s.a.build()
                                }
                            }
                    }
                }
            }
        }
        animatedItem(4) {
            LaoPanel(Modifier.fillMaxWidth()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Rounded.PhotoCamera, null, Modifier.size(24.dp), tint = c.primary)
                    Text("照片与相机", Modifier.weight(1f), style = LaoType.cell)
                    LaoChip("选择时确认", c.primary)
                }
                Text("每次选择要使用的照片，也可以打开手机相机拍摄。", style = LaoType.caption, color = c.onSurfaceVariant)
                LaoSecondaryButton("打开资料扫描", Modifier.fillMaxWidth()) { s.open("scanner") }
            }
        }
        animatedItem(5) {
            LaoTextAction("查看全部系统权限", Modifier.fillMaxWidth()) { openAppPermissions(s) }
        }
    }
}
