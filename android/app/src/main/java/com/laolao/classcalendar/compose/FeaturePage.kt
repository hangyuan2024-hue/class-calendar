package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

/** The same complete feature actions, re-rendered with Design System 2.0. No AndroidView. */
@Composable
private fun UtilityActionCell(
    text: String,
    modifier: Modifier,
    enabled: Boolean = true,
    action: () -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val destructive = text.contains("删除") || text.contains("清空")
    val hue = if (destructive) c.error else c.primary
    val icon =
        when {
            destructive -> Icons.Rounded.DeleteOutline
            text.contains("添加") || text.contains("新建") || text.startsWith("＋") -> Icons.Rounded.Add
            text.contains("设置") || text.contains("规则") || text.contains("参数") -> Icons.Rounded.Tune
            text.contains("编辑") || text.contains("修改") || text.contains("命名") ->
                Icons.Rounded.EditNote
            text.contains("导出") || text.contains("分享") -> Icons.Rounded.FileUpload
            text.contains("导入") -> Icons.Rounded.FileDownload
            text.contains("刷新") || text.contains("同步") || text.contains("更新") -> Icons.Rounded.Sync
            text.contains("录音") || text.contains("录制") || text.contains("语音") ->
                Icons.Rounded.MicNone
            text.contains("拍照") || text.contains("相册") || text.contains("照片") ->
                Icons.Rounded.PhotoCamera
            text.contains("保存") || text.contains("完成") || text.contains("掌握") -> Icons.Rounded.Check
            else -> Icons.Rounded.NorthEast
        }
    Row(
        modifier
            .heightIn(min = 56.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(c.surface.copy(alpha = if (enabled) .8f else .4f))
            .border(1.dp, c.outlineVariant.copy(alpha = .45f), RoundedCornerShape(18.dp))
            .laoTap(
                role = androidx.compose.ui.semantics.Role.Button,
                enabled = enabled,
                action = action,
            )
            .padding(horizontal = 12.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier.size(28.dp).background(hue.copy(alpha = .075f), RoundedCornerShape(9.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                icon,
                null,
                Modifier.size(17.dp),
                tint = hue.copy(alpha = if (enabled) 1f else .4f),
            )
        }
        Text(
            text,
            Modifier.weight(1f),
            style = LaoType.caption,
            color = if (enabled) c.onSurface else c.onSurfaceVariant,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
internal fun FeaturePage(s: CampusSession) {
    val c = MaterialTheme.colorScheme
    val content = s.nodes.filterNot { it is FeatureNode.Space }
    val heading = (content.firstOrNull() as? FeatureNode.Copy)?.takeIf { it.size >= 20f }
    val subtitle =
        if (heading != null)
            (content.getOrNull(1) as? FeatureNode.Copy)?.takeIf { !it.bold && it.size < 17f }
        else null
    val nodes = content.drop(if (heading != null) if (subtitle != null) 2 else 1 else 0)
    LaoPage(spacing = 16.dp) {
        animatedItem(0, "utility-heading-" + s.route) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(heading?.text ?: routeTitle(s.route), style = LaoType.headline)
                    if (subtitle != null)
                        Text(subtitle.text, style = LaoType.caption, color = c.onSurfaceVariant)
                }
                Box(
                    Modifier.size(48.dp)
                        .clip(RoundedCornerShape(18.dp))
                        .background(
                            Brush.linearGradient(
                                listOf(c.primary.copy(alpha = .12f), c.primary.copy(alpha = .035f))
                            )
                        ),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(routeIcon(s.route), null, Modifier.size(26.dp), tint = c.primary)
                }
            }
        }
        nodes.forEachIndexed { index, node ->
            animatedItem(index + 1, "feature-$index-${s.route}") { Feature(s, node) }
        }
        if (nodes.isEmpty())
            animatedItem(1) {
                LaoEmpty("正在准备内容", "需要联网的班级页面会读取真实账号数据。", "刷新") { s.a.refreshCloud() }
            }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun Feature(s: CampusSession, node: FeatureNode) {
    val colors = MaterialTheme.colorScheme
    when (node) {
        is FeatureNode.Copy -> {
            var text by
                remember(node.source) { mutableStateOf(node.source?.text?.toString() ?: node.text) }
            DisposableEffect(node.source) {
                val watcher =
                    object : android.text.TextWatcher {
                        override fun beforeTextChanged(
                            s: CharSequence?,
                            start: Int,
                            count: Int,
                            after: Int,
                        ) {}

                        override fun onTextChanged(
                            s: CharSequence?,
                            start: Int,
                            before: Int,
                            count: Int,
                        ) {
                            text = s?.toString().orEmpty()
                        }

                        override fun afterTextChanged(s: android.text.Editable?) {}
                    }
                node.source?.addTextChangedListener(watcher)
                onDispose { node.source?.removeTextChangedListener(watcher) }
            }
            Text(
                text,
                style =
                    when {
                        node.size >= 23 -> LaoType.title
                        node.size >= 17 -> LaoType.cell
                        node.bold -> LaoType.cell
                        node.size <= 12 -> LaoType.caption
                        else -> LaoType.body
                    },
                color =
                    if (!node.bold && node.size < 16) colors.onSurfaceVariant else colors.onSurface,
            )
        }
        is FeatureNode.Action ->
            UtilityActionCell(node.text, Modifier.fillMaxWidth(), node.enabled) {
                s.invoke(node.click)
                s.panelRevision++
            }
        is FeatureNode.Group -> {
            val children = node.children.filterNot { it is FeatureNode.Space }
            val body: @Composable ColumnScope.() -> Unit = {
                if (node.horizontal) {
                    if (children.all { it is FeatureNode.Action }) {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            maxItemsInEachRow = 2,
                        ) {
                            children.forEach { n ->
                                val action = n as FeatureNode.Action
                                UtilityActionCell(
                                    action.text,
                                    Modifier.weight(1f),
                                    enabled = action.enabled,
                                ) {
                                    s.invoke(action.click)
                                    s.panelRevision++
                                }
                            }
                        }
                    } else if (node.click != null) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            children.forEach { child ->
                                if (child is FeatureNode.Symbol) Feature(s, child)
                                else if (
                                    child is FeatureNode.Copy &&
                                        child.text.trim() in setOf("›", "→", "↗", "❯")
                                )
                                    Icon(
                                        Icons.AutoMirrored.Rounded.KeyboardArrowRight,
                                        null,
                                        Modifier.size(24.dp),
                                        tint = colors.onSurfaceVariant,
                                    )
                                else if (
                                    child is FeatureNode.Group && !child.horizontal && !child.card
                                )
                                    Column(
                                        Modifier.weight(1f),
                                        verticalArrangement = Arrangement.spacedBy(8.dp),
                                    ) {
                                        child.children
                                            .filterNot { it is FeatureNode.Space }
                                            .forEach { Feature(s, it) }
                                    }
                                else Column(Modifier.weight(1f)) { Feature(s, child) }
                            }
                        }
                    } else {
                        FlowRow(
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalArrangement = Arrangement.spacedBy(16.dp),
                            maxItemsInEachRow = 3,
                        ) {
                            children.forEach { child ->
                                Column(
                                    if (child is FeatureNode.Symbol) Modifier
                                    else Modifier.weight(1f)
                                ) {
                                    Feature(s, child)
                                }
                            }
                        }
                    }
                } else children.forEach { Feature(s, it) }
            }
            val nestedCardsOnly =
                node.click == null &&
                    children.isNotEmpty() &&
                    children.all { it is FeatureNode.Group && (it.card || it.click != null) }
            if ((node.card && !nestedCardsOnly) || node.click != null)
                LaoPanel(
                    Modifier.fillMaxWidth(),
                    onClick =
                        node.click?.let { click ->
                            {
                                s.invoke(click)
                                s.panelRevision++
                            }
                        },
                    content = body,
                )
            else
                Column(
                    Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    content = body,
                )
        }
        is FeatureNode.Toggle -> {
            var checked by remember(node.source) { mutableStateOf(node.source.isChecked) }
            Row(
                Modifier.fillMaxWidth().padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Text(node.text, Modifier.weight(1f), style = LaoType.body)
                LaoToggle(
                    checked,
                    enabled = node.source.isEnabled,
                    onCheckedChange = {
                        checked = it
                        s.invoke { node.source.isChecked = it }
                        s.panelRevision++
                    },
                )
            }
        }
        is FeatureNode.Input -> {
            var value by remember(node.source) { mutableStateOf(node.source.text.toString()) }
            LaoInput(
                value,
                onValue = {
                    value = it
                    s.invoke { node.source.setText(it) }
                },
                modifier = Modifier.fillMaxWidth(),
                placeholder = node.source.hint?.toString().orEmpty(),
                label = node.source.contentDescription?.toString().orEmpty(),
                enabled = node.source.isEnabled,
                keyboard =
                    KeyboardOptions(
                        keyboardType =
                            when {
                                node.source.inputType and android.text.InputType.TYPE_MASK_CLASS ==
                                    android.text.InputType.TYPE_CLASS_NUMBER -> KeyboardType.Decimal
                                node.source.inputType and
                                    android.text.InputType.TYPE_MASK_VARIATION ==
                                    android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD ->
                                    KeyboardType.Password
                                node.source.inputType and
                                    android.text.InputType.TYPE_MASK_VARIATION ==
                                    android.text.InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS ->
                                    KeyboardType.Email
                                else -> KeyboardType.Text
                            }
                    ),
                singleLine = node.source.maxLines == 1,
                transformation =
                    if (
                        node.source.inputType and
                            android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD != 0
                    )
                        PasswordVisualTransformation()
                    else VisualTransformation.None,
            )
        }
        is FeatureNode.Select -> {
            var expanded by remember { mutableStateOf(false) }
            var selected by
                remember(node.source) {
                    mutableIntStateOf(node.source.selectedItemPosition.coerceAtLeast(0))
                }
            Box {
                LaoSecondaryButton(
                    node.source.adapter?.getItem(selected)?.toString().orEmpty() + " ▾",
                    Modifier.fillMaxWidth(),
                ) {
                    expanded = true
                }
                DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
                    repeat(node.source.count) { i ->
                        DropdownMenuItem(
                            text = { Text(node.source.adapter.getItem(i).toString()) },
                            onClick = {
                                selected = i
                                node.source.setSelection(i)
                                s.a.handler.post { s.refreshControls() }
                                expanded = false
                                s.panelRevision++
                            },
                        )
                    }
                }
            }
        }
        is FeatureNode.Range -> {
            var value by
                remember(node.source) { mutableFloatStateOf(node.source.progress.toFloat()) }
            Slider(
                value,
                enabled = node.source.isEnabled,
                onValueChange = {
                    value = it
                    node.source.progress = it.toInt()
                },
                valueRange = 0f..node.source.max.coerceAtLeast(1).toFloat(),
            )
        }
        is FeatureNode.Picture ->
            Image(
                node.bitmap.asImageBitmap(),
                node.description,
                Modifier.fillMaxWidth()
                    .heightIn(max = 480.dp)
                    .then(
                        if (node.click != null)
                            Modifier.clickable {
                                s.invoke(node.click)
                                s.panelRevision++
                            }
                        else Modifier
                    ),
                contentScale = ContentScale.Fit,
            )
        is FeatureNode.Symbol ->
            Icon(routeIcon(node.type), null, Modifier.size(24.dp), tint = colors.primary)
        is FeatureNode.Space -> Spacer(Modifier.height(node.height.dp))
    }
}
