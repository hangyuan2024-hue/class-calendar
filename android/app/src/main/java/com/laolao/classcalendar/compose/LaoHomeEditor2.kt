package com.laolao.classcalendar

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import org.json.JSONArray
import org.json.JSONObject

private fun moduleRoute(id: String) =
    when (id) {
        "w:pins",
        "w:quick" -> "tools"
        "w:cal" -> "calendar"
        "w:hw" -> "homework"
        "w:habits" -> "growth"
        else -> CampusHome.route(id).ifBlank { "home" }
    }

private fun moduleNote(s: CampusSession, id: String) =
    when (id) {
        "w:cal" -> "课程与事项，按时间展开"
        "w:hw" -> "截止日期与实际完成进度"
        "w:pins" -> "自己选择的常用工具"
        "w:quick" -> "成长、班级和排行榜入口"
        "w:wall" -> "通知、讨论和同学动态"
        "w:habits" -> "每天的小目标和打卡"
        "w:rank" -> "和同学一起看见进步"
        "w:farm" -> s.a.store.`object`("farm_v1").optString("name", "小云朵") + "的成长"
        else -> CampusToolbox.description(moduleRoute(id))
    }

@Composable
@OptIn(ExperimentalLayoutApi::class)
internal fun ColumnScope.LaoHomeEditor(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    var selected by remember { mutableStateOf(laoHomeOrder(s.a)) }
    val latest by rememberUpdatedState(selected)
    var density by remember { mutableStateOf(s.a.store.string("native_home_density_v2", "rich")) }
    val positions = remember { mutableStateMapOf<String, Float>() }
    var dragged by remember { mutableStateOf<String?>(null) }
    var start by remember { mutableFloatStateOf(0f) }
    var distance by remember { mutableFloatStateOf(0f) }
    LaoSheetHeading("把首页，排成你的样子") { s.closeSheet() }
    LazyColumn(Modifier.weight(1f, false), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Column(
                Modifier.fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(LaoArt.soft())
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "实时预览",
                        Modifier.weight(1f),
                        style = LaoType.caption,
                        color = c.onSurfaceVariant,
                    )
                    LaoChip(if (density == "rich") "丰富" else "轻盈", c.secondary)
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(
                        Modifier.weight(1f)
                            .clip(RoundedCornerShape(16.dp))
                            .background(LaoArt.hero())
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("今日重点", style = LaoType.label, color = Color.White.copy(alpha = .75f))
                        Text(
                            CampusGuide.nextCourse(s.a)?.title ?: "课程与校园安排",
                            style = LaoType.caption,
                            color = Color.White,
                            maxLines = 2,
                            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                        )
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            LaoMascot(Modifier.size(24.dp), expressive = false)
                            Text("捞捞提醒", style = LaoType.label, color = Color.White.copy(alpha = .8f))
                        }
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        selected.take(3).forEach { id ->
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(
                                    routeIcon(moduleRoute(id)),
                                    null,
                                    Modifier.size(16.dp),
                                    tint = c.primary,
                                )
                                Text(
                                    productModuleName(id),
                                    style = LaoType.label,
                                    maxLines = 1,
                                    overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
                                )
                            }
                        }
                        if (selected.size > 3)
                            Text(
                                "还有 ${selected.size - 3} 个模块",
                                style = LaoType.label,
                                color = c.onSurfaceVariant,
                            )
                        if (selected.isEmpty())
                            Text("喜欢的模块，自己选择。", style = LaoType.caption, color = c.onSurfaceVariant)
                    }
                }
            }
        }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("你喜欢哪种节奏？", style = LaoType.cell)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("light" to "轻盈 · 少一点", "rich" to "丰富 · 看更多").forEach { (id, title) ->
                        Box(
                            Modifier.weight(1f)
                                .clip(CircleShape)
                                .background(
                                    if (density == id) c.primary.copy(alpha = .12f)
                                    else Color.Transparent
                                )
                                .border(
                                    1.dp,
                                    if (density == id) c.primary.copy(alpha = .3f)
                                    else c.outlineVariant,
                                    CircleShape,
                                )
                                .laoTap(role = Role.RadioButton) { density = id }
                                .semantics { this.selected = density == id }
                                .padding(horizontal = 8.dp, vertical = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                title,
                                style = LaoType.caption,
                                color = if (density == id) c.primary else c.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
        item { LaoSection("首页顺序", note = "按住右侧手柄拖动；点圆点可移除。") }
        items(selected, key = { it }) { id ->
            val moving = dragged == id
            Row(
                Modifier.fillMaxWidth()
                    .onGloballyPositioned { positions[id] = it.positionInRoot().y }
                    .then(
                        if (LocalMotionEnabled.current)
                            Modifier.animateItem(placementSpec = spring(.86f, 330f))
                        else Modifier
                    )
                    .zIndex(if (moving) 2f else 0f)
                    .graphicsLayer {
                        translationY =
                            if (moving) distance - ((positions[id] ?: start) - start) else 0f
                    }
                    .clip(RoundedCornerShape(20.dp))
                    .background(if (moving) c.primaryContainer else c.surface)
                    .border(
                        1.dp,
                        if (moving) c.primary.copy(alpha = .3f)
                        else c.outlineVariant.copy(alpha = .45f),
                        RoundedCornerShape(20.dp),
                    )
                    .padding(start = 12.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(routeIcon(moduleRoute(id)), null, Modifier.size(22.dp), tint = c.primary)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(productModuleName(id), style = LaoType.cell)
                    Text(
                        moduleNote(s, id),
                        style = LaoType.label,
                        color = c.onSurfaceVariant,
                        maxLines = 1,
                    )
                }
                LaoCheck(true, "显示 " + productModuleName(id)) {
                    selected = selected.filter { it != id }
                }
                Box(
                    Modifier.size(40.dp)
                        .pointerInput(id) {
                            detectDragGesturesAfterLongPress(
                                onDragStart = {
                                    dragged = id
                                    start = positions[id] ?: 0f
                                    distance = 0f
                                },
                                onDragEnd = {
                                    dragged = null
                                    distance = 0f
                                },
                                onDragCancel = {
                                    dragged = null
                                    distance = 0f
                                },
                                onDrag = { change, delta ->
                                    change.consume()
                                    distance += delta.y
                                    val target =
                                        latest
                                            .filter { it != id }
                                            .minByOrNull {
                                                kotlin.math.abs(
                                                    (positions[it] ?: Float.MAX_VALUE) -
                                                        (start + distance)
                                                )
                                            }
                                    if (
                                        target != null &&
                                            kotlin.math.abs(
                                                (positions[target] ?: Float.MAX_VALUE) -
                                                    (start + distance)
                                            ) < 44.dp.toPx()
                                    ) {
                                        val from = latest.indexOf(id)
                                        val to = latest.indexOf(target)
                                        if (from >= 0 && to >= 0)
                                            selected =
                                                latest.toMutableList().apply {
                                                    add(to, removeAt(from))
                                                }
                                    }
                                },
                            )
                        }
                        .semantics {
                            contentDescription = "拖动排序 " + productModuleName(id)
                            customActions =
                                listOf(
                                    CustomAccessibilityAction("向前移动") {
                                        val from = selected.indexOf(id)
                                        if (from > 0) {
                                            selected =
                                                selected.toMutableList().apply {
                                                    add(from - 1, removeAt(from))
                                                }
                                            true
                                        } else false
                                    },
                                    CustomAccessibilityAction("向后移动") {
                                        val from = selected.indexOf(id)
                                        if (from >= 0 && from < selected.lastIndex) {
                                            selected =
                                                selected.toMutableList().apply {
                                                    add(from + 1, removeAt(from))
                                                }
                                            true
                                        } else false
                                    },
                                )
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Canvas(Modifier.size(16.dp)) {
                        for (x in listOf(.3f, .7f)) for (y in listOf(.2f, .5f, .8f)) drawCircle(
                            c.onSurfaceVariant.copy(alpha = .6f),
                            1.4.dp.toPx(),
                            Offset(size.width * x, size.height * y),
                        )
                    }
                }
            }
        }
        item { LaoSection("再加一点喜欢的", note = "随时可以添加，也可以留白。") }
        item {
            FlowRow(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                ProductHomeModules.filterNot { it in selected }
                    .forEach { id ->
                        LaoSecondaryButton("＋ " + productModuleName(id)) {
                            selected = selected + id
                        }
                    }
            }
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(top = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LaoSecondaryButton("取消", Modifier.weight(1f)) { s.closeSheet() }
        LaoPrimaryButton("保存主页", Modifier.weight(2f)) {
            val config = JSONObject(s.a.store.`object`("native_compose_home_v1").toString())
            config.put(
                "home",
                JSONArray().apply {
                    selected.forEach { put(CampusJson.obj("id", it, "w", 4, "h", 1)) }
                },
            )
            s.a.store.set("native_compose_home_v1", config)
            s.a.store.set("native_home_density_v2", density)
            s.closeSheet()
            s.a.build()
            s.notice = "校园主页已更新"
        }
    }
}

@Composable
internal fun LaoToggle(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val c = MaterialTheme.colorScheme
    val progress by
        animateFloatAsState(
            if (checked) 1f else 0f,
            if (LocalMotionEnabled.current) spring(.85f, 420f) else snap(),
            label = "switch thumb",
        )
    Box(
        modifier
            .size(width = 52.dp, height = 48.dp)
            .alpha(if (enabled) 1f else .45f)
            .toggleable(checked, enabled = enabled && onCheckedChange != null, role = Role.Switch) {
                onCheckedChange?.invoke(it)
            }
            .semantics { contentDescription = if (checked) "已开启" else "已关闭" },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(width = 48.dp, height = 28.dp)) {
            drawRoundRect(
                lerp(c.outlineVariant, c.primary, progress),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(size.height / 2),
            )
            drawCircle(
                Color.Black.copy(alpha = .08f),
                10.dp.toPx(),
                Offset(14.dp.toPx() + 20.dp.toPx() * progress, size.height / 2 + 1.dp.toPx()),
            )
            drawCircle(
                Color.White,
                10.dp.toPx(),
                Offset(14.dp.toPx() + 20.dp.toPx() * progress, size.height / 2),
            )
        }
    }
}
