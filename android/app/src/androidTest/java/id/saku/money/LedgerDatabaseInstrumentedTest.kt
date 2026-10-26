package id.saku.money

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import net.zetetic.database.sqlcipher.SQLiteDatabase
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LedgerDatabaseInstrumentedTest {
    @Test
    fun widgetUsesMigratedSqliteRowsAndLeavesPrefsCopyUntouched() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val userId = "sqlite-instrumented-test"
        val prefs = context.getSharedPreferences("CapacitorStorage", 0)
        val oldCloud = prefs.getString("saku-cloud-state-v1", null)
        val legacy = "saku-ledger-v3-$userId"
        val oldLedger = prefs.getString(legacy, null)
        System.loadLibrary("sqlcipher")
        val db = SQLiteDatabase.openOrCreateDatabase(context.getDatabasePath("saku-ledgerSQLite.db"), "", null, null)
        try {
            db.execSQL("CREATE TABLE IF NOT EXISTS ledger_meta (user_id TEXT PRIMARY KEY, data_json TEXT NOT NULL, revision INTEGER NOT NULL, synced_revision INTEGER NOT NULL DEFAULT 0)")
            db.execSQL("CREATE TABLE IF NOT EXISTS ledger_transaction (user_id TEXT NOT NULL, transaction_id TEXT NOT NULL, position INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY (user_id, transaction_id))")
            val metadata = JSONObject().put("version", 3).put("name", "Test").put("accounts", org.json.JSONArray().put("Cash"))
                .put("pockets", org.json.JSONArray()).put("creditCards", org.json.JSONArray()).put("favorites", org.json.JSONArray())
            db.execSQL("INSERT OR REPLACE INTO ledger_meta (user_id, data_json, revision, synced_revision) VALUES (?, ?, 1, 1)", arrayOf(userId, metadata.toString()))
            db.execSQL("DELETE FROM ledger_transaction WHERE user_id = ?", arrayOf(userId))
            prefs.edit().putString("saku-cloud-state-v1", JSONObject().put("user", JSONObject().put("id", userId)).put("dirty", false).toString())
                .putString(legacy, "legacy-copy-must-survive").commit()

            assertEquals(0, WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").length())
            val id = WidgetLedger.addTransaction(context, "expense", 12_000, "Lunch", "Cash", "").getOrThrow()
            assertEquals(2L, LedgerDatabase.load(context, userId)!!.revision)
            assertEquals("Lunch", WidgetLedger.load(context)!!.ledger.getJSONArray("transactions").getJSONObject(0).getString("name"))
            assertFalse(LedgerDatabase.acknowledge(context, userId, 1))
            assertTrue(LedgerDatabase.acknowledge(context, userId, 2))
            LedgerDatabase.saveSyncBase(context, userId, 9, LedgerDatabase.load(context, userId)!!.ledger)
            LedgerDatabase.saveSyncBase(context, userId, 10, LedgerDatabase.load(context, userId)!!.ledger)
            db.rawQuery("SELECT revision, data_json FROM ledger_sync_base WHERE user_id = ?", arrayOf(userId)).use { cursor ->
                assertTrue(cursor.moveToFirst())
                assertEquals(10L, cursor.getLong(0))
                assertEquals("Lunch", JSONObject(cursor.getString(1)).getJSONArray("transactions").getJSONObject(0).getString("name"))
            }
            assertTrue(WidgetLedger.undo(context, id))
            assertEquals(0, LedgerDatabase.load(context, userId)!!.ledger.getJSONArray("transactions").length())
            assertEquals(2L, LedgerDatabase.load(context, userId)!!.syncedRevision)
            assertEquals("legacy-copy-must-survive", prefs.getString(legacy, null))
        } finally {
            db.execSQL("DELETE FROM ledger_transaction WHERE user_id = ?", arrayOf(userId))
            db.execSQL("DELETE FROM ledger_meta WHERE user_id = ?", arrayOf(userId))
            db.execSQL("CREATE TABLE IF NOT EXISTS ledger_sync_base (user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, data_json TEXT NOT NULL)")
            db.execSQL("DELETE FROM ledger_sync_base WHERE user_id = ?", arrayOf(userId))
            db.close()
            prefs.edit().apply {
                if (oldCloud == null) remove("saku-cloud-state-v1") else putString("saku-cloud-state-v1", oldCloud)
                if (oldLedger == null) remove(legacy) else putString(legacy, oldLedger)
            }.commit()
        }
    }
}
