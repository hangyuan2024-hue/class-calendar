package com.laolao.classcalendar

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import java.util.Locale
import kotlin.math.*
import org.json.JSONArray
import org.json.JSONObject

/** Real native tree editor. Documents and optimistic cloud versions use the website mm_* contract. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun CampusMindMapPage(s: CampusSession) {
    val a = s.a
    val owner = a.store.owner
    val colors = MaterialTheme.colorScheme
    var document by rememberSaveable(owner) { mutableStateOf("") }
    var selected by rememberSaveable(owner) { mutableStateOf("") }
    var query by rememberSaveable(owner) { mutableStateOf("") }
    val undo = remember(owner) { mutableStateListOf<String>() }
    val redo = remember(owner) { mutableStateListOf<String>() }
    val status = CampusMindMap.status(a)
    val map = remember(document) { if (document.isBlank()) null else JSONObject(document) }
    val root = map?.optJSONObject("root") ?: JSONObject()
    val active = map?.let { MindMapDocument.find(root, selected) ?: root }

    fun load(value: JSONObject) {
        document = value.toString()
        selected = value.optJSONObject("root")?.optString("id").orEmpty()
        undo.clear()
        redo.clear()
    }
    fun change(block: (JSONObject) -> Unit) {
        if (document.isEmpty()) return
        s.invoke {
            val before = document
            val next = JSONObject(before)
            block(next)
            val normalized = MindMapDocument.normalize(next, false)
            CampusMindMap.save(a, normalized)
            if (before != normalized.toString()) {
                undo.add(before)
                if (undo.size > 24) undo.removeAt(0)
                redo.clear()
            }
            document = normalized.toString()
            if (MindMapDocument.find(normalized.optJSONObject("root"), selected) == null)
                selected = normalized.getJSONObject("root").optString("id")
        }
    }
    fun create() {
        val labels = arrayOf("空白导图", "课程复习", "考试准备", "问题分析", "读书笔记", "项目计划")
        val ids = arrayOf("blank", "course", "exam", "question", "book", "project")
        a.ui.choose("从一个主题开始", labels) { i ->
            s.invoke { load(CampusMindMap.create(a, MindMapDocument.newMap(ids[i], ""))) }
        }
    }
    fun editNode(id: String? = null) {
        val node = (id?.let { MindMapDocument.find(root, it) } ?: active) ?: return
        val nodeId = node.optString("id")
        a.ui.form("编辑主题", CampusJson.copy(node), { value ->
            change { next ->
                val target = MindMapDocument.find(next.optJSONObject("root"), nodeId)
                    ?: throw IllegalArgumentException("这个主题已不存在")
                val text = value.optString("text").trim()
                require(text.isNotEmpty()) { "请写下主题名称" }
                val link = value.optString("link").trim()
                require(link.isEmpty() || MindMapDocument.safeUrl(link).isNotEmpty()) { "请填写有效的 http 或 https 链接" }
                listOf("text", "note", "link", "bold", "progress").forEach { CampusJson.put(target, it, value.opt(it)) }
                if (nodeId == next.getJSONObject("root").optString("id")) CampusJson.put(next, "title", text.take(80))
            }
        }, CampusUi.f("text", "主题"), CampusUi.Field("note", "笔记", "multiline", false),
            CampusUi.optional("link", "参考链接（可留空）"), CampusUi.Field("progress", "进度 0–100", "number", false),
            CampusUi.Field("bold", "加粗这个主题", "boolean", false))
    }
    fun addChild() {
        val node = active ?: return
        val parentId = node.optString("id")
        a.ui.form("添加子主题", CampusJson.obj("text", ""), { value ->
            change { next -> selected = MindMapDocument.addChild(next, parentId, value.optString("text")) }
        }, CampusUi.f("text", "子主题名称"))
    }
    fun export() {
        val current = map ?: return
        val filename = current.optString("title", "捞捞导图").replace(Regex("[\\/:*?\"<>|]"), "_").take(60)
        a.ui.choose("带走这张导图", arrayOf("JSON 备份（可在网页导入）", "Markdown 文档", "缩进文字", "复制 Markdown")) { option ->
            when (option) {
                0 -> a.export("$filename.json", current.toString(2), "application/json")
                1 -> a.export("$filename.md", MindMapDocument.toMarkdown(current.optJSONObject("root")), "text/markdown")
                2 -> a.export("$filename.txt", MindMapDocument.toText(current.optJSONObject("root")), "text/plain")
                else -> {
                    (a.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
                        .setPrimaryClip(ClipData.newPlainText("捞捞思维导图", MindMapDocument.toMarkdown(current.optJSONObject("root"))))
                    a.toast("Markdown 已复制")
                }
            }
        }
    }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) CampusMindMap.importFile(a, uri) { load(it) }
    }
    fun paste() {
        val clip = (a.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).primaryClip
        val text = if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(a).toString() else ""
        a.ui.form("粘贴文字生成导图", CampusJson.obj("text", text), { value ->
            s.invoke { load(CampusMindMap.create(a, MindMapDocument.parseText(value.optString("text")))) }
        }, CampusUi.Field("text", "Markdown、缩进文字或 AI 整理结果", "multiline", true))
    }
    fun leave() { CampusMindMap.onLeave(a); document = ""; selected = ""; undo.clear(); redo.clear() }
    DisposableEffect(document.isNotBlank()) {
        val back: () -> Boolean = { if (document.isNotBlank()) { leave(); true } else false }
        s.pageBack = back
        onDispose { if (s.pageBack === back) s.pageBack = null }
    }
    DisposableEffect(owner) { onDispose { CampusMindMap.onLeave(a) } }
    LaunchedEffect(owner) { CampusMindMap.refresh(a, false) }
    LaunchedEffect(s.revision, map?.optString("id")) {
        val current = map ?: return@LaunchedEffect
        val stored = CampusMindMap.localMap(a, current.optString("id"))
        if (stored.optJSONObject("root") != null && stored.toString() != document) document = stored.toString()
    }

    LaoPage(spacing = 16.dp) {
        animatedItem(0, "mindmap-heading") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (map != null) LaoIconButton(Icons.AutoMirrored.Rounded.ArrowBack, "返回导图列表") { leave() }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    LaoEyebrow(if (map == null) "知识，连成一张图" else "${MindMapDocument.count(root)} 个主题 · 自动保存")
                    Text(map?.optString("title") ?: "捞捞思维导图", style = LaoType.headline, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                LaoIconButton(Icons.Rounded.Sync, "同步思维导图") { CampusMindMap.refresh(a, true) }
            }
            if (status.busy) LinearProgressIndicator(Modifier.fillMaxWidth(), color = colors.primary)
            Text(status.error.ifBlank { status.message.ifBlank { "可以离线编辑；登录后与网页同步。" } },
                style = LaoType.caption, color = if (status.error.isBlank()) colors.onSurfaceVariant else colors.error)
            if (status.error.isNotBlank()) LaoSecondaryButton("重试同步") { CampusMindMap.refresh(a, true) }
        }
        if (map == null) {
            animatedItem(1, "mindmap-create") {
                LaoPanel(Modifier.fillMaxWidth(), color = colors.primaryContainer, padding = 24.dp) {
                    Icon(Icons.Rounded.AccountTree, null, Modifier.size(36.dp), tint = colors.primary)
                    Text("让思路，有迹可循。", style = LaoType.title)
                    Text("复习一门课，拆解一道题，或记录一个好想法。用指尖整理，内容始终保存在本机。", style = LaoType.body, color = colors.onSurfaceVariant)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        LaoPrimaryButton("新建导图", Modifier.weight(1f)) { create() }
                        LaoSecondaryButton("粘贴生成", Modifier.weight(1f)) { paste() }
                    }
                    LaoSecondaryButton("从文件导入", Modifier.fillMaxWidth()) {
                        importer.launch(arrayOf("application/json", "text/*", "application/octet-stream"))
                    }
                }
            }
            animatedItem(2, "mindmap-search") {
                LaoInput(query, { query = it }, "", Modifier.fillMaxWidth(), "搜索我的导图", Icons.Rounded.Search)
            }
            val entries = CampusJson.rows(CampusMindMap.index(a)).filter { !it.optBoolean("deleted") && it.optString("title").contains(query.trim(), true) }
                .sortedByDescending { it.optLong("updated") }
            if (entries.isEmpty()) animatedItem(3, "mindmap-empty") {
                LaoEmpty(if (query.isEmpty()) "你的第一张知识图，等你来画" else "没有找到这张导图",
                    if (query.isEmpty()) "支持六种起步模板，也可以从网页的 JSON 备份导入。" else "换个词试试，或清空搜索。",
                    if (query.isEmpty()) "新建导图" else "清空搜索") { if (query.isEmpty()) create() else query = "" }
            }
            entries.forEachIndexed { index, entry -> animatedItem(index + 3, "mindmap-" + entry.optString("id")) {
                LaoPanel(Modifier.fillMaxWidth(), onClick = { CampusMindMap.open(a, entry.optString("id")) { load(it) } }) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Icon(Icons.Rounded.Hub, null, Modifier.size(28.dp), tint = colors.primary)
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(entry.optString("title", "未命名导图"), style = LaoType.cell)
                            Text("${entry.optInt("nodes")} 个主题 · " + if (entry.optBoolean("dirty")) "本机已保存" else "已同步到账号", style = LaoType.caption, color = colors.onSurfaceVariant)
                        }
                        LaoIconButton(Icons.Rounded.MoreHoriz, "导图更多操作") {
                            a.ui.choose(entry.optString("title"), arrayOf("打开导图", "复制一份", "删除导图")) { action ->
                                when (action) {
                                    0 -> CampusMindMap.open(a, entry.optString("id")) { load(it) }
                                    1 -> CampusMindMap.open(a, entry.optString("id")) { value ->
                                        val copied = MindMapDocument.normalize(value, true)
                                        CampusJson.put(copied, "title", copied.optString("title").take(72) + "（副本）")
                                        load(CampusMindMap.create(a, copied))
                                    }
                                    else -> a.ui.confirm("删除导图？", "${entry.optString("title")}；需要保留时，请先导出备份。") { CampusMindMap.delete(a, entry.optString("id")) }
                                }
                            }
                        }
                    }
                }
            } }
        } else {
            animatedItem(1, "mindmap-toolbar") {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoSecondaryButton("添加分支") { addChild() }
                    LaoSecondaryButton("编辑主题") { editNode() }
                    LaoSecondaryButton("撤销") {
                        if (undo.isNotEmpty()) { redo.add(document); document = undo.removeAt(undo.lastIndex); CampusMindMap.save(a, JSONObject(document)) }
                        else a.toast("还没有可以撤销的操作")
                    }
                    LaoSecondaryButton("重做") {
                        if (redo.isNotEmpty()) { undo.add(document); document = redo.removeAt(redo.lastIndex); CampusMindMap.save(a, JSONObject(document)) }
                        else a.toast("还没有可以重做的操作")
                    }
                    LaoSecondaryButton("导出") { export() }
                }
            }
            animatedItem(2, "mindmap-options") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoSecondaryButton("布局") {
                        a.ui.choose("导图布局", arrayOf("左右思维图", "向右逻辑图", "向下组织图")) { i -> change { CampusJson.put(it, "layout", listOf("mind", "right", "down")[i]) } }
                    }
                    LaoSecondaryButton("连线") {
                        a.ui.choose("分支连线", arrayOf("柔和曲线", "折线", "直线")) { i -> change { CampusJson.put(it, "line", listOf("curve", "elbow", "straight")[i]) } }
                    }
                    LaoSecondaryButton("画布配色") {
                        a.ui.choose("导图画布", arrayOf("清爽", "暖纸", "夜空", "黑板")) { i -> change { CampusJson.put(it, "theme", listOf("fresh", "warm", "night", "board")[i]) } }
                    }
                }
            }
            animatedItem(3, "mindmap-canvas") {
                MindMapCanvas(map, selected, { selected = it }, { editNode(it) })
                Text("双指缩放，拖动画布；点选主题后编辑。下面的大纲也能逐条操作。", style = LaoType.caption, color = colors.onSurfaceVariant)
            }
            animatedItem(4, "mindmap-selected") {
                LaoPanel(Modifier.fillMaxWidth(), color = colors.primaryContainer) {
                    Text(active?.optString("text").orEmpty(), style = LaoType.cell)
                    if (!active?.optString("note").isNullOrBlank()) Text(active!!.optString("note"), style = LaoType.body)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LaoSecondaryButton("编辑") { editNode() }
                        LaoSecondaryButton(if (active?.optBoolean("fold") == true) "展开分支" else "收起分支") {
                            val id = active?.optString("id").orEmpty()
                            change { val n = MindMapDocument.find(it.optJSONObject("root"), id); CampusJson.put(n, "fold", !n.optBoolean("fold")) }
                        }
                        LaoSecondaryButton("移动") {
                            val id = active?.optString("id").orEmpty()
                            val descendants = MindMapDocument.find(root, id)
                            val targets = flattenMindMap(root).filter { MindMapDocument.find(descendants, it.node.optString("id")) == null }
                            if (id == root.optString("id")) a.toast("中心主题不能移动")
                            else a.ui.choose("移动到哪个主题下面", targets.map { it.node.optString("text") }.toTypedArray()) { i ->
                                change { MindMapDocument.move(it, id, targets[i].node.optString("id"), 9999) }
                            }
                        }
                        LaoSecondaryButton("标记") {
                            val id = active?.optString("id").orEmpty()
                            val keys = listOf("done", "star", "ask", "warn", "idea", "book", "heart", "p1", "p2", "p3")
                            a.ui.choose("给主题加一个标记", arrayOf("已掌握", "重点", "待提问", "注意", "灵感", "读书", "喜欢", "优先级 1", "优先级 2", "优先级 3", "清空标记")) { i ->
                                change { next ->
                                    val n = MindMapDocument.find(next.optJSONObject("root"), id)
                                    CampusJson.put(n, "marks", if (i == keys.size) JSONArray() else JSONArray().put(keys[i]))
                                }
                            }
                        }
                        if (active?.optString("id") != root.optString("id")) LaoSecondaryButton("删除分支") {
                            val id = active?.optString("id").orEmpty()
                            a.ui.confirm("删除这个分支？", "子主题会一起删除；也可以用撤销恢复。") { change { MindMapDocument.remove(it, id) } }
                        }
                    }
                }
            }
            animatedItem(5, "mindmap-outline-heading") { LaoSection("主题大纲", note = "每个主题都可点选，支持放大字体与屏幕阅读器") }
            flattenMindMap(root).forEachIndexed { index, line -> animatedItem(index + 6, "mindmap-node-" + line.node.optString("id")) {
                Row(
                    Modifier.fillMaxWidth().padding(start = (min(line.depth, 5) * 12).dp)
                        .clip(RoundedCornerShape(14.dp)).background(if (line.node.optString("id") == selected) colors.primaryContainer else colors.surface)
                        .laoTap(role = Role.Button) { selected = line.node.optString("id") }.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(if (line.node.optBoolean("fold")) Icons.Rounded.ChevronRight else Icons.Rounded.SubdirectoryArrowRight, null, Modifier.size(18.dp), tint = colors.primary)
                    Text(line.node.optString("text"), style = LaoType.body, modifier = Modifier.weight(1f))
                    val progress = line.node.optInt("progress", -1)
                    if (progress >= 0) Text("$progress%", style = LaoType.caption, color = colors.primary)
                }
            } }
        }
    }
}

private data class MindOutline(val node: JSONObject, val depth: Int)
private fun flattenMindMap(root: JSONObject): List<MindOutline> {
    val result = mutableListOf<MindOutline>()
    fun visit(n: JSONObject, depth: Int) {
        result.add(MindOutline(n, depth))
        if (!n.optBoolean("fold")) CampusJson.rows(n.opt("children")).forEach { visit(it, depth + 1) }
    }
    visit(root, 0)
    return result
}

private data class MindPosition(val node: JSONObject, val parent: String?, val x: Float, val y: Float, val branch: Int) {
    val id: String get() = node.optString("id")
    val rect: Rect get() = Rect(x - 88f, y - 30f, x + 88f, y + 30f)
}

/** Leaf-weighted layouts keep a subtree together and do not use fixed hardcoded demo positions. */
private fun mindPositions(map: JSONObject): List<MindPosition> {
    val root = map.getJSONObject("root")
    val result = mutableListOf<MindPosition>()
    fun kids(n: JSONObject) = if (n.optBoolean("fold")) emptyList() else CampusJson.rows(n.opt("children"))
    fun weight(n: JSONObject): Float = max(1f, kids(n).sumOf { weight(it).toDouble() }.toFloat())
    val layout = map.optString("layout")
    fun place(n: JSONObject, parent: String?, depth: Int, side: Int, start: Float, branch: Int) {
        val w = weight(n)
        val cross = (start + w / 2) * if (layout == "down") 204f else 84f
        val x = if (layout == "down") cross else depth * 216f * side
        val y = if (layout == "down") depth * 112f else cross
        result.add(MindPosition(n, parent, x, y, branch))
        var cursor = start
        kids(n).forEach { child ->
            place(child, n.optString("id"), depth + 1, side, cursor, branch)
            cursor += weight(child)
        }
    }
    val children = kids(root)
    if (layout != "mind") {
        place(root, null, 0, 1, 0f, 0)
    } else {
        val sides = children.mapIndexed { index, child ->
            when (child.optString("side")) { "l" -> -1; "r" -> 1; else -> if (index % 2 == 0) 1 else -1 }
        }
        val totals = listOf(-1, 1).associateWith { side -> children.indices.filter { sides[it] == side }.sumOf { weight(children[it]).toDouble() }.toFloat() }
        val largest = max(1f, totals.values.maxOrNull() ?: 1f)
        result.add(MindPosition(root, null, 0f, largest * 42f, 0))
        val cursors = totals.mapValues { (largest - it.value) / 2 }.toMutableMap()
        children.forEachIndexed { index, child ->
            val side = sides[index]
            place(child, root.optString("id"), 1, side, cursors[side] ?: 0f, index + 1)
            cursors[side] = (cursors[side] ?: 0f) + weight(child)
        }
    }
    return result
}

@Composable
private fun MindMapCanvas(map: JSONObject, selected: String, select: (String) -> Unit, edit: (String) -> Unit) {
    val positions = remember(map.toString()) { mindPositions(map) }
    val density = LocalDensity.current.density
    val theme = MaterialTheme.colorScheme
    val dark = map.optString("theme") in listOf("night", "board") || theme.background.luminance() < .3f
    val background = when (map.optString("theme")) {
        "warm" -> if (dark) Color(0xFF2E2727) else Color(0xFFFFF8EF)
        "night" -> Color(0xFF141E32)
        "board" -> Color(0xFF183632)
        else -> theme.surface
    }
    val ink = if (dark) Color(0xFFF1F3F9) else theme.onSurface
    val tones = listOf(theme.primary, Color(0xFF8571B4), Color(0xFFC4875E), Color(0xFF4A8D9D), Color(0xFF7E91B0))
    val measurer = rememberTextMeasurer()
    val labels = remember(positions, density, dark) {
        positions.associate { p ->
            val marks = CampusJson.arr(p.node.opt("marks"))
            val prefix = if (marks.length() > 0) when (marks.optString(0)) { "done" -> "✓ "; "star" -> "★ "; "ask" -> "? "; "warn" -> "! "; "idea" -> "✦ "; else -> "• " } else ""
            p.id to measurer.measure(AnnotatedString(prefix + p.node.optString("text")),
                style = TextStyle(color = ink, fontSize = 13.sp, fontWeight = if (p.node.optBoolean("bold") || p.parent == null) FontWeight.Bold else FontWeight.Medium),
                maxLines = 2, overflow = TextOverflow.Ellipsis,
                constraints = androidx.compose.ui.unit.Constraints(maxWidth = (148 * density).roundToInt()))
        }
    }
    var pan by remember(map.optString("id")) { mutableStateOf(Offset.Zero) }
    var zoom by remember(map.optString("id")) { mutableFloatStateOf(1f) }
    var reset by remember { mutableIntStateOf(0) }
    BoxWithConstraints(
        Modifier.fillMaxWidth().height(440.dp).clip(RoundedCornerShape(24.dp)).background(background)
            .border(1.dp, theme.outlineVariant, RoundedCornerShape(24.dp)),
    ) {
        val width = maxWidth.value * density
        val height = maxHeight.value * density
        LaunchedEffect(map.optString("id"), width, height, reset) {
            val left = positions.minOf { it.rect.left } * density
            val right = positions.maxOf { it.rect.right } * density
            val top = positions.minOf { it.rect.top } * density
            val bottom = positions.maxOf { it.rect.bottom } * density
            zoom = min(1f, min((width - 32 * density) / max(1f, right - left), (height - 64 * density) / max(1f, bottom - top))).coerceIn(.16f, 1f)
            pan = Offset(width / 2 - (left + right) / 2 * zoom, height / 2 - (top + bottom) / 2 * zoom)
        }
        Canvas(
            Modifier.fillMaxSize().semantics {
                contentDescription = "原生思维导图画布，${positions.size} 个可见主题；支持拖动和双指缩放。下方主题大纲提供可访问操作。"
            }.pointerInput(map.optString("id")) {
                detectTransformGestures { centroid, move, scale, _ ->
                    val next = (zoom * scale).coerceIn(.12f, 3f)
                    pan = centroid + (pan - centroid) * (next / zoom) + move
                    zoom = next
                }
            }.pointerInput(positions, selected) {
                detectTapGestures(
                    onTap = { point ->
                        val world = (point - pan) / (zoom * density)
                        positions.lastOrNull { it.rect.contains(world) }?.let { select(it.id) }
                    },
                    onDoubleTap = { point ->
                        val world = (point - pan) / (zoom * density)
                        positions.lastOrNull { it.rect.contains(world) }?.let { select(it.id); edit(it.id) }
                    },
                )
            },
        ) {
            val step = 24 * density
            var x = 0f
            while (x < size.width) {
                var y = 0f
                while (y < size.height) { drawCircle(ink.copy(alpha = .07f), density, Offset(x, y)); y += step }
                x += step
            }
            withTransform({ translate(pan.x, pan.y); scale(zoom, zoom, Offset.Zero) }) {
                val byId = positions.associateBy { it.id }
                positions.forEach { p ->
                    val parent = p.parent?.let { byId[it] } ?: return@forEach
                    val down = map.optString("layout") == "down"
                    val right = p.x >= parent.x
                    val start = if (down) Offset(parent.x * density, (parent.y + 30) * density) else Offset((parent.x + if (right) 88 else -88) * density, parent.y * density)
                    val end = if (down) Offset(p.x * density, (p.y - 30) * density) else Offset((p.x + if (right) -88 else 88) * density, p.y * density)
                    val path = Path().apply {
                        moveTo(start.x, start.y)
                        when (map.optString("line")) {
                            "straight" -> lineTo(end.x, end.y)
                            "elbow" -> if (down) { lineTo(start.x, (start.y + end.y) / 2); lineTo(end.x, (start.y + end.y) / 2); lineTo(end.x, end.y) }
                                else { lineTo((start.x + end.x) / 2, start.y); lineTo((start.x + end.x) / 2, end.y); lineTo(end.x, end.y) }
                            else -> if (down) cubicTo(start.x, (start.y + end.y) / 2, end.x, (start.y + end.y) / 2, end.x, end.y)
                                else cubicTo((start.x + end.x) / 2, start.y, (start.x + end.x) / 2, end.y, end.x, end.y)
                        }
                    }
                    drawPath(path, tones[p.branch % tones.size].copy(alpha = .5f), style = Stroke(2 * density))
                }
                positions.forEach { p ->
                    val rect = p.rect
                    val color = if (p.node.optString("color").matches(Regex("#[0-9a-fA-F]{6}"))) Color(android.graphics.Color.parseColor(p.node.optString("color"))) else tones[p.branch % tones.size]
                    val pos = Offset(rect.left * density, rect.top * density)
                    val size = Size(rect.width * density, rect.height * density)
                    drawRoundRect(if (p.parent == null) color.copy(alpha = if (dark) .3f else .18f) else background, pos, size, androidx.compose.ui.geometry.CornerRadius(14 * density))
                    drawRoundRect(if (selected == p.id) color else color.copy(alpha = .35f), pos, size,
                        androidx.compose.ui.geometry.CornerRadius(14 * density), style = Stroke((if (selected == p.id) 2.5f else 1f) * density))
                    if (zoom > .22f) labels[p.id]?.let { label -> drawText(label, topLeft = Offset(p.x * density - label.size.width / 2f, p.y * density - label.size.height / 2f)) }
                }
            }
        }
        Row(Modifier.align(Alignment.TopEnd).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            LaoIconButton(Icons.Rounded.CenterFocusStrong, "适应画布") { reset++ }
            LaoIconButton(Icons.Rounded.Add, "放大画布") { val center = Offset(width / 2, height / 2); val next = (zoom * 1.25f).coerceAtMost(3f); pan = center + (pan - center) * (next / zoom); zoom = next }
            LaoIconButton(Icons.Rounded.Remove, "缩小画布") { val center = Offset(width / 2, height / 2); val next = (zoom / 1.25f).coerceAtLeast(.12f); pan = center + (pan - center) * (next / zoom); zoom = next }
        }
    }
}
