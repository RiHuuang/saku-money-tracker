package id.saku.money

import android.content.Context

data class KnownApp(val packageName: String, val name: String, val suggestedAccount: String)
data class CapturedNotification(val packageName: String, val account: String, val title: String, val text: String, val postedAt: Long)

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
    private val knownPackages = KNOWN_APPS.map { it.packageName }.toSet()
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
