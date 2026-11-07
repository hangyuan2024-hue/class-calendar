package com.laolao.classcalendar.ui

import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import org.json.JSONObject

/**
 * 7.x 首页「捞捞推荐」：按现在几点、今天有什么，推荐此刻最可能想看的 1~2 件事。
 * 早上看今天第一节课和要带的东西，课前看下节课在哪，晚上看明天要交的作业、背单词、写日记，深夜看明天的安排……
 * 长按一条可以说「不喜欢」：这个时段不再推荐 / 今天不再显示 / 以后都不推荐（只存这台手机，home_rec_v1）。
 * 点过的会记一下，同一个时段下次排得更靠前。
 */
object Rec {
    private const val LS = "home_rec_v1"
    class S(val id: String, val icon: String, val title: String, val sub: String, val score: Double, val go: (Main) -> Unit)

    /** 时段：早上 / 上午 / 中午 / 下午 / 傍晚 / 晚上 / 深夜 */
    fun slot(h: Int = T.now().hour): String = when (h) { in 5..8 -> "morning"; in 9..10 -> "am"; in 11..13 -> "noon"; in 14..16 -> "pm"; in 17..18 -> "dusk"; in 19..22 -> "night"; else -> "late" }
    private fun st(): JSONObject = Kv.obj(LS)
    private fun save(o: JSONObject) = Kv.setQuiet(LS, o)
    private fun banned(id: String, slot: String): Boolean {
        val o = st()
        if (o.optJSONObject("never")?.optBoolean(id) == true) return true
        if (o.optJSONObject("slot")?.optBoolean("$id|$slot") == true) return true
        val d = o.optJSONObject("day"); return d?.optString("k") == T.todayKey() && d.optJSONObject("ids")?.optBoolean(id) == true
    }
    private fun likes(id: String, slot: String): Int = st().optJSONObject("like")?.optInt("$id|$slot") ?: 0
    fun liked(id: String) { val o = st(); val l = o.optJSONObject("like") ?: JSONObject(); val k = id + "|" + slot(); l.put(k, minOf(10, l.optInt(k) + 1)); o.put("like", l); save(o) }
    fun dislike(id: String, how: Int) {
        val o = st()
        when (how) {
            0 -> { val m = o.optJSONObject("slot") ?: JSONObject(); m.put(id + "|" + slot(), true); o.put("slot", m) }
            1 -> { var d = o.optJSONObject("day"); if (d?.optString("k") != T.todayKey()) d = JSONObject().put("k", T.todayKey()).put("ids", JSONObject()); d!!.getJSONObject("ids").put(id, true); o.put("day", d) }
            else -> { val m = o.optJSONObject("never") ?: JSONObject(); m.put(id, true); o.put("never", m) }
        }
        save(o)
    }
    fun resetAll() = Kv.setQuiet(LS, null)

    /** 现在推荐什么（最多 n 条） */
    fun pick(n: Int = 2): List<S> {
        val now = T.now(); val h = now.hour; val mm = h * 60 + now.minute; val sl = slot(h); val t0 = T.todayKey(); val t1 = T.addDays(t0, 1L)
        val out = mutableListOf<S>()
        fun add(id: String, icon: String, title: String, sub: String, base: Double, go: (Main) -> Unit) { out += S(id, icon, title, sub, base + likes(id, sl) * 0.6, go) }
        val lessons = try { if (Store.feat("courses")) Courses.on(t0) else emptyList() } catch (_: Exception) { emptyList() }
        // 课：早上看今天第一节，白天看马上要上的那节
        val next = lessons.filter { (it.m0 ?: -1) > mm }.minByOrNull { it.m0 ?: 9999 }
        if (next != null) {
            val left = (next.m0 ?: mm) - mm
            if (h in 5..8 && lessons.none { (it.m0 ?: 9999) <= mm }) add("first", "📚", "今天第一节：${next.name}", next.t0 + (if (next.location.isNotEmpty()) " · " + next.location else "") + " · 今天一共 ${lessons.size} 节", 9.0) { a -> a.push(CoursePage(a)) }
            else if (left <= 90) add("nextc", "📚", "下节课：${next.name}", "还有 $left 分钟 · " + next.t0 + if (next.location.isNotEmpty()) " · " + next.location else "", 8.5) { a -> a.push(CoursePage(a)) }
        }
        val all = try { Items.all() } catch (_: Exception) { emptyList() }
        // 今天要带的东西（早上、出门前）
        val bring = all.filter { it.day == t0 && !it.done && it.prepare.isNotBlank() }
        if (bring.isNotEmpty() && h in 5..13) add("bring", "🎒", "今天要带：" + bring.joinToString("、") { it.prepare }.take(30), bring.joinToString("、") { it.title }.take(30), 7.5) { a -> a.selectTab(0) }
        // 作业：傍晚、晚上看今晚 / 明天要交的
        val H = try { Items.homeworkAll() } catch (_: Exception) { null }
        val todayHw = H?.groups?.firstOrNull { it.key == "today" }?.items?.size ?: 0
        val tmrHw = H?.groups?.firstOrNull { it.key == "tomorrow" }?.items?.size ?: 0
        if (Store.feat("homework") && todayHw + tmrHw > 0 && h >= 12) add("hw", "📝", if (todayHw > 0) "今天还有 $todayHw 项作业要交" else "明天要交 $tmrHw 项作业", "趁现在做掉一项，晚上轻松点", if (h >= 17) 8.0 else 5.5) { a -> a.selectTab(1) }
        // 专注：下午、晚上没课的时候
        val busyNow = lessons.any { (it.m0 ?: 9999) <= mm && mm < (it.m1 ?: 0) }
        if (Store.feat("plan") && !busyNow && h in 13..22) add("pomo", "🍅", "来一个 25 分钟番茄", if (todayHw > 0) "先专注做作业" else "手机放一边，专心做一件事", if (sl == "night" || sl == "pm") 5.0 else 3.5) { a -> a.push(PlanPage(a, pomo = true)) }
        // 背单词：早上、晚上
        if (sl == "morning" || sl == "night" || sl == "noon") add("words", "📖", "背 10 个单词", "单词搭子 · 间隔复习，几分钟就好", if (sl == "night") 4.5 else 4.0) { a -> a.push(WordsPage(a)) }
        // 三只青蛙：上午写下今天最重要的三件事
        val frogs = try { com.laolao.classcalendar.core.TimeMaster.frogs(t0, false).filter { it.optString("title").isNotEmpty() } } catch (_: Exception) { emptyList() }
        if (frogs.isEmpty() && h in 6..11) add("frog", "🐸", "写下今天最重要的三件事", "时间管理大师 · 先吃掉最难的那只青蛙", 4.2) { a -> a.push(TimeMasterPage(a)) }
        // 考试倒计时：两周内有考试
        val exam = try { com.laolao.classcalendar.core.Tools.exams().firstOrNull { T.dayDiff(it.optString("date")) in 0..14 } } catch (_: Exception) { null }
        if (exam != null) add("exam", "⏳", "${exam.optString("subject")}还有 ${T.dayDiff(exam.optString("date"))} 天考试", "看看复习排期，今天复习哪一块", 6.0 - T.dayDiff(exam.optString("date")) * 0.1) { a -> a.push(DplanPage(a, "review")) }
        // 晚上：明天的安排、日记
        if (h >= 20 || h < 2) {
            val tl = try { if (Store.feat("courses")) Courses.on(t1) else emptyList() } catch (_: Exception) { emptyList() }
            val ti = all.count { it.day == t1 && !it.done && !it.course }
            if (tl.isNotEmpty() || ti > 0) add("tomorrow", "🗓", "看看明天：" + listOfNotNull(if (tl.isNotEmpty()) "${tl.size} 节课" else null, if (ti > 0) "$ti 件事" else null).joinToString(" · "), tl.minByOrNull { it.m0 ?: 9999 }?.let { "第一节 ${it.t0} ${it.name}" } ?: "提前准备好，明天不慌", 6.5) { a -> a.push(CalendarPage(a, pushed = true)) }
            if (Kv.get("personal_updated_$t0") == null) add("diary", "✍️", "写两句今天的日记", "今天发生了什么，记一点小事", 4.0) { a -> a.push(DiaryPage(a)) }
        }
        // 周日晚上：一周复盘
        if (now.dayOfWeek.value == 7 && h >= 18) add("week", "📊", "这周过得怎么样", "看看本周复盘和你的节奏", 5.0) { a -> a.push(CoachPage(a)) }
        // 云宠：有养料没喂
        val feed = try { if (com.laolao.classcalendar.core.Farm.on()) com.laolao.classcalendar.core.Farm.left() else 0 } catch (_: Exception) { 0 }
        if (feed >= 3 && h in 12..22) add("farm", "🐣", "云宠饿了", "攒了 $feed 份养料，去喂一下", 2.5) { a -> a.push(FarmPage(a)) }
        // 深夜：早点睡
        if (h >= 23 || h < 5) add("sleep", "💤", "早点睡吧", (try { if (Store.feat("courses")) Courses.on(if (h < 5) t0 else t1) else emptyList() } catch (_: Exception) { emptyList() }).minByOrNull { it.m0 ?: 9999 }?.let { "明天 ${it.t0} 有${it.name}" } ?: "睡饱了脑子才转得快", 7.0) { _ -> }
        return out.filter { !banned(it.id, sl) }.sortedByDescending { it.score }.take(n)
    }

    /** 首页问候卡里的推荐：一条一行，点了直接去；长按「不喜欢」 */
    fun view(a: Main, refresh: () -> Unit): View? {
        val l = pick(); if (l.isEmpty()) return null
        val box = a.col()
        l.forEachIndexed { i, s ->
            box.add(a.row().apply {
                gravity = Gravity.CENTER_VERTICAL; pad(12, 10, 10, 10); press(C.alpha(C.card, if (C.dark) 0.55f else 0.8f), 14)
                addView(Ic.tile(a, s.icon, 34), LinearLayout.LayoutParams(a.dp(34), a.dp(34)))
                addView(a.col().apply {
                    addView(a.text(s.title, 14.5f, C.text, BOLD, 1))
                    addView(a.text(s.sub, 12f, C.sub, lines = 1).apply { margins(t = 1) })
                }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = a.dp(10) })
                if (s.id != "sleep") addView(a.text("›", 18f, C.sub), LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = a.dp(6) })
                tap { liked(s.id); s.go(a) }
                setOnLongClickListener { v ->
                    v.buzz()
                    Dialogs.sheet(a, "「${s.title}」", listOf("不喜欢，这个时段别推荐", "今天先不显示", "以后都不推荐这个")) { k -> dislike(s.id, k); a.toast("好的，捞捞记住了"); refresh() }
                    true
                }
            }, if (i == 0) 0 else 6)
        }
        return box
    }
}
