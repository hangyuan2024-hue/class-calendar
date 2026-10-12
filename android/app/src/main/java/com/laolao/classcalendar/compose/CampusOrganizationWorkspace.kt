package com.laolao.classcalendar

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.*
import org.json.JSONObject

private val OrganizationTypes = linkedMapOf(
    "university" to "大学", "college" to "专科 / 高职", "high" to "高中", "middle" to "初中",
    "primary" to "小学", "work" to "工作单位", "personal" to "个人空间",
)
private data class OrganizationSchool(val name: String, val province: String, val city: String)

@Composable
internal fun OrganizationFields(type: String, name: String, change: (String, String) -> Unit) {
    val context = LocalContext.current
    val schools = remember(context) {
        val data = context.resources.openRawResource(R.raw.schools_2026).bufferedReader().use { JSONObject(it.readText()) }
        val output = mutableListOf<OrganizationSchool>()
        val provinces = data.getJSONArray("p")
        repeat(provinces.length()) { index ->
            val province = provinces.getJSONArray(index)
            val list = province.getJSONArray(1)
            repeat(list.length()) { i ->
                val row = list.getJSONArray(i)
                output.add(OrganizationSchool(row.getString(0), province.getString(0), row.optString(1)))
            }
        }
        output.toList()
    }
    var province by rememberSaveable { mutableStateOf("") }
    var selecting by rememberSaveable { mutableStateOf(false) }
    val s = context as CampusActivity
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("学校 / 单位（选填）", style = LaoType.cell)
        LaoSecondaryButton(OrganizationTypes[type] ?: "稍后再填", Modifier.fillMaxWidth()) {
            s.ui.choose("所属类型", OrganizationTypes.values.toTypedArray()) { index -> change(OrganizationTypes.keys.elementAt(index), name) }
        }
        LaoInput(name, { change(type.ifBlank { "university" }, it.take(40)); selecting = true }, "",
            Modifier.fillMaxWidth(), "学校或单位名称，可直接填写", Icons.Rounded.School)
        if (type in listOf("university", "college")) {
            LaoSecondaryButton(if (province.isEmpty()) "按省份查找学校" else province, Modifier.fillMaxWidth()) {
                val provinces = listOf("全部省份") + schools.map { it.province }.distinct()
                s.ui.choose("选择省份", provinces.toTypedArray()) { index -> province = if (index == 0) "" else provinces[index]; selecting = true }
            }
            if (selecting && (name.isNotBlank() || province.isNotBlank())) {
                val candidates = schools.filter {
                    (province.isBlank() || it.province == province) &&
                        (name.isBlank() || it.name.contains(name.trim(), true))
                }
                candidates.take(8).forEach { school ->
                    LaoPanel(Modifier.fillMaxWidth(), onClick = { change(type, school.name); selecting = false }) {
                        Text(school.name, style = LaoType.cell)
                        Text(school.province + " · " + school.city, style = LaoType.caption)
                    }
                }
                Text(if (candidates.isEmpty()) "没找到也可以直接填写，不影响注册。" else "找到 ${candidates.size} 所学校；可继续输入缩小范围。",
                    style = LaoType.caption, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text("不影响课程和班级权限；之后可在“我的 → 设置 → 学校与单位”修改。", style = LaoType.caption,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun CampusOrganizationPage(s: CampusSession) {
    var type by rememberSaveable(s.a.store.owner) { mutableStateOf(s.a.me.optString("org_type", "university")) }
    var name by rememberSaveable(s.a.store.owner) { mutableStateOf(s.a.me.optString("org_name")) }
    LaoPage {
        animatedItem(0) { LaoPageHeading("你的校园，\n从这里开始。", "与网页共用学校和单位资料，支持按省份查找。", "学校与单位", Icons.Rounded.School) }
        animatedItem(1) { LaoPanel(Modifier.fillMaxWidth()) { OrganizationFields(type, name) { t, n -> type = t; name = n } } }
        animatedItem(2) {
            LaoPrimaryButton("保存学校与单位", Modifier.fillMaxWidth()) {
                if (s.a.requireLogin()) s.a.rpc("profile_set_org", CampusJson.obj("p_type", type, "p_name", name.trim().take(40))) { response ->
                    val result = CampusJson.`object`(response)
                    listOf("org_type", "org_name").forEach { key -> CampusJson.put(s.a.me, key, result.opt(key)) }
                    s.a.store.set("cache_me", s.a.me)
                    s.a.build()
                    s.a.toast("学校与单位已保存")
                }
            }
        }
    }
}
