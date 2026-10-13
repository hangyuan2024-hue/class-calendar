package com.laolao.classcalendar

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.laolao.classcalendar.data.Repo
import com.laolao.classcalendar.work.Reminders
import com.laolao.classcalendar.work.SyncWorker
import java.util.concurrent.TimeUnit

class LaoApp : Application() {
    lateinit var repo: Repo

    override fun onCreate() {
        super.onCreate()
        instance = this
        repo = Repo(this)
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager::class.java).createNotificationChannel(
                NotificationChannel(Reminders.CHANNEL, "日程提醒", NotificationManager.IMPORTANCE_HIGH).apply { description = "课程和待办开始前提醒" })
        }
        WorkManager.getInstance(this).enqueueUniquePeriodicWork("sync", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build())
        Reminders.schedule(this)
    }

    companion object { lateinit var instance: LaoApp }
}
