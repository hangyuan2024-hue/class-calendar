package com.laolao.classcalendar.ui

import android.app.NotificationManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.str
import com.laolao.classcalendar.push.Push
import com.laolao.classcalendar.widget.HomeworkWidget
import com.laolao.classcalendar.widget.NextWidget
import com.laolao.classcalendar.widget.QuickWidget
import com.laolao.classcalendar.widget.TodayWidget
import com.laolao.classcalendar.work.Background
import com.laolao.classcalendar.work.Notify
import com.laolao.classcalendar.work.Prefs

/** 提醒与通知 */
class RemindPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    override fun build(): View = scaffold("提醒与通知") { body = it }
    override fun onShow() { render() }

    override fun render() {
        view
        keepScroll(body)
        val nm = ctx.getSystemService(NotificationManager::class.java)
        val ok = nm.areNotificationsEnabled()
        if (!ok) body.addView(ctx.col().apply {
            bg(C.dangerBg, 14); pad(14, 12); margins(b = 12)
            addView(ctx.text("通知被关掉了，提醒弹不出来", 14.5f, C.red, BOLD))
            addView(ctx.soft("去打开通知", C.card, C.red) { openNotifySettings() }.apply { margins(t = 8) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(8) })
        })
        val c1 = ctx.card(4, 18).apply { pad(16, 4) }
        c1.addView(Toggle(ctx, "上课前提醒", "按课程表，提前提醒去上课", Prefs.classOn(ctx)) { Prefs.set(ctx, "class", it); Background.reschedule(ctx) })
        c1.addView(ctx.hline())
        c1.addView(Toggle(ctx, "会议、活动开始前提醒", "有具体时间的班级事项和我的事项", Prefs.itemsOn(ctx)) { Prefs.set(ctx, "items", it); Background.reschedule(ctx) })
        c1.addView(ctx.hline())
        val lr = ctx.row().apply { pad(0, 12) }
        lr.addView(ctx.text("提前多久", 15f, C.text, SEMI), LinearLayout.LayoutParams(0, WRAP, 1f))
        val leads = listOf(5, 10, 15, 30)
        lr.addView(Seg(ctx, leads.map { "$it 分" }, maxOf(0, leads.indexOf(Prefs.lead(ctx)))) { i -> Prefs.set(ctx, "lead", leads[i]); Background.reschedule(ctx) }, LinearLayout.LayoutParams(dp(220), WRAP))
        c1.addView(lr)
        c1.addView(ctx.hline())
        c1.addView(Toggle(ctx, "作业截止提醒", "前一天晚上 8 点、当天早上、截止前 1 小时", Prefs.hwOn(ctx)) { Prefs.set(ctx, "hw", it); Background.reschedule(ctx) })
        c1.addView(ctx.hline())
        c1.addView(Toggle(ctx, "班级新作业、新通知", "老师、班委一发布就通知你", Prefs.newsOn(ctx)) { Prefs.set(ctx, "news", it) })
        c1.addView(ctx.hline())
        c1.addView(Toggle(ctx, "每天早上 7 点的今日概览", "今天几节课、几件事、哪些作业快截止", Prefs.briefOn(ctx)) { Prefs.set(ctx, "brief", it); Background.reschedule(ctx) })
        body.addView(c1)

        body.addView(ctx.section("App 关着也能收到"))
        val c2 = ctx.card(4, 18)
        val pushOk = Push.ready(ctx)
        c2.addView(ctx.cell("⚡", "即时推送", if (pushOk) "已连上：老师一发布，几秒内就推到这台手机" else "正在连接…（第一次打开要等一会儿，连上后显示「已连上」）", "测试") { test() })
        c2.addView(ctx.hline())
        val exact = Background.exactAllowed(ctx)
        c2.addView(ctx.cell("⏰", "准时提醒", if (exact) "已允许：上课、截止提醒会准点弹出" else "没有「闹钟和提醒」权限，提醒可能晚几分钟", if (exact) "" else "去允许") {
            if (!exact && Build.VERSION.SDK_INT >= 31) try { a.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + ctx.packageName))) } catch (_: Exception) {}
        })
        c2.addView(ctx.hline())
        val pm = ctx.getSystemService(PowerManager::class.java)
        val ign = pm.isIgnoringBatteryOptimizations(ctx.packageName)
        c2.addView(ctx.cell("🔋", "不被省电模式拦住", if (ign) "已设置：后台检查新作业不会被系统停掉" else "建议设置，不然有些手机关掉 App 后收不到提醒", if (ign) "" else "去设置") {
            if (!ign) try { a.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.packageName))) } catch (_: Exception) { openAppSettings() }
        })
        c2.addView(ctx.hline())
        c2.addView(ctx.cell("🚀", "允许自启动（华为、小米、OPPO、vivo）", "这些手机还要在「手机管家 / 设置 → 应用启动管理」里允许捞捞课程表自启动、后台运行") { openAppSettings() })
        body.addView(c2)
        body.add(ctx.button("发一条测试提醒", C.selected, C.accent) {
            Notify.show(ctx, 7, Notify.CH_CLASS, "测试提醒 ✓", "看到这条，说明提醒能正常弹出来", null, null, false)
        }, 16)
    }

    private fun test() {
        if (!Push.ready(ctx)) Push.start(a)
        a.toast("正在让服务器发一条推送…")
        Bg.load({ Api.rpcObj("jpush_test_me") }) { r, e ->
            when {
                e != null -> Dialogs.alert(ctx, "没发出去", e.message ?: "")
                r?.optBoolean("ok") == true -> Dialogs.alert(ctx, "已经发了", "几秒内应该会弹出「测试推送」。\n\n没收到的话：检查通知有没有被关掉、App 是否被省电模式限制；刚装好的 App 第一次连接要等一两分钟。")
                else -> Dialogs.alert(ctx, "暂时发不了", r?.str("reason")?.ifBlank { null } ?: "服务器还没装好推送")
            }
        }
    }
    private fun openNotifySettings() {
        try { a.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)) } catch (_: Exception) { openAppSettings() }
    }
    private fun openAppSettings() {
        try { a.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName))) } catch (_: Exception) {}
    }
}

/** 桌面小组件：介绍 + 一键添加（支持的桌面会弹出确认） */
class WidgetsPage(a: Main) : Page(a) {
    override fun build(): View = scaffold("桌面小组件") { b ->
        b.addView(ctx.text("长按手机桌面空白处 →「小组件 / 窗口小工具」→ 找到「捞捞课程表」，拖到桌面上。也可以直接点下面的「添加」。", 13.5f, C.sub).apply { setLineSpacing(0f, 1.35f) })
        val list = listOf(
            Triple("📅", "今天的课和事", "今天的课按时间排好，上完的课自动变灰；今天的事点方框直接打勾") to TodayWidget::class.java,
            Triple("⏱", "下节课倒计时", "下一节课 / 最该先做的事，还剩多久一目了然") to NextWidget::class.java,
            Triple("📝", "作业清单", "没做完的作业按截止时间排，点方框打勾，不用打开 App") to HomeworkWidget::class.java,
            Triple("✏️", "一键记事", "说一句话就记一件事；还能直接拍课表导入") to QuickWidget::class.java,
        )
        val m = AppWidgetManager.getInstance(ctx)
        for ((info, cls) in list) {
            val c = ctx.card(16, 18).apply { margins(t = 12) }
            val r = ctx.row()
            r.addView(ctx.text(info.first, 26f).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(44), WRAP))
            val cc = ctx.col()
            cc.addView(ctx.text(info.second, 16f, C.text, BOLD))
            cc.addView(ctx.text(info.third, 12.5f, C.sub).apply { margins(t = 3) })
            r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = dp(8) })
            val added = m.getAppWidgetIds(ComponentName(ctx, cls)).isNotEmpty()
            r.addView(ctx.soft(if (added) "已添加" else "添加") {
                if (Build.VERSION.SDK_INT >= 26 && m.isRequestPinAppWidgetSupported) m.requestPinAppWidget(ComponentName(ctx, cls), null, null)
                else Dialogs.alert(ctx, "手动添加", "这个桌面不支持一键添加：长按桌面空白处 →「小组件」→ 找到「捞捞课程表」。")
            })
            c.addView(r)
            b.addView(c)
        }
        b.add(ctx.text("小提示：下拉通知栏 → 编辑快捷开关，可以把「记一件事」加进去；长按 App 图标也能直接记事、看作业。", 12.5f, C.sub).apply { setLineSpacing(0f, 1.35f) }, 16)
    }
}
