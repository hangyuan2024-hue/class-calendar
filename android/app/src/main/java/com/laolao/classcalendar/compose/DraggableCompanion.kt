package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*
import kotlin.math.roundToInt

@Composable
internal fun DraggableCompanion(s: CampusSession) {
    if (!CampusGuide.enabled(s.a)) return
    val c = MaterialTheme.colorScheme
    val density = LocalDensity.current
    var x by rememberSaveable(s.a.store.owner) { mutableFloatStateOf(s.a.store.string("native_mascot_x", "0.05").toFloatOrNull() ?: .05f) }
    var y by rememberSaveable(s.a.store.owner) { mutableFloatStateOf(s.a.store.string("native_mascot_y", "1.0").toFloatOrNull() ?: 1f) }
    BoxWithConstraints(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(top = 64.dp, bottom = 150.dp, start = 8.dp, end = 8.dp)) {
        val width = with(density) { maxWidth.toPx() }
        val height = with(density) { maxHeight.toPx() }
        val dot = with(density) { 64.dp.toPx() }
        val travelX = (width-dot).coerceAtLeast(1f)
        val travelY = (height-dot).coerceAtLeast(1f)
        fun persist() {
            s.a.store.set("native_mascot_x", x)
            s.a.store.set("native_mascot_y", y)
        }
        Box(Modifier.offset { IntOffset((x.coerceIn(0f,1f)*travelX).roundToInt(),(y.coerceIn(0f,1f)*travelY).roundToInt()) }
            .size(64.dp).pointerInput(travelX,travelY) {
                detectDragGestures(onDragEnd={persist()}, onDragCancel={persist()}) { change, amount ->
                    change.consume(); x=(x+amount.x/travelX).coerceIn(0f,1f);y=(y+amount.y/travelY).coerceIn(0f,1f)
                }
            }.semantics { contentDescription="捞捞提示伙伴，可拖动" }) {
            LaoMascot(Modifier.fillMaxSize(),onTap={s.sheet = GuideSheet})
        }
    }
}