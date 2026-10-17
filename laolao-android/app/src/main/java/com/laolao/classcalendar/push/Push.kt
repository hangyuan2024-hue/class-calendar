package com.laolao.classcalendar.push

import android.content.Context
import android.content.Intent
import cn.jiguang.api.utils.JCollectionAuth
import cn.jpush.android.api.CustomMessage
import cn.jpush.android.api.JPushInterface
import cn.jpush.android.api.JPushMessage
import cn.jpush.android.api.NotificationMessage
import cn.jpush.android.service.JCommonService
import cn.jpush.android.service.JPushMessageReceiver
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.widget.Widgets
import org.json.JSONObject

/**
 * 极光推送：老师 / 班委一发布，数据库马上让极光推到同学手机上（App 没开也能收到）。
 * 每个账号在极光里的别名 = u + 用户编号去掉横线（和数据库 jpush_alias 一样）。
 * 用户同意隐私说明（登录）之后才初始化。
 */
object Push {
    private var started = false
    fun alias(uid: String) = "u" + uid.replace("-", "")

    fun start(ctx: Context) {
        val uid = Api.uid ?: return
        val app = ctx.applicationContext
        try {
            if (!started) {
                JCollectionAuth.setAuth(app, true)
                JPushInterface.setDebugMode(false)
                JPushInterface.init(app)
                started = true
            }
            if (JPushInterface.isPushStopped(app)) JPushInterface.resumePush(app)
            val p = app.getSharedPreferences("push", Context.MODE_PRIVATE)
            if (p.getString("alias", "") != alias(uid) || System.currentTimeMillis() - p.getLong("alias_at", 0) > 7 * 86400_000L) {
                JPushInterface.setAlias(app, 1, alias(uid))
                p.edit().putString("alias_want", alias(uid)).apply()
            }
        } catch (e: Throwable) { e.printStackTrace() }
    }
    fun stop(ctx: Context) {
        val app = ctx.applicationContext
        try { if (started) JPushInterface.deleteAlias(app, 2) } catch (_: Throwable) {}
        app.getSharedPreferences("push", Context.MODE_PRIVATE).edit().clear().apply()
    }
    fun ready(ctx: Context): Boolean = ctx.getSharedPreferences("push", Context.MODE_PRIVATE).getString("alias", "").orEmpty().isNotEmpty()
    fun regId(ctx: Context): String = try { if (started) JPushInterface.getRegistrationID(ctx.applicationContext) ?: "" else "" } catch (_: Throwable) { "" }
    /** 最近一次收到极光推送的时间（收到过就说明推送通了，后台检查就不重复提醒） */
    fun lastArrived(ctx: Context): Long = ctx.getSharedPreferences("push", Context.MODE_PRIVATE).getLong("arrived", 0)
    internal fun arrived(ctx: Context) {
        ctx.getSharedPreferences("push", Context.MODE_PRIVATE).edit().putLong("arrived", System.currentTimeMillis()).apply()
    }
}

/** 极光要求：继承 JCommonService 的服务（提高推送稳定性） */
class PushService : JCommonService()

/** 极光的回调 */
class PushReceiver : JPushMessageReceiver() {
    override fun onAliasOperatorResult(ctx: Context, m: JPushMessage) {
        val p = ctx.getSharedPreferences("push", Context.MODE_PRIVATE)
        if (m.errorCode == 0) {
            if (m.sequence == 2) p.edit().remove("alias").apply()
            else p.edit().putString("alias", m.alias ?: p.getString("alias_want", "")).putLong("alias_at", System.currentTimeMillis()).apply()
        } else if (m.sequence == 1) {
            // 失败了（网络不好 / 太频繁）：过一会儿再试
            Bg.later(60_000) { Push.start(ctx) }
        }
    }
    override fun onNotifyMessageArrived(ctx: Context, m: NotificationMessage) {
        Push.arrived(ctx)
        // 有新消息：顺手刷新数据和小组件
        Store.init(ctx)
        Bg.run { try { Store.refresh(); com.laolao.classcalendar.work.Background.reschedule(ctx); Widgets.update(ctx) } catch (_: Exception) {} }
    }
    override fun onMessage(ctx: Context, m: CustomMessage) {
        Push.arrived(ctx)
        Store.init(ctx)
        Bg.run { try { Store.refresh(); Widgets.update(ctx) } catch (_: Exception) {} }
    }
}
