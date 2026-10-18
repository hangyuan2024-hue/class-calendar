package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * 云端同步（和网页、小程序同一套规则、同一张表 user_kv，RPC：udata_pull / udata_push）。
 * 每条数据单独同步，带修改时间；两边都改了同一条，以后改的为准。
 * list：数组，按 id 一条条同步；map：对象，按键同步；one：整体同步
 */
object Sync {
    val KINDS = mapOf(
        "personal_events_v1" to "list", "personal_marks_v1" to "map", "done_log_v1" to "map",
        "course_rev_v1" to "one", "hw_view_v1" to "one",
        "habits_v1" to "list", "habit_log_v1" to "map2", "quad_v1" to "map", "pomo_log_v1" to "map", "plan_notes_v1" to "map", "fun_opts_v1" to "one", "course_view_v1" to "map", "ui_palette_v1" to "one",
        "farm_v1" to "one", "profile_v1" to "one", "home_layout_v1" to "one", "home_quick_tools_v1" to "one", "mood_log_v1" to "map", "coach_v1" to "map",
    )
    private const val META = "sync_meta_v1"
    private const val OUT = "sync_outbox_v1"
    private const val SEP = "\u0001"

    @Volatile var state = "off"; private set
    @Volatile var lastOk = 0L; private set
    @Volatile var lastErr = ""; private set
    private var uid: String? = null
    private val lock = Any()
    @Volatile private var applying = false
    private val dirty = mutableSetOf<String>()
    /** 从小组件、通知（App 没打开）改了数据：也能传上去（只要这台手机上次同步的就是这个账号） */
    private fun who(): String? = uid ?: Api.uid?.takeIf { it == meta().str("owner") }

    private fun hash(s: String): String {
        var h = 2166136261L.toInt()
        for (ch in s) { h = h xor ch.code; h *= 16777619 }
        return java.lang.Long.toString(h.toLong() and 0xffffffffL, 36) + Integer.toString(s.length, 36)
    }
    private fun meta(): JSONObject {
        val m = Kv.obj(META)
        if (!m.has("h")) m.put("h", JSONObject())
        if (!m.has("t")) m.put("t", JSONObject())
        return m
    }
    private fun sub(o: JSONObject, k: String): JSONObject = o.optJSONObject(k) ?: JSONObject().also { o.put(k, it) }

    private fun explode(k: String, v: Any?): LinkedHashMap<String, Any> {
        val out = LinkedHashMap<String, Any>()
        when (KINDS[k]) {
            "one" -> if (v != null) out["_"] = v
            "list" -> (v as? JSONArray)?.objs()?.forEach { x -> if (x.has("id") && !x.optBoolean("local")) out[x.get("id").toString()] = x }
            "map2" -> (v as? JSONObject)?.let { o -> for (a in o.keys()) { val inner = o.optJSONObject(a) ?: continue; for (b in inner.keys()) out[a + SEP + b] = inner.get(b) } }
            else -> (v as? JSONObject)?.let { o -> for (a in o.keys()) out[a] = o.get(a) }
        }
        return out
    }
    private fun implode(k: String, recs: Map<String, Any>, cur: Any?): Any? {
        when (KINDS[k]) {
            "one" -> return recs["_"]
            "list" -> {
                val res = JSONArray(); val seen = HashSet<String>()
                (cur as? JSONArray)?.objs()?.forEach { x ->
                    if (x.optBoolean("local")) { res.put(x); return@forEach }
                    val id = if (x.has("id")) x.get("id").toString() else null
                    if (id != null && recs.containsKey(id) && seen.add(id)) res.put(recs[id])
                }
                recs.keys.filter { it !in seen }.sorted().forEach { res.put(recs[it]) }
                return res
            }
            "map2" -> {
                val o = JSONObject()
                for ((r, v) in recs) { val i = r.indexOf(SEP); if (i < 0) continue; val a = r.substring(0, i); (o.optJSONObject(a) ?: JSONObject().also { o.put(a, it) }).put(r.substring(i + 1), v) }
                return o
            }
            else -> { val o = JSONObject(); for ((a, b) in recs) o.put(a, b); return o }
        }
    }
    private fun str(v: Any?): String = when (v) { null -> "null"; is String -> JSONObject.quote(v); else -> v.toString() }

    /** 本机改了一个键（Kv.set 调用） */
    fun note(k: String) {
        if (applying || !KINDS.containsKey(k)) return
        synchronized(lock) { dirty += k }
        Bg.main.removeCallbacks(scanRun); Bg.main.postDelayed(scanRun, 300)
    }
    private val scanRun = Runnable { Bg.run { scan(); flush() } }

    private fun scan() { synchronized(lock) {
        if (who() == null) return
        val m = meta(); val o = Kv.obj(OUT); val now = System.currentTimeMillis()
        val h = sub(m, "h"); val t = sub(m, "t")
        for (k in dirty) {
            val recs = explode(k, Kv.get(k)); val hk = sub(h, k); val tk = sub(t, k)
            for ((r, v) in recs) {
                val hv = hash(str(v))
                if (hk.optString(r) != hv) { hk.put(r, hv); val tt = maxOf(now, tk.optLong(r) + 1); tk.put(r, tt); o.put(k + SEP + r, jsonOf("ns" to k, "k" to r, "v" to v, "t" to tt)) }
            }
            for (r in hk.keys().asSequence().toList()) if (!recs.containsKey(r)) {
                hk.remove(r); val tt = maxOf(now, tk.optLong(r) + 1); tk.put(r, tt); o.put(k + SEP + r, jsonOf("ns" to k, "k" to r, "v" to null, "t" to tt))
            }
        }
        dirty.clear()
        Kv.setQuiet(META, m); Kv.setQuiet(OUT, o)
    } }

    /** 把本机没传的改动传上去 */
    fun flush() {
        if (who() == null) return
        val o = synchronized(lock) { Kv.obj(OUT) }
        if (o.length() == 0) return
        try {
            state = "syncing"
            val keys = o.keys().asSequence().toList()
            for (part in keys.chunked(300)) {
                val batch = JSONArray(); part.forEach { batch.put(o.get(it)) }
                Api.rpc("udata_push", jsonOf("p" to batch))
                synchronized(lock) {
                    val cur = Kv.obj(OUT)
                    part.forEach { x -> if (cur.optJSONObject(x)?.toString() == o.optJSONObject(x)?.toString()) cur.remove(x) }
                    Kv.setQuiet(OUT, cur)
                }
            }
            state = "ok"; lastOk = System.currentTimeMillis(); lastErr = ""
        } catch (e: Exception) { state = "error"; lastErr = e.message ?: "" }
    }

    /** 拿别的设备的改动，返回变了的键 */
    fun pull(): Set<String> {
        if (who() == null) return emptySet()
        val changed = HashSet<String>()
        try {
            state = "syncing"
            for (guard in 0 until 50) {
                val since = synchronized(lock) { meta().optLong("rev") }
                val r = Api.rpc("udata_pull", jsonOf("since" to since)) as? JSONObject ?: break
                synchronized(lock) {
                    val m = meta(); val h = sub(m, "h"); val t = sub(m, "t"); val out = Kv.obj(OUT)
                    val byNs = (r.optJSONArray("rows") ?: JSONArray()).objs().filter { KINDS.containsKey(it.str("ns")) }.groupBy { it.str("ns") }
                    for ((k, rows) in byNs) {
                        val cur = Kv.get(k); val recs = explode(k, cur); val hk = sub(h, k); val tk = sub(t, k)
                        var touched = false
                        for (row in rows) {
                            val rk = row.str("k"); val rt = row.optLong("t")
                            if (tk.optLong(rk) >= rt) continue
                            tk.put(rk, rt); touched = true
                            val v = row.opt("v")
                            if (v == null || v == JSONObject.NULL) { recs.remove(rk); hk.remove(rk) } else { recs[rk] = v; hk.put(rk, hash(str(v))) }
                            val pend = out.optJSONObject(k + SEP + rk)
                            if (pend != null && pend.optLong("t") <= rt) out.remove(k + SEP + rk)
                        }
                        if (touched) { applying = true; Kv.setQuiet(k, implode(k, recs, cur)); applying = false; changed += k }
                    }
                    if (r.has("rev")) m.put("rev", r.optLong("rev"))
                    Kv.setQuiet(META, m); Kv.setQuiet(OUT, out)
                }
                if (!r.optBoolean("more")) break
            }
            state = "ok"; lastOk = System.currentTimeMillis(); lastErr = ""
        } catch (e: Exception) { applying = false; state = "error"; lastErr = e.message ?: "" }
        flush()
        if (changed.isNotEmpty()) Bus.emit("data")
        return changed
    }

    /** 第一次在这台手机上同步：先拉云端全部，再把云端没有的本机数据传上去（云端已有的以云端为准） */
    private fun firstMerge() {
        val cloud = HashMap<String, HashMap<String, JSONObject>>()
        var rev = 0L
        for (guard in 0 until 50) {
            val r = Api.rpc("udata_pull", jsonOf("since" to rev)) as? JSONObject ?: break
            (r.optJSONArray("rows") ?: JSONArray()).objs().forEach { row -> if (KINDS.containsKey(row.str("ns"))) cloud.getOrPut(row.str("ns")) { HashMap() }[row.str("k")] = row }
            rev = r.optLong("rev", rev)
            if (!r.optBoolean("more")) break
        }
        synchronized(lock) {
            val m = JSONObject().put("rev", rev).put("h", JSONObject()).put("t", JSONObject())
            val o = Kv.obj(OUT); val now = System.currentTimeMillis()
            for (k in KINDS.keys) {
                val cur = Kv.get(k); val local = explode(k, cur); val c = cloud[k] ?: HashMap()
                val recs = LinkedHashMap<String, Any>(); val hk = sub(m.getJSONObject("h"), k); val tk = sub(m.getJSONObject("t"), k)
                for ((r, row) in c) { tk.put(r, row.optLong("t")); val v = row.opt("v"); if (v != null && v != JSONObject.NULL) { recs[r] = v; hk.put(r, hash(str(v))) } }
                for ((r, v) in local) if (!c.containsKey(r)) { recs[r] = v; hk.put(r, hash(str(v))); tk.put(r, now); o.put(k + SEP + r, jsonOf("ns" to k, "k" to r, "v" to v, "t" to now)) }
                val next = implode(k, recs, cur)
                applying = true; Kv.setQuiet(k, if (next is JSONArray && next.length() == 0 && cur == null) null else next); applying = false
            }
            m.put("owner", uid); m.put("kinds", sig())
            Kv.setQuiet(META, m); Kv.setQuiet(OUT, o)
        }
        Bus.emit("data")
        flush()
    }

    /** 登录后开始同步（换了账号：上一个人的个人数据清掉） */
    fun start(userId: String) {
        uid = userId
        val owner = synchronized(lock) { meta().str("owner") }
        val kinds = synchronized(lock) { meta().str("kinds") }
        try {
            // 新版本多同步了几种数据：重新对一遍（云端已有的以云端为准）
            if (owner == userId && kinds != sig()) { firstMerge(); return }
            if (owner != userId) {
                if (owner.isNotEmpty()) { applying = true; KINDS.keys.forEach { Kv.setQuiet(it, null) }; applying = false; Kv.setQuiet(OUT, null) }
                firstMerge()
            } else pull()
        } catch (e: Exception) { state = "error"; lastErr = e.message ?: "" }
    }
    fun stop() { uid = null; state = "off" }
    private fun sig() = KINDS.keys.sorted().joinToString(",")
    /** 退出登录前：把没传的传完 */
    fun finish() { scan(); flush() }
    fun pending(): Int = Kv.obj(OUT).length()
}
