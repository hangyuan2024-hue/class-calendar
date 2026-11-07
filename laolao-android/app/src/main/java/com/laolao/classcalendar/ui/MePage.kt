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

/**
 * 我的（7.x）：就是自己的个人主页——封面、头像、名字、签名、等级，这周的几个数字。
 * 其他的（班级、数据、外观、提醒、账号、关于）全部在右上角「设置」里，分成几大类。
 */
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
        // 7.x 不放标题和设置按钮：设置在侧边栏里（从左边缘往右滑）

        // 封面 + 头像 + 名字（和同学看到的个人主页同一个封面）
        val name = Store.name(); val g = me?.str("gender") ?: ""
        val hero = ctx.col().apply { bg(C.card, 22, C.line); clipToOutline = true }
        val top = android.widget.FrameLayout(ctx)
        top.addView(android.widget.FrameLayout(ctx).apply {
            background = CK.cover(me?.str("cover") ?: "", g)
            addView(ctx.text("编辑资料", 12.5f, Color.WHITE, SEMI).apply { pad(10, 5); bg(C.alpha(Color.BLACK, 0.25f), 12); tap { editProfile() } },
                android.widget.FrameLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.END or Gravity.TOP; topMargin = dp(10); rightMargin = dp(10) })
        }, android.widget.FrameLayout.LayoutParams(MATCH, dp(96)))
        top.addView(Avatar.view(ctx, name, g, 20).apply { tap { a.avatarMenu { render() } } },
            android.widget.FrameLayout.LayoutParams(dp(72), dp(72)).apply { leftMargin = dp(16); topMargin = dp(56) })
        top.addView(ctx.col().apply {
            addView(ctx.text(name.ifEmpty { "加载中…" } + when (g) { "m" -> " ♂"; "f" -> " ♀"; else -> "" }, 19f, C.text, HEAVY, 1))
            val roleName = when (me?.str("role")) { "teacher" -> "老师"; "admin" -> "管理员"; "developer" -> "开发者"; else -> if (Store.work()) "职场" else "学生" }
            addView(ctx.text(listOfNotNull("@" + (me?.str("account") ?: ""), roleName, me?.str("org_name")?.ifBlank { null }).joinToString(" · "), 12f, C.sub, lines = 1).apply { margins(t = 2) })
        }, android.widget.FrameLayout.LayoutParams(MATCH, WRAP).apply { leftMargin = dp(100); rightMargin = dp(14); topMargin = dp(102) })
        hero.addView(top)
        val bio = me?.str("bio") ?: ""
        hero.addView(ctx.text(bio.ifBlank { "还没有签名，点「编辑资料」写一句" }, 13.5f, if (bio.isBlank()) C.mutedText else C.text).apply { setLineSpacing(0f, 1.3f); pad(16, 12, 16, 0); if (bio.isBlank()) tap { editProfile() } })
        val chips = ctx.row().apply { pad(16, 10, 16, 16) }
        com.laolao.classcalendar.core.Level.me()?.let { l -> chips.addView(LevelUi.chip(ctx, l.level).apply { tap { a.selectTab(2) } }) }
        Store.role().takeIf { it.isNotEmpty() && it != "学生" }?.let { r -> chips.addView(ctx.chip(r, C.accent, C.selected, 12f).apply { pad(8, 2) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) }) }
        Store.cls?.let { c -> chips.addView(ctx.chip(c.str("name"), C.sub, C.mutedBg, 12f).apply { pad(8, 2) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) }) }
        hero.addView(chips)
        body.addView(hero)
        if (!avLoaded && Store.me != null) { avLoaded = true; Bg.load({ Avatar.load() }) { changed, _ -> if (changed == true) render() } }

        // 7.x「我的」就是个人主页（同学点你的名字看到的也是这些）：资料卡 + 我在班级墙的发言
        // 经验、等级、徽章都在「成长」里，这里不再重复
        if (up == null && !upLoading && Store.me != null) { upLoading = true
            Bg.load({ com.laolao.classcalendar.core.Api.rpcObj("user_page", com.laolao.classcalendar.core.jsonOf("uid" to com.laolao.classcalendar.core.Api.uid, "cid" to Store.cls?.str("id"))) }) { r, _ -> upLoading = false; if (r != null) { up = r; render() } }
        }
        up?.let { x ->
            val joined = CK.ms(x.str("joined")).takeIf { it > 0 }
            if (joined != null) hero.addView(ctx.text("加入 ${maxOf(1, (System.currentTimeMillis() - joined) / 86400000)} 天", 12f, C.mutedText).apply { pad(16, 0, 16, 14) })
            val posts = x.optJSONArray("posts")?.let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } ?: emptyList()
            if (Store.cls != null) {
                body.addView(ctx.row().apply {
                    gravity = Gravity.BOTTOM; pad(4, 18, 2, 8)
                    addView(ctx.text("我的班级墙", 15.5f, C.text, HEAVY))
                    addView(ctx.text("${x.optInt("post_count")} 条发言", 12f, C.sub).apply { pad(8, 0, 0, 2) }, LinearLayout.LayoutParams(0, WRAP, 1f))
                    addView(ctx.text("去班级墙 ›", 12.5f, C.accent, SEMI).apply { pad(6, 2); tap { a.push(WallPage(a)) } })
                })
                if (posts.isEmpty()) body.addView(ctx.text("还没在班级墙发过言，去打个招呼吧", 13.5f, C.sub).apply { bg(C.card, 14, C.line); pad(14, 14); tap { a.push(WallPage(a)) } })
                for (p in posts.take(5)) {
                    val c = ctx.card(12, 14).apply { margins(t = 8); tap { a.push(WallPage(a, p.optLong("id"))) } }
                    if (p.optBoolean("is_notice") || p.str("title").isNotEmpty()) c.addView(ctx.text(p.str("title").ifEmpty { "通知" }, 14.5f, C.text, BOLD, 1))
                    c.addView(ctx.text(p.str("body"), 13.5f, C.text, lines = 3).apply { margins(t = 2) })
                    c.addView(ctx.text(CK.ago(p.str("created_at")) + if (p.optInt("comments") > 0) " · ${p.optInt("comments")} 条评论" else "", 11.5f, C.sub).apply { margins(t = 4) })
                    body.addView(c)
                }
            }
        }
        body.add(ctx.text("捞捞课程表 安卓版 " + version(), 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 18)
    }
    private var avLoaded = false
    private var up: org.json.JSONObject? = null; private var upLoading = false
    private fun editProfile() { val me = Store.me; ProfileSheet.open(a, me?.str("gender") ?: "", me?.str("cover") ?: "", me?.str("bio") ?: "") { up = null; render() } }
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

/** 换头像 / 去掉头像（「我的」和「设置 → 账号与资料」共用） */
fun Main.avatarMenu(done: () -> Unit) {
    val has = Avatar.mine() != null
    Dialogs.sheet(this, "头像", listOf(if (has) "换一张" else "设置头像") + if (has) listOf("去掉头像") else emptyList(), danger = setOf(1)) { i ->
        if (i == 0) Media.pickImages(this, false) { l ->
            val u = l.firstOrNull() ?: return@pickImages
            toast("正在上传…")
            Bg.load({ Avatar.set(this, u); true }) { ok, e -> if (ok == true) { toast("头像换好了"); done() } else Dialogs.alert(this, "头像没换上", e?.message ?: "再试一次") }
        } else Bg.load({ Avatar.clear(); true }) { ok, e -> if (ok == true) done() else toast(e?.message ?: "没去掉") }
    }
}

/**
 * 设置（7.x）：点进来只看到几个大类，点哪一类再看里面的具体设置。
 * 账号与资料 · 班级与课表 · 数据与同步 · 外观与首页 · 提醒与通知 · 关于与帮助，最下面退出登录。
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
    private fun web(u: String) { try { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } catch (_: Exception) { a.toast("打不开浏览器") } }
    private fun syncText(): String {
        val st = when (Sync.state) { "ok" -> "已同步" + if (Sync.lastOk > 0) " · " + T.ago(Sync.lastOk) else ""; "syncing" -> "同步中…"; "error" -> "没同步上：" + Sync.lastErr; else -> "登录后自动同步" }
        val pend = Sync.pending(); return st + if (pend > 0) "（还有 $pend 条没传）" else ""
    }
    private fun version(): String = try { a.packageManager.getPackageInfo(a.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }

    override fun render() {
        body.removeAllViews()
        val cls = if (Store.work()) "团队与课表" else "班级与课表"
        // 只放大类：图标 + 名字（一行小字说明里面有什么）
        card(body,
            row("👤", "账号与资料", "头像、资料、学校院系、密码") { sub("账号与资料") { b -> account(b) } },
            row("🏫", cls, "班级、成员、课程表" + if (Store.isTeacher) "、班级管理" else "") { sub(cls) { b -> classes(b) } },
            row("☁️", "数据与同步", "同步、备份、加到手机日历") { sub("数据与同步") { b -> data(b) } })
        card(body,
            row("🎨", "外观与首页", "配色、＋菜单、捞捞推荐、小组件") { sub("外观与首页") { b -> look(b) } },
            row("🔔", "提醒与通知", "上课前、截止前提醒") { sub("提醒与通知") { b -> remind(b) } },
            row("📖", "关于与帮助", "功能介绍、信箱、检查更新") { sub("关于与帮助") { b -> about(b) } })
        body.add(ctx.button("退出登录", C.card, C.red) {
            Dialogs.sheet(ctx, "退出登录", listOf("退出登录", "退出并清除这台手机上的个人数据"), danger = setOf(1)) { i ->
                Bg.load({ Store.logout(i == 1) }) { _, _ -> com.laolao.classcalendar.push.Push.stop(a); com.laolao.classcalendar.work.Background.reschedule(a); a.showLogin() }
            }
        }.apply { background = round(C.card, dp(24).toFloat(), C.line, dp(1)) }, 22)
        body.add(ctx.text("捞捞课程表 安卓版 " + version(), 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 14)
    }
    private fun account(b: LinearLayout) {
        val me = Store.me
        card(b,
            row("✏️", "编辑资料", "性别、签名、主页封面") { ProfileSheet.open(a, me?.str("gender") ?: "", me?.str("cover") ?: "", me?.str("bio") ?: "") {} },
            row("👤", "头像", if (Avatar.mine() != null) "已设置 · 换一张或去掉" else "还没设置，和小程序、网站同一张") { a.avatarMenu {} },
            row("🎓", "学校与院系", (me?.str("org_name") ?: "").ifEmpty { "选了学校就自动挂到学校下面，再填上院系" }) { a.push(OrgPage(a)) })
        card(b,
            row("🔐", "账号与安全", "修改密码、登录设备、踢出其他设备") { a.push(SecurityPage(a)) },
            if (Store.feat("mail")) row("📮", "找回密码用的邮箱", "绑定后忘记密码可以用邮箱验证码重置") { a.push(MailPage(a)) } else null,
            row("🧑‍🏫", "没绑邮箱也别担心", "班主任可以在你的个人主页给你重置一个临时密码") { a.toast("找班主任：在班级成员里点你的名字 → 重置密码") })
    }
    private fun classes(b: LinearLayout) {
        val me = Store.me; val cls = Store.cls; val wk = Courses.weekNow()
        card(b,
            row("🏫", if (Store.work()) "我的团队" else "我的班级", cls?.let { it.str("name") + " · " + Store.role() + if (Store.classes.size > 1) " · 共 ${Store.classes.size} 个" else "" } ?: if (Store.pending.isNotEmpty()) "等老师批准中" else "还没加入，点这里输入班级码") { a.push(ClassPage(a)) },
            if (cls != null) row("👥", "班级成员", "点头像进入 TA 的主页") { a.push(PeoplePage(a)) } else null,
            row("📚", "课程表", if (Courses.has()) "${Courses.list().size} 门课" + (if (wk > 0) " · 现在是第 $wk 周" else "") else "拍一张课表截图就能导入") { a.push(CoursePage(a)) })
        card(b,
            if (cls != null && Store.isTeacher) row("🎛️", "班级管理", "审批同学、任命班委、本班功能开关") { a.push(ClassManagePage(a, cls.str("id"))) } else null,
            if (me?.str("role") in setOf("admin", "developer")) row("⚙️", "站长后台", "全站功能开关、身份与权限（在网页里打开）") { web(Cfg.SITE + "admin.html") } else null)
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
            row("➕", "首页快捷菜单", "右下角「＋」里放哪些、什么顺序") { a.push(FabCfgPage(a)) },
            row("💡", "接下来做啥", "首页的智能推荐会学你的习惯；在这里清空重新学") { Dialogs.confirm(ctx, "清空推荐记录？", "捞捞记住的习惯、长按选过的「不喜欢」「2 小时后再说」都会清空，重新开始学。", "清空") { Rec.resetAll(); NextAI.reset(); a.toast("已清空") } })
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
    private fun about(b: LinearLayout) {
        card(b,
            row("📖", "功能介绍", "每个功能怎么用，一图看懂") { a.push(GuidePage(a)) },
            row("✉️", "信箱", "写信给捞捞团队：建议、举报、合作") { a.push(LetterBoxPage(a)) },
            row("💻", "电脑版", "整周课表铺满屏幕、右下角提醒 · 同一个账号自动同步") { web(Cfg.SITE + "download/") },
            row("💛", "感谢名单", "为捞捞课程表做出贡献的人") { a.push(CreditsPage(a)) })
        card(b,
            row("🌐", "网络线路", "现在用的是" + Net.routeName() + "，连不上会自动换另一条") { a.push(NetCheckPage(a)) },
            row("⬆️", "检查更新", "当前版本 " + version()) { Updater.check(a, true) })
    }
}
