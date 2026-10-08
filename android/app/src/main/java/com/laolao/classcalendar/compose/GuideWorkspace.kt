package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.unit.*

@Composable
internal fun GuidePage(s: CampusSession) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        GuideWorkspace(s, Modifier.weight(1f))
    }
}

@Composable
internal fun ColumnScope.GuideWorkspace(s: CampusSession, modifier: Modifier = Modifier) {
    var query by remember { mutableStateOf("") }
    var question by remember { mutableStateOf("") }
    var reply by remember { mutableStateOf<CampusGuide.Reply?>(null) }
    val a = s.a
    val ranked = CampusGuide.ranked(a).take(3)
    fun ask(text: String) {
        if (text.isNotBlank()) {
            question = text
            reply = CampusGuide.answer(a, text)
            query = ""
        }
    }
    LazyColumn(
        modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        contentPadding = PaddingValues(bottom = 8.dp),
    ) {
        item {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                LaoMascot(Modifier.size(64.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("捞捞一直在这儿", style = MaterialTheme.typography.titleLarge)
                    Text(
                        "读你的真实课表和记录，帮你理清安排。",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        if (ranked.isNotEmpty())
            item {
                PremiumCard(Modifier.fillMaxWidth()) {
                    Text("先做哪件？", style = MaterialTheme.typography.titleMedium)
                    ranked.forEach { entry ->
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Column(
                                Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(entry.title, style = MaterialTheme.typography.titleSmall)
                                Text(
                                    entry.reason,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (!entry.course)
                                LaoSelection(
                                    false,
                                    onCheckedChange = { a.mark(CampusJson.copy(entry.source)) },
                                )
                            else
                                TextButton(
                                    onClick = {
                                        s.closeSheet()
                                        s.open("courses")
                                    }
                                ) {
                                    Text("查看")
                                }
                        }
                    }
                }
            }
        item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("最急的是什么" to "今天有什么课", "这周的作业" to "明天有什么安排", "下节课在哪" to "我今天打卡了吗").forEach {
                    pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SoftButton(pair.first, Modifier.weight(1f)) { ask(pair.first) }
                        SoftButton(pair.second, Modifier.weight(1f)) { ask(pair.second) }
                    }
                }
            }
        }
        if (reply != null) {
            item {
                PremiumCard(
                    Modifier.fillMaxWidth(),
                    tint = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Text(question, style = MaterialTheme.typography.labelLarge)
                    Text(reply!!.text, style = MaterialTheme.typography.bodyLarge)
                    reply!!.entries.forEach { entry ->
                        TextButton(
                            onClick = {
                                s.closeSheet()
                                if (entry.course) s.open("courses")
                                else CampusSchool.detail(a, entry.source)
                            }
                        ) {
                            Text(entry.title)
                        }
                    }
                }
            }
        }
        item {
            SoftButton("粘贴消息，整理到日历", Modifier.fillMaxWidth()) {
                s.closeSheet()
                CampusSocial.pasteImport(a)
            }
        }
    }
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        LaoInput(
            value = query,
            onValue = { query = it },
            label = "",
            modifier = Modifier.weight(1f),
            placeholder = "问捞捞：明天有什么课？",
        )
        FilledIconButton(
            onClick = { ask(query) },
            modifier = Modifier.size(48.dp),
            enabled = query.isNotBlank(),
        ) {
            Icon(Icons.AutoMirrored.Rounded.Send, "发送")
        }
    }
}
