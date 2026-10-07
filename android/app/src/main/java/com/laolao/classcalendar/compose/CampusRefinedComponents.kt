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
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

@Composable
internal fun GrowthSummary(s: CampusSession, week: IntArray, done: Int, sessions: Int) {
    val c = MaterialTheme.colorScheme
    val motion = LocalMotionEnabled.current
    var entered by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { entered = true }
    val value = if (week[3] == 0) 0f else (week[2].toFloat() / week[3]).coerceIn(0f, 1f)
    val progress by
        animateFloatAsState(
            if (entered || !motion) value else 0f,
            if (motion) spring(dampingRatio = .86f, stiffness = 100f) else snap(),
            label = "growth ring",
        )
    ProductSurface(Modifier.fillMaxWidth(), color = lerp(c.surface, c.primary, .05f)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("本周成长", Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            StatusPill(if (week[3] == 0) "从今天开始" else "${(value * 100).toInt()}% 已完成", c.primary)
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.size(104.dp), contentAlignment = Alignment.Center) {
                Canvas(Modifier.fillMaxSize()) {
                    val inset = 8.dp.toPx()
                    val origin = Offset(inset, inset)
                    val arcSize = Size(size.width - inset * 2, size.height - inset * 2)
                    drawArc(
                        c.primary.copy(alpha = .10f),
                        -90f,
                        360f,
                        false,
                        origin,
                        arcSize,
                        style = Stroke(8.dp.toPx(), cap = StrokeCap.Round),
                    )
                    if (progress > 0f)
                        drawArc(
                            c.primary,
                            -90f,
                            progress * 360f,
                            false,
                            origin,
                            arcSize,
                            style = Stroke(8.dp.toPx(), cap = StrokeCap.Round),
                        )
                }
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        "${week[2]}/${week[3]}",
                        style =
                            if (week[3] > 99) MaterialTheme.typography.titleLarge
                            else MaterialTheme.typography.headlineSmall,
                        color = c.primary,
                    )
                    Text(
                        "完成安排",
                        style = MaterialTheme.typography.labelSmall,
                        color = c.onSurfaceVariant,
                    )
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (week[2] > 0) "每一步，\n都算进步。" else "慢慢来，\n今天开始就好。",
                    style = MaterialTheme.typography.titleLarge,
                )
                Text(
                    if (week[3] == 0) "记录一个小目标，让坚持留下痕迹。"
                    else "还有 ${week[3] - week[2]} 项安排，按自己的节奏完成。",
                    style = MaterialTheme.typography.bodySmall,
                    color = c.onSurfaceVariant,
                )
            }
        }
        HorizontalDivider(color = c.primary.copy(alpha = .08f))
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            ProductMetric(done.toString(), "累计完成", Modifier.weight(1f))
            ProductMetric("${week[4]}/${week[5]}", "今日习惯", Modifier.weight(1f))
            ProductMetric(sessions.toString(), "专注记录", Modifier.weight(1f))
        }
        AiAction("帮我安排今天的复习", Modifier.fillMaxWidth()) { s.agent("帮我安排复习") }
    }
}

@Composable
internal fun ToolCatalogTile(s: CampusSession, tool: Array<String>, modifier: Modifier) {
    val c = MaterialTheme.colorScheme
    ProductSurface(modifier, onClick = { s.open(tool[0]) }, padding = 16.dp) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconTile(tool[0], 40.dp)
            Spacer(Modifier.weight(1f))
            Icon(
                Icons.Rounded.NorthEast,
                null,
                Modifier.size(16.dp),
                tint = c.onSurfaceVariant.copy(alpha = .6f),
            )
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                tool[1],
                style = MaterialTheme.typography.titleSmall,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                tool[2],
                style = MaterialTheme.typography.bodySmall,
                color = c.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
