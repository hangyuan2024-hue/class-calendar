package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import org.json.JSONObject

private data class CampusCover(val id: String, val name: String, val start: Color, val end: Color)

private val CampusCovers =
    listOf(
        CampusCover("sky", "晴空", Color(0xFF96C8FF), Color(0xFF7066D5)),
        CampusCover("sakura", "莓果", Color(0xFFF9C9DF), Color(0xFFD7659B)),
        CampusCover("ocean", "鸢尾", Color(0xFFCCD5FF), Color(0xFF6565C1)),
        CampusCover("sunset", "日落", Color(0xFFF6CF9A), Color(0xFFCE6D98)),
        CampusCover("forest", "森林", Color(0xFFC2DEC1), Color(0xFF418B77)),
        CampusCover("galaxy", "星河", Color(0xFFAA9DDF), Color(0xFF544E94)),
        CampusCover("peach", "蜜桃", Color(0xFFF4DAC0), Color(0xFFE89EA9)),
        CampusCover("mono", "极简", Color(0xFFD5DBE7), Color(0xFF808C9F)),
    )

@Composable
private fun CoverArt(id: String, modifier: Modifier = Modifier) {
    val cover = CampusCovers.firstOrNull { it.id == id } ?: CampusCovers.first()
    Canvas(modifier.background(Brush.linearGradient(listOf(cover.start, cover.end)))) {
        // Native vector artwork, with a different arrangement for every existing cover ID.
        val variant = CampusCovers.indexOf(cover)
        val center = Offset(size.width * (.67f + (variant % 3) * .06f), size.height * .1f)
        drawCircle(Color.White.copy(alpha = .12f), size.width * .37f, center)
        drawCircle(
            Color.White.copy(alpha = .16f),
            size.width * .23f,
            center,
            style = androidx.compose.ui.graphics.drawscope.Stroke(1.dp.toPx()),
        )
        val wave =
            Path().apply {
                moveTo(0f, size.height * .84f)
                cubicTo(
                    size.width * .3f,
                    size.height * .06f,
                    size.width * .57f,
                    size.height * 1.24f,
                    size.width,
                    size.height * .5f,
                )
                lineTo(size.width, size.height)
                lineTo(0f, size.height)
                close()
            }
        drawPath(wave, Color.White.copy(alpha = .15f))
        drawCircle(
            Color.White.copy(alpha = .32f),
            2.dp.toPx(),
            Offset(size.width * .57f, size.height * .26f),
        )
        drawCircle(
            Color.White.copy(alpha = .2f),
            4.dp.toPx(),
            Offset(size.width * .89f, size.height * .72f),
        )
    }
}

@Composable
internal fun CampusPersonalPage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val logged = a.api.logged()
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "account-summary") {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                CampusAvatar(campusName(a), a.me.optString("gender"), Modifier.size(56.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(if (logged) campusName(a) else "尚未登录", style = LaoType.title)
                    Text(if (logged) "@" + a.me.optString("account") else "本机课表与记录可继续使用", style = LaoType.caption, color = c.onSurfaceVariant)
                    if (logged) Text(LaoStylePrefs.resolve(a).name, style = LaoType.caption, color = c.primary)
                }
                if (logged) LaoIconButton(Icons.Rounded.Edit, "编辑个人资料") { s.sheet = ProfileEditorSheet }
            }
            if (!logged) LaoPrimaryButton("登录 / 注册", Modifier.fillMaxWidth()) { s.open("login") }
        }
        animatedItem(1, "account-essential") {
            LaoSection("账号与空间")
            LaoLink("班级与团队", a.currentClass.optString("name").ifBlank { "创建、加入与切换" }, "class", s)
            LaoLink("学校与单位", "学校、工作单位与个人空间", "organization", s)
            LaoLink("账号安全", "密码与登录信息", "security", s)
        }
        animatedItem(2, "account-appearance") {
            LaoSection("我的偏好")
            LaoLink("外观与配色", LaoStylePrefs.resolve(a).name + if (a.store.bool("appearance_sync_v1", true)) " · 与网站同步" else " · 仅手机", "appearance", s)
            LaoLink("提醒与通知", "课程、任务与自定义提醒", "reminders", s)
            LaoLink("数据与同步", "备份、恢复与账号同步", "backup", s)
        }
        animatedItem(3, "account-records") {
            LaoSection("我的记录")
            LaoLink("全部待办", "课程以外的全部任务与日程", "homework", s)
            LaoLink("成长与习惯", "完成记录、打卡与学习周报", "growth", s)
            LaoLink("个人日记", "私密记录", "diary", s)
            LaoLink("设置", "全部设置与版本信息", "settings", s)
        }
    }
}

@Composable
private fun CampusProfileHeader(
    s: CampusSession,
    person: JSONObject,
    className: String,
    own: Boolean,
) {
    val c = MaterialTheme.colorScheme
    val logged = s.a.api.logged()
    val gender = person.optString("gender")
    val name =
        person.optString("display_name").ifBlank {
            person.optString("name").ifBlank { if (logged) "同学" else "你的校园空间" }
        }
    val cover =
        person.optString("cover").ifBlank {
            if (gender == "f") "sakura" else if (gender == "m") "sky" else "ocean"
        }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(Modifier.fillMaxWidth().heightIn(min = 168.dp).clip(RoundedCornerShape(28.dp))) {
            CoverArt(cover, Modifier.matchParentSize())
            Column(
                Modifier.fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(24.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        if (own) "我的校园主页" else "同学的校园主页",
                        Modifier.weight(1f),
                        style = LaoType.caption,
                        color = Color(0xFF313557),
                    )
                    if (own && logged)
                        LaoIconButton(
                            Icons.Rounded.Edit,
                            "编辑资料与封面",
                            Modifier.size(40.dp),
                            tint = Color(0xFF313557),
                        ) {
                            s.sheet = ProfileEditorSheet
                        }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    CampusAvatar(
                        name,
                        gender,
                        Modifier.size(72.dp)
                            .border(3.dp, Color.White.copy(alpha = .85f), CircleShape),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(
                            name,
                            style = LaoType.title.copy(fontSize = 24.sp, lineHeight = 32.sp),
                            color = Color(0xFF242843),
                        )
                        Text(
                            if (person.optString("account").isNotBlank())
                                "@" + person.optString("account")
                            else CampusActivity.roleName(person.optString("role")),
                            style = LaoType.caption,
                            color = Color(0xFF343B60),
                        )
                    }
                }
            }
        }
        Row(
            verticalAlignment = Alignment.Top,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    person.optString("bio").ifBlank {
                        if (own && !logged) "课表和记录随时可用。登录后，遇见你的同学。" else "记录日常，把每一点进步留在这里。"
                    },
                    style = LaoType.body,
                    color = c.onSurfaceVariant,
                )
                if (className.isNotBlank()) LaoChip(className, c.primary, Icons.Rounded.School)
            }
            if (own && logged) LaoTextAction("编辑主页") { s.sheet = ProfileEditorSheet }
        }
        if (own && !logged) LaoPrimaryButton("登录 / 注册", Modifier.fillMaxWidth()) { s.open("login") }
    }
}

@Composable
private fun ProfileTile(
    title: String,
    subtitle: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    accent: Color,
    modifier: Modifier,
    click: () -> Unit,
) = LaoEditorialCard(title, subtitle, icon, CampusAccent.readable(accent), modifier, click)

@Composable
internal fun CampusPublicProfilePage(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    val data = a.store.`object`("cache_user_page")
    val person = data.optJSONObject("profile") ?: data.optJSONObject("user") ?: data
    val show = data.optBoolean("show_points")
    val teacher = data.optString("class_role", person.optString("role")) == "teacher"
    val posts = rows(data.optJSONArray("posts") ?: org.json.JSONArray())
    LaoPage {
        animatedItem(0) {
            CampusProfileHeader(s, person, data.optString("class_name"), data.optBoolean("me"))
        }
        animatedItem(1) {
            LaoSecondaryButton("刷新主页", Modifier.fillMaxWidth()) {
                CampusSocial.loadUser(a, person.optString("id"))
            }
            if (a.cloudError.isNotBlank())
                Text(a.cloudError, style = LaoType.caption, color = c.error)
        }
        if (!teacher)
            animatedItem(2) {
                LaoPanel(Modifier.fillMaxWidth()) {
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        LaoStat(
                            if (data.isNull("week_points")) "—"
                            else data.optString("week_points", "—"),
                            "本周成长值",
                            Modifier.weight(1f),
                        )
                        LaoStat(
                            if (data.isNull("total_points")) "—"
                            else data.optString("total_points", "—"),
                            "累计成长值",
                            Modifier.weight(1f),
                            CampusAccent.readable(CampusAccent.violet),
                        )
                        LaoStat(
                            (data.optInt("post_count") + data.optInt("comment_count")).toString(),
                            "发言与评论",
                            Modifier.weight(1f),
                            CampusAccent.readable(CampusAccent.berry),
                        )
                    }
                }
            }
        if (!teacher)
            animatedItem(3) {
                if (show)
                    LaoPanel(Modifier.fillMaxWidth()) {
                        LaoSection("成长足迹", note = "最近 16 周 · 连续活跃 ${data.optInt("streak")} 天")
                        Text(
                            "完成 ${data.optInt("done")} 件事 · 打卡 ${data.optInt("habits")} 次 · 专注 ${data.optInt("pomos")} 次",
                            style = LaoType.caption,
                            color = c.onSurfaceVariant,
                        )
                        CampusGrowthHeatmap(data.optJSONObject("days") ?: JSONObject())
                    }
                else
                    LaoPanel(Modifier.fillMaxWidth()) {
                        Icon(Icons.Rounded.Lock, null, tint = c.onSurfaceVariant)
                        Text("成长记录未公开", style = LaoType.cell)
                        Text("本人和有权限的老师可以查看。", style = LaoType.caption, color = c.onSurfaceVariant)
                    }
            }
        animatedItem(4) { LaoSection("班级墙", note = "${data.optInt("post_count")} 条发言") }
        if (posts.isEmpty()) animatedItem(5) { LaoEmpty("还没有发言", "在班级墙分享第一条消息。") }
        posts.forEachIndexed { index, post ->
            animatedItem(index + 5, "profile-post-" + post.optString("id")) {
                CampusPostCard(s, post, false)
            }
        }
        if (data.optBoolean("can_reset"))
            animatedItem(posts.size + 6) {
                LaoSecondaryButton("为此成员重置密码", Modifier.fillMaxWidth()) {
                    a.ui.confirm("重置成员密码？", "服务器将返回临时密码，请通过合适方式交给成员。") {
                        a.rpc("pw_reset_by_staff", CampusJson.obj("uid", person.optString("id"))) {
                            CampusManage.message(a, "临时密码", it.toString())
                        }
                    }
                }
            }
    }
}

@Composable
private fun CampusGrowthHeatmap(days: JSONObject) {
    val c = MaterialTheme.colorScheme
    val dates =
        remember(DateMath.today()) {
            (0 until 112).map { DateMath.plus(DateMath.today(), it - 111) }
        }
    val values = dates.map { CampusLearn.activityValue(days, it) }
    val max = values.maxOrNull()?.coerceAtLeast(1) ?: 1
    val active = values.count { it > 0 }
    Canvas(
        Modifier.fillMaxWidth().height(112.dp).semantics {
            contentDescription = "最近16周成长热力图，${active}天有记录"
        }
    ) {
        val step = minOf(size.width / 16f, size.height / 7f)
        values.forEachIndexed { i, value ->
            val hue =
                if (value == 0) c.surfaceContainerHighest
                else
                    lerp(
                        c.surfaceContainerHighest,
                        c.primary,
                        (value.toFloat() / max).coerceAtLeast(.3f),
                    )
            drawRoundRect(
                hue,
                Offset((i / 7) * step, (i % 7) * step),
                Size(step * .75f, step * .75f),
                CornerRadius(3.dp.toPx()),
            )
        }
    }
}

@Composable
internal fun ColumnScope.ProfileEditorContent(s: CampusSession) {
    val a = s.a
    val c = MaterialTheme.colorScheme
    var bio by rememberSaveable { mutableStateOf(a.me.optString("bio")) }
    var gender by rememberSaveable { mutableStateOf(a.me.optString("gender", "x")) }
    var cover by rememberSaveable {
        mutableStateOf(a.me.optString("cover").ifBlank { if (gender == "f") "sakura" else "sky" })
    }
    var saving by remember { mutableStateOf(false) }
    LaunchedEffect(s.revision, a.cloudError) { if (a.cloudError.isNotBlank()) saving = false }
    LaoSheetHeading("编辑校园主页") { s.closeSheet() }
    Column(
        Modifier.weight(1f, false).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(112.dp).clip(RoundedCornerShape(24.dp))) {
            CoverArt(cover, Modifier.matchParentSize())
            CampusAvatar(
                campusName(a),
                gender,
                Modifier.align(Alignment.Center)
                    .size(72.dp)
                    .border(3.dp, Color.White.copy(alpha = .9f), CircleShape),
            )
        }
        Text("性别显示", style = LaoType.cell)
        val genders = mapOf("m" to "男生", "f" to "女生", "x" to "保密")
        LaoTabs(genders.values.toList(), genders[gender] ?: "保密") { label ->
            gender = genders.entries.first { it.value == label }.key
        }
        LaoInput(
            bio,
            { bio = it.take(60) },
            "个人简介",
            Modifier.fillMaxWidth(),
            placeholder = "写下你的校园日常或最近的小目标",
            singleLine = false,
            minLines = 2,
            maxLines = 4,
            enabled = !saving,
        )
        Text(
            "${bio.length}/60",
            Modifier.align(Alignment.End),
            style = LaoType.label,
            color = c.onSurfaceVariant,
        )
        Text("主页封面", style = LaoType.cell)
        CampusCovers.chunked(4).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { candidate ->
                    Column(
                        Modifier.weight(1f)
                            .clip(RoundedCornerShape(16.dp))
                            .border(
                                if (cover == candidate.id) 2.dp else 0.dp,
                                if (cover == candidate.id) c.primary else Color.Transparent,
                                RoundedCornerShape(16.dp),
                            )
                            .clickable(role = Role.RadioButton) { cover = candidate.id }
                            .padding(4.dp)
                            .semantics {
                                selected = cover == candidate.id
                                contentDescription = "选择封面" + candidate.name
                            },
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        CoverArt(
                            candidate.id,
                            Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(12.dp)),
                        )
                        Text(candidate.name, style = LaoType.label)
                    }
                }
            }
        }
        if (a.cloudError.isNotBlank()) Text(a.cloudError, color = c.error, style = LaoType.caption)
    }
    LaoPrimaryButton(
        if (saving) "正在保存…" else "保存个人主页",
        Modifier.fillMaxWidth(),
        enabled = !saving,
    ) {
        saving = true
        a.cloudError = ""
        CampusSocial.saveProfile(a, gender, bio, cover) { s.closeSheet() }
    }
}
