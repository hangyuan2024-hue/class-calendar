package com.laolao.classcalendar

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.*
import androidx.compose.ui.semantics.Role

/** Native vector drawing of index.html #mascotArt, including the original facial proportions. */
@Composable
internal fun LaoMascot(
    modifier: Modifier = Modifier,
    expressive: Boolean = true,
    onTap: (() -> Unit)? = null,
) {
    val source = remember { MutableInteractionSource() }
    val motion = LocalMotionEnabled.current && expressive
    val breath: State<Float>
    val blink: State<Float>
    val wave: State<Float>
    if (motion) {
        val t = rememberInfiniteTransition(label = "laolao companion")
        breath =
            t.animateFloat(
                -1.4f,
                1.4f,
                infiniteRepeatable(tween(2800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
                label = "breathing",
            )
        blink =
            t.animateFloat(
                1f,
                1f,
                infiniteRepeatable(
                    keyframes {
                        durationMillis = 6200
                        1f at 0
                        1f at 3800
                        .10f at 3900
                        1f at 4020
                        1f at 4200
                        .10f at 4290
                        1f at 4410
                        1f at 6200
                    }
                ),
                label = "blink",
            )
        wave =
            t.animateFloat(
                0f,
                0f,
                infiniteRepeatable(
                    keyframes {
                        durationMillis = 8200
                        0f at 0
                        0f at 700
                        -12f at 1050
                        7f at 1350
                        -10f at 1650
                        6f at 1950
                        0f at 2350
                        0f at 8200
                    }
                ),
                label = "wave",
            )
    } else {
        breath = remember { mutableFloatStateOf(0f) }
        blink = remember { mutableFloatStateOf(1f) }
        wave = remember { mutableFloatStateOf(0f) }
    }
    Canvas(
        modifier
            .springPress(source)
            .then(
                if (onTap != null)
                    Modifier.clickable(
                        source,
                        null,
                        role = Role.Button,
                        onClickLabel = "和捞捞聊聊",
                        onClick = onTap,
                    )
                else Modifier
            )
    ) {
        val scale = minOf(size.width, size.height) / 120f
        val navy = Color(0xFF0E2240)
        val orange = Color(0xFFFF8A3D)
        val stroke = Stroke(5f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        withTransform({
            translate((size.width - 120f * scale) / 2, (size.height - 120f * scale) / 2)
            scale(scale, scale, Offset.Zero)
        }) {
            drawOval(Color(0x260A325A), Offset(30f, 107f), Size(60f, 10f))
            withTransform({ translate(0f, breath.value) }) {
                withTransform({ rotate(wave.value, Offset(96f, 74f)) }) {
                    drawPath(
                        Path().apply {
                            moveTo(96f, 74f)
                            quadraticBezierTo(112f, 70f, 114f, 52f)
                        },
                        navy,
                        style = stroke,
                    )
                    drawCircle(Color.White, 6f, Offset(114f, 50f))
                    drawCircle(navy, 6f, Offset(114f, 50f), style = Stroke(4f))
                }
                drawPath(
                    Path().apply {
                        moveTo(24f, 78f)
                        quadraticBezierTo(12f, 84f, 12f, 96f)
                    },
                    navy,
                    style = stroke,
                )
                drawRoundRect(Color.White, Offset(22f, 28f), Size(76f, 78f), CornerRadius(24f))
                drawRoundRect(
                    navy,
                    Offset(22f, 28f),
                    Size(76f, 78f),
                    CornerRadius(24f),
                    style = stroke,
                )
                val cap =
                    Path().apply {
                        moveTo(22f, 54f)
                        lineTo(22f, 52f)
                        cubicTo(22f, 38.745f, 32.745f, 28f, 46f, 28f)
                        lineTo(74f, 28f)
                        cubicTo(87.255f, 28f, 98f, 38.745f, 98f, 52f)
                        lineTo(98f, 54f)
                        close()
                    }
                drawPath(cap, orange)
                drawPath(cap, navy, style = stroke)
                listOf(40f, 71f).forEach { x ->
                    drawRoundRect(navy, Offset(x, 16f), Size(9f, 22f), CornerRadius(4.5f))
                }
                val eye = blink.value
                listOf(46f, 74f).forEach { x ->
                    drawOval(navy, Offset(x - 6f, 74f - 7.5f * eye), Size(12f, 15f * eye))
                    if (eye > .45f)
                        drawCircle(Color.White, 2.2f * eye, Offset(x + 2f, 74f - 3f * eye))
                }
                drawOval(Color(0xCCFF9DB5), Offset(30f, 82.5f), Size(12f, 7f))
                drawOval(Color(0xCCFF9DB5), Offset(78f, 82.5f), Size(12f, 7f))
                drawPath(
                    Path().apply {
                        moveTo(54f, 88f)
                        quadraticBezierTo(60f, 94f, 66f, 88f)
                    },
                    navy,
                    style = Stroke(4f, cap = StrokeCap.Round),
                )
                drawPath(
                    Path().apply {
                        moveTo(104f, 18f)
                        lineTo(107f, 25f)
                        lineTo(114f, 28f)
                        lineTo(107f, 31f)
                        lineTo(104f, 38f)
                        lineTo(101f, 31f)
                        lineTo(94f, 28f)
                        lineTo(101f, 25f)
                        close()
                    },
                    Color(0xFFFFD23F),
                )
            }
        }
    }
}
