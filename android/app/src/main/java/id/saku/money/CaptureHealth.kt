package id.saku.money

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context

// Timestamps and counts only, kept on the phone and never uploaded: enough to tell whether the reader is running
// and why it stopped. Nothing here records notification content or apps the user didn't choose.
object CaptureHealth {
    private const val PREFS = "saku_capture_health"

    data class Snapshot(
        val connectedAt: Long, val disconnectedAt: Long, val lastAdmittedAt: Long,
        val redactedCount: Int, val expiredCount: Int, val inboxResetAt: Long, val everGranted: Boolean, val appInfoShownAt: Long,
    )

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun stamp(context: Context, key: String, value: Long = System.currentTimeMillis()) { prefs(context).edit().putLong(key, value).apply() }
    private fun bump(context: Context, key: String, by: Int = 1) = synchronized(this) { prefs(context).let { it.edit().putInt(key, it.getInt(key, 0) + by).apply() } }

    fun connected(context: Context) = stamp(context, "connectedAt")
    fun disconnected(context: Context) = stamp(context, "disconnectedAt")
    fun admitted(context: Context) = stamp(context, "lastAdmittedAt")
    fun redacted(context: Context) = bump(context, "redactedCount")
    fun expired(context: Context, count: Int) = bump(context, "expiredCount", count)
    fun inboxReset(context: Context, at: Long) = stamp(context, "inboxResetAt", at)
    fun acknowledgeReset(context: Context) { prefs(context).edit().remove("inboxResetAt").apply() }
    fun granted(context: Context) { if (!prefs(context).getBoolean("everGranted", false)) prefs(context).edit().putBoolean("everGranted", true).apply() }
    fun appInfoShown(context: Context) = stamp(context, "appInfoShownAt")

    fun snapshot(context: Context) = prefs(context).let {
        Snapshot(it.getLong("connectedAt", 0), it.getLong("disconnectedAt", 0), it.getLong("lastAdmittedAt", 0),
            it.getInt("redactedCount", 0), it.getInt("expiredCount", 0), it.getLong("inboxResetAt", 0), it.getBoolean("everGranted", false), it.getLong("appInfoShownAt", 0))
    }

    // Exits the phone caused, as opposed to the user, an app update, or Saku itself. HyperOS's cleaner reports
    // REASON_OTHER with "OneKeyClean"; Android 17's memory limiter reports "MemoryLimiter".
    fun isSystemKill(reason: Int, description: String?): Boolean = when (reason) {
        ApplicationExitInfo.REASON_LOW_MEMORY, ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE, ApplicationExitInfo.REASON_FREEZER -> true
        ApplicationExitInfo.REASON_OTHER, ApplicationExitInfo.REASON_SIGNALED, ApplicationExitInfo.REASON_UNKNOWN ->
            description != null && Regex("""(?i)OneKeyClean|MemoryLimiter|lmk|kill.*(?:clean|memory|background)""").containsMatchIn(description)
        else -> false
    }

    fun killLabel(reason: Int, description: String?): String = when {
        description != null && description.contains("OneKeyClean", ignoreCase = true) -> "cleaner"
        description != null && description.contains("MemoryLimiter", ignoreCase = true) -> "memory_limit"
        reason == ApplicationExitInfo.REASON_LOW_MEMORY -> "low_memory"
        reason == ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE -> "battery"
        reason == ApplicationExitInfo.REASON_FREEZER -> "frozen"
        else -> "system"
    }

    // Newest phone-caused exit among the last 16 the system keeps, read locally on demand.
    fun lastSystemKill(context: Context): Pair<Long, String>? = runCatching {
        context.getSystemService(ActivityManager::class.java).getHistoricalProcessExitReasons(context.packageName, 0, 16)
            .filter { isSystemKill(it.reason, it.description) }
            .maxByOrNull { it.timestamp }
            ?.let { it.timestamp to killLabel(it.reason, it.description) }
    }.getOrNull()

    // Tells the next exit record that the listener was running, which helps tell a kill from a normal stop.
    fun markRunning(context: Context) {
        runCatching { context.getSystemService(ActivityManager::class.java).setProcessStateSummary("listener".toByteArray()) }
    }
}
