package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.unit.*
import org.json.JSONObject

@Composable
internal fun ImportReviewPage(s: CampusSession) {
    val a = s.a
    val draft = a.store.list("draft_parsed")
    val records = rows(draft)
    val colors = MaterialTheme.colorScheme
    PageList {
        animatedItem(0) {
            SectionHeading("核对整理结果", note = "本地整理已完成。确认标题、类型和时间后再保存。", action = "编辑原消息") {
                CampusSocial.editImport(a)
            }
        }
        animatedItem(1) {
            PremiumCard(Modifier.fillMaxWidth(), tint = colors.primaryContainer) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Icon(Icons.Rounded.FactCheck, null, tint = colors.primary)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            "${records.count { it.optBoolean("on",true) }} / ${records.size} 项已选择",
                            style = MaterialTheme.typography.titleLarge,
                        )
                        val pending =
                            records.count {
                                it.optBoolean("need_confirm") ||
                                    it.optString("event_time").isBlank()
                            }
                        Text(
                            if (pending == 0) "逐条检查，保存后会出现在日历和事项中"
                            else "$pending 项时间待确认，可点“编辑结果”补充",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onPrimaryContainer,
                        )
                    }
                }
            }
        }
        records.forEachIndexed { index, record ->
            animatedItem(index + 2, "parsed-$index") {
                PremiumCard(Modifier.fillMaxWidth()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LaoSelection(
                            record.optBoolean("on", true),
                            onCheckedChange = { on ->
                                record.put("on", on)
                                a.store.set("draft_parsed", draft)
                                a.build()
                            },
                        )
                        Text(
                            record.optString("subject"),
                            Modifier.weight(1f),
                            style = MaterialTheme.typography.titleMedium,
                        )
                    }
                    Text(
                        record.optString("msg_type", "事项") +
                            " · " +
                            record.optString("event_time").ifBlank { "时间待确认" },
                        style = MaterialTheme.typography.labelMedium,
                        color = colors.primary,
                    )
                    if (record.optString("location").isNotBlank())
                        Text(
                            "地点 · ${record.optString("location")}",
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    if (record.optString("summary").isNotBlank())
                        Text(
                            record.optString("summary"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.onSurfaceVariant,
                        )
                    if (record.optString("prepare").isNotBlank())
                        Text(
                            "需要准备 · ${record.optString("prepare")}",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.onSurfaceVariant,
                        )
                    SoftButton("编辑结果", Modifier.fillMaxWidth()) { editParsed(s, index) }
                }
            }
        }
        if (records.isEmpty())
            animatedItem(2) {
                EmptyState("还没有待核对的内容", "从日历粘贴群消息，再逐条确认整理结果。", "粘贴导入") {
                    CampusSocial.pasteImport(a)
                }
            }
    }
}

@Composable
internal fun ImportReviewActions(s: CampusSession) {
    s.revision
    val selected = rows(s.a.store.list("draft_parsed")).count { it.optBoolean("on", true) }
    Row(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .navigationBarsPadding()
            .padding(horizontal = 24.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        PrimaryButton("保存到我的事项", Modifier.weight(1f), enabled = selected > 0) {
            CampusSocial.publishLocal(s.a, s.a.store.list("draft_parsed"), false)
        }
        PressIcon(Icons.Rounded.MoreHoriz, "审核更多操作") { CampusSocial.reviewMore(s.a) }
    }
}

private fun editParsed(s: CampusSession, index: Int) {
    val a = s.a
    val draft = a.store.list("draft_parsed")
    val record = draft.optJSONObject(index) ?: return
    val initial = JSONObject(record.toString())
    val at = record.optString("event_time")
    initial.put("date", CampusJson.date(at))
    initial.put("time", if (at.length >= 16) at.substring(11, 16) else "")
    a.ui.form(
        "编辑整理结果",
        initial,
        { value ->
            val date = value.optString("date")
            val time = value.optString("time")
            value.put(
                "event_time",
                date + if (date.isNotBlank() && time.isNotBlank()) " $time" else "",
            )
            value.put("need_confirm", date.isBlank())
            value.remove("date")
            value.remove("time")
            draft.put(index, value)
            a.store.set("draft_parsed", draft)
            a.build()
        },
        CampusUi.choice("msg_type", "类型", "作业", "考试", "活动", "通知", "其他"),
        CampusUi.f("subject", "标题"),
        CampusUi.f("summary", "摘要", "multiline"),
        CampusUi.Field("date", "日期", "date", false),
        CampusUi.Field("time", "时间", "time", false),
        CampusUi.optional("location", "地点"),
        CampusUi.optional("prepare", "需要准备"),
    )
}
