package id.saku.money

import org.json.JSONArray
import org.json.JSONObject

// Uses the same app-owned columns and bounded changes as src/sheetMirror.ts.
object WidgetSheetMirror {
    // Android escapes '/' in JSON; JavaScript does not. Keep cells and byte
    // boundaries identical so another device can resume the same batch cursor.
    fun json(value: Any) = value.toString().replace("\\/", "/")
    private val columns = linkedMapOf(
        "Transactions" to ("transactions" to "id date description direction amount_idr account pocket_id note verified kind card_id installments first_due_month recurring_rule_id occurrence_month split for_transaction_id transfer_id"),
        "Pockets" to ("pockets" to "id name color icon default_budget_idr monthly_budgets created_month"),
        "Accounts" to ("accounts" to "name"),
        "Cards" to ("creditCards" to "id name limit_idr opening_debt_idr due_day"),
        "Recurring" to ("recurring" to "id name direction amount_idr pocket_id account card_id installments skipped_months day start_month active"),
        "Quick_entries" to ("favorites" to "id name direction amount_idr pocket_id account card_id"),
        "Pocket_transfers" to ("pocketTransfers" to "id month from_pocket_id to_pocket_id amount_idr"),
        "Existing_installments" to ("existingInstallments" to "id card_id description monthly_amount_idr next_due_month payments_left")
    )
    private val fields = mapOf(
        "Transactions" to "id date name type amount account pocketId note verified kind cardId installments firstDueMonth recurringRuleId occurrenceMonth split forTransactionId transferId",
        "Pockets" to "id name color icon budget budgets createdMonth", "Cards" to "id name limit openingDebt dueDay",
        "Recurring" to "id name type amount pocketId account cardId installments skippedMonths day startMonth active",
        "Quick_entries" to "id name type amount pocketId account cardId", "Pocket_transfers" to "id month fromPocketId toPocketId amount",
        "Existing_installments" to "id cardId name monthlyAmount nextDueMonth paymentsLeft"
    )

    private fun cell(value: Any?): String {
        if (value == null || value == JSONObject.NULL) return ""
        val text = if (value is Number && value.toDouble() == value.toLong().toDouble()) value.toLong().toString() else if (value is JSONObject || value is JSONArray) json(value) else value.toString()
        return if (text.firstOrNull() in listOf('=', '+', '-', '@')) "'$text" else text
    }

    fun tables(data: JSONObject): Map<String, List<List<String>>> = columns.mapValues { (name, spec) ->
        val headers = spec.second.split(" ")
        val rows = data.optJSONArray(spec.first) ?: JSONArray()
        listOf(headers) + (0 until rows.length()).map { index ->
            if (name == "Accounts") listOf(cell(rows.opt(index))) else {
                val row = rows.getJSONObject(index)
                fields.getValue(name).split(" ").map { field -> cell(if (field == "verified") row.opt(field) ?: false else row.opt(field)) }
            }
        }
    }

    fun plan(previous: JSONObject?, current: JSONObject): Pair<List<JSONObject>, JSONObject> {
        val old = previous?.let(::tables) ?: emptyMap()
        val changes = mutableListOf<JSONObject>()
        val grid = JSONObject()
        for ((name, afterRows) in tables(current)) {
            val beforeRows = old[name].orEmpty()
            val width = afterRows[0].size
            val blank = List(width) { "" }
            grid.put(name, maxOf(afterRows.size, beforeRows.size))
            var start = 1
            var bytes = 0
            var before = JSONArray()
            var after = JSONArray()
            fun flush() {
                if (after.length() == 0) return
                changes.add(JSONObject().put("range", "'$name'!A$start:${('A'.code + width - 1).toChar()}${start + after.length() - 1}").put("before", before).put("after", after))
                start += after.length(); before = JSONArray(); after = JSONArray(); bytes = 0
            }
            for (index in 0 until maxOf(beforeRows.size, afterRows.size)) {
                val oldRow = beforeRows.getOrElse(index) { blank }
                val newRow = afterRows.getOrElse(index) { blank }
                if (oldRow == newRow) { flush(); start++; continue }
                val size = json(JSONObject().put("before", JSONArray(oldRow)).put("after", JSONArray(newRow))).toByteArray(Charsets.UTF_8).size
                require(size <= 110_000) { "A $name row is too large for Google Sheets" }
                if (after.length() >= 64 || bytes + size > 110_000) flush()
                before.put(JSONArray(oldRow)); after.put(JSONArray(newRow)); bytes += size
            }
            flush()
        }
        return changes to grid
    }
}
