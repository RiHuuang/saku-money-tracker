package id.saku.money

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationParsersTest {
    private val postedAt = 1_793_000_000_000L

    @Test
    fun everyFixtureParsesAsExpected() {
        val failures = mutableListOf<String>()
        for (app in listOf("bca", "jago", "gopay", "seabank", "dana")) {
            val fixture = JSONObject(javaClass.getResource("/notifications/$app.json")!!.readText())
            val cases = fixture.getJSONArray("cases")
            assertTrue("$app needs at least 8 fixtures", cases.length() >= 8)
            for (index in 0 until cases.length()) {
                val case = cases.getJSONObject(index)
                val parsed = NotificationParsers.parse(fixture.getString("packageName"), case.getString("title"), case.getString("text"), postedAt)
                val expected = case.optJSONObject("expected")
                val actual = parsed?.let { "${it.amount}|${it.direction}|${it.rawMerchant}|${it.balance}" }
                val wanted = expected?.let { "${it.getLong("amount")}|${it.getString("direction")}|${it.getString("rawMerchant")}|${if (it.isNull("balance")) null else it.getLong("balance")}" }
                if (actual != wanted) failures += "$app #$index: expected $wanted, got $actual (${case.getString("text")})"
                if (parsed != null) assertEquals(postedAt, parsed.occurredAt)
            }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    @Test
    fun amountsFollowTheStatementImportRules() {
        assertEquals(25000L, NotificationParsers.wholeRupiah("25.000"))
        assertEquals(25000L, NotificationParsers.wholeRupiah("25.000,00"))
        assertEquals(25000L, NotificationParsers.wholeRupiah("25,000.00"))
        assertEquals(25000L, NotificationParsers.wholeRupiah("25000"))
        assertNull(NotificationParsers.wholeRupiah("25,000"))
        assertNull(NotificationParsers.wholeRupiah("25.00"))
        assertNull(NotificationParsers.wholeRupiah("2.5"))
    }

    @Test
    fun unknownAppsAndAmbiguousAmountsReturnNull() {
        assertNull(NotificationParsers.parse("com.example.chat", "Chat", "Transfer Rp10.000 ke Ani", postedAt))
        assertNull(NotificationParsers.parse("com.bca", "BCA", "Transfer Rp10.000 ke Ani dan Rp20.000 ke Budi", postedAt))
        assertNull(NotificationParsers.parse("com.bca", "BCA", "Transfer Rp25,000 ke Ani", postedAt))
    }
}
