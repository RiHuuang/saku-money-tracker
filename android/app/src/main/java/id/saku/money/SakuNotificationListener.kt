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

        // The gate: flags (no content), then the package (unchosen apps are never read), and only then the words.
        fun capture(context: Context, sbn: StatusBarNotification): CapturedNotification? {
            if (NotificationCapture.skippable(sbn.notification.flags)) return null
            return NotificationCapture.readIfAdmitted(sbn.packageName, NotificationCapture.load(context)) { account ->
                val extras = sbn.notification.extras
                val text = extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: extras.getCharSequence(Notification.EXTRA_TEXT)
                CapturedNotification(sbn.packageName, account, extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty(), text?.toString().orEmpty(), sbn.postTime, sbn.key)
            }
        }
    }

    override fun onListenerConnected() {
        CaptureHealth.connected(this)
        CaptureHealth.markRunning(this)
        // Alerts that arrived while Saku was stopped may still be in the shade: read them through the same gate.
        // IDs and tombstones keep anything already waiting or handled from coming back.
        val since = CaptureHealth.rescanSince(this)
        val active = runCatching { activeNotifications?.toList() }.getOrNull().orEmpty().filter { it.postTime >= since }
        val captured = active.mapNotNull { capture(this, it) }
        if (captured.isNotEmpty()) NotificationInbox.post { captured.forEach { NotificationInbox.receive(applicationContext, it) } }
    }

    override fun onListenerDisconnected() {
        CaptureHealth.disconnected(this)
        rebind(this)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val captured = capture(this, sbn) ?: return
        // Only parsed, redacted fields are kept; the full text is dropped on the capture thread.
        NotificationInbox.post { NotificationInbox.receive(applicationContext, captured) }
    }
}
