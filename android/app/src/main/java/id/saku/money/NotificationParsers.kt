package id.saku.money

data class ParsedNotification(val amount: Long, val direction: String, val rawMerchant: String, val balance: Long?, val occurredAt: Long)

// Deterministic parsing of bank and wallet notifications, in Indonesian or English
// (myBCA's Financial Diary writes "You received IDR 5,000.00 from …"). Anything unclear returns null and is
// simply not captured: a missed row is cheap, a wrong amount in the ledger is not.
object NotificationParsers {
    private data class AppRules(val wallet: Boolean)
    private val apps = mapOf(
        "com.bca" to AppRules(wallet = false),
        "com.bca.mybca.omni.android" to AppRules(wallet = false),
        "com.jago.digitalBanking" to AppRules(wallet = false),
        "id.co.bankbkemobile.digitalbank" to AppRules(wallet = false),
        "com.gojek.gopay" to AppRules(wallet = true),
        "com.gojek.app" to AppRules(wallet = true),
        "id.dana" to AppRules(wallet = true),
    )
    private val money = Regex("""(?i)\b(?:Rp\.?|IDR)\s?(\d[\d.,]*\d|\d)""")
    private val balanceLead = Regex("""(?i)(?<!isi\s)(?<!top\s?-?up\s)\b(?:sisa\s+)?(?:saldo|balance)(?:\s+\p{L}+){0,3}\s*(?::|adalah|menjadi|jadi)?\s*$""")
    private val unsettled = Regex("""(?i)\b(?:gagal|dibatalkan|batal|expired|kedaluwarsa|kadaluarsa|ditolak|tertunda|pending|menunggu|sedang\s+diproses|diproses|failed|declined)\b""")
    private val notATransaction = Regex("""(?i)\b(?:otp|kode\s+verifikasi|promo|diskon|voucher|hingga|s\.?d\.?|dapatkan|nikmati|tagihan\s+akan|jatuh\s+tempo|limit|pengingat)\b""")
    private val incoming = Regex("""(?i)\b(?:masuk|diterima|menerima|kamu\s+terima|anda\s+terima|kredit|refund|pengembalian|cashback\s+(?:diterima|masuk)|uang\s+dari|dana\s+dari|kiriman\s+dari|received|credited|refunded|incoming)\b""")
    private val topUp = Regex("""(?i)\b(?:top\s?-?up|isi\s+saldo)\b""")
    private val outgoing = Regex("""(?i)\b(?:pembayaran|bayar|dibayar|pembelian|beli|transfer|kirim|dikirim|debit|qris|tarik\s+tunai|transaksi|keluar|paid|payment|purchase|transaction|sent|spent|spending|debited|transferred)\b""")
    private val cancelled = Regex("""(?i)\b(?:cancell?ed|reversed)\b""")
    private val merchantLead = Regex("""(?i)\b(?:di|ke|kepada|dari|untuk|at|to|from)\s+([^.,!\n]+)""")
    private val merchantStop = Regex("""(?i)\s+(?:(?:rp\.?|idr)\s?\d|at\s+[^.]*\bcategory\b|(?:sebesar|senilai|pada|tgl|tanggal|berhasil|sukses|telah|sudah|dengan|pakai|via|menggunakan|ref|no\.?|ke\s+(?:rekening|akun|saldo|nomor|kamu|anda|kantong))\b).*$""")
    private val notAName = Regex("""(?i)^(?:rekening|akun|saldo|nomor|rp|idr|kamu|anda)\b""")
    private val topUpTarget = Regex("""(?i)\b(?:top\s?-?up|isi\s+saldo)\s+(?!rp|idr|\d|berhasil|sukses|sebesar|senilai)([^.,!\n]+)""")

    // Same accepted shapes as wholeRupiah in worker/import-ai.js.
    fun wholeRupiah(printed: String): Long? {
        val value = printed.trim()
        val digits = when {
            Regex("""\d+(?:,00)?""").matches(value) -> value.removeSuffix(",00")
            Regex("""\d{1,3}(?:\.\d{3})+(?:,00)?""").matches(value) -> value.removeSuffix(",00").replace(".", "")
            Regex("""\d{1,3}(?:,\d{3})+\.00""").matches(value) -> value.removeSuffix(".00").replace(",", "")
            else -> return null
        }
        return digits.toLongOrNull()?.takeIf { it in 1..1_000_000_000_000 }
    }

    // myBCA prints English amounts with sen ("IDR 1.00", "IDR 10,351,117.99"); Saku keeps whole rupiah, rounded.
    fun idrWithSen(printed: String): Long? {
        if (!Regex("""\d{1,3}(?:,\d{3})*\.\d{2}""").matches(printed)) return null
        val (rupiah, sen) = printed.replace(",", "").split(".")
        return (rupiah.toLong() + if (sen.toInt() >= 50) 1 else 0).takeIf { it in 1..1_000_000_000_000 }
    }

    private fun message(title: String, text: String) = "$title. $text".replace(Regex("""\s+"""), " ").trim()

    // The single transaction amount and an optional balance, or null when the amounts are unclear.
    private fun amounts(message: String): Pair<Long, Long?>? {
        var balance: Long? = null
        val amounts = mutableListOf<Long>()
        for (match in money.findAll(message)) {
            val printed = match.groupValues[1].trimEnd('.', ',')
            val value = (if (match.value.startsWith("IDR", ignoreCase = true)) idrWithSen(printed) else null) ?: wholeRupiah(printed) ?: return null
            if (balanceLead.containsMatchIn(message.substring(0, match.range.first))) {
                if (balance != null) return null
                balance = value
            } else amounts += value
        }
        return (amounts.distinct().singleOrNull() ?: return null) to balance
    }

    // "Spending of IDR 61,160.00 … was cancelled": the amount of an earlier spend that no longer happened.
    fun cancelledSpend(packageName: String, title: String, text: String): Long? {
        if (packageName !in apps) return null
        val message = message(title, text)
        if (!cancelled.containsMatchIn(message) || notATransaction.containsMatchIn(message) || incoming.containsMatchIn(message)) return null
        return amounts(message)?.first
    }

    fun parse(packageName: String, title: String, text: String, postedAt: Long): ParsedNotification? {
        val rules = apps[packageName] ?: return null
        val message = message(title, text)
        if (unsettled.containsMatchIn(message) || cancelled.containsMatchIn(message) || notATransaction.containsMatchIn(message)) return null
        val (amount, balance) = amounts(message) ?: return null
        val direction = when {
            topUp.containsMatchIn(message) -> if (rules.wallet) "income" else "expense"
            incoming.containsMatchIn(message) && !Regex("""(?i)\b(?:transfer|kirim)\s+ke\b|\b(?:sent|transferred|paid)\b""").containsMatchIn(message) -> "income"
            outgoing.containsMatchIn(message) -> "expense"
            else -> return null
        }
        return ParsedNotification(amount, direction, merchant(message), balance, postedAt)
    }

    private fun merchant(message: String): String {
        val body = message.replace(Regex("""(?i)(?<!isi\s)\b(?:sisa\s+)?saldo\b.*$"""), "")
        val clean = { value: String -> value.replace(merchantStop, "").trim().trimEnd('.', ',', '!').replace(Regex("""(?i)\s+category$"""), "") }
        val raw = topUpTarget.find(body)?.groupValues?.get(1)?.let(clean)
            ?: merchantLead.findAll(body).map { clean(it.groupValues[1]) }.firstOrNull { it.isNotEmpty() && !it.first().isDigit() && !notAName.containsMatchIn(it) }
        return raw?.take(60).orEmpty()
    }
}
