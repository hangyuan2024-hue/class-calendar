package com.laolao.classcalendar

import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.*
import java.security.SecureRandom
import java.util.Collections
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

@Composable
internal fun DrawPage(s: CampusSession) {
    val a = s.a
    val colors = MaterialTheme.colorScheme
    val pool = rows(a.store.list("native_draw_pool"))
    val scope = rememberCoroutineScope()
    val haptic = LocalHapticFeedback.current
    val motion = LocalMotionEnabled.current
    var result by rememberSaveable { mutableStateOf("") }
    var drawing by remember { mutableStateOf(false) }
    var importing by remember { mutableStateOf(false) }
    val picker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            if (uri != null)
                scope.launch {
                    importing = true
                    try {
                        val parsed =
                            withContext(Dispatchers.IO) {
                                val name =
                                    a.contentResolver
                                        .query(
                                            uri,
                                            arrayOf(OpenableColumns.DISPLAY_NAME),
                                            null,
                                            null,
                                            null,
                                        )
                                        ?.use { cursor ->
                                            if (cursor.moveToFirst()) cursor.getString(0) else null
                                        } ?: "名单.txt"
                                val bytes =
                                    a.contentResolver.openInputStream(uri)?.use { input ->
                                        val out = java.io.ByteArrayOutputStream()
                                        val buffer = ByteArray(8192)
                                        while (true) {
                                            val n = input.read(buffer)
                                            if (n < 0) break
                                            require(out.size() + n <= DrawFileParser.MAX_BYTES) {
                                                "文件请小于 8 MB"
                                            }
                                            out.write(buffer, 0, n)
                                        }
                                        out.toByteArray()
                                    } ?: throw IllegalArgumentException("无法读取这个文件")
                                DrawFileParser.parse(bytes, name) to name
                            }
                        s.sheet = DrawImportSheet(parsed.first, parsed.second)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (e: Exception) {
                        s.notice = e.message ?: "文件读取失败"
                    } finally {
                        importing = false
                    }
                }
        }
    PageList {
        animatedItem(0) {
            LaoPageHeading("给选择，一点惊喜。", "选人、定顺序或分小组，名单也能直接导入。", "抽签池", Icons.Rounded.Casino)
        }
        animatedItem(1) {
            PremiumCard(Modifier.fillMaxWidth(), tint = colors.primaryContainer) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Rounded.Casino, null, tint = colors.primary)
                    Text("抽签池 · ${pool.size} 个选项", style = MaterialTheme.typography.labelLarge)
                }
                Box(
                    Modifier.fillMaxWidth().heightIn(min = 112.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    AnimatedContent(
                        result.ifBlank { "谁会是今天的幸运儿？" },
                        transitionSpec = { fadeIn().togetherWith(fadeOut()) },
                        label = "draw result",
                    ) { text ->
                        Text(
                            text,
                            style =
                                if (result.isBlank()) MaterialTheme.typography.titleLarge
                                else MaterialTheme.typography.headlineLarge,
                            color = colors.onPrimaryContainer,
                        )
                    }
                }
                PrimaryButton(
                    if (drawing) "正在抽取…" else "随机抽一个",
                    Modifier.fillMaxWidth(),
                    enabled = !drawing && pool.isNotEmpty(),
                ) {
                    scope.launch {
                        drawing = true
                        val random = SecureRandom()
                        try {
                            if (motion)
                                repeat(8) {
                                    result = pool[random.nextInt(pool.size)].optString("title")
                                    delay(60L + it * 12)
                                }
                            result = pool[random.nextInt(pool.size)].optString("title")
                            a.store.add(
                                "native_draw_history",
                                CampusJson.obj("at", System.currentTimeMillis(), "result", result),
                            )
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            a.build()
                        } finally {
                            drawing = false
                        }
                    }
                }
                if (result.isNotBlank() && !drawing)
                    TextButton(
                        onClick = { CampusPhone.shareText(a, "捞捞课程表 · 抽签结果：$result") },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text("分享结果")
                    }
            }
        }
        animatedItem(2) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton("导入文件", Modifier.weight(1f)) {
                    if (!importing) picker.launch(arrayOf("*/*"))
                }
                SoftButton("批量粘贴", Modifier.weight(1f)) {
                    a.ui.form(
                        "批量添加抽签选项",
                        JSONObject(),
                        { values ->
                            val parsed =
                                DrawFileParser.parse(
                                    values.optString("text").toByteArray(),
                                    "名单.txt",
                                )
                            s.sheet = DrawImportSheet(parsed, "手动粘贴")
                        },
                        CampusUi.f("text", "每行一个选项", "multiline"),
                    )
                }
            }
            if (importing) LinearProgressIndicator(Modifier.fillMaxWidth())
            Text(
                "支持 TXT、CSV、TSV、JSON 和 Excel XLSX；确认名单后才会加入抽签池。",
                style = MaterialTheme.typography.bodySmall,
                color = colors.onSurfaceVariant,
            )
        }
        animatedItem(3) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SoftButton("随机分组", Modifier.weight(1f)) {
                    if (pool.isEmpty()) s.notice = "先添加抽签选项" else drawGroups(s, pool)
                }
                SoftButton("历史结果", Modifier.weight(1f)) {
                    CampusManage.records(a, "抽签历史", a.store.list("native_draw_history"))
                }
            }
        }
        animatedItem(4) {
            SectionHeading("池里的选项", action = "添加") {
                a.ui.form(
                    "添加抽签选项",
                    JSONObject(),
                    { value ->
                        val name = value.optString("title").trim()
                        require(name.length in 1..200) { "选项请填写 1—200 个字" }
                        require(pool.none { it.optString("title") == name }) { "这个选项已经在抽签池中" }
                        a.store.add(
                            "native_draw_pool",
                            CampusJson.obj("id", CampusJson.id(), "title", name),
                        )
                        a.build()
                    },
                    CampusUi.f("title", "选项 / 姓名"),
                )
            }
        }
        pool.chunked(2).forEachIndexed { index, pair ->
            animatedItem(index + 5, "draw-row-${pair.first().optString("id")}") {
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    pair.forEach { item ->
                        PremiumCard(Modifier.weight(1f)) {
                            Text(
                                item.optString("title"),
                                style = MaterialTheme.typography.titleMedium,
                            )
                            TextButton(
                                onClick = {
                                    a.ui.confirm("移出抽签池？", item.optString("title")) {
                                        a.store.replace(
                                            "native_draw_pool",
                                            item.optString("id"),
                                            null,
                                        )
                                        a.build()
                                    }
                                }
                            ) {
                                Text("移除", color = colors.onSurfaceVariant)
                            }
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        if (pool.isEmpty()) animatedItem(5) { EmptyState("先准备一份名单", "导入班级名单、粘贴分组候选，或手动加几个选项。") }
        if (pool.isNotEmpty())
            animatedItem(pool.size + 6) {
                TextButton(
                    onClick = {
                        a.ui.confirm("清空抽签池？", "已保存的历史结果会保留。") {
                            a.store.set("native_draw_pool", JSONArray())
                            result = ""
                            a.build()
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("清空抽签池", color = colors.error)
                }
            }
    }
}

private fun drawGroups(s: CampusSession, pool: List<JSONObject>) {
    val a = s.a
    a.ui.form(
        "随机分组",
        CampusJson.obj("size", 3),
        { v ->
            val size = v.optInt("size")
            require(size in 1..100) { "每组人数请填写 1—100" }
            val shuffled = pool.toMutableList()
            Collections.shuffle(shuffled, SecureRandom())
            val text =
                shuffled
                    .chunked(size)
                    .mapIndexed { index, group ->
                        "第 ${index+1} 组\n" + group.joinToString("、") { it.optString("title") }
                    }
                    .joinToString("\n\n")
            a.store.add(
                "native_draw_history",
                CampusJson.obj("at", System.currentTimeMillis(), "result", text),
            )
            CampusManage.message(a, "随机分组结果", text, arrayOf("分享结果")) {
                CampusPhone.shareText(a, text)
            }
        },
        CampusUi.f("size", "每组人数（填 1 即随机排序）", "number"),
    )
}

@Composable
internal fun ColumnScope.DrawImportContent(s: CampusSession, sheet: DrawImportSheet) {
    val existing = rows(s.a.store.list("native_draw_pool")).map { it.optString("title") }.toSet()
    val added = sheet.names.filter { it !in existing }
    SheetHeading("确认导入名单") { s.closeSheet() }
    Text(
        sheet.filename,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Text(
        "${added.size} 个新选项 · ${sheet.names.size-added.size} 个已有选项会跳过",
        style = MaterialTheme.typography.titleMedium,
    )
    LazyColumn(Modifier.weight(1f, false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        itemsIndexed(sheet.names, key = { _, name -> name }) { index, name ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(
                    "${index+1}",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
                Text(name, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                if (name in existing)
                    Text(
                        "已有",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
            }
        }
    }
    PrimaryButton(
        if (added.isEmpty()) "没有新选项" else "导入 ${added.size} 个选项",
        Modifier.fillMaxWidth(),
        enabled = added.isNotEmpty(),
    ) {
        val pool = s.a.store.list("native_draw_pool")
        added.forEach { pool.put(CampusJson.obj("id", CampusJson.id(), "title", it)) }
        s.a.store.set("native_draw_pool", pool)
        s.closeSheet()
        s.a.build()
        s.notice = "已导入 ${added.size} 个选项"
    }
}
