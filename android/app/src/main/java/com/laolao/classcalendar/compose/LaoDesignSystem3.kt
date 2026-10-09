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
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*

/** Editorial native design language. All surfaces inherit the user's palette and display mode. */
internal object LaoArt {
    val coral = Color(0xFFC65B48)
    val iris = Color(0xFF5156CF)
    val sand = Color(0xFFAB713A)

    @Composable fun ink() = MaterialTheme.colorScheme.onSurface

    @Composable
    fun hero(): Color {
        val c = MaterialTheme.colorScheme
        return lerp(
            Color(0xFF222443),
            c.primary,
            if (c.background.luminance() < .3f) .12f else .52f,
        )
    }

    @Composable
    fun soft() = lerp(MaterialTheme.colorScheme.surface, MaterialTheme.colorScheme.primary, .055f)
}

@Composable
internal fun LaoEyebrow(label: String, color: Color = MaterialTheme.colorScheme.primary) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.width(16.dp).height(2.dp).background(color, CircleShape))
        Text(label, style = LaoType.caption.copy(fontWeight = FontWeight.SemiBold), color = color)
    }
}

@Composable
internal fun LaoPageHeading(
    title: String,
    summary: String,
    eyebrow: String,
    icon: ImageVector? = null,
) {
    val c = MaterialTheme.colorScheme
    // Give long Chinese titles an intentional phrase break instead of orphaned final characters.
    val composedTitle =
        if (title.length > 9 && !title.contains('\n') && title.contains('，'))
            title.replaceFirst("，", "，\n")
        else title
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { LaoEyebrow(eyebrow) }
            if (icon != null)
                Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
                    LaoPaperArt(Modifier.matchParentSize(), c.primary)
                    Icon(icon, null, Modifier.size(20.dp), tint = c.primary)
                }
        }
        Text(composedTitle, style = LaoType.headline, color = c.onSurface)
        if (summary.isNotBlank()) Text(summary, style = LaoType.body, color = c.onSurfaceVariant)
    }
}

/** A small, original piece of vector paper sculpture. Not a bitmap, shader or web layer. */
@Composable
internal fun LaoPaperArt(
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.primary,
) {
    Canvas(modifier) {
        val side = size.minDimension
        val center = Offset(size.width / 2, size.height / 2)
        val rect = Size(side * .68f, side * .76f)
        val start = Offset(center.x - rect.width / 2, center.y - rect.height / 2)
        rotate(-16f, center) {
            drawRoundRect(tint.copy(alpha = .07f), start, rect, CornerRadius(side * .19f))
            drawRoundRect(
                tint.copy(alpha = .18f),
                start,
                rect,
                CornerRadius(side * .19f),
                style = Stroke(1.dp.toPx()),
            )
        }
        rotate(12f, center) {
            drawRoundRect(tint.copy(alpha = .045f), start, rect, CornerRadius(side * .19f))
            drawRoundRect(
                tint.copy(alpha = .22f),
                start,
                rect,
                CornerRadius(side * .19f),
                style = Stroke(1.dp.toPx()),
            )
        }
        drawCircle(
            tint.copy(alpha = .4f),
            side * .035f,
            Offset(center.x + side * .4f, center.y - side * .28f),
        )
    }
}

@Composable
internal fun LaoEditorialCard(
    title: String,
    summary: String,
    icon: ImageVector,
    hue: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = MaterialTheme.colorScheme
    Column(
        modifier
            .shadow(
                2.dp,
                RoundedCornerShape(24.dp),
                false,
                ambientColor = Color.Black.copy(alpha = .025f),
                spotColor = hue.copy(alpha = .05f),
            )
            .clip(RoundedCornerShape(24.dp))
            .background(
                Brush.linearGradient(
                    listOf(lerp(c.surface, hue, .06f), c.surface.copy(alpha = .94f))
                )
            )
            .border(1.dp, c.outlineVariant.copy(alpha = .35f), RoundedCornerShape(24.dp))
            .laoTap(role = Role.Button, action = onClick)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, null, Modifier.size(26.dp), tint = hue)
            Spacer(Modifier.weight(1f))
            Icon(Icons.Rounded.NorthEast, null, Modifier.size(16.dp), tint = hue.copy(alpha = .6f))
        }
        Text(title, style = LaoType.cell, color = c.onSurface)
        Text(
            summary,
            style = LaoType.caption,
            color = c.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
internal fun LaoProgressStrip(s: CampusSession, stats: IntArray) {
    val c = MaterialTheme.colorScheme
    val tones =
        listOf(c.primary, CampusAccent.readable(LaoArt.sand), CampusAccent.readable(LaoArt.coral))
    val labels = listOf("本周作业", "本周事项", "今日打卡")
    val routes = listOf("homework", "calendar", "growth")
    // Keep the right-hand quick action clear of all three progress labels, including large text.
    Row(
        Modifier.fillMaxWidth().padding(end = 64.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        labels.forEachIndexed { index, label ->
            val done = stats[index * 2]
            val total = stats[index * 2 + 1]
            val fraction by
                animateFloatAsState(
                    if (total == 0) 0f else done.toFloat() / total,
                    if (LocalMotionEnabled.current) spring(1f, 180f) else snap(),
                    label = "daily completion",
                )
            Column(
                Modifier.weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .laoTap(role = Role.Button) { s.open(routes[index]) }
                    .padding(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(2.dp),
                ) {
                    Text(
                        done.toString(),
                        style = LaoType.display.copy(fontSize = 30.sp, lineHeight = 36.sp),
                        color = tones[index],
                    )
                    Text(
                        "/ $total",
                        Modifier.padding(bottom = 3.dp),
                        style = LaoType.caption,
                        color = c.onSurfaceVariant,
                    )
                }
                Text(label, style = LaoType.caption, color = c.onSurfaceVariant)
                Box(
                    Modifier.fillMaxWidth()
                        .height(3.dp)
                        .clip(CircleShape)
                        .background(tones[index].copy(alpha = .1f))
                ) {
                    Box(
                        Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f))
                            .fillMaxHeight()
                            .background(tones[index], CircleShape)
                    )
                }
            }
        }
    }
}

/** A book object, rather than a generic card with another colored rectangle inside it. */
@Composable
internal fun LaoNotebook(
    name: String,
    total: Int,
    mastered: Int,
    modifier: Modifier,
    open: () -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val hue =
        lerp(
            when {
                name.contains("数学") -> LaoArt.iris
                name.contains("英语") || name.contains("语言") -> LaoArt.coral
                name.contains("物理") -> CampusAccent.blue
                name.contains("历史") || name.contains("政治") -> LaoArt.sand
                else ->
                    listOf(LaoArt.iris, LaoArt.coral, LaoArt.sand, CampusAccent.blue)[
                        kotlin.math.abs(name.hashCode() % 4)]
            },
            Color(0xFF282744),
            .16f,
        )
    Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(
            Modifier.fillMaxWidth()
                .height(192.dp)
                .shadow(
                    8.dp,
                    RoundedCornerShape(
                        topStart = 6.dp,
                        bottomStart = 6.dp,
                        topEnd = 20.dp,
                        bottomEnd = 20.dp,
                    ),
                    false,
                    ambientColor = hue.copy(alpha = .06f),
                    spotColor = hue.copy(alpha = .12f),
                )
                .clip(
                    RoundedCornerShape(
                        topStart = 6.dp,
                        bottomStart = 6.dp,
                        topEnd = 20.dp,
                        bottomEnd = 20.dp,
                    )
                )
                .background(Brush.linearGradient(listOf(lerp(hue, Color(0xFF272848), .28f), hue)))
                .laoTap(role = Role.Button, action = open)
        ) {
            Box(
                Modifier.padding(start = 12.dp)
                    .width(1.dp)
                    .fillMaxHeight()
                    .background(Color.White.copy(alpha = .22f))
            )
            Canvas(Modifier.matchParentSize()) {
                val circle = Offset(size.width * .85f, size.height * .88f)
                for (i in 1..4) drawCircle(
                    Color.White.copy(alpha = .11f),
                    size.width * (.2f + i * .12f),
                    circle,
                    style = Stroke(1.dp.toPx()),
                )
            }
            Column(
                Modifier.fillMaxSize()
                    .padding(start = 24.dp, top = 20.dp, end = 16.dp, bottom = 20.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("错题记录本", style = LaoType.label, color = Color.White.copy(alpha = .9f))
                Text(
                    name,
                    style = LaoType.title,
                    color = Color.White,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    total.toString().padStart(2, '0'),
                    style = LaoType.display,
                    color = Color.White,
                )
                Text("道学习记录", style = LaoType.label, color = Color.White.copy(alpha = .9f))
            }
        }
        Text("已掌握 $mastered 道", style = LaoType.caption, color = c.onSurfaceVariant)
    }
}
