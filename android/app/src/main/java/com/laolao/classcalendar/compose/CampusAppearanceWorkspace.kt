package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

@Composable
internal fun CampusAppearancePage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val synced = s.a.store.bool("appearance_sync_v1", true)
    fun key(cloud: String, mobile: String) = if (synced) cloud else mobile
    val chosen = s.a.store.`object`(key("ui_palette_v1", "mobile_palette_v1")).optString("id", LaoStylePrefs.resolve(s.a).defaultPalette)
    val mode = s.a.store.string(key("compose_mode_v1", "mobile_mode_v1"), "system")
    fun palette(p: LaoPalette) {
        s.a.store.set(
            key("ui_palette_v1", "mobile_palette_v1"),
            CampusJson.obj("id", p.id, "p", CampusTheme.hex(p.primary.toArgb()), "s", CampusTheme.hex(p.accent.toArgb())),
        )
        if (p.id in listOf("cyber", "graphite"))
            s.a.store.set(key("compose_mode_v1", "mobile_mode_v1"), "dark")
        s.a.store.set(
            key("ui_skin_v1", "mobile_skin_v1"),
            if (p.id in listOf("cyber", "graphite") || mode == "dark") "cyber" else "fresh",
        )
        s.a.build()
        if (synced) s.a.syncSoon()
    }
    LaoPage {
        animatedItem(0, "appearance-title") { Text("外观工作室", style = LaoType.headline) }
                animatedItem(1, "appearance-sync") {
            LaoPanel(Modifier.fillMaxWidth()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Icon(Icons.Rounded.Sync, null, tint = c.primary)
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("与网站同步配色", style = LaoType.cell)
                        Text(
                            if (synced) "网站和手机使用同一套配色与显示模式。"
                            else "手机保留自己的外观，不影响网站。",
                            style = LaoType.caption,
                            color = c.onSurfaceVariant,
                        )
                    }
                    LaoToggle(
                        synced,
                        { enabled ->
                            if (!enabled) {
                                s.a.store.batch(
                                    CampusJson.obj(
                                        "mobile_palette_v1",
                                        s.a.store.`object`("ui_palette_v1"),
                                        "mobile_mode_v1",
                                        s.a.store.string("compose_mode_v1", "system"),
                                        "mobile_skin_v1",
                                        s.a.store.string("ui_skin_v1", "fresh"),
                                        "mobile_reduce_motion_v1",
                                        s.a.store.bool("compose_reduce_motion_v1", false),
                                        "mobile_style_v1",
                                        s.a.store.string("ui_style_v1", "auto"),
                                    )
                                )
                            }
                            s.a.store.set("appearance_sync_v1", enabled)
                            s.a.build()
                            if (enabled) s.a.syncSoon()
                        },
                        Modifier.semantics { contentDescription = "与网站同步配色" },
                    )
                }
            }
        }
        animatedItem(3) {
            LaoSection("显示模式")
            val labels = mapOf("light" to "明亮", "dark" to "深色", "system" to "跟随系统")
            LaoTabs(labels.values.toList(), labels[mode] ?: "跟随系统") { label ->
                val id = labels.entries.first { it.value == label }.key
                s.a.store.set(key("compose_mode_v1", "mobile_mode_v1"), id)
                s.a.store.set(key("ui_skin_v1", "mobile_skin_v1"), if (id == "dark") "dark" else if(id == "system") "auto" else "fresh")
                s.a.build()
                if (synced) s.a.syncSoon()
            }
        }
        animatedItem(4, "identity-style") {
            val styleKey = LaoStylePrefs.key(s.a.store)
            val savedStyle = s.a.store.string(styleKey, "auto")
            val auto = LaoStyles.first { it.id == LaoStylePrefs.autoId(s.a) }
            LaoSection("界面风格", note = "按身份自动匹配，也可以自己选")
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                (listOf("auto") + LaoStyles.map { it.id }).forEach { id ->
                    val st = LaoStyles.firstOrNull { it.id == id }
                    val on = savedStyle == id || (id == "auto" && LaoStyles.none { it.id == savedStyle })
                    LaoPanel(
                        Modifier.fillMaxWidth(),
                        color = if (on) c.primaryContainer.copy(alpha = .55f) else c.surface,
                        padding = 14.dp,
                        onClick = {
                            s.a.store.set(styleKey, id)
                            s.a.build()
                            if (synced) s.a.syncSoon()
                        },
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            Box(
                                Modifier.size(36.dp)
                                    .clip(RoundedCornerShape((st ?: auto).corner / 2))
                                    .background((st ?: auto).paper)
                                    .border(1.dp, c.outlineVariant, RoundedCornerShape((st ?: auto).corner / 2))
                            )
                            Column(Modifier.weight(1f)) {
                                Text(st?.name ?: "自动 · 跟随身份（当前：${auto.name}）", style = LaoType.cell)
                                Text(st?.summary ?: "学生、老师、职场各有一套", style = LaoType.caption, color = c.onSurfaceVariant)
                            }
                            if (on) Icon(Icons.Rounded.CheckCircle, null, tint = c.primary)
                        }
                    }
                }
            }
        }
        animatedItem(5, "palette-title") { LaoSection("配色") }
        LaoPalettes.chunked(3).forEachIndexed { i, group ->
            animatedItem(i + 6, "palette-$i") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    group.forEach { p -> ThemeCard(p, p.id == chosen, Modifier.weight(1f)) { palette(p) } }
                    repeat(3 - group.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        animatedItem(13) {
            LaoPanel(Modifier.fillMaxWidth()) {
                val motionKey = key("compose_reduce_motion_v1", "mobile_reduce_motion_v1")
                val reduced = s.a.store.bool(motionKey, false)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("减少动态效果", style = LaoType.cell)
                        Text(
                            "保持静态阅读，减少页面移动与小人的呼吸动作。",
                            style = LaoType.caption,
                            color = c.onSurfaceVariant,
                        )
                    }
                    LaoToggle(
                        reduced,
                        {
                            s.a.store.set(motionKey, it)
                            s.a.build()
                            if (synced) s.a.syncSoon()
                        },
                        Modifier.semantics { contentDescription = "减少动态效果" },
                    )
                }
            }
        }
        animatedItem(14, "companion-settings") {
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                LaoMascot(Modifier.size(64.dp))
                Column(Modifier.weight(1f)) {
                    Text("捞捞提示伙伴",style=LaoType.cell)
                    Text("轻点看提示，也能移到喜欢的位置",style=LaoType.caption,color=c.onSurfaceVariant)
                }
                LaoToggle(CampusGuide.enabled(s.a), { on ->
                    val prefs=s.a.store.`object`("island_v1");prefs.put("on",on)
                    s.a.store.set("island_v1",prefs);s.a.build();s.a.syncSoon()
                },Modifier.semantics { contentDescription="显示捞捞提示伙伴" })
            }
        }
        animatedItem(15) {
            LaoSecondaryButton("编辑校园主页", Modifier.fillMaxWidth()) { s.sheet = HomeEditorSheet }
        }
    }
}

@Composable
private fun ThemeCard(p: LaoPalette, selected: Boolean, modifier: Modifier, click: () -> Unit) {
    val c = MaterialTheme.colorScheme
    Column(
        modifier.clip(LocalLaoStyle.current.card)
            .background(c.surface)
            .border(if (selected) 2.dp else 1.dp, if (selected) c.primary else c.outlineVariant, LocalLaoStyle.current.card)
            .laoTap(role = Role.RadioButton, action = click)
            .semantics { this.selected = selected; contentDescription = "配色 ${p.name}" }
            .padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Box(Modifier.size(36.dp).background(p.primary, CircleShape), contentAlignment = Alignment.Center) {
            if (selected) Icon(Icons.Rounded.Check, null, Modifier.size(20.dp), tint = p.companion)
        }
        Text(p.name.substringAfter(" · "), style = LaoType.caption, textAlign = androidx.compose.ui.text.style.TextAlign.Center, minLines = 2)
    }
}

@Composable
internal fun CampusHomeLayoutPage(s: CampusSession) {
    LaoPage {
        animatedItem(0) { ProductIntro("校园主页，按你的节奏", "首屏看重点，下面的模块由你决定。") }
        animatedItem(1) {
            LaoPanel(Modifier.fillMaxWidth()) {
                LaoSection("当前模块")
                homeOrder(s.a)
                    .filter { it !in listOf("w:pins", "w:rings") }
                    .forEach { Text("• ${productModuleName(it)}", style = LaoType.body) }
            }
        }
        animatedItem(2) {
            LaoPrimaryButton("编辑校园主页", Modifier.fillMaxWidth()) { s.sheet = HomeEditorSheet }
        }
        animatedItem(3) {
            LaoSecondaryButton("选择快捷工具", Modifier.fillMaxWidth()) { s.sheet = ToolPickerSheet }
        }
    }
}
