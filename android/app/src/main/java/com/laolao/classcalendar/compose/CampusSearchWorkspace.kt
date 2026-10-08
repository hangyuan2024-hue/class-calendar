package com.laolao.classcalendar

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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import org.json.JSONObject

private data class CampusSearchResult(
    val title: String,
    val note: String,
    val route: String,
    val item: JSONObject? = null,
    val course: Boolean = false,
)

@Composable
internal fun CampusSearchPage(s: CampusSession) {
    Column(
        Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        ProductIntro("找到你需要的", "课程、校园记录与工具，统一搜索。")
        SearchContent(s, false)
    }
}

@Composable
internal fun ColumnScope.SearchContent(s: CampusSession, sheet: Boolean = true) {
    var query by rememberSaveable { mutableStateOf(s.a.store.string("native_search", "")) }
    val c = MaterialTheme.colorScheme
    if (sheet) SheetHeading("搜索校园空间") { s.closeSheet() }
    LaoInput(
        query,
        { query = it },
        "",
        Modifier.fillMaxWidth(),
        placeholder = "课程、作业、工具…",
        leading = Icons.Rounded.Search,
        trailing = {
            if (query.isNotBlank()) LaoIconButton(Icons.Rounded.Close, "清空搜索") { query = "" }
        },
    )
    val results =
        if (query.isBlank()) emptyList()
        else {
            rows(s.a.store.list(CampusCourses.COURSES))
                .filter {
                    (it.optString("name") + it.optString("location") + it.optString("teacher"))
                        .contains(query, true)
                }
                .map {
                    CampusSearchResult(
                        it.optString("name"),
                        "课程 · ${it.optString("location")}",
                        "courses",
                        it,
                        true,
                    )
                } +
                visibleTasks(s.a)
                    .filter {
                        (taskTitle(it) + it.optString("summary") + it.optString("note")).contains(
                            query,
                            true,
                        )
                    }
                    .map {
                        CampusSearchResult(
                            taskTitle(it),
                            "${it.optString("msg_type", "事项")} · ${it.optString("event_time")}",
                            "homework",
                            it,
                        )
                    } +
                listOf(
                        "native_exams" to "countdown",
                        "native_wrong" to "wrongbook",
                        "native_cards" to "cards",
                        "native_ledger" to "ledger",
                    )
                    .flatMap { (key, route) ->
                        rows(s.a.store.list(key))
                            .filter { it.toString().contains(query, true) }
                            .map { record ->
                                CampusSearchResult(
                                    record.optString("title").ifBlank {
                                        record.optString("name").ifBlank {
                                            record.optString("subject").ifBlank {
                                                record.optString(
                                                    "question",
                                                    CampusToolbox.name(route),
                                                )
                                            }
                                        }
                                    },
                                    "${CampusToolbox.name(route)} · ${record.optString("date", record.optString("due"))}",
                                    route,
                                )
                            }
                    } +
                CampusToolbox.ITEMS.filter { (it[1] + it[2]).contains(query, true) }
                    .map { CampusSearchResult(it[1], "${it[3]} · ${it[2]}", it[0]) }
        }
    if (query.isBlank()) {
        Text("快捷打开", style = MaterialTheme.typography.titleMedium)
        CompactToolGrid(s, listOf("courses", "homework", "wrongbook", "growth", "pomo", "ledger"))
        Text(
            "输入名称，即可查询本机与已同步的班级记录。",
            style = MaterialTheme.typography.bodySmall,
            color = c.onSurfaceVariant,
        )
    } else
        LazyColumn(Modifier.weight(1f, false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                Text(
                    "${results.size} 个结果",
                    style = MaterialTheme.typography.labelMedium,
                    color = c.onSurfaceVariant,
                )
            }
            itemsIndexed(results) { _, result ->
                ProductSurface(
                    Modifier.fillMaxWidth(),
                    onClick = {
                        s.closeSheet()
                        s.a.store.set("native_search", query)
                        if (result.item == null) s.open(result.route)
                        else if (result.course) CampusCourses.detail(s.a, result.item)
                        else CampusSchool.detail(s.a, result.item)
                    },
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        IconTile(result.route, 40.dp)
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                result.title,
                                style = MaterialTheme.typography.titleMedium,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                result.note,
                                style = MaterialTheme.typography.bodySmall,
                                color = c.onSurfaceVariant,
                                maxLines = 2,
                            )
                        }
                        Icon(
                            Icons.Rounded.ChevronRight,
                            null,
                            Modifier.size(20.dp),
                            tint = c.onSurfaceVariant,
                        )
                    }
                }
            }
            if (results.isEmpty())
                item { ProductState("还没有找到匹配记录", "试试课程名称、作业关键词或工具名称。", Icons.Rounded.Search) }
        }
}

@Composable
internal fun ColumnScope.AlertsContent(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    SheetHeading("值得关注的安排") { s.closeSheet() }
    Text(
        "根据课程时间和待办截止时间整理。",
        style = MaterialTheme.typography.bodyMedium,
        color = c.onSurfaceVariant,
    )
    val entries = CampusGuide.ranked(s.a).take(12)
    LazyColumn(Modifier.weight(1f, false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        itemsIndexed(entries) { _, entry ->
            ProductSurface(
                Modifier.fillMaxWidth(),
                onClick = {
                    s.closeSheet()
                    if (entry.course) s.open("courses") else CampusSchool.detail(s.a, entry.source)
                },
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    IconTile(if (entry.course) "courses" else "homework", 40.dp)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            entry.title,
                            style = MaterialTheme.typography.titleMedium,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            entry.reason,
                            style = MaterialTheme.typography.bodySmall,
                            color = CampusStatus.warning(),
                        )
                    }
                }
            }
        }
        if (entries.isEmpty())
            item {
                ProductState("眼前没有紧急安排", "有新的课程和事项后，会在这里为你整理。", Icons.Rounded.NotificationsNone)
            }
    }
    SoftButton("手机提醒设置", Modifier.fillMaxWidth()) {
        s.closeSheet()
        s.open("reminders")
    }
}
