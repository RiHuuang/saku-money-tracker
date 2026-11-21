package id.saku.money

import android.app.ActivityManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
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
    private val brand = when (Build.MANUFACTURER.lowercase()) {
        "xiaomi", "redmi", "poco" -> "xiaomi"
        "samsung" -> "samsung"
        "oppo", "realme", "oneplus" -> "oppo"
        "vivo", "iqoo" -> "vivo"
        "infinix", "tecno", "itel" -> "transsion"
        else -> "other"
    }
    private val granted get() = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    private val activityManager get() = context.getSystemService(ActivityManager::class.java)
    private val batteryExempt get() = runCatching { context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName) }.getOrDefault(false)
    private val standbyBucket get() = runCatching { context.getSystemService(UsageStatsManager::class.java).appStandbyBucket }.getOrDefault(UsageStatsManager.STANDBY_BUCKET_ACTIVE)
    private val backgroundRestricted get() = runCatching { activityManager.isBackgroundRestricted }.getOrDefault(false)
    private fun appInfo() = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null))

    @PluginMethod
    fun status(call: PluginCall) {
        val allowlist = NotificationCapture.load(context)
        val isGranted = granted
        if (isGranted) CaptureHealth.granted(context)
        val health = CaptureHealth.snapshot(context)
        val kill = CaptureHealth.lastSystemKill(context)
        val apps = JSArray()
        for (app in NotificationCapture.apps) apps.put(JSObject().apply {
            put("packageName", app.packageName)
            put("name", app.name)
            put("suggestedAccount", app.suggestedAccount)
            put("installed", installed(app.packageName))
            put("account", allowlist.accounts[app.packageName] ?: "")
        })
        call.resolve(JSObject().apply {
            // Read live each time, so revoking access in system settings shows up on the next check.
            put("granted", isGranted)
            put("paused", allowlist.paused)
            put("needsAutostart", brand == "xiaomi")
            put("apps", apps)
            put("brand", brand)
            put("lowRam", activityManager.isLowRamDevice)
            put("directBuild", BuildConfig.FLAVOR == "direct")
            put("sdk", Build.VERSION.SDK_INT)
            put("everGranted", health.everGranted)
            put("connectedAt", health.connectedAt)
            put("disconnectedAt", health.disconnectedAt)
            put("lastCapturedAt", health.lastAdmittedAt)
            put("redactedCount", health.redactedCount)
            put("expiredCount", health.expiredCount)
            put("inboxResetAt", health.inboxResetAt)
            put("systemKillAt", kill?.first ?: 0)
            put("systemKillReason", kill?.second ?: "")
            put("batteryExempt", batteryExempt)
            put("backgroundRestricted", backgroundRestricted)
            put("standbyRestricted", standbyBucket >= UsageStatsManager.STANDBY_BUCKET_RESTRICTED)
            put("autoRevokeExempt", runCatching { context.packageManager.isAutoRevokeWhitelisted }.getOrDefault(true))
        })
    }

    // Opens Saku's own toggle. The website APK on Android 13+ is first sent to App info once, where Android's
    // "Allow restricted settings" lives; otherwise the toggle would be greyed out.
    @PluginMethod
    fun openSettings(call: PluginCall) {
        if (!granted && BuildConfig.FLAVOR == "direct" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !CaptureHealth.snapshot(context).everGranted && CaptureHealth.snapshot(context).appInfoShownAt == 0L) {
            CaptureHealth.appInfoShown(context)
            runCatching { activity.startActivity(appInfo().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onSuccess { call.resolve(JSObject().put("opened", "app_info")) }.onFailure { call.reject("Could not open settings") }
            return
        }
        val component = ComponentName(context, SakuNotificationListener::class.java).flattenToString()
        val detail = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME, component)
        runCatching { activity.startActivity(detail.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .recoverCatching { activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onSuccess { call.resolve(JSObject().put("opened", "listener")) }.onFailure { call.reject("Could not open settings") }
    }

    // Xiaomi's memory cleaner kills Saku, and without Autostart MIUI then refuses to restart the listener,
    // so capture stops until the app is opened again. Opens the Autostart list, or Saku's app info if it has moved.
    @PluginMethod
    fun openAutostart(call: PluginCall) {
        runCatching { activity.startActivity(brandScreen("xiaomi")!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .recoverCatching { activity.startActivity(appInfo().addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onSuccess { call.resolve() }.onFailure { call.reject("Could not open settings") }
    }

    // At most one brand screen per OEM. Their names change between OS versions, so each is tried, never trusted.
    private fun brandScreen(family: String): Intent? = when (family) {
        "xiaomi" -> Intent().setComponent(ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"))
        "samsung" -> Intent().setComponent(ComponentName("com.samsung.android.lool", "com.samsung.android.sm.battery.ui.BatteryActivity"))
        "oppo" -> Intent().setComponent(ComponentName("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"))
        "vivo" -> Intent().setComponent(ComponentName("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"))
        "transsion" -> Intent().setComponent(ComponentName("com.transsion.phonemaster", "com.cyin.himgr.autostart.AutoStartActivity"))
        else -> null
    }

    // The one Fix tap: reconnect the reader, then open the screen most likely to keep it running.
    @PluginMethod
    fun fix(call: PluginCall) {
        SakuNotificationListener.rebind(context)
        val restricted = backgroundRestricted || standbyBucket >= UsageStatsManager.STANDBY_BUCKET_RESTRICTED
        val screens = buildList {
            if (restricted) add("app_info" to appInfo())
            if (!batteryExempt) add("battery" to Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            brandScreen(brand)?.let { add("brand" to it) }
            add("app_info" to appInfo())
        }
        for ((name, intent) in screens) {
            if (runCatching { activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess) {
                call.resolve(JSObject().put("opened", name)); return
            }
        }
        call.reject("Could not open settings")
    }

    @PluginMethod
    fun acknowledgeReset(call: PluginCall) {
        CaptureHealth.acknowledgeReset(context)
        call.resolve()
    }

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

    // Inbox calls run off the UI thread: they decrypt and write the encrypted inbox.
    private fun background(call: PluginCall, work: () -> Unit) = NotificationInbox.post {
        runCatching(work).onFailure { call.reject(if (it is InboxUnavailable) "Inbox unavailable" else it.message ?: "Inbox error") }
    }

    @PluginMethod
    fun inbox(call: PluginCall) = background(call) {
        // Read on every app start for the badge, so this is where a dropped listener gets reconnected.
        if (granted) SakuNotificationListener.rebind(context)
        val rows = NotificationInbox.store(context).items()
        // Old rows were just purged, so the "N rows" reminder is corrected here too.
        NotificationInbox.summarize(context, rows.size)
        val items = JSArray()
        for (item in rows) items.put(JSObject().apply {
            put("id", item.id); put("packageName", item.packageName); put("account", item.account); put("amount", item.amount)
            put("direction", item.direction); put("rawMerchant", item.rawMerchant); put("balance", item.balance); put("occurredAt", item.occurredAt)
            if (item.cancels) put("cancels", true)
        })
        call.resolve(JSObject().apply { put("items", items) })
    }

    @PluginMethod
    fun removeInbox(call: PluginCall) = background(call) {
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
        val restored = mutableListOf<InboxItem>()
        for (index in 0 until items.length()) {
            val item = items.optJSONObject(index)
            if (item == null || item.optString("id").isBlank() || item.optString("id").length > 150 ||
                item.optString("packageName").isBlank() || item.optString("account").length > 50 ||
                item.optLong("amount") !in 1L..1_000_000_000_000L ||
                item.optString("direction") !in listOf("expense", "income")) {
                call.reject("Invalid inbox item"); return
            }
            val balance = if (item.isNull("balance")) null else item.optLong("balance")
            restored += InboxItem(item.getString("id"), item.getString("packageName"), item.optString("account"),
                item.getLong("amount"), item.getString("direction"), InboxRedaction.redact(item.optString("rawMerchant"), item.getLong("amount")),
                balance, item.optLong("occurredAt"), item.optBoolean("cancels", false))
        }
        background(call) {
            val store = NotificationInbox.store(context)
            store.restore(restored)
            NotificationInbox.summarize(context, store.items().size)
            call.resolve()
        }
    }

    @PluginMethod
    fun clearInbox(call: PluginCall) = background(call) {
        NotificationInbox.clear(context)
        call.resolve()
    }

    private fun installed(packageName: String) = try {
        context.packageManager.getPackageInfo(packageName, 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }
}
