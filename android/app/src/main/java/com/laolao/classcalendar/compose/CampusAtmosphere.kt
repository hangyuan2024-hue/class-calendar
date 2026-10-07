package com.laolao.classcalendar

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.unit.*

/** Diffuse native gradients underneath translucent surfaces; no bitmap blur or web content. */
@Composable
internal fun CampusBackdrop(modifier: Modifier = Modifier) {
    val c = MaterialTheme.colorScheme
    val dark = c.background.luminance() < .3f
    val drift: State<Float> =
        if (LocalMotionEnabled.current) {
            rememberInfiniteTransition(label = "campus atmosphere")
                .animateFloat(
                    initialValue = -.025f,
                    targetValue = .025f,
                    animationSpec =
                        infiniteRepeatable(tween(10000, easing = SineEase), RepeatMode.Reverse),
                    label = "light drift",
                )
        } else remember { mutableFloatStateOf(0f) }
    Canvas(modifier) {
        // Read animation only in the draw phase, keeping layout and UI composition stable.
        val shift = drift.value * size.width
        val radius = size.width * .86f
        val a = Offset(size.width + shift, size.height * .08f)
        val b = Offset(-shift, size.height * .62f)
        drawCircle(
            Brush.radialGradient(
                listOf(c.primary.copy(alpha = if (dark) .18f else .11f), Color.Transparent),
                a,
                radius,
            ),
            radius,
            a,
        )
        drawCircle(
            Brush.radialGradient(
                listOf(CampusLightLilac.copy(alpha = if (dark) .11f else .10f), Color.Transparent),
                b,
                radius,
            ),
            radius,
            b,
        )
    }
}

private val CampusLightLilac = Color(0xFF8B9CCC)
private val SineEase = Easing { ((1.0 - kotlin.math.cos(it * Math.PI)) / 2.0).toFloat() }

@Composable
internal fun Modifier.campusGlass(
    base: Color,
    shape: RoundedCornerShape = RoundedCornerShape(24.dp),
    elevation: Dp = 3.dp,
): Modifier {
    val c = MaterialTheme.colorScheme
    val dark = c.background.luminance() < .3f
    // Saturated course cards retain enough opacity for white foreground text.
    val strong = !dark && base.luminance() < .35f
    val top = base.copy(alpha = if (strong) .99f else if (dark) .94f else .91f)
    val bottom = base.copy(alpha = if (strong) .96f else if (dark) .86f else .76f)
    return shadow(
            elevation,
            shape,
            ambientColor = c.primary.copy(alpha = .06f),
            spotColor = c.primary.copy(alpha = .09f),
        )
        .clip(shape)
        .background(Brush.linearGradient(listOf(top, bottom)))
        .border(
            1.dp,
            Brush.linearGradient(
                listOf(
                    Color.White.copy(alpha = if (dark) .15f else .78f),
                    c.primary.copy(alpha = if (dark) .10f else .09f),
                    Color.White.copy(alpha = if (dark) .04f else .30f),
                )
            ),
            shape,
        )
}
