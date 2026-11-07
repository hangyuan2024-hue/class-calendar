package com.laolao.classcalendar.ui

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.Drawable
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import com.laolao.classcalendar.R

/**
 * 全 App 的功能图标统一放在这里（7.x）。
 *
 * 以前每个页面直接写表情符号（📚、🎯、⏳…）当图标：不同手机字体画出来大小、风格都不一样，老手机还会显示成空白方块。
 * 现在页面里照旧写原来的表情，当作图标的「名字」；画的时候查下面这张表，换成同一套线条图标（Lucide，ISC 许可，
 * 和底部导航栏是同一个风格）+ 统一的配色小方块。表里没有的，才照旧显示表情。
 *
 * 要换某个图标或颜色：只改这张表。要加新图标：从 https://lucide.dev 挑一个，
 * 把 SVG 转成 res/drawable/ic_l_名字.xml（同目录下的文件都是这么来的），再在表里加一行。
 */
object Ic {
    /** 一类功能一个颜色：B 蓝 · I 主题色 · G 绿 · O 橙 · R 红 · P 粉 · V 紫 · T 青 · A 琥珀 · S 灰 */
    fun color(k: Char): Int = when (k) {
        'B' -> 0xFF3B82F6.toInt(); 'I' -> C.accent; 'G' -> 0xFF16A34A.toInt(); 'O' -> 0xFFF97316.toInt()
        'R' -> 0xFFEF4444.toInt(); 'P' -> 0xFFEC4899.toInt(); 'V' -> 0xFF8B5CF6.toInt(); 'T' -> 0xFF0D9488.toInt()
        'A' -> 0xFFD97706.toInt(); else -> 0xFF64748B.toInt()
    }

    class Def(val emoji: String, val res: Int, val key: Char)

    private val ALL = listOf(
        Def("📚", R.drawable.ic_l_book_open, 'I'),   // 课程表
        Def("📘", R.drawable.ic_l_book, 'B'),   // 课程
        Def("📖", R.drawable.ic_l_book_open_text, 'G'),   // 单词 / 功能介绍
        Def("📕", R.drawable.ic_l_book_bookmark, 'R'),   // 错题本
        Def("📒", R.drawable.ic_l_notebook, 'A'),   // 备忘录
        Def("📝", R.drawable.ic_l_notebook_pen, 'O'),   // 作业 / 日记
        Def("✏️", R.drawable.ic_l_pencil, 'O'),   // 编辑 / 记一件事
        Def("✍️", R.drawable.ic_l_pen_line, 'O'),   // 手写 / 填写
        Def("📋", R.drawable.ic_l_clipboard_list, 'T'),   // 导入 / 清单
        Def("🎓", R.drawable.ic_l_graduation_cap, 'I'),   // 学校 / 复习排期
        Def("🏫", R.drawable.ic_l_school, 'I'),   // 班级
        Def("🧩", R.drawable.ic_l_puzzle, 'V'),   // 大作业拆解 / 小组件
        Def("🐸", R.drawable.ic_l_list_todo, 'G'),   // 时间管理大师
        Def("🎯", R.drawable.ic_l_target, 'R'),   // 规划与专注
        Def("🏹", R.drawable.ic_l_goal, 'R'),   // 目标
        Def("🍅", R.drawable.ic_l_timer, 'R'),   // 番茄钟
        Def("⏱", R.drawable.ic_l_timer, 'B'),   // 计时
        Def("⏳", R.drawable.ic_l_hourglass, 'A'),   // 倒计时 / 等待
        Def("⏰", R.drawable.ic_l_alarm_clock, 'O'),   // 提醒时间
        Def("🕘", R.drawable.ic_l_clock, 'B'),   // 时间
        Def("📅", R.drawable.ic_l_calendar, 'B'),   // 日历
        Def("🗓", R.drawable.ic_l_calendar_days, 'B'),   // 日期
        Def("📲", R.drawable.ic_l_calendar_plus, 'B'),   // 加到手机日历
        Def("💬", R.drawable.ic_l_message_circle, 'G'),   // 班级墙 / 一句话记事
        Def("👥", R.drawable.ic_l_users, 'B'),   // 成员
        Def("👤", R.drawable.ic_l_user, 'S'),   // 个人
        Def("✨", R.drawable.ic_l_sparkles, 'V'),   // 整理群消息
        Def("✦", R.drawable.ic_l_sparkle, 'V'),   // 神谕阁
        Def("📢", R.drawable.ic_l_megaphone, 'R'),   // 发布 / 通知
        Def("🏆", R.drawable.ic_l_trophy, 'A'),   // 排行榜
        Def("🏅", R.drawable.ic_l_medal, 'O'),   // 等级与徽章
        Def("⭐", R.drawable.ic_l_star, 'A'),   // 收藏 / 星标
        Def("📊", R.drawable.ic_l_chart_column, 'B'),   // 统计
        Def("📈", R.drawable.ic_l_trending_up, 'G'),   // 成长
        Def("🔥", R.drawable.ic_l_flame, 'O'),   // 打卡 / 连续
        Def("⚡", R.drawable.ic_l_zap, 'A'),   // 成长值 / 快速
        Def("💡", R.drawable.ic_l_lightbulb, 'A'),   // 问问捞捞
        Def("🤔", R.drawable.ic_l_circle_question_mark, 'S'),   // 疑问
        Def("🐣", R.drawable.ic_l_sprout, 'G'),   // 云宠农场
        Def("🎉", R.drawable.ic_l_party_popper, 'P'),   // 趣味 / 庆祝
        Def("🎲", R.drawable.ic_l_dices, 'V'),   // 随机抽签
        Def("💳", R.drawable.ic_l_wallet, 'G'),   // 记账本
        Def("📷", R.drawable.ic_l_camera, 'B'),   // 拍照导入
        Def("🖼", R.drawable.ic_l_image, 'V'),   // 图片
        Def("📄", R.drawable.ic_l_file_text, 'S'),   // 文件
        Def("📎", R.drawable.ic_l_paperclip, 'S'),   // 附件
        Def("📌", R.drawable.ic_l_pin, 'R'),   // 置顶 / 班级墙
        Def("📍", R.drawable.ic_l_map_pin, 'R'),   // 地点 / 签到
        Def("🎒", R.drawable.ic_l_backpack, 'O'),   // 要带的东西
        Def("🏷", R.drawable.ic_l_tag, 'V'),   // 标签
        Def("🔍", R.drawable.ic_l_search, 'S'),   // 搜索
        Def("👀", R.drawable.ic_l_eye, 'B'),   // 查看
        Def("🙈", R.drawable.ic_l_eye_off, 'S'),   // 隐藏
        Def("↗", R.drawable.ic_l_external_link, 'S'),   // 打开
        Def("🗑", R.drawable.ic_l_trash, 'R'),   // 删除
        Def("🚫", R.drawable.ic_l_ban, 'R'),   // 不允许
        Def("✅", R.drawable.ic_l_circle_check, 'G'),   // 完成
        Def("⏸", R.drawable.ic_l_pause, 'S'),   // 暂停
        Def("➕", R.drawable.ic_l_plus, 'I'),   // 添加
        Def("＋", R.drawable.ic_l_plus, 'I'),   // 添加（全角加号）
        Def("🔁", R.drawable.ic_l_repeat, 'T'),   // 重复 / 调课
        Def("🔄", R.drawable.ic_l_refresh_ccw, 'T'),   // 刷新
        Def("↻", R.drawable.ic_l_refresh_cw, 'T'),   // 刷新
        Def("☕", R.drawable.ic_l_coffee, 'A'),   // 空闲
        Def("💤", R.drawable.ic_l_moon, 'I'),   // 休息
        Def("📥", R.drawable.ic_l_inbox, 'T'),   // 收集 / 导入
        Def("📭", R.drawable.ic_l_inbox, 'S'),   // 空
        Def("📤", R.drawable.ic_l_upload, 'B'),   // 导出
        Def("☁️", R.drawable.ic_l_cloud, 'B'),   // 云端同步
        Def("🗄", R.drawable.ic_l_archive, 'T'),   // 备份与恢复
        Def("🎨", R.drawable.ic_l_palette, 'P'),   // 外观
        Def("🧭", R.drawable.ic_l_compass, 'T'),   // 捞捞教练
        Def("🗂️", R.drawable.ic_l_folder_open, 'I'),   // 规划页
        Def("🔔", R.drawable.ic_l_bell, 'A'),   // 提醒与通知
        Def("📧", R.drawable.ic_l_mail, 'B'),   // 邮箱
        Def("📮", R.drawable.ic_l_mailbox, 'R'),   // 邮箱 / 发件
        Def("✉️", R.drawable.ic_l_mail_open, 'P'),   // 信箱
        Def("🔐", R.drawable.ic_l_lock, 'S'),   // 账号与安全
        Def("🔑", R.drawable.ic_l_key_round, 'A'),   // 密码
        Def("🚪", R.drawable.ic_l_log_out, 'R'),   // 退出
        Def("🧑\u200D🏫", R.drawable.ic_l_life_buoy, 'T'),   // 找老师帮忙
        Def("🎛️", R.drawable.ic_l_sliders_horizontal, 'I'),   // 功能开关
        Def("⚙️", R.drawable.ic_l_settings, 'S'),   // 设置 / 后台
        Def("🧰", R.drawable.ic_l_layout_grid, 'I'),   // 工具
        Def("💻", R.drawable.ic_l_laptop, 'B'),   // 电脑版
        Def("💛", R.drawable.ic_l_heart, 'P'),   // 感谢
        Def("🌐", R.drawable.ic_l_globe, 'T'),   // 网络线路
        Def("⬆️", R.drawable.ic_l_circle_arrow_up, 'G'),   // 检查更新
        Def("🔋", R.drawable.ic_l_battery_charging, 'G'),   // 省电
        Def("🚀", R.drawable.ic_l_rocket, 'V'),   // 加速
        Def("⇅", R.drawable.ic_l_arrow_left_right, 'S'),   // 切换班级
        Def("⊞", R.drawable.ic_l_layout_grid, 'B'),   // 自定义首页
        Def("🏃", R.drawable.ic_l_footprints, 'G'),   // 跑步
        Def("💧", R.drawable.ic_l_droplet, 'B'),   // 喝水
        Def("🧘", R.drawable.ic_l_flower_2, 'P'),   // 冥想
        Def("🎹", R.drawable.ic_l_piano, 'V'),   // 练琴
        Def("😴", R.drawable.ic_l_moon, 'I'),   // 早睡
        Def("🍎", R.drawable.ic_l_apple, 'R'),   // 吃水果
        Def("🗣️", R.drawable.ic_l_languages, 'T'),   // 背单词 / 口语
        Def("💪", R.drawable.ic_l_dumbbell, 'O'),   // 健身
        Def("🧹", R.drawable.ic_l_brush_cleaning, 'A'),   // 打扫
        Def("🧠", R.drawable.ic_l_brain, 'P'),   // 思考
        Def("🌱", R.drawable.ic_l_sprout, 'G'),   // 成长
        Def("☀️", R.drawable.ic_l_sun, 'O'),   // 早起
        Def("☰", R.drawable.ic_l_menu, 'S'),   // 侧边栏
    )
    private fun norm(s: String) = s.replace("️", "").trim()
    private val BY: Map<String, Def> by lazy { ALL.associateBy { norm(it.emoji) } }

    fun find(e: String): Def? = BY[norm(e)]
    fun has(e: String): Boolean = find(e) != null
    /** 深色模式下颜色提亮一点，不然在深色底上发闷 */
    fun tone(c: Int): Int = if (C.dark) C.mix(c, Color.WHITE, 0.22f) else c
    fun colorOf(e: String): Int = find(e)?.let { tone(color(it.key)) } ?: C.sub

    fun drawable(ctx: Context, e: String, tint: Int? = null): Drawable? {
        val d = find(e) ?: return null
        val dr = ctx.getDrawable(d.res)?.mutate() ?: return null
        dr.setTint(tint ?: tone(color(d.key)))
        return dr
    }

    /**
     * 带浅色底的方块图标（工具卡片、设置列表、入口卡片）。调用的地方给它 size × size 的位置。
     * 表里没有的表情：照旧显示表情，大小和以前差不多。
     */
    fun tile(ctx: Context, e: String, size: Int = 36): View {
        val d = find(e) ?: return ctx.text(e, size * 0.52f).apply { gravity = Gravity.CENTER }
        val c = tone(color(d.key))
        return ImageView(ctx).apply {
            setImageDrawable(drawable(ctx, e, c)); scaleType = ImageView.ScaleType.FIT_CENTER
            val p = ctx.dp(size * 0.24f); setPadding(p, p, p, p)
            background = round(C.alpha(c, if (C.dark) 0.2f else 0.12f), ctx.dp(size * 0.3f).toFloat())
            contentDescription = null
        }
    }

    /** 不带底色的图标（菜单、小胶囊、按钮里）。tint 不给就用这个图标自己的颜色 */
    fun plain(ctx: Context, e: String, size: Int = 18, tint: Int? = null): View {
        if (find(e) == null) return ctx.text(e, size * 0.9f).apply { gravity = Gravity.CENTER }
        return ImageView(ctx).apply { setImageDrawable(drawable(ctx, e, tint)); scaleType = ImageView.ScaleType.FIT_CENTER }
    }

    /**
     * 文字最前面的表情换成图标：「📚 今天 3 节课」→ [书] 今天 3 节课。
     * 开头不是表里的表情就什么都不改。tint 不给就和文字同色（胶囊里更协调）；own = true 用图标自己的颜色（标题里）。
     */
    fun lead(tv: TextView, size: Int = 15, tint: Int? = null, own: Boolean = false): TextView {
        val s = tv.text?.toString() ?: return tv
        val sp = s.indexOf(' ')
        if (sp <= 0 || sp > 6) return tv
        val e = s.substring(0, sp)
        val dr = drawable(tv.context, e, tint ?: if (own) null else tv.currentTextColor) ?: return tv
        val px = tv.context.dp(size)
        dr.setBounds(0, 0, px, px)
        tv.text = s.substring(sp + 1)
        tv.setCompoundDrawablesRelative(dr, null, null, null)
        tv.compoundDrawablePadding = tv.context.dp(5)
        tv.gravity = tv.gravity or Gravity.CENTER_VERTICAL
        return tv
    }

    /** 搜索框前面放一个放大镜线条图标（代替以前写在提示文字里的 🔍） */
    fun search(et: TextView, size: Int = 17): TextView {
        val dr = drawable(et.context, "🔍", C.sub) ?: return et
        val px = et.context.dp(size); dr.setBounds(0, 0, px, px)
        et.setCompoundDrawablesRelative(dr, null, null, null); et.compoundDrawablePadding = et.context.dp(8)
        return et
    }
}
