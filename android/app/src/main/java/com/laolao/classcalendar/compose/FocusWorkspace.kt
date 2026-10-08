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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import org.json.JSONObject

internal data class FocusClock(
    val remaining: Long,
    val duration: Long,
    val running: Boolean,
    val rest: Boolean,
    val timer: JSONObject,
)

@Composable
internal fun rememberFocusClock(s: CampusSession): FocusClock {
    val owner = LocalLifecycleOwner.current
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(owner, s.a) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (isActive) {
                CampusPlanner.settle(s.a, s.a.store)
                now = System.currentTimeMillis()
                delay(1000)
            }
        }
    }
    s.revision
    val timer = s.a.store.`object`(CampusPlanner.TIMER)
    val default = s.a.store.`object`("native_pomo_config").optInt("focus", 25) * 60000L
    val running = timer.optBoolean("running")
    return FocusClock(
        if (running) maxOf(0, timer.optLong("deadline") - now)
        else timer.optLong("remaining", default),
        timer.optLong("duration", default).coerceAtLeast(1),
        running,
        timer.optString("phase", "focus") == "break",
        timer,
    )
}

@Composable
internal fun FocusPage(s: CampusSession) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    val clock = rememberFocusClock(s)
    val title = clock.timer.optString("title")
    val phase =
        if (!clock.rest) "专注时间" else if (clock.timer.optBoolean("longBreak")) "长休息" else "短休息"
    val progress by
        animateFloatAsState(
            (clock.remaining.toFloat() / clock.duration).coerceIn(0f, 1f),
            animationSpec = spring(dampingRatio = 1f, stiffness = 180f),
            label = "focus progress",
        )
    val history =
        rows(a.store.list("native_focus_sessions")).sortedByDescending { it.optLong("finishedAt") }
    val today = DateMath.today()
    val todayCount = a.store.`object`("pomo_log_v1").optInt(today)
    val minutes = history.filter { it.optString("day") == today }.sumOf { it.optInt("minutes") }
    PageList {
        animatedItem(0) { SectionHeading("把注意力，留给一件事", note = "专注与休息都有节奏，离开页面也会保留计时") }
        animatedItem(1) {
            PremiumCard(Modifier.fillMaxWidth()) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Surface(color = colors.primaryContainer, shape = RoundedCornerShape(8.dp)) {
                        Text(
                            phase,
                            Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                            style = MaterialTheme.typography.labelLarge,
                            color = colors.onPrimaryContainer,
                        )
                    }
                    PressIcon(Icons.Rounded.Tune, "计时设置") { focusSettings(s) }
                }
                TextButton(
                    onClick = {
                        a.ui.form(
                            "这轮专注做什么",
                            CampusJson.obj("title", title),
                            { v ->
                                val timer = a.store.`object`(CampusPlanner.TIMER)
                                timer.put("title", v.optString("title"))
                                a.store.set(CampusPlanner.TIMER, timer)
                                a.build()
                            },
                            CampusUi.optional("title", "例如：完成微积分作业"),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        title.ifBlank { "给这轮专注起个名字" },
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
                Box(
                    Modifier.fillMaxWidth().aspectRatio(1f).padding(8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Canvas(Modifier.fillMaxSize().padding(8.dp)) {
                        val stroke = 8.dp.toPx()
                        val diameter = size.minDimension - stroke
                        val offset =
                            Offset((size.width - diameter) / 2, (size.height - diameter) / 2)
                        drawArc(
                            colors.surfaceContainerHigh,
                            -90f,
                            360f,
                            false,
                            topLeft = offset,
                            size = Size(diameter, diameter),
                            style = Stroke(stroke, cap = StrokeCap.Round),
                        )
                        drawArc(
                            colors.primary,
                            -90f,
                            progress * 360f,
                            false,
                            topLeft = offset,
                            size = Size(diameter, diameter),
                            style = Stroke(stroke, cap = StrokeCap.Round),
                        )
                    }
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            CampusPlanner.duration(clock.remaining),
                            style =
                                MaterialTheme.typography.displayLarge.copy(
                                    fontSize = 48.sp,
                                    lineHeight = 56.sp,
                                    fontWeight = FontWeight.Medium,
                                    fontFamily = FontFamily.Monospace,
                                ),
                            color = colors.onSurface,
                        )
                        Text(
                            "本轮 ${maxOf(1, clock.duration/60000)} 分钟",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant,
                        )
                        Text(
                            if (clock.running) "正在计时" else "准备好以后，轻轻开始",
                            style = MaterialTheme.typography.labelMedium,
                            color = colors.primary,
                        )
                    }
                }
                PrimaryButton(
                    if (clock.running) "暂停计时" else if (clock.rest) "开始休息" else "开始专注",
                    Modifier.fillMaxWidth(),
                ) {
                    CampusPlanner.toggle(a)
                }
                if (clock.timer.has("id"))
                    TextButton(
                        onClick = {
                            a.ui.confirm("结束这轮计时？", "未完成的专注不会计入番茄次数。") {
                                a.store.set(CampusPlanner.TIMER, JSONObject())
                                CampusPlanner.cancel(a, a.store.owner)
                                a.build()
                            }
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("结束本轮", color = colors.onSurfaceVariant)
                    }
            }
        }
        animatedItem(2) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                FocusMetric("今日完成", "$todayCount", "轮专注", Modifier.weight(1f))
                FocusMetric("累计投入", "$minutes", "分钟", Modifier.weight(1f))
            }
        }
        animatedItem(3) { SectionHeading("专注足迹", action = "提醒设置") { s.open("reminders") } }
        if (history.isEmpty()) {
            val legacy = a.store.`object`("pomo_log_v1")
            val days = CampusJson.keys(legacy).sortedDescending().take(7)
            if (days.isEmpty())
                animatedItem(4) { EmptyState("第一轮专注，等你开始", "完成专注时段后，轮次、时长与成长会记录在这里。") }
            days.forEachIndexed { index, day ->
                animatedItem(index + 4, "focus-old-$day") {
                    PremiumCard(Modifier.fillMaxWidth()) {
                        Text(
                            "${dateLabel(day)} · ${legacy.optInt(day)} 轮",
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                }
            }
        } else
            history.take(14).forEachIndexed { index, record ->
                animatedItem(index + 4, "focus-${record.optString("id")}") {
                    PremiumCard(Modifier.fillMaxWidth()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            IconTile("pomo", 40.dp)
                            Column(
                                Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    record.optString("title").ifBlank { "一次认真专注" },
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                Text(
                                    "${dateLabel(record.optString("day"))} · ${record.optInt("minutes")} 分钟",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = colors.onSurfaceVariant,
                                )
                            }
                            Icon(Icons.Rounded.CheckCircle, null, tint = colors.primary)
                        }
                    }
                }
            }
    }
}

@Composable
private fun FocusMetric(title: String, value: String, unit: String, modifier: Modifier) {
    PremiumCard(modifier) {
        Text(
            title,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                value,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Text(
                unit,
                style = MaterialTheme.typography.bodySmall,
                modifier = Modifier.padding(bottom = 8.dp),
            )
        }
    }
}

internal fun focusSettings(s: CampusSession) {
    val a = s.a
    val c = a.store.`object`("native_pomo_config")
    val initial =
        CampusJson.obj(
            "focus",
            c.optInt("focus", 25),
            "break",
            c.optInt("break", 5),
            "longBreak",
            c.optInt("longBreak", 15),
            "every",
            c.optInt("every", 4),
            "autoBreak",
            c.optBoolean("autoBreak"),
            "autoNext",
            c.optBoolean("autoNext"),
            "sound",
            c.optBoolean("sound", true),
        )
    a.ui.form(
        "专注与休息",
        initial,
        { v ->
            require(
                v.optInt("focus") in 1..180 &&
                    v.optInt("break") in 1..60 &&
                    v.optInt("longBreak") in 1..60 &&
                    v.optInt("every") in 2..12
            ) {
                "专注 1—180 分钟，休息 1—60 分钟，长休息间隔 2—12 轮"
            }
            a.store.set("native_pomo_config", v)
            if (!a.store.`object`(CampusPlanner.TIMER).optBoolean("running")) {
                a.store.set(CampusPlanner.TIMER, JSONObject())
                CampusPlanner.cancel(a, a.store.owner)
            }
            a.build()
        },
        CampusUi.f("focus", "专注分钟", "number"),
        CampusUi.f("break", "短休息分钟", "number"),
        CampusUi.f("longBreak", "长休息分钟", "number"),
        CampusUi.f("every", "每几轮长休息一次", "number"),
        CampusUi.f("autoBreak", "完成后自动休息", "boolean"),
        CampusUi.f("autoNext", "休息后自动专注", "boolean"),
        CampusUi.f("sound", "有声提醒", "boolean"),
    )
}
