package com.laolao.classcalendar

import org.json.JSONObject

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.*

/** The current site's real account form, with native IME, secure in-memory passwords and RPCs. */
@Composable
internal fun WebAuthPage(s: CampusSession, signup: Boolean) {
    val c = WebDesign.colors()
    val focus = LocalFocusManager.current
    val keyboard = campusKeyboardVisible()
    var account by rememberSaveable { mutableStateOf("") }
    var name by rememberSaveable { mutableStateOf("") }
    var gender by rememberSaveable { mutableStateOf("") }
    var role by rememberSaveable { mutableStateOf("student") }
    var orgType by rememberSaveable { mutableStateOf("university") }
    var orgName by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var reveal by remember { mutableStateOf(false) }
    var recovery by rememberSaveable { mutableIntStateOf(0) }
    var code by rememberSaveable { mutableStateOf("") }
    var helper by remember { mutableStateOf("") }
    var error by remember { mutableStateOf("") }
    val legal = remember { s.a.getSharedPreferences("laolao_legal_v1", Context.MODE_PRIVATE) }
    var agreed by rememberSaveable {
        mutableStateOf(!signup && legal.getString("accepted", "") == "2026-10-10")
    }
    val accountFocus = remember { FocusRequester() }
    val passwordFocus = remember { FocusRequester() }
    val confirmFocus = remember { FocusRequester() }
    val nameFocus = remember { FocusRequester() }
    val busy = s.a.loading
    val message = error.ifBlank { s.a.cloudError }
    fun resetError() {
        error = ""
        s.a.cloudError = ""
    }
    fun validate(): Boolean {
        error =
            when {
                !account.trim().lowercase().matches(Regex("[a-z0-9_]{3,20}")) ->
                    "账号需为 3–20 位小写字母、数字或下划线"
                signup && name.isBlank() -> "请填写同学们认识的姓名"
                signup && gender.isBlank() -> "请选择男生、女生或暂不公开"
                password.isEmpty() -> "请填写密码"
                signup && password.length < 8 -> "密码至少 8 位"
                signup && confirmation != password -> "两次输入的密码不一致"
                !agreed -> "请先阅读并同意用户协议和隐私政策"
                else -> ""
            }
        return error.isEmpty()
    }
    fun submit() {
        if (busy || !validate()) return
        focus.clearFocus()
        legal.edit().putString("accepted", "2026-10-10").apply()
        s.a.authenticate(account.trim(), password, name.trim(), role, gender, signup,
            if (signup) CampusJson.obj("org_type", orgType, "org_name", orgName) else JSONObject())
    }
    fun sendRecovery() {
        if (busy) return
        resetError()
        if (!account.trim().lowercase().matches(Regex("[a-z0-9_]{3,20}"))) {
            error = "请输入正确的账号"
            return
        }
        focus.clearFocus()
        s.a.loading = true
        s.a.build()
        s.a.rpc("pw_reset_start", CampusJson.obj("acct", account.trim().lowercase())) { raw ->
            s.a.loading = false
            val result = CampusJson.`object`(raw)
            if (result.optBoolean("ok")) {
                recovery = 2
                helper = "验证码已发到绑定的邮箱 ${result.optString("email")}，15 分钟内有效。"
            } else
                helper =
                    if (result.optString("why") == "no_email") "这个账号还没有绑定邮箱，请联系班主任重置临时密码。"
                    else "邮箱找回暂不可用，请联系班主任重置临时密码。"
            s.a.build()
        }
    }
    fun finishRecovery() {
        if (busy) return
        resetError()
        error =
            when {
                !code.matches(Regex("\\d{6}")) -> "验证码是 6 位数字"
                password.length < 8 -> "新密码至少 8 位"
                confirmation != password -> "两次输入的新密码不一致"
                else -> ""
            }
        if (error.isNotEmpty()) return
        focus.clearFocus()
        s.a.loading = true
        s.a.build()
        s.a.rpc(
            "pw_reset_finish",
            CampusJson.obj("acct", account.trim().lowercase(), "code", code, "newpw", password),
        ) {
            s.a.loading = false
            s.a.authenticate(account.trim(), password, "", "student", "", false)
        }
    }
    DisposableEffect(s, recovery) {
        val back: () -> Boolean = {
            if (recovery != 0) {
                if (!busy) {
                    recovery = 0
                    resetError()
                }
                true
            } else false
        }
        s.pageBack = back
        onDispose { if (s.pageBack === back) s.pageBack = null }
    }
    LazyColumn(
        Modifier.fillMaxSize().background(c.bg).imePadding(),
        state = LocalPageListState.current ?: rememberLazyListState(),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        item("web-auth-brand") {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier.size(36.dp).clip(RoundedCornerShape(12.dp)).background(c.primary),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Rounded.EventAvailable,
                        null,
                        Modifier.size(23.dp),
                        tint = Color.White,
                    )
                }
                Text("捞捞课程表", style = WebDesign.title, color = c.ink)
            }
        }
        item("web-auth-welcome") {
            AnimatedVisibility(!keyboard) {
                Box {
                    Canvas(Modifier.matchParentSize()) {
                        drawCircle(
                            c.sage.copy(alpha = .8f),
                            size.height * .65f,
                            Offset(size.width * .02f, size.height * .48f),
                        )
                    }
                    Column(
                        Modifier.fillMaxWidth().padding(vertical = 20.dp, horizontal = 6.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Text(
                            "WELCOME TO YOUR CAMPUS",
                            style = WebDesign.eyebrow.copy(letterSpacing = 1.5.sp),
                            color = c.primary,
                        )
                        Column {
                            Text(
                                "群消息太多？",
                                fontSize = 30.sp,
                                lineHeight = 40.sp,
                                fontWeight = FontWeight.Bold,
                                color = c.ink,
                            )
                            Row {
                                Text(
                                    "捞捞",
                                    fontSize = 30.sp,
                                    lineHeight = 40.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = c.primary,
                                )
                                Text(
                                    "帮你理清楚",
                                    fontSize = 30.sp,
                                    lineHeight = 40.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = c.ink,
                                )
                            }
                        }
                        Text(
                            "作业、通知、活动自动整理成日历。登录同一账号，你的待办都在。",
                            style = WebDesign.body,
                            color = c.sub,
                        )
                        Text(
                            "↗ 课程与待办，在一起    ✓ 手机和电脑，同步安排",
                            style = WebDesign.eyebrow,
                            color = c.ink,
                        )
                    }
                }
            }
        }
        item("web-auth-form") {
            WebCard(Modifier.fillMaxWidth(), padding = 22.dp) {
                Row(Modifier.fillMaxWidth()) {
                    Text(
                        "你的校园，从这里继续",
                        Modifier.weight(1f),
                        style = WebDesign.caption,
                        color = c.sub,
                    )
                    Text("↗", color = c.primary, fontSize = 20.sp)
                }
                HorizontalDivider(Modifier.padding(vertical = 10.dp), color = c.line)
                Text(
                    if (recovery != 0) "找回密码" else if (signup) "创建你的账号 ✨" else "欢迎回来 👋",
                    style = WebDesign.headline,
                    color = c.ink,
                )
                Text(
                    if (recovery != 0) "使用你绑定的邮箱验证账号"
                    else if (signup) "一分钟搞定，账号不需要邮箱和手机号" else "登录后查看你的捞捞课程表",
                    style = WebDesign.body,
                    color = c.sub,
                )
                if (recovery == 0)
                    Row(
                        Modifier.fillMaxWidth()
                            .padding(vertical = 10.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(c.bg)
                            .padding(4.dp)
                    ) {
                        listOf(false to "登录", true to "注册新账号").forEach { (register, label) ->
                            Box(
                                Modifier.weight(1f)
                                    .heightIn(min = 36.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(
                                        if (signup == register) c.card else Color.Transparent
                                    )
                                    .laoTap {
                                        if (signup != register)
                                            s.open(if (register) "register" else "login")
                                    }
                                    .padding(8.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    label,
                                    style =
                                        WebDesign.caption.copy(fontWeight = FontWeight.SemiBold),
                                    color = if (signup == register) c.ink else c.sub,
                                )
                            }
                        }
                    }
                WebCredential(
                    account,
                    {
                        account = it.take(20)
                        resetError()
                    },
                    "账号",
                    "学号或自己起的账号",
                    Icons.Rounded.PersonOutline,
                    !busy,
                    Modifier.focusRequester(accountFocus),
                    keyboard =
                        KeyboardOptions(
                            keyboardType = KeyboardType.Ascii,
                            autoCorrectEnabled = false,
                            imeAction = ImeAction.Next,
                        ),
                    actions =
                        KeyboardActions(
                            onNext = {
                                if (signup && recovery == 0) nameFocus.requestFocus()
                                else passwordFocus.requestFocus()
                            }
                        ),
                )
                if (signup && recovery == 0) {
                    Text("3–20 位小写字母、数字或下划线，比如学号", style = WebDesign.caption, color = c.sub)
                    Text(
                        "我是",
                        Modifier.padding(top = 6.dp),
                        style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
                        color = c.ink,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        listOf("m" to "男生", "f" to "女生").forEach { (id, label) ->
                            Column(
                                Modifier.weight(1f)
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(if (gender == id) c.selected else c.card)
                                    .border(
                                        if (gender == id) 2.dp else 1.dp,
                                        if (gender == id) c.primary else c.line,
                                        RoundedCornerShape(12.dp),
                                    )
                                    .laoTap {
                                        gender = id
                                        resetError()
                                    }
                                    .padding(12.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                CampusAvatar(label, id, Modifier.size(42.dp))
                                Text(
                                    label,
                                    style =
                                        WebDesign.caption.copy(fontWeight = FontWeight.SemiBold),
                                    color = c.ink,
                                )
                                Text(
                                    if (id == "m") "默认晴空蓝主题" else "默认莓果粉主题",
                                    style = WebDesign.caption,
                                    color = c.sub,
                                )
                            }
                        }
                    }
                    WebButton(if (gender == "x") "✓ 暂不公开性别" else "暂不公开性别", filled = false) {
                        gender = "x"
                        resetError()
                    }
                    Text(
                        "身份",
                        style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
                        color = c.ink,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        WebPill("学生", role == "student", Modifier.weight(1f)) { role = "student" }
                        WebPill("老师", role == "teacher", Modifier.weight(1f)) { role = "teacher" }
                    }
                    WebCredential(
                        name,
                        {
                            name = it
                            resetError()
                        },
                        "姓名",
                        "真实姓名，方便老师审批入班",
                        Icons.Rounded.Badge,
                        !busy,
                        Modifier.focusRequester(nameFocus),
                        keyboard = KeyboardOptions(imeAction = ImeAction.Next),
                        actions = KeyboardActions(onNext = { passwordFocus.requestFocus() }),
                    )
                }
                if (signup && recovery == 0) {
                    OrganizationFields(orgType, orgName) { type, value -> orgType = type; orgName = value }
                }
                if (recovery == 2) {
                    Text(helper, style = WebDesign.caption, color = c.sub)
                    WebCredential(
                        code,
                        {
                            code = it.filter(Char::isDigit).take(6)
                            resetError()
                        },
                        "验证码",
                        "6 位数字",
                        Icons.Rounded.VerifiedUser,
                        !busy,
                        keyboard =
                            KeyboardOptions(
                                keyboardType = KeyboardType.Number,
                                imeAction = ImeAction.Next,
                            ),
                        actions = KeyboardActions(onNext = { passwordFocus.requestFocus() }),
                    )
                }
                if (recovery != 1) {
                    WebCredential(
                        password,
                        {
                            password = it
                            resetError()
                        },
                        if (recovery == 2) "新密码" else "密码",
                        "至少 8 位",
                        Icons.Rounded.Lock,
                        !busy,
                        Modifier.focusRequester(passwordFocus),
                        if (reveal) VisualTransformation.None else PasswordVisualTransformation(),
                        KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            imeAction =
                                if (signup || recovery == 2) ImeAction.Next else ImeAction.Done,
                        ),
                        KeyboardActions(
                            onNext = { confirmFocus.requestFocus() },
                            onDone = { submit() },
                        ),
                        trailing = {
                            IconButton(
                                onClick = { reveal = !reveal },
                                modifier = Modifier.size(38.dp),
                            ) {
                                Icon(
                                    if (reveal) Icons.Rounded.VisibilityOff
                                    else Icons.Rounded.Visibility,
                                    if (reveal) "隐藏密码" else "显示密码",
                                    Modifier.size(19.dp),
                                    tint = c.sub,
                                )
                            }
                        },
                    )
                    if (signup || recovery == 2)
                        WebCredential(
                            confirmation,
                            {
                                confirmation = it
                                resetError()
                            },
                            "确认密码",
                            "再输入一次密码",
                            Icons.Rounded.Lock,
                            !busy,
                            Modifier.focusRequester(confirmFocus),
                            PasswordVisualTransformation(),
                            KeyboardOptions(
                                keyboardType = KeyboardType.Password,
                                imeAction = ImeAction.Done,
                            ),
                            KeyboardActions(
                                onDone = { if (recovery == 2) finishRecovery() else submit() }
                            ),
                        )
                }
                if (!signup && recovery == 0)
                    WebButton("忘记密码？", Modifier.align(Alignment.End), filled = false) {
                        recovery = 1
                        resetError()
                        helper = ""
                    }
                if (recovery == 1 && helper.isNotEmpty())
                    Text(helper, style = WebDesign.body, color = c.sub)
                if (recovery == 0) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                        Checkbox(
                            agreed,
                            {
                                agreed = it
                                resetError()
                            },
                            colors = CheckboxDefaults.colors(checkedColor = c.primary),
                            modifier = Modifier.size(38.dp),
                        )
                        Column(
                            Modifier.weight(1f),
                            verticalArrangement = Arrangement.spacedBy(4.dp),
                        ) {
                            Text("我已阅读并同意", style = WebDesign.caption, color = c.sub)
                            Row {
                                WebButton("用户协议", filled = false) {
                                    s.sheet = MessageSheet("用户协议", WebLegal.terms, listOf("已阅读")) {}
                                }
                                WebButton("隐私政策", filled = false) {
                                    s.sheet =
                                        MessageSheet("隐私政策", WebLegal.privacy, listOf("已阅读")) {}
                                }
                            }
                            if (signup)
                                Text("未满 14 周岁请在监护人同意后使用", style = WebDesign.caption, color = c.sub)
                        }
                    }
                }
                if (message.isNotBlank())
                    Text(
                        message,
                        Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.error.copy(alpha = .06f))
                            .padding(10.dp)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                        style = WebDesign.caption,
                        color = MaterialTheme.colorScheme.error,
                    )
                if (busy)
                    LinearProgressIndicator(
                        Modifier.fillMaxWidth(),
                        color = c.primary,
                        trackColor = c.selected,
                    )
                WebButton(
                    if (busy) "正在连接…"
                    else if (recovery == 1) "发送验证码"
                    else if (recovery == 2) "设置新密码并登录" else if (signup) "注册并开始" else "登录",
                    Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    enabled = !busy,
                ) {
                    when (recovery) {
                        1 -> sendRecovery()
                        2 -> finishRecovery()
                        else -> submit()
                    }
                }
                if (recovery != 0)
                    WebButton(
                        "返回登录",
                        Modifier.align(Alignment.CenterHorizontally),
                        filled = false,
                    ) {
                        recovery = 0
                        resetError()
                        password = ""
                        confirmation = ""
                    }
                else {
                    HorizontalDivider(Modifier.padding(top = 12.dp), color = c.line)
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                        WebButton("功能介绍", filled = false) { s.open("intro") }
                        WebButton("先体验一下 →", filled = false) {
                            focus.clearFocus()
                            s.a.tab("home")
                        }
                    }
                }
            }
        }
        item("web-auth-footer") {
            Text(
                "捞捞课程表 · 信息捞捞队",
                Modifier.fillMaxWidth(),
                style = WebDesign.caption,
                color = c.sub,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center,
            )
        }
    }
}

@Composable
private fun WebCredential(
    value: String,
    change: (String) -> Unit,
    label: String,
    placeholder: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    transformation: VisualTransformation = VisualTransformation.None,
    keyboard: KeyboardOptions = KeyboardOptions.Default,
    actions: KeyboardActions = KeyboardActions.Default,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = WebDesign.colors()
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            label,
            Modifier.padding(top = 8.dp),
            style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
            color = c.ink,
        )
        OutlinedTextField(
            value,
            change,
            Modifier.fillMaxWidth().then(modifier),
            enabled = enabled,
            singleLine = true,
            textStyle = WebDesign.body,
            placeholder = { Text(placeholder, style = WebDesign.body, color = c.sub) },
            leadingIcon = { Icon(icon, null, Modifier.size(18.dp), tint = c.sub) },
            trailingIcon = trailing,
            shape = RoundedCornerShape(11.dp),
            visualTransformation = transformation,
            keyboardOptions = keyboard,
            keyboardActions = actions,
            colors =
                OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = c.primary,
                    unfocusedBorderColor = c.line,
                    focusedContainerColor = c.card,
                    unfocusedContainerColor = c.bg.copy(alpha = .45f),
                    focusedTextColor = c.ink,
                    unfocusedTextColor = c.ink,
                    cursorColor = c.primary,
                ),
        )
    }
}

/** Exact public policy texts from the reference site; no browser is needed to read them. */
private object WebLegal {
    val terms: String
        get() = WEB_TERMS

    val privacy: String
        get() = WEB_PRIVACY
}

private val WEB_TERMS =
    """
捞捞课程表用户协议
更新日期：2026年10月10日　·　生效日期：2026年10月10日
欢迎使用捞捞课程表（下称「本服务」）。本服务由学生团队信息捞捞队（下称「我们」）开发和运营，帮助同学和老师整理课表、作业、班级通知和学习计划。
    注册、登录或使用本服务前，请仔细阅读本协议和《隐私政策》，特别是加粗的内容。勾选「我已阅读并同意」或者继续使用，即表示你同意本协议。
一、账号
你可以用自己设置的账号（3~20 位字母、数字或下划线）和密码注册。注册时需要填写姓名、选择身份（学生 / 老师），学校 / 单位可以不填。
请填写真实姓名，方便老师审批入班、同学认出你。不要冒用他人姓名、学号或冒充老师、管理员。
账号和密码由你自己保管，不要告诉别人。因为你泄露密码造成的损失由你自己承担；发现账号被盗用，请尽快修改密码并联系我们。
账号只限你本人使用，不得出借、转让或出售。
不满 14 周岁的用户，请在父母或其他监护人的陪同和同意下阅读本协议和《隐私政策》后再使用本服务。不满 18 周岁的用户，请在监护人指导下使用。
二、服务内容
本服务目前包括：班级事项（作业、通知、活动）的日历和提醒、AI 整理班级群消息、课程表（拍照导入、调课）、个人待办和计划、成长打卡、班级墙、学习资料整理、思维导图、邮件提醒和手机日历订阅等。具体功能以网站、小程序和 App 中实际提供的为准，我们可能会增加、调整或停止部分功能。
本服务目前免费提供。我们是学生团队，会尽力保证服务稳定，但不保证服务不中断、没有错误，也可能因为维护、升级或不可抗力暂停服务。
三、AI 整理的内容
「AI 整理」会把你或班委粘贴的群消息交给人工智能模型，自动提取作业、截止时间、地点等信息。AI 整理的结果由人工智能生成，可能有遗漏或错误，一切以老师和班级群里的原始通知为准。
「拍照导入课表」由程序识别图片里的文字，结果请在保存前核对。
请不要把与学习无关的、他人隐私的或者违法的内容交给 AI 整理。
四、使用规范
使用本服务时，你不得发布、传播以下内容，也不得进行以下行为：
违反宪法和法律法规，危害国家安全、荣誉和利益，破坏民族团结，宣扬恐怖主义、极端主义，散布谣言扰乱社会秩序的内容；
淫秽、色情、赌博、暴力、凶杀、恐怖或者教唆犯罪的内容；
侮辱、诽谤、骚扰、欺凌他人，泄露他人隐私（如手机号、住址、身份证号、成绩），侵犯他人知识产权或其他合法权益的内容；
广告、垃圾信息、诈骗信息；
攻击、破解、扫描本服务，批量注册账号，用程序刷接口，或者干扰本服务正常运行的行为。
班级墙、评论等内容会被班级里的其他人看到，请文明发言。你对自己发布的内容负责。违反以上规定的，老师、班委、管理员可以删除相关内容；情节严重的，我们可以限制或停止你的账号，并依法配合有关部门处理。
五、班级和老师
老师创建班级后，可以审批学生入班、任命班委、发布和管理班级事项、给学生重置临时密码。班委可以在老师授权的范围内整理和发布班级事项。
入班后，班级成员能看到你的姓名、身份和你在班级墙发布的内容；老师能看到成员名单。
六、知识产权
本服务的界面设计、程序代码、图标和吉祥物形象等归我们或相关权利人所有。你上传、发布的内容，权利仍归你或原权利人；为了提供服务（如保存、同步、展示给你选择的班级），你允许我们在必要范围内存储和处理这些内容。
插件商店里的插件由各自的作者开发，作者对插件内容负责。
七、免责和责任限制
本服务提供的作业截止时间、课表、提醒等信息仅供参考，请以学校、老师的正式通知为准。因信息不准确、提醒没送达导致错过作业、考试等，我们不承担责任，但会尽力改进。
因黑客攻击、网络故障、第三方服务（如云服务器、短信邮件服务）故障等我们无法控制的原因造成的服务中断或数据问题，我们会尽力补救，但不承担超出法律规定的责任。
八、注销账号
你可以随时停止使用本服务。如需注销账号、删除账号里的全部数据，请laolaokechengbiao@163.com，我们核实是你本人后会在 15 个工作日内处理。如果你是班级的班主任，需要先把班级转交给其他老师。
九、协议的修改
我们可能根据法律法规或功能变化修改本协议。重大修改时，我们会在网站登录页、小程序等位置提示你，并请你重新确认。修改后你继续使用本服务，即表示同意修改后的协议。
十、其他
本协议适用中华人民共和国大陆地区法律。因本协议产生的争议，双方应先友好协商解决。
对本协议有任何疑问、意见或投诉，请laolaokechengbiao@163.com。
"""
        .trimIndent()

private val WEB_PRIVACY =
    """
捞捞课程表隐私政策
更新日期：2026年10月10日　·　生效日期：2026年10月10日
捞捞课程表由学生团队信息捞捞队（下称「我们」）开发和运营。我们很重视你的个人信息，会按照《中华人民共和国个人信息保护法》等法律法规，只收集提供服务所必需的信息，不出售你的个人信息，也不用来投放广告。
    本政策说明我们收集哪些信息、怎么用、存在哪里、和谁共享，以及你有哪些权利。请仔细阅读，特别是加粗的内容。
我们收集哪些信息
信息的使用
本机存储
委托处理和共享
存储地点和期限
安全措施
你的权利
未成年人
政策更新和联系我们
一、我们收集哪些信息
1. 注册和登录（必需）　信息　用来做什么
　账号、密码　登录。密码只保存加密后的结果，我们也看不到原密码
　姓名、身份（学生 / 老师）、性别　显示你的名字、老师审批入班；性别只用来选默认的欢迎页和主题颜色
　学校 / 单位（选填）　显示在个人资料里，方便找到同校的班级
2. 使用功能时产生的信息　功能　收集的信息
　班级　你加入的班级、在班里的身份（班委等）、你在班级墙发的内容和评论
　AI 整理群消息　你粘贴进来的群消息文字（交给大模型整理，原文不单独保存），以及整理出来的事项
　拍照导入课表　你选择的课表截图。图片识别完 10 分钟内删除，识别结果保留 7 天方便重新核对。只有你在导入时主动打开「把截图和核对结果交给管理员」，截图和核对结果才会保存下来给管理员改进识别
　课程表、待办、计划、打卡、学习资料、思维导图　你自己填写或上传的内容，用来在手机、电脑之间同步
　邮件提醒、找回密码（选填）　你绑定的邮箱地址
　手机日历订阅（选填）　为你生成的订阅链接
　微信小程序登录　微信提供的、只代表「你在本小程序里」的编号（openid），用来认出你绑定的账号。我们拿不到你的微信号、手机号和聊天记录
　安全和运行　出错时的错误信息、请求次数（用来防止被刷、排查故障）
我们不会收集你的身份证号、手机号、通讯录、精确位置，也不会读取你手机或电脑里的其他文件；只有你主动选择的图片和文件才会上传。
二、信息的使用
提供你选择使用的功能，比如把群消息整理成日历、在多台设备间同步、按时发提醒；
保障账号和服务的安全，比如限制频繁请求、处理举报；
用不能认出你个人身份的统计数据改进功能（比如某个功能有多少人用）。
如果我们要把你的信息用于本政策没写到的其他目的，会先征得你的同意。
三、本机存储
为了让网页打开更快、离线也能看，我们会在你的浏览器本地存储（localStorage、IndexedDB）和离线缓存里保存登录状态、你的设置和部分数据。我们不使用第三方的广告或统计 Cookie。你可以随时在浏览器设置里清除这些数据，清除后需要重新登录。
「本地整理」「本地 AI 问答」等标明「本地」的功能，在你的设备上运行，内容不会上传。
四、委托处理和共享
我们不会向任何公司、组织或个人出售、出租你的个人信息。为了提供服务，下面这些服务商会按我们的要求处理必要的信息：
　服务商　用途　涉及的信息
　火山引擎（北京字节跳动科技有限公司）　云数据库，存放账号和你保存的数据（服务器在北京）　上面列出的账号和功能数据
　扣子（Coze）平台　运行我们的后台程序：AI 整理群消息（调用平台提供的大模型）、识别课表图片、发送提醒邮件　群消息文字、课表图片、提醒邮件内容和邮箱地址
　腾讯（微信）　微信小程序登录　小程序登录时由微信提供的 openid
　邮件服务商（如 QQ 邮箱）　发送提醒、找回密码邮件　你的邮箱地址和邮件内容
　GitHub Pages　存放网站的网页文件　不存放你的个人信息（只是网页、图片等公开文件）
在班级里，你的姓名、身份和你发布的内容会被同班成员看到，这是班级功能本身需要的。除此之外，只有在法律法规要求、司法或行政机关依法要求时，我们才会提供你的信息。
五、存储地点和期限
你的个人信息存储在中华人民共和国境内。
账号和你保存的数据，在你使用期间一直保存，方便你换设备继续用；你删除某条内容后，我们会从数据库里删除它。
课表截图识别后 10 分钟内删除，识别记录 7 天后删除。
AI 整理时粘贴的群消息原文只用于这一次整理，不单独保存；整理出来的事项保存在班级日历里，老师、班委可以修改和删除。
账号注销后，我们会删除你的个人信息，或者做匿名化处理（法律法规另有规定的除外）。
六、安全措施
全站使用 HTTPS 加密传输；密码加密保存；
数据库按「每个人只能读写自己的数据、班级数据只有班级成员能看」设置访问规则；
后台密钥只保存在服务器上，不会放到网页和小程序里。
如果不幸发生个人信息安全事件，我们会及时告诉你事件情况、可能的影响和我们采取的措施，并按规定向有关部门报告。
七、你的权利
查看和修改：在「我的」里可以查看和修改姓名、学校、密码、邮箱等资料；课表、待办等内容可以随时编辑。
删除：你可以删除自己发布的内容和保存的数据；可以解绑邮箱、微信。
撤回同意：可以关闭邮件提醒、手机日历订阅等功能；撤回不影响之前已经进行的处理。
注销账号：请laolaokechengbiao@163.com，我们核实是你本人后 15 个工作日内注销并删除你的数据。
复制：如需获取你的个人信息副本，也可以联系我们。
八、未成年人
本服务面向学生，可能有未成年人使用。如果你不满 14 周岁，请在父母或其他监护人阅读本政策并同意后再使用。我们只收集提供服务所必需的信息。监护人对孩子的个人信息有疑问，或者想要查看、更正、删除，请联系我们。
九、政策更新和联系我们
我们可能会更新本政策。重大变化（比如收集新的信息、增加新的服务商）时，会在登录页等位置提示并请你重新确认。
对本政策或你的个人信息有任何疑问、意见或投诉，请laolaokechengbiao@163.com。我们会在 15 个工作日内回复。

安卓端说明：录音、相机、位置、设备验证等手机能力，仅在你主动使用对应功能时请求系统权限；授权可以在系统设置中撤回。
"""
        .trimIndent()
