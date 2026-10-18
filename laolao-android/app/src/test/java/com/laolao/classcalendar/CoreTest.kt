package com.laolao.classcalendar

import com.laolao.classcalendar.core.Coach
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Flow
import com.laolao.classcalendar.core.Island
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.Tools
import com.laolao.classcalendar.core.Memo
import com.laolao.classcalendar.core.MemoCore
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

    /** 捞捞教练：和网页 coach-core.js 的 test/coach.test.js 同样的例子 */
    private fun near(a: Double, b: Double) { if (Math.abs(a - b) >= 1e-9) throw AssertionError("$a ≠ $b") }
    @Test fun coach() {
        val C = Coach
        val bj = com.laolao.classcalendar.core.T.BJ
        fun at(d: Int, h: Int, m: Int = 0) = java.time.LocalDateTime.of(2026, 10, d, h, m).atZone(bj).toInstant().toEpochMilli()
        val now = at(17, 19)
        fun ev(t: Long, e: String, k: String = "", y: String = "", d: Long = 0, m: Int = 0) = Coach.Ev(t, e, k, y, d, m)
        val c0 = at(17, 12)
        val log = listOf(ev(at(17, 10), "done", "a", "作业", at(17, 22)), ev(at(17, 11), "done", "b", "作业"), ev(at(17, 11, 5), "undo", "b"),
            ev(c0, "done", "c1"), ev(c0 + 10_000, "done", "c2"), ev(c0 + 20_000, "done", "c3"), ev(c0 + 30_000, "done", "c4"), ev(c0 + 40_000, "done", "c5"),
            ev(at(17, 14), "pomo", m = 25), ev(at(17, 15), "done", "old", d = at(5, 12)))
        val cr = C.credible(log); fun w(k: String) = cr.first { it.k == k }.w
        assertEquals(listOf(1.0, 0.0, 1.0, 1.0, 0.3, 0.3, 0.3, 0.5), listOf("a", "b", "c1", "c2", "c3", "c4", "c5", "old").map { w(it) })
        val m = C.learn(log, now)
        near(5.4, m.day["2026-10-17"]!!); assertTrue(m.sus >= 4); assertEquals(listOf(12.0), m.lead)
        // 连续天数、小目标
        val day = HashMap<String, Double>(); listOf(2.0, 3.0, 4.0, 3.0, 5.0, 2.0).forEachIndexed { i, v -> day["2026-10-" + (16 - i).toString().padStart(2, '0')] = v }
        val m2 = C.combine(listOf(Coach.Model(day = day, n = 19.0)))
        val st = C.streak(m2, now); assertEquals(6, st.days); assertTrue(st.atRisk)
        val g = C.goal(m2, now); near(3.0, g.cap); assertEquals(4, g.target)
        // 推荐
        fun row(kind: String, key: String, title: String, type: String, level: String, score: Double, reason: String) = Island.Row(kind, key, title, type, "2026-10-17", "", "", level, false, score, "", reason)
        val ranked = listOf(row("item", "hw", "高数作业", "作业", "urgent", 60.0, "还剩 3 小时"), row("item", "words", "背单词", "个人", "soon", 30.0, "还剩 2 天"),
            row("item", "meet", "班会", "会议", "soon", 80.0, "2 天后开始"),
            Island.Row("item", "conf", "26年换届暨总结表彰大会", "个人", "2026-10-19", "12:30", "中快三楼", "soon", false, 90.0, "", "1 天后开始"))
        val e = C.combine(emptyList())
        val s = C.suggest(ranked, e, emptyList(), now, rnd = 0.9); assertEquals("go", s.mode); assertEquals("hw", s.top!!.key); assertTrue(s.top!!.step.contains("番茄"))
        assertEquals("words", C.suggest(ranked, e, emptyList(), now, mapOf("hw" to now + 3_600_000), 0.9).top!!.key)
        assertTrue(s.alts.none { it.key == "meet" || it.key == "conf" })
        assertEquals("free", C.suggest(ranked.drop(2), e, emptyList(), now, rnd = 0.9).mode)
        assertEquals("sleep", C.suggest(listOf(ranked[1]), e, emptyList(), at(17, 23, 30), rnd = 0.9).mode)
        assertEquals("rest", C.suggest(listOf(ranked[1]), e, listOf(ev(now - 3_000_000, "pomo", m = 50), ev(now - 1_500_000, "pomo", m = 25)), now, rnd = 0.9).mode)
        assertEquals("class", C.suggest(listOf(row("course", "c", "线代", "课程", "now", 96.0, "正在上课")) + ranked, e, emptyList(), now, rnd = 0.9).mode)
        // 提示风格
        val m3 = Coach.Model(sty = hashMapOf("step" to intArrayOf(10, 1), "deadline" to intArrayOf(10, 8)))
        assertEquals("deadline", C.pickStyle(m3, listOf("step", "deadline"), 0.9))
        // 提醒时间
        val h = DoubleArray(24); h[15] = 10.0; h[20] = 8.0
        val m4 = C.combine(listOf(Coach.Model(h = h, day = hashMapOf("2026-10-16" to 3.0, "2026-10-15" to 3.0), n = 21.0)))
        val ns = C.nudges(listOf(row("item", "a", "英语作文", "作业", "soon", 20.0, "")), emptyList(), m4, at(18, 9))
        assertEquals(listOf("best", "weekly"), ns.map { it.kind })
        assertEquals(15, java.time.LocalDateTime.ofInstant(java.time.Instant.ofEpochMilli(ns[0].at), bj).hour)
        // 每周复盘
        val m5 = C.combine(listOf(Coach.Model(day = hashMapOf("2026-10-12" to 2.0, "2026-10-13" to 3.0, "2026-10-14" to 4.0, "2026-10-15" to 2.0, "2026-10-16" to 3.0, "2026-10-05" to 1.0, "2026-10-06" to 2.0),
            lead = mutableListOf(1.0, 2.0, 1.0), sus = 5, n = 17.0)))
        val r = C.weekly(m5, now)
        near(14.0, r.thisWeek.done); near(3.0, r.lastWeek.done); assertEquals(5, r.thisWeek.days)
        assertTrue(r.highlights[0].contains("多完成了 11 件")); assertTrue(r.next.any { it.contains("提前一天") }); assertTrue(r.next.any { it.contains("一口气") })
    }

    // 刷任务、随机掉落：和 test/coach.test.js 同样的例子
    @Test fun flow() {
        val bj = com.laolao.classcalendar.core.T.BJ
        val now = java.time.LocalDateTime.of(2026, 10, 17, 19, 0).atZone(bj).toInstant().toEpochMilli()
        fun row(key: String, title: String, type: String, level: String, score: Double, exam: Boolean = false) = Island.Row("item", key, title, type, "2026-10-17", "", "", level, exam, score, "", "")
        val ranked = listOf(row("a", "数学作业", "作业", "soon", 90.0), row("b", "英语单词", "个人", "later", 50.0), row("c", "物理小测", "个人", "later", 40.0, true), row("z", "过期的", "", "past", 99.0))
        val d = Flow.deck(ranked, now, mapOf("b" to now + 1000))
        assertEquals("start2a,work5a,work10a,checka,start2c,work5c,work10c,checkc,break3,start2review,review5review,review10review,end",
            d.cards.joinToString(",") { it.kind + (if (it.min > 0) it.min.toString() else "") + it.key })
        assertEquals(51, d.work); assertTrue(d.cards[0].step.contains("第一题")); assertTrue(d.cards[4].step.contains("3 个重点"))
        assertEquals("sleep", Flow.deck(ranked, now + 4 * 3_600_000 + 1_800_000, emptyMap()).end)
        assertEquals("class", Flow.deck(listOf(Island.Row("course", "k", "语文", "课程", "", "", "", "now", false, 96.0, "", "")), now).end)
        assertEquals(120_000L, Flow.awayCredit(300_000, 120_000)); assertEquals(-1L, Flow.awayCredit(31 * 60_000L, 120_000))
        val cr = Coach.credible(listOf(Coach.Ev(now, "flow", m = 5), Coach.Ev(now + 1, "flow", m = 1)))
        near(0.2, cr[0].w); near(0.0, cr[1].w)
        fun seq(vararg xs: Double): () -> Double { var i = 0; return { xs[i++ % xs.size] } }
        var r = Flow.roll(Flow.bag(null, now), 2, seq(0.99, 0.5, 0.0))
        assertEquals("star", r.got!!.id); assertTrue(r.first); assertEquals(1, r.bag.dn)
        r = Flow.roll(r.bag, 5, seq(0.5)); assertEquals(null, r.got)
        r = Flow.roll(r.bag, 10, seq(0.1, 0.5, 0.0)); assertTrue(r.dup); assertEquals(1, r.bag.sh); assertEquals(2, r.bag.own["star"])
        r = Flow.roll(r.bag, 10, seq(0.1, 0.01, 0.99)); assertEquals(3, r.got!!.r); assertEquals(0, r.bag.pity)
        r.bag.pity = 7; r = Flow.roll(r.bag, 10, seq(0.1, 0.9, 0.0)); assertEquals(1, r.got!!.r)
        val full = Flow.bag(org.json.JSONObject().put("v", 1).put("day", "2026-10-17").put("dn", 10), now)
        assertTrue(Flow.roll(full, 10, seq(0.0)).cap)
        assertEquals(0, Flow.bag(org.json.JSONObject().put("v", 1).put("day", "2026-10-16").put("dn", 10), now).dn)
        assertEquals(null, Flow.roll(Flow.bag(null, now), 1, seq(0.0)).got)
        val b = Flow.Bag(sh = 12); assertTrue(Flow.redeem(b, "fox")); assertEquals(2, b.sh); assertTrue(!Flow.redeem(b, "crown"))
        val mg = Flow.mergeBag(Flow.Bag(own = hashMapOf("star" to 1), sh = 3), listOf(org.json.JSONObject().put("own", org.json.JSONObject().put("star", 4).put("fox", 1))))
        assertEquals(listOf(4, 1, 3, 2), listOf(mg.own["star"], mg.own["fox"], mg.sh, mg.owned()))
        assertEquals(34, Flow.LOOT.size)
        assertEquals("班里现在 7 人在专注 · 今天全班 230 分钟 · 班级连续 3 天", Flow.roomLine(7, 230, 3))
    }

    /** 6.2 备忘录：和网页 test/memo.test.js 同样的例子 */
    @Test fun memoCore() {
        val M = MemoCore
        assertEquals("2026-10-17", M.nextDay("2026-10-16", "day"))
        assertEquals("2026-10-19", M.nextDay("2026-10-16", "weekday"))
        assertEquals("2026-10-23", M.nextDay("2026-10-16", "week"))
        assertEquals("2026-02-28", M.nextDay("2026-01-31", "month"))
        assertEquals("2029-02-28", M.nextDay("2028-02-29", "year"))
        val r = org.json.JSONObject().put("event_time", "2026-10-12 07:30").put("rep", "day").put("reps", 2)
            .put("list", org.json.JSONArray().put(org.json.JSONObject().put("t", "A").put("d", true)))
        val p = M.complete(r, "2026-10-18")!!
        assertEquals("2026-10-19 07:30", p.getString("event_time")); assertEquals(3, p.getInt("reps")); assertEquals(false, p.getJSONArray("list").getJSONObject(0).getBoolean("d"))
        assertEquals("2026-11-01", M.complete(org.json.JSONObject().put("event_time", "2026-10-25").put("rep", "week"), "2026-10-18")!!.getString("event_time"))
        assertEquals(null, M.complete(org.json.JSONObject().put("event_time", "").put("rep", "day"), "2026-10-18"))
        val l = M.listFromText("□ 牛奶\n✓ 面包\n- 鸡蛋\n\n[x] 苹果\n1. 香蕉", listOf(MemoCore.Li("鸡蛋", true)))
        assertEquals(listOf("牛奶" to false, "面包" to true, "鸡蛋" to true, "苹果" to true, "香蕉" to false), l.map { it.t to it.d })
        assertEquals("3/5", M.statText(l))
        assertTrue(M.looksLikeList("□ a\n□ b\n□ c")); assertTrue(!M.looksLikeList("今天去开会\n记得带电脑"))
        assertTrue(M.match("社团例会 带电脑和充电器 A201 打印签到表", "签到 a201")); assertTrue(!M.match("社团例会", "例会 体育馆"))
    }
}
