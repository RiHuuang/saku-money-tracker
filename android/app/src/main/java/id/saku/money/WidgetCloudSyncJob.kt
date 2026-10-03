package id.saku.money

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

object WidgetCloudSync {
    const val JOB_ID = 0x53414b55

    fun schedule(context: Context) {
        if (BuildConfig.SAKU_API_URL.isBlank()) return
        val job = JobInfo.Builder(JOB_ID, ComponentName(context, WidgetCloudSyncJob::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setMinimumLatency(1_500)
            .setBackoffCriteria(15_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
            .setPersisted(true)
            .build()
        context.getSystemService(JobScheduler::class.java).schedule(job)
    }

    fun cancel(context: Context) = context.getSystemService(JobScheduler::class.java).cancel(JOB_ID)

    fun sameLedger(left: String, right: JSONObject) = runCatching {
        canonical(JSONObject(left)) == canonical(right)
    }.getOrDefault(false)

    private fun canonical(value: Any?): String = when (value) {
        null, JSONObject.NULL -> "null"
        is JSONObject -> value.keys().asSequence().toList().sorted()
            .joinToString(prefix = "{", postfix = "}") { "${JSONObject.quote(it)}:${canonical(value.opt(it))}" }
        is JSONArray -> (0 until value.length()).joinToString(prefix = "[", postfix = "]") { canonical(value.opt(it)) }
        is String -> JSONObject.quote(value)
        is Number, is Boolean -> value.toString()
        else -> JSONObject.quote(value.toString())
    }
}

class WidgetCloudSyncJob : JobService() {
    @Volatile private var stopped = false
    @Volatile private var connection: HttpURLConnection? = null

    override fun onStartJob(params: JobParameters): Boolean {
        stopped = false
        thread(name = "saku-background-sync") {
            val retry = !runCatching { syncLatest() }.getOrDefault(false)
            if (!stopped) jobFinished(params, retry)
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        stopped = true
        connection?.disconnect()
        return true
    }

    private fun syncLatest(): Boolean {
        if (MainActivity.visible) return false
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        var tokens = SecureSessionStore.load(this) ?: return true
        repeat(3) {
            if (stopped) return true
            val cloud = prefs.getString("saku-cloud-state-v1", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return true
            if (!cloud.optBoolean("dirty")) return true
            val userId = cloud.optJSONObject("user")?.optString("id").orEmpty()
            if (userId.isBlank()) return true
            val ledgerKey = "saku-ledger-v3-$userId"
            val ledgerText = prefs.getString(ledgerKey, null) ?: return true
            val ledger = runCatching { JSONObject(ledgerText) }.getOrNull() ?: return true
            val baseRevision = cloud.optInt("revision", 0)
            val payload = JSONObject().put("baseRevision", baseRevision).put("data", ledger).toString()
            var response = call("/v1/sync", "PUT", payload, tokens.accessToken)
            if (response.status == 401) {
                val refreshed = call("/v1/auth/refresh", "POST", JSONObject().put("refreshToken", tokens.refreshToken).toString(), null)
                if (refreshed.status !in 200..299) return terminal(refreshed.status)
                val body = JSONObject(refreshed.body)
                tokens = SessionTokens(body.optString("accessToken"), body.optString("refreshToken"))
                if (tokens.accessToken.isBlank() || tokens.refreshToken.isBlank()) return true
                SecureSessionStore.save(this, tokens)
                response = call("/v1/sync", "PUT", payload, tokens.accessToken)
            }
            if (response.status == 409) return resolveConflict(prefs, ledgerKey, tokens.accessToken)
            if (response.status !in 200..299) return terminal(response.status)

            val result = JSONObject(response.body)
            val currentLedger = prefs.getString(ledgerKey, null)
            val currentCloud = prefs.getString("saku-cloud-state-v1", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: cloud
            currentCloud.put("revision", maxOf(currentCloud.optInt("revision", 0), result.optInt("revision", baseRevision)))
                .put("lastSyncedAt", java.time.Instant.now().toString())
                .put("spreadsheetUrl", result.optString("spreadsheetUrl", currentCloud.optString("spreadsheetUrl")))
                .put("sheetPending", result.optBoolean("sheetPending"))
                .put("dirty", currentLedger != ledgerText)
            if (!prefs.edit().putString("saku-cloud-state-v1", currentCloud.toString()).commit()) return false
            if (currentLedger == ledgerText) return true
        }
        return false
    }

    private fun resolveConflict(prefs: android.content.SharedPreferences, ledgerKey: String, accessToken: String): Boolean {
        val remote = call("/v1/sync", "GET", null, accessToken)
        if (remote.status !in 200..299) return terminal(remote.status)
        val result = JSONObject(remote.body)
        val remoteLedger = result.optJSONObject("data") ?: return true
        val currentLedger = prefs.getString(ledgerKey, null) ?: return true
        if (!WidgetCloudSync.sameLedger(currentLedger, remoteLedger)) return true
        val cloud = prefs.getString("saku-cloud-state-v1", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return true
        cloud.put("dirty", false)
            .put("revision", result.optInt("revision", cloud.optInt("revision", 0)))
            .put("lastSyncedAt", java.time.Instant.now().toString())
            .put("spreadsheetUrl", result.optString("spreadsheetUrl", cloud.optString("spreadsheetUrl")))
        return prefs.edit().putString("saku-cloud-state-v1", cloud.toString()).commit()
    }

    private fun terminal(status: Int) = status in 400..499 && status != 408 && status != 429

    private fun call(path: String, method: String, body: String?, accessToken: String?): HttpResult {
        val request = (URL(BuildConfig.SAKU_API_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Content-Type", "application/json")
            if (!accessToken.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $accessToken")
            doOutput = body != null
        }
        connection = request
        return try {
            if (body != null) request.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = request.responseCode
            val stream = if (status in 200..299) request.inputStream else request.errorStream
            HttpResult(status, stream?.bufferedReader()?.use { it.readText() } ?: "{}")
        } finally {
            connection = null
            request.disconnect()
        }
    }

    private data class HttpResult(val status: Int, val body: String)
}
