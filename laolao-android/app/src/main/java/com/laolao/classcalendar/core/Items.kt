package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject

/** 一条事项：班级事项 / 我的事项 / 课程表里的一节课 */
class Item(
    val key: String, val id: String, val type: String, val title: String, val summary: String,
    val day: String, val time: String, val location: String, val prepare: String, val original: String,
    val note: String, val done: Boolean, val hidden: Boolean, val mine: Boolean, val course: Boolean,
    val color: Int = 0, val needConfirm: Boolean = false, val local: Boolean = false, val endTime: String = "",
    // 6.2 备忘录：清单、重复、置顶；full = 班级事项的完整内容（改成「我自己的版本」时带进备注）
    val list: List<MemoCore.Li> = emptyList(), val rep: String = "", val reps: Int = 0, val pin: Boolean = false, val full: String = "",
) {
    val hw: Boolean get() = type == "作业"
    val dated: Boolean get() = day.isNotEmpty()
    /** 截止 / 开始的真实时刻（没时间的按当天 23:59） */
    fun at(): Long = if (day.isEmpty()) Long.MAX_VALUE else T.epoch(day, T.min(time) ?: (23 * 60 + 59))
    val sub: String get() = when {
        course -> summary
        title != summary && summary.isNotBlank() -> summary
        location.isNotBlank() -> "📍 $location"
        else -> ""
    }
}

/** 一天的安排 */
class Day(val key: String, val label: String, val sub: String, val items: List<Item>)

object Items {
    const val MINE = "personal_events_v1"
    const val MARK = "personal_marks_v1"
    const val DONE_LOG = "done_log_v1"
    val TYPES = listOf("作业", "会议", "活动", "通知")
    private val EXAM = Regex("考试|测验|测试|小测|期中|期末|月考|考核|答辩")

    fun mine(): List<JSONObject> = Kv.arr(MINE).objs()
    fun marks(): JSONObject = Kv.obj(MARK)

    // 6.2 内容完整：摘要被写成「……按指定...」而原文还在，就显示完整原文（和网页、小程序、电脑版同一条规则）
    private val CUT_RE = Regex("(\\.{3,}|…+)\\s*$")
    private fun origOf(r: JSONObject): String { val o = r.str("original"); return if (o.isNotEmpty() && !o.startsWith("（由")) o else "" }
    fun fullText(r: JSONObject): String { val s = r.str("summary"); val o = origOf(r); return if (o.isNotEmpty() && (s.isEmpty() || CUT_RE.containsMatchIn(s))) o else s }
    fun fullNote(r: JSONObject): String = listOf(if (r.str("subject").isNotEmpty() && fullText(r).isNotEmpty()) fullText(r) else origOf(r),
        if (r.str("prepare").isNotEmpty()) "要准备：" + r.str("prepare") else "").filter { it.isNotEmpty() }.joinToString("\n")
    private fun fromClass(r: JSONObject, mk: JSONObject): Item {
        val key = "c" + r.opt("id")
        val m = mk.optJSONObject(key) ?: JSONObject()
        val w = When.of(r.str("event_time"))
        val subject = r.str("subject"); val summary = fullText(r)
        return Item(key, r.opt("id").toString(), r.str("msg_type").ifBlank { "通知" }, subject.ifBlank { summary.ifBlank { r.str("msg_type") } }, summary,
            w?.day ?: "", w?.time ?: "", r.str("location"), r.str("prepare"), r.str("original"), m.str("note"),
            m.optBoolean("done"), m.optBoolean("hidden"), false, false, needConfirm = r.optBoolean("need_confirm"), full = fullNote(r))
    }
    private fun fromMine(r: JSONObject, cls: Map<String, JSONObject> = emptyMap()): Item {
        val w = When.of(r.str("event_time"))
        val src = cls[r.str("from")]
        val note = if (src != null && CUT_RE.containsMatchIn(r.str("note"))) fullNote(src) else r.str("note")
        return Item(r.str("id"), r.str("id"), if (r.str("kind") == "作业") "作业" else "个人", r.str("subject").ifBlank { "（没写标题）" }, "",
            w?.day ?: "", w?.time ?: "", r.str("location"), "", "", note, r.optBoolean("done"), false, true, false, local = r.optBoolean("local"),
            list = MemoCore.listOf(r), rep = MemoCore.repName(r.str("rep")).let { if (it.isEmpty()) "" else r.str("rep") }, reps = r.optInt("reps", 0), pin = r.optBoolean("pin"))
    }
    fun lessonsAsItems(a: String, b: String): List<Item> {
        val hasC = Store.feat("courses") && Courses.has()
        val evOn = (Kv.get("evening_v1") as? JSONObject)?.optBoolean("on") == true
        val moOn = (Kv.get("morning_v1") as? JSONObject)?.optBoolean("on") == true   // 6.5 早自习
        if (!hasC && !evOn && !moOn) return emptyList()
        val out = mutableListOf<Item>()
        val adj = try { Courses.adjList() } catch (_: Exception) { emptyList() }
        var k = a; var guard = 0
        while (k <= b && guard++ < 400) {
            // 6.3 晚自习：和课一样显示在「接下来的安排」和日历里，跟着调课 / 调休走
            if (moOn) for (e in Island.morning(k, adj = adj)) out += Item("mor_$k", "", "课程", "🌅 " + e.name, "${e.t0}-${e.t1}" + (if (e.study) " · 自习时间" else "") + (if (e.location.isNotEmpty()) " · ${e.location}" else ""),
                k, e.t0, e.location, "", "", "", false, false, false, true, 0xFFF08A24.toInt(), endTime = e.t1)
            if (evOn) for (e in Island.evening(k, adj = adj)) out += Item("eve_$k", "", "课程", "🌙 " + e.name, "${e.t0}-${e.t1}" + (if (e.study) " · 写作业时间" else "") + (if (e.location.isNotEmpty()) " · ${e.location}" else ""),
                k, e.t0, e.location, "", "", "", false, false, false, true, 0xFF7C5CFF.toInt(), endTime = e.t1)
            if (hasC) for (c in Courses.on(k)) out += Item("crs_${c.name}_${c.start}_$k", "", "课程", c.name + if (c.add) "（加课）" else if (c.from.isNotEmpty()) "（调课）" else "",
                "第${c.start}-${c.end}节" + (if (c.t0.isNotEmpty()) " ${c.t0}-${c.t1}" else "") + (if (c.location.isNotEmpty()) " · ${c.location}" else ""),
                k, c.t0, c.location, "", "", "", false, false, false, true, Courses.color(c.name), endTime = c.t1)
            k = T.addDays(k, 1)
        }
        return out
    }

    /** 全部事项（班级 + 我的），可选带上一段日期里的课 */
    fun all(showHidden: Boolean = false, courses: Pair<String, String>? = null): List<Item> {
        val mk = marks()
        val cls = Store.items.associateBy { "c" + it.opt("id") }
        var list = Store.items.map { fromClass(it, mk) } + mine().map { fromMine(it, cls) }
        if (!showHidden) list = list.filter { !it.hidden }
        if (courses != null) list = list + lessonsAsItems(courses.first, courses.second)
        return list
    }
    private val byTime = Comparator<Item> { a, b ->
        when { a.time.isEmpty() && b.time.isNotEmpty() -> -1; a.time.isNotEmpty() && b.time.isEmpty() -> 1; else -> a.time.compareTo(b.time) }
    }
    fun byDay(list: List<Item>): Map<String, List<Item>> = list.filter { it.dated }.groupBy { it.day }.mapValues { (_, v) -> v.sortedWith(byTime) }

    fun find(key: String): Item? = all(showHidden = true).firstOrNull { it.key == key }
    fun hideDone(): Boolean = Kv.bool("app_hide_done", false)

    // ---------- 首页：今天起两周 ----------
    class Agenda(val overdue: List<Item>, val days: List<Day>, val undatedMine: List<Item>, val undatedCls: List<Item>,
                 val todayCount: Int, val hwLeft: Int, val say: String, val doneCount: Int, val pins: List<Item> = emptyList())
    fun agenda(): Agenda {
        val t0 = T.todayKey()
        val list = all(courses = t0 to T.addDays(t0, 13))
        val hide = hideDone()
        val by = byDay(list.filter { !(hide && it.done) })
        val overdue = mutableListOf<Item>()
        for (i in -7..-1) for (r in by[T.addDays(t0, i.toLong())] ?: emptyList()) if (r.hw && !r.done) overdue += r
        val days = mutableListOf<Day>()
        var hw = 0; var todayCount = 0
        for (i in 0 until 14) {
            val k = T.addDays(t0, i.toLong()); val items = by[k] ?: emptyList()
            val pending = items.filter { !it.done && !it.course }
            hw += pending.count { it.hw }
            if (i == 0) todayCount = pending.size + items.count { it.course }
            if (items.isEmpty() && i != 0) continue
            val d = T.date(k)!!
            val label = when (i) { 0 -> "今天"; 1 -> "明天"; 2 -> "后天"; else -> T.dayName(k) }
            days += Day(k, label, T.md(d) + " " + T.wk(d) + if (pending.isNotEmpty()) " · ${pending.size} 项" else "", items)
        }
        val undated = list.filter { !it.dated && !(hide && it.done) }
        val todayHw = (by[t0] ?: emptyList()).count { it.hw && !it.done }
        val say = when {
            overdue.isNotEmpty() -> "有 ${overdue.size} 项作业已经过期了，快去看看！"
            todayHw > 0 -> "今天有 $todayHw 项作业要交，别忘啦～"
            todayCount > 0 -> "今天有 $todayCount 件事，一件件来"
            else -> "今天没有要交的作业，喘口气吧～"
        }
        return Agenda(overdue, days, undated.filter { it.mine }, undated.filter { !it.mine }, todayCount, hw + overdue.size, say, list.count { it.done && !it.course },
            list.filter { it.mine && it.pin && !it.done })
    }

    // ---------- 作业页 ----------
    class Week(val title: String, val range: String, val todo: List<Item>, val done: List<Item>, val overdue: List<Item>, val undated: List<Item>)
    fun weekStart(offset: Int): String { val d = T.today(); return T.key(d.minusDays((d.dayOfWeek.value - 1).toLong()).plusWeeks(offset.toLong())) }
    fun homework(offset: Int): Week {
        val hw = all().filter { it.hw }
        val a = weekStart(offset); val b = T.addDays(a, 6)
        val byDue = compareBy<Item>({ it.day }, { it.time.ifEmpty { "99" } })
        val week = hw.filter { it.dated && it.day >= a && it.day <= b }.sortedWith(byDue)
        val overdue = if (offset == 0) hw.filter { it.dated && !it.done && it.day < a && T.dayDiff(it.day) >= -30 }.sortedWith(byDue) else emptyList()
        val title = when (offset) { 0 -> "本周作业"; 1 -> "下周作业"; -1 -> "上周作业"; else -> T.md(a) + "这周" }
        return Week(title, T.md(a) + " – " + T.md(b), week.filter { !it.done }, week.filter { it.done }, overdue, if (offset == 0) hw.filter { !it.dated } else emptyList())
    }
    /**
     * 作业页：所有没做完的作业按截止时间分组（不再按周切开，下周要交的也一眼看得到）
     * 已过期 / 今天 / 明天 / 这周 / 下周 / 以后 / 时间待定；已完成的单独一组（最近 30 天）
     */
    class Group(val key: String, val title: String, val sub: String, val items: List<Item>)
    class HwAll(val groups: List<Group>, val done: List<Item>, val left: Int, val weekDone: Int, val weekTotal: Int)
    fun homeworkAll(): HwAll {
        val hw = all().filter { it.hw }
        val t = T.todayKey(); val tm = T.addDays(t, 1)
        val sun = T.addDays(weekStart(0), 6); val nextSun = T.addDays(sun, 7)
        val byDue = compareBy<Item>({ it.day }, { it.time.ifEmpty { "99" } })
        val todo = hw.filter { !it.done && (!it.dated || T.dayDiff(it.day) >= -30) }
        fun g(key: String, title: String, sub: String, f: (Item) -> Boolean): Group? {
            val l = todo.filter { it.dated && f(it) }.sortedWith(byDue); return if (l.isEmpty()) null else Group(key, title, sub, l)
        }
        val groups = listOfNotNull(
            g("late", "已过期", "还没做完的") { it.day < t || (it.day == t && it.time.isNotEmpty() && it.at() < System.currentTimeMillis()) },
            g("today", "今天截止", T.md(t) + " " + T.wk(t)) { it.day == t && !(it.time.isNotEmpty() && it.at() < System.currentTimeMillis()) },
            g("tomorrow", "明天截止", T.md(tm) + " " + T.wk(tm)) { it.day == tm },
            g("week", "这周", "到 " + T.md(sun) + " 周日") { it.day > tm && it.day <= sun },
            g("next", "下周", T.md(T.addDays(sun, 1)) + " – " + T.md(nextSun)) { it.day > sun && it.day <= nextSun },
            g("later", "以后", "下周之后") { it.day > nextSun },
        ) + listOfNotNull(todo.filter { !it.dated }.takeIf { it.isNotEmpty() }?.let { Group("undated", "时间待定", "去群里核实一下截止时间", it) })
        val log = Kv.obj(DONE_LOG)
        val done = hw.filter { it.done && (!it.dated || T.dayDiff(it.day) >= -30) }
            .sortedByDescending { log.optString(it.key).ifEmpty { it.day } }
        val a = weekStart(0)
        val week = hw.filter { it.dated && it.day >= a && it.day <= sun }
        return HwAll(groups, done, todo.size, week.count { it.done }, week.size)
    }

    /** 「今天截止」「还剩 3 天」「已过期 2 天」 */
    fun due(r: Item): Pair<String, Int> {
        if (!r.dated) return "时间待定" to 0
        if (r.done) return "已完成" to 0
        val n = T.dayDiff(r.day)
        return when { n < 0 -> "已过期 ${-n} 天" to 3; n == 0L -> "今天截止" to 2; n == 1L -> "明天截止" to 1; else -> "还剩 $n 天" to (if (n <= 3) 1 else 0) }
    }
    /**
     * 会议、活动、通知、我的事项这类「到点开始」的事：还有多久开始（作业是截止，不走这里）。
     * 返回 文字 to 紧急程度（3 进行中、2 一小时内、1 今天 / 明天、0 更远），不适用返回 null
     */
    fun startIn(r: Item, nowMs: Long = System.currentTimeMillis()): Pair<String, Int>? {
        if (r.hw || r.course || r.done || !r.dated || r.time.isEmpty()) return null
        if (Island.isDue(r.type, r.title + " " + r.summary + " " + r.original)) return null   // 6.3 「X 点之前完成」：是截止，不是开始
        val st = r.at(); val end = T.min(r.endTime)?.let { T.epoch(r.day, it) }?.takeIf { it > st } ?: (st + 3_600_000L)
        if (nowMs >= end) return null
        if (nowMs >= st) return "进行中" to 3
        val m = Math.ceil((st - nowMs) / 60000.0).toLong()
        val dd = T.dayDiff(r.day)
        return when {
            m < 60 -> "$m 分钟后开始" to 2
            dd == 0L -> T.left(st - nowMs).removeSuffix("后") + "后开始" to 1
            dd == 1L -> "明天 ${r.time} 开始" to 1
            dd == 2L -> "后天 ${r.time} 开始" to 0
            else -> "$dd 天后开始" to 0
        }
    }
    /**
     * 一件事现在的状态（首页「接下来的安排」、日历的每一行）：
     * 已完成 / 已上完 / 已结束（-1，变淡）、上课中 / 进行中（3）、一小时内开始（2）、今天 / 明天（1）、更远（0）；作业不在这里（看截止）
     */
    fun state(r: Item, nowMs: Long = System.currentTimeMillis()): Pair<String, Int>? {
        if (r.done && !r.course) return "已完成" to -1
        if (!r.dated || r.time.isEmpty() || r.hw) return null
        if (!r.course && Island.isDue(r.type, r.title + " " + r.summary + " " + r.original)) return null
        val st = r.at()
        val end = T.min(r.endTime)?.let { T.epoch(r.day, it) }?.takeIf { it > st } ?: (st + (if (r.course) 45 else 60) * 60_000L)
        if (nowMs >= end) return (if (r.course) "已上完" else "已结束") to -1
        if (r.course) {
            if (nowMs >= st) return "上课中" to 3
            val m = Math.ceil((st - nowMs) / 60000.0).toLong()
            return if (T.dayDiff(r.day) == 0L && m <= 180) (if (m < 60) "$m 分钟后上课" else T.left(st - nowMs).removeSuffix("后") + "后上课") to (if (m < 60) 2 else 1) else null
        }
        return startIn(r, nowMs)
    }
    /** 还没做完、也还没过去的事（「接下来」从这里开始） */
    fun pending(r: Item, nowMs: Long = System.currentTimeMillis()): Boolean = !r.done && (state(r, nowMs)?.second ?: 0) >= 0

    /** 待交的作业（小组件、提醒用）：过期 7 天内 + 没定日子 + 以后的，按截止时间排 */
    fun pendingHomework(): List<Item> = all().filter { it.hw && !it.done && (!it.dated || T.dayDiff(it.day) >= -7) }
        .sortedWith(compareBy<Item>({ if (it.dated) 0 else 1 }, { it.day }, { it.time.ifEmpty { "99" } }))

    // ---------- 「现在最该做的事」：首页卡片、小组件 ----------
    /** cday / cstart：是课的话，哪天第几节（6.9 首页点课程看课表截图） */
    class Next(val label: String, val title: String, val sub: String, val at: Long, val hot: Boolean, val key: String, val live: Boolean, val cday: String = "", val cstart: Int = 0)
    fun next(): Next? {
        val now = T.now(); val t = T.todayKey(); val nowMs = System.currentTimeMillis(); val nowMin = now.hour * 60 + now.minute
        val night = now.hour >= 23 || now.hour < 5
        data class C(val score: Double, val n: Next, val far: Boolean)
        val cands = mutableListOf<C>()
        for (it in all()) {
            if (it.done) continue
            val w = if (EXAM.containsMatchIn(it.title + it.summary)) 1.7 else when (it.type) { "作业" -> 1.45; "会议" -> 1.15; "个人" -> 1.05; "通知" -> 0.8; else -> 1.0 }
            if (!it.dated) { cands += C(4 * w, Next("没定日子", it.title, "时间待定", 0, false, it.key, false), true); continue }
            val mins = (it.at() - nowMs) / 60000.0
            val score: Double; var label: String; var hot = false
            if (mins < 0) {
                if (T.dayDiff(it.day) < -7) continue
                if (!it.hw && mins < -120) continue
                score = ((if (it.hw) 150.0 else 60.0) - minOf(-mins / 1440, 7.0) * 8) * w
                label = if (it.hw) "过期了" else "接下来"; hot = it.hw
            } else {
                score = 100 / (1 + mins / 60 / 12) * w
                label = if (EXAM.containsMatchIn(it.title)) "考试" else if (it.hw) "先做这个" else "接下来"
                hot = mins <= 360 && it.hw
            }
            val sub = listOf(if (it.time.isNotEmpty()) T.dayName(it.day) + " " + it.time else T.dayName(it.day), if (it.location.isNotEmpty()) "📍 " + it.location else "").filter { s -> s.isNotEmpty() }.joinToString(" · ")
            cands += C(score, Next(label, it.title, sub, if (it.time.isNotEmpty()) it.at() else 0, hot, it.key, false), mins > 48 * 60)
        }
        for (c in if (Store.feat("courses")) Courses.on(t) else emptyList()) {
            val s = c.m0 ?: continue; val e = c.m1 ?: (s + 45)
            if (e <= nowMin) continue
            val on = s <= nowMin; val toStart = s - nowMin
            val score = if (on) 96.0 else if (toStart <= 180) 110.0 / (1 + toStart / 60.0) else 0.0
            if (score <= 0) continue
            cands += C(score, Next(if (on) "正在上" else "下一节", c.name, c.t0 + "-" + c.t1 + if (c.location.isNotEmpty()) " · 📍 " + c.location else "",
                T.epoch(t, if (on) e else s), on, "", on, if (c.evening) "" else t, c.start), false)
        }
        cands.sortByDescending { it.score }
        // 6.6 正在上课：首页这一格固定显示这节课和「还有多久下课」，不被别的事挤掉
        val top = cands.firstOrNull { it.n.live } ?: cands.firstOrNull()
        if (top == null || top.far) {
            nextLesson()?.let { (day, c) ->
                val tm = day != t; val early = night || (tm && now.hour >= 21)
                return Next(if (early) "早点睡" else "下一节", c.name, (if (tm) "明天 " else "") + c.t0 + if (c.location.isNotEmpty()) " · 📍 " + c.location else "", T.epoch(day, c.m0 ?: 0), false, "", false, if (c.evening) "" else day, c.start)
            }
            if (top == null) return null
        }
        val n = top.n
        return if (night && !n.hot && !n.live && (n.at == 0L || n.at - nowMs > 6 * 3600_000L)) Next("早点睡", n.title, n.sub, n.at, false, n.key, false) else n
    }
    /** 下一节课（今天还没开始的，没有就明天第一节） */
    fun nextLesson(): Pair<String, Lesson>? {
        if (!Store.feat("courses") || !Courses.has()) return null
        val now = T.now(); val nowMin = now.hour * 60 + now.minute; val t = T.todayKey()
        Courses.on(t).filter { (it.m0 ?: -1) > nowMin }.minByOrNull { it.m0!! }?.let { return t to it }
        for (i in 1..7) { val k = T.addDays(t, i.toLong()); Courses.on(k).filter { it.m0 != null }.minByOrNull { it.m0!! }?.let { return k to it } }
        return null
    }

    /** 一句话 / 备忘录里写了「下节课前」：换成那门课下次上课的时间 */
    fun withLesson(q: Memo.Row, text: String): Memo.Row {
        if (q.day.isNotEmpty()) return q
        val n = Courses.resolveNext(text) ?: return q
        return Memo.Row(Courses.stripNext(q.subject).ifEmpty { q.subject }, n.day, n.time, q.place, q.note, q.done, true)
    }

    // ---------- 操作 ----------
    fun toggleDone(key: String): Boolean {
        val on: Boolean
        val r0 = try { find(key) } catch (_: Exception) { null }
        if (Regex("^c\\d+$").matches(key)) {
            val mk = marks(); val m = mk.optJSONObject(key) ?: JSONObject()
            on = !m.optBoolean("done"); m.put("done", on); mk.put(key, m); Kv.set(MARK, mk)
            growth(key.substring(1), !on)
            Level.log("done", key.substring(1), !on)
        } else {
            val list = Kv.arr(MINE); var hit = false; var v = false; var roll: JSONObject? = null
            for (x in list.objs()) if (x.str("id") == key) {
                // 6.2 重复的事项：勾完成就排到下一次，不会消失
                roll = if (!x.optBoolean("done")) MemoCore.complete(x, T.todayKey()) else null
                if (roll != null) { for (k in roll.keys()) x.put(k, roll.get(k)); v = true } else { v = !x.optBoolean("done"); x.put("done", v) }
                hit = true
            }
            if (!hit) return false
            on = v; Kv.set(MINE, list)
            if (roll != null) lastRoll = roll.str("event_time").take(10)
            // 6.9 账号经验：重复的事项每次完成单独算（同一天只算一次）
            if (roll != null) Level.log("mine", key + "@" + T.todayKey(), false) else Level.log("mine", key, !on)
        }
        val log = Kv.obj(DONE_LOG); if (on) log.put(key, T.todayKey()) else log.remove(key); Kv.set(DONE_LOG, log)
        // 捞捞教练：记下几点完成的（只存在这台手机），用来学你的节奏、判断是不是一口气乱勾
        Coach.record(Coach.Ev(System.currentTimeMillis(), if (on) "done" else "undo", key, r0?.type ?: "", if (r0 != null && r0.dated) r0.at() else 0))
        Bus.emit("data")
        return on
    }
    /** 6.2 刚才勾的是重复的事项：下一次是哪天（给界面提示用），用完清空 */
    var lastRoll: String = ""
    fun toggleListItem(id: String, i: Int): List<MemoCore.Li> {
        val list = Kv.arr(MINE); var out = emptyList<MemoCore.Li>()
        for (x in list.objs()) if (x.str("id") == id) {
            out = MemoCore.listOf(x).mapIndexed { n, it -> if (n == i) MemoCore.Li(it.t, !it.d) else it }
            x.put("list", MemoCore.toJson(out))
        }
        Kv.set(MINE, list); Bus.emit("data"); return out
    }
    fun togglePin(id: String): Boolean {
        val list = Kv.arr(MINE); var on = false
        for (x in list.objs()) if (x.str("id") == id) { on = !x.optBoolean("pin"); if (on) x.put("pin", true) else x.remove("pin") }
        Kv.set(MINE, list); Bus.emit("data"); return on
    }
    /** 6.2 搜索：标题、摘要、备注、清单、地点、原文（我的事项、班级事项都搜，包括已完成的、两周以后的） */
    fun search(q: String): List<Item> = all(showHidden = true).filter { r ->
        MemoCore.match(listOf(r.title, r.summary, r.note, r.location, r.prepare, r.original, r.type).joinToString(" ") + " " + r.list.joinToString(" ") { it.t }, q)
    }.sortedWith(compareBy<Item>({ it.done }, { if (it.dated) it.day + it.time.ifEmpty { "00" } else "9" })).take(80)
    fun setDone(key: String, done: Boolean) { val r = find(key) ?: return; if (r.done != done) toggleDone(key) }
    private fun growth(id: String, undo: Boolean) {
        val c = Store.cls ?: return
        if (c.optBoolean("is_teacher") || !Store.feat("rank")) return
        Bg.run { try { Api.rpc("growth_log", jsonOf("cid" to c.str("id"), "k" to "done", "r" to id, "undo" to undo)) } catch (_: Exception) {} }
    }
    fun setMark(key: String, patch: JSONObject) {
        val mk = marks(); val m = mk.optJSONObject(key) ?: JSONObject()
        for (k in patch.keys()) m.put(k, patch.get(k))
        mk.put(key, m); Kv.set(MARK, mk); Bus.emit("data")
    }
    fun saveMine(rec: JSONObject) {
        val list = Kv.arr(MINE); val out = JSONArray(); var hit = false
        for (x in list.objs()) {
            if (x.str("id") == rec.str("id")) { for (k in rec.keys()) x.put(k, rec.get(k)); hit = true }
            if (x.has("local") && !x.optBoolean("local")) x.remove("local")
            if (x.has("kind") && x.str("kind").isEmpty()) x.remove("kind")
            if (x.has("rep") && x.str("rep").isEmpty()) x.remove("rep")
            if (x.has("pin") && !x.optBoolean("pin")) x.remove("pin")
            if ((x.optJSONArray("list")?.length() ?: -1) == 0) x.remove("list")
            out.put(x)
        }
        if (!hit) out.put(rec)
        Kv.set(MINE, out); Bus.emit("data")
    }
    fun deleteMine(id: String) {
        val list = Kv.arr(MINE); val out = JSONArray()
        for (x in list.objs()) { if (x.str("id") == id) { if (x.str("from").isNotEmpty()) setMark(x.str("from"), jsonOf("hidden" to false)); continue }; out.put(x) }
        Kv.set(MINE, out); Bus.emit("data")
    }
    fun clearDoneMine(): Int {
        val list = Kv.arr(MINE).objs(); val left = list.filter { !it.optBoolean("done") }
        Kv.set(MINE, JSONArray(left)); Bus.emit("data"); return list.size - left.size
    }
    fun mineRecord(id: String): JSONObject? = mine().firstOrNull { it.str("id") == id }

    // ---------- 班级事项：发布 / 修改 / 删除（班委、老师） ----------
    /** 返回这条事项的 id（新发布的从服务器拿） */
    fun publish(id: String?, type: String, title: String, summary: String, day: String, time: String, location: String, prepare: String): String? {
        val c = Store.cls ?: throw ApiError(0, "还没有班级")
        val rec = jsonOf("msg_type" to type, "subject" to title.trim(), "summary" to summary.trim(), "event_time" to if (day.isEmpty()) "" else day + if (time.isNotEmpty()) " $time" else "",
            "location" to location.trim(), "prepare" to prepare.trim(), "need_confirm" to day.isEmpty())
        val h = mapOf("Prefer" to "return=representation")
        if (id != null) {
            val res = Api.rest("class_info?id=eq.$id", "PATCH", rec, h, hedge = true) as? JSONArray
            if (res == null || res.length() == 0) throw ApiError(403, "没有修改权限")
        } else {
            rec.put("class_id", c.str("id")); rec.put("publish_date", T.todayKey())
            rec.put("original", "（由" + (Store.me?.str("display_name")?.ifBlank { null } ?: "班委") + "手动发布）")
            val res = Api.rest("class_info", "POST", rec, h, hedge = false) as? JSONArray
            Store.loadItems()
            return res?.optJSONObject(0)?.opt("id")?.toString()
        }
        Store.loadItems()
        return id
    }
    fun deleteClassItem(id: String) {
        val res = Api.rest("class_info?id=eq.$id", "DELETE", null, mapOf("Prefer" to "return=representation")) as? JSONArray
        if (res == null || res.length() == 0) throw ApiError(403, "没有删除权限")
        Store.loadItems()
    }
}
