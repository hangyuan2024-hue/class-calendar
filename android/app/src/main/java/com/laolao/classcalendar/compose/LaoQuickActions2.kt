package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.*

private data class LaoOperation(
    val title: String,
    val note: String,
    val icon: ImageVector,
    val action: () -> Unit,
)

@Composable
internal fun ColumnScope.LaoQuickActions(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val operations =
        mutableListOf(
            LaoOperation("记一件事", "日程、作业与待办", Icons.Rounded.EditNote) {
                s.a.selectedDay = DateMath.today()
                CampusSchool.personalForm(s.a, null)
            },
            LaoOperation("粘贴导入", "整理班群消息", Icons.Rounded.ContentPaste) {
                CampusSocial.pasteImport(s.a)
            },
            LaoOperation("开始专注", "给注意力留点时间", Icons.Rounded.Timelapse) { s.open("pomo") },
            LaoOperation("习惯打卡", "让今天再好一点", Icons.Rounded.Spa) { s.open("growth") },
            LaoOperation("选择快捷工具", "常用工具放在手边", Icons.Rounded.Widgets) { s.sheet = ToolPickerSheet },
            LaoOperation("写日记", "留住一个校园瞬间", Icons.Rounded.AutoStories) { s.open("diary") },
        )
    if (s.a.cid().isNotBlank()) {
        if (s.a.can("can_ingest"))
            operations +=
                LaoOperation("发布班级事项", "共享课程与安排", Icons.Rounded.Campaign) {
                    CampusSchool.classForm(s.a, null)
                }
        operations +=
            LaoOperation("发布班级消息", "通知、讨论与日常", Icons.Rounded.Forum) { CampusSocial.post(s.a, null) }
    }
    LaoSheetHeading("顺手，做一件事") { s.closeSheet() }
    Text("你的校园快捷操作", style = LaoType.caption, color = c.onSurfaceVariant)
    LazyColumn(Modifier.weight(1f, false), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(operations.chunked(2)) { pair ->
            Row(
                Modifier.fillMaxWidth().height(IntrinsicSize.Min),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                pair.forEachIndexed { index, action ->
                    val hue =
                        CampusAccent.readable(
                            if (index == 0) CampusAccent.blue else CampusAccent.violet
                        )
                    Column(
                        Modifier.weight(1f)
                            .fillMaxHeight()
                            .heightIn(min = 104.dp)
                            .clip(RoundedCornerShape(24.dp))
                            .background(hue.copy(alpha = .055f))
                            .laoTap(role = androidx.compose.ui.semantics.Role.Button) {
                                s.closeSheet()
                                s.invoke(action.action)
                            }
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(action.icon, null, Modifier.size(24.dp), tint = hue)
                        Text(action.title, style = LaoType.cell)
                        Text(action.note, style = LaoType.caption, color = c.onSurfaceVariant)
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}
