package com.laolao.classcalendar

import org.json.JSONObject

/** One ordering rule shared by the home dashboard, calendar and task inbox. */
internal data class DailyAgendaEntry(
    val key: String,
    val clock: String,
    val course: Boolean,
    val item: JSONObject,
)

internal fun dailyAgenda(courses: List<JSONObject>, tasks: List<JSONObject>): List<DailyAgendaEntry> =
    (courses.mapIndexed { index, item ->
        DailyAgendaEntry("course-${item.optString("id")}-$index", item.optString("t0"), true, item)
    } + tasks.mapIndexed { index, item ->
        DailyAgendaEntry("task-${item.optString("_key", item.optString("id"))}-$index", taskClock(item), false, item)
    }).sortedWith(compareBy<DailyAgendaEntry> { it.clock.ifBlank { "00:00" } }.thenBy { !it.course })

internal fun isOverdueTask(item: JSONObject, today: String, done: Boolean): Boolean =
    !done && taskDate(item).let { it.isNotBlank() && it < today }

internal fun pendingBucket(item: JSONObject, today: String): String = when {
    taskDate(item).isBlank() -> "未定日期"
    taskDate(item) < today -> "已逾期"
    taskDate(item) == today -> "今天"
    taskDate(item) == DateMath.plus(today, 1) -> "明天"
    else -> dateLabel(taskDate(item))
}