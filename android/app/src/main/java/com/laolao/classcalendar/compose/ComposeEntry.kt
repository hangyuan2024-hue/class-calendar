package com.laolao.classcalendar

import android.app.AlertDialog
import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.drawable.BitmapDrawable
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.*
import androidx.activity.compose.setContent
import androidx.compose.runtime.*
import java.util.WeakHashMap
import java.util.function.IntConsumer
import org.json.JSONObject

/** Keeps the proven data/API/device controllers; every visible page and form is Compose. */
object ComposeEntry {
    private val sessions = WeakHashMap<CampusActivity, CampusSession>()

    @JvmStatic fun active(a: CampusActivity) = sessions.containsKey(a)

    @JvmStatic
    fun dispose(a: CampusActivity) {
        sessions.remove(a)?.closeSheet()
    }

    @JvmStatic
    fun install(a: CampusActivity) {
        a.scroll = ScrollView(a)
        val session = CampusSession(a)
        sessions[a] = session
        a.setContent { LaoLaoApp(session) }
    }

    @JvmStatic
    fun refresh(a: CampusActivity) {
        sessions[a]?.refresh()
    }

    @JvmStatic
    fun notice(a: CampusActivity, message: String) {
        sessions[a]?.notice = message
    }

    @JvmStatic
    fun form(
        a: CampusActivity,
        title: String,
        action: String,
        initial: JSONObject,
        save: CampusUi.Save,
        fields: Array<CampusUi.Field>,
    ) {
        sessions[a]?.sheet =
            FormSheet(title, action, JSONObject(initial.toString()), fields.toList(), save)
    }

    @JvmStatic
    fun choose(a: CampusActivity, title: String, options: Array<String>, callback: IntConsumer) {
        sessions[a]?.sheet = ChoiceSheet(title, options.toList()) { callback.accept(it) }
    }

    @JvmStatic
    fun confirm(a: CampusActivity, title: String, body: String, yes: Runnable) {
        sessions[a]?.sheet = ConfirmSheet(title, body) { yes.run() }
    }

    @JvmStatic
    fun message(
        a: CampusActivity,
        title: String,
        body: String,
        options: Array<String>,
        callback: IntConsumer,
    ) {
        sessions[a]?.sheet = MessageSheet(title, body, options.toList()) { callback.accept(it) }
    }

    @JvmStatic
    fun guide(a: CampusActivity) {
        sessions[a]?.sheet = GuideSheet
    }

    @JvmStatic
    fun photo(a: CampusActivity, id: String) {
        sessions[a]?.sheet = PhotoSheet(id)
    }

    @JvmStatic
    fun dialog(a: CampusActivity, dialog: AlertDialog) {
        val state = sessions[a] ?: return
        // Custom legacy controllers are converted into Compose models. The window is invisible,
        // not focusable and not touchable; it supplies callbacks only and never renders app UI.
        dialog.window?.apply {
            addFlags(
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
            )
            attributes = attributes.apply { alpha = 0f }
        }
        dialog.show()
        dialog.window?.attributes = dialog.window!!.attributes.apply { alpha = 0f }
        val decor = dialog.window?.decorView ?: return
        val titleId = a.resources.getIdentifier("alertTitle", "id", "android")
        val title =
            decor.findViewById<TextView>(titleId)?.text?.toString().orEmpty().ifEmpty { "操作" }
        val customId = a.resources.getIdentifier("custom", "id", "android")
        val body = decor.findViewById<View>(customId)
        val messages = decor.findViewById<TextView>(android.R.id.message)
        val actions =
            listOf(
                    AlertDialog.BUTTON_NEUTRAL,
                    AlertDialog.BUTTON_NEGATIVE,
                    AlertDialog.BUTTON_POSITIVE,
                )
                .mapNotNull { id ->
                    dialog
                        .getButton(id)
                        ?.takeIf { it.visibility == View.VISIBLE }
                        ?.let { b ->
                            PanelAction(b.text.toString(), id == AlertDialog.BUTTON_POSITIVE) {
                                b.performClick()
                                a.handler.post {
                                    if (
                                        !dialog.isShowing &&
                                            (state.sheet as? PanelSheet)?.native === dialog
                                    )
                                        state.sheet = null
                                    state.panelRevision++
                                }
                            }
                        }
                }
        val list = dialog.listView
        val nodes =
            if (body != null) FeatureModels.read(body, a)
            else
                messages?.let { listOf(FeatureNode.Copy(it.text.toString(), 15f, false)) }.orEmpty()
        val lists =
            if (list != null)
                List(list.count) { i ->
                    FeatureNode.Action(list.adapter.getItem(i).toString()) {
                        list.performItemClick(
                            list.adapter.getView(i, null, list),
                            i,
                            list.adapter.getItemId(i),
                        )
                        a.handler.post {
                            if (
                                !dialog.isShowing && (state.sheet as? PanelSheet)?.native === dialog
                            )
                                state.sheet = null
                            state.panelRevision++
                        }
                    }
                }
            else emptyList()
        state.sheet = PanelSheet(title, nodes + lists, actions, dialog, body)
        dialog.hide()
    }
}

internal class CampusSession(val activity: CampusActivity) {
    var route by mutableStateOf(activity.page)
    var revision by mutableIntStateOf(0)
    var nodes by mutableStateOf<List<FeatureNode>>(emptyList())
    private var currentSheet by mutableStateOf<CampusSheet?>(null)
    var sheet: CampusSheet?
        get() = currentSheet
        set(value) {
            val previous = currentSheet
            if (previous !== value && previous is PanelSheet) previous.native.dismiss()
            currentSheet = value
        }

    var notice by mutableStateOf("")
    var agentPrompt by mutableStateOf("")
    var panelRevision by mutableIntStateOf(0)
    val a
        get() = activity

    fun refresh() {
        route = a.page
        if (route !in ModernPages.routes) nodes = FeatureModels.read(a.featureContent(), a)
        else nodes = emptyList()
        revision++
    }

    fun open(route: String) {
        a.open(route)
    }

    fun closeSheet() {
        (sheet as? PanelSheet)?.native?.dismiss()
        sheet = null
    }

    fun refreshControls() {
        val panel = sheet as? PanelSheet
        if (panel?.source != null) panelRevision++
        else if (route !in ModernPages.routes && a.content != null)
            nodes = FeatureModels.read(a.content, a)
    }

    fun invoke(block: () -> Unit) {
        try {
            block()
            refreshControls()
        } catch (e: Exception) {
            notice = e.message ?: "操作未完成，请重试"
        }
    }
}

internal sealed interface CampusSheet

internal class FormSheet(
    val title: String,
    val action: String,
    val initial: JSONObject,
    val fields: List<CampusUi.Field>,
    val save: CampusUi.Save,
) : CampusSheet

internal class ChoiceSheet(
    val title: String,
    val options: List<String>,
    val action: (Int) -> Unit,
) : CampusSheet

internal class ConfirmSheet(val title: String, val body: String, val yes: () -> Unit) : CampusSheet

internal class MessageSheet(
    val title: String,
    val body: String,
    val options: List<String>,
    val action: (Int) -> Unit,
) : CampusSheet

internal data object GuideSheet : CampusSheet

internal data object ToolPickerSheet : CampusSheet

internal data object QuickAddSheet : CampusSheet

internal data object HomeEditorSheet : CampusSheet

internal data object SearchSheet : CampusSheet

internal data object AlertsSheet : CampusSheet

internal class DrawImportSheet(val names: List<String>, val filename: String) : CampusSheet

internal class PhotoSheet(val id: String) : CampusSheet

internal class PanelAction(val text: String, val primary: Boolean, val click: () -> Unit)

internal class PanelSheet(
    val title: String,
    val nodes: List<FeatureNode>,
    val actions: List<PanelAction>,
    val native: AlertDialog,
    val source: View?,
) : CampusSheet

/** Semantic feature descriptors, not AndroidView wrappers; actions retain validation/storage. */
internal sealed interface FeatureNode {
    class Copy(val text: String, val size: Float, val bold: Boolean, val source: TextView? = null) :
        FeatureNode

    class Action(val text: String, val enabled: Boolean = true, val click: () -> Unit) :
        FeatureNode

    class Group(
        val horizontal: Boolean,
        val card: Boolean,
        val children: List<FeatureNode>,
        val click: (() -> Unit)? = null,
    ) : FeatureNode

    class Toggle(val text: String, val source: CompoundButton) : FeatureNode

    class Input(val source: EditText) : FeatureNode

    class Select(val source: Spinner) : FeatureNode

    class Range(val source: SeekBar) : FeatureNode

    class Picture(val bitmap: Bitmap, val description: String, val click: (() -> Unit)? = null) :
        FeatureNode

    class Symbol(val type: String) : FeatureNode

    class Space(val height: Int) : FeatureNode
}

internal object FeatureModels {
    fun read(view: View, a: CampusActivity): List<FeatureNode> {
        if (view.visibility != View.VISIBLE) return emptyList()
        val click =
            if (view.hasOnClickListeners())
                ({
                    view.performClick()
                    Unit
                })
            else null
        return when (view) {
            is EditText -> listOf(FeatureNode.Input(view))
            is CompoundButton -> listOf(FeatureNode.Toggle(view.text.toString(), view))
            is Spinner -> listOf(FeatureNode.Select(view))
            is SeekBar -> listOf(FeatureNode.Range(view))
            is TextView ->
                if (view.text.isNullOrBlank()) emptyList()
                else
                    listOf(
                        if (click != null)
                            FeatureNode.Action(view.text.toString(), view.isEnabled, click)
                        else
                            FeatureNode.Copy(
                                view.text.toString(),
                                view.textSize / a.resources.displayMetrics.scaledDensity,
                                view.typeface?.isBold == true,
                                view,
                            )
                    )
            is CampusUi.Icon -> listOf(FeatureNode.Symbol(view.type))
            is ImageView -> {
                val drawable = view.drawable
                val bitmap = (drawable as? BitmapDrawable)?.bitmap
                if (bitmap == null) emptyList()
                else
                    listOf(
                        FeatureNode.Picture(
                            bitmap,
                            view.contentDescription?.toString() ?: "记录照片",
                            click,
                        )
                    )
            }
            is ViewGroup -> {
                val children = (0 until view.childCount).flatMap { read(view.getChildAt(it), a) }
                if (children.isEmpty()) emptyList()
                else if (view === a.content) children
                else if (
                    view is ScrollView ||
                        view is HorizontalScrollView ||
                        view is FrameLayout && children.size == 1
                )
                    children
                else
                    listOf(
                        FeatureNode.Group(
                            view is LinearLayout && view.orientation == LinearLayout.HORIZONTAL,
                            view.background != null && view !is FrameLayout,
                            children,
                            click,
                        )
                    )
            }
            else -> {
                if (view.javaClass == View::class.java) {
                    val h = (view.layoutParams?.height ?: 0) / a.resources.displayMetrics.density
                    if (h >= 4) listOf(FeatureNode.Space(((h / 8).toInt() * 8).coerceIn(8, 40)))
                    else emptyList()
                } else {
                    // Saved native graphs and document previews are raster assets, painted into
                    // Compose Image.
                    val width =
                        (a.resources.displayMetrics.widthPixels - a.ui.dp(48f)).coerceAtLeast(240)
                    val height =
                        (view.layoutParams?.height ?: a.ui.dp(160f))
                            .takeIf { it > 0 }
                            ?.coerceAtMost(a.ui.dp(720f)) ?: a.ui.dp(160f)
                    view.measure(
                        View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
                    )
                    view.layout(0, 0, width, height)
                    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
                    view.draw(AndroidCanvas(bitmap))
                    listOf(
                        FeatureNode.Picture(
                            bitmap,
                            view.contentDescription?.toString() ?: "学习数据图表",
                            click,
                        )
                    )
                }
            }
        }
    }
}
