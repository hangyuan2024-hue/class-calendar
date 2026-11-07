package com.laolao.classcalendar.ui

import android.graphics.drawable.GradientDrawable
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Cfg
import com.laolao.classcalendar.core.Net
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.jsonOf

/** 登录 / 注册（和网页、小程序同一个账号） */
class LoginPage(a: Main) : Page(a) {
    private var signup = false
    private var busy = false
    private var teacher = false
    private var gender = ""
    private var orgType = ""
    private lateinit var form: LinearLayout
    private lateinit var title: TextView
    private lateinit var subtitle: TextView
    private lateinit var msg: TextView
    private lateinit var btn: TextView
    private val acct by lazy { ctx.input("学号或自己起的账号").apply { inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD } }
    private val pw by lazy { ctx.input("密码", type = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD) }
    private val name by lazy { ctx.input("真实姓名，方便老师审批入班") }
    private val orgName by lazy { ctx.input("学校或单位名称（选填）") }
    private lateinit var accHint: TextView
    private var accSeq = 0

    override fun build(): View {
        val sv = ScrollView(ctx).apply { isFillViewport = true; setBackgroundColor(C.bg) }
        val c = ctx.col().apply { pad(22, 30, 22, 30) }
        sv.addView(c)

        // ---- 上面：捞捞 + 欢迎 ----
        val top = ctx.row().apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(ImageView(ctx).apply { setImageResource(R.drawable.logo_w); setPadding(dp(7), dp(7), dp(7), dp(7)); bg(C.accent, 12) }, LinearLayout.LayoutParams(dp(38), dp(38)))
        top.addView(ctx.text("捞捞课程表", 18f, C.text, HEAVY).apply { pad(10, 0) })
        c.addView(top)
        c.addView(ctx.text("WELCOME TO YOUR CAMPUS", 11.5f, C.sub, SEMI).apply { letterSpacing = 0.12f; margins(t = 26) })
        val hero = ctx.row().apply { gravity = Gravity.BOTTOM }
        val ht = ctx.col()
        ht.addView(ctx.text("你的校园，", 30f, C.text, HEAVY))
        ht.addView(ctx.text("从这里继续", 30f, C.accent, HEAVY))
        hero.addView(ht, LinearLayout.LayoutParams(0, WRAP, 1f))
        hero.addView(ImageView(ctx).apply { setImageResource(R.drawable.mascot); rotation = 8f }, LinearLayout.LayoutParams(dp(92), dp(92)))
        c.addView(hero.apply { margins(t = 6) })
        val feats = ctx.row().apply { margins(t = 12) }
        feats.addView(ctx.chip("↗ 课程与待办在一起", C.accent, C.selected, 12.5f).apply { pad(10, 5) })
        feats.addView(ctx.chip("✓ 手机电脑同步", C.green, C.mint, 12.5f).apply { pad(10, 5) }, LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(8) })
        c.addView(feats)

        // ---- 卡片：登录 / 注册 ----
        val card = ctx.card(20, 24).apply { margins(t = 24) }
        title = ctx.text("欢迎回来 👋", 21f, C.text, HEAVY)
        subtitle = ctx.text("登录后查看你的捞捞课程表", 13.5f, C.sub).apply { margins(t = 4) }
        card.addView(title); card.addView(subtitle)
        card.addView(Seg(ctx, listOf("登录", "注册新账号"), 0) { i -> signup = i == 1; paint() }.apply { margins(t = 16) })
        form = ctx.col()
        card.addView(form)
        msg = ctx.text("", 13.5f, C.red).apply { visibility = View.GONE; margins(t = 10) }
        card.addView(msg)
        btn = ctx.button("登录") { submit() }.apply { margins(t = 16) } as TextView
        card.addView(btn)
        card.addView(ctx.text("和网站、微信小程序用同一个账号，数据自动同步", 12f, C.sub).apply { gravity = Gravity.CENTER; margins(t = 12) })
        c.addView(card)
        c.addView(ctx.text("忘记密码？", 13f, C.accent, SEMI).apply {
            gravity = Gravity.CENTER; pad(10); margins(t = 8)
            tap { Dialogs.alert(ctx, "忘记密码", "请找老师或班委在「班级管理」里帮你重置密码；如果绑定过微信，也可以在微信小程序里用微信登录后修改密码。") }
        })
        c.addView(ctx.text("连不上？网络检测", 13f, C.sub, SEMI).apply { gravity = Gravity.CENTER; pad(10); tap { a.push(NetCheckPage(a)) } })
        accHint = ctx.text("", 12f, C.sub).apply { visibility = View.GONE; margins(t = 4) }
        acct.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun afterTextChanged(s: Editable?) { checkAccount() }
        })
        pw.setOnEditorActionListener { _, _, _ -> submit(); true }
        paint()
        return sv
    }

    private fun label(t: String, opt: Boolean = false): View = ctx.row().apply {
        margins(t = 14, b = 6)
        addView(ctx.text(t, 13f, C.text, SEMI))
        if (opt) addView(ctx.chip("选填", C.sub, C.mutedBg, 10.5f), LinearLayout.LayoutParams(WRAP, WRAP).apply { leftMargin = dp(6) })
    }
    private fun picks(opts: List<Pair<String, String>>, sel: () -> Int, pick: (Int) -> Unit): LinearLayout {
        val r = ctx.row()
        fun draw() {
            for (i in 0 until r.childCount) {
                val v = r.getChildAt(i) as LinearLayout; val on = i == sel()
                v.background = GradientDrawable().apply { setColor(if (on) C.selected else C.mutedBg); cornerRadius = dp(14).toFloat(); setStroke(dp(if (on) 2 else 1), if (on) C.accent else C.line) }
                (v.getChildAt(0) as TextView).setTextColor(if (on) C.accent else C.text)
            }
        }
        opts.forEachIndexed { i, (t, s) ->
            val v = ctx.col().apply { pad(12, 10); gravity = Gravity.CENTER_HORIZONTAL; tap { pick(i); draw() } }
            v.addView(ctx.text(t, 15f, C.text, BOLD))
            if (s.isNotEmpty()) v.addView(ctx.text(s, 11.5f, C.sub).apply { margins(t = 2) })
            r.addView(v, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) leftMargin = dp(10) })
        }
        draw()
        return r
    }

    private fun paint() {
        title.text = if (signup) "创建你的账号 ✨" else "欢迎回来 👋"
        subtitle.text = if (signup) "一分钟搞定，账号不需要邮箱和手机号" else "登录后查看你的捞捞课程表"
        btn.text = if (signup) "注册并登录" else "登录"
        msg.visibility = View.GONE
        form.removeAllViews()
        listOf<View>(acct, pw, name, orgName, accHint).forEach { (it.parent as? LinearLayout)?.removeView(it) }
        if (signup) {
            form.addView(label("身份"))
            form.addView(picks(listOf("学生" to "输入班级码入班", "老师" to "创建班级、任命班委"), { if (teacher) 1 else 0 }) { teacher = it == 1; name.hint = if (teacher) "真实姓名，学生能看到" else "真实姓名，方便老师审批入班" })
            form.addView(label("我是"))
            form.addView(picks(listOf("男生" to "", "女生" to ""), { when (gender) { "m" -> 0; "f" -> 1; else -> -1 } }) { gender = if (it == 0) "m" else "f" })
            form.addView(label("姓名")); form.addView(name)
            form.addView(label("学校 / 单位", true))
            val types = listOf("university" to "大学", "college" to "大专", "high" to "高中", "middle" to "初中", "primary" to "小学", "work" to "职场", "personal" to "个人")
            val chips = ctx.row()
            val hs = android.widget.HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false; addView(chips) }
            fun drawChips() { for (i in 0 until chips.childCount) { val on = types[i].first == orgType; (chips.getChildAt(i) as TextView).apply { setTextColor(if (on) C.accent else C.sub); bg(if (on) C.selected else C.mutedBg, 14, if (on) C.accent else 0) } } }
            types.forEach { (k, t) -> chips.addView(ctx.text(t, 13.5f, C.sub, SEMI).apply { pad(14, 7); tap { orgType = if (orgType == k) "" else k; drawChips() } }, LinearLayout.LayoutParams(WRAP, WRAP).apply { rightMargin = dp(8) }) }
            drawChips()
            form.addView(hs); form.addView(orgName.apply { margins(t = 8) })
        }
        form.addView(label("账号")); form.addView(acct); form.addView(accHint)
        form.addView(label("密码")); form.addView(pw)
        pw.hint = if (signup) "至少 8 位，字母 + 数字更安全" else "密码"
        checkAccount()
    }

    /** 注册时：账号有没有被用过 */
    private fun checkAccount() {
        if (!::accHint.isInitialized) return
        val v = acct.text.toString().trim().lowercase()
        if (!signup || v.isEmpty()) { accHint.visibility = View.GONE; return }
        accHint.visibility = View.VISIBLE
        if (!Api.ACCOUNT_RE.matches(v)) { accHint.text = "3~20 位小写字母、数字或下划线"; accHint.setTextColor(C.red); return }
        accHint.text = "正在检查有没有被注册…"; accHint.setTextColor(C.sub)
        val seq = ++accSeq
        Bg.main.postDelayed({
            if (seq != accSeq) return@postDelayed
            Bg.load({ Api.rpc("account_available", jsonOf("acct" to v)) }) { r, e ->
                if (seq != accSeq) return@load
                when { e != null -> { accHint.text = "格式没问题"; accHint.setTextColor(C.sub) }
                    r == false -> { accHint.text = "这个账号已经被注册了。换一个，或者直接登录"; accHint.setTextColor(C.red) }
                    else -> { accHint.text = "✓ 这个账号可以用"; accHint.setTextColor(C.green) } }
            }
        }, 450)
    }

    private fun fail(s: String) { msg.text = s; msg.visibility = View.VISIBLE }

    private fun submit() {
        if (busy) return
        val ac = acct.text.toString(); val p = pw.text.toString()
        if (ac.isBlank()) return fail("请填写账号")
        if (p.isEmpty()) return fail("请填写密码")
        if (signup && name.text.isBlank()) return fail("请填写姓名")
        if (signup && gender.isEmpty()) return fail("请选择男生或女生")
        Dialogs.hideKeyboard(btn)
        busy = true; btn.text = if (signup) "正在注册…" else "正在登录…"; btn.alpha = 0.7f; msg.visibility = View.GONE
        Bg.load({
            if (signup) Api.signUp(ac, p, name.text.toString(), teacher, gender, orgType, orgName.text.toString()) else Api.signIn(ac, p)
            Store.boot()
        }) { _, e ->
            busy = false; btn.alpha = 1f; btn.text = if (signup) "注册并登录" else "登录"
            if (e != null) {
                fail((e.message ?: "登录失败") + if (e is com.laolao.classcalendar.core.ApiError && e.status == 0) "。可以点下面的「网络检测」看看是哪一步卡住" else "")
                return@load
            }
            if (!Api.loggedIn) { fail("登录失败，请重试"); return@load }
            a.toast(if (signup) "注册成功，欢迎 🎉" else "欢迎回来，" + Store.name())
            a.showTabs()
        }
    }
}
