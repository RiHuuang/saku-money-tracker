package id.saku.money

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

// Never log notification content here, in any build type.
class SakuNotificationListener : NotificationListenerService() {
    companion object {
        // Android (and MIUI after an app update or memory cleanup) can unbind the listener while access stays granted;
        // capture then stops silently until something asks for a rebind.
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
