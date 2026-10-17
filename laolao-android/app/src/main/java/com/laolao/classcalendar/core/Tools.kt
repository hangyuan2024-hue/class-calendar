package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject

/** 小工具的数据（和小程序一样只存在这台手机上；键名和网页、小程序的插件一样） */
object Tools {
    private fun list(k: String): List<JSONObject> = when (val v = Kv.get(k)) {
        is JSONArray -> v.objs()
        is String -> (parseJson(v) as? JSONArray)?.objs() ?: emptyList()
        else -> emptyList()
    }
    private fun put(k: String, l: List<JSONObject>) { Kv.set(k, JSONArray(l)); Bus.emit("data") }
    private fun newNumId(l: List<JSONObject>): Long = maxOf(System.currentTimeMillis(), (l.mapNotNull { it.opt("id")?.toString()?.toLongOrNull() }.maxOrNull() ?: 0) + 1)

    // ---------- 考试倒计时 ----------
    const val EXAMS = "personal_exam-countdown_list"
    fun exams(): List<JSONObject> = list(EXAMS).filter { T.date(it.str("date")) != null }.sortedBy { it.str("date") }
    fun saveExam(id: String?, subject: String, date: String, note: String) {
        if (subject.isBlank()) throw ApiError(0, "请填写考试科目")
        if (T.date(date) == null) throw ApiError(0, "请选择考试日期")
        val l = list(EXAMS).toMutableList()
        val old = l.firstOrNull { it.opt("id")?.toString() == id }
        val rec = jsonOf("id" to (old?.opt("id") ?: newNumId(l)), "subject" to subject.trim().take(80), "date" to date, "note" to note.trim().take(500))
        if (old != null) l[l.indexOf(old)] = rec else l += rec
        put(EXAMS, l)
    }
    fun delExam(id: String) = put(EXAMS, list(EXAMS).filter { it.opt("id")?.toString() != id })

    // ---------- 校园记账本 ----------
    const val BOOK = "personal_campus-account-book_list"
    val CATS = listOf("餐饮", "交通", "学习", "购物", "娱乐", "住宿", "生活费", "奖学金", "兼职", "其他")
    fun book(): List<JSONObject> = list(BOOK).filter { it.optDouble("money", 0.0) > 0 }
    fun dayOf(x: JSONObject): String {
        if (T.date(x.str("date")) != null) return x.str("date").take(10)
        Regex("^(\\d{4})[/-](\\d{1,2})[/-](\\d{1,2})").find(x.str("time"))?.let { m -> return String.format("%s-%02d-%02d", m.groupValues[1], m.groupValues[2].toInt(), m.groupValues[3].toInt()) }
        return ""
    }
    fun saveBill(id: String?, type: String, money: Double, cat: String, remark: String, date: String) {
        if (money <= 0 || money > 1e8) throw ApiError(0, "金额不对")
        if (T.date(date) == null) throw ApiError(0, "请选择日期")
        val l = list(BOOK).toMutableList()
        val old = l.firstOrNull { it.opt("id")?.toString() == id }
        val rec = jsonOf("id" to (old?.opt("id") ?: newNumId(l)), "type" to if (type == "in") "in" else "out", "money" to Math.round(money * 100) / 100.0,
            "remark" to remark.trim().take(300), "category" to if (cat in CATS) cat else "其他", "date" to date,
            "time" to (old?.str("time")?.ifEmpty { null } ?: (date + " " + T.hm(T.now().toLocalTime()))))
        if (old != null) l[l.indexOf(old)] = rec else l += rec
        put(BOOK, l)
    }
    fun delBill(id: String) = put(BOOK, list(BOOK).filter { it.opt("id")?.toString() != id })

    // ---------- 随机抽签 ----------
    const val DRAW = "personal_random-draw_app_v1"
    fun drawNames(): List<String> = (Kv.obj(DRAW).optJSONArray("names") ?: JSONArray()).let { a -> (0 until a.length()).map { a.optString(it) }.filter { it.isNotBlank() } }
    fun drawPicked(): List<String> = (Kv.obj(DRAW).optJSONArray("picked") ?: JSONArray()).let { a -> (0 until a.length()).map { a.optString(it) } }
    fun setNames(text: String) {
        val names = text.split(Regex("[\\n,，、;；\\t]+")).map { it.trim() }.filter { it.isNotEmpty() }.distinct().take(2000)
        Kv.set(DRAW, jsonOf("names" to JSONArray(names), "picked" to JSONArray())); Bus.emit("data")
    }
    /** 抽 n 个；noRepeat = 抽过的不再抽 */
    fun draw(n: Int, noRepeat: Boolean): List<String> {
        val names = drawNames(); val picked = drawPicked().toMutableList()
        var pool = if (noRepeat) names.filter { it !in picked } else names
        if (pool.isEmpty() && noRepeat) { picked.clear(); pool = names }
        val got = pool.shuffled(java.security.SecureRandom().let { r -> java.util.Random(r.nextLong()) }).take(n.coerceIn(1, pool.size.coerceAtLeast(1)))
        picked += got
        Kv.set(DRAW, jsonOf("names" to JSONArray(names), "picked" to JSONArray(picked)))
        return got
    }
    fun resetDraw() { Kv.set(DRAW, jsonOf("names" to JSONArray(drawNames()), "picked" to JSONArray())) }
}
