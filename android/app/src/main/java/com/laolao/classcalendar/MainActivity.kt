package com.laolao.classcalendar

import android.Manifest
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
        setContent { LaoRoot(LaoApp.instance.repo) }
    }

    override fun onResume() {
        super.onResume()
        val repo = LaoApp.instance.repo
        lifecycleScope.launch {
            runCatching { repo.touchDevice() }
            repo.refresh(quiet = true)
            com.laolao.classcalendar.work.Reminders.schedule(this@MainActivity)
        }
    }
}
