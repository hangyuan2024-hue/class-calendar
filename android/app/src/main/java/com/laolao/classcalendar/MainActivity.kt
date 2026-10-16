package com.laolao.classcalendar

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import com.laolao.classcalendar.ui.LaoRoot
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        setTheme(R.style.AppTheme)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= 33)
            registerForActivityResult(ActivityResultContracts.RequestPermission()) {}.launch(Manifest.permission.POST_NOTIFICATIONS)
        handle(intent)
        setContent { LaoRoot(LaoApp.instance.repo) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handle(intent)
    }

    /** 小组件、通知、快捷方式点进来的页面；别的 App「分享」过来的文字（备忘录）和图片（课表截图） */
    private fun handle(i: Intent?) {
        if (i == null) return
        if (i.action == Intent.ACTION_SEND) {
            val type = i.type.orEmpty()
            if (type.startsWith("image/")) {
                @Suppress("DEPRECATION")
                val uri = if (Build.VERSION.SDK_INT >= 33) i.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) else i.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                if (uri != null) { LaoApp.sharedImage = uri; LaoApp.pendingRoute.value = "course_import" }
            } else {
                val text = listOfNotNull(i.getStringExtra(Intent.EXTRA_SUBJECT), i.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()).joinToString("\n").trim()
                if (text.isNotEmpty()) { LaoApp.sharedText = text; LaoApp.pendingRoute.value = "memo" }
            }
            return
        }
        i.getStringExtra("route")?.takeIf { it.isNotBlank() }?.let { LaoApp.pendingRoute.value = it }
        i.removeExtra("route")
    }

    override fun onResume() {
        super.onResume()
        LaoApp.foreground = true
        val repo = LaoApp.instance.repo
        lifecycleScope.launch {
            runCatching { repo.touchDevice() }
            repo.refresh(quiet = true)
            com.laolao.classcalendar.work.Reminders.schedule(this@MainActivity)
        }
    }

    override fun onPause() {
        super.onPause()
        LaoApp.foreground = false
    }
}
