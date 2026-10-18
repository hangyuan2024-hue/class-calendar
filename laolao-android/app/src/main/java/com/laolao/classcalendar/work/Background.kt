package com.laolao.classcalendar.work

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.str
import com.laolao.classcalendar.ui.Main
import com.laolao.classcalendar.widget.Widgets

/** 提醒设置（只存这台手机） */
object Prefs {
    fun of(ctx: Context): SharedPreferences = ctx.getSharedPreferences("remind", Context.MODE_PRIVATE)
    fun classOn(ctx: Context) = of(ctx).getBoolean("class", true)
    fun lead(ctx: Context) = of(ctx).getInt("lead", 10)
    fun hwOn(ctx: Context) = of(ctx).getBoolean("hw", true)
    fun itemsOn(ctx: Context) = of(ctx).getBoolean("items", true)
    fun newsOn(ctx: Context) = of(ctx).getBoolean("news", true)
    fun briefOn(ctx: Context) = of(ctx).getBoolean("brief", false)
    fun set(ctx: Context, k: String, v: Any) { val e = of(ctx).edit(); when (v) { is Boolean -> e.putBoolean(k, v); is Int -> e.putInt(k, v) }; e.apply() }
}

/** 通知 */
object Notify {
    const val CH_CLASS = "class"; const val CH_DUE = "due"; const val CH_NEWS = "news"; const val CH_BRIEF = "brief"
    fun channels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_CLASS, "上课和日程提醒", NotificationManager.IMPORTANCE_HIGH).apply { description = "上课前、会议活动开始前提醒" })
        nm.createNotificationChannel(NotificationChannel(CH_DUE, "作业截止提醒", NotificationManager.IMPORTANCE_HIGH).apply { description = "作业快截止的时候提醒" })
        nm.createNotificationChannel(NotificationChannel(CH_NEWS, "班级新消息", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "老师、班委发布新作业和通知" })
        nm.createNotificationChannel(NotificationChannel(CH_BRIEF, "每日概览", NotificationManager.IMPORTANCE_LOW).apply { description = "每天早上看看今天有什么" })
    }
    fun open(ctx: Context, key: String?, go: String?, req: Int): PendingIntent {
        val i = Intent(ctx, Main::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (key != null) i.putExtra("item", key)
        if (go != null) i.putExtra("go", go)
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    fun show(ctx: Context, id: Int, ch: String, title: String, text: String, key: String?, go: String?, done: Boolean) {
        channels(ctx)
        val b = Notification.Builder(ctx, ch).setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text)).setAutoCancel(true).setColor(0xFF5366E8.toInt())
            .setContentIntent(open(ctx, key, go, id)).setCategory(if (ch == CH_NEWS) Notification.CATEGORY_SOCIAL else Notification.CATEGORY_REMINDER)
        if (done && key != null) {
            val di = Intent(ctx, DoneReceiver::class.java).putExtra("key", key).putExtra("nid", id)
            b.addAction(Notification.Action.Builder(null, "✓ 完成", PendingIntent.getBroadcast(ctx, id, di, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)).build())
        }
        try { ctx.getSystemService(NotificationManager::class.java).notify(id, b.build()) } catch (_: SecurityException) {}
    }
}

/** 通知上点「✓ 完成」 */
class DoneReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        Store.init(ctx)
        val key = i.getStringExtra("key") ?: return
        Items.setDone(key, true)
        ctx.getSystemService(NotificationManager::class.java).cancel(i.getIntExtra("nid", 0))
        val p = goAsync()
        Bg.run { try { com.laolao.classcalendar.core.Sync.finish(); Widgets.update(ctx) } finally { p.finish() } }
    }
}

/** 闹钟到点：弹提醒 */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        Store.init(ctx)
        when (i.action) {
            ACTION_TICK -> { Widgets.update(ctx); Background.reschedule(ctx); return }
            ACTION_BRIEF -> { Background.brief(ctx); Background.reschedule(ctx); return }
            ACTION_POMO -> {
                when (com.laolao.classcalendar.core.Plan.tick()) {
                    "focus" -> Notify.show(ctx, 7100, Notify.CH_CLASS, "🍅 一个番茄完成！", "休息 5 分钟吧，今天已经 ${com.laolao.classcalendar.core.Plan.today()} 个番茄", null, "plan", false)
                    "break" -> Notify.show(ctx, 7100, Notify.CH_CLASS, "休息结束", "准备下一个番茄吧 🍅", null, "plan", false)
                }
                Background.pomoAlarm(ctx); return
            }
            ACTION_COACH -> {
                val C = com.laolao.classcalendar.core.Coach
                if (!C.on() || !C.opt("notify")) return
                // 到点再看一眼：已经做到了就不打扰
                val now = System.currentTimeMillis(); val m = C.model()
                val kind = i.getStringExtra("kind") ?: ""
                val skip = when (kind) { "streak" -> C.streak(m, now).today >= 1; "best" -> C.goal(m, now).met || C.now().mode != "go"; else -> false }
                if (!skip) {
                    val text = if (kind == "best") C.now().say else i.getStringExtra("text") ?: ""
                    Notify.show(ctx, 7200, Notify.CH_CLASS, i.getStringExtra("title") ?: "", text, null, if (kind == "weekly") "coach" else null, false)
                }
                return
            }
            ACTION_TM -> {
                val tm = com.laolao.classcalendar.core.TimeMaster
                val phase = try { tm.timer().optString("phase") } catch (_: Exception) { "" }
                if (try { tm.reconcile() } catch (_: Exception) { false })
                    Notify.show(ctx, 7101, Notify.CH_CLASS, if (phase == "focus") "🍅 专注完成" else "休息结束", if (phase == "focus") "这一段专注已经记录，休息一下吧" else "准备开始下一段专注", null, "timemaster", false)
                Background.pomoAlarm(ctx); return
            }
        }
        val key = i.getStringExtra("key")
        // 已经做完了 / 删掉了就不提醒
        if (key != null && !key.startsWith("crs_")) { val r = Items.find(key); if (r == null || r.done) return }
        Notify.show(ctx, i.getIntExtra("nid", 1), i.getStringExtra("ch") ?: Notify.CH_CLASS, i.getStringExtra("title") ?: "", i.getStringExtra("text") ?: "",
            key?.takeIf { !it.startsWith("crs_") }, if (key?.startsWith("crs_") == true) "course" else null, i.getBooleanExtra("done", false))
        Widgets.update(ctx)
    }
    companion object { const val ACTION_TICK = "com.laolao.classcalendar.TICK"; const val ACTION_BRIEF = "com.laolao.classcalendar.BRIEF"; const val ACTION_POMO = "com.laolao.classcalendar.POMO"; const val ACTION_TM = "com.laolao.classcalendar.TM"; const val ACTION_COACH = "com.laolao.classcalendar.COACH" }
}

/** 开机、升级后：重新排好提醒 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, i: Intent) {
        Store.init(ctx)
        Background.reschedule(ctx); Background.startJob(ctx); Widgets.update(ctx)
        Guard.ensure(ctx)    // 5.9.4 游戏前先做 5 分钟（用户打开过才会启动）
    }
}

/** 每 15 分钟左右（系统决定）在后台拿一次新数据：班级新作业提醒、更新小组件、重排提醒 */
class SyncJob : JobService() {
    override fun onStartJob(p: JobParameters): Boolean {
        Store.init(this)
        if (!Api.loggedIn) return false
        Bg.run {
            try { if (Store.me == null) Store.boot() else Store.refresh(); Background.afterRefresh(this) } catch (_: Exception) {}
            jobFinished(p, false)
        }
        return true
    }
    override fun onStopJob(p: JobParameters) = true
}

object Background {
    private const val MAX = 40
    private const val JOB = 7701
    private fun am(ctx: Context) = ctx.getSystemService(AlarmManager::class.java)
    private fun exactOk(ctx: Context) = Build.VERSION.SDK_INT < 31 || am(ctx).canScheduleExactAlarms()

    fun startJob(ctx: Context) {
        val js = ctx.getSystemService(JobScheduler::class.java)
        val pj = js.getPendingJob(JOB)
        if (pj != null && pj.service.className == SyncJob::class.java.name) return
        js.schedule(JobInfo.Builder(JOB, ComponentName(ctx, SyncJob::class.java)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(15 * 60_000L).setPersisted(true).build())
    }

    /** 刷新完：班级新消息提醒、重排闹钟、更新小组件 */
    fun afterRefresh(ctx: Context) {
        try { news(ctx) } catch (_: Exception) {}
        reschedule(ctx)
        startJob(ctx)
        Widgets.update(ctx)
    }

    /** 班级里新发布的事项（极光推送通了就不重复提醒） */
    private fun news(ctx: Context) {
        val cls = Store.cls ?: return
        val p = ctx.getSharedPreferences("news", Context.MODE_PRIVATE)
        val k = "seen_" + cls.str("id")
        val ids = Store.items.map { it.opt("id").toString() }.toSet()
        val seen = p.getStringSet(k, null)
        p.edit().putStringSet(k, ids).apply()
        if (seen == null) return
        val fresh = Store.items.filter { it.opt("id").toString() !in seen && it.str("created_by") != Api.uid }
        if (fresh.isEmpty() || !Prefs.newsOn(ctx)) return
        if (System.currentTimeMillis() - com.laolao.classcalendar.push.Push.lastArrived(ctx) < 24 * 3600_000L) return
        val name = cls.str("name")
        if (fresh.size == 1) {
            val r = fresh[0]; val t = r.str("subject").ifBlank { r.str("summary").take(30) }
            val w = com.laolao.classcalendar.core.When.of(r.str("event_time"))
            Notify.show(ctx, 9000 + (r.opt("id").hashCode() and 0xfff), Notify.CH_NEWS, "$name：新" + r.str("msg_type").ifBlank { "通知" },
                t + (if (w != null) "（" + T.dayName(w.day) + (if (w.time.isNotEmpty()) " " + w.time else "") + "）" else ""), "c" + r.opt("id"), null, r.str("msg_type") == "作业")
        } else Notify.show(ctx, 9000, Notify.CH_NEWS, "$name：${fresh.size} 条新消息", fresh.take(3).joinToString("、") { it.str("subject").ifBlank { "新事项" } } + " 等", null, "homework", false)
    }

    /** 早上的今日概览 */
    fun brief(ctx: Context) {
        if (!Prefs.briefOn(ctx) || !Api.loggedIn) return
        val t = T.todayKey()
        val lessons = if (Store.feat("courses")) Courses.on(t) else emptyList()
        val items = Items.all().filter { it.day == t && !it.done }
        val hw = Items.pendingHomework().filter { it.dated && T.dayDiff(it.day) in 0..1 }
        if (lessons.isEmpty() && items.isEmpty() && hw.isEmpty()) return
        val parts = mutableListOf<String>()
        if (lessons.isNotEmpty()) parts += "${lessons.size} 节课（第一节 ${lessons[0].t0} ${lessons[0].name}）"
        if (items.isNotEmpty()) parts += "${items.size} 件事"
        if (hw.isNotEmpty()) parts += "${hw.size} 项作业今明两天截止"
        Notify.show(ctx, 8000, Notify.CH_BRIEF, "早上好，今天有 " + parts.joinToString("、"), (lessons.map { it.t0 + " " + it.name } + items.map { (if (it.time.isNotEmpty()) it.time + " " else "") + it.title }).take(6).joinToString("\n"), null, null, false)
    }

    private class Plan(val at: Long, val ch: String, val title: String, val text: String, val key: String?, val done: Boolean)

    /** 排好接下来 36 小时的提醒（App 关着也会准时响） */
    fun reschedule(ctx: Context) {
        val p = ctx.getSharedPreferences("alarms", Context.MODE_PRIVATE)
        val old = p.getInt("n", 0)
        for (i in 0 until maxOf(old, MAX)) {
            PendingIntent.getBroadcast(ctx, 100 + i, Intent(ctx, ReminderReceiver::class.java), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let { am(ctx).cancel(it); it.cancel() }
        }
        if (!Api.loggedIn) { p.edit().putInt("n", 0).apply(); return }
        val now = System.currentTimeMillis(); val end = now + 36 * 3600_000L
        val plans = mutableListOf<Plan>()
        val lead = Prefs.lead(ctx) * 60_000L
        val t = T.todayKey()
        if (Prefs.classOn(ctx) && Store.feat("courses")) for (d in listOf(t, T.addDays(t, 1))) for (c in Courses.on(d)) {
            val m = c.m0 ?: continue
            val at = T.epoch(d, m) - lead
            plans += Plan(at, Notify.CH_CLASS, "${Prefs.lead(ctx)} 分钟后上课：${c.name}", c.t0 + "-" + c.t1 + (if (c.location.isNotEmpty()) " · 📍 " + c.location else "") + " · 第${c.start}-${c.end}节", "crs_${c.name}_${c.start}_$d", false)
        }
        for (r in Items.all()) {
            if (r.done || !r.dated) continue
            val m = T.min(r.time)
            if (r.hw) {
                if (!Prefs.hwOn(ctx)) continue
                val due = T.epoch(r.day, m ?: (23 * 60 + 59))
                if (m != null) plans += Plan(due - 3600_000L, Notify.CH_DUE, "作业 1 小时后截止：${r.title}", "截止 ${T.dayName(r.day)} ${r.time}，做完了点「完成」", r.key, true)
                plans += Plan(T.epoch(T.addDays(r.day, -1), 20 * 60), Notify.CH_DUE, "明天要交：${r.title}", (if (m != null) "明天 ${r.time} 截止" else "明天截止") + "，今晚做完吧", r.key, true)
                if (m == null || m >= 12 * 60) plans += Plan(T.epoch(r.day, 7 * 60 + 30), Notify.CH_DUE, "今天要交：${r.title}", if (m != null) "今天 ${r.time} 截止" else "今天截止", r.key, true)
            } else if (m != null && Prefs.itemsOn(ctx)) {
                plans += Plan(T.epoch(r.day, m) - lead, Notify.CH_CLASS, "${Prefs.lead(ctx)} 分钟后：${r.title}", T.dayName(r.day) + " " + r.time + if (r.location.isNotEmpty()) " · 📍 " + r.location else "", r.key, true)
            }
        }
        val list = plans.filter { it.at in (now + 5000)..end }.sortedBy { it.at }.take(MAX - 2)
        list.forEachIndexed { i, pl ->
            val intent = Intent(ctx, ReminderReceiver::class.java).putExtra("nid", 1000 + i).putExtra("ch", pl.ch).putExtra("title", pl.title)
                .putExtra("text", pl.text).putExtra("key", pl.key).putExtra("done", pl.done)
            val pi = PendingIntent.getBroadcast(ctx, 100 + i, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            set(ctx, pl.at, pi, exact = true)
        }
        // 小组件按时翻页（下一节课开始、结束的时候）+ 早上的概览
        val ticks = mutableListOf<Long>()
        if (Store.feat("courses")) for (d in listOf(t, T.addDays(t, 1))) for (c in Courses.on(d)) { c.m0?.let { ticks += T.epoch(d, it) }; c.m1?.let { ticks += T.epoch(d, it) } }
        ticks += T.epoch(T.addDays(t, 1), 0) + 60_000
        ticks.filter { it > now + 5000 }.minOrNull()?.let {
            set(ctx, it, PendingIntent.getBroadcast(ctx, 100 + MAX - 2, Intent(ctx, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_TICK), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE), exact = false)
        }
        if (Prefs.briefOn(ctx)) {
            var at = T.epoch(t, 7 * 60); if (at < now) at = T.epoch(T.addDays(t, 1), 7 * 60)
            set(ctx, at, PendingIntent.getBroadcast(ctx, 100 + MAX - 1, Intent(ctx, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_BRIEF), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE), exact = true)
        }
        p.edit().putInt("n", MAX).apply()
        coach(ctx)
    }
    /** 捞捞教练：今天挑合适的时间提醒（状态最好的钟点、连续天数快断了、周日晚上复盘），最多 3 条；到点再确认一次还要不要发 */
    fun coach(ctx: Context) {
        for (i in 0 until 3) PendingIntent.getBroadcast(ctx, 90 + i, Intent(ctx, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_COACH), PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)?.let { am(ctx).cancel(it); it.cancel() }
        val C = com.laolao.classcalendar.core.Coach
        if (!Api.loggedIn || !C.on() || !C.opt("notify")) return
        val list = try {
            val c = com.laolao.classcalendar.core.Island.ctx()
            C.nudges(com.laolao.classcalendar.core.Island.rank(c.items, c.courses, c.now), c.courses, C.model(), System.currentTimeMillis())
        } catch (_: Exception) { emptyList() }
        list.forEachIndexed { i, n ->
            val it = Intent(ctx, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_COACH).putExtra("kind", n.kind).putExtra("title", n.title).putExtra("text", n.body)
            set(ctx, n.at, PendingIntent.getBroadcast(ctx, 90 + i, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE), exact = false)
        }
    }
    private fun set(ctx: Context, at: Long, pi: PendingIntent, exact: Boolean) {
        val a = am(ctx)
        try {
            if (exact && exactOk(ctx)) a.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else a.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (_: SecurityException) { a.set(AlarmManager.RTC_WAKEUP, at, pi) }
    }
    fun exactAllowed(ctx: Context) = exactOk(ctx)

    /** 番茄钟：专注 / 休息到点的提醒（App 关着也会响） */
    fun pomoAlarm(ctx: Context) {
        val pi = PendingIntent.getBroadcast(ctx, 99, Intent(ctx, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_POMO), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val p = com.laolao.classcalendar.core.Plan.pomo()
        if (p.mode == "focus" || p.mode == "break") set(ctx, p.end, pi, exact = true) else am(ctx).cancel(pi)
        // 时间管理大师的计时：另一个闹钟
        val pi2 = PendingIntent.getBroadcast(ctx, 98, Intent(ctx, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_TM), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val end = try { com.laolao.classcalendar.core.TimeMaster.endsAt() } catch (_: Exception) { 0L }
        if (end > 0) set(ctx, end, pi2, exact = true) else am(ctx).cancel(pi2)
    }
}
