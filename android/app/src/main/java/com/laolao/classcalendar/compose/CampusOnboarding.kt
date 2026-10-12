package com.laolao.classcalendar

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.isTraversalGroup
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** The root maps these to the existing real native controllers after the introduction closes. */
internal enum class OnboardingShortcut {
    COURSES,
    CLIPBOARD,
    REMINDERS,
    TOOLS,
    LAN,
}

private enum class IntroductionStep(val label: String) {
    WELCOME("认识捞捞"),
    EXPERIENCE("选择界面"),
    IMPORT("装好课表"),
    POCKET("随身更方便"),
    READY("开始使用"),
}

/**
 * A native, scrollable introduction on the app's own edge-to-edge canvas, not a Dialog window.
 * Replaying this composable never clears the completion flag or changes learning records.
 */
@Composable
internal fun CampusOnboarding(
    s: CampusSession,
    experience: UiExperience,
    onExperienceSelected: (UiExperience) -> Unit,
    onCompleted: (OnboardingShortcut?) -> Unit,
) {
    val colors = MaterialTheme.colorScheme
    val motion = LocalMotionEnabled.current
    val gutter = if (LocalConfiguration.current.screenWidthDp < 360) 16.dp else 24.dp
    var index by rememberSaveable { mutableIntStateOf(0) }
    var completing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val steps = IntroductionStep.entries
    val step = steps[index.coerceIn(steps.indices)]

    fun finish(shortcut: OnboardingShortcut? = null) {
        if (completing) return
        completing = true
        try {
            UiExperiencePrefs.completeOnboarding(s.a)
            onCompleted(shortcut)
        } catch (failure: Exception) {
            completing = false
            error = failure.message ?: "暂时无法保存，请重试"
        }
    }

    // Closing the activity on page one leaves the guide incomplete for the next launch.
    BackHandler { if (index > 0) index-- else s.a.finish() }

    Box(
        Modifier.fillMaxSize().background(colors.background).semantics {
            paneTitle = "捞捞课程表使用引导"
            isTraversalGroup = true
        }
    ) {
        Box(
            Modifier.matchParentSize()
                .background(
                    Brush.verticalGradient(
                        listOf(
                            lerp(colors.background, colors.primary, .045f),
                            colors.background,
                            lerp(colors.background, colors.secondary, .025f),
                        )
                    )
                )
                .pointerInput(Unit) { detectTapGestures {} }
        )
        Column(
            Modifier.align(Alignment.TopCenter)
                .widthIn(max = 680.dp)
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = gutter),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(
                Modifier.fillMaxWidth().heightIn(min = 56.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                LaoMascot(Modifier.size(32.dp), expressive = false)
                Text(
                    "捞捞课程表",
                    Modifier.weight(1f).padding(start = 8.dp),
                    style = LaoType.cell,
                    color = colors.onBackground,
                )
                Box(
                    Modifier.heightIn(min = 48.dp)
                        .clip(CircleShape)
                        .laoTap(role = Role.Button, enabled = !completing) { finish() }
                        .padding(horizontal = 16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text("跳过", style = LaoType.caption, color = colors.onSurfaceVariant)
                }
            }
            Row(
                Modifier.fillMaxWidth().semantics {
                    contentDescription = "引导第 ${index + 1} 步，共 ${steps.size} 步：${step.label}"
                },
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                steps.forEachIndexed { position, _ ->
                    val fill by
                        animateFloatAsState(
                            if (position <= index) 1f else .14f,
                            if (motion) spring(.95f, 360f) else snap(),
                            label = "introduction progress $position",
                        )
                    Box(
                        Modifier.weight(1f)
                            .height(3.dp)
                            .background(colors.primary.copy(alpha = fill), CircleShape)
                    )
                }
                Text(
                    "${index + 1} / ${steps.size}",
                    style = LaoType.label,
                    color = colors.onSurfaceVariant,
                )
            }
            AnimatedContent(
                targetState = step,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                transitionSpec = {
                    val direction = if (targetState.ordinal >= initialState.ordinal) 1 else -1
                    if (motion)
                        (fadeIn(tween(220)) +
                                slideInHorizontally(spring(.88f, 350f)) { it / 10 * direction })
                            .togetherWith(
                                fadeOut(tween(100)) +
                                    slideOutHorizontally(tween(180)) { -it / 16 * direction }
                            )
                    else EnterTransition.None.togetherWith(ExitTransition.None)
                },
                label = "native introduction pages",
            ) { current ->
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                ) {
                    when (current) {
                        IntroductionStep.WELCOME -> {
                            item {
                                IntroductionHero(
                                    "把校园日常，\n安排刚刚好。",
                                    "课程、作业、班级和成长，在一个熟悉的地方。用几步认识捞捞，再按你的习惯开始。",
                                    "你好，新伙伴",
                                )
                            }
                            item { WelcomeIllustration() }
                            item {
                                IntroductionFeature(
                                    Icons.Rounded.CalendarMonth,
                                    "先看今天，再安排下一步",
                                    "首页汇集真实的课程、待办与提醒。捞捞小人会帮你抓住重点。",
                                )
                            }
                            item {
                                IntroductionFeature(
                                    Icons.Rounded.Groups,
                                    "你的校园空间，一直都在",
                                    "登录原有账号连接班级；也可以先使用本机课表和学习工具。",
                                )
                            }
                        }
                        IntroductionStep.EXPERIENCE -> {
                            item {
                                IntroductionHero(
                                    "两种界面，\n一种校园日常。",
                                    "保留现有设计，也能切到网页同款。课程和记录共用，之后随时可以再换。",
                                    "按你的习惯来",
                                )
                            }
                            items(UiExperience.entries.size) { position ->
                                val choice = UiExperience.entries[position]
                                ExperiencePreview(choice, experience == choice) {
                                    try {
                                        onExperienceSelected(choice)
                                        error = ""
                                    } catch (failure: Exception) {
                                        error = failure.message ?: "界面选择未保存，请重试"
                                    }
                                }
                            }
                            item {
                                Text(
                                    "之后前往「我的 → 设置 → 界面体验」即可切换。配色与深浅模式仍由你选择。",
                                    style = LaoType.caption,
                                    color = colors.onSurfaceVariant,
                                )
                            }
                        }
                        IntroductionStep.IMPORT -> {
                            item {
                                IntroductionHero(
                                    "不用从头，\n一条条手动输入。",
                                    "先带上自己的课表，再把班群消息整理成安排。每次导入都能先核对。",
                                    "把课表装进口袋",
                                )
                            }
                            item {
                                IntroductionAction(
                                    Icons.Rounded.School,
                                    "导入课程表",
                                    "打开完整课表，使用已有的课程导入与编辑功能。",
                                    "去课程表",
                                    !completing,
                                ) {
                                    finish(OnboardingShortcut.COURSES)
                                }
                            }
                            item {
                                IntroductionAction(
                                    Icons.Rounded.ContentPaste,
                                    "粘贴班群消息",
                                    "复制课程、作业或通知，在日历里粘贴整理；确认内容后再保存。",
                                    "粘贴导入",
                                    !completing,
                                ) {
                                    finish(OnboardingShortcut.CLIPBOARD)
                                }
                            }
                            item {
                                Text(
                                    "现在不导入也没关系。点「继续」先了解其他功能，已有记录会原样保留。",
                                    style = LaoType.caption,
                                    color = colors.onSurfaceVariant,
                                )
                            }
                        }
                        IntroductionStep.POCKET -> {
                            item {
                                IntroductionHero(
                                    "随身的方便，\n让手机来帮忙。",
                                    "提醒、快捷工具和局域网传输，按需要开启。引导过程不会请求权限。",
                                    "校园里的随身伙伴",
                                )
                            }
                            item {
                                IntroductionAction(
                                    Icons.Rounded.NotificationsNone,
                                    "重要安排，提前提醒",
                                    "在提醒中心检查课前、作业和自定义通知，再按需设置提前时间。",
                                    "查看提醒中心",
                                    !completing,
                                ) {
                                    finish(OnboardingShortcut.REMINDERS)
                                }
                            }
                            item {
                                IntroductionAction(
                                    Icons.Rounded.Widgets,
                                    "把常用工具放在手边",
                                    "课程、错题本、考试倒计时、校园记账等工具，可以收藏并快捷打开。",
                                    "逛逛工具",
                                    !completing,
                                ) {
                                    finish(OnboardingShortcut.TOOLS)
                                }
                            }
                            item {
                                IntroductionAction(
                                    Icons.Rounded.Wifi,
                                    "和网页互传资料",
                                    "使用局域网传输，让同一网络下的手机和网页交换文字与文件。",
                                    "打开局域网传输",
                                    !completing,
                                ) {
                                    finish(OnboardingShortcut.LAN)
                                }
                            }
                        }
                        IntroductionStep.READY -> {
                            item {
                                IntroductionHero(
                                    "准备好了。\n今天，从这里开始。",
                                    "你不用一次学会所有功能。先看下一节课，记一件要事，再慢慢找到自己的节奏。",
                                    "欢迎来到你的校园",
                                )
                            }
                            item {
                                LaoPanel(Modifier.fillMaxWidth(), color = colors.surface) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                                    ) {
                                        LaoMascot(Modifier.size(72.dp))
                                        Column(
                                            Modifier.weight(1f),
                                            verticalArrangement = Arrangement.spacedBy(8.dp),
                                        ) {
                                            Text("捞捞一直在这儿", style = LaoType.title)
                                            Text(
                                                "轻点提示小人，查看安排与提醒。它不会占用底部导航的位置。",
                                                style = LaoType.body,
                                                color = colors.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                            item {
                                IntroductionFeature(
                                    Icons.Rounded.Add,
                                    "右下角加号，是你的快捷入口",
                                    "记录安排、导入内容或打开常用操作，不必反复寻找页面。",
                                )
                            }
                            item {
                                IntroductionFeature(
                                    Icons.Rounded.Tune,
                                    "一切都能按自己的习惯调整",
                                    "在「我的 → 设置」搜索配色、提醒、布局和备份；也能重新查看这份引导。",
                                )
                            }
                        }
                    }
                }
            }
            if (error.isNotBlank()) Text(error, style = LaoType.caption, color = colors.error)
            Row(
                Modifier.fillMaxWidth().padding(bottom = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (index > 0)
                    LaoSecondaryButton("上一步", Modifier.weight(1f), enabled = !completing) {
                        index--
                    }
                LaoPrimaryButton(
                    if (step == IntroductionStep.READY) "开始我的校园日常"
                    else if (step == IntroductionStep.WELCOME) "认识一下捞捞" else "继续",
                    Modifier.weight(if (index > 0) 1.5f else 1f),
                    enabled = !completing,
                ) {
                    if (index == steps.lastIndex) finish() else index++
                }
            }
        }
    }
}

@Composable
private fun IntroductionHero(title: String, summary: String, eyebrow: String) {
    val c = MaterialTheme.colorScheme
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        LaoEyebrow(eyebrow)
        Text(title, style = LaoType.headline.copy(fontSize = 32.sp), color = c.onBackground)
        Text(
            summary,
            style = LaoType.body.copy(fontSize = 16.sp, lineHeight = 24.sp),
            color = c.onSurfaceVariant,
        )
    }
}

@Composable
private fun IntroductionFeature(icon: ImageVector, title: String, summary: String) {
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier.size(48.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(c.primary.copy(alpha = .08f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, Modifier.size(24.dp), tint = c.primary)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = LaoType.cell, color = c.onSurface)
            Text(summary, style = LaoType.body, color = c.onSurfaceVariant)
        }
    }
}

@Composable
private fun IntroductionAction(
    icon: ImageVector,
    title: String,
    summary: String,
    action: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    LaoPanel(Modifier.fillMaxWidth()) {
        IntroductionFeature(icon, title, summary)
        LaoSecondaryButton(action, Modifier.fillMaxWidth(), enabled, onClick)
    }
}

@Composable
private fun ExperiencePreview(experience: UiExperience, selected: Boolean, onClick: () -> Unit) {
    val c = MaterialTheme.colorScheme
    val shape = RoundedCornerShape(24.dp)
    Column(
        Modifier.fillMaxWidth()
            .clip(shape)
            .background(if (selected) lerp(c.surface, c.primary, .065f) else c.surface)
            .border(
                if (selected) 2.dp else 1.dp,
                if (selected) c.primary else c.outlineVariant,
                shape,
            )
            .laoTap(role = Role.RadioButton, action = onClick)
            .semantics {
                this.selected = selected
                contentDescription = "界面体验：${experience.label}"
            }
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(experience.label, style = LaoType.title, color = c.onSurface)
                Text(experience.summary, style = LaoType.caption, color = c.onSurfaceVariant)
            }
            Box(
                Modifier.size(28.dp)
                    .clip(CircleShape)
                    .background(if (selected) c.primary else c.surfaceContainer),
                contentAlignment = Alignment.Center,
            ) {
                if (selected)
                    Icon(Icons.Rounded.Check, null, Modifier.size(18.dp), tint = c.onPrimary)
            }
        }
        // Abstract native shape previews communicate structure without seeding fake records.
        Canvas(
            Modifier.fillMaxWidth()
                .height(88.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(c.background)
        ) {
            val inset = 12.dp.toPx()
            val gap = 8.dp.toPx()
            val h = size.height - inset * 2
            if (experience == UiExperience.STUDIO) {
                val w = (size.width - inset * 2 - gap) * .6f
                drawRoundRect(
                    c.primary.copy(alpha = .82f),
                    Offset(inset, inset),
                    Size(w, h),
                    CornerRadius(12.dp.toPx()),
                )
                val side = size.width - inset * 2 - gap - w
                drawRoundRect(
                    c.primary.copy(alpha = .12f),
                    Offset(inset + w + gap, inset),
                    Size(side, (h - gap) / 2),
                    CornerRadius(8.dp.toPx()),
                )
                drawRoundRect(
                    c.secondary.copy(alpha = .12f),
                    Offset(inset + w + gap, inset + (h + gap) / 2),
                    Size(side, (h - gap) / 2),
                    CornerRadius(8.dp.toPx()),
                )
                drawRoundRect(
                    c.onPrimary.copy(alpha = .8f),
                    Offset(inset * 2, inset * 2),
                    Size(w * .55f, 4.dp.toPx()),
                    CornerRadius(2.dp.toPx()),
                )
            } else {
                val w = size.width - inset * 2
                drawRoundRect(
                    c.primary.copy(alpha = .12f),
                    Offset(inset, inset),
                    Size(w, h * .36f),
                    CornerRadius(8.dp.toPx()),
                )
                val bottom = (w - gap * 2) / 3
                repeat(3) { cell ->
                    drawRoundRect(
                        c.primary.copy(alpha = if (cell == 0) .48f else .10f),
                        Offset(inset + cell * (bottom + gap), inset + h * .36f + gap),
                        Size(bottom, h * .64f - gap),
                        CornerRadius(8.dp.toPx()),
                    )
                }
            }
        }
    }
}

@Composable
private fun WelcomeIllustration() {
    val c = MaterialTheme.colorScheme
    Box(
        Modifier.fillMaxWidth()
            .height(176.dp)
            .clip(RoundedCornerShape(32.dp))
            .background(Brush.linearGradient(listOf(lerp(c.surface, c.primary, .08f), c.surface))),
        contentAlignment = Alignment.Center,
    ) {
        LaoPaperArt(
            Modifier.align(Alignment.CenterEnd).padding(end = 16.dp).size(120.dp),
            c.primary,
        )
        LaoPaperArt(
            Modifier.align(Alignment.CenterStart).padding(start = 16.dp).size(88.dp),
            c.secondary,
        )
        LaoMascot(Modifier.size(112.dp))
        Text(
            "你的课表，你的节奏",
            Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
            style = LaoType.caption.copy(fontWeight = FontWeight.SemiBold),
            color = c.onSurfaceVariant,
        )
    }
}
