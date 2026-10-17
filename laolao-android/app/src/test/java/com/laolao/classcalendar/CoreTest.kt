package com.laolao.classcalendar

import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.Tools
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

    /**
     * 会议、活动这类到点开始的事：说「还有多久开始 / 进行中」，作业还是「还剩 / 过期」（和网页、小程序、电脑版同一套）。
     * 用到本机存储的工具（记账、错题本、日记…）在本机的 JVM 测试里跑，这里只放不依赖手机系统的规则。
     */
    @Test fun events() {
        val I = com.laolao.classcalendar.core.Island
        val now = java.time.LocalDateTime.of(2026, 10, 17, 19, 0)
        fun item(key: String, type: String, day: String, time: String, end: String = "") = com.laolao.classcalendar.core.Island.In(key, key, type, day, time, "", false, false, false, "", end)
        val r = I.rank(listOf(
            item("会", "会议", "2026-10-17", "19:25"),
            item("课", "活动", "2026-10-17", "18:30", "20:00"),
            item("大会", "个人", "2026-10-19", "12:30"),
            item("作业", "作业", "2026-10-18", "08:00"),
            item("早会", "会议", "2026-10-17", "08:00")), emptyList(), now)
        val by = r.associateBy { it.title }
        assertEquals("25 分钟后开始", by["会"]!!.reason)
        assertEquals("now", by["课"]!!.level); assertTrue(by["课"]!!.reason.startsWith("进行中"))
        assertEquals("2 天后开始", by["大会"]!!.reason)
        assertEquals("还剩 13 小时", by["作业"]!!.reason)
        assertEquals("past", by["早会"]!!.level)
        assertEquals("课", r.first().title)        // 正在进行的排最前
    }
}
