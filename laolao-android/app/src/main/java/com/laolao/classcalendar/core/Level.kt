package com.laolao.classcalendar.core

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject

/**
 * 6.9 账号等级（经验值）。和网页 level-ui.js、小程序 lib/level.js 同一套规则，经验在数据库里算（level.sql 的 xp_*）：
 * 完成班级作业 +10 / 其它班级事项 +5、自己的事项 +2（每天 5 件）、习惯打卡 +3（每天 5 次）、番茄钟 +2（每天 12 个）、位置签到 +5。
 * 同一件事只算一次，取消完成会扣回来，所以反复勾、取消刷不出经验。
 */
object Level {
    private const val LS = "xp_me_v1"
    private val TITLES = listOf(1 to "新同学", 2 to "小学徒", 3 to "见习生", 4 to "进阶者", 5 to "好学者", 6 to "行动派", 8 to "学霸", 10 to "卷王", 13 to "大神", 16 to "传说")
    fun title(l: Int): String = TITLES.lastOrNull { l >= it.first }?.second ?: TITLES[0].second

    data class L(val level: Int, val xp: Int, val from: Int, val to: Int) {
        val pct: Int get() = ((xp - from) * 100 / maxOf(1, to - from)).coerceIn(0, 100)
        val need: Int get() = maxOf(0, to - xp)
        val title: String get() = title(level)
    }
    fun parse(o: JSONObject?): L? = o?.takeIf { it.has("level") }?.let { L(it.optInt("level", 1), it.optInt("xp"), it.optInt("from"), it.optInt("to", 50)) }
    /** 本地缓存：{ uid, level:{...}, today } */
    private fun cache(): JSONObject? { val c = Kv.obj(LS); return if (c.str("uid").isNotEmpty() && c.str("uid") == (Store.me?.str("id") ?: "")) c else null }
    fun me(): L? = parse(cache()?.optJSONObject("level"))
    fun today(): Int = cache()?.optInt("today") ?: 0

    /** 界面提示：经验 +N / 升级（Main 里设置成弹 Toast） */
    var onXp: ((points: Int, l: L, up: Boolean) -> Unit)? = null

    private fun apply(r: JSONObject, undo: Boolean) {
        val l = parse(r.optJSONObject("level")) ?: return
        val uid = Store.me?.str("id") ?: return
        val old = me()?.level ?: 0
        val pts = if (undo) 0 else r.optInt("points")
        Kv.setQuiet(LS, jsonOf("uid" to uid, "level" to r.getJSONObject("level"), "today" to maxOf(0, today() + pts)))
        Bg.ui { if (pts > 0) onXp?.invoke(pts, l, old > 0 && l.level > old); Bus.emit("xp") }
    }
    /** kind：done（班级事项 id）/ mine（自己的事项 id）/ habit（习惯id|日期）/ pomo（日期|序号） */
    fun log(kind: String, ref: String, undo: Boolean) {
        if (Store.me == null) return
        Bg.run { try { (Api.rpc("xp_log", jsonOf("k" to kind, "r" to ref, "undo" to undo)) as? JSONObject)?.let { apply(it, undo) } } catch (_: Exception) { /* 数据库还没升级：不影响打勾 */ } }
    }
    fun refresh(done: (() -> Unit)? = null) {
        val uid = Store.me?.str("id") ?: run { done?.invoke(); return }
        Bg.load({ Api.rpcObj("xp_me") }) { r, _ ->
            if (r != null && r.has("level")) Kv.setQuiet(LS, jsonOf("uid" to uid, "level" to r.getJSONObject("level"), "today" to r.optInt("today")))
            done?.invoke()
        }
    }
    fun board(cid: String): JSONObject = Api.rpcObj("xp_board", jsonOf("cid" to cid))
}

/** 定位（一次）：GPS / 网络，WGS-84 原始坐标（和网页、小程序一样），只在点按钮那一下取 */
object Geo {
    data class Pos(val lat: Double, val lng: Double, val acc: Int)
    fun dist(aLat: Double, aLng: Double, bLat: Double, bLng: Double): Double {
        val r = 6371000.0; val dLat = Math.toRadians(bLat - aLat); val dLng = Math.toRadians(bLng - aLng)
        val h = Math.pow(Math.sin(dLat / 2), 2.0) + Math.cos(Math.toRadians(aLat)) * Math.cos(Math.toRadians(bLat)) * Math.pow(Math.sin(dLng / 2), 2.0)
        return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(h)))
    }
    /** 要先有定位权限（Main.needLocation）。最多等 15 秒，取最准的一次；精度到 30 米以内就提前结束 */
    @SuppressLint("MissingPermission")
    fun once(ctx: Context, done: (Pos?, String) -> Unit) {
        val lm = ctx.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val provs = listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter { try { lm.isProviderEnabled(it) } catch (_: Exception) { false } }
        if (provs.isEmpty()) { done(null, "手机的定位（位置信息）没打开，打开后再试"); return }
        var best: Location? = null; var finished = false
        val fresh = provs.mapNotNull { try { lm.getLastKnownLocation(it) } catch (_: Exception) { null } }.filter { System.currentTimeMillis() - it.time < 30_000 }.minByOrNull { it.accuracy }
        if (fresh != null && fresh.accuracy <= 30) { done(Pos(fresh.latitude, fresh.longitude, fresh.accuracy.toInt()), ""); return }
        lateinit var ls: LocationListener
        fun finish() {
            if (finished) return; finished = true
            try { lm.removeUpdates(ls) } catch (_: Exception) {}
            val b = best ?: fresh
            if (b == null) done(null, "没定位到，到窗边或空旷一点的地方再试试") else done(Pos(b.latitude, b.longitude, b.accuracy.toInt()), "")
        }
        ls = object : LocationListener {
            override fun onLocationChanged(l: Location) { if (best == null || l.accuracy < best!!.accuracy) best = l; if (l.accuracy <= 30) finish() }
            @Deprecated("Deprecated in Java") override fun onStatusChanged(p: String?, s: Int, e: android.os.Bundle?) {}
            override fun onProviderEnabled(p: String) {}
            override fun onProviderDisabled(p: String) {}
        }
        try { for (p in provs) lm.requestLocationUpdates(p, 500L, 0f, ls, Looper.getMainLooper()) }
        catch (e: SecurityException) { finished = true; done(null, "需要允许「位置信息」才能签到 / 打卡"); return }
        Bg.later(15_000) { finish() }
    }
}

/** 6.9 班级位置签到：班委 / 老师发起，同学到了现场（范围内）才能签；距离由服务器算 */
object Checkin {
    fun list(cid: String): List<JSONObject> = (Api.rpc("checkin_list", jsonOf("cid" to cid)) as? JSONArray)?.objs() ?: emptyList()
    /** mode：geo 位置 / code 动态码（不用定位）/ both 两个都要 */
    /** 7.3 photo：拍照签到（拍一张现场照片就签）；photo = true：位置 / 动态码之外还要拍照 */
    fun create(cid: String, title: String, place: String, p: Geo.Pos?, radius: Int, minutes: Int, mode: String = "geo", photo: Boolean = false): JSONObject {
        val a = jsonOf("cid" to cid, "title" to title, "place" to place, "radius" to radius, "minutes" to minutes, "mode" to mode)
        if (p != null) { a.put("lat", Math.round(p.lat * 1e6) / 1e6); a.put("lng", Math.round(p.lng * 1e6) / 1e6) }
        if (photo && mode != "photo") a.put("photo", true)   // 老服务器没有这个参数：只在要拍照时带上
        return try { Api.rpcObj("checkin_create", a) } catch (e: Exception) {
            if ((mode == "photo" || photo) && Regex("photo|check constraint|签到方式不对|Could not find", RegexOption.IGNORE_CASE).containsMatchIn(e.message ?: "")) throw ApiError(0, "拍照签到要先在数据库执行 7.3 的 SQL")
            throw e
        }
    }
    fun sign(id: Long, p: Geo.Pos?, code: String? = null, photo: String? = null): JSONObject {
        val a = jsonOf("id" to id)
        if (p != null) { a.put("lat", p.lat); a.put("lng", p.lng); a.put("accuracy", p.acc) }
        if (!code.isNullOrBlank()) a.put("code", code)
        if (!photo.isNullOrEmpty()) a.put("photo", photo)
        return Api.rpcObj("checkin_sign", a)
    }
    /** 签到照片（发起人、班委、老师看）；uid 为空 = 全部 */
    fun photos(id: Long, uid: String? = null): List<JSONObject> = (Api.rpc("checkin_photos", jsonOf("id" to id, "uid" to uid)) as? JSONArray)?.objs() ?: emptyList()
    fun needPhoto(x: JSONObject) = x.optBoolean("need_photo")
    fun get(id: Long): JSONObject = Api.rpcObj("checkin_get", jsonOf("id" to id))
    fun code(id: Long): JSONObject = Api.rpcObj("checkin_code", jsonOf("id" to id))
    fun needCode(x: JSONObject) = x.str("mode") == "code" || x.str("mode") == "both"
    fun needGeo(x: JSONObject) = x.str("mode").let { it.isEmpty() || it == "geo" || it == "both" }
    fun modeText(x: JSONObject) = when (x.str("mode")) { "code" -> "🔢 动态码签到"; "both" -> "📍 位置 + 🔢 动态码"; "photo" -> "📷 拍照签到"; else -> "📍 位置签到" } +
        if (x.optBoolean("need_photo") && x.str("mode") != "photo") " + 📷 拍照" else ""
    fun amap(x: JSONObject) = "https://uri.amap.com/marker?position=${x.optDouble("lng")},${x.optDouble("lat")}&name=${java.net.URLEncoder.encode(x.str("place").ifEmpty { x.str("title") }, "UTF-8")}&coordinate=wgs84&callnative=1"
    fun detail(id: Long): JSONObject = Api.rpcObj("checkin_detail", jsonOf("id" to id))
    fun close(id: Long) { Api.rpc("checkin_close", jsonOf("id" to id)) }
    /** 6.9.6 补签 / 撤销（发起人、班委、老师） */
    fun mark(id: Long, uid: String, signed: Boolean) { Api.rpc("checkin_mark", jsonOf("id" to id, "uid" to uid, "signed" to signed)) }
    /** 能发起签到：老师（建班的）或有发布 / AI 整理权限的班委；cid 为空就看当前班 */
    fun mgr(cid: String = ""): Boolean {
        val c = (if (cid.isEmpty()) Store.cls else Store.classes.firstOrNull { it.str("id") == cid }) ?: return false
        return c.optBoolean("is_teacher") || (c.str("member_role") == "monitor" && (c.optBoolean("can_edit") || c.optBoolean("can_ingest")))
    }
    /** 6.9.2 能不能签：班里的同学（班委也要签）；老师不用签。老服务器没有 can_sign 就按以前的规则 */
    fun signable(x: JSONObject): Boolean = if (x.has("can_sign")) x.optBoolean("can_sign") && !x.optBoolean("is_teacher") else !x.optBoolean("can_manage")
    fun leftText(x: JSONObject): String {
        val end = try { java.time.OffsetDateTime.parse(x.str("ends_at")).toInstant().toEpochMilli() } catch (_: Exception) { 0L }
        val m = maxOf(0L, (end - System.currentTimeMillis()) / 60000)
        return if (m >= 60) "${m / 60} 小时 ${m % 60} 分" else "$m 分钟"
    }
    fun hm(iso: String): String = try { val t = java.time.OffsetDateTime.parse(iso).atZoneSameInstant(T.BJ); "${t.monthValue}/${t.dayOfMonth} " + String.format("%02d:%02d", t.hour, t.minute) } catch (_: Exception) { "" }
    /** 首页提醒用：正在进行的那一个（缓存 25 秒） */
    @Volatile var open: JSONObject? = null; @Volatile private var openAt = 0L; @Volatile private var openCid = ""
    fun peek(done: () -> Unit) {
        val cid = Store.cls?.str("id") ?: run { open = null; return }
        if (Store.me == null || (cid == openCid && System.currentTimeMillis() - openAt < 25_000)) return
        openAt = System.currentTimeMillis(); openCid = cid
        Bg.load({ list(cid).firstOrNull { it.optBoolean("open") } }) { r, e -> if (e == null) { val ch = (r?.toString() ?: "") != (open?.toString() ?: ""); open = r; if (ch) done() } }
    }
}

/** 6.9 课表截图原图：存到账号里（course_shot_*），首页点课程时能看，框出这门课 */
object CourseShot {
    @Volatile private var mem: JSONObject? = null; @Volatile private var at = 0L
    fun push(b64: String, rows: List<JSONObject>) {
        if (Store.me == null || !b64.startsWith("/9j/") || b64.length > 2_300_000) return
        val items = JSONObject()
        rows.forEachIndexed { i, r -> val b = r.optJSONArray("_box") ?: return@forEachIndexed; items.put("a$i", jsonOf("box" to b, "name" to r.str("name"))) }
        val rec = jsonOf("img" to "data:image/jpeg;base64,$b64", "at" to System.currentTimeMillis(), "items" to items)
        mem = rec; at = System.currentTimeMillis()
        Bg.run { try { Api.rpc("course_shot_set", jsonOf("d" to rec)) } catch (_: Exception) {} }
    }
    /** 后台线程里调 */
    fun get(): JSONObject? {
        mem?.let { if (System.currentTimeMillis() - at < 300_000) return it }
        val r = try { Api.rpc("course_shot_get") as? JSONObject } catch (_: Exception) { null }
        mem = r?.takeIf { it.str("img").startsWith("data:image/jpeg;base64,") }; at = System.currentTimeMillis()
        return mem
    }
    /** 这门课在原图里的框 [x0,y0,x1,y1]（0~1）；按名字找 */
    fun boxOf(rec: JSONObject, name: String): DoubleArray? {
        val its = rec.optJSONObject("items") ?: return null
        for (k in its.keys()) {
            val v = its.opt(k)
            val (b, n) = when (v) { is JSONObject -> v.optJSONArray("box") to v.str("name"); is JSONArray -> v to ""; else -> null to "" }
            if (b != null && b.length() == 4 && (n == name || (n.isEmpty() && k == name))) return DoubleArray(4) { b.optDouble(it) }
        }
        return null
    }
}
