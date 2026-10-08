package com.laolao.classcalendar

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.graphics.*
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.*

internal object CampusAccent {
    val blue = Color(0xFF4262D6)
    val berry = Color(0xFFBD3C77)
    val mint = Color(0xFF13836A)
    val violet = Color(0xFF7654CB)
    val amber = Color(0xFFA66319)

    @Composable
    fun readable(color: Color): Color =
        if (MaterialTheme.colorScheme.background.luminance() < .3f) lerp(color, Color.White, .44f)
        else color
}

internal fun campusName(a: CampusActivity) =
    a.me.optString("display_name").ifBlank { a.me.optString("name").ifBlank { "同学" } }

@Composable internal fun CampusDailyHomePage(s: CampusSession) = LaoCampusHome(s)
