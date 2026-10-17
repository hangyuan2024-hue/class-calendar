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

        val g1 = ctx.card(4, 18).apply { margins(t = 14) }
        val cls = Store.cls
        g1.addView(ctx.cell("🏫", if (Store.work()) "我的团队" else "我的班级", cls?.let { it.str("name") + " · " + Store.role() + if (Store.classes.size > 1) " · 共 ${Store.classes.size} 个" else "" } ?: if (Store.pending.isNotEmpty()) "等老师批准中" else "还没加入，点这里输入班级码") { a.push(ClassPage(a)) })
        g1.addView(ctx.hline())
        val wk = Courses.weekNow()
        g1.addView(ctx.cell("📚", "课程表", if (Courses.has()) "${Courses.list().size} 门课" + (if (wk > 0) " · 现在是第 $wk 周" else "") else "拍一张课表截图就能导入") { a.push(CoursePage(a)) })
        g1.addView(ctx.hline())
        g1.addView(ctx.cell("📋", "从备忘录 / 聊天记录导入", "粘贴一段文字，自动拆成一条条待办") { a.push(MemoPage(a, "")) })
        body.addView(g1)

        val g2 = ctx.card(4, 18).apply { margins(t = 14) }
        g2.addView(ctx.cell("🔔", "提醒与通知", "上课前、作业截止前提醒；App 关着也能收到") { a.push(RemindPage(a)) })
        g2.addView(ctx.hline())
        g2.addView(ctx.cell("🧩", "桌面小组件", "今天的课和事、下节课倒计时、作业清单、一键记事") { a.push(WidgetsPage(a)) })
        body.addView(g2)

        val g3 = ctx.card(4, 18).apply { margins(t = 14) }
        val st = when (Sync.state) { "ok" -> "☁ 已同步" + if (Sync.lastOk > 0) " · " + T.ago(Sync.lastOk) else ""; "syncing" -> "☁ 同步中…"; "error" -> "⚠ 没同步上：" + Sync.lastErr; else -> "☁ 登录后自动同步" }
        val pend = Sync.pending()
        g3.addView(ctx.cell("🔄", "和网页、小程序同步", st + if (pend > 0) "（还有 $pend 条没传）" else "", "立即同步") { v ->
            a.toast("正在同步…")
            a.refreshSoon(force = true) { a.toast(if (Sync.state == "error") "没同步上：" + Sync.lastErr else "同步好了"); render() }
        })
        g3.addView(ctx.hline())
        g3.addView(ctx.cell("🌐", "网络线路", "现在用的是" + Net.routeName() + "，连不上会自动换另一条", "") {})
        g3.addView(ctx.hline())
        g3.addView(ctx.cell("💻", "在网页上用更多功能", "成长打卡、班级墙、工具箱、AI 整理…") { a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Cfg.SITE))) })
        g3.addView(ctx.hline())
        g3.addView(ctx.cell("⬆️", "检查更新", "当前版本 " + version()) { checkUpdate(true) })
        body.addView(g3)

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
    fun checkUpdate(manual: Boolean) {
        if (manual) a.toast("正在检查…")
        Bg.load({
            val c = URL(Cfg.VERSION_JSON + "?t=" + System.currentTimeMillis()).openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 10000
            try { JSONObject(c.inputStream.bufferedReader().readText()) } finally { c.disconnect() }
        }) { j, e ->
            if (j == null) { if (manual) a.toast("检查失败：" + (e?.message ?: "网络不好")); return@load }
            val vc = j.optLong("versionCode"); val vn = j.str("versionName")
            if (vc <= code()) { if (manual) a.toast("已经是最新版"); return@load }
            Dialogs.confirm(ctx, "有新版本 $vn", "下载后点安装就能覆盖升级，数据不会丢。", "去下载") {
                a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Cfg.SITE + "download/")))
            }
        }
    }
}
