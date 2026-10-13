package com.laolao.classcalendar.work

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.laolao.classcalendar.LaoApp
import com.laolao.classcalendar.MainActivity
import com.laolao.classcalendar.R
import com.laolao.classcalendar.model.AgendaItem
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId

/** Background sync every 30 minutes (WorkManager survives OEM task killers better than services). */
class SyncWorker(ctx: Context, p: WorkerParameters) : CoroutineWorker(ctx, p) {
    override suspend fun doWork(): Result {
        val repo = LaoApp.instance.repo
        runCatching { repo.touchDevice() }
        repo.refresh(quiet = true)
        Reminders.schedule(applicationContext)
        runCatching { TodayWidget().updateAll(applicationContext) }
        return Result.success()
    }
}

object Reminders {
    const val CHANNEL = "agenda"
    private const val LEAD_MIN = 10

    fun exactAllowed(c: Context): Boolean {
        if (Build.VERSION.SDK_INT < 31) return true
        return c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    }

    /** Schedules the next upcoming item of today/tomorrow. Falls back to inexact when exact alarms are revoked. */
    fun schedule(c: Context) {
        val repo = LaoApp.instance.repo
        if (repo.pref("remind", "on") != "on") return
        val now = LocalDateTime.now()
        val next: AgendaItem = (repo.agenda(LocalDate.now()) + repo.agenda(LocalDate.now().plusDays(1)))
            .filter { it.start != null && !it.done }
            .firstOrNull { it.date.atStartOfDay().plusMinutes((it.start!! - LEAD_MIN).toLong()).isAfter(now) } ?: return
        val at = next.date.atStartOfDay().plusMinutes((next.start!! - LEAD_MIN).toLong()).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        val intent = Intent(c, ReminderReceiver::class.java).putExtra("title", next.title)
            .putExtra("text", next.timeText + (if (next.place.isNotBlank()) " · " + next.place else ""))
        val pi = PendingIntent.getBroadcast(c, 7, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val am = c.getSystemService(AlarmManager::class.java)
        try {
            if (exactAllowed(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        } catch (_: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }
}

class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) {
        val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val n = NotificationCompat.Builder(c, Reminders.CHANNEL).setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("即将开始：" + i.getStringExtra("title")).setContentText(i.getStringExtra("text"))
            .setPriority(NotificationCompat.PRIORITY_HIGH).setAutoCancel(true).setContentIntent(open).build()
        runCatching { c.getSystemService(NotificationManager::class.java).notify(System.currentTimeMillis().toInt(), n) }
        Reminders.schedule(c)
    }
}

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(c: Context, i: Intent) = Reminders.schedule(c)
}

class TodayWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val items = LaoApp.instance.repo.agenda(LocalDate.now())
        provideContent {
            Column(GlanceModifier.fillMaxSize().background(ColorProvider(Color.White)).cornerRadius(20.dp).padding(14.dp)
                .clickable(actionStartActivity<MainActivity>())) {
                Text("今日安排 · ${items.size} 项", style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 15.sp, color = ColorProvider(Color(0xFF1E8CFF))))
                Spacer(GlanceModifier.height(6.dp))
                if (items.isEmpty()) Text("今天没有安排", style = TextStyle(color = ColorProvider(Color(0xFF6B7A90))))
                items.forEach { a ->
                    Row(GlanceModifier.padding(vertical = 2.dp)) {
                        Text(a.timeText, style = TextStyle(fontSize = 12.sp, color = ColorProvider(Color(0xFF6B7A90))))
                        Spacer(GlanceModifier.width(8.dp))
                        Text(a.title, style = TextStyle(fontSize = 13.sp, color = ColorProvider(Color(0xFF14202E))))
                    }
                }
            }
        }
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = TodayWidget() }
