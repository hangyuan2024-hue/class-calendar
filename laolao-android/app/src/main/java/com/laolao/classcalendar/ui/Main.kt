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

/** 主界面：底部四个标签（首页 / 作业 / 日历 / 我的），其它页面一层层叠在上面 */
class Main : Activity() {
    private lateinit var root: FrameLayout
    private lateinit var tabBox: LinearLayout
    private lateinit var tabContent: FrameLayout
    private lateinit var tabBar: LinearLayout
    private val tabs = mutableListOf<Page>()
    private val tabViews = mutableListOf<Pair<ImageView, TextView>>()
    private var cur = 0
    private val stack = mutableListOf<Page>()
    private var login: LoginPage? = null
    private var lastRefresh = 0L
    private var resultFn: ((Int, Intent?) -> Unit)? = null
    private var dark = false

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
        stack.clear(); tabs.clear(); tabViews.clear(); root.removeAllViews()
        val p = LoginPage(this); login = p
        root.addView(p.view, FrameLayout.LayoutParams(MATCH, MATCH))
        Widgets.update(this)
    }
    fun showTabs() {
        login = null; stack.clear(); tabs.clear(); tabViews.clear(); root.removeAllViews()
        tabBox = col()
        tabContent = FrameLayout(this)
        tabBox.addView(tabContent, LinearLayout.LayoutParams(MATCH, 0, 1f))
        tabBar = row().apply { setBackgroundColor(C.card); pad(0, 6, 0, 6) }
        tabBox.addView(View(this).apply { setBackgroundColor(C.line) }, LinearLayout.LayoutParams(MATCH, maxOf(1, dp(1) / 2)))
        tabBox.addView(tabBar, LinearLayout.LayoutParams(MATCH, WRAP))
        root.addView(tabBox, FrameLayout.LayoutParams(MATCH, MATCH))
        tabs += HomePage(this); tabs += HomeworkPage(this); tabs += CalendarPage(this); tabs += MePage(this)
        val names = listOf("首页", if (Store.work()) "任务" else "作业", "日历", "我的")
        val icons = listOf(R.drawable.tab_home, R.drawable.tab_homework, R.drawable.tab_calendar, R.drawable.tab_me)
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
            Bg.later(4000) { (tabs.getOrNull(3) as? MePage)?.checkUpdate(false) }
        }
    }
    fun selectTab(i: Int) {
        if (i == cur) { (tabs[i] as? HomePage)?.scrollTop(); return }
        if (cur >= 0) tabs[cur].onHide()
        cur = i
        tabContent.removeAllViews()
        tabContent.addView(tabs[i].view, FrameLayout.LayoutParams(MATCH, MATCH))
        tabViews.forEachIndexed { k, (ic, tx) ->
            ic.setColorFilter(if (k == i) C.accent else C.tab)
            tx.setTextColor(if (k == i) C.accent else C.tab)
        }
        tabs[i].render(); tabs[i].onShow()
    }

    // ---------- 页面栈 ----------
    fun push(p: Page) {
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
        stack.remove(top)
        top.onHide()
        Dialogs.hideKeyboard(top.view)
        val v = top.view
        v.animate().translationX(resources.displayMetrics.widthPixels * 0.3f).alpha(0f).setDuration(150).withEndAction { root.removeView(v) }.start()
        (stack.lastOrNull() ?: if (cur >= 0 && tabs.isNotEmpty()) tabs[cur] else null)?.let { it.render(); it.onShow() }
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        val top = stack.lastOrNull()
        if (top != null) { if (!top.onBack()) pop(top); return }
        if (login == null && cur > 0) { selectTab(0); return }
        @Suppress("DEPRECATION") super.onBackPressed()
    }

    // ---------- 数据变了：只重画看得见的页面（合并 100 毫秒内的多次通知） ----------
    private val renderRun = Runnable {
        val top = stack.lastOrNull()
        if (top != null) { if (top.autoRender) top.render() } else if (cur >= 0 && cur < tabs.size) tabs[cur].render()
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
        if (login == null && Api.loggedIn) { refreshSoon(); schedule() }
        if (login == null && !Api.loggedIn) showLogin()
    }
    override fun onPause() { super.onPause(); Bg.run { com.laolao.classcalendar.core.Sync.finish() }; Widgets.update(this) }
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
        val key = i.getStringExtra("item")
        // 点极光推送打开的：看它带的 route
        val jp = i.getStringExtra("cn.jpush.android.EXTRA")?.let { try { org.json.JSONObject(it).optString("route") } catch (_: Exception) { "" } } ?: ""
        i.removeExtra("cn.jpush.android.EXTRA")
        val go = i.getStringExtra("go") ?: jp.takeIf { it == "homework" || it == "calendar" }
        i.removeExtra("item"); i.removeExtra("go")
        Bg.main.post {
            when {
                key != null -> push(ItemPage(this, key))
                go == "homework" -> { stack.toList().forEach { pop(it) }; selectTab(1) }
                go == "calendar" -> { stack.toList().forEach { pop(it) }; selectTab(2) }
                go == "add" -> push(EditPage(this, null))
                go == "course" -> push(CoursePage(this))
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
    }
    fun statusColor(c: Int) { window.statusBarColor = if (c == 0) C.bg else c }
    val transparent = Color.TRANSPARENT
}
