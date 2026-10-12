package com.laolao.classcalendar

import org.json.JSONObject

internal data class UpcomingSlot(val day: String, val entry: DailyAgendaEntry, val start: Long, val end: Long)
internal data class UpcomingState(val slot: UpcomingSlot, val live: Boolean, val progress: Float, val minutes: Long)

/** Shanghai wall dates; untimed records remain in the full list, never become fake midnight deadlines. */
internal fun agendaMinute(day: String, clock: String): Long? = try {
    val hm = DateMath.time(clock)
    DateMath.parse(day).time / 60000L + hm[0] * 60 + hm[1]
} catch (_: IllegalArgumentException) { null }

internal fun upcomingSlots(day: String, courses: List<JSONObject>, tasks: List<JSONObject>, done: (JSONObject) -> Boolean): List<UpcomingSlot> =
    dailyAgenda(courses, tasks.filter { taskDate(it) == day && !done(it) }).mapNotNull { entry ->
        val start = agendaMinute(day, entry.clock) ?: return@mapNotNull null
        val end = if (entry.course) agendaMinute(day, entry.item.optString("t1"))?.coerceAtLeast(start) ?: start else start
        UpcomingSlot(day, entry, start, end)
    }.sortedBy { it.start }

internal fun nextAgenda(slots: List<UpcomingSlot>, now: Long): UpcomingState? {
    val ordered = slots.sortedBy { it.start }
    val live = ordered.firstOrNull { it.entry.course && now >= it.start && now < it.end }
    val slot = live ?: ordered.firstOrNull { it.start >= now } ?: return null
    val anchor = if (live != null) slot.start else agendaMinute(slot.day, "00:00") ?: slot.start
    val target = if (live != null) slot.end else slot.start
    val progress = if (target <= anchor) 1f else ((now - anchor).toFloat() / (target - anchor)).coerceIn(0f, 1f)
    return UpcomingState(slot, live != null, progress, (target - now).coerceAtLeast(0))
}

internal fun audienceQuestions(id: String): List<String> = when (id) {
    "mentor" -> listOf("今天有什么课", "明天有什么课", "本周安排", "最急的是什么", "这周的作业", "全部待办")
    "business" -> listOf("今天有什么安排", "明天有什么安排", "本周安排", "最急的是什么", "全部待办", "我今天打卡了吗")
    else -> listOf("最急的是什么", "今天有什么课", "这周的作业", "明天有什么安排", "下节课在哪", "我今天打卡了吗")
}