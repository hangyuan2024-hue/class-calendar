package com.laolao.classcalendar

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.*

private fun toolState(s: CampusSession, route: String): String =
    when (route) {
        "courses" -> "今天 ${CampusCourses.onDay(s.a.store, DateMath.today()).size} 节课"
        "wrongbook" -> {
            val records = rows(s.a.store.list("native_wrong"))
            if (records.isEmpty()) "拍照收进学科书架"
            else
                "${records.map { it.optString("subject", "其他") }.distinct().size} 本错题本 · ${records.count { !it.optBoolean("mastered") }} 题待复习"
        }
        "countdown" -> {
            val next =
                rows(s.a.store.list("native_exams"))
                    .mapNotNull { runCatching { DateMath.days(it.optString("date")) }.getOrNull() }
                    .filter { it >= 0 }
                    .minOrNull()
            if (next == null) "设置下一次考试" else if (next == 0L) "今天有考试" else "下次考试还有 $next 天"
        }
        "ledger" -> "已记录 ${s.a.store.list("native_expenses").length()} 笔校园花销"
        "pomo" ->
            if (s.a.store.`object`("native_pomo_timer").optBoolean("running")) "本轮正在专注"
            else "给注意力一点空间"
        "growth" -> "今天 ${weekStats(s.a)[4]}/${weekStats(s.a)[5]} 个目标完成"
        else -> ""
    }

@Composable
private fun toolHue(route: String, group: String): Color =
    CampusAccent.readable(
        when {
            route in listOf("countdown", "draw", "oracle") -> CampusAccent.amber
            route in listOf("wrongbook", "ledger", "diary") -> CampusAccent.berry
            group == "规划" -> CampusAccent.violet
            group == "生活" || group == "手机" -> CampusAccent.mint
            else -> CampusAccent.blue
        }
    )

@Composable
internal fun LaoToolsStudio(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("全部") }
    val shelfWidth = if (LocalConfiguration.current.screenWidthDp < 360) 64.dp else 70.dp
    val catalog = CampusToolbox.ITEMS.toList()
    val pinned =
        CampusToolbox.pinned(s.a).let { (0 until it.length()).map { i -> it.optString(i) } }
    val recent =
        s.a.store.list("native_recent_tools").let {
            (0 until it.length()).map { i -> it.optString(i) }
        }
    val shown =
        catalog
            .filter { item ->
                if (query.isNotBlank())
                    (item[1] + item[2] + CampusToolbox.name(item[0])).contains(query, true)
                else if (category == "最近") item[0] in recent
                else category == "全部" || item[3] == category
            }
            .let { list ->
                if (category == "最近" && query.isBlank()) list.sortedBy { recent.indexOf(it[0]) }
                else list
            }
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "tools3-heading") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("工具箱", Modifier.weight(1f), style = LaoType.headline)
                Column(horizontalAlignment = Alignment.End) {
                    Text("随身的小帮手", style = LaoType.caption, color = c.onSurfaceVariant)
                    Text("${catalog.size} 个校园工具", style = LaoType.label, color = c.primary)
                }
            }
        }
        animatedItem(1, "tools3-search") {
            LaoInput(
                query,
                { query = it },
                "",
                Modifier.fillMaxWidth(),
                "搜工具、功能或关键词",
                Icons.Rounded.Search,
                trailing = {
                    if (query.isNotBlank())
                        LaoIconButton(Icons.Rounded.Close, "清空工具搜索", Modifier.size(32.dp)) {
                            query = ""
                        }
                },
            )
        }
        if (query.isBlank())
            animatedItem(2, "tools3-favorites") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("我的常用", Modifier.weight(1f), style = LaoType.cell)
                        Text("${pinned.size} 个", style = LaoType.label, color = c.onSurfaceVariant)
                        LaoIconButton(Icons.Rounded.Add, "选择常用工具", Modifier.size(40.dp)) {
                            s.sheet = ToolPickerSheet
                        }
                    }
                    if (pinned.isEmpty()) {
                        Row(
                            Modifier.fillMaxWidth()
                                .clip(RoundedCornerShape(20.dp))
                                .background(c.primary.copy(alpha = .045f))
                                .laoTap { s.sheet = ToolPickerSheet }
                                .padding(16.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Rounded.BookmarkAdd,
                                null,
                                Modifier.size(24.dp),
                                tint = c.primary,
                            )
                            Text("把喜欢的工具，放在手边。", style = LaoType.caption)
                        }
                    } else {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(pinned, key = { it }) { route ->
                                val info = catalog.find { it[0] == route }
                                val hue = toolHue(route, info?.get(3).orEmpty())
                                Column(
                                    Modifier.width(shelfWidth)
                                        .clip(RoundedCornerShape(16.dp))
                                        .laoTap { s.open(route) }
                                        .padding(vertical = 4.dp),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Box(
                                        Modifier.size(40.dp)
                                            .clip(RoundedCornerShape(14.dp))
                                            .background(
                                                Brush.linearGradient(
                                                    listOf(
                                                        hue.copy(alpha = .15f),
                                                        hue.copy(alpha = .045f),
                                                    )
                                                )
                                            ),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        Icon(
                                            routeIcon(route),
                                            null,
                                            Modifier.size(23.dp),
                                            tint = hue,
                                        )
                                    }
                                    Text(
                                        CampusToolbox.name(route),
                                        style = LaoType.label,
                                        maxLines = 2,
                                        textAlign = TextAlign.Center,
                                        color = c.onSurface,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        animatedItem(3, "tools3-categories") {
            if (query.isBlank()) {
                val categories =
                    listOf("全部", "学习", "规划", "生活", "手机", "更多") +
                        if (recent.isNotEmpty()) listOf("最近") else emptyList()
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(categories, key = { it }) { label ->
                        val count =
                            if (label == "全部") catalog.size
                            else if (label == "最近") recent.size
                            else catalog.count { it[3] == label }
                        val on = label == category
                        Row(
                            Modifier.heightIn(min = 44.dp)
                                .clip(CircleShape)
                                .background(if (on) c.onSurface else c.surface.copy(alpha = .6f))
                                .border(
                                    1.dp,
                                    if (on) Color.Transparent
                                    else c.outlineVariant.copy(alpha = .5f),
                                    CircleShape,
                                )
                                .laoTap(role = Role.Tab) { category = label }
                                .semantics {
                                    selected = on
                                    contentDescription = "工具分类" + label
                                }
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                label,
                                style = LaoType.caption,
                                color = if (on) c.surface else c.onSurfaceVariant,
                            )
                            Text(
                                count.toString(),
                                style = LaoType.label.copy(fontFamily = LaoDisplayFont),
                                color =
                                    if (on) c.surface.copy(alpha = .55f)
                                    else c.onSurfaceVariant.copy(alpha = .6f),
                            )
                        }
                    }
                }
            } else Text("找到 ${shown.size} 个工具", style = LaoType.caption, color = c.onSurfaceVariant)
        }
        shown.chunked(2).forEachIndexed { index, pair ->
            animatedItem(index + 4, "tools3-pair-" + pair.joinToString { it[0] }) {
                Row(
                    Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    pair.forEach { info ->
                        ToolStudioCard(s, info, Modifier.weight(1f).fillMaxHeight())
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        if (shown.isEmpty())
            animatedItem(4, "tools3-empty") {
                LaoEmpty(
                    "暂时没有找到",
                    if (category == "最近" && query.isBlank()) "打开的工具会自动出现在这里。"
                    else "换个关键词，例如课程、复习或记账。",
                    if (query.isNotBlank()) "清空搜索" else "全部工具",
                ) {
                    query = ""
                    category = "全部"
                }
            }
    }
}

@Composable
private fun ToolStudioCard(s: CampusSession, info: Array<String>, modifier: Modifier) {
    val c = MaterialTheme.colorScheme
    val hue = toolHue(info[0], info[3])
    val state = toolState(s, info[0])
    Column(
        modifier
            .clip(RoundedCornerShape(24.dp))
            .background(
                Brush.linearGradient(
                    listOf(
                        c.surface.copy(alpha = .95f),
                        lerp(c.surface, hue, .04f).copy(alpha = .8f),
                    )
                )
            )
            .border(1.dp, c.outlineVariant.copy(alpha = .45f), RoundedCornerShape(24.dp))
            .laoTap { s.open(info[0]) }
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier.size(36.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(hue.copy(alpha = .1f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(routeIcon(info[0]), null, Modifier.size(22.dp), tint = hue)
            }
            Spacer(Modifier.weight(1f))
            Text(info[3], style = LaoType.label, color = c.onSurfaceVariant.copy(alpha = .7f))
        }
        Text(
            CampusToolbox.name(info[0]),
            style = LaoType.cell,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Text(
            info[2],
            style =
                LaoType.label.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Normal),
            color = c.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.weight(1f))
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (state.isNotBlank())
                Text(
                    state,
                    Modifier.weight(1f),
                    style = LaoType.label,
                    color = hue,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            else Spacer(Modifier.weight(1f))
            Icon(Icons.Rounded.NorthEast, null, Modifier.size(16.dp), tint = hue)
        }
    }
}
