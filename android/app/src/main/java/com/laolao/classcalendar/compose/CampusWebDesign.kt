package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*

/** Native layout tokens measured from the mobile site at commit 8bc3ff5. */
@Immutable
internal data class WebColors(
    val bg: Color,
    val card: Color,
    val ink: Color,
    val sub: Color,
    val primary: Color,
    val line: Color,
    val hero: Color,
    val selected: Color,
    val apricot: Color,
    val sage: Color,
)

internal object WebDesign {
    val headline = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold)
    val title = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Bold)
    val body = TextStyle(fontSize = 14.sp, lineHeight = 22.sp)
    val caption = TextStyle(fontSize = 12.sp, lineHeight = 19.sp)
    val eyebrow = TextStyle(fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.SemiBold)

    @Composable
    fun colors(): WebColors {
        val material = MaterialTheme.colorScheme
        val dark = material.background.luminance() < .3f
        return WebColors(
            bg = material.background,
            card = material.surface,
            ink = material.onSurface,
            sub = material.onSurfaceVariant,
            primary = material.primary,
            line = material.outlineVariant,
            hero = material.primaryContainer,
            selected = lerp(material.surface, material.primary, if (dark) .16f else .08f),
            apricot = if (dark) Color(0xFF3A2D29) else Color(0xFFFFF0E1),
            sage = if (dark) Color(0xFF203D37) else Color(0xFFE8EFEB),
        )
    }
}

@Composable
internal fun WebPage(spacing: Dp = 16.dp, content: LazyListScope.() -> Unit) {
    val state = LocalPageListState.current ?: rememberLazyListState()
    val edge = if (LocalConfiguration.current.screenWidthDp <= 370) 12.dp else 16.dp
    LazyColumn(
        modifier = Modifier.fillMaxSize().background(WebDesign.colors().bg),
        state = state,
        contentPadding = PaddingValues(start = edge, end = edge, top = 24.dp, bottom = 116.dp),
        verticalArrangement = Arrangement.spacedBy(spacing),
        content = content,
    )
}

@Composable
internal fun WebCard(
    modifier: Modifier = Modifier,
    color: Color = WebDesign.colors().card,
    padding: Dp = 16.dp,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = WebDesign.colors()
    val shape = RoundedCornerShape(18.dp)
    Column(
        modifier
            .clip(shape)
            .background(color)
            .border(1.dp, colors.line, shape)
            .then(
                if (onClick == null) Modifier
                else Modifier.laoTap(role = Role.Button, action = onClick)
            )
            .padding(padding),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        content = content,
    )
}

@Composable
internal fun WebSectionTitle(
    title: String,
    modifier: Modifier = Modifier,
    eyebrow: String? = null,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    val c = WebDesign.colors()
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (eyebrow != null) Text(eyebrow, style = WebDesign.eyebrow, color = c.sub)
            Text(title, style = WebDesign.title, color = c.ink)
        }
        if (action != null) WebButton(action, filled = false, onClick = onAction)
    }
}

@Composable
internal fun WebButton(
    text: String,
    modifier: Modifier = Modifier,
    filled: Boolean = true,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val c = WebDesign.colors()
    val shape = RoundedCornerShape(11.dp)
    Box(
        modifier
            .heightIn(min = 40.dp)
            .clip(shape)
            .background(
                if (filled) c.primary.copy(alpha = if (enabled) 1f else .35f) else Color.Transparent
            )
            .then(if (enabled) Modifier.laoTap(role = Role.Button, action = onClick) else Modifier)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = WebDesign.caption.copy(fontWeight = FontWeight.SemiBold),
            color = if (filled) Color.White else c.primary.copy(alpha = if (enabled) 1f else .35f),
        )
    }
}

@Composable
internal fun WebIconButton(
    icon: ImageVector,
    description: String,
    modifier: Modifier = Modifier,
    selected: Boolean = false,
    onClick: () -> Unit,
) {
    val c = WebDesign.colors()
    Box(
        modifier
            .size(40.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(if (selected) c.primary else c.selected)
            .laoTap(role = Role.Button, action = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            icon,
            description,
            Modifier.size(20.dp),
            tint = if (selected) Color.White else c.primary,
        )
    }
}

@Composable
internal fun WebPill(
    label: String,
    selected: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = WebDesign.colors()
    Box(
        modifier
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) c.selected else c.card)
            .border(
                1.dp,
                if (selected) c.primary.copy(alpha = .25f) else c.line,
                RoundedCornerShape(10.dp),
            )
            .laoTap(role = Role.Tab, action = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = WebDesign.caption, color = if (selected) c.primary else c.sub)
    }
}

@Composable
internal fun WebInput(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    val c = WebDesign.colors()
    OutlinedTextField(
        value,
        onValueChange,
        modifier,
        singleLine = true,
        placeholder = { Text(placeholder, style = WebDesign.body) },
        textStyle = WebDesign.body,
        shape = RoundedCornerShape(12.dp),
        colors =
            OutlinedTextFieldDefaults.colors(
                focusedBorderColor = c.primary,
                unfocusedBorderColor = c.line,
                focusedContainerColor = c.card,
                unfocusedContainerColor = c.card,
                focusedTextColor = c.ink,
                unfocusedTextColor = c.ink,
                cursorColor = c.primary,
            ),
    )
}

@Composable
internal fun WebEmpty(
    title: String,
    body: String = "",
    action: String? = null,
    onClick: () -> Unit = {},
) {
    val c = WebDesign.colors()
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(c.bg).padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = WebDesign.body, color = c.sub)
        if (body.isNotBlank()) Text(body, style = WebDesign.caption, color = c.sub)
        if (action != null) WebButton(action, filled = false, onClick = onClick)
    }
}

@Composable
internal fun WebLinkRow(
    title: String,
    note: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val c = WebDesign.colors()
    Row(
        modifier.fillMaxWidth().heightIn(min = 56.dp).laoTap(role = Role.Button, action = onClick),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, Modifier.size(24.dp), tint = c.primary)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                title,
                style = WebDesign.body.copy(fontWeight = FontWeight.SemiBold),
                color = c.ink,
            )
            if (note.isNotEmpty())
                Text(
                    note,
                    style = WebDesign.caption,
                    color = c.sub,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
        }
        Text("›", fontSize = 24.sp, color = c.sub)
    }
}
