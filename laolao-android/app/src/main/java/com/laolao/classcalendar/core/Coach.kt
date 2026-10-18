package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * 捞捞教练（5.9.3；5.9.4 的刷任务、随机掉落、班级同步自习在 Flow.kt）：在本机学你的节奏，推荐「现在最适合做的事」、定一个够得着的小目标、挑合适的时间提醒、每周复盘。
 * 和网页 / 小程序 / 电脑版的 coach-core.js 同一套规则（测试用同样的例子）。
 *
 * 隐私：原始记录（几点完成了哪件事）只存在这台手机（coach_log_v1，最多 60 天），不上传；
 *   跟着账号同步的只有统计数字（coach_v1，每台设备一条）：每个钟点 / 星期几的活跃度、每天的有效完成数、作业提前多久做完、哪种提示有用。
 * 防「假完成」：一口气连着勾很多、勾了又马上取消、过期很久才勾——只算一部分或不算；番茄钟是真计时，最可信。
 * 健康：深夜不推任务、专注太久劝休息、小目标只比最近的水平高一点点。
 */
object Coach {
    const val LOG = "coach_log_v1"
    const val SYNC = "coach_v1"
    const val OPTS = "coach_opts_v1"
    private const val DAY = 86_400_000L; private const val H = 3_600_000L; private const val MIN = 60_000L
    private const val LOG_DAYS = 60
    val STYLES = listOf("step", "deadline", "streak", "progress")

    class Ev(val t: Long, val e: String, val k: String = "", val y: String = "", val d: Long = 0, val m: Int = 0, val s: String = "") {
        fun json(): JSONObject = JSONObject().put("t", t).put("e", e).also { if (k.isNotEmpty()) it.put("k", k); if (y.isNotEmpty()) it.put("y", y); if (d > 0) it.put("d", d); if (m > 0) it.put("m", m); if (s.isNotEmpty()) it.put("s", s) }
        companion object { fun of(o: JSONObject) = Ev(o.optLong("t"), o.optString("e"), o.optString("k"), o.optString("y"), o.optLong("d"), o.optInt("m"), o.optString("s")) }
    }
    class Cr(val t: Long, val k: String, val y: String, var w: Double, val d: Long, val m: Int = 0, var why: String = "")
    class Model(val h: DoubleArray = DoubleArray(24), val w: DoubleArray = DoubleArray(7), val day: MutableMap<String, Double> = HashMap(),
                val lead: MutableList<Double> = ArrayList(), val sty: MutableMap<String, IntArray> = HashMap(), var sus: Int = 0, var n: Double = 0.0, var at: Long = 0) {
        fun json(): JSONObject = JSONObject().put("v", 1).put("at", at).put("h", JSONArray(h.toList())).put("w", JSONArray(w.toList()))
            .put("day", JSONObject().also { o -> day.forEach { (k, v) -> o.put(k, v) } }).put("lead", JSONArray(lead))
            .put("sty", JSONObject().also { o -> sty.forEach { (k, v) -> o.put(k, JSONArray(v.toList())) } }).put("sus", sus).put("n", n)
        companion object {
            fun of(o: JSONObject?): Model? {
                if (o == null || o.optInt("v") != 1) return null
                val m = Model(at = o.optLong("at"))
                o.optJSONArray("h")?.let { a -> for (i in 0 until minOf(24, a.length())) m.h[i] = a.optDouble(i, 0.0) }
                o.optJSONArray("w")?.let { a -> for (i in 0 until minOf(7, a.length())) m.w[i] = a.optDouble(i, 0.0) }
                o.optJSONObject("day")?.let { d -> d.keys().forEach { k -> m.day[k] = d.optDouble(k, 0.0) } }
                o.optJSONArray("lead")?.let { a -> for (i in 0 until a.length()) m.lead += a.optDouble(i, 0.0) }
                o.optJSONObject("sty")?.let { d -> d.keys().forEach { k -> val a = d.optJSONArray(k); m.sty[k] = intArrayOf(a?.optInt(0) ?: 0, a?.optInt(1) ?: 0) } }
                m.sus = o.optInt("sus"); m.n = o.optDouble("n", 0.0)
                return m
            }
        }
    }

    private fun ldt(ms: Long): LocalDateTime = LocalDateTime.ofInstant(Instant.ofEpochMilli(ms), T.BJ)
    private fun ms(d: LocalDateTime): Long = d.atZone(T.BJ).toInstant().toEpochMilli()
    private fun key(d: LocalDate) = T.key(d)
    private fun addDays(k: String, n: Int) = T.addDays(k, n.toLong())
    private fun r1(x: Double) = Math.round(x * 10) / 10.0
    private fun median(xs: List<Double>): Double { val s = xs.sorted(); val m = s.size / 2; return if (s.size % 2 == 1) s[m] else (s[m - 1] + s[m]) / 2 }
    private fun fmt(x: Double): String { val v = r1(x); return if (v == Math.floor(v)) v.toLong().toString() else v.toString() }
    private fun dow(d: LocalDateTime) = d.dayOfWeek.value % 7       // 和 JS 一样：周日 = 0

    // ---------- 1. 可信度 ----------
    fun credible(log: List<Ev>): List<Cr> {
        val sorted = log.sortedBy { it.t }; val out = ArrayList<Cr>()
        for ((i, x) in sorted.withIndex()) {
            when (x.e) {
                "pomo" -> { out += Cr(x.t, x.k, "pomo", if (x.m >= 10) minOf(2.0, (if (x.m > 0) x.m else 25) / 25.0) else 0.0, 0, x.m); continue }
                "habit" -> { out += Cr(x.t, x.k, "habit", 0.5, 0); continue }
                // 刷任务的一张卡：真的计时走完才记，按分钟算（25 分钟 = 1 件）
                "flow" -> { out += Cr(x.t, x.k, "flow", if (x.m >= 2) minOf(2.0, x.m / 25.0) else 0.0, 0, x.m); continue }
                "done" -> {}
                else -> continue
            }
            var w = 1.0; var why = ""
            var j = i + 1
            while (j < sorted.size && sorted[j].t - x.t <= 30 * MIN) { if (sorted[j].e == "undo" && sorted[j].k == x.k) { w = 0.0; why = "undo"; break }; j++ }
            if (w > 0 && x.d > 0 && x.t - x.d > 7 * DAY) { w = 0.5; why = "late" }
            out += Cr(x.t, x.k, x.y, w, x.d, 0, why)
        }
        val dones = out.filter { it.y != "pomo" && it.y != "habit" && it.y != "flow" && it.w > 0 }
        for (a in dones.indices) {
            var n = 0; var b = a
            while (b < dones.size && dones[b].t - dones[a].t <= 90_000) { n++; b++ }
            if (n >= 4) for (c in a + 2 until a + n) if (dones[c].w > 0.3) { dones[c].w = 0.3; dones[c].why = "burst" }
        }
        return out
    }

    // ---------- 2. 学习：这台设备的统计数字 ----------
    fun learn(log: List<Ev>, nowMs: Long): Model {
        val now = ldt(nowMs); val t = key(now.toLocalDate()); val cut = nowMs - LOG_DAYS * DAY
        val m = Model(at = nowMs)
        for (r in credible(log.filter { it.t >= cut })) {
            val d = ldt(r.t); val age = (nowMs - r.t).toDouble() / DAY; val decay = Math.pow(0.97, maxOf(0.0, age))
            if ((r.why == "burst" || r.why == "undo") && age <= 14) m.sus++
            if (r.w <= 0) continue
            m.h[d.hour] += r.w * decay; m.w[dow(d)] += r.w * decay; m.n += r.w
            val k = key(d.toLocalDate()); if (k >= addDays(t, -27)) m.day[k] = r1((m.day[k] ?: 0.0) + r.w)
            if (r.y == "作业" && r.d > 0 && r.w >= 1 && age <= 30) m.lead += r1((r.d - r.t).toDouble() / H)
        }
        for (x in log) {
            if (x.t < cut || x.s !in STYLES) continue
            val s = m.sty.getOrPut(x.s) { intArrayOf(0, 0) }
            if (x.e == "show") s[0]++ else if (x.e == "acc") s[1]++
        }
        for (i in 0 until 24) m.h[i] = r1(m.h[i]); for (i in 0 until 7) m.w[i] = r1(m.w[i])
        while (m.lead.size > 30) m.lead.removeAt(0)
        return m
    }
    fun combine(models: List<Model?>): Model {
        val out = Model()
        for (m in models.filterNotNull()) {
            for (i in 0 until 24) out.h[i] += m.h[i]; for (i in 0 until 7) out.w[i] += m.w[i]
            m.day.forEach { (k, v) -> out.day[k] = r1((out.day[k] ?: 0.0) + v) }
            out.lead += m.lead
            m.sty.forEach { (k, v) -> val a = out.sty.getOrPut(k) { intArrayOf(0, 0) }; a[0] += v[0]; a[1] += v[1] }
            out.sus += m.sus; out.n += m.n
        }
        return out
    }

    // ---------- 3. 连续天数、小目标 ----------
    class Streak(val days: Int, val today: Double, val atRisk: Boolean)
    fun streak(m: Model, nowMs: Long): Streak {
        val now = ldt(nowMs); val t = key(now.toLocalDate()); var n = 0
        var k = if ((m.day[t] ?: 0.0) >= 1) t else addDays(t, -1)
        while ((m.day[k] ?: 0.0) >= 1 && n < 400) { n++; k = addDays(k, -1) }
        val today = m.day[t] ?: 0.0
        return Streak(n, today, n >= 2 && today < 1 && now.hour >= 19)
    }
    class Goal(val target: Int, val done: Double, val cap: Double, val met: Boolean)
    fun goal(m: Model, nowMs: Long): Goal {
        val t = key(ldt(nowMs).toLocalDate())
        val xs = (1..14).mapNotNull { (m.day[addDays(t, -it)] ?: 0.0).takeIf { v -> v > 0 } }
        val cap = if (xs.size >= 3) median(xs) else 2.5   // 刚开始用：先定 3 件
        val target = maxOf(2, minOf(8, Math.ceil(cap * 1.1).toInt()))
        val done = m.day[t] ?: 0.0
        return Goal(target, r1(done), r1(cap), done >= target)
    }
    fun bestHours(m: Model): List<Int> {
        if (m.h.sum() < 5) return emptyList()
        return (7..23).sortedByDescending { m.h[it] }.take(2).filter { m.h[it] > 0 }
    }
    fun pickStyle(m: Model, cands0: List<String>, rnd: Double = Math.random()): String {
        val cands = cands0.ifEmpty { STYLES }
        if (rnd < 0.15) return cands[((rnd * 100).toInt()) % cands.size]
        return cands.maxByOrNull { val a = m.sty[it] ?: intArrayOf(0, 0); (a[1] + 1.0) / (a[0] + 2.0) } ?: cands[0]
    }

    // ---------- 3.5 哪些事「现在就能动手做」（和 coach-core.js 的 doable 同一套规则） ----------
    // 只推荐能马上开始、能做完的事；会议、讲座、活动、典礼这类到点去参加的事不推荐（日程和提醒里照样有）。
    private val DO_RE = Regex("作业|报告(?!会|厅)|习题|练习|论文|ppt|PPT|复习|预习|背诵|背单词|单词|阅读|读书|笔记|整理|提交|上交|打卡|写|填|交|做|改|准备|报名|缴费|打印|签字|看完|刷题|错题")
    private val MEET_RE = Regex("会议|大会|例会|班会|年会|晚会|座谈|讲座|论坛|典礼|仪式|宣讲|培训|比赛|竞赛|演出|集合|面试|答辩|聚餐|聚会|观影|升旗|报告会|报告厅|研讨|沙龙|见面会|分享会|交流会|发布会|招聘会|运动会|开幕|闭幕|彩排|排练|值班|门诊|牙医|体检|活动")
    private val PREP_RE = Regex("作业|习题|论文|ppt|PPT|报名|缴费|提交|上交|填写|填表|材料|讲稿|演讲稿|稿子|复习|预习|背诵")
    fun doable(x: Island.Row): Boolean {
        if (x.kind != "item") return false
        if (x.exam || x.type == "作业") return true
        if (x.type == "会议" || x.type == "活动" || x.type == "课程") return false
        val t = x.title
        if (MEET_RE.containsMatchIn(t) && !PREP_RE.containsMatchIn(t)) return false
        if (x.time.isNotEmpty() && !DO_RE.containsMatchIn(t)) return false
        return true
    }

    // ---------- 4. 现在最适合做什么 ----------
    class Pick(val kind: String, val key: String, val title: String, val type: String = "", val reason: String = "", val step: String = "", val level: String = "")
    class Sug(val mode: String, val top: Pick?, val say: String, val style: String, val alts: List<Pick>, val streak: Streak, val goal: Goal, val best: List<Int>, val sus: Int)
    fun suggest(ranked: List<Island.Row>, m: Model, log: List<Ev>, nowMs: Long, skip: Map<String, Long> = emptyMap(), rnd: Double = Math.random()): Sug {
        val now = ldt(nowMs); val h = now.hour
        val st = streak(m, nowMs); val g = goal(m, nowMs); val best = bestHours(m)
        val night = h >= 23 || h < 5; val late = h >= 22
        val focusMin = credible(log).filter { (it.y == "pomo" || it.y == "flow") && nowMs - it.t < 2 * H }.sumOf { if (it.m > 0) it.m else 25 }
        fun sug(mode: String, top: Pick?, say: String, style: String = "", alts: List<Pick> = emptyList()) = Sug(mode, top, say, style, alts, st, g, best, m.sus)
        ranked.firstOrNull { it.kind == "course" && it.level == "now" }?.let { return sug("class", Pick("course", it.key, it.title, reason = it.reason, step = "专心听讲，有作业记得随手记下来"), "正在上「${it.title}」，手机先放一放 📚") }
        val cands = ranked.filter { it.kind == "item" && it.level != "past" && doable(it) && (skip[it.key] ?: 0L) <= nowMs }
        if (night && cands.none { it.level == "late" || it.level == "urgent" })
            return sug("sleep", null, if (st.today >= 1) "今天已经完成 ${fmt(st.today)} 件，够了！早点睡，明天接着来 🌙" else "夜深了，明天再做，睡饱了效率更高 🌙")
        if (focusMin >= 75 && cands.none { it.level == "late" || it.level == "now" })
            return sug("rest", null, "已经专注 $focusMin 分钟了，起来走走、喝口水，10 分钟后再继续 🍵")
        if (cands.isEmpty())
            return sug("free", Pick("pomo", "pomo", "专注 25 分钟", reason = "没有急事的时候最适合提前学", step = "挑一门最近吃力的课，复习 25 分钟"),
                if (g.met) "今天的小目标完成了 🎉 剩下的时间留给自己" else "手头没有要赶的事，来一个番茄，预习或者复习一下？")
        val maxH = maxOf(0.0001, (7..23).maxOf { m.h[it] })
        val fit = if (m.n >= 8) 0.8 + 0.4 * m.h[h] / maxH else 1.0
        val scored = cands.map { x ->
            var s = x.score * fit
            if (late && !(x.level == "late" || x.level == "urgent")) s *= 0.4
            if (x.exam) s *= 1.1
            x to s
        }.sortedByDescending { it.second }
        val top = scored[0].first
        val styles = mutableListOf("step")
        if (top.level == "late" || top.level == "urgent") styles += "deadline"
        if (st.days >= 2) styles += "streak"
        if (g.done > 0 && !g.met) styles += "progress"
        val style = pickStyle(m, styles, rnd)
        return sug("go", Pick("item", top.key, top.title, top.type, top.reason, stepFor(top), top.level), sayFor(style, top, st, g, best, h), style,
            scored.drop(1).take(2).map { Pick("item", it.first.key, it.first.title, reason = it.first.reason) })
    }
    private fun stepFor(x: Island.Row): String = when {
        x.exam -> "先花 15 分钟把重点过一遍"
        x.type == "作业" -> if (x.level == "late") "先补上最简单的那部分，开个番茄 25 分钟" else "先做 25 分钟，开个番茄，做多少算多少"
        else -> "先做 5 分钟，开了头就不难了"
    }
    private fun sayFor(style: String, x: Island.Row, st: Streak, g: Goal, best: List<Int>, h: Int): String {
        val name = "「${x.title}」"
        return when {
            style == "deadline" -> if (x.level == "late") "${name}已经过期了，现在补上还来得及 💪" else "$name${x.reason}，先把它拿下！"
            style == "streak" -> "已经连续 ${st.days} 天了 🔥 今天做完${name}就能续上"
            style == "progress" -> "今天完成 ${fmt(g.done)}/${g.target}，再做${name}就更近一步"
            best.contains(h) -> "这个点通常是你状态最好的时候，先做$name"
            else -> "一次只做一件：先把${name}拿下"
        }
    }

    // ---------- 5. 今天什么时候提醒（最多 3 条，避开 23:00–7:00、避开上课） ----------
    class Nudge(val at: Long, val kind: String, val title: String, val body: String)
    fun nudges(ranked: List<Island.Row>, courses: List<Lesson>, m: Model, nowMs: Long): List<Nudge> {
        val now = ldt(nowMs); val today = now.toLocalDate(); val out = ArrayList<Nudge>()
        val st = streak(m, nowMs); val g = goal(m, nowMs); val best = bestHours(m)
        fun at(hh: Int, mi: Int = 0) = ms(today.atTime(hh, mi))
        fun busy(t: Long): Boolean { val d = ldt(t); val mm = d.hour * 60 + d.minute; return courses.any { c -> val a = c.m0; val b = c.m1 ?: c.m0; a != null && b != null && mm >= a - 5 && mm < b } }
        val pending = ranked.filter { it.kind == "item" && it.level != "past" && doable(it) }
        for (bh in best) {
            val t = at(bh)
            if (out.isNotEmpty() || t <= nowMs + 10 * MIN || bh >= 23 || bh < 7 || pending.isEmpty() || g.met || busy(t)) continue
            out += Nudge(t, "best", "现在是你状态最好的时候", "先做「${pending[0].title}」吧，开个番茄 25 分钟")
        }
        if (st.days >= 2 && st.today < 1 && nowMs < at(20, 30)) out += Nudge(at(20, 30), "streak", "🔥 连续 ${st.days} 天，今天还差一点", "做完一件事或者专注一个番茄，就能续上")
        if (now.dayOfWeek.value == 7 && nowMs < at(20)) out += Nudge(at(20), "weekly", "📊 这周的复盘出来了", "看看这周进步在哪，定一下下周的小目标")
        return out.filter { ldt(it.at).hour in 7..22 }.take(3)
    }

    // ---------- 6. 每周复盘 ----------
    class Week(val done: Double, val days: Int)
    class Review(val thisWeek: Week, val lastWeek: Week, val best: List<Int>, val lead: Double?, val highlights: List<String>, val next: List<String>, val streak: Int)
    fun weekly(m: Model, nowMs: Long): Review {
        val now = ldt(nowMs); val t = key(now.toLocalDate()); val mon = addDays(t, -((dow(now) + 6) % 7))
        fun sum(a: String): Week { var s = 0.0; var d = 0; for (i in 0 until 7) { val v = m.day[addDays(a, i)] ?: 0.0; s += v; if (v >= 1) d++ }; return Week(r1(s), d) }
        val tw = sum(mon); val lw = sum(addDays(mon, -7)); val best = bestHours(m)
        val leadMed = if (m.lead.size >= 3) median(m.lead) else null
        val hi = ArrayList<String>(); val next = ArrayList<String>()
        if (tw.done > lw.done) hi += "比上周多完成了 ${fmt(r1(tw.done - lw.done))} 件 👏" else if (lw.done > 0) hi += "这周完成 ${fmt(tw.done)} 件，上周 ${fmt(lw.done)} 件，下周加把劲"
        if (tw.days >= 5) hi += "这周有 ${tw.days} 天都在坚持，很自律！"
        val st = streak(m, nowMs); if (st.days >= 3) hi += "连续 ${st.days} 天 🔥"
        if (best.isNotEmpty()) next += "把最难的事放在 ${best[0]}:00 左右做，那是你状态最好的时候"
        if (leadMed != null) next += if (leadMed < 3) "作业常常拖到最后几个小时才做完，下周试试提前一天开始" else "作业平均提前 ${Math.round(leadMed)} 小时做完，保持！"
        if (m.sus > 3) next += "有几次一口气勾了很多件，捞捞没全算进去；做完一件勾一件，记录才准"
        next += "下周每天的小目标：${goal(m, nowMs).target} 件"
        return Review(tw, lw, best, leadMed, hi, next, st.days)
    }

    // =====================================================================
    // 下面是手机上的存取（上面的规则是纯计算，测试直接调）
    /** 要用户自己点「开启」才开始记录（默认关） */
    fun on(): Boolean = Kv.obj(OPTS).optBoolean("on", false)
    fun opt(k: String, def: Boolean = true): Boolean = Kv.obj(OPTS).optBoolean(k, def)
    fun setOpt(k: String, v: Boolean) { val o = Kv.obj(OPTS); o.put(k, v); Kv.set(OPTS, o) }
    fun log(): List<Ev> = Kv.arr(LOG).let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it)?.let(Ev::of) } }
    /** 记一条（只存在这台手机）；关掉教练时什么都不记 */
    fun record(ev: Ev) {
        if (!on()) return
        try {
            val cut = ev.t - LOG_DAYS * DAY
            val a = Kv.arr(LOG); val out = JSONArray()
            for (i in maxOf(0, a.length() - 2999) until a.length()) a.optJSONObject(i)?.takeIf { it.optLong("t") >= cut }?.let { out.put(it) }
            out.put(ev.json()); Kv.setQuiet(LOG, out)
            dirty = true
        } catch (_: Exception) {}
    }
    @Volatile private var dirty = true
    @Volatile private var cache: Model? = null
    /** 本机学到的 + 别的设备同步过来的 */
    fun model(): Model {
        val now = System.currentTimeMillis()
        if (dirty || cache == null) {
            val mine = learn(log(), now)
            // 自己这台设备的统计放进同步数据（每台设备一条）
            try {
                val j = mine.json()
                Kv.obj(Flow.BAG).optJSONObject("own")?.let { j.put("bag", JSONObject().put("own", it).put("n", Kv.obj(Flow.BAG).optInt("n"))) }   // 5.9.4 收藏也跟着账号（只有「有哪几样」）
                val all = Kv.obj(SYNC); all.put(Store.deviceId(), j); Kv.set(SYNC, all)
            } catch (_: Exception) {}
            dirty = false; cache = mine
        }
        val all = Kv.obj(SYNC); val dev = Store.deviceId()
        val others = all.keys().asSequence().filter { it != dev }.mapNotNull { Model.of(all.optJSONObject(it)) }.filter { now - it.at < 90 * DAY }.toList()
        return combine(listOf(cache) + others)
    }
    fun skips(): Map<String, Long> = Kv.obj("coach_skip_v1").let { o -> o.keys().asSequence().associateWith { o.optLong(it) } }
    fun skip(key: String) { val o = Kv.obj("coach_skip_v1"); val now = System.currentTimeMillis(); o.keys().asSequence().toList().forEach { if (o.optLong(it) < now) o.remove(it) }; o.put(key, now + 2 * H); Kv.setQuiet("coach_skip_v1", o) }
    /** 现在的建议（首页卡片、捞捞、小组件共用） */
    fun now(): Sug {
        val c = Island.ctx(); val ranked = Island.rank(c.items, c.courses, c.now)
        return suggest(ranked, model(), log(), System.currentTimeMillis(), skips())
    }
    /** 一键清空：本机记录 + 云端统计 */
    fun touch() { dirty = true }
    fun clear() { Kv.set(LOG, JSONArray()); Kv.setQuiet("coach_skip_v1", JSONObject()); val all = Kv.obj(SYNC); all.keys().asSequence().toList().forEach { all.put(it, JSONObject().put("v", 0)) }; Kv.set(SYNC, all); dirty = true; cache = null }
}
