package com.laolao.classcalendar.model

import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

enum class Kind(val label: String) { COURSE("课程"), EVENT("个人"), CLASS("班级") }

data class AgendaItem(
    val id: String,
    val kind: Kind,
    val title: String,
    val date: LocalDate,
    val start: Int?, // minutes since midnight; null = all day
    val end: Int?,
    val place: String = "",
    val note: String = "",
    val done: Boolean = false,
    /** 班级事项的类型（作业 / 通知 / 会议 / 活动），自己记的作业也是「作业」 */
    val type: String = "",
    /** 班级事项在服务器上的编号（已读、附件用）；自己记的事项为空 */
    val serverId: String = "",
    val summary: String = "",
) {
    val isHomework: Boolean get() = type == "作业"
    val timeText: String get() = if (start == null) "全天" else fmt(start) + (end?.let { "–" + fmt(it) } ?: "")
}

fun fmt(m: Int) = "%02d:%02d".format(m / 60, m % 60)

fun parseHm(s: String): Int? {
    val p = s.trim().split(":")
    if (p.size != 2) return null
    val h = p[0].toIntOrNull() ?: return null
    val m = p[1].toIntOrNull() ?: return null
    return if (h in 0..23 && m in 0..59) h * 60 + m else null
}

/** "YYYY-MM-DD HH:MM" or "YYYY-MM-DD" (website format). */
fun parseEventTime(s: String): Pair<LocalDate, Int?>? {
    val t = s.trim().replace('T', ' ')
    if (t.length < 10) return null
    val d = runCatching { LocalDate.parse(t.substring(0, 10)) }.getOrNull() ?: return null
    return d to (if (t.length >= 16) parseHm(t.substring(11, 16)) else null)
}

val DEFAULT_TIMES = listOf(
    "08:00-08:50", "09:00-09:50", "10:10-11:00", "11:10-12:00", "14:30-15:20",
    "15:30-16:20", "16:40-17:30", "17:40-18:30", "19:40-20:30", "20:40-21:30",
)
val WEEKDAYS = listOf("周一", "周二", "周三", "周四", "周五", "周六", "周日")

data class Course(
    val id: String, val name: String, val day: Int, val start: Int, val end: Int,
    val weeks: String, val location: String, val teacher: String,
) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("day", day).put("start", start)
        .put("end", end).put("weeks", weeks).put("wl", JSONArray(parseWeeks(weeks).toList()))
        .put("location", location).put("teacher", teacher)

    companion object {
        fun from(o: JSONObject) = Course(o.optString("id"), o.optString("name"), o.optInt("day", -1), o.optInt("start"),
            o.optInt("end"), o.optString("weeks", "1-16"), o.optString("location"), o.optString("teacher"))
    }
}

data class CourseMeta(val week1: LocalDate, val times: List<String>) {
    fun week(day: LocalDate) = Math.floorDiv(ChronoUnit.DAYS.between(week1, day), 7L).toInt() + 1
    fun toJson(): JSONObject = JSONObject().put("week1", week1.toString()).put("times", JSONArray(times)).put("ics", true)

    companion object {
        fun from(o: JSONObject?): CourseMeta {
            val w = runCatching { LocalDate.parse(o?.optString("week1")) }.getOrNull() ?: LocalDate.of(2026, 9, 14)
            val arr = o?.optJSONArray("times")
            val t = if (arr != null && arr.length() > 0) (0 until arr.length()).map { arr.optString(it) } else DEFAULT_TIMES
            return CourseMeta(w.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)), t)
        }
    }
}

/** "1-16", "1,3,5", "1-16单", "2-8双" -> set of week numbers. */
fun parseWeeks(raw: String): Set<Int> {
    val out = sortedSetOf<Int>()
    val s = raw.trim().ifEmpty { "1-16" }
    for (part0 in s.split(',', '，', ' ').filter { it.isNotBlank() }) {
        var part = part0.removeSuffix("周")
        val odd = part.endsWith("单"); val even = part.endsWith("双")
        part = part.removeSuffix("单").removeSuffix("双").removeSuffix("周")
        val r = part.split('-', '–', '~')
        val a = r[0].toIntOrNull() ?: continue
        val b = if (r.size > 1) r[1].toIntOrNull() ?: a else a
        for (w in minOf(a, b)..minOf(maxOf(a, b), 60)) if ((!odd || w % 2 == 1) && (!even || w % 2 == 0)) out.add(w)
    }
    return out
}

object AgendaModel {
    fun coursesOn(day: LocalDate, courses: List<Course>, meta: CourseMeta): List<AgendaItem> {
        val wd = day.dayOfWeek.value - 1
        val w = meta.week(day)
        return courses.filter { it.day == wd && w in parseWeeks(it.weeks) && it.start >= 1 && it.end >= it.start && it.end <= meta.times.size }
            .map { c ->
                val s = parseHm(meta.times[c.start - 1].substringBefore('-'))
                val e = parseHm(meta.times[c.end - 1].substringAfter('-'))
                AgendaItem("c:${c.id}:$day", Kind.COURSE, c.name, day, s, e, c.location, c.teacher)
            }
    }

    /** 一条班级事项 / 自己记的事项 → AgendaItem。和网站一样：班级事项的完成标记存在 personal_marks_v1["c<编号>"]，自己记的存在记录的 done 字段里 */
    fun toItem(e: JSONObject, marks: JSONObject, kind: Kind, fallbackDay: LocalDate? = null): AgendaItem? {
        val parsed = parseEventTime(e.optString("event_time"))
        val d = parsed?.first ?: fallbackDay ?: return null
        val t = parsed?.second
        val raw = e.optString("id")
        val isClass = kind == Kind.CLASS
        val key = if (isClass) "c$raw" else raw
        val mk = marks.optJSONObject(key)
        if (isClass && mk?.optBoolean("hidden") == true) return null
        val done = if (isClass) mk?.optBoolean("done") == true else (e.optBoolean("done") || mk?.optBoolean("done") == true)
        val type = if (isClass) e.optString("msg_type", "通知") else if (e.optString("kind") == "作业") "作业" else ""
        val note = if (isClass) (mk?.optString("note") ?: "") else e.optString("note")
        return AgendaItem(key, kind, e.optString("subject").ifBlank { e.optString("summary").ifBlank { "未命名事项" } }, d, t,
            t?.let { minOf(it + 60, 24 * 60 - 1) }, e.optString("location"), note, done, type, if (isClass) raw else "",
            if (isClass && e.optString("subject").isNotBlank()) e.optString("summary") else "")
    }

    fun eventsOn(day: LocalDate, events: List<JSONObject>, marks: JSONObject, kind: Kind): List<AgendaItem> =
        events.mapNotNull { e ->
            val p = parseEventTime(e.optString("event_time")) ?: return@mapNotNull null
            if (p.first != day) return@mapNotNull null
            toItem(e, marks, kind)
        }

    /** Every item of the day, chronological; all-day items last. Never truncated. */
    fun day(day: LocalDate, courses: List<Course>, meta: CourseMeta, personal: List<JSONObject>, classItems: List<JSONObject>, marks: JSONObject): List<AgendaItem> =
        (coursesOn(day, courses, meta) + eventsOn(day, personal, marks, Kind.EVENT) + eventsOn(day, classItems, marks, Kind.CLASS))
            .sortedWith(compareBy<AgendaItem> { it.start ?: Int.MAX_VALUE }.thenBy { it.title })

    /** Index of the item happening now, or the next upcoming timed item. */
    fun current(items: List<AgendaItem>, nowMin: Int): Pair<AgendaItem?, AgendaItem?> {
        val now = items.firstOrNull { it.start != null && it.start <= nowMin && (it.end ?: it.start) > nowMin }
        val next = items.firstOrNull { it.start != null && it.start > nowMin }
        return now to next
    }
}
