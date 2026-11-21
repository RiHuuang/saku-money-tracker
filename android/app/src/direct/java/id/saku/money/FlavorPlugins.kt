package id.saku.money

import com.getcapacitor.BridgeActivity

// The website APK updates itself, so only this flavor ships the updater.
object FlavorPlugins {
    @JvmStatic
    fun register(activity: BridgeActivity) {
        activity.registerPlugin(AppUpdatePlugin::class.java)
    }
}
