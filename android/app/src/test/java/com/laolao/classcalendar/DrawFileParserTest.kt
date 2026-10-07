package com.laolao.classcalendar

import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.*
import org.junit.Test

class DrawFileParserTest {
    @Test
    fun textTrimsEmptyLinesAndDuplicateNames() {
        assertEquals(listOf("林同学", "陈同学"), parse("  林同学\r\n\n陈同学\n林同学 ", "names.txt"))
    }

    @Test
    fun csvChoosesTheNamedColumnAndPreservesQuotedNames() {
        assertEquals(
            listOf("林,同学", "陈\"同学"),
            parse("学号,姓名,班级\r\n1001,\"林,同学\",1\r\n1002,\"陈\"\"同学\",2\r\n", "names.csv"),
        )
    }

    @Test
    fun csvSupportsUtf8BomAndUtf16ExcelExport() {
        assertEquals(listOf("林同学"), parse("\uFEFF姓名\n林同学", "names.csv"))
        val bytes =
            byteArrayOf(0xff.toByte(), 0xfe.toByte()) +
                "姓名\t班级\r\n林同学\t1".toByteArray(Charsets.UTF_16LE)
        assertEquals(listOf("林同学"), DrawFileParser.parse(bytes, "names.tsv"))
    }

    @Test
    fun csvSupportsChineseWindowsEncoding() {
        assertEquals(
            listOf("林同学", "陈同学"),
            DrawFileParser.parse("姓名\n林同学\n陈同学".toByteArray(charset("GB18030")), "names.csv"),
        )
    }

    @Test
    fun jsonAcceptsStringAndObjectRecordsWithoutImportingMetadata() {
        assertEquals(
            listOf("林同学", "陈同学"),
            parse("{\"pool\":[\"林同学\",{\"id\":\"x\",\"title\":\"陈同学\"},null,123]}", "names.json"),
        )
    }

    @Test
    fun xlsxUsesSharedStringsAndReadsTheNameColumnDespiteSparseRows() {
        val bytes =
            zip(
                mapOf(
                    "xl/sharedStrings.xml" to
                        """<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>姓名</t></si><si><t>林同学</t></si><si><r><t>陈</t></r><r><t>同学</t></r></si></sst>""",
                    "xl/worksheets/sheet1.xml" to
                        """<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>学号</t></is></c><c r="B1" t="s"><v>0</v></c></row><row r="2"><c r="A2"><v>1001</v></c><c r="B2" t="s"><v>1</v></c></row><row r="3"><c r="B3" t="s"><v>2</v></c></row></sheetData></worksheet>""",
                )
            )
        assertEquals(listOf("林同学", "陈同学"), DrawFileParser.parse(bytes, "names.xlsx"))
    }

    @Test
    fun xlsxAcceptsInlineStringsAndUnheadedLists() {
        val bytes =
            zip(
                mapOf(
                    "xl/worksheets/sheet1.xml" to
                        """<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="inlineStr"><is><t>林同学</t></is></c></row><row><c r="A2" t="inlineStr"><is><t>陈同学</t></is></c></row></sheetData></worksheet>"""
                )
            )
        assertEquals(listOf("林同学", "陈同学"), DrawFileParser.parse(bytes, "names.xlsx"))
    }

    @Test
    fun invalidImportIsRejectedBeforeAListIsReturned() {
        listOf(
                "\"unterminated" to "names.csv",
                "" to "names.txt",
                "姓名\n" to "names.csv",
                "" to "names.xls",
                "x".repeat(201) to "names.txt",
            )
            .forEach { (text, name) ->
                assertThrows(IllegalArgumentException::class.java) { parse(text, name) }
            }
        assertThrows(IllegalArgumentException::class.java) {
            DrawFileParser.parse(ByteArray(DrawFileParser.MAX_BYTES + 1), "names.txt")
        }
    }

    @Test
    fun xlsxRejectsEntityDeclarations() {
        val bytes =
            zip(
                mapOf(
                    "xl/worksheets/sheet1.xml" to
                        "<!DOCTYPE x [<!ENTITY e SYSTEM 'file:///private'>]><worksheet/>"
                )
            )
        assertThrows(IllegalArgumentException::class.java) {
            DrawFileParser.parse(bytes, "names.xlsx")
        }
    }

    private fun parse(text: String, name: String) = DrawFileParser.parse(text.toByteArray(), name)

    private fun zip(files: Map<String, String>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            files.forEach { (name, content) ->
                zip.putNextEntry(ZipEntry(name))
                zip.write(content.toByteArray())
                zip.closeEntry()
            }
        }
        return out.toByteArray()
    }
}
