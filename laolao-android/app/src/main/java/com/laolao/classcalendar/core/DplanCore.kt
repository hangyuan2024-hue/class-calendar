package com.laolao.classcalendar.core

import java.time.LocalDate
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * 7.1 大作业倒排拆解 + 期末复习排期 + 没做完自动顺延：纯算法部分（不碰存储、不碰界面）。
 * 和网页 deadline-plan.js、小程序 lib/dplan.js 一行一行对过：同样的输入排出同样的日程，
 * 所以三端谁先打开都能顺延，排出来的步骤互相认得。日期都是 "YYYY-MM-DD"。
 */
object DplanCore {
    const val WD = "一二三四五六日"

    // ---------- 日期 ----------
    fun d(k: String): LocalDate = LocalDate.parse(k.substring(0, 10))
    fun add(k: String, n: Int): String = d(k).plusDays(n.toLong()).toString()
    fun wd(k: String): Int = d(k).dayOfWeek.value                       // 1 = 周一
    fun diff(a: String, b: String): Int = java.time.temporal.ChronoUnit.DAYS.between(d(a), d(b)).toInt()   // b - a
    fun md(k: String): String { val x = d(k); return "${x.monthValue}月${x.dayOfMonth}日 周${WD[wd(k) - 1]}" }
    fun hm(t: String?, plus: Int = 0): String {
        val p = (t ?: "20:00").ifBlank { "20:00" }.split(":")
        var m = (p.getOrNull(0)?.toIntOrNull() ?: 20) * 60 + (p.getOrNull(1)?.toIntOrNull() ?: 0) + plus
        m = min(m, 23 * 60 + 30)
        return String.format("%02d:%02d", m / 60, m % 60)
    }
    fun mins(x: Double): String { val m = x.roundToInt(); return if (m >= 60) "${m / 60} 小时" + (if (m % 60 != 0) " ${m % 60} 分钟" else "") else "$m 分钟" }
    fun startDay(today: String, hour: Int): String = if (hour >= 21) add(today, 1) else today

    /** 可用的日子：from..to（含），跳过勾掉的星期几（1 = 周一） */
    fun daysBetween(from: String, to: String, skip: List<Int>): List<String> {
        val out = mutableListOf<String>(); if (diff(from, to) < 0) return out
        var k = from; var i = 0
        while (diff(k, to) >= 0 && i < 400) { if (wd(k) !in skip) out += k; k = add(k, 1); i++ }
        return out
    }

    // ---------- 排期 ----------
    /** 一个要排的单元：有先后（ord）、分钟数、最晚哪天前做完（before，当天不排） */
    class Unit(val unit: String, val ord: Int, var min: Double, val before: String, val subject: String, val note: String)
    class Seg(val u: Unit, val day: String, val min: Double, val part: Int = 0, val parts: Int = 0)
    class Placed(val segs: List<Seg>, val tight: Boolean, val cap: Double, val days: Int, val total: Double)

    fun place(units: List<Unit>, start: String, perDay: Int, skip: List<Int>): Placed {
        val total = units.sumOf { it.min }
        var last = ""; for (u in units) if (last.isEmpty() || diff(u.before, last) > 0) last = u.before
        var days = daysBetween(start, add(last, -1), skip)
        if (days.isEmpty()) days = listOf(if (diff(start, last) > 0) add(last, -1) else start)
        val pd = perDay.toDouble()
        // 平均摊开：每天至少做一点（不全挤到前几天，也不拖到最后）
        var cap = max(ceil(total / days.size), min(pd, 30.0))
        var tight = cap > pd
        if (!tight) cap = min(pd, max(cap, min(pd, 40.0)))
        val out = mutableListOf<Seg>(); var di = 0; var left = cap
        for (u in units) {
            var r = u.min; val parts = mutableListOf<Pair<String, Double>>()
            var lim = days.size - 1; while (lim > 0 && diff(days[lim], u.before) <= 0) lim--
            while (r > 0) {
                // 最后一天也放不下：剩下的都挤在这一天
                if (di > lim || (di == lim && left < r)) { di = lim; left = max(left, r); tight = true }
                val take = min(r, left)
                if (take < 15 && r > take && di < lim) { di++; left = cap; continue }
                parts += days[di] to take
                r -= take; left -= take
                if (left < 15 && di < lim) { di++; left = cap }
            }
            parts.forEachIndexed { i, p -> out += Seg(u, p.first, p.second, if (parts.size > 1) i + 1 else 0, parts.size) }
        }
        return Placed(out, tight, cap, days.size, total)
    }

    // ---------- 大作业：按常见做法拆步骤 ----------
    class Step(var t: String, var m: Int, var d: String)
    private class Tpl(val re: Regex, val steps: List<Triple<String, Int, String>>)
    private fun r(s: String) = Regex(s, RegexOption.IGNORE_CASE)
    private val TPL = listOf(
        Tpl(r("数据库|sql|可视化|系统|程序|代码|编程|开发|网站|网页|app|小程序|爬虫|算法|python|java|c\\+\\+|前端|后端|接口"), listOf(
            Triple("读懂要求，列出要交的东西", 20, "评分点、提交格式、截止时间列成一张清单"), Triple("设计方案", 60, "表结构 / 模块划分 / 页面草图先画出来"),
            Triple("搭环境、准备数据", 60, "建库建表、导入测试数据，或把开发环境跑起来"), Triple("实现核心功能", 150, "先把最主要的功能跑通，别急着美化"),
            Triple("做可视化 / 界面", 90, "图表或页面，能拿出来演示"), Triple("测试、修 bug", 60, "对照清单逐条自测"),
            Triple("写文档 / 报告", 60, "设计思路、运行截图、遇到的问题"), Triple("检查并提交", 20, "对照第一步的清单逐项打勾后提交"))),
        Tpl(r("ppt|汇报|展示|答辩|演讲|presentation|路演"), listOf(
            Triple("读懂要求，定主题", 20, "时长、页数、评分点"), Triple("收集素材", 60, "数据、图片、案例"), Triple("定大纲", 30, "每页讲什么先写成提纲"),
            Triple("做 PPT", 120, "先把内容放上去，再统一样式"), Triple("写讲稿", 45, "每页 2～3 句要说的话"), Triple("排练两遍", 40, "掐时间，卡壳的地方改"), Triple("检查并提交", 15, "文件名、格式按要求"))),
        Tpl(r("实验|实训|测量|上机"), listOf(
            Triple("预习实验原理", 40, "看懂步骤和要记录的数据"), Triple("整理实验数据", 60, "数据表、单位、有效数字"), Triple("处理数据、画图", 60, "计算、误差分析、图表"),
            Triple("写实验报告", 90, "目的、原理、步骤、结果、讨论"), Triple("检查并提交", 15, "格式、签名、截图"))),
        Tpl(r("论文|报告|综述|调研|读书|心得|小论文|文章|essay|作文|案例分析|策划"), listOf(
            Triple("读懂要求，定题目", 30, "字数、格式、评分点，定一个能写的题目"), Triple("查资料", 90, "找 5～8 篇能引用的资料，记下出处"), Triple("列提纲", 40, "每一部分要说什么写成一句话"),
            Triple("写初稿（上）", 120, "先写完前一半，不求完美"), Triple("写初稿（下）", 120, "写完剩下的部分和结尾"), Triple("修改", 60, "逻辑、例子、错别字"),
            Triple("格式和参考文献", 40, "按要求排版，参考文献格式统一"), Triple("检查并提交", 15, "查重 / 文件名 / 提交方式"))),
        Tpl(r("习题|作业|练习|题|卷"), listOf(
            Triple("先过一遍题目", 15, "标出会的、不会的"), Triple("做完会的", 60, "先拿下能拿的分"), Triple("攻克不会的", 60, "翻书、看例题、问同学"), Triple("订正、整理", 25, "错的地方记到错题本"), Triple("检查并提交", 10, "拍照 / 上传 / 交到哪里"))),
    )
    private val DEF = listOf(Triple("读懂要求，列出要交的东西", 20, "评分点、格式、截止时间"), Triple("收集材料", 60, "需要的资料、数据、工具"), Triple("完成主体", 150, "最主要的部分先做出来"), Triple("完善细节", 60, "补全、修改、润色"), Triple("检查并提交", 15, "对照要求逐条检查后提交"))
    private fun jsRound(x: Double): Int = floor(x + 0.5).toInt()

    fun ruleSteps(title: String, req: String, daysLeft: Int, perDay: Int): MutableList<Step> {
        val text = "$title $req"
        val t = TPL.firstOrNull { it.re.containsMatchIn(text) }
        val steps = (t?.steps ?: DEF).map { Step(it.first, it.second, it.third) }.toMutableList()
        if (Regex("小组|组队|分组|团队|组员").containsMatchIn(text)) steps.add(1, Step("小组分工", 20, "谁做哪部分、什么时候汇总，在群里定下来"))
        // 按字数 / 页数稍微放大一点
        val big = Regex("(\\d{4,5})\\s*字").find(text); val pages = Regex("(\\d{2,3})\\s*页").find(text); var k = 1.0
        if (big != null) k = min(3.0, max(1.0, big.groupValues[1].toDouble() / 3000)) else if (pages != null) k = min(2.5, max(1.0, pages.groupValues[1].toDouble() / 15))
        if (k != 1.0) steps.forEachIndexed { i, s -> if (i > 0 && i < steps.size - 1) s.m = jsRound(s.m * k / 5) * 5 }
        // 时间特别紧：等比例压缩，但每步至少 15 分钟
        val cap = max(1, daysLeft) * perDay * 1.3; val total = steps.sumOf { it.m }
        if (total > cap) steps.forEach { s -> s.m = max(15, jsRound(s.m * cap / total / 5) * 5) }
        return steps
    }

    /** 拆好的步骤 → 排期单元（上午截止的，截止当天不排；最后一步可以排到截止当天） */
    fun draftUnits(title: String, due: String, steps: List<Step>): List<Unit> {
        val day = due.substring(0, 10)
        val lastDay = if (Regex("^(0\\d|1[01]):").containsMatchIn(due.drop(11))) day else add(day, 1)
        return steps.mapIndexed { i, s -> Unit("s$i", i, max(10, if (s.m > 0) s.m else 30).toDouble(), if (i == steps.size - 1) lastDay else day, title + "｜" + (i + 1) + ". " + s.t, s.d) }
    }

    // ---------- 期末复习 ----------
    class Exam(val course: String, val date: String, val time: String = "09:00", val w: Int = 2)
    class Review(val exams: List<Exam>, val segs: List<Seg>, val tight: Boolean, val days: Int)

    /** 安卓和小程序一样读不到课内学习的知识框架和错题：每门课按通用步骤排（网页有知识框架时会按知识点排） */
    fun courseUnits(e: Exam, block: Int): MutableList<Unit> {
        val units = mutableListOf<Unit>(); val w = if (e.w > 0) e.w else 2
        val topics = listOf("梳理整本书的知识框架", "过一遍课件 / 课本（前半）", "过一遍课件 / 课本（后半）", "重点公式、概念整理成一页")
        val rounds = max(2, min(topics.size, 3 + w * 3)); val per = ceil(topics.size.toDouble() / rounds).toInt()
        var i = 0
        while (i < topics.size) {
            val s = topics.subList(i, min(topics.size, i + per)).joinToString("、")
            units += Unit("", 0, block * (if (w >= 3) 1.5 else 1.0), "", "复习｜" + e.course + "：" + s.take(28) + (if (s.length > 28) "…" else ""), "过一遍：$s。合上书能讲出来才算过")
            i += per
        }
        units += Unit("", 0, block.toDouble(), "", "复习｜" + e.course + "：整理错题和易错点", "把作业、练习里错过的再做一遍")
        for (k in 0 until max(1, w - 1)) units += Unit("", 0, max(block, 90).toDouble(), "", "复习｜" + e.course + "：做一套往年题 / 模拟题" + (if (w > 2) "（${k + 1}）" else ""), "限时做，做完对答案，错的记下来")
        return units
    }

    fun buildReview(exams: List<Exam>, today: String, start: String, perDay: Int, skip: List<Int>): Review? {
        val es = exams.filter { it.course.isNotBlank() && it.date.length >= 10 && diff(today, it.date) > 0 }.sortedBy { it.date }
        if (es.isEmpty()) return null
        val block = if (perDay >= 120) 60 else 45
        // 每门课的单元在「开始 ~ 考前两天」之间均匀摊开；考前一天固定是这门课的考前回顾；几门课交错
        class Q(val e: Exam, val i: Int, val units: List<Unit>)
        val queues = es.mapIndexed { i, e -> Q(e, i, courseUnits(e, block).mapIndexed { j, u -> Unit("e${i}u$j", i * 100 + j, u.min, e.date, u.subject, u.note) }) }
        val allDays = daysBetween(start, add(es.last().date, -1), skip)
        val used = HashMap<String, Double>(); val segs = mutableListOf<Seg>(); var tight = false
        fun put(day: String, m: Double, u: Unit) { used[day] = (used[day] ?: 0.0) + m; segs += Seg(u, day, m) }
        for (q in queues) {
            val last = add(q.e.date, -1)
            if (last in allDays || diff(start, last) >= 0) put(last, min(60, block).toDouble(), Unit("e${q.i}last", q.i * 100 + 99, 0.0, q.e.date, "复习｜" + q.e.course + "：考前回顾", "只看知识框架、公式和错题，不做新题，早点睡"))
        }
        class Wish(val u: Unit, val at: Int, val win: List<String>)
        val wish = mutableListOf<Wish>()
        for (q in queues) {
            var win = allDays.filter { diff(it, q.e.date) >= 2 }
            if (win.isEmpty()) win = allDays.filter { diff(it, q.e.date) >= 1 }
            if (win.isEmpty()) { tight = true; continue }
            q.units.forEachIndexed { j, u -> wish += Wish(u, floor(j.toDouble() * win.size / q.units.size).toInt(), win) }
        }
        wish.sortWith(compareBy<Wish> { it.win[it.at] }.thenBy { it.u.ord })
        for (w in wish) {
            var left = w.u.min; var k = w.at
            while (left > 0) {
                if (k >= w.win.size) { tight = true; put(w.win.last(), left, w.u); left = 0.0; break }
                val dd = w.win[k]; val room = perDay - (used[dd] ?: 0.0)
                if (room >= min(25.0, left)) { val take = min(room, left); put(dd, take, w.u); left -= take }
                k++
            }
        }
        val sorted = segs.sortedWith(compareBy<Seg> { it.day }.thenBy { it.u.ord })
        return Review(es, sorted, tight, allDays.size)
    }

    // ---------- 没做完自动顺延 ----------
    /** 计划里的一步（从「我的事项」读出来的） */
    class Rec(val id: String, val eventTime: String, val done: Boolean, val fixed: Boolean, val ord: Int, val est: Int, val before: String, val unit: String, val subject: String, val note: String)

    /** 返回要重新排的单元（同一单元拆成几段的合成一个）；没有过期没做的、又不是强制，返回 null */
    fun replanUnits(its: List<Rec>, due: String, today: String, force: Boolean): Pair<Int, List<Unit>>? {
        val steps = its.filter { !it.fixed }
        val late = steps.count { !it.done && it.eventTime.take(10) < today }
        if (late == 0 && !force) return null
        val undone = steps.filter { !it.done }.sortedWith(compareBy<Rec> { it.ord }.thenBy { it.eventTime })
        val units = mutableListOf<Unit>(); val byUnit = HashMap<String, Unit>()
        val tail = Regex("（\\d+/\\d+）$")
        for (r in undone) {
            val key = r.unit.ifEmpty { r.id }
            val have = byUnit[key]
            if (have != null) { have.min += (if (r.est > 0) r.est else 30); continue }
            val u = Unit(key, r.ord, (if (r.est > 0) r.est else 30).toDouble(), r.before.ifEmpty { due.take(10) }, r.subject.replace(tail, ""), r.note.split("\n")[0])
            byUnit[key] = u; units += u
        }
        return late to units
    }
}
