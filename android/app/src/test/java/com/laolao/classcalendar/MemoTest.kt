package com.laolao.classcalendar

import com.laolao.classcalendar.model.AgendaModel
import com.laolao.classcalendar.model.Kind
import com.laolao.classcalendar.model.Memo
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

class MemoTest {
    private val today = LocalDate.of(2026, 10, 14) // 周三

    @Test fun quickParsesDateTimePlace() {
        val r = Memo.quick("明天下午3点交实验报告 @B302", today)!!
        assertEquals(LocalDate.of(2026, 10, 15), r.date)
        assertEquals("15:00", r.time)
        assertEquals("B302", r.place)
        assertTrue(r.homework)
        assertTrue(r.subject.contains("实验报告"))
    }

    @Test fun quickPlainText() {
        val r = Memo.quick("买牛奶", today)!!
        assertNull(r.date)
        assertEquals("买牛奶", r.subject)
        assertFalse(r.homework)
        assertNull(Memo.quick("   ", today))
    }

    @Test fun parseContextDayAndChecks() {
        val rows = Memo.parse("周五\n☐ 交高数作业\n☑ 买实验服\n\n10月20日 14:30 班会", today)
        assertEquals(3, rows.size)
        assertEquals(LocalDate.of(2026, 10, 16), rows[0].date)
        assertTrue(rows[0].homework)
        assertFalse(rows[0].done)
        assertTrue(rows[1].done)
        assertEquals(LocalDate.of(2026, 10, 16), rows[1].date)
        assertEquals(LocalDate.of(2026, 10, 20), rows[2].date)
        assertEquals("14:30", rows[2].time)
        assertEquals("班会", rows[2].subject)
    }

    @Test fun chineseNumbers() {
        assertEquals(12, Memo.cnNum("十二"))
        assertEquals(20, Memo.cnNum("二十"))
        assertEquals("20:30", Memo.findTime("晚上八点半")?.first)
    }

    @Test fun classHomeworkUsesMarks() {
        val e = JSONObject().put("id", 7).put("subject", "习题3").put("msg_type", "作业").put("event_time", "2026-10-15 08:00")
        val marks = JSONObject().put("c7", JSONObject().put("done", true))
        val a = AgendaModel.toItem(e, marks, Kind.CLASS)!!
        assertEquals("c7", a.id)
        assertEquals("7", a.serverId)
        assertTrue(a.isHomework)
        assertTrue(a.done)
        val hidden = JSONObject().put("c7", JSONObject().put("hidden", true))
        assertNull(AgendaModel.toItem(e, hidden, Kind.CLASS))
        val undated = JSONObject().put("id", "p1").put("subject", "读书").put("event_time", "")
        assertEquals(LocalDate.MAX, AgendaModel.toItem(undated, JSONObject(), Kind.EVENT, LocalDate.MAX)!!.date)
        assertNull(AgendaModel.toItem(undated, JSONObject(), Kind.EVENT))
    }
}
