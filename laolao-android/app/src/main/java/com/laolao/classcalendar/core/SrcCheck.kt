package com.laolao.classcalendar.core

/**
 * 7.1 原文对照（和网页 app.js 的 srcHtml()、小程序 lib/srccheck.js 同一套规则）：
 * 每条事项下面放出它来自的那句原话，日期 / 时间（t）、地点（l）、「截止 / 必须 / 带上」（k）标颜色；
 * 原话里没写、是捞捞推测出来的，直接说出来：核对只要扫一眼。
 */
object SrcCheck {
    class Seg(val t: String, val c: String)
    class Result(val segs: List<Seg>, val notes: List<String>) { val note: String get() = notes.joinToString("；") }

    private val SRC_T = Regex("(?:大?后天|明天|明早|明晚|今天|今晚|今早|(?:下下|下|这|本)?(?:周|星期|礼拜)[一二三四五六日天末]|\\d{4}[-/.年]\\d{1,2}[-/.月]\\d{1,2}[日号]?|\\d{1,2}\\s*月\\s*\\d{1,2}\\s*[日号]?|\\d{1,2}[./]\\d{1,2}(?![\\d./])|(?:上午|早上|中午|下午|傍晚|晚上|晚)?\\s*\\d{1,2}[:：]\\d{2}|(?:上午|早上|中午|下午|傍晚|晚上|晚)?\\s*[\\d一二三四五六七八九十两]{1,3}\\s*[点时](?:半|一刻|三刻|\\d{1,2}分?)?)")
    private val SRC_K = Regex("截止|之前|以前|前交|前提交|ddl|deadline|务必|必须|带上|携带", RegexOption.IGNORE_CASE)
    private val SHORT_DATE = Regex("^\\d{1,2}[./]\\d{1,2}$")
    private const val WK = "一二三四五六日"

    /** 原文：src_text 优先；original 是「（由 xx 手动发布）」这种的不算 */
    fun origOf(original: String): String = if (original.isNotEmpty() && !original.startsWith("（由")) original else ""

    /** day：事项的日期（YYYY-MM-DD，没有就空）；hasTime：事项有没有日期（网页的 event_time 非空） */
    fun check(srcText: String, original: String, location: String, eventTime: String): Result? {
        val src = srcText.ifEmpty { origOf(original) }.trim()
        if (src.isEmpty()) return null
        class M(val s: Int, val e: Int, val c: String)
        val marks = mutableListOf<M>()
        fun add(re: Regex, cls: String) {
            var from = 0
            while (from <= src.length) {
                val m = re.find(src, from) ?: break
                if (m.value.isEmpty()) { from = m.range.first + 1; continue }
                // 「3.5」这种短日期：前面紧挨着数字或小数点的不算（比如 12.3.5、3.14）
                if (cls == "t" && SHORT_DATE.matches(m.value) && m.range.first > 0 && (src[m.range.first - 1].isDigit() || src[m.range.first - 1] == '.')) { from = m.range.first + 1; continue }
                marks += M(m.range.first, m.range.last + 1, cls)
                from = m.range.last + 1
            }
        }
        add(SRC_T, "t"); add(SRC_K, "k")
        val loc = location.removePrefix("📍").trim()
        if (loc.length >= 2) { var i = src.indexOf(loc); while (i >= 0) { marks += M(i, i + loc.length, "l"); i = src.indexOf(loc, i + loc.length) } }
        marks.sortWith(compareBy<M> { it.s }.thenByDescending { it.e })
        val segs = mutableListOf<Seg>(); var at = 0; var hasT = false
        for (m in marks) {
            if (m.s < at) continue
            if (m.s > at) segs += Seg(src.substring(at, m.s), "")
            segs += Seg(src.substring(m.s, m.e), m.c); at = m.e
            if (m.c == "t") hasT = true
        }
        if (at < src.length) segs += Seg(src.substring(at), "")
        val notes = mutableListOf<String>()
        if (eventTime.isNotEmpty() && !hasT) notes += "原文没写时间，日期是捞捞推测的"
        if (loc.isNotEmpty() && !src.contains(loc)) notes += "地点是按以前的说法推测的"
        // 原文写了「周三」，日期却不是周三：提醒核对
        val wd = Regex("(?:周|星期|礼拜)([一二三四五六日天])").find(src); val day = eventTime.take(10)
        if (wd != null && Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(day)) {
            val w = wd.groupValues[1]; val want = WK.indexOf(if (w == "天") "日" else w) + 1
            val got = try { java.time.LocalDate.parse(day).dayOfWeek.value } catch (e: Exception) { 0 }
            if (want > 0 && got > 0 && want != got) notes += "原文写的是周$w，但这个日期是周${WK[got - 1]}，请核对"
        }
        return Result(segs, notes)
    }
}
