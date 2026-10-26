package id.saku.money

import android.content.Context
import net.zetetic.database.sqlcipher.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject

/** The same unencrypted database opened by @capacitor-community/sqlite. */
object LedgerDatabase {
    private const val NAME = "saku-ledgerSQLite.db"
    data class Snapshot(val ledger: JSONObject, val revision: Long, val syncedRevision: Long)
    init { System.loadLibrary("sqlcipher") }

    private fun open(context: Context): SQLiteDatabase? {
        val file = context.getDatabasePath(NAME)
        if (!file.exists()) return null
        return SQLiteDatabase.openOrCreateDatabase(file, "", null, null)
    }

    fun load(context: Context, userId: String): Snapshot? {
        val db = open(context) ?: return null
        return db.use dbUse@ {
            val head = db.rawQuery("SELECT data_json, revision, synced_revision FROM ledger_meta WHERE user_id = ?", arrayOf(userId)).use cursorUse@ { cursor ->
                if (!cursor.moveToFirst()) return@cursorUse null
                Triple(cursor.getString(0), cursor.getLong(1), cursor.getLong(2))
            } ?: return@dbUse null
            val ledger = JSONObject(head.first)
            val rows = JSONArray()
            db.rawQuery("SELECT payload FROM ledger_transaction WHERE user_id = ? ORDER BY position", arrayOf(userId)).use { cursor ->
                while (cursor.moveToNext()) rows.put(JSONObject(cursor.getString(0)))
            }
            ledger.put("transactions", rows)
            Snapshot(ledger, head.second, head.third)
        }
    }

    fun acknowledge(context: Context, userId: String, revision: Long): Boolean {
        val db = open(context) ?: return false
        return db.use {
            db.execSQL("UPDATE ledger_meta SET synced_revision = ? WHERE user_id = ? AND revision = ?", arrayOf<Any>(revision, userId, revision))
            db.rawQuery("SELECT revision, synced_revision FROM ledger_meta WHERE user_id = ?", arrayOf(userId)).use { cursor ->
                cursor.moveToFirst() && cursor.getLong(0) == revision && cursor.getLong(1) == revision
            }
        }
    }

    fun save(context: Context, userId: String, ledger: JSONObject, expectedRevision: Long) {
        val db = open(context) ?: error("Open Saku to finish storage migration")
        db.use {
            db.beginTransaction()
            try {
                val current = db.rawQuery("SELECT revision FROM ledger_meta WHERE user_id = ?", arrayOf(userId)).use { cursor ->
                    if (cursor.moveToFirst()) cursor.getLong(0) else null
                }
                check(current == expectedRevision) { "Ledger changed on this device. Try again." }
                val transactions = ledger.getJSONArray("transactions")
                val ids = mutableSetOf<String>()
                for (index in 0 until transactions.length()) {
                    val row = transactions.getJSONObject(index)
                    val id = row.getString("id")
                    check(ids.add(id)) { "Duplicate transaction ID" }
                    db.execSQL("INSERT INTO ledger_transaction (user_id, transaction_id, position, payload) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, transaction_id) DO UPDATE SET position = excluded.position, payload = excluded.payload", arrayOf<Any>(userId, id, index, row.toString()))
                }
                val stale = mutableListOf<String>()
                db.rawQuery("SELECT transaction_id FROM ledger_transaction WHERE user_id = ?", arrayOf(userId)).use { cursor ->
                    while (cursor.moveToNext()) {
                        val id = cursor.getString(0)
                        if (!ids.contains(id)) stale.add(id)
                    }
                }
                stale.forEach { id -> db.execSQL("DELETE FROM ledger_transaction WHERE user_id = ? AND transaction_id = ?", arrayOf(userId, id)) }
                db.execSQL("UPDATE ledger_meta SET revision = revision + 1 WHERE user_id = ?", arrayOf(userId))
                db.setTransactionSuccessful()
            } finally { db.endTransaction() }
        }
    }
}
