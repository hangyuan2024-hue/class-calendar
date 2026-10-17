package com.laolao.classcalendar

import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Memo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** 一句话记事、导入备忘录、周次规则（和网页、小程序同一套） */
class CoreTest {
    private val today = LocalDate.of(2026, 10, 17)   // 周六

    @Test fun quick() {
        val r = Memo.quick("明天下午3点交数学作业 @图书馆", today)
        assertEquals("2026-10-18", r.day); assertEquals("15:00", r.time); assertEquals("图书馆", r.place); assertEquals("交数学作业", r.subject); assertTrue(r.homework)
        val m = Memo.quick("下周三 晚上8点半 社团开会", today)
        assertEquals("2026-10-21", m.day); assertEquals("20:30", m.time); assertEquals("社团开会", m.subject)
        assertEquals("", Memo.quick("买牛奶", today).day)
    }

    @Test fun memo() {
        val r = Memo.parse("周三：\n- 交英语作文\n- 下午3点 社团开会\n\n☑ 已经做完的事\n10.20 体测", today)
        assertEquals(4, r.size)
        assertEquals("2026-10-21", r[0].day); assertEquals("15:00", r[1].time)
        assertTrue(r[2].done)
        assertEquals("2026-10-20", r[3].day)
    }

    @Test fun weeks() {
        assertEquals(16, Courses.parseWeeks("").size)
        assertEquals(setOf(1, 3, 5, 7, 9, 11, 13, 15), Courses.parseWeeks("1-15单"))
        assertEquals(setOf(1, 2, 3, 5, 7, 8), Courses.parseWeeks("1-3,5,7-8"))
        assertEquals("1-7单", Courses.weeksText(listOf(1, 3, 5, 7)))
        assertEquals("1-3,5", Courses.weeksText(listOf(1, 2, 3, 5)))
    }
}
