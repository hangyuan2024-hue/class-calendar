package com.laolao.classcalendar.core

import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

/**
 * 7.1 群消息自动收集（用户自己打开、自己授权「通知使用权」才会工作）
 * 微信 / QQ 群里的新消息弹通知时，在这台手机上用本地规则看一眼：像作业、截止、考试、开会、签到的，
 * 放进「待确认」清单，用户点「记下」才变成事项。消息只存在这台手机，不上传、不进账号同步。
 */
object Collect {
    const val WX = "com.tencent.mm"
    val QQ = setOf("com.tencent.mobileqq", "com.tencent.tim", "com.tencent.qqlite")
    private const val INBOX = "collect_inbox_v1"          // 不在 Sync.KINDS 里：只存本机
    private const val MAX = 80

    fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences("collect", Context.MODE_PRIVATE)
    fun on(ctx: Context) = prefs(ctx).getBoolean("on", false)
    fun wxOn(ctx: Context) = prefs(ctx).getBoolean("wx", true)
    fun qqOn(ctx: Context) = prefs(ctx).getBoolean("qq", true)
    /** 只看名字里带这些字的群（空 = 不限）。用空格或逗号隔开 */
    fun groups(ctx: Context): String = prefs(ctx).getString("groups", "") ?: ""
    fun set(ctx: Context, k: String, v: Any) { val e = prefs(ctx).edit(); when (v) { is Boolean -> e.putBoolean(k, v); is String -> e.putString(k, v) }; e.apply() }

    /** 系统设置里有没有给「通知使用权」 */
    fun granted(ctx: Context): Boolean {
        val s = Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: return false
        return s.split(":").any { it.startsWith(ctx.packageName + "/") }
    }

    // 像要记下来的：作业、截止、考试、开会、签到、报名……
    val KEY = Regex("作业|习题|练习|报告|论文|实验|截止|ddl|提交|上交|交到|收齐|考试|测验|小测|期中|期末|补考|签到|打卡|班会|开会|会议|集合|讲座|报名|填写|问卷|教室|调课|停课|补课|上课|答辩|汇报|体测|核对|缴费|领取|务必|请大家|请同学", RegexOption.IGNORE_CASE)
    // 明显是闲聊的，不收
    private val CHAT = Regex("^(收到|好的|好|ok|谢谢|谢谢老师|1|嗯|哈+|[。.!！?？~～]+)$", RegexOption.IGNORE_CASE)

    class Hit(val id: String, val app: String, val group: String, val sender: String, val text: String, val at: Long)

    fun inbox(): List<Hit> = Kv.arr(INBOX).objs().map { Hit(it.str("id"), it.str("app"), it.str("g"), it.str("s"), it.str("t"), it.optLong("at")) }
    fun count(): Int = Kv.arr(INBOX).length()
    fun remove(id: String) { val out = JSONArray(); for (x in Kv.arr(INBOX).objs()) if (x.str("id") != id) out.put(x); Kv.setQuiet(INBOX, out); Bus.emit("collect") }
    fun clear() { Kv.setQuiet(INBOX, JSONArray()); Bus.emit("collect") }

    /** 值不值得收：有关键词，并且写了日期 / 时间，或者本身就是作业、考试这种 */
    fun worth(text: String): Boolean {
        val t = text.trim()
        if (t.length < 6 || CHAT.matches(t)) return false
        if (!KEY.containsMatchIn(t)) return false
        val today = T.today()
        return Memo.findDate(t, today) != null || Memo.findTime(t) != null || Regex("作业|截止|ddl|考试|签到|报名|提交|上交", RegexOption.IGNORE_CASE).containsMatchIn(t)
    }

    /**
     * 通知里拿到的一条：标题一般是群名（QQ 会带「(3条新消息)」），正文是「张三: 内容」或「[2条]张三: 内容」
     * 返回 true = 收进了待确认清单
     */
    fun consider(ctx: Context, pkg: String, title0: String, text0: String, at: Long): Boolean {
        if (!on(ctx)) return false
        val app = when { pkg == WX && wxOn(ctx) -> "微信"; pkg in QQ && qqOn(ctx) -> "QQ"; else -> return false }
        val group = title0.replace(Regex("\\s*[（(]\\d+\\s*条新消息[)）]\\s*$"), "").trim()
        var body = text0.replace(Regex("^\\s*\\[\\d+条]\\s*"), "").trim()
        var sender = ""
        Regex("^([^:：\\n]{1,16})[:：]\\s*").find(body)?.let { sender = it.groupValues[1].trim(); body = body.substring(it.value.length).trim() }
        if (body.startsWith("[图片]") || body.startsWith("[语音]") || body.startsWith("[动画表情]") || body.startsWith("[视频]")) return false
        val want = groups(ctx).split(Regex("[\\s,，、]+")).filter { it.isNotEmpty() }
        if (want.isNotEmpty() && want.none { group.contains(it) }) return false
        if (!worth(body)) return false
        val list = Kv.arr(INBOX).objs().toMutableList()
        // 同一条通知会被系统重复推几次（更新条数），去重
        if (list.any { it.str("g") == group && it.str("t") == body }) return false
        list.add(0, jsonOf("id" to "c" + at + "_" + (body.hashCode() and 0xffff), "app" to app, "g" to group, "s" to sender, "t" to body.take(1200), "at" to at))
        Kv.setQuiet(INBOX, JSONArray(list.take(MAX)))
        Bus.emit("collect")
        return true
    }

    /** 把一条消息变成事项（和「一句话记事」同一套规则；写了「下节课前」的按课表算） */
    fun toRow(text: String): Memo.Row = Items.withLesson(Memo.quick(text), text)

    /** 记下：存成自己的事项，原消息留在备注里方便以后对照 */
    fun keep(h: Hit, row: Memo.Row) {
        val rec = jsonOf("id" to "p" + System.currentTimeMillis() + "_c", "subject" to row.subject,
            "event_time" to if (row.day.isEmpty()) "" else row.day + if (row.time.isNotEmpty()) " " + row.time else "",
            "location" to row.place, "note" to "来自${h.app}「${h.group}」" + (if (h.sender.isNotEmpty()) " · " + h.sender else "") + "：\n" + h.text,
            "done" to false, "src" to "collect")
        if (row.homework) rec.put("kind", "作业")
        Items.saveMine(rec)
        remove(h.id)
    }
}
