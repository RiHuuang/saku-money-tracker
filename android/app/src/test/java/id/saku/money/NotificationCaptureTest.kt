package id.saku.money

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationCaptureTest {
    private var reads = 0
    private fun capture(packageName: String, allowlist: NotificationCapture.Allowlist) =
        NotificationCapture.readIfAdmitted(packageName, allowlist) { account -> reads++; account }

    @Test
    fun unlistedAppsAreNeverRead() {
        val onlyBca = NotificationCapture.Allowlist(mapOf("com.bca" to "BCA"), paused = false)
        assertNull(capture("com.example.chat", onlyBca))
        assertNull(capture("id.dana", onlyBca))
        assertEquals(0, reads)
        assertEquals("BCA", capture("com.bca", onlyBca))
        assertEquals(1, reads)
    }

    @Test
    fun pauseStopsReadingImmediately() {
        assertNull(capture("com.bca", NotificationCapture.Allowlist(mapOf("com.bca" to "BCA"), paused = true)))
        assertEquals(0, reads)
    }

    @Test
    fun onlyKnownAppsWithAnAccountAreAdmitted() {
        assertNull(capture("com.example.fake", NotificationCapture.Allowlist(mapOf("com.example.fake" to "BCA"), paused = false)))
        assertNull(capture("com.bca", NotificationCapture.Allowlist(mapOf("com.bca" to " "), paused = false)))
        assertEquals(0, reads)
    }
}
