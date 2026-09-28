package id.saku.money

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import java.text.NumberFormat
import java.util.Locale

object SakuWidgets {
    const val ACTION_ADD_FAVORITE = "id.saku.money.widget.ADD_FAVORITE"
    const val ACTION_UNDO = "id.saku.money.widget.UNDO"
    const val EXTRA_MODE = "mode"
    private val favoriteButtons = intArrayOf(R.id.favorite_1, R.id.favorite_2, R.id.favorite_3, R.id.favorite_4)

    fun refreshAll(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        manager.getAppWidgetIds(ComponentName(context, FavoritesWidgetProvider::class.java)).forEach { renderFavorites(context, manager, it) }
        manager.getAppWidgetIds(ComponentName(context, QuickEntryWidgetProvider::class.java)).forEach { renderQuickEntry(context, manager, it) }
        manager.getAppWidgetIds(ComponentName(context, SnapshotWidgetProvider::class.java)).forEach { renderSnapshot(context, manager, it) }
    }

    fun renderFavorites(context: Context, manager: AppWidgetManager, widgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_favorites)
        val prefs = WidgetLedger.widgetPreferences(context)
        val available = WidgetLedger.load(context) != null
        val all = WidgetLedger.favorites(context)
        val selected = prefs.getStringSet("favorites:$widgetId", null)
        val rows = if (selected.isNullOrEmpty()) all.take(4) else all.filter { selected.contains(it.id) }.take(4)
        val private = prefs.getBoolean("privacy:$widgetId", false)
        views.setOnClickPendingIntent(R.id.widget_title, openApp(context, widgetId))
        favoriteButtons.forEachIndexed { index, viewId ->
            val row = rows.getOrNull(index)
            views.setViewVisibility(viewId, if (row == null) View.GONE else View.VISIBLE)
            if (row != null) {
                val amount = if (private) "••••" else compact(row.amount)
                views.setTextViewText(viewId, "${row.name} · $amount")
                val intent = Intent(context, FavoritesWidgetProvider::class.java)
                    .setAction(ACTION_ADD_FAVORITE)
                    .setData(Uri.parse("saku://widget/favorite/$widgetId/${row.id}"))
                    .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
                    .putExtra("favoriteId", row.id)
                views.setOnClickPendingIntent(viewId, PendingIntent.getBroadcast(context, widgetId * 10 + index, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            }
        }
        views.setViewVisibility(R.id.widget_empty, if (rows.isEmpty()) View.VISIBLE else View.GONE)
        views.setTextViewText(R.id.widget_empty, if (available) "Save favorites in Saku to add them here" else "Open Saku to sign in")
        views.setOnClickPendingIntent(R.id.widget_empty, openApp(context, widgetId + 9000))
        val lastId = prefs.getString("lastId:$widgetId", null)
        views.setViewVisibility(R.id.widget_status_row, if (lastId == null) View.GONE else View.VISIBLE)
        if (lastId != null) {
            views.setTextViewText(R.id.widget_status, "Added ${prefs.getString("lastName:$widgetId", "transaction")}")
            val undo = Intent(context, FavoritesWidgetProvider::class.java)
                .setAction(ACTION_UNDO).setData(Uri.parse("saku://widget/undo/$widgetId/$lastId"))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId).putExtra("transactionId", lastId)
            views.setOnClickPendingIntent(R.id.widget_undo, PendingIntent.getBroadcast(context, widgetId + 5000, undo, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
        manager.updateAppWidget(widgetId, views)
    }

    fun renderQuickEntry(context: Context, manager: AppWidgetManager, widgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_quick_entry)
        val available = WidgetLedger.load(context) != null
        views.setViewVisibility(R.id.quick_actions, if (available) View.VISIBLE else View.GONE)
        views.setViewVisibility(R.id.quick_sign_in, if (available) View.GONE else View.VISIBLE)
        views.setOnClickPendingIntent(R.id.quick_sign_in, openApp(context, widgetId + 8000))
        if (available) {
            listOf(R.id.quick_expense to "expense", R.id.quick_income to "income", R.id.quick_transfer to "transfer").forEachIndexed { index, (viewId, mode) ->
                val intent = Intent(context, QuickEntryActivity::class.java).putExtra(EXTRA_MODE, mode)
                    .setData(Uri.parse("saku://widget/quick/$widgetId/$mode"))
                views.setOnClickPendingIntent(viewId, PendingIntent.getActivity(context, widgetId * 10 + index, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            }
        }
        manager.updateAppWidget(widgetId, views)
    }

    fun renderSnapshot(context: Context, manager: AppWidgetManager, widgetId: Int) {
        val views = RemoteViews(context.packageName, R.layout.widget_snapshot)
        val snapshot = WidgetLedger.snapshot(context)
        val private = WidgetLedger.widgetPreferences(context).getBoolean("privacy:$widgetId", false)
        views.setViewVisibility(R.id.snapshot_values, if (snapshot == null) View.GONE else View.VISIBLE)
        views.setViewVisibility(R.id.snapshot_sign_in, if (snapshot == null) View.VISIBLE else View.GONE)
        views.setOnClickPendingIntent(R.id.snapshot_root, openApp(context, widgetId))
        if (snapshot != null) {
            views.setTextViewText(R.id.snapshot_cash, amount(snapshot.totalCash, private))
            views.setTextViewText(R.id.snapshot_today, amount(snapshot.spentToday, private))
            views.setTextViewText(R.id.snapshot_week, amount(snapshot.spentWeek, private))
            views.setTextViewText(R.id.snapshot_pockets, amount(snapshot.pocketRemaining, private))
        }
        manager.updateAppWidget(widgetId, views)
    }

    fun clearWidget(context: Context, ids: IntArray) {
        val editor = WidgetLedger.widgetPreferences(context).edit()
        ids.forEach { id -> listOf("favorites", "privacy", "lastId", "lastName").forEach { editor.remove("$it:$id") } }
        editor.apply()
    }

    private fun openApp(context: Context, requestCode: Int): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    private fun amount(value: Long, private: Boolean) = if (private) "••••" else "Rp ${NumberFormat.getIntegerInstance(Locale.forLanguageTag("id-ID")).format(value)}"
    private fun compact(value: Long): String = when {
        value >= 1_000_000 -> "Rp ${String.format(Locale.US, "%.1f", value / 1_000_000.0).removeSuffix(".0")}m"
        value >= 1_000 -> "Rp ${value / 1_000}k"
        else -> "Rp $value"
    }
}

class FavoritesWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = ids.forEach { SakuWidgets.renderFavorites(context, manager, it) }
    override fun onDeleted(context: Context, ids: IntArray) = SakuWidgets.clearWidget(context, ids)
    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) return
        val prefs = WidgetLedger.widgetPreferences(context)
        when (intent.action) {
            SakuWidgets.ACTION_ADD_FAVORITE -> {
                val favoriteId = intent.getStringExtra("favoriteId") ?: return
                val name = WidgetLedger.favorites(context).find { it.id == favoriteId }?.name ?: "transaction"
                WidgetLedger.addFavorite(context, favoriteId).onSuccess {
                    prefs.edit().putString("lastId:$widgetId", it).putString("lastName:$widgetId", name).apply()
                    Toast.makeText(context, "$name added", Toast.LENGTH_SHORT).show()
                }.onFailure { Toast.makeText(context, it.message ?: "Could not add transaction", Toast.LENGTH_LONG).show() }
            }
            SakuWidgets.ACTION_UNDO -> {
                val id = intent.getStringExtra("transactionId") ?: return
                if (prefs.getString("lastId:$widgetId", null) == id && WidgetLedger.undo(context, id)) Toast.makeText(context, "Transaction removed", Toast.LENGTH_SHORT).show()
                prefs.edit().remove("lastId:$widgetId").remove("lastName:$widgetId").apply()
            }
        }
        SakuWidgets.refreshAll(context)
    }
}

class QuickEntryWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = ids.forEach { SakuWidgets.renderQuickEntry(context, manager, it) }
    override fun onDeleted(context: Context, ids: IntArray) = SakuWidgets.clearWidget(context, ids)
}

class SnapshotWidgetProvider : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = ids.forEach { SakuWidgets.renderSnapshot(context, manager, it) }
    override fun onDeleted(context: Context, ids: IntArray) = SakuWidgets.clearWidget(context, ids)
}
