package com.laolao.classcalendar.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Cfg
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.jsonOf
import com.laolao.classcalendar.core.str
import org.json.JSONObject

/** 我的班级：切换、加入（班级码）、退出；老师：创建班级、复制班级码 */
class ClassPage(a: Main) : Page(a) {
    private lateinit var body: LinearLayout
    private var busy = false
    private val w get() = if (Store.work()) "团队" else "班级"
    override val autoRender = false

    override fun build(): View = scaffold("我的$w", pull = { done -> a.refreshSoon(force = true) { done(); render() } }) { body = it }

    override fun render() {
        view
        keepScroll(body)
        // 加入
        val jc = ctx.card(18, 20)
        jc.addView(ctx.text("加入$w", 17f, C.text, BOLD))
        jc.addView(ctx.text("问老师或班委要 6 位${w}码，申请后等老师批准", 13f, C.sub).apply { margins(t = 4) })
        val r = ctx.row().apply { margins(t = 12) }
        val code = ctx.input("比如 A3K9QZ").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS
            filters = arrayOf(InputFilter.LengthFilter(6), InputFilter.AllCaps()); textSize = 18f; letterSpacing = 0.2f
        }
        r.addView(code, LinearLayout.LayoutParams(0, WRAP, 1f))
        r.addView(ctx.text("加入", 15f, android.graphics.Color.WHITE, BOLD).apply {
            gravity = Gravity.CENTER; press(C.accent, 12); pad(18, 0)
            tap { join(code.text.toString()) }
        }, LinearLayout.LayoutParams(WRAP, dp(48)).apply { leftMargin = dp(10) })
        jc.addView(r)
        body.addView(jc)

        if (Store.pending.isNotEmpty()) {
            body.addView(ctx.section("等待批准"))
            val pc = ctx.card(4, 18)
            Store.pending.forEach { c -> pc.addView(ctx.cell("⏳", c.str("name"), "已申请，等老师批准", "撤回") { leave(c, true) }) }
            body.addView(pc)
        }

        body.addView(ctx.section("已加入", if (Store.classes.isEmpty()) "" else "点一下切换到这个$w"))
        if (Store.classes.isEmpty()) body.addView(ctx.empty("🏫", "还没有$w", "输入${w}码加入，或者老师在下面创建一个"))
        else {
            val lc = ctx.card(4, 18)
            Store.classes.forEachIndexed { i, c ->
                if (i > 0) lc.addView(ctx.hline())
                val cur = c.str("id") == Store.cls?.str("id")
                val role = if (c.optBoolean("is_teacher")) "管理者" else if (c.str("member_role") == "monitor") "班委" else "成员"
                val desc = role + if (c.optBoolean("is_teacher") && c.str("code").isNotEmpty()) " · ${w}码 ${c.str("code")}" else ""
                lc.addView(ctx.cell(if (cur) "✅" else "🏫", c.str("name"), desc, if (cur) "当前" else "›") { more(c) })
            }
            body.addView(lc)
        }

        if (Store.me?.str("role") == "teacher" || Store.me?.str("role") == "admin" || Store.classes.any { it.optBoolean("is_teacher") }) {
            body.addView(ctx.section("创建$w", "老师、负责人用"))
            val cc = ctx.card(18, 20)
            val nm = ctx.input("${w}名称，比如 计科2501")
            cc.addView(nm)
            cc.add(ctx.button("创建") { create(nm.text.toString()) }, 12)
            cc.add(ctx.text("创建后点上面的班级 →「管理这个班级」可以审批同学、任命班委（分组请在网页上操作）", 12.5f, C.sub), 10)
            body.addView(cc)
        }
    }

    private fun join(raw: String) {
        val code = raw.trim().uppercase()
        if (!Regex("^[A-Z0-9]{6}$").matches(code)) { a.toast("班级码是 6 位字母或数字"); return }
        if (busy) return; busy = true
        Bg.load({ Store.join(code) }) { r, e ->
            busy = false
            if (e != null) { a.toast(e.message ?: "加入失败"); return@load }
            val name = r?.str("class_name") ?: ""
            if (r?.str("status") == "approved") a.toast("你已经在「$name」里了")
            else Dialogs.alert(ctx, "申请已提交 ✉️", "已申请加入「$name」，等老师批准后首页就能看到班级的作业和通知。\n\n批准前可以先用「记一件事」记自己的待办。")
            render()
        }
    }

    private fun more(c: JSONObject) {
        val opts = mutableListOf<String>()
        val cur = c.str("id") == Store.cls?.str("id")
        if (!cur) opts += "切换到这个$w"
        if (c.optBoolean("is_teacher")) opts += "管理这个$w（审批、班委、功能开关）"
        if (c.optBoolean("is_teacher") && c.str("code").isNotEmpty()) { opts += "复制${w}码 ${c.str("code")}"; opts += "复制邀请语（发到群里）" }
        opts += "成员名单"
        if (!c.optBoolean("is_teacher")) opts += "退出$w"
        Dialogs.sheet(ctx, c.str("name"), opts, danger = setOf(opts.size - 1).filter { opts.last().startsWith("退出") }.toSet()) { i ->
            val o = opts[i]
            when {
                o.startsWith("管理") -> a.push(ClassManagePage(a, c.str("id")))
                o.startsWith("切换") -> Bg.load({ Store.switchClass(c.str("id")) }) { _, e -> if (e != null) a.toast(e.message ?: "") else { a.toast("已切换到「${c.str("name")}」"); close() } }
                o.startsWith("复制邀请") -> copy("请用「捞捞课程表」加入「${c.str("name")}」：下载安卓 App 或打开微信小程序 / 网页版注册（选“学生”，填真实姓名），在「我的 → 班级」输入班级码 ${c.str("code")} 申请加入。", "邀请语已复制，发到班群就行")
                o.startsWith("复制") -> copy(c.str("code"), "班级码 ${c.str("code")} 已复制")
                o == "成员名单" -> Bg.load({ Api.rpcArr("class_roster", jsonOf("cid" to c.str("id"))) }) { r, e ->
                    if (r == null) { a.toast(e?.message ?: "看不了成员名单"); return@load }
                    val names = (0 until r.length()).mapNotNull { r.optJSONObject(it) }.map { it.str("name") + if (it.str("member_role") == "monitor") "（班委）" else "" }
                    Dialogs.alert(ctx, "${names.size} 人", names.joinToString("、"))
                }
                o.startsWith("退出") -> leave(c, false)
            }
        }
    }
    private fun copy(s: String, msg: String) {
        (ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("laolao", s)); a.toast(msg)
    }
    private fun leave(c: JSONObject, pending: Boolean) {
        Dialogs.confirm(ctx, if (pending) "撤回申请？" else "退出「${c.str("name")}」？", if (pending) "" else "退出后就看不到这个${w}的事项了。", if (pending) "撤回" else "退出", danger = true) {
            Bg.load({
                Api.rest("class_members?class_id=eq.${c.str("id")}&user_id=eq.${Api.uid}", "DELETE")
                Store.refresh()
            }) { _, e -> if (e != null) a.toast("没成功：" + e.message) else { a.toast(if (pending) "已撤回申请" else "已退出"); render() } }
        }
    }
    private fun create(name0: String) {
        val name = name0.trim()
        if (name.isEmpty()) { a.toast("先写一下名称，比如 计科2501"); return }
        if (busy) return; busy = true
        Bg.load({ val r = Api.rpcObj("create_class", jsonOf("cname" to name)); Store.refresh(); if (r.str("id").isNotEmpty()) Store.switchClass(r.str("id")); r }) { r, e ->
            busy = false
            if (e != null || r == null) { a.toast("创建失败：" + (e?.message ?: "")); return@load }
            Dialogs.alert(ctx, "「${r.str("name").ifEmpty { name }}」创建好了 🎉", "班级码是 ${r.str("code")}。\n\n把班级码发给同学，他们申请后，在「我的 → 管理这个班级」里批准就行。")
            render()
        }
    }
}
