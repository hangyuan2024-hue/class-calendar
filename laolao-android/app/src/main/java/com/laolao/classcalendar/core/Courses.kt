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
        var best: String? = null; var score = 1.0
        for (n in names()) {
            val core = n.replace(Regex("[（(].*?[)）]|[A-Za-z0-9ⅠⅡⅢⅣ]+$"), "").trim()
            val sc = if (core.length >= 2 && tx.contains(core)) 100.0 + core.length else maxOf(common(tx, core).toDouble(), abbr(tx, core))
            if (sc > score) { score = sc; best = n }
        }
        return best
    }
    /** 简称：「线代」→「线性代数」、「高数」→「高等数学」（第一个字一样，后面的字按顺序出现在课名里） */
    private fun abbr(tx: String, core: String): Double {
        if (core.isEmpty()) return 0.0
        var best = 0
        for (i in tx.indices) {
            if (tx[i] != core[0]) continue
            for (len in 2..4) {
                if (i + len > tx.length) break
                val sub = tx.substring(i, i + len)
                if (sub.any { it.isWhitespace() }) break
                var p = 0
                for (ch in core) if (p < sub.length && ch == sub[p]) p++
                if (p == sub.length && len > best) best = len
            }
        }
        return if (best > 0) best + 0.5 else 0.0
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
        val meta = metaNow()
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

    // ---------- 在手机上直接改（加课、改课、删课、调课调休、作息、第 1 周、学期）：改完马上存到服务器 ----------
    val WINTER_T get() = WINTER
    val SUMMER_T get() = SUMMER
    fun metaNow(): JSONObject = JSONObject(meta().toString())
    fun semester(): String = meta().str("semester")
    /** 现在用的是哪套作息：winter / summer / custom */
    fun mode(): String { val t = times(); return if (t == WINTER) "winter" else if (t == SUMMER) "summer" else "custom" }
    fun adjList(): List<JSONObject> = (meta().optJSONArray("adj") ?: JSONArray()).objs().sortedBy { it.str("date") }
    /** 存一份完整的课表（课 + meta 的一部分改动）；课删光了就删掉云端那份 */
    fun save(courses: List<JSONObject>, patch: JSONObject = JSONObject()) {
        val m = metaNow()
        for (k in patch.keys()) m.put(k, patch.get(k))
        m.put("week1", T.key(T.date(m.str("week1"))?.let { it.minusDays((it.dayOfWeek.value - 1).toLong()) } ?: week1()))
        if (m.optJSONArray("times") == null) m.put("times", JSONArray(times()))
        if (!m.has("ics")) m.put("ics", true)
        val arr = JSONArray()
        courses.take(200).forEach { c ->
            val ws = parseWeeks(c.str("weeks"))
            arr.put(jsonOf("id" to c.str("id").ifBlank { newId("c") }.take(40), "name" to c.str("name").take(60), "day" to c.optInt("day"), "start" to c.optInt("start"), "end" to c.optInt("end"),
                "weeks" to c.str("weeks").take(40), "wl" to JSONArray(ws.sorted()), "location" to c.str("location").take(60), "teacher" to c.str("teacher").take(40)))
        }
        var srv = ""
        if (arr.length() == 0) { try { Api.rpc("courses_clear") } catch (_: Exception) {} }
        else srv = (Api.rpc("courses_sync", jsonOf("p_courses" to arr, "p_meta" to m)) as? JSONObject)?.str("updated_at") ?: ""
        val o = JSONObject().put("courses", arr).put("meta", m).put("updated_at", srv).put("at", System.currentTimeMillis())
        cache = o; Kv.setQuiet(LS, o)
        if (srv.isNotEmpty()) Kv.set(LS_REV, jsonOf("at" to srv, "n" to arr.length()))
        Bus.emit("data")
    }
    fun all(): List<JSONObject> = list().map { JSONObject(it.toString()) }
    fun saveCourse(c: JSONObject) {
        if (c.str("name").isBlank()) throw ApiError(0, "请填写课程名称")
        if (parseWeeks(c.str("weeks")).isEmpty()) throw ApiError(0, "上课周次不对，比如 1-16、1-8单、1,3,5")
        if (c.optInt("end") < c.optInt("start")) throw ApiError(0, "结束节次不能早于开始节次")
        val l = all().toMutableList(); val i = l.indexOfFirst { it.str("id") == c.str("id") && c.str("id").isNotEmpty() }
        if (i >= 0) l[i] = c else l += c.put("id", c.str("id").ifEmpty { newId("c") })
        save(l)
    }
    fun deleteCourse(id: String) = save(all().filter { it.str("id") != id })
    fun clearAll() = save(emptyList())
    fun setAdj(l: List<JSONObject>) = save(all(), jsonOf("adj" to JSONArray(l.take(200))))
    fun addAdj(x: JSONObject) { x.put("id", newId("a").take(40)); setAdj(adjList() + x) }
    fun delAdj(id: String) = setAdj(adjList().filter { it.str("id") != id })
    /** 一条调整的说明 */
    fun adjText(a: JSONObject): String = when (a.str("type")) {
        "swap" -> "上 " + T.md(a.str("from")) + "（" + T.wk(a.str("from")) + "）的课"
        "off" -> "放假 / 停课" + if (a.str("note").isNotEmpty()) "：" + a.str("note") else ""
        "cancel" -> "「${a.str("name")}」" + (if (a.optInt("start") > 0) "第${a.optInt("start")}节" else "") + "不上"
        else -> "加课「${a.str("name")}」第${a.optInt("start")}" + (if (a.optInt("end") > a.optInt("start")) "-${a.optInt("end")}" else "") + "节" + if (a.str("location").isNotEmpty()) " · " + a.str("location") else ""
    }
    fun setTimes(t: List<String>) { if (t.size < 4 || !t.all { TIME_RE.matches(it) }) throw ApiError(0, "作息时间格式不对"); save(all(), jsonOf("times" to JSONArray(t))) }
    fun setWeek1(d: LocalDate) = save(all(), jsonOf("week1" to T.key(d)))
    fun setSemester(s: String) = save(all(), jsonOf("semester" to s.trim().take(30)))

    // ---------- 班级课表（老师 / 班委发布，全班能看、一键套用） ----------
    fun classGet(cid: String): JSONObject? {
        val r = Api.rpc("class_schedule_get", jsonOf("p_cid" to cid)) as? JSONObject
        val all = Kv.obj("class_schedule_cache_v1"); all.put(cid, r ?: JSONObject.NULL); Kv.setQuiet("class_schedule_cache_v1", all)
        return r?.takeIf { (it.optJSONArray("courses")?.length() ?: 0) > 0 }
    }
    fun classPublish(cid: String, title: String) {
        val l = all(); if (l.isEmpty()) throw ApiError(0, "你的课表还是空的，先导入或添加课程再发布")
        val arr = JSONArray(l.map { c -> jsonOf("id" to c.str("id"), "name" to c.str("name"), "day" to c.optInt("day"), "start" to c.optInt("start"), "end" to c.optInt("end"), "weeks" to c.str("weeks"), "wl" to JSONArray(parseWeeks(c.str("weeks")).sorted()), "location" to c.str("location"), "teacher" to c.str("teacher")) })
        Api.rpc("class_schedule_publish", jsonOf("p_cid" to cid, "p_courses" to arr, "p_title" to title.take(40), "p_meta" to jsonOf("week1" to T.key(week1()), "times" to JSONArray(times()), "semester" to semester())))
    }
    fun classClear(cid: String) { Api.rpc("class_schedule_clear", jsonOf("p_cid" to cid)) }
    /** 班级课表的课（画格子用，形状和自己的一样） */
    fun classCourses(r: JSONObject): List<JSONObject> = (r.optJSONArray("courses") ?: JSONArray()).objs()
    /** 套用：replace 换成班级课表；merge 保留自己的，只加上没有的 */
    fun useClass(r: JSONObject, merge: Boolean): Int {
        val stamp = java.lang.Long.toString(System.currentTimeMillis(), 36)
        val add = classCourses(r).mapIndexed { i, c -> JSONObject(c.toString()).put("id", "c${stamp}_$i") }
        val mine = all(); fun key(c: JSONObject) = c.str("name") + "|" + c.optInt("day") + "|" + c.optInt("start")
        val list = if (merge) { val have = mine.map(::key).toSet(); mine + add.filter { key(it) !in have } } else add
        val m = r.optJSONObject("meta") ?: JSONObject(); val patch = JSONObject()
        if (T.date(m.str("week1")) != null) patch.put("week1", m.str("week1"))
        m.optJSONArray("times")?.let { if (it.length() >= 4) patch.put("times", it) }
        if (m.str("semester").isNotEmpty() && semester().isEmpty()) patch.put("semester", m.str("semester"))
        save(list, patch)
        return list.size - if (merge) mine.size else 0
    }
    /** 某一周、某一天的课（给任意一份课表数据用：班级课表预览） */
    fun onFor(courses: List<JSONObject>, k: String, w1: LocalDate, tm: List<String>): List<Lesson> {
        val wk = Math.floorDiv(java.time.temporal.ChronoUnit.DAYS.between(w1, T.date(k)), 7L).toInt() + 1
        if (wk < 1 || wk > MAX_WEEK) return emptyList()
        val day = T.date(k)!!.dayOfWeek.value - 1
        return courses.filter { it.optInt("day", -1) == day && wk in weeksOf(it) }.map { c -> val st = c.optInt("start", 1); val en = c.optInt("end", st)
            Lesson(c.str("name"), st, en, tm.getOrNull(st - 1)?.substringBefore("-") ?: "", tm.getOrNull(en - 1)?.substringAfter("-") ?: "", c.str("location"), c.str("teacher"), wk) }.sortedBy { it.start }
    }
    /** 一节课对应哪一条课程记录（点开详情、编辑用） */
    fun courseOf(l: Lesson, day: Int): JSONObject? = list().firstOrNull { it.str("name") == l.name && it.optInt("day") == day && it.optInt("start") == l.start }
}
