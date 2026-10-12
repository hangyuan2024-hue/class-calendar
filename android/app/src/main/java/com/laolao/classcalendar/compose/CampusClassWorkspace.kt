package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.unit.*
import java.util.Locale
import org.json.JSONObject

@Composable
internal fun CampusClassPage(s: CampusSession) {
    val a = s.a
    val classes = rows(a.store.list("cache_classes"))
    val current = a.currentClass
    val clipboard = LocalClipboardManager.current
    LaoPage {
        animatedItem(0, "class-heading") {
            Text("班级与团队", style = LaoType.headline)
            if (a.cid().isNotBlank()) {
                Text(current.optString("name"), style = LaoType.title)
                Text(if (a.teacher()) "当前空间 · 管理者" else "当前空间 · 成员", style = LaoType.caption, color = MaterialTheme.colorScheme.onSurfaceVariant)
                val code = current.optString("code")
                if (code.isNotBlank() && a.teacher()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("班级码  $code", Modifier.weight(1f), style = LaoType.cell)
                        LaoIconButton(Icons.Rounded.ContentCopy, "复制班级码") { clipboard.setText(AnnotatedString(code)); s.notice = "已复制班级码" }
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoPrimaryButton("班级消息", Modifier.weight(1f)) { s.open("wall") }
                    LaoSecondaryButton("成员", Modifier.weight(1f)) { s.open("people") }
                }
            }
        }
        if (!a.api.logged()) {
            animatedItem(1) {
                LaoPanel(Modifier.fillMaxWidth()) {
                    Text("登录后管理你的班级", style = LaoType.title)
                    Text("已有账号可直接登录，也可以创建新账号。", style = LaoType.caption, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    LaoPrimaryButton("登录 / 注册", Modifier.fillMaxWidth()) { s.open("login") }
                }
            }
        } else {
            animatedItem(1, "class-actions") {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    LaoPrimaryButton("创建空间", Modifier.weight(1f)) { showCreateClass(a) }
                    LaoSecondaryButton("输入班级码", Modifier.weight(1f)) { showJoinClass(a) }

                }
            }
            if (a.loading) animatedItem(2, "class-loading") { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if (a.cloudError.isNotBlank()) animatedItem(2, "class-error") { Text(a.cloudError, style = LaoType.caption, color = MaterialTheme.colorScheme.error); LaoTextAction("重试") { a.refreshCloud() } }
            if (classes.isEmpty()) {
                animatedItem(2) { LaoEmpty("还没有班级或团队", "你可以自己创建；创建后会自动成为管理者。") }
            } else {
                animatedItem(2) { LaoSection("我的空间", note = "已加入 ${classes.size} 个") }
                classes.forEachIndexed { index, item ->
                    animatedItem(index + 3, "class-${item.optString("id")}") {
                        ClassSpaceCard(a, item)
                    }
                }
            }
            if (a.cid().isNotBlank()) {
                animatedItem(classes.size + 4) { LaoSection("当前班级", note = current.optString("name")) }
                animatedItem(classes.size + 5) {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            LaoSecondaryButton("班级消息", Modifier.weight(1f)) { s.open("wall") }
                            LaoSecondaryButton("分组", Modifier.weight(1f)) { s.open("groups") }
                        }
                        if (a.teacher())
                            LaoPrimaryButton("成员审批与权限", Modifier.fillMaxWidth()) { s.open("members") }
                    }
                }
            }
        }
    }
}

@Composable
private fun ClassSpaceCard(a: CampusActivity, item: JSONObject) {
    val usable = item.optBoolean("is_teacher") || item.optString("status") == "approved"
    val active = item.optString("id") == a.cid()
    val role =
        when {
            item.optBoolean("is_teacher") -> "管理者"
            !usable -> "等待审批"
            else -> CampusActivity.roleName(item.optString("member_role"))
        }
    LaoPanel(Modifier.fillMaxWidth(), onClick = if (usable) { { CampusSchool.select(a, item) } } else null) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconTile("class", 44.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(item.optString("name").ifBlank { "未命名班级" }, style = LaoType.cell)
                Text(if (active) "$role · 当前使用" else role, style = LaoType.caption, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (active) Icon(Icons.Rounded.CheckCircle, "当前空间", tint = MaterialTheme.colorScheme.primary)
            else if (usable) Icon(Icons.Rounded.SwapHoriz, "切换空间", tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

internal fun showCreateClass(a: CampusActivity) {
    a.ui.form(
        "创建班级或团队",
        JSONObject(),
        { value ->
            val name = value.optString("name").trim()
            require(name.length >= 2) { "名称至少需要 2 个字" }
            a.rpc("create_class", CampusJson.obj("cname", name)) {
                a.toast("创建成功，你已成为管理者")
                a.refreshCloud()
            }
        },
        CampusUi.f("name", "班级或团队名称"),
    )
}

internal fun showJoinClass(a: CampusActivity) {
    a.ui.form(
        "申请加入班级",
        JSONObject(),
        { value ->
            val code = value.optString("ccode").trim().uppercase(Locale.ROOT)
            require(code.matches(Regex("[A-Z0-9]{6}"))) { "班级码为 6 位字母或数字" }
            a.rpc("join_class", CampusJson.obj("ccode", code)) {
                a.toast("申请已提交，请等待管理者审批")
                a.refreshCloud()
            }
        },
        CampusUi.f("ccode", "6 位班级码"),
    )
}