package com.laolao.classcalendar

import java.util.Calendar
import java.util.TimeZone

/** Keep the selected day when moving months, clamping at month end in every device time zone. */
internal fun calendarShift(date: String, monthly: Boolean, delta: Int): String {
    if (!monthly) return DateMath.plus(date, delta * 7)
    val value =
        Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            time = DateMath.parse(date)
            add(Calendar.MONTH, delta)
        }
    return DateMath.date(
        value.get(Calendar.YEAR),
        value.get(Calendar.MONTH) + 1,
        value.get(Calendar.DAY_OF_MONTH),
    )
}

/** Monday-first rows; out-of-month cells have no date and cannot be selected. */
internal fun calendarRows(year: Int, month: Int): List<List<String?>> {
    val first = DateMath.date(year, month, 1)
    val calendar =
        Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = DateMath.parse(first) }
    val offset = (calendar.get(Calendar.DAY_OF_WEEK) + 5) % 7
    val days = calendar.getActualMaximum(Calendar.DAY_OF_MONTH)
    val cells = ((offset + days + 6) / 7) * 7
    return List(cells) { index ->
            val day = index - offset + 1
            if (day in 1..days) DateMath.date(year, month, day) else null
        }
        .chunked(7)
}
