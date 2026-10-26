package id.saku.money

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate

class WidgetConfigActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        AppCompatDelegate.setDefaultNightMode(SakuAppearance.nightMode(this))
        super.onCreate(savedInstanceState)
        SakuAppearance.applyChrome(this)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        setResult(Activity.RESULT_CANCELED)
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }
        val density = resources.displayMetrics.density
        val dark = SakuAppearance.isDark(this)
        val ink = if (dark) 0xffedf3ed.toInt() else 0xff203b33.toInt()
        val muted = if (dark) 0xffaec3b5.toInt() else 0xff60746a.toInt()
        val pad = (20 * density).toInt()
        val prefs = WidgetLedger.widgetPreferences(this)
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad, pad, pad); setBackgroundColor(if (dark) 0xff192c24.toInt() else 0xfff7f6f0.toInt()) }
        root.addView(TextView(this).apply { text = getString(R.string.widget_config_title); textSize = 24f; setTextColor(ink) })
        val privacy = CheckBox(this).apply { text = getString(R.string.widget_hide_amounts); setTextColor(ink); isChecked = prefs.getBoolean("privacy:$widgetId", AppLockSettings.enabled(this@WidgetConfigActivity)) }
        root.addView(privacy)
        val isFavorites = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId)?.provider?.className == FavoritesWidgetProvider::class.java.name
        val favoriteChecks = mutableListOf<Pair<String, CheckBox>>()
        if (isFavorites) {
            root.addView(TextView(this).apply { text = getString(R.string.widget_choose_favorites); setTextColor(muted); setPadding(0, pad / 2, 0, 0) })
            val configured = prefs.getStringSet("favorites:$widgetId", null)
            WidgetLedger.favorites(this).forEachIndexed { index, favorite ->
                val check = CheckBox(this).apply { text = "${favorite.name} · Rp ${favorite.amount}"; setTextColor(ink); isChecked = configured?.contains(favorite.id) ?: (index < 4) }
                check.setOnCheckedChangeListener { button, checked -> if (checked && favoriteChecks.count { it.second.isChecked } > 4) button.isChecked = false }
                favoriteChecks += favorite.id to check; root.addView(check)
            }
        }
        root.addView(Button(this).apply {
            text = getString(R.string.widget_save)
            isAllCaps = false
            minHeight = (48 * density).toInt()
            setTextColor(if (dark) 0xff10231a.toInt() else 0xffffffff.toInt())
            setBackgroundResource(if (dark) R.drawable.widget_dark_action_background else R.drawable.widget_action_background)
            setOnClickListener {
                prefs.edit().putBoolean("privacy:$widgetId", privacy.isChecked)
                    .putStringSet("favorites:$widgetId", favoriteChecks.filter { it.second.isChecked }.map { it.first }.toSet()).apply()
                SakuWidgets.refreshAll(this@WidgetConfigActivity)
                setResult(Activity.RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId))
                finish()
            }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(root)
    }
}
