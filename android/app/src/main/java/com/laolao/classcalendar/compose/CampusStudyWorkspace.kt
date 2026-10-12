package com.laolao.classcalendar

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject

private val StudyKinds = linkedMapOf("material" to "资料", "note" to "笔记", "assessment" to "考核", "mistake" to "错题", "tree" to "知识框架")

/** The course workspace uses the website's actual kn_* account APIs, not a web container. */
@Composable
internal fun CampusStudyPage(s: CampusSession) {
    val a = s.a
    s.revision
    val owner = a.store.owner
    val data = CampusStudy.state(a)
    val status = CampusStudy.status(a)
    val courses = CampusJson.rows(data.opt("courses"))
    var cid by rememberSaveable(owner) { mutableLongStateOf(0L) }
    var tab by rememberSaveable(owner) { mutableStateOf("material") }
    var query by rememberSaveable(owner) { mutableStateOf("") }
    var viewing by rememberSaveable(owner) { mutableLongStateOf(0L) }
    var editor by rememberSaveable(owner) { mutableStateOf(false) }
    var editing by rememberSaveable(owner) { mutableLongStateOf(0L) }
    var nodeFilter by rememberSaveable(owner) { mutableLongStateOf(0L) }
    val course = courses.firstOrNull { it.optLong("id") == cid }
    val items = CampusJson.rows(data.opt("items"))
    val nodes = CampusJson.rows(data.opt("nodes"))
    val selected = items.firstOrNull { it.optLong("id") == viewing }
    val editItem = items.firstOrNull { it.optLong("id") == editing }
    val c = MaterialTheme.colorScheme
    LaunchedEffect(owner) {
        val open = a.store.string("native_study_open", "").toLongOrNull()
        if (open != null) {
            viewing = open
            a.store.set("native_study_open", "")
        }
        CampusStudy.refresh(a, false)
        while (true) { delay(30000); CampusStudy.refresh(a, false) }
    }
    LaunchedEffect(viewing, data.toString()) {
        val item = items.firstOrNull { it.optLong("id") == viewing }
        if (item != null) { cid = item.optLong("course_id"); tab = item.optString("kind", "material") }
    }
    DisposableEffect(s, owner) {
        val back: () -> Boolean = {
            when {
                editor -> { editor = false; true }
                viewing != 0L -> { viewing = 0L; true }
                nodeFilter != 0L -> { nodeFilter = 0L; true }
                cid != 0L -> { cid = 0L; true }
                else -> false
            }
        }
        s.pageBack = back
        onDispose { if (s.pageBack === back) s.pageBack = null }
    }
    fun addResource() { editing = 0; editor = true; viewing = 0 }
    if (editor && course != null) {
        key(owner, cid, editing, tab) {
            StudyItemEditor(s, course, tab, editItem, nodes, data.optJSONArray("links") ?: JSONArray(), status.busy,
                onCancel = { editor = false }, onSaved = { editor = false; viewing = 0 })
        }
        return
    }
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "study-title") {
            LaoPageHeading(course?.optString("name") ?: "把学习，按课程收好。",
                if (course == null) "资料、笔记、考核与错题，用知识框架串成自己的复习路线。" else "${StudyKinds[tab]} · 账号资料与网页共用", "课内学习", Icons.Rounded.AutoStories)
        }
        if (!a.api.logged()) {
            animatedItem(1, "study-login") {
                LaoPanel(Modifier.fillMaxWidth()) {
                    Text("登录后，就能接着学", style = LaoType.title)
                    Text("课内学习与网页共用账号，换手机也能找到资料和笔记。", style = LaoType.body, color = c.onSurfaceVariant)
                    LaoPrimaryButton("登录我的账号", Modifier.fillMaxWidth()) { s.open("login") }
                }
            }
        } else {
            if (status.busy || status.error.isNotEmpty()) {
                animatedItem(1, "study-status") {
                    LaoPanel(Modifier.fillMaxWidth()) {
                        if (status.busy) {
                            LinearProgressIndicator(Modifier.fillMaxWidth())
                            Text(if (CampusStudy.cached(a)) "正在更新账号资料…" else "正在读取课内学习…", style = LaoType.caption)
                        }
                        if (status.error.isNotEmpty()) {
                            Text(status.error, style = LaoType.body, color = c.error)
                            LaoTextAction("重新读取") { CampusStudy.refresh(a, true) }
                        }
                    }
                }
            }
            if (cid == 0L || course == null) {
                animatedItem(2, "study-create") {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        LaoPrimaryButton("＋ 课程", Modifier.weight(1f), enabled = !status.busy) { studyCourseForm(s, null) }
                        LaoSecondaryButton("从课表加入", Modifier.weight(1f), enabled = !status.busy) {
                            val existing = courses.map { it.optString("name") }.toSet()
                            val names = CampusJson.rows(a.store.list(CampusCourses.COURSES)).map { it.optString("name").trim() }.filter { it.isNotEmpty() && it !in existing }.distinct()
                            if (names.isEmpty()) a.toast("课程表中的课程已经加入；也可以手动添加")
                            else CampusStudy.act(a, "kn_course_import", CampusJson.obj("p_names", JSONArray(names)), "已从课程表加入 ${names.size} 门课", null)
                        }
                    }
                }
                animatedItem(3, "study-search") { LaoInput(query, { query = it.take(60) }, "搜索课程", leading = Icons.Rounded.Search, placeholder = "课程名称") }
                val filtered = courses.filter { it.optString("name").contains(query.trim(), true) }.sortedByDescending { it.optBoolean("pinned") }
                if (filtered.isEmpty() && !status.busy) {
                    animatedItem(4, "study-empty") {
                        LaoEmpty(if (query.isBlank()) "还没有课程" else "没有找到这门课",
                            if (query.isBlank()) "从课程表一键加入，或手动创建你的第一门课。" else "试试其他课程名称。")
                    }
                }
                filtered.forEachIndexed { i, row ->
                    animatedItem(i + 5, "study-course-${row.optLong("id")}") {
                        val resources = items.filter { it.optLong("course_id") == row.optLong("id") }
                        LaoPanel(Modifier.fillMaxWidth(), onClick = { cid = row.optLong("id"); viewing = 0; nodeFilter = 0 }) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text((if (row.optBoolean("pinned")) "📌 " else "") + row.optString("name"), Modifier.weight(1f), style = LaoType.title)
                                LaoIconButton(Icons.Rounded.MoreHoriz, "课程更多操作") { studyCourseMenu(s, row) }
                            }
                            Text(StudyKinds.filterKeys { it != "tree" }.entries.joinToString("  ·  ") { (kind, name) -> "$name ${resources.count { it.optString("kind") == kind }}" }, style = LaoType.caption, color = c.onSurfaceVariant)
                            val upcoming = resources.filter { it.optString("kind") == "assessment" && CampusJson.date(it.optString("deadline")) >= DateMath.today() }.minByOrNull { it.optString("deadline") }
                            if (upcoming != null) LaoChip("${upcoming.optString("title")} · ${CampusJson.date(upcoming.optString("deadline"))}", c.primary)
                        }
                    }
                }
                animatedItem(filtered.size + 6, "study-storage") {
                    Text("附件已用 ${studySize(data.optLong("used"))} / 100 MB\n课内学习由合作队伍 courses_app 设计，使用捞捞课程表账号。", style = LaoType.label, color = c.onSurfaceVariant)
                }
            } else {
                animatedItem(2, "study-back") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LaoTextAction(if (viewing != 0L || nodeFilter != 0L) "‹ 返回课程" else "‹ 所有课程", Modifier.weight(1f)) {
                            if (viewing != 0L || nodeFilter != 0L) { viewing = 0; nodeFilter = 0 } else cid = 0
                        }
                        LaoIconButton(Icons.Rounded.MoreHoriz, "课程管理") { studyCourseMenu(s, course) }
                    }
                }
                if (selected != null) {
                    animatedItem(3, "study-detail") {
                        LaoPanel(Modifier.fillMaxWidth()) {
                            Text(selected.optString("title"), style = LaoType.title)
                            Text("${StudyKinds[selected.optString("kind")]} · ${course.optString("name")}", style = LaoType.caption, color = c.onSurfaceVariant)
                            val deadline = CampusJson.date(selected.optString("deadline"))
                            if (deadline.isNotBlank()) LaoChip("截止 $deadline", c.primary)
                            SelectionContainer { Text(selected.optString(if (selected.optString("kind") == "assessment") "requirement" else "content"), style = LaoType.body) }
                            val tags = studyTags(selected.optLong("id"), nodes, data.optJSONArray("links") ?: JSONArray())
                            if (tags.isNotEmpty()) Text(tags.joinToString(" · ") { it.optString("name") }, style = LaoType.caption, color = c.primary)
                            if (!selected.isNull("file_id") && selected.optString("file_id").isNotBlank()) {
                                Text("${selected.optString("file_name")} · ${studySize(selected.optLong("file_size"))}", style = LaoType.caption, color = c.onSurfaceVariant)
                                LaoSecondaryButton("打开 / 分享附件", Modifier.fillMaxWidth(), !status.busy) { CampusStudy.openFile(a, selected) }
                            }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                LaoSecondaryButton("删除", Modifier.weight(1f), !status.busy) {
                                    s.sheet = ConfirmSheet("删除这条内容？", "「${selected.optString("title")}」与附件会一起删除，无法恢复。") {
                                        CampusStudy.act(a, "kn_item_del", CampusJson.obj("p_id", selected.optLong("id")), "已删除", Runnable { viewing = 0 })
                                    }
                                }
                                LaoPrimaryButton("编辑", Modifier.weight(1f), !status.busy) { editing = selected.optLong("id"); tab = selected.optString("kind"); editor = true }
                            }
                        }
                    }
                } else {
                    animatedItem(3, "study-tabs") {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            items(StudyKinds.entries.toList(), key = { it.key }) { (id, name) ->
                                LaoSecondaryButton(if (id == tab) "● $name" else name) { tab = id; nodeFilter = 0 }
                            }
                        }
                    }
                    if (tab == "tree" && nodeFilter == 0L) {
                        animatedItem(4, "study-new-node") {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                LaoPrimaryButton("＋ 分类", Modifier.weight(1f), !status.busy) { studyNodeForm(s, cid, null, 0, "folder") }
                                LaoSecondaryButton("＋ 知识点", Modifier.weight(1f), !status.busy) { studyNodeForm(s, cid, null, 0, "knowledge") }
                            }
                        }
                        val tree = studyTree(nodes.filter { it.optLong("course_id") == cid })
                        tree.forEachIndexed { i, (node, depth) ->
                            animatedItem(i + 5, "study-node-${node.optLong("id")}") {
                                LaoPanel(Modifier.fillMaxWidth().padding(start = (depth.coerceAtMost(4) * 12).dp), onClick = { nodeFilter = node.optLong("id") }) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(if (node.optString("type") == "folder") Icons.Rounded.FolderOpen else Icons.Rounded.Lightbulb, null, tint = c.primary, modifier = Modifier.size(24.dp))
                                        Text(node.optString("name"), Modifier.weight(1f).padding(start = 12.dp), style = LaoType.cell)
                                        if (!node.optBoolean("is_system")) LaoIconButton(Icons.Rounded.MoreHoriz, "${node.optString("name")}管理") { studyNodeMenu(s, cid, node, nodes) }
                                    }
                                }
                            }
                        }
                        if (tree.isEmpty()) animatedItem(5, "study-tree-empty") { LaoEmpty("建起自己的知识框架", "先建章节分类，再添加知识点。资料与错题可以打上相同的标签。") }
                    } else {
                        val filtered = if (nodeFilter != 0L) studyItemsUnder(nodeFilter, cid, nodes, items, data.optJSONArray("links") ?: JSONArray())
                            else items.filter { it.optLong("course_id") == cid && it.optString("kind") == tab }.sortedBy { if (tab == "assessment") it.optString("deadline", "9999") else it.optString("created_at") }
                        animatedItem(4, "study-resource-actions") {
                            if (nodeFilter != 0L) LaoSection(nodes.firstOrNull { it.optLong("id") == nodeFilter }?.optString("name") ?: "关联内容", note = "分类及下级知识点关联的资料、笔记与错题")
                            else LaoPrimaryButton("＋ 添加${StudyKinds[tab]}", Modifier.fillMaxWidth(), !status.busy) { addResource() }
                        }
                        filtered.forEachIndexed { i, item ->
                            animatedItem(i + 5, "study-item-${item.optLong("id")}") {
                                LaoPanel(Modifier.fillMaxWidth(), onClick = { viewing = item.optLong("id") }) {
                                    Text(item.optString("title"), style = LaoType.cell)
                                    val summary = item.optString(if (item.optString("kind") == "assessment") "requirement" else "content")
                                    if (summary.isNotBlank()) Text(summary, maxLines = 3, overflow = TextOverflow.Ellipsis, style = LaoType.body, color = c.onSurfaceVariant)
                                    val day = CampusJson.date(item.optString("deadline"))
                                    Text(if (day.isNotBlank()) "截止 $day" else if (!item.isNull("file_id") && item.optString("file_id").isNotBlank()) "附件 · ${item.optString("file_name")}" else "手动整理 · ${StudyKinds[item.optString("kind")]}", style = LaoType.label, color = c.primary)
                                    val tags = studyTags(item.optLong("id"), nodes, data.optJSONArray("links") ?: JSONArray())
                                    if (tags.isNotEmpty()) Text(tags.joinToString(" · ") { it.optString("name") }, style = LaoType.label, color = c.onSurfaceVariant)
                                }
                            }
                        }
                        if (filtered.isEmpty()) animatedItem(5, "study-resource-empty") { LaoEmpty("这里还没有内容", if (nodeFilter != 0L) "给资料、笔记或错题打上这个知识点标签，就能在这里一起复习。" else "添加${StudyKinds[tab]}，支持文字、图片、PDF 与文档。") }
                    }
                }
            }
        }
    }
}

@Composable
private fun StudyItemEditor(s: CampusSession, course: JSONObject, kind: String, original: JSONObject?, nodes: List<JSONObject>, links: JSONArray, busy: Boolean, onCancel: () -> Unit, onSaved: () -> Unit) {
    val c = MaterialTheme.colorScheme
    var title by rememberSaveable { mutableStateOf(original?.optString("title").orEmpty()) }
    var content by rememberSaveable { mutableStateOf(original?.optString("content").orEmpty()) }
    var requirement by rememberSaveable { mutableStateOf(original?.optString("requirement").orEmpty()) }
    var deadline by rememberSaveable { mutableStateOf(CampusJson.date(original?.optString("deadline"))) }
    var source by rememberSaveable { mutableStateOf(original?.optString("source") ?: "自己整理") }
    var attachment by remember { mutableStateOf<Uri?>(null) }
    var tags by remember { mutableStateOf(studyTags(original?.optLong("id") ?: 0, nodes, links).map { it.optLong("id") }.toSet()) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        attachment = uri
        if (uri != null && title.isBlank()) title = CampusStudy.fileName(s.a, uri).take(120)
    }
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "study-editor-title") { LaoPageHeading(if (original == null) "添加${StudyKinds[kind]}" else "编辑${StudyKinds[kind]}", course.optString("name"), "课内学习", Icons.Rounded.EditNote) }
        animatedItem(1, "study-editor-name") { LaoInput(title, { title = it.take(120) }, "名称", placeholder = "给这条学习内容起个名字") }
        if (kind == "assessment") {
            animatedItem(2, "study-editor-date") { LaoInput(deadline, { deadline = it.take(10) }, "截止日期（可选）", placeholder = "2026-10-11", leading = Icons.Rounded.Event) }
            animatedItem(3, "study-editor-requirement") { LaoInput(requirement, { requirement = it.take(4000) }, "考核要求", singleLine = false, minLines = 4, maxLines = 12, placeholder = "范围、形式、需要准备什么…") }
        } else {
            animatedItem(2, "study-editor-content") { LaoInput(content, { content = it.take(20000) }, if (kind == "mistake") "题目与正确思路" else "内容", singleLine = false, minLines = 6, maxLines = 20, placeholder = "可以直接整理文字，或选择图片与文档附件") }
        }
        if (kind == "note") animatedItem(4, "study-editor-source") { LaoInput(source, { source = it.take(40) }, "来源", placeholder = "课堂笔记、自己整理、同学分享") }
        animatedItem(5, "study-editor-file") {
            LaoPanel(Modifier.fillMaxWidth()) {
                Text(attachment?.let { CampusStudy.fileName(s.a, it) } ?: original?.optString("file_name").orEmpty().ifEmpty { "图片、PDF、文档，最多 5 MB" }, style = LaoType.caption, color = c.onSurfaceVariant)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoSecondaryButton(if (attachment == null) "选择附件" else "重新选择", Modifier.weight(1f), !busy) { picker.launch(arrayOf("*/*")) }
                    if (attachment != null) LaoTextAction("取消选择") { attachment = null }
                }
            }
        }
        if (kind != "assessment") {
            animatedItem(6, "study-editor-tags") {
                LaoSection("知识点标签", note = "可以选择多个；之后按知识点一起复习。")
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val options = studyTree(nodes.filter { it.optLong("course_id") == course.optLong("id") && !it.optBoolean("is_system") })
                    if (options.isEmpty()) Text("这门课还没有知识框架，可先保存，再在「知识框架」中创建。", style = LaoType.caption, color = c.onSurfaceVariant)
                    options.forEach { (node, depth) ->
                        Row(Modifier.fillMaxWidth().padding(start = (depth.coerceAtMost(4) * 12).dp), verticalAlignment = Alignment.CenterVertically) {
                            LaoSelection(node.optLong("id") in tags, { checked -> tags = if (checked) tags + node.optLong("id") else tags - node.optLong("id") })
                            Text(node.optString("name"), Modifier.weight(1f).padding(start = 8.dp), style = LaoType.body)
                        }
                    }
                }
            }
        }
        animatedItem(7, "study-editor-save") {
            val error = CampusStudy.status(s.a).error
            if (error.isNotBlank()) Text(error, color = c.error, style = LaoType.caption)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LaoSecondaryButton("取消", Modifier.weight(1f), !busy, onCancel)
                LaoPrimaryButton(if (busy) "保存中…" else "保存", Modifier.weight(1f), !busy) {
                    if (title.trim().isBlank()) { s.a.toast("请填写名称"); return@LaoPrimaryButton }
                    if (kind != "assessment" && content.isBlank() && attachment == null && original?.optString("file_id").orEmpty().isBlank()) { s.a.toast("请填写内容或选择附件"); return@LaoPrimaryButton }
                    val p = CampusJson.obj("title", title.trim())
                    if (original == null) { CampusJson.put(p, "course_id", course.optLong("id")); CampusJson.put(p, "kind", kind) }
                    else CampusJson.put(p, "id", original.optLong("id"))
                    if (kind == "assessment") { CampusJson.put(p, "deadline", deadline.ifBlank { null }); CampusJson.put(p, "requirement", requirement) }
                    else { CampusJson.put(p, "content", content); CampusJson.put(p, "nodes", JSONArray(tags.toList())) }
                    if (kind == "note") CampusJson.put(p, "source", source.trim())
                    CampusStudy.saveItem(s.a, p, attachment, Runnable(onSaved))
                }
            }
        }
    }
}

private fun studyCourseForm(s: CampusSession, course: JSONObject?) {
    s.sheet = FormSheet(if (course == null) "添加课程" else "课程改名", "保存", CampusJson.obj("name", course?.optString("name") ?: ""), listOf(CampusUi.f("name", "课程名称"))) { v ->
        val name = v.optString("name").trim()
        require(name.isNotBlank() && name.length <= 60) { "课程名称请填写 1—60 字" }
        CampusStudy.act(s.a, "kn_course_save", CampusJson.obj("p_id", course?.optLong("id"), "p_name", name, "p_pinned", null), "已保存课程", null)
    }
}

private fun studyCourseMenu(s: CampusSession, course: JSONObject) {
    s.sheet = ChoiceSheet(course.optString("name"), listOf(if (course.optBoolean("pinned")) "取消置顶" else "置顶课程", "改名", "删除课程")) { at ->
        when (at) {
            0 -> CampusStudy.act(s.a, "kn_course_save", CampusJson.obj("p_id", course.optLong("id"), "p_name", null, "p_pinned", !course.optBoolean("pinned")), "已更新课程", null)
            1 -> studyCourseForm(s, course)
            2 -> s.sheet = ConfirmSheet("删除这门课程？", "里面的资料、笔记、考核、错题和附件会一起删除，无法恢复。") { CampusStudy.act(s.a, "kn_course_del", CampusJson.obj("p_id", course.optLong("id")), "已删除课程", null) }
        }
    }
}

private fun studyNodeForm(s: CampusSession, course: Long, original: JSONObject?, parent: Long, type: String) {
    s.sheet = FormSheet(if (original == null) if (type == "folder") "新建分类" else "新建知识点" else "修改名称", "保存", CampusJson.obj("name", original?.optString("name") ?: ""), listOf(CampusUi.f("name", "名称"))) { value ->
        val name = value.optString("name").trim()
        require(name.isNotBlank() && name.length <= 60) { "名称请填写 1—60 字" }
        if (original != null) CampusStudy.act(s.a, "kn_node_rename", CampusJson.obj("p_id", original.optLong("id"), "p_name", name), "已修改名称", null)
        else CampusStudy.act(s.a, "kn_node_add", CampusJson.obj("p_course", course, "p_parent", parent.takeIf { it != 0L }, "p_name", name, "p_type", type), "已加入知识框架", null)
    }
}

private fun studyNodeMenu(s: CampusSession, course: Long, node: JSONObject, all: List<JSONObject>) {
    val folder = node.optString("type") == "folder"
    val options = (if (folder) listOf("添加下级分类", "添加下级知识点") else emptyList()) + listOf("改名", "移动到分类", "上移", "下移", "删除")
    s.sheet = ChoiceSheet(node.optString("name"), options) { index ->
        when (options[index]) {
            "添加下级分类" -> studyNodeForm(s, course, null, node.optLong("id"), "folder")
            "添加下级知识点" -> studyNodeForm(s, course, null, node.optLong("id"), "knowledge")
            "改名" -> studyNodeForm(s, course, node, 0, "")
            "删除" -> s.sheet = ConfirmSheet("删除这个分类或知识点？", "下级分类会一起删除；资料、笔记与错题仍然保留，只移除标签。") { CampusStudy.act(s.a, "kn_node_del", CampusJson.obj("p_id", node.optLong("id")), "已删除知识点", null) }
            "移动到分类" -> {
                val bad = studyDescendants(node.optLong("id"), all)
                val targets = all.filter { it.optLong("course_id") == course && it.optString("type") == "folder" && !it.optBoolean("is_system") && it.optLong("id") !in bad }
                s.sheet = ChoiceSheet("移动到哪里", listOf("第一级") + targets.map { it.optString("name") }) { i ->
                    CampusStudy.act(s.a, "kn_node_move", CampusJson.obj("p_id", node.optLong("id"), "p_parent", if (i == 0) null else targets[i - 1].optLong("id"), "p_pos", null), "已移动", null)
                }
            }
            "上移", "下移" -> {
                val siblings = all.filter { it.optLong("course_id") == course && it.optLong("parent_id") == node.optLong("parent_id") && !it.optBoolean("is_system") }.sortedBy { it.optInt("sort_order") }
                val at = siblings.indexOfFirst { it.optLong("id") == node.optLong("id") }
                val next = at + if (options[index] == "上移") -1 else 1
                if (next in siblings.indices) CampusStudy.act(s.a, "kn_node_move", CampusJson.obj("p_id", node.optLong("id"), "p_parent", node.opt("parent_id"), "p_pos", next), "已调整顺序", null)
                else s.a.toast("已经在这个分类的${if (next < 0) "最前面" else "最后面"}")
            }
        }
    }
}

internal fun studyTree(nodes: List<JSONObject>): List<Pair<JSONObject, Int>> {
    val out = mutableListOf<Pair<JSONObject, Int>>()
    val seen = mutableSetOf<Long>()
    fun append(parent: Long, depth: Int) {
        if (depth > 80) return
        nodes.filter { it.optLong("parent_id") == parent }.sortedWith(compareByDescending<JSONObject> { it.optBoolean("is_system") }.thenBy { it.optInt("sort_order") }).forEach {
            if (seen.add(it.optLong("id"))) { out += it to depth; append(it.optLong("id"), depth + 1) }
        }
    }
    append(0, 0)
    nodes.filter { it.optLong("id") !in seen }.forEach { if (seen.add(it.optLong("id"))) out += it to 0 }
    return out
}

internal fun studyDescendants(id: Long, nodes: List<JSONObject>): Set<Long> {
    val out = mutableSetOf(id)
    var changed = true
    while (changed) { changed = false; nodes.forEach { if (it.optLong("parent_id") in out && out.add(it.optLong("id"))) changed = true } }
    return out
}

private fun studyTags(id: Long, nodes: List<JSONObject>, links: JSONArray): List<JSONObject> {
    val ids = (0 until links.length()).mapNotNull { links.optJSONArray(it) }.filter { it.optLong(0) == id }.map { it.optLong(1) }.toSet()
    return nodes.filter { it.optLong("id") in ids }
}

internal fun studyItemsUnder(id: Long, course: Long, nodes: List<JSONObject>, items: List<JSONObject>, links: JSONArray): List<JSONObject> {
    val pairs = (0 until links.length()).mapNotNull { links.optJSONArray(it) }
    val system = nodes.firstOrNull { it.optLong("id") == id }?.optBoolean("is_system") == true
    val ids = if (system) pairs.map { it.optLong(0) }.toSet() else {
        val descendants = studyDescendants(id, nodes)
        pairs.filter { it.optLong(1) in descendants }.map { it.optLong(0) }.toSet()
    }
    return items.filter { it.optLong("course_id") == course && it.optString("kind") != "assessment" && (if (system) it.optLong("id") !in ids else it.optLong("id") in ids) }
}

private fun studySize(bytes: Long): String = when { bytes >= 1024 * 1024 -> String.format(java.util.Locale.CHINA, "%.1f MB", bytes / 1048576.0); bytes >= 1024 -> "${bytes / 1024} KB"; else -> "$bytes B" }
