package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject

// 7.x（和小程序 1.33、网站同步，数据库 7.52 / 7.54）：签到范围、网络差时的签到队列、班委审批入班、学校院系

/** 服务器还没升级（函数不存在） */
fun noFn(e: Throwable?): Boolean = Regex("Could not find|PGRST202|schema cache").containsMatchIn(e?.message ?: "") || (e is ApiError && e.status == 404)
/** 网络原因（没发出去 / 没收到回复 / 服务器忙）：签到先记在手机上，等网络恢复再交 */
fun netFail(e: Throwable?): Boolean = e !is ApiError || e.status == 0 || e.status in 502..504

/** 签到范围：s 学生、m 班委、t 老师、g 分组编号、u 指定的人。默认 = 学生 + 班委（和以前一样） */
data class CkScope(val s: Boolean = true, val m: Boolean = true, val t: Boolean = false, val g: List<Long> = emptyList(), val u: List<String> = emptyList(), val names: String = "") {
    val isDefault get() = s && m && !t && g.isEmpty() && u.isEmpty()
    fun json(): JSONObject = jsonOf("s" to s, "m" to m, "t" to t, "g" to JSONArray(g), "u" to JSONArray(u))
    fun text(): String {
        if (isDefault) return "全班学生和班委（默认）"
        val roles = listOfNotNull("学生".takeIf { s }, "班委".takeIf { m }, "老师".takeIf { t })
        val extra = names.ifBlank { listOfNotNull(if (g.isNotEmpty()) "${g.size} 个分组" else null, if (u.isNotEmpty()) "${u.size} 人" else null).joinToString(" + ") }
        if (roles.isEmpty()) return if (extra.isBlank()) "还没选人" else "只让：$extra"
        return (if (roles.size == 3) "全班（含老师）" else "全班" + roles.joinToString("、")) + if (extra.isBlank()) "" else " + $extra"
    }
    companion object {
        fun from(o: JSONObject?): CkScope {
            if (o == null) return CkScope()
            val ga = o.optJSONArray("g"); val ua = o.optJSONArray("u")
            return CkScope(o.optBoolean("s", true), o.optBoolean("m", true), o.optBoolean("t", false),
                (0 until (ga?.length() ?: 0)).map { ga!!.optLong(it) }, (0 until (ua?.length() ?: 0)).map { ua!!.optString(it) }, o.str("names"))
        }
    }
}

class NoScopeError : Exception("签到范围暂时用不了（服务器还没升级）")

object CkMore {
    /** 选人：老师、全班成员（带身份）、分组 */
    fun pick(cid: String): JSONObject = Api.rpcObj("ck_people_pick", jsonOf("cid" to cid))
    fun groupPut(cid: String, name: String, uids: List<String>): JSONObject = Api.rpcObj("class_group_put", jsonOf("cid" to cid, "p_name" to name, "p_uids" to JSONArray(uids)))
    fun setScope(id: Long, scope: JSONObject?): JSONObject = Api.rpcObj("checkin_set_scope", jsonOf("p_id" to id, "p_scope" to scope))
    /** 带范围发起（checkin_create2）；服务器没升级抛 NoScopeError */
    fun createScoped(cid: String, a: JSONObject, scope: JSONObject): JSONObject {
        val p = JSONObject(a.toString()); p.remove("cid")
        return try { Api.rpcObj("checkin_create2", jsonOf("cid" to cid, "p" to p, "p_scope" to scope)) } catch (e: Exception) { if (noFn(e)) throw NoScopeError() else throw e }
    }
    /** 签到：先试 checkin_sign2（按点签到那一刻核对，网络恢复后交上去也算），服务器没升级就用老的 checkin_sign */
    fun sign2(p: JSONObject): JSONObject {
        try { return Api.rpcObj("checkin_sign2", jsonOf("p" to p)) } catch (e: Exception) { if (!noFn(e)) throw e }
        val pos = if (p.has("lat") && p.has("lng")) Geo.Pos(p.optDouble("lat"), p.optDouble("lng"), p.optInt("acc")) else null
        return Checkin.sign(p.optLong("id"), pos, p.str("code").ifEmpty { null }, p.str("photo").ifEmpty { null }, p.str("thumb").ifEmpty { null })
    }
}

/** 网络差时的签到队列（和小程序、网站一样）：点了签到就先记在手机上，联网后自动交；签到结束后 30 分钟内交上都算 */
object CkQ {
    private const val KEY = "ck_queue_v1"
    fun all(): List<JSONObject> = try { Kv.arr(KEY).objs() } catch (_: Exception) { emptyList() }
    private fun save(l: List<JSONObject>) { try { Kv.setQuiet(KEY, JSONArray(l)) } catch (_: Exception) {} }
    fun pending(id: Long): JSONObject? = all().firstOrNull { it.optJSONObject("p")?.optLong("id") == id }
    fun add(title: String, p: JSONObject) {
        save(all().filter { it.optJSONObject("p")?.optLong("id") != p.optLong("id") } + jsonOf("title" to title, "p" to p, "t0" to System.currentTimeMillis()))
    }
    /** 交一遍（后台线程调用）；返回给用户看的结果 */
    @Synchronized fun flush(): List<String> {
        val out = mutableListOf<String>()
        var l = all()
        for (q in l.toList()) {
            val title = q.str("title").ifEmpty { "签到" }
            if (System.currentTimeMillis() - q.optLong("t0") > 3 * 3600_000L) { l = l - q; out += "「$title」太久没联网，没交上去，找发起人补签"; continue }
            val r = try { CkMore.sign2(q.getJSONObject("p")) } catch (e: Exception) { if (netFail(e)) break else jsonOf("ok" to false, "why" to (e.message ?: "没签上")) }
            l = l - q
            out += if (r.optBoolean("ok") || r.optBoolean("already")) "「$title」刚才的签到已经交上去了 ✓" else "「$title」没签上：" + r.str("why").ifEmpty { "签到没成功" }
        }
        save(l)
        return out
    }
}

/** 班委默认能批准谁入班（7.54）；老师可以单独关掉某个班委的审批权 */
object JoinReview {
    fun pending(cid: String): List<JSONObject> = (Api.rpc("class_pending", jsonOf("p_cid" to cid)) as? JSONArray)?.objs() ?: emptyList()
    fun review(cid: String, uid: String, ok: Boolean) { Api.rpc("review_member", jsonOf("cid" to cid, "uid" to uid, "approve" to ok)) }
    fun approvers(cid: String): JSONObject? = try { Api.rpcObj("class_approvers", jsonOf("cid" to cid)) } catch (_: Exception) { null }
    fun setApprove(cid: String, uid: String, on: Boolean) { Api.rpc("set_member_approve", jsonOf("cid" to cid, "uid" to uid, "p_on" to on)) }
}

/** 学校与院系（7.54）：选了学校就自动挂到这所学校下面（还没开通也一样），院系自己填或从提示里选 */
object OrgApi {
    val TYPES = listOf("university" to "本科大学", "college" to "专科 / 高职", "high" to "高中", "middle" to "初中", "primary" to "小学", "work" to "职场人员", "personal" to "个人使用")
    val SCHOOL = setOf("university", "college", "high", "middle", "primary")
    fun me(): JSONObject? = try { Api.rpcObj("org_me") } catch (_: Exception) { null }
    fun suggest(q: String): List<JSONObject> = try { (Api.rpc("org_dept_suggest", jsonOf("p_q" to q)) as? JSONArray)?.objs() ?: emptyList() } catch (_: Exception) { emptyList() }
    fun deptSet(name: String): JSONObject = Api.rpcObj("org_dept_set", jsonOf("p_name" to name))
    fun setOrg(type: String, name: String): JSONObject {
        val r = Api.rpcObj("profile_set_org", jsonOf("p_type" to type, "p_name" to name))
        Store.me?.let { it.put("org_type", r.str("org_type").ifEmpty { type }); it.put("org_name", r.str("org_name").ifEmpty { name }) }
        return r
    }
}
