package com.laolao.classcalendar.ui

import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.JoinReview
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.OrgApi
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.noFn
import com.laolao.classcalendar.core.str
import org.json.JSONObject

// 7.x（和小程序 1.33、网站同步）：带插图的功能介绍、学校与院系、班委审批入班

/** 带插图的功能介绍（插图和小程序、网站同一套）：「我的 → 功能介绍」里一图一卡；第一次打开某个页面时弹一张卡片说怎么用 */
object Guide {
    data class G(val key: String, val img: Int, val title: String, val steps: List<String>)
    val ALL = listOf(
        G("home", R.drawable.guide_calendar, "首页", listOf("今天的课、早晚自习、作业和班级通知按时间排好；点右边的圆圈标记完成。", "右下角「＋」可以记一件事、记作业、拍课表导入。")),
        G("homework", R.drawable.guide_homework, "作业", listOf("按截止时间列出要交的作业，做完点一下标记完成。", "作业也会出现在首页和日历里，截止前会提醒你。")),
        G("checkin", R.drawable.guide_checkin, "签到", listOf("同学：输入投屏、黑板或群里的 4 位签到码，或者扫二维码；要拍照、定位的按提示做。网络不好也能签：点了就先记在手机上，联网后自动交。",
            "老师、班委：发起签到时选方式、时长和「谁要签」（学生、班委、老师、指定的人或分组）；进行中可以看名单、补签、改范围。")),
        G("course", R.drawable.guide_course, "课程表", listOf("可以拍照 / 截图导入课表，也可以长按空白格子加课；记得设置第一周的日期和作息时间。", "早自习、晚自习显示在课表最上面和最下面，在右上角「⋯」里设置。")),
        G("class", R.drawable.guide_class, "班级", listOf("同学：输入老师或班委给的班级码申请加入，批准后就能看到班级作业和通知。", "老师：审批入班、任命班委、给班委单独开关审批权；班委默认也能批准谁入班。")),
        G("org", R.drawable.guide_growth, "学校与院系", listOf("选了学校就会自动挂到这所学校下面（学校还没开通也一样），再填上自己的院系。", "学校开通后，管理员可以按院系一键整理，不用一个个找人。")),
        G("ingest", R.drawable.guide_ingest, "整理群消息", listOf("把群里的通知文字粘贴进来，或者选截图、文件，捞捞认出作业、通知、截止时间和地点。", "核对一下再发布到班级，或者加到自己的事项里。")),
        G("plan", R.drawable.guide_plan, "规划与专注", listOf("用四象限、六件事等方法排今天要做的事，番茄钟帮你专注 25 分钟。")),
        G("growth", R.drawable.guide_growth, "成长", listOf("完成作业、签到、打卡都会攒成长值，看本周进度和最近的趋势。")),
        G("ask", R.drawable.guide_ask, "查日程", listOf("输入「明天的课」「这周的作业」「下节课在哪」，捞捞按你的日历和课表回答。")),
        G("remind", R.drawable.guide_remind, "提醒", listOf("上课、早晚自习、作业截止前，手机会按时提醒；也可以订阅到手机日历。")),
        G("farm", R.drawable.guide_farm, "云宠农场", listOf("完成作业、打卡、番茄专注会攒「养料」，喂你的云宠长大。")),
    )
    private const val KEY = "web_tips_seen_v1"
    /** 第一次打开这个页面：弹一张带插图的说明（每个页面只弹一次，记在本机） */
    fun once(a: Main, key: String) {
        val g = ALL.firstOrNull { it.key == key } ?: return
        val seen = Kv.obj(KEY)
        if (seen.optBoolean(key)) return
        seen.put(key, true); Kv.setQuiet(KEY, seen)
        Bg.later(400) { show(a, g) }
    }
    fun reset() = Kv.setQuiet(KEY, null)
    fun show(a: Main, g: G) {
        val ctx = a
        val c = ctx.col().apply { pad(0, 0, 0, 14) }
        lateinit var d: android.app.Dialog
        val img = ImageView(ctx).apply { setImageResource(g.img); scaleType = ImageView.ScaleType.CENTER_CROP; adjustViewBounds = true
            background = GradientDrawable().apply { val r = ctx.dp(22).toFloat(); cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f) }; clipToOutline = true }
        val w = (ctx.resources.displayMetrics.widthPixels * 0.88).toInt()
        c.addView(img, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, w * 320 / 600))
        val t = ctx.col().apply { pad(20, 14, 20, 0) }
        t.addView(ctx.text(g.title, 19f, C.text, BOLD))
        g.steps.forEachIndexed { i, s -> t.add(ctx.text("${i + 1}. $s", 14.5f, C.text).apply { setLineSpacing(0f, 1.25f) }, 8) }
        c.addView(t)
        c.add(ctx.row().apply { gravity = Gravity.END; pad(12, 0); addView(ctx.text("知道了", 15f, C.accent, BOLD).apply { pad(16, 10); press(0, 10); tap { d.dismiss() } }) }, 8)
        d = Dialogs.show(ctx, c)
    }
}

class GuidePage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    override fun build(): View = scaffold("功能介绍") { body = it }
    override fun onShow() = render()
    override fun render() {
        view; keepScroll(body)
        body.add(ctx.text("每个功能怎么用，一图看懂。点卡片看详细说明。", 13f, C.sub), 6)
        val w = (if (body.width > 0) body.width else ctx.resources.displayMetrics.widthPixels - dp(32))
        for (g in Guide.ALL) {
            val c = ctx.card(0, 18).apply { margins(t = 12); clipToOutline = true }
            c.addView(ImageView(ctx).apply { setImageResource(g.img); scaleType = ImageView.ScaleType.CENTER_CROP }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, w * 320 / 600))
            val t = ctx.col().apply { pad(16, 12, 16, 14) }
            t.addView(ctx.text(g.title, 16f, C.text, BOLD))
            t.add(ctx.text(g.steps.first(), 13f, C.sub, lines = 3), 4)
            c.addView(t)
            c.press(C.card, 18, C.line); c.tap { Guide.show(a, g) }
            body.addView(c)
        }
        body.add(ctx.soft("以后第一次打开每个页面时，再弹一次使用说明") { Guide.reset(); a.toast("好了，下次打开每个页面会再弹一次") }, 16)
    }
}

/** 学校与院系（7.54）：选了学校就自动挂到这所学校下面（还没开通也一样），院系自己填或从提示里选 */
class OrgPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    override val autoRender = false
    private var type = Store.me?.str("org_type") ?: ""
    private var name = Store.me?.str("org_name") ?: ""
    private var dept = ""; private var dept0 = ""; private var info: JSONObject? = null; private var sug: List<JSONObject> = emptyList(); private var busy = false
    private val saved get() = type == (Store.me?.str("org_type") ?: "") && name.trim() == (Store.me?.str("org_name") ?: "")
    override fun build(): View = scaffold("学校与院系") { body = it }
    override fun onShow() { render(); load(); Guide.once(a, "org") }
    private fun load() {
        Bg.load({ OrgApi.me() to OrgApi.suggest("") }) { r, _ ->
            info = r?.first; sug = r?.second ?: emptyList()
            info?.str("dept")?.takeIf { it.isNotEmpty() }?.let { if (dept.isEmpty()) dept = it; dept0 = it }
            render()
        }
    }
    override fun render() {
        view; keepScroll(body)
        val c1 = ctx.card(16, 18).apply { margins(t = 8) }
        c1.addView(ctx.text("学校 / 单位", 16f, C.text, BOLD))
        c1.add(ctx.text("选填；学校开通后，本校管理员能看到你的姓名、院系和班级", 12.5f, C.sub), 2)
        val f = FlowRow(ctx, dp(6), dp(6))
        OrgApi.TYPES.forEach { (k, t) -> f.addView(ctx.text(t, 13.5f, if (type == k) C.accent else C.text, if (type == k) BOLD else null).apply {
            pad(12, 6); bg(if (type == k) C.alpha(C.accent, 0.12f) else C.mutedBg, 14); tap { type = k; render() } }) }
        c1.add(f, 10)
        if (type.isNotEmpty() && type != "personal") {
            val ni = ctx.input(if (type in OrgApi.SCHOOL) "学校全称，比如：西安交通大学" else "单位名称", name).apply { margins(t = 10) }
            ni.addTextChangedListener(watch { name = it })
            c1.addView(ni)
        }
        body.addView(c1)
        if (type in OrgApi.SCHOOL && name.isNotBlank()) {
            val c2 = ctx.card(16, 18).apply { margins(t = 12) }
            c2.addView(ctx.text("院系", 16f, C.text, BOLD))
            c2.add(ctx.text("选填，方便学校开通后统一管理", 12.5f, C.sub), 2)
            val di = ctx.input("比如：计算机学院、软件工程系", dept).apply { margins(t = 10) }
            di.addTextChangedListener(watch { v -> dept = v; Bg.main.removeCallbacks(sugRun); Bg.main.postDelayed(sugRun, 300) })
            c2.addView(di)
            if (!saved) c2.add(ctx.text("换了学校：保存后再选院系", 12.5f, C.sub), 6)
            else { val sf = FlowRow(ctx, dp(6), dp(6)); sugBox = sf; fillSug(); c2.add(sf, 10) }
            info?.let { o ->
                if (saved && o.str("school").isNotEmpty()) c2.add(ctx.text(
                    if (o.optBoolean("opened")) "${o.str("school")}已在捞捞开通" + if (o.optBoolean("dept_ok")) "，你的院系已对上学校建好的院系。" else "。"
                    else "${o.str("school")}还没开通，已经有 ${o.optInt("n_school")} 位同学选了这所学校。学校开通后会按院系一键整理。", 12.5f, C.sub), 10)
            }
            body.addView(c2)
        }
        body.add(ctx.button(if (busy) "保存中…" else "保存") { save() }, 16)
    }
    private var sugBox: FlowRow? = null
    /** 只重画提示（不重画整页，不然正在打的字会丢焦点） */
    private fun fillSug() {
        val sf = sugBox ?: return
        sf.removeAllViews()
        sug.take(12).forEach { x -> sf.addView(ctx.text(x.str("name") + "  " + if (x.optBoolean("real")) "学校已建" else "${x.optInt("n")} 人选了", 13f, C.text).apply {
            pad(10, 5); bg(C.mutedBg, 14, if (x.optBoolean("real")) C.alpha(C.green, 0.5f) else 0); tap { dept = x.str("name"); render() } }) }
    }
    private val sugRun = Runnable { if (saved) Bg.load({ OrgApi.suggest(dept.trim()) }) { r, _ -> if (r != null) { sug = r; fillSug() } } }
    private fun watch(fn: (String) -> Unit) = object : android.text.TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, a1: Int, b1: Int, c1: Int) {}
        override fun onTextChanged(s: CharSequence?, a1: Int, b1: Int, c1: Int) {}
        override fun afterTextChanged(s: android.text.Editable?) { fn(s.toString()) }
    }
    private fun save() {
        if (busy) return; busy = true; render()
        val wasSaved = saved; val t0 = type; val n0 = if (type == "personal") "" else name.trim(); val d0 = dept.trim()
        Bg.load({
            if (!wasSaved) OrgApi.setOrg(t0, n0)
            if (t0 in OrgApi.SCHOOL && d0 != dept0 && (wasSaved || d0.isNotEmpty())) { try { OrgApi.deptSet(d0) } catch (e: Exception) { if (noFn(e)) throw Exception("院系要等管理员升级数据库后才能填") else throw e } }
            true
        }) { r, e ->
            busy = false
            if (r == null) a.toast(if (noFn(e)) "学校 / 单位要等管理员升级数据库后才能改" else "没保存：" + (e?.message ?: ""))
            else { a.toast("已保存"); dept0 = d0 }
            load()
        }
    }
}

/** 班委审批入班（7.54：班委默认能批准谁入班；老师关掉了你的审批权时这里是空的） */
class JoinReviewPage(a: Main, private val cid: String, private val cname: String) : Page(a) {
    private lateinit var body: LinearLayout
    private var list: List<JSONObject>? = null; private var err = ""
    override fun build(): View = scaffold("审批入班", pull = { done -> load { done() } }) { body = it }
    override fun onShow() { load() }
    private fun load(done: (() -> Unit)? = null) {
        Bg.load({ JoinReview.pending(cid) }) { r, e -> done?.invoke(); if (r == null) err = e?.message ?: "加载失败" else { list = r; err = "" }; render() }
    }
    override fun render() {
        view; keepScroll(body)
        body.add(ctx.text("「$cname」的入班申请。班委默认也能批准或拒绝；老师可以在班级管理里关掉某个班委的审批权。", 13f, C.sub), 6)
        if (err.isNotEmpty()) { body.add(ctx.text(err, 13.5f, C.red), 10); return }
        val l = list ?: run { body.add(ctx.text("加载中…", 14f, C.sub), 12); return }
        if (l.isEmpty()) { body.add(ctx.empty("✅", "没有待批准的申请", "有同学申请加入时，微信和这里都会提醒"), 12); return }
        val pc = ctx.card(4, 18).apply { margins(t = 12) }
        l.forEachIndexed { i, m ->
            if (i > 0) pc.addView(ctx.hline())
            val row = ctx.row().apply { pad(14, 10) }
            row.addView(CK.avatar(ctx, m.str("name"), 36), LinearLayout.LayoutParams(dp(36), dp(36)))
            val cc = ctx.col().apply { pad(10, 0) }
            cc.addView(ctx.text(m.str("name"), 15f, C.text, SEMI, 1)); cc.addView(ctx.text("@" + m.str("account"), 12f, C.sub, lines = 1))
            row.addView(cc, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(ctx.text("拒绝", 13.5f, C.red, SEMI).apply { pad(12, 7); press(C.dangerBg, 10); tap { Dialogs.confirm(ctx, "拒绝 ${m.str("name")} 的申请？", "", "拒绝", danger = true) { review(m, false) } } })
            row.addView(ctx.text("批准", 13.5f, android.graphics.Color.WHITE, BOLD).apply { pad(14, 7); press(C.accent, 10); tap { review(m, true) } }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { leftMargin = dp(8) })
            pc.addView(row)
        }
        body.addView(pc)
    }
    private fun review(m: JSONObject, ok: Boolean) {
        Bg.load({ JoinReview.review(cid, m.str("user_id"), ok) }) { _, e ->
            if (e != null) a.toast(if (Regex("42501|只有老师|权限").containsMatchIn(e.message ?: "")) "你的审批权限被老师关掉了" else "没成功：" + e.message)
            else { a.toast(if (ok) "已批准 ${m.str("name")}" else "已拒绝"); load() }
        }
    }
}
