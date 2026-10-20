"""Create invented wallet-history and scanned-PDF fixtures (requires Pillow)."""

from pathlib import Path
from io import BytesIO

from PIL import Image, ImageDraw, ImageFont


OUT = Path("output")
OUT.mkdir(exist_ok=True)
REGULAR = "C:/Windows/Fonts/segoeui.ttf"
BOLD = "C:/Windows/Fonts/segoeuib.ttf"


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else REGULAR, size)


def line(draw, y, title, detail, amount, color="#173e40"):
    draw.rounded_rectangle((48, y, 852, y + 158), 20, fill="#ffffff")
    draw.text((76, y + 24), title, font=font(29, True), fill="#123c38")
    draw.text((76, y + 80), detail, font=font(22), fill="#62746e")
    draw.text((620, y + 78), amount, font=font(25, True), fill=color)


wallet = Image.new("RGB", (900, 1120), "#edf3ee")
d = ImageDraw.Draw(wallet)
d.rounded_rectangle((24, 28, 876, 1078), 32, fill="#f8faf7")
d.text((60, 70), "CONTOH RIWAYAT DOMPET", font=font(34, True), fill="#123c38")
d.text((60, 121), "DATA SINTETIS - BUKAN REKENING NYATA", font=font(19), fill="#526963")
d.text((60, 220), "10 Oktober 2026", font=font(24, True), fill="#244a42")
line(d, 280, "QRIS WARUNG CONTOH", "10:15  |  Selesai", "-Rp28.000")
line(d, 458, "Isi saldo dompet", "11:24  |  Selesai", "+Rp37.000", "#247450")
line(d, 636, "Pembayaran contoh", "13:12  |  Diproses", "-Rp19.000")
d.text((60, 900), "Saldo ditampilkan: Rp500.000", font=font(23), fill="#62746e")
d.text((60, 967), "Contoh buatan untuk menguji ekstraksi, bukan format aplikasi tertentu.", font=font(17), fill="#62746e")
wallet.save(OUT / "synthetic-wallet-history.png")

scan = Image.new("RGB", (1200, 1550), "#ffffff")
d = ImageDraw.Draw(scan)
d.text((85, 92), "CONTOH MUTASI REKENING", font=font(42, True), fill="#162e2a")
d.text((85, 157), "DATA SINTETIS - HALAMAN PINDAI", font=font(24), fill="#62746e")
d.line((85, 247, 1115, 247), fill="#b9c8c0", width=3)
d.text((90, 285), "TANGGAL", font=font(25, True), fill="#1f4139")
d.text((370, 285), "KETERANGAN", font=font(25, True), fill="#1f4139")
d.text((945, 285), "JUMLAH", font=font(25, True), fill="#1f4139")
for y, date, name, amount in [
    (360, "10/10/2026", "QRIS WARUNG CONTOH  DB", "28.000,00"),
    (462, "10/10/2026", "TOP UP GOPAY  DB", "37.000,00"),
]:
    d.text((90, y), date, font=font(24), fill="#162e2a")
    d.text((370, y), name, font=font(24), fill="#162e2a")
    d.text((945, y), amount, font=font(24), fill="#162e2a")
    d.line((85, y + 73, 1115, y + 73), fill="#dae3dd", width=2)
d.text((780, 623), "SALDO AKHIR", font=font(25, True), fill="#1f4139")
d.text((945, 680), "500.000,00", font=font(25), fill="#162e2a")
d.text((85, 1390), "Halaman buatan untuk pengujian - tidak memuat data nasabah.", font=font(20), fill="#62746e")
scan.save(OUT / "synthetic-scanned-statement.pdf", "PDF", resolution=150)

# A mixed PDF with selectable header text and a raster transaction table.
# It catches pages whose text layer looks non-empty but omits every posting.
jpeg = BytesIO()
scan.save(jpeg, "JPEG", quality=82)
image_bytes = jpeg.getvalue()
image_draw = b"q 548 0 0 620 32 90 cm /Im1 Do Q\n"
def mixed_pdf(headers, path):
    header = b"BT /F1 11 Tf 32 760 Td " + b" 0 -16 Td ".join(
        b"(" + text.encode() + b") Tj" for text in headers
    ) + b" ET\n"
    content = header + image_draw
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content)).encode() + b" >>\nstream\n" + content + b"endstream",
        b"<< /Type /XObject /Subtype /Image /Width 1200 /Height 1550 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + str(len(image_bytes)).encode() + b" >>\nstream\n" + image_bytes + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode())
    pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    path.write_bytes(pdf)


mixed_pdf(["CONTOH MUTASI REKENING - DATA SINTETIS. This header is selectable, while every transaction in the table below is only an image."], OUT / "synthetic-mixed-statement.pdf")
mixed_pdf(["CONTOH MUTASI REKENING - DATA SINTETIS. This selectable disclosure contains no transactions; the table below is embedded as a scanned image."] * 6, OUT / "synthetic-long-header-mixed-statement.pdf")
print(OUT / "synthetic-wallet-history.png")
print(OUT / "synthetic-scanned-statement.pdf")
print(OUT / "synthetic-mixed-statement.pdf")
print(OUT / "synthetic-long-header-mixed-statement.pdf")
