package com.laolao.classcalendar.data

import android.content.Context
import android.os.Build
import com.laolao.classcalendar.model.AgendaItem
import com.laolao.classcalendar.model.AgendaModel
import com.laolao.classcalendar.model.Kind
import com.laolao.classcalendar.model.Course
import com.laolao.classcalendar.model.CourseMeta
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID

data class Profile(val name: String, val identity: String, val org: String, val account: String, val isAdmin: Boolean) {
    val identityLabel get() = when (identity) { "teacher" -> "老师"; "other" -> "职场·个人"; else -> "学生" }
}

/** Single source of truth for the UI. All network calls go through here. */
class Repo(private val ctx: Context) {
    val api = Api(ctx)
    private val prefs = ctx.getSharedPreferences("laolao_app_v6", 0)

    private val _store = MutableStateFlow(SyncStore(ctx, api.uid()))
    val store: StateFlow<SyncStore> = _store
    private val _logged = MutableStateFlow(api.logged())
    val logged: StateFlow<Boolean> = _logged
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy
    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error

    val s get() = _store.value

    // ---------- settings (device-level) ----------
    fun pref(key: String, def: String) = prefs.getString(key, def) ?: def
    fun setPref(key: String, v: String) { prefs.edit().putString(key, v).apply(); _store.value.setCache("_pref_tick", System.nanoTime()) }

    val deviceId: String get() = prefs.getString("cc_device_id_v1", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("cc_device_id_v1", it).apply() }

    // ---------- auth ----------
    suspend fun login(account: String, pw: String) { api.login(account, pw); afterAuth() }
    suspend fun register(account: String, pw: String, name: String, identity: String, orgType: String, orgName: String) {
        api.register(account, pw, name, identity, orgType, orgName); afterAuth()
    }
    private suspend fun afterAuth() {
        _store.value = SyncStore(ctx, api.uid()); _logged.value = true
        runCatching { touchDevice() }
        refresh()
    }
    suspend fun logout() { api.logout(); signedOut() }
    private fun signedOut() { _store.value = SyncStore(ctx, "guest"); _logged.value = false }

    // ---------- snapshots ----------
    fun profile(): Profile {
        val me = s.cache("me").obj()
        return Profile(me.optString("name").ifBlank { "同学" }, me.optString("identity", me.optString("role", "student")),
            me.optString("org_name"), me.optString("username", me.optString("account")),
            me.optString("role") == "admin" || me.optBoolean("is_admin"))
    }
    fun classes(): List<JSONObject> = s.cache("classes").rows()
    fun currentClass(): JSONObject = s.cache("class").obj()
    fun classItems(): List<JSONObject> = s.cache("items").rows()
    fun courses(): List<Course> = s.get("native_courses").rows().map(Course::from)
    fun meta(): CourseMeta = CourseMeta.from(s.get("native_course_meta") as? JSONObject)
    fun personal(): List<JSONObject> = s.list("personal_events_v1")
    fun marks(): JSONObject = s.map("personal_marks_v1")

    fun agenda(day: LocalDate): List<AgendaItem> = AgendaModel.day(day, courses(), meta(), personal(), classItems(), marks())

    // ---------- refresh ----------
    suspend fun refresh(quiet: Boolean = false) {
        if (!api.logged()) return
        _busy.value = true
        try {
            withContext(Dispatchers.IO) {
                val store = s
                val wanted = store.cache("class_id") as? String ?: ""
                val boot = try {
                    api.rpcBlocking("app_bootstrap2", JSONObject().put("cid", wanted.ifEmpty { JSONObject.NULL })).obj()
                } catch (e: ApiError) {
                    if (e.status != 404 && e.status != 400) throw e
                    api.rpcBlocking("app_bootstrap", JSONObject().put("cid", wanted.ifEmpty { JSONObject.NULL })).obj()
                }
                store.setCache("me", boot.optJSONObject("me") ?: JSONObject())
                val classes = boot.optJSONArray("classes") ?: (api.rpcBlocking("my_classes") as? JSONArray ?: JSONArray())
                store.setCache("classes", classes)
                val usable = classes.rows().filter { it.optBoolean("is_teacher") || it.optString("status") == "approved" }
                val sel = usable.firstOrNull { it.optString("id") == wanted } ?: usable.firstOrNull() ?: JSONObject()
                store.setCache("class", sel); store.setCache("class_id", sel.optString("id"))
                if (sel.length() > 0) {
                    val c = api.rpcBlocking("class_ctx", JSONObject().put("cid", sel.optString("id"))).obj()
                    store.setCache("items", c.opt("items") ?: JSONArray())
                    store.setCache("groups", c.opt("groups") ?: JSONArray())
                } else store.setCache("items", JSONArray())
                if (!prefs.getBoolean("courses_dirty", false)) runCatching {
                    val r = api.rpcBlocking("courses_get").obj()
                    r.optJSONArray("courses")?.let { store.setCacheData("native_courses", it) }
                    r.optJSONObject("meta")?.let { m ->
                        val merged = (store.get("native_course_meta") as? JSONObject) ?: JSONObject()
                        m.keys().forEach { k -> if (!m.isNull(k)) merged.put(k, m.get(k)) }
                        store.setCacheData("native_course_meta", CourseMeta.from(merged).toJson())
                    }
                }
                store.sync(api)
            }
            _error.value = null
            runCatching { onRefreshed?.invoke() }
        } catch (e: ApiError) {
            if (e.status == 401) signedOut()
            if (!quiet) _error.value = e.message
        } catch (e: Exception) {
            if (!quiet) _error.value = e.message ?: "同步失败，本地数据已保留"
        } finally { _busy.value = false }
    }

    fun clearError() { _error.value = null }
    /** 每次同步成功后（LaoApp 里设置）：发新事项通知、更新小组件和提醒 */
    var onRefreshed: (() -> Unit)? = null

    // ---------- personal events ----------
    fun saveEvent(id: String?, title: String, date: LocalDate?, time: String, place: String, note: String, homework: Boolean = false, done: Boolean? = null, src: String = "") {
        val key = id ?: ("p" + System.currentTimeMillis() + "_" + UUID.randomUUID().toString().replace("-", "").take(6))
        val old = if (id != null) personal().firstOrNull { it.optString("id") == id } else null
        val rec = (old ?: JSONObject()).put("id", key).put("subject", title.trim())
            .put("event_time", if (date == null) "" else date.toString() + if (time.isBlank()) "" else " $time")
            .put("location", place.trim()).put("note", note.trim())
        if (homework) rec.put("kind", "作业") else rec.remove("kind")
        if (done != null) rec.put("done", done) else if (!rec.has("done")) rec.put("done", false)
        if (src.isNotBlank()) rec.put("src", src)
        s.entry("personal_events_v1", key, rec)
        onLocalChange?.invoke()
    }
    fun deleteEvent(id: String) { s.entry("personal_events_v1", id, null); onLocalChange?.invoke() }
    /** 勾完成 / 取消完成（和网站、小程序同一套：班级事项记在 personal_marks_v1["c<编号>"]，自己记的记在事项的 done 字段） */
    fun setDone(a: AgendaItem, done: Boolean) {
        if (a.kind == Kind.COURSE) return
        if (a.kind == Kind.CLASS) {
            val m = marks().optJSONObject(a.id) ?: JSONObject()
            m.put("done", done)
            s.entry("personal_marks_v1", a.id, m)
        } else {
            val rec = personal().firstOrNull { it.optString("id") == a.id } ?: return
            rec.put("done", done)
            s.entry("personal_events_v1", a.id, rec)
        }
        // 成长记录（网站「成长」页、排行榜用）：完成的那天
        if (done) s.entry("done_log_v1", a.id, LocalDate.now().toString()) else s.entry("done_log_v1", a.id, null)
        onLocalChange?.invoke()
    }
    fun toggleDone(a: AgendaItem) = setDone(a, !a.done)
    fun findItem(key: String): AgendaItem? = allItems().firstOrNull { it.id == key }

    /** 本地数据改了（勾完成、记事）：小组件、提醒跟着更新（LaoApp 里设置） */
    var onLocalChange: (() -> Unit)? = null

    /** 所有班级事项 + 自己记的事项（没有日期的放在今天之后的「待定」里） */
    fun allItems(): List<AgendaItem> {
        val m = marks()
        return personal().mapNotNull { AgendaModel.toItem(it, m, Kind.EVENT, LocalDate.MAX) } +
            classItems().mapNotNull { AgendaModel.toItem(it, m, Kind.CLASS, LocalDate.MAX) }
    }

    /** 作业：班级发的作业 + 自己记的作业，按截止时间排；没日期的在最后 */
    fun homework(): List<AgendaItem> = allItems().filter { it.isHomework }
        .sortedWith(compareBy<AgendaItem>({ it.date }, { it.start ?: Int.MAX_VALUE }, { it.title }))

    // ---------- 5.8：已读 ----------
    suspend fun viewCounts(): JSONObject? {
        val cid = currentClass().optString("id"); if (cid.isBlank()) return null
        return runCatching { api.rpc("item_view_counts", JSONObject().put("cid", cid)) as? JSONObject }.getOrNull()
    }
    suspend fun markSeen(ids: List<String>) {
        val cid = currentClass().optString("id"); if (cid.isBlank() || ids.isEmpty()) return
        val arr = JSONArray(); ids.take(200).forEach { id -> id.toLongOrNull()?.let { arr.put(it) } }
        if (arr.length() == 0) return
        runCatching { api.rpc("item_seen", JSONObject().put("cid", cid).put("ids", arr)) }
    }
    suspend fun viewers(id: String): List<JSONObject> =
        api.rpc("item_viewers", JSONObject().put("cid", currentClass().optString("id")).put("iid", id.toLong())).rows()

    // ---------- courses ----------
    fun saveCourse(c: Course) {
        val list = courses().filter { it.id != c.id } + c
        s.setCacheData("native_courses", JSONArray(list.map { it.toJson() })); prefs.edit().putBoolean("courses_dirty", true).apply()
    }
    fun deleteCourse(id: String) {
        s.setCacheData("native_courses", JSONArray(courses().filter { it.id != id }.map { it.toJson() })); prefs.edit().putBoolean("courses_dirty", true).apply()
    }
    fun saveMeta(m: CourseMeta) { s.setCacheData("native_course_meta", m.toJson()); prefs.edit().putBoolean("courses_dirty", true).apply() }
    fun coursesDirty() = prefs.getBoolean("courses_dirty", false)
    suspend fun uploadCourses() {
        api.rpc("courses_sync", JSONObject().put("p_courses", JSONArray(courses().map { it.toJson() })).put("p_meta", meta().toJson()))
        prefs.edit().putBoolean("courses_dirty", false).apply()
    }

    /** 拍课表：把截图交给服务器识别（和网站同一个接口），每秒问一次进度。onProgress(百分比, 已用秒数) */
    suspend fun ocrCourses(b64: String, onProgress: (Int, Int) -> Unit): JSONObject {
        val job = api.rpc("course_ocr_start", JSONObject().put("img", b64)).obj().optString("job_id")
        if (job.isBlank()) throw ApiError(0, "上传失败，请重试")
        val t0 = System.currentTimeMillis()
        var r: JSONObject? = null
        while (System.currentTimeMillis() - t0 < 160_000) {
            kotlinx.coroutines.delay(1000)
            r = runCatching { api.rpc("course_ocr_status", JSONObject().put("jid", job)).obj() }.getOrNull()
            onProgress(r?.optInt("progress") ?: 0, ((System.currentTimeMillis() - t0) / 1000).toInt())
            if (r != null && r.optString("status") != "running" && r.optString("status").isNotBlank()) break
        }
        val res = r ?: throw ApiError(0, "识别超时了，请稍后再试")
        if (res.optString("status") != "done" || res.optJSONObject("result") == null) {
            val msg = if (res.optString("status") == "failed") res.optString("message") else ""
            throw ApiError(0, msg.ifBlank { "识别超时了，请稍后再试" })
        }
        return res.getJSONObject("result")
    }

    /** 把核对好的课程存进课程表并上传（replace=true 替换原来的课） */
    suspend fun importCourses(list: List<Course>, replace: Boolean, times: List<String>?, week1: LocalDate?) {
        val keep = if (replace) emptyList() else courses()
        s.setCacheData("native_courses", JSONArray((keep + list).map { it.toJson() }))
        val m = meta()
        if (times != null || week1 != null) s.setCacheData("native_course_meta", CourseMeta(week1 ?: m.week1, times ?: m.times).toJson())
        prefs.edit().putBoolean("courses_dirty", true).apply()
        onLocalChange?.invoke()
        uploadCourses()
    }

    // ---------- classes ----------
    suspend fun createClass(name: String) { api.rpc("create_class", JSONObject().put("cname", name.trim())); refresh() }
    suspend fun joinClass(code: String) { api.rpc("join_class", JSONObject().put("ccode", code.trim().uppercase())); refresh() }
    suspend fun selectClass(id: String) { s.setCache("class_id", id); refresh() }
    suspend fun leaderboard(): List<JSONObject> = runCatching { api.rpc("growth_board", JSONObject().put("cid", currentClass().optString("id"))).rows() }.getOrDefault(emptyList())
    suspend fun credits(): List<JSONObject> = runCatching { api.rpc("credit_list").rows() }.getOrDefault(emptyList())

    // ---------- devices ----------
    private val deviceName get() = (Build.MANUFACTURER + " " + Build.MODEL).trim().take(40)

    /** Registers this device; signs out locally if another device revoked it. */
    suspend fun touchDevice() {
        if (!api.logged()) return
        val r = api.rpc("device_touch", JSONObject().put("p_device", deviceId).put("p_name", deviceName).put("p_platform", "android")).obj()
        if (r.optBoolean("revoked")) { api.dropSession(); signedOut(); _error.value = "这台设备已在其他设备上被退出，请重新登录" }
    }
    suspend fun devices(): List<JSONObject> = api.rpc("device_list", JSONObject().put("p_device", deviceId)).rows()
    suspend fun revoke(id: String?, all: Boolean) {
        api.rpc("device_revoke", JSONObject().put("p_id", id ?: JSONObject.NULL).put("p_all", all).put("p_device", deviceId))
    }
}

/** Local data keys that are stored with the account but synced through dedicated RPCs. */
fun SyncStore.setCacheData(key: String, v: Any) = setLocalData(key, v)
