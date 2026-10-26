package id.saku.money

import android.content.Intent
import android.content.pm.PackageManager
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
            put("granted", NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName))
            put("paused", allowlist.paused)
            put("apps", apps)
        })
    }

    @PluginMethod
    fun openSettings(call: PluginCall) {
        activity.startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
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

    private fun installed(packageName: String) = try {
        context.packageManager.getPackageInfo(packageName, 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }
}
