package com.laolao.classcalendar.core

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/**
 * 7.55 把小程序里做过的班级功能同步到安卓（和小程序、网页同一套数据库函数）
 *   · ClassAdj：老师 / 班委「发给全班」的调课、早晚自习（7.15 SQL，小程序 1.22 lib/classadj.js）
 *   · HwProof：作业要交证明（7.35 SQL，小程序 1.26 lib/hwproof.js）
 *   · ClassAct：课堂互动 —— 抢答、小组互评（7.41 SQL，小程序 1.28）
 *   · Gesture：手势签到的九宫格规则（7.41 / 7.43 SQL）
 */
object ClassAdj {
    private const val LS = "cls_adj_v1"   // { 班级编号: { adj, study, can, at } }（只存在这台手机，不同步）
    private val lastAt = HashMap<String, Long>()
    @Volatile private var busy = false
    private fun cid(): String = Store.cls?.str("id") ?: ""
    private fun cache(id: String = cid()): JSONObject? = if (id.isEmpty()) null else Kv.obj(LS).optJSONObject(id)

    /** 班级发的调课（编号前面加 cls_，和自己记的区分开） */
    fun adj(): List<JSONObject> {
        val a = cache()?.optJSONArray("adj") ?: return emptyList()
        return a.objs().filter { it.str("date").isNotEmpty() && it.str("type").isNotEmpty() }.map { x ->
            JSONObject(x.toString()).apply { put("id", "cls_" + x.str("id").removePrefix("cls_")); put("cls", true) }
        }
    }
    /** 自己记的 + 班级发的 */
    fun all(own: List<JSONObject>): List<JSONObject> = own + adj()
    /** 早晚自习：自己设过的以自己的为准，没设过就用班级发的 */
    fun study(kind: String): JSONObject? {
        val own = Kv.get(if (kind == "morning") "morning_v1" else "evening_v1") as? JSONObject
        if (own != null) return own
        return cache()?.optJSONObject("study")?.optJSONObject(kind)
    }
    /** 10 分钟内不重复问；换了班 / 下拉刷新时 force */
    fun load(force: Boolean = false) {
        val id = cid(); if (id.isEmpty() || !Api.loggedIn || busy) return
        if (!force && System.currentTimeMillis() - (lastAt[id] ?: 0L) < 10 * 60_000L) return
        busy = true; lastAt[id] = System.currentTimeMillis()
        Bg.run {
            try {
                val r = Api.rpc("class_adj_get", jsonOf("p_cid" to id)) as? JSONObject
                if (r != null) {
                    val all = Kv.obj(LS); val old = all.optJSONObject(id)?.toString()
                    val o = jsonOf("adj" to (r.optJSONArray("adj") ?: JSONArray()), "study" to (r.optJSONObject("study") ?: JSONObject()),
                        "can" to r.optBoolean("can_manage"), "at" to r.str("updated_at"))
                    all.put(id, o); Kv.setQuiet(LS, all)
                    if (o.toString() != old) Bus.emit("data")
                }
            } catch (_: Exception) { /* 服务器还没有 7.15：只用自己的 */ } finally { busy = false }
        }
    }
}

object HwProof {
    private const val LS = "hw_proof_v1"   // { 班级编号: { mode, subs: { 作业编号: { status, review_note } }, at } }
    const val CH = 600 * 1024
    const val MAX = 10 * 1024 * 1024
    /** 谁要交：同学、班委都要交；自己建班的人（学委建班当班主任）也要交，只有身份是「老师」的不用交 */
    fun mustSubmit(c: JSONObject?): Boolean {
        if (c == null) return false
        if (Store.me?.str("role") == "teacher") return false
        return !c.optBoolean("is_teacher") || c.str("member_role") == "teacher"
    }
    fun get(cid: String): JSONObject? = Kv.obj(LS).optJSONObject(cid)
    /** 问一次服务器（在后台线程调）；服务器还没有 7.35 就当作没开 */
    fun refresh(cid: String): JSONObject {
        val o = try {
            val r = Api.rpcObj("hw_my", jsonOf("p_cid" to cid))
            jsonOf("mode" to r.str("mode").ifEmpty { "off" }, "subs" to (r.optJSONObject("subs") ?: JSONObject()), "at" to System.currentTimeMillis())
        } catch (e: Exception) { jsonOf("mode" to "off", "subs" to JSONObject(), "at" to System.currentTimeMillis()) }
        val all = Kv.obj(LS); all.put(cid, o); Kv.setQuiet(LS, all)
        return o
    }
    fun setSub(cid: String, item: String, status: String) {
        val all = Kv.obj(LS); val c = all.optJSONObject(cid) ?: return
        val s = c.optJSONObject("subs") ?: JSONObject(); s.put(item, jsonOf("status" to status)); c.put("subs", s); all.put(cid, c); Kv.setQuiet(LS, all)
    }
    /** 这项作业还要不要先交证明：null = 不知道（要问服务器），true = 要交，false = 直接打勾 */
    fun need(cid: String, item: String): Boolean? {
        val c = get(cid) ?: return null
        if (System.currentTimeMillis() - c.optLong("at") > 90_000L) return null
        if (c.str("mode") == "off") return false
        val st = c.optJSONObject("subs")?.optJSONObject(item)?.str("status") ?: ""
        return !(st == "pending" || st == "approved")
    }
    /** 上传一个文件（后台线程）：分块，每块 600KB；图片带一张小图 */
    fun upload(sid: Long, name: String, mime: String, data: ByteArray, thumb: String?, say: (Int) -> Unit): JSONObject {
        if (data.size > MAX) throw ApiError(0, "「$name」太大了（单个最多 10MB）")
        val n = maxOf(1, (data.size + CH - 1) / CH)
        val id = Api.rpcObj("hw_file_begin", jsonOf("p_sid" to sid, "fname" to name, "fmime" to mime, "fsize" to data.size, "nparts" to n)).str("id")
        if (id.isEmpty()) throw ApiError(0, "上传没开始，请重试")
        for (i in 0 until n) {
            val part = data.copyOfRange(i * CH, minOf(data.size, (i + 1) * CH))
            Api.rpc("hw_file_part", jsonOf("fid" to id, "n" to i, "b64" to Base64.encodeToString(part, Base64.NO_WRAP)))
            say(((i + 1) * 100) / n)
        }
        return Api.rpcObj("hw_file_end", jsonOf("fid" to id, "p_thumb" to thumb?.ifEmpty { null }))
    }
    /** 下载（后台线程） */
    fun pull(f: JSONObject): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        for (i in 0 until maxOf(1, f.optInt("parts", 1))) {
            val r = Api.rpcObj("hw_file_get", jsonOf("fid" to f.str("id"), "n" to i))
            val b = r.str("data").replace(Regex("[^A-Za-z0-9+/=]"), "")
            if (b.isEmpty()) throw ApiError(0, "文件第 ${i + 1} 段没有下载到，请重试")
            out.write(Base64.decode(b, Base64.DEFAULT))
        }
        return out.toByteArray()
    }
}

object ClassAct {
    private const val SEEN = "act_seen_v1"
    fun seen(k: String): Boolean = Kv.obj(SEEN).optBoolean(k)
    fun markSeen(k: String) { val o = Kv.obj(SEEN); o.put(k, true); Kv.setQuiet(SEEN, o) }
    fun rush(cid: String): JSONObject = Api.rpcObj("rush_state", jsonOf("p_cid" to cid))
    fun hit(id: Long): JSONObject = Api.rpcObj("rush_hit", jsonOf("p_id" to id))
    fun peers(cid: String): List<JSONObject> = Api.rpcArr("peer_todo", jsonOf("p_cid" to cid)).objs()
    fun rate(rid: Long, target: String, score: Int, comment: String?) { Api.rpc("peer_rate", jsonOf("p_rid" to rid, "p_target" to target, "p_score" to score, "p_comment" to comment)) }
    /** 1.28.4 班委发起了自己也能抢；老服务器没有 can_hit 时按以前的规则 */
    fun canHit(r: JSONObject): Boolean = if (r.has("can_hit")) r.optBoolean("can_hit") && !r.optBoolean("by_me") else !r.optBoolean("staff")
}

object Gesture {
    /** 九宫格（数字 1~9）：pat 里第几步连到哪个点 → 每个点是第几步（0 = 没连） */
    fun cells(pat: String): List<Int> = (1..9).map { i -> val k = pat.indexOf(('0' + i)); if (k >= 0) k + 1 else 0 }
    /** 两个点连线正好跨过的中间点（比如 1→9 经过 5），没有就是 0 */
    fun mid(a: Int, b: Int): Int {
        val ra = (a - 1) / 3; val ca = (a - 1) % 3; val rb = (b - 1) / 3; val cb = (b - 1) % 3
        return if ((ra + rb) % 2 == 0 && (ca + cb) % 2 == 0) ((ra + rb) / 2) * 3 + (ca + cb) / 2 + 1 else 0
    }
    /** 随机一个画得出来的手势（5~7 个点；跨过的中间点必须已经连过） */
    fun random(): String {
        val rnd = java.util.Random()
        while (true) {
            val seq = mutableListOf(1 + rnd.nextInt(9)); val want = 5 + rnd.nextInt(3)
            var guard = 0
            while (seq.size < want && guard++ < 60) {
                val n = 1 + rnd.nextInt(9); if (n in seq) continue
                val m = mid(seq.last(), n); if (m != 0 && m !in seq) continue
                seq += n
            }
            if (seq.size >= 4) return seq.joinToString("")
        }
    }
}
