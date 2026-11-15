package id.saku.money

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "NotificationCapture")
class NotificationCapturePlugin : Plugin() {
    @PluginMethod
    fun status(call: PluginCall) {
        val allowlist = NotificationCapture.load(context)
        val granted = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
        val apps = JSArray()
        for (app in NotificationCapture.KNOWN_APPS) apps.put(JSObject().apply {
            put("packageName", app.packageName)
            put("name", app.name)
            put("suggestedAccount", app.suggestedAccount)
            put("installed", installed(app.packageName))
            put("account", allowlist.accounts[app.packageName] ?: "")
        })
        call.resolve(JSObject().apply {
            // Read live each time, so revoking access in system settings shows up on the next check.
            put("granted", granted)
            put("paused", allowlist.paused)
            put("needsAutostart", xiaomi)
            put("apps", apps)
        })
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        call.resolve()
    }

    // Xiaomi's memory cleaner kills Saku, and without Autostart MIUI then refuses to restart the listener,
    // so capture stops until the app is opened again. Opens the Autostart list, or Saku's app info if it has moved.
    @PluginMethod
    fun openAutostart(call: PluginCall) {
        val autostart = Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
        val appInfo = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))
        runCatching { activity.startActivity(autostart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .recoverCatching { activity.startActivity(appInfo.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onSuccess { call.resolve() }.onFailure { call.reject("Could not open settings") }
    }

    private val xiaomi = Build.MANUFACTURER.lowercase() in setOf("xiaomi", "redmi", "poco")

    @PluginMethod
    fun setApp(call: PluginCall) {
        val packageName = call.getString("packageName") ?: return call.reject("Choose an app")
        runCatching { NotificationCapture.setApp(context, packageName, call.getString("account")) }
            .onSuccess { call.resolve() }.onFailure { call.reject(it.message ?: "Could not save this app") }
    }

    @PluginMethod
    fun setPaused(call: PluginCall) {
        NotificationCapture.setPaused(context, call.getBoolean("paused") ?: false)
        call.resolve()
    }

    @PluginMethod
    fun inbox(call: PluginCall) {
        // Read on every app start for the badge, so this is where a dropped listener gets reconnected.
        if (NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)) SakuNotificationListener.rebind(context)
        val items = JSArray()
        for (item in NotificationInbox.store(context).items()) items.put(JSObject().apply {
            put("id", item.id); put("packageName", item.packageName); put("account", item.account); put("amount", item.amount)
            put("direction", item.direction); put("rawMerchant", item.rawMerchant); put("balance", item.balance); put("occurredAt", item.occurredAt)
        })
        call.resolve(JSObject().apply { put("items", items) })
    }

    @PluginMethod
    fun removeInbox(call: PluginCall) {
        val ids = call.getArray("ids")?.toList<String>()?.toSet() ?: emptySet()
        val store = NotificationInbox.store(context)
        store.remove(ids)
        NotificationInbox.summarize(context, store.items().size)
        call.resolve()
    }

    @PluginMethod
    fun restoreInbox(call: PluginCall) {
        val items = call.getArray("items")
        if (items == null || items.length() > 500) { call.reject("Invalid inbox items"); return }
        val store = NotificationInbox.store(context)
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index)
            if (item == null || item.optString("id").isBlank() || item.optString("id").length > 150 ||
                item.optString("packageName").isBlank() || item.optString("account").length > 50 ||
                item.optLong("amount") !in 1L..1_000_000_000_000L ||
                item.optString("direction") !in listOf("expense", "income")) {
                call.reject("Invalid inbox item"); return
            }
            val balance = if (item.isNull("balance")) null else item.optLong("balance")
            store.add(InboxItem(item.getString("id"), item.getString("packageName"), item.optString("account"),
                item.getLong("amount"), item.getString("direction"), InboxRedaction.redact(item.optString("rawMerchant"), item.getLong("amount")),
                balance, item.optLong("occurredAt")))
        }
        NotificationInbox.summarize(context, store.items().size)
        call.resolve()
    }

    @PluginMethod
    fun clearInbox(call: PluginCall) {
        NotificationInbox.clear(context)
        call.resolve()
    }

    private fun installed(packageName: String) = try {
        context.packageManager.getPackageInfo(packageName, 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }
}
