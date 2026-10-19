package com.laolao.classcalendar.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit

/**
 * 捞捞的「大脑」：智能排序 + 不联网的问答（照 lib/island-core.js，网页、小程序、电脑版同一套规则）
 * 手机上跑不了大模型，所以按「意图」回答：最急的是什么、今天有什么课、这周的作业、下节课在哪、打卡、番茄……
 */
object Island {
    private val WEEK = listOf("日", "一", "二", "三", "四", "五", "六")
    private val EXAM = Regex("考试|测验|测试|小测|期中|期末|月考|考核|答辩")
    /** 6.3「6:30 之前完成签到」「周五前提交」：钟点是截止时间，不是开始时间（和 island-core.js 的 isDue 同一条规则） */
    private val DUE_RE = Regex("(之前|以前|前完成|前提交|前上交|前交|前填|前签到|前打卡|前报名|截止|截至|deadline|ddl)", RegexOption.IGNORE_CASE)
    /** 6.3 晚自习（课程表里设置，跟着账号同步，键 evening_v1；和 island-core.js 的 evening 同一套规则） */
    //   跟着调课 / 调休走：放假那天没有；「这天上周三的课」按周三算；「停课」写了晚自习的名字那天没有
    fun evening(day: String, ev: org.json.JSONObject? = Kv.get("evening_v1") as? org.json.JSONObject, adj: List<org.json.JSONObject>? = null): List<Lesson> =
        selfStudy(day, ev, adj, "晚自习", 90)
    /** 6.5 早自习（键 morning_v1）：和晚自习同一套规则，默认叫「早自习」、排在当天最前面 */
    fun morning(day: String, mo: org.json.JSONObject? = Kv.get("morning_v1") as? org.json.JSONObject, adj: List<org.json.JSONObject>? = null): List<Lesson> =
        selfStudy(day, mo, adj, "早自习", 0)
    private fun selfStudy(day: String, ev: org.json.JSONObject?, adj: List<org.json.JSONObject>?, defName: String, start: Int): List<Lesson> {
        if (ev == null || !ev.optBoolean("on")) return emptyList()
        val t0 = ev.str("t0"); val t1 = ev.str("t1")
        if (T.min(t0) == null || T.min(t1) == null || t1 <= t0) return emptyList()
        val name = ev.str("name").ifBlank { defName }.take(20)
        val on = (adj ?: try { Courses.adjList() } catch (_: Exception) { emptyList() }).filter { it.str("date") == day }
        if (on.any { it.str("type") == "off" || (it.str("type") == "cancel" && it.str("name").trim() == name) }) return emptyList()
        val sw = on.firstOrNull { it.str("type") == "swap" && Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(it.str("from")) }
        val wd = (T.date(sw?.str("from") ?: day) ?: return emptyList()).dayOfWeek.value - 1
        val days = ev.optJSONArray("days") ?: return emptyList()
        if ((0 until days.length()).none { days.optInt(it, -1) == wd }) return emptyList()
        return listOf(Lesson(name, start, start, t0, t1, ev.str("location").take(40), "", 0, evening = true, study = !ev.has("study") || ev.optBoolean("study", true)))
    }
    fun isDue(type: String, text: String): Boolean = type == "作业" || DUE_RE.containsMatchIn(text)
    val CHIPS = listOf("最急的是什么", "今天有什么课", "这周的作业", "明天有什么安排", "下节课在哪", "我今天打卡了吗")

    class In(val key: String, val title: String, val type: String, val day: String, val time: String, val location: String,
             val done: Boolean, val needConfirm: Boolean, val mine: Boolean, val summary: String, val endTime: String = "")
    class Row(val kind: String, val key: String, val title: String, val type: String, val day: String, val time: String, val location: String,
              val level: String, val exam: Boolean, val score: Double, val whenText: String, val reason: String,
              val evening: Boolean = false, val study: Boolean = false)
    class Answer(val text: String, val list: List<Row> = emptyList(), val more: Int = 0, val lines: List<String> = emptyList(),
                 val chips: List<String> = emptyList(), val action: String = "")
    class Ctx(val now: LocalDateTime, val name: String, val items: List<In>, val courses: List<Lesson>, val hasCourses: Boolean,
              val habits: List<Triple<String, Boolean, Int>>, val pomoToday: Int, val pomoWeek: Int,
              val food: Int?, val petName: String, val petLevel: Int, val growth: Int, val rank: Int)

    private fun key(d: LocalDate) = T.key(d)
    private fun fromKey(k: String) = T.date(k)!!
    private fun addDays(k: String, n: Int) = T.addDays(k, n.toLong())
    private fun diff(a: String, b: String) = ChronoUnit.DAYS.between(fromKey(b), fromKey(a)).toInt()
    private fun wd(d: LocalDate) = WEEK[d.dayOfWeek.value % 7]
    private fun hm(n: LocalDateTime) = T.hm(n.toLocalTime())

    fun dayName(k: String, now: LocalDateTime): String {
        val t = key(now.toLocalDate()); val n = diff(k, t); val d = fromKey(k)
        when (n) { 0 -> return "今天"; 1 -> return "明天"; 2 -> return "后天"; -1 -> return "昨天" }
        val w = "周" + wd(d)
        val mon = addDays(t, -(now.dayOfWeek.value - 1))
        val dw = Math.floorDiv(diff(k, mon), 7)
        return when (dw) { 0 -> w; 1 -> "下$w"; -1 -> "上$w"; else -> "${d.monthValue}月${d.dayOfMonth}日" }
    }
    private fun whenText(day: String, time: String, now: LocalDateTime) = if (day.isNotEmpty()) dayName(day, now) + (if (time.isNotEmpty()) " $time" else "") else "时间待定"
    fun leftText(mins: Double): String {
        if (mins < 0) {
            val late = -mins
            if (late < 60) return "刚过 ${maxOf(1, Math.round(late).toInt())} 分钟"
            if (late < 1440) return "已过 ${Math.round(late / 60)} 小时"
            return "过期 ${Math.floor(late / 1440).toInt()} 天"
        }
        if (mins < 60) return "还剩 ${maxOf(1, Math.round(mins).toInt())} 分钟"
        if (mins < 1440) return "还剩 ${Math.round(mins / 60)} 小时"
        return "还剩 ${Math.round(mins / 1440)} 天"
    }
    /** 到点开始的事：「25 分钟后开始」「3 小时后开始」「2 天后开始」 */
    fun startText(mins: Double): String {
        if (mins < 60) return "${maxOf(1, Math.ceil(mins).toInt())} 分钟后开始"
        if (mins < 1440) { val h = (mins / 60).toInt(); val m = Math.round(mins - h * 60).toInt(); return "$h 小时" + (if (m in 1..59 && h < 3) " $m 分" else "") + "后开始" }
        return "${Math.round(mins / 1440)} 天后开始"
    }
    private fun weightOf(it: In): Double {
        if (EXAM.containsMatchIn(it.title + " " + it.summary)) return 1.7
        return when (it.type) { "作业" -> 1.45; "会议" -> 1.15; "活动" -> 1.0; "通知" -> 0.8; "个人" -> 1.05; else -> 1.0 }
    }
    private fun epochMin(d: LocalDateTime) = d.atZone(T.BJ).toInstant().toEpochMilli() / 60000.0

    fun rank(items: List<In>, courses: List<Lesson>, now: LocalDateTime, lateDays: Int = 7): List<Row> {
        val out = mutableListOf<Row>(); val t = key(now.toLocalDate()); val nowMin = epochMin(now)
        for (it in items) {
            if (it.done) continue
            val w = weightOf(it); var score: Double; var level = "normal"; val reason: String
            if (it.day.isEmpty()) { score = 4 * w; reason = "没定日子" }
            else {
                val tm = T.min(it.time) ?: (23 * 60 + 59)
                val due = fromKey(it.day).atStartOfDay().plusMinutes(tm.toLong())
                val mins = epochMin(due) - nowMin; val hours = mins / 60
                // 会议、活动这类到点开始的事：正在进行就排前面，说「还有多久开始」而不是「还剩」
                val endMin = T.min(it.endTime)?.takeIf { e -> e > tm }?.let { e -> (e - tm).toDouble() } ?: 60.0
                val startsAt = it.type != "作业" && it.time.isNotEmpty() && !isDue(it.type, it.title + " " + it.summary)
                if (startsAt && mins < 0 && -mins < endMin) {
                    score = 125 * w; level = "now"; reason = "进行中 · 还有 ${maxOf(1, Math.round(endMin + mins).toInt())} 分钟结束"
                } else if (startsAt && mins >= 0) {
                    score = 100 / (1 + hours / 12) * w
                    level = if (hours <= 1) "urgent" else if (hours <= 48) "soon" else "normal"
                    reason = startText(mins)
                } else {
                    if (mins < 0) {
                        if (diff(t, it.day) > lateDays) continue
                        score = (if (it.type == "作业") 150.0 else 60.0) - minOf(-hours / 24, 7.0) * 8
                        level = if (it.type == "作业") "late" else "past"
                    } else {
                        score = 100 / (1 + hours / 12)
                        level = if (hours <= 6) "urgent" else if (hours <= 48) "soon" else "normal"
                    }
                    score *= w
                    if (it.type != "作业" && mins < -120) score *= 0.2
                    if (startsAt && mins < 0) score *= 0.1      // 6.3 已经结束的会、活动：不再排在「最该先做」前面
                    reason = leftText(mins)
                }
            }
            if (it.needConfirm) score += 3
            out += Row("item", it.key, it.title.ifEmpty { "事项" }, it.type, it.day, it.time, it.location, level, EXAM.containsMatchIn(it.title + it.summary),
                Math.round(score * 10) / 10.0, whenText(it.day, it.time, now), reason)
        }
        val cur = now.toLocalTime().hour * 60 + now.toLocalTime().minute
        for (c in courses) {
            val m0 = c.m0 ?: continue; val m1 = c.m1 ?: m0
            val toStart = (m0 - cur).toDouble(); val toEnd = (m1 - cur).toDouble()
            if (toEnd <= 0) continue
            val on = toStart <= 0
            val score = if (on) 96.0 else if (toStart <= 180) 110 / (1 + toStart / 60) else 0.0
            if (score == 0.0) continue
            out += Row("course", "course:" + c.name + c.t0, c.name, "课程", t, c.t0, c.location, if (on) "now" else if (toStart <= 20) "urgent" else "soon", false,
                Math.round(score * 10) / 10.0, c.t0 + "–" + c.t1, if (on) "正在上课 · 还有 ${Math.round(toEnd)} 分钟下课" else "${Math.round(toStart)} 分钟后上课", c.evening, c.study)
        }
        return out.sortedByDescending { it.score }
    }

    private fun hello(now: LocalDateTime): String { val h = now.hour; return if (h < 5) "夜深了" else if (h < 9) "早上好" else if (h < 12) "上午好" else if (h < 14) "中午好" else if (h < 18) "下午好" else "晚上好" }
    fun greet(c: Ctx): String {
        val list = rank(c.items, c.courses, c.now); val name = if (c.name.isNotEmpty()) "，" + c.name else ""
        val late = list.count { it.level == "late" }; val todayN = list.count { it.kind == "item" && it.day == key(c.now.toLocalDate()) }
        var s = hello(c.now) + name + "！"
        if (list.isEmpty()) return s + "手头没有要赶的事，" + if (c.now.hour >= 21) "早点休息吧 🌙" else "可以安心学点别的 ☕"
        if (late > 0) s += "有 $late 项作业过期了，先补上吧。" else if (todayN > 0) s += "今天有 $todayN 件事。"
        val top = list.firstOrNull { it.level != "past" } ?: return s   // 6.3 不挑已经过去的事
        s += if (top.kind == "course") "「${top.title}」${top.reason}" + (if (top.location.isNotEmpty()) "，在 ${top.location}" else "") + "。" else "最该先做的是「${top.title}」（${top.reason}）。"
        return s
    }

    // ---------- 听懂问题里的日子 ----------
    private val CN = mapOf("一" to 1, "二" to 2, "三" to 3, "四" to 4, "五" to 5, "六" to 6, "日" to 7, "天" to 7, "1" to 1, "2" to 2, "3" to 3, "4" to 4, "5" to 5, "6" to 6, "7" to 7)
    class D(val day: String, val name: String)
    class R(val a: String, val b: String, val name: String)
    fun parseDay(q: String, now: LocalDateTime): D? {
        val t = key(now.toLocalDate())
        if (q.contains("大后天")) return D(addDays(t, 3), "大后天")
        if (q.contains("后天")) return D(addDays(t, 2), "后天")
        if (Regex("明天|明日|明早|明晚").containsMatchIn(q)) return D(addDays(t, 1), "明天")
        if (q.contains("昨天")) return D(addDays(t, -1), "昨天")
        Regex("(下下|下|上|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天1-7])").find(q)?.let { m ->
            val mon = addDays(t, -(now.dayOfWeek.value - 1))
            val off = when (m.groupValues[1]) { "下下" -> 14; "下" -> 7; "上" -> -7; else -> 0 }
            val k = addDays(mon, off + CN[m.groupValues[2]]!! - 1)
            val pre = m.groupValues[1].let { if (it == "下" || it == "上") it else "" }
            return D(k, pre + "周" + wd(fromKey(k)))
        }
        Regex("(\\d{1,2})\\s*月\\s*(\\d{1,2})\\s*[日号]").find(q)?.let { m ->
            try {
                var d = LocalDate.of(now.year, m.groupValues[1].toInt(), m.groupValues[2].toInt())
                if (d.isBefore(now.toLocalDate().minusDays(60))) d = d.plusYears(1)
                return D(key(d), "${d.monthValue}月${d.dayOfMonth}日")
            } catch (_: Exception) {}
        }
        Regex("(\\d{1,2})\\s*[日号]").find(q)?.let { m ->
            try {
                val n = m.groupValues[1].toInt()
                var d = now.toLocalDate().withDayOfMonth(1).plusDays((n - 1).toLong())
                if (n < now.dayOfMonth - 7) d = d.plusMonths(1)
                return D(key(d), "${d.monthValue}月${d.dayOfMonth}日")
            } catch (_: Exception) {}
        }
        if (Regex("今天|今日|今晚|今早|现在|当下").containsMatchIn(q)) return D(t, "今天")
        return null
    }
    fun parseRange(q: String, now: LocalDateTime): R? {
        val t = key(now.toLocalDate()); val mon = addDays(t, -(now.dayOfWeek.value - 1))
        if (Regex("下周|下星期|下个星期|下礼拜").containsMatchIn(q) && !Regex("(下周|下星期|下礼拜)[一二三四五六日天1-7]").containsMatchIn(q)) return R(addDays(mon, 7), addDays(mon, 13), "下周")
        if (Regex("这周|本周|这星期|这个星期|这礼拜|这几天|最近").containsMatchIn(q)) {
            val near = Regex("这几天|最近").containsMatchIn(q)
            return R(t, if (near) addDays(t, 6) else addDays(mon, 6), if (near) "最近一周" else "这周")
        }
        return null
    }

    private fun itemsOf(c: Ctx, f: (Row) -> Boolean) = rank(c.items, emptyList(), c.now, 30).filter(f)
    private fun listReply(text: String, list: List<Row>, empty: String) = if (list.isNotEmpty()) Answer(text, list.take(6), if (list.size > 6) list.size - 6 else 0) else Answer(empty)
    private fun courseLine(c: Lesson) = (if (c.t0.isNotEmpty()) c.t0 + (if (c.t1.isNotEmpty()) "–" + c.t1 else "") else "第${c.start}节") + " " + c.name + (if (c.location.isNotEmpty()) " @" + c.location else "")
    private fun weekOf(k: String): Int { if (!Courses.has()) return 0; val w = Courses.weekOf(k); return if (w in 1..30) w else 0 }
    private fun coursesReply(c: Ctx, d: D): Answer {
        if (!c.hasCourses) return Answer("你还没导入课程表。在「工具 → 课程表」里拍一张课表照片就能导入，之后问我哪天有什么课都行 📷", action = "courses")
        val l = Courses.on(d.day); val wk = weekOf(d.day)
        if (l.isEmpty()) return Answer(d.name + (if (wk > 0) "（第 $wk 周）" else "") + "没有课 🎈" + if (d.day == key(c.now.toLocalDate())) "可以安排点自己的事。" else "")
        return Answer(d.name + (if (wk > 0) "（第 $wk 周 · 周${wd(fromKey(d.day))}）" else "") + "有 ${l.size} 节课：", lines = l.map(::courseLine))
    }
    private class NC(val c: Lesson, val day: String, val now: Boolean)
    private fun nextCourse(c: Ctx): NC? {
        if (!c.hasCourses) return null
        val t = key(c.now.toLocalDate()); val cur = hm(c.now)
        for (i in 0 until 8) {
            val k = addDays(t, i)
            for (x in Courses.on(k)) {
                if (i == 0 && x.t1.isNotEmpty() && x.t1 <= cur) continue
                return NC(x, k, i == 0 && x.t0.isNotEmpty() && x.t0 <= cur)
            }
        }
        return null
    }

    fun answer(q0: String, c: Ctx): Answer? {
        val q = q0.trim().replace(Regex("[？?！!。，,、~～\\s]+$"), "")
        val now = c.now; val t = key(now.toLocalDate())
        if (q.isEmpty()) return Answer("想问什么都可以，比如：", chips = CHIPS)
        if (Regex("你会|能做什么|能干什么|会干什么|帮助|怎么用|功能|help", RegexOption.IGNORE_CASE).containsMatchIn(q)) return Answer("我会帮你盯着日程：哪件事最急、哪天有什么课、这周的作业、下节课在哪、考试安排，还能看打卡、番茄和云宠。直接问就行，比如：", chips = CHIPS)
        if (Regex("你是谁|你叫什么|你是什么").containsMatchIn(q)) return Answer("我是捞捞，住在这个小岛上的学习小助手 🤖 我会把你最该先做的事放在最上面，有问题随时问我。")
        if (Regex("^(你好|您好|嗨|哈喽|hi|hello|hey|在吗|在不在|早|早上好|早安|中午好|下午好|晚上好|晚安)", RegexOption.IGNORE_CASE).containsMatchIn(q))
            return Answer(hello(now) + (if (c.name.isNotEmpty()) "，" + c.name else "") + "！" + if (q.contains("晚安")) "明天见，好好睡一觉 🌙" else "今天想先搞定哪件事？", chips = CHIPS.take(3))
        if (Regex("谢谢|感谢|辛苦|多谢|thx|thanks", RegexOption.IGNORE_CASE).containsMatchIn(q)) return Answer("不客气～有事随时叫我 😊")
        if (Regex("累|烦|压力|不想学|不想写|焦虑|难过|崩溃|好难|学不动|摆烂").containsMatchIn(q)) {
            val top0 = rank(c.items, emptyList(), now).firstOrNull()
            return Answer("辛苦啦，先深呼吸一下 🌿 " + if (top0 != null) "不用一口气做完，先只做「${top0.title}」的第一步，25 分钟就好，做完奖励自己休息一下。" else "现在手头没有急事，休息一会儿也没关系。")
        }
        if (!Regex("课|作业|考").containsMatchIn(q) && Regex("几点|现在时间|什么时间|几号|日期|星期几|周几|礼拜几|第几周|教学周|今天是").containsMatchIn(q)) {
            val wk = weekOf(t)
            return Answer("现在是 ${now.monthValue}月${now.dayOfMonth}日 周${wd(now.toLocalDate())} ${hm(now)}" + (if (wk > 0) "，第 $wk 教学周" else "") + "。")
        }
        if (Regex("下[一节]*节课|下一节|接下来.*课|在哪.*上课|上课.*在哪|哪个教室|现在.*什么课|在上什么|还有课吗|还有几节").containsMatchIn(q)) {
            if (!c.hasCourses) return coursesReply(c, D(t, "今天"))
            if (Regex("还有课吗|还有几节").containsMatchIn(q)) {
                val rest = Courses.on(t).filter { it.t1.isEmpty() || it.t1 > hm(now) }
                return if (rest.isNotEmpty()) Answer("今天还有 ${rest.size} 节课：", lines = rest.map(::courseLine)) else Answer("今天的课都上完啦 🎉")
            }
            val nc = nextCourse(c) ?: return Answer("最近一周都没有课了 🎈")
            return Answer(if (nc.now) "现在正在上「${nc.c.name}」，${nc.c.t1} 下课" + (if (nc.c.location.isNotEmpty()) "，在 ${nc.c.location}" else "") + "。"
            else "下节课是" + dayName(nc.day, now) + " " + nc.c.t0.ifEmpty { "第${nc.c.start}节" } + " 的「${nc.c.name}」" + (if (nc.c.location.isNotEmpty()) "，在 ${nc.c.location}" else "") + (if (nc.c.teacher.isNotEmpty()) "，${nc.c.teacher}老师" else "") + "。")
        }
        val d = parseDay(q, now); val r = parseRange(q, now)
        if (q.contains("课") && !Regex("作业|课后|课程作业").containsMatchIn(q)) {
            if (r != null && d == null) {
                if (!c.hasCourses) return coursesReply(c, D(t, "今天"))
                val lines = mutableListOf<String>(); var k = r.a
                while (k <= r.b) { val l2 = Courses.on(k); if (l2.isNotEmpty()) lines += dayName(k, now) + "：" + l2.joinToString("、") { it.name }; k = addDays(k, 1) }
                return if (lines.isNotEmpty()) Answer(r.name + "的课：", lines = lines) else Answer(r.name + "没有课 🎈")
            }
            return coursesReply(c, d ?: D(t, "今天"))
        }
        if (Regex("考试|测验|测试|小测|期中|期末|月考|答辩").containsMatchIn(q)) {
            return listReply("日历里的考试 / 测验：", itemsOf(c) { it.exam && it.level != "late" }, "日历里还没看到考试安排 👀 有消息记得让班委发到班级里，或者自己「记一件事」。")
        }
        if (Regex("作业|要交|没交|交什么|ddl|DDL|截止").containsMatchIn(q)) {
            val hw = itemsOf(c) { it.type == "作业" || Regex("作业|报告|习题|练习|论文|ppt|PPT").containsMatchIn(it.title) }
            if (Regex("过期|没交|欠|补").containsMatchIn(q)) { val late = hw.filter { it.level == "late" }; return listReply("过期还没交的作业有 ${late.size} 项，抓紧补上：", late, "没有过期的作业，棒 👍") }
            if (d != null) { val hd = hw.filter { it.day == d.day }; return listReply(d.name + "要交 ${hd.size} 项作业：", hd, d.name + "没有要交的作业 🎉") }
            if (r != null) {
                val hr = hw.filter { it.day.isNotEmpty() && it.day >= r.a && it.day <= r.b }
                val dow = now.dayOfWeek.value
                if (hr.isEmpty() && r.name == "这周" && (dow == 6 || dow == 7)) {
                    val nx = hw.filter { it.day.isNotEmpty() && it.day > r.b && it.day <= addDays(r.b, 7) }
                    if (nx.isNotEmpty()) return listReply("这周的都交完了，下周要交 ${nx.size} 项：", nx, "")
                }
                return listReply(r.name + "要交 ${hr.size} 项作业（按急的排）：", hr, r.name + "没有要交的作业 🎉")
            }
            return listReply("还没交的作业有 ${hw.size} 项，按轻重缓急排好了：", hw, "作业都交完了，太棒了 🎉")
        }
        if (Regex("打卡|习惯").containsMatchIn(q)) {
            val hs = c.habits
            if (hs.isEmpty()) return Answer("你还没有习惯，去「成长」页加一个，比如「背 30 个单词」，每天打卡能攒成长值和养料。", action = "growth")
            val undone = hs.filter { !it.second }
            return Answer(if (undone.isNotEmpty()) "今天还差 ${undone.size} 个没打：" + undone.joinToString("、") { it.first } + "。" else "今天的 ${hs.size} 个习惯都打卡了 🔥",
                lines = hs.map { (if (it.second) "✅ " else "⬜ ") + it.first + if (it.third > 0) "（连续 ${it.third} 天）" else "" })
        }
        if (Regex("番茄|专注").containsMatchIn(q)) return Answer("今天专注了 ${c.pomoToday} 个番茄，这周一共 ${c.pomoWeek} 个。" + if (c.pomoToday < 4) "再来一个？" else "很专注 👏", action = "pomo")
        if (Regex("成长值|排名|排行|第几名").containsMatchIn(q)) return Answer(if (c.rank > 0) "这周你攒了 ${c.growth} 成长值，班里第 ${c.rank} 名 🏆" else "这周还没上榜，完成一项作业就能攒成长值。", action = "rank")
        if (Regex("云宠|宠物|养料|喂").containsMatchIn(q)) return Answer(if (c.food != null) "「${c.petName}」现在 Lv.${c.petLevel}，你有 ${c.food} 养料" + (if (c.food >= 10) "，可以去喂它啦 🥕" else "，完成一件事就能攒养料 🌾") else "去云宠农场领一只云宠吧 🐣", action = "farm")
        if (d != null && Regex("安排|计划|事|忙|干什么|做什么|有啥|有什么|日程").containsMatchIn(q)) {
            val di = itemsOf(c) { it.day == d.day }
            val dc = if (c.hasCourses) Courses.on(d.day) else emptyList()
            if (di.isEmpty() && dc.isEmpty()) return Answer(d.name + "没有安排，日历是空的 ☕")
            return Answer(d.name + "有 ${di.size} 件事" + (if (dc.isNotEmpty()) "、${dc.size} 节课" else "") + "：", di.take(6),
                lines = if (dc.isNotEmpty()) listOf("📚 " + dc.joinToString("；") { (it.t0 + " " + it.name).trim() }) else emptyList())
        }
        if (r != null && Regex("安排|事|忙|计划|日程|有啥|有什么").containsMatchIn(q)) {
            return listReply(r.name + "有 ${itemsOf(c) { it.day.isNotEmpty() && it.day >= r.a && it.day <= r.b }.size} 件事，最急的在前面：", itemsOf(c) { it.day.isNotEmpty() && it.day >= r.a && it.day <= r.b }, r.name + "没有安排 ☕")
        }
        if (Regex("急|先做|优先|接下来|该做|要做什么|做什么|待办|安排|有什么事|忙|任务|干嘛|干啥").containsMatchIn(q)) {
            val all = rank(c.items, c.courses, now).filter { it.level != "past" }
            return listReply(if (all.isNotEmpty()) "按轻重缓急排好了，从上往下做：" else "", all, "现在没有要赶的事，轻松一下吧 ☕")
        }
        val kw = q.replace(Regex("什么时候|什么时间|几点|在哪里?|在哪儿|地点|要带什么|带什么|准备什么|是什么|有没有|吗|呢|呀|啊|吧|的|了|我|请问|告诉我|帮我|查一?下|看看|一下"), "").trim()
        if (kw.length >= 2) {
            val hit = rank(c.items, emptyList(), now, 60).filter { it.title.contains(kw) || kw.contains(it.title) }
            if (hit.isNotEmpty()) {
                val h0 = hit[0]
                if (Regex("在哪|地点").containsMatchIn(q) && h0.location.isNotEmpty()) return Answer("「${h0.title}」在 ${h0.location}，${h0.whenText}。", hit.take(3))
                return listReply("找到 ${hit.size} 件跟「$kw」有关的事：", hit, "")
            }
            if (c.hasCourses) for (i in 0 until 7) {
                val kk = addDays(t, i); val cl = Courses.on(kk).filter { it.name.contains(kw) || kw.contains(it.name) }
                if (cl.isNotEmpty()) return Answer("「${cl[0].name}」最近一次是" + dayName(kk, now) + " " + cl[0].t0.ifEmpty { "第${cl[0].start}节" } + (if (cl[0].location.isNotEmpty()) "，在 ${cl[0].location}" else "") + "。")
            }
        }
        return null
    }
    fun fallback() = Answer("这个我还不太会 😅 我能回答日程、课程、作业、考试、打卡这些，试试问：", chips = CHIPS)

    /** 排行榜里我的成长值（问答页打开时拉一次） */
    @Volatile var rankMe: Pair<Int, Int>? = null

    /** 把手机上的数据整理成上面要的样子 */
    fun ctx(): Ctx {
        val now = T.now(); val t = T.todayKey()
        val items = Items.all().filter { !it.course && !it.hidden }.map { In(it.key, it.title, it.type, it.day, it.time, it.location, it.done, it.needConfirm, it.mine, it.summary, it.endTime) }
        val hasC = Store.feat("courses") && Courses.has()
        val hl = Growth.log()
        val habits = Growth.habits().map { Triple(it.name, Growth.checked(it.id), Growth.streak(it.id, hl)) }
        val pl = Plan.log()
        val farm = try { if (Farm.on()) Farm.state() else null } catch (_: Exception) { null }
        val ev = morning(t) + evening(t)   // 6.3 晚自习 / 6.5 早自习：当成今天最后 / 第一节课，到点「上课中」（设成「催我写作业」时教练照样推荐）
        return Ctx(now, Store.name(), items, (if (hasC) Courses.on(t) else emptyList()) + ev, hasC || ev.isNotEmpty(), habits, pl.optInt(t), (0..6).sumOf { pl.optInt(T.addDays(t, -it.toLong())) },
            farm?.let { Farm.left() }, farm?.str("name") ?: "", farm?.optInt("level") ?: 0, rankMe?.first ?: 0, rankMe?.second ?: 0)
    }
}
