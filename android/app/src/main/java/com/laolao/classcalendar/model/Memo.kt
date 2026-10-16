package com.laolao.classcalendar.model

import java.time.LocalDate

/**
 * 导入手机备忘录：把一段文字拆成一条条事项（和网站 memo.js 同一套规则）。
 * 一行一条；认出日期、时间、勾选状态；「周三：」「10月20日」这种单独一行的日期，算作下面几行的日期，空一行就不算了。
 */
data class MemoRow(val subject: String, val note: String, val done: Boolean, val date: LocalDate?, val time: String, val homework: Boolean, val place: String = "")

object Memo {
    private val CN = mapOf('零' to 0, '〇' to 0, '一' to 1, '二' to 2, '两' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '七' to 7, '八' to 8, '九' to 9, '十' to 10)
    private const val NUM = "(\\d{1,2}|[一二三四五六七八九十两]{1,3})"

    fun cnNum(s: String): Int? {
        if (s.all { it.isDigit() } && s.isNotEmpty()) return s.toInt()
        if (s == "十") return 10
        Regex("^([一二三四五六七八九两]?)十([一二三四五六七八九]?)$").find(s)?.let { m ->
            val a = m.groupValues[1]; val b = m.groupValues[2]
            return (if (a.isEmpty()) 1 else CN[a[0]]!!) * 10 + (if (b.isEmpty()) 0 else CN[b[0]]!!)
        }
        return if (s.length == 1) CN[s[0]] else null
    }

    private val WD = mapOf('一' to 1, '二' to 2, '三' to 3, '四' to 4, '五' to 5, '六' to 6, '日' to 7, '天' to 7, '末' to 6)

    private fun fixYear(today: LocalDate, mo: Int, d: Int): LocalDate? {
        val dt = runCatching { LocalDate.of(today.year, mo, d) }.getOrNull() ?: return null
        return if (dt.isBefore(today.minusDays(60))) runCatching { LocalDate.of(today.year + 1, mo, d) }.getOrNull() else dt
    }

    /** 找日期：返回 (日期, 匹配到的文字) */
    fun findDate(t: String, today: LocalDate): Pair<LocalDate, String>? {
        Regex("(\\d{4})[-/.年](\\d{1,2})[-/.月](\\d{1,2})[日号]?").find(t)?.let { m ->
            runCatching { LocalDate.of(m.groupValues[1].toInt(), m.groupValues[2].toInt(), m.groupValues[3].toInt()) }.getOrNull()?.let { return it to m.value }
        }
        Regex(NUM + "\\s*月\\s*" + NUM + "\\s*[日号]?").find(t)?.let { m ->
            val mo = cnNum(m.groupValues[1]); val d = cnNum(m.groupValues[2])
            if (mo != null && d != null && mo in 1..12 && d in 1..31) fixYear(today, mo, d)?.let { return it to m.value }
        }
        // 10.20 / 10/20（不要把 3.5 小时、版本号 1.2.3 当日期）
        Regex("(^|[^\\d./])(\\d{1,2})[./](\\d{1,2})(?![\\d./])(?!\\s*(?:小时|分钟|天|元|块|个|%|倍|斤|公里|米|km|kg|h\\b|g\\b))", RegexOption.IGNORE_CASE).find(t)?.let { m ->
            val mo = m.groupValues[2].toInt(); val d = m.groupValues[3].toInt()
            if (mo in 1..12 && d in 1..31) fixYear(today, mo, d)?.let { return it to m.value.substring(m.groupValues[1].length) }
        }
        Regex("大后天").find(t)?.let { return today.plusDays(3) to it.value }
        Regex("后天").find(t)?.let { return today.plusDays(2) to it.value }
        Regex("明天|明日|明早|明晚").find(t)?.let { return today.plusDays(1) to it.value }
        Regex("今天|今日|今晚|今早").find(t)?.let { return today to it.value }
        Regex("(下下|下|这|本)?\\s*(?:周|星期|礼拜)([一二三四五六日天末])").find(t)?.let { m ->
            val want = WD[m.groupValues[2][0]]!!          // 1 = 周一 … 7 = 周日
            val cur = today.dayOfWeek.value
            val pre = m.groupValues[1]
            var diff = want - cur
            when (pre) {
                "下" -> diff += 7
                "下下" -> diff += 14
                "这", "本" -> {}
                else -> diff = (want - cur + 7) % 7
            }
            return today.plusDays(diff.toLong()) to m.value
        }
        return null
    }

    /** 找时间：返回 ("HH:MM", 匹配到的文字) */
    fun findTime(t: String): Pair<String, String>? {
        fun fix(p: String, h0: Int, mm: Int, re: String): Pair<String, String>? {
            var hh = h0
            if (Regex("下午|傍晚|晚").containsMatchIn(p) && hh < 12) hh += 12
            if (p == "中午" && hh < 6) hh += 12
            if (hh > 23 || mm > 59) return null
            return "%02d:%02d".format(hh, mm) to re
        }
        Regex("(上午|早上|早晨|中午|下午|傍晚|晚上|晚)?\\s*(\\d{1,2})[:：](\\d{2})").find(t)?.let { m ->
            return fix(m.groupValues[1], m.groupValues[2].toInt(), m.groupValues[3].toInt(), m.value)
        }
        Regex("(上午|早上|早晨|中午|下午|傍晚|晚上|晚)?\\s*" + NUM + "\\s*[点時时](半|一刻|三刻|" + NUM + "\\s*分?)?").find(t)?.let { m ->
            val h = cnNum(m.groupValues[2])
            val g3 = m.groupValues[3]
            val mi: Int? = when { g3 == "半" -> 30; g3 == "一刻" -> 15; g3 == "三刻" -> 45; g3.isNotEmpty() -> cnNum(m.groupValues[4]); else -> 0 }
            if (h != null && mi != null) fix(m.groupValues[1], h, mi, m.value)?.let { return it }
        }
        Regex("(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)\\b", RegexOption.IGNORE_CASE).find(t)?.let { m ->
            var h = m.groupValues[1].toInt(); val mi = m.groupValues[2].ifEmpty { "0" }.toInt()
            val ap = m.groupValues[3].lowercase()
            if (ap == "pm" && h < 12) h += 12
            if (ap == "am" && h == 12) h = 0
            if (h in 0..23 && mi in 0..59) return "%02d:%02d".format(h, mi) to m.value
        }
        return null
    }

    private val BULLET = Regex("^\\s*(?:[-*•·◦●○▪▫■□☐☑✅✔✓√×✗]|\\[\\s?[xX✓ ]?\\s?]|\\d{1,3}[.、)）]|[（(]\\d{1,3}[)）])\\s*")
    private val DONE = Regex("^\\s*(?:[-*]?\\s*\\[[xX✓]]|☑|✅|✔|✓|√)")
    private val HW = Regex("作业|习题|练习册|报告|论文|提交|交到|上交|ddl|截止", RegexOption.IGNORE_CASE)

    private fun clean(s: String) = s.replace(Regex("^[\\s,，;；:：、\\-–—]+|[\\s,，;；:：、\\-–—]+$"), "").replace(Regex("\\s{2,}"), " ")

    fun parse(text: String, today: LocalDate = LocalDate.now()): List<MemoRow> {
        val out = ArrayList<MemoRow>()
        val seen = HashSet<String>()
        var ctxDay: LocalDate? = null
        var ctxTime = ""
        for (raw in text.replace("\r", "").split("\n")) {
            if (raw.isBlank()) { ctxDay = null; ctxTime = ""; continue }
            val done = DONE.containsMatchIn(raw)
            var t = raw
            repeat(3) { if (BULLET.containsMatchIn(t)) t = t.replaceFirst(BULLET, "") }
            t = t.trim()
            if (t.isEmpty()) continue
            val dm = findDate(t, today)
            val tm = findTime(t)
            var rest = t
            if (tm != null) rest = rest.replaceFirst(tm.second, " ")
            if (dm != null) rest = if (rest.contains(dm.second)) rest.replaceFirst(dm.second, " ") else rest.replace(Regex("(^|\\s)[明今]\\s"), " ")
            rest = clean(rest.replace(Regex("[（(]\\s*[)）]"), "").replace(Regex("^\\s*(之前|以前|前)(?=\\S)"), ""))
            // 只有日期的一行：下面几行都算这一天
            if (dm != null && (rest.isEmpty() || Regex("^(要做的|待办|安排|计划|事项|todo)$", RegexOption.IGNORE_CASE).matches(rest))) {
                ctxDay = dm.first; ctxTime = tm?.first ?: ""; continue
            }
            // 「## 标题」「【学习】」这种分组标题不当事项
            if (Regex("^#{1,6}\\s").containsMatchIn(raw.trim()) || Regex("^【[^】]{1,12}】$").matches(t) || (Regex("[:：]$").containsMatchIn(t) && dm == null && t.length <= 12)) {
                ctxDay = null; ctxTime = ""; continue
            }
            val day = dm?.first ?: ctxDay
            val time = tm?.first ?: (if (dm == null) ctxTime else "")
            var subject = rest.ifEmpty { t }
            var note = ""
            if (subject.length > 40) { note = subject; subject = subject.take(30) + "…" }
            if (!seen.add(subject + "|" + (day?.toString() ?: ""))) continue
            out.add(MemoRow(subject, note, done, day, time, HW.containsMatchIn(t)))
            if (out.size >= 300) break
        }
        return out
    }

    /** 一句话记事（小组件、快捷方式、通知栏开关用）：「明天下午3点交实验报告 @B302」 */
    fun quick(text: String, today: LocalDate = LocalDate.now()): MemoRow? {
        val line = text.trim().lineSequence().firstOrNull()?.trim().orEmpty()
        if (line.isEmpty()) return null
        var place = ""
        val at = Regex("[@＠]\\s*(\\S+)\\s*$").find(line)
        val body = if (at != null) { place = at.groupValues[1]; line.substring(0, at.range.first).trim() } else line
        val r = parse(body, today).firstOrNull() ?: return MemoRow(body, "", false, null, "", false, place)
        return r.copy(place = place)
    }
}
