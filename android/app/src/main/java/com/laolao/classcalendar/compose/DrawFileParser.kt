package com.laolao.classcalendar

import java.io.ByteArrayInputStream
import java.nio.ByteBuffer
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction
import java.util.zip.ZipInputStream
import javax.xml.parsers.DocumentBuilderFactory
import org.json.JSONArray
import org.json.JSONObject
import org.w3c.dom.Element

/** Bounded, offline TXT/CSV/JSON/XLSX import. Parsing never modifies the draw pool. */
internal object DrawFileParser {
    const val MAX_BYTES = 8 * 1024 * 1024
    private val headings = setOf("姓名", "名字", "名称", "选项", "抽签选项", "name", "title", "label")

    fun parse(bytes: ByteArray, name: String): List<String> {
        require(bytes.size <= MAX_BYTES) { "文件请小于 8 MB" }
        val ext = name.substringAfterLast('.', "txt").lowercase()
        val raw =
            when (ext) {
                "xlsx" -> xlsx(bytes)
                "json" -> json(decode(bytes))
                "csv",
                "tsv" -> table(csv(decode(bytes), if (ext == "tsv") '\t' else ','))
                "txt",
                "md" -> decode(bytes).lineSequence().map { it.trim() }.toList()
                "xls" -> throw IllegalArgumentException("请将旧版 XLS 另存为 XLSX 或 CSV 后导入")
                else -> throw IllegalArgumentException("请选择 TXT、CSV、TSV、JSON 或 XLSX 文件")
            }
        val names =
            raw.map { it.trim().replace('\n', ' ').replace('\r', ' ') }
                .filter { it.isNotBlank() }
                .distinct()
        require(names.isNotEmpty()) { "文件里没有找到可导入的选项" }
        require(names.size <= 10000) { "单次最多导入 10,000 个选项" }
        require(names.all { it.length <= 200 }) { "每个选项请控制在 200 字以内" }
        return names
    }

    private fun decode(bytes: ByteArray): String {
        if (bytes.size >= 2 && bytes[0] == 0xff.toByte() && bytes[1] == 0xfe.toByte())
            return String(bytes.copyOfRange(2, bytes.size), Charsets.UTF_16LE)
        if (bytes.size >= 2 && bytes[0] == 0xfe.toByte() && bytes[1] == 0xff.toByte())
            return String(bytes.copyOfRange(2, bytes.size), Charsets.UTF_16BE)
        return try {
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
                .removePrefix("\uFEFF")
        } catch (_: java.nio.charset.CharacterCodingException) {
            Charset.forName("GB18030")
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        }
    }

    internal fun csv(text: String, delimiter: Char): List<List<String>> {
        val result = mutableListOf<List<String>>()
        val row = mutableListOf<String>()
        val cell = StringBuilder()
        var quoted = false
        var i = 0
        fun endCell() {
            row.add(cell.toString())
            cell.setLength(0)
        }
        fun endRow() {
            endCell()
            result.add(row.toList())
            row.clear()
        }
        while (i < text.length) {
            val c = text[i]
            when {
                c == '"' && quoted && text.getOrNull(i + 1) == '"' -> {
                    cell.append('"')
                    i++
                }
                c == '"' -> quoted = !quoted
                c == delimiter && !quoted -> endCell()
                c == '\n' && !quoted -> endRow()
                c == '\r' && !quoted -> {
                    endRow()
                    if (text.getOrNull(i + 1) == '\n') i++
                }
                else -> cell.append(c)
            }
            i++
        }
        require(!quoted) { "CSV 的引号没有成对结束，请检查文件" }
        if (cell.isNotEmpty() || row.isNotEmpty()) endRow()
        return result
    }

    private fun table(rows: List<List<String>>): List<String> {
        val data = rows.filter { row -> row.any { it.isNotBlank() } }
        if (data.isEmpty()) return emptyList()
        val column = data.first().indexOfFirst { it.trim().lowercase() in headings }
        return (if (column >= 0) data.drop(1) else data).map { row ->
            if (column >= 0) row.getOrNull(column).orEmpty()
            else row.firstOrNull { it.isNotBlank() }.orEmpty()
        }
    }

    private fun json(text: String): List<String> {
        val array =
            if (text.trimStart().startsWith("[")) JSONArray(text)
            else
                JSONObject(text).let { obj ->
                    listOf("pool", "items", "entries", "names").firstNotNullOfOrNull {
                        obj.optJSONArray(it)
                    } ?: throw IllegalArgumentException("JSON 请使用姓名数组或包含 pool/items/names 的对象")
                }
        return (0 until array.length()).mapNotNull { index ->
            when (val value = array.opt(index)) {
                is String -> value
                is JSONObject ->
                    listOf("title", "name", "label")
                        .map { value.optString(it) }
                        .firstOrNull { it.isNotBlank() }
                else -> null
            }
        }
    }

    private fun xml(bytes: ByteArray): org.w3c.dom.Document {
        val text = String(bytes, Charsets.UTF_8)
        require(
            !text.contains("<!DOCTYPE", ignoreCase = true) &&
                !text.contains("<!ENTITY", ignoreCase = true)
        ) {
            "无法读取含外部实体的工作簿"
        }
        val factory =
            DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = true
                isExpandEntityReferences = false
                for (feature in
                    listOf(
                        "http://xml.org/sax/features/external-general-entities",
                        "http://xml.org/sax/features/external-parameter-entities",
                    )) {
                    try {
                        setFeature(feature, false)
                    } catch (_: Exception) {
                        /* Android XML parser varies. */
                    }
                }
            }
        return factory.newDocumentBuilder().parse(ByteArrayInputStream(bytes))
    }

    private fun xlsx(bytes: ByteArray): List<String> {
        val entries = mutableMapOf<String, ByteArray>()
        var expanded = 0
        var count = 0
        ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                require(++count <= 512) { "工作簿内容过多，请仅保留需要导入的名单" }
                val keep =
                    entry.name == "xl/sharedStrings.xml" ||
                        entry.name.matches(Regex("xl/worksheets/sheet[0-9]+\\.xml"))
                val out = if (keep) java.io.ByteArrayOutputStream() else null
                val buf = ByteArray(8192)
                while (true) {
                    val n = zip.read(buf)
                    if (n < 0) break
                    expanded += n
                    require(expanded <= 32 * 1024 * 1024) { "解压后的工作簿过大，请导出 CSV" }
                    out?.write(buf, 0, n)
                }
                if (out != null) entries[entry.name] = out.toByteArray()
                zip.closeEntry()
            }
        }
        val shared =
            entries["xl/sharedStrings.xml"]
                ?.let {
                    val strings = xml(it).getElementsByTagNameNS("*", "si")
                    (0 until strings.length).map { index -> strings.item(index).textContent }
                }
                .orEmpty()
        val firstSheet =
            entries.keys
                .filter { it.startsWith("xl/worksheets/") }
                .minByOrNull {
                    it.substringAfter("/sheet").substringBefore('.').toIntOrNull() ?: Int.MAX_VALUE
                } ?: throw IllegalArgumentException("没有找到工作表，请使用标准 XLSX 文件")
        val rowNodes = xml(entries.getValue(firstSheet)).getElementsByTagNameNS("*", "row")
        require(rowNodes.length <= 10001) { "工作表最多包含 10,000 行选项" }
        val matrix =
            (0 until rowNodes.length).map { index ->
                val cells = (rowNodes.item(index) as Element).getElementsByTagNameNS("*", "c")
                val values = mutableMapOf<Int, String>()
                for (n in 0 until cells.length) {
                    val cell = cells.item(n) as Element
                    var col = 0
                    for (c in cell.getAttribute("r").takeWhile { it.isLetter() }) col =
                        col * 26 + (c.uppercaseChar() - 'A' + 1)
                    col = if (col > 0) col - 1 else n
                    require(col <= 1024) { "工作表列数过多，请只保留名单列" }
                    val raw = cell.getElementsByTagNameNS("*", "v").item(0)?.textContent.orEmpty()
                    values[col] =
                        when (cell.getAttribute("t")) {
                            "s" -> shared.getOrNull(raw.toIntOrNull() ?: -1).orEmpty()
                            "inlineStr" ->
                                cell
                                    .getElementsByTagNameNS("*", "is")
                                    .item(0)
                                    ?.textContent
                                    .orEmpty()
                            else -> raw
                        }
                }
                List((values.keys.maxOrNull() ?: -1) + 1) { values[it].orEmpty() }
            }
        return table(matrix)
    }
}
