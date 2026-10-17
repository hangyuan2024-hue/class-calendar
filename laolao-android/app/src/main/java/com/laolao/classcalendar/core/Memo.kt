package com.laolao.classcalendar.core

import java.time.LocalDate

/**
 * 一句话记事 / 导入备忘录（和网页、小程序 memo-parse.js 同一套规则）：
 * 「明天下午3点交数学作业 @图书馆」→ 日期、时间、标题、地点、是不是作业
 */
object Memo {
    class Row(val subject: String, val day: String, val time: String, val place: String, val note: String, val done: Boolean, val homework: Boolean)

    private val CN = mapOf('零' to 0, '〇' to 0, '一' to 1, '二' to 2, '两' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '七' to 7, '八' to 8, '九' to 9, '十' to 10)
    fun cnNum(s: String): Int? {
        if (Regex("^\\d+$").matches(s)) return s.toInt()
        if (s == "十") return 10
        Regex("^([一二三四五六七八九两]?)十([一二三四五六七八九]?)$").find(s)?.let { m ->
            val a = m.groupValues[1]; val b = m.groupValues[2]
            return (if (a.isEmpty()) 1 else CN[a[0]]!!) * 10 + (if (b.isEmpty()) 0 else CN[b[0]]!!)
        }
        return if (s.length == 1) CN[s[0]] else null
    }
    private const val NUM = "(\\d{1,2}|[一二三四五六七八九十两]{1,3})"
    private val WD = mapOf('一' to 1, '二' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '日' to 7, '天' to 7, '末' to 6)

    class Found(val day: LocalDate, val re: String)
    fun findDate(t: String, today: LocalDate): Found? {
        val y = today.year
        fun fix(mo: Int, d: Int): LocalDate? {
            if (mo !in 1..12 || d !in 1..31) return null
            return try { var dt = LocalDate.of(y, mo, d); if (dt.isBefore(today.minusDays(60))) dt = LocalDate.of(y + 1, mo, d); dt } catch (e: Exception) { null }
        }
        Regex("(\\d{4})[-/.年](\\d{1,2})[-/.月](\\d{1,2})[日号]?").find(t)?.let { m ->
            try { return Found(LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()), m.value) } catch (_: Exception) {}
        }
        Regex("$NUM\\s*月\\s*$NUM\\s*[日号]?").find(t)?.let { m ->
            val mo = cnNum(m.groupValues[1]); val d = cnNum(m.groupValues[2])
            if (mo != null && d != null) fix(mo, d)?.let { return Found(it, m.value) }
        }
        Regex("(^|[^\\d./])(\\d{1,2})[./](\\d{1,2})(?![\\d./])(?!\\s*(?:小时|分钟|天|元|块|个|%|倍|斤|公里|米|km|kg|h\\b|g\\b))", RegexOption.IGNORE_CASE).find(t)?.let { m ->
            fix(m.groupValues[2].toInt(), m.groupValues[3].toInt())?.let { return Found(it, m.value.substring(m.groupValues[1].length)) }
        }
        Regex("大后天").find(t)?.let { return Found(today.plusDays(3), it.value) }
        Regex("后天").find(t)?.let { return Found(today.plusDays(2), it.value) }
        Regex("明天|明日|明早|明晚").find(t)?.let { return Found(today.plusDays(1), it.value) }
        Regex("今天|今日|今晚|今早").find(t)?.let { return Found(today, it.value) }
        Regex("(下下|下|这|本)?\\s*(?:周|星期|礼拜)([一二三四五六日天末])").find(t)?.let { m ->
            val want = WD[m.groupValues[2][0]]!!; val cur = today.dayOfWeek.value
            val pre = m.groupValues[1]
            var diff = (want - cur).toLong()
            when (pre) { "下" -> diff += 7; "下下" -> diff += 14; "这", "本" -> {}; else -> diff = ((want - cur + 7) % 7).toLong() }
            return Found(today.plusDays(diff), m.value)
        }
        return null
    }

    class FoundT(val time: String, val re: String)
    fun findTime(t: String): FoundT? {
        fun fix(p: String, h0: Int, mm: Int, re: String): FoundT? {
            var h = h0
            if (Regex("下午|傍晚|晚").containsMatchIn(p) && h < 12) h += 12
            if (p == "中午" && h < 6) h += 12
            if (h > 23 || mm > 59) return null
            return FoundT(String.format("%02d:%02d", h, mm), re)
        }
        Regex("(上午|早上|早晨|中午|下午|傍晚|晚上|晚)?\\s*(\\d{1,2})[:：](\\d{2})").find(t)?.let { m ->
            return fix(m.groupValues[1], m.groupValues[2].toInt(), m.groupValues[3].toInt(), m.value)
        }
        Regex("(上午|早上|早晨|中午|下午|傍晚|晚上|晚)?\\s*$NUM\\s*[点時时](半|一刻|三刻|$NUM\\s*分?)?").find(t)?.let { m ->
            val h = cnNum(m.groupValues[2])
            val mi = when (m.groupValues[3]) { "半" -> 30; "一刻" -> 15; "三刻" -> 45; "" -> 0; else -> cnNum(m.groupValues[4]) }
            if (h != null && mi != null) return fix(m.groupValues[1], h, mi, m.value)
        }
        Regex("(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b", RegexOption.IGNORE_CASE).find(t)?.let { m ->
            var h = m.groupValues[1].toInt(); val mi = m.groupValues[2].ifEmpty { "0" }.toInt()
            if (m.groupValues[3].equals("pm", true) && h < 12) h += 12
            if (m.groupValues[3].equals("am", true) && h == 12) h = 0
            if (h <= 23 && mi <= 59) return FoundT(String.format("%02d:%02d", h, mi), m.value)
        }
        return null
    }

    private val BULLET = Regex("^\\s*(?:[-*•·◦●○▪▫■□☐☑✅✔✓√×✗]|\\[\\s?[xX✓ ]?\\s?\\]|\\d{1,3}[.、)）](?!\\d)|[（(]\\d{1,3}[)）])\\s*")
    private val DONE = Regex("^\\s*(?:[-*]?\\s*\\[[xX✓]\\]|☑|✅|✔|✓|√)")
    private val HW = Regex("作业|习题|练习册|报告|论文|提交|交到|上交|ddl|截止", RegexOption.IGNORE_CASE)
    private fun clean(s: String) = s.replace(Regex("^[\\s,，;；:：、\\-–—]+|[\\s,，;；:：、\\-–—]+$"), "").replace(Regex("\\s{2,}"), " ")

    /** 一大段文字（备忘录、微信里分享来的）→ 一条条事项 */
    fun parse(text: String, today: LocalDate = T.today()): List<Row> {
        val out = mutableListOf<Row>(); val seen = HashSet<String>()
        var ctxDay: LocalDate? = null; var ctxTime = ""
        for (raw in text.replace("\r", "").split("\n")) {
            if (raw.isBlank()) { ctxDay = null; continue }
            val done = DONE.containsMatchIn(raw)
            var t = raw
            for (b in 0 until 3) { if (BULLET.containsMatchIn(t)) t = t.replaceFirst(BULLET, "") else break }
            t = t.trim(); if (t.isEmpty()) continue
            val dm = findDate(t, today); val tm = findTime(t)
            var rest = t
            if (tm != null) rest = rest.replaceFirst(tm.re, " ")
            if (dm != null) rest = if (rest.contains(dm.re)) rest.replaceFirst(dm.re, " ") else rest.replaceFirst(Regex("(^|\\s)[明今]\\s"), " ")
            rest = clean(rest.replace(Regex("[（(]\\s*[)）]"), "").replaceFirst(Regex("^\\s*(之前|以前|前)(?=\\S)"), ""))
            if (dm != null && (rest.isEmpty() || Regex("^(要做的|待办|安排|计划|事项|todo)$", RegexOption.IGNORE_CASE).matches(rest))) { ctxDay = dm.day; ctxTime = tm?.time ?: ""; continue }
            if (Regex("^#{1,6}\\s").containsMatchIn(raw.trim()) || Regex("^【[^】]{1,12}】$").matches(t) || (Regex("[:：]$").containsMatchIn(t) && dm == null && t.length <= 12)) { ctxDay = null; continue }
            val day = dm?.day ?: ctxDay
            val time = tm?.time ?: if (dm == null && ctxDay != null) ctxTime else ""
            var subject = rest.ifEmpty { t }; var note = ""
            if (subject.length > 40) { note = subject; subject = subject.take(30) + "…" }
            if (!seen.add(subject + "|" + (day?.let { T.key(it) } ?: ""))) continue
            out += Row(subject, day?.let { T.key(it) } ?: "", if (day != null) time else "", "", note, done, HW.containsMatchIn(t))
            if (out.size >= 300) break
        }
        return out
    }

    /** 一句话记事：「明天下午3点交数学作业 @图书馆」 */
    fun quick(text: String, today: LocalDate = T.today()): Row {
        var t = text.trim().replace("\n", " ")
        var place = ""
        Regex("[@＠]\\s*([^\\s@＠]{1,20})").find(t)?.let { place = it.groupValues[1]; t = t.replace(it.value, " ") }
        Regex("在([^\\s，,。]{2,12}?)(?:上课|开会|集合|见面|考试)").find(t)?.let { if (place.isEmpty()) place = it.groupValues[1] }
        val dm = findDate(t, today); val tm = findTime(t)
        var rest = t
        if (tm != null) rest = rest.replaceFirst(tm.re, " ")
        if (dm != null) rest = if (rest.contains(dm.re)) rest.replaceFirst(dm.re, " ") else rest.replaceFirst(Regex("(^|\\s)[明今]\\s"), " ")
        rest = clean(rest.replace(Regex("[（(]\\s*[)）]"), "").replaceFirst(Regex("^\\s*(之前|以前|前)(?=\\S)"), ""))
        val day = dm?.day ?: if (tm != null) today else null
        return Row(rest.ifEmpty { t.trim() }.take(60), day?.let { T.key(it) } ?: "", tm?.time ?: "", place, "", false, HW.containsMatchIn(t))
    }
}
