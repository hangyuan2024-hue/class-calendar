package com.laolao.classcalendar.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Net

/** 网络检测：连不上的时候看是哪一步卡住了（截图发给开发者） */
class NetCheckPage(a: Main) : Page(a) {
    private lateinit var out: TextView
    private var busy = false
    private val lines = mutableListOf<String>()

    override fun build(): View = scaffold("网络检测") { b ->
        b.addView(ctx.text("登录一直超时的时候点「开始检测」，把结果截图发给我们。会分别连国内线路、海外线路和两个参照网站，看看是哪一步卡住。", 13.5f, C.sub).apply { setLineSpacing(0f, 1.35f) })
        b.add(ctx.button("开始检测") { run() }, 14)
        out = ctx.text("", 13.5f, C.text).apply { setTextIsSelectable(true); setLineSpacing(0f, 1.35f); bg(C.card, 14, C.line); pad(14, 12) }
        b.add(out, 14)
        b.add(ctx.soft("复制结果") {
            (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("net", out.text)); a.toast("已复制")
        }, 10)
        out.text = "还没检测"
    }

    private fun run() {
        if (busy) return; busy = true
        lines.clear()
        lines += "手机：${Build.MANUFACTURER} ${Build.MODEL} · 安卓 ${Build.VERSION.RELEASE}"
        lines += "现在用：${Net.routeName()}" + if (Net.lastError.isNotEmpty()) "；上次出错：${Net.lastError}" else ""
        lines += "检测中…（每一项最多 20 秒）"
        out.text = lines.joinToString("\n")
        Bg.run {
            Net.diagnose { l -> Bg.ui { lines.remove("检测中…（每一项最多 20 秒）"); lines += l; lines += "检测中…（每一项最多 20 秒）"; out.text = lines.joinToString("\n") } }
            Bg.ui { busy = false; lines.remove("检测中…（每一项最多 20 秒）"); lines += "检测完了"; out.text = lines.joinToString("\n") }
        }
    }
}
