package id.saku.money

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.view.View

object SakuAppearance {
    private const val KEY = "saku-appearance-v1"
    fun isDark(context: Context): Boolean {
        val preference = context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString(KEY, "system")
        return when (preference) {
            "dark" -> true
            "light" -> false
            else -> context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        }
    }
    fun applyChrome(activity: Activity) {
        val dark = isDark(activity)
        val background = if (dark) 0xff101d18.toInt() else 0xfff7f6f0.toInt()
        activity.window.statusBarColor = background
        activity.window.navigationBarColor = background
        if (Build.VERSION.SDK_INT >= 29) activity.window.isNavigationBarContrastEnforced = false
        @Suppress("DEPRECATION")
        activity.window.decorView.systemUiVisibility = if (dark) 0 else View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
    }
}
