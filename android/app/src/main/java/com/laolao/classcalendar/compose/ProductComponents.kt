package com.laolao.classcalendar

import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

/** Shared native product components. Colors always resolve from the selected theme. */
internal object CampusStatus {
    @Composable
    fun success() =
        if (MaterialTheme.colorScheme.background.luminance() < .3f) Color(0xFF8BD6B9)
        else Color(0xFF347969)

    @Composable
    fun warning() =
        if (MaterialTheme.colorScheme.background.luminance() < .3f) Color(0xFFF5C391)
        else Color(0xFF95613B)

    @Composable
    fun ai() =
        if (MaterialTheme.colorScheme.background.luminance() < .3f) Color(0xFFBCCAF7)
        else Color(0xFF5369A8)
}

@Composable
internal fun ProductSurface(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.surface,
    padding: Dp = 16.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) = LaoPanel(modifier, color, padding, onClick, content = content)

@Composable
internal fun ProductIntro(
    title: String,
    subtitle: String,
    action: String? = null,
    click: () -> Unit = {},
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.headlineMedium, letterSpacing = (-.5).sp)
            Text(
                subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (action != null) TextButton(onClick = click) { Text(action) }
    }
}

@Composable
internal fun StatusPill(
    label: String,
    color: Color = MaterialTheme.colorScheme.primary,
    icon: ImageVector? = null,
) {
    Row(
        Modifier.clip(CircleShape)
            .background(color.copy(alpha = .09f))
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (icon != null) Icon(icon, null, Modifier.size(12.dp), tint = color)
        Text(label, style = MaterialTheme.typography.labelSmall, color = color, maxLines = 1)
    }
}

@Composable
internal fun ProductTabs(options: List<String>, selected: String, change: (String) -> Unit) {
    val colors = MaterialTheme.colorScheme
    BoxWithConstraints(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(colors.surfaceContainer)
            .padding(4.dp)
    ) {
        val cell = maxWidth / options.size
        val x by
            animateDpAsState(
                cell * options.indexOf(selected).coerceAtLeast(0),
                if (LocalMotionEnabled.current) spring(dampingRatio = .82f, stiffness = 420f)
                else snap(),
                label = "segmented highlight",
            )
        // The moving selection is laid out separately from each accessible tab target.
        Box(
            Modifier.offset(x = x)
                .width(cell)
                .height(48.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(colors.surface.copy(alpha = .94f))
        )
        Row {
            options.forEach { label ->
                val source = remember { MutableInteractionSource() }
                val on = selected == label
                Box(
                    Modifier.weight(1f)
                        .heightIn(min = 48.dp)
                        .springPress(source)
                        .clip(RoundedCornerShape(12.dp))
                        .clickable(source, null, role = Role.Tab) { change(label) }
                        .semantics {
                            this.selected = on
                            contentDescription = label
                        }
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        style = MaterialTheme.typography.labelLarge,
                        color = if (on) colors.primary else colors.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
internal fun ProductMetric(
    value: String,
    label: String,
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    click: (() -> Unit)? = null,
) {
    val source = remember { MutableInteractionSource() }
    val motion = LocalMotionEnabled.current
    Column(
        modifier
            .springPress(source)
            .then(
                if (click != null) Modifier.clickable(source, null, onClick = click) else Modifier
            ),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        AnimatedContent(
            targetState = value,
            transitionSpec = {
                if (motion)
                    (fadeIn(tween(200)) + slideInVertically { it / 3 }).togetherWith(
                        fadeOut(tween(100)) + slideOutVertically { -it / 3 }
                    )
                else EnterTransition.None.togetherWith(ExitTransition.None)
            },
            label = "metric update",
        ) {
            Text(it, style = MaterialTheme.typography.headlineSmall, color = color, maxLines = 1)
        }
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun ProductLink(
    label: String,
    note: String,
    route: String,
    s: CampusSession,
    trailing: String? = null,
) {
    val source = remember { MutableInteractionSource() }
    Row(
        Modifier.fillMaxWidth()
            .heightIn(min = 64.dp)
            .springPress(source)
            .clip(RoundedCornerShape(16.dp))
            .clickable(source, null) { s.open(route) }
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        IconTile(route, 40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, style = MaterialTheme.typography.titleMedium)
            if (note.isNotBlank())
                Text(
                    note,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
        }
        if (trailing != null)
            Text(
                trailing,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        Icon(
            Icons.Rounded.ChevronRight,
            null,
            Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun AiAction(label: String, modifier: Modifier = Modifier, click: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val color = CampusStatus.ai()
    Row(
        modifier
            .heightIn(min = 48.dp)
            .springPress(source)
            .clip(RoundedCornerShape(16.dp))
            .background(color.copy(alpha = .08f))
            .clickable(source, null, onClick = click)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Icon(Icons.Rounded.AutoAwesome, null, Modifier.size(16.dp), tint = color)
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = color)
        Icon(Icons.AutoMirrored.Rounded.ArrowForward, null, Modifier.size(16.dp), tint = color)
    }
}

@Composable
internal fun ProductState(
    title: String,
    body: String,
    icon: ImageVector = Icons.Rounded.EventAvailable,
    action: String? = null,
    error: Boolean = false,
    click: () -> Unit = {},
) {
    val colors = MaterialTheme.colorScheme
    ProductSurface(Modifier.fillMaxWidth(), color = colors.surfaceContainerLow, padding = 24.dp) {
        Box(
            Modifier.size(48.dp).clip(RoundedCornerShape(16.dp)).background(colors.surface),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = if (error) colors.error else colors.primary)
        }
        Text(title, style = MaterialTheme.typography.titleMedium)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant)
        if (action != null) SoftButton(action, onClick = click)
    }
}

@Composable
internal fun LoadingLines(label: String) {
    val colors = MaterialTheme.colorScheme
    val motion = LocalMotionEnabled.current
    val transition = rememberInfiniteTransition(label = "waiting")
    val alpha by
        transition.animateFloat(
            .35f,
            .75f,
            infiniteRepeatable(tween(850), RepeatMode.Reverse),
            label = "loading pulse",
        )
    ProductSurface(Modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            Text(label, style = MaterialTheme.typography.labelLarge)
        }
        repeat(3) { i ->
            Box(
                Modifier.fillMaxWidth(if (i == 2) .6f else 1f)
                    .height(8.dp)
                    .clip(CircleShape)
                    .background(colors.primary.copy(alpha = (if (motion) alpha else .5f) * .12f))
            )
        }
    }
}
