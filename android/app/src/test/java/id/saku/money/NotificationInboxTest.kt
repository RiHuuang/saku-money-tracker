package id.saku.money

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class NotificationInboxTest {
    private class JvmCipher(private val key: SecretKey) : InboxCipher {
        override fun seal(plain: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
            return cipher.iv + cipher.doFinal(plain)
        }
        override fun open(sealed: ByteArray): ByteArray = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
            doFinal(sealed.copyOfRange(12, sealed.size))
        }
    }
    private fun key() = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private var file: String? = null
    private var now = 1_793_000_000_000L
    private fun store(key: SecretKey) = InboxStore(JvmCipher(key), { file }, { file = it }, { now })
    private fun item(id: String, at: Long = now, merchant: String = "ALFAMART") = InboxItem(id, "com.bca", "BCA", 48500, "expense", merchant, null, at)

    @Test
    fun accountNumbersAndReferencesAreNeverStored() {
        val parsed = NotificationParsers.parse("com.bca", "BCA mobile", "Transfer Rp250.000 ke BUDI 1234567890 ref TRX99887766 berhasil.", now)!!
        val merchant = InboxRedaction.redact(parsed.rawMerchant, parsed.amount)
        val key = key()
        store(key).add(item("a", merchant = merchant))
        val plain = String(JvmCipher(key).open(Base64.getDecoder().decode(file)), Charsets.UTF_8)
        assertFalse(plain.contains("1234567890"))
        assertFalse(plain.contains("99887766"))
        assertEquals("BUDI", merchant)
        assertEquals("Kartu", InboxRedaction.redact("Kartu x1234", 1000))
        assertEquals("ke", InboxRedaction.redact("ke ****5678", 1000))
        assertEquals("Order 250000", InboxRedaction.redact("Order 250000", 250000))
    }

    @Test
    fun theStoredFileIsUnreadableWithoutTheKey() {
        store(key()).add(item("a"))
        val raw = String(Base64.getDecoder().decode(file), Charsets.ISO_8859_1)
        assertFalse(raw.contains("ALFAMART"))
        assertTrue(store(key()).items().isEmpty())
        assertNull("an unreadable inbox is discarded rather than kept", file)
    }

    @Test
    fun itemsExpireAfterSevenDaysAndClearEmptiesTheInbox() {
        val key = key()
        store(key).add(item("old", at = now - InboxStore.MAX_AGE_MS - 1))
        store(key).add(item("fresh"))
        assertEquals(listOf("fresh"), store(key).items().map { it.id })
        assertEquals(1, store(key).add(item("fresh")))
        store(key).clear()
        assertNull(file)
        assertTrue(store(key).items().isEmpty())
    }

    @Test
    fun theInboxKeepsAtMostFiveHundredItems() {
        val key = key()
        var size = 0
        for (index in 0 until InboxStore.LIMIT + 5) size = store(key).add(item("i$index", at = now - InboxStore.LIMIT + index))
        assertEquals(InboxStore.LIMIT, size)
        assertFalse(store(key).items().any { it.id == "i0" })
    }
}
