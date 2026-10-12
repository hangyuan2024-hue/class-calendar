package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.*

internal val WebMainRoutes = listOf("home", "homework", "growth", "tools", "me")

internal fun webDestination(route: String): String = when (route) {
    "home", "calendar", "ask", "parse-review" -> "home"
    "homework" -> "homework"
    "growth", "farm", "meta", "report", "cards", "review", "habits" -> "growth"
    "me", "settings", "appearance", "home-layout", "login", "register", "class", "wall", "rank",
    "people", "user", "about", "credits", "backup", "security", "mail", "permissions", "lan", "organization" -> "me"
    else -> "tools"
}

@Composable
internal fun WebTopBar(s: CampusSession) {
    // These pages contain their own measured website headers; no duplicate brand app bar.
    if (s.route in WebMainRoutes || s.route == "calendar" || s.route in listOf("login", "register")) {
        Spacer(Modifier.windowInsetsTopHeight(WindowInsets.statusBars))
        return
    }
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().background(c.background).statusBarsPadding()
            .heightIn(min = 48.dp).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = { s.a.onBackPressed() }) {
            Icon(Icons.AutoMirrored.Rounded.ArrowBack, "返回", Modifier.size(21.dp))
        }
        Text(routeTitle(s.route), fontSize = 19.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
        IconButton(onClick = { s.sheet = GuideSheet }) {
            Icon(Icons.Rounded.HelpOutline, "页面使用帮助", Modifier.size(20.dp), tint = c.primary)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun WebBottomNavigation(s: CampusSession, onSelect: (String) -> Unit) {
    val c = MaterialTheme.colorScheme
    val labels = listOf("首页", "作业", "成长", "工具", "我的")
    val icons = listOf(Icons.Rounded.Home, Icons.Rounded.Description, Icons.Rounded.Insights,
        Icons.Rounded.GridView, Icons.Rounded.PersonOutline)
    Column(Modifier.fillMaxWidth().background(c.surface.copy(alpha = .96f)).navigationBarsPadding()) {
        HorizontalDivider(color = c.outlineVariant, thickness = .5.dp)
        Row(Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
            WebMainRoutes.forEachIndexed { index, route ->
                val selected = webDestination(s.route) == route
                Column(
                    Modifier.weight(1f).fillMaxHeight()
                        .semantics { this.selected = selected; role = Role.Tab; contentDescription = labels[index] }
                        .combinedClickable(
                            onClick = { if (route == "tools" && s.route == "tools") CampusToolbox.quickChoose(s.a) else onSelect(route) },
                            onLongClickLabel = if (route == "tools") "快捷打开工具" else null,
                            onLongClick = if (route == "tools") ({ CampusToolbox.quickChoose(s.a) }) else null,
                        ).padding(top = 10.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Box(
                        Modifier.size(44.dp, 27.dp).clip(RoundedCornerShape(9.dp))
                            .background(if (selected) c.primaryContainer else Color.Transparent),
                        contentAlignment = Alignment.Center,
                    ) { Icon(icons[index], null, Modifier.size(20.dp), tint = if (selected) c.primary else c.onSurfaceVariant) }
                    Text(labels[index], fontSize = 12.sp, color = if (selected) c.primary else c.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
internal fun WebFloatingActions(s: CampusSession, modifier: Modifier = Modifier) {
    val c = MaterialTheme.colorScheme
    Row(
        modifier.fillMaxWidth().navigationBarsPadding().padding(start = 12.dp, end = 18.dp, bottom = 78.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (CampusGuide.enabled(s.a)) {
            Box(
                Modifier.size(60.dp).semantics { contentDescription = "捞捞提示小人" }
                    .clip(RoundedCornerShape(16.dp)).clickable { s.sheet = GuideSheet },
                contentAlignment = Alignment.Center,
            ) { LaoMascot(Modifier.size(54.dp)) }
        }
        Spacer(Modifier.weight(1f))
        if (s.route in listOf("home", "calendar", "homework", "wall", "growth", "tools")) Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(13.dp)).background(c.primary)
                .semantics { contentDescription = "快捷操作"; role = Role.Button }
                .laoTap(role = Role.Button) {
                    when (s.route) {
                        "calendar" -> CampusSchool.personalForm(s.a, null)
                        "growth" -> CampusLearn.habitForm(s.a, null)
                        "wall" -> CampusSocial.post(s.a, null)
                        "tools" -> CampusToolbox.quickChoose(s.a)
                        else -> s.sheet = QuickAddSheet
                    }
                },
            contentAlignment = Alignment.Center,
        ) { Icon(Icons.Rounded.Add, null, Modifier.size(28.dp), tint = c.onPrimary) }
    }
}

@Composable
internal fun ExperienceSelector(s: CampusSession) {
    val selected by rememberUiExperience()
    val c = MaterialTheme.colorScheme
    val focus = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    LaoSection("两套界面，随时切换", note = "只切换布局，账号、课程与记录保持一致")
    UiExperience.entries.forEach { experience ->
        LaoPanel(Modifier.fillMaxWidth(), color = if (selected == experience) c.primaryContainer else c.surface,
            onClick = {
                focus.clearFocus()
                keyboard?.hide()
                s.closeSheet()
                UiExperiencePrefs.write(s.a, experience)
            }) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(if (experience == UiExperience.STUDIO) Icons.Rounded.AutoAwesome else Icons.Rounded.Web,
                    null, tint = c.primary)
                Column(Modifier.weight(1f)) {
                    Text(experience.label, style = LaoType.cell)
                    Text(experience.summary, style = LaoType.caption, color = c.onSurfaceVariant)
                }
                Icon(if (selected == experience) Icons.Rounded.CheckCircle else Icons.Rounded.RadioButtonUnchecked,
                    if (selected == experience) "已选择" else "选择${experience.label}", tint = c.primary)
            }
        }
    }
}

@Composable
internal fun CampusWebPage(s: CampusSession, route: String) {
    when (route) {
        "home" -> WebHomePage(s)
        "calendar" -> WebCalendarPage(s)
        "homework" -> WebHomeworkPage(s)
        "growth" -> WebGrowthPage(s)
        "tools" -> WebToolsPage(s)
        "me" -> WebProfilePage(s)
        "login", "register" -> WebAuthPage(s, route == "register")
        else -> ModernPages.Page(s, route)
    }
}
