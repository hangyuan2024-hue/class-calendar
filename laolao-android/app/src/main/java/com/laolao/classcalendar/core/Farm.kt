package com.laolao.classcalendar.core

import org.json.JSONObject

/**
 * 云宠农场（照小程序 lib/farm.js：同一套规则、同一个键 farm_v1，跟着账号同步，三个端是同一只）
 * 养料从真实记录算：完成作业 +10、其它事项 +5、打卡 +3（每天最多 5 次）、番茄 +2（每天最多 12 个）、一天完成 3 件以上 +5、连续 3 天以上每天 +3
 */
object Farm {
    const val LS = "farm_v1"
    const val FEED_COST = 10
    const val FEED_EXP = 20
    val STAGE = listOf("孵化中", "幼崽期", "成长期", "完全体", "传说形态")
    val EVO = listOf(1 to "孵化", 2 to "幼崽", 4 to "成长期", 7 to "完全体", 10 to "传说")
    class Pet(val id: String, val name: String, val kind: String)
    val PETS = listOf(Pet("cloud", "云朵精灵", "人形 · 云朵"), Pet("berry", "草莓精灵", "人形 · 水果"), Pet("rice", "米粒精灵", "人形 · 谷物"),
        Pet("bread", "面包精灵", "人形 · 烘焙"), Pet("cat", "奶油猫咪", "动物 · 猫"), Pet("sprout", "树苗精灵", "植物 · 树"))
    private val HELLO = listOf("今天也一起加油呀", "完成一件事，我就能吃饱一点", "你专心的样子好帅", "打卡了吗？我在等养料哦", "慢慢来，比较快", "今天的你也很棒")
    fun expNeed(lv: Int) = 80 + (lv - 1) * 40
    fun stage(lv: Int) = when { lv >= 10 -> 4; lv >= 7 -> 3; lv >= 4 -> 2; lv >= 2 -> 1; else -> 0 }
    fun on(): Boolean = Store.feat("growth") && Kv.obj("fun_opts_v1").opt("farm") != false

    fun state(): JSONObject {
        val v = Kv.obj(LS)
        val s = jsonOf("pet" to "cloud", "name" to "小云朵", "level" to 1, "exp" to 0, "spent" to 0, "fed" to 0)
        for (k in v.keys()) s.put(k, v.get(k))
        if (PETS.none { it.id == s.str("pet") }) s.put("pet", "cloud")
        return s
    }
    private fun save(patch: JSONObject) { val s = state(); for (k in patch.keys()) s.put(k, patch.get(k)); s.put("at", System.currentTimeMillis()); Kv.set(LS, s); Bus.emit("data") }

    class Day(var done: Int = 0, var hw: Int = 0, var habit: Int = 0, var pomo: Int = 0, var food: Int = 0, var bonus: Int = 0)
    class Ledger(val days: Map<String, Day>, val total: Int, val today: Int, val streak: Int)
    private val DAY = Regex("^\\d{4}-\\d{2}-\\d{2}$")
    fun ledger(): Ledger {
        val byKey = Items.all(showHidden = true).associateBy { it.key }
        val days = sortedMapOf<String, Day>()
        fun d(k: String) = days.getOrPut(k) { Day() }
        val dl = Kv.obj(Items.DONE_LOG)
        for (k in dl.keys()) { val day = dl.optString(k); if (!DAY.matches(day)) continue; val x = d(day); x.done++; if (byKey[k]?.hw == true) x.hw++ }
        val hl = Kv.obj("habit_log_v1")
        for (id in hl.keys()) { val h = hl.optJSONObject(id) ?: continue; for (day in h.keys()) if (h.optBoolean(day) && DAY.matches(day)) d(day).habit++ }
        val pl = Kv.obj("pomo_log_v1")
        for (day in pl.keys()) if (DAY.matches(day) && pl.optInt(day) > 0) d(day).pomo += pl.optInt(day)
        var run = 0; var prev = ""; var total = 0
        for ((day, x) in days) {
            x.food = x.hw * 10 + (x.done - x.hw) * 5 + minOf(x.habit, 5) * 3 + minOf(x.pomo, 12) * 2
            if (x.done >= 3) x.bonus += 5
            run = if (prev.isNotEmpty() && T.addDays(prev, 1) == day) run + 1 else 1; prev = day
            if (run >= 3) x.bonus += 3
            x.food += x.bonus; total += x.food
        }
        var streak = 0; var k = T.todayKey()
        if (!days.containsKey(k)) k = T.addDays(k, -1)
        while (days.containsKey(k)) { streak++; k = T.addDays(k, -1) }
        return Ledger(days, total, days[T.todayKey()]?.food ?: 0, streak)
    }
    fun left(l: Ledger = ledger()): Int = maxOf(0, l.total - state().optInt("spent"))

    /** 喂一次（untilLevel：一直喂到升级或者养料用完）→ (成功没有, 说什么) */
    fun feed(untilLevel: Boolean): Pair<Boolean, String> {
        val s = state(); var left = left()
        var level = s.optInt("level", 1); var exp = s.optInt("exp"); var spent = s.optInt("spent"); var fed = s.optInt("fed"); var times = 0; var ups = 0
        if (left < FEED_COST) return false to "养料不够啦：去完成一件事、打个卡或者专注一个番茄 🌾"
        do {
            left -= FEED_COST; spent += FEED_COST; fed++; times++; exp += FEED_EXP
            while (exp >= expNeed(level)) { exp -= expNeed(level); level++; ups++ }
        } while (untilLevel && ups == 0 && left >= FEED_COST && times < 200)
        val before = stage(s.optInt("level", 1))
        save(jsonOf("level" to level, "exp" to exp, "spent" to spent, "fed" to fed))
        if (stage(level) > before) return true to "✨ 进化了！${s.str("name")} 变成了「${STAGE[stage(level)]}」"
        if (ups > 0) return true to "🎉 升级啦！现在是 Lv.$level"
        return true to if (times > 1) "🥕 喂了 $times 次，经验 +${times * FEED_EXP}" else "🥕 好吃！经验 +$FEED_EXP"
    }
    fun rename(name: String) { val n = name.trim().take(12); if (n.isNotEmpty()) save(jsonOf("name" to n)) }
    fun pick(id: String) { if (PETS.any { it.id == id }) save(jsonOf("pet" to id)) }
    fun hello(): String = HELLO[(T.today().dayOfMonth + state().optInt("level", 1)) % HELLO.size]
    /** 图片资源名（队友画的 SVG 在电脑上转成了 PNG） */
    fun img(pet: String, level: Int) = "pet_${pet}_${stage(level)}"
}

/** 等级与徽章（照小程序 lib/meta.js：经验全部由自己的记录算出来） */
object Meta {
    private val TITLES = listOf(1 to "新手旅人", 2 to "见习探索者", 3 to "时间猎手", 5 to "自律骑士", 8 to "星际学霸", 12 to "银河指挥官", 18 to "元宇宙传奇")
    class S(val doneAll: Int, val doneToday: Int, val checks: Int, val checksToday: Int, val bestStreak: Int, val pomos: Int, val pomosToday: Int,
            val goalsDone: Int, val pdcaRounds: Int, val ivyDone: Int, val exp: Int, val level: Int, val lo: Int, val hi: Int, val title: String) {
        val pct: Int get() = if (hi > lo) (exp - lo) * 100 / (hi - lo) else 0
    }
    fun stats(): S {
        val t = T.todayKey(); val dl = Growth.doneLog(); val hl = Growth.log(); val hs = Growth.habits()
        val pl = Plan.log(); val notes = Kv.obj(Plan.NOTES)
        val keys = dl.keys().asSequence().toList()
        val doneAll = keys.size; val doneToday = keys.count { dl.optString(it) == t }
        var checks = 0; var checksToday = 0; var best = 0
        for (h in hs) { val log = hl.optJSONObject(h.id) ?: JSONObject(); checks += log.keys().asSequence().count { log.optBoolean(it) }; if (log.optBoolean(t)) checksToday++; best = maxOf(best, Growth.streak(h.id, hl)) }
        val pomos = pl.keys().asSequence().sumOf { pl.optInt(it) }; val pomosToday = pl.optInt(t)
        val nk = notes.keys().asSequence().toList()
        val goalsDone = nk.count { it.startsWith("smart:") && notes.optJSONObject(it)?.optBoolean("done") == true }
        val pdca = nk.filter { it.startsWith("pdca:") }.sumOf { k -> val x = notes.optJSONObject(k) ?: return@sumOf 0; (x.optInt("round", 1) - 1) + if (x.optInt("stage") == 3) 1 else 0 }
        val ivy = nk.filter { it.startsWith("ivy:") }.sumOf { k -> val a = notes.optJSONArray(k) ?: return@sumOf 0; (0 until a.length()).count { a.optJSONObject(it)?.let { x -> x.str("text").isNotEmpty() && x.optBoolean("done") } == true } }
        val exp = doneAll * 10 + checks * 5 + pomos * 15 + goalsDone * 30 + pdca * 20 + ivy * 5
        val level = Math.floor(Math.sqrt(exp / 40.0)).toInt() + 1
        val lo = 40 * (level - 1) * (level - 1); val hi = 40 * level * level
        return S(doneAll, doneToday, checks, checksToday, best, pomos, pomosToday, goalsDone, pdca, ivy, exp, level, lo, hi, TITLES.last { level >= it.first }.second)
    }
    class Badge(val icon: String, val name: String, val desc: String, val on: Boolean)
    fun badges(s: S = stats()): List<Badge> = listOf(
        Badge("🛸", "初次接入", "进入过一次等级与徽章页", Kv.bool("meta_visited_v1", false)),
        Badge("✅", "第一步", "完成 1 件事", s.doneAll >= 1), Badge("🔟", "十全十美", "累计完成 10 件事", s.doneAll >= 10),
        Badge("💯", "百事通", "累计完成 100 件事", s.doneAll >= 100), Badge("🔥", "小火苗", "任意习惯连续打卡 3 天", s.bestStreak >= 3),
        Badge("🌟", "一周不断", "任意习惯连续打卡 7 天", s.bestStreak >= 7), Badge("🍅", "番茄新手", "完成 1 个番茄钟", s.pomos >= 1),
        Badge("⏱️", "专注大师", "累计 25 个番茄钟", s.pomos >= 25), Badge("🏹", "神射手", "达成 1 个 SMART 目标", s.goalsDone >= 1),
        Badge("🔄", "螺旋上升", "完成一轮 PDCA", s.pdcaRounds >= 1), Badge("☁️", "云端旅人", "开启云端同步", Sync.state == "ok" || Sync.lastOk > 0),
        Badge("📚", "课表达人", "导入了课程表", Courses.has()),
    )
    val WIKI = listOf(
        Triple("🌐", "什么是元宇宙", "元宇宙（Metaverse）指和现实世界平行、又互相连通的虚拟空间。人们可以用虚拟形象在里面学习、社交、工作和创作。这个词最早出自 1992 年的科幻小说《雪崩》。"),
        Triple("🥽", "虚拟现实 VR", "VR 用头戴设备把你的视野完全换成电脑生成的世界，转头、走动时画面跟着变，让人有「身临其境」的感觉。常用于游戏、模拟驾驶、虚拟实验室。"),
        Triple("📱", "增强现实 AR", "AR 把虚拟内容叠加到真实画面上，比如用手机扫课本出现立体模型、导航箭头直接画在路面上。它不替换现实，而是给现实「加一层」。"),
        Triple("🏙️", "数字孪生", "给真实的工厂、城市甚至校园在电脑里做一个一模一样的「双胞胎」，实时同步数据。改方案前先在虚拟世界里试，省钱又安全。"),
        Triple("🧑‍🚀", "虚拟形象与数字人", "虚拟形象是你在元宇宙里的「化身」；数字人是能说话、有表情的虚拟人物，已经被用在新闻播报、客服和虚拟主播里。"),
        Triple("🎓", "元宇宙里的学习", "在虚拟空间里可以走进细胞内部、站在古罗马街头、做危险的化学实验。沉浸式学习让抽象知识变得看得见、摸得着。"),
        Triple("🛡️", "安全小贴士", "在任何虚拟世界里都要保护好个人信息：不随便透露真实姓名、学校和住址，遇到让你不舒服的人或内容及时离开并告诉老师家长。"),
    )
    fun visit() { if (!Kv.bool("meta_visited_v1", false)) Kv.set("meta_visited_v1", true) }
}
