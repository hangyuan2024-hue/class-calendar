package com.laolao.classcalendar.core

/**
 * 7.2 全屏备忘录：富文本（delta）和「我的事项」原来的字段（note 文字 + list 清单）互相转换。
 * 和网页 / 小程序 / 电脑版的 note-core.js 同一套规则（测试用同样的例子，和 node 跑出来逐字一样）。
 *   rich: { d: [delta ops], s: 保存时 note + list 的指纹, f: { 图片编号: 云端附件 id } }
 * 指纹 s = JSON.stringify([note, [[t, d], …]])：quote() 照着 JavaScript 的 JSON.stringify 转义，三端算出来一样。
 * 这里只放纯算法（不碰 org.json，电脑上就能测）；和 JSON 互转在 NoteJson。
 */
object NoteCore {
    /** 一个 delta 操作：文字（text）或嵌入（embed：{image: 地址} / {divider: true}） */
    class Op(val text: String?, val embed: Map<String, Any?>? = null, val attrs: Map<String, Any?> = emptyMap()) {
        val isImage: Boolean get() = embed?.get("image") != null
        val isDivider: Boolean get() = embed != null && embed.containsKey("divider")
    }
    class Run(val t: String = "", val a: Map<String, Any?>? = null, val img: Op? = null, val hr: Boolean = false)
    class Line(var t: String = "", val imgs: MutableList<Op> = mutableListOf(), val runs: MutableList<Run> = mutableListOf(), var attrs: Map<String, Any?> = emptyMap())
    class Li(val t: String, val d: Boolean)
    class Plain(val note: String, val list: List<Li>, val imgs: List<Op>)

    // JavaScript 的 \s（trim、/\s+$/ 用的就是这一组）
    private const val WS = "\t\n\u000B\u000C\r                  　﻿"
    fun isWs(c: Char) = WS.indexOf(c) >= 0
    fun jsTrim(s: String): String = s.trim { isWs(it) }
    fun jsTrimEnd(s: String): String = s.trimEnd { isWs(it) }

    /** 和 JavaScript 的 JSON.stringify(字符串) 一样 */
    fun quote(s: String): String {
        val b = StringBuilder(s.length + 2).append('"')
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when {
                c == '"' -> b.append("\\\"")
                c == '\\' -> b.append("\\\\")
                c == '\b' -> b.append("\\b")
                c == '\u000C' -> b.append("\\f")
                c == '\n' -> b.append("\\n")
                c == '\r' -> b.append("\\r")
                c == '\t' -> b.append("\\t")
                c < ' ' -> b.append("\\u").append(String.format("%04x", c.code))
                Character.isHighSurrogate(c) -> {
                    if (i + 1 < s.length && Character.isLowSurrogate(s[i + 1])) { b.append(c).append(s[i + 1]); i++ }
                    else b.append("\\u").append(String.format("%04x", c.code))
                }
                Character.isLowSurrogate(c) -> b.append("\\u").append(String.format("%04x", c.code))
                else -> b.append(c)
            }
            i++
        }
        return b.append('"').toString()
    }
    /** 清单按 memo-core.js 的 listOf 整理（去空、去两头空白、最多 100 项、每项 200 字） */
    fun cleanList(raw: List<Li>): List<Li> = raw.filter { jsTrim(it.t).isNotEmpty() }.take(100).map { Li(jsTrim(it.t).take(200), it.d) }
    fun sigOf(note: String, list: List<Li>): String =
        "[" + quote(note) + ",[" + cleanList(list).joinToString(",") { "[" + quote(it.t) + "," + it.d + "]" } + "]]"

    /** 普通文字 + 清单 → delta */
    fun fromPlain(note0: String, list: List<Li>, keepImgs: List<Op> = emptyList()): List<Op> {
        val ops = mutableListOf<Op>()
        val note = note0.replace("\r", "")
        if (note.isNotEmpty()) for (line in note.split("\n")) { if (line.isNotEmpty()) ops += Op(line); ops += Op("\n") }
        for (x in cleanList(list)) { ops += Op(x.t); ops += Op("\n", attrs = mapOf("list" to if (x.d) "checked" else "unchecked")) }
        for (im in keepImgs) { ops += im; ops += Op("\n") }
        if (ops.isEmpty()) ops += Op("\n")
        return ops
    }

    /** delta → 一行一行 */
    fun lines(ops: List<Op>): List<Line> {
        val out = mutableListOf<Line>(); var cur = Line()
        for (op in ops) {
            if (op.text != null) {
                val parts = op.text.split("\n")
                parts.forEachIndexed { i, p ->
                    if (p.isNotEmpty()) { cur.t += p; cur.runs += Run(p, op.attrs.takeIf { it.isNotEmpty() }) }
                    if (i < parts.size - 1) { cur.attrs = op.attrs; out += cur; cur = Line() }
                }
            } else if (op.isImage) { cur.imgs += op; cur.runs += Run(img = op) }
            else if (op.isDivider) { cur.t += "———"; cur.runs += Run(hr = true) }
        }
        if (cur.t.isNotEmpty() || cur.imgs.isNotEmpty()) { cur.attrs = emptyMap(); out += cur }
        return out
    }

    /** delta → { note, list, imgs }（写回原来的字段，老版本能看） */
    fun toPlain(ops: List<Op>): Plain {
        val note = mutableListOf<String>(); val list = mutableListOf<Li>(); val imgs = mutableListOf<Op>(); var n = 0
        for (ln in lines(ops)) {
            imgs += ln.imgs
            val lst = ln.attrs["list"]?.toString() ?: ""
            val t = jsTrimEnd(ln.t)
            if (lst == "checked" || lst == "unchecked") { if (jsTrim(t).isNotEmpty()) list += Li(jsTrim(t).take(200), lst == "checked"); continue }
            var pre = ""
            if (lst == "ordered") { n++; pre = "$n. " } else { n = 0; if (lst == "bullet") pre = "• " }
            if (ln.imgs.isNotEmpty() && jsTrim(t).isEmpty()) { note += "[图片]"; continue }
            note += pre + t
        }
        while (note.isNotEmpty() && jsTrim(note.last()).isEmpty()) note.removeAt(note.size - 1)
        while (note.isNotEmpty() && jsTrim(note.first()).isEmpty()) note.removeAt(0)
        return Plain(note.joinToString("\n").take(5000), list.take(100), imgs)
    }

    /** 有没有「只在全屏页里才看得出来」的东西（格式、图片、手写） */
    fun hasRich(ops: List<Op>): Boolean = ops.any { op -> op.isImage || op.attrs.keys.any { k -> k != "list" || Regex("ordered|bullet").containsMatchIn(op.attrs["list"]?.toString() ?: "") } }
    fun imgCount(ops: List<Op>): Int = ops.count { it.isImage }

    /** 图片上挂的编号（小程序 editor 把 insertImage 的 data 变成 data-custom="k=xxx"） */
    fun imgKey(op: Op): String {
        val c = (op.attrs["data-custom"] ?: op.attrs["dataCustom"] ?: "").toString()
        val m = Regex("(?:^|&)k=([^&]+)").find(c) ?: return ""
        return try { java.net.URLDecoder.decode(m.groupValues[1].replace("+", "%2B"), "UTF-8") } catch (e: Exception) { m.groupValues[1] }
    }
}
