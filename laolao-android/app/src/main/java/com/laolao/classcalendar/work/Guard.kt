package com.laolao.classcalendar.work

import android.app.Activity
import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import android.view.Gravity
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import com.laolao.classcalendar.R
import com.laolao.classcalendar.core.Coach
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.ui.BOLD
import com.laolao.classcalendar.ui.HEAVY
import com.laolao.classcalendar.ui.Main
import com.laolao.classcalendar.ui.SEMI
import com.laolao.classcalendar.ui.col
import com.laolao.classcalendar.ui.dp
import com.laolao.classcalendar.ui.pad
import com.laolao.classcalendar.ui.round
import com.laolao.classcalendar.ui.tap
import com.laolao.classcalendar.ui.text
import org.json.JSONArray
import org.json.JSONObject

/**
 * 5.9.4「游戏前先做 5 分钟」（只有安卓 App 能做；默认关，要自己在「捞捞教练」里打开并给两个权限）：
 *  · 打开你选的 App（默认是手机认出来的游戏）时，捞捞跳出来问一句「先做 5 分钟再玩？」
 *    选「好」→ 打开刷任务；选「这次先玩」→ 这个 App 30 分钟内不再问。不锁游戏、不拦截，只是在那一刻给你一个选择。
 *  · 要「使用情况访问权限」才知道你打开了哪个 App（只在手机上判断，不记录、不上传你用了什么 App）；
 *    要「显示在其他应用上层」才能在游戏上面弹出来。
 *  · 后台每 1.5 秒看一眼最上面是哪个 App（亮屏时；锁屏时 10 秒一次），通知栏会有一条常驻通知（安卓的规定）。
 */
object Guard {
    const val KEY = "guard_v1"
    private const val CH = "guard"
    const val NOTE_ID = 7301
    /** 手机没标成「游戏」、但很多同学会玩的 */
    val KNOWN = setOf(
        "com.tencent.tmgp.sgame", "com.tencent.tmgp.pubgmhd", "com.tencent.jkchess", "com.tencent.lolm", "com.tencent.tmgp.cf", "com.tencent.tmgp.speedmobile",
        "com.miHoYo.Yuanshen", "com.miHoYo.hkrpg", "com.miHoYo.Nap", "com.miHoYo.bh3", "com.netease.party", "com.netease.dwrg", "com.netease.sky", "com.netease.x19",
        "com.netease.mrzh", "com.netease.onmyoji", "com.hypergryph.arknights", "com.papegames.infinitynikki", "com.kurogame.mingchao", "com.mojang.minecraftpe",
        "com.supercell.clashroyale", "com.supercell.brawlstars", "com.tencent.tmgp.dnf", "com.tencent.nfsonline", "com.bilibili.fatego",
    )

    fun opts(): JSONObject = Kv.obj(KEY)
    fun on() = opts().optBoolean("on", false)
    fun setOn(ctx: Context, v: Boolean) { val o = opts(); o.put("on", v); Kv.setQuiet(KEY, o); ensure(ctx) }
    fun apps(ctx: Context): Set<String> {
        val a = opts().optJSONArray("apps") ?: return defaults(ctx)
        return (0 until a.length()).map { a.optString(it) }.toSet()
    }
    fun setApps(set: Set<String>) { val o = opts(); o.put("apps", JSONArray(set.toList())); Kv.setQuiet(KEY, o) }
    /** 手机上装了的：标成游戏的 + 上面那些 */
    fun defaults(ctx: Context): Set<String> = launchable(ctx).filter { it.second }.map { it.first }.toSet()
    /** 桌面上能打开的 App：(包名, 是不是游戏) */
    fun launchable(ctx: Context): List<Pair<String, Boolean>> {
        val pm = ctx.packageManager
        val list = try { pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0) } catch (_: Exception) { emptyList() }
        return list.mapNotNull { r ->
            val p = r.activityInfo?.packageName ?: return@mapNotNull null
            if (p == ctx.packageName) return@mapNotNull null
            val ai = r.activityInfo.applicationInfo
            @Suppress("DEPRECATION") val game = p in KNOWN || ai.category == ApplicationInfo.CATEGORY_GAME || (ai.flags and ApplicationInfo.FLAG_IS_GAME) != 0
            p to game
        }.distinctBy { it.first }
    }
    fun label(ctx: Context, p: String): String = try { ctx.packageManager.getApplicationLabel(ctx.packageManager.getApplicationInfo(p, 0)).toString() } catch (_: Exception) { p }

    fun hasUsage(ctx: Context): Boolean = try {
        val ao = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        @Suppress("DEPRECATION") val m = if (Build.VERSION.SDK_INT >= 29) ao.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName) else ao.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
        m == AppOpsManager.MODE_ALLOWED
    } catch (_: Exception) { false }
    fun hasOverlay(ctx: Context) = Settings.canDrawOverlays(ctx)
    fun openUsage(ctx: Context) { try { ctx.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {} }
    fun openOverlay(ctx: Context) { try { ctx.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) { try { ctx.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) } catch (_: Exception) {} } }
    fun ready(ctx: Context) = on() && hasUsage(ctx) && hasOverlay(ctx)

    /** 该开就开、该关就关（App 回到前台、开机、改设置时调） */
    fun ensure(ctx: Context) {
        try {
            val i = Intent(ctx, GuardService::class.java)
            if (ready(ctx)) { if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i) }
            else ctx.stopService(i)
        } catch (_: Exception) {}
    }

    // 「这次先玩」：这个 App 30 分钟内不再问
    fun snoozed(p: String): Boolean = opts().optJSONObject("snooze")?.optLong(p) ?: 0L > System.currentTimeMillis()
    fun snooze(p: String, min: Int) { val o = opts(); val s = o.optJSONObject("snooze") ?: JSONObject(); s.put(p, System.currentTimeMillis() + min * 60_000L); o.put("snooze", s); Kv.setQuiet(KEY, o) }
    /** 今天问了几次、选了几次「先做」 */
    fun stat(field: String? = null): Pair<Int, Int> {
        val o = opts(); val t = T.todayKey(); var s = o.optJSONObject("stat") ?: JSONObject()
        if (s.optString("day") != t) s = JSONObject().put("day", t)
        if (field != null) { s.put(field, s.optInt(field) + 1); o.put("stat", s); Kv.setQuiet(KEY, o) }
        return s.optInt("ask") to s.optInt("yes")
    }

    fun channel(ctx: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(NotificationChannel(CH, "游戏前先做 5 分钟", NotificationManager.IMPORTANCE_MIN).apply { description = "打开游戏时捞捞问一句（安卓规定要有一条常驻通知）"; setShowBadge(false) })
    }
    fun note(ctx: Context): Notification {
        channel(ctx)
        val pi = PendingIntent.getActivity(ctx, 93, Intent(ctx, Main::class.java).putExtra("go", "coach").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val (ask, yes) = stat()
        val b = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(ctx, CH) else @Suppress("DEPRECATION") Notification.Builder(ctx)
        return b.setSmallIcon(R.drawable.ic_stat).setContentTitle("🎮 游戏前先做 5 分钟")
            .setContentText(if (ask > 0) "今天问了 $ask 次，$yes 次你选了先做事 👍" else "打开游戏时捞捞会问你一句；点这里可以关掉")
            .setContentIntent(pi).setOngoing(true).setShowWhen(false).build()
    }
}

/** 后台看一眼最上面是哪个 App（只在手机上判断，不记录） */
class GuardService : Service() {
    private val h = Handler(Looper.getMainLooper())
    private var lastPkg = ""; private var lastAt = 0L; private var asked = ""; private var askedAt = 0L
    private lateinit var watch: Set<String>; private var watchAt = 0L
    private val loop = object : Runnable {
        override fun run() {
            val interactive = try { (getSystemService(Context.POWER_SERVICE) as PowerManager).isInteractive } catch (_: Exception) { true }
            if (interactive) check()
            h.postDelayed(this, if (interactive) 1500 else 10_000)
        }
    }
    override fun onBind(i: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate(); Store.init(this)
        val n = Guard.note(this)
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(Guard.NOTE_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(Guard.NOTE_ID, n)
        } catch (_: Exception) { stopSelf(); return }
        h.post(loop)
    }
    override fun onStartCommand(i: Intent?, flags: Int, id: Int): Int {
        if (!Guard.ready(this)) { stopSelf(); return START_NOT_STICKY }
        watchAt = 0
        return START_STICKY
    }
    override fun onDestroy() { h.removeCallbacks(loop); super.onDestroy() }

    private fun check() {
        if (!Guard.ready(this)) { stopSelf(); return }
        val now = System.currentTimeMillis()
        if (now - watchAt > 60_000) { watch = Guard.apps(this); watchAt = now }
        val usm = getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
        val ev = try { usm.queryEvents(maxOf(lastAt, now - 5000), now) } catch (_: Exception) { return }
        val e = UsageEvents.Event(); var top = ""
        while (ev.hasNextEvent()) { ev.getNextEvent(e); if (e.eventType == 1 /* ACTIVITY_RESUMED */) { top = e.packageName ?: ""; lastAt = e.timeStamp + 1 } }
        if (top.isEmpty() || top == lastPkg) return
        lastPkg = top
        if (top !in watch || Guard.snoozed(top)) return
        if (top == asked && now - askedAt < 60_000) return
        asked = top; askedAt = now
        Guard.stat("ask")
        try { startActivity(Intent(this, GuardAsk::class.java).putExtra("pkg", top).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_ANIMATION or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)) } catch (_: Exception) {}
        try { (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(Guard.NOTE_ID, Guard.note(this)) } catch (_: Exception) {}
    }
}

/** 盖在游戏上面的那一句「先做 5 分钟再玩？」 */
class GuardAsk : Activity() {
    override fun onCreate(s: Bundle?) {
        super.onCreate(s)
        Store.init(this)
        val pkg = intent.getStringExtra("pkg") ?: run { finish(); return }
        val name = Guard.label(this, pkg)
        window.setBackgroundDrawable(ColorDrawable(0xB3000000.toInt()))
        val root = FrameLayout(this).apply { setOnClickListener { } }
        val card = col().apply {
            gravity = Gravity.CENTER_HORIZONTAL; pad(24, 26, 24, 20)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF2E1065.toInt(), 0xFF111827.toInt())).apply { cornerRadius = dp(28).toFloat(); setStroke(dp(1), 0x33FFFFFF) }
            elevation = dp(20).toFloat()
        }
        try { card.addView(ImageView(this).apply { setImageDrawable(packageManager.getApplicationIcon(pkg)) }, LinearLayout.LayoutParams(dp(56), dp(56))) } catch (_: Exception) {}
        card.addView(text("要打开「$name」了", 14f, 0xFFC4B5FD.toInt(), SEMI).apply { gravity = Gravity.CENTER; pad(0, 10, 0, 0) })
        val h = java.time.LocalTime.now(T.BJ).hour
        card.addView(text(if (h >= 23 || h < 5) "夜深了，玩一会儿就睡吧 🌙" else "先做 5 分钟再玩？", 24f, Color.WHITE, HEAVY).apply { gravity = Gravity.CENTER; pad(0, 6, 0, 6) })
        val (ask, yes) = Guard.stat()
        val streak = try { if (Coach.on()) Coach.streak(Coach.model(), System.currentTimeMillis()).days else 0 } catch (_: Exception) { 0 }
        val sub = listOfNotNull("做完一张卡有机会掉宝贝 🎁", if (streak > 0) "已经连续 $streak 天 🔥" else null, if (yes > 0) "今天已经 $yes 次选了先做事 👍" else null).joinToString(" · ")
        card.addView(text(sub, 13f, 0xFFCBD5E1.toInt()).apply { gravity = Gravity.CENTER; setLineSpacing(0f, 1.4f) })
        val go = text("好，先做 5 分钟", 16f, Color.WHITE, BOLD).apply {
            gravity = Gravity.CENTER; pad(18, 13)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF8B5CF6.toInt(), 0xFFEC4899.toInt())).apply { cornerRadius = dp(18).toFloat() }
            tap {
                Guard.stat("yes"); Guard.snooze(pkg, 20)
                startActivity(Intent(this@GuardAsk, Main::class.java).putExtra("go", "flow").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
                finish()
            }
        }
        card.addView(go, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(20) })
        card.addView(text("这次先玩（30 分钟内不再问）", 13.5f, 0xFF94A3B8.toInt(), SEMI).apply {
            gravity = Gravity.CENTER; pad(12, 12)
            tap { Guard.snooze(pkg, 30); finish() }
        }, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) })
        root.addView(card, FrameLayout.LayoutParams(minOf(resources.displayMetrics.widthPixels - dp(40), dp(400)), FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
        setContentView(root)
        card.scaleX = 0.85f; card.scaleY = 0.85f; card.alpha = 0f
        card.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(260).setInterpolator(android.view.animation.OvershootInterpolator(1.4f)).start()
    }
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() { intent.getStringExtra("pkg")?.let { Guard.snooze(it, 30) }; finish() }
    override fun onPause() { super.onPause(); if (!isFinishing) finish() }
}
