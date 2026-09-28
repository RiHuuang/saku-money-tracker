package id.saku.money

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "HomeWidget")
class HomeWidgetPlugin : Plugin() {
    @PluginMethod
    fun refresh(call: PluginCall) {
        SakuWidgets.refreshAll(context)
        call.resolve()
    }

    @PluginMethod
    fun getRevision(call: PluginCall) {
        call.resolve(JSObject().put("revision", WidgetLedger.revision(context)))
    }
}
