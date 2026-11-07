package com.laolao.classcalendar.ui

import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.T
import org.json.JSONObject
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.sqrt

/**
 * 7.x 首页「接下来做啥」：要做的事和捞捞的建议放在一起，统一打分排序（只在这台手机上算，不上传）。
 *
 * 每张卡的分数 = 紧急程度 × 你的习惯 + 探索加分 + 场景修正：
 *  - 紧急程度：正在上的课、马上开始的课最高；有截止时间的按「还剩多久」指数衰减（越近越高）；过期作业按件数加分；
 *    捞捞的建议按时段给基础分（早上背单词、课前看教室、晚上看明天……见 Rec）。
 *  - 你的习惯：按「哪一类 × 哪个时段」记你点开 / 完成了几次、划过去跳过了几次（Beta 分布的均值），
 *    常做的排前面，总跳过的往后放。
 *  - 探索加分：很少出现过的建议给一点加分（UCB），免得永远只推那几样。
 *  - 场景修正：正在上课、20 分钟内就要上课时，不推「来个番茄」「背单词」这类要整块时间的事。
 * 长按一张卡：「2 小时后再说」暂时收起；「这个时段少推荐这类」直接降权；建议还能「以后都不推荐」。
 */
object NextAI {
    private const val LS = "next_ai_v1"
    class Card(val id: String, val cat: String, val next: Items.Next?, val rec: Rec.S?, val score: Double, val why: String, val icon: String)

    private fun st(): JSONObject = Kv.obj(LS)
    private fun save(o: JSONObject) = Kv.setQuiet(LS, o)
    private fun stat(k: String): Pair<Double, Double> { val a = st().optJSONObject("s")?.optJSONArray(k) ?: return 0.0 to 0.0; return a.optDouble(0, 0.0) to a.optDouble(1, 0.0) }
    private fun bump(k: String, like: Double, skip: Double) {
        val o = st(); val s = o.optJSONObject("s") ?: JSONObject()
        val a = s.optJSONArray(k); val l = (a?.optDouble(0, 0.0) ?: 0.0) * 0.98 + like; val sk = (a?.optDouble(1, 0.0) ?: 0.0) * 0.98 + skip   // 慢慢遗忘：最近的习惯更重要
        s.put(k, org.json.JSONArray().put(minOf(40.0, l)).put(minOf(40.0, sk))); o.put("s", s); save(o)
    }
    private fun key(cat: String) = cat + "|" + Rec.slot()

    /** 点开、完成：这一类在这个时段更受欢迎 */
    fun act(c: Card) { bump(key(c.cat), 1.0, 0.0); c.rec?.let { Rec.liked(it.id) } }
    /** 划过去没理：轻轻扣一点 */
    fun skip(c: Card) { if (c.cat != "live" && c.cat != "class") bump(key(c.cat), 0.0, 0.3) }
    /** 这个时段少推荐这类 */
    fun less(c: Card) = bump(key(c.cat), 0.0, 3.0)
    /** 暂时收起（默认 2 小时） */
    fun snooze(c: Card, ms: Long = 2 * 3600_000L) { val o = st(); val z = o.optJSONObject("z") ?: JSONObject(); z.put(c.id, System.currentTimeMillis() + ms); o.put("z", z); save(o) }
    private fun snoozed(id: String): Boolean = (st().optJSONObject("z")?.optLong(id) ?: 0L) > System.currentTimeMillis()
    fun reset() = Kv.setQuiet(LS, null)

    private fun catOf(n: Items.Next): String = when {
        n.label == "正在上" -> "live"; n.label == "下一节" || n.label == "明天" -> "class"; n.merged -> "late"
        n.label == "进行中" -> "live"; n.label == "考试" -> "exam"; n.label == "作业" -> "hw"; n.label == "会议" -> "meet"
        n.label == "活动" -> "event"; n.label == "通知" -> "notice"; n.id == "sleep" -> "sleep"; n.id == "idle" -> "idle"; else -> "todo"
    }
    private fun iconOf(cat: String): String = when (cat) {
        "live", "class" -> "📚"; "late" -> "⏰"; "exam" -> "⏳"; "hw" -> "📝"; "meet" -> "👥"; "event" -> "🎉"; "notice" -> "📢"; "sleep" -> "💤"; "idle" -> "☕"; else -> "✅"
    }

    fun rank(): List<Card> {
        val now = System.currentTimeMillis(); val nowT = T.now(); val mm = nowT.hour * 60 + nowT.minute
        val deck = try { Items.deck() } catch (_: Exception) { emptyList() }
        val recs = try { Rec.pick(6) } catch (_: Exception) { emptyList() }
        // 场景：现在在上课吗？多久后上下一节？
        val lessons = try { com.laolao.classcalendar.core.Courses.on(T.todayKey()) } catch (_: Exception) { emptyList() }
        val inClass = lessons.any { (it.m0 ?: 9999) <= mm && mm < (it.m1 ?: 0) }
        val nextIn = lessons.mapNotNull { it.m0 }.filter { it > mm }.minOrNull()?.let { it - mm } ?: 9999
        val total = (st().optJSONObject("s")?.length() ?: 0) + 1
        val out = mutableListOf<Card>()
        for (n in deck) {
            if (snoozed(n.id)) continue
            val cat = catOf(n)
            if (cat == "idle" && recs.isNotEmpty()) continue
            if (cat == "sleep" && recs.any { it.id == "sleep" }) continue
            val mins = if (n.at > 0) (n.at - now) / 60000.0 else null
            val w = when (cat) { "exam" -> 1.1; "hw" -> 1.0; "meet" -> 0.95; "event" -> 0.85; "notice" -> 0.7; else -> 0.8 }
            val prior = when (cat) {
                "live" -> 100.0
                "class" -> if (n.label == "明天") 30.0 else 96.0 - (mins ?: 180.0) * 0.4
                "late" -> 50.0 + minOf(12.0, n.title.filter { it.isDigit() }.toIntOrNull()?.times(2.0) ?: 2.0)
                "sleep" -> 62.0
                "idle" -> 5.0
                else -> if (mins != null) 10.0 + 80.0 * exp(-maxOf(0.0, mins) / 240.0) * w else 40.0 * w
            }
            val (l, s) = stat(key(cat)); val p = (l + 1) / (l + s + 2)
            val score = if (cat == "live") 1000.0 else prior * (0.7 + 0.6 * p)
            val why = when {
                cat == "late" -> "越拖越难补，先补一项"
                l >= 3 && p > 0.65 -> "你平时这个时候常做这类事"
                else -> ""
            }
            out += Card(n.id, cat, n, null, score, why, iconOf(cat))
        }
        for (r in recs) {
            val id = "rec:" + r.id
            if (snoozed(id)) continue
            val cat = "rec_" + r.id
            var prior = r.score * 7.0
            if ((inClass || nextIn <= 20) && r.id in setOf("pomo", "words", "frog", "diary", "farm", "week")) prior -= 30.0
            val (l, s) = stat(key(cat)); val p = (l + 1) / (l + s + 2)
            val bonus = 5.0 * sqrt(ln(total + 1.0) / (l + s + 1.0))
            val why = if (l >= 3 && p > 0.65) "你平时这个时候常点这个" else ""
            out += Card(id, cat, null, r, prior * (0.7 + 0.6 * p) + bonus, why, r.icon)
        }
        return out.sortedByDescending { it.score }.take(10)
    }
}
