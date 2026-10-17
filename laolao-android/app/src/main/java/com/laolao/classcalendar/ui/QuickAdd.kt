package com.laolao.classcalendar.ui

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.service.quicksettings.TileService
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Memo
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.Sync
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.When
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.newId
import com.laolao.classcalendar.widget.Widgets

/**
 * 一句话记事：桌面小组件、下拉快捷开关、长按图标都能直接打开（不用进 App）。
 * 「明天下午3点交数学作业 @图书馆」→ 自动认出日期、时间、地点、是不是作业
 */
class QuickAdd : Activity() {
    companion object {
        /** 在 App 里也用同一个小窗 */
        fun open(ctx: Context) { ctx.startActivity(Intent(ctx, QuickAdd::class.java)) }
    }

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        Store.init(this)
        C.load(this)
        if (!Api.loggedIn) { startActivity(Intent(this, Main::class.java)); finish(); return }
        val c = col().apply { pad(20, 20, 20, 14); background = round(C.card, dp(22).toFloat()) }
        c.addView(text("💬 一句话记一件事", 17f, C.text, BOLD))
        c.addView(text("写「明天下午3点交数学作业 @图书馆」，时间地点自动认出来", 12.5f, C.sub).apply { margins(t = 4) })
        val e = input("要记的事").apply { margins(t = 14); imeOptions = EditorInfo.IME_ACTION_DONE }
        c.addView(e)
        val preview = text("", 13f, C.accent, SEMI).apply { margins(t = 10) }
        c.addView(preview)
        e.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(x: Editable?) {
                val t = x.toString().trim()
                if (t.isEmpty()) { preview.text = ""; return }
                val q = Items.withLesson(Memo.quick(t), t)
                preview.text = "→ " + q.subject + "  " + (if (q.day.isNotEmpty()) "🗓 " + T.dayName(q.day) + " " + q.time else "🗓 没写日期（放进待办）") +
                    (if (q.place.isNotEmpty()) "  📍" + q.place else "") + if (q.homework) "  · 作业" else ""
            }
        })
        val btns = row().apply { gravity = Gravity.END or Gravity.CENTER_VERTICAL; margins(t = 14) }
        btns.addView(text("详细填写", 14.5f, C.sub, SEMI).apply {
            pad(14, 10); press(0, 10)
            tap { startActivity(Intent(this@QuickAdd, Main::class.java).putExtra("go", "add").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); finish() }
        })
        val save = text("记下来", 15f, android.graphics.Color.WHITE, BOLD).apply { pad(20, 10); press(C.accent, 18) }
        btns.addView(save)
        c.addView(btns)
        fun go() {
            val t = e.text.toString().trim()
            if (t.isEmpty()) { finish(); return }
            val q = Items.withLesson(Memo.quick(t), t)
            val rec = jsonOf("id" to newId("p"), "subject" to q.subject, "event_time" to if (q.day.isEmpty()) "" else When(q.day, q.time).toString(),
                "location" to q.place, "note" to "", "done" to false)
            if (q.homework) rec.put("kind", "作业")
            Items.saveMine(rec)
            toast("记好了 ✓ " + if (q.day.isNotEmpty()) T.dayName(q.day) + " " + q.time else "")
            Widgets.update(this)
            Bg.run { Sync.finish(); com.laolao.classcalendar.work.Background.reschedule(applicationContext) }
            finish()
        }
        save.tap { go() }
        e.setOnEditorActionListener { _, _, _ -> go(); true }
        val wrap = LinearLayout(this).apply { pad(16) }
        wrap.addView(c, LinearLayout.LayoutParams(MATCH, WRAP))
        setContentView(wrap)
        window.setLayout(MATCH, WRAP)
        window.setGravity(Gravity.CENTER)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        e.requestFocus()
    }
}

/** 下拉通知栏里的快捷开关「记一件事」 */
class QuickTile : TileService() {
    override fun onClick() {
        val i = Intent(this, QuickAdd::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= 34) startActivityAndCollapse(PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        else @Suppress("DEPRECATION") startActivityAndCollapse(i)
    }
}
