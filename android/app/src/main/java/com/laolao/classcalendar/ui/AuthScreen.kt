package com.laolao.classcalendar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

val IDENTITIES = listOf("student" to "学生", "teacher" to "老师", "other" to "职场·个人")
val ORG_TYPES = listOf("" to "暂不填写", "university" to "大学", "college" to "大专", "high" to "高中", "middle" to "初中", "primary" to "小学", "work" to "工作单位", "personal" to "个人")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuthScreen() {
    val repo = LocalRepo.current
    val c = LocalLao.current
    val scope = rememberCoroutineScope()
    var register by remember { mutableStateOf(false) }
    var account by remember { mutableStateOf("") }
    var pw by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var identity by remember { mutableStateOf("student") }
    var orgType by remember { mutableStateOf("") }
    var orgName by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var msg by remember { mutableStateOf<String?>(null) }

    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(c.tint, c.bg)))) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).systemBarsPadding().imePadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Spacer(Modifier.height(40.dp))
            Text("捞捞课程表", style = MaterialTheme.typography.headlineMedium, color = c.accent)
            Text("课程、日程和班级，一个账号三端同步", color = c.muted, fontSize = 13.sp)
            Spacer(Modifier.height(28.dp))
            Card0 {
                Row(Modifier.fillMaxWidth().background(c.tint, RoundedCornerShape(50)).padding(4.dp)) {
                    listOf(false to "登录", true to "注册").forEach { (r, label) ->
                        val on = register == r
                        Surface(onClick = { register = r; msg = null }, shape = RoundedCornerShape(50),
                            color = if (on) c.card else c.tint, modifier = Modifier.weight(1f)) {
                            Text(label, Modifier.padding(10.dp), fontWeight = if (on) FontWeight.Bold else FontWeight.Normal,
                                color = if (on) c.accent else c.muted, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
                OutlinedTextField(account, { account = it.lowercase().filter { ch -> ch.isLetterOrDigit() || ch == '_' } }, label = { Text("账号") },
                    supportingText = { Text("3—20 位小写字母、数字或下划线") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(pw, { pw = it }, label = { Text("密码") }, singleLine = true, visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth(),
                    supportingText = { if (register) Text("至少 8 位") })
                if (register) {
                    OutlinedTextField(name, { name = it.take(20) }, label = { Text("姓名或昵称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    Spacer(Modifier.height(10.dp))
                    Text("我的身份", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Text("决定首页的常用入口和风格，以后可在「我的」里修改。任何身份都能创建班级。", color = c.muted, fontSize = 12.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(vertical = 6.dp)) {
                        IDENTITIES.forEach { (id, label) -> FilterChip(identity == id, { identity = id }, label = { Text(label) }) }
                    }
                    var expand by remember { mutableStateOf(false) }
                    ExposedDropdownMenuBox(expand, { expand = it }) {
                        OutlinedTextField(ORG_TYPES.first { it.first == orgType }.second, {}, readOnly = true, label = { Text("学校或单位类型（可选）") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expand) }, modifier = Modifier.menuAnchor().fillMaxWidth())
                        ExposedDropdownMenu(expand, { expand = false }) {
                            ORG_TYPES.forEach { (id, l) -> DropdownMenuItem(text = { Text(l) }, onClick = { orgType = id; expand = false }) }
                        }
                    }
                    if (orgType.isNotEmpty()) OutlinedTextField(orgName, { orgName = it.take(40) }, label = { Text("学校或单位名称") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                }
                msg?.let { Text(it, color = MaterialTheme.colorScheme.error, fontSize = 13.sp, modifier = Modifier.padding(top = 8.dp)) }
                Spacer(Modifier.height(14.dp))
                Button(enabled = !busy, onClick = {
                    busy = true; msg = null
                    scope.launch {
                        try { if (register) repo.register(account, pw, name, identity, orgType, orgName) else repo.login(account, pw) }
                        catch (e: Exception) { msg = e.message ?: "操作失败，请重试" }
                        busy = false
                    }
                }, modifier = Modifier.fillMaxWidth().height(50.dp), shape = RoundedCornerShape(14.dp)) {
                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = c.card)
                    else Text(if (register) "注册并登录" else "登录", fontSize = 16.sp)
                }
            }
            Spacer(Modifier.height(16.dp))
            Text("和网站、微信小程序使用同一个账号", color = c.muted, fontSize = 12.sp)
        }
    }
}
