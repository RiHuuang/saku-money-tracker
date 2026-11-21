package id.saku.money

import android.app.Notification
import android.content.Context

data class KnownApp(val packageName: String, val name: String, val suggestedAccount: String)
// key is the system's StatusBarNotification key; it never leaves the phone and is only hashed into the row ID.
data class CapturedNotification(val packageName: String, val account: String, val title: String, val text: String, val postedAt: Long, val key: String = "$packageName|$postedAt")

object NotificationCapture {
    // Owner-chosen first apps. Package names need confirming against installs on a real phone.
    val KNOWN_APPS = listOf(
        KnownApp("com.bca", "BCA mobile", "BCA"),
        KnownApp("com.bca.mybca.omni.android", "myBCA", "BCA"),
        KnownApp("com.jago.digitalBanking", "Jago", "Jago"),
        KnownApp("com.gojek.gopay", "GoPay", "GoPay"),
        KnownApp("com.gojek.app", "Gojek", "GoPay"),
        KnownApp("id.co.bankbkemobile.digitalbank", "SeaBank", "SeaBank"),
        KnownApp("id.dana", "DANA", "DANA"),
    )
    // Debug builds only: "adb shell cmd notification post" comes from the shell package, so it acts as a test bank
    // that drives the real pipeline. Release builds never list it.
    const val DEBUG_SHELL = "com.android.shell"
    fun appsFor(debug: Boolean) = if (debug) KNOWN_APPS + KnownApp(DEBUG_SHELL, "ADB test bank", "BCA") else KNOWN_APPS
    val apps get() = appsFor(BuildConfig.DEBUG)
    private val knownPackages get() = apps.map { it.packageName }.toSet()

    // Group summaries and ongoing notifications (music, downloads, navigation) are never payments.
    fun skippable(flags: Int) = flags and (Notification.FLAG_GROUP_SUMMARY or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE) != 0

    // Android 15+ replaces OTP-like text with a placeholder for listeners. It is counted, never parsed.
    private val redactedPlaceholder = Regex("""(?i)^\s*(?:sensitive notification content hidden|konten notifikasi sensitif disembunyikan)\s*$""")
    fun isRedactedPlaceholder(text: String) = redactedPlaceholder.matches(text)
    private const val PREFS = "saku_notification_capture"
    private const val APP_PREFIX = "app:"

    data class Allowlist(val accounts: Map<String, String>, val paused: Boolean) {
        fun admits(packageName: String) = !paused && packageName in knownPackages && !accounts[packageName].isNullOrBlank()
    }

    // The only gate between the listener and notification content: read() runs only for an admitted package.
    fun <T> readIfAdmitted(packageName: String, allowlist: Allowlist, read: (account: String) -> T): T? =
        if (allowlist.admits(packageName)) read(allowlist.accounts.getValue(packageName)) else null

    fun load(context: Context): Allowlist {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val accounts = prefs.all.mapNotNull { (key, value) -> if (key.startsWith(APP_PREFIX) && value is String) key.removePrefix(APP_PREFIX) to value else null }.toMap()
        return Allowlist(accounts, prefs.getBoolean("paused", false))
    }

    fun setApp(context: Context, packageName: String, account: String?) {
        require(packageName in knownPackages) { "Unknown app" }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        if (account.isNullOrBlank()) prefs.remove(APP_PREFIX + packageName) else prefs.putString(APP_PREFIX + packageName, account.trim().take(50))
        check(prefs.commit())
    }

    fun setPaused(context: Context, paused: Boolean) = check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("paused", paused).commit())

    fun clear(context: Context) = check(context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit())
}
