package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.*
import java.text.SimpleDateFormat
import java.util.*
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun CampusSheets(s: CampusSession) {
    val sheet = s.sheet ?: return
    val height = LocalConfiguration.current.screenHeightDp.dp * .84f
    LaoBottomSheet(onDismiss = { s.closeSheet() }) {
        key(sheet) {
            Column(
                Modifier.fillMaxWidth()
                    .then(
                        if (sheet is PhotoSheet) Modifier.height(height)
                        else Modifier.heightIn(max = height)
                    )
                    .imePadding()
                    .padding(
                        horizontal =
                            if (LocalConfiguration.current.screenWidthDp < 360) 16.dp else 24.dp
                    ),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                when (sheet) {
                    is PhotoSheet -> PhotoContent(s, sheet)
                    is DrawImportSheet -> DrawImportContent(s, sheet)
                    is FormSheet -> FormContent(s, sheet)
                    is ChoiceSheet -> {
                        LaoSheetHeading(sheet.title) { s.closeSheet() }
                        LazyColumn(
                            Modifier.weight(1f, false),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            itemsIndexed(sheet.options) { index, label ->
                                LaoSecondaryButton(label, Modifier.fillMaxWidth()) {
                                    s.closeSheet()
                                    s.invoke { sheet.action(index) }
                                }
                            }
                        }
                    }
                    is ConfirmSheet -> {
                        LaoSheetHeading(sheet.title) { s.closeSheet() }
                        Text(sheet.body, style = MaterialTheme.typography.bodyLarge)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            LaoSecondaryButton("取消", Modifier.weight(1f)) { s.closeSheet() }
                            LaoPrimaryButton("确定", Modifier.weight(1f)) {
                                s.closeSheet()
                                s.invoke(sheet.yes)
                            }
                        }
                    }
                    is MessageSheet -> {
                        LaoSheetHeading(sheet.title) { s.closeSheet() }
                        Box(Modifier.weight(1f, false).verticalScroll(rememberScrollState())) {
                            androidx.compose.foundation.text.selection.SelectionContainer {
                                Text(sheet.body, style = MaterialTheme.typography.bodyLarge)
                            }
                        }
                        sheet.options.forEachIndexed { index, label ->
                            LaoPrimaryButton(label, Modifier.fillMaxWidth()) {
                                s.closeSheet()
                                s.invoke { sheet.action(index) }
                            }
                        }
                    }
                    is PanelSheet -> {
                        LaoSheetHeading(sheet.title) { s.closeSheet() }
                        val nodes =
                            if (s.panelRevision > 0 && sheet.source != null)
                                FeatureModels.read(sheet.source, s.a)
                            else sheet.nodes
                        Column(
                            Modifier.weight(1f, false).verticalScroll(rememberScrollState()),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                        ) {
                            nodes.forEach { Feature(s, it) }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            sheet.actions.forEach { action ->
                                if (action.primary)
                                    LaoPrimaryButton(action.text, Modifier.weight(1f)) {
                                        s.invoke(action.click)
                                    }
                                else
                                    LaoSecondaryButton(action.text, Modifier.weight(1f)) {
                                        s.invoke(action.click)
                                    }
                            }
                        }
                    }
                    HomeEditorSheet -> HomeEditorContent(s)
                    SearchSheet -> SearchContent(s)
                    AlertsSheet -> AlertsContent(s)
                    GuideSheet -> {
                        LaoSheetHeading("捞捞提醒") { s.closeSheet() }
                        GuideWorkspace(s, Modifier.weight(1f, false))
                    }
                    ToolPickerSheet -> ToolPicker(s)
                    ProfileEditorSheet -> ProfileEditorContent(s)
                    QuickAddSheet -> LaoQuickActions(s)
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
internal fun LaoSheetHeading(title: String, close: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(
                Modifier.width(24.dp)
                    .height(3.dp)
                    .background(
                        MaterialTheme.colorScheme.primary,
                        androidx.compose.foundation.shape.CircleShape,
                    )
            )
            Text(title, style = LaoType.title.copy(fontSize = 24.sp, lineHeight = 32.sp))
        }
        LaoIconButton(Icons.Rounded.Close, "关闭", click = close)
    }
}

@Composable
internal fun SheetHeading(title: String, close: () -> Unit) = LaoSheetHeading(title, close)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun ColumnScope.FormContent(s: CampusSession, form: FormSheet) {
    val values =
        remember(form) {
            mutableStateMapOf<String, String>().apply {
                form.fields.forEach { f ->
                    put(
                        f.key,
                        if (f.kind == "boolean") form.initial.optBoolean(f.key).toString()
                        else
                            form.initial
                                .optString(f.key)
                                .takeUnless { it == "null" }
                                .orEmpty()
                                .ifEmpty {
                                    if (f.kind == "choice") f.choices.firstOrNull().orEmpty()
                                    else ""
                                },
                    )
                }
            }
        }
    var error by remember { mutableStateOf("") }
    var dateField by remember { mutableStateOf<CampusUi.Field?>(null) }
    var timeField by remember { mutableStateOf<CampusUi.Field?>(null) }
    LaoSheetHeading(form.title) { s.closeSheet() }
    if (error.isNotBlank())
        Text(
            error,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.error,
        )
    LazyColumn(Modifier.weight(1f, false), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        items(form.fields, key = { it.key }) { field ->
            val value = values[field.key].orEmpty()
            if (field.kind == "boolean")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        field.label,
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    LaoToggle(
                        value == "true",
                        onCheckedChange = { values[field.key] = it.toString() },
                    )
                }
            else if (field.kind == "choice") {
                var expanded by remember { mutableStateOf(false) }
                Box {
                    LaoSelect(value, field.label, Modifier.fillMaxWidth()) { expanded = true }
                    DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
                        field.choices.forEach { option ->
                            DropdownMenuItem(
                                text = { Text(option) },
                                onClick = {
                                    values[field.key] = option
                                    expanded = false
                                },
                            )
                        }
                    }
                }
            } else if (field.kind == "date" || field.kind == "time") {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(field.label, style = MaterialTheme.typography.labelLarge)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        LaoSecondaryButton(
                            value.ifBlank { if (field.kind == "date") "选择日期" else "选择时间" },
                            Modifier.weight(1f),
                        ) {
                            if (field.kind == "date") dateField = field else timeField = field
                        }
                        if (!field.required)
                            PressIcon(Icons.Rounded.Close, "清空${field.label}") {
                                values[field.key] = ""
                            }
                    }
                }
            } else
                LaoInput(
                    value,
                    { values[field.key] = it },
                    field.label + if (field.required) " *" else "",
                    Modifier.fillMaxWidth(),
                    singleLine = field.kind != "multiline",
                    keyboard =
                        KeyboardOptions(
                            keyboardType =
                                when (field.kind) {
                                    "number" -> KeyboardType.Number
                                    "decimal" -> KeyboardType.Decimal
                                    "password" -> KeyboardType.Password
                                    else -> KeyboardType.Text
                                }
                        ),
                    transformation =
                        if (field.kind == "password") PasswordVisualTransformation()
                        else VisualTransformation.None,
                    minLines = if (field.kind == "multiline") 3 else 1,
                    maxLines = if (field.kind == "multiline") 8 else 1,
                )
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LaoSecondaryButton("取消", Modifier.weight(1f)) { s.closeSheet() }
        LaoPrimaryButton(form.action, Modifier.weight(1f)) {
            try {
                val out = JSONObject(form.initial.toString())
                form.fields.forEach { f ->
                    val v = values[f.key].orEmpty().trim()
                    require(!f.required || v.isNotBlank()) { "请填写：${f.label}" }
                    if (v.isNotBlank() && f.kind == "date") DateMath.parse(v)
                    if (v.isNotBlank() && f.kind == "time") DateMath.time(v)
                    out.put(
                        f.key,
                        when (f.kind) {
                            "boolean" -> v == "true"
                            "number" -> if (v.isBlank()) "" else v.toInt()
                            "decimal" -> if (v.isBlank()) "" else v.toDouble()
                            else -> v
                        },
                    )
                }
                form.save.save(out)
                if (s.sheet === form) s.sheet = null
            } catch (e: Exception) {
                error = e.message ?: "输入格式不正确"
            }
        }
    }
    dateField?.let { field ->
        val initial = values[field.key].orEmpty().ifBlank { DateMath.today() }
        val picker =
            rememberDatePickerState(initialSelectedDateMillis = DateMath.parse(initial).time)
        DatePickerDialog(
            onDismissRequest = { dateField = null },
            confirmButton = {
                TextButton(
                    onClick = {
                        picker.selectedDateMillis?.let {
                            values[field.key] =
                                SimpleDateFormat("yyyy-MM-dd", Locale.ROOT)
                                    .apply { timeZone = TimeZone.getTimeZone("UTC") }
                                    .format(Date(it))
                        }
                        dateField = null
                    }
                ) {
                    Text("确定")
                }
            },
            dismissButton = { TextButton(onClick = { dateField = null }) { Text("取消") } },
        ) {
            DatePicker(state = picker, showModeToggle = true)
        }
    }
    timeField?.let { field ->
        val parts = DateMath.time(values[field.key].orEmpty().ifBlank { "08:00" })
        val picker = rememberTimePickerState(parts[0], parts[1], true)
        AlertDialog(
            onDismissRequest = { timeField = null },
            confirmButton = {
                TextButton(
                    onClick = {
                        values[field.key] =
                            String.format(Locale.ROOT, "%02d:%02d", picker.hour, picker.minute)
                        timeField = null
                    }
                ) {
                    Text("确定")
                }
            },
            dismissButton = { TextButton(onClick = { timeField = null }) { Text("取消") } },
            title = { Text("选择时间") },
            text = { TimeInput(picker) },
        )
    }
}

@Composable
internal fun ColumnScope.ToolPicker(s: CampusSession) {
    val a = s.a
    val old = CampusToolbox.pinned(a)
    val selected = remember {
        mutableStateListOf<String>().apply { repeat(old.length()) { add(old.optString(it)) } }
    }
    var search by remember { mutableStateOf("") }
    LaoSheetHeading("选择常用工具") { s.closeSheet() }
    Text(
        "收藏会同时出现在首页和工具页。",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    LaoInput(
        search,
        { search = it },
        "",
        Modifier.fillMaxWidth(),
        placeholder = "搜索要收藏的工具",
        leading = Icons.Rounded.Search,
    )
    LazyColumn(Modifier.weight(1f, false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items(
            CampusToolbox.ITEMS.filter {
                search.isBlank() || it[1].contains(search) || it[2].contains(search)
            },
            key = { it[0] },
        ) { item ->
            Row(
                Modifier.fillMaxWidth()
                    .clickable {
                        if (item[0] in selected) selected.remove(item[0]) else selected.add(item[0])
                    }
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                IconTile(item[0], 40.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(item[1], style = MaterialTheme.typography.titleMedium)
                    Text(
                        item[3],
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                LaoCheck(
                    item[0] in selected,
                    "收藏 " + item[1],
                    change = { if (it) selected.add(item[0]) else selected.remove(item[0]) },
                )
            }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LaoSecondaryButton("取消", Modifier.weight(1f)) { s.closeSheet() }
        LaoPrimaryButton("保存 ${selected.size} 个", Modifier.weight(1f)) {
            a.store.set("native_home_tools", JSONArray(selected.distinct()))
            s.closeSheet()
            a.build()
            a.syncSoon()
        }
    }
}
