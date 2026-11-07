package com.laolao.classcalendar.ui

import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.str
import org.json.JSONObject

/**
 * 7.x 课堂互动（和小程序 1.28「课堂抢答与评分」、网页管理中心一样，7.41 SQL）：
 *  · 抢答：老师 / 班委发起（时长、前几名），同学点大圆按钮「抢」，按先后排名；发起人可以给抢到的人加成长值
 *  · 小组评分：组内（给同组的人）或组间（给别的组）1~5 星；老师 / 班委看平均分
 */
class ActPage(a: Main, tab0: String = "rush") : Page(a) {
    private lateinit var body: LinearLayout
    private var tab = if (tab0 == "peer") 1 else 0
    private var rs: JSONObject? = null; private var peers: List<JSONObject> = emptyList(); private var err = ""; private var loading = true
    private var on = false; private var hitting = false
    private var secI = 1; private var topI = 1
    private val SECS = listOf(30, 60, 120, 300); private val TOPS = listOf(1, 3, 5, 10)
    private val tick = Runnable { if (on) load(true) }
    override val autoRender = false
    override fun build(): View = scaffold("课堂互动", pull = { done -> load(false) { done() } }) { body = it }
    override fun onShow() { on = true; load(false) }
    override fun onHide() { on = false; Bg.main.removeCallbacks(tick) }
    private val cid get() = Store.cls?.str("id") ?: ""

    private fun nope(e: Throwable?) = Regex("rush_|peer_|PGRST202|Could not find").containsMatchIn(e?.message ?: "")
    private fun load(quiet: Boolean, done: (() -> Unit)? = null) {
        Bg.main.removeCallbacks(tick)
        if (cid.isEmpty()) { loading = false; err = "先加入一个班级"; render(); done?.invoke(); return }
        Bg.load({
            val r = Api.rpc("rush_state", jsonOf("p_cid" to cid)) as? JSONObject
            val p = if (tab == 1) Api.rpcArr("peer_todo", jsonOf("p_cid" to cid)).let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } else null
            Pair(r, p)
        }) { res, e ->
            done?.invoke(); loading = false
            if (res == null) { if (!quiet) err = if (nope(e)) "课堂互动暂时用不了（服务器还没开通 7.41）" else (e?.message ?: "加载失败") }
            else { err = ""; rs = res.first; res.second?.let { peers = it } }
            if (on) render()
            // 抢答进行中 1.5 秒刷一次名次；没在抢答时 4 秒看一次有没有新的
            if (on && tab == 0) Bg.main.postDelayed(tick, if (open()) 1500 else 4000)
        }
    }
    private fun open(): Boolean { val r = rs ?: return false; return !r.optBoolean("none") && r.optBoolean("open") && CK.ms(r.str("ends_at")) > System.currentTimeMillis() }
    private fun staff() = rs?.optBoolean("staff") == true

    override fun render() {
        view; keepScroll(body)
        body.addView(Seg(ctx, listOf("抢答", "小组评分"), tab) { tab = it; loading = true; render(); load(false) })
        if (loading && rs == null) { body.add(ctx.text("加载中…", 14f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 40) }, 0); return }
        if (err.isNotEmpty()) { body.add(ctx.text(err, 14f, C.red).apply { gravity = Gravity.CENTER; pad(0, 30) }, 0); return }
        if (tab == 0) rush() else peer()
    }

    // ---------- 抢答 ----------
    private fun rush() {
        val r = rs; val isOpen = open(); val st = staff()
        val c = ctx.card(18, 20).apply { margins(t = 12); gravity = Gravity.CENTER_HORIZONTAL }
        if (r != null && !r.optBoolean("none")) {
            val left = maxOf(0L, (CK.ms(r.str("ends_at")) - System.currentTimeMillis()) / 1000)
            c.addView(ctx.text(r.str("title").ifEmpty { "抢答" }, 18f, C.text, HEAVY, 2).apply { gravity = Gravity.CENTER })
            c.add(ctx.text(if (isOpen) "还剩 $left 秒 · 前 ${r.optInt("top_n")} 名" else "这次抢答已结束", 13f, if (isOpen) C.red else C.sub, SEMI), 4)
            val mine = r.optBoolean("mine")
            // 大圆按钮：抢
            val canHit = isOpen && !mine && (r.has("can_hit") && r.optBoolean("can_hit") || !st)
            if (isOpen) c.add(FrameLayout(ctx).apply {
                background = round(if (canHit) C.red else C.mutedBg, dp(64).toFloat())
                addView(ctx.text(if (mine) "已抢" else "抢", 34f, if (canHit) Color.WHITE else C.sub, HEAVY).apply { gravity = Gravity.CENTER }, FrameLayout.LayoutParams(MATCH, MATCH))
                if (canHit) tap { v -> hit(v) }
            }.also { it.layoutParams = LinearLayout.LayoutParams(dp(128), dp(128)) }, 16)
            val rows = r.optJSONArray("rows")?.let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } ?: emptyList()
            if (rows.isNotEmpty()) {
                c.add(ctx.text(if (st) "名次 · 点一行给加分" else "名次", 12.5f, C.sub, BOLD).apply { gravity = Gravity.START }, 16).layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(16) }
                val me = Api.uid
                rows.forEachIndexed { i, x ->
                    val top = i < r.optInt("top_n")
                    c.addView(ctx.row().apply {
                        gravity = Gravity.CENTER_VERTICAL; pad(6, 9); if (x.str("uid") == me) bg(C.selected, 10)
                        addView(ctx.text("${i + 1}", 15f, if (top) C.accent else C.sub, HEAVY), LinearLayout.LayoutParams(dp(30), WRAP))
                        addView(ctx.text(x.str("name"), 14.5f, C.text, SEMI, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
                        addView(ctx.text(String.format("%.1f 秒", x.optLong("ms") / 1000.0), 12.5f, C.sub))
                        if (x.optInt("points") > 0) addView(ctx.text("  +${x.optInt("points")}", 13f, C.c("#ff7a45"), BOLD))
                        if (st) tap { award(r.optLong("id"), x) }
                    }, LinearLayout.LayoutParams(MATCH, WRAP))
                }
            } else if (isOpen) c.add(ctx.text("还没有人抢", 13f, C.sub), 12)
            if (st && isOpen) c.add(ctx.text("提前结束", 14f, C.red, SEMI).apply { gravity = Gravity.CENTER; pad(16, 8); press(C.dangerBg, 14); tap { stop(r.optLong("id")) } }, 14)
        } else c.addView(ctx.text("现在没有抢答", 15f, C.sub).apply { gravity = Gravity.CENTER; pad(0, 10) })
        body.addView(c)
        // 发起（老师 / 班委，没有进行中的才能发）
        if (st && !isOpen) {
            body.addView(ctx.section("发起抢答"))
            val f = ctx.card(14, 18)
            val tIn = ctx.input("题目（选填）", "").apply { setSingleLine(true); filters = arrayOf(android.text.InputFilter.LengthFilter(40)) }
            f.addView(tIn)
            f.add(ctx.text("时长", 13f, C.sub, SEMI), 12)
            f.add(Seg(ctx, SECS.map { if (it < 60) "$it 秒" else "${it / 60} 分钟" }, secI) { secI = it }, 6)
            f.add(ctx.text("前几名算抢到", 13f, C.sub, SEMI), 12)
            f.add(Seg(ctx, TOPS.map { "前 $it 名" }, topI) { topI = it }, 6)
            f.add(ctx.button("开始抢答") {
                val t = tIn.text.toString().trim()
                Bg.load({ Api.rpc("rush_start", jsonOf("p_cid" to cid, "p_title" to (t.ifEmpty { null }), "p_secs" to SECS[secI], "p_top" to TOPS[topI])) }) { _, e ->
                    if (e != null) Dialogs.alert(ctx, "发起失败", if (nope(e)) "抢答暂时用不了" else e.message ?: "") else { Dialogs.hideKeyboard(tIn); a.toast("开始了，同学手机上会弹出提醒"); load(true) }
                }
            }, 14)
            body.addView(f)
        }
    }
    private fun hit(v: View) {
        val r = rs ?: return; if (hitting) return; hitting = true; v.buzz()
        v.animate().scaleX(0.9f).scaleY(0.9f).setDuration(80).withEndAction { v.animate().scaleX(1f).scaleY(1f).setDuration(160).start() }.start()
        Bg.load({ Api.rpcObj("rush_hit", jsonOf("p_id" to r.optLong("id"))) }) { x, e ->
            hitting = false
            when { e != null -> a.toast(e.message ?: "没抢上"); x?.optBoolean("ok") == false -> a.toast(x.str("why")); else -> a.toast("抢到了，第 ${x?.optInt("rank")} 名" + if (x?.optBoolean("top") == true) " 🎉" else "") }
            load(true)
        }
    }
    private fun stop(id: Long) = Bg.load({ Api.rpc("rush_close", jsonOf("p_id" to id)) }) { _, e -> if (e != null) a.toast(e.message ?: "") else load(true) }
    private fun award(id: Long, x: JSONObject) {
        val opts = listOf(0, 1, 2, 3, 5, 10)
        Dialogs.sheet(ctx, "给「${x.str("name")}」加成长值", opts.map { if (it == 0) "不加分" else "加 $it 成长值" }) { i ->
            Bg.load({ Api.rpc("rush_award", jsonOf("p_id" to id, "p_uid" to x.str("uid"), "p_points" to opts[i])) }) { _, e -> if (e != null) a.toast(e.message ?: "") else { a.toast(if (opts[i] > 0) "已加 ${opts[i]}" else "已取消加分"); load(true) } }
        }
    }

    // ---------- 小组评分 ----------
    private fun peer() {
        val st = staff()
        if (st) body.add(ctx.text("＋ 发起小组评分", 14.5f, C.accent, BOLD).apply { gravity = Gravity.CENTER; pad(0, 12); press(C.selected, 14); tap { peerStart() } }, 12)
        if (peers.isEmpty()) { body.add(ctx.empty("👥", "最近没有小组评分", if (st) "点上面发起一个" else "老师或班委发起后会出现在这里"), 12); return }
        for (r in peers) {
            val isOpen = r.optBoolean("open")
            val c = ctx.card(14, 18).apply { margins(t = 12) }
            c.addView(ctx.row().apply {
                gravity = Gravity.CENTER_VERTICAL
                addView(ctx.text(r.str("title"), 15.5f, C.text, BOLD, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
                addView(ctx.chip(if (r.str("kind") == "cross") "组间" else "组内", C.accent, C.selected, 11.5f))
            })
            val end = CK.ms(r.str("ends_at")).let { java.util.Calendar.getInstance().apply { timeInMillis = it } }
            c.add(ctx.text(if (isOpen) "${end.get(java.util.Calendar.MONTH) + 1}月${end.get(java.util.Calendar.DAY_OF_MONTH)}日截止 · 点星星打分" else "已结束", 12f, C.sub), 3)
            val ts = r.optJSONArray("targets")?.let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } ?: emptyList()
            if (ts.isEmpty()) c.add(ctx.text(if (r.str("kind") == "cross") "没有别的小组可以评" else "你还不在小组里，或者组里只有你", 13f, C.sub), 8)
            for (t in ts) {
                val sc = t.optInt("score")
                c.add(ctx.row().apply {
                    gravity = Gravity.CENTER_VERTICAL
                    addView(ctx.text(t.str("name"), 14.5f, C.text, SEMI, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
                    for (n in 1..5) addView(ctx.text(if (n <= sc) "★" else "☆", 22f, if (n <= sc) C.c("#f5a623") else C.mutedText).apply {
                        gravity = Gravity.CENTER; if (isOpen) tap { v -> v.buzz(); rate(r.optLong("id"), t.str("id"), n) }
                    }, LinearLayout.LayoutParams(dp(32), dp(36)))
                }, 6)
            }
            if (st) c.add(ctx.text("看结果 ›", 13.5f, C.accent, SEMI).apply { pad(0, 6); tap { result(r.optLong("id")) } }, 8)
            body.addView(c)
        }
    }
    private fun rate(rid: Long, target: String, s: Int) = Bg.load({ Api.rpcObj("peer_rate", jsonOf("p_rid" to rid, "p_target" to target, "p_score" to s, "p_comment" to null)) }) { _, e -> if (e != null) a.toast(e.message ?: "") else load(true) }
    private fun peerStart() {
        Dialogs.sheet(ctx, "怎么评", listOf("组内评分（给同组的组员打分）", "组间评分（给别的小组打分）")) { k ->
            val names = listOf("小组合作评分", "小组展示评分", "小组作业评分", "课堂讨论评分")
            Dialogs.sheet(ctx, "评什么", names) { ni ->
                Dialogs.sheet(ctx, "多久内评完", listOf("1 天", "3 天", "7 天")) { di ->
                    Bg.load({ Api.rpc("peer_start", jsonOf("p_cid" to cid, "p_title" to names[ni], "p_kind" to if (k == 1) "cross" else "in", "p_days" to listOf(1, 3, 7)[di])) }) { _, e ->
                        if (e != null) Dialogs.alert(ctx, "发起失败", if (nope(e)) "小组评分暂时用不了" else e.message ?: "") else { a.toast("已发起"); load(true) }
                    }
                }
            }
        }
    }
    private fun result(rid: Long) = Bg.load({ Api.rpcObj("peer_result", jsonOf("p_rid" to rid)) }) { r, e ->
        if (r == null) { a.toast(e?.message ?: "打不开"); return@load }
        val box = ctx.col().apply { pad(20, 18, 20, 20) }
        box.addView(ctx.text(r.str("title"), 18f, C.text, HEAVY))
        box.add(ctx.text("${r.optInt("raters")} 人参与", 12.5f, C.sub), 2)
        val rows = r.optJSONArray("rows")?.let { arr -> (0 until arr.length()).map { arr.getJSONObject(it) } } ?: emptyList()
        if (rows.isEmpty()) box.add(ctx.text("还没有人评", 13.5f, C.sub), 12)
        val list = ctx.col()
        for (x in rows) list.add(ctx.row().apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(ctx.text(x.str("name").ifEmpty { "（已退出）" }, 14.5f, C.text, SEMI, 1), LinearLayout.LayoutParams(0, WRAP, 1f))
            addView(ctx.text("${x.opt("avg")} ★", 14.5f, C.c("#f5a623"), BOLD))
            addView(ctx.text("  ${x.optInt("n")} 人评", 12f, C.sub))
        }, 10)
        box.add(android.widget.ScrollView(ctx).apply { addView(list) }, 8)
        Dialogs.show(ctx, box, bottom = true)
    }
}
