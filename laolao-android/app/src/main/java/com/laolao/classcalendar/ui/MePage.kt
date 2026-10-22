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

/** 我的：账号、班级、课程表、提醒、小组件、同步、更新 */
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
        body.addView(ctx.text("我的", 26f, C.text, HEAVY).apply { pad(2, 6, 2, 12) })
        // 账号卡
        val pc = ctx.card(18, 22).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val name = Store.name()
        pc.addView(ctx.text(name.take(1).ifEmpty { "?" }, 22f, Color.WHITE, BOLD).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (me?.str("gender") == "f") intArrayOf(C.c("#ff9ac1"), C.c("#ff5f8f")) else intArrayOf(C.mix(C.accent, Color.WHITE, 0.25f), C.accent)).apply { cornerRadius = dp(16).toFloat() }
        }, LinearLayout.LayoutParams(dp(56), dp(56)))
        val pcc = ctx.col()
        pcc.addView(ctx.text(name.ifEmpty { "加载中…" }, 19f, C.text, HEAVY))
        val roleName = when (me?.str("role")) { "teacher" -> "老师"; "admin" -> "管理员"; "developer" -> "开发者"; else -> if (Store.work()) "职场" else "学生" }
        pcc.addView(ctx.text("账号 " + (me?.str("account") ?: "") + " · " + roleName + (me?.str("org_name")?.takeIf { it.isNotBlank() }?.let { " · $it" } ?: ""), 12.5f, C.sub, lines = 2).apply { margins(t = 3) })
        pc.addView(pcc, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(14) })
        body.addView(pc)
        val pr = ctx.row().apply { margins(t = 10) }
        pr.addView(ctx.soft("✏️ 编辑资料") { ProfileSheet.open(a, me?.str("gender") ?: "", me?.str("cover") ?: "", me?.str("bio") ?: "") { render() } }, LinearLayout.LayoutParams(0, dp(42), 1f))
        pr.addView(ctx.soft("我的主页 ›") { a.push(UserPage(a)) }, LinearLayout.LayoutParams(0, dp(42), 1f).apply { leftMargin = dp(10) })
        body.addView(pr)

        val cls = Store.cls
        fun group(title: String, sub: String, vararg rows: Triple<String, String, Pair<String, () -> Unit>>?) {
            val list = rows.filterNotNull(); if (list.isEmpty()) return
            body.addView(ctx.section(title, sub))
            val g = ctx.card(4, 18)
            list.forEachIndexed { i, (ic, t, d) -> if (i > 0) g.addView(ctx.hline()); g.addView(ctx.cell(ic, t, d.first) { d.second() }) }
            body.addView(g)
        }
        fun row(ic: String, t: String, d: String, fn: () -> Unit) = Triple(ic, t, d to fn)
        val open = { u: String -> try { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } catch (_: Exception) { a.toast("打不开浏览器") } }

        // 我的数据
        val st = when (Sync.state) { "ok" -> "已同步" + if (Sync.lastOk > 0) " · " + T.ago(Sync.lastOk) else ""; "syncing" -> "同步中…"; "error" -> "没同步上：" + Sync.lastErr; else -> "登录后自动同步" }
        val pend = Sync.pending()
        body.addView(ctx.section("我的数据", "存在云端，网页、小程序、电脑版同一份"))
        val gd = ctx.card(4, 18)
        gd.addView(ctx.cell("☁️", "云端同步", st + if (pend > 0) "（还有 $pend 条没传）" else "", "⟳ 立即同步") {
            a.toast("正在同步…"); a.refreshSoon(force = true) { a.toast(if (Sync.state == "error") "没同步上：" + Sync.lastErr else "同步好了"); render() }
        })
        gd.addView(ctx.hline()); gd.addView(ctx.cell("🗄", "备份与恢复", "我的事项和完成标记存成文件，和网页、小程序互通") { a.push(BackupPage(a)) })
        gd.addView(ctx.hline()); gd.addView(ctx.cell("↻", "刷新班级数据", "重新从服务器拉一遍班级事项") { a.toast("正在刷新…"); a.refreshSoon(force = true) { a.toast("刷新好了"); render() } })
        body.addView(gd)

        group("外观与趣味", "需要哪个开哪个",
            row("🎨", "外观", "配色、深色模式、背景") { a.push(LookPage(a)) },
            row("🧭", "捞捞教练", "学你的节奏、推荐现在做什么、每周复盘；只在本机计算") { a.push(CoachPage(a)) },
            row("🎉", "趣味与效率", "完成时的鼓励、撒花、捞捞助手、打卡、规划、云宠") { a.push(FunPage(a)) },
            if (Store.feat("plan")) row("🗂️", "打开规划页", "四象限、PDCA、SMART、六件事、番茄钟") { a.push(PlanPage(a)) } else null,
            row("📈", "查看成长页", "进度环、趋势图、打卡") { a.selectTab(2) })

        group("提醒", "作业、上课、班级通知，到点提醒你",
            row("🔔", "提醒与通知", "这台手机直接提醒：上课前、作业截止前，App 关着也能收到") { a.push(RemindPage(a)) },
            row("📲", "加到手机日历", "订阅链接、订阅里放什么、提前多久提醒、一次性导入") { a.push(FeedPage(a)) },
            if (Store.feat("mail")) row("📧", "邮箱通知", "重要的事发到邮箱，不怕漏看群消息") { a.push(MailPage(a)) } else null,
            row("🧩", "桌面小组件", "今天的课和事、下节课倒计时、作业清单、一键记事") { a.push(WidgetsPage(a)) })

        group("账号安全", "忘记密码时怎么找回",
            row("🔐", "账号与安全", "修改密码、登录设备、踢出其他设备") { a.push(SecurityPage(a)) },
            if (Store.feat("mail")) row("📮", "找回密码用的邮箱", "绑定后忘记密码可以用邮箱验证码重置") { a.push(MailPage(a)) } else null,
            row("🧑‍🏫", "没绑邮箱也别担心", "班主任可以在你的个人主页给你重置一个临时密码") { a.toast("找班主任：在班级成员里点你的名字 → 重置密码") })

        val wk = Courses.weekNow()
        group(if (Store.work()) "团队与账号" else "班级与账号", "",
            row("🏫", if (Store.work()) "我的团队" else "我的班级", cls?.let { it.str("name") + " · " + Store.role() + if (Store.classes.size > 1) " · 共 ${Store.classes.size} 个" else "" } ?: if (Store.pending.isNotEmpty()) "等老师批准中" else "还没加入，点这里输入班级码") { a.push(ClassPage(a)) },
            row("📚", "课程表", if (Courses.has()) "${Courses.list().size} 门课" + (if (wk > 0) " · 现在是第 $wk 周" else "") else "拍一张课表截图就能导入") { a.push(CoursePage(a)) },
            if (cls != null) row("👥", "班级成员", "点头像进入 TA 的主页") { a.push(PeoplePage(a)) } else null,
            if (cls != null && Store.isTeacher) row("🎛️", "班级管理 · 本班功能开关", "审批同学、任命班委、决定学生和班委能用哪些功能") { a.push(ClassManagePage(a, cls.str("id"))) } else null,
            if (me?.str("role") in setOf("admin", "developer")) row("⚙️", "管理后台", "全站功能开关、身份与权限（在网页里打开）") { open(Cfg.SITE + "admin.html") } else null,
            row("🧰", "工具与插件", "课程表、错题本、单词、记账…") { a.selectTab(3) })

        group("下载与关于", "",
            row("💻", "Windows 电脑版", "整周课表铺满屏幕、右下角提醒 · 同一个账号自动同步") { open(Cfg.SITE + "download/") },
            row("📖", "功能介绍", "每个功能怎么用") { open(Cfg.SITE) },
            row("💛", "感谢名单", "为捞捞课程表做出贡献的人") { a.push(CreditsPage(a)) },
            row("🌐", "网络线路", "现在用的是" + Net.routeName() + "，连不上会自动换另一条") { a.push(NetCheckPage(a)) },
            row("⬆️", "检查更新", "当前版本 " + version()) { checkUpdate(true) })

        body.add(ctx.button("退出登录", C.card, C.red) {
            Dialogs.sheet(ctx, "退出登录", listOf("退出登录", "退出并清除这台手机上的个人数据"), danger = setOf(1)) { i ->
                Bg.load({ Store.logout(i == 1) }) { _, _ -> com.laolao.classcalendar.push.Push.stop(a); com.laolao.classcalendar.work.Background.reschedule(a); a.showLogin() }
            }
        }.apply { background = round(C.card, dp(24).toFloat(), C.line, dp(1)) }, 22)
        body.add(ctx.text("捞捞课程表 安卓版 " + version(), 12f, C.mutedText).apply { gravity = Gravity.CENTER }, 16)
    }

    private fun version(): String = try { a.packageManager.getPackageInfo(a.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }
    @Suppress("DEPRECATION")
    private fun code(): Long = try { val p = a.packageManager.getPackageInfo(a.packageName, 0); if (android.os.Build.VERSION.SDK_INT >= 28) p.longVersionCode else p.versionCode.toLong() } catch (e: Exception) { 0 }

    /** 看官网有没有新版 */
    fun checkUpdate(manual: Boolean) = Updater.check(a, manual)   // 7.x：在 App 里下载、直接安装（ui/Updater.kt）
}
