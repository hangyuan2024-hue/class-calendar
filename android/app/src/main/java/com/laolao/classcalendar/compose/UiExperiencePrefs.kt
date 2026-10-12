package com.laolao.classcalendar

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext

/** A layout choice, independent from the account's colors, learning data and cloud sync. */
internal enum class UiExperience(val id: String, val label: String, val summary: String) {
    STUDIO("studio", "设计版", "保留你现在喜欢的 App 设计"),
    WEB("web", "网页同款", "熟悉的手机版布局，原生操作体验");

    companion object {
        fun fromStored(value: String?) = entries.firstOrNull { it.id == value } ?: STUDIO
    }
}

/**
 * Device-only preferences: logging in, restoring records or switching accounts cannot reset them.
 */
internal object UiExperiencePrefs {
    private const val FILE = "laolao_device_experience_v1"
    private const val EXPERIENCE = "experience"
    private const val ONBOARDING_COMPLETE = "onboarding_done_v1"

    private fun preferences(context: Context): SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun read(context: Context): UiExperience =
        UiExperience.fromStored(preferences(context).getString(EXPERIENCE, null))

    fun write(context: Context, experience: UiExperience) {
        check(preferences(context).edit().putString(EXPERIENCE, experience.id).commit()) {
            "界面选择未保存，请检查设备存储空间"
        }
    }

    fun onboardingComplete(context: Context): Boolean =
        preferences(context).getBoolean(ONBOARDING_COMPLETE, false)

    /** Called only for the user's explicit finish or skip action, never for back or lifecycle. */
    fun completeOnboarding(context: Context) {
        check(preferences(context).edit().putBoolean(ONBOARDING_COMPLETE, true).commit()) {
            "使用引导状态未保存，请检查设备存储空间"
        }
    }

    internal fun observe(context: Context) = preferences(context)

    internal fun isExperienceKey(key: String?) = key == EXPERIENCE
}

/** Also reacts to a selector elsewhere in the app; no activity recreation or account mutation. */
@Composable
internal fun rememberUiExperience(context: Context = LocalContext.current): State<UiExperience> {
    val appContext = context.applicationContext
    val prefs = remember(appContext) { UiExperiencePrefs.observe(appContext) }
    val value = remember(prefs) { mutableStateOf(UiExperiencePrefs.read(appContext)) }
    DisposableEffect(prefs) {
        val listener =
            SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
                if (UiExperiencePrefs.isExperienceKey(key))
                    value.value = UiExperiencePrefs.read(appContext)
            }
        prefs.registerOnSharedPreferenceChangeListener(listener)
        // Cover a preference write between the initial composition and listener registration.
        value.value = UiExperiencePrefs.read(appContext)
        onDispose { prefs.unregisterOnSharedPreferenceChangeListener(listener) }
    }
    return value
}
