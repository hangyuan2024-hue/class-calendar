package com.laolao.classcalendar.ui

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.LinearLayout
import com.laolao.classcalendar.core.Bg
import com.laolao.classcalendar.core.Courses
import com.laolao.classcalendar.core.Items
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.Store
import com.laolao.classcalendar.core.T
import com.laolao.classcalendar.core.str
import org.json.JSONObject
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.sin

/**
 * 7.x App 开着时的提醒（照小程序 1.22 / 1.23 alert.js 搬过来，设置同名 alert_opts_v1）：
 *  ① 老师、班委发了新事项 → 专属提示音（上扬和弦）+ 震动 + 顶部横幅，点横幅打开那一条
 *  ② 作业快截止（默认前 30 分钟）、会议活动快开始（前 15 分钟）→ 另一种提示音（双音脉冲）+ 横幅，每件只响一次
 *  ③ 班委发起签到 → 签到提示音（扫描声 + 确认和弦）+ 横幅
 *  上课时间不出声（按课程表），只震动、弹横幅。App 关着时靠系统通知（RemindPage 那些），这里不管。
 */
object InAlert {
    private const val LS_OPT = "alert_opts_v1"; private const val LS_MAX = "alert_max_v1"; private const val LS_DUE = "alert_due_v1"
    private val DEF = JSONObject().put("sound", true).put("ckSound", true).put("classMute", true).put("vibrate", true).put("banner", true).put("due", true).put("lead", 30)
    fun opts(): JSONObject { val o = JSONObject(DEF.toString()); val s = Kv.obj(LS_OPT); s.keys().forEach { o.put(it, s.opt(it)) }; return o }
    fun set(k: String, v: Any) { val s = Kv.obj(LS_OPT); s.put(k, v); Kv.setQuiet(LS_OPT, s) }

    // ---------- 声音：现场合成，不用放音频文件 ----------
    private var lastSound = 0L
    private fun tone(freqs: List<Pair<Double, Int>>, gapMs: Int = 30): ShortArray {
        val sr = 22050; val out = ArrayList<Short>()
        for ((f, ms) in freqs) {
            val n = sr * ms / 1000
            for (i in 0 until n) {
                val t = i.toDouble() / sr
                val env = minOf(1.0, i / (sr * 0.008)) * exp(-3.2 * t / (ms / 1000.0))      // 起音快、慢慢消失
                val v = (sin(2 * PI * f * t) * 0.55 + sin(2 * PI * f * 2 * t) * 0.18) * env
                out += (v * 26000).toInt().toShort()
            }
            repeat(sr * gapMs / 1000) { out += 0 }
        }
        return out.toShortArray()
    }
    private val SOUNDS by lazy {
        mapOf(
            "new" to tone(listOf(784.0 to 110, 988.0 to 110, 1319.0 to 260)),          // 叮咚咚：上扬和弦
            "due" to tone(listOf(880.0 to 140, 880.0 to 220), 90),                       // 当当：双音脉冲
            "ck" to tone(listOf(660.0 to 70, 880.0 to 70, 1100.0 to 70, 1320.0 to 240)))  // 扫描声 + 确认
    }
    fun inClass(): Boolean = try {
        val now = T.now(); val m = now.hour * 60 + now.minute
        Courses.on(T.todayKey()).any { (it.m0 ?: 9999) <= m && m <= (it.m1 ?: -1) }
    } catch (_: Exception) { false }
    fun play(kind: String, force: Boolean = false) {
        val o = opts()
        if (!force && (!o.optBoolean("sound") || (kind == "ck" && !o.optBoolean("ckSound")) || (o.optBoolean("classMute") && inClass()))) return
        if (!force && System.currentTimeMillis() - lastSound < 2500) return
        lastSound = System.currentTimeMillis()
        val pcm = SOUNDS[kind] ?: return
        Bg.run {
            try {
                val t = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                    .setAudioFormat(AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(22050).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
                    .setBufferSizeInBytes(pcm.size * 2).setTransferMode(AudioTrack.MODE_STATIC).build()
                t.write(pcm, 0, pcm.size); t.play()
                Thread.sleep(pcm.size * 1000L / 22050 + 200); t.release()
            } catch (_: Exception) {}
        }
    }
    fun buzz(ctx: Context, kind: String) {
        if (!opts().optBoolean("vibrate")) return
        try {
            val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            val p = if (kind == "due") longArrayOf(0, 260, 140, 120) else longArrayOf(0, 380, 160, 120, 90, 120)
            if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(p, -1)) else @Suppress("DEPRECATION") v.vibrate(p, -1)
        } catch (_: Exception) {}
    }

    // ---------- 顶部横幅：从顶上滑下来，7 秒后收起，点一下打开 ----------
    private var cur: View? = null
    fun banner(a: Main, icon: String, title: String, sub: String, hot: Boolean = false, go: () -> Unit) {
        if (!opts().optBoolean("banner")) return
        val root = a.findViewById<FrameLayout>(android.R.id.content) ?: return
        cur?.let { root.removeView(it) }
        val v = a.row().apply {
            gravity = Gravity.CENTER_VERTICAL; pad(14, 12, 14, 12)
            background = round(C.card, a.dp(18).toFloat(), if (hot) C.alpha(C.red, 0.4f) else C.line, a.dp(1)); elevation = a.dp(10).toFloat()
            addView(Ic.tile(a, icon, 38), LinearLayout.LayoutParams(a.dp(38), a.dp(38)))
            addView(a.col().apply {
                addView(a.text(title, 14.5f, C.text, BOLD, 1))
                if (sub.isNotEmpty()) addView(a.text(sub, 12.5f, C.sub, lines = 2).apply { margins(t = 2) })
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { leftMargin = a.dp(12) })
            addView(a.text("×", 18f, C.sub).apply { gravity = Gravity.CENTER; tap { dismiss(root, this@apply) } }, LinearLayout.LayoutParams(a.dp(32), a.dp(32)))
        }
        v.setOnClickListener { dismiss(root, v); go() }
        val top = (a.window.decorView.rootWindowInsets?.systemWindowInsetTop ?: a.dp(24)) + a.dp(8)
        root.addView(v, FrameLayout.LayoutParams(-1, -2, Gravity.TOP).apply { leftMargin = a.dp(12); rightMargin = a.dp(12); topMargin = top })
        cur = v
        v.translationY = -a.dp(140).toFloat(); v.animate().translationY(0f).setDuration(320).start()
        v.postDelayed({ dismiss(root, v) }, 7000)
    }
    private fun dismiss(root: FrameLayout, v: View) {
        if (v.parent == null) return
        v.animate().translationY(-v.height.toFloat() - 60).alpha(0f).setDuration(220).withEndAction { root.removeView(v); if (cur === v) cur = null }.start()
    }

    // ---------- 检查：数据刷新后、每 30 秒一次（Main 里调） ----------
    fun check(a: Main) {
        if (Store.me == null) return
        val cid = Store.cls?.str("id") ?: ""
        val all = try { Items.all() } catch (_: Exception) { return }
        // ① 新事项：按「上次响过的最大编号」算，不会重复响；第一次只记下来不响
        if (cid.isNotEmpty()) {
            val cls = all.filter { !it.mine && !it.course && it.id.toLongOrNull() != null }
            val mx = cls.maxOfOrNull { it.id.toLong() } ?: 0L
            val m = Kv.obj(LS_MAX); val last = m.optLong(cid, -1L)
            if (last < 0 || mx < last) { m.put(cid, mx); Kv.setQuiet(LS_MAX, m) }
            else if (mx > last) {
                val fresh = cls.filter { it.id.toLong() > last && !it.done }.sortedByDescending { it.id.toLong() }
                m.put(cid, mx); Kv.setQuiet(LS_MAX, m)
                if (fresh.isNotEmpty()) {
                    val f = fresh[0]
                    play("new"); buzz(a, "new")
                    banner(a, if (f.hw) "📝" else "📢", (if (fresh.size > 1) "班级新发布 ${fresh.size} 条：" else "班级新发布：") + f.title,
                        listOf(typeName(f.type), if (f.dated) T.md(f.day) + " " + f.time else "", f.sub).filter { it.isNotBlank() }.joinToString(" · ")) { a.push(ItemPage(a, f.key)) }
                    return
                }
            }
        }
        // ② 快截止 / 快开始：每件只响一次
        val o = opts(); if (!o.optBoolean("due")) return
        val now = System.currentTimeMillis(); val lead = o.optInt("lead", 30) * 60_000L
        val seen = Kv.obj(LS_DUE); val t0 = T.todayKey()
        for (k in seen.keys().asSequence().toList()) if (seen.optString(k) < T.addDays(t0, -2L)) seen.remove(k)
        val hit = all.filter { r ->
            if (r.done || r.course || !r.dated || r.time.isEmpty() || seen.has(r.key)) return@filter false
            val left = r.at() - now
            if (r.hw) left in 1..lead else (r.type == "会议" || r.type == "活动" || r.mine) && left in 1..15 * 60_000L
        }.minByOrNull { it.at() } ?: return
        seen.put(hit.key, t0); Kv.setQuiet(LS_DUE, seen)
        val mins = ((hit.at() - now) / 60_000L).coerceAtLeast(1)
        play("due"); buzz(a, "due")
        banner(a, if (hit.hw) "⏳" else "⏰", if (hit.hw) "作业还有 $mins 分钟截止：${hit.title}" else "还有 $mins 分钟开始：${hit.title}", listOf(hit.time, hit.location).filter { it.isNotBlank() }.joinToString(" · "), hot = hit.hw) { a.push(ItemPage(a, hit.key)) }
    }
    /** ③ 签到开始（Checkin.open 变了时调） */
    private var ckSeen = 0L
    fun checkin(a: Main, o: JSONObject?) {
        val id = o?.optLong("id") ?: return
        if (id == ckSeen || o.optJSONObject("mine") != null) { ckSeen = id; return }
        val first = ckSeen == 0L && Kv.obj(LS_MAX).optLong("ck") == id
        ckSeen = id; Kv.setQuiet(LS_MAX, Kv.obj(LS_MAX).put("ck", id))
        if (first) return
        play("ck"); buzz(a, "new")
        banner(a, "📍", "开始签到：" + o.str("title").ifEmpty { "位置签到" }, o.str("place").ifEmpty { "点这里去签到" }, hot = true) { a.push(CheckinPage(a, id)) }
    }
}
