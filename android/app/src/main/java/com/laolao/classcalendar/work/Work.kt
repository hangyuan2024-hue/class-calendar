package com.laolao.classcalendar.work

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.laolao.classcalendar.LaoApp
import com.laolao.classcalendar.MainActivity
import com.laolao.classcalendar.R
import com.laolao.classcalendar.model.AgendaItem
import com.laolao.classcalendar.model.Kind
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** 后台同步（每 15 分钟，系统统一调度，App 没打开也会跑）：顺便发新作业通知、更新小组件、排好提醒。 */
class SyncWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p) {
    override suspend fun doWork(): Result {
        val repo = LaoApp.instance.repo
        runCatching { repo.touchDevice() }
        repo.refresh(quiet = true)
        Reminders.schedule(applicationContext)
        Widgets.updateAll(applicationContext)
        return Result.success()
    }

    companion object {
        /** 马上在后台同步一次（比如在通知上点了「完成」） */
        fun now(c: Context) = WorkManager.getInstance(c).enqueueUniqueWork("sync_now", ExistingWorkPolicy.REPLACE, OneTimeWorkRequestBuilder<SyncWorker>().build())
    }
}

/** 通知渠道：用户可以在系统设置里分别开关 */
object Notify {
    const val AGENDA = "agenda"      // 上课、日程开始前
    const val HOMEWORK = "homework"  // 作业快截止了
    const val NEWS = "news"          // 班级里发了新作业 / 新通知

    fun channels(c: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = c.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(AGENDA, "上课和日程提醒", NotificationManager.IMPORTANCE_HIGH).apply { description = "上课、日程开始前提醒" })
        nm.createNotificationChannel(NotificationChannel(HOMEWORK, "作业截止提醒", NotificationManager.IMPORTANCE_HIGH).apply { description = "作业截止前提醒，可以直接在通知上点「完成」" })
        nm.createNotificationChannel(NotificationChannel(NEWS, "班级新消息", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "老师、班委发布了新作业或通知" })
    }

    fun openIntent(c: Context, route: String, req: Int): PendingIntent =
        PendingIntent.getActivity(c, req, Intent(c, MainActivity::class.java).putExtra("route", route).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    fun show(c: Context, id: Int, channel: String, title: String, text: String, route: String, doneKey: String? = null) {
        val b = NotificationCompat.Builder(c, channel).setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title).setContentText(text).setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(if (channel == NEWS) NotificationCompat.PRIORITY_DEFAULT else NotificationCompat.PRIORITY_HIGH)
            .setCategory(if (channel == AGENDA) NotificationCompat.CATEGORY_EVENT else NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true).setContentIntent(openIntent(c, route, id))
        if (doneKey != null) {
            val done = PendingIntent.getBroadcast(c, id, Intent(c, DoneReceiver::class.java).putExtra("key", doneKey).putExtra("nid", id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            b.addAction(0, "✓ 完成", done)
        }
        runCatching { c.getSystemService(NotificationManager::class.java).notify(id, b.build()) }
    }

    /** 同步后：班级里有没看过的新事项就发一条通知（第一次同步只记下来，不发） */
    fun newItems(c: Context) {
        val repo = LaoApp.instance.repo
        if (repo.pref("notify_news", "on") != "on") return
        val cid = repo.currentClass().optString("id"); if (cid.isBlank()) return
        val ids = repo.classItems().map { it.optString("id") }.filter { it.isNotBlank() }
        val keyName = "seen_ids_$cid"
        val old = repo.pref(keyName, "")
        repo.setPref(keyName, JSONArray(ids.takeLast(500)).toString())
        // 极光推送通了就由推送来提醒，这里不重复弹
        if (old.isEmpty() || LaoApp.foreground || com.laolao.classcalendar.push.Push.recentlyWorked(c)) return
        val known = runCatching { JSONArray(old) }.getOrNull()?.let { a -> (0 until a.length()).map { a.optString(it) }.toHashSet() } ?: return
        val fresh = repo.classItems().filter { it.optString("id") !in known }
        if (fresh.isEmpty()) return
        val cls = repo.currentClass().optString("name", "班级")
        val hw = fresh.count { it.optString("msg_type") == "作业" }
        val title = if (fresh.size == 1) "${cls}：新${fresh[0].optString("msg_type", "通知")}" else "${cls}：${fresh.size} 条新消息" + (if (hw > 0) "（$hw 项作业）" else "")
        val text = fresh.take(4).joinToString("\n") { "· " + it.optString("subject").ifBlank { it.optString("summary").take(30) } + (it.optString("event_time").takeIf { t -> t.length >= 10 }?.let { t -> "（" + t.substring(5, minOf(16, t.length)).replace('-', '/') + "）" } ?: "") }
        show(c, 4000 + (cid.hashCode() and 0xfff), NEWS, title, text, if (hw > 0) "homework" else "class")
    }
}

/**
 * 本地提醒：用系统闹钟排好接下来 36 小时内所有要提醒的事（App 被关掉、手机重启都照样响）：
 *  · 上课 / 有时间点的日程：开始前 N 分钟（默认 10）
 *  · 作业：有截止时间的提前 1 小时；截止日是明天的，今晚 20:00 提醒一次；今天截止没写时间的，早上 8:00
 */
object Reminders {
    const val CHANNEL = Notify.AGENDA
    private const val MAX = 24

    fun exactAllowed(c: Context): Boolean {
        if (Build.VERSION.SDK_INT < 31) return true
        return c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    }

    data class Plan(val at: LocalDateTime, val title: String, val text: String, val channel: String, val key: String?, val route: String)

    fun plans(c: Context): List<Plan> {
        val repo = LaoApp.instance.repo
        val lead = repo.pref("remind_lead", "10").toIntOrNull() ?: 10
        val now = LocalDateTime.now()
        val until = now.plusHours(36)
        val out = ArrayList<Plan>()
        if (repo.pref("remind", "on") == "on") {
            val days = listOf(LocalDate.now(), LocalDate.now().plusDays(1))
            for (d in days) for (a in repo.agenda(d)) {
                if (a.start == null || a.done || a.isHomework) continue
                val at = d.atStartOfDay().plusMinutes((a.start - lead).toLong())
                val head = if (a.kind == Kind.COURSE) "${lead} 分钟后上课：" else "${lead} 分钟后："
                out += Plan(at, head + a.title, a.timeText + (if (a.place.isNotBlank()) " · " + a.place else ""), Notify.AGENDA, null, "home")
            }
        }
        if (repo.pref("remind_hw", "on") == "on") {
            for (h in repo.homework()) {
                if (h.done || h.date == LocalDate.MAX) continue
                val text = h.title + (if (h.summary.isNotBlank()) " · " + h.summary.take(40) else "")
                if (h.start != null) out += Plan(h.date.atStartOfDay().plusMinutes((h.start - 60).toLong()), "1 小时后截止：" + h.title, text, Notify.HOMEWORK, h.id, "homework")
                if (h.date == LocalDate.now().plusDays(1)) out += Plan(LocalDate.now().atTime(20, 0), "明天要交：" + h.title, text, Notify.HOMEWORK, h.id, "homework")
                if (h.date == LocalDate.now() && h.start == null) out += Plan(LocalDate.now().atTime(8, 0), "今天要交：" + h.title, text, Notify.HOMEWORK, h.id, "homework")
            }
        }
        return out.filter { it.at.isAfter(now) && it.at.isBefore(until) }.sortedBy { it.at }.take(MAX)
    }

    private fun pi(c: Context, req: Int, p: Plan?): PendingIntent {
        val i = Intent(c, ReminderReceiver::class.java)
        if (p != null) i.putExtra("title", p.title).putExtra("text", p.text).putExtra("channel", p.channel).putExtra("key", p.key).putExtra("route", p.route)
        return PendingIntent.getBroadcast(c, 1000 + req, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun schedule(c: Context) {
        val am = c.getSystemService(AlarmManager::class.java)
        val prefs = c.getSharedPreferences("laolao_alarms", 0)
        val old = prefs.getInt("n", 0)
        for (i in 0 until maxOf(old, MAX)) runCatching { am.cancel(pi(c, i, null)) }
        val list = runCatching { plans(c) }.getOrDefault(emptyList())
        list.forEachIndexed { i, p ->
            val at = p.at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            val intent = pi(c, i, p)
            try {
                if (exactAllowed(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
            } catch (_: SecurityException) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, intent)
            }
        }
        prefs.edit().putInt("n", list.size).apply()
        Widgets.scheduleTicks(c)
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val key = i.getStringExtra("key")
        // 作业：已经勾了完成就不提醒了
        if (key != null && runCatching { LaoApp.instance.repo.findItem(key)?.done == true }.getOrDefault(false)) { Reminders.schedule(c); return }
        Notify.show(c, (System.currentTimeMillis() % 100000).toInt(), i.getStringExtra("channel") ?: Notify.AGENDA,
            i.getStringExtra("title") ?: "提醒", i.getStringExtra("text") ?: "", i.getStringExtra("route") ?: "home", key)
        Reminders.schedule(c)
    }
}

/** 通知上的「✓ 完成」 */
class DoneReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val key = i.getStringExtra("key") ?: return
        val repo = LaoApp.instance.repo
        repo.findItem(key)?.let { if (!it.done) repo.setDone(it, true) }
        runCatching { c.getSystemService(NotificationManager::class.java).cancel(i.getIntExtra("nid", 0)) }
        SyncWorker.now(c)
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try { Widgets.updateAll(c); Reminders.schedule(c) } finally { pending.finish() }
        }
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) { Reminders.schedule(c); SyncWorker.now(c) }
}

/** 下节课开始 / 结束时刷新小组件（倒计时） */
class WidgetTickReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val pending = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.Default).launch {
            try { Widgets.updateAll(c); Widgets.scheduleTicks(c) } finally { pending.finish() }
        }
    }
}

/** 下一个要刷新小组件的时间点：下节课开始前 30 / 10 分钟、开始、结束 */
fun nextTicks(items: List<AgendaItem>, nowMin: Int): List<Int> {
    val pts = ArrayList<Int>()
    for (a in items) {
        val s = a.start ?: continue
        pts += listOf(s - 30, s - 10, s, a.end ?: (s + 45))
    }
    return pts.filter { it > nowMin }.sorted()
}
