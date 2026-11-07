package com.laolao.classcalendar.ui

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Cfg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Net
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.Sync
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.str
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** 我的：资料卡、常用入口、班级与学校、关于；设置相关的都在「设置」（SettingsPage） */
class MePage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout

    override fun build(): View {
        val ps = PullScroll(ctx) { done -> a.refreshSoon(force = true) { done() } }
        ps.setBackgroundColor(C.bg)
        body = ps.content.apply { pad(18, 14, 18, 60) }
        return ps
    }

    override fun render() {
        view
        keepScroll(body)
        val me = Store.me
        // 7.x 重新排版（和小程序 1.22 一样）：资料卡 → 常用入口 → 班级与学校 → 关于；设置相关的全部放进右上角「设置」
        val hd = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; pad(2, 6, 0, 12) }
        hd.addView(ctx.text("我的", 26f, C.text, HEAVY), LinearLayout.LayoutParams(0, WRAP, 1f))
        hd.addView(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(12, 8); bg(C.card, 20, C.line); contentDescription = "设置"
            addView(Ic.plain(ctx, "⚙️", 17, C.text), LinearLayout.LayoutParams(dp(17), dp(17)))
            addView(ctx.text("设置", 13.5f, C.text, SEMI).apply { pad(6, 0, 0, 0) })
            tap { a.push(SettingsPage(a)) }
        })
        body.addView(hd)
        // 资料卡：点卡片编辑资料
        val pc = ctx.card(18, 20).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val name = Store.name()
        // 头像（和小程序、网站同一张）：点头像换 / 去掉；没设过显示名字第一个字
        pc.addView(Avatar.view(ctx, name, me?.str("gender") ?: "", 16).apply { tap { avatarMenu() } }, LinearLayout.LayoutParams(dp(56), dp(56)))
        if (!avLoaded && Store.me != null) { avLoaded = true; Bg.load({ Avatar.load() }) { changed, _ -> if (changed == true) render() } }
        val pcc = ctx.col()
        pcc.addView(ctx.text(name.ifEmpty { "加载中…" }, 19f, C.text, HEAVY, 1))
        val roleName = when (me?.str("role")) { "teacher" -> "老师"; "admin" -> "管理员"; "developer" -> "开发者"; else -> if (Store.work()) "职场" else "学生" }
        pcc.addView(ctx.text("账号 " + (me?.str("account") ?: "") + " · " + roleName + (me?.str("org_name")?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), 12.5f, C.sub, lines = 2).apply { margins(t = 3) })
        val lv = ctx.row().apply { margins(t = 6) }
        com.laolao.classcalendar.core.Level.me()?.let { l -> lv.addView(LevelUi.chip(ctx, l.level).apply { tap { a.selectTab(2) } }) }
        Store.role().takeIf { it.isNotEmpty() && it != "学生" }?.let { r -> lv.addView(ctx.chip(r, C.accent, C.selected, 12f).apply { pad(8, 2) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) }) }
        if (lv.childCount > 0) pcc.addView(lv)
        pc.addView(pcc, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(14) })
        pc.addView(ctx.text("编辑 ›", 12.5f, C.sub, SEMI))
        pc.tap { ProfileSheet.open(a, me?.str("gender") ?: "", me?.str("cover") ?: "", me?.str("bio") ?: "") { render() } }
        body.addView(pc)

        // 常用入口：一排四个
        val cls = Store.cls
        val grid = ctx.row().apply { margins(t = 12) }
        fun tile(ic: String, t: String, fn: () -> Unit) = grid.addView(ctx.col().apply {
            gravity = Gravity.CENTER; pad(4, 14); bg(C.card, 18, C.line); springy()
            addView(Ic.tile(ctx, ic, 40), LinearLayout.LayoutParams(dp(40), dp(40)))
            addView(ctx.text(t, 13f, C.text, SEMI, 1).apply { gravity = Gravity.CENTER; margins(t = 8) })
            tap { fn() }
        }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (grid.childCount > 0) leftMargin = dp(10) })
        tile("🏫", if (Store.work()) "团队" else "班级") { a.push(ClassPage(a)) }
        if (cls != null) tile("👥", "成员") { a.push(PeoplePage(a)) }
        tile("👤", "主页") { a.push(UserPage(a)) }
        tile("✉️", "信箱") { a.push(LetterBoxPage(a)) }
        body.addView(grid)

        fun group(title: String, sub: String, vararg rows: Triple<String, String, Pair<String, () -> Unit>>?) {
            val list = rows.filterNotNull(); if (list.isEmpty()) return
            if (title.isNotEmpty()) body.addView(ctx.section(title, sub))
            val g = ctx.card(4, 18).apply { if (title.isEmpty()) margins(t = 14) }
            list.forEachIndexed { i, (ic, t, d) -> if (i > 0) g.addView(ctx.hline()); g.addView(ctx.cell(ic, t, d.first) { d.second() }) }
            body.addView(g)
        }
        fun row(ic: String, t: String, d: String, fn: () -> Unit) = Triple(ic, t, d to fn)
        val open = { u: String -> try { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } catch (_: Exception) { a.toast("打不开浏览器") } }

        val wk = Courses.weekNow()
        // 7.x 分类入口：点进去再看里面的（和「设置」一样）
        val wk0 = wk
        group("", "",
            row("🏫", if (Store.work()) "团队与学习" else "班级与学校", listOfNotNull(cls?.str("name"), me?.str("org_name")?.ifBlank { null }, if (Courses.has()) "${Courses.list().size} 门课" + (if (wk0 > 0) " · 第 $wk0 周" else "") else null).joinToString(" · ").ifEmpty { "班级、学校与院系、课程表" }) { a.push(SubPage(a, if (Store.work()) "团队与学习" else "班级与学校") { b -> classGroup(b) }) },
            row("📖", "关于与帮助", "功能介绍、电脑版、感谢名单、检查更新 · 版本 " + version()) { a.push(SubPage(a, "关于与帮助") { b -> aboutGroup(b) }) })
        body.add(ctx.text("捞捞课程表 安卓版 " + version(), 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 18)
    }
    private fun rows(b: LinearLayout, vararg rows: Triple<String, String, Pair<String, () -> Unit>>?) {
        val list = rows.filterNotNull(); if (list.isEmpty()) return
        val g = ctx.card(4, 18).apply { margins(t = 12) }
        list.forEachIndexed { i, (ic, t, d) -> if (i > 0) g.addView(ctx.hline()); g.addView(ctx.cell(ic, t, d.first) { d.second() }) }
        b.addView(g)
    }
    private fun r3(ic: String, t: String, d: String, fn: () -> Unit) = Triple(ic, t, d to fn)
    private fun web(u: String) { try { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } catch (_: Exception) { a.toast("打不开浏览器") } }
    /** 班级与学校：我的班级、成员、学校与院系、课程表、班级管理、站长后台 */
    private fun classGroup(b: LinearLayout) {
        val me = Store.me; val cls = Store.cls; val wk = Courses.weekNow()
        rows(b,
            r3("🏫", if (Store.work()) "我的团队" else "我的班级", cls?.let { it.str("name") + " · " + Store.role() + if (Store.classes.size > 1) " · 共 ${Store.classes.size} 个" else "" } ?: if (Store.pending.isNotEmpty()) "等老师批准中" else "还没加入，点这里输入班级码") { a.push(ClassPage(a)) },
            if (cls != null) r3("👥", "班级成员", "点头像进入 TA 的主页") { a.push(PeoplePage(a)) } else null,
            r3("🎓", "学校与院系", (me?.str("org_name") ?: "").ifEmpty { "选了学校就自动挂到学校下面，再填上院系" }) { a.push(OrgPage(a)) },
            r3("📚", "课程表", if (Courses.has()) "${Courses.list().size} 门课" + (if (wk > 0) " · 现在是第 $wk 周" else "") else "拍一张课表截图就能导入") { a.push(CoursePage(a)) })
        rows(b,
            if (cls != null && Store.isTeacher) r3("🎛️", "班级管理", "审批同学、任命班委、本班功能开关") { a.push(ClassManagePage(a, cls.str("id"))) } else null,
            if (me?.str("role") in setOf("admin", "developer")) r3("⚙️", "站长后台", "全站功能开关、身份与权限（在网页里打开）") { web(Cfg.SITE + "admin.html") } else null)
    }
    private fun aboutGroup(b: LinearLayout) {
        rows(b,
            r3("📖", "功能介绍", "每个功能怎么用，一图看懂") { a.push(GuidePage(a)) },
            r3("💻", "电脑版", "整周课表铺满屏幕、右下角提醒 · 同一个账号自动同步") { web(Cfg.SITE + "download/") },
            r3("💛", "感谢名单", "为捞捞课程表做出贡献的人") { a.push(CreditsPage(a)) },
            r3("⬆️", "检查更新", "当前版本 " + version()) { checkUpdate(true) })
    }
    private var avLoaded = false
    private fun avatarMenu() {
        val has = Avatar.mine() != null
        Dialogs.sheet(ctx, "头像", listOf(if (has) "换一张" else "设置头像") + if (has) listOf("去掉头像") else emptyList(), danger = setOf(1)) { i ->
            if (i == 0) Media.pickImages(a, false) { l ->
                val u = l.firstOrNull() ?: return@pickImages
                a.toast("正在上传…")
                Bg.load({ Avatar.set(ctx, u); true }) { ok, e -> if (ok == true) { a.toast("头像换好了"); render() } else Dialogs.alert(ctx, "头像没换上", e?.message ?: "再试一次") }
            } else Bg.load({ Avatar.clear(); true }) { ok, e -> if (ok == true) render() else a.toast(e?.message ?: "没去掉") }
        }
    }
    private fun version(): String = try { a.packageManager.getPackageInfo(a.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }
    @Suppress("DEPRECATION")
    private fun code(): Long = try { val p = a.packageManager.getPackageInfo(a.packageName, 0); if (android.os.Build.VERSION.SDK_INT >= 28) p.longVersionCode else p.versionCode.toLong() } catch (e: Exception) { 0 }

    /** 看官网有没有新版 */
    fun checkUpdate(manual: Boolean) = Updater.check(a, manual)   // 7.x：在 App 里下载、直接安装（ui/Updater.kt）
}

/** 一个简单的二级页：标题 + 由调用方往里加内容（「我的」「设置」的分类点进去用） */
class SubPage(a: Main, private val title: String, private val fill: (LinearLayout) -> Unit) : Page(a) {
    private lateinit var body: LinearLayout
    override fun build(): View = scaffold(title) { body = it }
    override fun render() { body.removeAllViews(); fill(body) }
}

/**
 * 设置（7.x，和小程序「设置」一样：先选分类，点进去再看具体设置）：
 * 我的数据 · 外观与首页 · 提醒与通知 · 账号安全 · 其他，最下面退出登录。
 */
class SettingsPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    override fun build(): View = scaffold("设置") { body = it }
    private fun card(b: LinearLayout, vararg rows: Triple<String, String, Pair<String, () -> Unit>>?) {
        val list = rows.filterNotNull(); if (list.isEmpty()) return
        val g = ctx.card(4, 18).apply { margins(t = 12) }
        list.forEachIndexed { i, (ic, t, d) -> if (i > 0) g.addView(ctx.hline()); g.addView(ctx.cell(ic, t, d.first) { d.second() }) }
        b.addView(g)
    }
    private fun row(ic: String, t: String, d: String, fn: () -> Unit) = Triple(ic, t, d to fn)
    private fun sub(t: String, fill: (LinearLayout) -> Unit) = a.push(SubPage(a, t, fill))
    private fun syncText(): String {
        val st = when (Sync.state) { "ok" -> "已同步" + if (Sync.lastOk > 0) " · " + T.ago(Sync.lastOk) else ""; "syncing" -> "同步中…"; "error" -> "没同步上：" + Sync.lastErr; else -> "登录后自动同步" }
        val pend = Sync.pending(); return st + if (pend > 0) "（还有 $pend 条没传）" else ""
    }

    override fun render() {
        body.removeAllViews()
        card(body,
            row("☁️", "我的数据", syncText() + " · 刷新、备份、加到手机日历") { sub("我的数据") { b -> data(b) } },
            row("🎨", "外观与首页", "配色、深色模式、＋菜单、趣味、捞捞教练、小组件") { sub("外观与首页") { b -> look(b) } },
            row("🔔", "提醒与通知", "上课前、作业截止前提醒" + if (Store.feat("mail")) "、邮箱通知" else "") { sub("提醒与通知") { b -> remind(b) } },
            row("🔐", "账号安全", "密码、登录设备、找回密码") { sub("账号安全") { b -> security(b) } },
            row("🌐", "网络线路", "现在用的是" + Net.routeName() + "，连不上会自动换另一条") { a.push(NetCheckPage(a)) })
        body.add(ctx.button("退出登录", C.card, C.red) {
            Dialogs.sheet(ctx, "退出登录", listOf("退出登录", "退出并清除这台手机上的个人数据"), danger = setOf(1)) { i ->
                Bg.load({ Store.logout(i == 1) }) { _, _ -> com.laolao.classcalendar.push.Push.stop(a); com.laolao.classcalendar.work.Background.reschedule(a); a.showLogin() }
            }
        }.apply { background = round(C.card, dp(24).toFloat(), C.line, dp(1)) }, 22)
    }
    private fun data(b: LinearLayout) {
        card(b,
            row("☁️", "云端同步", syncText()) { a.toast("正在同步…"); a.refreshSoon(force = true) { a.toast(if (Sync.state == "error") "没同步上：" + Sync.lastErr else "同步好了") } },
            row("↻", "刷新班级数据", "重新从服务器拉一遍班级事项") { a.toast("正在刷新…"); a.refreshSoon(force = true) { a.toast("刷新好了") } },
            row("🗄", "备份与恢复", "我的事项和完成标记存成文件，和网页、小程序互通") { a.push(BackupPage(a)) },
            row("📲", "加到手机日历", "订阅链接、提前多久提醒、一次性导入") { a.push(FeedPage(a)) })
        b.add(ctx.text("存在云端，网页、小程序、电脑版同一份；平时会自动同步，不用手动点。", 12.5f, C.sub).apply { pad(6, 0) }, 10)
    }
    private fun look(b: LinearLayout) {
        card(b,
            row("🎨", "外观", "配色、深色模式、背景") { a.push(LookPage(a)) },
            row("➕", "首页快捷菜单", "右下角「＋」里放哪些、什么顺序") { a.push(FabCfgPage(a)) })
        card(b,
            row("🎉", "趣味与效率", "完成时的鼓励、撒花、捞捞助手、打卡、规划、云宠") { a.push(FunPage(a)) },
            row("🧭", "捞捞教练", "推荐现在做什么、每周复盘；只在本机计算") { a.push(CoachPage(a)) },
            row("🧩", "桌面小组件", "今天的课和事、下节课倒计时、作业清单、一键记事") { a.push(WidgetsPage(a)) })
    }
    private fun remind(b: LinearLayout) {
        card(b,
            row("🔔", "提醒设置", "上课前、作业截止前提醒；App 关着也能收到") { a.push(RemindPage(a)) },
            if (Store.feat("mail")) row("📧", "邮箱通知", "重要的事发到邮箱，不怕漏看群消息") { a.push(MailPage(a)) } else null,
            row("📲", "加到手机日历", "到时候手机日历也会提醒") { a.push(FeedPage(a)) })
    }
    private fun security(b: LinearLayout) {
        card(b,
            row("🔐", "账号与安全", "修改密码、登录设备、踢出其他设备") { a.push(SecurityPage(a)) },
            if (Store.feat("mail")) row("📮", "找回密码用的邮箱", "绑定后忘记密码可以用邮箱验证码重置") { a.push(MailPage(a)) } else null,
            row("🧑‍🏫", "没绑邮箱也别担心", "班主任可以在你的个人主页给你重置一个临时密码") { a.toast("找班主任：在班级成员里点你的名字 → 重置密码") })
    }
}
