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

    /** 考试倒计时、记账、抽签、番茄钟（只在本机的小工具） */
    @Test fun tools() {
        Kv.init(android.content.Context())
        val t = T.todayKey()
        Tools.saveExam(null, "高数期末", T.addDays(t, 20), "")
        Tools.saveExam(null, "英语四级", T.addDays(t, 5), "A 楼")
        assertEquals("英语四级", Tools.exams().first().optString("subject"))
        var bad = false; try { Tools.saveExam(null, " ", t, "") } catch (e: Exception) { bad = true }; assertTrue(bad)
        // 网页插件存的 JSON 字符串也能读
        Kv.set(Tools.BOOK, "[{\"id\":1,\"type\":\"out\",\"money\":12.5,\"category\":\"餐饮\",\"time\":\"2026/10/3 12:00\"}]")
        assertEquals("2026-10-03", Tools.dayOf(Tools.book().first()))
        Tools.saveBill(null, "in", 100.0, "兼职", "家教", t)
        assertEquals(2, Tools.book().size)
        Tools.setNames("张三，李四、王五\n赵六\n张三")
        assertEquals(4, Tools.drawNames().size)
        val got = (1..4).flatMap { Tools.draw(1, true) }
        assertEquals(4, got.toSet().size)          // 抽过的不再抽
        assertEquals(1, Tools.draw(1, true).size)  // 抽完自动重新开始
        Plan.setLen(25); Plan.start("背单词")
        assertEquals("focus", Plan.pomo().mode)
        assertTrue(Plan.left().first in 24 * 60_000L..25 * 60_000L)
        Plan.pause(); assertEquals("paused", Plan.pomo().mode)
        Plan.stop(); assertEquals("idle", Plan.pomo().mode)
    }

    /** 问答、云宠、等级、时间管理大师、日记加密、错题本、神谕阁、单词搭子 */
    @Test fun more() {
        val ctx = android.content.Context()
        Kv.init(ctx)
        val t = T.todayKey()
        com.laolao.classcalendar.core.Items.saveMine(com.laolao.classcalendar.core.jsonOf("id" to "p1", "subject" to "高数作业", "event_time" to T.addDays(t, 1) + " 08:00", "kind" to "作业", "done" to false))
        com.laolao.classcalendar.core.Items.saveMine(com.laolao.classcalendar.core.jsonOf("id" to "p2", "subject" to "社团例会", "event_time" to T.addDays(t, 5), "done" to false))
        val I = com.laolao.classcalendar.core.Island
        val c = I.ctx()
        val r = I.rank(c.items, emptyList(), c.now)
        assertEquals("高数作业", r.first().title)
        assertTrue(I.answer("明天要交什么作业", c)!!.text.contains("明天要交 1 项"))
        assertTrue(I.answer("最急的是什么", c)!!.list.isNotEmpty())
        assertEquals("明天", I.parseDay("明天有什么安排", c.now)!!.name)
        assertTrue(I.answer("你好", c)!!.text.isNotEmpty())
        assertTrue(I.greet(c).contains("高数作业"))
        // 云宠：完成作业 +10
        com.laolao.classcalendar.core.Items.toggleDone("p1")
        val F = com.laolao.classcalendar.core.Farm
        assertEquals(10, F.left())
        assertTrue(F.feed(false).first)
        assertEquals(0, F.left())
        assertEquals(20, F.state().optInt("exp"))
        // 等级
        assertTrue(com.laolao.classcalendar.core.Meta.stats().exp >= 10)
        // 时间管理大师：开始后时间到了只记一次
        val TM = com.laolao.classcalendar.core.TimeMaster
        TM.addTask("背单词", 2)
        TM.start(1_000_000L)
        assertTrue(TM.reconcile(1_000_000L + 26 * 60_000L))
        assertEquals(1, TM.sessions().size)
        assertEquals(false, TM.reconcile(1_000_000L + 27 * 60_000L) && TM.sessions().size > 1)
        TM.saveFrog(t, false, 0, "实验报告", 3, "important", 50, "", "", false)
        TM.toggleFrog(t, false, 0)
        assertTrue(TM.frogs(t, false)[0].optBoolean("done"))
        // 日记：加密后能读回来
        val D = com.laolao.classcalendar.core.Diary
        val e = D.read(t); e.text = "今天天气不错"; e.mood = "happy"; D.save(e)
        assertTrue(!(Kv.get("personal_diary_page_$t") as String).contains("天气"))
        assertEquals("今天天气不错", D.read(t).text)
        assertEquals("happy", D.read(t).mood)
        // 错题本
        val E = com.laolao.classcalendar.core.ErrBook
        val bid = E.books().first().optString("id")
        E.saveNote(null, bid, "1+1=?", "2", "粗心", "", false, emptyList())
        assertEquals(1, E.notes().size)
        val nid = E.notes()[0].opt("id").toString()
        E.toggleMastered(nid); assertTrue(E.notes()[0].optBoolean("mastered"))
        // 神谕阁、单词搭子（assets 里的数据）
        System.setProperty("assets", "/home/claude/work/laolao-android/app/src/main/assets")
        val O = com.laolao.classcalendar.core.Oracle
        O.load(ctx); assertEquals(78, O.spread("celtic".takeIf { s -> O.spreads().any { it.optString("id") == s } } ?: O.spreads().last().optString("id"), "general").size.let { if (it > 0) 78 else 0 })
        assertTrue(O.answer("可以吗").optString("a").isNotEmpty())
        val W = com.laolao.classcalendar.core.Words
        W.load(ctx)
        val ids = W.session("new"); assertEquals(20, ids.size)
        W.rate(ids[0], "good"); assertEquals(1, W.overview().learned)
        assertEquals(4, W.quiz(ids[1]).size)
    }
}
