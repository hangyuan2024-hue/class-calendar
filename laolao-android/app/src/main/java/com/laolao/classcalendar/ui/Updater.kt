package com.laolao.classcalendar.ui

import android.app.Dialog
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Cfg
import com.laolao.classcalendar.core.str
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 7.x 安卓自动更新：打开 App 时（最多 12 小时一次）看官网 download/app-version.json，
 * 有新版本弹窗「立即更新」→ 在 App 里下载（先官网，断了换 GitHub），显示进度 → 下完直接调起系统安装界面，不用再去浏览器找文件
 */
object Updater {
    @Volatile private var running = false

    fun code(a: Main): Long = try { val p = a.packageManager.getPackageInfo(a.packageName, 0); if (Build.VERSION.SDK_INT >= 28) p.longVersionCode else p.versionCode.toLong() } catch (e: Exception) { 0 }
    fun version(a: Main): String = try { a.packageManager.getPackageInfo(a.packageName, 0).versionName ?: "" } catch (e: Exception) { "" }

    /** 启动时调：12 小时内问过就不问；同一个版本点过「以后」就三天内不再弹 */
    fun auto(a: Main) {
        val ap = a.getSharedPreferences("app", android.content.Context.MODE_PRIVATE)
        if (System.currentTimeMillis() - ap.getLong("upd_at", 0) < 12 * 3600_000L) return
        ap.edit().putLong("upd_at", System.currentTimeMillis()).apply()
        check(a, false)
    }

    fun check(a: Main, manual: Boolean) {
        if (running) { if (manual) a.toast("正在下载新版本…"); return }
        if (manual) a.toast("正在检查…")
        Bg.load({
            val c = URL(Cfg.VERSION_JSON + "?t=" + System.currentTimeMillis()).openConnection() as HttpURLConnection
            c.connectTimeout = 8000; c.readTimeout = 10000; c.useCaches = false
            try { JSONObject(c.inputStream.bufferedReader().readText()) } finally { c.disconnect() }
        }) { j, e ->
            if (j == null) { if (manual) a.toast("检查失败：" + (e?.message ?: "网络不好")); return@load }
            val vc = j.optLong("versionCode"); val vn = j.str("versionName")
            if (vc <= code(a)) { if (manual) a.toast("已经是最新版 " + version(a)); return@load }
            val ap = a.getSharedPreferences("app", android.content.Context.MODE_PRIVATE)
            if (!manual && ap.getLong("upd_skip", 0) == vc && System.currentTimeMillis() - ap.getLong("upd_skip_at", 0) < 3 * 86400_000L) return@load
            val mb = if (j.optLong("size") > 0) " · " + Media.size(j.optLong("size")) else ""
            ask(a, j, "有新版本 $vn", "你现在是 ${version(a)}$mb\n点「立即更新」在 App 里下载，下完点「安装」就能覆盖升级，数据不会丢。")
        }
    }

    private fun ask(a: Main, j: JSONObject, title: String, msg: String) {
        val ctx = a
        val c = ctx.col().apply { pad(22, 22, 22, 14) }
        lateinit var d: Dialog
        c.addView(ctx.text(title, 18f, C.text, BOLD))
        val tip = ctx.text(msg, 14.5f, C.sub).apply { margins(t = 8) }
        c.addView(tip)
        val bar = FrameLayout(ctx).apply { bg(C.mutedBg, 3); visibility = View.GONE }
        val fill = View(ctx).apply { bg(C.accent, 3) }
        bar.addView(fill, FrameLayout.LayoutParams(0, MATCH))
        c.addView(bar, LinearLayout.LayoutParams(MATCH, ctx.dp(6)).apply { topMargin = ctx.dp(14) })
        val btns = ctx.row().apply { gravity = Gravity.END; margins(t = 16) }
        val later = ctx.text("以后", 15f, C.sub, SEMI).apply { pad(16, 10); press(0, 10) }
        val web = ctx.text("去官网下载", 15f, C.sub, SEMI).apply { pad(16, 10); press(0, 10); visibility = View.GONE }
        val ok = ctx.text("立即更新", 15f, C.accent, BOLD).apply { pad(16, 10); press(0, 10) }
        btns.addView(later); btns.addView(web); btns.addView(ok); c.addView(btns)
        var file: File? = null
        later.tap {
            a.getSharedPreferences("app", android.content.Context.MODE_PRIVATE).edit().putLong("upd_skip", j.optLong("versionCode")).putLong("upd_skip_at", System.currentTimeMillis()).apply()
            d.dismiss()
        }
        web.tap { d.dismiss(); a.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(Cfg.SITE + "download/"))) }
        ok.tap {
            file?.let { install(a, it); return@tap }
            if (running) return@tap
            running = true; d.setCancelable(false)
            bar.visibility = View.VISIBLE; later.visibility = View.GONE; web.visibility = View.GONE
            ok.text = "下载中…"; tip.text = "正在下载新版本，别关这个窗口…"
            download(a, j, { p -> Bg.ui { fill.layoutParams = fill.layoutParams.apply { width = (bar.width * p).toInt() }; fill.requestLayout(); ok.text = "下载中 ${(p * 100).toInt()}%" } }) { f, err ->
                running = false; d.setCancelable(true)
                if (f == null) {
                    tip.text = "下载失败：${err ?: "网络不好"}\n可以再试一次，或者去官网下载。"
                    ok.text = "再试一次"; later.visibility = View.VISIBLE; web.visibility = View.VISIBLE; bar.visibility = View.GONE
                } else {
                    file = f; ok.text = "安装"; later.visibility = View.VISIBLE; (later as TextView).text = "关闭"
                    tip.text = "下载好了，点「安装」→ 系统界面里点「更新 / 安装」。\n第一次可能要先允许「安装未知应用」。"
                    install(a, f)
                }
            }
        }
        d = Dialogs.show(ctx, c)
    }

    private fun download(a: Main, j: JSONObject, prog: (Float) -> Unit, done: (File?, String?) -> Unit) {
        val urls = listOf(j.str("fallbackUrl"), j.str("url")).filter { it.isNotEmpty() }.map { if (it.startsWith("http")) it else Cfg.SITE + it.removePrefix("/") }.distinct()
        val want = j.optLong("size")
        Bg.load({
            val dir = File(a.cacheDir, "att").apply { mkdirs() }
            val f = File(dir, "update.apk")
            var last: Exception? = null
            for (u in urls) {
                try {
                    var url = u; var c: HttpURLConnection
                    var hops = 0
                    while (true) {   // GitHub 会跳到别的域名，HttpURLConnection 不跟着跨协议跳，自己跟
                        c = URL(url).openConnection() as HttpURLConnection
                        c.connectTimeout = 10000; c.readTimeout = 20000; c.instanceFollowRedirects = false; c.useCaches = false
                        val rc = c.responseCode
                        if (rc in 300..399 && hops++ < 6) { url = URL(URL(url), c.getHeaderField("Location")).toString(); c.disconnect(); continue }
                        if (rc != 200) { c.disconnect(); throw Exception("HTTP $rc") }
                        break
                    }
                    val total = c.contentLengthLong.takeIf { it > 0 } ?: want
                    var got = 0L; var lastP = 0L
                    try {
                        c.inputStream.use { ins -> f.outputStream().use { out ->
                            val buf = ByteArray(64 * 1024)
                            while (true) {
                                val n = ins.read(buf); if (n < 0) break
                                out.write(buf, 0, n); got += n
                                if (total > 0 && System.currentTimeMillis() - lastP > 250) { lastP = System.currentTimeMillis(); prog(minOf(0.99f, got.toFloat() / total)) }
                            }
                        } }
                    } finally { c.disconnect() }
                    if (want > 0 && got != want && u == urls.first()) throw Exception("文件不完整")
                    if (got < 512 * 1024) throw Exception("文件不完整")
                    prog(1f)
                    return@load f
                } catch (e: Exception) { last = e; f.delete() }
            }
            throw last ?: Exception("下载失败")
        }) { f, e -> done(f, e?.message) }
    }

    /** 调起系统安装界面；Android 8+ 第一次要先允许「安装未知应用」 */
    fun install(a: Main, f: File) {
        if (Build.VERSION.SDK_INT >= 26 && !a.packageManager.canRequestPackageInstalls()) {
            Dialogs.confirm(a, "先允许安装", "系统需要你允许「捞捞课程表」安装应用（只用于更新自己）。打开开关后回来，再点一次「安装」。", "去打开") {
                try { a.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.packageName))) } catch (e: Exception) { a.toast("请到系统设置里允许安装未知应用") }
            }
            return
        }
        val uri = Uri.parse("content://" + a.packageName + ".photo/att/" + f.name)
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        try { a.startActivity(i) } catch (e: Exception) { a.toast("打不开安装界面：" + (e.message ?: "")) }
    }
}
