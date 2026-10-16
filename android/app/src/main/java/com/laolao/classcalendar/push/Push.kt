package com.laolao.classcalendar.push

import android.content.Context
import android.content.Intent
import cn.jpush.android.api.CustomMessage
import cn.jpush.android.api.JPushInterface
import cn.jpush.android.api.NotificationMessage
import cn.jpush.android.service.JCommonService
import cn.jpush.android.service.JPushMessageReceiver
import com.laolao.classcalendar.MainActivity
import com.laolao.classcalendar.work.SyncWorker
import org.json.JSONObject

/**
 * 极光推送：老师 / 班委一发布，服务器马上推到同学手机（App 没打开也能收到）。
 * 每个账号绑定一个别名 u+用户编号（去掉横线），服务器按别名推送。
 * 推送只是「更快」：没收到时，后台每 15 分钟检查一次照样会提醒。
 */
object Push {
    @Volatile private var started = false

    /** 登录后才启动（用户已同意隐私政策） */
    fun start(c: Context, uid: String) {
        if (uid.isBlank() || uid == "guest") return
        runCatching {
            if (!started) {
                // 隐私合规：同意后才允许采集（不同 SDK 版本这个类可能不存在，用反射调用）
                runCatching {
                    Class.forName("cn.jiguang.api.utils.JCollectionAuth")
                        .getMethod("setAuth", Context::class.java, Boolean::class.javaPrimitiveType)
                        .invoke(null, c.applicationContext, true)
                }
                JPushInterface.setDebugMode(false)
                JPushInterface.init(c.applicationContext)
                started = true
            }
            val alias = alias(uid)
            val prefs = c.getSharedPreferences("laolao_push", 0)
            if (prefs.getString("alias", "") != alias) {
                JPushInterface.setAlias(c.applicationContext, 1, alias)
                prefs.edit().putString("alias", alias).apply()
            }
        }
    }

    /** 退出登录：解绑，别人的通知不会再发到这台手机 */
    fun stop(c: Context) {
        runCatching {
            c.getSharedPreferences("laolao_push", 0).edit().remove("alias").apply()
            if (started) JPushInterface.deleteAlias(c.applicationContext, 2)
        }
    }

    fun alias(uid: String) = "u" + uid.replace("-", "").lowercase()

    /** 最近 3 天收到过推送 → 推送是通的，后台检查就不再重复弹「新消息」 */
    fun recentlyWorked(c: Context): Boolean =
        System.currentTimeMillis() - c.getSharedPreferences("laolao_push", 0).getLong("got_at", 0L) < 3L * 24 * 3600 * 1000

    internal fun markGot(c: Context) {
        c.getSharedPreferences("laolao_push", 0).edit().putLong("got_at", System.currentTimeMillis()).apply()
    }

    internal fun routeOf(extras: String?): String =
        runCatching { JSONObject(extras ?: "{}").optString("route") }.getOrDefault("").ifBlank { "home" }
}

/** 极光要求的常驻服务（空的就行） */
class PushService : JCommonService()

class PushReceiver : JPushMessageReceiver() {
    /** 通知到了：记下推送是通的，顺便在后台同步，小组件、作业页马上有新内容 */
    override fun onNotifyMessageArrived(context: Context, message: NotificationMessage) {
        Push.markGot(context)
        runCatching { SyncWorker.now(context) }
    }

    /** 点通知：打开对应页面（作业 / 班级） */
    override fun onNotifyMessageOpened(context: Context, message: NotificationMessage) {
        val route = Push.routeOf(message.notificationExtras)
        runCatching {
            context.startActivity(Intent(context, MainActivity::class.java).putExtra("route", route)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
        }
    }

    /** 自定义消息（不弹通知）：只同步 */
    override fun onMessage(context: Context, message: CustomMessage) {
        Push.markGot(context)
        runCatching { SyncWorker.now(context) }
    }
}
