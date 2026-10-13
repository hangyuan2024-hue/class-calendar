package com.laolao.classcalendar.data

import android.content.Context
import android.util.AtomicFile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Per-account local records with a durable outbox, using the website's per-record
 * timestamp protocol (udata_pull / udata_push). Survives offline use and app restarts.
 */
class SyncStore(context: Context, val owner: String) {
    companion object {
        val KINDS: Map<String, String> = buildMap {
            listOf("personal_events_v1", "habits_v1", "quad_todos_v1").forEach { put(it, "list") }
            listOf("personal_marks_v1", "done_log_v1", "quad_v1", "pomo_log_v1", "plan_notes_v1", "mood_log_v1").forEach { put(it, "map") }
            listOf("fun_opts_v1", "home_layout_v1", "ui_skin_v1", "ui_palette_v1", "ui_style_v1", "profile_v1").forEach { put(it, "one") }
        }
        private const val SEP = "\u0001"

        fun explode(kind: String?, value: Any?): JSONObject {
            val out = JSONObject()
            when (kind) {
                "one" -> if (value != null && value != JSONObject.NULL) out.put("_", value)
                "list" -> value.rows().forEach { x -> x.optString("id").takeIf { it.isNotEmpty() }?.let { out.put(it, x) } }
                else -> (value as? JSONObject)?.let { m -> m.keys().forEach { out.put(it, m.get(it)) } }
            }
            return out
        }

        fun implode(kind: String?, records: JSONObject, old: Any?): Any? = when (kind) {
            "one" -> records.opt("_")
            "list" -> {
                val out = JSONArray(); val seen = HashSet<String>()
                old.rows().forEach { x -> val id = x.optString("id"); if (records.has(id) && seen.add(id)) out.put(records.get(id)) }
                records.keys().forEach { if (seen.add(it)) out.put(records.get(it)) }
                out
            }
            else -> JSONObject(records.toString())
        }

        /** Rejects malformed pull pages before they can advance the cursor. */
        fun validatePull(raw: Any?, since: Long): JSONObject {
            val r = raw as? JSONObject ?: error("同步响应不完整，未更新本地进度")
            val rows = r.opt("rows") as? JSONArray ?: error("同步进度无效，保留本地数据")
            if (r.opt("rev") !is Number || r.optLong("rev") < since || (r.optBoolean("more") && r.optLong("rev") <= since))
                error("同步进度无效，保留本地数据并等待重试")
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: error("同步记录格式错误")
                if (row.optString("ns").isEmpty() || row.optString("k").isEmpty() || row.opt("t") !is Number || row.optLong("t") <= 0 || !row.has("v"))
                    error("同步记录不完整，保留本地数据")
            }
            return r
        }

        fun acknowledged(current: JSONObject?, sent: JSONObject) =
            current != null && current.optLong("t") == sent.optLong("t") && current.opt("v").toString() == sent.opt("v").toString()
    }

    private val file = AtomicFile(File(context.filesDir, "laolao_store_${owner.replace(Regex("[^a-zA-Z0-9_-]"), "_")}.json"))
    private var root: JSONObject
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version

    init {
        root = runCatching { JSONObject(String(file.readFully())) }.getOrNull() ?: migrateOld(context)
        for (k in listOf("data", "clock", "pending", "cache")) if (root.optJSONObject(k) == null) root.put(k, JSONObject())
        if (!root.has("revision")) root.put("revision", 0)
    }

    /** Imports records from the previous app version so nothing is lost on update. */
    private fun migrateOld(c: Context): JSONObject {
        val raw = c.getSharedPreferences("campus_v4_$owner", 0).getString("data", null)
        val old = runCatching { JSONObject(raw ?: "") }.getOrNull() ?: return JSONObject()
        val out = JSONObject().put("data", JSONObject()).put("clock", old.optJSONObject("clock") ?: JSONObject())
            .put("pending", old.optJSONObject("pending") ?: JSONObject()).put("revision", old.optLong("revision")).put("cache", JSONObject())
        val d = old.optJSONObject("data") ?: JSONObject()
        d.keys().forEach { k -> if (KINDS.containsKey(k) || k == "native_courses" || k == "native_course_meta") out.getJSONObject("data").put(k, d.get(k)) }
        return out
    }

    @Synchronized private fun commit() {
        val out = file.startWrite()
        try { out.write(root.toString().toByteArray()); file.finishWrite(out) } catch (e: Exception) { file.failWrite(out); throw e }
        _version.value++
    }

    @Synchronized fun get(ns: String): Any? = root.getJSONObject("data").opt(ns)
    @Synchronized fun list(ns: String): List<JSONObject> = get(ns).rows().map { JSONObject(it.toString()) }
    @Synchronized fun map(ns: String): JSONObject = (get(ns) as? JSONObject)?.let { JSONObject(it.toString()) } ?: JSONObject()

    /** Local-only cached values (server snapshots, settings). Never pushed. */
    @Synchronized fun cache(key: String): Any? = root.getJSONObject("cache").opt(key)
    @Synchronized fun setCache(key: String, v: Any?) { root.getJSONObject("cache").put(key, v ?: JSONObject.NULL); commit() }

    /** Account data not in the udata protocol (courses use courses_sync). */
    @Synchronized fun setLocalData(key: String, v: Any) { root.getJSONObject("data").put(key, v); commit() }

    /** Writes one record and queues it for upload. v = null deletes it. */
    @Synchronized fun entry(ns: String, id: String, v: Any?) {
        val kind = KINDS[ns] ?: error("未知数据类型 $ns")
        val data = root.getJSONObject("data")
        val recs = explode(kind, data.opt(ns))
        if (v == null) recs.remove(id) else recs.put(id, v)
        data.put(ns, implode(kind, recs, data.opt(ns)))
        val clocks = root.getJSONObject("clock").optJSONObject(ns) ?: JSONObject().also { root.getJSONObject("clock").put(ns, it) }
        val stamp = maxOf(TrustedClock.now(), clocks.optLong(id) + 1)
        clocks.put(id, stamp)
        root.getJSONObject("pending").put(ns + SEP + id, JSONObject().put("ns", ns).put("k", id).put("v", v ?: JSONObject.NULL).put("t", stamp))
        commit()
    }

    @Synchronized fun pendingCount() = root.getJSONObject("pending").length()

    /** Full two-way sync. Blocking; call from a background thread. */
    fun sync(api: Api) {
        if (owner == "guest" || owner != api.uid()) return
        for (guard in 0 until 50) {
            val since = synchronized(this) { root.optLong("revision") }
            val r = validatePull(api.rpcBlocking("udata_pull", JSONObject().put("since", since)), since)
            synchronized(this) {
                val data = root.getJSONObject("data"); val clocks = root.getJSONObject("clock"); val pending = root.getJSONObject("pending")
                val touched = HashMap<String, JSONObject>()
                r.optJSONArray("rows").rows().forEach { row ->
                    val ns = row.optString("ns"); val id = row.optString("k")
                    if (!KINDS.containsKey(ns)) return@forEach
                    val times = clocks.optJSONObject(ns) ?: JSONObject().also { clocks.put(ns, it) }
                    val t = row.optLong("t")
                    if (times.optLong(id) >= t) return@forEach
                    val recs = touched.getOrPut(ns) { explode(KINDS[ns], data.opt(ns)) }
                    times.put(id, t)
                    val v = row.opt("v")
                    if (v == null || v == JSONObject.NULL) recs.remove(id) else recs.put(id, v)
                    val q = pending.optJSONObject(ns + SEP + id)
                    if (q != null && q.optLong("t") <= t) pending.remove(ns + SEP + id)
                }
                touched.forEach { (ns, recs) -> data.put(ns, implode(KINDS[ns], recs, data.opt(ns))) }
                root.put("revision", maxOf(root.optLong("revision"), r.optLong("rev", since)))
                commit()
            }
            if (!r.optBoolean("more")) break
        }
        for (guard in 0 until 100) {
            val batch = JSONArray()
            synchronized(this) {
                val p = root.getJSONObject("pending")
                for (k in p.keys()) { batch.put(JSONObject(p.getJSONObject(k).toString())); if (batch.length() == 300) break }
            }
            if (batch.length() == 0 || owner != api.uid()) break
            api.rpcBlocking("udata_push", JSONObject().put("p", batch))
            synchronized(this) {
                val p = root.getJSONObject("pending")
                batch.rows().forEach { row ->
                    val key = row.optString("ns") + SEP + row.optString("k")
                    if (acknowledged(p.optJSONObject(key), row)) p.remove(key)
                }
                commit()
            }
        }
        setCache("last_sync", System.currentTimeMillis())
    }
}
