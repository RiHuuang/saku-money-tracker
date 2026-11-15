package id.saku.money

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import androidx.appcompat.app.AppCompatDelegate

object SakuAppearance {
    private const val KEY = "saku-appearance-v1"
    fun preference(context: Context): String = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString(KEY, "system") ?: "system"
    fun isDark(context: Context): Boolean {
        return when (preference(context)) {
            "dark" -> true
            "light" -> false
            else -> context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        }
    }
    fun systemDark(context: Context): Boolean = context.applicationContext.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    fun nightMode(context: Context): Int = when (preference(context)) {
        "dark" -> AppCompatDelegate.MODE_NIGHT_YES
        "light" -> AppCompatDelegate.MODE_NIGHT_NO
        else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
    }
    fun applyChrome(activity: Activity) {
        if (android.os.Build.VERSION.SDK_INT >= 29) activity.window.isNavigationBarContrastEnforced = false
    }
}
