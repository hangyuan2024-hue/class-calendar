package com.laolao.classcalendar

import android.app.Application
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.laolao.classcalendar.data.Repo
import com.laolao.classcalendar.work.Notify
import com.laolao.classcalendar.work.Reminders
import com.laolao.classcalendar.work.SyncWorker
import com.laolao.classcalendar.work.Widgets
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import java.util.concurrent.TimeUnit

class LaoApp : Application() {
    lateinit var repo: Repo
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun onCreate() {
        super.onCreate()
        instance = this
        repo = Repo(this)
        Notify.channels(this)
        // 本地改了（勾完成、记事）→ 小组件、提醒马上跟着变；同步完 → 发新消息通知
        repo.onLocalChange = { scope.launch { Widgets.updateAll(this@LaoApp) }; Reminders.schedule(this) }
        repo.onRefreshed = {
            runCatching { Notify.newItems(this) }
            Reminders.schedule(this)
            scope.launch { Widgets.updateAll(this@LaoApp) }
        }
        // 后台同步：系统允许的最短间隔 15 分钟。App 没打开也会跑，新作业最晚十几分钟就能收到通知
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.UPDATE,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        Reminders.schedule(this)
        runCatching { shortcuts() }
    }

    /** 长按桌面图标出现的快捷方式 */
    private fun shortcuts() {
        fun sc(id: String, label: String, intent: Intent) = ShortcutInfoCompat.Builder(this, id).setShortLabel(label).setLongLabel(label)
            .setIcon(IconCompat.createWithResource(this, R.mipmap.ic_launcher)).setIntent(intent).build()
        fun open(route: String) = Intent(this, MainActivity::class.java).setAction(Intent.ACTION_VIEW).putExtra("route", route)
        ShortcutManagerCompat.setDynamicShortcuts(this, listOf(
            sc("quick", "记一件事", Intent(this, QuickAddActivity::class.java).setAction(Intent.ACTION_VIEW)),
            sc("homework", "作业", open("homework")),
            sc("memo", "导入备忘录", open("memo")),
            sc("course_import", "拍课表导入", open("course_import")),
        ))
    }

    companion object {
        lateinit var instance: LaoApp
        /** App 在前台时不发「新消息」通知（已经在看了） */
        @Volatile var foreground = false
        /** 从小组件、通知、快捷方式、分享进来时要打开的页面 */
        val pendingRoute = MutableStateFlow<String?>(null)
        /** 从别的 App 分享过来的文字（导入备忘录用） */
        @Volatile var sharedText: String? = null
        /** 从别的 App 分享过来的图片（拍课表导入用） */
        @Volatile var sharedImage: android.net.Uri? = null
    }
}
