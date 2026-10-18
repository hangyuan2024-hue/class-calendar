package com.laolao.classcalendar.core

import java.io.InputStream
import java.util.zip.ZipInputStream

/**
 * 6.3 直接导入文稿：Word 文档（.docx）→ 一行行字，全在手机上读，不上传。
 * 和网页 / 小程序 / 电脑版的 docx-text.js 同一套规则：正文一段一行；表格每一行输出成一行（格子之间空一格）。
 */
object DocxText {
    fun read(input: InputStream): String {
        val head = ByteArray(4)
        val buf = input.buffered()
        buf.mark(8); val n = buf.read(head); buf.reset()
        if (n >= 2 && head[0] == 0xD0.toByte() && head[1] == 0xCF.toByte()) throw ApiError(0, "这是老版本的 .doc 文件，请在 Word / WPS 里另存为 .docx 再导入")
        if (n >= 2 && head[0] == 0x25.toByte() && head[1] == 0x50.toByte()) throw ApiError(0, "PDF 暂时不能直接导入：截图后用「截图识别」，或者复制里面的文字粘贴进来")
        ZipInputStream(buf).use { z ->
            while (true) {
                val e = z.nextEntry ?: break
                if (e.name == "word/document.xml") return xmlText(z.readBytes().toString(Charsets.UTF_8))
            }
        }
        throw ApiError(0, "不是 Word 文档（.docx）")
    }

    private fun unxml(s: String) = s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'")
        .replace(Regex("&#(\\d+);")) { it.groupValues[1].toInt().toChar().toString() }.replace("&amp;", "&")

    fun xmlText(xml: String): String {
        val body = Regex("<w:body[\\s\\S]*</w:body>").find(xml)?.value ?: xml
        val re = Regex("<w:tbl[ >]|</w:tbl>|<w:tr[ >]|</w:tr>|<w:tc[ >]|</w:tc>|<w:p[ >]|<w:p/>|</w:p>|<w:t(?: [^>]*)?>([\\s\\S]*?)</w:t>|<w:tab/>|<w:br/>|<w:cr/>")
        val out = mutableListOf<String>(); var depth = 0; var para = StringBuilder(); var row: MutableList<String>? = null; var cell = StringBuilder()
        fun endPara() {
            val p = para.toString().trim()
            if (depth > 0) { if (cell.isNotEmpty() && p.isNotEmpty()) cell.append(' '); cell.append(p) }
            else if (p.isNotEmpty()) out += p
            para = StringBuilder()
        }
        for (m in re.findAll(body)) {
            val t = m.value
            when {
                t.startsWith("<w:tbl") -> { if (depth == 0) endPara(); depth++ }
                t == "</w:tbl>" -> depth = maxOf(0, depth - 1)
                t.startsWith("<w:tr") -> if (depth == 1) row = mutableListOf()
                t == "</w:tr>" -> if (depth == 1 && row != null) { val line = row!!.joinToString(" ").replace(Regex("\\s+"), " ").trim(); if (line.isNotEmpty()) out += line; row = null }
                t.startsWith("<w:tc") -> if (depth == 1) cell = StringBuilder()
                t == "</w:tc>" -> if (depth == 1 && row != null) { row!!.add(cell.toString().replace(Regex("\\s+"), " ").trim().ifEmpty { "-" }); cell = StringBuilder() }
                t == "</w:p>" || t == "<w:p/>" -> endPara()
                t.startsWith("<w:p") -> {}
                t == "<w:tab/>" -> para.append(' ')
                t == "<w:br/>" || t == "<w:cr/>" -> if (depth > 0) para.append(' ') else endPara()
                else -> para.append(unxml(m.groupValues[1]))
            }
        }
        endPara()
        return out.joinToString("\n")
    }
}
