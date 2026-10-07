package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.KeyboardArrowRight
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.*

/** The same complete feature actions, re-rendered as Material 3 components. No AndroidView. */
@Composable
internal fun FeaturePage(s: CampusSession) {
    val nodes =
        s.nodes
            .filterNot { it is FeatureNode.Space }
            .let { content ->
                val heading = content.firstOrNull() as? FeatureNode.Copy
                if (
                    heading != null &&
                        heading.size >= 20f &&
                        heading.text.trim() == routeTitle(s.route)
                )
                    content.drop(1)
                else content
            }
    PageList {
        nodes.forEachIndexed { index, node ->
            animatedItem(index, "feature-$index-${s.route}") { Feature(s, node) }
        }
        if (nodes.isEmpty())
            animatedItem(0) {
                EmptyState("正在准备内容", "需要联网的班级页面会读取真实账号数据。", "刷新") { s.a.refreshCloud() }
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
                        node.size >= 23 -> MaterialTheme.typography.headlineSmall
                        node.size >= 17 -> MaterialTheme.typography.titleLarge
                        node.bold -> MaterialTheme.typography.titleMedium
                        node.size <= 12 -> MaterialTheme.typography.bodySmall
                        else -> MaterialTheme.typography.bodyMedium
                    },
                color =
                    if (!node.bold && node.size < 16) colors.onSurfaceVariant else colors.onSurface,
            )
        }
        is FeatureNode.Action ->
            SoftButton(node.text, Modifier.fillMaxWidth(), enabled = node.enabled) {
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
                                SoftButton(
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
                PremiumCard(
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
                Text(node.text, Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                Switch(
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
            OutlinedTextField(
                value,
                onValueChange = {
                    value = it
                    s.invoke { node.source.setText(it) }
                },
                modifier = Modifier.fillMaxWidth(),
                placeholder = { Text(node.source.hint?.toString().orEmpty()) },
                label =
                    node.source.contentDescription
                        ?.takeIf { it.isNotBlank() }
                        ?.let { label -> ({ Text(label.toString()) }) },
                shape = RoundedCornerShape(16.dp),
                enabled = node.source.isEnabled,
                keyboardOptions =
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
                visualTransformation =
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
                SoftButton(
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
