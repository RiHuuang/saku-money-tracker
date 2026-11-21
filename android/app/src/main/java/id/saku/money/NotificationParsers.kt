package id.saku.money

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId

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
    private val notATransaction = Regex("""(?i)\b(?:otp|kode\s+verifikasi|promo|diskon|voucher|hingga|s\.?d\.?|dapatkan|nikmati|tagihan\s+akan|jatuh\s+tempo|limit|pengingat|split\s+bill|dana\s+tertahan|pop-?up\s+awareness)\b""")
    private val incoming = Regex("""(?i)\b(?:masuk|diterima|menerima|kamu\s+terima|anda\s+terima|kredit|refund|pengembalian|cashback\s+(?:diterima|masuk)|uang\s+dari|dana\s+dari|kiriman\s+dari|received|credited|refunded|incoming)\b""")
    private val topUp = Regex("""(?i)\b(?:top\s?-?up|isi\s+saldo)\b""")
    private val outgoing = Regex("""(?i)\b(?:pembayaran|bayar|dibayar|pembelian|beli|transfer|kirim|dikirim|debit|qris|tarik\s+tunai|transaksi|keluar|paid|payment|purchase|transaction|sent|spent|spending|debited|transferred)\b""")
    private val cancelled = Regex("""(?i)\b(?:cancell?ed|reversed)\b""")
    private val merchantLead = Regex("""(?i)\b(?:di|ke|kepada|dari|untuk|at|to|from)\s+([^.,!\n]+)""")
    private val merchantStop = Regex("""(?i)\s+(?:(?:rp\.?|idr)\s?\d|at\s+[^.]*\bcategory\b|di\s+kategori\b|(?:sebesar|senilai|pada|tgl|tanggal|berhasil|sukses|telah|sudah|dengan|pakai|via|menggunakan|ref|no\.?|ke\s+(?:rekening|akun|saldo|nomor|kamu|anda|kantong))\b).*$""")
    private val notAName = Regex("""(?i)^(?:rekening|akun|saldo|nomor|rp|idr|kamu|anda)\b""")
    private val topUpTarget = Regex("""(?i)\b(?:top\s?-?up|isi\s+saldo)\s+(?!rp|idr|\d|berhasil|sukses|sebesar|senilai)([^.,!\n]+)""")

    // Stricter than wholeRupiah in worker/import-ai.js, which also accepts OCR-flipped marks (42.940.00): notification text is never OCR'd.
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
    private fun rulesFor(packageName: String) = apps[packageName] ?: if (BuildConfig.DEBUG && packageName == NotificationCapture.DEBUG_SHELL) AppRules(wallet = false) else null

    fun cancelledSpend(packageName: String, title: String, text: String): Long? {
        if (rulesFor(packageName) == null) return null
        val message = message(title, text)
        if (!cancelled.containsMatchIn(message) || notATransaction.containsMatchIn(message) || incoming.containsMatchIn(message)) return null
        return amounts(message)?.first
    }

    fun parse(packageName: String, title: String, text: String, postedAt: Long): ParsedNotification? {
        val rules = rulesFor(packageName) ?: return null
        val message = message(title, text)
        if (unsettled.containsMatchIn(message) || cancelled.containsMatchIn(message) || notATransaction.containsMatchIn(message)) return null
        val (amount, balance) = amounts(message) ?: return null
        val direction = when {
            topUp.containsMatchIn(message) -> if (rules.wallet) "income" else "expense"
            incoming.containsMatchIn(message) && !Regex("""(?i)\b(?:transfer|kirim)\s+ke\b|\b(?:sent|transferred|paid)\b""").containsMatchIn(message) -> "income"
            outgoing.containsMatchIn(message) -> "expense"
            else -> return null
        }
        return ParsedNotification(amount, direction, merchant(message), balance, printedTime(message, postedAt) ?: postedAt)
    }

    private val months = mapOf("jan" to 1, "feb" to 2, "peb" to 2, "mar" to 3, "apr" to 4, "mei" to 5, "may" to 5, "jun" to 6, "jul" to 7, "agu" to 8, "agt" to 8, "aug" to 8,
        "sep" to 9, "okt" to 10, "oct" to 10, "nov" to 11, "nop" to 11, "des" to 12, "dec" to 12)
    private val numericStamp = Regex("""\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\D{1,12}?(\d{1,2})[:.](\d{2})(?::\d{2})?\b(?!\s*[AaPp]\.?[Mm]\b)""")
    private val isoStamp = Regex("""\b(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?\b(?!\s*[AaPp]\.?[Mm]\b)""")
    private val wordStamp = Regex("""(?i)\b(\d{1,2})\s+(\p{L}{3})\p{L}*\s+(\d{4})\D{1,12}?(\d{1,2})[:.](\d{2})(?::\d{2})?\b(?!\s*[AaPp]\.?[Mm]\b)""")

    // A time the bank printed, used only with a full date that falls between 36 hours before and 5 minutes after
    // the post time. Anything else (a due date, a time with no date) is ignored and the post time is kept.
    // Indonesian banks print local time with its zone (WIB, WITA, WIT); without one, WIB. Never the phone's zone.
    private fun zoneOf(message: String, fallback: ZoneId): ZoneId = when {
        Regex("""\bWITA\b""").containsMatchIn(message) -> ZoneId.of("Asia/Makassar")
        Regex("""\bWIT\b""").containsMatchIn(message) -> ZoneId.of("Asia/Jayapura")
        Regex("""\bWIB\b""").containsMatchIn(message) -> ZoneId.of("Asia/Jakarta")
        else -> fallback
    }

    fun printedTime(message: String, postedAt: Long, defaultZone: ZoneId = ZoneId.of("Asia/Jakarta")): Long? {
        val zone = zoneOf(message, defaultZone)
        val stamp = isoStamp.find(message)?.groupValues?.let { g -> listOf(g[1], g[2], g[3], g[4], g[5]).map(String::toInt) }
            ?: numericStamp.find(message)?.groupValues?.let { g -> listOf(g[3], g[2], g[1], g[4], g[5]).map(String::toInt) }
            ?: wordStamp.find(message)?.groupValues?.let { g -> months[g[2].lowercase().take(3)]?.let { listOf(g[3].toInt(), it, g[1].toInt(), g[4].toInt(), g[5].toInt()) } }
            ?: return null
        val (year, month, day, hour, minute) = stamp
        val at = runCatching { LocalDateTime.of(LocalDate.of(year, month, day), LocalTime.of(hour, minute)).atZone(zone).toInstant().toEpochMilli() }.getOrNull() ?: return null
        return at.takeIf { it in (postedAt - 36 * 3_600_000L)..(postedAt + 5 * 60_000L) }
    }

    private fun merchant(message: String): String {
        val body = message.replace(Regex("""(?i)(?<!isi\s)\b(?:sisa\s+)?saldo\b.*$"""), "")
        val clean = { value: String -> value.replace(merchantStop, "").trim().trimEnd('.', ',', '!').replace(Regex("""(?i)\s+category$"""), "").replace(Regex("""(?i)^kategori\s+"""), "") }
        val raw = topUpTarget.find(body)?.groupValues?.get(1)?.let(clean)
            ?: merchantLead.findAll(body).map { clean(it.groupValues[1]) }.firstOrNull { it.isNotEmpty() && !it.first().isDigit() && !notAName.containsMatchIn(it) }
        return raw?.take(60).orEmpty()
    }
}
