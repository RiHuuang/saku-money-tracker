package id.saku.money

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// cancels: a payment the bank later cancelled, after its spend already left the inbox (added or skipped).
// content: a salted hash of the notification's key and words, used to merge an update posted within minutes.
data class InboxItem(val id: String, val packageName: String, val account: String, val amount: Long, val direction: String, val rawMerchant: String, val balance: Long?, val occurredAt: Long, val cancels: Boolean = false, val content: String = "")

// A row the user already handled (added, skipped or cancelled). Kept for 8 days inside the encrypted inbox so a
// rescan or a repost never brings it back. Holds no merchant name.
// direction is "expense"/"income" for rows the user added or skipped, "cancelled" for a spend a later notice cancelled.
data class Tombstone(val id: String, val packageName: String, val account: String, val direction: String, val amount: Long, val occurredAt: Long, val at: Long, val content: String = "")

interface InboxCipher {
    fun seal(plain: ByteArray): ByteArray
    fun open(sealed: ByteArray): ByteArray
}

// The inbox exists but can't be read right now (for example the keystore is busy). Nothing is wiped.
class InboxUnavailable(cause: Throwable) : IllegalStateException("The inbox could not be read right now", cause)

object InboxRedaction {
    private val longDigits = Regex("""\S*\d{6,}\S*""")
    private val maskedAccount = Regex("""(?i)(?<![\p{L}\p{N}])(?:[x*•]+[\s-]?\d{3,4}|\d{2,4}[x*•]{2,}\d{2,4})(?!\p{N})""")

    // Account numbers, card fragments and reference codes never reach storage; the amount itself may stay.
    fun redact(text: String, amount: Long): String = text
        .replace(maskedAccount, " ")
        .replace(longDigits) { if (it.value.filter(Char::isDigit) == amount.toString()) it.value else " " }
        .replace(Regex("""\s+"""), " ").trim().take(60)
}

class InboxStore(
    private val cipher: InboxCipher,
    private val read: () -> String?,
    private val write: (String?) -> Unit,
    private val now: () -> Long,
    private val onReset: (Long) -> Unit = {},
    private val onExpired: (Int) -> Unit = {},
) {
    companion object {
        const val LIMIT = 500
        const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
        const val TOMBSTONE_MS = 8L * 24 * 60 * 60 * 1000
        const val TOMBSTONE_LIMIT = 2000
        // The same words under the same notification key within this window are an update of one alert, not a
        // second payment. Beyond it, an identical alert is a new payment (same coffee, same shop, next day).
        const val REPOST_MS = 10L * 60 * 1000
        // One lock for every read-modify-write in the process: the listener thread and the app's plugin calls
        // otherwise overwrite each other's changes.
        val LOCK = Any()
        private val permanentErrors = setOf(
            "javax.crypto.AEADBadTagException",
            "android.security.keystore.KeyPermanentlyInvalidatedException",
            "java.security.UnrecoverableKeyException",
        )

        // Only these mean the stored inbox can never be opened again; anything else is retried later.
        fun permanent(error: Throwable): Boolean = generateSequence(error) { it.cause }.take(8).any { it.javaClass.name in permanentErrors }
    }

    private data class State(val items: List<InboxItem> = emptyList(), val tombstones: List<Tombstone> = emptyList())

    fun items(): List<InboxItem> = synchronized(LOCK) { current().items }

    // Adds a row, or keeps the existing one (with the earliest time) when the same notification is posted again.
    // Returns how many rows are waiting.
    fun add(item: InboxItem): Int = synchronized(LOCK) {
        val state = current()
        if (state.tombstones.any { it.id == item.id }) return state.items.size
        val near = { other: Long -> kotlin.math.abs(other - item.occurredAt) <= REPOST_MS }
        val existing = state.items.find { it.id == item.id } ?: state.items.find { item.content.isNotEmpty() && it.content == item.content && near(it.occurredAt) }
        if (existing != null) {
            if (item.occurredAt < existing.occurredAt) save(state.copy(items = state.items.map { if (it.id == existing.id) it.copy(occurredAt = item.occurredAt) else it }))
            return state.items.size
        }
        if (item.content.isNotEmpty() && state.tombstones.any { it.content == item.content && near(it.occurredAt) }) return state.items.size
        val next = purge(state.copy(items = state.items + item))
        save(next)
        next.items.size
    }

    // Whether this notification was already handled or is already waiting.
    fun knows(id: String): Boolean = synchronized(LOCK) { current().let { state -> state.items.any { it.id == id } || state.tombstones.any { it.id == id } } }

    // Rows the user added or skipped leave the inbox and are remembered, so they are never captured again.
    fun remove(ids: Set<String>) = synchronized(LOCK) {
        val state = current()
        val (gone, kept) = state.items.partition { it.id in ids }
        save(purge(State(kept, state.tombstones + gone.map { it.tombstone(now()) })))
    }

    // Undo: the rows come back and are no longer treated as handled.
    fun restore(items: List<InboxItem>) = synchronized(LOCK) {
        val state = current()
        val ids = items.map { it.id }.toSet()
        // The app layer doesn't carry the content key, so it comes back from the tombstone this undo removes.
        val withContent = items.map { restored -> if (restored.content.isNotEmpty()) restored else restored.copy(content = state.tombstones.find { it.id == restored.id }?.content.orEmpty()) }
        val merged = state.items.filterNot { it.id in ids } + withContent.map { restored -> state.items.find { it.id == restored.id }?.let { if (it.occurredAt < restored.occurredAt) it else restored } ?: restored }
        save(purge(State(merged, state.tombstones.filterNot { it.id in ids })))
    }

    // A cancelled payment: drops the latest matching spend still waiting from the same app in the day before.
    // If that spend already left the inbox, a "cancelled" row is added so the user can fix the ledger.
    fun cancel(packageName: String, amount: Long, cancelledAt: Long, cancelId: String, content: String = ""): Int = synchronized(LOCK) {
        val state = current()
        val window = (cancelledAt - 86_400_000L)..cancelledAt
        val spend = state.items.lastOrNull { it.packageName == packageName && it.direction == "expense" && !it.cancels && it.amount == amount && it.occurredAt in window }
        if (state.items.any { it.id == cancelId } || state.tombstones.any { it.id == cancelId }) return state.items.size
        // An update or repost of the same cancellation notice (same words, new post time) is the same cancellation.
        val near = { other: Long -> kotlin.math.abs(other - cancelledAt) <= REPOST_MS }
        if (content.isNotEmpty() && (state.items.any { it.content == content && near(it.occurredAt) } || state.tombstones.any { it.content == content && near(it.occurredAt) })) return state.items.size
        if (spend != null) {
            // The cancellation itself is remembered too, so a repost of it can't cancel a second time.
            val handledCancel = Tombstone(cancelId, packageName, spend.account, "cancel", amount, cancelledAt, now(), content)
            // Marked "cancelled", so a second notice about the same cancellation can't add a phantom refund row.
            val next = purge(State(state.items - spend, state.tombstones + spend.tombstone(now()).copy(direction = "cancelled") + handledCancel))
            save(next)
            return next.items.size
        }
        val handled = state.tombstones.lastOrNull { it.packageName == packageName && it.direction == "expense" && it.amount == amount && it.occurredAt in window }
        if (handled == null) return state.items.size
        // The handled spend is marked cancelled, so a second, differently worded notice can't add another refund.
        val stones = state.tombstones.map { if (it === handled) it.copy(direction = "cancelled") else it }
        val next = purge(State(state.items + InboxItem(cancelId, packageName, handled.account, amount, "income", "", null, cancelledAt, cancels = true, content = content), stones))
        save(next)
        next.items.size
    }

    fun clear() = synchronized(LOCK) { write(null) }

    private fun InboxItem.tombstone(at: Long) = Tombstone(id, packageName, account, direction, amount, occurredAt, at, content)

    private fun current(): State {
        val state = load()
        val kept = purge(state)
        if (kept != state) save(kept)
        return kept
    }

    private fun load(): State {
        val sealed = read() ?: return State()
        val plain = try {
            cipher.open(Base64.getDecoder().decode(sealed))
        } catch (error: Exception) {
            if (!permanent(error)) throw InboxUnavailable(error)
            return reset()
        }
        return runCatching { decode(String(plain, Charsets.UTF_8)) }.getOrElse { reset() }
    }

    // The stored inbox can never be read again (the key was replaced or the data is corrupt): start empty, and
    // record when, so the app can tell the user once.
    private fun reset(): State {
        write(null)
        onReset(now())
        return State()
    }

    private fun purge(state: State): State {
        val fresh = state.items.filter { now() - it.occurredAt <= MAX_AGE_MS }
        if (fresh.size < state.items.size) onExpired(state.items.size - fresh.size)
        return State(
            fresh.sortedBy { it.occurredAt }.takeLast(LIMIT),
            state.tombstones.filter { now() - it.at <= TOMBSTONE_MS }.sortedBy { it.at }.takeLast(TOMBSTONE_LIMIT),
        )
    }

    private fun save(state: State) =
        write(if (state.items.isEmpty() && state.tombstones.isEmpty()) null else Base64.getEncoder().encodeToString(cipher.seal(encode(state).toByteArray(Charsets.UTF_8))))

    private fun encode(state: State) = JSONObject().apply {
        put("v", 2)
        put("items", JSONArray().apply {
            for (item in state.items) put(JSONObject().apply {
                put("id", item.id); put("packageName", item.packageName); put("account", item.account); put("amount", item.amount)
                put("direction", item.direction); put("rawMerchant", item.rawMerchant); put("balance", item.balance ?: JSONObject.NULL); put("occurredAt", item.occurredAt)
                if (item.cancels) put("cancels", true)
                if (item.content.isNotEmpty()) put("content", item.content)
            })
        })
        put("tombstones", JSONArray().apply {
            for (stone in state.tombstones) put(JSONObject().apply {
                put("id", stone.id); put("packageName", stone.packageName); put("account", stone.account); put("direction", stone.direction)
                put("amount", stone.amount); put("occurredAt", stone.occurredAt); put("at", stone.at)
                if (stone.content.isNotEmpty()) put("content", stone.content)
            })
        })
    }.toString()

    private fun decode(json: String): State {
        // Version 1 stored a bare array of rows.
        val root = json.trimStart()
        val items = if (root.startsWith("[")) JSONArray(json) else JSONObject(json).getJSONArray("items")
        val stones = if (root.startsWith("[")) JSONArray() else JSONObject(json).optJSONArray("tombstones") ?: JSONArray()
        return State(
            (0 until items.length()).map { index ->
                val row = items.getJSONObject(index)
                InboxItem(row.getString("id"), row.getString("packageName"), row.getString("account"), row.getLong("amount"), row.getString("direction"),
                    row.getString("rawMerchant"), if (row.isNull("balance")) null else row.getLong("balance"), row.getLong("occurredAt"), row.optBoolean("cancels", false), row.optString("content"))
            },
            (0 until stones.length()).map { index ->
                val row = stones.getJSONObject(index)
                Tombstone(row.getString("id"), row.getString("packageName"), row.optString("account"), row.getString("direction"), row.getLong("amount"), row.getLong("occurredAt"), row.getLong("at"), row.optString("content"))
            },
        )
    }
}

object NotificationInbox {
    private const val PREFS = "saku_notification_inbox"
    private const val ALIAS = "saku_inbox_key"
    private const val CHANNEL = "saku_inbox"
    private const val SUMMARY_ID = 4100

    // Listener work runs here, one notification at a time, never on the WebView's UI thread.
    private val worker: ExecutorService = Executors.newSingleThreadExecutor { runnable -> Thread(runnable, "saku-capture").apply { isDaemon = true } }
    fun post(task: () -> Unit) { worker.execute { runCatching(task) } }

    private object KeystoreCipher : InboxCipher {
        // Under the inbox lock, so two threads can't each create a different key.
        private fun key(): SecretKey = synchronized(InboxStore.LOCK) {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
                init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
                generateKey()
            }
        }
        override fun seal(plain: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
            return cipher.iv + cipher.doFinal(plain)
        }
        override fun open(sealed: ByteArray): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            doFinal(sealed.copyOfRange(12, sealed.size))
        }
    }

    fun store(context: Context): InboxStore {
        val app = context.applicationContext
        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return InboxStore(KeystoreCipher, { prefs.getString("items", null) }, { value ->
            check((if (value == null) prefs.edit().remove("items") else prefs.edit().putString("items", value)).commit())
        }, System::currentTimeMillis, { at -> CaptureHealth.inboxReset(app, at) }, { count -> CaptureHealth.expired(app, count) })
    }

    // A per-install salt, so IDs can't be linked across phones.
    private fun salt(context: Context): String = synchronized(InboxStore.LOCK) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString("salt", null) ?: Base64.getEncoder().encodeToString(ByteArray(16).also { SecureRandom().nextBytes(it) }).also { check(prefs.edit().putString("salt", it).commit()) }
    }

    private fun sha(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    // One post of a notification: a rescan of the same post (same post time) finds the same ID, while a second real
    // payment with identical words gets a new one. Updates within minutes are merged through contentKey instead.
    fun idFor(salt: String, key: String, title: String, text: String, postedAt: Long): String = sha("$salt|$key|${sha("$title\n$text")}|$postedAt").take(32)
    fun contentKey(salt: String, key: String, title: String, text: String): String = sha("$salt|$key|${sha("$title\n$text")}").take(32)
    fun legacyId(packageName: String, postedAt: Long, amount: Long, direction: String): String = sha("$packageName|$postedAt|$amount|$direction").take(32)

    fun receive(context: Context, captured: CapturedNotification) {
        if (NotificationCapture.isRedactedPlaceholder(captured.text)) {
            // Android 15 hides OTP-like text; count it, never parse it.
            CaptureHealth.redacted(context)
            return
        }
        val salt = salt(context)
        val id = idFor(salt, captured.key, captured.title, captured.text, captured.postedAt)
        val store = store(context)
        val content = contentKey(salt, captured.key, captured.title, captured.text)
        NotificationParsers.cancelledSpend(captured.packageName, captured.title, captured.text)?.let { amount ->
            summarize(context, store.cancel(captured.packageName, amount, captured.postedAt, id, content))
            return
        }
        if (store.knows(id)) return
        val parsed = NotificationParsers.parse(captured.packageName, captured.title, captured.text, captured.postedAt) ?: return
        // Rows from 2.6.0 and earlier carry the old ID, sha(package|post time|amount|direction), and no content key.
        if (store.knows(legacyId(captured.packageName, captured.postedAt, parsed.amount, parsed.direction))) return
        val count = store.add(InboxItem(id, captured.packageName, captured.account, parsed.amount, parsed.direction,
            InboxRedaction.redact(parsed.rawMerchant, parsed.amount), parsed.balance, parsed.occurredAt, content = content))
        CaptureHealth.admitted(context)
        summarize(context, count)
    }

    fun clear(context: Context) {
        store(context).clear()
        NotificationManagerCompat.from(context).cancel(SUMMARY_ID)
    }

    // One quiet, grouped reminder that rows are waiting, never one notification per transaction.
    fun summarize(context: Context, count: Int) {
        val manager = NotificationManagerCompat.from(context)
        if (count <= 0) { manager.cancel(SUMMARY_ID); return }
        if (!manager.areNotificationsEnabled()) return
        // Android 13+ users can refuse notifications; a quiet no-op is right here.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.notification_review_channel), NotificationManager.IMPORTANCE_LOW))
        // Explicit and in-app only: the activity reports saku://review to the web layer, which opens the Notifications tab.
        val open = Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW).setData(Uri.parse("saku://review")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_saku)
            .setContentTitle("Saku")
            .setContentText(context.resources.getQuantityString(R.plurals.notification_rows_to_review, count, count))
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setGroup("saku_inbox")
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(context, SUMMARY_ID, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
            .build()
        runCatching { manager.notify(SUMMARY_ID, notification) }
    }
}
