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

internal fun campusWallRows(a: CampusActivity): List<JSONObject> {
    if (!a.api.logged() || a.cid().isBlank()) return emptyList()
    val cachedClass = a.store.string("cache_wall_class", "")
    if (cachedClass.isNotBlank() && cachedClass != a.cid()) return emptyList()
    return rows(a.store.list("cache_wall"))
        .filter {
            (!it.optBoolean("hidden") ||
                CampusSocial.moderator(a) ||
                it.optString("author_id") == a.api.uid()) &&
                (it.optString("class_id").isBlank() || it.optString("class_id") == a.cid())
        }
        .sortedWith(
            compareByDescending<JSONObject> {
                    it.optString("pinned_at").isNotBlank() && !it.isNull("pinned_at")
                }
                .thenByDescending { it.optString("created_at") }
        )
}

@Composable
internal fun CampusClassWallPage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val connected = a.api.logged() && a.cid().isNotBlank()
    var search by rememberSaveable { mutableStateOf(a.store.string("native_wall_query", "")) }
    var searching by rememberSaveable { mutableStateOf(false) }
    val channel = a.store.string("native_wall_channel", "全部")
    val groups = rows(a.store.list("cache_groups"))
    val posts =
        campusWallRows(a).filter { post ->
            val channelMatch =
                when (channel) {
                    "全部" -> true
                    "通知" -> post.optBoolean("is_notice")
                    "全班" -> post.isNull("group_id") || post.optString("group_id").isBlank()
                    else ->
                        groups.any {
                            it.optString("name") == channel &&
                                it.optString("id") == post.optString("group_id")
                        }
                }
            channelMatch &&
                (search.isBlank() ||
                    (post.optString("title") +
                            post.optString("body") +
                            post.optString("author_name"))
                        .contains(search, true))
        }
    LaunchedEffect(a.cid(), a.api.uid()) {
        if (connected && a.store.string("cache_wall_class", "") != a.cid()) CampusSocial.loadWall(a)
    }
    LaoPage {
        animatedItem(0, "community-header") {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(
                    Modifier.size(48.dp)
                        .background(
                            CampusAccent.violet.copy(alpha = .1f),
                            RoundedCornerShape(16.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Rounded.Forum,
                        null,
                        tint = CampusAccent.readable(CampusAccent.violet),
                    )
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        a.currentClass.optString("name").ifBlank { "同学的校园圈" },
                        style = LaoType.title,
                    )
                    Text("通知、讨论和日常，在这里碰面。", style = LaoType.caption, color = c.onSurfaceVariant)
                }
            }
        }
        animatedItem(1, "community-entries") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CommunityTile(
                    "班级排行榜",
                    "一起把进步看见",
                    Icons.Rounded.EmojiEvents,
                    CampusAccent.amber,
                    Modifier.weight(1f),
                ) {
                    s.open("rank")
                }
                CommunityTile(
                    "班级成员",
                    "认识你的同学",
                    Icons.Rounded.Groups,
                    CampusAccent.violet,
                    Modifier.weight(1f),
                ) {
                    s.open("people")
                }
            }
        }
        if (!connected) animatedItem(2) { CampusClassGate(s) }
        else {
            animatedItem(2, "community-filters") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LaoTabs(listOf("全部", "通知", "全班"), channel) {
                        a.store.set("native_wall_channel", it)
                        a.build()
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            if (channel in listOf("全部", "通知", "全班")) "最新动态" else channel,
                            Modifier.weight(1f),
                            style = LaoType.cell,
                        )
                        LaoIconButton(Icons.Rounded.FilterList, "选择班级消息范围") {
                            val names =
                                listOf("全部", "通知", "全班") + groups.map { it.optString("name") }
                            a.ui.choose("消息范围", names.toTypedArray()) {
                                a.store.set("native_wall_channel", names[it])
                                a.build()
                            }
                        }
                        LaoIconButton(Icons.Rounded.Search, "搜索班级消息") { searching = !searching }
                        LaoIconButton(Icons.Rounded.Refresh, "刷新班级墙") { CampusSocial.loadWall(a) }
                    }
                    if (searching)
                        LaoInput(
                            search,
                            {
                                search = it
                                a.store.set("native_wall_query", it)
                            },
                            "搜索班级消息",
                            Modifier.fillMaxWidth(),
                        )
                    if (a.cloudError.isNotBlank())
                        ProductState("刷新暂未完成", a.cloudError, Icons.Rounded.CloudOff, "重试", true) {
                            CampusSocial.loadWall(a)
                        }
                    if (CampusSocial.moderator(a))
                        TextButton(
                            onClick = {
                                a.rpc("wall_report_list", CampusJson.obj("cid", a.cid())) {
                                    CampusManage.records(a, "举报记录", it)
                                }
                            }
                        ) {
                            Text("举报审核")
                        }
                }
            }
            if (posts.isEmpty())
                animatedItem(3) {
                    LaoEmpty(
                        "这里等你开个头",
                        if (search.isNotBlank()) "试试其他关键词，或清空筛选。" else "班级通知、讨论和同学动态会显示在这里。",
                        "发布班级消息",
                    ) {
                        CampusSocial.post(a, null)
                    }
                }
            posts.forEachIndexed { index, post ->
                animatedItem(index + 3, "post-" + post.optString("id")) { CampusPostCard(s, post) }
            }
        }
    }
}

@Composable
internal fun CampusClassGate(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    LaoPanel(Modifier.fillMaxWidth(), color = lerp(c.surface, c.secondary, .04f)) {
        LaoMascot(Modifier.size(56.dp))
        Text(if (s.a.api.logged()) "找到你的班级，遇见你的同学。" else "先登录，连接你的校园圈。", style = LaoType.title)
        Text("班级墙、通知、成员和成长榜使用网站原来的班级数据。", style = LaoType.caption, color = c.onSurfaceVariant)
        LaoPrimaryButton(if (s.a.api.logged()) "加入或管理班级" else "登录 / 注册", Modifier.fillMaxWidth()) {
            s.open(if (s.a.api.logged()) "class" else "login")
        }
    }
}

@Composable
private fun CommunityTile(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    accent: Color,
    modifier: Modifier,
    click: () -> Unit,
) {
    val color = CampusAccent.readable(accent)
    Column(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(color.copy(alpha = .08f))
            .clickable(onClick = click)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(icon, null, Modifier.size(24.dp), tint = color)
        Text(title, style = LaoType.cell)
        Text(subtitle, style = LaoType.label, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun CampusPostCard(s: CampusSession, post: JSONObject, author: Boolean = true) =
    LaoFeedCell(s, post, author)

@Composable
internal fun LaoFeedCell(s: CampusSession, post: JSONObject, author: Boolean = true) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val name = post.optString("author_name").ifBlank { "同学" }
    Column(
        Modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (author)
                CampusAvatar(
                    name,
                    "",
                    Modifier.size(44.dp).laoTap {
                        CampusSocial.loadUser(a, post.optString("author_id"))
                    },
                )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(
                        Modifier.weight(1f)
                            .then(
                                if (author)
                                    Modifier.laoTap {
                                        CampusSocial.loadUser(a, post.optString("author_id"))
                                    }
                                else Modifier
                            ),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        if (author) Text(name, style = LaoType.cell)
                        Text(
                            if (author)
                                CampusActivity.roleName(post.optString("author_role")) +
                                    " · " +
                                    post.optString("created_at").replace('T', ' ').take(16)
                            else post.optString("created_at").replace('T', ' ').take(16),
                            style = LaoType.label,
                            color = c.onSurfaceVariant,
                        )
                    }
                    LaoIconButton(Icons.Rounded.MoreHoriz, "班级消息更多操作") {
                        CampusSocial.postMore(a, post)
                    }
                }
                if (post.optBoolean("is_notice"))
                    LaoChip(
                        "班级通知",
                        CampusAccent.readable(CampusAccent.blue),
                        Icons.Rounded.Campaign,
                    )
                if (!post.isNull("pinned_at") && post.optString("pinned_at").isNotBlank())
                    LaoChip("置顶", CampusAccent.readable(CampusAccent.amber), Icons.Rounded.PushPin)
                if (post.optBoolean("hidden")) LaoChip("已隐藏", c.error)
                if (post.optString("title").isNotBlank())
                    Text(post.optString("title"), style = LaoType.cell)
                Text(post.optString("body"), style = LaoType.body)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    LaoIconButton(
                        Icons.Rounded.ChatBubbleOutline,
                        "查看评论与回复",
                        Modifier.size(40.dp),
                        tint = c.onSurfaceVariant,
                    ) {
                        openFeedComments(s, post, author)
                    }
                    LaoTextAction("评论 / 回复") { openFeedComments(s, post, author) }
                }
            }
        }
        HorizontalDivider(
            Modifier.padding(start = if (author) 56.dp else 0.dp),
            color = c.outlineVariant.copy(alpha = .6f),
        )
    }
}

private fun openFeedComments(s: CampusSession, post: JSONObject, cached: Boolean) {
    if (cached) CampusSocial.comments(s.a, post)
    else
        s.a.rpc("wall_comments_get", CampusJson.obj("cid", CampusJson.nullable(s.a.cid()))) {
            s.a.store.set("cache_comments", it)
            CampusSocial.comments(s.a, post)
        }
}

@Composable
internal fun CampusHomeWallPreview(s: CampusSession) {
    val posts = campusWallRows(s.a).take(2)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        LaoSection("班级墙", action = "查看全部") { s.open("wall") }
        if (posts.isEmpty())
            LaoPanel(Modifier.fillMaxWidth(), padding = 16.dp, onClick = { s.open("wall") }) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(
                        Icons.Rounded.Forum,
                        null,
                        tint = CampusAccent.readable(CampusAccent.violet),
                    )
                    Text(
                        if (s.a.cid().isBlank()) "找到班级，和同学一起捞捞。" else "看看班级的最新通知与讨论。",
                        style = LaoType.body,
                    )
                }
            }
        else posts.forEach { CampusPostCard(s, it) }
    }
}

@Composable
internal fun CampusRankPreview(s: CampusSession) {
    CommunityTile(
        "班级排行榜",
        "本周的进步，也值得被看见",
        Icons.Rounded.EmojiEvents,
        CampusAccent.amber,
        Modifier.fillMaxWidth(),
    ) {
        s.open("rank")
    }
}

@Composable
internal fun CampusRankPage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val period = a.store.string("native_rank_period", "week")
    val cached = a.store.get("cache_rank", null)
    val data = CampusJson.`object`(cached)
    val ranked = rows(data.optJSONArray("rows") ?: CampusJson.arr(cached))
    val connected = a.api.logged() && a.cid().isNotBlank()
    val valid = a.store.string("native_rank_class", a.cid()) == a.cid()
    val board = if (connected && valid) ranked else emptyList()
    LaunchedEffect(a.cid(), a.api.uid()) {
        if (connected && (!valid || cached == null)) CampusLearn.loadRank(a, period)
    }
    LaoPage {
        animatedItem(0) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Box(
                    Modifier.size(56.dp)
                        .background(
                            CampusAccent.amber.copy(alpha = .12f),
                            RoundedCornerShape(20.dp),
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Rounded.EmojiEvents,
                        null,
                        Modifier.size(32.dp),
                        tint = CampusAccent.readable(CampusAccent.amber),
                    )
                }
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("每一点进步，\n都值得上榜。", style = LaoType.title)
                    Text(
                        a.currentClass.optString("name").ifBlank { "班级成长排行榜" },
                        style = LaoType.caption,
                        color = c.onSurfaceVariant,
                    )
                }
            }
        }
        if (!connected) animatedItem(1) { CampusClassGate(s) }
        else {
            animatedItem(1) {
                LaoTabs(listOf("本周", "全部"), if (period == "all") "全部" else "本周") {
                    CampusLearn.loadRank(a, if (it == "全部") "all" else "week")
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "来自真实成长记录",
                        Modifier.weight(1f),
                        style = LaoType.label,
                        color = c.onSurfaceVariant,
                    )
                    LaoIconButton(Icons.Rounded.Refresh, "刷新班级排行榜") {
                        CampusLearn.loadRank(a, period)
                    }
                    LaoIconButton(Icons.Rounded.Visibility, "排行榜展示方式") {
                        rankPreferences(s, period)
                    }
                }
                if (a.cloudError.isNotBlank())
                    Text(a.cloudError, style = LaoType.caption, color = c.error)
            }
            if (board.isEmpty())
                animatedItem(2) {
                    LaoEmpty("榜单等你点亮", "完成事项、习惯打卡和专注后，刷新查看真实成长值。", "刷新排行榜") {
                        CampusLearn.loadRank(a, period)
                    }
                }
            else {
                animatedItem(2, "rank-podium") {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.Bottom,
                    ) {
                        listOf(1, 0, 2)
                            .filter { it < minOf(3, board.size) }
                            .forEach { i ->
                                val row = board[i]
                                val accent =
                                    if (i == 0) CampusAccent.amber
                                    else if (i == 1) CampusAccent.blue else CampusAccent.berry
                                Column(
                                    Modifier.weight(1f)
                                        .clip(RoundedCornerShape(24.dp))
                                        .background(
                                            Brush.verticalGradient(
                                                listOf(
                                                    CampusAccent.readable(accent)
                                                        .copy(alpha = .14f),
                                                    c.surface.copy(alpha = .85f),
                                                )
                                            )
                                        )
                                        .padding(
                                            horizontal = 8.dp,
                                            vertical = if (i == 0) 24.dp else 16.dp,
                                        ),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Icon(
                                        if (i == 0) Icons.Rounded.EmojiEvents
                                        else Icons.Rounded.WorkspacePremium,
                                        null,
                                        tint = CampusAccent.readable(accent),
                                    )
                                    CampusAvatar(
                                        row.optString("name", row.optString("display_name", "同学")),
                                        "",
                                        Modifier.size(48.dp),
                                    )
                                    Text(
                                        row.optString("name", row.optString("display_name", "同学")),
                                        style = LaoType.cell,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        row.optInt("score", row.optInt("points")).toString(),
                                        style = LaoType.title,
                                        color = CampusAccent.readable(accent),
                                    )
                                    Text(
                                        "第 " + (i + 1) + " 名",
                                        style = LaoType.label,
                                        color = c.onSurfaceVariant,
                                    )
                                }
                            }
                    }
                }
                board.forEachIndexed { i, row ->
                    animatedItem(i + 3, "rank-" + i) {
                        Row(
                            Modifier.fillMaxWidth()
                                .clip(RoundedCornerShape(20.dp))
                                .background(c.surface.copy(alpha = .7f))
                                .padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            Text(
                                (i + 1).toString().padStart(2, '0'),
                                Modifier.width(24.dp),
                                style = LaoType.cell,
                                color = c.onSurfaceVariant,
                            )
                            CampusAvatar(
                                row.optString("name", row.optString("display_name", "同学")),
                                "",
                                Modifier.size(40.dp),
                            )
                            Text(
                                row.optString("name", row.optString("display_name", "同学")),
                                Modifier.weight(1f),
                                style = LaoType.cell,
                            )
                            Text(
                                row.optInt("score", row.optInt("points")).toString(),
                                style = LaoType.cell,
                                color = c.primary,
                            )
                        }
                    }
                }
            }
        }
    }
}

private fun rankPreferences(s: CampusSession, period: String) {
    val a = s.a
    if (!a.needClass()) return
    a.ui.choose("我的成长榜展示", arrayOf("显示姓名", "匿名显示", "不参与排名")) { i ->
        a.rpc(
            "rank_set_pref",
            CampusJson.obj("cid", a.cid(), "m", arrayOf("show", "anon", "off")[i]),
        ) {
            CampusLearn.loadRank(a, period)
        }
    }
}
