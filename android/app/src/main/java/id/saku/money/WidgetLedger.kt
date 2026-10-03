package id.saku.money

import android.content.Context
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.YearMonth
import java.util.UUID

data class WidgetFavorite(val id: String, val name: String, val amount: Long)
data class WidgetFavoriteAdd(val transactionId: String, val created: Boolean)
data class WidgetSnapshot(val totalCash: Long, val spentToday: Long, val spentWeek: Long, val pocketRemaining: Long)
data class WidgetChoice(val id: String, val name: String)
data class WidgetData(
    val userId: String,
    val ledger: JSONObject,
    val accounts: List<String>,
    val pockets: List<WidgetChoice>,
    val cards: List<WidgetChoice>,
)

object WidgetLedger {
    private const val CAPACITOR_STORAGE = "CapacitorStorage"
    private const val CLOUD_KEY = "saku-cloud-state-v1"
    const val WIDGET_STORAGE = "SakuWidgets"
    const val REVISION_KEY = "ledgerRevision"
    private const val MAX_AMOUNT = 1_000_000_000_000L
    private const val FAVORITE_TAP_GUARD_MS = 1_500L

    private fun capacitor(context: Context) = context.getSharedPreferences(CAPACITOR_STORAGE, Context.MODE_PRIVATE)
    fun widgetPreferences(context: Context) = context.getSharedPreferences(WIDGET_STORAGE, Context.MODE_PRIVATE)

    @Synchronized
    fun load(context: Context): WidgetData? {
        val prefs = capacitor(context)
        val cloud = prefs.getString(CLOUD_KEY, null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
        val userId = cloud.optJSONObject("user")?.optString("id").orEmpty()
        if (userId.isBlank()) return null
        val ledger = prefs.getString("saku-ledger-v3-$userId", null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: return null
        if (ledger.optInt("version") != 3) return null
        return WidgetData(
            userId,
            ledger,
            strings(ledger.optJSONArray("accounts")),
            choices(ledger.optJSONArray("pockets")),
            choices(ledger.optJSONArray("creditCards")),
        )
    }

    fun favorites(context: Context): List<WidgetFavorite> {
        val data = load(context) ?: return emptyList()
        val rows = data.ledger.optJSONArray("favorites") ?: return emptyList()
        return buildList {
            for (index in 0 until rows.length()) {
                val row = rows.optJSONObject(index) ?: continue
                val amount = wholeAmount(row.opt("amount")) ?: continue
                val id = row.optString("id")
                val name = row.optString("name").trim()
                if (id.isNotBlank() && name.isNotBlank()) add(WidgetFavorite(id, name, amount))
            }
        }
    }

    @Synchronized
    fun addFavorite(context: Context, favoriteId: String, nowMs: Long = SystemClock.elapsedRealtime()): Result<WidgetFavoriteAdd> = runCatching {
        val data = load(context) ?: error("Open Saku to sign in")
        val favorite = find(data.ledger.optJSONArray("favorites"), favoriteId) ?: error("Favorite is no longer available")
        val guardKey = "${data.userId}:$favoriteId"
        val widgetPrefs = widgetPreferences(context)
        val previousAt = widgetPrefs.getLong("favoriteAt:$guardKey", Long.MIN_VALUE)
        val previousId = widgetPrefs.getString("favoriteId:$guardKey", "").orEmpty()
        if (previousAt >= 0 && nowMs >= previousAt && nowMs - previousAt < FAVORITE_TAP_GUARD_MS && find(data.ledger.optJSONArray("transactions"), previousId) != null) {
            return@runCatching WidgetFavoriteAdd(previousId, false)
        }
        val amount = wholeAmount(favorite.opt("amount")) ?: error("Favorite amount is invalid")
        require(amount > 0) { "Favorite amount is invalid" }
        val name = favorite.optString("name").trim()
        require(name.isNotBlank() && name.length <= 100) { "Favorite name is invalid" }
        val type = favorite.optString("type")
        require(type == "expense" || type == "income") { "Favorite direction is invalid" }
        val cardId = favorite.optString("cardId")
        val account = favorite.optString("account")
        val pocketId = if (type == "expense") favorite.optString("pocketId") else ""
        if (cardId.isNotBlank()) {
            val card = find(data.ledger.optJSONArray("creditCards"), cardId)
            require(type == "expense" && card != null && card.optString("name") == account) { "Favorite card is no longer available" }
        }
        else require(data.accounts.contains(account)) { "Favorite account is no longer available" }
        if (pocketId.isNotBlank()) require(find(data.ledger.optJSONArray("pockets"), pocketId) != null) { "Favorite pocket is no longer available" }
        val id = UUID.randomUUID().toString()
        val transaction = JSONObject()
            .put("id", id).put("name", name).put("amount", amount)
            .put("type", type).put("date", LocalDate.now().toString()).put("pocketId", pocketId)
            .put("account", account).put("note", "").put("verified", false)
        if (cardId.isNotBlank()) {
            transaction.put("kind", "card_purchase").put("cardId", cardId).put("installments", 1)
                .put("firstDueMonth", YearMonth.now().plusMonths(1).toString())
        }
        appendAndSave(context, data, listOf(transaction))
        check(widgetPrefs.edit().putLong("favoriteAt:$guardKey", nowMs).putString("favoriteId:$guardKey", id).commit())
        WidgetFavoriteAdd(id, true)
    }

    @Synchronized
    fun addTransaction(context: Context, mode: String, amount: Long, name: String, paymentId: String, pocketId: String): Result<String> = runCatching {
        require(amount in 1..MAX_AMOUNT) { "Enter a whole rupiah amount greater than zero" }
        val data = load(context) ?: error("Open Saku to sign in")
        require(mode == "expense" || mode == "income") { "Transaction direction is invalid" }
        val card = data.cards.find { it.id == paymentId }
        val account = if (card != null) card.name else paymentId
        if (card == null) require(data.accounts.contains(account)) { "Choose a valid account" }
        if (mode == "expense" && pocketId.isNotBlank()) require(data.pockets.any { it.id == pocketId }) { "Choose a valid pocket" }
        val label = name.trim().ifBlank {
            if (mode == "income") "Quick income" else data.pockets.find { it.id == pocketId }?.name ?: "Quick expense"
        }
        require(label.length <= 100) { "Description must be 100 characters or fewer" }
        val id = UUID.randomUUID().toString()
        val row = JSONObject().put("id", id).put("name", label).put("amount", amount).put("type", mode)
            .put("date", LocalDate.now().toString()).put("pocketId", if (mode == "income") "" else pocketId)
            .put("account", account).put("note", "").put("verified", false)
        if (mode == "expense" && card != null) row.put("kind", "card_purchase").put("cardId", card.id)
            .put("installments", 1).put("firstDueMonth", YearMonth.now().plusMonths(1).toString())
        appendAndSave(context, data, listOf(row))
        id
    }

    @Synchronized
    fun addTransfer(context: Context, amount: Long, from: String, to: String): Result<String> = runCatching {
        require(amount in 1..MAX_AMOUNT) { "Enter a whole rupiah amount greater than zero" }
        val data = load(context) ?: error("Open Saku to sign in")
        require(from != to && data.accounts.contains(from) && data.accounts.contains(to)) { "Choose two different accounts" }
        require(accountBalance(data.ledger, from) >= amount) { "The source account does not have enough money" }
        val transferId = UUID.randomUUID().toString()
        val date = LocalDate.now().toString()
        val outgoing = JSONObject().put("id", UUID.randomUUID().toString()).put("transferId", transferId)
            .put("kind", "account_transfer").put("name", "Transfer to $to").put("amount", amount)
            .put("type", "expense").put("date", date).put("pocketId", "").put("account", from)
            .put("note", "").put("verified", false)
        val incoming = JSONObject().put("id", UUID.randomUUID().toString()).put("transferId", transferId)
            .put("kind", "account_transfer").put("name", "Transfer from $from").put("amount", amount)
            .put("type", "income").put("date", date).put("pocketId", "").put("account", to)
            .put("note", "").put("verified", false)
        appendAndSave(context, data, listOf(outgoing, incoming))
        transferId
    }

    @Synchronized
    fun undo(context: Context, transactionId: String): Boolean {
        val data = load(context) ?: return false
        val rows = data.ledger.optJSONArray("transactions") ?: return false
        val kept = JSONArray()
        var removed = false
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            if (row.optString("id") == transactionId) removed = true else kept.put(row)
        }
        if (!removed) return false
        data.ledger.put("transactions", kept)
        save(context, data)
        return true
    }

    fun snapshot(context: Context): WidgetSnapshot? {
        val data = load(context) ?: return null
        val today = LocalDate.now()
        val weekStart = today.minusDays(6)
        val month = YearMonth.from(today).toString()
        val rows = data.ledger.optJSONArray("transactions") ?: JSONArray()
        var totalCash = 0L
        var spentToday = 0L
        var spentWeek = 0L
        val pocketSpent = mutableMapOf<String, Long>()
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            val amount = wholeAmount(row.opt("amount")) ?: continue
            val type = row.optString("type")
            val kind = row.optString("kind")
            if (kind != "card_purchase") totalCash += if (type == "income") amount else -amount
            if (type != "expense" || kind == "card_payment" || kind == "account_transfer") continue
            val personal = wholeAmount(row.optJSONObject("split")?.opt("ownAmount")) ?: amount
            val date = runCatching { LocalDate.parse(row.optString("date")) }.getOrNull() ?: continue
            if (date == today) spentToday += personal
            if (!date.isBefore(weekStart) && !date.isAfter(today)) spentWeek += personal
            if (YearMonth.from(date).toString() == month) {
                val pocketId = row.optString("pocketId")
                pocketSpent[pocketId] = (pocketSpent[pocketId] ?: 0) + personal
            }
        }
        val moves = mutableMapOf<String, Long>()
        val transfers = data.ledger.optJSONArray("pocketTransfers") ?: JSONArray()
        for (index in 0 until transfers.length()) {
            val move = transfers.optJSONObject(index) ?: continue
            if (move.optString("month") != month) continue
            val amount = wholeAmount(move.opt("amount")) ?: continue
            val from = move.optString("fromPocketId"); val to = move.optString("toPocketId")
            moves[from] = (moves[from] ?: 0) - amount; moves[to] = (moves[to] ?: 0) + amount
        }
        var remaining = 0L
        val pockets = data.ledger.optJSONArray("pockets") ?: JSONArray()
        for (index in 0 until pockets.length()) {
            val pocket = pockets.optJSONObject(index) ?: continue
            if (pocket.optString("createdMonth") > month) continue
            val budget = wholeAmount(pocket.optJSONObject("budgets")?.opt(month)) ?: wholeAmount(pocket.opt("budget")) ?: 0
            val id = pocket.optString("id")
            remaining += (budget + (moves[id] ?: 0) - (pocketSpent[id] ?: 0)).coerceAtLeast(0)
        }
        return WidgetSnapshot(totalCash, spentToday, spentWeek, remaining)
    }

    fun revision(context: Context) = widgetPreferences(context).getLong(REVISION_KEY, 0L)

    private fun appendAndSave(context: Context, data: WidgetData, rows: List<JSONObject>) {
        val transactions = data.ledger.optJSONArray("transactions") ?: JSONArray().also { data.ledger.put("transactions", it) }
        require(transactions.length() + rows.size <= 100_000) { "Transaction limit reached" }
        rows.forEach(transactions::put)
        save(context, data)
    }

    private fun save(context: Context, data: WidgetData) {
        val prefs = capacitor(context)
        val cloud = prefs.getString(CLOUD_KEY, null)?.let(::JSONObject) ?: error("Open Saku to sign in")
        cloud.put("dirty", true).put("changeVersion", cloud.optLong("changeVersion", 0) + 1)
        check(prefs.edit().putString("saku-ledger-v3-${data.userId}", data.ledger.toString()).putString(CLOUD_KEY, cloud.toString()).commit())
        val widgetPrefs = widgetPreferences(context)
        widgetPrefs.edit().putLong(REVISION_KEY, widgetPrefs.getLong(REVISION_KEY, 0L) + 1).apply()
        WidgetCloudSync.schedule(context)
    }

    private fun accountBalance(ledger: JSONObject, account: String): Long {
        val rows = ledger.optJSONArray("transactions") ?: return 0
        var balance = 0L
        for (index in 0 until rows.length()) {
            val row = rows.optJSONObject(index) ?: continue
            if (row.optString("account") != account || row.optString("kind") == "card_purchase") continue
            val amount = wholeAmount(row.opt("amount")) ?: continue
            balance += if (row.optString("type") == "income") amount else -amount
        }
        return balance
    }

    private fun strings(rows: JSONArray?) = buildList {
        if (rows != null) for (index in 0 until rows.length()) rows.optString(index).takeIf(String::isNotBlank)?.let(::add)
    }
    private fun choices(rows: JSONArray?) = buildList {
        if (rows != null) for (index in 0 until rows.length()) rows.optJSONObject(index)?.let {
            val id = it.optString("id"); val name = it.optString("name")
            if (id.isNotBlank() && name.isNotBlank()) add(WidgetChoice(id, name))
        }
    }
    private fun find(rows: JSONArray?, id: String): JSONObject? {
        if (rows != null) for (index in 0 until rows.length()) rows.optJSONObject(index)?.takeIf { it.optString("id") == id }?.let { return it }
        return null
    }
    private fun wholeAmount(value: Any?): Long? = when (value) {
        is Int -> value.toLong()
        is Long -> value
        is Double -> if (value.isFinite() && value % 1.0 == 0.0) value.toLong() else null
        is Number -> value.toLong()
        else -> null
    }?.takeIf { it in 0..MAX_AMOUNT }
}
