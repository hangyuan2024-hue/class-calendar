package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

@Composable
internal fun CampusAppearancePage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val chosen = s.a.store.`object`("ui_palette_v1").optString("id", "ocean")
    val mode = s.a.store.string("compose_mode_v1", "system")
    fun palette(p: LaoPalette) {
        s.a.store.set(
            "ui_palette_v1",
            CampusJson.obj("id", p.id, "p", CampusTheme.hex(p.primary.toArgb())),
        )
        if (p.id in listOf("cyber", "graphite")) s.a.store.set("compose_mode_v1", "dark")
        s.a.store.set(
            "ui_skin_v1",
            if (p.id in listOf("cyber", "graphite") || mode == "dark") "cyber" else "fresh",
        )
        s.a.build()
        s.a.syncSoon()
    }
    LaoPage {
        animatedItem(0) { ProductIntro("一眼喜欢，久看不累", "整套配色与显示模式，为你的日常而设计。") }
        animatedItem(1) {
            LaoPanel(Modifier.fillMaxWidth(), color = c.surfaceContainerLow, padding = 24.dp) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    LaoMascot(Modifier.size(32.dp))
                    Text("当前外观预览", style = LaoType.caption, color = c.onSurfaceVariant)
                }
                LaoPanel(Modifier.fillMaxWidth()) {
                    Text("今天的节奏，安排从容", style = LaoType.cell)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        LaoChip(
                            "${CampusCourses.onDay(s.a.store, DateMath.today()).size} 节课程",
                            c.primary,
                        )
                        LaoChip(
                            "${visibleTasks(s.a).count { !s.a.done(it) }} 项待办",
                            CampusStatus.ai(),
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Rounded.CalendarMonth, null, tint = c.primary)
                        Icon(Icons.Rounded.Forum, null, tint = c.secondary)
                        Icon(Icons.Rounded.EmojiEvents, null, tint = c.tertiary)
                        Text("课程 · 同学 · 成长", style = LaoType.caption, color = c.onSurfaceVariant)
                    }
                }
            }
        }
        animatedItem(2) {
            LaoSection("显示模式")
            val labels = mapOf("light" to "明亮", "dark" to "深色", "system" to "跟随系统")
            LaoTabs(labels.values.toList(), labels[mode] ?: "跟随系统") { label ->
                val id = labels.entries.first { it.value == label }.key
                s.a.store.set("compose_mode_v1", id)
                s.a.store.set("ui_skin_v1", if (id == "dark") "cyber" else "fresh")
                s.a.build()
                s.a.syncSoon()
            }
        }
        animatedItem(3) { LaoSection("两种气质，同样从容", note = "默认柔和主题，或更有科技感的深空蓝") }
        animatedItem(4) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                listOf(LaoPalettes.first(), LaoPalettes.first { it.id == "cyber" }).forEach { p ->
                    ThemeCard(p, p.id == chosen, Modifier.weight(1f)) { palette(p) }
                }
            }
        }
        animatedItem(5) { LaoSection("更多喜欢的颜色", note = "所有页面、输入框与弹窗同步切换") }
        LaoPalettes.filter { it.id !in listOf("ocean", "cyber") }
            .chunked(2)
            .forEachIndexed { i, pair ->
                animatedItem(i + 6, "product-palette-$i") {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        pair.forEach { p ->
                            ThemeCard(p, p.id == chosen, Modifier.weight(1f)) { palette(p) }
                        }
                        if (pair.size == 1) Spacer(Modifier.weight(1f))
                    }
                }
            }
        animatedItem(12) {
            LaoPanel(Modifier.fillMaxWidth()) {
                val reduced = s.a.store.bool("compose_reduce_motion_v1", false)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("减少动态效果", style = LaoType.cell)
                        Text(
                            "保持静态阅读，减少页面移动与小人的呼吸动作。",
                            style = LaoType.caption,
                            color = c.onSurfaceVariant,
                        )
                    }
                    LaoToggle(
                        reduced,
                        {
                            s.a.store.set("compose_reduce_motion_v1", it)
                            s.a.build()
                        },
                        Modifier.semantics { contentDescription = "减少动态效果" },
                    )
                }
            }
        }
        animatedItem(13) {
            LaoSecondaryButton("编辑校园主页", Modifier.fillMaxWidth()) { s.sheet = HomeEditorSheet }
        }
    }
}

@Composable
private fun ThemeCard(p: LaoPalette, selected: Boolean, modifier: Modifier, click: () -> Unit) {
    val c = MaterialTheme.colorScheme
    LaoPanel(
        modifier.border(
            if (selected) 2.dp else 0.dp,
            if (selected) c.primary else Color.Transparent,
            RoundedCornerShape(24.dp),
        ),
        onClick = click,
    ) {
        val previewDark = p.id in listOf("cyber", "graphite")
        val canvas = if (previewDark) Color(0xFF121622) else Color(0xFFF6F7FC)
        val ink = if (previewDark) p.companion else p.primary
        Column(
            Modifier.fillMaxWidth()
                .height(112.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(canvas)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(16.dp).background(ink.copy(alpha = .2f), CircleShape))
                Box(
                    Modifier.width(32.dp)
                        .height(4.dp)
                        .background(ink.copy(alpha = .7f), CircleShape)
                )
                Spacer(Modifier.weight(1f))
                Box(Modifier.size(8.dp).background(p.accent, CircleShape))
            }
            Row(
                Modifier.fillMaxWidth()
                    .weight(1f)
                    .clip(RoundedCornerShape(12.dp))
                    .background(
                        Brush.linearGradient(listOf(p.primary, lerp(p.primary, p.accent, .24f)))
                    )
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(Icons.Rounded.AutoStories, null, Modifier.size(20.dp), tint = Color.White)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Box(
                        Modifier.width(32.dp)
                            .height(4.dp)
                            .background(Color.White.copy(alpha = .9f), CircleShape)
                    )
                    Box(
                        Modifier.width(20.dp)
                            .height(3.dp)
                            .background(Color.White.copy(alpha = .55f), CircleShape)
                    )
                }
            }
            Row(
                Modifier.fillMaxWidth()
                    .clip(CircleShape)
                    .background(if (previewDark) Color.White.copy(alpha = .08f) else Color.White)
                    .padding(4.dp),
                horizontalArrangement = Arrangement.SpaceAround,
            ) {
                listOf(ink, p.accent, ink.copy(alpha = .3f), ink.copy(alpha = .3f)).forEach { hue ->
                    Box(Modifier.size(8.dp).background(hue, CircleShape))
                }
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                p.name,
                Modifier.weight(1f),
                style = LaoType.cell,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Icon(
                if (selected) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                if (selected) "当前使用 ${p.name}" else "选择 ${p.name}",
                Modifier.size(18.dp),
                tint = if (selected) c.primary else c.onSurfaceVariant,
            )
        }
    }
}

@Composable
internal fun CampusHomeLayoutPage(s: CampusSession) {
    LaoPage {
        animatedItem(0) { ProductIntro("校园主页，按你的节奏", "首屏看重点，下面的模块由你决定。") }
        animatedItem(1) {
            LaoPanel(Modifier.fillMaxWidth()) {
                LaoSection("当前模块")
                homeOrder(s.a)
                    .filter { it !in listOf("w:pins", "w:rings") }
                    .forEach { Text("• ${productModuleName(it)}", style = LaoType.body) }
            }
        }
        animatedItem(2) {
            LaoPrimaryButton("编辑校园主页", Modifier.fillMaxWidth()) { s.sheet = HomeEditorSheet }
        }
        animatedItem(3) {
            LaoSecondaryButton("选择快捷工具", Modifier.fillMaxWidth()) { s.sheet = ToolPickerSheet }
        }
    }
}
