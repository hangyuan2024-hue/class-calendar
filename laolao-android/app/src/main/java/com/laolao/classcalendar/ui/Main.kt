package com.laolao.classcalendar.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.WindowInsetsController
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Bus
import com.laolao.classcalendar.core.Net
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.push.Push
import com.laolao.classcalendar.work.Background
import com.laolao.classcalendar.widget.Widgets

/** 主界面：底部五个标签（首页 / 作业 / 成长 / 工具 / 我的），其它页面一层层叠在上面 */
class Main : Activity() {
    private lateinit var root: FrameLayout
    val rootView: FrameLayout get() = root
    /** 各页面右下角的「＋」：按返回键先收起展开的菜单 */
    val fabs = mutableListOf<Fab>()
    private lateinit var tabBox: FrameLayout
    /** 标签页区域（底栏半透明浮在内容上面） */
    val tabArea: View? get() = if (::tabBox.isInitialized && login == null) tabBox else null
    /** 底栏的高度：浮动按钮、捞捞、滚动内容都要让出这么多 */
    var underBar = 0
    private lateinit var tabInd: View
    private val padded = java.util.WeakHashMap<View, Int>()
    private lateinit var tabContent: FrameLayout
    private lateinit var tabBar: LinearLayout
    private lateinit var barWrap: GlassBar
    private val tabs = mutableListOf<Page>()
    private val tabViews = mutableListOf<Pair<ImageView, TextView>>()
    private var cur = 0
    private val stack = mutableListOf<Page>()
    private var login: LoginPage? = null
    private var lastRefresh = 0L
    private var resultFn: ((Int, Intent?) -> Unit)? = null
    private var dark = false
    /** 捞捞助手（标签页左下角，可以拖） */
    var lao: Lao? = null

    /** 7.x 界面大小：大屏安卓上默认紧凑一点（整体缩到 90%），设置 → 外观里能改 */
    override fun attachBaseContext(base: android.content.Context) {
        val sc = UiScale.get(base)
        if (sc == 1f) { super.attachBaseContext(base); return }
        val cfg = android.content.res.Configuration(base.resources.configuration)
        cfg.densityDpi = (base.resources.configuration.densityDpi * sc).toInt()
        super.attachBaseContext(base.createConfigurationContext(cfg))
    }

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        Store.init(this)
        C.load(this); dark = C.dark
        root = FrameLayout(this)
        setContentView(root)
        chrome()
        Api.onLost = { why -> toast(if (why == "revoked") "这台手机已在其他设备上被退出登录" else "登录已过期，请重新登录"); showLogin() }
        Bus.on(this) { what -> if (what == "user" && !Api.loggedIn) showLogin() else schedule(); if (what == "data" && login == null) { Bg.main.postDelayed({ InAlert.check(this) }, 600); paintBadges() } }
        Net.probe()
        // 6.9 账号经验：+N / 升级的提示
        com.laolao.classcalendar.core.Level.onXp = { pts, l, up -> toast(if (up) "🎉 升级了！Lv.${l.level} ${l.title}" else "⭐ 经验 +$pts · Lv.${l.level} ${l.xp}/${l.to}") }
        com.laolao.classcalendar.work.Notify.channels(this)
        // 从旧版（6.x）升级上来：清掉旧版留下的后台任务和通知分类
        val ap = getSharedPreferences("app", MODE_PRIVATE)
        if (!ap.getBoolean("v7_clean", false)) {
            ap.edit().putBoolean("v7_clean", true).apply()
            try { getSystemService(android.app.job.JobScheduler::class.java).cancelAll() } catch (_: Exception) {}
            try { val nm = getSystemService(android.app.NotificationManager::class.java); for (c in nm.notificationChannels) if (c.id !in setOf("class", "due", "news", "brief")) nm.deleteNotificationChannel(c.id) } catch (_: Exception) {}
        }
        if (Api.loggedIn) showTabs() else showLogin()
        handle(intent)
    }

    /** 状态栏、导航栏跟背景一个颜色 */
    @Suppress("DEPRECATION")
    private fun chrome() {
        window.statusBarColor = C.bg
        window.navigationBarColor = C.card
        root.setBackgroundColor(C.bg)
        if (Build.VERSION.SDK_INT >= 30) {
            val f = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(if (C.dark) 0 else f, f)
        } else {
            window.decorView.systemUiVisibility = if (C.dark) 0 else (View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR)
        }
    }

    // ---------- 登录 / 主界面 ----------
    fun showLogin() {
        lao?.stop(); lao = null; Drawer.close(false)
        stack.clear(); tabs.clear(); tabViews.clear(); fabs.clear(); root.removeAllViews()
        val p = LoginPage(this); login = p
        root.addView(p.view, FrameLayout.LayoutParams(MATCH, MATCH))
        Widgets.update(this)
    }
    fun showTabs() {
        Drawer.close(false); login = null; stack.clear(); tabs.clear(); tabViews.clear(); fabs.clear(); root.removeAllViews()
        tabBox = FrameLayout(this)
        tabContent = FrameLayout(this).apply { clipChildren = false }
        lao?.stop(); lao = Lao(this, tabContent)
        tabBox.addView(tabContent, FrameLayout.LayoutParams(MATCH, MATCH))
        // 底栏：毛玻璃一样半透明，内容从下面透出来；选中的标签有一块会滑动的底色
        barWrap = GlassBar(this, tabContent).apply { lift(8, C.text) }
        barWrap.addView(View(this).apply { setBackgroundColor(C.alpha(C.line, 0.7f)) }, FrameLayout.LayoutParams(MATCH, maxOf(1, dp(1) / 2)))
        // 7.x 选中的标签不再垫一块底色，简洁一点：只换成「实心」图标 + 主题色文字
        tabInd = View(this).apply { visibility = View.GONE }
        barWrap.addView(tabInd, FrameLayout.LayoutParams(dp(58), dp(32)).apply { topMargin = dp(TAB_TOP) })
        tabBar = row().apply { pad(4, TAB_TOP, 4, 4) }
        barWrap.addView(tabBar, FrameLayout.LayoutParams(MATCH, WRAP))
        tabBox.addView(barWrap, FrameLayout.LayoutParams(MATCH, WRAP).apply { gravity = Gravity.BOTTOM })
        barWrap.addOnLayoutChangeListener { _, _, t, _, b, _, _, _, _ -> if (b - t != underBar) { underBar = b - t; tabContent.post { if (cur >= 0) { padUnder(tabs[cur].view); moveInd(false) }; lao?.attach() } } }
        root.addView(tabBox, FrameLayout.LayoutParams(MATCH, MATCH))
        tabs += HomePage(this); tabs += HomeworkPage(this); tabs += GrowthPage(this); tabs += ToolsPage(this); tabs += MePage(this)
        val names = listOf("首页", if (Store.work()) "任务" else "作业", "成长", "工具", "我的")
        tabBadges.clear()
        for (i in tabs.indices) {
            val cell = col().apply {
                gravity = Gravity.CENTER_HORIZONTAL; contentDescription = names[i]
                setOnClickListener { v -> v.performHapticFeedback(android.view.HapticFeedbackConstants.KEYBOARD_TAP); selectTab(i) }
                // 按下去轻轻缩一下
                setOnTouchListener { v, e ->
                    when (e.actionMasked) {
                        android.view.MotionEvent.ACTION_DOWN -> v.animate().scaleX(0.92f).scaleY(0.92f).setDuration(90).start()
                        android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> v.animate().scaleX(1f).scaleY(1f).setDuration(160).start()
                    }
                    false
                }
            }
            val box = FrameLayout(this).apply { clipChildren = false; clipToPadding = false }
            val ic = ImageView(this).apply { setImageResource(TAB_ICONS[i].first); scaleType = ImageView.ScaleType.FIT_CENTER }
            box.addView(ic, FrameLayout.LayoutParams(dp(23), dp(23), Gravity.CENTER))
            // 角标：作业有过期 / 今天要交的显示红色数字
            val badge = text("", 10f, Color.WHITE, BOLD).apply {
                gravity = Gravity.CENTER; minWidth = dp(16); setPadding(dp(4), 0, dp(4), 0); includeFontPadding = false
                background = round(C.red, dp(8).toFloat(), C.card, dp(2)); visibility = View.GONE
            }
            // 角标放在图标右上角，但不超出这一格的上边（超出去会被底栏裁掉一半）
            box.addView(badge, FrameLayout.LayoutParams(WRAP, dp(16), Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { leftMargin = dp(21); topMargin = 0 })
            tabBadges += badge
            cell.addView(box, LinearLayout.LayoutParams(dp(52), dp(26)))
            val tx = text(names[i], 10.5f, C.tab, SEMI).apply { gravity = Gravity.CENTER; letterSpacing = 0.02f }
            cell.addView(tx, LinearLayout.LayoutParams(WRAP, WRAP).apply { topMargin = dp(1) })
            tabBar.addView(cell, LinearLayout.LayoutParams(0, WRAP, 1f))
            tabViews += ic to tx
        }
        paintBadges()
        // 第一次用：告诉一声侧边栏怎么打开（没有按钮了）
        if (com.laolao.classcalendar.core.Kv.get("drawer_tip_v1") == null) Bg.main.postDelayed({
            if (login == null && !isFinishing) { com.laolao.classcalendar.core.Kv.setQuiet("drawer_tip_v1", true); toast("从屏幕左边缘往右滑，可以打开侧边栏") }
        }, 2500)
        cur = -1
        selectTab(0)
        if (System.currentTimeMillis() - Store.bootAt > 15_000) refreshSoon(force = true) else { lastRefresh = System.currentTimeMillis(); Background.afterRefresh(this) }
        askNotifications()
        Push.start(this)
        // 有没有新版本：12 小时最多问一次，有就弹窗「立即更新」（ui/Updater.kt）
        Bg.later(4000) { Updater.auto(this) }
    }
    /** 底栏图标：没选中是线条，选中是「实心」版（tools/icons/tabs.py 生成） */
    private val TAB_ICONS = listOf(R.drawable.tab_v_home to R.drawable.tab_v_home_on, R.drawable.tab_v_homework to R.drawable.tab_v_homework_on,
        R.drawable.tab_v_growth to R.drawable.tab_v_growth_on, R.drawable.tab_v_tools to R.drawable.tab_v_tools_on, R.drawable.tab_v_me to R.drawable.tab_v_me_on)
    private val TAB_TOP = 5
    private val tabBadges = mutableListOf<TextView>()
    /** 作业角标：过期的 + 今天要交的（没有就不显示） */
    fun paintBadges() {
        val b = tabBadges.getOrNull(1) ?: return
        val n = try {
            if (!Store.feat("homework")) 0 else Items.homeworkAll().groups.filter { it.key == "late" || it.key == "today" }.sumOf { g -> g.items.count { !it.done } }
        } catch (_: Exception) { 0 }
        b.text = if (n > 99) "99+" else "$n"
        b.visibility = if (n > 0) View.VISIBLE else View.GONE
        tabViews.getOrNull(1)?.second?.contentDescription = if (n > 0) "作业，$n 项要尽快交" else null
    }
    /** 再点一下当前标签：滚回顶部 */
    private fun toTop(v: View): Boolean {
        if (v is android.widget.ScrollView) { v.smoothScrollTo(0, 0); return true }
        if (v is android.view.ViewGroup) for (k in 0 until v.childCount) if (toTop(v.getChildAt(k))) return true
        return false
    }
    fun selectTab(i: Int) {
        if (i == cur) { (tabs[i] as? HomePage)?.scrollTop() ?: toTop(tabs[i].view); return }
        fabs.forEach { it.close() }
        if (cur >= 0) tabs[cur].onHide()
        cur = i
        val first = tabContent.childCount == 0
        tabContent.removeAllViews()
        val pv = tabs[i].view
        tabContent.addView(pv, FrameLayout.LayoutParams(MATCH, MATCH))
        padUnder(pv)
        if (!first) { pv.alpha = 0f; pv.translationY = dp(10).toFloat(); pv.animate().alpha(1f).translationY(0f).setDuration(200).start() }
        tabViews.forEachIndexed { k, (ic, tx) ->
            ic.setImageResource(if (k == i) TAB_ICONS[k].second else TAB_ICONS[k].first)
            ic.setColorFilter(if (k == i) C.accent else C.tab)
            tx.setTextColor(if (k == i) C.accent else C.tab)
            tx.typeface = if (k == i) BOLD else SEMI
        }
        // 选中的图标弹一下
        tabViews.getOrNull(i)?.first?.let { ic -> ic.scaleX = 0.8f; ic.scaleY = 0.8f
            ic.animate().scaleX(1f).scaleY(1f).setDuration(280).setInterpolator(android.view.animation.OvershootInterpolator(2.2f)).start() }
        moveInd(!first)
        tabs[i].render(); tabs[i].onShow()
        tabContent.post { lao?.attach() }
    }

    /** 滑动的底色块移到当前标签下面 */
    private fun moveInd(anim: Boolean) {
        val cell = tabBar.getChildAt(cur) ?: return
        if (cell.width == 0) { tabBar.post { moveInd(false) }; return }
        val x = tabBar.left + cell.left + (cell.width - tabInd.width.coerceAtLeast(dp(58))) / 2f
        if (anim) tabInd.animate().translationX(x).setDuration(300).setInterpolator(android.view.animation.OvershootInterpolator(1.2f)).start() else tabInd.translationX = x
    }
    /** 标签页里的滚动内容：底下多留出底栏那么高，滚到底时不被底栏挡住，滚动时内容从底栏下面透出来 */
    private fun padUnder(v: View) {
        if (underBar == 0) return
        fun walk(x: View): Boolean {
            if (x is android.widget.ScrollView) {
                val base = padded.getOrPut(x) { x.paddingBottom }
                x.setPadding(x.paddingLeft, x.paddingTop, x.paddingRight, base + underBar); x.clipToPadding = false
                return true
            }
            if (x is android.view.ViewGroup) for (k in 0 until x.childCount) if (walk(x.getChildAt(k))) return true
            return false
        }
        walk(v)
    }

    // ---------- 7.x 侧边栏：从屏幕左边缘往右滑打开（捞捞趴在左边时让着它） ----------
    private var edgeX = -1f; private var edgeY = 0f; private var edgeOn = false
    override fun dispatchTouchEvent(e: android.view.MotionEvent): Boolean {
        if (login == null && !Drawer.isOpen) when (e.actionMasked) {
            android.view.MotionEvent.ACTION_DOWN -> {
                edgeOn = false
                edgeX = if (e.rawX < dp(22) && lao?.hit(e.rawX, e.rawY) != true) e.rawX else -1f; edgeY = e.rawY
            }
            android.view.MotionEvent.ACTION_MOVE -> if (edgeX >= 0 && !edgeOn) {
                val dx = e.rawX - edgeX; val dy = Math.abs(e.rawY - edgeY)
                if (dx > dp(28) && dx > dy * 1.4f) {
                    edgeOn = true; edgeX = -1f
                    // 让下面的页面取消这次按下（不会误点到东西）
                    val c = android.view.MotionEvent.obtain(e).apply { action = android.view.MotionEvent.ACTION_CANCEL }
                    super.dispatchTouchEvent(c); c.recycle()
                    Drawer.open(this); return true
                } else if (dy > dp(24)) edgeX = -1f
            }
        }
        if (edgeOn) { if (e.actionMasked == android.view.MotionEvent.ACTION_UP || e.actionMasked == android.view.MotionEvent.ACTION_CANCEL) edgeOn = false; return true }
        return super.dispatchTouchEvent(e)
    }

    // ---------- 页面栈 ----------
    fun push(p: Page) {
        fabs.forEach { it.close() }
        val v = p.view
        v.isClickable = true
        if (v.background == null) v.setBackgroundColor(C.bg)
        root.addView(v, FrameLayout.LayoutParams(MATCH, MATCH))
        v.translationX = resources.displayMetrics.widthPixels * 0.3f; v.alpha = 0f
        v.animate().translationX(0f).alpha(1f).setDuration(180).start()
        stack += p
        p.render(); p.onShow()
    }
    fun pop(p: Page? = null) {
        val top = p ?: stack.lastOrNull() ?: return
        fabs.forEach { it.close() }
        stack.remove(top)
        top.onHide()
        Dialogs.hideKeyboard(top.view)
        val v = top.view
        v.animate().translationX(resources.displayMetrics.widthPixels * 0.3f).alpha(0f).setDuration(150).withEndAction { root.removeView(v) }.start()
        (stack.lastOrNull() ?: if (cur >= 0 && tabs.isNotEmpty()) tabs[cur] else null)?.let { it.render(); it.onShow() }
        if (stack.isEmpty()) lao?.let { l -> if (Lao.on() != (l.isAttached)) tabContent.post { l.attach() } else l.paint(true) }
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (Drawer.isOpen) { Drawer.close(); return }
        fabs.firstOrNull { it.open }?.let { it.close(); return }
        if (stack.isEmpty() && lao?.isOpen == true) { lao?.close(); return }
        val top = stack.lastOrNull()
        if (top != null) { if (!top.onBack()) pop(top); return }
        if (login == null && cur > 0) { selectTab(0); return }
        @Suppress("DEPRECATION") super.onBackPressed()
    }

    // ---------- 数据变了：只重画看得见的页面（合并 100 毫秒内的多次通知） ----------
    private val renderRun = Runnable {
        val top = stack.lastOrNull()
        if (top != null) { if (top.autoRender) top.render() } else if (cur >= 0 && cur < tabs.size) { tabs[cur].render(); lao?.paint() }
    }
    private fun schedule() { Bg.main.removeCallbacks(renderRun); Bg.main.postDelayed(renderRun, 100) }

    /** 回到前台：超过 2 分钟没刷新就刷新一下 */
    fun refreshSoon(force: Boolean = false, done: (() -> Unit)? = null) {
        if (!Api.loggedIn) { done?.invoke(); return }
        if (!force && System.currentTimeMillis() - lastRefresh < 120_000) { done?.invoke(); return }
        lastRefresh = System.currentTimeMillis()
        Bg.load({ if (Store.me == null || !Store.ready) Store.boot() else Store.refresh() }) { ok, _ ->
            if (ok == false && Store.error.isNotEmpty() && force) toast(Store.error)
            Background.afterRefresh(this)
            // 7.1 大作业 / 复习排期：过期没勾掉的步骤往后顺延（同步拉完之后再做，免得和网页、小程序重复排）
            Bg.load({ com.laolao.classcalendar.core.Dplan.replanAll() }) { m, _ -> if (!m.isNullOrEmpty()) toast(m) }
            done?.invoke()
        }
    }

    override fun onResume() {
        super.onResume()
        C.load(this)
        if (C.dark != dark) { recreate(); return }
        if (login == null && Api.loggedIn) { refreshSoon(); schedule(); lao?.paint(true) }
        if (login == null && !Api.loggedIn) showLogin()
        stack.lastOrNull()?.onAppResume()
        com.laolao.classcalendar.work.Guard.ensure(this)
        if (login == null && Api.loggedIn) Bg.later(1500) { Updater.auto(this) }   // 7.x 强制更新：从后台回来也看一眼
        Bg.main.removeCallbacks(alertTick); Bg.main.postDelayed(alertTick, 3000)
    }
    // 7.x App 开着时每 30 秒看一次：快截止、快开始（InAlert）
    private val alertTick = object : Runnable { override fun run() { if (login == null && Api.loggedIn) InAlert.check(this@Main); Bg.main.postDelayed(this, 30_000) } }
    override fun onPause() { Bg.main.removeCallbacks(alertTick); super.onPause(); stack.lastOrNull()?.onAppPause(); Bg.run { com.laolao.classcalendar.core.Sync.finish() }; Widgets.update(this) }
    override fun onDestroy() { Bus.off(this); super.onDestroy() }
    override fun onNewIntent(i: Intent) { super.onNewIntent(i); setIntent(i); handle(i) }

    /** 从通知、小组件、快捷方式打开：直接到对应页面 */
    private fun handle(i: Intent?) {
        if (i == null || !Api.loggedIn || login != null) return
        // 别的 App 分享过来：文字 → 拆成待办；图片 → 当课表识别
        if (i.action == Intent.ACTION_SEND) {
            i.action = Intent.ACTION_MAIN
            if (i.type?.startsWith("image/") == true) {
                @Suppress("DEPRECATION") val uri = i.getParcelableExtra<android.net.Uri>(Intent.EXTRA_STREAM) ?: return
                Bg.main.post { val p = CourseImportPage(this); push(p); p.run(uri) }
            } else {
                val t = i.getStringExtra(Intent.EXTRA_TEXT) ?: return
                Bg.main.post { push(MemoPage(this, t)) }
            }
            return
        }
        // 6.9.1 扫签到二维码打开的：https://www.laolaokechengbiao.cn/ck/?i=编号&k=码
        val u = i.data
        if (i.action == Intent.ACTION_VIEW && u != null && (u.path ?: "").startsWith("/ck")) {
            i.data = null
            val id = u.getQueryParameter("i")?.toLongOrNull()
            if (id != null) { val k = (u.getQueryParameter("k") ?: "").filter { it.isDigit() }.take(4); Bg.main.post { push(CheckinPage(this, id, k, scanned = true)) } }
            return
        }
        val key = i.getStringExtra("item")
        // 点极光推送打开的：看它带的 route
        val jp = i.getStringExtra("cn.jpush.android.EXTRA")?.let { try { org.json.JSONObject(it).optString("route") } catch (_: Exception) { "" } } ?: ""
        i.removeExtra("cn.jpush.android.EXTRA")
        val go = i.getStringExtra("go") ?: jp.takeIf { it in setOf("homework", "calendar", "growth", "plan", "wall", "rank") }
        i.removeExtra("item"); i.removeExtra("go")
        Bg.main.post {
            when {
                key != null -> push(ItemPage(this, key))
                go == "homework" -> { stack.toList().forEach { pop(it) }; selectTab(1) }
                go == "calendar" -> { selectTab(0); push(CalendarPage(this, pushed = true)) }
                go == "growth" -> { stack.toList().forEach { pop(it) }; selectTab(2) }
                go == "plan" -> { if (stack.lastOrNull() !is PlanPage) push(PlanPage(this)) }
                go == "timemaster" -> { if (stack.lastOrNull() !is TimeMasterPage) push(TimeMasterPage(this)) }
                go == "wall" -> push(WallPage(this))
                go == "rank" -> push(RankPage(this))
                go == "farm" -> push(FarmPage(this))
                go == "ask" -> push(AskPage(this))
                go == "add" -> push(EditPage(this, null))
                go == "course" -> push(CoursePage(this))
                go == "coach" -> push(CoachPage(this))
                go == "flow" -> { if (stack.lastOrNull() !is FlowPage) push(FlowPage(this)) }
                go == "course_import" -> push(CourseImportPage(this))
                go == "memo" -> push(MemoPage(this, ""))
                go == "collect" -> { if (stack.lastOrNull() !is CollectPage) push(CollectPage(this)) }
            }
        }
    }

    // ---------- 选图片、拍照等：结果回到这里 ----------
    fun startForResult(i: Intent, fn: (Int, Intent?) -> Unit) {
        resultFn = fn
        try { @Suppress("DEPRECATION") startActivityForResult(i, 77) } catch (e: Exception) { resultFn = null; toast("这台手机上没有能用的应用") }
    }
    @Deprecated("Deprecated in Java")
    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(req, res, data)
        if (req == 77) { val f = resultFn; resultFn = null; f?.invoke(res, data) }
    }

    private fun askNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            val p = getSharedPreferences("app", MODE_PRIVATE)
            if (!p.getBoolean("asked_notify", false)) { p.edit().putBoolean("asked_notify", true).apply(); requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 5) }
        }
    }
    override fun onRequestPermissionsResult(req: Int, perms: Array<out String>, res: IntArray) {
        super.onRequestPermissionsResult(req, perms, res)
        if (req == 5) Background.reschedule(this)
        if (req == 6) { val f = locFn; locFn = null; f?.invoke(res.any { it == PackageManager.PERMISSION_GRANTED }) }
    }
    // ---------- 6.9 定位权限：位置签到、习惯到地点打卡（只在点按钮那一下定位） ----------
    private var locFn: ((Boolean) -> Unit)? = null
    fun needLocation(fn: (Boolean) -> Unit) {
        val fine = Manifest.permission.ACCESS_FINE_LOCATION; val coarse = Manifest.permission.ACCESS_COARSE_LOCATION
        if (checkSelfPermission(fine) == PackageManager.PERMISSION_GRANTED || checkSelfPermission(coarse) == PackageManager.PERMISSION_GRANTED) { fn(true); return }
        locFn = fn; requestPermissions(arrayOf(fine, coarse), 6)
    }
    /** 定位一次（会先要权限）；失败时直接提示 */
    fun locate(fn: (com.laolao.classcalendar.core.Geo.Pos) -> Unit) {
        needLocation { ok ->
            if (!ok) { Dialogs.alert(this, "需要位置权限", "签到 / 打卡要确认你在现场。请在系统设置里允许「捞捞课程表」使用位置信息（只在你点按钮那一下定位，不会一直跟踪）。"); return@needLocation }
            toast("正在定位…")
            com.laolao.classcalendar.core.Geo.once(this) { p, why -> if (p == null) Dialogs.alert(this, "没定位到", why) else fn(p) }
        }
    }
    /** 刷任务这种深色全屏页：状态栏、导航栏换成深色，图标变白；off 时恢复 */
    @Suppress("DEPRECATION")
    fun immersive(on: Boolean, top: Int = 0, bottom: Int = 0) {
        if (!on) { chrome(); return }
        window.statusBarColor = top; window.navigationBarColor = bottom
        if (Build.VERSION.SDK_INT >= 30) {
            val f = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
            window.insetsController?.setSystemBarsAppearance(0, f)
        } else window.decorView.systemUiVisibility = 0
    }
    fun statusColor(c: Int) { window.statusBarColor = if (c == 0) C.bg else c }
    val transparent = Color.TRANSPARENT
}
