package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject

/**
 * 成长：完成记录、习惯打卡、进度环、趋势（和网页、小程序同一套数据：done_log_v1、habits_v1、habit_log_v1）
 */
object Growth {
    const val HABITS = "habits_v1"
    const val HLOG = "habit_log_v1"
    val EMO = listOf("📖", "🏃", "💧", "🧘", "✍️", "🎹", "😴", "🍎", "🗣️", "💪", "🧹", "🎨", "🧠", "🌱", "☀️", "📝")
    val SUGG = listOf("📖" to "阅读 30 分钟", "🗣️" to "背 30 个单词", "🏃" to "跑步 / 阳光跑", "😴" to "12 点前睡觉", "💧" to "喝够 8 杯水")

    class Habit(val id: String, val name: String, val icon: String)
    fun habits(): List<Habit> = Kv.arr(HABITS).objs().filter { it.str("id").isNotEmpty() }.map { Habit(it.str("id"), it.str("name"), it.str("icon").ifEmpty { "✅" }) }
    fun log(): JSONObject = Kv.obj(HLOG)
    fun doneLog(): JSONObject = Kv.obj(Items.DONE_LOG)
    private fun on(log: JSONObject, id: String, d: String): Boolean = log.optJSONObject(id)?.optBoolean(d) ?: false

    fun streak(id: String, log: JSONObject = log()): Int {
        var k = T.todayKey(); var n = 0
        if (!on(log, id, k)) k = T.addDays(k, -1)
        while (on(log, id, k)) { n++; k = T.addDays(k, -1) }
        return n
    }
    fun total(id: String, log: JSONObject = log()): Int { val l = log.optJSONObject(id) ?: return 0; return l.keys().asSequence().count { l.optBoolean(it) } }

    /** 打卡 / 取消打卡，返回打上了没有 */
    fun toggle(id: String): Boolean {
        val t = T.todayKey(); val all = log(); val l = all.optJSONObject(id) ?: JSONObject()
        val now = !l.optBoolean(t)
        if (now) l.put(t, true) else l.remove(t)
        all.put(id, l); Kv.set(HLOG, all)
        if (now) Coach.record(Coach.Ev(System.currentTimeMillis(), "habit", id))
        val c = Store.cls
        if (c != null && !c.optBoolean("is_teacher") && Store.feat("rank")) Bg.run { try { Api.rpc("growth_log", jsonOf("cid" to c.str("id"), "k" to "habit", "r" to "$id|$t", "undo" to !now)) } catch (_: Exception) {} }
        Bus.emit("data")
        return now
    }
    fun add(name: String, icon: String): Boolean {
        val n = name.trim(); if (n.isEmpty()) return false
        val list = Kv.arr(HABITS)
        if (list.objs().any { it.str("name") == n }) return false
        list.put(jsonOf("id" to "h" + System.currentTimeMillis(), "name" to n.take(16), "icon" to icon))
        Kv.set(HABITS, list); Bus.emit("data"); return true
    }
    fun update(id: String, name: String? = null, icon: String? = null) {
        val list = Kv.arr(HABITS)
        for (x in list.objs()) if (x.str("id") == id) { if (name != null) x.put("name", name.take(16)); if (icon != null) x.put("icon", icon) }
        Kv.set(HABITS, list); Bus.emit("data")
    }
    fun remove(id: String) {
        Kv.set(HABITS, JSONArray(Kv.arr(HABITS).objs().filter { it.str("id") != id }))
        val l = log(); if (l.has(id)) { l.remove(id); Kv.set(HLOG, l) }
        Bus.emit("data")
    }

    /** 本周作业、本周事项、今天打卡 */
    class Ring(val label: String, val done: Int, val total: Int, val color: Int)
    fun rings(red: Int, blue: Int, green: Int): List<Ring> {
        val t = T.todayKey(); val mon = Items.weekStart(0); val sun = T.addDays(mon, 6)
        val list = Items.all().filter { !it.course && it.dated && it.day >= mon && it.day <= sun }
        val hw = list.filter { it.hw }
        val hs = habits(); val lg = log()
        return listOf(Ring("本周作业", hw.count { it.done }, hw.size, red), Ring("本周事项", list.count { it.done }, list.size, blue),
            Ring("今日打卡", hs.count { on(lg, it.id, t) }, hs.size, green))
    }

    /** 最近 n 天：每天完成几件事、打了几次卡 */
    fun trend(n: Int): List<Triple<String, Int, Int>> {
        val t = T.todayKey(); val dl = doneLog(); val hl = log(); val hs = habits()
        val per = HashMap<String, Int>()
        for (k in dl.keys()) { val d = dl.optString(k); per[d] = (per[d] ?: 0) + 1 }
        return (n - 1 downTo 0).map { i -> val d = T.addDays(t, -i.toLong()); Triple(d, per[d] ?: 0, hs.count { on(hl, it.id, d) }) }
    }
    /** 某个习惯最近 n 天打没打卡 */
    fun cells(id: String, n: Int, log: JSONObject = log()): List<Boolean> { val t = T.todayKey(); return (n - 1 downTo 0).map { on(log, id, T.addDays(t, -it.toLong())) } }
    fun checked(id: String): Boolean = on(log(), id, T.todayKey())

    /** 最近完成的事（按天分组） */
    fun recentDone(limit: Int): List<Pair<String, List<Item>>> {
        val dl = doneLog(); val all = Items.all(showHidden = true).associateBy { it.key }
        val keys = dl.keys().asSequence().filter { all[it]?.done == true }.sortedByDescending { dl.optString(it) }.take(limit).toList()
        return keys.groupBy { dl.optString(it) }.map { (d, ks) -> d to ks.mapNotNull { all[it] } }
    }
}
