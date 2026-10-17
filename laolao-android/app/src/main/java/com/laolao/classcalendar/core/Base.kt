package com.laolao.classcalendar.core

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.concurrent.Executors

/** 部署配置：和网页、小程序填的一样（匿名密钥本来就是公开的，权限由数据库控制） */
object Cfg {
    const val BASE = "https://br-brave-deer-5873ae6f.supabase2.aidap-global.cn-beijing.volces.com"
    /** 海外中转线路（Cloudflare Worker） */
    const val ALT = "https://laolao-relay.hangyuan2024.workers.dev"
    const val ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjMzNzEwOTUyNjksInJvbGUiOiJhbm9uIn0.WaD9_FSQy0vUU7Vi6H-PtzC-kTU8wNvE5R9yVJU5Mhk"
    const val DOMAIN = "calendar.test"
    const val SITE = "https://www.laolaokechengbiao.cn/"
    const val VERSION_JSON = "https://www.laolaokechengbiao.cn/download/app-version.json"
}

/** 后台线程 + 主线程 */
object Bg {
    private val pool = Executors.newFixedThreadPool(4)
    val main = Handler(Looper.getMainLooper())
    fun run(block: () -> Unit) { pool.execute { try { block() } catch (e: Throwable) { e.printStackTrace() } } }
    fun ui(block: () -> Unit) { if (Looper.myLooper() == Looper.getMainLooper()) block() else main.post(block) }
    fun later(ms: Long, block: () -> Unit) { main.postDelayed(block, ms) }
    /** 在后台算，算完回到主线程 */
    fun <T> load(work: () -> T, done: (T?, Throwable?) -> Unit) {
        pool.execute {
            var v: T? = null; var err: Throwable? = null
            try { v = work() } catch (e: Throwable) { err = e }
            main.post { done(v, err) }
        }
    }
}

/** 时间：一律按北京时间（东八区）算，和网页、小程序一样 */
object T {
    val BJ: ZoneId = ZoneId.of("Asia/Shanghai")
    private val DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd")
    val WEEK = arrayOf("一", "二", "三", "四", "五", "六", "日")
    fun now(): LocalDateTime = LocalDateTime.now(BJ)
    fun today(): LocalDate = LocalDate.now(BJ)
    fun todayKey(): String = key(today())
    fun key(d: LocalDate): String = d.format(DAY)
    fun date(k: String?): LocalDate? = try { if (k == null || k.length < 10) null else LocalDate.parse(k.substring(0, 10)) } catch (e: Exception) { null }
    fun addDays(k: String, n: Long): String = key(date(k)!!.plusDays(n))
    fun dayDiff(k: String, base: String = todayKey()): Long = java.time.temporal.ChronoUnit.DAYS.between(date(base), date(k))
    /** 「周四」 */
    fun wk(d: LocalDate): String = "周" + WEEK[d.dayOfWeek.value - 1]
    fun wk(k: String): String = date(k)?.let { wk(it) } ?: ""
    /** 「10月8日」 */
    fun md(d: LocalDate): String = "${d.monthValue}月${d.dayOfMonth}日"
    fun md(k: String): String = date(k)?.let { md(it) } ?: ""
    fun hm(t: LocalTime): String = String.format("%02d:%02d", t.hour, t.minute)
    fun min(hm: String?): Int? {
        val m = Regex("^(\\d{1,2}):(\\d{2})").find(hm ?: "") ?: return null
        return m.groupValues[1].toInt() * 60 + m.groupValues[2].toInt()
    }
    /** 北京钟面的某天某分钟 → 真实时刻（毫秒） */
    fun epoch(day: String, minutes: Int): Long = date(day)!!.atStartOfDay(BJ).plusMinutes(minutes.toLong()).toInstant().toEpochMilli()
    fun nowMs(): Long = System.currentTimeMillis()
    /** 「今天 / 明天 / 后天 / 周三 / 下周三 / 10月8日」 */
    fun dayName(k: String): String {
        val n = dayDiff(k)
        if (n == 0L) return "今天"
        if (n == 1L) return "明天"
        if (n == 2L) return "后天"
        if (n == -1L) return "昨天"
        val d = date(k)!!
        val monThis = today().minusDays((today().dayOfWeek.value - 1).toLong())
        val diffW = Math.floorDiv(java.time.temporal.ChronoUnit.DAYS.between(monThis, d), 7L)
        if (diffW == 0L) return wk(d)
        if (diffW == 1L) return "下" + wk(d)
        if (diffW == -1L) return "上" + wk(d)
        return md(d)
    }
    fun greet(): String {
        val h = now().hour
        return when { h < 5 -> "夜深了"; h < 9 -> "早上好"; h < 12 -> "上午好"; h < 14 -> "中午好"; h < 18 -> "下午好"; else -> "晚上好" }
    }
    /** 还有多久：「25 分钟后」「3 小时 5 分后」「2 天后」 */
    fun left(ms: Long): String {
        if (ms < -60_000) {
            val late = -ms / 60000
            return if (late < 60) "刚过 $late 分钟" else if (late < 1440) "已过 ${late / 60} 小时" else "过期 ${late / 1440} 天"
        }
        if (ms <= 60_000) return "就是现在"
        val m = Math.ceil(ms / 60000.0).toLong()
        if (m < 60) return "$m 分钟后"
        if (m < 1440) { val h = m / 60; val r = m % 60; return "$h 小时" + (if (r > 0) " $r 分" else "") + "后" }
        return "${Math.round(m / 1440.0)} 天后"
    }
    fun ago(ms: Long): String {
        if (ms <= 0) return ""
        val s = (System.currentTimeMillis() - ms) / 1000
        if (s < 60) return "刚刚"
        if (s < 3600) return "${s / 60} 分钟前"
        val d = java.time.Instant.ofEpochMilli(ms).atZone(BJ).toLocalDateTime()
        if (d.toLocalDate() == today()) return "今天 " + hm(d.toLocalTime())
        if (d.toLocalDate() == today().minusDays(1)) return "昨天 " + hm(d.toLocalTime())
        return md(d.toLocalDate())
    }
}

/** 「2026-10-02 14:00」→ day + time */
data class When(val day: String, val time: String) {
    companion object {
        private val RE = Regex("^(\\d{4}-\\d{2}-\\d{2})(?:[ T](\\d{2}:\\d{2}))?")
        fun of(s: String?): When? { val m = RE.find((s ?: "").trim()) ?: return null; return When(m.groupValues[1], m.groupValues[2]) }
    }
    override fun toString(): String = if (time.isEmpty()) day else "$day $time"
}

// ---------- JSON 小工具 ----------
fun JSONObject.str(k: String): String = if (isNull(k)) "" else optString(k, "")
fun JSONArray.objs(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
fun jsonOf(vararg kv: Pair<String, Any?>): JSONObject { val o = JSONObject(); for ((k, v) in kv) o.put(k, v ?: JSONObject.NULL); return o }
fun parseJson(s: String?): Any? = try {
    val t = (s ?: "").trim()
    when { t.isEmpty() -> null; t.startsWith("{") -> JSONObject(t); t.startsWith("[") -> JSONArray(t); t == "null" -> null; else -> org.json.JSONTokener(t).nextValue() }
} catch (e: Exception) { null }

/** 新事项的 id：和小程序一样 p + 时间戳 */
private var seq = 0
fun newId(p: String = "p"): String { seq++; return p + System.currentTimeMillis() + if (seq > 1) "_$seq" else "" }
