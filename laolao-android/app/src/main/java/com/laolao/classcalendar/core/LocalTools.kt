package com.laolao.classcalendar.core

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** 只存在这台手机上的小工具数据（键名和网页、小程序的插件一样：personal_<工具>_…） */
object Local {
    /** 小程序 / 网页存的是 JSON 字符串；安卓直接存对象。两种都认 */
    fun read(k: String): Any? = when (val v = Kv.get(k)) { is String -> parseJson(v) ?: v; else -> v }
    fun obj(k: String): JSONObject = read(k) as? JSONObject ?: JSONObject()
    fun arr(k: String): JSONArray = read(k) as? JSONArray ?: JSONArray()
    fun put(k: String, v: Any?) { Kv.setQuiet(k, v); Bus.emit("data") }
    fun id(p: String) = p + java.lang.Long.toString(System.currentTimeMillis(), 36) + java.lang.Long.toString(SecureRandom().nextLong() and 0xffffffffL, 36)
    val rnd = SecureRandom()
}

// =====================================================================
/** 个人日记：正文 AES-GCM 加密（和网页、小程序同一种格式 {v:1, iv, ct}），心情、天气、照片 */
object Diary {
    class Mood(val key: String, val emoji: String, val label: String)
    val MOODS = listOf(Mood("happy", "😊", "开心"), Mood("calm", "😌", "平静"), Mood("excited", "🤩", "期待"), Mood("tired", "😴", "疲惫"), Mood("sad", "😔", "低落"), Mood("anxious", "😟", "焦虑"), Mood("angry", "😤", "生气"))
    private const val KEY = "personal_diary_key"
    private const val META = "personal_diary_meta"
    private fun page(d: String) = "personal_diary_page_$d"
    private fun legacy(d: String) = "personal_diary_$d"
    private fun mood(d: String) = "personal_mood_$d"
    private fun updated(d: String) = "personal_updated_$d"
    private fun weather(d: String) = "personal_diary_weather_$d"
    fun photoKey(id: String) = "personal_photo_$id"

    private fun key(): ByteArray {
        val raw = Kv.get(KEY) as? String
        if (raw != null) { val b = Base64.decode(raw, Base64.DEFAULT); if (b.size != 32) throw ApiError(0, "日记密钥格式异常，请恢复原备份。"); return b }
        val b = ByteArray(32).also { Local.rnd.nextBytes(it) }
        Kv.setQuiet(KEY, Base64.encodeToString(b, Base64.NO_WRAP)); return b
    }
    private fun encode(text: String): String {
        val iv = ByteArray(12).also { Local.rnd.nextBytes(it) }
        val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key(), "AES"), GCMParameterSpec(128, iv))
        return jsonOf("v" to 1, "iv" to Base64.encodeToString(iv, Base64.NO_WRAP), "ct" to Base64.encodeToString(c.doFinal(text.toByteArray()), Base64.NO_WRAP)).toString()
    }
    private fun decode(raw: String): String {
        if (raw.isEmpty()) return ""
        val d = parseJson(raw) as? JSONObject ?: return raw
        if (d.optInt("v", -1) == 0 && d.has("d")) return String(Base64.decode(d.str("d"), Base64.DEFAULT))
        if (d.optInt("v") == 1 && d.has("iv") && d.has("ct")) {
            if (Kv.get(KEY) == null) throw ApiError(0, "找不到日记密钥，现有日记没有改动。")
            try {
                val c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key(), "AES"), GCMParameterSpec(128, Base64.decode(d.str("iv"), Base64.DEFAULT)))
                return String(c.doFinal(Base64.decode(d.str("ct"), Base64.DEFAULT)))
            } catch (e: Exception) { throw ApiError(0, "日记无法解密，现有日记没有改动。") }
        }
        return raw
    }
    private fun rawStr(k: String): String = when (val v = Kv.get(k)) { null -> ""; is String -> v; else -> v.toString() }

    class Photo(val id: String, val name: String, val data: String)
    class Entry(val day: String, var text: String, var mood: String, var city: String, var temp: String, val photos: MutableList<Photo>, val updated: String)
    fun read(day: String): Entry {
        val raw = rawStr(page(day)); var pg: JSONObject? = null
        if (raw.isNotEmpty()) { val o = parseJson(decode(raw)) as? JSONObject; pg = if (o?.optInt("v") == 2) o.optJSONObject("page") else if (o?.has("blocks") == true) o else null }
        val blocks = pg?.optJSONArray("blocks")?.objs() ?: emptyList()
        val text = if (pg != null) blocks.filter { it.str("type") == "text" }.joinToString("\n") { it.str("content") } else decode(rawStr(legacy(day)))
        val photos = blocks.filter { it.str("type") == "image" && it.str("id").isNotEmpty() }.map { Photo(it.str("id"), it.str("fileName").ifEmpty { "日记照片" }, rawStr(photoKey(it.str("id")))) }.toMutableList()
        val m = Local.obj(mood(day)); val w = Local.obj(weather(day)); val pw = pg?.optJSONObject("weather")
        return Entry(day, text, pg?.optJSONObject("mood")?.str("key")?.ifEmpty { null } ?: m.str("mood"), (pw ?: w).str("city"),
            (pw ?: w).opt("temperature")?.takeIf { it != JSONObject.NULL }?.toString() ?: "", photos, rawStr(updated(day)))
    }
    fun save(e: Entry) {
        if (e.text.length > 20000) throw ApiError(0, "正文最多 20000 字")
        val md = MOODS.firstOrNull { it.key == e.mood }; val stamp = java.time.Instant.now().toString()
        val t = e.temp.trim().toDoubleOrNull()
        val weather = jsonOf("city" to e.city.trim().take(40), "temperature" to t)
        val blocks = JSONArray().put(jsonOf("type" to "text", "content" to e.text))
        e.photos.forEach { blocks.put(jsonOf("type" to "image", "id" to it.id, "fileName" to it.name, "w" to 280, "rot" to 0)) }
        val pg = jsonOf("date" to e.day, "mood" to md?.let { jsonOf("key" to it.key, "emoji" to it.emoji, "label" to it.label) }, "weather" to weather, "blocks" to blocks)
        val has = e.text.isNotBlank() || e.photos.isNotEmpty()
        val old = read(e.day)
        Kv.setQuiet(page(e.day), if (has) encode(jsonOf("v" to 2, "page" to pg).toString()) else null)
        Kv.setQuiet(legacy(e.day), if (e.text.isNotBlank()) encode(e.text) else null)
        Kv.setQuiet(updated(e.day), stamp)
        Kv.setQuiet(mood(e.day), md?.let { jsonOf("date" to e.day, "mood" to it.key, "emoji" to it.emoji, "label" to it.label, "updatedAt" to stamp) })
        Kv.setQuiet(weather(e.day), weather)
        for (p in e.photos) if (p.data.isNotEmpty()) Kv.setQuiet(photoKey(p.id), p.data)
        val list = metaList().filter { it.str("d") != e.day }.toMutableList()
        if (has || md != null) list += jsonOf("d" to e.day, "u" to stamp, "n" to e.photos.size, "pids" to JSONArray(e.photos.map { it.id }))
        Kv.setQuiet(META, JSONArray(list))
        for (p in old.photos) if (e.photos.none { it.id == p.id }) Kv.setQuiet(photoKey(p.id), null)
        Bus.emit("data")
    }
    fun remove(day: String) {
        val old = read(day)
        listOf(page(day), legacy(day), mood(day), updated(day), weather(day)).forEach { Kv.setQuiet(it, null) }
        old.photos.forEach { Kv.setQuiet(photoKey(it.id), null) }
        Kv.setQuiet(META, JSONArray(metaList().filter { it.str("d") != day })); Bus.emit("data")
    }
    private fun metaList(): List<JSONObject> = Local.arr(META).objs()
    /** 有记录的日子：(日期, 心情表情, 心情文字, 照片数) */
    fun history(): List<Triple<String, String, Int>> {
        val map = LinkedHashMap<String, Int>()
        for (m in metaList()) if (T.date(m.str("d")) != null) map[m.str("d")] = m.optInt("n")
        val re = Regex("^personal_(?:diary_(?:page_)?|mood_)(\\d{4}-\\d{2}-\\d{2})$")
        for (k in Kv.keys()) re.find(k)?.let { if (!map.containsKey(it.groupValues[1])) map[it.groupValues[1]] = 0 }
        return map.keys.sortedDescending().map { d -> val m = Local.obj(mood(d)); Triple(d, m.str("emoji").ifEmpty { "📝" } + " " + m.str("label").ifEmpty { "留下一页记忆" }, map[d] ?: 0) }
    }
}

// =====================================================================
/** 错题本（键名和网页、小程序「错题记录本」一样） */
object ErrBook {
    const val LIST = "personal_error-notebook_list"
    const val BOOKS = "personal_error-notebook_books_v2"
    const val PHOTO = "personal_error-notebook_image:"
    const val UNFILED = "unfiled"
    val COLOURS = listOf(Triple("sky", "晴空蓝", "#c9d9f8"), Triple("forest", "森野绿", "#c9dfd4"), Triple("rose", "樱花粉", "#edcfdc"), Triple("apricot", "暖杏橙", "#edd7be"), Triple("lavender", "鸢尾紫", "#dcd3ed"), Triple("ocean", "海盐青", "#c4dde1"))
    val SUBJECTS = listOf("语文", "数学", "英语", "物理", "化学", "生物", "高等数学", "专业课")
    private val SEED = listOf("语文", "数学", "英语", "物理", "化学", "生物").mapIndexed { i, s -> jsonOf("id" to "subject-$i", "name" to s + "错题本", "subject" to s, "color" to COLOURS[i].first) }
    fun colour(b: JSONObject): String = (COLOURS.firstOrNull { it.first == b.str("color") } ?: COLOURS[0]).third

    fun books(): List<JSONObject> {
        val saved = Local.read(BOOKS) as? JSONArray
        val out = (saved?.objs() ?: SEED).filter { it.str("id").isNotEmpty() && it.str("name").isNotEmpty() && it.str("id") != UNFILED }.toMutableList()
        for (n in Local.arr(LIST).objs()) {
            val s = n.str("subject")
            if (s.isNotEmpty() && n.str("bookId").isEmpty() && out.none { it.str("subject") == s }) out += jsonOf("id" to "legacy-" + java.net.URLEncoder.encode(s, "UTF-8"), "name" to s + "错题本", "subject" to s, "color" to "sky")
        }
        out += jsonOf("id" to UNFILED, "name" to "未分类", "subject" to "待整理", "color" to "apricot")
        return out
    }
    fun notes(): List<JSONObject> {
        val all = books()
        return Local.arr(LIST).objs().mapIndexed { i, x ->
            val b = all.firstOrNull { it.str("id") == x.str("bookId") } ?: (if (x.str("bookId").isEmpty()) all.firstOrNull { it.str("subject") == x.str("subject") } else null) ?: all.first { it.str("id") == UNFILED }
            JSONObject(x.toString()).apply { if (!has("id") || isNull("id")) put("id", "legacy-$i"); put("bookId", b.str("id")); put("subject", if (b.str("id") == UNFILED) "" else b.str("subject")); if (optJSONArray("images") == null) put("images", JSONArray()) }
        }
    }
    private fun saveAll(list: List<JSONObject>, books: List<JSONObject>) {
        Kv.setQuiet(LIST, JSONArray(list)); Kv.setQuiet(BOOKS, JSONArray(books.filter { it.str("id") != UNFILED })); Bus.emit("data")
    }
    fun photo(id: String): String = (Kv.get(PHOTO + id) as? String) ?: ""
    fun saveNote(id: String?, bookId: String, q: String, ans: String, reason: String, analysis: String, mastered: Boolean, photos: List<Pair<String, String>>) {
        if (q.isBlank() && photos.isEmpty()) throw ApiError(0, "填写题干或添加至少一张题目图片。")
        val all = notes().toMutableList(); val bs = books(); val b = bs.firstOrNull { it.str("id") == bookId } ?: throw ApiError(0, "请选择一本错题本。")
        val old = all.firstOrNull { it.opt("id")?.toString() == id }
        if (old == null && all.size >= 5000) throw ApiError(0, "错题最多保存 5000 道。")
        for ((pid, data) in photos) if (data.isNotEmpty()) Kv.setQuiet(PHOTO + pid, data)
        old?.optJSONArray("images")?.objs()?.forEach { p -> if (photos.none { it.first == p.str("id") }) Kv.setQuiet(PHOTO + p.str("id"), null) }
        val d = java.time.LocalDateTime.now(T.BJ)
        val item = JSONObject(old?.toString() ?: "{}").apply {
            put("id", old?.opt("id") ?: Local.id("n")); put("question", q.trim()); put("answer", ans.trim()); put("reason", reason.trim()); put("analysis", analysis.trim())
            put("bookId", b.str("id")); put("subject", if (b.str("id") == UNFILED) "" else b.str("subject")); put("mastered", mastered)
            put("images", JSONArray(photos.map { jsonOf("id" to it.first, "name" to "题目图片") }))
            if (str("createTime").isEmpty()) put("createTime", "${d.year}/${d.monthValue}/${d.dayOfMonth} ${String.format("%02d:%02d:%02d", d.hour, d.minute, d.second)}")
            put("updatedAt", java.time.Instant.now().toString())
        }
        val i = all.indexOf(old); if (i >= 0) all[i] = item else all += item
        saveAll(all, bs)
    }
    fun toggleMastered(id: String) { val all = notes(); all.firstOrNull { it.opt("id").toString() == id }?.let { it.put("mastered", !it.optBoolean("mastered")) }; saveAll(all, books()) }
    fun delNote(id: String) {
        val all = notes(); val x = all.firstOrNull { it.opt("id").toString() == id } ?: return
        x.optJSONArray("images")?.objs()?.forEach { Kv.setQuiet(PHOTO + it.str("id"), null) }
        saveAll(all.filter { it !== x }, books())
    }
    fun saveBook(id: String?, subject0: String, name0: String, color: String): String {
        val subject = subject0.trim().take(24); val name = name0.trim().ifEmpty { subject + "错题本" }.take(32)
        if (subject.isEmpty()) throw ApiError(0, "先填写一个学科名称。")
        val all = books().toMutableList()
        if (all.any { it.str("id") != id && it.str("name") == name }) throw ApiError(0, "这本名称已经存在，换个名称更好分辨。")
        val b = jsonOf("id" to (id ?: Local.id("b")), "subject" to subject, "name" to name, "color" to color)
        val i = all.indexOfFirst { it.str("id") == b.str("id") }; if (i >= 0) all[i] = b else all.add(all.size - 1, b)
        saveAll(notes().map { if (it.str("bookId") == b.str("id")) it.put("subject", subject) else it }, all)
        return b.str("id")
    }
    fun removeBook(id: String) = saveAll(notes().map { if (it.str("bookId") == id) it.put("bookId", UNFILED).put("subject", "") else it }, books().filter { it.str("id") != id })
}

// =====================================================================
/** 时间管理大师：每日 / 每周三只青蛙、番茄任务、专注记录（键名和网页、小程序一样） */
object TimeMaster {
    private const val P = "personal_time-master_"
    private const val SETTINGS = P + "pomodoro_settings"
    private const val STATE = P + "pomodoro_state"
    private const val TASKS = P + "pomodoro_tasks"
    private const val SESSIONS = P + "sessions"
    val PRIOS = listOf("urgent-important" to "重要且紧急", "important" to "重要不紧急", "urgent" to "紧急不重要", "none" to "暂不着急")
    val PHASE = mapOf("focus" to "专注", "short" to "短休息", "long" to "长休息")
    fun settings(): JSONObject {
        val s = jsonOf("focusMin" to 25, "shortMin" to 5, "longMin" to 15, "longEvery" to 4, "autoBreak" to true, "autoNext" to false, "sound" to true, "keepScreenOn" to false)
        val o = Local.obj(SETTINGS); for (k in o.keys()) s.put(k, o.get(k)); return s
    }
    fun saveSettings(focus: Int, short: Int, long: Int, every: Int, autoBreak: Boolean, autoNext: Boolean, sound: Boolean, keepOn: Boolean) {
        if (focus !in 1..180 || short !in 1..60 || long !in 1..120 || every !in 2..12) throw ApiError(0, "请检查专注、休息和长休息周期的时长。")
        Local.put(SETTINGS, jsonOf("focusMin" to focus, "shortMin" to short, "longMin" to long, "longEvery" to every, "autoBreak" to autoBreak, "autoNext" to autoNext, "sound" to sound, "keepScreenOn" to keepOn))
        if (!timer().optBoolean("isRunning")) reset()
    }
    private fun secs(phase: String, s: JSONObject = settings()) = s.optInt(if (phase == "short") "shortMin" else if (phase == "long") "longMin" else "focusMin") * 60
    private fun empty(s: JSONObject) = jsonOf("phase" to "focus", "isRunning" to false, "startTimestamp" to null, "duration" to secs("focus", s), "pausedRemaining" to secs("focus", s),
        "currentTaskId" to null, "currentTaskTitle" to "", "completedInCycle" to 0, "deep" to false, "linkedFrog" to null, "updatedAt" to System.currentTimeMillis())
    fun timer(): JSONObject { val st = empty(settings()); val o = Local.obj(STATE); for (k in o.keys()) st.put(k, o.get(k)); if (PHASE[st.str("phase")] == null) st.put("phase", "focus"); return st }
    fun remaining(st: JSONObject = timer(), now: Long = System.currentTimeMillis()): Double =
        maxOf(0.0, if (st.optBoolean("isRunning")) st.optDouble("duration") - (now - st.optLong("startTimestamp")) / 1000.0 else st.optDouble("pausedRemaining"))
    fun sessions(): List<JSONObject> = Local.arr(SESSIONS).objs()
    fun tasks(): List<JSONObject> = Local.arr(TASKS).objs()
    private fun weekKey(day: String): String { val d = T.date(day)!!; val wf = java.time.temporal.WeekFields.ISO; return "${d.get(wf.weekBasedYear())}-W${String.format("%02d", d.get(wf.weekOfWeekBasedYear()))}" }
    private fun frogKey(day: String, weekly: Boolean) = P + if (weekly) "weekly_frogs_" + weekKey(day) else "frogs_$day"
    fun frogs(day: String, weekly: Boolean): List<JSONObject> {
        val l = Local.obj(frogKey(day, weekly)).optJSONArray("frogs")?.objs() ?: emptyList()
        return (0..2).map { i -> jsonOf("id" to (if (weekly) "w" else "f") + (i + 1), "title" to "", "stars" to 0, "priority" to "", "planMin" to 0, "actualMin" to 0, "done" to false, "note" to "", "due" to "").also { b -> l.getOrNull(i)?.let { x -> for (k in x.keys()) b.put(k, x.get(k)) } } }
    }
    fun saveFrog(day: String, weekly: Boolean, i: Int, title: String, stars: Int, prio: String, planMin: Int, due: String, note: String, done: Boolean) {
        val all = frogs(day, weekly).toMutableList()
        if (planMin !in 0..1440 || stars !in 0..5) throw ApiError(0, "计划时长或重要程度不正确。")
        val t = title.trim().take(80)
        all[i].put("title", t).put("stars", stars).put("priority", if (PRIOS.any { it.first == prio }) prio else "").put("planMin", planMin).put("due", due).put("note", note.take(300)).put("done", t.isNotEmpty() && done)
        Local.put(frogKey(day, weekly), if (weekly) jsonOf("week" to weekKey(day), "frogs" to JSONArray(all)) else jsonOf("date" to day, "frogs" to JSONArray(all)))
    }
    fun toggleFrog(day: String, weekly: Boolean, i: Int) {
        val f = frogs(day, weekly)[i]; if (f.str("title").isEmpty()) throw ApiError(0, "先写下这只青蛙要完成的事。")
        saveFrog(day, weekly, i, f.str("title"), f.optInt("stars"), f.str("priority"), f.optInt("planMin"), f.str("due"), f.str("note"), !f.optBoolean("done"))
    }
    fun addTask(title: String, est: Int) {
        if (title.isBlank() || title.length > 60 || est !in 1..20) throw ApiError(0, "请填写任务，并选择 1 到 20 个预计番茄。")
        Local.put(TASKS, JSONArray(tasks() + jsonOf("id" to Local.id("t"), "title" to title.trim(), "done" to false, "pomodoros" to 0, "estimate" to est, "createdAt" to System.currentTimeMillis())))
    }
    fun toggleTask(id: String) = Local.put(TASKS, JSONArray(tasks().map { if (it.opt("id").toString() == id) it.put("done", !it.optBoolean("done")) else it }))
    fun deleteTask(id: String) {
        val t = timer(); if (t.opt("currentTaskId")?.toString() == id && t.optBoolean("isRunning")) throw ApiError(0, "这个任务正在专注中，请先暂停或切换任务。")
        Local.put(TASKS, JSONArray(tasks().filter { it.opt("id").toString() != id }))
    }
    fun assign(id: String?, title: String, frog: JSONObject?) {
        val st = timer(); if (st.optBoolean("isRunning")) throw ApiError(0, "请先暂停当前计时，再选择新的专注任务。")
        st.put("currentTaskId", id).put("currentTaskTitle", title).put("linkedFrog", frog); Local.put(STATE, st)
    }
    /** 到点结算（只结算真实开始的这一段）；返回是否有一段结束了 */
    fun reconcile(now: Long = System.currentTimeMillis()): Boolean {
        val st = timer()
        if (!st.optBoolean("isRunning") || remaining(st, now) > 0) return false
        val opts = settings(); val hist = sessions().toMutableList()
        val endedAt = st.optLong("startTimestamp") + (st.optDouble("duration") * 1000).toLong()
        val phase = st.str("phase"); val sid = "mp-$phase-${st.optLong("startTimestamp")}"; val minutes = st.optDouble("duration") / 60
        val date = T.key(java.time.Instant.ofEpochMilli(endedAt).atZone(T.BJ).toLocalDate())
        val first = hist.none { it.str("id") == sid }
        if (first) hist += jsonOf("id" to sid, "date" to date, "taskId" to st.opt("currentTaskId"), "taskTitle" to st.str("currentTaskTitle"), "minutes" to minutes, "phase" to phase, "frogId" to st.optJSONObject("linkedFrog")?.str("id"), "completedAt" to endedAt)
        Kv.setQuiet(SESSIONS, JSONArray(hist.takeLast(800)))
        var next = "focus"; var auto = opts.optBoolean("autoNext")
        if (phase == "focus") {
            st.put("completedInCycle", st.optInt("completedInCycle") + 1)
            next = if (st.optInt("completedInCycle") % opts.optInt("longEvery", 4) == 0) "long" else "short"; auto = opts.optBoolean("autoBreak")
            val tid = st.opt("currentTaskId")?.toString()
            if (first && tid != null && tid != "null") Kv.setQuiet(TASKS, JSONArray(tasks().map { if (it.opt("id").toString() == tid) it.put("pomodoros", it.optInt("pomodoros") + 1) else it }))
            val lf = st.optJSONObject("linkedFrog")
            if (first && lf != null && T.date(lf.str("day")) != null) {
                val all = frogs(lf.str("day"), false); all.firstOrNull { it.str("id") == lf.str("id") }?.let { it.put("actualMin", it.optDouble("actualMin") + minutes); Kv.setQuiet(frogKey(lf.str("day"), false), jsonOf("date" to lf.str("day"), "frogs" to JSONArray(all))) }
            }
            // 也记进「规划与专注」的番茄数（成长、云宠、等级都会算上）
            if (first) { val l = Plan.log(); l.put(date, l.optInt(date) + 1); Kv.set(Plan.POMO_LOG, l) }
        }
        st.put("phase", next).put("duration", secs(next, opts)).put("pausedRemaining", secs(next, opts)).put("isRunning", auto).put("startTimestamp", if (auto) now else JSONObject.NULL).put("updatedAt", now)
        Local.put(STATE, st)
        return true
    }
    fun start(now: Long = System.currentTimeMillis()) {
        reconcile(now); val st = timer(); if (st.optBoolean("isRunning")) return
        if (st.optDouble("pausedRemaining") <= 0) st.put("pausedRemaining", st.optDouble("duration"))
        st.put("startTimestamp", now - ((st.optDouble("duration") - st.optDouble("pausedRemaining")) * 1000).toLong()).put("isRunning", true).put("updatedAt", now); Local.put(STATE, st)
    }
    fun pause(now: Long = System.currentTimeMillis()) { reconcile(now); val st = timer(); st.put("pausedRemaining", remaining(st, now)).put("isRunning", false).put("startTimestamp", JSONObject.NULL).put("updatedAt", now); Local.put(STATE, st) }
    fun reset() { val old = timer(); val n = empty(settings()); n.put("currentTaskId", old.opt("currentTaskId")).put("currentTaskTitle", old.str("currentTaskTitle")).put("linkedFrog", old.opt("linkedFrog")); Local.put(STATE, n) }
    fun skip() { val st = timer(); val n = if (st.str("phase") == "focus") "short" else "focus"; st.put("phase", n).put("duration", secs(n)).put("pausedRemaining", secs(n)).put("isRunning", false).put("startTimestamp", JSONObject.NULL); Local.put(STATE, st) }
    /** 什么时候到点（给闹钟用）；没在计时返回 0 */
    fun endsAt(): Long { val st = timer(); return if (st.optBoolean("isRunning")) st.optLong("startTimestamp") + (st.optDouble("duration") * 1000).toLong() else 0 }
    fun focusMinutes(days: Int): Int { val t = T.todayKey(); return Math.round(sessions().filter { it.str("phase") == "focus" && T.date(it.str("date")) != null && T.dayDiff(it.str("date"), t) in -(days - 1)..0 }.sumOf { it.optDouble("minutes") }).toInt() }
}

// =====================================================================
/** 神谕阁：答案之书 + 78 张卡牌（数据在 assets/oracle.json，和小程序同一份） */
object Oracle {
    private const val BOOK = "personal_oracle_book_history"
    private const val TAROT = "personal_oracle_tarot_history"
    private const val DAILY = "personal_oracle_tarot_daily"
    private var data: JSONObject? = null
    class Card(val i: Int, val name: String, val en: String, val roman: String, val reversed: Boolean, val position: String, val keywords: List<String>, val core: String, val advice: String)
    private val deck = mutableListOf<JSONObject>()
    fun load(ctx: Context): JSONObject {
        data?.let { return it }
        val d = JSONObject(ctx.assets.open("oracle.json").bufferedReader().readText())
        deck.clear()
        d.getJSONArray("major").objs().forEach { deck += it }
        val suits = d.getJSONObject("suits"); val ranks = d.getJSONArray("ranks").objs()
        for (sk in suits.keys()) { val s = suits.getJSONObject(sk); for (r in ranks) {
            val kw = JSONArray(); s.optJSONArray("kw")?.let { a -> for (i in 0 until a.length()) kw.put(a.get(i)) }; kw.put(r.str("kw"))
            val rk = JSONArray().put("重新审视"); s.optJSONArray("kw")?.let { a -> for (i in 0 until a.length()) rk.put(a.get(i)) }
            deck += jsonOf("name" to s.str("name") + r.str("name"), "en" to r.str("en") + " OF " + s.str("en").uppercase(), "roman" to r.str("roman"),
                "up" to jsonOf("kw" to kw, "core" to r.str("up") + " " + s.str("upWord"), "adv" to r.str("adv")), "rev" to jsonOf("kw" to rk, "core" to r.str("rev") + " " + s.str("revWord"), "adv" to r.str("adv")))
        } }
        data = d; return d
    }
    val answerCount: Int get() = data?.optJSONArray("answers")?.length() ?: 0
    fun domains(): List<Pair<String, String>> = listOf("general" to "日常思考") + (data?.optJSONObject("domains")?.let { o -> o.keys().asSequence().map { it to o.getJSONObject(it).str("name") }.toList() } ?: emptyList())
    fun spreads(): List<JSONObject> = data?.optJSONArray("spreads")?.objs() ?: emptyList()
    private fun card(i: Int, rev: Boolean, pos: String, domain: String): Card {
        val row = deck[i]; val m = row.getJSONObject(if (rev) "rev" else "up")
        val lead = data!!.optJSONObject("domain_lead")?.let { it.optJSONObject(domain) ?: it.optJSONObject("general") }
        val text = lead?.optString(if (rev) "rev" else "up") ?: ""
        val kw = m.optJSONArray("kw")?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
        return Card(i, row.str("name"), row.str("en"), row.str("roman"), rev, pos, kw, if (text.isNotEmpty()) text + "\n" + m.str("core") else m.str("core"), m.str("adv"))
    }
    fun daily(): Card {
        val day = T.todayKey(); var v = Local.obj(DAILY)
        if (v.str("day") != day || v.optInt("i", -1) !in deck.indices) {
            var seed = 0L; for (ch in day) seed = (seed * 31 + ch.code) and 0xffffffffL
            v = jsonOf("day" to day, "i" to (seed % deck.size).toInt(), "rev" to ((seed ushr 8) % 100 < 34)); Local.put(DAILY, v)
        }
        return card(v.optInt("i"), v.optBoolean("rev"), "今日指引", "general")
    }
    fun answer(q: String, page: Int? = null): JSONObject {
        val ans = data!!.getJSONArray("answers"); val n = page ?: (Local.rnd.nextInt(ans.length()) + 1)
        if (n !in 1..ans.length()) throw ApiError(0, "页码需要在 1 到 ${ans.length()} 之间。")
        val row = jsonOf("id" to Local.id("book"), "q" to q.trim().take(160), "a" to ans.getString(n - 1), "p" to n, "t" to System.currentTimeMillis())
        Local.put(BOOK, JSONArray((listOf(row) + Local.arr(BOOK).objs()).take(100))); return row
    }
    fun spread(id: String, domain: String): List<Card> {
        val s = spreads().firstOrNull { it.str("id") == id } ?: throw ApiError(0, "请选择牌阵。")
        val pos = s.getJSONArray("positions").objs()
        val cards = deck.indices.shuffled(Local.rnd).take(s.optInt("n")).mapIndexed { k, i -> card(i, Local.rnd.nextDouble() < .34, pos.getOrNull(k)?.str("name") ?: "", domain) }
        val row = jsonOf("id" to Local.id("tarot"), "t" to System.currentTimeMillis(), "spread" to s.str("name"), "domain" to domain, "cards" to JSONArray(cards.map { it.name + if (it.reversed) "(逆)" else "(正)" }))
        Local.put(TAROT, JSONArray((listOf(row) + Local.arr(TAROT).objs()).take(100))); return cards
    }
    /** 历史：(时间, 标题, 内容, 标签, 类型, 下标) */
    fun history(): List<JSONObject> =
        (Local.arr(BOOK).objs().mapIndexed { i, x -> jsonOf("type" to "book", "i" to i, "t" to x.optLong("t"), "title" to x.str("q").ifEmpty { "答案之书" }, "body" to x.str("a"), "label" to "第 ${x.optInt("p")} 页") } +
         Local.arr(TAROT).objs().mapIndexed { i, x -> jsonOf("type" to "tarot", "i" to i, "t" to x.optLong("t"), "title" to x.str("spread").ifEmpty { "卡牌指引" }, "body" to (x.optJSONArray("cards")?.let { a -> (0 until a.length()).joinToString(" · ") { a.optString(it) } } ?: ""), "label" to "卡牌") })
            .sortedByDescending { it.optLong("t") }
    fun remove(type: String, i: Int) { val k = if (type == "book") BOOK else TAROT; val l = Local.arr(k).objs().toMutableList(); if (i in l.indices) { l.removeAt(i); Local.put(k, JSONArray(l)) } }
    fun clear() { Local.put(BOOK, JSONArray()); Local.put(TAROT, JSONArray()) }
}

// =====================================================================
/** 单词搭子：七本词书（assets/words.json.gz，和小程序同一份词库），间隔复习 3/7/15/30 天 */
object Words {
    private const val P = "personal_word-buddy_"
    private const val WORDS = P + "words"
    private const val WEAK = P + "weak"
    private const val FAV = P + "fav"
    private const val STATS = P + "stats"
    private const val BOOK = P + "book"
    private val GOOD_DAYS = listOf(3, 7, 15, 30)
    @Volatile private var dict: JSONObject? = null
    val loaded: Boolean get() = dict != null
    fun load(ctx: Context): JSONObject {
        dict?.let { return it }
        synchronized(this) {
            dict?.let { return it }
            val text = java.util.zip.GZIPInputStream(ctx.assets.open("words.json.gz")).bufferedReader().readText()
            return JSONObject(text).also { dict = it }
        }
    }
    private val d get() = dict!!
    private fun words() = d.getJSONObject("words")
    fun exists(w: String) = words().has(w)
    fun books(): List<JSONObject> = d.getJSONArray("books").objs().map { b -> JSONObject(b.toString()).put("count", d.getJSONObject("bookWords").optJSONArray(b.str("id"))?.length() ?: 0) }
    fun book(): JSONObject {
        val raw = (Kv.get(BOOK) as? String) ?: "CET4"
        val alias = mapOf("CET4 四级" to "CET4", "CET6 六级" to "CET6", "考研英语" to "KY", "高考英语" to "GK", "Oxford核心" to "OX")
        val id = alias[raw] ?: raw
        return books().firstOrNull { it.str("id") == id } ?: books()[0]
    }
    fun setBook(id: String) { Kv.setQuiet(BOOK, id); Bus.emit("data") }
    private fun bookWords(): List<String> = d.getJSONObject("bookWords").optJSONArray(book().str("id"))?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: emptyList()
    private fun prog(): JSONObject = Local.obj(WORDS)
    private fun weak(): JSONObject = Local.obj(WEAK)
    private fun fav(): JSONObject = Local.obj(FAV)
    fun stats(): JSONObject = jsonOf("xpTotal" to 0, "reviews" to 0, "quizCorrect" to 0, "quizTotal" to 0, "days" to JSONArray(), "streak" to 0, "lastDay" to "").also { s -> val o = Local.obj(STATS); for (k in o.keys()) s.put(k, o.get(k)) }
    private fun cn(t: String) = t.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n")

    class Card(val word: String, val pron: String, val cn: String, val en: String, val examples: List<Pair<String, String>>, val phrases: List<Pair<String, String>>, val fav: Boolean, val stage: String)
    fun meaning(w: String): Card {
        val raw = words().getJSONObject(w); val cur = book()
        val src = raw.optJSONArray("sources")?.objs()?.firstOrNull { it.opt("book")?.toString() == cur.opt("tag")?.toString() }
        fun pairs(k: String) = src?.optJSONArray(k)?.let { a -> (0 until a.length()).mapNotNull { a.optJSONArray(it) }.map { it.optString(0) to it.optString(1) } } ?: emptyList()
        val rec = prog().optJSONObject(w)
        return Card(w, raw.str("us").ifEmpty { raw.str("uk") }, cn(raw.str("cn")), cn(raw.str("en")), pairs("examples"), pairs("phrases"), fav().has(w),
            if (rec == null || rec.optInt("seen") == 0) "新词" else if (rec.str("s") == "mastered") "已掌握" else "学习中")
    }
    private fun daily(): JSONObject {
        val b = book().str("id"); val date = T.todayKey(); val k = P + "daily_" + b
        val cur = Local.obj(k); if (cur.str("date") == date && cur.optJSONArray("ids") != null) return cur
        val all = bookWords(); val p = prog()
        val seqK = P + "seq_" + b; val ex = Local.obj(seqK).optJSONArray("ids")
        val inBook = all.toHashSet()
        val ids = ex?.let { a -> (0 until a.length()).map { a.optString(it) }.filter { it in inBook } }?.takeIf { it.isNotEmpty() } ?: all.shuffled(Local.rnd)
        val unseen = ids.filter { p.optJSONObject(it)?.optInt("seen", 0) ?: 0 == 0 }
        val v = jsonOf("date" to date, "ids" to JSONArray(unseen.take(20)), "done" to JSONArray())
        Kv.setQuiet(seqK, jsonOf("v" to d.str("version"), "ids" to JSONArray(ids))); Kv.setQuiet(k, v)
        return v
    }
    private fun arrList(a: JSONArray?) = a?.let { x -> (0 until x.length()).map { x.optString(it) } } ?: emptyList()
    fun due(): List<String> { val p = prog(); val now = System.currentTimeMillis(); return bookWords().filter { val r = p.optJSONObject(it); r != null && r.optLong("due") in 1..now }.sortedBy { p.getJSONObject(it).optLong("due") } }
    fun rate(w: String, grade: String) {
        val now = System.currentTimeMillis(); val p = prog(); val wk = weak(); val st = stats()
        val old = p.optJSONObject(w) ?: jsonOf("s" to "new", "step" to 0, "due" to 0, "seen" to 0, "right" to 0, "wrong" to 0, "last" to 0)
        val rec = JSONObject(old.toString()); val wasSeen = old.optInt("seen") > 0
        rec.put("seen", rec.optInt("seen") + 1).put("last", now)
        when (grade) {
            "again" -> { rec.put("s", "learning").put("step", 0).put("wrong", rec.optInt("wrong") + 1).put("due", now + 600_000); val pr = wk.optJSONObject(w); wk.put(w, jsonOf("addedAt" to (pr?.optLong("addedAt") ?: now), "reason" to "again", "count" to (pr?.optInt("count") ?: 0) + 1)) }
            "hard" -> rec.put("s", "learning").put("due", now + 86_400_000)
            else -> { val step = rec.optInt("step"); rec.put("right", rec.optInt("right") + 1).put("due", now + GOOD_DAYS[minOf(step, 3)] * 86_400_000L).put("step", minOf(4, step + 1)); rec.put("s", if (rec.optInt("step") >= 4) "mastered" else "learning"); if (rec.str("s") == "mastered") wk.remove(w) }
        }
        p.put(w, rec)
        val today = T.todayKey(); st.put("xpTotal", st.optInt("xpTotal") + 5).put("reviews", st.optInt("reviews") + if (wasSeen) 1 else 0)
        if (st.str("lastDay") != today) {
            st.put("streak", if (st.str("lastDay") == T.addDays(today, -1)) st.optInt("streak") + 1 else 1).put("lastDay", today)
            val days = arrList(st.optJSONArray("days")).toMutableList(); if (today !in days) days += today; st.put("days", JSONArray(days.takeLast(730)))
        }
        val dy = daily(); val done = arrList(dy.optJSONArray("done")).toMutableList()
        if (w in arrList(dy.optJSONArray("ids")) && w !in done) done += w; dy.put("done", JSONArray(done))
        Kv.setQuiet(WORDS, p); Kv.setQuiet(WEAK, wk); Kv.setQuiet(STATS, st); Kv.setQuiet(P + "daily_" + book().str("id"), dy)
    }
    fun favorite(w: String) { val f = fav(); if (f.has(w)) f.remove(w) else f.put(w, System.currentTimeMillis()); Kv.setQuiet(FAV, f) }
    class Overview(val book: JSONObject, val learned: Int, val mastered: Int, val due: Int, val favs: Int, val weak: Int, val dailyTotal: Int, val dailyDone: Int, val stats: JSONObject, val count: Int)
    fun overview(): Overview {
        val p = prog(); val sel = bookWords(); val dy = daily()
        return Overview(book(), sel.count { (p.optJSONObject(it)?.optInt("seen") ?: 0) > 0 }, sel.count { p.optJSONObject(it)?.str("s") == "mastered" }, due().size,
            fav().keys().asSequence().count { exists(it) }, weak().keys().asSequence().count { exists(it) }, dy.optJSONArray("ids")?.length() ?: 0, dy.optJSONArray("done")?.length() ?: 0, stats(), sel.size)
    }
    fun session(mode: String): List<String> {
        val p = prog()
        return when (mode) {
            "review" -> due()
            "weak" -> weak().keys().asSequence().filter { exists(it) }.toList()
            "favorites" -> fav().keys().asSequence().filter { exists(it) }.toList()
            "quiz" -> (bookWords().filter { (p.optJSONObject(it)?.optInt("seen") ?: 0) > 0 } + arrList(daily().optJSONArray("ids"))).distinct().shuffled(Local.rnd).take(10)
            else -> arrList(daily().optJSONArray("ids")).filter { (p.optJSONObject(it)?.optInt("seen") ?: 0) == 0 }
        }
    }
    /** 词库搜索：(单词, 释义第一行, 收藏了没, 阶段) */
    fun rows(mode: String, q0: String): List<Card> {
        val q = q0.trim().lowercase(); val all = words()
        val ids: Sequence<String> = when (mode) { "favorites" -> fav().keys().asSequence(); "weak" -> weak().keys().asSequence(); "review" -> due().asSequence(); else -> all.keys().asSequence() }
        return ids.filter { exists(it) }.filter { q.isEmpty() || it.lowercase().contains(q) || all.getJSONObject(it).str("cn").contains(q) }.take(40).map { meaning(it) }.toList()
    }
    fun quiz(w: String): List<Pair<String, String>> {
        val ans = meaning(w).cn; val opts = mutableListOf(w to ans)
        for (id in bookWords().shuffled(Local.rnd)) { if (id == w) continue; val c = cn(words().getJSONObject(id).str("cn")); if (c.isEmpty() || opts.any { it.second == c }) continue; opts += id to c; if (opts.size >= 4) break }
        return opts.shuffled(Local.rnd)
    }
    fun recordQuiz(w: String, ok: Boolean) {
        val st = stats(); st.put("quizTotal", st.optInt("quizTotal") + 1)
        if (ok) st.put("quizCorrect", st.optInt("quizCorrect") + 1).put("xpTotal", st.optInt("xpTotal") + 3)
        else { val wk = weak(); wk.put(w, jsonOf("addedAt" to System.currentTimeMillis(), "reason" to "quiz", "count" to (wk.optJSONObject(w)?.optInt("count") ?: 0) + 1)); Kv.setQuiet(WEAK, wk) }
        Kv.setQuiet(STATS, st)
    }
}
