package com.laolao.classcalendar.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Bus
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Farm
import com.laolao.classcalendar.core.Growth
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Meta
import com.laolao.classcalendar.core.Plan
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.objs
import com.laolao.classcalendar.core.str
import org.json.JSONArray
import org.json.JSONObject

/** 按下去轻轻缩一下、松手弹回来（卡片的「手感」） */
@SuppressLint("ClickableViewAccessibility")
fun View.springy(): View {
    setOnTouchListener { v, e ->
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> v.animate().scaleX(0.97f).scaleY(0.97f).setDuration(90).start()
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> v.animate().scaleX(1f).scaleY(1f).setDuration(160).setInterpolator(android.view.animation.OvershootInterpolator(2f)).start()
        }
        false
    }
    return this
}

/** 每日鼓励（照小程序 lib/enc.js：队员设计的情绪包，心情记录 mood_log_v1 跟着账号同步） */
object Enc {
    class Q(val zh: String, val en: String, val emo: String, val c1: String, val c2: String)
    private fun q(zh: String, en: String, emo: String, g: String) = g.split(",").let { Q(zh, en, emo, it[0], it[1]) }
    private val GO = listOf(q("今天的努力，是明天的底气。", "Today's effort is tomorrow's confidence.", "💪", "#667eea,#764ba2"), q("每一步都算数，继续往前走。", "Every step counts, keep going.", "🚶", "#4facfe,#00f2fe"),
        q("坚持一下，再坚持一下。", "Hold on, just a little longer.", "🔥", "#ffecd2,#fcb69f"), q("你的坚持，终将美好。", "Your persistence will pay off beautifully.", "🦋", "#ff9a9e,#fad0c4"),
        q("先完成，再完美。", "Done is better than perfect.", "✅", "#43e97b,#38f9d7"), q("一次只做一件事，做完就是胜利。", "One thing at a time — finishing is winning.", "🎯", "#f6d365,#fda085"),
        q("作业不会自己消失，但你可以让它消失。", "Homework won't vanish by itself — but you can make it.", "📝", "#a18cd1,#fbc2eb"), q("世界很大，你的可能性更大。", "The world is big, your possibilities are bigger.", "🌍", "#89f7fe,#66a6ff"))
    private val WARM = listOf(q("你比想象中更强大。", "You are stronger than you think.", "🌟", "#f093fb,#f5576c"), q("别急，花会开的。", "Be patient, the flowers will bloom.", "🌸", "#43e97b,#38f9d7"),
        q("你已经做得很好了。", "You're already doing great.", "✨", "#fa709a,#fee140"), q("慢慢来，比较快。", "Slow and steady wins the race.", "🐢", "#a18cd1,#fbc2eb"),
        q("光而不耀，静而不止。", "Bright but calm, quiet but unstoppable.", "☀️", "#a1c4fd,#c2e9fb"), q("允许一切发生，然后继续走。", "Let things happen, then keep walking.", "🍃", "#d4fc79,#96e6a1"),
        q("你已经走了很远了，别忘了为自己鼓掌。", "You've come so far — applaud yourself.", "👏", "#84fab0,#8fd3f4"), q("日子还长，值得期待的还有很多。", "There's still so much to look forward to.", "🌈", "#fbc2eb,#a6c1ee"),
        q("今天也是值得被期待的一天。", "Today is another day worth looking forward to.", "🌅", "#fdcbf1,#e6dee9"), q("偶尔停下来，也是在往前走。", "Pausing is also part of moving forward.", "☕", "#e0c3fc,#8ec5fc"))
    private val REST = listOf(q("累了就休息，但别忘了重新出发。", "Rest if tired, but don't forget to start again.", "🛏️", "#f6d365,#fda085"), q("周末快乐！给自己充充电吧。", "Happy weekend — time to recharge.", "🔋", "#84fab0,#8fd3f4"), q("出去走走，晒晒太阳。", "Go outside and catch some sunshine.", "🌤️", "#ffecd2,#fcb69f"))
    private val NIGHT = listOf(q("夜深了，明天的事交给明天的你。", "It's late — leave tomorrow's work to tomorrow's you.", "🌙", "#30cfd0,#330867"), q("早点睡，睡饱了脑子才转得快。", "Sleep well — a rested brain works faster.", "😴", "#4b6cb7,#182848"))
    val MOODS = listOf(Triple("great", "😄", "超开心"), Triple("good", "🙂", "还不错"), Triple("meh", "😐", "一般般"), Triple("tired", "😮‍💨", "有点累"), Triple("down", "😢", "不开心"))
    private val REPLY = mapOf("great" to listOf("开心的日子要记住！把好心情分一点给同桌吧 🎉", "今天状态满分，冲鸭！"), "good" to listOf("平平稳稳就是好日子 🙂", "保持住，今天也会顺顺利利。"),
        "meh" to listOf("一般般也没关系，做完一件小事就会好一点。", "听首喜欢的歌，再开始下一件事吧 🎧"), "tired" to listOf("累了就歇一会儿，喝口水、伸个懒腰 ☕", "今天早点睡，明天又是满血的你。"),
        "down" to listOf("抱抱你。难过的时候不用硬撑，找信任的朋友或老师聊聊 🤍", "今天不开心也没关系，明天会好一点的。需要的话，随时可以找人说说。"))
    var shift = 0
    fun card(overdue: Int, hwLeft: Int): Q {
        val now = T.now(); val h = now.hour; val wd = now.dayOfWeek.value
        val p = if (h >= 23 || h < 5) NIGHT else if (overdue > 0 || hwLeft >= 3) GO else if (wd >= 6) REST + WARM else WARM + GO
        val k = T.todayKey() + (Api.uid ?: ""); var hash = 0; for (ch in k) hash = hash * 31 + ch.code
        return p[(Math.abs(hash) + shift) % p.size]
    }
    fun mood(): String = Kv.obj("mood_log_v1").optString(T.todayKey())
    fun setMood(k: String?) { val l = Kv.obj("mood_log_v1"); if (k == null) l.remove(T.todayKey()) else l.put(T.todayKey(), k); Kv.set("mood_log_v1", l); Bus.emit("data") }
    fun reply(m: String): String = REPLY[m]?.let { it[(T.todayKey().length + shift) % it.size] } ?: ""
}

/**
 * 首页「我的学习空间」：一张张会动的卡片（照小程序首页：作业、日历、置顶通知、每日鼓励、四象限、进度环、云宠、快捷按钮…）
 * 摆放、大小存在 home_layout_v1，和网页、小程序同步；「自定义首页」可以排序、换大小、加减卡片
 */
class HomeCards(private val p: Page) {
    private val a = p.a; private val ctx = p.ctx
    private fun dp(v: Int) = ctx.dp(v)
    var editing = false
    class Def(val name: String, val icon: String, val w: Int, val h: Int, val on: () -> Boolean = { true }, val fixed: Boolean = false)
    private val funo: JSONObject get() = jsonOf("rings" to true, "habits" to true, "plan" to true).also { d -> val x = Kv.obj("fun_opts_v1"); for (k in x.keys()) d.put(k, x.get(k)) }
    val DEFS = linkedMapOf(
        "w:hw" to Def("作业", "📝", 2, 1), "w:cal" to Def("日历", "📅", 2, 1),
        "w:pins" to Def("置顶通知", "📌", 4, 1, { Store.feat("wall") && Store.cls != null }),
        "w:rings" to Def("本周进度", "⭕", 4, 1, { funo.optBoolean("rings", true) }),
        "w:quick" to Def("快捷按钮", "⚡", 4, 1, fixed = true),
        "w:habits" to Def("今日打卡", "🔥", 2, 2, { funo.optBoolean("habits", true) }),
        "w:encourage" to Def("每日鼓励", "🌱", 4, 1),
        "w:plan" to Def("规划 · 四象限", "🎯", 4, 2, { funo.optBoolean("plan", true) && Store.feat("plan") }),
        "w:pomo" to Def("番茄钟", "🍅", 2, 1, { funo.optBoolean("plan", true) }),
        "w:rank" to Def("排行榜", "🏆", 2, 1, { Store.feat("rank") && Store.cls != null }),
        "w:course" to Def("今日课程", "📚", 2, 1, { Store.feat("courses") }),
        "w:meta" to Def("等级与徽章", "🏅", 2, 1),
        "w:farm" to Def("云宠农场", "🐣", 2, 1, { Farm.on() }),
    )
    private val DEFAULT = listOf("w:pins" to (4 to 1), "w:hw" to (2 to 1), "w:cal" to (2 to 1), "w:encourage" to (4 to 1), "w:plan" to (4 to 2), "w:rings" to (4 to 1), "w:farm" to (2 to 1), "w:quick" to (4 to 1))
    class Slot(val id: String, var w: Int, var h: Int)
    /** 网页上放到首页的工具里，安卓能打开的这几个；网页插件（p:…）不显示 */
    private val TOOL_IDS = setOf("t:growth", "t:plan", "t:rank", "t:farm", "t:meta")

    // ---------- 摆放（home_layout_v1） ----------
    private fun raw(): JSONObject = Kv.obj("home_layout_v1")
    fun layout(): MutableList<Slot> {
        val L = raw(); val arr = L.optJSONArray("home")
        if (arr == null) return DEFAULT.map { Slot(it.first, it.second.first, it.second.second) }.toMutableList()
        val out = arr.objs().filter { it.str("id").isNotEmpty() }.map { Slot(it.str("id"), it.optInt("w", 2), it.optInt("h", 1)) }.toMutableList()
        var fix = false
        fun at(id: String) = out.indexOfFirst { it.id == id }
        if (!L.optBoolean("planCard") && at("w:plan") < 0) { out.add(maxOf(at("w:cal"), at("w:hw")) + 1, Slot("w:plan", 4, 2)); fix = true }
        if (!L.optBoolean("encCard") && at("w:encourage") < 0) { out.add(maxOf(at("w:cal"), at("w:hw")) + 1, Slot("w:encourage", 4, 1)); fix = true }
        if (!L.optBoolean("farmCard") && at("w:farm") < 0) { val i = at("w:rings"); out.add(if (i < 0) out.size else i + 1, Slot("w:farm", 2, 1)); fix = true }
        if (at("w:quick") < 0) { out += Slot("w:quick", 4, 1); fix = true }
        if (fix) save(out)
        return out
    }
    private fun save(l: List<Slot>) {
        val L = raw()
        L.put("home", JSONArray(l.map { jsonOf("id" to it.id, "w" to it.w, "h" to it.h) }))
        if (!L.has("rail")) L.put("rail", JSONArray())
        L.put("planCard", true); L.put("encCard", true); L.put("farmCard", true)
        Kv.set("home_layout_v1", L)
    }

    // ---------- 画出来 ----------
    fun build(body: LinearLayout, A: Items.Agenda) {
        val sp = ctx.row().apply { margins(t = 26, b = 12) }
        val hc = ctx.col()
        hc.addView(ctx.text("为今天而安排", 11.5f, C.sub, SEMI))
        hc.addView(ctx.text("我的学习空间", 20f, C.text, HEAVY).apply { margins(t = 2) })
        sp.addView(hc, LinearLayout.LayoutParams(0, WRAP, 1f))
        sp.addView(ctx.text(if (editing) "完成" else "⊞ 自定义首页", 13f, if (editing) Color.WHITE else C.accent, SEMI).apply { pad(12, 7); press(if (editing) C.accent else C.selected, 16); tap { editing = !editing; p.render() } })
        body.addView(sp)
        val L = layout()
        if (editing) body.addView(editBar(L))
        loadPins()
        val shown = L.filter { s -> (s.id in TOOL_IDS || DEFS[s.id]?.on?.invoke() == true) && (s.id != "w:pins" || pins.isNotEmpty() || editing) }
        var i = 0
        while (i < shown.size) {
            val s = shown[i]
            val full = s.w >= 3
            if (full) { body.addView(wrap(s, L, A), LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dp(12) }); i++; continue }
            val row = ctx.row().apply { gravity = Gravity.TOP }
            row.addView(wrap(s, L, A), LinearLayout.LayoutParams(0, MATCH, 1f))
            val nx = shown.getOrNull(i + 1)
            if (nx != null && nx.w < 3) { row.addView(wrap(nx, L, A), LinearLayout.LayoutParams(0, MATCH, 1f).apply { leftMargin = dp(12) }); i += 2 }
            else { row.addView(View(ctx), LinearLayout.LayoutParams(0, MATCH, 1f).apply { leftMargin = dp(12) }); i++ }
            body.addView(row, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dp(12) })
        }
    }
    /** 卡片 + 编辑时盖在上面的按钮 */
    private fun wrap(s: Slot, L: MutableList<Slot>, A: Items.Agenda): View {
        val v = try { card(s, A) } catch (e: Exception) { ctx.text("这张卡片出错了：" + e.message, 12f, C.red).apply { bg(C.card, 18, C.line); pad(14, 14) } }
        // 只有半行的小方块统一高度；整行的卡片按内容走，不留空白
        if (s.w < 3) v.minimumHeight = dp(if (s.h >= 2) 260 else 140)
        if (!editing) return v
        val f = FrameLayout(ctx)
        f.addView(v, FrameLayout.LayoutParams(MATCH, MATCH))
        val ov = ctx.col().apply { gravity = Gravity.CENTER; background = round(0x8C0E2240.toInt(), dp(18).toFloat()); isClickable = true }
        val d = DEFS[s.id]
        ov.addView(ctx.text("${d?.icon ?: "🧩"} ${d?.name ?: s.id} · ${if (s.w >= 3) "整行" else "半行"}${if (s.h > 1) " · 高" else ""}  ⇲", 12.5f, Color.WHITE, BOLD).apply { gravity = Gravity.CENTER; pad(8, 6)
            tap { // 换大小：半行 → 整行 → 整行·高 → 半行·高
                val nx = when { s.w < 3 && s.h == 1 -> 4 to 1; s.w >= 3 && s.h == 1 -> 4 to 2; s.w >= 3 -> 2 to 2; else -> 2 to 1 }
                s.w = nx.first; s.h = nx.second; save(L); p.render()
            } })
        val br = ctx.row().apply { gravity = Gravity.CENTER; margins(t = 6) }
        fun btn(t: String, bgc: Int, fg: Int, fn: () -> Unit) = br.addView(ctx.text(t, 15f, fg, HEAVY).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(bgc) }; tap { fn() } }, LinearLayout.LayoutParams(dp(34), dp(34)).apply { leftMargin = dp(5); rightMargin = dp(5) })
        btn("↑", Color.WHITE, C.c("#172c36")) { val k = L.indexOf(s); if (k > 0) { L.removeAt(k); L.add(k - 1, s); save(L); p.render() } }
        btn("↓", Color.WHITE, C.c("#172c36")) { val k = L.indexOf(s); if (k < L.size - 1) { L.removeAt(k); L.add(k + 1, s); save(L); p.render() } }
        if (d?.fixed != true) btn("✕", C.c("#ff6a3d"), Color.WHITE) { L.remove(s); save(L); p.render() }
        ov.addView(br)
        f.addView(ov, FrameLayout.LayoutParams(MATCH, MATCH))
        return f
    }
    private fun editBar(L: MutableList<Slot>): View {
        val c = ctx.card(14, 18).apply { margins(b = 12) }
        c.addView(ctx.text("自定义首页", 15f, C.text, BOLD))
        c.addView(ctx.text("点名字换大小，↑↓ 排序，✕ 移走；会同步到网页和小程序", 12f, C.sub).apply { margins(t = 2) })
        val addable = DEFS.filter { (id, d) -> L.none { it.id == id } && d.on() }
        val wrapRow = ctx.col().apply { margins(t = 8) }
        var row: LinearLayout? = null
        addable.entries.forEachIndexed { i, (id, d) ->
            if (i % 3 == 0) { row = ctx.row(); wrapRow.addView(row, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(6) }) }
            row!!.addView(ctx.text("＋ ${d.icon} ${d.name}", 12.5f, C.accent, SEMI).apply { gravity = Gravity.CENTER; pad(6, 7); bg(C.selected, 14); tap { L.add(maxOf(0, L.size - 1), Slot(id, d.w, d.h)); save(L); p.render() } }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i % 3 > 0) leftMargin = dp(6) })
        }
        if (addable.isEmpty()) wrapRow.addView(ctx.text("所有卡片都在首页上了", 12.5f, C.sub))
        c.addView(wrapRow)
        val br = ctx.row().apply { margins(t = 12) }
        br.addView(ctx.text("恢复默认", 13f, C.sub, SEMI).apply { pad(12, 7); bg(C.mutedBg, 14); tap { Dialogs.confirm(ctx, "恢复默认的首页？", "", "恢复") { save(DEFAULT.map { Slot(it.first, it.second.first, it.second.second) }); p.render() } } })
        br.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        br.addView(ctx.text("完成", 13f, Color.WHITE, BOLD).apply { pad(16, 7); bg(C.accent, 14); tap { editing = false; p.render() } })
        c.addView(br)
        return c
    }

    // ---------- 每一张卡片 ----------
    private fun card(s: Slot, A: Items.Agenda): View = when (s.id) {
        "w:hw" -> hwTile(s, A); "w:cal" -> calTile(s, A); "w:pins" -> pins(); "w:encourage" -> encourage(s, A); "w:plan" -> plan(s)
        "w:rings" -> rings(); "w:farm" -> farm(s); "w:quick" -> quick(); "w:habits" -> habits(s); "w:pomo" -> pomo(); "w:rank" -> rank()
        "w:course" -> course(s); "w:meta" -> meta()
        else -> toolCard(s.id)
    }
    private fun base(): LinearLayout = ctx.col().apply { pad(16, 16); bg(C.card, 18, C.line); elevation = dp(1).toFloat() }
    private fun head(c: LinearLayout, t: String, meta: String = "", right: String = "", go: (() -> Unit)? = null) {
        val r = ctx.row().apply { margins(b = 10) }
        r.addView(ctx.text(t, 14.5f, C.text, BOLD))
        if (meta.isNotEmpty()) r.addView(ctx.text("  $meta", 12f, C.sub, SEMI, 1), LinearLayout.LayoutParams(0, WRAP, 1f)) else r.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f))
        if (right.isNotEmpty()) r.addView(ctx.text(right, 12.5f, C.accent, SEMI).apply { if (go != null) tap { go() } })
        c.addView(r)
    }
    private val tileA get() = if (C.dark) C.c("#3a322d") else C.c("#fff0e1")
    private val tileB get() = if (C.dark) C.c("#263d35") else C.c("#e8efeb")
    private val tileText get() = if (C.dark) C.c("#eef3f0") else C.c("#172c36")

    /** 作业 / 日历：彩色方块，大数字 + 最近几项 */
    private fun tile(color: Int, title: String, sub: String, big: String, unit: String, rows: List<Pair<String, Pair<String, Int>>>, emptyRow: String, go: String, deco: View, onTap: () -> Unit): View {
        val f = FrameLayout(ctx).apply { background = round(color, dp(18).toFloat(), C.alpha(tileText, 0.06f), dp(1)); clipToOutline = true; springy(); tap { onTap() }; lift(5, tileText) }
        f.addView(deco, FrameLayout.LayoutParams(dp(44), dp(44)).apply { gravity = Gravity.END or Gravity.TOP; topMargin = dp(16); rightMargin = dp(12) })
        val c = ctx.col().apply { pad(16, 16, 16, 34) }
        c.addView(ctx.text(title, 13.5f, tileText, BOLD))
        c.addView(ctx.text(sub, 11.5f, C.alpha(tileText, 0.62f), lines = 1).apply { margins(t = 3) })
        if (rows.isNotEmpty() || emptyRow.isNotEmpty()) {
            val l = ctx.col().apply { margins(t = 8) }
            if (rows.isEmpty()) l.addView(ctx.text(emptyRow, 12.5f, tileText, SEMI).apply { pad(0, 6) })
            for ((t, d) in rows) {
                l.addView(View(ctx).apply { setBackgroundColor(C.alpha(tileText, 0.12f)) }, LinearLayout.LayoutParams(MATCH, 1))
                val r = ctx.row().apply { pad(0, 6) }
                r.addView(ctx.text(t, 12.5f, tileText, SEMI, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
                r.addView(ctx.text(d.first, 11f, if (d.second >= 2) C.red else C.alpha(tileText, 0.7f), BOLD).apply { pad(6, 0, 0, 0) })
                l.addView(r)
            }
            c.addView(l)
        }
        val br = ctx.row().apply { gravity = Gravity.BOTTOM; margins(t = if (rows.isEmpty()) 14 else 6) }
        br.addView(ctx.text(big, if (rows.isEmpty()) 38f else 26f, tileText).apply { typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL); letterSpacing = -0.03f; includeFontPadding = false })
        br.addView(ctx.text(" $unit", 11.5f, C.alpha(tileText, 0.75f)).apply { pad(0, 0, 0, dp(3) / 3) })
        c.addView(br)
        f.addView(c, FrameLayout.LayoutParams(MATCH, WRAP))
        f.addView(ctx.text(go, 11.5f, tileText, BOLD), FrameLayout.LayoutParams(WRAP, WRAP).apply { gravity = Gravity.END or Gravity.BOTTOM; rightMargin = dp(14); bottomMargin = dp(12) })
        return f
    }
    private fun hwTile(s: Slot, A: Items.Agenda): View {
        val list = Items.all().filter { it.hw && it.dated && !it.done && T.dayDiff(it.day) >= -30 }.sortedBy { it.day + it.time.ifEmpty { "99" } }
        val n = if (s.h >= 2) 5 else if (s.w >= 3) 3 else 1
        val deco = ctx.text("✓", 40f, C.alpha(tileText, 0.18f)).apply { gravity = Gravity.CENTER }
        return tile(tileA, if (Store.work()) "任务" else "作业", if (A.overdue.isNotEmpty()) "${A.overdue.size} 项已过期" else "两周内要交", "${A.hwLeft}", "项没交",
            list.take(n).map { it.title to Items.due(it).let { d -> d.first.replace("截止", "") to d.second } }, if (list.isEmpty()) "没有要交的作业 🎉" else "", "去完成 ›", deco) { a.selectTab(1) }
    }
    private fun calTile(s: Slot, A: Items.Agenda): View {
        val t = T.todayKey()
        val today = Items.byDay(Items.all(courses = t to t))[t]?.filter { !it.done } ?: emptyList()
        val n = if (s.h >= 2) 5 else if (s.w >= 3) 3 else 1
        val up = A.days.sumOf { d -> d.items.count { !it.done && !it.course } }
        val deco = CalDeco(ctx, C.alpha(tileText, 0.2f))
        return tile(tileB, "日历", "${T.md(t)} ${T.wk(t)} · 两周 $up 项", "${A.todayCount}", "今天待办",
            today.take(n).map { it.title to (it.time.ifEmpty { "全天" } to 0) }, if (today.isEmpty()) "今天没有安排 ☕" else "", "打开 ›", deco) { a.push(CalendarPage(a, pushed = true)) }
    }
    /** 日历小图标（和小程序的装饰一样） */
    class CalDeco(ctx: Context, private val col: Int) : View(ctx) {
        private val pt = Paint(Paint.ANTI_ALIAS_FLAG)
        override fun onDraw(c: Canvas) {
            val d = resources.displayMetrics.density; val w = 4 * d
            pt.style = Paint.Style.STROKE; pt.strokeWidth = w; pt.color = col
            c.drawRoundRect(RectF(w / 2, 6 * d, width - w / 2, height - w / 2), 9 * d, 9 * d, pt)
            pt.style = Paint.Style.FILL; c.drawRect(w, 12 * d, width - w, 16 * d, pt)
        }
    }

    // 置顶通知（班级墙里置顶的那条，5 分钟拿一次）
    companion object { var pinFor = ""; var pinAt = 0L; var pins: List<JSONObject> = emptyList() }
    private fun loadPins() {
        val c = Store.cls ?: run { pins = emptyList(); return }
        if (!Store.feat("wall")) return
        if (pinFor != c.str("id") || System.currentTimeMillis() - pinAt > 300_000) {
            val cid = c.str("id"); if (pinFor != cid) pins = emptyList(); pinFor = cid; pinAt = System.currentTimeMillis()
            Bg.load({ (Api.rest("wall_posts?select=id,title,body,author_name,pinned_at,is_notice,hidden&class_id=eq.$cid&pinned_at=not.is.null&hidden=eq.false&order=pinned_at.desc&limit=1") as? JSONArray)?.objs() ?: emptyList() }) { l, _ ->
                if (l != null && l.map { it.opt("id") } != pins.map { it.opt("id") }) { pins = l; p.render() }
            }
        }
    }
    private fun pins(): View {
        val top = pins.firstOrNull()
        val v = ctx.row().apply { pad(16, 14); background = round(C.noteBg, dp(18).toFloat(), C.alpha(C.c("#e0a526"), 0.25f), dp(1)); springy(); tap { a.push(WallPage(a, top?.optLong("id") ?: 0)) } }
        v.addView(ctx.text("📌", 20f))
        val cc = ctx.col().apply { pad(12, 0, 0, 0) }
        if (top != null) {
            cc.addView(ctx.text((if (top.optBoolean("is_notice")) "置顶通知" else "班级墙置顶") + " · " + top.str("author_name"), 14f, C.text, BOLD, 1))
            cc.addView(ctx.text(if (top.str("title").isNotEmpty()) top.str("title") + "：" + top.str("body") else top.str("body"), 13f, C.sub, lines = 2).apply { margins(t = 2); setLineSpacing(0f, 1.25f) })
        } else { cc.addView(ctx.text("置顶通知", 14f, C.text, BOLD)); cc.addView(ctx.text("班级墙里置顶的内容会显示在这里", 12.5f, C.sub)) }
        v.addView(cc, LinearLayout.LayoutParams(0, WRAP, 1f))
        v.minimumHeight = 0
        return v
    }
    // 每日鼓励
    private fun encourage(s: Slot, A: Items.Agenda): View {
        val q = Enc.card(A.overdue.size, A.hwLeft); val m = Enc.mood()
        val r = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL; bg(C.card, 18, C.line); clipToOutline = true; elevation = dp(1).toFloat() }
        val img = FrameLayout(ctx).apply { background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(C.c(q.c1), C.c(q.c2))) }
        img.addView(ctx.text(q.emo, 30f).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(MATCH, MATCH))
        img.addView(View(ctx).apply { background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT, intArrayOf(C.alpha(C.card, 0f), C.card)) }, FrameLayout.LayoutParams(dp(30), MATCH, Gravity.END))
        r.addView(img, LinearLayout.LayoutParams(dp(66), MATCH))
        val b = ctx.col().apply { pad(8, 14, 14, 14) }
        val lr = ctx.row()
        lr.addView(ctx.text("🌱 每日一句", 12f, C.sub), LinearLayout.LayoutParams(0, WRAP, 1f))
        lr.addView(ctx.text("↻", 15f, C.sub).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(C.mutedBg) }; tap { v -> Enc.shift++; v.buzz(); v.animate().rotationBy(360f).setDuration(350).withEndAction { p.render() }.start() } }, LinearLayout.LayoutParams(dp(28), dp(28)))
        b.addView(lr)
        b.addView(ctx.text(q.zh, 15f, C.text, BOLD).apply { margins(t = 4); setLineSpacing(0f, 1.3f) })
        b.addView(ctx.text(q.en, 12f, C.sub).apply { margins(t = 2) })
        val mr = ctx.row().apply { margins(t = 8) }
        if (m.isEmpty()) b.add(ctx.text("今天心情怎么样？", 12f, C.sub), 8)
        if (m.isNotEmpty()) {
            val mo = Enc.MOODS.firstOrNull { it.first == m }
            mr.addView(ctx.text((mo?.second ?: "") + " " + Enc.reply(m), 12.5f, C.text), LinearLayout.LayoutParams(0, WRAP, 1f))
            mr.addView(ctx.text("改", 12.5f, C.accent, SEMI).apply { pad(8, 2); tap { Enc.setMood(null); p.render() } })
        } else {
            mr.margins(t = 4)
            for ((k, e, n) in Enc.MOODS) mr.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL
                addView(ctx.text(e, 17f).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(C.mutedBg) }
                tap { v -> v.buzz(); v.animate().scaleX(1.35f).scaleY(1.35f).setDuration(120).withEndAction { Enc.setMood(k); p.render() }.start() } }, LinearLayout.LayoutParams(dp(34), dp(34)))
                addView(ctx.text(n, 10f, C.sub, lines = 1).apply { gravity = Gravity.CENTER; margins(t = 2) }) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        b.addView(mr)
        r.addView(b, LinearLayout.LayoutParams(0, WRAP, 1f))
        r.minimumHeight = 0
        return r
    }
    // 规划 · 四象限
    private fun plan(s: Slot): View {
        val c = base().apply { springy(); tap { a.push(PlanPage(a)) } }
        val qs = Plan.quads(); val total = qs.sumOf { l -> l.count { !it.done } }
        val m = Plan.METHODS.first { it.id == Plan.cur() }
        head(c, "🎯 规划", (if (s.h > 1) "四象限" else m.name) + " · $total 件待办", if (m.id == "quad") "打开 ›" else m.name + " ›")
        val QC = listOf(C.c(if (C.dark) "#e8a18c" else "#bf6650"), C.accent, C.c(if (C.dark) "#d8c27a" else "#998245"), C.c("#73858a"))
        if (s.h > 1) {
            for (rI in 0..1) {
                val row = ctx.row().apply { gravity = Gravity.TOP; if (rI == 1) margins(t = 8) }
                for (k in 0..1) {
                    val i = rI * 2 + k; val list = qs[i].filter { !it.done }
                    val q = ctx.col().apply { pad(10, 9); background = round(C.alpha(QC[i], 0.07f), dp(12).toFloat(), C.alpha(QC[i], 0.22f), dp(1)) }
                    val qh = ctx.row()
                    qh.addView(ctx.text(Plan.QUADS[i].first, 12f, QC[i], BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
                    if (list.isNotEmpty()) qh.addView(ctx.text("${list.size}", 12f, QC[i], HEAVY))
                    q.addView(qh)
                    if (list.isEmpty()) q.addView(ctx.text(if (i == 0) "没有急事 👍" else "空", 12f, C.mutedText).apply { margins(t = 5) })
                    list.take(2).forEach { q.addView(ctx.text(it.title, 12.5f, C.text, lines = 1).apply { margins(t = 5) }) }
                    row.addView(q, LinearLayout.LayoutParams(0, MATCH, 1f).apply { if (k == 1) leftMargin = dp(8) })
                }
                c.addView(row, LinearLayout.LayoutParams(MATCH, WRAP))
            }
        } else {
            val row = ctx.row()
            for (i in 0..3) row.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; pad(4, 8); background = round(C.alpha(QC[i], 0.07f), dp(10).toFloat())
                addView(ctx.text("${qs[i].count { !it.done }}", 18f, QC[i], HEAVY)); addView(ctx.text(Plan.QUADS[i].first, 10.5f, C.sub, lines = 1)) }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) leftMargin = dp(6) })
            c.addView(row)
        }
        return c
    }
    // 本周进度环
    private fun rings(): View {
        val c = ctx.row().apply { pad(8, 16); bg(C.card, 18, C.line); elevation = dp(1).toFloat(); springy(); tap { a.selectTab(2) } }
        val green = if (C.dark) C.c("#82bea1") else C.c("#39856a")
        val rs = Growth.rings(C.red, C.accent, green).let { if (funo.optBoolean("habits", true)) it else it.take(2) }
        for (r in rs) c.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL
            addView(RingView(ctx, r.done, r.total, r.color), LinearLayout.LayoutParams(dp(62), dp(62)))
            addView(ctx.text(r.label, 12f, C.text, BOLD).apply { gravity = Gravity.CENTER; margins(t = 6) })
            addView(ctx.text("${r.done} / ${r.total}", 11f, C.sub).apply { gravity = Gravity.CENTER }) }, LinearLayout.LayoutParams(0, WRAP, 1f))
        c.minimumHeight = 0
        return c
    }
    // 云宠：能直接喂
    private fun farm(s: Slot): View {
        val st = Farm.state(); val left = Farm.left(); val lv = st.optInt("level", 1)
        val big = s.h >= 2
        val wide = s.w >= 3 && !big
        val c = (if (wide) ctx.row() else ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL }).apply { pad(14, 14); bg(C.card, 18, C.line); elevation = dp(1).toFloat(); springy(); tap { a.push(FarmPage(a)) } }
        val iv = ImageView(ctx).apply { setImageResource(a.resources.getIdentifier(Farm.img(st.str("pet"), lv), "drawable", com.laolao.classcalendar.R::class.java.`package`!!.name)) }
        c.addView(iv, LinearLayout.LayoutParams(dp(if (big) 110 else if (wide) 64 else 72), dp(if (big) 110 else if (wide) 64 else 72)))
        // 轻轻上下浮动，像活的
        iv.post { iv.animate().translationY(-dp(3).toFloat()).setDuration(1200).withEndAction(object : Runnable { var up = false; override fun run() { if (iv.isAttachedToWindow) { iv.animate().translationY(if (up) -dp(3).toFloat() else 0f).setDuration(1200).withEndAction(this).start(); up = !up } } }).start() }
        val t = ctx.col().apply { if (!wide) gravity = Gravity.CENTER_HORIZONTAL else pad(12, 0, 0, 0) }
        t.addView(ctx.text(st.str("name") + " Lv.$lv", 13.5f, C.text, BOLD, 1).apply { if (!wide) gravity = Gravity.CENTER })
        t.addView(ctx.text("💧 养料 $left" + if (left >= Farm.FEED_COST) " · 可以喂啦" else "", 11.5f, C.sub, lines = 1).apply { margins(t = 2); if (!wide) gravity = Gravity.CENTER })
        val can = left >= Farm.FEED_COST
        t.addView(ctx.text(if (can) "🥕 喂一下" else "去攒养料", 12f, if (can) Color.WHITE else C.accent, BOLD).apply { pad(10, 4); bg(if (can) C.accent else C.selected, 12); margins(t = 6)
            tap { if (!can) { a.push(FarmPage(a)); return@tap }
                val (ok, msg) = Farm.feed(false); a.toast(msg)
                if (ok) { iv.buzz(); iv.animate().scaleX(1.18f).scaleY(1.18f).setDuration(140).withEndAction { iv.animate().scaleX(1f).scaleY(1f).setDuration(220).setInterpolator(android.view.animation.OvershootInterpolator(3f)).withEndAction { p.render() }.start() }.start() }
            } }, LinearLayout.LayoutParams(WRAP, WRAP))
        c.addView(t, if (!wide) LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(4) } else LinearLayout.LayoutParams(0, WRAP, 1f))
        return c
    }
    // 快捷按钮（选哪些存在 home_quick_tools_v1，和网页、小程序同步）
    private class QDef(val k: String, val e: String, val t: String, val d: String, val on: () -> Boolean, val go: () -> Unit)
    private fun qdefs(): List<QDef> = listOf(
        QDef("cIngestBtn", "✨", "AI 整理", "整理班级群消息", { Store.cls != null && (Store.can("can_ingest") || Store.feat("ingest_local")) }) { a.push(IngestPage(a)) },
        QDef("cAddBtn", "📣", "发布事项", "发布班级作业与通知", { Store.can("can_edit") }) { a.push(EditPage(a, null, classMode = true)) },
        QDef("qMine", "✏️", "记一件事", "添加自己的待办", { true }) { a.push(EditPage(a, null)) },
        QDef("qPlan", "🎯", "时间管理", "四象限与学习规划", { funo.optBoolean("plan", true) }) { a.push(PlanPage(a)) },
        QDef("qIcs", "🔥", "打卡成长", "习惯与成长记录", { funo.optBoolean("habits", true) }) { a.selectTab(2) },
        QDef("qFarm", "🐣", "云宠农场", "养料与陪伴", { Farm.on() }) { a.push(FarmPage(a)) },
        QDef("qPomo", "🍅", "番茄专注", "开始一个专注时段", { funo.optBoolean("plan", true) }) { a.push(PlanPage(a)) },
        QDef("qCourse", "📚", "课程表", "查看自己的课程", { Store.feat("courses") }) { a.push(CoursePage(a)) },
        QDef("qPeople", "👥", "班级成员", "找到同学与老师", { Store.cls != null }) { a.push(PeoplePage(a)) },
        QDef("qCal", "📲", "加到日历", "订阅到手机日历", { true }) { a.push(FeedPage(a)) },
        QDef("t:rank", "🏆", "排行榜", "班级成长排行", { Store.cls != null && Store.feat("rank") }) { a.push(RankPage(a)) },
        QDef("t:meta", "🏅", "等级徽章", "经验、任务和徽章", { true }) { a.push(MetaPage(a)) },
        QDef("qWall", "💬", "班级墙", "班级通知与交流", { Store.cls != null && Store.feat("wall") }) { a.push(WallPage(a)) },
        QDef("qAsk", "💡", "问捞捞", "今天先做什么", { true }) { a.push(AskPage(a)) },
    )
    private val QDEFAULT = listOf("cIngestBtn", "cAddBtn", "qMine", "qPlan", "qIcs", "qFarm", "qPomo", "qCourse", "qPeople", "qCal")
    private fun picks(): List<String> = (Kv.get("home_quick_tools_v1") as? JSONArray)?.let { x -> (0 until x.length()).map { x.optString(it) } } ?: QDEFAULT
    private fun quick(): View {
        val c = base()
        val ps = picks()
        val list = qdefs().filter { it.k in ps && it.on() }
        val all = list.map { Triple(it.e, it.t, it.go) } + Triple("🧰", "全部工具") { a.selectTab(3) } + Triple("＋", "自选") { pickQuick() }
        var row: LinearLayout? = null
        all.forEachIndexed { i, (e, t, go) ->
            if (i % 4 == 0) { row = ctx.row(); c.addView(row, LinearLayout.LayoutParams(MATCH, WRAP).apply { if (i > 0) topMargin = dp(6) }) }
            row!!.addView(ctx.col().apply { gravity = Gravity.CENTER_HORIZONTAL; pad(2, 8); press(0, 14); tap { go() }
                addView(ctx.text(e, 20f, if (e == "＋") C.accent else C.text).apply { gravity = Gravity.CENTER; background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(if (e == "＋") C.selected else C.mutedBg) } }, LinearLayout.LayoutParams(dp(44), dp(44)))
                addView(ctx.text(t, 11.5f, C.text, lines = 1).apply { gravity = Gravity.CENTER; margins(t = 5) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f))
        }
        val rest = all.size % 4; if (rest > 0) repeat(4 - rest) { row!!.addView(View(ctx), LinearLayout.LayoutParams(0, 1, 1f)) }
        c.minimumHeight = 0
        return c
    }
    private fun pickQuick() {
        val defs = qdefs().filter { it.on() }; val sel = picks().toMutableSet()
        val c = ctx.col().apply { pad(20, 18, 20, 18) }
        lateinit var d: android.app.Dialog
        c.addView(ctx.text("自选首页工具", 18f, C.text, BOLD))
        c.addView(ctx.text("勾选首页常用入口，会同步到网页和小程序", 12.5f, C.sub).apply { margins(t = 2, b = 8) })
        for (q in defs) c.addView(Toggle(ctx, q.e + " " + q.t, q.d, q.k in sel) { on -> if (on) sel += q.k else sel -= q.k })
        val br = ctx.row().apply { margins(t = 12) }
        br.addView(ctx.button("恢复默认", C.mutedBg, C.sub) { Kv.set("home_quick_tools_v1", JSONArray(QDEFAULT)); d.dismiss(); p.render() }, LinearLayout.LayoutParams(0, dp(46), 1f))
        br.addView(ctx.button("保存") { Kv.set("home_quick_tools_v1", JSONArray((qdefs().map { it.k }).filter { it in sel })); d.dismiss(); p.render() }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { leftMargin = dp(10) })
        c.addView(br)
        d = Dialogs.show(ctx, android.widget.ScrollView(ctx).apply { addView(c) }, bottom = true)
    }
    // 今日打卡：直接点
    private fun habits(s: Slot): View {
        val c = base(); head(c, "🔥 今日打卡", "", "全部 ›") { a.selectTab(2) }
        val hs = Growth.habits()
        if (hs.isEmpty()) c.addView(ctx.text("还没有习惯，点「全部」去添加", 12.5f, C.sub).apply { tap { a.selectTab(2) } })
        for (h in hs.take(if (s.h >= 2) 5 else 2)) {
            val on = Growth.checked(h.id)
            val r = ctx.row().apply { pad(0, 6) }
            r.addView(ctx.text(h.icon + " " + h.name, 13.5f, C.text, lines = 1), LinearLayout.LayoutParams(0, WRAP, 1f))
            r.addView(ctx.text(if (on) "✓" else "打卡", 12f, if (on) Color.WHITE else C.accent, BOLD).apply { gravity = Gravity.CENTER; pad(10, 4); bg(if (on) C.green else C.selected, 12)
                tap { v -> v.buzz(); HabitPlace.toggle(a, h.id) { now -> if (now) Cheer.show(a, "habit", "连续 ${Growth.streak(h.id)} 天"); p.render() } } })
            c.addView(r)
        }
        return c
    }
    // 番茄钟：活的倒计时
    private fun pomo(): View {
        val c = base().apply { springy(); tap { a.push(PlanPage(a)) } }
        head(c, "🍅 番茄钟")
        val pm = Plan.pomo(); val (left, _) = Plan.left()
        val run = pm.mode == "focus" || pm.mode == "break" || pm.mode == "paused"
        val r = ctx.row()
        val clock = ctx.text(Plan.fmt(left), 26f, if (pm.mode == "focus") C.red else C.text, HEAVY)
        r.addView(clock, LinearLayout.LayoutParams(0, WRAP, 1f))
        r.addView(ctx.text(if (run) "查看" else "去专注", 12f, Color.WHITE, BOLD).apply { pad(10, 5); bg(C.red, 12) })
        c.addView(r)
        c.addView(ctx.text(when (pm.mode) { "focus" -> if (pm.task.isNotEmpty()) "专注：" + pm.task else "专注中"; "break" -> "休息一下"; "paused" -> "已暂停"; else -> if (Plan.today() > 0) "今天已完成 ${Plan.today()} 个番茄" else "专注 ${pm.len} 分钟" }, 11.5f, C.sub, lines = 1).apply { margins(t = 4) })
        if (pm.mode == "focus" || pm.mode == "break") clock.post(object : Runnable { override fun run() { if (!clock.isAttachedToWindow) return; clock.text = Plan.fmt(Plan.left().first); clock.postDelayed(this, 1000) } })
        return c
    }
    // 本周排行（前三名）
    private var rankData: JSONObject? = null; private var rankAt = 0L
    private fun rank(): View {
        val c = base().apply { springy(); tap { a.push(RankPage(a)) } }
        head(c, "🏆 本周排行", "", "全部 ›")
        val cls = Store.cls
        if (cls != null && System.currentTimeMillis() - rankAt > 300_000) { rankAt = System.currentTimeMillis()
            Bg.load({ Api.rpcObj("growth_board", jsonOf("cid" to cls.str("id"), "period" to "week")) }) { d, _ -> if (d != null) { rankData = d; p.render() } } }
        val rows = rankData?.optJSONArray("rows")?.objs() ?: emptyList()
        if (rankData == null) c.addView(ctx.text("加载中…", 12.5f, C.sub))
        else if (rows.isEmpty()) c.addView(ctx.text("这周还没人上榜，完成一项作业就能上榜！", 12.5f, C.sub))
        rows.take(3).forEachIndexed { i, r -> c.addView(ctx.row().apply { pad(0, 3); addView(ctx.text(listOf("🥇", "🥈", "🥉")[i] + " " + r.str("name"), 13f, C.text, lines = 1), LinearLayout.LayoutParams(0, WRAP, 1f)); addView(ctx.text("${r.optInt("points")}", 13f, C.text, BOLD)) }) }
        rows.firstOrNull { it.optBoolean("me") }?.let { if (it.optInt("rank") > 3) c.addView(ctx.text("我：第 ${it.optInt("rank")} 名 · ${it.optInt("points")}", 11.5f, C.sub).apply { margins(t = 4) }) }
        return c
    }
    // 今日课程
    private fun course(s: Slot): View {
        val c = base().apply { springy(); tap { a.push(CoursePage(a)) } }
        val wk = Courses.weekNow()
        head(c, "📚 今日课程", if (wk > 0) "第 $wk 周" else "")
        val l = Courses.on(T.todayKey()); val nowM = T.now().hour * 60 + T.now().minute
        if (!Courses.has()) c.addView(ctx.text("还没导入课程表，点这里导入", 12.5f, C.sub))
        else if (l.isEmpty()) c.addView(ctx.text("今天没课 🎉", 12.5f, C.sub))
        for (x in l.take(if (s.h >= 2) 6 else 3)) {
            val past = (x.m1 ?: 0) <= nowM; val on = (x.m0 ?: 9999) <= nowM && nowM < (x.m1 ?: 0)
            c.addView(ctx.row().apply { pad(8, 4); if (on) bg(C.selected, 8)
                addView(View(ctx).apply { bg(Courses.color(x.name), 2) }, LinearLayout.LayoutParams(dp(3), dp(16)))
                addView(ctx.text(x.name, 13f, if (past) C.mutedText else C.text, if (on) BOLD else null, 1).apply { pad(8, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
                addView(ctx.text(x.t0, 11.5f, C.sub))
                if (!x.evening) { press(if (on) C.selected else 0, 8); tap { CourseView.open(a, T.today(), x) } } })   // 6.9 点课程看课表截图
        }
        return c
    }
    // 等级
    private fun meta(): View {
        val c = base().apply { springy(); tap { a.push(MetaPage(a)) } }
        val s = Meta.stats()
        head(c, "🏅 Lv.${s.level} ${s.title}")
        val bx = FrameLayout(ctx).apply { bg(C.mutedBg, 4) }
        bx.addView(View(ctx).apply { bg(C.purple, 4) }, FrameLayout.LayoutParams(0, MATCH))
        c.addView(bx, LinearLayout.LayoutParams(MATCH, dp(8)))
        bx.post { bx.getChildAt(0).layoutParams = bx.getChildAt(0).layoutParams.apply { width = bx.width * s.pct / 100 }; bx.requestLayout() }
        c.addView(ctx.text("经验 ${s.exp - s.lo} / ${s.hi - s.lo}", 11.5f, C.sub).apply { margins(t = 6) })
        return c
    }
    // 网页「工具」放到首页的（t:growth 等）
    private fun toolCard(id: String): View {
        val (ic, n, go) = when (id) {
            "t:growth" -> Triple("📈", "成长") { a.selectTab(2) }; "t:plan" -> Triple("🎯", "规划") { a.push(PlanPage(a)) }
            "t:rank" -> Triple("🏆", "排行榜") { a.push(RankPage(a)) }; "t:farm" -> Triple("🐣", "云宠农场") { a.push(FarmPage(a)) }
            "t:meta" -> Triple("🏅", "等级与徽章") { a.push(MetaPage(a)) }; else -> Triple("🧩", "网页工具") { a.toast("这个工具在网页版里打开") }
        }
        return base().apply { gravity = Gravity.CENTER; springy(); tap { go() }; addView(ctx.text(ic, 26f)); addView(ctx.text(n, 13.5f, C.text, BOLD).apply { margins(t = 4) }) }
    }
}
