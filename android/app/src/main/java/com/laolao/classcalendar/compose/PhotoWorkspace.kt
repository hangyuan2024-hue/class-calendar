package com.laolao.classcalendar

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Composable
internal fun rememberRecordBitmap(a: CampusActivity, id: String): Bitmap? {
    val bitmap by
        produceState<Bitmap?>(null, a.store.owner, id) {
            value =
                withContext(Dispatchers.IO) {
                    if (!CampusPhone.validId(id)) return@withContext null
                    val file = CampusPhone.file(a, id)
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeFile(file.path, bounds)
                    if (bounds.outWidth < 1 || bounds.outHeight < 1) return@withContext null
                    val options = BitmapFactory.Options()
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
                    options.inSampleSize = sample
                    BitmapFactory.decodeFile(file.path, options)
                }
        }
    return bitmap
}

@Composable
internal fun ColumnScope.PhotoContent(s: CampusSession, photo: PhotoSheet) {
    SheetHeading("记录图片") { s.closeSheet() }
    val bitmap = rememberRecordBitmap(s.a, photo.id)
    var scale by remember(photo.id) { mutableFloatStateOf(1f) }
    var offset by remember(photo.id) { mutableStateOf(Offset.Zero) }
    val transform = rememberTransformableState { zoom, pan, _ ->
        scale = (scale * zoom).coerceIn(1f, 5f)
        offset = if (scale == 1f) Offset.Zero else offset + pan
    }
    Box(
        Modifier.fillMaxWidth()
            .weight(1f)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerLow),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap == null) CircularProgressIndicator()
        else
            Image(
                bitmap.asImageBitmap(),
                "记录照片，可双指缩放",
                Modifier.fillMaxSize()
                    .graphicsLayer(
                        scaleX = scale,
                        scaleY = scale,
                        translationX = offset.x,
                        translationY = offset.y,
                    )
                    .transformable(transform),
                contentScale = ContentScale.Fit,
            )
    }
    Text(
        "双指缩放查看细节，拖动可移动图片。",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        SoftButton("恢复大小", Modifier.weight(1f)) {
            scale = 1f
            offset = Offset.Zero
        }
        SoftButton("分享图片", Modifier.weight(1f)) {
            s.invoke { CampusPhone.shareFile(s.a, CampusPhone.file(s.a, photo.id), "image/jpeg") }
        }
    }
}
