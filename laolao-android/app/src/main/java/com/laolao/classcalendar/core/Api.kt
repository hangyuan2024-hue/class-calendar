package com.laolao.classcalendar.core

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** 本机存储：和网页、小程序用同样的键名、同样的数据格式（JSON），云端同步后三边看到的是同一份 */
object Kv {
    private lateinit var p: SharedPreferences
    var onSet: ((String) -> Unit)? = null
    fun init(ctx: Context) { if (!::p.isInitialized) p = ctx.getSharedPreferences("kv", Context.MODE_PRIVATE) }
    fun raw(k: String): String? = p.getString(k, null)
    fun get(k: String): Any? = parseJson(raw(k))
    fun obj(k: String): JSONObject = (get(k) as? JSONObject) ?: JSONObject()
    fun arr(k: String): JSONArray = (get(k) as? JSONArray) ?: JSONArray()
    fun str(k: String, def: String = ""): String = (get(k) as? String) ?: def
    fun bool(k: String, def: Boolean): Boolean = (get(k) as? Boolean) ?: def
    fun int(k: String, def: Int): Int = (get(k) as? Number)?.toInt() ?: def
    /** 写入并通知云端同步 */
    fun set(k: String, v: Any?) { setQuiet(k, v); onSet?.invoke(k) }
    fun setQuiet(k: String, v: Any?) {
        val e = p.edit()
        if (v == null || v == JSONObject.NULL) e.remove(k) else e.putString(k, if (v is String) JSONObject.quote(v) else v.toString())
        e.apply()
    }
    fun keys(): Set<String> = p.all.keys
    fun clear(keep: (String) -> Boolean) { val e = p.edit(); for (k in p.all.keys) if (!keep(k)) e.remove(k); e.apply() }
}

/** 页面之间的通知：数据变了、班级变了、登录状态变了 */
object Bus {
    private val subs = mutableListOf<Pair<Any, (String) -> Unit>>()
    fun on(owner: Any, fn: (String) -> Unit) { synchronized(subs) { subs += owner to fn } }
    fun off(owner: Any) { synchronized(subs) { subs.removeAll { it.first === owner } } }
    fun emit(what: String) {
        Bg.ui {
            val list = synchronized(subs) { subs.toList() }
            for ((_, fn) in list) try { fn(what) } catch (e: Exception) { e.printStackTrace() }
        }
    }
}

/** 登录凭证 + 数据库接口（和网页、小程序同一套 Supabase 账号） */
object Api {
    private lateinit var p: SharedPreferences
    val ACCOUNT_RE = Regex("^[a-z0-9_]{3,20}$")
    /** 登录失效（被别的设备踢出 / 改了密码）时调用 */
    var onLost: ((String) -> Unit)? = null

    fun init(ctx: Context) { if (!::p.isInitialized) p = ctx.getSharedPreferences("session", Context.MODE_PRIVATE) }

    val uid: String? get() = p.getString("uid", null)?.takeIf { p.getString("access", null) != null }
    val loggedIn: Boolean get() = uid != null

    private fun keep(j: JSONObject) {
        val exp = j.optLong("expires_at", 0).takeIf { it > 0 } ?: (System.currentTimeMillis() / 1000 + j.optLong("expires_in", 3600))
        p.edit().putString("access", j.str("access_token")).putString("refresh", j.str("refresh_token"))
            .putLong("exp", exp).putString("uid", j.optJSONObject("user")?.str("id") ?: p.getString("uid", null)).apply()
    }
    private fun drop() { p.edit().clear().apply() }

    private val lock = Any()
    /** 取一张有效的凭证：快过期了先续期。网络不好续不上就先用旧的 */
    fun token(): String? = synchronized(lock) {
        val a = p.getString("access", null) ?: return null
        if (p.getLong("exp", 0) - 60 > System.currentTimeMillis() / 1000) return a
        val r = try { Net.request("/auth/v1/token?grant_type=refresh_token", "POST", jsonOf("refresh_token" to p.getString("refresh", "")).toString()) }
                catch (e: ApiError) { return a }
        if (r.status in 200..299) { keep(JSONObject(r.body)); return p.getString("access", null) }
        if (r.status == 400 || r.status == 401) { drop(); lost(if (Net.isRevoked(r.body)) "revoked" else "expired"); return null }
        return a
    }
    private fun lost(why: String) { Bg.ui { onLost?.invoke(why) } }

    private fun email(account: String) = account.trim().lowercase() + "@" + Cfg.DOMAIN

    fun signIn(account: String, password: String) {
        val acc = account.trim().lowercase()
        if (!ACCOUNT_RE.matches(acc)) throw ApiError(0, "账号只能用 3~20 位小写字母、数字或下划线")
        val r = Net.request("/auth/v1/token?grant_type=password", "POST", jsonOf("email" to email(acc), "password" to password).toString())
        if (r.status !in 200..299) throw ApiError(r.status, Net.human(r.body, r.status))
        keep(JSONObject(r.body))
    }

    fun signUp(account: String, password: String, name: String, teacher: Boolean, gender: String, orgType: String, orgName: String) {
        val acc = account.trim().lowercase()
        if (!ACCOUNT_RE.matches(acc)) throw ApiError(0, "账号只能用 3~20 位小写字母、数字或下划线")
        if (name.isBlank()) throw ApiError(0, "请填写姓名")
        if (password.length < 8) throw ApiError(0, "密码至少 8 位")
        val data = jsonOf("name" to name.trim(), "role" to if (teacher) "teacher" else "student", "gender" to gender)
        if (orgType.isNotEmpty()) { data.put("org_type", orgType); data.put("org_name", orgName.trim().take(40)) }
        val r = Net.request("/auth/v1/signup", "POST", jsonOf("email" to email(acc), "password" to password, "data" to data).toString(), hedge = false)
        if (r.status !in 200..299) throw ApiError(r.status, Net.human(r.body, r.status))
        val j = JSONObject(r.body)
        if (j.str("access_token").isNotEmpty()) keep(j) else signIn(acc, password)
    }

    fun signOut() {
        val a = p.getString("access", null)
        if (a != null) try { Net.request("/auth/v1/logout?scope=local", "POST", "{}", a, readMs = 6000) } catch (_: Exception) {}
        drop()
    }

    /** 读数据的请求遇到服务器忙自动重试一次 */
    fun rest(path: String, method: String = "GET", body: Any? = null, headers: Map<String, String> = emptyMap(), hedge: Boolean = true): Any? {
        val tk = token()
        var tries = 0
        while (true) {
            val r = Net.request("/rest/v1/$path", method, body?.toString(), tk, headers, hedge)
            if (r.status in 200..299) return parseJson(r.body)
            if ((r.status == 502 || r.status == 503 || r.status == 504 || r.status == 429) && hedge && tries < 2) { tries++; Thread.sleep(700L * tries); continue }
            if (Net.isRevoked(r.body)) { drop(); lost("revoked"); throw ApiError(401, "这台设备已在其他设备上被退出登录", true) }
            if (r.status == 401 && tk != null) { drop(); lost("expired") }
            throw ApiError(r.status, Net.human(r.body, r.status))
        }
    }
    fun rpc(fn: String, args: JSONObject = JSONObject(), hedge: Boolean = true): Any? = rest("rpc/$fn", "POST", args, hedge = hedge)
    fun rpcObj(fn: String, args: JSONObject = JSONObject()): JSONObject = (rpc(fn, args) as? JSONObject) ?: JSONObject()
    fun rpcArr(fn: String, args: JSONObject = JSONObject()): JSONArray = (rpc(fn, args) as? JSONArray) ?: JSONArray()
}
