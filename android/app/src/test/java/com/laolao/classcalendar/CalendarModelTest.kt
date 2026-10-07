package com.laolao.classcalendar

import org.junit.Assert.*
import org.junit.Test

class CalendarModelTest {
    @Test
    fun allMonthsHaveOnlyValidSelectableDates() {
        for (year in 2024..2027) for (month in 1..12) {
            val rows = calendarRows(year, month)
            assertTrue(rows.all { it.size == 7 })
            val dates = rows.flatten().filterNotNull()
            assertEquals(DateMath.date(year, month, 1), dates.first())
            dates.forEach { DateMath.parse(it) }
            assertEquals(dates.size, dates.distinct().size)
            dates.zipWithNext().forEach { (left, right) ->
                assertEquals(DateMath.plus(left, 1), right)
            }
            assertTrue(dates.size in 28..31)
        }
    }

    @Test
    fun februaryRespectsLeapYearsAndLeavesTrailingCellsEmpty() {
        assertEquals(29, calendarRows(2024, 2).flatten().filterNotNull().size)
        val february = calendarRows(2026, 2).flatten()
        assertEquals(28, february.filterNotNull().size)
        assertNull(february.last())
        assertEquals("2026-02-01", february[6]) // Sunday in a Monday-first calendar.
    }
}
