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
    fun op(id:String): LaoOperation = when(id) {
        "course" -> LaoOperation("添加课程", "周次、时间与教室", Icons.Rounded.School) { CampusCourses.form(s.a,null) }
        "import" -> LaoOperation("导入课表", "截图、文件或粘贴", Icons.Rounded.FileDownload) { importCourses(s) }
        "task" -> LaoOperation("记一件事", "日程、作业与待办", Icons.Rounded.EditNote) { if(s.route !in listOf("calendar","courses")) s.a.selectedDay=DateMath.today(); CampusSchool.personalForm(s.a,null) }
        "create" -> LaoOperation("创建空间", "班级或团队", Icons.Rounded.GroupAdd) { if(s.a.api.logged()) showCreateClass(s.a) else s.open("login") }
        "join" -> LaoOperation("输入班级码", "申请加入已有空间", Icons.Rounded.Key) { if(s.a.api.logged()) showJoinClass(s.a) else s.open("login") }
        "post" -> LaoOperation("发布班级消息", "通知与讨论", Icons.Rounded.Forum) { CampusSocial.post(s.a,null) }
        "shared" -> LaoOperation("发布班级事项", "共享课程与安排", Icons.Rounded.Campaign) { CampusSchool.classForm(s.a,null) }
        "paste" -> LaoOperation("粘贴导入", "整理收到的消息", Icons.Rounded.ContentPaste) { CampusSocial.pasteImport(s.a) }
        "pomo" -> LaoOperation("开始专注", "给注意力留点时间", Icons.Rounded.Timelapse) { s.open("pomo") }
        "habit" -> LaoOperation("习惯打卡", "记录今日成长", Icons.Rounded.Spa) { s.open("growth") }
        "reminder" -> LaoOperation("自定义提醒", "日期、时间与内容", Icons.Rounded.Notifications) { CampusPhone.reminderForm(s.a,null) }
        "appearance" -> LaoOperation("外观工作室", "风格与配色", Icons.Rounded.Palette) { s.open("appearance") }
        "backup" -> LaoOperation("导出备份", "先保留一份记录", Icons.Rounded.CloudDownload) { s.a.export("laolao-backup.json",s.a.store.backup().toString(),"application/json") }
        else -> LaoOperation("选择快捷工具", "收藏常用入口", Icons.Rounded.Widgets) { s.sheet=ToolPickerSheet }
    }
    val operations = quickActionIds(s.route).map(::op).toMutableList()
    if(s.route in listOf("class","wall","people","members","groups") && s.a.cid().isNotBlank()) {
        operations += op("post")
        if(s.a.can("can_ingest")) operations += op("shared")
    }
    LaoSheetHeading("快捷操作 · " + routeTitle(s.route)) { s.closeSheet() }
    Text("当前页面的常用操作", style = LaoType.caption, color = c.onSurfaceVariant)
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
                            .clip(LocalLaoStyle.current.card)
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
