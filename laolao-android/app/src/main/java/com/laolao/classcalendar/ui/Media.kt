package com.laolao.classcalendar.ui

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.widget.ImageView
import com.laolao.classcalendar.core.ApiError
import com.laolao.classcalendar.core.Bg
import java.io.ByteArrayOutputStream
import java.io.File

/** 选图片 / 文件、压缩、显示 data:image 图片、打开下载好的附件 */
object Media {
    private val MIME = mapOf("apk" to "application/vnd.android.package-archive", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png", "gif" to "image/gif", "webp" to "image/webp", "heic" to "image/heic",
        "pdf" to "application/pdf", "doc" to "application/msword", "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" to "application/vnd.ms-excel", "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "ppt" to "application/vnd.ms-powerpoint",
        "pptx" to "application/vnd.openxmlformats-officedocument.presentationml.presentation", "txt" to "text/plain", "zip" to "application/zip", "ics" to "text/calendar", "json" to "application/json")
    fun ext(n: String) = n.substringAfterLast('.', "").lowercase()
    fun mimeOf(n: String) = MIME[ext(n)] ?: ""
    fun size(n: Long) = if (n >= 1048576) String.format("%.1f MB", n / 1048576.0) else "${maxOf(1, Math.round(n / 1024.0))} KB"

    /** 选图片：相册（可多选）或拍照 */
    fun pickImages(a: Main, multi: Boolean, fn: (List<Uri>) -> Unit) {
        Dialogs.sheet(a, "", listOf("从相册选", "拍照")) { i ->
            if (i == 0) {
                val it = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multi)
                a.startForResult(Intent.createChooser(it, "选图片")) { res, data -> if (res == Activity.RESULT_OK && data != null) fn(uris(data)) }
            } else camera(a) { fn(listOf(it)) }
        }
    }
    fun camera(a: Main, fn: (Uri) -> Unit) {
        val f = PhotoProvider.file(a); f.delete()
        val i = Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, PhotoProvider.uri(a)).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        a.startForResult(i) { res, _ ->
            if (res == Activity.RESULT_OK && f.length() > 0) {
                // 拍的照片会被下一次覆盖：先复制一份
                val keep = File(a.cacheDir, "cam_${System.currentTimeMillis()}.jpg"); f.copyTo(keep, true); fn(Uri.fromFile(keep))
            }
        }
    }
    /** 6.3 选文档（Word / txt）：导入文稿用 */
    fun pickDocs(a: Main, fn: (List<Uri>) -> Unit) {
        val it = Intent(Intent.ACTION_GET_CONTENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/msword", "text/plain", "application/octet-stream"))
        a.startForResult(Intent.createChooser(it, "选 Word 文档")) { res, data -> if (res == Activity.RESULT_OK && data != null) fn(uris(data)) }
    }
    fun nameOf(ctx: android.content.Context, u: Uri): String = try {
        ctx.contentResolver.query(u, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) ?: "" else "" } ?: ""
    } catch (_: Exception) { u.lastPathSegment ?: "" }
    /** 选任意文件（附件用） */
    fun pickFiles(a: Main, fn: (List<Uri>) -> Unit) {
        Dialogs.sheet(a, "", listOf("选文件（PDF、Word、Excel…）", "从相册选图片", "拍照")) { i ->
            when (i) {
                0 -> { val it = Intent(Intent.ACTION_GET_CONTENT).setType("*/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    a.startForResult(Intent.createChooser(it, "选文件")) { res, data -> if (res == Activity.RESULT_OK && data != null) fn(uris(data)) } }
                1 -> { val it = Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    a.startForResult(Intent.createChooser(it, "选图片")) { res, data -> if (res == Activity.RESULT_OK && data != null) fn(uris(data)) } }
                else -> camera(a) { fn(listOf(it)) }
            }
        }
    }
    private fun uris(d: Intent): List<Uri> {
        val c = d.clipData
        if (c != null) return (0 until c.itemCount).mapNotNull { c.getItemAt(it).uri }
        return listOfNotNull(d.data)
    }
    fun name(ctx: Context, u: Uri): String {
        if (u.scheme == "file") return u.lastPathSegment ?: "文件"
        return try { ctx.contentResolver.query(u, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null } } catch (e: Exception) { null } ?: "文件"
    }
    fun bytes(ctx: Context, u: Uri): ByteArray = ctx.contentResolver.openInputStream(u)?.use { it.readBytes() } ?: throw ApiError(0, "读不了这个文件")

    /** 读图、转正、长边压到 maxSide、JPEG；返回字节 */
    fun jpeg(ctx: Context, u: Uri, maxSide: Int, quality: Int): ByteArray {
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        ctx.contentResolver.openInputStream(u).use { BitmapFactory.decodeStream(it, null, o) }
        val big = maxOf(o.outWidth, o.outHeight); if (big <= 0) throw ApiError(0, "读不了这张图片")
        var s = 1; while (big / s > maxSide * 2) s *= 2
        val bm0 = ctx.contentResolver.openInputStream(u).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = s }) } ?: throw ApiError(0, "读不了这张图片")
        val rot = try { ctx.contentResolver.openInputStream(u).use { ExifInterface(it!!).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) } } catch (e: Exception) { ExifInterface.ORIENTATION_NORMAL }
        val deg = when (rot) { ExifInterface.ORIENTATION_ROTATE_90 -> 90f; ExifInterface.ORIENTATION_ROTATE_180 -> 180f; ExifInterface.ORIENTATION_ROTATE_270 -> 270f; else -> 0f }
        val k = minOf(1f, maxSide.toFloat() / maxOf(bm0.width, bm0.height))
        val m = Matrix().apply { postScale(k, k); if (deg != 0f) postRotate(deg) }
        val bm = Bitmap.createBitmap(bm0, 0, 0, bm0.width, bm0.height, m, true)
        val out = ByteArrayOutputStream(); bm.compress(Bitmap.CompressFormat.JPEG, quality, out)
        return out.toByteArray()
    }
    /** 日记、错题本的图片：data:image/jpeg;base64,…（和网页、小程序一样控制在 50 万字以内） */
    fun dataUrl(ctx: Context, u: Uri): String {
        for ((q, w) in listOf(80 to 1440, 60 to 1200, 45 to 960)) {
            val s = "data:image/jpeg;base64," + Base64.encodeToString(jpeg(ctx, u, w, q), Base64.NO_WRAP)
            if (s.length < 500_000) return s
        }
        throw ApiError(0, "照片过大，请裁剪后重新添加。")
    }
    fun bitmapOf(data: String, maxSide: Int = 900): Bitmap? = try {
        val b = Base64.decode(data.substringAfter(','), Base64.DEFAULT)
        val o = BitmapFactory.Options().apply { inJustDecodeBounds = true }; BitmapFactory.decodeByteArray(b, 0, b.size, o)
        var s = 1; while (maxOf(o.outWidth, o.outHeight) / s > maxSide) s *= 2
        BitmapFactory.decodeByteArray(b, 0, b.size, BitmapFactory.Options().apply { inSampleSize = s })
    } catch (e: Exception) { null }
    /** 后台解码再放进 ImageView */
    fun show(iv: ImageView, data: String, maxSide: Int = 900) { Bg.load({ bitmapOf(data, maxSide) }) { b, _ -> if (b != null) iv.setImageBitmap(b) } }

    /** 全屏看一张图：两指捏合放大缩小、双击放大 / 还原、放大后拖动看细节，点一下关闭（7.x） */
    fun preview(a: Main, data: String) {
        val d = android.app.Dialog(a, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val box = android.widget.FrameLayout(a).apply { setBackgroundColor(0xFF000000.toInt()) }
        val iv = ZoomImageView(a) { d.dismiss() }
        box.addView(iv, android.widget.FrameLayout.LayoutParams(-1, -1))
        box.addView(a.text("双指放大 · 双击放大 · 点一下关闭", 12f, 0xAAFFFFFF.toInt()).apply { pad(12, 6); bg(0x55000000, 14) },
            android.widget.FrameLayout.LayoutParams(-2, -2, android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL).apply { bottomMargin = a.dp(28) })
        d.setContentView(box)
        Bg.load({ bitmapOf(data, 3000) }) { b, _ -> if (b != null) iv.setImage(b) else { a.toast("图片打不开"); d.dismiss() } }
        d.show()
    }
    /** 用别的 App 打开下载好的附件 */
    fun open(a: Main, f: File, mime: String) {
        val u = Uri.parse("content://" + a.packageName + ".photo/att/" + Uri.encode(f.name))
        val i = Intent(Intent.ACTION_VIEW).setDataAndType(u, mime.ifEmpty { "*/*" }).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { a.startActivity(Intent.createChooser(i, "用什么打开")) } catch (e: Exception) { a.toast("这台手机上没有能打开它的应用") }
    }
}

/** 能放大缩小的图片：捏合缩放（1～6 倍）、双击在 1 倍和 2.5 倍之间切换、放大后拖动，边缘不会拖出黑边 */
class ZoomImageView(ctx: Context, private val onTap: () -> Unit) : ImageView(ctx) {
    private val m = Matrix()
    private var base = 1f; private var scale = 1f
    private var bw = 0; private var bh = 0
    private val sg = android.view.ScaleGestureDetector(ctx, object : android.view.ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScale(d: android.view.ScaleGestureDetector): Boolean { zoomBy(d.scaleFactor, d.focusX, d.focusY); return true }
    })
    private val gd = android.view.GestureDetector(ctx, object : android.view.GestureDetector.SimpleOnGestureListener() {
        override fun onSingleTapConfirmed(e: android.view.MotionEvent): Boolean { onTap(); return true }
        override fun onDoubleTap(e: android.view.MotionEvent): Boolean { animateTo(if (scale > 1.05f) 1f else 2.5f, e.x, e.y); return true }
        override fun onScroll(e1: android.view.MotionEvent?, e2: android.view.MotionEvent, dx: Float, dy: Float): Boolean { if (scale > 1.01f) { m.postTranslate(-dx, -dy); fix() }; return true }
    })
    init { scaleType = ScaleType.MATRIX }
    fun setImage(b: Bitmap) { setImageBitmap(b); bw = b.width; bh = b.height; post { reset() } }
    override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) { super.onSizeChanged(w, h, ow, oh); if (bw > 0) reset() }
    private fun reset() {
        if (width == 0 || bw == 0) return
        base = minOf(width.toFloat() / bw, height.toFloat() / bh); scale = 1f
        m.reset(); m.postScale(base, base); m.postTranslate((width - bw * base) / 2f, (height - bh * base) / 2f); imageMatrix = m
    }
    private fun zoomBy(f: Float, fx: Float, fy: Float) {
        val ns = (scale * f).coerceIn(1f, 6f); val k = ns / scale
        scale = ns; m.postScale(k, k, fx, fy); fix()
    }
    private fun animateTo(target: Float, fx: Float, fy: Float) {
        val from = scale
        android.animation.ValueAnimator.ofFloat(0f, 1f).apply {
            duration = 220
            addUpdateListener { v -> val want = from + (target - from) * (v.animatedValue as Float); zoomBy(want / scale, fx, fy) }
            start()
        }
    }
    /** 不让图片拖出边：比屏幕小就居中，比屏幕大就贴边 */
    private fun fix() {
        val r = android.graphics.RectF(0f, 0f, bw.toFloat(), bh.toFloat()); m.mapRect(r)
        var dx = 0f; var dy = 0f
        if (r.width() <= width) dx = (width - r.width()) / 2f - r.left else { if (r.left > 0) dx = -r.left; if (r.right < width) dx = width - r.right }
        if (r.height() <= height) dy = (height - r.height()) / 2f - r.top else { if (r.top > 0) dy = -r.top; if (r.bottom < height) dy = height - r.bottom }
        m.postTranslate(dx, dy); imageMatrix = m
    }
    override fun onTouchEvent(e: android.view.MotionEvent): Boolean {
        sg.onTouchEvent(e); if (!sg.isInProgress) gd.onTouchEvent(e)
        return true
    }
}
