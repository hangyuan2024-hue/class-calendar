package com.laolao.classcalendar.core

import org.json.JSONObject

/**
 * 规划与专注：番茄钟 + 四象限（和网页、小程序同一套数据：pomo_state_v1 只存本机，pomo_log_v1、quad_v1 跟着账号同步）
 */
object Plan {
    const val POMO = "pomo_state_v1"
    const val POMO_LOG = "pomo_log_v1"
    const val QUAD = "quad_v1"
    const val BREAK_MIN = 5
    val QUADS = listOf(
        Triple("重要且紧急", "马上做", "两天内截止的作业、会议，先把它们解决"),
        Triple("重要不紧急", "计划做", "复习、长期作业、习惯——最值得投入时间的地方"),
        Triple("紧急不重要", "尽快处理", "填表、报名这类小事，花几分钟打发掉"),
        Triple("不重要不紧急", "少做", "有空再说，别让它占用整块时间"),
    )

    // ---------- 番茄钟 ----------
    /** mode：idle 准备 / focus 专注 / break 休息 / paused 暂停 */
    class Pomo(val len: Int, val mode: String, val end: Long, val left: Long, val task: String)
    fun pomo(): Pomo {
        val o = Kv.obj(POMO)
        val m = o.str("mode").takeIf { it in setOf("idle", "focus", "break", "paused") } ?: "idle"
        return Pomo(o.optInt("len", 25).takeIf { it in setOf(15, 25, 45) } ?: 25, m, o.optLong("end"), o.optLong("left"), o.str("task"))
    }
    private fun save(p: Pomo) = Kv.setQuiet(POMO, jsonOf("len" to p.len, "mode" to p.mode, "end" to p.end, "left" to p.left, "task" to p.task))
    fun log(): JSONObject = Kv.obj(POMO_LOG)
    fun today(): Int = log().optInt(T.todayKey())
    fun week(): Int { val l = log(); val t = T.todayKey(); return (0..6).sumOf { l.optInt(T.addDays(t, -it.toLong())) } }

    /** 到点了：专注 → 记一个番茄，进入休息；休息 → 回到准备。返回刚结束的是什么（"focus" / "break" / ""） */
    fun tick(): String {
        val p = pomo(); val now = System.currentTimeMillis()
        if ((p.mode == "focus" || p.mode == "break") && now >= p.end) {
            if (p.mode == "focus") {
                val t = T.todayKey(); val l = log(); l.put(t, l.optInt(t) + 1); Kv.set(POMO_LOG, l)
                Coach.record(Coach.Ev(now, "pomo", p.task ?: "", m = p.len))     // 番茄钟是真计时，教练最信这个
                val c = Store.cls
                if (c != null && !c.optBoolean("is_teacher") && Store.feat("rank")) Bg.run { try { Api.rpc("growth_log", jsonOf("cid" to c.str("id"), "k" to "pomo", "r" to "$t|${l.optInt(t)}", "undo" to false)) } catch (_: Exception) {} }
                save(Pomo(p.len, "break", p.end + BREAK_MIN * 60_000L, 0, p.task))
                Bus.emit("data"); return "focus"
            }
            save(Pomo(p.len, "idle", 0, 0, p.task)); return "break"
        }
        return ""
    }
    fun start(task: String?) {
        val p = pomo(); val now = System.currentTimeMillis()
        save(when (p.mode) {
            "paused" -> Pomo(p.len, "focus", now + p.left, 0, p.task)
            "break" -> Pomo(p.len, "idle", 0, 0, p.task)
            else -> Pomo(p.len, "focus", now + p.len * 60_000L, 0, task ?: p.task)
        })
    }
    fun pause() { val p = pomo(); if (p.mode == "focus") save(Pomo(p.len, "paused", 0, maxOf(0, p.end - System.currentTimeMillis()), p.task)) }
    fun stop() { val p = pomo(); save(Pomo(p.len, "idle", 0, 0, p.task)) }
    fun setLen(n: Int) { val p = pomo(); if (p.mode == "idle" && n in setOf(15, 25, 45)) save(Pomo(n, p.mode, p.end, p.left, p.task)) }
    /** 剩多少毫秒、总共多少毫秒 */
    fun left(): Pair<Long, Long> {
        val p = pomo(); val total = (if (p.mode == "break") BREAK_MIN else p.len) * 60_000L
        val left = when (p.mode) { "focus", "break" -> p.end - System.currentTimeMillis(); "paused" -> p.left; else -> total }
        return maxOf(0, left) to total
    }
    fun fmt(ms: Long): String { val s = Math.round(ms / 1000.0); return String.format("%02d:%02d", s / 60, s % 60) }

    // ---------- 四象限 ----------
    fun autoQuad(r: Item): Int {
        val n = if (r.dated) T.dayDiff(r.day) else 99
        val urgent = n <= 2
        val important = r.mine || r.hw || r.type == "会议"
        return if (important) (if (urgent) 1 else 2) else (if (urgent) 3 else 4)
    }
    /** 前后两周内的事 + 没日期的；已完成的只留今天完成的 */
    fun quads(): List<List<Item>> {
        val qm = Kv.obj(QUAD); val dl = Kv.obj(Items.DONE_LOG); val t = T.todayKey()
        val list = Items.all().filter { !it.course && (!it.dated || T.dayDiff(it.day) in -14..14) && (!it.done || dl.optString(it.key) == t) }
        val q = list.groupBy { qm.optInt(it.key).takeIf { n -> n in 1..4 } ?: autoQuad(it) }
        return (1..4).map { n -> (q[n] ?: emptyList()).sortedWith(compareBy<Item>({ it.done }, { it.day.ifEmpty { "9" } })) }
    }
    fun move(key: String, q: Int) { val m = Kv.obj(QUAD); m.put(key, q); Kv.set(QUAD, m); Bus.emit("data") }
    fun addTodo(text: String, q: Int) {
        val id = "p" + System.currentTimeMillis()
        Items.saveMine(jsonOf("id" to id, "subject" to text.trim(), "event_time" to "", "location" to "", "note" to "", "done" to false))
        move(id, q)
    }

    // ---------- PDCA / SMART / 六件事（plan_notes_v1，和网页、小程序同一份，跟着账号同步） ----------
    const val NOTES = "plan_notes_v1"
    class Method(val id: String, val icon: String, val name: String, val tag: String, val intro: String)
    val METHODS = listOf(
        Method("quad", "🎯", "四象限", "分清轻重缓急", "按「重要」和「紧急」把事情分成四类：①马上做；②排进计划，最值得投入；③尽快处理或请人帮忙；④少做或不做。每天先清空第①格，把大块时间留给第②格。"),
        Method("pdca", "🔄", "PDCA", "计划 → 执行 → 检查 → 改进", "把一件事分成四步，一轮一轮做得更好：P 计划：定目标、想方法；D 执行：按计划去做；C 检查：对照目标看效果；A 改进：好的方法保留，没解决的放进下一轮。适合备考、学技能、准备比赛。"),
        Method("smart", "🏹", "SMART", "把目标定清楚", "好目标要满足五点：S 具体、M 可衡量、A 可实现、R 相关、T 有时限。例子：把「我要学好英语」改成「11 月 30 日前每天背 30 个四级单词，周末自测正确率达到 80%」。"),
        Method("ivy", "📋", "六件事", "每天只排最重要的 6 件", "每天睡前写下明天最重要的 6 件事，按重要程度排好；第二天从第 1 件开始做，做完一件再做下一件；没做完的移到第二天。"),
    )
    val PD = listOf(Triple("p", "P 计划", "目标是什么？打算怎么做？"), Triple("d", "D 执行", "实际做了什么？记录过程"), Triple("c", "C 检查", "效果怎么样？和目标差多少？问题在哪？"), Triple("a", "A 改进", "哪些做法保留？哪些问题放进下一轮？"))
    val SM = listOf(Triple("s", "S 具体", "要做成什么样？越具体越好"), Triple("m", "M 可衡量", "用什么数字判断完成了？"), Triple("a", "A 可实现", "需要什么条件？每天做多少？"), Triple("r", "R 相关", "为什么这件事对你重要？"))
    fun notes(): JSONObject = Kv.obj(NOTES)
    fun setNote(key: String, v: Any?) { val n = notes(); if (v == null) n.remove(key) else n.put(key, v); Kv.set(NOTES, n); Bus.emit("data") }
    fun cur(): String = notes().optString("cur").takeIf { c -> METHODS.any { it.id == c } } ?: "quad"
    fun setCur(id: String) { if (METHODS.any { it.id == id }) setNote("cur", id) }
    private fun pid() = java.lang.Long.toString(System.currentTimeMillis(), 36) + (1000..9999).random()
    fun notesOf(pre: String): List<Pair<String, JSONObject>> { val n = notes(); return n.keys().asSequence().filter { it.startsWith(pre) }.mapNotNull { k -> n.optJSONObject(k)?.let { k to it } }.sortedByDescending { it.second.optLong("at") }.toList() }
    fun get(key: String): JSONObject? = notes().optJSONObject(key)
    fun patch(key: String, f: String, v: String) { val x = get(key) ?: return; x.put(f, v.trim()); setNote(key, x) }
    fun pdcaAdd(title: String) = setNote("pdca:" + pid(), jsonOf("title" to title.trim(), "stage" to 0, "round" to 1, "at" to System.currentTimeMillis()))
    fun pdcaNext(key: String) { val x = get(key) ?: return; x.put("stage", minOf(3, x.optInt("stage") + 1)); setNote(key, x) }
    fun pdcaRound(key: String) { val x = get(key) ?: return; setNote(key, jsonOf("title" to x.str("title"), "stage" to 0, "round" to x.optInt("round", 1) + 1, "at" to System.currentTimeMillis(), "p" to if (x.str("a").isNotEmpty()) "上一轮的改进：" + x.str("a") else "")) }
    fun smartAdd(title: String) = setNote("smart:" + pid(), jsonOf("title" to title.trim(), "at" to System.currentTimeMillis()))
    fun smartDone(key: String): Boolean { val x = get(key) ?: return false; x.put("done", !x.optBoolean("done")); setNote(key, x); return x.optBoolean("done") }
    fun smartMissing(x: JSONObject): List<String> = SM.filter { x.str(it.first).isBlank() }.map { it.second.substring(2) } + if (x.str("t").isEmpty()) listOf("截止日期") else emptyList()
    /** SMART 目标放进日历：变成一条「我的事项」，id = g + 目标 id（重复点只会更新） */
    fun smartToCal(key: String): Boolean {
        val x = get(key) ?: return false; if (x.str("t").isEmpty()) return false
        val id = "g" + key.substring(6); val old = Items.mineRecord(id)
        Items.saveMine(jsonOf("id" to id, "subject" to "🎯 " + x.str("title"), "event_time" to x.str("t"), "location" to "",
            "note" to listOf(x.str("s"), if (x.str("m").isNotEmpty()) "衡量：" + x.str("m") else "").filter { it.isNotEmpty() }.joinToString("\n"), "done" to (old?.optBoolean("done") ?: false)))
        return true
    }
    fun inCal(key: String) = Items.mineRecord("g" + key.substring(6)) != null
    fun ivy(day: String): MutableList<JSONObject> {
        val a = notes().optJSONArray("ivy:$day"); val l = mutableListOf<JSONObject>()
        if (a != null) for (i in 0 until minOf(6, a.length())) l += (a.optJSONObject(i) ?: JSONObject()).let { jsonOf("text" to it.str("text"), "done" to it.optBoolean("done")) }
        while (l.size < 6) l += jsonOf("text" to "", "done" to false)
        return l
    }
    fun ivySet(day: String, l: List<JSONObject>) = setNote("ivy:$day", if (l.any { it.str("text").isNotEmpty() }) org.json.JSONArray(l) else null)
    /** 今天没做完的挪到明天 */
    fun ivyMoveLeft(): Int {
        val t = T.todayKey(); val tm = T.addDays(t, 1)
        val today = ivy(t); val left = today.filter { it.str("text").isNotEmpty() && !it.optBoolean("done") }
        val merged = (left.map { jsonOf("text" to it.str("text"), "done" to false) } + ivy(tm).filter { it.str("text").isNotEmpty() }).take(6)
        val n = notes(); n.put("ivy:$tm", org.json.JSONArray(merged))
        val rest = today.filter { it.str("text").isEmpty() || it.optBoolean("done") }
        if (rest.any { it.str("text").isNotEmpty() }) n.put("ivy:$t", org.json.JSONArray(rest)) else n.remove("ivy:$t")
        Kv.set(NOTES, n); Bus.emit("data")
        return left.size
    }
}
