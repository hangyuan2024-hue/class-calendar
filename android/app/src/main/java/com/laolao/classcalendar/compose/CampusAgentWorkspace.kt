package com.laolao.classcalendar

import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.*
import java.util.Calendar
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import org.json.JSONArray
import org.json.JSONObject

private const val AgentHistory = "native_agent_chat_v1"

private fun campusRecordQuestion(question: String) =
    listOf(
            "规划",
            "复习",
            "工具",
            "课",
            "作业",
            "安排",
            "接下来",
            "待办",
            "成长",
            "打卡",
            "导入",
            "粘贴",
            "提醒",
            "重要",
            "你好",
            "你是谁",
            "累",
            "谢",
        )
        .any { question.contains(it) }

internal fun groundedReply(a: CampusActivity, question: String): JSONObject {
    val turn =
        JSONObject()
            .put("id", CampusJson.id())
            .put("question", question)
            .put("date", DateMath.today())
    if (question.contains("规划") || question.contains("复习")) {
        val courses = CampusCourses.onDay(a.store, DateMath.today())
        val now =
            Calendar.getInstance().let {
                it.get(Calendar.HOUR_OF_DAY) * 60 + it.get(Calendar.MINUTE)
            }
        val busy =
            courses.mapNotNull { course ->
                val start = AgentPlanner.minute(course.optString("t0"))
                val end = AgentPlanner.minute(course.optString("t1"))
                if (start == null || end == null) null else BusyInterval(start, end)
            }
        val ranked = CampusGuide.ranked(a).filter { !it.course }
        val targets =
            if (question.contains("复习")) {
                val wrong = rows(a.store.list("native_wrong")).filter { !it.optBoolean("mastered") }
                wrong
                    .take(3)
                    .map {
                        StudyTarget(
                            "复习 · ${it.optString("subject", "错题")} · ${it.optString("title")}"
                        )
                    }
                    .ifEmpty {
                        courses
                            .map { StudyTarget("复习 · ${it.optString("name")}") }
                            .distinctBy { it.title }
                    }
            } else
                ranked
                    .take(3)
                    .map { entry ->
                        StudyTarget(
                            entry.title,
                            if (entry.day == DateMath.today())
                                AgentPlanner.minute(entry.time) ?: 22 * 60
                            else 22 * 60,
                        )
                    }
                    .ifEmpty {
                        courses
                            .map { StudyTarget("整理 · ${it.optString("name")}课堂笔记") }
                            .distinctBy { it.title }
                    }
        val events =
            visibleTasks(a)
                .filter {
                    !a.done(it) &&
                        taskDate(it) == DateMath.today() &&
                        it.optString("msg_type") != "作业"
                }
                .mapNotNull {
                    AgentPlanner.minute(taskClock(it))?.let { time ->
                        BusyInterval(time, time + 30)
                    }
                }
        val blocks = AgentPlanner.plan(now, busy + events, targets)
        turn.put(
            "text",
            if (targets.isEmpty())
                "目前没有可用的${if (question.contains("复习")) "课程或错题" else "课程与待办"}记录。先导入课表或添加一项任务，我再帮你安排。"
            else if (blocks.isEmpty()) "今天剩下的时间里，没有找到能避开已记录安排的 25 分钟学习段。可以先休息，或调整日历后再规划。"
            else "我避开了已记录的课程与定时事项，为你留出 ${blocks.size} 个 25 分钟学习段。每段之间休息 5 分钟。先从第一段开始，确认后可以加入日历。",
        )
        turn.put(
            "blocks",
            JSONArray().apply {
                blocks.forEach {
                    put(
                        JSONObject()
                            .put("title", it.title)
                            .put("start", it.start)
                            .put("end", it.end)
                    )
                }
            },
        )
        turn.put("source", "基于你的课程、待办与错题记录")
        turn.put("action", if (targets.isEmpty()) "courses" else "pomo")
        return turn
    }
    if (question.contains("工具")) {
        turn.put("text", "想整理学习资料，可以打开错题本；需要保持节奏，可以用专注计时；想记录校园生活，可以用日记与记账。你选择的常用工具会保留在首页。")
        turn.put("action", "tools").put("source", "来自已安装的校园工具")
        return turn
    }
    val reply = CampusGuide.answer(a, question)
    turn.put("text", reply.text).put("action", reply.action).put("source", "基于你的校园记录")
    turn.put(
        "entries",
        JSONArray().apply {
            reply.entries.forEach { e ->
                put(
                    JSONObject()
                        .put("title", e.title)
                        .put("reason", e.reason)
                        .put("course", e.course)
                        .put("source", CampusJson.copy(e.source))
                )
            }
        },
    )
    return turn
}

internal fun addStudyBlock(s: CampusSession, turn: JSONObject, block: JSONObject) {
    val date = turn.optString("date", DateMath.today())
    val seed =
        CampusJson.obj(
            "id",
            CampusJson.id(),
            "subject",
            block.optString("title"),
            "msg_type",
            "个人",
            "event_time",
            "$date ${AgentPlanner.clock(block.optInt("start"))}",
            "done",
            false,
            "note",
            "学习建议：${AgentPlanner.clock(block.optInt("start"))}–${AgentPlanner.clock(block.optInt("end"))}，之后休息 5 分钟。",
        )
    CampusSchool.personalForm(s.a, seed)
    val form = s.sheet as? FormSheet ?: return
    s.sheet = FormSheet("加入日历", "保存安排", form.initial, form.fields, form.save)
}

@Composable
internal fun CampusAgentPage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    var query by rememberSaveable { mutableStateOf("") }
    var turns by
        remember(a.api.uid()) { mutableStateOf(rows(a.store.list(AgentHistory)).takeLast(20)) }
    var waiting by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf("") }
    var retryQuery by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    fun append(turn: JSONObject) {
        turns = (turns + turn).takeLast(20)
        a.store.set(AgentHistory, JSONArray().apply { turns.forEach { put(it) } })
    }
    fun remote(question: String) {
        val owner = a.api.uid()
        waiting = true
        failure = ""
        retryQuery = question
        scope.launch {
            try {
                val reply = withContext(Dispatchers.IO) { CampusSocial.requestAi(a, question) }
                if (owner == a.api.uid())
                    append(
                        JSONObject()
                            .put("id", CampusJson.id())
                            .put("question", question)
                            .put("text", reply)
                            .put("source", "来自你连接的 AI 服务")
                            .put("date", DateMath.today())
                    )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (e: Exception) {
                failure = e.message ?: "连接暂时未完成"
            } finally {
                waiting = false
            }
        }
    }
    fun ask(question: String, cloud: Boolean = false) {
        val prompt = question.trim()
        if (prompt.isEmpty() || waiting) return
        failure = ""
        val serviceConnected = a.store.`object`("native_ai_config").optString("url").isNotBlank()
        if (cloud || (serviceConnected && !campusRecordQuestion(prompt))) {
            if (a.store.`object`("native_ai_config").optString("url").isBlank()) {
                CampusSocial.aiSettings(a)
                return
            }
            s.sheet =
                ConfirmSheet("交给我的 AI 服务", "将问题和课程、待办摘要发送至你连接的服务。") {
                    query = ""
                    remote(prompt)
                }
        } else {
            query = ""
            append(groundedReply(a, prompt))
        }
    }
    LaunchedEffect(s.agentPrompt) {
        if (s.agentPrompt.isNotBlank()) {
            val prompt = s.agentPrompt
            s.agentPrompt = ""
            ask(prompt)
        }
    }
    LaunchedEffect(turns.size, waiting, failure) {
        if (turns.isNotEmpty() || waiting || failure.isNotBlank()) {
            val index =
                if (waiting || failure.isNotBlank()) (if (turns.isEmpty()) 2 else 3) + turns.size
                else 2 + turns.size
            snapshotFlow { list.layoutInfo.totalItemsCount }.first { it > index }
            list.animateScrollToItem(index)
        }
    }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            state = list,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item("agent-intro") {
                Column(
                    Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Box(
                        Modifier.size(104.dp)
                            .clip(CircleShape)
                            .background(
                                Brush.radialGradient(
                                    listOf(CampusStatus.ai().copy(alpha = .13f), Color.Transparent)
                                )
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        LaoMascot(Modifier.size(88.dp))
                    }
                    Text(
                        "校园生活，\n捞捞和你一起安排。",
                        style = MaterialTheme.typography.headlineSmall,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                    Text(
                        "查课程、排待办、安排复习。\n建议都从你的校园记录出发。",
                        style = MaterialTheme.typography.bodyMedium,
                        color = c.onSurfaceVariant,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                    StatusPill(
                        if (a.store.`object`("native_ai_config").optString("url").isBlank())
                            "校园记录助手"
                        else "校园记录 + 我的 AI 服务",
                        CampusStatus.ai(),
                        Icons.Rounded.AutoAwesome,
                    )
                }
            }
            item("agent-prompts") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf(
                            ("规划今天" to "帮我规划今天") to ("总结课程" to "总结今日课程"),
                            ("重要提醒" to "提醒我重要事项") to ("安排复习" to "帮我安排复习"),
                        )
                        .forEach { pair ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf(pair.first, pair.second).forEach { (label, prompt) ->
                                    ProductSurface(
                                        Modifier.weight(1f).semantics {
                                            contentDescription = prompt
                                        },
                                        color = lerp(c.surface, CampusStatus.ai(), .07f),
                                        onClick = { ask(prompt) },
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            Icon(
                                                Icons.Rounded.AutoAwesome,
                                                null,
                                                Modifier.size(16.dp),
                                                tint = CampusStatus.ai(),
                                            )
                                            Text(
                                                label,
                                                style = MaterialTheme.typography.titleSmall,
                                                color = CampusStatus.ai(),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                }
            }
            if (turns.isNotEmpty())
                item("conversation-heading") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "和捞捞聊聊",
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        TextButton(
                            onClick = {
                                s.sheet =
                                    ConfirmSheet("清空对话？", "只清空助手对话，课程与待办继续保留。") {
                                        turns = emptyList()
                                        a.store.set(AgentHistory, JSONArray())
                                    }
                            }
                        ) {
                            Text("清空")
                        }
                    }
                }
            itemsIndexed(turns, key = { _, t -> t.optString("id") }) { index, turn ->
                Entrance(index.coerceAtMost(4)) {
                    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            Surface(
                                shape = RoundedCornerShape(20.dp, 20.dp, 4.dp, 20.dp),
                                color = c.primaryContainer,
                            ) {
                                Text(
                                    turn.optString("question"),
                                    Modifier.padding(16.dp),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = c.onPrimaryContainer,
                                )
                            }
                        }
                        ProductSurface(Modifier.fillMaxWidth()) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Icon(
                                    Icons.Rounded.AutoAwesome,
                                    null,
                                    Modifier.size(18.dp),
                                    tint = CampusStatus.ai(),
                                )
                                Text("捞捞", style = MaterialTheme.typography.titleSmall)
                            }
                            androidx.compose.foundation.text.selection.SelectionContainer {
                                Text(
                                    turn.optString("text"),
                                    style = MaterialTheme.typography.bodyLarge,
                                )
                            }
                            Text(
                                turn.optString("source"),
                                style = MaterialTheme.typography.labelSmall,
                                color = c.onSurfaceVariant,
                            )
                            rows(turn.optJSONArray("blocks") ?: JSONArray()).forEach { block ->
                                Column(
                                    Modifier.fillMaxWidth()
                                        .clip(RoundedCornerShape(16.dp))
                                        .background(c.surfaceContainerLow)
                                        .padding(16.dp),
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Text(
                                        "${AgentPlanner.clock(block.optInt("start"))} — ${AgentPlanner.clock(block.optInt("end"))}",
                                        style = MaterialTheme.typography.labelLarge,
                                        color = c.primary,
                                    )
                                    Text(
                                        block.optString("title"),
                                        style = MaterialTheme.typography.titleMedium,
                                    )
                                    TextButton(
                                        onClick = { addStudyBlock(s, turn, block) },
                                        modifier = Modifier.align(Alignment.End),
                                    ) {
                                        Icon(Icons.Rounded.Add, null, Modifier.size(16.dp))
                                        Spacer(Modifier.width(8.dp))
                                        Text("加入日历")
                                    }
                                }
                            }
                            rows(turn.optJSONArray("entries") ?: JSONArray()).take(6).forEach { e ->
                                val source = e.optJSONObject("source") ?: JSONObject()
                                Row(
                                    Modifier.fillMaxWidth()
                                        .clickable {
                                            if (e.optBoolean("course")) {
                                                s.open("courses")
                                            } else CampusSchool.detail(a, source)
                                        }
                                        .padding(vertical = 8.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Icon(
                                        routeIcon(
                                            if (e.optBoolean("course")) "courses" else "homework"
                                        ),
                                        null,
                                        Modifier.size(20.dp),
                                        tint = c.primary,
                                    )
                                    Column(
                                        Modifier.weight(1f),
                                        verticalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        Text(
                                            e.optString("title"),
                                            style = MaterialTheme.typography.titleSmall,
                                        )
                                        Text(
                                            e.optString("reason"),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = c.onSurfaceVariant,
                                        )
                                    }
                                    Icon(Icons.Rounded.ChevronRight, null, Modifier.size(16.dp))
                                }
                            }
                            val action = turn.optString("action")
                            if (action.isNotBlank())
                                SoftButton(
                                    when (action) {
                                        "pomo" -> "开始一段专注"
                                        "courses" -> "打开课程表"
                                        "paste" -> "粘贴导入"
                                        "homework" -> "查看作业"
                                        "growth" -> "查看成长"
                                        "tools" -> "打开工具"
                                        else -> "查看日历"
                                    },
                                    Modifier.fillMaxWidth(),
                                ) {
                                    if (action == "paste") CampusSocial.pasteImport(a)
                                    else s.open(action)
                                }
                        }
                    }
                }
            }
            if (waiting) item("waiting") { LoadingLines("正在等待你的 AI 服务回复…") }
            if (failure.isNotBlank())
                item("failure") {
                    ProductState("这次连接没有完成", failure, Icons.Rounded.CloudOff, "重试", true) {
                        ask(retryQuery, true)
                    }
                }
            item("agent-settings") {
                TextButton(
                    onClick = { CampusSocial.aiSettings(a) },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Icon(Icons.Rounded.Tune, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(8.dp))
                    Text("连接 / 设置我的 AI 服务")
                }
            }
        }
        Surface(color = c.surface, tonalElevation = 0.dp, shadowElevation = 2.dp) {
            Column(
                Modifier.imePadding().padding(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    IconButton(onClick = { CampusSocial.pasteImport(a) }) {
                        Icon(Icons.Rounded.ContentPaste, "粘贴导入班群消息", tint = c.primary)
                    }
                    LaoInput(
                        query,
                        { query = it },
                        "",
                        Modifier.weight(1f),
                        placeholder = "问捞捞，今天怎么安排？",
                        singleLine = false,
                        maxLines = 3,
                        keyboard = KeyboardOptions(imeAction = ImeAction.Send),
                        actions = KeyboardActions(onSend = { ask(query) }),
                    )
                    FilledIconButton(
                        onClick = { ask(query) },
                        enabled = query.isNotBlank() && !waiting,
                        modifier = Modifier.size(48.dp),
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.Send, "发送")
                    }
                }
                if (
                    query.isNotBlank() &&
                        !waiting &&
                        campusRecordQuestion(query) &&
                        a.store.`object`("native_ai_config").optString("url").isNotBlank()
                )
                    TextButton(
                        onClick = { ask(query, true) },
                        enabled = query.isNotBlank() && !waiting,
                        modifier = Modifier.align(Alignment.End),
                    ) {
                        Text("交给我的 AI 服务")
                    }
            }
        }
    }
}
