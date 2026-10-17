package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** 一节课（某一天的） */
data class Lesson(val name: String, val start: Int, val end: Int, val t0: String, val t1: String, val location: String, val teacher: String,
                  val week: Int, val add: Boolean = false, val from: String = "") {
    val m0: Int? get() = T.min(t0)
    val m1: Int? get() = T.min(t1) ?: m0?.plus(45)
}

/**
 * 课程表：以服务器上的为准（网页导入的、小程序改的、这里拍照导入的都会存到服务器 courses_sync）。
 * 换算规则和网页 / 小程序 courses.js 一样：第几周、单双周、调课 / 调休（swap / off / cancel / add）。
 */
object Courses {
    private const val LS = "course_srv_v1"          // 本机缓存：{ courses, meta, updated_at, at }
    private const val LS_REV = "course_rev_v1"      // 课表版本（跟着我的数据同步，别的设备改了就知道要重新拿）
    private val WINTER = listOf("08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:00-14:50", "15:00-15:50", "16:10-17:00", "17:10-18:00", "19:10-20:00", "20:10-21:00")
    private val SUMMER = listOf("08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:30-15:20", "15:30-16:20", "16:40-17:30", "17:40-18:30", "19:40-20:30", "20:40-21:30")
    private val TIME_RE = Regex("^\\d{2}:\\d{2}-\\d{2}:\\d{2}$")
    const val MAX_WEEK = 20
    /** 和课程表插件一样的 10 种颜色（按课名算，同一门课颜色固定） */
    val BAR = intArrayOf(0xFF5B8DEF.toInt(), 0xFFE68A97.toInt(), 0xFF5FC491.toInt(), 0xFFEDA35C.toInt(), 0xFF9D7BE0.toInt(), 0xFF5FB7D4.toInt(), 0xFFE587BD.toInt(), 0xFFC2AB62.toInt(), 0xFF9CB85C.toInt(), 0xFFE0936F.toInt())
    fun color(name: String): Int { var h = 0L; for (ch in name) h = (h * 31 + ch.code) and 0xffffffffL; return BAR[(h % BAR.size).toInt()] }

    @Volatile private var cache: JSONObject? = null
    private fun data(): JSONObject = cache ?: Kv.obj(LS).also { cache = it }
    fun list(): List<JSONObject> = (data().optJSONArray("courses") ?: JSONArray()).objs().filter { it.str("name").isNotBlank() }
    fun has(): Boolean = list().isNotEmpty()
    fun syncedAt(): Long = data().optLong("at")
    private fun meta(): JSONObject = data().optJSONObject("meta") ?: JSONObject()

    fun week1(): LocalDate {
        val w = T.date(meta().str("week1")) ?: LocalDate.of(2026, 9, 14)
        return w.minusDays((w.dayOfWeek.value - 1).toLong())
    }
    fun times(): List<String> {
        val t = meta().optJSONArray("times")
        val l = (0 until (t?.length() ?: 0)).map { t!!.optString(it) }
        if (l.size >= 4 && l.all { TIME_RE.matches(it) }) return l
        val m = T.today().monthValue
        return if (m in 5..10) SUMMER else WINTER
    }
    fun weekOf(k: String): Int = Math.floorDiv(java.time.temporal.ChronoUnit.DAYS.between(week1(), T.date(k)), 7L).toInt() + 1
    /** 今天第几周（不在学期内返回 0） */
    fun weekNow(): Int { if (!has()) return 0; val w = weekOf(T.todayKey()); return if (w in 1..MAX_WEEK) w else 0 }

    /** 「1-16」「1-15单」「2-16双」「1-3,5-8」，空的 = 1-16 周 */
    fun parseWeeks(s0: String?): Set<Int> {
        val s = (s0 ?: "").trim(); val set = HashSet<Int>()
        if (s.isEmpty()) { set.addAll(1..16); return set }
        Regex("^(\\d+)\\s*[-–—~至]\\s*(\\d+)\\s*[（(]?\\s*(单|双)\\s*[）)]?$").find(s)?.let { m ->
            for (i in m.groupValues[1].toInt()..m.groupValues[2].toInt()) if ((m.groupValues[3] == "单") == (i % 2 == 1)) set += i
            return set
        }
        for (part in s.split(Regex("[,，、;；\\s]+"))) {
            val r = Regex("^(\\d+)\\s*[-–—~至]\\s*(\\d+)$").find(part)
            if (r != null) { var x = r.groupValues[1].toInt(); var y = r.groupValues[2].toInt(); if (x > y) { val t = x; x = y; y = t }; for (k in x..minOf(y, 30)) set += k }
            else if (Regex("^\\d+$").matches(part) && part.toInt() <= 30) set += part.toInt()
        }
        return set
    }
    fun weeksText(ws: Collection<Int>): String {
        val a = ws.filter { it in 1..30 }.sorted()
        if (a.isEmpty()) return ""
        if (a.size >= 3 && a.withIndex().all { (i, x) -> i == 0 || x - a[i - 1] == 2 }) return "${a.first()}-${a.last()}" + if (a.first() % 2 == 1) "单" else "双"
        val runs = mutableListOf<String>(); var s0 = a[0]
        for (i in 1..a.size) if (i == a.size || a[i] != a[i - 1] + 1) { runs += if (s0 == a[i - 1]) "$s0" else "$s0-${a[i - 1]}"; if (i < a.size) s0 = a[i] }
        return runs.joinToString(",")
    }

    private fun base(k: String): List<Lesson> {
        val wk = weekOf(k); if (wk < 1 || wk > MAX_WEEK) return emptyList()
        val day = T.date(k)!!.dayOfWeek.value - 1
        val tm = times()
        return list().filter { it.optInt("day", -1) == day && wk in weeksOf(it) }.map { c ->
            val st = c.optInt("start", 1); val en = c.optInt("end", st)
            Lesson(c.str("name"), st, en, tm.getOrNull(st - 1)?.substringBefore("-") ?: "", tm.getOrNull(en - 1)?.substringAfter("-") ?: "",
                c.str("location"), c.str("teacher"), wk)
        }.sortedBy { it.start }
    }
    private fun weeksOf(c: JSONObject): Set<Int> {
        val wl = c.optJSONArray("wl")
        if (wl != null && wl.length() > 0) return (0 until wl.length()).map { wl.optInt(it) }.toSet()
        return parseWeeks(c.str("weeks"))
    }
    private fun adj(k: String): List<JSONObject> = (meta().optJSONArray("adj") ?: JSONArray()).objs().filter { it.str("date") == k }

    /** 某一天的课（含调课、调休、停课、加课） */
    fun on(k: String): List<Lesson> {
        if (!has()) return emptyList()
        val a = adj(k)
        var list: List<Lesson> = when {
            a.any { it.str("type") == "off" } -> emptyList()
            else -> a.firstOrNull { it.str("type") == "swap" }?.let { sw -> base(sw.str("from")).map { it.copy(from = sw.str("from")) } } ?: base(k)
        }
        for (x in a) if (x.str("type") == "cancel") list = list.filter { !(it.name == x.str("name") && (x.optInt("start") == 0 || x.optInt("start") == it.start)) }
        val tm = times(); val wk = weekOf(k)
        for (x in a) if (x.str("type") == "add") {
            val st = x.optInt("start", 1); val en = maxOf(st, x.optInt("end", st))
            list = list + Lesson(x.str("name"), st, en, tm.getOrNull(st - 1)?.substringBefore("-") ?: "", tm.getOrNull(en - 1)?.substringAfter("-") ?: "", x.str("location"), x.str("teacher"), wk, add = true)
        }
        return list.sortedBy { it.start }
    }
    /** 这一天的调整说明（「国庆放假」「上 10月8日 的课」） */
    fun dayNote(k: String): String {
        val a = adj(k); if (a.isEmpty()) return ""
        a.firstOrNull { it.str("type") == "off" }?.let { return it.str("note").ifBlank { "放假 / 停课" } }
        val parts = mutableListOf<String>()
        a.firstOrNull { it.str("type") == "swap" }?.let { parts += "上 " + T.md(it.str("from")) + "（" + T.wk(it.str("from")) + "）的课" }
        val nc = a.count { it.str("type") == "cancel" }; val na = a.count { it.str("type") == "add" }
        if (nc > 0) parts += "停 $nc 节"; if (na > 0) parts += "加 $na 节"
        return parts.joinToString("，")
    }

    // ---------- 「下次上课前」：交作业最常用的截止时间 ----------
    class NextLesson(val name: String, val day: String, val time: String) {
        /** 「周一 08:00」 */
        val text: String get() = T.dayName(day).let { if (it.length > 3) T.md(day) else it } + " " + time
    }
    fun names(): List<String> = list().map { it.str("name") }.distinct()
    /** 这门课下一次上课（现在之后，两周内） */
    fun nextOf(name: String): NextLesson? {
        val now = T.now(); val nowMin = now.hour * 60 + now.minute; val t = T.todayKey()
        for (i in 0..14) {
            val k = T.addDays(t, i.toLong())
            val l = on(k).filter { it.name == name && it.m0 != null && (i > 0 || it.m0!! > nowMin) }.minByOrNull { it.m0!! } ?: continue
            return NextLesson(l.name, k, l.t0)
        }
        return null
    }
    /** 一句话里说的是哪门课：「数学作业」→「高等数学」（名字里有两个字以上对得上） */
    fun match(text: String): String? {
        val tx = text.replace(Regex("作业|练习|习题|报告|预习|复习|课前|上课|下次|下节|交"), " ")
        var best: String? = null; var score = 1
        for (n in names()) {
            val core = n.replace(Regex("[（(].*?[)）]|[A-Za-z0-9ⅠⅡⅢⅣ]+$"), "").trim()
            val sc = if (core.length >= 2 && tx.contains(core)) 100 + core.length else common(tx, core)
            if (sc > score) { score = sc; best = n }
        }
        return best
    }
    private fun common(a: String, b: String): Int {
        var best = 0
        for (i in a.indices) for (j in b.indices) { var k = 0; while (i + k < a.length && j + k < b.length && a[i + k] == b[j + k] && !a[i + k].isWhitespace()) k++; if (k > best) best = k }
        return best
    }
    /** 截止时间候选：先放对得上的那门课，再按时间先后放别的课 */
    fun nextChoices(text: String, max: Int = 6): List<NextLesson> {
        val m = match(text)
        val all = names().mapNotNull { nextOf(it) }.sortedBy { it.day + it.time }
        return (all.filter { it.name == m } + all.filter { it.name != m }).take(max)
    }
    fun stripNext(s: String): String = s.replace(NEXT_RE, " ").replace(Regex("\\s+"), " ").trim().trim('，', ',', '：', ':')
    private val NEXT_RE = Regex("下(节|次|一节|一次)(课|上课)?(前|之前|以前)?|(上课|课)(前|之前)|下节|下次课")
    /** 一句话里写了「下节课前 / 下次上课前」：换成那门课下次上课的时间 */
    fun resolveNext(text: String): NextLesson? {
        if (!NEXT_RE.containsMatchIn(text) || !has()) return null
        val m = match(text) ?: return null
        return nextOf(m)
    }

    // ---------- 和服务器同步 ----------
    /** 别的设备改过课表（course_rev_v1 变了）、太久没拿、或者强制：从服务器拿 */
    fun pull(force: Boolean = false): Boolean {
        if (!Api.loggedIn) return false
        val d = data()
        val rev = (Kv.get(LS_REV) as? JSONObject)?.str("at") ?: ""
        val fresh = System.currentTimeMillis() - d.optLong("at") < 6 * 3600_000L
        if (!force && d.has("updated_at") && (rev.isEmpty() || same(rev, d.str("updated_at"))) && fresh) return false
        val r = Api.rpc("courses_get") as? JSONObject
        val o = JSONObject()
        o.put("courses", r?.optJSONArray("courses") ?: JSONArray())
        o.put("meta", r?.optJSONObject("meta") ?: JSONObject())
        o.put("updated_at", r?.str("updated_at") ?: "")
        o.put("at", System.currentTimeMillis())
        val changed = o.optJSONArray("courses").toString() != (d.optJSONArray("courses") ?: JSONArray()).toString() || o.optJSONObject("meta").toString() != (d.optJSONObject("meta") ?: JSONObject()).toString()
        cache = o; Kv.setQuiet(LS, o)
        if (changed) Bus.emit("data")
        return changed
    }
    private fun same(a: String, b: String): Boolean {
        if (a == b) return true
        return try { java.time.OffsetDateTime.parse(a.replace(" ", "T")).toInstant() == java.time.OffsetDateTime.parse(b.replace(" ", "T")).toInstant() } catch (e: Exception) { false }
    }

    /** 拍照识别后核对好的课：存到服务器（网页、小程序、邮件提醒、手机日历订阅都跟着变） */
    fun upload(courses: List<JSONObject>, times: List<String>?, week1: LocalDate?) {
        val cur = meta()
        val meta = JSONObject()
        val w = week1 ?: week1()
        meta.put("week1", T.key(w.minusDays((w.dayOfWeek.value - 1).toLong())))
        meta.put("times", JSONArray(times ?: times()))
        meta.put("ics", cur.optBoolean("ics", true))
        meta.put("adj", cur.optJSONArray("adj") ?: JSONArray())
        val arr = JSONArray()
        courses.take(200).forEach { c ->
            val ws = parseWeeks(c.str("weeks"))
            arr.put(jsonOf("id" to c.str("id").ifBlank { newId("c") }.take(40), "name" to c.str("name").take(60), "day" to c.optInt("day"), "start" to c.optInt("start"), "end" to c.optInt("end"),
                "weeks" to c.str("weeks").take(40), "wl" to JSONArray(ws.sorted()), "location" to c.str("location").take(60), "teacher" to c.str("teacher").take(40)))
        }
        if (arr.length() == 0) throw ApiError(0, "没有要保存的课")
        val r = Api.rpc("courses_sync", jsonOf("p_courses" to arr, "p_meta" to meta), hedge = true) as? JSONObject
        val srv = r?.str("updated_at") ?: ""
        val o = JSONObject().put("courses", arr).put("meta", meta).put("updated_at", srv).put("at", System.currentTimeMillis())
        cache = o; Kv.setQuiet(LS, o)
        if (srv.isNotEmpty()) Kv.set(LS_REV, jsonOf("at" to srv, "n" to arr.length()))
        Bus.emit("data")
    }
    fun clearLocal() { cache = null; Kv.setQuiet(LS, null) }
}
