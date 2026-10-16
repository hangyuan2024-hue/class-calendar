package com.laolao.classcalendar.data

import android.content.Context
import com.laolao.classcalendar.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.IOException
import java.util.Locale
import java.util.concurrent.TimeUnit

class ApiError(val status: Int, message: String) : IOException(message)

/** Same auth / REST / RPC endpoints as the website and mini program. */
class Api(context: Context) {
    private val ctx = context.applicationContext
    // 6.1：两条线路（和网站、小程序、电脑版一样）：国内直连 + 海外中转。连不上自动换另一条，真的连通了才记住（3 天后重新试国内）
    private val routes: List<String>
    @Volatile private var ri = 0
    @Volatile private var routeKnown = false
    private val routePrefs = context.applicationContext.getSharedPreferences("laolao_route_v1", 0)
    val base: String get() = routes[ri]
    private val anon: String
    private val domain: String
    @Volatile private var session: JSONObject? = null
    private val client = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .followRedirects(false)
        .build()

    init {
        val cfg = JSONObject(ctx.resources.openRawResource(R.raw.campus_config).bufferedReader().readText())
        routes = listOf(cfg.getString("base"), cfg.optString("alt", "")).map { it.trimEnd('/') }.filter { it.isNotBlank() }.distinct()
        val saved = routePrefs.getInt("i", -1)
        if (saved in routes.indices && System.currentTimeMillis() - routePrefs.getLong("at", 0L) < 3L * 86_400_000L) { ri = saved; routeKnown = true }
        anon = cfg.getString("anon")
        domain = cfg.getString("accountDomain")
        session = runCatching { SecretBox.read(ctx)?.let(::JSONObject) }.getOrNull()
    }

    fun logged() = session?.has("access_token") == true

    fun uid(): String {
        val s = session ?: return "guest"
        return s.optJSONObject("user")?.optString("id", "guest") ?: s.optString("user_id", "guest")
    }

    private fun keep(s: JSONObject) {
        s.put("expires_at", s.optLong("expires_at", System.currentTimeMillis() / 1000 + s.optLong("expires_in", 3600)))
        SecretBox.write(ctx, s.toString())
        session = s
    }

    private fun forget() {
        runCatching { SecretBox.write(ctx, null) }
        session = null
    }

    private fun token(): String {
        val s = session ?: return anon
        if (s.optLong("expires_at") < System.currentTimeMillis() / 1000 + 60) {
            try {
                val r = request("/auth/v1/token?grant_type=refresh_token", "POST",
                    JSONObject().put("refresh_token", s.optString("refresh_token")), anon, null)
                keep(r as JSONObject)
            } catch (e: ApiError) {
                if (e.status == 400 || e.status == 401) {
                    forget(); throw ApiError(401, "登录已过期，请重新登录")
                }
                throw e
            }
        }
        return session?.optString("access_token", anon) ?: anon
    }

    suspend fun login(account: String, password: String) = io {
        val acc = account.trim().lowercase(Locale.ROOT)
        require(acc.matches(Regex("[a-z0-9_]{3,20}"))) { "账号需为3—20位小写字母、数字或下划线" }
        val s = request("/auth/v1/token?grant_type=password", "POST",
            JSONObject().put("email", "$acc@$domain").put("password", password), anon, null)
        keep(s as JSONObject)
    }

    suspend fun register(account: String, password: String, name: String, identity: String, orgType: String, orgName: String) = io {
        val acc = account.trim().lowercase(Locale.ROOT)
        require(acc.matches(Regex("[a-z0-9_]{3,20}"))) { "账号需为3—20位小写字母、数字或下划线" }
        require(password.length >= 8) { "密码至少8位" }
        require(name.isNotBlank()) { "请填写姓名或昵称" }
        val id = if (identity == "teacher" || identity == "other") identity else "student"
        val data = JSONObject().put("name", name.trim()).put("role", if (id == "teacher") "teacher" else "student")
            .put("identity", id).put("gender", "")
        if (orgType.isNotBlank()) data.put("org_type", orgType).put("org_name", orgName.trim().take(40))
        val s = request("/auth/v1/signup", "POST",
            JSONObject().put("email", "$acc@$domain").put("password", password).put("data", data), anon, null)
        if (s is JSONObject && s.has("access_token")) keep(s) else {
            val r = request("/auth/v1/token?grant_type=password", "POST",
                JSONObject().put("email", "$acc@$domain").put("password", password), anon, null)
            keep(r as JSONObject)
        }
    }

    suspend fun logout() = io {
        try { if (logged()) request("/auth/v1/logout?scope=local", "POST", JSONObject(), token(), null) } catch (_: Exception) {}
        forget()
    }

    /** Called when the server says this device was kicked out. */
    fun dropSession() = forget()

    suspend fun rpc(name: String, args: JSONObject = JSONObject()): Any? = io {
        request("/rest/v1/rpc/$name", "POST", args, token(), "return=representation")
    }

    fun rpcBlocking(name: String, args: JSONObject = JSONObject()): Any? =
        request("/rest/v1/rpc/$name", "POST", args, token(), "return=representation")

    private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }

    private fun keepRoute() {
        routeKnown = true
        routePrefs.edit().putInt("i", ri).putLong("at", System.currentTimeMillis()).apply()
    }

    /** 连不上（断网、超时、域名解析失败）时换另一条线路再试一次。 */
    private fun request(path: String, method: String, body: Any?, token: String, prefer: String?): Any? {
        val first = ri
        try {
            val r = requestOnce(path, method, body, token, prefer)
            if (!routeKnown || ri != first) keepRoute()
            return r
        } catch (e: ApiError) {
            if (!routeKnown) keepRoute()   // 服务器回话了（哪怕是报错），说明这条线路是通的
            throw e
        } catch (e: IOException) {
            if (routes.size < 2) throw e
            ri = (first + 1) % routes.size
            try {
                val r = requestOnce(path, method, body, token, prefer)
                keepRoute()
                return r
            } catch (e2: ApiError) {
                keepRoute(); throw e2
            } catch (e2: IOException) {
                ri = first
                throw e
            }
        }
    }

    private fun requestOnce(path: String, method: String, body: Any?, token: String, prefer: String?): Any? {
        val started = System.nanoTime()
        val rb = (body?.toString() ?: "").toRequestBody("application/json; charset=utf-8".toMediaType())
        val req = Request.Builder().url(base + path)
            .header("apikey", anon).header("Authorization", "Bearer $token")
            .apply { if (prefer != null) header("Prefer", prefer) }
            .method(method, if (method == "GET") null else rb).build()
        try {
            client.newCall(req).execute().use { resp ->
                val status = resp.code
                if (status < 300 && base.startsWith("https://")) {
                    resp.headers.getDate("Date")?.let {
                        TrustedClock.calibrate(it.time, TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started))
                    }
                }
                val text = resp.body?.string().orEmpty()
                val parsed = runCatching { if (text.isEmpty()) null else JSONTokener(text).nextValue() }.getOrNull()
                if (status >= 300) {
                    val e = parsed as? JSONObject ?: JSONObject()
                    var msg = e.optString("msg", e.optString("error_description", e.optString("message", e.optString("error", "请求失败"))))
                    msg = when {
                        status in 502..504 -> "云服务暂时不可用（$status），本地记录仍然保留"
                        status == 429 -> "请求较多，请稍后重试"
                        msg.lowercase(Locale.ROOT).contains("invalid login") -> "账号或密码错误"
                        msg.lowercase(Locale.ROOT).contains("already registered") -> "这个账号已被注册"
                        status == 403 -> "当前账号没有此操作权限"
                        else -> msg
                    }
                    throw ApiError(status, msg)
                }
                return parsed
            }
        } catch (e: java.net.SocketTimeoutException) {
            throw IOException("连接超时，请稍后重试；本地记录已保留")
        } catch (e: java.net.UnknownHostException) {
            throw IOException("没有网络，本地记录已保留")
        } catch (e: ApiError) {
            throw e
        } catch (e: IOException) {
            throw IOException("网络连接失败，本地记录已保留")
        }
    }
}

fun Any?.rows(): List<JSONObject> {
    val a = this as? JSONArray ?: return emptyList()
    return (0 until a.length()).mapNotNull { a.optJSONObject(it) }
}

fun Any?.obj(): JSONObject = this as? JSONObject ?: JSONObject()
