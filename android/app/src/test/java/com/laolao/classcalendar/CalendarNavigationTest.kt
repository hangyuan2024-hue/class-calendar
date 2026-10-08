package com.laolao.classcalendar

import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Test

class CalendarNavigationTest {
    @Test
    fun monthEndKeepsTheNearestValidDay() {
        assertEquals("2024-02-29", calendarShift("2024-01-31", true, 1))
        assertEquals("2026-02-28", calendarShift("2026-03-31", true, -1))
    }

    @Test
    fun yearAndWeekBoundariesRemainSelectable() {
        assertEquals("2027-01-12", calendarShift("2026-12-12", true, 1))
        assertEquals("2026-12-12", calendarShift("2027-01-12", true, -1))
        assertEquals("2027-01-04", calendarShift("2026-12-28", false, 1))
    }

    @Test
    fun monthNavigationIsIndependentOfDeviceTimeZone() {
        val previous = TimeZone.getDefault()
        try {
            for (zone in listOf("Pacific/Kiritimati", "America/Los_Angeles", "Asia/Shanghai")) {
                TimeZone.setDefault(TimeZone.getTimeZone(zone))
                assertEquals("2026-02-01", calendarShift("2026-01-01", true, 1))
            }
        } finally {
            TimeZone.setDefault(previous)
        }
    }
}
