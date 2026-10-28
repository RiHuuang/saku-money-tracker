package id.saku.money

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

// Never log notification content here, in any build type.
class SakuNotificationListener : NotificationListenerService() {
    companion object {
        @Volatile private var connected = false

        // Android (and MIUI after an app update or memory cleanup) can unbind the listener while access stays granted;
        // capture then stops silently. requestRebind alone is ignored for a listener the system still counts as on,
        // so an unbound listener's own component is switched off and on, which makes the system bind it again.
        fun rebind(context: Context) {
            if (connected) return
            val component = ComponentName(context, SakuNotificationListener::class.java)
            runCatching {
                val packages = context.packageManager
                packages.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
                packages.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_DEFAULT, PackageManager.DONT_KILL_APP)
            }
            runCatching { requestRebind(component) }
        }
    }

    override fun onListenerConnected() {
        connected = true
    }

    override fun onListenerDisconnected() {
        connected = false
        rebind(this)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val captured = NotificationCapture.readIfAdmitted(sbn.packageName, NotificationCapture.load(this)) { account ->
            val extras = sbn.notification.extras
            val text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT)
            CapturedNotification(sbn.packageName, account, extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty(), text?.toString().orEmpty(), sbn.postTime)
        } ?: return
        // Only parsed, redacted fields are kept; the full text is dropped here.
        runCatching { NotificationInbox.receive(this, captured) }
    }
}
