package com.laolao.classcalendar.work

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.laolao.classcalendar.core.Collect
import com.laolao.classcalendar.core.Store

/**
 * 7.1 群消息自动收集：系统把微信 / QQ 的新消息通知给我们看一眼（用户在系统设置里授权「通知使用权」）。
 * 只在这台手机上判断像不像作业、通知；像的放进待确认清单。别的 App 的通知一律不看、不存。
 */
class CollectService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val n = sbn ?: return
        val pkg = n.packageName ?: return
        if (pkg != Collect.WX && pkg !in Collect.QQ) return
        try {
            Store.init(applicationContext)
            if (!Collect.on(applicationContext)) return
            val ex = n.notification?.extras ?: return
            if ((n.notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return
            val title = ex.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
            // 一条通知里可能叠了好几条消息（MessagingStyle）：一条条看
            val msgs = ArrayList<String>()
            @Suppress("DEPRECATION")
            val arr = ex.getParcelableArray(Notification.EXTRA_MESSAGES)
            if (arr != null) for (p in arr) {
                val b = p as? android.os.Bundle ?: continue
                val t = b.getCharSequence("text")?.toString() ?: continue
                val who = b.getCharSequence("sender")?.toString() ?: ""
                msgs += if (who.isNotEmpty()) "$who: $t" else t
            }
            if (msgs.isEmpty()) {
                val t = (ex.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: ex.getCharSequence(Notification.EXTRA_TEXT))?.toString() ?: return
                msgs += t
            }
            var got = 0
            for (m in msgs.takeLast(6)) if (Collect.consider(applicationContext, pkg, title, m, n.postTime)) got++
            if (got > 0) {
                val total = Collect.count()
                Notify.show(applicationContext, 7300, Notify.CH_NEWS, "捞捞在群消息里发现 $total 件事",
                    "最新：「${title.take(12)}」" + (Collect.inbox().firstOrNull()?.text?.take(40) ?: "") + "\n点开核对，确认了才会记下", null, "collect", false)
            }
        } catch (_: Exception) {
            // 读不了就算了，不影响微信 / QQ 本身
        }
    }
}
