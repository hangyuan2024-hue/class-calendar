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

    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        Store.init(this)
        C.load(this); dark = C.dark
        root = FrameLayout(this)
        setContentView(root)
        chrome()
        Api.onLost = { why -> toast(if (why == "revoked") "这台手机已在其他设备上被退出登录" else "登录已过期，请重新登录"); showLogin() }
        Bus.on(this) { what -> if (what == "user" && !Api.loggedIn) showLogin() else schedule() }
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
        lao?.stop(); lao = null
        stack.clear(); tabs.clear(); tabViews.clear(); fabs.clear(); root.removeAllViews()
        val p = LoginPage(this); login = p
        root.addView(p.view, FrameLayout.LayoutParams(MATCH, MATCH))
        Widgets.update(this)
    }
    fun showTabs() {
        login = null; stack.clear(); tabs.clear(); tabViews.clear(); fabs.clear(); root.removeAllViews()
        tabBox = FrameLayout(this)
        tabContent = FrameLayout(this).apply { clipChildren = false }
        lao?.stop(); lao = Lao(this, tabContent)
        tabBox.addView(tabContent, FrameLayout.LayoutParams(MATCH, MATCH))
        // 底栏：毛玻璃一样半透明，内容从下面透出来；选中的标签有一块会滑动的底色
        barWrap = GlassBar(this, tabContent).apply { lift(8, C.text) }
        barWrap.addView(View(this).apply { setBackgroundColor(C.alpha(C.line, 0.7f)) }, FrameLayout.LayoutParams(MATCH, maxOf(1, dp(1) / 2)))
        tabInd = View(this).apply { background = round(C.alpha(C.accent, if (C.dark) 0.26f else 0.13f), dp(16).toFloat()) }
        barWrap.addView(tabInd, FrameLayout.LayoutParams(dp(60), dp(32)).apply { topMargin = dp(5) })
        tabBar = row().apply { pad(0, 6, 0, 6) }
        barWrap.addView(tabBar, FrameLayout.LayoutParams(MATCH, WRAP))
        tabBox.addView(barWrap, FrameLayout.LayoutParams(MATCH, WRAP).apply { gravity = Gravity.BOTTOM })
        barWrap.addOnLayoutChangeListener { _, _, t, _, b, _, _, _, _ -> if (b - t != underBar) { underBar = b - t; tabContent.post { if (cur >= 0) { padUnder(tabs[cur].view); moveInd(false) }; lao?.attach() } } }
        root.addView(tabBox, FrameLayout.LayoutParams(MATCH, MATCH))
        tabs += HomePage(this); tabs += HomeworkPage(this); tabs += GrowthPage(this); tabs += ToolsPage(this); tabs += MePage(this)
        val names = listOf("首页", if (Store.work()) "任务" else "作业", "成长", "工具", "我的")
        val icons = listOf(R.drawable.tab_home, R.drawable.tab_homework, R.drawable.tab_growth, R.drawable.tab_tools, R.drawable.tab_me)
        for (i in tabs.indices) {
            val cell = col().apply { gravity = Gravity.CENTER; tap { selectTab(i) } }
            val ic = icon(icons[i], 25)
            val tx = text(names[i], 11f, C.tab, SEMI).apply { gravity = Gravity.CENTER }
            cell.addView(ic); cell.addView(tx)
            tabBar.addView(cell, LinearLayout.LayoutParams(0, WRAP, 1f))
            tabViews += ic to tx
        }
        cur = -1
        selectTab(0)
        if (System.currentTimeMillis() - Store.bootAt > 15_000) refreshSoon(force = true) else { lastRefresh = System.currentTimeMillis(); Background.afterRefresh(this) }
        askNotifications()
        Push.start(this)
        // 一天看一次有没有新版本
        val ap = getSharedPreferences("app", MODE_PRIVATE)
        if (System.currentTimeMillis() - ap.getLong("upd_at", 0) > 86400_000L) {
            ap.edit().putLong("upd_at", System.currentTimeMillis()).apply()
            Bg.later(4000) { (tabs.lastOrNull() as? MePage)?.checkUpdate(false) }
        }
    }
    fun selectTab(i: Int) {
        if (i == cur) { (tabs[i] as? HomePage)?.scrollTop(); return }
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
            ic.setColorFilter(if (k == i) C.accent else C.tab)
            tx.setTextColor(if (k == i) C.accent else C.tab)
            tx.typeface = if (k == i) BOLD else SEMI
        }
        // 选中的图标弹一下
        tabViews.getOrNull(i)?.first?.let { ic -> ic.scaleX = 0.7f; ic.scaleY = 0.7f; ic.translationY = dp(3).toFloat()
            ic.animate().scaleX(1f).scaleY(1f).translationY(0f).setDuration(320).setInterpolator(android.view.animation.OvershootInterpolator(3f)).start() }
        moveInd(!first)
        tabs[i].render(); tabs[i].onShow()
        tabContent.post { lao?.attach() }
    }

    /** 滑动的底色块移到当前标签下面 */
    private fun moveInd(anim: Boolean) {
        val cell = tabBar.getChildAt(cur) ?: return
        if (cell.width == 0) { tabBar.post { moveInd(false) }; return }
        val x = cell.left + (cell.width - tabInd.width.coerceAtLeast(dp(60))) / 2f
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
    }
    override fun onPause() { super.onPause(); stack.lastOrNull()?.onAppPause(); Bg.run { com.laolao.classcalendar.core.Sync.finish() }; Widgets.update(this) }
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
            if (id != null) { val k = (u.getQueryParameter("k") ?: "").filter { it.isDigit() }.take(4); Bg.main.post { push(CheckinPage(this, id, k)) } }
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
