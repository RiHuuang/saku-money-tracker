"""Generate three fabricated 10-row Indonesian transaction screenshots.

These fixtures contain no customer data and do not imitate any bank's branding.
Run: python scripts/synthetic-30-import-benchmark.py
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT = Path("output/import-benchmark-30")
OUT.mkdir(parents=True, exist_ok=True)
FONT = "C:/Windows/Fonts/segoeui.ttf"
BOLD = "C:/Windows/Fonts/segoeuib.ttf"


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


# Account names and merchants are invented. The matched top-up is intentionally
# visible twice, once in the bank and once in the wallet, to test pairing.
groups = [
    ("Contoh bank account", [
        ("14 Oct", "QRIS Kedai Contoh", "-Rp28.000", "purchase"),
        ("14 Oct", "Transfer gaji Contoh Studio", "+Rp3.500.000", "income"),
        ("14 Oct", "Top up Dompet Contoh", "-Rp40.000", "topup"),
        ("13 Oct", "Biaya admin bulanan", "-Rp6.500", "fee"),
        ("13 Oct", "Toko Alat Tulis Contoh", "-Rp24.500", "purchase"),
        ("13 Oct", "Bunga tabungan", "+Rp332", "interest"),
        ("12 Oct", "Transfer dari rekening sendiri", "+Rp200.000", "transfer"),
        ("12 Oct", "QRIS Warung Pagi", "-Rp19.000", "purchase"),
        ("12 Oct", "Pengembalian toko contoh", "+Rp12.000", "refund"),
        ("11 Oct", "Tagihan kartu kredit Contoh", "-Rp150.000", "card_payment"),
    ]),
    ("Contoh wallet activity", [
        ("14 Oct", "Isi saldo dari bank Contoh", "+Rp40.000", "topup"),
        ("14 Oct", "QRIS Roti Pagi", "-Rp17.000", "purchase"),
        ("13 Oct", "Transportasi Contoh", "-Rp14.000", "purchase"),
        ("13 Oct", "Cashback poin", "+13 poin", "reward"),
        ("13 Oct", "Pembayaran tertunda", "-Rp22.000", "pending"),
        ("12 Oct", "Gerai Minuman Contoh", "-Rp21.500", "purchase"),
        ("12 Oct", "Beli pulsa Contoh", "-Rp25.000", "purchase"),
        ("12 Oct", "Biaya layanan", "-Rp1.000", "fee"),
        ("11 Oct", "Refund pesanan contoh", "+Rp8.000", "refund"),
        ("11 Oct", "QRIS Toko Buah", "-Rp31.000", "purchase"),
    ]),
    ("Contoh pocket activity", [
        ("14 Oct", "Pindah dana antar kantong", "-Rp75.000", "transfer"),
        ("14 Oct", "Pembayaran toko contoh", "-Rp46.000", "purchase"),
        ("13 Oct", "Belanja dengan PayLater", "-Rp39.200", "pay_later"),
        ("13 Oct", "Pajak bunga", "-Rp66", "fee"),
        ("13 Oct", "Bunga tabungan", "+Rp330", "interest"),
        ("12 Oct", "Tiket perjalanan contoh", "-Rp64.000", "purchase"),
        ("12 Oct", "Transfer masuk tidak dikenal", "+Rp55.000", "income"),
        ("12 Oct", "Pembayaran dibatalkan", "-Rp18.000", "failed"),
        ("11 Oct", "QRIS Kios Contoh", "-Rp11.000", "purchase"),
        ("11 Oct", "Tarik tunai ATM", "-Rp100.000", "unknown"),
    ]),
]

expected = []
for group_index, (title, rows) in enumerate(groups, start=1):
    image = Image.new("RGB", (900, 1700), "#edf3f0")
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((25, 25, 875, 1675), radius=28, fill="white")
    draw.text((55, 65), title, font=font(35, True), fill="#173b35")
    draw.text((55, 123), "FABRICATED EXAMPLE  /  OCTOBER 2026", font=font(20), fill="#60756e")
    draw.line((55, 174, 845, 174), fill="#d7e3dd", width=2)
    for row_index, (date, name, amount, activity) in enumerate(rows, start=1):
        y = 206 + (row_index - 1) * 137
        draw.text((60, y), date + " 2026", font=font(21), fill="#63766f")
        draw.text((60, y + 35), name, font=font(28, True), fill="#173b35")
        draw.text((60, y + 78), "Selesai" if activity not in {"pending", "failed"} else activity.title(), font=font(19), fill="#657870")
        draw.text((595, y + 37), amount, font=font(25, True), fill="#23805c" if amount.startswith("+") else "#2d423c")
        draw.line((55, y + 118, 845, y + 118), fill="#e3eae6", width=1)
        expected.append({
            "file": f"screen-{group_index}.png",
            "date": f"2026-10-{int(date.split()[0]):02d}",
            "name": name,
            "amount": int(amount.removeprefix("+").removeprefix("-").removeprefix("Rp").replace(".", "")) if "Rp" in amount else 0,
            "direction": "income" if amount.startswith("+") else "expense",
            "activity": activity,
        })
    image.save(OUT / f"screen-{group_index}.png", optimize=True)

(OUT / "expected.json").write_text(json.dumps(expected, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Wrote 3 synthetic screenshots and {len(expected)} expected rows to {OUT}")
