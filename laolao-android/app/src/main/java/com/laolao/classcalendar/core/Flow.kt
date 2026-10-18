package com.laolao.classcalendar.core

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime

/**
 * 5.9.4 刷任务 · 随机掉落 · 班级同步自习：和网页 / 小程序 / 电脑版的 coach-core.js 同一套规则（测试用同样的例子）。
 *  · 刷任务：把要做的事切成一张张小卡（先只做 2 分钟，再 5 分钟、10 分钟），像刷视频一样上划下一张；
 *    每张卡要真的计时走完才算；每轮 50 分钟就停（明确的终点：刷完了就去玩），中间插休息卡；深夜和上课时不刷。
 *  · 随机掉落：每张走完的卡都有机会掉一样收藏；今天第一张必掉，卡越长越容易掉，连着 8 次普通下一个至少稀有，
 *    一天最多 10 个，重复的变成碎片可以换没有的。乱点「做完了」不会掉任何东西。
 *  · 班级同步自习：只有人数和分钟数（接口在 5.9.4 的 SQL），没有名字。
 */
object Flow {
    const val BAG = "coach_bag_v1"
    const val ROUND = 50
    const val DAY_CAP = 10
    private const val MIN = 60_000L

    // ---------- 刷任务的卡 ----------
    class Card(val kind: String, val key: String, val title: String, val min: Int, val step: String)
    class Deck(val cards: List<Card>, val work: Int, val end: String, val say: String)

    fun deck(ranked: List<Island.Row>, nowMs: Long, skip: Map<String, Long> = emptyMap()): Deck {
        val h = LocalDateTime.ofInstant(Instant.ofEpochMilli(nowMs), T.BJ).hour
        if (h >= 23 || h < 5) return Deck(emptyList(), 0, "sleep", "夜深了，今天不刷了，睡饱了明天效率更高 🌙")
        ranked.firstOrNull { it.kind == "course" && it.level == "now" }?.let { return Deck(emptyList(), 0, "class", "正在上「${it.title}」，下课再来刷 📚") }
        val items = ranked.filter { it.kind == "item" && it.level != "past" && Coach.doable(it) && (skip[it.key] ?: 0L) <= nowMs }.take(3)
        val cards = ArrayList<Card>(); var work = 0; var since = 0
        fun add(c: Card): Boolean {
            if (work >= ROUND) return false
            if ((c.kind == "work" || c.kind == "start" || c.kind == "review") && since >= 25) { cards += Card("break", "", "休息一下", 3, "站起来喝口水，看看远处 👀"); since = 0 }
            cards += c
            if (c.kind != "check" && c.kind != "break") { work += c.min; since += c.min }
            return true
        }
        for (x in items) {
            add(Card("start", x.key, x.title, 2, "只做 2 分钟：" + startStep(x)))
            add(Card("work", x.key, x.title, 5, "开了头就不难了，接着做 5 分钟"))
            add(Card("work", x.key, x.title, 10, "进入状态了，再做 10 分钟"))
            if (work < ROUND || cards.last().key == x.key) cards += Card("check", x.key, x.title, 0, "「${x.title}」做完了吗？")
        }
        val rv = listOf("挑一门最近吃力的课，翻开课本看 2 分钟", "把今天课上的笔记过一遍", "做几道练习题，错的标出来", "预习明天的课，把看不懂的地方圈出来", "把错题再做一遍")
        var i = 0
        while (work < ROUND && i < 12) { add(Card(if (i == 0) "start" else "review", "review", "复习 / 预习", if (i == 0) 2 else if (i < 2) 5 else 10, rv[i % rv.size])); i++ }
        cards += Card("end", "", "这一轮刷完了", 0, "专注了 $work 分钟 🎉 去玩吧，想继续可以再来一轮")
        return Deck(cards, work, "", if (items.isNotEmpty()) "从「${items[0].title}」开始，先只做 2 分钟" else "没有要赶的事，来一轮复习 / 预习")
    }
    private fun startStep(x: Island.Row) = when {
        x.exam -> "翻开课本，列出要考的 3 个重点"
        x.type == "作业" -> "把作业拿出来，读完第一题"
        x.type == "会议" || x.type == "活动" -> "看看要准备什么，列个清单"
        else -> "打开它，看看第一步是什么"
    }
    fun more(c: Card) = Card("work", c.key, c.title, 10, "再来 10 分钟，快好了")
    /** 离开 App 的那段时间：30 分钟以内算到这张卡剩下的时间为止；离开太久这张重来（-1） */
    fun awayCredit(awayMs: Long, remainMs: Long): Long = if (awayMs > 30 * MIN) -1 else maxOf(0L, minOf(awayMs, remainMs))

    // ---------- 随机掉落 ----------
    class Loot(val id: String, val e: String, val name: String, val r: Int, val wear: Boolean = false)
    val LOOT = listOf(
        Loot("star", "⭐", "小星星", 0), Loot("clover", "🍀", "四叶草", 0), Loot("donut", "🍩", "甜甜圈", 0), Loot("straw", "🍓", "草莓", 0), Loot("leaf", "🌿", "嫩芽", 0),
        Loot("pencil", "✏️", "铅笔头", 0), Loot("book", "📘", "蓝皮书", 0), Loot("milk", "🥛", "一杯牛奶", 0), Loot("sun", "🌤️", "晴天", 0), Loot("shell", "🐚", "贝壳", 0),
        Loot("fish", "🐟", "小鱼干", 0), Loot("cookie", "🍪", "曲奇", 0), Loot("bag", "🎒", "小书包", 0, true), Loot("cap", "🧢", "鸭舌帽", 0, true),
        Loot("rainbow", "🌈", "彩虹", 1), Loot("whale", "🐳", "鲸鱼", 1), Loot("fox", "🦊", "小狐狸", 1), Loot("panda", "🐼", "熊猫", 1), Loot("moon", "🌙", "月牙", 1),
        Loot("rocket", "🚀", "小火箭", 1), Loot("bulb", "💡", "灵光一闪", 1), Loot("glasses", "🕶️", "墨镜", 1, true), Loot("phones", "🎧", "耳机", 1, true), Loot("scarf", "🧣", "围巾", 1, true),
        Loot("comet", "☄️", "彗星", 2), Loot("owl", "🦉", "夜猫头鹰", 2), Loot("dragon", "🐉", "小龙", 2), Loot("medal", "🏅", "奖牌", 2), Loot("hat", "🎩", "魔术帽", 2, true), Loot("grad", "🎓", "学士帽", 2, true),
        Loot("crown", "👑", "皇冠", 3, true), Loot("gem", "💎", "钻石", 3), Loot("trophy", "🏆", "奖杯", 3), Loot("halo", "😇", "光环", 3, true),
    )
    val RARITY = listOf("普通", "稀有", "史诗", "传说")
    val SHARD = intArrayOf(1, 2, 4, 8)
    val COST = intArrayOf(5, 10, 20, 40)
    val RC = intArrayOf(0xFF94A3B8.toInt(), 0xFF3B82F6.toInt(), 0xFFA855F7.toInt(), 0xFFF59E0B.toInt())
    fun loot(id: String) = LOOT.firstOrNull { it.id == id }

    class Bag(val own: MutableMap<String, Int> = HashMap(), var sh: Int = 0, var pity: Int = 0, var day: String = "", var dn: Int = 0, var wear: String = "", var n: Int = 0) {
        fun json(): JSONObject = JSONObject().put("v", 1).put("own", JSONObject().also { o -> own.forEach { (k, v) -> o.put(k, v) } })
            .put("sh", sh).put("pity", pity).put("day", day).put("dn", dn).put("wear", wear).put("n", n)
        fun owned() = own.count { it.value > 0 && loot(it.key) != null }
    }
    fun bag(o: JSONObject?, nowMs: Long): Bag {
        val t = T.key(LocalDateTime.ofInstant(Instant.ofEpochMilli(nowMs), T.BJ).toLocalDate())
        val b = Bag(day = t)
        if (o != null && o.optInt("v") == 1) {
            o.optJSONObject("own")?.let { m -> m.keys().forEach { k -> b.own[k] = m.optInt(k) } }
            b.sh = o.optInt("sh"); b.pity = o.optInt("pity"); b.wear = o.optString("wear"); b.n = o.optInt("n")
            if (o.optString("day") == t) b.dn = o.optInt("dn")
        }
        return b
    }
    class Roll(val bag: Bag, val got: Loot?, val dup: Boolean = false, val first: Boolean = false, val shard: Int = 0, val cap: Boolean = false)
    fun roll(b: Bag, min: Int, rnd: () -> Double = { Math.random() }): Roll {
        if (min < 2) return Roll(b, null)
        if (b.dn >= DAY_CAP) return Roll(b, null, cap = true)
        val first = b.dn == 0; val p = if (first) 1.0 else minOf(0.85, 0.08 * min)
        if (rnd() >= p) return Roll(b, null)
        val x = rnd(); var rar = if (x < 0.03) 3 else if (x < 0.13) 2 else if (x < 0.4) 1 else 0
        if (rar == 0 && b.pity >= 7) rar = 1
        b.pity = if (rar >= 1) 0 else b.pity + 1
        val pool = LOOT.filter { it.r == rar }; val got = pool[minOf(pool.size - 1, (rnd() * pool.size).toInt())]
        val dup = (b.own[got.id] ?: 0) > 0
        if (dup) b.sh += SHARD[rar]
        b.own[got.id] = (b.own[got.id] ?: 0) + 1; b.dn++; b.n++
        return Roll(b, got, dup, first, if (dup) SHARD[rar] else 0)
    }
    fun redeem(b: Bag, id: String): Boolean {
        val l = loot(id) ?: return false
        if ((b.own[id] ?: 0) > 0 || b.sh < COST[l.r]) return false
        b.sh -= COST[l.r]; b.own[id] = 1; return true
    }
    fun mergeBag(b: Bag, others: List<JSONObject>): Bag {
        for (o in others) o.optJSONObject("own")?.let { m -> m.keys().forEach { k -> if (m.optInt(k) > (b.own[k] ?: 0)) b.own[k] = m.optInt(k) } }
        return b
    }

    // ---------- 班级同步自习 ----------
    fun roomLine(now: Int, todayMin: Int, streak: Int): String {
        val a = ArrayList<String>()
        if (now > 0) a += "班里现在 $now 人在专注"
        if (todayMin > 0) a += "今天全班 $todayMin 分钟"
        if (streak > 0) a += "班级连续 $streak 天"
        return a.joinToString(" · ").ifEmpty { "你是今天班里第一个开始的 💪" }
    }

    // =====================================================================
    // 手机上的存取
    fun myBag(): Bag = bag(Kv.obj(BAG), System.currentTimeMillis())
    /** 这台的收藏 + 别的设备同步过来的（每样取最多的那台） */
    fun fullBag(): Bag {
        val all = Kv.obj(Coach.SYNC); val dev = Store.deviceId()
        return mergeBag(myBag(), all.keys().asSequence().filter { it != dev }.mapNotNull { all.optJSONObject(it)?.optJSONObject("bag") }.toList())
    }
    fun save(b: Bag) { Kv.setQuiet(BAG, b.json()); Coach.touch(); try { Coach.model() } catch (_: Exception) {} }
    fun wearEmoji(): String = loot(Kv.obj(BAG).optString("wear"))?.e ?: ""
    fun deckNow(): Deck { val c = Island.ctx(); return deck(Island.rank(c.items, c.courses, c.now), System.currentTimeMillis(), Coach.skips()) }
}
