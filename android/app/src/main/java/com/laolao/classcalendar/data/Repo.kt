package com.laolao.classcalendar.data

import android.content.Context
import android.os.Build
import com.laolao.classcalendar.model.AgendaItem
import com.laolao.classcalendar.model.AgendaModel
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
        } catch (e: ApiError) {
            if (e.status == 401) signedOut()
            if (!quiet) _error.value = e.message
        } catch (e: Exception) {
            if (!quiet) _error.value = e.message ?: "同步失败，本地数据已保留"
        } finally { _busy.value = false }
    }

    fun clearError() { _error.value = null }

    // ---------- personal events ----------
    fun saveEvent(id: String?, title: String, date: LocalDate, time: String, place: String, note: String) {
        val key = id ?: ("n" + UUID.randomUUID().toString().replace("-", "").take(16))
        s.entry("personal_events_v1", key, JSONObject().put("id", key).put("subject", title.trim()).put("event_time", date.toString() + if (time.isBlank()) "" else " $time")
            .put("location", place.trim()).put("note", note.trim()))
    }
    fun deleteEvent(id: String) { s.entry("personal_events_v1", id, null) }
    fun toggleDone(id: String) {
        val m = marks().optJSONObject(id) ?: JSONObject()
        m.put("done", !m.optBoolean("done"))
        s.entry("personal_marks_v1", id, m)
    }

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
