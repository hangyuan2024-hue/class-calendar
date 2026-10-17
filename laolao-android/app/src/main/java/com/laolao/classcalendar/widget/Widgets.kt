package com.laolao.classcalendar.widget

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.ui.Main
import com.laolao.classcalendar.ui.QuickAdd

/** 桌面小组件：今天的课和事、下节课倒计时、作业清单、一键记事 */
object Widgets {
    private val KINDS = listOf(TodayWidget::class.java, NextWidget::class.java, HomeworkWidget::class.java, QuickWidget::class.java)

    fun update(ctx: Context) {
        val app = ctx.applicationContext
        Store.init(app)
        val m = AppWidgetManager.getInstance(app)
        for (k in KINDS) {
            val ids = m.getAppWidgetIds(ComponentName(app, k))
            if (ids.isEmpty()) continue
            for (id in ids) try { m.updateAppWidget(id, build(app, k, id)) } catch (e: Exception) { e.printStackTrace() }
            if (k == TodayWidget::class.java || k == HomeworkWidget::class.java) m.notifyAppWidgetViewDataChanged(ids, R.id.w_list)
        }
    }
    fun any(ctx: Context): Boolean { val m = AppWidgetManager.getInstance(ctx); return KINDS.any { m.getAppWidgetIds(ComponentName(ctx, it)).isNotEmpty() } }

    private fun openApp(ctx: Context, req: Int, go: String? = null, item: String? = null): PendingIntent {
        val i = Intent(ctx, Main::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (go != null) i.putExtra("go", go)
        if (item != null) i.putExtra("item", item)
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private fun quick(ctx: Context, req: Int, voice: Boolean = false): PendingIntent =
        PendingIntent.getActivity(ctx, req, Intent(ctx, QuickAdd::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK).putExtra("voice", voice),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun build(ctx: Context, k: Class<*>, id: Int): RemoteViews = when (k) {
        TodayWidget::class.java -> list(ctx, id, false)
        HomeworkWidget::class.java -> list(ctx, id, true)
        NextWidget::class.java -> next(ctx)
        else -> RemoteViews(ctx.packageName, R.layout.widget_quick).apply {
            setOnClickPendingIntent(R.id.q_say, quick(ctx, 31))
            setOnClickPendingIntent(R.id.q_add, openApp(ctx, 32, "add"))
            setOnClickPendingIntent(R.id.q_photo, openApp(ctx, 33, "course_import"))
        }
    }

    private fun list(ctx: Context, id: Int, hw: Boolean): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_today)
        val d = T.today()
        if (!Api.loggedIn) {
            v.setTextViewText(R.id.w_date, "捞捞课程表"); v.setTextViewText(R.id.w_title, "点这里登录")
        } else if (hw) {
            val n = Items.pendingHomework().size
            v.setTextViewText(R.id.w_date, "${d.monthValue}月${d.dayOfMonth}日 ${T.wk(d)}")
            v.setTextViewText(R.id.w_title, if (Store.work()) "任务 · $n 项没做" else "作业 · $n 项没做")
        } else {
            val wk = Courses.weekNow()
            v.setTextViewText(R.id.w_date, "${d.monthValue}月${d.dayOfMonth}日 ${T.wk(d)}" + if (wk > 0) " · 第 $wk 周" else "")
            v.setTextViewText(R.id.w_title, "今天的课和事")
        }
        val svc = Intent(ctx, WidgetService::class.java).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra("hw", hw)
        svc.data = Uri.parse("laolao://widget/$id/" + if (hw) "hw" else "today")
        v.setRemoteAdapter(R.id.w_list, svc)
        v.setEmptyView(R.id.w_list, R.id.w_empty)
        v.setTextViewText(R.id.w_empty, if (!Api.loggedIn) "登录后这里会显示你的课和作业" else if (hw) "作业都做完了 🎉" else "今天没有安排，轻松一下 ☕")
        // 列表里每一行：点方框打勾、点别处打开（都经过 WidgetTap）
        val tpl = Intent(ctx, WidgetTap::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        v.setPendingIntentTemplate(R.id.w_list, PendingIntent.getActivity(ctx, if (hw) 21 else 22, tpl, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE))
        v.setOnClickPendingIntent(R.id.w_head, openApp(ctx, if (hw) 23 else 24, if (hw) "homework" else null))
        v.setOnClickPendingIntent(R.id.w_empty, openApp(ctx, if (hw) 25 else 26, if (hw) "homework" else null))
        v.setOnClickPendingIntent(R.id.w_add, if (hw) openApp(ctx, 27, "add") else quick(ctx, 28))
        return v
    }

    private fun next(ctx: Context): RemoteViews {
        val v = RemoteViews(ctx.packageName, R.layout.widget_next)
        val d = T.today()
        v.setTextViewText(R.id.n_date, "${d.monthValue}/${d.dayOfMonth} ${T.wk(d)}" + Courses.weekNow().let { if (it > 0) " · 第${it}周" else "" })
        v.setOnClickPendingIntent(R.id.n_root, openApp(ctx, 41))
        if (!Api.loggedIn) {
            v.setTextViewText(R.id.n_label, "捞捞"); v.setTextViewText(R.id.n_title, "登录后显示下一节课"); v.setTextViewText(R.id.n_sub, "")
            v.setViewVisibility(R.id.n_cd, View.GONE); v.setTextViewText(R.id.n_more, ""); return v
        }
        val n = try { Items.next() } catch (e: Exception) { null }
        if (n == null) {
            v.setTextViewText(R.id.n_label, "空闲"); v.setTextViewText(R.id.n_title, "手头没有要赶的事"); v.setTextViewText(R.id.n_sub, "好好休息一下 ☕")
            v.setViewVisibility(R.id.n_cd, View.GONE); v.setViewVisibility(R.id.n_left, View.GONE)
        } else {
            v.setTextViewText(R.id.n_label, n.label); v.setTextViewText(R.id.n_title, n.title); v.setTextViewText(R.id.n_sub, n.sub)
            val left = n.at - System.currentTimeMillis()
            if (n.at > 0 && left in 1 until 24 * 3600_000L) {
                v.setViewVisibility(R.id.n_cd, View.VISIBLE); v.setViewVisibility(R.id.n_left, View.GONE)
                v.setChronometer(R.id.n_cd, SystemClock.elapsedRealtime() + left, if (n.live) "还有 %s 下课" else "还有 %s", true)
                v.setChronometerCountDown(R.id.n_cd, true)
            } else {
                v.setViewVisibility(R.id.n_cd, View.GONE)
                v.setViewVisibility(R.id.n_left, if (n.at > 0) View.VISIBLE else View.GONE)
                if (n.at > 0) v.setTextViewText(R.id.n_left, T.left(left))
            }
            if (n.key.isNotEmpty()) v.setOnClickPendingIntent(R.id.n_root, openApp(ctx, 42, item = n.key))
        }
        val t = T.todayKey(); val nowMin = T.now().let { it.hour * 60 + it.minute }
        val lessons = if (Store.feat("courses")) Courses.on(t).count { (it.m1 ?: 0) > nowMin } else 0
        val hw = Items.pendingHomework().count { it.dated && it.day <= T.addDays(t, 1) }
        v.setTextViewText(R.id.n_more, listOf(if (lessons > 0) "今天还有 $lessons 节课" else "今天的课上完了", if (hw > 0) "$hw 项作业今明截止" else "").filter { it.isNotEmpty() }.joinToString(" · "))
        return v
    }

    /** 列表的数据 */
    fun rows(hw: Boolean): List<Item> {
        if (!Api.loggedIn) return emptyList()
        if (hw) return Items.pendingHomework().take(30)
        val t = T.todayKey()
        val nowMin = T.now().let { it.hour * 60 + it.minute }
        val list = Items.all(courses = t to t).filter { it.day == t && !(it.done && !it.course) }
        // 上完的课排到后面
        return list.sortedWith(compareBy<Item>({ if (it.course && (T.min(it.endTime) ?: 0) <= nowMin) 1 else 0 }, { it.time.ifEmpty { "00:00" } }))
    }
}

/** 列表行 */
class WidgetService : RemoteViewsService() {
    override fun onGetViewFactory(i: Intent): RemoteViewsFactory = Factory(applicationContext, i.getBooleanExtra("hw", false))
    class Factory(private val ctx: Context, private val hw: Boolean) : RemoteViewsFactory {
        private var list: List<Item> = emptyList()
        override fun onCreate() { Store.init(ctx) }
        override fun onDataSetChanged() { list = try { Widgets.rows(hw) } catch (e: Exception) { emptyList() } }
        override fun onDestroy() {}
        override fun getCount() = list.size
        override fun getViewAt(pos: Int): RemoteViews {
            val v = RemoteViews(ctx.packageName, R.layout.widget_row)
            val r = list.getOrNull(pos) ?: return v
            v.setTextViewText(R.id.r_title, r.title)
            val nowMin = T.now().let { it.hour * 60 + it.minute }
            if (r.course) {
                v.setViewVisibility(R.id.r_check, View.GONE); v.setViewVisibility(R.id.r_bar, View.VISIBLE)
                v.setInt(R.id.r_bar, "setColorFilter", r.color)
                v.setTextViewText(R.id.r_sub, r.sub)
                v.setTextViewText(R.id.r_time, r.time)
                val past = (T.min(r.endTime) ?: 0) <= nowMin
                v.setTextColor(R.id.r_title, if (past) 0xFF9AA4A9.toInt() else ctx.getColor(R.color.w_text))
            } else {
                v.setViewVisibility(R.id.r_check, View.VISIBLE); v.setViewVisibility(R.id.r_bar, View.GONE)
                v.setTextViewText(R.id.r_check, if (r.done) "✓" else "")
                v.setTextColor(R.id.r_title, ctx.getColor(R.color.w_text))
                val sub = if (hw) (if (r.dated) T.dayName(r.day) + (if (r.time.isNotEmpty()) " " + r.time else "") + " 截止" else "时间待定") + if (r.summary.isNotBlank() && r.summary != r.title) " · " + r.summary else ""
                          else listOf(if (r.mine) "我的" else r.type, r.sub).filter { it.isNotBlank() }.joinToString(" · ")
                v.setTextViewText(R.id.r_sub, sub)
                if (hw) {
                    val (t, lv) = Items.due(r)
                    v.setTextViewText(R.id.r_time, t)
                    v.setTextColor(R.id.r_time, if (lv >= 2) ctx.getColor(R.color.w_red) else ctx.getColor(R.color.w_accent))
                } else v.setTextViewText(R.id.r_time, r.time.ifEmpty { "全天" })
                v.setOnClickFillInIntent(R.id.r_check, Intent().putExtra("done", r.key))
            }
            v.setOnClickFillInIntent(R.id.r_root, Intent().putExtra(if (r.course) "go" else "item", if (r.course) "course" else r.key))
            return v
        }
        override fun getLoadingView(): RemoteViews? = null
        override fun getViewTypeCount() = 1
        override fun getItemId(pos: Int) = (list.getOrNull(pos)?.key?.hashCode() ?: pos).toLong()
        override fun hasStableIds() = true
    }
}

/** 小组件列表里点一下：打勾（不打开 App）或者打开那一条 */
class WidgetTap : Activity() {
    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        Store.init(this)
        val done = intent.getStringExtra("done")
        if (done != null) {
            val on = Items.toggleDone(done)
            android.widget.Toast.makeText(this, if (on) "完成 ✓" else "已取消完成", android.widget.Toast.LENGTH_SHORT).show()
            Widgets.update(this)
            Bg.run { com.laolao.classcalendar.core.Sync.finish() }
        } else {
            val i = Intent(this, Main::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            intent.getStringExtra("item")?.let { i.putExtra("item", it) }
            intent.getStringExtra("go")?.let { i.putExtra("go", it) }
            startActivity(i)
        }
        finish()
        @Suppress("DEPRECATION") overridePendingTransition(0, 0)
    }
}

open class BaseWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, m: AppWidgetManager, ids: IntArray) { Widgets.update(ctx) }
    override fun onEnabled(ctx: Context) { Store.init(ctx); com.laolao.classcalendar.work.Background.reschedule(ctx) }
    override fun onAppWidgetOptionsChanged(ctx: Context, m: AppWidgetManager, id: Int, o: Bundle) { Widgets.update(ctx) }
}
class TodayWidget : BaseWidget()
class NextWidget : BaseWidget()
class HomeworkWidget : BaseWidget()
class QuickWidget : BaseWidget()
