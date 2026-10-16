package com.laolao.classcalendar

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.quicksettings.TileService
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.laolao.classcalendar.model.Memo
import com.laolao.classcalendar.model.WEEKDAYS
import com.laolao.classcalendar.ui.LaoTheme
import com.laolao.classcalendar.ui.paletteFor
import com.laolao.classcalendar.work.SyncWorker

/** 一句话记事：桌面小组件、长按图标、下拉通知栏的开关都打开这个小窗，不用进 App */
class QuickAddActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val repo = LaoApp.instance.repo
        setContent {
            LaoTheme(paletteFor(repo), repo.pref("dark", "system")) {
                var text by remember { mutableStateOf("") }
                var hwOverride by remember { mutableStateOf<Boolean?>(null) }
                val focus = remember { FocusRequester() }
                LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
                val parsed = Memo.quick(text)
                val hw = hwOverride ?: (parsed?.homework == true)
                fun save() {
                    val p = parsed ?: return
                    if (p.subject.isBlank()) return
                    repo.saveEvent(null, p.subject, p.date, p.time, p.place, p.note, homework = hw, src = "quick")
                    SyncWorker.now(this@QuickAddActivity)
                    android.widget.Toast.makeText(this@QuickAddActivity, if (p.date != null) "已记下，到时间会提醒你" else "已记下", android.widget.Toast.LENGTH_SHORT).show()
                    finish()
                }
                AlertDialog(onDismissRequest = { finish() },
                    title = { Text("记一件事") },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(text, { text = it.take(120) }, modifier = Modifier.fillMaxWidth().focusRequester(focus),
                                placeholder = { Text("明天下午3点交实验报告 @B302") }, singleLine = true,
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done), keyboardActions = KeyboardActions(onDone = { save() }))
                            if (parsed != null && text.isNotBlank()) {
                                val d = parsed.date
                                Text(listOf(
                                    if (d != null) "📅 ${d.monthValue}月${d.dayOfMonth}日 ${WEEKDAYS[d.dayOfWeek.value - 1]}" else "📅 没写日期（记在待办里）",
                                    if (parsed.time.isNotBlank()) "⏰ ${parsed.time}" else "",
                                    if (parsed.place.isNotBlank()) "📍 ${parsed.place}" else "",
                                ).filter { it.isNotBlank() }.joinToString("   "), fontSize = 13.sp)
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(hw, { hwOverride = it })
                                Text("这是作业（会出现在作业页，截止前提醒）", fontSize = 13.sp)
                            }
                        }
                    },
                    confirmButton = { TextButton(onClick = { save() }, enabled = text.isNotBlank()) { Text("记下") } },
                    dismissButton = { TextButton(onClick = { finish() }) { Text("取消") } })
            }
        }
    }
}

/** 下拉通知栏里的「记一件事」开关 */
class QuickAddTile : TileService() {
    override fun onClick() {
        super.onClick()
        val i = Intent(this, QuickAddActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(i)
        }
    }
}
