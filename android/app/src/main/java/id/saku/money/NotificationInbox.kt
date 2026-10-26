package id.saku.money

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class InboxItem(val id: String, val packageName: String, val account: String, val amount: Long, val direction: String, val rawMerchant: String, val balance: Long?, val occurredAt: Long)

interface InboxCipher {
    fun seal(plain: ByteArray): ByteArray
    fun open(sealed: ByteArray): ByteArray
}

object InboxRedaction {
    private val longDigits = Regex("""\S*\d{6,}\S*""")
    private val maskedAccount = Regex("""(?i)(?<![\p{L}\p{N}])(?:[x*•]+[\s-]?\d{3,4}|\d{2,4}[x*•]{2,}\d{2,4})(?!\p{N})""")

    // Account numbers, card fragments and reference codes never reach storage; the amount itself may stay.
    fun redact(text: String, amount: Long): String = text
        .replace(maskedAccount, " ")
        .replace(longDigits) { if (it.value.filter(Char::isDigit) == amount.toString()) it.value else " " }
        .replace(Regex("""\s+"""), " ").trim().take(60)
}

class InboxStore(private val cipher: InboxCipher, private val read: () -> String?, private val write: (String?) -> Unit, private val now: () -> Long) {
    companion object {
        const val LIMIT = 500
        const val MAX_AGE_MS = 7L * 24 * 60 * 60 * 1000
    }

    fun items(): List<InboxItem> {
        val sealed = read() ?: return emptyList()
        val stored = runCatching { decode(String(cipher.open(Base64.getDecoder().decode(sealed)), Charsets.UTF_8)) }.getOrElse { write(null); return emptyList() }
        val kept = purge(stored)
        if (kept.size != stored.size) save(kept)
        return kept
    }

    fun add(item: InboxItem): Int {
        val current = items()
        if (current.any { it.id == item.id }) return current.size
        val next = purge(current + item)
        save(next)
        return next.size
    }

    fun remove(ids: Set<String>) = save(items().filterNot { it.id in ids })

    fun clear() = write(null)

    private fun purge(items: List<InboxItem>) = items.filter { now() - it.occurredAt <= MAX_AGE_MS }.sortedBy { it.occurredAt }.takeLast(LIMIT)

    private fun save(items: List<InboxItem>) =
        write(if (items.isEmpty()) null else Base64.getEncoder().encodeToString(cipher.seal(encode(items).toByteArray(Charsets.UTF_8))))

    private fun encode(items: List<InboxItem>) = JSONArray().apply {
        for (item in items) put(JSONObject().apply {
            put("id", item.id); put("packageName", item.packageName); put("account", item.account); put("amount", item.amount)
            put("direction", item.direction); put("rawMerchant", item.rawMerchant); put("balance", item.balance ?: JSONObject.NULL); put("occurredAt", item.occurredAt)
        })
    }.toString()

    private fun decode(json: String): List<InboxItem> {
        val array = JSONArray(json)
        return (0 until array.length()).map { index ->
            val row = array.getJSONObject(index)
            InboxItem(row.getString("id"), row.getString("packageName"), row.getString("account"), row.getLong("amount"), row.getString("direction"),
                row.getString("rawMerchant"), if (row.isNull("balance")) null else row.getLong("balance"), row.getLong("occurredAt"))
        }
    }
}

object NotificationInbox {
    private const val PREFS = "saku_notification_inbox"
    private const val ALIAS = "saku_inbox_key"
    private const val CHANNEL = "saku_inbox"
    private const val SUMMARY_ID = 4100

    private object KeystoreCipher : InboxCipher {
        private fun key(): SecretKey {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
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
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return InboxStore(KeystoreCipher, { prefs.getString("items", null) }, { value ->
            check((if (value == null) prefs.edit().remove("items") else prefs.edit().putString("items", value)).commit())
        }, System::currentTimeMillis)
    }

    fun receive(context: Context, captured: CapturedNotification) {
        val parsed = NotificationParsers.parse(captured.packageName, captured.title, captured.text, captured.postedAt) ?: return
        val id = MessageDigest.getInstance("SHA-256").digest("${captured.packageName}|${captured.postedAt}|${parsed.amount}|${parsed.direction}".toByteArray())
            .joinToString("") { "%02x".format(it) }.take(32)
        val count = store(context).add(InboxItem(id, captured.packageName, captured.account, parsed.amount, parsed.direction,
            InboxRedaction.redact(parsed.rawMerchant, parsed.amount), parsed.balance, parsed.occurredAt))
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
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "Transactions to review", NotificationManager.IMPORTANCE_LOW))
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply { putExtra("saku_open", "inbox"); addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP) }
        val notification = NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_saku)
            .setContentTitle("Saku")
            .setContentText("$count ${if (count == 1) "transaction" else "transactions"} to review")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .setGroup("saku_inbox")
            .setAutoCancel(true)
            .apply { if (open != null) setContentIntent(PendingIntent.getActivity(context, SUMMARY_ID, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)) }
            .build()
        runCatching { manager.notify(SUMMARY_ID, notification) }
    }
}
