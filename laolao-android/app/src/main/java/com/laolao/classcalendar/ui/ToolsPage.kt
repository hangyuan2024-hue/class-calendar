package com.laolao.classcalendar.ui

import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.Tools

/** 工具（底部标签）：课程表、日历、规划专注、考试倒计时、记账本、抽签…（照小程序「工具」） */
class ToolsPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    class Tool(val icon: String, val name: String, val desc: String, val open: () -> Unit)

    override fun build(): View {
        val ps = PullScroll(ctx, null)
        ps.setBackgroundColor(C.bg)
        body = ps.content.apply { pad(18, 14, 18, 60) }
        return ps
    }

    private fun tools(): List<Pair<String, List<Tool>>> {
        val wk = Courses.weekNow()
        val exams = try { Tools.exams().filter { T.dayDiff(it.optString("date")) >= 0 } } catch (e: Exception) { emptyList() }
        val learn = mutableListOf<Tool>()
        if (Store.feat("courses")) learn += Tool("📚", "课程表", if (Courses.has()) "${Courses.list().size} 门课" + (if (wk > 0) " · 第 $wk 周" else "") else "拍一张课表截图就能导入") { a.push(CoursePage(a)) }
        learn += Tool("📅", "日历", "月历看所有安排") { a.push(CalendarPage(a, pushed = true)) }
        if (Store.feat("plan")) learn += Tool("🎯", "规划与专注", "今天 ${com.laolao.classcalendar.core.Plan.today()} 个番茄 · 四象限、PDCA、SMART") { a.push(PlanPage(a)) }
        // 7.1 大作业倒排拆解、期末复习排期（和网页、小程序一样；排出来的是普通的我的事项，没做完自动顺延）
        val dps = com.laolao.classcalendar.core.Dplan.projects()
        learn += Tool("🪜", "大作业拆解", if (dps.isNotEmpty()) "${dps.size} 个进行中 · 没做完自动顺延" else "拆成几步，倒排进截止前的每一天") { a.push(DplanPage(a, "project")) }
        learn += Tool("🎓", "期末复习排期", com.laolao.classcalendar.core.Dplan.currentReview()?.let { "复习计划进行中" } ?: "填考试日期，排出每天复习什么") { a.push(DplanPage(a, "review")) }
        learn += Tool("⏳", "考试倒计时", exams.firstOrNull()?.let { "${it.optString("subject")} · 还剩 ${T.dayDiff(it.optString("date"))} 天" } ?: "考试科目、日期，自动倒计时") { a.push(CountdownPage(a)) }
        learn += Tool("📕", "错题本", (try { com.laolao.classcalendar.core.ErrBook.notes().count { !it.optBoolean("mastered") } } catch (e: Exception) { 0 }).let { if (it > 0) "$it 道待复习" else "按学科整理错题，拍照收录" }) { a.push(ErrBookPage(a)) }
        learn += Tool("📖", "单词搭子", "七本词书，间隔复习、小测") { a.push(WordsPage(a)) }
        learn += Tool("🐸", "时间管理大师", (try { com.laolao.classcalendar.core.TimeMaster.frogs(T.todayKey(), false).filter { it.optString("title").isNotEmpty() } } catch (e: Exception) { emptyList() }).let { f -> if (f.isEmpty()) "今天的三只青蛙还没写" else "今天的青蛙 ${f.count { it.optBoolean("done") }}/${f.size} 只" }) { a.push(TimeMasterPage(a)) }
        // 7.2 全屏备忘录（格式、清单、图片、手写；和小程序、网页同一份）
        learn += Tool("🗒", "备忘录", com.laolao.classcalendar.core.NoteStore.memos().size.let { if (it > 0) "$it 条 · 格式、清单、图片、手写" else "格式、清单、图片、手写，三端同步" }) { a.push(NoteListPage(a)) }
        learn += Tool("📋", "导入备忘录 / 作业", "一段文字拆成一条条待办") { a.push(MemoPage(a, "")) }
        learn += Tool("📥", "群消息自动收集", com.laolao.classcalendar.core.Collect.count().let { n -> if (n > 0) "$n 条待确认" else if (com.laolao.classcalendar.core.Collect.on(a)) "开着 · 群里有作业、通知会收进来" else "微信 / QQ 群的作业通知自动收进来，不用粘贴" }) { a.push(CollectPage(a)) }
        val cls = mutableListOf<Tool>()
        if (Store.cls != null) {
            if (Store.feat("wall")) cls += Tool("💬", "班级墙", "通知、文章、评论") { a.push(WallPage(a)) }
            cls += Tool("👥", "班级成员", "找到同学与老师") { a.push(PeoplePage(a)) }
            if (Store.can("can_ingest") || Store.feat("ingest_local")) cls += Tool("✨", "整理群消息", "群聊截图、文字一键变事项") { a.push(IngestPage(a)) }
            if (Store.can("can_edit")) cls += Tool("📢", "发布班级事项", "作业、通知发给全班") { a.push(EditPage(a, null, classMode = true)) }
            if (Store.feat("rank")) cls += Tool("🏆", "班级排行榜", "这周谁攒的成长值最多") { a.push(RankPage(a)) }
        }
        cls += Tool("💡", "问问捞捞", "今天先做什么？下节课在哪？") { a.push(AskPage(a)) }
        val fun0 = mutableListOf<Tool>()
        if (com.laolao.classcalendar.core.Farm.on()) fun0 += Tool("🐣", "云宠农场", com.laolao.classcalendar.core.Farm.state().let { st -> st.optString("name") + " Lv." + st.optInt("level", 1) + " · 养料 " + com.laolao.classcalendar.core.Farm.left() }) { a.push(FarmPage(a)) }
        fun0 += Tool("🏅", "等级与徽章", com.laolao.classcalendar.core.Meta.stats().let { "Lv.${it.level} ${it.title}" }) { a.push(MetaPage(a)) }
        fun0 += Tool("📝", "个人日记", if (com.laolao.classcalendar.core.Kv.get("personal_updated_" + T.todayKey()) != null) "今天写过了 ✓" else "今天还没写，记一点小事吧") { a.push(DiaryPage(a)) }
        fun0 += Tool("✦", "神谕阁", "答案之书、卡牌指引") { a.push(OraclePage(a)) }
        val life = listOf(
            Tool("💳", "校园记账本", "收支分类、月度统计") { a.push(LedgerPage(a)) },
            Tool("🎲", "随机抽签", "点名、分组、抽奖") { a.push(DrawPage(a)) },
        )
        return listOf("学习" to learn, (if (Store.work()) "团队" else "班级") to cls, "趣味" to fun0, "生活" to life)
    }

    override fun render() {
        view
        keepScroll(body)
        body.addView(ctx.text("顺手的小工具", 11.5f, C.sub, SEMI).apply { letterSpacing = 0.08f })
        body.addView(ctx.text("工具", 26f, C.text, HEAVY).apply { margins(t = 2) })
        for ((title, list) in tools()) {
            body.addView(ctx.section(title))
            var row: LinearLayout? = null
            list.forEachIndexed { i, t ->
                if (i % 2 == 0) { row = ctx.row().apply { gravity = Gravity.TOP }; body.addView(row, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = if (i == 0) 0 else dp(10) }) }
                val c = ctx.col().apply {
                    pad(14, 14); press(C.card, 18, C.line); tap { t.open() }
                    addView(ctx.text(t.icon, 26f))
                    addView(ctx.text(t.name, 15f, C.text, BOLD, 1).apply { margins(t = 8) })
                    addView(ctx.text(t.desc, 12f, C.sub, lines = 2).apply { margins(t = 2) })
                }
                row!!.addView(c, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i % 2 == 1) leftMargin = dp(10) })
            }
            if (list.size % 2 == 1) row!!.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f).apply { leftMargin = dp(10) })
        }
    }
}
