package com.laolao.classcalendar.core

import org.json.JSONObject

/**
 * 5.9.2 重要事项弹窗（和网页、小程序、电脑版同一套，接口在 5.9.2 的 SQL）：
 * 老师、班委发布 / 修改班级事项时勾「📣 弹窗提醒全班」→ 同学下次打开时弹出来，点「我知道了」以后不再弹（换设备也不弹）
 */
object Popup {
    @Volatile var items: Set<Long> = emptySet(); private set
    private val later = mutableSetOf<Long>()
    @Volatile private var at = 0L
    @Volatile private var cidOf = ""

    /** 拿这个班设了弹窗的事项；返回我已经点过「我知道了」的 */
    fun refresh(cid: String): Set<Long> {
        val r = Api.rpc("popup_state", jsonOf("p_cid" to cid)) as? JSONObject ?: JSONObject()
        val its = r.optJSONArray("items"); val ack = r.optJSONArray("acked")
        items = (0 until (its?.length() ?: 0)).map { its!!.optLong(it) }.toSet()
        cidOf = cid; at = System.currentTimeMillis()
        return (0 until (ack?.length() ?: 0)).map { ack!!.optLong(it) }.toSet()
    }
    fun has(id: String?): Boolean = id?.toLongOrNull()?.let { it in items } ?: false
    fun set(cid: String, id: String, on: Boolean) {
        Api.rpc("popup_set", jsonOf("p_cid" to cid, "p_item" to id.toLong(), "p_on" to on))
        items = if (on) items + id.toLong() else items - id.toLong()
    }
    fun ack(id: Long) { try { Api.rpc("popup_ack", jsonOf("p_item" to id)) } catch (_: Exception) {} }
    fun later(id: Long) { synchronized(later) { later += id } }

    /** 还没看过的重要事项（后台线程调；一分钟最多问一次服务器）。数据库还没升级时返回空 */
    fun pending(force: Boolean = false): List<JSONObject> {
        val c = Store.cls ?: return emptyList(); val cid = c.str("id")
        if (!force && System.currentTimeMillis() - at < 60_000 && cidOf == cid) return emptyList()
        val acked = try { refresh(cid) } catch (_: Exception) { return emptyList() }
        val old = T.addDays(T.todayKey(), -1)
        return Store.items.filter { r ->
            val id = r.opt("id")?.toString()?.toLongOrNull() ?: return@filter false
            id in items && id !in acked && synchronized(later) { id !in later } && !(r.str("event_time").length >= 10 && r.str("event_time").take(10) < old)
        }
    }
}
