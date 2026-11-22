package id.saku.money

import android.app.ApplicationExitInfo
import android.app.Notification
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.UnrecoverableKeyException
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

// Master plan 1A, V1.1: the capture pipeline's logic, without a device.
class CapturePipelineTest {
    private class JvmCipher(private val key: SecretKey, var failOpen: Exception? = null) : InboxCipher {
        override fun seal(plain: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key) }
            return cipher.iv + cipher.doFinal(plain)
        }
        override fun open(sealed: ByteArray): ByteArray {
            failOpen?.let { throw it }
            return Cipher.getInstance("AES/GCM/NoPadding").run {
                init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, sealed.copyOfRange(0, 12)))
                doFinal(sealed.copyOfRange(12, sealed.size))
            }
        }
    }
    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    @Volatile private var file: String? = null
    private var now = 1_793_000_000_000L
    private var resets = 0
    private var expired = 0
    private fun store(cipher: InboxCipher = JvmCipher(key)) = InboxStore(cipher, { file }, { file = it }, { now }, { resets++ }, { expired += it })
    private fun item(id: String, at: Long = now, amount: Long = 48_500, direction: String = "expense") = InboxItem(id, "com.bca", "BCA", amount, direction, "ALFAMART", null, at)

    @Test
    fun concurrentWritersNeverLoseARow() {
        val pool = Executors.newFixedThreadPool(8)
        val start = CountDownLatch(1)
        repeat(80) { index -> pool.execute { start.await(); store().add(item("row$index", at = now - index)) } }
        start.countDown()
        pool.shutdown()
        assertTrue(pool.awaitTermination(30, TimeUnit.SECONDS))
        assertEquals(80, store().items().size)
    }

    @Test
    fun aTemporaryCryptoErrorKeepsTheInbox() {
        store().add(item("keep"))
        val saved = file
        val failing = JvmCipher(key, failOpen = IllegalStateException("Keystore busy"))
        assertTrue(runCatching { store(failing).items() }.exceptionOrNull() is InboxUnavailable)
        assertTrue(runCatching { store(failing).add(item("new")) }.exceptionOrNull() is InboxUnavailable)
        assertEquals("nothing is wiped or overwritten", saved, file)
        assertEquals(0, resets)
        assertEquals(listOf("keep"), store().items().map { it.id })
    }

    @Test
    fun onlyAPermanentCryptoErrorResetsTheInboxAndIsRecorded() {
        store().add(item("lost"))
        assertTrue(store(JvmCipher(key, failOpen = AEADBadTagException("tag mismatch"))).items().isEmpty())
        assertNull(file)
        assertEquals(1, resets)
        assertTrue(InboxStore.permanent(IllegalStateException("wrapped", UnrecoverableKeyException("gone"))))
        assertFalse(InboxStore.permanent(IllegalStateException("busy")))
    }

    @Test
    fun aRepostIsTheSameRowButASecondIdenticalPaymentIsNot() {
        val key = "0|id.dana|7|null|10001"
        val words = "Kamu bayar Rp25.000 ke KOPI KENANGAN"
        val content = NotificationInbox.contentKey("salt", key, "DANA", words)
        assertEquals("a rescan of the same post finds the same ID", NotificationInbox.idFor("salt", key, "DANA", words, now), NotificationInbox.idFor("salt", key, "DANA", words, now))
        assertNotEquals(NotificationInbox.idFor("salt", key, "DANA", words, now), NotificationInbox.idFor("salt", key, "DANA", words, now + 1))
        assertNotEquals("the salt keeps IDs from linking across phones", content, NotificationInbox.contentKey("other", key, "DANA", words))
        val first = item("first", at = now - 600_000).copy(content = content)
        store().add(first)
        assertEquals("an update 5 minutes later is the same alert", 1, store().add(item("update", at = now - 300_000).copy(content = content)))
        assertEquals("and keeps the earliest time", 1, store().add(item("earlier", at = now - 900_000).copy(content = content)))
        assertEquals(listOf(now - 900_000), store().items().map { it.occurredAt })
        assertEquals("the same coffee two hours later is a second payment", 2, store().add(item("second", at = now + 2 * 3_600_000).copy(content = content)))
        store().remove(setOf("first", "second"))
        assertEquals("a handled alert's update is not captured again", 0, store().add(item("late-update", at = now - 600_000 + 60_000).copy(content = content)))
        assertEquals("but the next day's identical payment is", 1, store().add(item("next-day", at = now + 86_400_000).copy(content = content)))
    }

    @Test
    fun handledRowsAreRememberedSoARescanNeverBringsThemBack() {
        store().add(item("added"))
        store().add(item("skipped", amount = 10_000))
        store().remove(setOf("added", "skipped"))
        assertTrue(store().knows("added"))
        assertEquals(0, store().add(item("added")))
        assertEquals(0, store().add(item("skipped", amount = 10_000)))
        now += InboxStore.TOMBSTONE_MS + 1
        assertFalse("tombstones last 8 days", store().knows("added"))
    }

    @Test
    fun undoRestoresAHandledRow() {
        val row = item("undo")
        store().add(row)
        store().remove(setOf("undo"))
        store().restore(listOf(row))
        assertEquals(listOf("undo"), store().items().map { it.id })
        assertFalse(store().knows("missing"))
    }

    @Test
    fun aCancellationAfterTheSpendWasAddedCreatesACancelledRow() {
        store().add(item("spend", at = now - 60_000))
        store().remove(setOf("spend"))
        assertEquals(1, store().cancel("com.bca", 48_500, now, "cancel-1"))
        val cancelled = store().items().single()
        assertTrue(cancelled.cancels)
        assertEquals("income", cancelled.direction)
        assertEquals("BCA", cancelled.account)
        assertEquals("a repost of the cancellation adds nothing", 1, store().cancel("com.bca", 48_500, now, "cancel-1"))
        assertEquals("no handled spend, nothing to cancel", 1, store().cancel("com.bca", 1_000, now, "cancel-2"))
    }

    @Test
    fun aRepostedOrSecondCancellationOfAnAddedSpendAddsOneRefundRow() {
        store().add(item("spend", at = now - 60_000))
        store().remove(setOf("spend"))
        assertEquals(1, store().cancel("com.bca", 48_500, now, "cancel-1", "content-c"))
        assertEquals("an update of the same notice", 1, store().cancel("com.bca", 48_500, now + 60_000, "cancel-1b", "content-c"))
        assertEquals("a differently worded second notice", 1, store().cancel("com.bca", 48_500, now + 120_000, "cancel-2", "content-d"))
        store().remove(setOf("cancel-1"))
        assertEquals("a repost after the refund was handled", 0, store().cancel("com.bca", 48_500, now + 180_000, "cancel-1c", "content-c"))
    }

    @Test
    fun undoKeepsTheContentKeySoAnUpdateStillMerges() {
        val row = item("alert", at = now - 300_000).copy(content = "content-a")
        store().add(row)
        store().remove(setOf("alert"))
        store().restore(listOf(row.copy(content = "")))
        assertEquals(1, store().add(item("update", at = now - 120_000).copy(content = "content-a")))
        assertEquals(listOf("alert"), store().items().map { it.id })
    }

    @Test
    fun aRowFromBeforeTheUpgradeIsRecognisedByItsOldId() {
        val legacy = NotificationInbox.legacyId("com.bca", now, 48_500, "expense")
        store().add(item(legacy, at = now))
        assertTrue(store().knows(legacy))
    }

    @Test
    fun aSecondNoticeAboutTheSameCancellationAddsNoRefundRow() {
        store().add(item("spend", at = now - 60_000))
        assertEquals(0, store().cancel("com.bca", 48_500, now, "cancel-1"))
        assertEquals("a differently worded follow-up finds only a cancelled spend", 0, store().cancel("com.bca", 48_500, now + 30_000, "cancel-2"))
        assertTrue(store().items().isEmpty())
    }

    @Test
    fun aCancellationWhileTheSpendIsWaitingJustRemovesIt() {
        store().add(item("spend", at = now - 60_000))
        assertEquals(0, store().cancel("com.bca", 48_500, now, "cancel-1"))
        assertEquals(0, store().cancel("com.bca", 48_500, now, "cancel-1"))
        assertTrue(store().items().isEmpty())
    }

    @Test
    fun expiredRowsAreCountedAndOldInboxesStillOpen() {
        val legacy = """[{"id":"old","packageName":"com.bca","account":"BCA","amount":5000,"direction":"expense","rawMerchant":"X","balance":null,"occurredAt":${now - InboxStore.MAX_AGE_MS - 1}},{"id":"v1","packageName":"com.bca","account":"BCA","amount":5000,"direction":"expense","rawMerchant":"X","balance":null,"occurredAt":$now}]"""
        file = Base64.getEncoder().encodeToString(JvmCipher(key).seal(legacy.toByteArray()))
        assertEquals(listOf("v1"), store().items().map { it.id })
        assertEquals(1, expired)
    }

    @Test
    fun groupSummariesOngoingAndPlaceholderTextAreNeverParsed() {
        assertTrue(NotificationCapture.skippable(Notification.FLAG_GROUP_SUMMARY))
        assertTrue(NotificationCapture.skippable(Notification.FLAG_ONGOING_EVENT or Notification.FLAG_AUTO_CANCEL))
        assertFalse(NotificationCapture.skippable(Notification.FLAG_AUTO_CANCEL))
        assertTrue(NotificationCapture.isRedactedPlaceholder("Sensitive notification content hidden"))
        assertTrue(NotificationCapture.isRedactedPlaceholder(" Konten notifikasi sensitif disembunyikan "))
        assertFalse(NotificationCapture.isRedactedPlaceholder("Transaksi Rp25.000 berhasil"))
    }

    @Test
    fun theReleaseAllowlistIsExactlyTheKnownApps() {
        assertEquals(NotificationCapture.KNOWN_APPS, NotificationCapture.appsFor(debug = false))
        assertFalse(NotificationCapture.appsFor(debug = false).any { it.packageName == NotificationCapture.DEBUG_SHELL })
        assertTrue(NotificationCapture.appsFor(debug = true).any { it.packageName == NotificationCapture.DEBUG_SHELL })
    }

    @Test
    fun aPrintedTimeIsUsedOnlyWithAFullDateNearThePostTime() {
        val zone = ZoneId.of("Asia/Jakarta")
        val posted = LocalDateTime.of(2026, 10, 28, 14, 30).atZone(zone).toInstant().toEpochMilli()
        val at = { h: Int, m: Int, day: Int -> LocalDateTime.of(2026, 10, day, h, m).atZone(zone).toInstant().toEpochMilli() }
        assertEquals(at(14, 22, 28), NotificationParsers.printedTime("Transaksi 28/10/2026 14:22:05 sebesar Rp25.000", posted, zone))
        assertEquals(at(9, 5, 28), NotificationParsers.printedTime("Pada 28 Okt 2026 pukul 09.05 WIB", posted, zone))
        assertEquals(at(23, 59, 27), NotificationParsers.printedTime("2026-10-27 23:59 QRIS", posted, zone))
        assertNull("a time without a date is ignored", NotificationParsers.printedTime("pukul 14:22", posted, zone))
        assertNull("older than 36 hours", NotificationParsers.printedTime("Transaksi 20/10/2026 14:22", posted, zone))
        assertNull("in the future", NotificationParsers.printedTime("Jatuh tempo 30/10/2026 10:00", posted, zone))
        assertNull("an impossible date", NotificationParsers.printedTime("31/02/2026 10:00", posted, zone))
        assertNull("a 12-hour time is not guessed", NotificationParsers.printedTime("Payment on 28 Oct 2026 05:30 PM", posted, zone))
        val wita = ZoneId.of("Asia/Makassar")
        val postedWita = LocalDateTime.of(2026, 10, 29, 0, 31).atZone(wita).toInstant().toEpochMilli()
        assertEquals("a WIB time is read as WIB even where the default zone is WITA", LocalDateTime.of(2026, 10, 28, 23, 30).atZone(zone).toInstant().toEpochMilli(),
            NotificationParsers.printedTime("Transaksi 28/10/2026 23:30 WIB", postedWita, wita))
        assertNull("seconds can't hide a 12-hour time", NotificationParsers.printedTime("Transaksi 28/10/2026 05:30:15 PM", posted, zone))
        assertNull(NotificationParsers.printedTime("Transaksi 28/10/2026 05:30:15PM", posted, zone))
        assertEquals(LocalDateTime.of(2026, 10, 29, 0, 20).atZone(wita).toInstant().toEpochMilli(), NotificationParsers.printedTime("Transaksi 29/10/2026 00:20 WITA", postedWita))
    }

    @Test
    fun exitsThePhoneCausedAreToldApartFromUserAndUpdateExits() {
        assertTrue(CaptureHealth.isSystemKill(ApplicationExitInfo.REASON_OTHER, "OneKeyClean"))
        assertTrue(CaptureHealth.isSystemKill(ApplicationExitInfo.REASON_OTHER, "MemoryLimiter:AnonSwap"))
        assertTrue(CaptureHealth.isSystemKill(ApplicationExitInfo.REASON_LOW_MEMORY, null))
        assertFalse(CaptureHealth.isSystemKill(ApplicationExitInfo.REASON_USER_REQUESTED, "OneKeyClean"))
        assertFalse(CaptureHealth.isSystemKill(ApplicationExitInfo.REASON_PACKAGE_UPDATED, null))
        assertFalse(CaptureHealth.isSystemKill(ApplicationExitInfo.REASON_OTHER, "swipe"))
        assertEquals("cleaner", CaptureHealth.killLabel(ApplicationExitInfo.REASON_OTHER, "OneKeyClean"))
    }

    @Test
    fun newPaymentNoisePhrasesAreNotCaptured() {
        assertNull(NotificationParsers.parse("id.dana", "DANA", "Split bill Rp50.000 dari BUDI menunggu kamu", now))
        assertNull(NotificationParsers.parse("com.bca", "BCA", "Dana tertahan Rp100.000 untuk transaksi", now))
    }
}
