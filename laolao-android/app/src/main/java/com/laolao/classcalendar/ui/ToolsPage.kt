package com.laolao.classcalendar.ui

import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.Tools

/**
 * 工具（底部标签）。7.x 重新排：一屏放下所有工具——每个分组一张卡，一行四个小图标 + 短名字；
 * 要紧的状态用右上角小角标（待复习几道、待确认几条、离考试几天），长按图标看说明。
 */
class ToolsPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    class Tool(val icon: String, val name: String, val desc: String, val badge: String = "", val hot: Boolean = false, val open: () -> Unit)

    override fun build(): View {
        val ps = PullScroll(ctx, null)
        ps.setBackgroundColor(C.bg)
        body = ps.content.apply { pad(18, 40, 18, 60) }
        return ps
    }

    private fun tools(): List<Pair<String, List<Tool>>> {
        val wk = Courses.weekNow()
        val exams = try { Tools.exams().filter { T.dayDiff(it.optString("date")) >= 0 } } catch (e: Exception) { emptyList() }
        val learn = mutableListOf<Tool>()
        if (Store.feat("courses")) learn += Tool("📚", "课程表", if (Courses.has()) "${Courses.list().size} 门课" + (if (wk > 0) " · 第 $wk 周" else "") else "拍一张课表截图就能导入") { a.push(CoursePage(a)) }
        learn += Tool("📅", "日历", "月历看所有安排") { a.push(CalendarPage(a, pushed = true)) }
        // 7.2 全屏备忘录（格式、清单、图片、手写；和小程序、网页同一份）
        learn += Tool("📒", "备忘录", "格式、清单、图片、手写，三端同步") { a.push(NoteListPage(a)) }
        val pm = com.laolao.classcalendar.core.Plan.pomo().mode
        if (Store.feat("plan")) learn += Tool("🎯", "规划专注", "番茄钟、四象限、PDCA、SMART", if (pm == "focus") "专注中" else "") { a.push(PlanPage(a)) }
        val ex = exams.firstOrNull()?.let { T.dayDiff(it.optString("date")) }
        learn += Tool("⏳", "考试倒计时", exams.firstOrNull()?.let { "${it.optString("subject")} · 还剩 ${T.dayDiff(it.optString("date"))} 天" } ?: "考试科目、日期，自动倒计时", if (ex != null) "${ex}天" else "", ex != null && ex <= 7) { a.push(CountdownPage(a)) }
        // 7.1 大作业倒排拆解、期末复习排期（和网页、小程序一样；排出来的是普通的我的事项，没做完自动顺延）
        learn += Tool("🧩", "大作业拆解", "拆成几步，倒排进截止前的每一天", com.laolao.classcalendar.core.Dplan.projects().size.let { if (it > 0) "$it" else "" }) { a.push(DplanPage(a, "project")) }
        learn += Tool("🎓", "期末复习", "填考试日期，排出每天复习什么") { a.push(DplanPage(a, "review")) }
        val err = try { com.laolao.classcalendar.core.ErrBook.notes().count { !it.optBoolean("mastered") } } catch (e: Exception) { 0 }
        learn += Tool("📕", "错题本", "按学科整理错题，拍照收录", if (err > 0) "$err" else "") { a.push(ErrBookPage(a)) }
        learn += Tool("📖", "背单词", "七本词书，间隔复习、小测") { a.push(WordsPage(a)) }
        learn += Tool("🐸", "时间管理", "三只青蛙：先做今天最重要的事") { a.push(TimeMasterPage(a)) }
        learn += Tool("📋", "导入待办", "一段文字拆成一条条待办") { a.push(MemoPage(a, "")) }
        val col = com.laolao.classcalendar.core.Collect.count()
        learn += Tool("📥", "群消息收集", "微信 / QQ 群的作业通知自动收进来", if (col > 0) "$col" else "", col > 0) { a.push(CollectPage(a)) }
        val cls = mutableListOf<Tool>()
        if (Store.cls != null) {
            if (Store.feat("wall")) cls += Tool("💬", "班级墙", "通知、文章、评论") { a.push(WallPage(a)) }
            cls += Tool("⚡", "课堂互动", "抢答、小组评分") { a.push(ActPage(a)) }
            cls += Tool("👥", "成员", "找到同学与老师") { a.push(PeoplePage(a)) }
            if (Store.can("can_ingest") || Store.feat("ingest_local")) cls += Tool("✨", "整理群消息", "群聊截图、文字一键变事项") { a.push(IngestPage(a)) }
            if (Store.can("can_edit")) cls += Tool("📢", "发布事项", "作业、通知发给全班") { a.push(EditPage(a, null, classMode = true)) }
            if (Store.feat("rank")) cls += Tool("🏆", "排行榜", "成长值、等级排行") { a.push(RankPage(a)) }
        }
        cls += Tool("💡", "问问捞捞", "今天先做什么？下节课在哪？") { a.push(AskPage(a)) }
        val more = mutableListOf<Tool>()
        more += Tool("📝", "日记", "记一点今天的小事", if (com.laolao.classcalendar.core.Kv.get("personal_updated_" + T.todayKey()) != null) "✓" else "") { a.push(DiaryPage(a)) }
        more += Tool("💳", "记账本", "收支分类、月度统计") { a.push(LedgerPage(a)) }
        more += Tool("🎲", "随机抽签", "点名、分组、抽奖") { a.push(DrawPage(a)) }
        if (com.laolao.classcalendar.core.Farm.on()) more += Tool("🐣", "云宠农场", "打卡攒养料，养一只小宠物") { a.push(FarmPage(a)) }
        more += Tool("🏅", "等级徽章", com.laolao.classcalendar.core.Meta.stats().let { "Lv.${it.level} ${it.title}" }) { a.push(MetaPage(a)) }
        more += Tool("✦", "神谕阁", "答案之书、卡牌指引") { a.push(OraclePage(a)) }
        return listOf("学习" to learn, (if (Store.work()) "团队" else "班级") to cls, "生活与趣味" to more)
    }

    override fun render() {
        view
        keepScroll(body)
        for ((title, list) in tools()) {
            if (list.isEmpty()) continue
            val c = ctx.card(0, 20).apply { pad(6, 10, 6, 4); if (body.childCount > 0) margins(t = 10) }
            c.addView(ctx.text(title, 12.5f, C.sub, BOLD).apply { pad(10, 0, 0, 2) })
            list.chunked(4).forEach { rowItems ->
                val r = ctx.row()
                rowItems.forEach { t -> r.addView(cell(t), LinearLayout.LayoutParams(0, WRAP, 1f)) }
                repeat(4 - rowItems.size) { r.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f)) }
                c.addView(r)
            }
            body.addView(c)
        }
    }

    /** 一个工具：小方块图标 + 短名字；右上角角标；长按看说明 */
    private fun cell(t: Tool): View = ctx.col().apply {
        gravity = Gravity.CENTER_HORIZONTAL; pad(2, 5, 2, 6); press(C.card, 14)
        tap { t.open() }
        setOnLongClickListener { v -> v.buzz(); a.toast(t.name + "：" + t.desc); true }
        contentDescription = t.name
        val box = FrameLayout(ctx).apply { clipChildren = false; clipToPadding = false }
        box.addView(Ic.tile(ctx, t.icon, 38), FrameLayout.LayoutParams(dp(38), dp(38), Gravity.CENTER))
        if (t.badge.isNotEmpty()) box.addView(ctx.text(t.badge, 9.5f, android.graphics.Color.WHITE, BOLD).apply {
            gravity = Gravity.CENTER; includeFontPadding = false; minWidth = dp(15); setPadding(dp(4), 0, dp(4), 0)
            background = round(when { t.badge == "✓" -> C.green; t.hot -> C.red; else -> C.alpha(C.text, 0.55f) }, dp(8).toFloat(), C.card, dp(1))
        }, FrameLayout.LayoutParams(WRAP, dp(16), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { leftMargin = dp(22) })
        addView(box, LinearLayout.LayoutParams(dp(56), dp(41)))
        addView(ctx.text(t.name, 12.5f, C.text, SEMI, 1).apply { gravity = Gravity.CENTER; margins(t = 3) }, LinearLayout.LayoutParams(MATCH, WRAP))
    }
}
