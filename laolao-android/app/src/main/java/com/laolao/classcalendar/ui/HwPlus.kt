package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.ApiError
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Item
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 7.x 作业页：图片附件直接显示小图、已读人数（和小程序 hwplus.js、网站同一套接口，5.8.0 SQL）：
 * item_extras（每条有几个附件）→ item_files_many（附件列表 + 小图）→ item_view_counts（已读人数）。
 * 以前上传的图片没有小图：下载下来在手机上压一张，存在本机，能写的顺便存回服务器（file_thumb）。
 * 数据库还没升级时这些接口会报错：安静地不显示，不影响别的。
 */
object HwPlus {
    class F(val id: String, val name: String, val mime: String, val size: Long, val parts: Int, val canThumb: Boolean, var thumb: Bitmap?) {
        val img get() = mime.startsWith("image/")
    }
    private var counts: Map<String, Int> = emptyMap(); private var countsAt = 0L; private var countsCid: String? = null
    private val files = HashMap<String, List<F>>(); private val filesAt = HashMap<String, Long>()
    private var views: JSONObject? = null; private var viewsAt = 0L; private var viewsCid: String? = null
    @Volatile private var busy = false
    private val tried = HashMap<String, Int>()

    fun count(key: String): Int = counts[key] ?: 0
    fun list(key: String): List<F>? = files[key]
    /** 「已读 12/40」：只有班级事项、能拿到人数时才有 */
    fun read(r: Item): String {
        val v = views ?: return ""; if (r.mine || viewsCid != Store.cls?.str("id")) return ""
        val n = v.optJSONObject("views")?.optInt(r.id) ?: 0
        val t = v.optJSONObject("aud")?.optInt(r.id)?.takeIf { it > 0 } ?: v.optInt("total")
        return if (t > 0) "已读 $n/$t" else ""
    }

    /** 作业页每次画完调一次（主线程）：后台拿附件、小图、已读人数，有变化再叫 changed 重画 */
    fun load(ctx: Context, rows: List<Item>, changed: () -> Unit) {
        if (busy || Store.me == null) return
        busy = true
        Bg.load({ work(ctx, rows) }) { ch, _ -> busy = false; if (ch == true) changed() }
    }
    private fun work(ctx: Context, rows: List<Item>): Boolean {
        val cid = Store.cls?.str("id")
        val now = System.currentTimeMillis()
        var ch = false
        if (cid != countsCid || now - countsAt > 60_000) {
            countsAt = now; countsCid = cid
            try {
                val r = Api.rpc("item_extras", jsonOf("cid" to cid)) as? JSONObject
                val m = HashMap<String, Int>(); r?.optJSONObject("files")?.let { o -> o.keys().forEach { k -> m[k] = o.optInt(k) } }
                if (m != counts) { counts = m; ch = true }
            } catch (_: Exception) {}
        }
        if (cid != null && rows.any { !it.mine } && (cid != viewsCid || now - viewsAt > 60_000)) {
            viewsAt = now
            try { views = Api.rpc("item_view_counts", jsonOf("cid" to cid)) as? JSONObject; viewsCid = cid; ch = true } catch (_: Exception) {}
            // 打开作业页就算看过
            val ids = JSONArray(); rows.filter { !it.mine && !it.course }.mapNotNull { it.id.toLongOrNull() }.take(200).forEach { ids.put(it) }
            if (ids.length() > 0) try { Api.rpc("item_seen", jsonOf("cid" to cid, "ids" to ids)) } catch (_: Exception) {}
        }
        val want = rows.filter { count(it.key) > 0 && (files[it.key] == null || now - (filesAt[it.key] ?: 0) > 300_000) }
        for ((c, l) in listOf(cid to want.filter { !it.mine }, null to want.filter { it.mine })) {
            if (l.isEmpty() || (c == null && l.any { !it.mine })) continue
            val ref = { r: Item -> if (r.mine) r.key else r.id }
            try {
                val m = Api.rpc("item_files_many", jsonOf("cid" to c, "keys" to JSONArray(l.take(60).map(ref)))) as? JSONObject
                for (r in l.take(60)) {
                    val arr = m?.optJSONArray(ref(r))?.objs() ?: emptyList()
                    files[r.key] = arr.map { f -> F(f.str("id"), f.str("name"), f.str("mime"), f.optLong("size"), maxOf(1, f.optInt("parts")), f.optBoolean("can_thumb"),
                        f.str("thumb").takeIf { it.isNotEmpty() }?.let { decode(it) } ?: disk(ctx, f.str("id"))) }
                    filesAt[r.key] = now
                }
                ch = true
            } catch (_: Exception) { l.forEach { files[it.key] = emptyList() } }
        }
        // 以前传的图片没有小图：下载原图（不超过 1.6MB）压一张
        for (l in files.values) for (f in l) {
            if (f.thumb != null || !f.img || f.size > 1_600_000 || (tried[f.id] ?: 0) >= 3) continue
            tried[f.id] = (tried[f.id] ?: 0) + 1
            try {
                val file = pull(ctx, f.id, f.name, f.parts)
                val b = Media.jpeg(ctx, android.net.Uri.fromFile(file), 360, 55)
                File(ctx.cacheDir, "thm_${f.id}.jpg").writeBytes(b)
                f.thumb = BitmapFactory.decodeByteArray(b, 0, b.size); ch = true
                if (f.canThumb) try { Api.rpc("file_thumb", jsonOf("fid" to f.id, "b64" to Base64.encodeToString(b, Base64.NO_WRAP))) } catch (_: Exception) {}
            } catch (_: Exception) {}
        }
        return ch
    }
    private fun decode(b64: String): Bitmap? = try { val b = Base64.decode(b64.substringAfter(","), Base64.DEFAULT); BitmapFactory.decodeByteArray(b, 0, b.size) } catch (_: Exception) { null }
    private fun disk(ctx: Context, id: String): Bitmap? = File(ctx.cacheDir, "thm_$id.jpg").takeIf { it.exists() && it.length() > 0 }?.let { BitmapFactory.decodeFile(it.path) }

    private val pulled = HashMap<String, File>()
    /** 下载一个附件（每块 600KB 分块），存在本机缓存里（后台线程） */
    fun pull(ctx: Context, id: String, name: String, parts: Int): File {
        pulled[id]?.takeIf { it.exists() }?.let { return it }
        val out = java.io.ByteArrayOutputStream()
        for (i in 0 until maxOf(1, parts)) {
            var r = Api.rpc("file_get", jsonOf("fid" to id, "n" to i))
            if (r is JSONArray) r = r.opt(0)
            if (r is JSONObject && !r.has("data") && r.has("file_get")) r = r.opt("file_get")
            val b64 = (if (r is String) r else (r as? JSONObject)?.let { it.optString("data").ifEmpty { it.optString("b64") } }) ?: ""
            if (b64.isEmpty()) throw ApiError(0, "附件第 ${i + 1} 段没有下载到，请重试")
            out.write(Base64.decode(b64.replace(Regex("[^A-Za-z0-9+/=]"), ""), Base64.DEFAULT))
        }
        if (out.size() == 0) throw ApiError(0, "附件是空的，请上传者重新上传")
        val dir = File(ctx.cacheDir, "att").apply { mkdirs() }
        val file = File(dir, id.take(8) + "_" + name.replace(Regex("[\\\\/:*?\"<>|\\s]+"), "_"))
        file.writeBytes(out.toByteArray()); pulled[id] = file
        return file
    }
    /** 点小图：下载原图全屏看；不是图片就用别的 App 打开 */
    fun open(a: Main, f: F) {
        a.toast(if (f.img) "正在加载原图…" else "正在打开…")
        Bg.load({ pull(a, f.id, f.name, f.parts) }) { file, e ->
            if (file == null) { Dialogs.alert(a, "打开失败", e?.message ?: ""); return@load }
            val mime = f.mime.ifEmpty { Media.mimeOf(f.name) }
            if (f.img) Media.preview(a, "data:$mime;base64," + Base64.encodeToString(file.readBytes(), Base64.NO_WRAP)) else Media.open(a, file, mime)
        }
    }
}
