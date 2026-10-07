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
        s.a.store.set("ui_skin_v1", if (p.id == "cyber" || mode == "dark") "cyber" else "fresh")
        s.a.build()
        s.a.syncSoon()
    }
    PageList {
        animatedItem(0) { ProductIntro("一眼喜欢，久看不累", "整套配色与显示模式，为你的日常而设计。") }
        animatedItem(1) {
            ProductSurface(
                Modifier.fillMaxWidth(),
                color = c.surfaceContainerLow,
                padding = 24.dp,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    LaoMascot(Modifier.size(32.dp))
                    Text(
                        "当前外观预览",
                        style = MaterialTheme.typography.labelLarge,
                        color = c.onSurfaceVariant,
                    )
                }
                ProductSurface(Modifier.fillMaxWidth()) {
                    Text("今天的节奏，安排从容", style = MaterialTheme.typography.titleMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        StatusPill(
                            "${CampusCourses.onDay(s.a.store, DateMath.today()).size} 节课程",
                            c.primary,
                        )
                        StatusPill(
                            "${visibleTasks(s.a).count { !s.a.done(it) }} 项待办",
                            CampusStatus.ai(),
                        )
                    }
                    AiAction("帮我规划今天", Modifier.fillMaxWidth()) { s.agent("帮我规划今天") }
                }
            }
        }
        animatedItem(2) {
            SectionHeading("显示模式")
            val labels = mapOf("light" to "明亮", "dark" to "深色", "system" to "跟随系统")
            ProductTabs(labels.values.toList(), labels[mode] ?: "跟随系统") { label ->
                val id = labels.entries.first { it.value == label }.key
                s.a.store.set("compose_mode_v1", id)
                s.a.store.set("ui_skin_v1", if (id == "dark") "cyber" else "fresh")
                s.a.build()
                s.a.syncSoon()
            }
        }
        animatedItem(3) { SectionHeading("两种气质，同样从容", note = "默认柔和主题，或更有科技感的深空蓝") }
        animatedItem(4) {
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                listOf(LaoPalettes.first(), LaoPalettes.first { it.id == "cyber" }).forEach { p ->
                    ThemeCard(p, p.id == chosen, Modifier.weight(1f)) { palette(p) }
                }
            }
        }
        animatedItem(5) { SectionHeading("更多喜欢的颜色", note = "所有页面、输入框与弹窗同步切换") }
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
            ProductSurface(Modifier.fillMaxWidth()) {
                val reduced = s.a.store.bool("compose_reduce_motion_v1", false)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("减少动态效果", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "保持静态阅读，减少页面移动与小人的呼吸动作。",
                            style = MaterialTheme.typography.bodySmall,
                            color = c.onSurfaceVariant,
                        )
                    }
                    Switch(
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
            SoftButton("编辑校园主页", Modifier.fillMaxWidth()) { s.sheet = HomeEditorSheet }
        }
    }
}

@Composable
private fun ThemeCard(p: LaoPalette, selected: Boolean, modifier: Modifier, click: () -> Unit) {
    val c = MaterialTheme.colorScheme
    ProductSurface(
        modifier.border(
            if (selected) 2.dp else 0.dp,
            if (selected) c.primary else Color.Transparent,
            RoundedCornerShape(24.dp),
        ),
        onClick = click,
    ) {
        Box(
            Modifier.fillMaxWidth()
                .height(64.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(
                    Brush.linearGradient(
                        listOf(p.companion.copy(alpha = .75f), p.primary.copy(alpha = .22f))
                    )
                )
        ) {
            Row(
                Modifier.align(Alignment.Center).padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(Modifier.size(24.dp).background(p.primary, CircleShape))
                Box(Modifier.size(24.dp).background(p.companion, CircleShape))
                Box(Modifier.size(24.dp).background(Color.White.copy(alpha = .8f), CircleShape))
            }
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                p.name,
                Modifier.weight(1f),
                style = MaterialTheme.typography.titleSmall,
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
    PageList {
        animatedItem(0) { ProductIntro("校园主页，按你的节奏", "首屏看重点，下面的模块由你决定。") }
        animatedItem(1) {
            ProductSurface(Modifier.fillMaxWidth()) {
                SectionHeading("当前模块")
                homeOrder(s.a)
                    .filter { it !in listOf("w:pins", "w:rings") }
                    .forEach {
                        Text(
                            "• ${productModuleName(it)}",
                            style = MaterialTheme.typography.bodyLarge,
                        )
                    }
            }
        }
        animatedItem(2) {
            PrimaryButton("编辑校园主页", Modifier.fillMaxWidth()) { s.sheet = HomeEditorSheet }
        }
        animatedItem(3) {
            SoftButton("选择快捷工具", Modifier.fillMaxWidth()) { s.sheet = ToolPickerSheet }
        }
    }
}
