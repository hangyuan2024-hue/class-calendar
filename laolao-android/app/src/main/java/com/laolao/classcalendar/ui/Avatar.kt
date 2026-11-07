package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import com.laolao.classcalendar.core.Api
import com.laolao.classcalendar.core.ApiError
import com.laolao.classcalendar.core.Kv
import com.laolao.classcalendar.core.jsonOf
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/**
 * 7.x 自己的头像（和小程序 1.23、网站同一份，数据库 7.23 的 user_avatars）：
 * 200×200 左右的 JPEG（base64），本机缓存一份（my_avatar_v1，和小程序同名），打开「我的」不用等。
 */
object Avatar {
    private const val LS = "my_avatar_v1"
    private var memo: Pair<String, Bitmap?>? = null

    private fun data(): String { val o = Kv.obj(LS); val uid = Api.uid ?: return ""; return if (o.optString("uid") == uid) o.optString("img") else "" }
    private fun decode(d: String): Bitmap? = try { val b = Base64.decode(d.substringAfter(","), Base64.DEFAULT); if (b.isEmpty()) null else BitmapFactory.decodeByteArray(b, 0, b.size) } catch (_: Exception) { null }

    /** 本机缓存的头像（没有就 null） */
    fun mine(): Bitmap? {
        val d = data(); if (d.isEmpty()) return null
        memo?.let { if (it.first == d) return it.second }
        return decode(d).also { memo = d to it }
    }

    /** 从服务器拿最新的（后台线程）；返回有没有变化 */
    fun load(): Boolean {
        val uid = Api.uid ?: return false
        val old = data()
        val img = try { ((Api.rpc("avatar_get", JSONObject()) as? JSONObject)?.optJSONObject(uid)?.optString("img") ?: "") } catch (_: Exception) { return false }   // 后台还没执行 7.23：用本机的
        if (img != old) Kv.setQuiet(LS, jsonOf("uid" to uid, "img" to img))
        return img != old
    }

    /** 换头像（后台线程）：从中间裁成正方形，压到 200×200，不超过 11 万字 */
    fun set(ctx: Context, u: Uri) {
        val raw = Media.jpeg(ctx, u, 600, 90)
        val bm = BitmapFactory.decodeByteArray(raw, 0, raw.size) ?: throw ApiError(0, "读不了这张图片")
        val side = minOf(bm.width, bm.height)
        val sq = Bitmap.createScaledBitmap(Bitmap.createBitmap(bm, (bm.width - side) / 2, (bm.height - side) / 2, side, side), 200, 200, true)
        var img = ""
        for (q in listOf(82, 60, 40)) {
            val out = ByteArrayOutputStream(); sq.compress(Bitmap.CompressFormat.JPEG, q, out)
            img = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
            if (img.length <= 110000) break
        }
        if (img.length > 110000) throw ApiError(0, "图片太大了，换一张小一点的")
        try { Api.rpc("avatar_set", jsonOf("img" to img)) }
        catch (e: Exception) { throw if (Regex("avatar_set|PGRST202|Could not find").containsMatchIn(e.message ?: "")) ApiError(0, "头像功能暂未开通，请联系管理员") else e }
        Kv.setQuiet(LS, jsonOf("uid" to Api.uid, "img" to img))
    }
    fun clear() { Api.rpc("avatar_set", jsonOf("img" to "")); Kv.setQuiet(LS, jsonOf("uid" to Api.uid, "img" to "")) }

    /** 自己的头像：有图片显示图片，没有显示名字第一个字（渐变底） */
    fun view(ctx: Context, name: String, gender: String, radiusDp: Int): View {
        val bm = mine()
        val r = ctx.dp(radiusDp).toFloat()
        if (bm != null) return ImageView(ctx).apply {
            setImageBitmap(bm); scaleType = ImageView.ScaleType.CENTER_CROP
            background = GradientDrawable().apply { cornerRadius = r; setColor(C.card) }; clipToOutline = true
            contentDescription = "我的头像"
        }
        return ctx.text(name.take(1).ifEmpty { "?" }, 22f, Color.WHITE, BOLD).apply {
            gravity = Gravity.CENTER
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, if (gender == "f") intArrayOf(C.c("#ff9ac1"), C.c("#ff5f8f")) else intArrayOf(C.mix(C.accent, Color.WHITE, 0.25f), C.accent)).apply { cornerRadius = r }
        }
    }
}
