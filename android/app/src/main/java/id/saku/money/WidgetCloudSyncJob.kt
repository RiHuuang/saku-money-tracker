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
import java.util.zip.GZIPInputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import kotlin.concurrent.thread

object WidgetCloudSync {
    const val JOB_ID = 0x53414b55

    fun schedule(context: Context) {
        if (!BuildConfig.SAKU_WIDGETS_ENABLED) return
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
    private var expectedUserId = ""

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
        SecureSessionStore.load(this) ?: return true
        repeat(3) {
            if (stopped) return true
            val cloud = prefs.getString("saku-cloud-state-v1", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return true
            val userId = cloud.optJSONObject("user")?.optString("id").orEmpty()
            if (userId.isBlank()) return true
            expectedUserId = userId
            if (!cloud.optBoolean("dirty")) return mirrorLatest(cloud)
            val ledgerKey = "saku-ledger-v3-$userId"
            val ledgerText = prefs.getString(ledgerKey, null) ?: return true
            val ledger = runCatching { JSONObject(ledgerText) }.getOrNull() ?: return true
            val baseRevision = cloud.optInt("revision", 0)
            val response = upload(ledger.toString(), baseRevision)
            if (response.status == 409) return resolveConflict(prefs, ledgerKey)
            if (response.status !in 200..299) return terminal(response.status)

            val result = JSONObject(response.body)
            val currentLedger = prefs.getString(ledgerKey, null)
            val currentCloud = prefs.getString("saku-cloud-state-v1", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: cloud
            if (currentCloud.optJSONObject("user")?.optString("id") != userId) return true
            currentCloud.put("revision", maxOf(currentCloud.optInt("revision", 0), result.optInt("revision", baseRevision)))
                .put("lastSyncedAt", java.time.Instant.now().toString())
                .put("spreadsheetUrl", result.optString("spreadsheetUrl", currentCloud.optString("spreadsheetUrl")))
                .put("sheetPending", result.optBoolean("sheetPending"))
                .put("dirty", currentLedger != ledgerText)
            if (!prefs.edit().putString("saku-cloud-state-v1", currentCloud.toString()).commit()) return false
            if (currentLedger == ledgerText) return mirrorLatest(currentCloud)
        }
        return false
    }

    private fun resolveConflict(prefs: android.content.SharedPreferences, ledgerKey: String): Boolean {
        val remote = authorized("/v2/sync?format=manifest", "GET")
        if (remote.status !in 200..299) return terminal(remote.status)
        if (remote.status == 204) return true
        val remoteLedger = download(remote) ?: return true
        val currentLedger = prefs.getString(ledgerKey, null) ?: return true
        if (!WidgetCloudSync.sameLedger(currentLedger, remoteLedger)) return true
        val cloud = prefs.getString("saku-cloud-state-v1", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return true
        if (cloud.optJSONObject("user")?.optString("id") != expectedUserId) return true
        cloud.put("dirty", false)
            .put("revision", remote.revision ?: cloud.optInt("revision", 0))
            .put("lastSyncedAt", java.time.Instant.now().toString())
            .put("spreadsheetUrl", remote.spreadsheetUrl ?: cloud.optString("spreadsheetUrl"))
            .put("sheetPending", remote.sheetPending)
        return prefs.edit().putString("saku-cloud-state-v1", cloud.toString()).commit() && mirrorLatest(cloud)
    }

    private fun upload(json: String, revision: Int): HttpResult {
        val bytes = json.toByteArray(Charsets.UTF_8)
        require(bytes.size <= 10_000_000) { "Saku data exceeds 10 MB" }
        if (bytes.size <= 250_000) return authorized("/v2/sync?baseRevision=$revision", "PUT", json)
        val started = authorized("/v2/sync/start", "POST", JSONObject().put("baseRevision", revision).put("size", bytes.size).toString())
        if (started.status != 200) return started
        val metadata = JSONObject(started.body)
        require(metadata.getInt("chunkBytes") == 250_000)
        val id = metadata.getString("id")
        for (offset in bytes.indices step 250_000) {
            val part = authorized("/v2/sync/chunk?id=$id&index=${offset / 250_000}", "PUT", bytes = bytes.copyOfRange(offset, minOf(bytes.size, offset + 250_000)))
            if (part.status != 200) return part
        }
        return authorized("/v2/sync/finish", "POST", JSONObject().put("id", id).toString())
    }

    private fun download(response: HttpResult): JSONObject? {
        if (response.status == 204) return null
        check(response.status == 200) { "Backup download failed" }
        val manifest = JSONObject(response.body)
        val parts = manifest.getJSONArray("parts")
        require(parts.length() in 1..40 && manifest.getInt("size") in 1..10_100_000)
        val output = ByteArrayOutputStream()
        for (index in 0 until parts.length()) {
            val part = parts.getJSONObject(index)
            val size = part.getInt("size")
            require(size in 1..10_100_000)
            val key = java.net.URLEncoder.encode(part.getString("key"), "UTF-8")
            for (offset in 0 until size step 250_000) {
                val chunk = authorized("/v2/sync/chunk?key=$key&offset=$offset", "GET")
                check(chunk.status == 200 && chunk.bytes.size == minOf(250_000, size - offset)) { "Backup chunk is incomplete" }
                output.write(chunk.bytes)
                require(output.size() <= 10_100_000)
            }
        }
        check(output.size() == manifest.getInt("size"))
        val raw = ByteArrayInputStream(output.toByteArray())
        val stream = when (manifest.getString("encoding")) { "gzip" -> GZIPInputStream(raw); "identity" -> raw; else -> error("Unsupported backup encoding") }
        return stream.bufferedReader().use { JSONObject(it.readText()) }
    }

    private fun mirrorLatest(cloud: JSONObject): Boolean {
        if (!cloud.optBoolean("sheetPending") || cloud.optString("spreadsheetUrl").isBlank()) return true
        val started = authorized("/v2/sheets/start", "POST", "{}")
        if (started.status != 200) return terminal(started.status)
        val targetRevision = JSONObject(started.body).getInt("targetRevision")
        val baseline = download(authorized("/v2/sheets/snapshot?kind=baseline&format=manifest", "GET"))
        val target = download(authorized("/v2/sheets/snapshot?kind=target&format=manifest", "GET")) ?: return false
        val (changes, rows) = WidgetSheetMirror.plan(baseline, target)
        val plan = authorized("/v2/sheets/plan", "POST", JSONObject().put("targetRevision", targetRevision).put("total", changes.size).toString())
        if (plan.status != 200) return terminal(plan.status)
        val grid = authorized("/v2/sheets/grid", "POST", JSONObject().put("targetRevision", targetRevision).put("rows", rows).toString())
        if (grid.status != 200) return terminal(grid.status)
        val cursor = JSONObject(plan.body).getInt("cursor")
        for (index in cursor until changes.size) {
            if (index > cursor) Thread.sleep(1_200)
            val payload = WidgetSheetMirror.json(changes[index].put("targetRevision", targetRevision).put("index", index))
            var applied = authorized("/v2/sheets/batch", "POST", payload)
            if (applied.status == 428) {
                val refreshed = authorized("/v2/sheets/refresh", "POST", "{}")
                if (refreshed.status != 200) return terminal(refreshed.status)
                applied = authorized("/v2/sheets/batch", "POST", payload)
            }
            if (applied.status != 200) return terminal(applied.status)
        }
        val finished = authorized("/v2/sheets/finish", "POST", JSONObject().put("targetRevision", targetRevision).toString())
        if (finished.status != 200) return terminal(finished.status)
        val prefs = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
        val current = prefs.getString("saku-cloud-state-v1", null)?.let(::JSONObject) ?: return true
        if (current.optJSONObject("user")?.optString("id") != expectedUserId) return true
        current.put("sheetPending", JSONObject(finished.body).optBoolean("sheetPending"))
        return prefs.edit().putString("saku-cloud-state-v1", current.toString()).commit() && !current.optBoolean("dirty") && !current.optBoolean("sheetPending")
    }

    private fun ensureAccount(allowForeground: Boolean = false) {
        // Preserve completed token rotation for this account if the app opens.
        check(allowForeground || (!stopped && !MainActivity.visible)) { "Background sync stopped" }
        val state = getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).getString("saku-cloud-state-v1", null)?.let(::JSONObject)
        check(state?.optJSONObject("user")?.optString("id") == expectedUserId) { "Google account changed during synchronization" }
    }

    private fun authorized(path: String, method: String, body: String? = null, bytes: ByteArray? = null): HttpResult {
        ensureAccount()
        var tokens = SecureSessionStore.load(this) ?: error("Google session ended")
        var result = call(path, method, body, tokens.accessToken, bytes)
        if (result.status == 401) {
            val refreshed = call("/v1/auth/refresh", "POST", JSONObject().put("refreshToken", tokens.refreshToken).toString(), null)
            if (refreshed.status != 200) return refreshed
            ensureAccount(allowForeground = true)
            check(SecureSessionStore.load(this) == tokens) { "Google session changed during synchronization" }
            val payload = JSONObject(refreshed.body)
            tokens = SessionTokens(payload.getString("accessToken"), payload.getString("refreshToken"))
            SecureSessionStore.save(this, tokens)
            ensureAccount()
            result = call(path, method, body, tokens.accessToken, bytes)
        }
        ensureAccount()
        return result
    }

    private fun terminal(status: Int) = status in 400..499 && status != 408 && status != 429

    private fun call(path: String, method: String, body: String?, accessToken: String?, bytes: ByteArray? = null): HttpResult {
        val payload = bytes ?: body?.toByteArray(Charsets.UTF_8)
        val request = (URL(BuildConfig.SAKU_API_URL.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 60_000
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("X-Saku-User-Id", expectedUserId)
            setRequestProperty("X-Saku-App-Build", BuildConfig.VERSION_CODE.toString())
            if (path.startsWith("/v2/sync") && method == "PUT") setRequestProperty("X-Saku-Version", "3")
            if (!accessToken.isNullOrBlank()) setRequestProperty("Authorization", "Bearer $accessToken")
            doOutput = payload != null
            if (payload != null) setFixedLengthStreamingMode(payload.size)
        }
        connection = request
        return try {
            if (payload != null) request.outputStream.use { it.write(payload) }
            val status = request.responseCode
            val stream = if (status in 200..299) request.inputStream else request.errorStream
            val decoded = if (request.getHeaderField("X-Saku-Encoding") == "gzip" && stream != null) GZIPInputStream(stream) else stream
            HttpResult(status, decoded?.use { it.readBytes() } ?: ByteArray(0), request.getHeaderField("X-Saku-Revision")?.toIntOrNull(), request.getHeaderField("X-Saku-Spreadsheet-Url"), request.getHeaderField("X-Saku-Sheet-Pending") == "true")
        } finally {
            connection = null
            request.disconnect()
        }
    }

    private data class HttpResult(val status: Int, val bytes: ByteArray, val revision: Int?, val spreadsheetUrl: String?, val sheetPending: Boolean) {
        val body: String get() = String(bytes, Charsets.UTF_8)
    }
}
