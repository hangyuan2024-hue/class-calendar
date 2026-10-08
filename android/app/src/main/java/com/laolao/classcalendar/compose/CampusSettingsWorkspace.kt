package com.laolao.classcalendar

import android.content.Intent
import android.net.Uri
import android.provider.Settings
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
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

private data class CampusSetting(
    val title: String,
    val detail: String,
    val group: String,
    val icon: ImageVector,
    val keywords: String = "",
    val toggle: Boolean? = null,
    val action: (CampusSession) -> Unit,
)

private fun settingsCatalog(s: CampusSession): List<CampusSetting> {
    val a = s.a
    val palette = a.store.`object`("ui_palette_v1").optString("id", "ocean")
    val mode =
        when (a.store.string("compose_mode_v1", "system")) {
            "dark" -> "深色"
            "light" -> "明亮"
            else -> "跟随系统"
        }
    val list =
        mutableListOf(
            CampusSetting("账号与安全", "密码、登录信息与账号保护", "账号", Icons.Rounded.Shield, "修改密码 学号 安全") {
                it.open("security")
            },
            CampusSetting(
                "个人资料与封面",
                "头像、性别、简介和校园主页",
                "账号",
                Icons.Rounded.AccountCircle,
                "男 女 保密 个人主页",
            ) {
                if (it.a.requireLogin()) it.sheet = ProfileEditorSheet
            },
            CampusSetting("我的班级", "加入班级、分组和成员管理", "账号", Icons.Rounded.Groups, "邀请码 班委 老师 成员") {
                it.open("class")
            },
            CampusSetting(
                "外观与配色",
                (LaoPalettes.firstOrNull { it.id == palette }?.name ?: "默认 · 海盐青") + " · " + mode,
                "外观",
                Icons.Rounded.Palette,
                "皮肤 主题 深空蓝 海盐青 深色 明亮 夜间 跟随系统 减少动画 动效 透明",
            ) {
                it.open("appearance")
            },
            CampusSetting("显示模式", mode, "外观", Icons.Rounded.DarkMode, "明亮 深色 夜间 跟随系统 自动") {
                displayModeSettings(it)
            },
            CampusSetting(
                "减少动态效果",
                "减少页面移动和小人的呼吸动作",
                "外观",
                Icons.Rounded.Animation,
                "关闭动画 静态 动效",
                toggle = a.store.bool("compose_reduce_motion_v1", false),
            ) {
                it.a.store.set(
                    "compose_reduce_motion_v1",
                    !it.a.store.bool("compose_reduce_motion_v1", false),
                )
                it.a.build()
            },
            CampusSetting(
                "校园主页布局",
                "预览、排序、模块与信息密度",
                "外观",
                Icons.Rounded.DashboardCustomize,
                "首页 编辑主页 轻盈 丰富",
            ) {
                it.sheet = HomeEditorSheet
            },
            CampusSetting(
                "常用工具收藏",
                "把喜欢的工具放在首页和工具架",
                "外观",
                Icons.Rounded.BookmarkBorder,
                "快捷 添加工具 工具栏",
            ) {
                it.sheet = ToolPickerSheet
            },
            CampusSetting(
                "课表与学期",
                "开学日期、节次时间与课程显示",
                "学习",
                Icons.Rounded.School,
                "周次 周一 上课时间 学期设置",
            ) {
                CampusCourses.settings(it.a)
            },
            CampusSetting(
                "专注与休息",
                "专注时长、自动休息与声音提醒",
                "学习",
                Icons.Rounded.Timelapse,
                "番茄钟 分钟 长休息 铃声",
            ) {
                focusSettings(it)
            },
            CampusSetting(
                "成长与显示偏好",
                "完成记录、日历筛选和成长模块",
                "学习",
                Icons.Rounded.Insights,
                "隐藏已完成 鼓励 习惯 小云朵 规划 进度",
            ) {
                growthDisplaySettings(it)
            },
            CampusSetting(
                "系统提醒",
                "课前、作业、自定义提醒与提前时间",
                "通知",
                Icons.Rounded.NotificationsNone,
                "通知 权限 提前分钟 自动提醒规则 电池 后台",
            ) {
                it.open("reminders")
            },
            CampusSetting(
                "自动提醒规则",
                "选择课前提醒、作业提醒与提前分钟",
                "通知",
                Icons.Rounded.Alarm,
                "提前时间 课前分钟 自动提醒",
            ) {
                CampusPhone.reminderRules(it.a)
            },
            CampusSetting("提示小人", "小人显示与提醒偏好", "通知", Icons.Rounded.AutoAwesome, "捞捞 吉祥物 助手 小人设置") {
                CampusGuide.settings(it.a)
            },
            CampusSetting(
                "上课自动勿扰",
                if (a.store.bool("native_quiet", false)) "已开启 · 根据课表切换" else "未开启 · 由你决定何时安静",
                "通知",
                Icons.Rounded.DoNotDisturbOn,
                "免打扰 安静 勿扰权限",
            ) {
                it.open("quiet")
            },
            CampusSetting(
                "邮箱通知",
                "邮箱绑定、验证码和订阅偏好",
                "通知",
                Icons.Rounded.AlternateEmail,
                "邮件 通知 测试邮箱 退订",
            ) {
                it.open("mail")
            },
            CampusSetting(
                "应用权限",
                "相机、麦克风、位置与通知权限",
                "通知",
                Icons.Rounded.AdminPanelSettings,
                "授权 录音 拍照 定位 摄像头",
            ) {
                it.open("permissions")
            },
            CampusSetting(
                "备份与恢复",
                "导出完整备份、导入数据和账号同步",
                "数据",
                Icons.Rounded.CloudSync,
                "导出 导入 JSON 附件 恢复 本地 云端 同步",
            ) {
                it.open("backup")
            },
            CampusSetting(
                "日记设备验证",
                if (a.store.bool("native_diary_lock", false)) "已开启 · 用设备验证保护日记"
                else "未开启 · 可以使用设备验证",
                "数据",
                Icons.Rounded.Fingerprint,
                "隐私 指纹 面容 锁 密码 私密",
            ) {
                it.open("privacy")
            },
            CampusSetting(
                "AI 服务连接",
                "配置自己的 AI 服务、模型与连接参数",
                "数据",
                Icons.Rounded.Hub,
                "助手 接口 API 模型 key URL 服务设置",
            ) {
                CampusSocial.aiSettings(it.a)
            },
            CampusSetting(
                "关于捞捞课程表",
                "版本 " + BuildConfig.VERSION_NAME,
                "关于",
                Icons.Rounded.Info,
                "版本 更新 协议 帮助",
            ) {
                it.open("about")
            },
            CampusSetting(
                "功能与使用说明",
                "课程、班级和工具的使用方法",
                "关于",
                Icons.Rounded.AutoStories,
                "功能介绍 帮助 新手 指南",
            ) {
                it.open("intro")
            },
            CampusSetting(
                "贡献名单",
                "认识一起建设校园空间的伙伴",
                "关于",
                Icons.Rounded.FavoriteBorder,
                "校园共建者 团队 感谢 开发者",
            ) {
                it.open("credits")
            },
        )
    if (a.staff())
        list +=
            CampusSetting(
                "管理工作台",
                "成员、插件、功能和权限管理",
                "账号",
                Icons.Rounded.ManageAccounts,
                "管理员 老师 班委",
            ) {
                it.open("admin")
            }
    if (!a.api.logged())
        list.add(
            0,
            CampusSetting("登录或注册", "使用原网站账号连接班级", "账号", Icons.Rounded.Login, "注册 学号 账号") {
                it.open("login")
            },
        )
    return list
}

@Composable
internal fun CampusSettingsPage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    var query by rememberSaveable { mutableStateOf("") }
    var category by rememberSaveable { mutableStateOf("全部") }
    val catalog = settingsCatalog(s)
    val shown =
        catalog.filter {
            if (query.isNotBlank())
                (it.title + it.detail + it.group + it.keywords).contains(query.trim(), true)
            else category == "全部" || category == it.group
        }
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "settings-heading") {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("按你的习惯来。", style = LaoType.headline)
                    Text("账号、外观和提醒，都在这里。", style = LaoType.caption, color = c.onSurfaceVariant)
                }
                Box(
                    Modifier.size(48.dp).background(c.primary.copy(alpha = .08f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Rounded.Tune, null, Modifier.size(24.dp), tint = c.primary)
                }
            }
        }
        animatedItem(1, "settings-search") {
            LaoInput(
                query,
                { query = it },
                "",
                Modifier.fillMaxWidth(),
                "搜索设置，例如配色、提醒、备份",
                Icons.Rounded.Search,
                trailing = {
                    if (query.isNotBlank())
                        LaoIconButton(Icons.Rounded.Close, "清空设置搜索", Modifier.size(32.dp)) {
                            query = ""
                        }
                },
            )
        }
        animatedItem(2, "settings-categories") {
            if (query.isBlank())
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(listOf("全部", "账号", "外观", "学习", "通知", "数据", "关于")) { label ->
                        val on = label == category
                        Box(
                            Modifier.heightIn(min = 44.dp)
                                .clip(CircleShape)
                                .background(if (on) c.onSurface else c.surface.copy(alpha = .65f))
                                .laoTap(role = Role.Tab) { category = label }
                                .semantics {
                                    selected = on
                                    contentDescription = "设置分类" + label
                                }
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                label,
                                style = LaoType.caption,
                                color = if (on) c.surface else c.onSurfaceVariant,
                            )
                        }
                    }
                }
            else Text("找到 ${shown.size} 项设置", style = LaoType.caption, color = c.onSurfaceVariant)
        }
        shown
            .groupBy { it.group }
            .entries
            .forEachIndexed { index, (group, entries) ->
                animatedItem(index + 3, "settings-group-" + group) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        LaoSection(
                            group +
                                when (group) {
                                    "账号" -> "与校园"
                                    "外观" -> "与布局"
                                    "学习" -> "习惯"
                                    "通知" -> "与提醒"
                                    "数据" -> "与隐私"
                                    else -> "与支持"
                                }
                        )
                        LaoPanel(Modifier.fillMaxWidth(), padding = 0.dp) {
                            Column {
                                entries.forEachIndexed { i, item ->
                                    SettingCell(item, query.isNotBlank()) {
                                        s.invoke { item.action(s) }
                                    }
                                    if (i < entries.lastIndex)
                                        HorizontalDivider(
                                            Modifier.padding(start = 72.dp, end = 16.dp),
                                            color = c.outlineVariant.copy(alpha = .45f),
                                        )
                                }
                            }
                        }
                    }
                }
            }
        if (shown.isEmpty())
            animatedItem(3, "settings-empty") {
                LaoEmpty("没有找到这项设置", "试试配色、提醒、密码或备份。", "清空搜索") { query = "" }
            }
        if (query.isBlank() && category == "全部" && s.a.api.logged())
            animatedItem(12, "settings-logout") {
                LaoSecondaryButton("退出当前账号", Modifier.fillMaxWidth()) {
                    s.a.ui.confirm("退出账号？", "本机记录会按账号保留。") {
                        s.a.background(
                            "退出登录",
                            {
                                s.a.api.logout()
                                null
                            },
                            { s.a.recreate() },
                        )
                    }
                }
            }
    }
}

@Composable
private fun SettingCell(item: CampusSetting, breadcrumb: Boolean, click: () -> Unit) {
    val c = MaterialTheme.colorScheme
    val hue =
        CampusAccent.readable(
            when (item.group) {
                "外观" -> CampusAccent.berry
                "学习" -> CampusAccent.violet
                "数据" -> CampusAccent.blue
                "关于" -> CampusAccent.amber
                else -> CampusAccent.mint
            }
        )
    Row(
        Modifier.fillMaxWidth().laoTap(role = Role.Button, action = click).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.size(40.dp).background(hue.copy(alpha = .1f), RoundedCornerShape(14.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(item.icon, null, Modifier.size(22.dp), tint = hue)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(item.title, style = LaoType.cell)
            Text(
                (if (breadcrumb) item.group + " · " else "") + item.detail,
                style = LaoType.label,
                color = c.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (item.toggle != null) LaoToggle(item.toggle, { click() })
        else
            Icon(
                Icons.Rounded.ChevronRight,
                null,
                Modifier.size(18.dp),
                tint = c.onSurfaceVariant.copy(alpha = .6f),
            )
    }
}

private fun growthDisplaySettings(s: CampusSession) {
    val opts = CampusJson.copy(s.a.store.`object`("fun_opts_v1"))
    for (key in listOf("rings", "habits", "plan", "farm", "confetti")) if (!opts.has(key))
        opts.put(key, true)
    s.a.ui.form(
        "成长与显示偏好",
        opts,
        { value ->
            s.a.store.set("fun_opts_v1", value)
            s.a.build()
            s.a.syncSoon()
        },
        CampusUi.f("hideDone", "日历隐藏已完成事项", "boolean"),
        CampusUi.f("rings", "显示本周进度卡片", "boolean"),
        CampusUi.f("habits", "显示习惯卡片", "boolean"),
        CampusUi.f("plan", "显示规划卡片", "boolean"),
        CampusUi.f("farm", "显示云宠卡片", "boolean"),
        CampusUi.f("confetti", "完成时显示鼓励", "boolean"),
    )
}

private fun displayModeSettings(s: CampusSession) {
    s.a.ui.choose("显示模式", arrayOf("明亮", "深色", "跟随系统")) { i ->
        val mode = listOf("light", "dark", "system")[i]
        s.a.store.set("compose_mode_v1", mode)
        s.a.store.set("ui_skin_v1", if (mode == "dark") "cyber" else "fresh")
        s.a.build()
        s.a.syncSoon()
    }
}

internal fun openAppPermissions(s: CampusSession) {
    s.invoke {
        s.a.startActivity(
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + s.a.packageName),
            )
        )
    }
}
