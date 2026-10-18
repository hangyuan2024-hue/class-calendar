package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth

/**
 * 6.2 备忘录：我的事项里的「清单、重复、置顶、搜索」。和网页 / 小程序 / 电脑版的 memo-core.js 同一套规则（测试用同样的例子）。
 * 我的事项（personal_events_v1）里多的字段：list [{t, d}] 清单、rep 重复（day / weekday / week / month / year）、pin 置顶、reps 完成过几次
 */
object MemoCore {
    class Li(val t: String, val d: Boolean)

    // ---------- 重复 ----------
    val REPS = listOf("" to "不重复", "day" to "每天", "weekday" to "工作日", "week" to "每周", "month" to "每月", "year" to "每年")
    fun repName(rep: String): String = REPS.drop(1).firstOrNull { it.first == rep }?.second ?: ""
    fun nextDay(day: String, rep: String): String {
        val d = try { LocalDate.parse(day) } catch (_: Exception) { return "" }
        val n = when (rep) {
            "day" -> d.plusDays(1)
            "weekday" -> { var x = d.plusDays(1); while (x.dayOfWeek == DayOfWeek.SATURDAY || x.dayOfWeek == DayOfWeek.SUNDAY) x = x.plusDays(1); x }
            "week" -> d.plusDays(7)
            "month" -> { val ym = YearMonth.from(d).plusMonths(1); ym.atDay(minOf(d.dayOfMonth, ym.lengthOfMonth())) }   // 31 号 → 下个月没有就排到月底
            "year" -> { val ym = YearMonth.of(d.year + 1, d.month); ym.atDay(minOf(d.dayOfMonth, ym.lengthOfMonth())) }
            else -> return ""
        }
        return n.toString()
    }
    /** 勾完成：重复的事项排到今天之后的下一次，清单清空重来；返回要合并进记录的字段，不重复的返回 null */
    fun complete(rec: JSONObject, today: String): JSONObject? {
        val rep = rec.str("rep"); if (repName(rep).isEmpty()) return null
        val et = rec.str("event_time"); val day = et.take(10); val time = if (et.length >= 16) et.substring(11, 16) else ""
        if (!Regex("^\\d{4}-\\d{2}-\\d{2}$").matches(day)) return null
        var n = nextDay(day, rep); var guard = 0
        while (n.isNotEmpty() && n <= today && guard++ < 800) n = nextDay(n, rep)
        if (n.isEmpty()) return null
        val list = JSONArray(); for (i in listOf(rec)) list.put(JSONObject().put("t", i.t).put("d", false))
        return JSONObject().put("event_time", n + if (time.isNotEmpty()) " $time" else "").put("done", false)
            .put("reps", rec.optInt("reps", 0) + 1).put("list", list)
    }

    // ---------- 清单 ----------
    private val MARK_DONE = Regex("^\\s*(\\[[xX✓√]\\]|☑|✅|✓|√)\\s*")
    private val MARK_TODO = Regex("^\\s*(\\[\\s?\\]|☐|□|○|[-*•·]|\\d+[.、)）])\\s*")
    fun listOf(rec: JSONObject): List<Li> {
        val a = rec.optJSONArray("list") ?: return emptyList()
        val out = mutableListOf<Li>()
        for (i in 0 until a.length()) { val o = a.optJSONObject(i) ?: continue; val t = o.str("t").trim(); if (t.isNotEmpty() && out.size < 100) out += Li(t.take(200), o.optBoolean("d")) }
        return out
    }
    /** 编辑框里每行一项；行首写 ✓ / [x] 表示已经做完；原来勾过的同名项保留勾 */
    fun listFromText(text: String, old: List<Li> = emptyList()): List<Li> {
        val was = old.filter { it.d }.map { it.t }.toSet()
        val out = mutableListOf<Li>()
        for (line in text.split("\n")) {
            val d = MARK_DONE.containsMatchIn(line)
            val t = line.replace(MARK_DONE, "").replace(MARK_TODO, "").trim()
            if (t.isNotEmpty() && out.size < 100) out += Li(t.take(200), d || t in was)
        }
        return out
    }
    fun listToText(list: List<Li>): String = list.joinToString("\n") { (if (it.d) "✓ " else "") + it.t }
    fun toJson(list: List<Li>): JSONArray = JSONArray().apply { for (x in list) put(JSONObject().put("t", x.t).put("d", x.d)) }
    fun statText(list: List<Li>): String = if (list.isEmpty()) "" else "${list.count { it.d }}/${list.size}"
    fun looksLikeList(text: String): Boolean {
        val lines = text.split("\n").filter { it.isNotBlank() }
        return lines.size >= 2 && lines.count { MARK_TODO.containsMatchIn(it) || MARK_DONE.containsMatchIn(it) } >= (lines.size * 0.6).let { Math.ceil(it).toInt() }
    }

    // ---------- 搜索：空格分开的几个词都要出现（不分大小写、不管空格） ----------
    private fun norm(s: String) = s.lowercase().replace(Regex("\\s+"), "")
    fun match(hay: String, q: String): Boolean {
        val words = q.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return false
        val h = norm(hay)
        return words.all { h.contains(norm(it)) }
    }
}
