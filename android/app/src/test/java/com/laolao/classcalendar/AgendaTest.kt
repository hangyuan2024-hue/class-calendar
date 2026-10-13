package com.laolao.classcalendar

import com.laolao.classcalendar.data.SyncStore
import com.laolao.classcalendar.model.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class AgendaTest {
    private val meta = CourseMeta(LocalDate.of(2026, 9, 14), DEFAULT_TIMES)
    @Test fun weeksParse() {
        assertEquals((1..16).toSet(), parseWeeks("1-16"))
        assertEquals(setOf(1, 3, 5), parseWeeks("1-5单"))
        assertEquals(setOf(2, 4), parseWeeks("2-4双"))
    }
    @Test fun dayKeepsEveryItemInOrder() {
        val mon = LocalDate.of(2026, 10, 12)
        val courses = listOf(Course("a", "高数", 0, 1, 2, "1-16", "A101", ""), Course("b", "英语", 0, 3, 4, "1-16", "", ""))
        val ev = (1..30).map { JSONObject().put("id", "e$it").put("subject", "事$it").put("event_time", "2026-10-12 09:00") }
        val all = AgendaModel.day(mon, courses, meta, ev, emptyList(), JSONObject())
        assertEquals(32, all.size)
        assertEquals("高数", all.first().title)
        assertEquals(480, all.first().start)
    }
    @Test fun eventTimeParse() {
        assertEquals(LocalDate.of(2026, 10, 1) to 870, parseEventTime("2026-10-01 14:30"))
        assertEquals(LocalDate.of(2026, 10, 1) to null, parseEventTime("2026-10-01"))
        assertNull(parseEventTime("bad"))
    }
    @Test fun malformedPullRejected() {
        assertThrows(IllegalStateException::class.java) { SyncStore.validatePull(JSONObject().put("rows", JSONArray()).put("rev", 3), 5) }
        assertThrows(IllegalStateException::class.java) { SyncStore.validatePull(JSONObject().put("rows", JSONArray().put(JSONObject().put("ns", "x"))).put("rev", 6), 5) }
    }
    @Test fun ackRequiresSamePayload() {
        val a = JSONObject().put("t", 5).put("v", "x")
        assertTrue(SyncStore.acknowledged(a, JSONObject().put("t", 5).put("v", "x")))
        assertFalse(SyncStore.acknowledged(JSONObject().put("t", 5).put("v", "y"), a))
    }
    @Test fun currentAndNext() {
        val d = LocalDate.now()
        val items = listOf(AgendaItem("1", Kind.EVENT, "a", d, 600, 660), AgendaItem("2", Kind.EVENT, "b", d, 700, 760))
        assertEquals("a", AgendaModel.current(items, 620).first?.title)
        assertEquals("b", AgendaModel.current(items, 620).second?.title)
    }
}
