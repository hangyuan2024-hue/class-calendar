package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import org.json.JSONObject

internal fun refreshCredits(s: CampusSession) =
    CampusManage.load(s.a, "credit_list", "cache_credits", "credits")

@Composable
internal fun CampusCreditsPage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val members = rows(s.a.store.list("cache_credits"))
    val admin = s.a.me.optString("role") == "admin"
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "credits-heading") {
            LaoPageHeading(
                "让热爱，有迹可循。",
                "感谢每一位参与建设捞捞课程表的同学与伙伴。",
                "校园共建者",
                Icons.Rounded.FavoriteBorder,
            )
        }
        if (members.isNotEmpty())
            animatedItem(1, "credits-collective") {
                Row(
                    Modifier.fillMaxWidth()
                        .clip(RoundedCornerShape(24.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(
                                    c.primary.copy(alpha = .085f),
                                    c.tertiary.copy(alpha = .035f),
                                )
                            )
                        )
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy((-12).dp)) {
                        members.take(4).forEachIndexed { i, member ->
                            CreditAvatar(
                                member.optString("name"),
                                i,
                                Modifier.size(36.dp).border(2.dp, c.surface, CircleShape),
                            )
                        }
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("${members.size} 位校园共建者", style = LaoType.cell)
                        Text("让每一个校园想法，慢慢长成现实。", style = LaoType.label, color = c.onSurfaceVariant)
                    }
                }
            }
        animatedItem(2, "credits-list-heading") { LaoSection("贡献名单", note = "每一份认真，都值得被看见。") }
        members.forEachIndexed { index, member ->
            animatedItem(index + 3, "credit-" + member.optString("id", index.toString())) {
                CreditCell(s, member, index, admin)
            }
        }
        if (members.isEmpty())
            animatedItem(3, "credits-empty") {
                LaoEmpty("等待认识校园伙伴", "刷新后读取已有的贡献记录。", "刷新贡献名单") { refreshCredits(s) }
            }
        if (admin)
            animatedItem(members.size + 4, "credits-admin") {
                LaoSecondaryButton("添加贡献记录", Modifier.fillMaxWidth()) {
                    CampusManage.creditForm(s.a, null)
                }
            }
        animatedItem(members.size + 5, "credits-footer") {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 16.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LaoMascot(Modifier.size(32.dp), expressive = false)
                Spacer(Modifier.width(8.dp))
                Text("谢谢你，让捞捞更好一点。", style = LaoType.caption, color = c.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun CreditAvatar(name: String, index: Int, modifier: Modifier) {
    val c = MaterialTheme.colorScheme
    val hue =
        CampusAccent.readable(
            listOf(
                CampusAccent.blue,
                CampusAccent.berry,
                CampusAccent.violet,
                CampusAccent.mint,
                CampusAccent.amber,
            )[index % 5]
        )
    Box(
        modifier
            .clip(CircleShape)
            .background(
                Brush.linearGradient(listOf(lerp(c.surface, hue, .16f), lerp(c.surface, hue, .05f)))
            ),
        contentAlignment = Alignment.Center,
    ) {
        Text(name.take(1).ifBlank { "捞" }, style = LaoType.cell, color = hue)
    }
}

@Composable
private fun CreditCell(s: CampusSession, member: JSONObject, index: Int, admin: Boolean) {
    val c = MaterialTheme.colorScheme
    var expanded by rememberSaveable(member.optString("id")) { mutableStateOf(false) }
    val contribution = member.optString("contribution")
    LaoPanel(Modifier.fillMaxWidth(), padding = 16.dp) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CreditAvatar(member.optString("name"), index, Modifier.size(44.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(member.optString("name"), style = LaoType.cell)
                Text("校园共建者", style = LaoType.label, color = c.onSurfaceVariant)
            }
            if (admin)
                LaoIconButton(
                    Icons.Rounded.MoreHoriz,
                    "管理贡献记录 " + member.optString("name"),
                    Modifier.size(40.dp),
                ) {
                    s.a.ui.choose("贡献记录", arrayOf("编辑 / 排序", "删除")) { choice ->
                        if (choice == 0) CampusManage.creditForm(s.a, member)
                        else
                            s.a.ui.confirm("删除贡献记录？", member.optString("name")) {
                                s.a.rpc(
                                    "credit_delete",
                                    CampusJson.obj(
                                        "cid",
                                        CampusJson.numericId(member.optString("id")),
                                    ),
                                ) {
                                    refreshCredits(s)
                                }
                            }
                    }
                }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(
                Modifier.width(2.dp)
                    .height(24.dp)
                    .background(c.primary.copy(alpha = .2f), CircleShape)
            )
            Text(
                contribution,
                Modifier.weight(1f),
                style = LaoType.body,
                color = c.onSurfaceVariant,
                maxLines = if (expanded) Int.MAX_VALUE else 4,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (contribution.length > 80)
            LaoTextAction(if (expanded) "收起" else "展开贡献说明") { expanded = !expanded }
    }
}
