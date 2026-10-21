package com.laolao.classcalendar.ui

import android.app.Activity
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.ApiError
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File

/** 拍照 / 选截图 → 识别成课程 → 核对 → 存到云端课表 */
class CourseImportPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var rows: MutableList<JSONObject>? = null
    @Volatile private var lastB64 = ""   // 6.9 识别用的那张图：导入成功后存到账号里，首页点课程能看原图
    private var times: List<String>? = null
    private var week1: String = T.key(Courses.week1())
    private var replace = true
    private var status = ""
    private var busy = false
    private var warn = ""

    override fun build(): View = scaffold("拍课表导入") { body = it }

    override fun render() {
        view
        keepScroll(body)
        val list = rows
        if (list == null) {
            val c = ctx.card(20, 22)
            c.addView(ctx.text("📷", 40f).apply { gravity = Gravity.CENTER })
            c.add(ctx.text("拍一张课表，自动变成课程表", 18f, C.text, BOLD).apply { gravity = Gravity.CENTER }, 8)
            c.add(ctx.text("教务系统里的整周课表截图最好认；纸质课表请拍正、拍全、光线亮一点。识别完可以逐条核对再保存。", 13.5f, C.sub).apply { gravity = Gravity.CENTER }, 6)
            if (busy) c.add(ctx.text(status, 14f, C.accent, SEMI).apply { gravity = Gravity.CENTER; bg(C.selected, 12); pad(12, 10) }, 16)
            else {
                c.add(ctx.button("🖼 从相册选截图") { pick() }, 18)
                c.add(ctx.button("📷 拍照", C.selected, C.accent) { camera() }, 10)
            }
            body.addView(c)
            if (Courses.has()) body.add(ctx.text("你已经有 ${Courses.list().size} 门课。导入后可以选择替换原来的，还是加在后面。", 12.5f, C.sub).apply { gravity = Gravity.CENTER }, 12)
            return
        }
        if (warn.isNotEmpty()) body.addView(ctx.text(warn, 13f, C.text).apply { bg(C.noteBg, 12); pad(12, 10) })
        // 第一周
        val wc = ctx.card(4, 18).apply { margins(t = 12) }
        wc.addView(ctx.cell("🗓", "第一周的周一", T.md(week1) + " " + T.wk(week1) + " · 用来算现在是第几周", "改") { Dialogs.pickDate(ctx, week1) { d -> val x = T.date(d)!!; week1 = T.key(x.minusDays((x.dayOfWeek.value - 1).toLong())); render() } })
        if (Courses.has()) {
            wc.addView(ctx.hline())
            wc.addView(Toggle(ctx, "替换原来的 ${Courses.list().size} 门课", "关掉就是加在原来的后面", replace) { replace = it }.apply { pad(14, 10) })
        }
        body.addView(wc)
        val on = list.count { it.optBoolean("_on", true) }
        body.addView(ctx.section("认出 ${list.size} 门课", "点一门可以改，标黄的不太确定"))
        val lc = ctx.card(4, 18)
        list.forEachIndexed { i, o ->
            if (i > 0) lc.addView(ctx.hline())
            val r = ctx.row().apply { pad(8, 10) }
            val sel = o.optBoolean("_on", true)
            r.addView(a.check(sel) { o.put("_on", !sel); render() }, LinearLayout.LayoutParams(dp(22), dp(22)).apply { rightMargin = dp(10) })
            val cc = ctx.col()
            cc.addView(ctx.text(o.str("name"), 15f, if (sel) C.text else C.mutedText, SEMI, 1))
            cc.addView(ctx.text("周" + T.WEEK[o.optInt("day").coerceIn(0, 6)] + " 第${o.optInt("start")}-${o.optInt("end")}节 · ${o.str("weeks").ifEmpty { "1-16" }}周" + (if (o.str("location").isNotEmpty()) " · " + o.str("location") else ""), 12.5f, C.sub, lines = 1))
            r.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
            if (o.optBoolean("_unsure")) r.background = round(C.noteBg, dp(10).toFloat())
            r.tap { edit(o) }
            lc.addView(r)
        }
        body.addView(lc)
        body.add(ctx.button("保存 $on 门课到课程表") { save() }, 18)
        body.add(ctx.text("重新选一张", 14f, C.sub, SEMI).apply { gravity = Gravity.CENTER; pad(12); tap { rows = null; render() } }, 4)
    }

    // ---------- 选图 ----------
    private fun pick() {
        val i = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE)
        a.startForResult(Intent.createChooser(i, "选一张课表截图")) { res, data -> if (res == Activity.RESULT_OK) data?.data?.let { run(it) } }
    }
    private fun camera() {
        val f = PhotoProvider.file(ctx); f.delete()
        val uri = PhotoProvider.uri(ctx)
        val i = Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, uri)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
        a.startForResult(i) { res, _ -> if (res == Activity.RESULT_OK && f.length() > 0) run(Uri.fromFile(f)) }
    }

    /** 压缩 → 上传识别 → 等结果 */
    fun run(uri: Uri) {
        busy = true; status = "正在压缩图片…"; render()
        Bg.load({
            val b64 = compress(ctx, uri)
            lastB64 = b64
            Bg.ui { status = "上传中…"; render() }
            val job = Api.rpcObj("course_ocr_start", jsonOf("img" to b64)).str("job_id")
            if (job.isEmpty()) throw ApiError(0, "上传失败，请重试")
            val t0 = System.currentTimeMillis(); var r: JSONObject? = null
            while (System.currentTimeMillis() - t0 < 160_000) {
                Thread.sleep(1200)
                r = try { Api.rpcObj("course_ocr_status", jsonOf("jid" to job)) } catch (e: Exception) { null }
                val sec = (System.currentTimeMillis() - t0) / 1000
                val p = r?.optInt("progress") ?: 0
                Bg.ui { status = "识别中… " + (if (p > 0) "$p%，" else "") + "$sec 秒（一般 5~15 秒）"; render() }
                if (r != null && r.str("status").isNotEmpty() && r.str("status") != "running") break
            }
            val res = r ?: throw ApiError(0, "识别超时了，请稍后再试")
            if (res.str("status") != "done" || res.optJSONObject("result") == null) throw ApiError(0, res.str("message").ifBlank { "识别超时了，请稍后再试" })
            res.getJSONObject("result")
        }) { res, e ->
            busy = false
            if (res == null) { status = ""; render(); Dialogs.alert(ctx, "没识别成功", e?.message ?: "请换一张更清楚的图片试试"); return@load }
            take(res)
        }
    }
    private fun take(res: JSONObject) {
        val list = (res.optJSONArray("courses") ?: JSONArray()).objs().map { o ->
            val st = o.optInt("start", 1).coerceAtLeast(1)
            jsonOf("name" to o.str("name"), "day" to o.optInt("day", 0).coerceIn(0, 6), "start" to st, "end" to o.optInt("end", st).coerceAtLeast(st),
                "weeks" to o.str("weeks"), "location" to o.str("location"), "teacher" to o.str("teacher"), "_unsure" to (o.has("conf") && o.optDouble("conf", 1.0) < 0.9), "_box" to o.optJSONArray("box"))
        }.filter { it.str("name").isNotBlank() }.toMutableList()
        val maxW = maxOf(16, list.flatMap { Courses.parseWeeks(it.str("weeks").ifBlank { "1-16" }) }.maxOrNull() ?: 16)
        val noWeeks = list.count { it.str("weeks").isBlank() }
        list.forEach { if (it.str("weeks").isBlank()) { it.put("weeks", "1-$maxW"); it.put("_unsure", true) } }
        val t = res.optJSONObject("times")
        val nper = maxOf(res.optInt("periods"), list.maxOfOrNull { it.optInt("end") } ?: 0)
        val full = mutableListOf<String>()
        if (t != null) for (i in 1..nper) { val v = t.optString(i.toString()); if (!Regex("^\\d{2}:\\d{2}-\\d{2}:\\d{2}$").matches(v)) { full.clear(); break }; full += v }
        times = if (full.size >= 4) full else null
        val ws = res.optJSONArray("warnings")
        warn = listOfNotNull(
            if (list.isEmpty()) "没认出课程。换一张更清楚、更完整的截图试试（教务系统里的整周课表最好）。" else null,
            if (noWeeks > 0) "有 $noWeeks 门课没认出周次，先按「1-$maxW」填了，请核对。" else null,
            if (times != null) "认出了每节课的上课时间，会一起保存。" else null,
        ).plus((0 until (ws?.length() ?: 0)).map { ws!!.optString(it) }).joinToString("\n")
        rows = if (list.isEmpty()) null else list
        if (list.isEmpty()) Dialogs.alert(ctx, "没认出课程", "换一张更清楚、更完整的截图试试（教务系统里的整周课表最好）。")
        render()
    }

    /** 改一门课 */
    private fun edit(o: JSONObject) {
        val c = ctx.col().apply { pad(20, 20, 20, 12) }
        lateinit var d: android.app.Dialog
        c.addView(ctx.text("改一下", 18f, C.text, BOLD))
        val name = ctx.input("课程名", o.str("name")); c.add(name, 12)
        val day = Seg(ctx, T.WEEK.toList(), o.optInt("day")) {}; c.add(day, 10)
        val r = ctx.row().apply { margins(t = 10) }
        val st = ctx.input("第几节开始", o.optInt("start").toString(), type = android.text.InputType.TYPE_CLASS_NUMBER)
        val en = ctx.input("到第几节", o.optInt("end").toString(), type = android.text.InputType.TYPE_CLASS_NUMBER)
        r.addView(st, LinearLayout.LayoutParams(0, WRAP, 1f)); r.addView(ctx.text("—", 14f, C.sub).apply { pad(8, 0) }); r.addView(en, LinearLayout.LayoutParams(0, WRAP, 1f))
        c.addView(r)
        val wk = ctx.input("周次，比如 1-16、1-15单、2-16双", o.str("weeks")); c.add(wk, 10)
        val loc = ctx.input("地点", o.str("location")); c.add(loc, 10)
        val btns = ctx.row().apply { gravity = Gravity.END; margins(t = 12) }
        btns.addView(ctx.text("删掉这门", 15f, C.red, SEMI).apply { pad(14, 10); tap { d.dismiss(); rows?.remove(o); render() } })
        btns.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        btns.addView(ctx.text("好了", 15f, C.accent, BOLD).apply { pad(16, 10); tap {
            val s = st.text.toString().toIntOrNull()?.coerceIn(1, 16) ?: 1; val e = en.text.toString().toIntOrNull()?.coerceIn(s, 16) ?: s
            o.put("name", name.text.toString().trim()); o.put("day", day.sel); o.put("start", s); o.put("end", e)
            o.put("weeks", wk.text.toString().trim()); o.put("location", loc.text.toString().trim()); o.put("_unsure", false)
            d.dismiss(); render()
        } })
        c.addView(btns)
        d = Dialogs.show(ctx, c)
    }

    private fun save() {
        val chosen = rows?.filter { it.optBoolean("_on", true) && it.str("name").isNotBlank() } ?: return
        if (chosen.isEmpty()) { a.toast("至少选一门课"); return }
        if (busy) return; busy = true
        val keep = if (replace) emptyList() else Courses.list()
        Bg.load({ Courses.upload(keep + chosen, times, T.date(week1)) }) { _, e ->
            busy = false
            if (e != null) { a.toast("保存失败：" + e.message); return@load }
            a.toast("课程表存好了，网页和小程序也能看到 🎉")
            if (lastB64.isNotEmpty()) com.laolao.classcalendar.core.CourseShot.push(lastB64, chosen)
            close(); a.push(CoursePage(a))
        }
    }

    companion object {
        /** 读图、按 EXIF 转正、长边压到 1800 像素、JPEG */
        fun compress(ctx: Context, uri: Uri): String {
            val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            ctx.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, o) }
            val big = maxOf(o.outWidth, o.outHeight)
            if (big <= 0) throw ApiError(0, "读不了这张图片")
            var s = 1; while (big / s > 3600) s *= 2
            val bm0 = ctx.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = s }) } ?: throw ApiError(0, "读不了这张图片")
            val rot = try { ctx.contentResolver.openInputStream(uri).use { ExifInterface(it!!).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } } catch (e: Exception) { ExifInterface.ORIENTATION_NORMAL }
            val deg = when (rot) { ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f }
            val k = minOf(1f, 1800f / maxOf(bm0.width, bm0.height))
            val m = Matrix().apply { postScale(k, k); if (deg != 0f) postRotate(deg) }
            val bm = Bitmap.createBitmap(bm0, 0, 0, bm0.width, bm0.height, m, true)
            val out = ByteArrayOutputStream()
            bm.compress(Bitmap.CompressFormat.JPEG, 85, out)
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        }
    }
}

/** 拍照时给相机 App 一个能写的地址（不用 AndroidX 的 FileProvider） */
class PhotoProvider : ContentProvider() {
    companion object {
        fun file(ctx: Context) = File(ctx.cacheDir, "photo.jpg")
        fun uri(ctx: Context): Uri = Uri.parse("content://" + ctx.packageName + ".photo/photo.jpg")
    }
    override fun onCreate() = true
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        val path = uri.path ?: ""
        // /att/<文件名>：下载好的附件，给别的 App 打开（只读）
        if (path.startsWith("/att/")) {
            val f = File(File(context!!.cacheDir, "att"), path.removePrefix("/att/").substringAfterLast('/'))
            return ParcelFileDescriptor.open(f, ParcelFileDescriptor.MODE_READ_ONLY)
        }
        val f = file(context!!)
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode))
    }
    override fun getType(uri: Uri): String = if ((uri.path ?: "").startsWith("/att/")) Media.mimeOf(uri.path ?: "").ifEmpty { "application/octet-stream" } else "image/jpeg"
    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null
    override fun insert(uri: Uri, v: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0
}
