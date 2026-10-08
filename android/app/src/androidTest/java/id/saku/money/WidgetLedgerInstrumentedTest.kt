package id.saku.money

import android.content.Context
import android.content.ContextWrapper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class WidgetLedgerInstrumentedTest {
    private lateinit var context: Context

    @Before
    fun setUp() {
        val base = ApplicationProvider.getApplicationContext<Context>()
        context = object : ContextWrapper(base) {
            override fun getSharedPreferences(name: String?, mode: Int) =
                base.getSharedPreferences("widget-test-$name", mode)
        }
        seed()
    }

    @After
    fun tearDown() {
        context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit().clear().commit()
        context.getSharedPreferences(WidgetLedger.WIDGET_STORAGE, Context.MODE_PRIVATE).edit().clear().commit()
    }

    @Test
    fun favoriteAddMarksDirtyAndExactUndoRestoresLedger() {
        val id = WidgetLedger.addFavorite(context, "coffee").getOrThrow().transactionId
        val data = WidgetLedger.load(context)!!
        assertEquals(2, data.ledger.getJSONArray("transactions").length())
        assertEquals("Coffee", data.ledger.getJSONArray("transactions").getJSONObject(1).getString("name"))
        val cloud = JSONObject(context.getSharedPreferences("CapacitorStorage", 0).getString("saku-cloud-state-v1", null)!!)
        assertTrue(cloud.getBoolean("dirty"))
        assertEquals(1, cloud.getInt("changeVersion"))
        assertTrue(WidgetLedger.revision(context) > 0)
        assertTrue(WidgetLedger.undo(context, id))
        assertFalse(WidgetLedger.undo(context, id))
        assertEquals(1, WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").length())
    }

    @Test
    fun rapidFavoriteTapsCreateOneTransactionAndKeepExactUndo() {
        val first = WidgetLedger.addFavorite(context, "coffee", 1_000).getOrThrow()
        val duplicate = WidgetLedger.addFavorite(context, "coffee", 1_200).getOrThrow()
        assertTrue(first.created)
        assertFalse(duplicate.created)
        assertEquals(first.transactionId, duplicate.transactionId)
        assertEquals(2, WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").length())
        assertTrue(WidgetLedger.undo(context, first.transactionId))
        assertEquals(1, WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").length())
        val afterUndo = WidgetLedger.revision(context)
        val afterUndoTap = WidgetLedger.addFavorite(context, "coffee", 15_999).getOrThrow()
        assertFalse(afterUndoTap.created)
        assertEquals(1, WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").length())
        assertEquals(afterUndo, WidgetLedger.revision(context))
    }

    @Test
    fun favoriteCanBeAddedAgainAfterTapGuard() {
        val first = WidgetLedger.addFavorite(context, "coffee", 1_000).getOrThrow()
        val blocked = WidgetLedger.addFavorite(context, "coffee", 15_999).getOrThrow()
        assertFalse(blocked.created)
        val later = WidgetLedger.addFavorite(context, "coffee", 16_000).getOrThrow()
        assertTrue(first.created)
        assertTrue(later.created)
        assertFalse(first.transactionId == later.transactionId)
        assertEquals(3, WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").length())
    }

    @Test
    fun cloudConflictComparisonIgnoresJsonKeyOrder() {
        assertTrue(WidgetCloudSync.sameLedger("{\"version\":3,\"transactions\":[{\"id\":\"one\",\"amount\":5000}]}", JSONObject("{\"transactions\":[{\"amount\":5000,\"id\":\"one\"}],\"version\":3}")))
        assertFalse(WidgetCloudSync.sameLedger("{\"version\":3,\"transactions\":[]}", JSONObject("{\"version\":3,\"transactions\":[{\"id\":\"one\"}]}")))
    }

    @Test
    fun cardAndUnassignedQuickExpensesKeepVersionThreeShape() {
        WidgetLedger.addTransaction(context, "expense", 25_000, "Lunch", "card-1", "").getOrThrow()
        WidgetLedger.addTransaction(context, "expense", 5_000, "Snack", "Cash", "").getOrThrow()
        val rows = WidgetLedger.load(context)!!.ledger.getJSONArray("transactions")
        assertEquals("card_purchase", rows.getJSONObject(1).getString("kind"))
        assertEquals("card-1", rows.getJSONObject(1).getString("cardId"))
        assertEquals("", rows.getJSONObject(2).getString("pocketId"))
        assertEquals(3, WidgetLedger.load(context)!!.ledger.getInt("version"))
    }

    @Test
    fun transferIsPairedAndRejectsUnavailableCash() {
        val transferId = WidgetLedger.addTransfer(context, 40_000, "Cash", "BCA").getOrThrow()
        val rows = WidgetLedger.load(context)!!.ledger.getJSONArray("transactions")
        val pair = (0 until rows.length()).map { rows.getJSONObject(it) }.filter { it.optString("transferId") == transferId }
        assertEquals(2, pair.size)
        assertEquals(setOf("expense", "income"), pair.map { it.getString("type") }.toSet())
        assertTrue(WidgetLedger.addTransfer(context, 1_000_000, "Cash", "BCA").isFailure)
        assertEquals(3, WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").length())
    }

    @Test
    fun rejectsStaleFavoriteReferencesWithoutChangingLedger() {
        val ledger = WidgetLedger.load(context)!!.ledger
        ledger.getJSONArray("favorites").getJSONObject(0).put("pocketId", "deleted-pocket")
        context.getSharedPreferences("CapacitorStorage", 0).edit().putString("saku-ledger-v3-test-user", ledger.toString()).commit()
        assertTrue(WidgetLedger.addFavorite(context, "coffee").isFailure)
        assertEquals(1, WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").length())
    }

    @Test
    fun activeUserSelectsOnlyThatUsersLedger() {
        val prefs = context.getSharedPreferences("CapacitorStorage", 0)
        val other = JSONObject(WidgetLedger.load(context)!!.ledger.toString()).put("name", "Other")
        prefs.edit()
            .putString("saku-ledger-v3-other-user", other.toString())
            .putString("saku-cloud-state-v1", JSONObject().put("user", JSONObject().put("id", "other-user")).toString())
            .commit()
        val loaded = WidgetLedger.load(context)!!
        assertEquals("other-user", loaded.userId)
        assertEquals("Other", loaded.ledger.getString("name"))
    }

    @Test
    fun snapshotIncludesCashTodayWeekAndPocketRemaining() {
        val snapshot = WidgetLedger.snapshot(context)!!
        assertEquals(100_000, snapshot.totalCash)
        assertEquals(0, snapshot.spentToday)
        assertEquals(0, snapshot.spentWeek)
        assertEquals(200_000, snapshot.pocketRemaining)
    }

    private fun seed() {
        val cloud = JSONObject().put("dirty", false).put("revision", 0).put("syncInterval", 15)
            .put("user", JSONObject().put("id", "test-user").put("name", "Tester").put("email", "test@example.com").put("hasAvatar", false))
        val ledger = JSONObject()
            .put("version", 3).put("demo", false).put("name", "Tester")
            .put("accounts", JSONArray().put("Cash").put("BCA"))
            .put("pockets", JSONArray().put(JSONObject().put("id", "food").put("name", "Food").put("color", "#15786e").put("icon", "utensils").put("budget", 200_000).put("budgets", JSONObject()).put("createdMonth", "2020-01")))
            .put("creditCards", JSONArray().put(JSONObject().put("id", "card-1").put("name", "BCA Card").put("limit", 1_000_000).put("openingDebt", 0).put("dueDay", 15)))
            .put("transactions", JSONArray().put(JSONObject().put("id", "opening").put("name", "Opening balance").put("amount", 100_000).put("type", "income").put("date", "2020-01-01").put("pocketId", "").put("account", "Cash").put("note", "").put("kind", "opening_balance")))
            .put("favorites", JSONArray().put(JSONObject().put("id", "coffee").put("name", "Coffee").put("amount", 20_000).put("type", "expense").put("pocketId", "food").put("account", "Cash")))
            .put("recurring", JSONArray()).put("pocketTransfers", JSONArray()).put("existingInstallments", JSONArray())
        context.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE).edit()
            .putString("saku-cloud-state-v1", cloud.toString())
            .putString("saku-ledger-v3-test-user", ledger.toString()).commit()
    }
}
