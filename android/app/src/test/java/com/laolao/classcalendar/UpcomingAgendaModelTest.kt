package com.laolao.classcalendar

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class UpcomingAgendaModelTest {
    private val day = "2026-10-12"
    private fun task(id: String, time: String) = JSONObject().put("id", id).put("event_time", time)
    private fun course(start: String, end: String) = JSONObject().put("id", "c").put("t0", start).put("t1", end)
    private fun now(time: String) = requireNotNull(agendaMinute(day, time))
    @Test fun untimedCompletedAndMalformedAreNotFakeDeadlines() {
        val tasks = listOf(task("all", day), task("bad", "$day 99:99"), task("done", "$day 12:00"), task("ok", "$day 16:00"))
        val slots = upcomingSlots(day, emptyList(), tasks) { it.optString("id") == "done" }
        assertEquals(listOf("ok"), slots.map { it.entry.item.optString("id") })
    }
    @Test fun ongoingCourseShowsElapsedNotCompletedTasks() {
        val slots = upcomingSlots(day, listOf(course("08:00", "10:00")), emptyList()) { false }
        val state = requireNotNull(nextAgenda(slots, now("09:00")))
        assertTrue(state.live); assertEquals(.5f, state.progress, .001f); assertEquals(60L, state.minutes)
    }
    @Test fun endedCourseDoesNotStayLiveAndPastTasksDoNotBlockNext() {
        val slots = upcomingSlots(day, listOf(course("08:00", "10:00")), listOf(task("old", "$day 09:00"), task("next", "$day 12:00"))) { false }
        assertEquals("next", nextAgenda(slots, now("10:00"))?.slot?.entry?.item?.optString("id"))
        assertNull(nextAgenda(slots, now("23:59")))
    }
    @Test fun midnightTomorrowAndBoundaryAreHandled() {
        val tomorrow = DateMath.plus(day, 1)
        val slots = upcomingSlots(tomorrow, emptyList(), listOf(task("midnight", "$tomorrow 00:00"))) { false }
        val state = requireNotNull(nextAgenda(slots, now("23:59")))
        assertEquals(1L, state.minutes); assertTrue(state.progress in 0f..1f)
        assertEquals(1f, nextAgenda(slots, requireNotNull(agendaMinute(tomorrow, "00:00")))?.progress)
    }
    @Test fun invalidDatesAndTimesAreRejected() {
        assertNull(agendaMinute("2026-02-30", "10:00")); assertNull(agendaMinute(day, "24:00")); assertNull(agendaMinute(day, ""))
    }
    @Test fun identityQuestionsActuallyDiffer() {
        assertNotEquals(audienceQuestions("campus"), audienceQuestions("mentor"))
        assertNotEquals(audienceQuestions("mentor"), audienceQuestions("business"))
        assertEquals(6, audienceQuestions("business").size)
    }
}