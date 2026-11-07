package com.laolao.classcalendar.ui

import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Store
import org.json.JSONArray

/**
 * 7.x 首页右下角「＋」放哪些入口（和小程序 1.22 fabcfg.js 一样，同一个 fab_cfg_v1，只存这台手机）：
 * 「＋」只管新建（记事、发布、整理群消息、写备忘录、导入……）；打卡、专注、签到、课表、日历这些常用入口在侧边栏里。
 * 在「我的 → 设置 → 首页快捷菜单」里勾选、排顺序，最多 8 个。
 */
object FabCfg {
    private const val LS = "fab_cfg_v1"
    const val MAX = 8
    class Opt(val k: String, val icon: String, val title: String, val ok: () -> Boolean, val go: (Main) -> Unit)
    private val ALL = listOf(
        Opt("mine", "✏️", "记一件事", { true }) { a -> a.push(EditPage(a, null)) },
        Opt("quick", "💬", "一句话记事", { true }) { a -> QuickAdd.open(a) },
        Opt("pub", "📢", "发布班级事项", { Store.can("can_edit") }) { a -> a.push(EditPage(a, null, classMode = true)) },
        Opt("ingest", "✨", "整理群消息", { Store.cls != null && (Store.can("can_ingest") || Store.feat("ingest_local")) }) { a -> a.push(IngestPage(a)) },
        Opt("wall", "📌", "发到班级墙", { Store.cls != null && Store.feat("wall") }) { a -> a.push(WallPage(a)) },
        Opt("note", "📒", "写备忘录", { true }) { a -> a.push(NotePage(a, null)) },
        Opt("courseimp", "📷", "拍课表导入", { Store.feat("courses") }) { a -> a.push(CourseImportPage(a)) },
        Opt("memo", "📋", "导入备忘录 / 聊天记录", { true }) { a -> a.push(MemoPage(a, "")) },
    )
    private val DEF = listOf("mine", "quick", "pub", "ingest", "note")
    private fun safe(f: () -> Boolean) = try { f() } catch (_: Exception) { false }

    /** 现在选了哪些（按顺序）；没设置过用默认 */
    fun keys(): List<String> {
        val a = Kv.get(LS) as? JSONArray ?: return DEF
        return (0 until a.length()).map { a.optString(it) }.filter { k -> ALL.any { it.k == k } }
    }
    fun save(l: List<String>) = Kv.setQuiet(LS, JSONArray(l.take(MAX)))
    /** 「＋」里实际显示的（当前账号用不了的自动不显示） */
    fun items(a: Main): List<FabItem> = keys().mapNotNull { k -> ALL.firstOrNull { it.k == k && safe(it.ok) } }.map { o -> FabItem(o.icon, o.title) { o.go(a) } }
    fun all(): List<Opt> = ALL.filter { safe(it.ok) }
    fun reset() = Kv.setQuiet(LS, null)
}

/** 设置 → 首页快捷菜单：上面是选中的（可以调顺序），下面是还能加的 */
class FabCfgPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    override fun build(): View = scaffold("首页快捷菜单", ctx.text("恢复默认", 13f, C.accent, SEMI).apply { pad(12, 8); tap { FabCfg.reset(); render(); a.toast("已恢复默认") } }) { body = it }
    override fun render() {
        body.removeAllViews()
        val sel = FabCfg.keys().toMutableList()
        val all = FabCfg.all()
        body.addView(ctx.text("首页右下角「＋」用来新建东西，点开后显示哪些入口，最多 ${FabCfg.MAX} 个。打卡、专注、签到、课表这些常用入口在侧边栏里（从左边缘往右滑）。只存在这台手机上。", 13f, C.sub).apply { setLineSpacing(0f, 1.3f); pad(4, 0, 4, 4) })
        body.addView(ctx.section("已选 ${sel.size} 个", "点 ↑ ↓ 调顺序，点 − 去掉"))
        val c1 = ctx.card(4, 18)
        sel.forEachIndexed { i, k ->
            val o = all.firstOrNull { it.k == k } ?: return@forEachIndexed
            if (c1.childCount > 0) c1.addView(ctx.hline())
            c1.addView(ctx.row().apply {
                gravity = Gravity.CENTER_VERTICAL; pad(12, 10)
                addView(Ic.tile(ctx, o.icon, 32), LinearLayout.LayoutParams(dp(32), dp(32)))
                addView(ctx.text(o.title, 15f, C.text, SEMI, 1).apply { pad(12, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
                fun btn(t: String, on: Boolean, fn: () -> Unit) = addView(ctx.text(t, 16f, if (on) C.text else C.mutedText, BOLD).apply { gravity = Gravity.CENTER; if (on) { press(C.mutedBg, 10); tap { fn(); FabCfg.save(sel); render() } } }, LinearLayout.LayoutParams(dp(34), dp(34)).apply { leftMargin = dp(4) })
                btn("↑", i > 0) { sel.removeAt(i); sel.add(i - 1, k) }
                btn("↓", i < sel.size - 1) { sel.removeAt(i); sel.add(i + 1, k) }
                btn("−", true) { sel.removeAt(i) }
            })
        }
        if (c1.childCount == 0) c1.addView(ctx.text("一个都没选，「＋」点开会是空的", 13.5f, C.sub).apply { pad(14, 14) })
        body.addView(c1)
        val rest = all.filter { it.k !in sel }
        if (rest.isNotEmpty()) {
            body.addView(ctx.section("还能加的", if (sel.size >= FabCfg.MAX) "已经 ${FabCfg.MAX} 个了，先去掉一个" else "点 ＋ 加进去"))
            val c2 = ctx.card(4, 18)
            rest.forEach { o ->
                if (c2.childCount > 0) c2.addView(ctx.hline())
                c2.addView(ctx.row().apply {
                    gravity = Gravity.CENTER_VERTICAL; pad(12, 10)
                    addView(Ic.tile(ctx, o.icon, 32), LinearLayout.LayoutParams(dp(32), dp(32)))
                    addView(ctx.text(o.title, 15f, C.text, lines = 1).apply { pad(12, 0) }, LinearLayout.LayoutParams(0, WRAP, 1f))
                    val can = sel.size < FabCfg.MAX
                    addView(ctx.text("＋", 16f, if (can) C.accent else C.mutedText, BOLD).apply { gravity = Gravity.CENTER; if (can) { press(C.selected, 10); tap { sel += o.k; FabCfg.save(sel); render() } } }, LinearLayout.LayoutParams(dp(34), dp(34)))
                })
            }
            body.addView(c2)
        }
    }
}
