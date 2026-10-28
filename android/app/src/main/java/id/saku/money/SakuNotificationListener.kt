package id.saku.money

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

// Never log notification content here, in any build type.
class SakuNotificationListener : NotificationListenerService() {
    companion object {
        // Asks the system to bind the listener again after it was dropped. Never switch the component off and on
        // to force this: on MIUI that removes Saku from the allowed listeners, so access has to be granted again.
        // What keeps the listener alive on Xiaomi is Autostart (see NotificationCapturePlugin.openAutostart).
        fun rebind(context: Context) = runCatching { requestRebind(ComponentName(context, SakuNotificationListener::class.java)) }
    }

    override fun onListenerDisconnected() {
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
