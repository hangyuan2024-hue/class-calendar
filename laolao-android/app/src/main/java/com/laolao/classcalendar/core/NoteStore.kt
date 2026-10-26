package com.laolao.classcalendar.core

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * 7.2 全屏备忘录的存取：delta 和 JSON 互转、写回「我的事项」、图片文件（本机 + 云端附件）。
 * 规则在 NoteCore（和 note-core.js 一样）；存法和小程序 1.18、网页一样：
 *   每次保存都写回 note + list（老版本、表单里照样能看），rich = { d: delta, s: 指纹, f: { 图片编号: 附件 id } }
 */
object NoteStore {
    // ---------- JSON ↔ delta ----------
    private fun plainVal(v: Any?): Any? = when (v) { null, JSONObject.NULL -> null; is JSONObject, is JSONArray -> v.toString(); else -> v }
    private fun mapOf(o: JSONObject?): Map<String, Any?> {
        if (o == null) return emptyMap()
        val m = LinkedHashMap<String, Any?>(); for (k in o.keys()) m[k] = plainVal(o.opt(k)); return m
    }
    fun opsOf(a: JSONArray?): List<NoteCore.Op> {
        val out = mutableListOf<NoteCore.Op>(); a ?: return out
        for (i in 0 until a.length()) {
            val o = a.optJSONObject(i) ?: continue
            when (val ins = o.opt("insert")) {
                is String -> out += NoteCore.Op(ins, null, mapOf(o.optJSONObject("attributes")))
                is JSONObject -> out += NoteCore.Op(null, mapOf(ins), mapOf(o.optJSONObject("attributes")))
            }
        }
        return out
    }
    fun opJson(op: NoteCore.Op): JSONObject {
        val o = JSONObject()
        if (op.text != null) o.put("insert", op.text) else { val e = JSONObject(); op.embed?.forEach { (k, v) -> e.put(k, v ?: JSONObject.NULL) }; o.put("insert", e) }
        if (op.attrs.isNotEmpty()) { val at = JSONObject(); op.attrs.forEach { (k, v) -> at.put(k, v ?: JSONObject.NULL) }; o.put("attributes", at) }
        return o
    }
    fun toJson(ops: List<NoteCore.Op>): JSONArray = JSONArray().apply { ops.forEach { put(opJson(it)) } }

    // ---------- 记录 ----------
    fun rawList(rec: JSONObject?): List<NoteCore.Li> {
        val a = rec?.optJSONArray("list") ?: return emptyList()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { NoteCore.Li(it.str("t"), it.optBoolean("d")) }
    }
    fun noteOf(rec: JSONObject?): String = rec?.str("note") ?: ""
    fun sig(rec: JSONObject?): String = NoteCore.sigOf(noteOf(rec), rawList(rec))
    class Loaded(val ops: List<NoteCore.Op>, val fresh: Boolean)
    /** 打开时用哪份内容：rich 还对得上就用 rich，否则按文字重新排（保留图片） */
    fun load(rec: JSONObject?): Loaded {
        val r = rec?.optJSONObject("rich"); val d = r?.optJSONArray("d")
        if (d != null && r.str("s") == sig(rec)) return Loaded(opsOf(d), false)
        val imgs = if (d != null) opsOf(d).filter { it.isImage } else emptyList()
        return Loaded(NoteCore.fromPlain(noteOf(rec), rawList(rec), imgs), r != null)
    }
    fun richOps(rec: JSONObject?): List<NoteCore.Op> = opsOf(rec?.optJSONObject("rich")?.optJSONArray("d"))
    fun hasRich(rec: JSONObject?): Boolean = NoteCore.hasRich(richOps(rec))
    fun imgCount(rec: JSONObject?): Int = NoteCore.imgCount(richOps(rec))
    fun fmap(rec: JSONObject?): LinkedHashMap<String, String> {
        val m = LinkedHashMap<String, String>(); val f = rec?.optJSONObject("rich")?.optJSONObject("f") ?: return m
        for (k in f.keys()) m[k] = f.str(k); return m
    }
    /** 备忘录列表：我的事项里除了大作业 / 复习排期拆出来的步骤 */
    fun memos(): List<JSONObject> = Items.mine().filter { !it.has("dplan") }
    fun madeAt(r: JSONObject): Long = r.optLong("upd", 0L).takeIf { it > 0 } ?: Regex("^p(\\d{13})").find(r.str("id"))?.groupValues?.get(1)?.toLongOrNull() ?: 0L

    /** 写回：f 里的字段合并进记录；tAuto、list 没有就去掉；新的一条带上类型 */
    fun save(id: String, f: JSONObject, newKind: String?) {
        val out = JSONArray(); var hit = false
        for (x in Kv.arr(Items.MINE).objs()) {
            if (x.str("id") == id) { for (k in f.keys()) x.put(k, f.get(k)); for (k in listOf("tAuto", "list")) if (!f.has(k)) x.remove(k); hit = true }
            out.put(x)
        }
        if (!hit) {
            val r = JSONObject().put("id", id).put("event_time", "")
            if (!newKind.isNullOrEmpty()) r.put("kind", newKind)
            for (k in f.keys()) r.put(k, f.get(k))
            out.put(r)
        }
        Kv.set(Items.MINE, out); Bus.emit("data")
    }
    fun patch(id: String, fn: (JSONObject) -> Unit) {
        val out = JSONArray()
        for (x in Kv.arr(Items.MINE).objs()) { if (x.str("id") == id) fn(x); out.put(x) }
        Kv.set(Items.MINE, out); Bus.emit("data")
    }

    // ---------- 图片文件 ----------
    fun dir(ctx: Context): File = File(ctx.filesDir, "note_img").apply { mkdirs() }
    fun localFile(ctx: Context, k: String): File? {
        if (k.isEmpty()) return null
        return dir(ctx).listFiles()?.firstOrNull { it.name.startsWith("$k.") && it.length() > 0 }
    }
    fun keep(ctx: Context, k: String, ext: String, bytes: ByteArray): File = File(dir(ctx), "$k.$ext").apply { writeBytes(bytes) }

    private const val CH = 600 * 1024
    /** 传成这条事项的附件（自己的事项：cid 为空、item = 记录 id），返回附件 id；在后台线程调用 */
    fun upload(item: String, fname: String, mime: String, buf: ByteArray, thumb: ByteArray?): String {
        val n = maxOf(1, (buf.size + CH - 1) / CH)
        val id = Api.rpcObj("file_begin", jsonOf("cid" to null, "item" to item, "fname" to fname, "fmime" to mime, "fsize" to buf.size, "nparts" to n)).str("id")
        for (i in 0 until n) Api.rpc("file_part", jsonOf("fid" to id, "n" to i, "b64" to Base64.encodeToString(buf.copyOfRange(i * CH, minOf(buf.size, (i + 1) * CH)), Base64.NO_WRAP)))
        Api.rpc("file_end", jsonOf("fid" to id))
        if (thumb != null) try { Api.rpc("file_thumb", jsonOf("fid" to id, "b64" to Base64.encodeToString(thumb, Base64.NO_WRAP))) } catch (_: Exception) {}
        return id
    }
    /** 按附件 id 下载（先查这条事项的附件列表拿到分了几段）；在后台线程调用 */
    fun download(item: String, fid: String, list: MutableList<JSONObject>? = null): Pair<ByteArray, String>? {
        val l = if (!list.isNullOrEmpty()) list else ((Api.rpc("file_list", jsonOf("cid" to null, "item" to item)) as? JSONArray)?.objs() ?: emptyList()).also { list?.addAll(it) }
        val f = l.firstOrNull { it.str("id") == fid } ?: return null
        val out = java.io.ByteArrayOutputStream()
        for (i in 0 until maxOf(1, f.optInt("parts"))) {
            var r = Api.rpc("file_get", jsonOf("fid" to fid, "n" to i))
            if (r is JSONArray) r = r.opt(0)
            if (r is JSONObject && !r.has("data") && r.has("file_get")) r = r.opt("file_get")
            val b64 = (if (r is String) r else (r as? JSONObject)?.let { it.optString("data").ifEmpty { it.optString("b64") } }) ?: ""
            if (b64.isEmpty()) return null
            out.write(Base64.decode(b64.replace(Regex("[^A-Za-z0-9+/=]"), ""), Base64.DEFAULT))
        }
        if (out.size() == 0) return null
        return out.toByteArray() to f.str("mime")
    }
}
