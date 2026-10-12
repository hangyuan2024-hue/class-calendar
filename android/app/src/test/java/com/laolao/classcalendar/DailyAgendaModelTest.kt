package com.laolao.classcalendar

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DailyAgendaModelTest {
    private fun task(id: String, at: String) = JSONObject().put("id", id).put("subject", id).put("event_time", at)

    @Test fun completeTodayListIsNeverTruncated() {
        val tasks = (1..25).map { task("task-$it", "2026-10-12 18:00") }
        val courses = (1..8).map { JSONObject().put("id", it).put("name", "课程$it").put("t0", "08:00") }
        val entries = dailyAgenda(courses, tasks)
        assertEquals(33, entries.size)
        assertEquals(33, entries.map { it.key }.distinct().size)
        assertEquals(25, entries.count { !it.course })
    }

    @Test fun allDayAndMidnightRemainDistinct() {
        val result = dailyAgenda(emptyList(), listOf(task("evening", "2026-10-12T18:00:00"), task("all-day", "2026-10-12"), task("midnight", "2026-10-12 00:00")))
        assertEquals("all-day", result.first().item.getString("id"))
        assertEquals("00:00", result[1].clock)
        assertEquals("18:00", result.last().clock)
    }

    @Test fun overdueExcludesCompletedUndatedAndToday() {
        assertTrue(isOverdueTask(task("old", "2026-10-11 18:00"), "2026-10-12", false))
        assertFalse(isOverdueTask(task("done", "2026-10-11 18:00"), "2026-10-12", true))
        assertFalse(isOverdueTask(task("none", ""), "2026-10-12", false))
        assertFalse(isOverdueTask(task("today", "2026-10-12"), "2026-10-12", false))
    }

    @Test fun inboxIncludesEveryKindAndUndatedBucket() {
        assertEquals("未定日期", pendingBucket(task("none", ""), "2026-10-12"))
        assertEquals("已逾期", pendingBucket(task("old", "2026-10-11"), "2026-10-12"))
        assertEquals("今天", pendingBucket(task("today", "2026-10-12"), "2026-10-12"))
        assertEquals("明天", pendingBucket(task("next", "2026-10-13"), "2026-10-12"))
    }
}