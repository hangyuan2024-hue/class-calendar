package com.laolao.classcalendar.work

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.updateAll
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import com.laolao.classcalendar.LaoApp
import com.laolao.classcalendar.MainActivity
import com.laolao.classcalendar.QuickAddActivity
import com.laolao.classcalendar.model.AgendaItem
import com.laolao.classcalendar.model.AgendaModel
import com.laolao.classcalendar.model.Kind
import com.laolao.classcalendar.model.WEEKDAYS
import com.laolao.classcalendar.model.fmt
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/** 桌面小组件：今天的课和事、下节课倒计时、作业清单（能直接勾完成）、一键记事 / 拍课表 */
object Widgets {
    suspend fun updateAll(c: Context) {
        runCatching { TodayWidget().updateAll(c) }
        runCatching { NextClassWidget().updateAll(c) }
        runCatching { HomeworkWidget().updateAll(c) }
        runCatching { QuickWidget().updateAll(c) }
    }

    /** 在下一个关键时间点（下节课前 30 / 10 分钟、上课、下课）刷新一次倒计时 */
    fun scheduleTicks(c: Context) {
        runCatching {
            val repo = LaoApp.instance.repo
            val now = LocalTime.now().let { it.hour * 60 + it.minute }
            val next = nextTicks(repo.agenda(LocalDate.now()).filter { it.kind == Kind.COURSE }, now).firstOrNull()
            val atMin = next ?: (24 * 60 + 5)   // 今天没有了：明天 0:05 刷新一次
            val at = LocalDate.now().atStartOfDay().plusMinutes(atMin.toLong()).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            val pi = PendingIntent.getBroadcast(c, 900, Intent(c, WidgetTickReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            c.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        }
    }

    // ---------- 颜色：跟着 App 里选的配色（默认和网站一样的天空蓝） ----------
    fun accent(): Color {
        return runCatching { com.laolao.classcalendar.ui.paletteFor(LaoApp.instance.repo).accent }.getOrDefault(Color(0xFF1E8CFF))
    }

    fun parseHex(h: String): Color? {
        val t = h.removePrefix("#")
        if (t.length != 6) return null
        val v = t.toLongOrNull(16) ?: return null
        return Color(0xFF000000 or v)
    }

    val INK = Color(0xFF14202E)
    val MUTED = Color(0xFF6B7A90)
    val CARD = Color(0xFFFFFFFF)
    val LINE = Color(0xFFEFF3F8)

    fun open(c: Context, route: String): Intent =
        Intent(c, MainActivity::class.java).putExtra("route", route).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
}

private fun cp(c: Color) = ColorProvider(c)

// ==================== 今天的课和事 ====================
class TodayWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val repo = LaoApp.instance.repo
        val today = LocalDate.now()
        val now = LocalTime.now().let { it.hour * 60 + it.minute }
        val items = if (repo.api.logged()) repo.agenda(today) else emptyList()
        val accent = Widgets.accent()
        val week = runCatching { repo.meta().week(today) }.getOrDefault(0)
        provideContent {
            Column(GlanceModifier.fillMaxSize().background(cp(Widgets.CARD)).cornerRadius(22.dp).padding(14.dp)
                .clickable(actionStartActivity(Widgets.open(context, "home")))) {
                Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.Vertical.CenterVertically) {
                    Text("今天", style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp, color = cp(Widgets.INK)))
                    Spacer(GlanceModifier.width(6.dp))
                    Text("${today.monthValue}/${today.dayOfMonth} ${WEEKDAYS[today.dayOfWeek.value - 1]}" + (if (week in 1..30) " · 第${week}周" else ""),
                        style = TextStyle(fontSize = 12.sp, color = cp(Widgets.MUTED)))
                    Spacer(GlanceModifier.defaultWeight())
                    Text("${items.count { !it.done }} 项", style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Bold, color = cp(accent)))
                }
                Spacer(GlanceModifier.height(8.dp))
                if (!repo.api.logged()) Text("打开捞捞课程表登录后，这里显示今天的课和事", style = TextStyle(fontSize = 13.sp, color = cp(Widgets.MUTED)))
                else if (items.isEmpty()) Text("今天没有安排，好好休息 🎉", style = TextStyle(fontSize = 13.sp, color = cp(Widgets.MUTED)))
                items.take(7).forEach { a -> AgendaLine(a, now, accent) }
                if (items.size > 7) Text("还有 ${items.size - 7} 项…", style = TextStyle(fontSize = 11.sp, color = cp(Widgets.MUTED)))
            }
        }
    }
}

@Composable
private fun AgendaLine(a: AgendaItem, now: Int, accent: Color) {
    val active = a.start != null && a.start <= now && (a.end ?: a.start) > now
    val past = a.start != null && (a.end ?: a.start) <= now
    val bar = when { a.kind == Kind.COURSE -> accent; a.isHomework -> Color(0xFFFF7B2E); a.kind == Kind.CLASS -> Color(0xFF22A06B); else -> Color(0xFF8C6BFF) }
    Row(GlanceModifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.Vertical.CenterVertically) {
        Box(GlanceModifier.width(3.dp).height(26.dp).background(cp(if (past || a.done) Widgets.LINE else bar)).cornerRadius(2.dp)) {}
        Spacer(GlanceModifier.width(8.dp))
        Text(if (a.start == null) "全天" else fmt(a.start), style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Bold, color = cp(if (active) accent else Widgets.MUTED)))
        Spacer(GlanceModifier.width(8.dp))
        Column(GlanceModifier.defaultWeight()) {
            Text((if (a.done) "✓ " else "") + a.title, maxLines = 1,
                style = TextStyle(fontSize = 13.sp, fontWeight = if (active) FontWeight.Bold else FontWeight.Normal, color = cp(if (past || a.done) Widgets.MUTED else Widgets.INK)))
            val sub = listOf(if (active) "正在进行" else "", a.place, if (a.isHomework) "作业" else "").filter { it.isNotBlank() }.joinToString(" · ")
            if (sub.isNotBlank()) Text(sub, maxLines = 1, style = TextStyle(fontSize = 11.sp, color = cp(if (active) accent else Widgets.MUTED)))
        }
    }
}

// ==================== 下节课倒计时 ====================
class NextClassWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val repo = LaoApp.instance.repo
        val now = LocalTime.now().let { it.hour * 60 + it.minute }
        val logged = repo.api.logged()
        val todayCourses = if (logged) repo.agenda(LocalDate.now()).filter { it.kind == Kind.COURSE } else emptyList()
        val (cur, next) = AgendaModel.current(todayCourses, now)
        val tomorrow = if (logged && cur == null && next == null) repo.agenda(LocalDate.now().plusDays(1)).firstOrNull { it.kind == Kind.COURSE } else null
        val accent = Widgets.accent()
        val label: String; val title: String; val sub: String; val big: String
        when {
            !logged -> { label = "下节课"; title = "登录后显示"; sub = ""; big = "" }
            cur != null -> { label = "正在上课"; title = cur.title; sub = cur.place; big = "还剩 ${(cur.end ?: now) - now} 分钟" }
            next != null -> {
                val m = next.start!! - now
                label = "下节课 · ${fmt(next.start)}"; title = next.title; sub = next.place
                big = if (m >= 60) "${m / 60} 小时 ${m % 60} 分后" else "$m 分钟后"
            }
            tomorrow != null -> { label = "明天第一节 · ${tomorrow.start?.let { fmt(it) } ?: ""}"; title = tomorrow.title; sub = tomorrow.place; big = "今天没课了" }
            else -> { label = "下节课"; title = "今天没课了 🎉"; sub = ""; big = "" }
        }
        provideContent {
            Column(GlanceModifier.fillMaxSize().background(cp(accent)).cornerRadius(22.dp).padding(14.dp)
                .clickable(actionStartActivity(Widgets.open(context, "courses")))) {
                Text(label, maxLines = 1, style = TextStyle(fontSize = 12.sp, color = cp(Color(0xDDFFFFFF))))
                Spacer(GlanceModifier.height(4.dp))
                Text(title, maxLines = 2, style = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.Bold, color = cp(Color.White)))
                if (sub.isNotBlank()) Text("📍 $sub", maxLines = 1, style = TextStyle(fontSize = 12.sp, color = cp(Color(0xEEFFFFFF))))
                Spacer(GlanceModifier.defaultWeight())
                if (big.isNotBlank()) Text(big, maxLines = 1, style = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.Bold, color = cp(Color.White)))
            }
        }
    }
}

// ==================== 作业清单（点圆圈直接完成） ====================
private val KEY = ActionParameters.Key<String>("key")

class ToggleHomework : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val key = parameters[KEY] ?: return
        val repo = LaoApp.instance.repo
        repo.findItem(key)?.let { repo.setDone(it, !it.done) }
        Widgets.updateAll(context)
        Reminders.schedule(context)
        SyncWorker.now(context)
    }
}

class HomeworkWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val repo = LaoApp.instance.repo
        val today = LocalDate.now()
        val list = if (repo.api.logged()) repo.homework().filter { !it.done && (it.date == LocalDate.MAX || !it.date.isBefore(today.minusDays(14))) } else emptyList()
        val accent = Widgets.accent()
        provideContent {
            Column(GlanceModifier.fillMaxSize().background(cp(Widgets.CARD)).cornerRadius(22.dp).padding(14.dp)) {
                Row(GlanceModifier.fillMaxWidth().clickable(actionStartActivity(Widgets.open(context, "homework"))), verticalAlignment = Alignment.Vertical.CenterVertically) {
                    Text("作业", style = TextStyle(fontWeight = FontWeight.Bold, fontSize = 16.sp, color = cp(Widgets.INK)))
                    Spacer(GlanceModifier.defaultWeight())
                    Text(if (list.isEmpty()) "全部搞定" else "${list.size} 项没交", style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Bold, color = cp(if (list.any { it.date.isBefore(today) }) Color(0xFFE5484D) else accent)))
                }
                Spacer(GlanceModifier.height(6.dp))
                if (!repo.api.logged()) Text("打开 App 登录后显示", style = TextStyle(fontSize = 13.sp, color = cp(Widgets.MUTED)))
                else if (list.isEmpty()) Text("这周的作业都交了 🎉", style = TextStyle(fontSize = 13.sp, color = cp(Widgets.MUTED)))
                list.take(6).forEach { h ->
                    val days = if (h.date == LocalDate.MAX) null else java.time.temporal.ChronoUnit.DAYS.between(today, h.date)
                    val due = when { days == null -> "待定"; days < 0 -> "过期 ${-days} 天"; days == 0L -> if (h.start != null) "今天 ${fmt(h.start)}" else "今天"; days == 1L -> "明天"; else -> "${h.date.monthValue}/${h.date.dayOfMonth}" }
                    Row(GlanceModifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.Vertical.CenterVertically) {
                        Text("◯", style = TextStyle(fontSize = 17.sp, color = cp(accent)),
                            modifier = GlanceModifier.padding(end = 8.dp).clickable(actionRunCallback<ToggleHomework>(actionParametersOf(KEY to h.id))))
                        Text(h.title, maxLines = 1, modifier = GlanceModifier.defaultWeight().clickable(actionStartActivity(Widgets.open(context, "homework"))),
                            style = TextStyle(fontSize = 13.sp, color = cp(Widgets.INK)))
                        Spacer(GlanceModifier.width(6.dp))
                        Text(due, style = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Bold, color = cp(if (days != null && days < 0) Color(0xFFE5484D) else if (days != null && days <= 1) Color(0xFFFF7B2E) else Widgets.MUTED)))
                    }
                }
            }
        }
    }
}

// ==================== 一键记事 / 拍课表 ====================
class QuickWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val accent = Widgets.accent()
        provideContent {
            Row(GlanceModifier.fillMaxSize().background(cp(Widgets.CARD)).cornerRadius(22.dp).padding(10.dp), verticalAlignment = Alignment.Vertical.CenterVertically) {
                QuickBtn("✏️", "记一件事", accent, actionStartActivity(Intent(context, QuickAddActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)))
                Spacer(GlanceModifier.width(8.dp))
                QuickBtn("📷", "拍课表", accent, actionStartActivity(Widgets.open(context, "course_import")))
                Spacer(GlanceModifier.width(8.dp))
                QuickBtn("📝", "导入备忘录", accent, actionStartActivity(Widgets.open(context, "memo")))
            }
        }
    }
}

@Composable
private fun androidx.glance.layout.RowScope.QuickBtn(icon: String, label: String, accent: Color, action: androidx.glance.action.Action) {
    Column(GlanceModifier.defaultWeight().background(cp(Widgets.LINE)).cornerRadius(16.dp).padding(vertical = 10.dp).clickable(action),
        horizontalAlignment = Alignment.Horizontal.CenterHorizontally) {
        Text(icon, style = TextStyle(fontSize = 20.sp))
        Spacer(GlanceModifier.height(2.dp))
        Text(label, maxLines = 1, style = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Bold, color = cp(accent)))
    }
}

class TodayWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = TodayWidget() }
class NextClassWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = NextClassWidget() }
class HomeworkWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = HomeworkWidget() }
class QuickWidgetReceiver : GlanceAppWidgetReceiver() { override val glanceAppWidget: GlanceAppWidget = QuickWidget() }
