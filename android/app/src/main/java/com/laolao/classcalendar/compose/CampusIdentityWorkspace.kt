package com.laolao.classcalendar

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.autofill.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.*
import kotlinx.coroutines.delay

/** Phone-first entry: a thumb-reachable action, adaptive keyboard and two short signup steps. */
@OptIn(ExperimentalComposeUiApi::class)
@Composable
internal fun CampusAuthPage(s: CampusSession, signup: Boolean) {
    val c = MaterialTheme.colorScheme
    val focus = LocalFocusManager.current
    val keyboard = campusKeyboardVisible()
    val listState = LocalPageListState.current ?: rememberLazyListState()
    val motion = LocalMotionEnabled.current
    var account by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    // Credentials stay in memory only. Never persist passwords as UI saved state or preferences.
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var gender by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("student") }
    var step by rememberSaveable { mutableIntStateOf(0) }
    var reveal by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val accountFocus = remember { FocusRequester() }
    val nameFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    val confirmFocus = remember { FocusRequester() }
    val busy = s.a.loading
    val identity = signup && step == 0
    val message = error.ifBlank { s.a.cloudError }
    LaunchedEffect(step) { listState.scrollToItem(0) }

    fun clearError() {
        error = ""
        s.a.cloudError = ""
    }
    fun continueIdentity() {
        error =
            when {
                gender.isBlank() -> "请选择男生、女生或暂不公开"
                name.isBlank() -> "填写一个同学们认识的名字吧"
                else -> ""
            }
        if (error.isNotBlank()) {
            if (name.isBlank()) nameFocus.requestFocus()
            return
        }
        focus.clearFocus()
        step = 1
    }
    fun submit() {
        if (busy) return
        error =
            when {
                !account.trim().lowercase().matches(Regex("[a-z0-9_]{3,20}")) ->
                    "账号需为 3–20 位字母、数字或下划线"
                password.isBlank() -> "请填写密码"
                signup && password.length < 8 -> "密码至少需要 8 位"
                signup && confirmation != password -> "两次密码不一致"
                signup && (name.isBlank() || gender.isBlank()) -> "先完成你的校园身份"
                else -> ""
            }
        if (error.isNotBlank()) {
            when {
                signup && (name.isBlank() || gender.isBlank()) -> step = 0
                !account.trim().lowercase().matches(Regex("[a-z0-9_]{3,20}")) ->
                    accountFocus.requestFocus()
                signup && confirmation != password && password.length >= 8 ->
                    confirmFocus.requestFocus()
                else -> passwordFocus.requestFocus()
            }
            return
        }
        focus.clearFocus()
        s.a.authenticate(account.trim(), password, name.trim(), role, gender, signup)
    }
    DisposableEffect(s, signup, step, busy) {
        val back: () -> Boolean = {
            if (s.route == "register" && signup && step == 1) {
                if (!busy) {
                    focus.clearFocus()
                    clearError()
                    step = 0
                }
                true
            } else false
        }
        s.pageBack = back
        onDispose { if (s.pageBack === back) s.pageBack = null }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val gutter = if (maxWidth < 360.dp) 16.dp else 24.dp
        Column(Modifier.fillMaxSize().imePadding()) {
            LazyColumn(
                Modifier.weight(1f).fillMaxWidth(),
                state = listState,
                contentPadding =
                    PaddingValues(start = gutter, end = gutter, top = 16.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                item("auth-welcome") {
                    AnimatedVisibility(
                        visible = !keyboard && (!signup || identity),
                        enter =
                            if (motion) fadeIn(tween(180)) + expandVertically(spring(.9f, 450f))
                            else EnterTransition.None,
                        exit =
                            if (motion) fadeOut(tween(100)) + shrinkVertically(spring(.95f, 500f))
                            else ExitTransition.None,
                    ) {
                        AuthWelcome(signup)
                    }
                }
                item("auth-section") {
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (identity) "先认识一下" else if (signup) "设置登录信息" else "登录你的校园",
                                Modifier.weight(1f),
                                style = LaoType.title,
                            )
                            if (signup)
                                Text(
                                    if (identity) "01 / 02" else "02 / 02",
                                    style = LaoType.caption,
                                    color = c.primary,
                                )
                            else
                                LaoTextAction("注册新账号") {
                                    clearError()
                                    focus.clearFocus()
                                    s.open("register")
                                }
                        }
                        if (signup) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                repeat(2) { index ->
                                    val active = index == step
                                    Box(
                                        Modifier.weight(1f)
                                            .height(3.dp)
                                            .clip(CircleShape)
                                            .background(
                                                if (active) c.primary
                                                else c.primary.copy(alpha = .15f)
                                            )
                                    )
                                }
                            }
                        }
                    }
                }
                if (identity) {
                    item("auth-avatar") {
                        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                GenderCard("m", "男生", "晴空蓝", gender, Modifier.weight(1f)) {
                                    gender = "m"
                                    clearError()
                                }
                                GenderCard("f", "女生", "莓果粉", gender, Modifier.weight(1f)) {
                                    gender = "f"
                                    clearError()
                                }
                            }
                            Row(
                                Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    "头像与配色以后都能换。",
                                    Modifier.weight(1f),
                                    style = LaoType.label,
                                    color = c.onSurfaceVariant,
                                )
                                LaoTextAction(if (gender == "x") "✓ 暂不公开" else "暂不公开性别") {
                                    gender = "x"
                                    clearError()
                                }
                            }
                        }
                    }
                    item("auth-name") {
                        LaoInput(
                            name,
                            {
                                name = it
                                clearError()
                            },
                            "怎么称呼你",
                            Modifier.fillMaxWidth(),
                            "同学们认识的名字",
                            Icons.Rounded.Badge,
                            enabled = !busy,
                            keyboard = KeyboardOptions(imeAction = ImeAction.Done),
                            actions = KeyboardActions(onDone = { continueIdentity() }),
                            fieldModifier = Modifier.focusRequester(nameFocus),
                        )
                    }
                    item("auth-role") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("你的校园身份", style = LaoType.caption, color = c.onSurfaceVariant)
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                AuthRole(
                                    "学生",
                                    "课程、成长和同学",
                                    Icons.Rounded.School,
                                    role == "student",
                                    Modifier.weight(1f),
                                ) {
                                    role = "student"
                                }
                                AuthRole(
                                    "老师",
                                    "课程与班级协作",
                                    Icons.Rounded.Groups,
                                    role == "teacher",
                                    Modifier.weight(1f),
                                ) {
                                    role = "teacher"
                                }
                            }
                        }
                    }
                } else {
                    item("auth-fields") {
                        LaoPanel(Modifier.fillMaxWidth(), padding = 16.dp) {
                            AuthCredential(
                                account,
                                {
                                    account = it.take(20)
                                    clearError()
                                },
                                "账号",
                                "学号或自己起的账号",
                                Icons.Rounded.PersonOutline,
                                accountFocus,
                                if (signup) AutofillType.NewUsername else AutofillType.Username,
                                !busy,
                                keyboard =
                                    KeyboardOptions(
                                        autoCorrectEnabled = false,
                                        keyboardType = KeyboardType.Ascii,
                                        imeAction = ImeAction.Next,
                                    ),
                                actions = KeyboardActions(onNext = { passwordFocus.requestFocus() }),
                            )
                            AuthCredential(
                                password,
                                {
                                    password = it
                                    clearError()
                                },
                                "密码",
                                if (signup) "至少 8 位" else "输入你的密码",
                                Icons.Rounded.Lock,
                                passwordFocus,
                                if (signup) AutofillType.NewPassword else AutofillType.Password,
                                !busy,
                                transformation =
                                    if (reveal) VisualTransformation.None
                                    else PasswordVisualTransformation(),
                                keyboard =
                                    KeyboardOptions(
                                        keyboardType = KeyboardType.Password,
                                        imeAction = if (signup) ImeAction.Next else ImeAction.Done,
                                    ),
                                actions =
                                    KeyboardActions(
                                        onNext = { confirmFocus.requestFocus() },
                                        onDone = { submit() },
                                    ),
                                trailing = {
                                    LaoIconButton(
                                        if (reveal) Icons.Rounded.VisibilityOff
                                        else Icons.Rounded.Visibility,
                                        if (reveal) "隐藏密码" else "显示密码",
                                        Modifier.size(32.dp),
                                    ) {
                                        reveal = !reveal
                                    }
                                },
                            )
                            if (signup)
                                AuthCredential(
                                    confirmation,
                                    {
                                        confirmation = it
                                        clearError()
                                    },
                                    "确认密码",
                                    "再输入一次密码",
                                    Icons.Rounded.VerifiedUser,
                                    confirmFocus,
                                    AutofillType.NewPassword,
                                    !busy,
                                    transformation = PasswordVisualTransformation(),
                                    keyboard =
                                        KeyboardOptions(
                                            keyboardType = KeyboardType.Password,
                                            imeAction = ImeAction.Done,
                                        ),
                                    actions = KeyboardActions(onDone = { submit() }),
                                )
                        }
                    }
                    item("auth-account-note") {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                Icons.Rounded.VerifiedUser,
                                null,
                                Modifier.size(16.dp),
                                tint = c.primary,
                            )
                            Text(
                                "与网页版使用同一个账号。",
                                style = LaoType.caption,
                                color = c.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
            Column(
                Modifier.fillMaxWidth()
                    .background(c.background.copy(alpha = .96f))
                    .padding(horizontal = gutter, vertical = 12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                AnimatedVisibility(message.isNotBlank()) {
                    Row(
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(16.dp))
                            .background(c.error.copy(alpha = .07f))
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(Icons.Rounded.ErrorOutline, null, Modifier.size(18.dp), tint = c.error)
                        Text(
                            message,
                            Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
                            style = LaoType.caption,
                            color = c.error,
                        )
                    }
                }
                LaoPrimaryButton(
                    if (busy) "正在连接…"
                    else if (identity) "下一步，设置账号" else if (signup) "注册并开始" else "登录",
                    Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    enabled = !busy,
                ) {
                    if (identity) continueIdentity() else submit()
                }
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    if (signup && step == 1)
                        LaoTextAction("返回修改身份") {
                            focus.clearFocus()
                            clearError()
                            step = 0
                        }
                    else
                        LaoTextAction("先看看，稍后再登录") {
                            focus.clearFocus()
                            s.a.tab("home")
                        }
                    if (!keyboard && signup)
                        LaoTextAction("已有账号，登录") {
                            focus.clearFocus()
                            clearError()
                            s.open(if (signup) "login" else "register")
                        }
                }
            }
        }
    }
}

@Composable
private fun AuthWelcome(signup: Boolean) {
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            LaoEyebrow("你的校园，随身带走。")
            Text(
                if (signup) "你好，新同学。" else "欢迎回来，\n一起捞捞。",
                style =
                    if (signup) LaoType.headline.copy(fontSize = 28.sp, lineHeight = 36.sp)
                    else LaoType.headline,
            )
            Text(
                if (signup) "两小步，开启你的校园空间。" else "课程、成长与同学，都在身边。",
                style = LaoType.caption,
                color = c.onSurfaceVariant,
            )
        }
        Box(Modifier.size(if (signup) 72.dp else 96.dp), contentAlignment = Alignment.Center) {
            LaoPaperArt(Modifier.matchParentSize(), c.primary)
            LaoMascot(Modifier.size(if (signup) 60.dp else 80.dp))
        }
    }
}

@Composable
private fun AuthRole(
    title: String,
    detail: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    selected: Boolean,
    modifier: Modifier,
    click: () -> Unit,
) {
    val c = MaterialTheme.colorScheme
    Column(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(
                if (selected) c.primary.copy(alpha = .075f) else c.surface.copy(alpha = .7f)
            )
            .border(
                1.dp,
                if (selected) c.primary.copy(alpha = .6f) else c.outlineVariant.copy(alpha = .6f),
                RoundedCornerShape(18.dp),
            )
            .laoTap(role = Role.RadioButton, action = click)
            .semantics {
                this.selected = selected
                contentDescription = "选择" + title + "身份"
            }
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                icon,
                null,
                Modifier.size(20.dp),
                tint = if (selected) c.primary else c.onSurfaceVariant,
            )
            Text(title, Modifier.weight(1f), style = LaoType.cell)
            if (selected) Icon(Icons.Rounded.Check, null, Modifier.size(16.dp), tint = c.primary)
        }
        Text(detail, style = LaoType.label, color = c.onSurfaceVariant)
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalFoundationApi::class)
@Composable
private fun AuthCredential(
    value: String,
    onValue: (String) -> Unit,
    label: String,
    placeholder: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    requester: FocusRequester,
    type: AutofillType,
    enabled: Boolean,
    transformation: VisualTransformation = VisualTransformation.None,
    keyboard: KeyboardOptions,
    actions: KeyboardActions,
    trailing: (@Composable () -> Unit)? = null,
) {
    val autofill = LocalAutofill.current
    val tree = LocalAutofillTree.current
    val latest by rememberUpdatedState(onValue)
    val node =
        remember(type) { AutofillNode(autofillTypes = listOf(type), onFill = { latest(it) }) }
    val bring = remember { BringIntoViewRequester() }
    var focused by remember { mutableStateOf(false) }
    val keyboardVisible = campusKeyboardVisible()
    DisposableEffect(tree, node) {
        tree += node
        onDispose {
            tree.children.remove(node.id)
            autofill?.cancelAutofillForNode(node)
        }
    }
    LaunchedEffect(focused, keyboardVisible) {
        if (focused) {
            delay(180)
            bring.bringIntoView()
        }
    }
    LaoInput(
        value,
        onValue,
        label,
        Modifier.fillMaxWidth(),
        placeholder,
        icon,
        enabled = enabled,
        transformation = transformation,
        keyboard = keyboard,
        actions = actions,
        trailing = trailing,
        fieldModifier =
            Modifier.focusRequester(requester)
                .bringIntoViewRequester(bring)
                .onGloballyPositioned { node.boundingBox = it.boundsInWindow() }
                .onFocusChanged { state ->
                    focused = state.isFocused
                    if (focused) autofill?.requestAutofillForNode(node)
                    else autofill?.cancelAutofillForNode(node)
                },
    )
}

@Composable
private fun GenderCard(
    id: String,
    title: String,
    subtitle: String,
    selected: String,
    modifier: Modifier,
    click: () -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val hue = CampusAccent.readable(if (id == "f") CampusAccent.berry else CampusAccent.blue)
    Row(
        modifier
            .clip(RoundedCornerShape(24.dp))
            .background(
                Brush.linearGradient(listOf(hue.copy(alpha = .11f), c.surface.copy(alpha = .8f)))
            )
            .border(
                1.dp,
                if (id == selected) hue else c.outlineVariant.copy(alpha = .6f),
                RoundedCornerShape(24.dp),
            )
            .laoTap(role = Role.RadioButton, action = click)
            .semantics {
                this.selected = id == selected
                contentDescription = "选择" + title
            }
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CampusAvatar(title, id, Modifier.size(40.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = LaoType.cell)
            Text(subtitle, style = LaoType.label, color = c.onSurfaceVariant)
        }
        Canvas(Modifier.size(16.dp)) {
            drawCircle(
                if (id == selected) hue else c.onSurfaceVariant.copy(alpha = .5f),
                style = androidx.compose.ui.graphics.drawscope.Stroke(1.5.dp.toPx()),
            )
            if (id == selected) drawCircle(hue, size.width * .25f)
        }
    }
}

@Composable
internal fun CampusAvatar(name: String, gender: String, modifier: Modifier = Modifier) {
    val c = MaterialTheme.colorScheme
    val girl = gender == "f"
    val hue = if (girl) Color(0xFFF5B8D3) else Color(0xFFB8D3FF)
    Box(
        modifier.clip(CircleShape).background(Brush.linearGradient(listOf(hue, c.surface))),
        contentAlignment = Alignment.Center,
    ) {
        if (gender !in listOf("f", "m"))
            Text(name.take(1).ifBlank { "捞" }, style = LaoType.headline, color = Color(0xFF30385C))
        else
            Canvas(Modifier.fillMaxSize().padding(4.dp)) {
                val scale = size.width / 80f
                drawContext.canvas.save()
                drawContext.canvas.scale(scale, scale)
                val hair = Color(0xFF302840)
                val skin = Color(0xFFFFE4D6)
                if (girl) {
                    drawOval(hair, Offset(12f, 24f), Size(16f, 34f))
                    drawOval(hair, Offset(52f, 24f), Size(16f, 34f))
                }
                drawOval(
                    if (girl) Color(0xFFDE78AB) else Color(0xFF5E83D8),
                    Offset(17f, 57f),
                    Size(46f, 28f),
                )
                drawRoundRect(skin, Offset(34f, 50f), Size(12f, 16f), CornerRadius(5f))
                drawOval(hair, Offset(20f, 10f), Size(40f, 44f))
                drawOval(skin, Offset(23f, 21f), Size(34f, 37f))
                val fringe =
                    Path().apply {
                        moveTo(22f, 27f)
                        lineTo(22f, 18f)
                        cubicTo(31f, 4f, 54f, 10f, 59f, 27f)
                        lineTo(48f, 21f)
                        lineTo(40f, 29f)
                        lineTo(32f, 21f)
                        close()
                    }
                drawPath(fringe, hair)
                drawOval(hair, Offset(30f, 35f), Size(4f, 6f))
                drawOval(hair, Offset(46f, 35f), Size(4f, 6f))
                drawCircle(Color(0xFFF69CB5), 3f, Offset(27f, 44f))
                drawCircle(Color(0xFFF69CB5), 3f, Offset(53f, 44f))
                drawArc(
                    hair,
                    10f,
                    160f,
                    false,
                    Offset(36f, 43f),
                    Size(8f, 6f),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(1.8f),
                )
                if (girl) {
                    val bow =
                        Path().apply {
                            moveTo(51f, 16f)
                            lineTo(44f, 10f)
                            lineTo(44f, 21f)
                            close()
                            moveTo(51f, 16f)
                            lineTo(59f, 10f)
                            lineTo(59f, 21f)
                            close()
                        }
                    drawPath(bow, Color(0xFFFF799D))
                    drawCircle(Color.White, 2.5f, Offset(51f, 16f))
                }
                drawContext.canvas.restore()
            }
    }
}
