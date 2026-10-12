package com.laolao.classcalendar

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import org.json.JSONObject

/** The same native controller is shared by both appearance modes. No WebView or web bridge. */
@Composable
internal fun CampusLanWorkspace(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val status = s.a.lan?.state() ?: JSONObject()
    val enabled = status.optBoolean("enabled")
    val logged = status.optBoolean("logged", s.a.api.logged())
    val state = status.optString("state", "off")
    val connected = status.optInt("open")
    val working = state in listOf("searching", "connecting")
    val hue = if (state == "error" || state == "unavailable") c.error else c.primary
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "lan-heading") {
            LaoPageHeading("同一个 Wi-Fi，\n把校园带过去。", "网页、手机、电脑，互传本机学习记录。", "局域网互传", Icons.Rounded.Wifi)
        }
        animatedItem(1, "lan-controls") {
            LaoPanel(padding = 16.dp) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Box(
                        Modifier.size(48.dp)
                            .background(c.primary.copy(alpha = .08f), RoundedCornerShape(16.dp)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(Icons.Rounded.Devices, null, tint = c.primary)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("局域网互传", style = LaoType.cell)
                        Text(
                            if (enabled) "关闭后立即断开设备连接" else "由你开启，随时可以关闭",
                            style = LaoType.caption,
                            color = c.onSurfaceVariant,
                        )
                    }
                    LaoToggle(
                        enabled,
                        { value ->
                            s.a.lan?.setEnabled(value)
                            s.refresh()
                        },
                        Modifier.semantics { contentDescription = "局域网互传开关" },
                    )
                }
            }
        }
        animatedItem(2, "lan-status") {
            Column(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(28.dp))
                    .background(
                        Brush.linearGradient(
                            listOf(lerp(c.surface, hue, .1f), c.surface.copy(alpha = .94f))
                        )
                    )
                    .border(1.dp, hue.copy(alpha = .1f), RoundedCornerShape(28.dp))
                    .padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                LanOrbit(working, connected > 0, hue, Modifier.size(72.dp))
                Text(
                    when {
                        !enabled -> "准备好，再连接。"
                        !logged -> "用同一个账号。"
                        connected > 0 -> "设备已经相遇。"
                        working -> "正在寻找你的设备。"
                        state in listOf("error", "unavailable") -> "这次先保留在本机。"
                        else -> "记录在这里，随时带走。"
                    },
                    style = LaoType.title,
                )
                Text(
                    status.optString("text", "开启后，在同一网络中寻找设备"),
                    style = LaoType.body,
                    color = c.onSurfaceVariant,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    LanMetric("本机记录", status.optInt("local").toString(), Modifier.weight(1f))
                    LanMetric("直连设备", connected.toString(), Modifier.weight(1f))
                    LanMetric("本次收下", status.optLong("received").toString(), Modifier.weight(1f))
                }
                if (enabled && !logged) {
                    LaoPrimaryButton("登录账号", Modifier.fillMaxWidth()) { s.open("login") }
                } else if (enabled) {
                    LaoSecondaryButton("重新查找设备", Modifier.fillMaxWidth()) { s.a.lan?.refresh() }
                }
            }
        }
        val peers = status.optJSONArray("peers")
        if (peers != null && peers.length() > 0) {
            animatedItem(3, "lan-peers") {
                LaoPanel {
                    LaoSection("设备状态", note = "仅显示当前账号的设备")
                    repeat(peers.length()) { index ->
                        val peer = peers.optJSONObject(index) ?: return@repeat
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Icon(
                                if (peer.optString("kind") == "电脑") Icons.Rounded.Computer
                                else if (peer.optString("kind") == "网页") Icons.Rounded.Public
                                else Icons.Rounded.PhoneAndroid,
                                null,
                                tint = c.primary,
                            )
                            Text(
                                peer.optString("kind", "其他设备"),
                                Modifier.weight(1f),
                                style = LaoType.body,
                            )
                            Text(
                                when (peer.optString("state")) {
                                    "open" -> "已直连"
                                    "connecting" -> "连接中"
                                    else -> "等待重连"
                                },
                                style = LaoType.caption,
                                color = c.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
        animatedItem(4, "lan-steps") {
            LaoSection("两端这样打开", note = "第一次互传，照着做就好。")
            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                LanInstruction("01", "登录同一个账号", "另一台设备打开捞捞课程表的网页或电脑版。")
                LanInstruction("02", "连上同一个 Wi-Fi", "保持两端打开；访客网络和校园网隔离可能阻止直连。")
                LanInstruction("03", "打开局域网互传", "网页版在“我的 → 数据”开启；本机事项修改后会自动互传。")
            }
        }
        animatedItem(5, "lan-local-action") {
            LaoEditorialCard(
                "记一件本机事项",
                "单独标为本机记录，经局域网带到另一台设备。",
                Icons.Rounded.EditCalendar,
                CampusAccent.readable(LaoArt.coral),
            ) {
                lanLocalEvent(s)
            }
        }
        animatedItem(6, "lan-boundaries") {
            LaoPanel {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Rounded.VerifiedUser, null, Modifier.size(20.dp), tint = c.primary)
                    Text("学习数据直传，登录信息留在本机", style = LaoType.cell)
                }
                Text(
                    "互传个人事项、习惯与打卡等本机记录；选择“只存本机”时，也互传兼容的规划与个人偏好。电脑版倒数日会收进手机的考试倒计时。",
                    style = LaoType.caption,
                    color = c.onSurfaceVariant,
                )
                Text(
                    "服务器只交换连接信息，学习内容通过加密设备连接传输。课表云插件、登录凭据、手机权限、录音和图片文件不在这项网页互传协议内。",
                    style = LaoType.caption,
                    color = c.onSurfaceVariant,
                )
                if (status.optInt("conflicts") > 0) {
                    Text(
                        "有 ${status.optInt("conflicts")} 条冲突或格式不同的记录已跳过，原有记录保持安全。",
                        style = LaoType.caption,
                        color = c.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun LanMetric(label: String, value: String, modifier: Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(value, style = LaoType.headline)
        Text(label, style = LaoType.label, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LanInstruction(number: String, title: String, body: String) {
    val c = MaterialTheme.colorScheme
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(
            Modifier.size(40.dp)
                .background(c.primary.copy(alpha = .08f), RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text(number, style = LaoType.label, color = c.primary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = LaoType.cell)
            Text(body, style = LaoType.caption, color = c.onSurfaceVariant)
        }
    }
}

@Composable
private fun LanOrbit(working: Boolean, connected: Boolean, hue: Color, modifier: Modifier) {
    val motion = LocalMotionEnabled.current
    val transition = rememberInfiniteTransition(label = "寻找设备")
    val progress by
        transition.animateFloat(
            0f,
            1f,
            infiniteRepeatable(tween(2200), RepeatMode.Restart),
            label = "连接波纹",
        )
    val phase = if (motion && working) progress else 0f
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val center = Offset(size.width / 2, size.height / 2)
            drawCircle(hue.copy(alpha = .06f), size.width / 2, center)
            drawCircle(hue.copy(alpha = .07f), size.width * .36f, center)
            if (phase > 0f)
                drawCircle(
                    hue.copy(alpha = .14f * (1f - phase)),
                    size.width * (.24f + phase * .25f),
                    center,
                )
        }
        Icon(
            if (connected) Icons.Rounded.Sync else Icons.Rounded.Wifi,
            null,
            Modifier.size(28.dp),
            tint = hue,
        )
    }
}

private fun lanLocalEvent(s: CampusSession) {
    val a = s.a
    a.ui.form(
        "记一件本机事项",
        CampusJson.obj(
            "id",
            CampusJson.id(),
            "date",
            a.selectedDay,
            "time",
            "",
            "done",
            false,
            "msg_type",
            "个人",
            "local",
            true,
        ),
        { value ->
            val date = value.optString("date")
            val time = value.optString("time")
            CampusJson.put(value, "event_time", date + if (time.isEmpty()) "" else " $time")
            value.remove("date")
            value.remove("time")
            CampusJson.put(value, "local", true)
            a.store.replace("personal_events_v1", value.optString("id"), value)
            a.build()
            a.syncSoon()
            a.lan?.dataChanged()
        },
        CampusUi.f("subject", "事项名称"),
        CampusUi.choice("msg_type", "事项类型", "个人", "作业", "考试", "活动", "通知", "其他"),
        CampusUi.Field("date", "日期（可留空）", "date", false),
        CampusUi.Field("time", "时间（可留空）", "time", false),
        CampusUi.optional("location", "地点"),
        CampusUi.Field("note", "私人备注", "multiline", false),
    )
}
