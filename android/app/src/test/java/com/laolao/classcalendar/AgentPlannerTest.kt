package com.laolao.classcalendar

import org.junit.Assert.*
import org.junit.Test

class AgentPlannerTest {
    @Test
    fun suggestionsAvoidCoursesAndOverlappingAppointments() {
        val busy = listOf(BusyInterval(540, 590), BusyInterval(570, 630), BusyInterval(660, 690))
        val plan =
            AgentPlanner.plan(
                555,
                busy,
                listOf(StudyTarget("A"), StudyTarget("B"), StudyTarget("C")),
            )
        assertEquals(3, plan.size)
        plan.forEach { block ->
            assertTrue(busy.none { block.start < it.end && block.end > it.start })
        }
        assertTrue(plan.first().start >= 630)
        plan.zipWithNext().forEach { (a, b) -> assertTrue(b.start >= a.end + 5) }
    }

    @Test
    fun suggestionsNeverPromiseAStudyBlockAfterDeadline() {
        val plan =
            AgentPlanner.plan(
                600,
                emptyList(),
                listOf(StudyTarget("Too late", 620), StudyTarget("Fits", 660)),
            )
        assertEquals(listOf("Fits"), plan.map { it.title })
        assertTrue(plan.single().end <= 660)
    }

    @Test
    fun lateNightAndFullScheduleProduceNoInventedFreeTime() {
        assertTrue(AgentPlanner.plan(1310, emptyList(), listOf(StudyTarget("A"))).isEmpty())
        assertTrue(
            AgentPlanner.plan(480, listOf(BusyInterval(480, 1320)), listOf(StudyTarget("A")))
                .isEmpty()
        )
    }

    @Test
    fun inputTimesAreValidatedAndBlocksAreLimited() {
        assertNull(AgentPlanner.minute("25:01"))
        assertNull(AgentPlanner.minute("12:60"))
        assertNull(AgentPlanner.minute("pending"))
        assertEquals(754, AgentPlanner.minute("12:34"))
        assertEquals(
            3,
            AgentPlanner.plan(481, emptyList(), List(10) { StudyTarget("Task $it") }).size,
        )
        assertEquals("09:05", AgentPlanner.clock(545))
    }
}
