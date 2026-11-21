package id.saku.money

import android.content.res.Configuration
import androidx.appcompat.app.AppCompatDelegate
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "HomeWidget")
class HomeWidgetPlugin : Plugin() {
    @PluginMethod
    fun getSystemTheme(call: PluginCall) {
        call.resolve(JSObject().put("systemDark", SakuAppearance.systemDark(context)))
    }

    override fun handleOnConfigurationChanged(newConfig: Configuration) {
        super.handleOnConfigurationChanged(newConfig)
        notifyListeners("systemThemeChanged", JSObject().put("systemDark", SakuAppearance.systemDark(context)))
    }

    @PluginMethod
    fun refresh(call: PluginCall) {
        SakuWidgets.refreshAll(context)
        call.resolve()
    }

    @PluginMethod
    fun getRevision(call: PluginCall) {
        call.resolve(JSObject().put("revision", WidgetLedger.revision(context)))
    }

    @PluginMethod
    fun scheduleSync(call: PluginCall) {
        WidgetCloudSync.schedule(context)
        call.resolve()
    }

    @PluginMethod
    fun applyAppearance(call: PluginCall) {
        bridge.activity.runOnUiThread {
            AppCompatDelegate.setDefaultNightMode(SakuAppearance.nightMode(context))
            SakuAppearance.applyChrome(bridge.activity)
            SakuWidgets.refreshAll(context)
            call.resolve()
        }
    }
}
