package com.laolao.classcalendar.core

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class ApiError(val status: Int, msg: String, val revoked: Boolean = false) : Exception(msg)

/**
 * 网络：两条线路（国内直连 + 海外中转）。
 * 一条线路几秒内没回应，就同时在另一条上再发一次，谁先回来用谁（不用等一条超时再换），
 * 并记住能用的那条 3 天。这样在国内、在海外打开都不会卡在「连接超时」。
 */
object Net {
    /** 两条线路（测试时可以换成本机地址） */
    var ROUTES = listOf(Cfg.BASE, Cfg.ALT)
    private const val KEEP_MS = 3L * 86400_000
    private var prefs: SharedPreferences? = null
    @Volatile var cur = 0; private set
    @Volatile private var known = false

    fun init(ctx: Context) {
        if (prefs != null) return
        val p = ctx.getSharedPreferences("net", Context.MODE_PRIVATE)
        prefs = p
        val i = p.getInt("route", 0); val at = p.getLong("route_at", 0)
        if (i in ROUTES.indices && System.currentTimeMillis() - at < KEEP_MS) { cur = i; known = true }
    }
    fun routeName(): String = if (cur == 0) "国内线路" else "海外线路"

    private fun remember(i: Int) {
        if (i == cur && known) return
        cur = i; known = true
        prefs?.edit()?.putInt("route", i)?.putLong("route_at", System.currentTimeMillis())?.apply()
    }

    class Resp(val status: Int, val body: String)
    private class Out(val route: Int, val resp: Resp?, val err: Exception?)

    /** 安卓自带的 HttpURLConnection 支持 PATCH；万一某台手机不支持，就直接改它的 method 字段 */
    private fun setMethod(c: HttpURLConnection, method: String) {
        try { c.requestMethod = method; return } catch (_: java.net.ProtocolException) {}
        var k: Class<*>? = c.javaClass
        while (k != null) {
            try { val f = k.getDeclaredField("method"); f.isAccessible = true; f.set(c, method); return } catch (_: Exception) {}
            k = k.superclass
        }
        throw ApiError(0, "这台手机不支持这个操作")
    }

    private fun once(base: String, path: String, method: String, body: String?, token: String?, headers: Map<String, String>, readMs: Int): Resp {
        val c = URL(base + path).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 9000
            c.readTimeout = readMs
            setMethod(c, method)
            c.setRequestProperty("apikey", Cfg.ANON)
            c.setRequestProperty("Authorization", "Bearer " + (token ?: Cfg.ANON))
            c.setRequestProperty("Content-Type", "application/json")
            c.setRequestProperty("Accept", "application/json")
            for ((k, v) in headers) c.setRequestProperty(k, v)
            if (body != null) {
                c.doOutput = true
                c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = c.responseCode
            val stream = if (code >= 400) c.errorStream else c.inputStream
            val bytes = ByteArrayOutputStream()
            stream?.use { s -> val buf = ByteArray(16384); while (true) { val n = s.read(buf); if (n < 0) break; bytes.write(buf, 0, n) } }
            return Resp(code, bytes.toString("UTF-8"))
        } finally { c.disconnect() }
    }

    /**
     * 发请求。hedge=false 的写请求（会产生新数据的）只在一条线路上发，连不上才换线路。
     * 返回 HTTP 结果；两条线路都连不上就抛 ApiError(0, …)
     */
    fun request(path: String, method: String = "GET", body: String? = null, token: String? = null,
                headers: Map<String, String> = emptyMap(), hedge: Boolean = true, readMs: Int = 20000): Resp {
        val first = cur
        val second = 1 - first
        val q = LinkedBlockingQueue<Out>()
        fun start(i: Int) = Thread {
            try { q.put(Out(i, once(ROUTES[i], path, method, body, token, headers, readMs), null)) }
            catch (e: Exception) { q.put(Out(i, null, e)) }
        }.apply { isDaemon = true; start() }
        start(first)
        var launched = 1
        var pending = 1
        var lastErr: Exception? = null
        // 还不知道哪条线路能用：2.5 秒没回应就两条一起试；知道了就多等一会儿
        val wait = if (known) 7000L else 2500L
        val deadline = System.currentTimeMillis() + readMs + 12000
        var o: Out? = q.poll(wait, TimeUnit.MILLISECONDS)
        while (true) {
            if (o == null) {
                if (launched == 1 && hedge) { start(second); launched = 2; pending++ }
                val left = deadline - System.currentTimeMillis()
                if (left <= 0) break
                o = q.poll(left, TimeUnit.MILLISECONDS) ?: break
                continue
            }
            val r = o.resp
            if (r != null) { remember(o.route); return r }
            pending--
            lastErr = o.err
            // 这条线路连不上：另一条还没发就马上发
            if (launched == 1) { start(second); launched = 2; pending++ }
            if (pending <= 0) break
            val left = deadline - System.currentTimeMillis()
            if (left <= 0) break
            o = q.poll(left, TimeUnit.MILLISECONDS) ?: break
        }
        throw ApiError(0, if (lastErr is SocketTimeoutException || lastErr == null) "服务器响应太慢，请稍后重试" else "网络连接失败，请检查网络后重试")
    }

    /** 启动时：两条线路一起问一声，谁先回来先用谁（不阻塞界面） */
    fun probe() {
        if (known) return
        Bg.run {
            val q = LinkedBlockingQueue<Int>()
            for (i in ROUTES.indices) Thread {
                try { val r = once(ROUTES[i], "/auth/v1/health", "GET", null, null, emptyMap(), 8000); if (r.status in 200..499) q.put(i) } catch (_: Exception) {}
            }.apply { isDaemon = true; start() }
            val i = q.poll(9, TimeUnit.SECONDS)
            if (i != null && !known) cur = i
        }
    }

    fun human(body: String, status: Int): String {
        val j = parseJson(body) as? JSONObject
        val m = j?.let { listOf("msg", "error_description", "message", "error", "hint").map { k -> it.str(k) }.firstOrNull { s -> s.isNotBlank() } } ?: body.take(200)
        return when {
            Regex("invalid login credentials", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "账号或密码错误"
            Regex("already (registered|exists)", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "这个账号已经被注册了，换一个或直接登录"
            Regex("password should be", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "密码太短，至少 8 位"
            Regex("signups? not allowed|signup is disabled", RegexOption.IGNORE_CASE).containsMatchIn(m) -> "暂时关闭了注册，请联系管理员"
            Regex("[\\u4e00-\\u9fa5]").containsMatchIn(m) -> m
            status == 429 || status == 502 || status == 503 || status == 504 -> "现在用的人太多了，请过一会儿再试"
            Regex("row-level security|permission denied|42501", RegexOption.IGNORE_CASE).containsMatchIn(m) || status == 403 -> "没有权限执行这个操作"
            Regex("JWT expired|JWT invalid|PGRST30", RegexOption.IGNORE_CASE).containsMatchIn(m) || status == 401 -> "登录已过期，请重新登录"
            m.isNotBlank() -> m
            else -> "请求失败（$status）"
        }
    }
    fun isRevoked(body: String): Boolean = body.contains("device_revoked") || body.contains("\"PT401\"")
}
