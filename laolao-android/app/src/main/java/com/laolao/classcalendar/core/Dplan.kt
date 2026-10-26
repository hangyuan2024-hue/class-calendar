package com.laolao.classcalendar.core

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 7.1 大作业倒排拆解 + 期末复习排期 + 没做完自动顺延（和网页 deadline-plan.js、小程序 lib/dplan.js 同样的数据）
 *  · 计划存在 deadline_plans_v1（{ 计划id: 计划 }，跟着账号同步，Sync.KINDS 里是 map）
 *  · 排出来的每一步都是普通的「我的事项」，带 dplan（哪个计划）、ord（第几步）、est（分钟）、before（最晚哪天前）、unit（同一步拆成几段时合并用）；
 *    截止 / 考试那一条带 fixed（不参与顺延）
 *  · 网页、小程序、安卓谁先打开都会顺延，字段一样，互相认得
 * 算法在 DplanCore（和 JS 版逐条对过）；这里只管读写和 AI。
 */
object Dplan {
    const val LS = "deadline_plans_v1"
    private val D = DplanCore

    fun today(): String = T.todayKey()
    fun startDay(): String = D.startDay(today(), T.now().hour)
    fun plans(): JSONObject = Kv.obj(LS)
    private fun savePlans(p: JSONObject) { Kv.set(LS, p); Bus.emit("data") }
    private fun mine(): List<JSONObject> = Kv.arr(Items.MINE).objs()
    private fun saveMine(list: List<JSONObject>) { Kv.set(Items.MINE, JSONArray(list)); Bus.emit("data") }
    private fun uid(): String = java.lang.Long.toString(System.currentTimeMillis(), 36) + Integer.toString((Math.random() * 1679616).toInt(), 36).padStart(4, '0')
    private fun skipOf(p: JSONObject): List<Int> { val a = p.optJSONArray("skip") ?: return emptyList(); return (0 until a.length()).map { a.optInt(it) } }

    /** 排好的单元 → 我的事项；同一天的按顺序往后错开时间 */
    private fun toItems(plan: JSONObject, segs: List<DplanCore.Seg>): List<JSONObject> {
        val at = HashMap<String, Int>(); val out = mutableListOf<JSONObject>(); val stamp = java.lang.Long.toString(System.currentTimeMillis(), 36)
        val project = plan.str("kind") == "project"
        segs.forEachIndexed { i, s ->
            val start = D.hm(plan.str("time"), at[s.day] ?: 0); at[s.day] = (at[s.day] ?: 0) + s.min.roundToInt()
            out += jsonOf("id" to "dp_${plan.str("id")}_${stamp}_$i", "subject" to s.u.subject + (if (s.part > 0) "（${s.part}/${s.parts}）" else ""),
                "event_time" to "${s.day} $start", "location" to "",
                "note" to s.u.note + "\n约 " + D.mins(s.min) + (if (project) " · 大作业「${plan.str("title")}」截止 " + D.md(plan.str("due").take(10)) else " · 期末复习排期"),
                "dplan" to plan.str("id"), "ord" to s.u.ord, "est" to s.min.roundToInt(), "before" to s.u.before, "unit" to s.u.unit)
        }
        return out
    }
    fun planItems(id: String, list: List<JSONObject> = mine()): List<JSONObject> = list.filter { it.str("dplan") == id }

    // ---------- 没做完自动顺延 ----------
    private fun recOf(r: JSONObject) = DplanCore.Rec(r.str("id"), r.str("event_time"), r.optBoolean("done"), r.optBoolean("fixed"), r.optInt("ord", 0), r.optInt("est", 0),
        r.str("before"), r.str("unit"), r.str("subject"), r.str("note"))

    /** 过期还没勾掉的步骤：和后面没做的一起从今天（晚上 9 点后从明天）重新往后排，不越过截止 / 考试。返回顺延了几步 */
    fun replan(plan: JSONObject, force: Boolean): Int {
        val all = mine(); val its = planItems(plan.str("id"), all)
        val r = D.replanUnits(its.map { recOf(it) }, plan.str("due"), today(), force) ?: return 0
        val keepIds = its.filter { it.optBoolean("done") || it.optBoolean("fixed") }.map { it.str("id") }.toHashSet()
        val placed = if (r.second.isNotEmpty()) D.place(r.second, startDay(), plan.optInt("perDay", 60), skipOf(plan)).segs else emptyList()
        saveMine(all.filter { it.str("dplan") != plan.str("id") || it.str("id") in keepIds } + toItems(plan, placed))
        return r.first
    }
    /** 打开 App 时调（同步拉完之后）：返回要提示的话，没有就是空字符串 */
    fun replanAll(): String {
        val ps = plans(); val msgs = mutableListOf<String>()
        for (id in ps.keys().asSequence().toList()) {
            val p = ps.optJSONObject(id) ?: continue
            if (p.optBoolean("archived")) continue
            val end = p.str("due").ifEmpty { p.str("end") }.take(10)
            if (end.length < 10 || D.diff(today(), end) < 0) continue          // 已经过了截止 / 考试
            val n = replan(p, false)
            if (n > 0) { p.put("shifted", p.optInt("shifted", 0) + n); msgs += (if (p.str("kind") == "project") "「${p.str("title")}」" else "期末复习") + "有 $n 步没做完" }
        }
        if (msgs.isEmpty()) return ""
        savePlans(ps)
        return msgs.joinToString("，") + "，已经帮你顺延到后面几天，不会越过截止日期 ✓"
    }
    fun replanNow(id: String) { val ps = plans(); val p = ps.optJSONObject(id) ?: return; replan(p, true); savePlans(ps) }

    // ---------- 大作业 ----------
    class Draft(var title: String, var course: String, var due: String, var req: String, var perDay: Int, var time: String, var skip: List<Int>,
                var steps: MutableList<DplanCore.Step>, var src: String)

    /** 平台 AI（和网页、小程序同一条路：learn_ai_start → 扣子 plan-steps），失败抛异常，界面上退回按常见做法拆 */
    fun aiSteps(input: JSONObject): MutableList<DplanCore.Step> {
        val started = Api.rpcObj("learn_ai_start", jsonOf("p_path" to "plan-steps", "p_body" to jsonOf("provider" to "platform", "confirm_cost" to true, "input" to input)))
        val jid = started.opt("job_id") ?: throw Exception("AI 暂时用不了")
        val t0 = System.currentTimeMillis()
        while (true) {
            Thread.sleep(if (System.currentTimeMillis() - t0 < 6000) 900 else 1600)
            val st = Api.rpcObj("learn_ai_status", jsonOf("jid" to jid))
            if (st.str("status").isNotEmpty() && st.str("status") != "running") {
                val b = st.optJSONObject("result")?.optJSONObject("b") ?: JSONObject()
                val arr = b.optJSONObject("result")?.optJSONArray("steps")
                if (arr != null) return arr.objs().map { DplanCore.Step(it.str("title").take(40), max(10, min(900, it.optInt("minutes", 30).let { m -> if (m > 0) m else 30 })), it.str("detail").take(120)) }.toMutableList()
                throw Exception(if (b.str("error") == "AI_SERVICE_NOT_DEPLOYED") "AI 服务还没部署" else "AI 暂时用不了")
            }
            if (System.currentTimeMillis() - t0 > 160000) throw Exception("AI 太久没回应")
        }
    }
    fun preview(d: Draft): DplanCore.Placed = D.place(D.draftUnits(d.title, d.due, d.steps), startDay(), d.perDay, d.skip)

    /** 放进日程：返回排了几段 */
    fun saveProject(d: Draft): Int {
        val id = uid()
        val steps = JSONArray(); d.steps.forEach { steps.put(jsonOf("t" to it.t, "m" to it.m, "d" to it.d)) }
        val plan = jsonOf("id" to id, "kind" to "project", "title" to d.title, "course" to d.course, "due" to d.due, "req" to d.req.take(2000), "perDay" to d.perDay,
            "time" to d.time, "skip" to JSONArray(d.skip), "steps" to steps, "src" to d.src, "created" to today(), "shifted" to 0)
        val list = toItems(plan, preview(d).segs).toMutableList()
        // 截止那一刻也放进去（作业）
        list += jsonOf("id" to "dp_${id}_due", "subject" to d.title + (if (d.course.isNotEmpty()) "（${d.course}）" else ""), "event_time" to d.due, "location" to "",
            "note" to (if (d.req.isNotEmpty()) d.req.take(400) + "\n" else "") + "大作业截止 · 已拆成 ${d.steps.size} 步排进日程", "kind" to "作业", "dplan" to id, "fixed" to true)
        saveMine(mine() + list)
        val ps = plans(); ps.put(id, plan); savePlans(ps)
        return list.size - 1
    }

    class Progress(val n: Int, val done: Int, val pct: Int, val next: JSONObject?)
    fun progress(id: String): Progress {
        val its = planItems(id).filter { !it.optBoolean("fixed") }
        val done = its.filter { it.optBoolean("done") }
        val next = its.filter { !it.optBoolean("done") }.minByOrNull { it.str("event_time") }
        val tot = its.sumOf { it.optInt("est", 0) }; val got = done.sumOf { it.optInt("est", 0) }
        return Progress(its.size, done.size, if (tot > 0) (got * 100.0 / tot).roundToInt() else 0, next)
    }
    /** 删掉计划：没做的步骤从日程里去掉，做过的留着；全部做完时连截止那条也留着（只是收起） */
    fun archive(id: String) {
        val ps = plans(); val p = ps.optJSONObject(id) ?: return
        val g = progress(id); val all = g.n > 0 && g.done == g.n
        saveMine(mine().filter { it.str("dplan") != id || it.optBoolean("done") || (all && it.optBoolean("fixed")) })
        p.put("archived", true); savePlans(ps)
    }
    fun projects(): List<JSONObject> { val ps = plans(); return ps.keys().asSequence().mapNotNull { ps.optJSONObject(it) }.filter { it.str("kind") == "project" && !it.optBoolean("archived") }.sortedBy { it.str("due") }.toList() }

    // ---------- 期末复习 ----------
    fun currentReview(): JSONObject? { val ps = plans(); return ps.keys().asSequence().mapNotNull { ps.optJSONObject(it) }.firstOrNull { it.str("kind") == "review" && !it.optBoolean("archived") } }
    fun buildReview(exams: List<DplanCore.Exam>, perDay: Int, start: String, skip: List<Int>): DplanCore.Review? = D.buildReview(exams, today(), start, perDay, skip)

    /** 放进日程：返回 (几次复习, 几场考试)；只留一份期末复习计划（旧的没做的删掉，做过的留着） */
    fun saveReview(exams: List<DplanCore.Exam>, perDay: Int, time: String, start: String, skip: List<Int>): Pair<Int, Int>? {
        val r = buildReview(exams, perDay, start, skip) ?: return null
        val ps = plans(); var list = mine()
        for (k in ps.keys().asSequence().toList()) {
            val p = ps.optJSONObject(k) ?: continue
            if (p.str("kind") == "review" && !p.optBoolean("archived")) { list = list.filter { it.str("dplan") != k || it.optBoolean("done") }; p.put("archived", true) }
        }
        val id = uid(); val last = r.exams.last().date
        val ex = JSONArray(); r.exams.forEach { ex.put(jsonOf("course" to it.course, "date" to it.date, "time" to it.time, "w" to it.w)) }
        val plan = jsonOf("id" to id, "kind" to "review", "title" to "期末复习", "exams" to ex, "due" to last, "perDay" to perDay, "time" to time, "skip" to JSONArray(skip), "created" to today(), "shifted" to 0)
        val add = toItems(plan, r.segs).toMutableList()
        r.exams.forEachIndexed { i, e -> add += jsonOf("id" to "dp_${id}_exam$i", "subject" to "考试：" + e.course, "event_time" to e.date + " " + e.time.ifEmpty { "09:00" }, "location" to "",
            "note" to "期末复习排期 · 考前一天只回顾，不做新题", "dplan" to id, "fixed" to true) }
        saveMine(list + add)
        ps.put(id, plan); savePlans(ps)
        return r.segs.size to r.exams.size
    }
    fun examsOf(p: JSONObject): List<DplanCore.Exam> = (p.optJSONArray("exams") ?: JSONArray()).objs().map { DplanCore.Exam(it.str("course"), it.str("date"), it.str("time").ifEmpty { "09:00" }, it.optInt("w", 2)) }
}
