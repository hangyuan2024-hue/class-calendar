package com.laolao.classcalendar

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.interaction.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import kotlin.math.roundToInt
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Native editorial product primitives; Material provides capabilities rather than page templates.
 */
internal val LaoDisplayFont =
    FontFamily(
        Font(R.font.laolao_display_regular, FontWeight.Normal),
        Font(R.font.laolao_display_bold, FontWeight.Bold),
    )

internal object LaoType {
    val display =
        TextStyle(
            fontFamily = LaoDisplayFont,
            fontSize = 40.sp,
            lineHeight = 48.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-1.3).sp,
        )
    val headline =
        TextStyle(
            fontSize = 32.sp,
            lineHeight = 40.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-.8).sp,
        )
    val title =
        TextStyle(
            fontSize = 22.sp,
            lineHeight = 30.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-.3).sp,
        )
    val cell = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.SemiBold)
    val body = TextStyle(fontSize = 14.sp, lineHeight = 22.sp)
    val caption = TextStyle(fontSize = 13.sp, lineHeight = 20.sp, fontWeight = FontWeight.Medium)
    val label =
        TextStyle(
            fontSize = 12.sp,
            lineHeight = 18.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = .3.sp,
        )
}

internal object LaoCorners {
    val paper = RoundedCornerShape(24.dp)
    val control = RoundedCornerShape(18.dp)
}

@Composable
internal fun Modifier.laoTap(
    role: Role? = null,
    enabled: Boolean = true,
    action: () -> Unit,
): Modifier {
    val source = remember { MutableInteractionSource() }
    return springPress(source)
        .clickable(source, null, enabled = enabled, role = role, onClick = action)
}

@Composable
internal fun LaoPage(spacing: Dp = 24.dp, content: LazyListScope.() -> Unit) {
    val gutter = if (LocalConfiguration.current.screenWidthDp < 360) 16.dp else 24.dp
    LazyColumn(
        Modifier.fillMaxSize(),
        state = LocalPageListState.current ?: rememberLazyListState(),
        contentPadding = PaddingValues(start = gutter, end = gutter, top = 12.dp, bottom = 176.dp),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

@Composable
internal fun LaoPanel(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.surface,
    padding: Dp = 16.dp,
    onClick: (() -> Unit)? = null,
    glass: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val interaction = remember { MutableInteractionSource() }
    Column(
        modifier
            .springPress(interaction)
            .shadow(
                if (glass) 6.dp else 3.dp,
                LaoCorners.paper,
                false,
                ambientColor = Color.Black.copy(alpha = .025f),
                spotColor = c.onSurface.copy(alpha = .05f),
            )
            .clip(LaoCorners.paper)
            .background(
                if (glass)
                    Brush.linearGradient(listOf(color.copy(alpha = .82f), color.copy(alpha = .58f)))
                else Brush.linearGradient(listOf(color, lerp(color, c.background, .09f)))
            )
            .border(
                1.dp,
                if (glass) Color.White.copy(alpha = .35f) else c.outlineVariant.copy(alpha = .36f),
                LaoCorners.paper,
            )
            .then(
                if (onClick != null) Modifier.clickable(interaction, null, onClick = onClick)
                else Modifier
            )
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        content = content,
    )
}

@Composable
internal fun LaoSection(
    title: String,
    modifier: Modifier = Modifier,
    note: String? = null,
    action: String? = null,
    click: () -> Unit = {},
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = LaoType.title)
            if (!note.isNullOrBlank())
                Text(
                    note,
                    style = LaoType.caption,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
        }
        if (action != null) LaoTextAction(action, click = click)
    }
}

@Composable
internal fun LaoPrimaryButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) = LaoAction(label, modifier, filled = true, enabled = enabled, onClick = onClick)

@Composable
internal fun LaoSecondaryButton(
    label: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) = LaoAction(label, modifier, filled = false, enabled = enabled, onClick = onClick)

@Composable
private fun LaoAction(
    label: String,
    modifier: Modifier,
    filled: Boolean,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val c = MaterialTheme.colorScheme
    val ink = c.primary
    val text = c.onPrimary
    val source = remember { MutableInteractionSource() }
    val haptic = LocalHapticFeedback.current
    Box(
        modifier
            .heightIn(min = 48.dp)
            .springPress(source)
            .alpha(if (enabled) 1f else .45f)
            .clip(CircleShape)
            .background(if (filled) ink else c.surface.copy(alpha = .85f))
            .border(1.dp, if (filled) ink else c.outlineVariant, CircleShape)
            .clickable(source, null, enabled = enabled, role = Role.Button) {
                haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            }
            .padding(horizontal = 20.dp, vertical = 12.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = LaoType.cell,
            color = if (filled) text else c.onSurface,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
    }
}

@Composable
internal fun LaoTextAction(label: String, modifier: Modifier = Modifier, click: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    Box(
        modifier
            .heightIn(min = 40.dp)
            .springPress(source)
            .clip(CircleShape)
            .clickable(source, null, role = Role.Button, onClick = click)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = LaoType.caption, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
internal fun LaoIconButton(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    click: () -> Unit,
) {
    val source = remember { MutableInteractionSource() }
    Box(
        modifier
            .size(48.dp)
            .springPress(source)
            .clip(CircleShape)
            .clickable(source, null, role = Role.Button, onClick = click)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, null, Modifier.size(22.dp), tint = tint)
    }
}

@Composable
internal fun LaoStat(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.onSurface,
    click: (() -> Unit)? = null,
) {
    Column(
        modifier.then(if (click != null) Modifier.clickable(onClick = click) else Modifier),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            value,
            style = LaoType.display.copy(fontSize = 32.sp, lineHeight = 40.sp),
            color = color,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Text(label, style = LaoType.caption, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
internal fun LaoChip(
    label: String,
    color: Color = MaterialTheme.colorScheme.primary,
    icon: ImageVector? = null,
) {
    Row(
        Modifier.clip(CircleShape)
            .background(color.copy(alpha = .09f))
            .padding(horizontal = 8.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(12.dp), tint = color)
        Text(label, style = LaoType.label, color = color, maxLines = 1)
    }
}

@Composable
internal fun LaoTabs(options: List<String>, selected: String, change: (String) -> Unit) {
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        options.forEach { label ->
            val on = label == selected
            val source = remember { MutableInteractionSource() }
            val hue by
                animateColorAsState(
                    if (on) c.primary else c.onSurfaceVariant,
                    if (LocalMotionEnabled.current) tween(180) else snap(),
                    label = "tab ink",
                )
            Column(
                Modifier.heightIn(min = 48.dp)
                    .springPress(source)
                    .clip(LaoCorners.control)
                    .clickable(source, null, role = Role.Tab) { change(label) }
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .semantics {
                        this.selected = on
                        contentDescription = label
                    },
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(label, style = LaoType.cell, color = hue)
                val scale by
                    animateFloatAsState(
                        if (on) 1f else 0f,
                        if (LocalMotionEnabled.current) spring(.8f, 400f) else snap(),
                        label = "tab underline",
                    )
                Box(
                    Modifier.width(20.dp)
                        .height(3.dp)
                        .scale(scaleX = scale, scaleY = 1f)
                        .background(c.primary, CircleShape)
                )
            }
        }
    }
}

@Composable
internal fun LaoLink(
    label: String,
    note: String,
    route: String,
    s: CampusSession,
    trailing: String? = null,
) {
    val c = MaterialTheme.colorScheme
    Row(
        Modifier.fillMaxWidth()
            .heightIn(min = 64.dp)
            .clip(LaoCorners.control)
            .clickable { s.open(route) }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(routeIcon(route), null, Modifier.size(24.dp), tint = c.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = LaoType.cell)
            if (note.isNotBlank())
                Text(
                    note,
                    style = LaoType.caption,
                    color = c.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
        }
        if (trailing != null) Text(trailing, style = LaoType.label, color = c.onSurfaceVariant)
        Icon(Icons.Rounded.ChevronRight, null, Modifier.size(16.dp), tint = c.onSurfaceVariant)
    }
}

@Composable
internal fun LaoEmpty(
    title: String,
    body: String,
    action: String? = null,
    onClick: () -> Unit = {},
) {
    val c = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxWidth()
            .clip(LaoCorners.paper)
            .background(
                Brush.linearGradient(
                    listOf(lerp(c.surface, c.primary, .035f), c.surface.copy(alpha = .7f))
                )
            )
            .border(1.dp, c.outlineVariant.copy(alpha = .3f), LaoCorners.paper)
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.size(56.dp), contentAlignment = Alignment.Center) {
                LaoPaperArt(Modifier.matchParentSize(), c.primary)
                LaoMascot(Modifier.size(44.dp), expressive = false)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, style = LaoType.cell)
                Text(body, style = LaoType.body, color = c.onSurfaceVariant)
            }
        }
        if (action != null) LaoSecondaryButton(action, onClick = onClick)
    }
}

@Composable
internal fun LaoInput(
    value: String,
    onValue: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    leading: ImageVector? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    transformation: VisualTransformation = VisualTransformation.None,
    keyboard: KeyboardOptions = KeyboardOptions.Default,
    actions: KeyboardActions = KeyboardActions.Default,
    trailing: (@Composable () -> Unit)? = null,
    minLines: Int = 1,
    maxLines: Int = if (singleLine) 1 else 8,
    fieldModifier: Modifier = Modifier,
) {
    val c = MaterialTheme.colorScheme
    val source = remember { MutableInteractionSource() }
    val focused by source.collectIsFocusedAsState()
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (label.isNotBlank())
            Text(
                label,
                style = LaoType.caption,
                color = if (focused) c.primary else c.onSurfaceVariant,
            )
        BasicTextField(
            value,
            onValue,
            Modifier.fillMaxWidth()
                .then(fieldModifier)
                .heightIn(min = 56.dp)
                .semantics { contentDescription = label }
                .clip(LaoCorners.control)
                .background(lerp(c.surface, c.primary, if (focused) .025f else .008f))
                .border(
                    if (focused) 2.dp else 1.dp,
                    if (focused) c.primary else c.outlineVariant.copy(alpha = .65f),
                    LaoCorners.control,
                )
                .padding(horizontal = 16.dp, vertical = 12.dp),
            enabled = enabled,
            singleLine = singleLine,
            minLines = minLines,
            maxLines = maxLines,
            textStyle =
                LaoType.body.copy(fontSize = 16.sp, lineHeight = 24.sp, color = c.onSurface),
            keyboardOptions = keyboard,
            keyboardActions = actions,
            visualTransformation = transformation,
            interactionSource = source,
            cursorBrush = SolidColor(c.primary),
            decorationBox = { field ->
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (leading != null)
                        Icon(leading, null, Modifier.size(20.dp), tint = c.onSurfaceVariant)
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty())
                            Text(
                                placeholder,
                                style = LaoType.body,
                                color = c.onSurfaceVariant.copy(alpha = .75f),
                            )
                        field()
                    }
                    trailing?.invoke()
                }
            },
        )
    }
}

@Composable
internal fun LaoSelection(
    checked: Boolean,
    onCheckedChange: ((Boolean) -> Unit)?,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(modifier) {
        LaoCheck(checked, "", enabled = enabled && onCheckedChange != null) {
            onCheckedChange?.invoke(it)
        }
    }
}

@Composable
internal fun LaoSelect(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    click: () -> Unit,
) {
    val c = MaterialTheme.colorScheme
    Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = LaoType.caption, color = c.onSurfaceVariant)
        Row(
            Modifier.fillMaxWidth()
                .heightIn(min = 56.dp)
                .clip(LaoCorners.control)
                .background(c.surface.copy(alpha = .8f))
                .border(1.dp, c.outlineVariant.copy(alpha = .65f), LaoCorners.control)
                .laoTap(role = Role.Button, action = click)
                .semantics { contentDescription = "选择" + label }
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(value, Modifier.weight(1f), style = LaoType.body)
            Icon(Icons.Rounded.ExpandMore, null, Modifier.size(20.dp), tint = c.onSurfaceVariant)
        }
    }
}

@Composable
internal fun LaoBottomSheet(onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val c = MaterialTheme.colorScheme
    val motion = LocalMotionEnabled.current
    val scope = rememberCoroutineScope()
    val focusManager = LocalFocusManager.current
    var entered by remember { mutableStateOf(false) }
    var closing by remember { mutableStateOf(false) }
    var drag by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf(false) }
    val settled by
        animateFloatAsState(
            drag,
            if (motion) spring(.86f, 330f) else snap(),
            label = "sheet drag spring",
        )
    val density = LocalDensity.current
    LaunchedEffect(Unit) {
        focusManager.clearFocus(force = true)
        entered = true
    }
    fun dismiss() {
        if (closing) return
        closing = true
        if (!motion) onDismiss()
        else {
            entered = false
            scope.launch {
                delay(180)
                onDismiss()
            }
        }
    }
    val alpha by
        animateFloatAsState(
            if (entered) 1f else 0f,
            if (motion) tween(160) else snap(),
            label = "sheet scrim",
        )
    BackHandler { dismiss() }
    Box(
        Modifier.fillMaxSize().semantics {
            paneTitle = "操作面板"
            isTraversalGroup = true
        }
    ) {
        Box(
            Modifier.matchParentSize()
                .background(Color(0xFF151526).copy(alpha = .28f * alpha))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {
                    dismiss()
                }
        )
        AnimatedVisibility(
            entered,
            Modifier.align(Alignment.BottomCenter),
            enter =
                if (motion) slideInVertically(spring(.86f, 320f)) { it } + fadeIn(tween(140))
                else EnterTransition.None,
            exit =
                if (motion) slideOutVertically(tween(180)) { it } + fadeOut(tween(120))
                else ExitTransition.None,
        ) {
            CompositionLocalProvider(LocalContentColor provides c.onSurface) {
                ProvideTextStyle(LaoType.body) {
                    Column(
                        Modifier.widthIn(max = 680.dp)
                            .fillMaxWidth()
                            .offset { IntOffset(0, (if (dragging) drag else settled).roundToInt()) }
                            .clip(RoundedCornerShape(topStart = 32.dp, topEnd = 32.dp))
                            .background(
                                Brush.verticalGradient(
                                    listOf(c.surface, lerp(c.surface, c.primary, .025f))
                                )
                            )
                            .pointerInput(Unit) { detectTapGestures(onTap = {}) }
                            .navigationBarsPadding()
                            .padding(top = 12.dp, bottom = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        Box(
                            Modifier.fillMaxWidth()
                                .height(20.dp)
                                .draggable(
                                    rememberDraggableState { drag = (drag + it).coerceAtLeast(0f) },
                                    Orientation.Vertical,
                                    onDragStarted = { dragging = true },
                                    onDragStopped = {
                                        dragging = false
                                        if (drag > with(density) { 72.dp.toPx() }) dismiss()
                                        else drag = 0f
                                    },
                                )
                                .semantics { contentDescription = "下拉关闭弹层" },
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                Modifier.width(40.dp)
                                    .height(4.dp)
                                    .background(c.onSurfaceVariant.copy(alpha = .3f), CircleShape)
                            )
                        }
                        content()
                    }
                }
            }
        }
    }
}

@Composable
internal fun LaoGlyph(
    route: String,
    selected: Boolean,
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier) {
        val scale = size.width / 24f
        drawContext.canvas.save()
        drawContext.canvas.scale(scale, scale)
        val stroke = Stroke(1.8f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        when (route) {
            "home" -> {
                val p =
                    Path().apply {
                        moveTo(3f, 10f)
                        lineTo(12f, 3f)
                        lineTo(21f, 10f)
                        moveTo(5f, 10f)
                        lineTo(5f, 20f)
                        lineTo(10f, 20f)
                        lineTo(10f, 14f)
                        lineTo(14f, 14f)
                        lineTo(14f, 20f)
                        lineTo(19f, 20f)
                        lineTo(19f, 10f)
                    }
                if (selected)
                    drawRoundRect(
                        tint.copy(alpha = .1f),
                        Offset(5f, 8f),
                        Size(14f, 12f),
                        CornerRadius(2f),
                    )
                drawPath(p, tint, style = stroke)
            }
            "calendar" -> {
                drawRoundRect(
                    tint,
                    Offset(4f, 5f),
                    Size(16f, 16f),
                    CornerRadius(4f),
                    style = stroke,
                )
                drawLine(tint, Offset(4f, 10f), Offset(20f, 10f), 1.8f)
                drawLine(tint, Offset(8f, 3f), Offset(8f, 7f), 1.8f, cap = StrokeCap.Round)
                drawLine(tint, Offset(16f, 3f), Offset(16f, 7f), 1.8f, cap = StrokeCap.Round)
                drawCircle(tint, if (selected) 2f else 1.2f, Offset(12f, 15f))
            }
            "wall" -> {
                val p =
                    Path().apply {
                        moveTo(5f, 4f)
                        lineTo(19f, 4f)
                        quadraticTo(21f, 4f, 21f, 7f)
                        lineTo(21f, 15f)
                        quadraticTo(21f, 18f, 18f, 18f)
                        lineTo(10f, 18f)
                        lineTo(5f, 21f)
                        lineTo(5f, 18f)
                        quadraticTo(3f, 18f, 3f, 15f)
                        lineTo(3f, 7f)
                        quadraticTo(3f, 4f, 5f, 4f)
                        close()
                    }
                if (selected) drawPath(p, tint.copy(alpha = .1f))
                drawPath(p, tint, style = stroke)
                for (x in listOf(8f, 12f, 16f)) drawCircle(tint, 1f, Offset(x, 11f))
            }
            "tools" -> {
                for (x in listOf(4f, 14f)) for (y in listOf(4f, 14f)) drawRoundRect(
                    tint,
                    Offset(x, y),
                    Size(6f, 6f),
                    CornerRadius(2f),
                    style =
                        if (selected && x == y) androidx.compose.ui.graphics.drawscope.Fill
                        else stroke,
                )
            }
            else -> {
                drawCircle(tint, 4f, Offset(12f, 8f), style = stroke)
                drawArc(tint, 180f, 180f, false, Offset(4f, 14f), Size(16f, 12f), style = stroke)
                drawLine(tint, Offset(4f, 20f), Offset(20f, 20f), 1.8f, cap = StrokeCap.Round)
            }
        }
        drawContext.canvas.restore()
    }
}
