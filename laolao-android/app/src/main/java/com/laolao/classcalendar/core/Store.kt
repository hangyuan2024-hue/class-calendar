package com.laolao.classcalendar.core

import android.content.Context
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/** 全局状态：我是谁、我的班级、班级事项、功能开关。打开 App 先用上次的缓存画出来，网络回来再刷新 */
object Store {
    private const val LS_ME = "app_me_v1"
    private const val LS_CACHE = "app_class_cache_v1"
    private const val LS_CUR = "current_class_v1"
    const val COLS = "id,msg_type,subject,summary,event_time,location,prepare,original,publish_date,need_confirm,created_by"

    @Volatile var me: JSONObject? = null
    @Volatile var classes: List<JSONObject> = emptyList()
    @Volatile var pending: List<JSONObject> = emptyList()
    @Volatile var cls: JSONObject? = null
    @Volatile var items: List<JSONObject> = emptyList()
    @Volatile var itemsAt = 0L
    @Volatile var feats: JSONObject = JSONObject()
    @Volatile var error = ""
    @Volatile var ready = false
    /** 上次完整加载成功的时间 */
    @Volatile var bootAt = 0L
    private lateinit var app: Context

    fun init(ctx: Context) {
        if (::app.isInitialized) return
        app = ctx.applicationContext
        Kv.init(app); Api.init(app); Net.init(app)
        Kv.onSet = { Sync.note(it) }
        warm()
    }
    private fun warm() {
        val uid = Api.uid ?: return
        (Kv.get(LS_ME) as? JSONObject)?.takeIf { it.str("id") == uid }?.let { me = it }
        val c = Kv.get(LS_CACHE) as? JSONObject ?: return
        if (me == null) return
        classes = (c.optJSONArray("classes") ?: JSONArray()).objs()
        cls = c.optJSONObject("cls")
        items = (c.optJSONArray("records") ?: JSONArray()).objs()
        itemsAt = c.optLong("at")
        feats = c.optJSONObject("feat") ?: JSONObject()
    }
    private fun save() {
        val c = jsonOf("classes" to JSONArray(classes), "cls" to cls, "records" to JSONArray(items), "at" to itemsAt, "feat" to feats)
        Kv.setQuiet(LS_CACHE, c)
    }

    fun feat(k: String): Boolean = feats.optJSONObject(k)?.let { it.opt("on") != false } ?: true
    fun can(perm: String): Boolean = cls?.optBoolean(perm) ?: false
    val isTeacher: Boolean get() = cls?.optBoolean("is_teacher") ?: false
    fun role(): String = when { cls == null -> ""; isTeacher -> if (me?.str("role") == "teacher") "老师" else "管理者"; cls!!.str("member_role") == "monitor" -> "班委"; else -> "学生" }
    fun isTeacherRole(): Boolean = me?.str("role") == "teacher" || me?.str("role") == "admin"
    fun name(): String = me?.let { it.str("display_name").ifBlank { it.str("account") } } ?: ""
    /** 职场人员：班级→团队、作业→任务 */
    fun work(): Boolean = me?.str("org_type") == "work"

    /** 冷启动 / 登录后：一次拿全（app_bootstrap），再开同步、拿课表、设备报到 */
    fun boot(): Boolean {
        if (!Api.loggedIn) { reset(); ready = true; Bus.emit("user"); return false }
        try {
            val b = Api.rpc("app_bootstrap", jsonOf("cid" to Kv.str(LS_CUR).ifBlank { null })) as? JSONObject
            if (b == null || b.optJSONObject("me") == null) { if (!Api.loggedIn) { reset(); Bus.emit("user"); return false }; throw ApiError(0, "没拿到账号信息") }
            val m = b.getJSONObject("me"); m.put("perms", b.optJSONArray("perms") ?: JSONArray())
            me = m; Kv.setQuiet(LS_ME, m)
            setClasses((b.optJSONArray("classes") ?: JSONArray()).objs(), b.str("cid"))
            feats = b.optJSONObject("features") ?: JSONObject()
            if (cls != null && b.optJSONArray("items") != null && b.str("cid") == cls!!.str("id")) putItems(b.getJSONArray("items").objs()) else loadItems()
            error = ""
        } catch (e: Exception) {
            error = e.message ?: "网络不太好"
            ready = true; Bus.emit("class")
            return false
        }
        ready = true; bootAt = System.currentTimeMillis()
        Bus.emit("user"); Bus.emit("class")
        val uid = Api.uid ?: return true
        Sync.start(uid)
        try { Courses.pull() } catch (_: Exception) {}
        touchDevice()
        Bus.emit("data")
        return true
    }
    private fun setClasses(all: List<JSONObject>, want: String) {
        classes = all.filter { it.str("status") == "approved" || it.optBoolean("is_teacher") }
        pending = all.filter { it.str("status") == "pending" && !it.optBoolean("is_teacher") }
        val w = want.ifBlank { Kv.str(LS_CUR) }
        cls = classes.firstOrNull { it.str("id") == w } ?: classes.firstOrNull()
        Kv.setQuiet(LS_CUR, cls?.str("id"))
    }
    fun putItems(list: List<JSONObject>) { items = list; itemsAt = System.currentTimeMillis(); save() }
    fun loadItems() {
        val c = cls
        if (c == null) { putItems(emptyList()); Bus.emit("class"); return }
        val rows = Api.rest("class_info?select=$COLS&class_id=eq.${c.str("id")}&order=id.asc&limit=2000") as? JSONArray ?: JSONArray()
        if (cls?.str("id") == c.str("id")) { putItems(rows.objs()); Bus.emit("class") }
    }

    /** 下拉刷新 / 回到前台 / 后台定时：班级列表、事项、我的数据、课表 */
    fun refresh(): Boolean {
        if (!Api.loggedIn) return false
        if (me == null) return boot()
        try {
            setClasses(Api.rpcArr("my_classes").objs(), cls?.str("id") ?: "")
            try { feats = (Api.rpc("feature_state", jsonOf("cid" to cls?.str("id"))) as? JSONObject) ?: feats } catch (_: Exception) {}
            loadItems()
            error = ""
        } catch (e: Exception) { error = e.message ?: "网络不太好"; Bus.emit("class"); return false }
        Sync.pull()
        try { Courses.pull() } catch (_: Exception) {}
        Bus.emit("data")
        return true
    }
    fun switchClass(id: String) {
        val c = classes.firstOrNull { it.str("id") == id } ?: return
        cls = c; Kv.setQuiet(LS_CUR, id); items = emptyList(); Bus.emit("class")
        try { feats = (Api.rpc("feature_state", jsonOf("cid" to id)) as? JSONObject) ?: feats } catch (_: Exception) {}
        loadItems()
    }
    fun join(code: String): JSONObject {
        val r = Api.rpcObj("join_class", jsonOf("ccode" to code.trim().uppercase()))
        refresh()
        if (r.str("status") == "approved" && classes.any { it.str("id") == r.str("class_id") }) switchClass(r.str("class_id"))
        return r
    }

    fun reset() { me = null; classes = emptyList(); pending = emptyList(); cls = null; items = emptyList(); itemsAt = 0; feats = JSONObject(); Sync.stop() }

    /** 退出登录：班级缓存一律清掉；wipe = 连这台手机上的个人数据也清掉 */
    fun logout(wipe: Boolean) {
        try { Sync.finish() } catch (_: Exception) {}
        Api.signOut()
        Courses.clearLocal()
        Kv.clear { k -> !wipe && !(k == LS_ME || k == LS_CACHE || k == LS_CUR) }
        reset()
        Bus.emit("user"); Bus.emit("class"); Bus.emit("data")
    }

    // ---------- 登录设备（「我的 → 账号安全」里能看到、能踢出） ----------
    fun deviceId(): String {
        val p = app.getSharedPreferences("device", Context.MODE_PRIVATE)
        return p.getString("id", null) ?: ("and_" + java.util.UUID.randomUUID().toString().replace("-", "").take(20)).also { p.edit().putString("id", it).apply() }
    }
    fun deviceName(): String = "安卓 App · " + (Build.MANUFACTURER.replaceFirstChar { it.uppercase() } + " " + Build.MODEL).trim()
    private fun touchDevice() {
        try {
            val r = Api.rpc("device_touch", jsonOf("p_device" to deviceId(), "p_name" to deviceName(), "p_platform" to "android")) as? JSONObject
            if (r?.optBoolean("revoked") == true) { Api.signOut(); reset(); Api.onLost?.let { f -> Bg.ui { f("revoked") } } }
        } catch (_: Exception) {}
    }
}
