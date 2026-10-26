// Legal pages in Bahasa Indonesia (default) and English. Both languages carry the same sections in the
// same order, so a reader can compare them; worker/legal.test.mjs checks that structure.
// 🔒 Draft pending legal review: do not publish before the owner's counsel approves the text.
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export const LEGAL_EFFECTIVE = "2026-10-26";
// The operator's legal identity must be filled in during legal review.
const OPERATOR = { id: "[Nama dan alamat penyelenggara Saku: diisi saat tinjauan hukum]", en: "[Saku operator's legal name and address: to be completed during legal review]" };

const copy = {
  id: {
    eyebrow: "Uangmu, lebih seimbang", effective: "Berlaku sejak 26 Oktober 2026", questions: "Pertanyaan", other: "English", otherLang: "en", htmlLang: "id",
    privacyLink: "Privasi", termsLink: "Ketentuan", deletionLink: "Hapus akun", home: "Saku adalah pencatat keuangan yang tetap bisa dipakai offline.",
    pages: {
      "/privacy": ["Pemberitahuan Privasi", (email) => `
<h2>Siapa yang bertanggung jawab</h2>
<p>Saku diselenggarakan oleh ${OPERATOR.id}, sebagai pengendali data pribadi menurut Undang-Undang Nomor 27 Tahun 2022 tentang Pelindungan Data Pribadi. Hubungi kami di <a href="mailto:${email}">${email}</a>.</p>
<h2>Data yang kami proses dan tujuannya</h2>
<ul>
<li><strong>Akun:</strong> ID akun Google, email, nama, dan foto profil opsional, untuk masuk dan menampilkan profilmu.</li>
<li><strong>Catatan keuangan:</strong> akun, transaksi, kantong, kartu, dan tagihan rutin yang kamu catat, beserta nomor revisi sinkronisasi, untuk menyimpan cadangan dan menyinkronkannya antarperangkat.</li>
<li><strong>Keamanan sesi:</strong> token Google yang dienkripsi dan rahasia sesi Saku yang disimpan sebagai hash, untuk menjaga akunmu tetap masuk dengan aman.</li>
<li><strong>Penggunaan AI:</strong> hitungan pemakaian harian yang terhubung ke ID akunmu, untuk membatasi pemakaian AI secara adil.</li>
<li><strong>Persetujuan:</strong> versi perjanjian yang kamu setujui dan waktunya, sebagai bukti persetujuanmu.</li>
</ul>
<p>Dasar pemrosesan adalah persetujuanmu dan pelaksanaan layanan yang kamu minta. Saku tidak menjual data pribadimu dan tidak memakainya untuk iklan.</p>
<h2>Pihak yang memproses data untuk kami</h2>
<ul>
<li><strong>Cloudflare</strong> menjalankan server Saku (Workers, D1, dan R2) yang menyimpan catatan dan foto profilmu, serta memproses alamat IP untuk mengirim dan melindungi layanan.</li>
<li><strong>Cloudflare Workers AI</strong> memproses teks atau gambar rekening yang kamu pilih untuk diimpor, dan nama merchant yang belum dikenal jika kamu menyalakan perapian nama. Saku meminta agar data ini tidak disimpan oleh layanan AI.</li>
<li><strong>Google</strong> memverifikasi saat kamu masuk. Jika kamu mengizinkan Google Drive, salinan yang bisa dibaca disimpan sebagai Google Sheet di Drive milikmu sendiri.</li>
</ul>
<p>Penyedia ini dapat memproses data di luar Indonesia. Kami hanya memakai penyedia yang menerapkan perlindungan keamanan yang memadai.</p>
<h2>Yang tetap di perangkatmu</h2>
<p>File rekening dan tangkapan layar asli serta draf peninjauan impor tetap di perangkatmu dan tidak masuk cadangan atau Sheet. Di Android, kamu bisa mengizinkan Saku membaca notifikasi dari aplikasi bank dan dompet digital yang kamu pilih. Saku memeriksa aplikasinya sebelum membaca isi apa pun, hanya menyimpan jumlah, arah uang, saldo, dan nama merchant dengan nomor rekening dan referensi dihapus, mengenkripsinya di ponselmu, dan menghapusnya setelah tujuh hari, saat kamu keluar, atau saat akun dihapus. Isi notifikasi tidak pernah diunggah atau disinkronkan; hanya transaksi yang kamu tambahkan yang masuk ke catatanmu.</p>
<h2>Berapa lama data disimpan</h2>
<ul>
<li>Catatan dan profil disimpan selama akunmu aktif.</li>
<li>Saat kamu menghapus akun, data cloud aktif langsung dihapus. Penyimpanan R2 dapat menyimpan salinan yang bisa dipulihkan hingga tujuh hari sebelum terhapus permanen.</li>
<li>Folder Saku di Google Drive dipindahkan ke sampah Drive-mu, yang dikosongkan Google sesuai kebijakannya.</li>
<li>Draf notifikasi di ponsel dihapus paling lambat setelah tujuh hari.</li>
</ul>
<h2>Keamanan</h2>
<p>Data dikirim melalui HTTPS. Token Google dienkripsi, rahasia sesi disimpan sebagai hash, dan data di Android dilindungi oleh penyimpanan aplikasi serta Android Keystore. Kamu bisa menambahkan kunci aplikasi di Pengaturan.</p>
<h2>Hak kamu</h2>
<ul>
<li><strong>Mendapat informasi dan akses:</strong> lihat semua catatanmu di aplikasi kapan saja.</li>
<li><strong>Memperbaiki:</strong> ubah atau hapus transaksi dan profilmu di aplikasi.</li>
<li><strong>Mendapat salinan dan memindahkan data:</strong> ekspor cadangan JSON atau CSV dari Pengaturan, atau pakai Google Sheet-mu.</li>
<li><strong>Menarik persetujuan dan menghapus:</strong> matikan fitur opsional, cabut akses Saku di akun Google-mu, atau hapus akun di Pengaturan.</li>
<li><strong>Keberatan atas keputusan otomatis:</strong> saran AI dan notifikasi tidak pernah dicatat tanpa konfirmasimu.</li>
<li><strong>Mengajukan pengaduan:</strong> hubungi kami lebih dulu; kamu juga berhak mengadu kepada otoritas pelindungan data pribadi di Indonesia.</li>
</ul>
<h2>Hubungi kami</h2>
<p>Kirim permintaan atau pertanyaan ke <a href="mailto:${email}">${email}</a> dari alamat Google yang kamu pakai untuk Saku.</p>`],
      "/terms": ["Perjanjian Pengguna", () => `
<h2>Layanan</h2>
<p>Saku membantumu mencatat dan meninjau informasi yang kamu berikan. Saku bukan bank, penyedia pembayaran, atau penasihat keuangan. Kamu tetap bertanggung jawab memeriksa catatan, kecocokan rekening, anggaran, pajak, dan pembayaran.</p>
<h2>Catatanmu</h2>
<p>Catatanmu tetap milikmu. Kamu mengizinkan Saku memprosesnya untuk masuk, cadangan, sinkronisasi otomatis, foto profil, dan cerminan Google Sheets. Fitur offline tetap bisa berjalan tanpa layanan cloud.</p>
<h2>Fitur opsional</h2>
<p>Impor AI, perapian nama merchant, dan membaca notifikasi bank dan dompet digital di Android bersifat opsional, hanya memakai sumber yang kamu pilih, dan menghasilkan saran yang kamu tinjau. Saku tidak pernah mencatat transaksi tanpa konfirmasimu.</p>
<h2>Mengakhiri</h2>
<p>Kamu bisa mengekspor data atau menghapus akun dari Pengaturan kapan saja.</p>`],
      "/account-deletion": ["Hapus akun Saku", (email) => `
<h2>Dari aplikasi</h2>
<p>Di Pengaturan Saku, pilih Hapus akun lalu ketik DELETE. Ini menghapus identitas cloud Saku, sesi, cadangan catatan, dan foto profilmu, mencabut akses Google, dan meminta Google Drive memindahkan folder buatan Saku ke sampah.</p>
<h2>Tanpa aplikasi</h2>
<p>Jika kamu tidak bisa membuka aplikasi, kirim email ke <a href="mailto:${email}">${email}</a> dari alamat Google yang kamu pakai untuk Saku.</p>`],
    },
  },
  en: {
    eyebrow: "Your money, in balance", effective: "Effective 26 October 2026", questions: "Questions", other: "Bahasa Indonesia", otherLang: "id", htmlLang: "en",
    privacyLink: "Privacy", termsLink: "Terms", deletionLink: "Delete account", home: "Saku is an offline-first money tracker.",
    pages: {
      "/privacy": ["Privacy Notice", (email) => `
<h2>Who is responsible</h2>
<p>Saku is operated by ${OPERATOR.en}, as the personal data controller under Indonesia's Law No. 27 of 2022 on Personal Data Protection. Contact us at <a href="mailto:${email}">${email}</a>.</p>
<h2>What we process and why</h2>
<ul>
<li><strong>Account:</strong> your Google account ID, email, name and optional profile photo, to sign you in and show your profile.</li>
<li><strong>Financial records:</strong> the accounts, transactions, pockets, cards and recurring bills you record, plus a sync revision number, to back them up and sync them between devices.</li>
<li><strong>Session security:</strong> encrypted Google tokens and Saku session secrets stored as hashes, to keep you signed in safely.</li>
<li><strong>AI usage:</strong> daily usage counts linked to your account ID, to share the AI allowance fairly.</li>
<li><strong>Consent:</strong> the agreement version you accepted and when, as a record of your consent.</li>
</ul>
<p>We process this data on the basis of your consent and to provide the service you request. Saku does not sell your personal data or use it for advertising.</p>
<h2>Who processes data for us</h2>
<ul>
<li><strong>Cloudflare</strong> runs Saku's servers (Workers, D1 and R2), which store your records and profile photo, and processes IP addresses to deliver and protect the service.</li>
<li><strong>Cloudflare Workers AI</strong> processes the statement text or images you choose to import, and unknown merchant names if you turn on name tidying. Saku asks the AI service not to store this data.</li>
<li><strong>Google</strong> verifies you when you sign in. If you allow Google Drive, a readable copy is stored as a Google Sheet in your own Drive.</li>
</ul>
<p>These providers may process data outside Indonesia. We only use providers that apply appropriate security safeguards.</p>
<h2>What stays on your device</h2>
<p>Original statement files and screenshots, and import review drafts, stay on your device and are not added to backups or Sheets. On Android you can let Saku read notifications from the bank and e-wallet apps you choose. Saku checks the app before reading any content, keeps only the amount, money direction, balance and merchant name with account and reference numbers removed, encrypts them on your phone, and deletes them after seven days, when you sign out, or when the account is deleted. Notification text is never uploaded or synced; only transactions you add join your records.</p>
<h2>How long we keep data</h2>
<ul>
<li>Records and profile are kept while your account is active.</li>
<li>When you delete your account, active cloud data is deleted immediately. R2 storage can keep a recoverable copy for up to seven days before it is permanently erased.</li>
<li>The Saku folder in Google Drive is moved to your Drive trash, which Google empties under its own policy.</li>
<li>Notification drafts on your phone are deleted after seven days at the latest.</li>
</ul>
<h2>Security</h2>
<p>Data travels over HTTPS. Google tokens are encrypted, session secrets are stored as hashes, and data on Android is protected by app storage and the Android Keystore. You can add an app lock in Settings.</p>
<h2>Your rights</h2>
<ul>
<li><strong>Information and access:</strong> see all your records in the app at any time.</li>
<li><strong>Correction:</strong> edit or delete transactions and your profile in the app.</li>
<li><strong>Copies and portability:</strong> export a JSON or CSV backup from Settings, or use your Google Sheet.</li>
<li><strong>Withdrawing consent and deletion:</strong> turn off optional features, revoke Saku's access in your Google account, or delete your account in Settings.</li>
<li><strong>Objecting to automated decisions:</strong> AI suggestions and notifications are never recorded without your confirmation.</li>
<li><strong>Complaints:</strong> contact us first; you also have the right to complain to Indonesia's personal data protection authority.</li>
</ul>
<h2>Contact us</h2>
<p>Send requests or questions to <a href="mailto:${email}">${email}</a> from the Google address you use for Saku.</p>`],
      "/terms": ["User Agreement", () => `
<h2>The service</h2>
<p>Saku helps you record and review information you provide. It is not a bank, payment provider or financial adviser. You remain responsible for checking entries, statement matches, budgets, taxes and payments.</p>
<h2>Your records</h2>
<p>Your records remain yours. You authorize Saku to process them for sign-in, backup, automatic synchronization, profile photos and Google Sheets mirroring. Offline features keep working without cloud service.</p>
<h2>Optional features</h2>
<p>AI import, merchant name tidying, and reading bank and e-wallet notifications on Android are optional, use only the sources you choose, and create suggestions you review. Saku never records a transaction without your confirmation.</p>
<h2>Ending</h2>
<p>You can export your data or delete your account from Settings at any time.</p>`],
      "/account-deletion": ["Delete your Saku account", (email) => `
<h2>From the app</h2>
<p>In Saku Settings, choose Delete account and type DELETE. This removes your Saku cloud identity, sessions, ledger backups and profile photo, revokes Google access, and asks Google Drive to move the Saku-created folder to the trash.</p>
<h2>Without the app</h2>
<p>If you cannot open the app, email <a href="mailto:${email}">${email}</a> from the Google address you use for Saku.</p>`],
    },
  },
};

export const legalLanguage = (url) => url.searchParams.get("lang") === "en" ? "en" : "id";

export function legalPage(path, env, lang = "id") {
  const email = escapeHtml(env.SUPPORT_EMAIL), text = copy[lang], other = copy[text.otherLang];
  const nav = `<a href="/privacy?lang=${lang}">${text.privacyLink}</a> · <a href="/terms?lang=${lang}">${text.termsLink}</a> · <a href="/account-deletion?lang=${lang}">${text.deletionLink}</a>`;
  const [title, body] = text.pages[path] ? [text.pages[path][0], text.pages[path][1](email)] : ["Saku", `<p>${text.home} ${nav}</p>`];
  return new Response(`<!doctype html><html lang="${text.htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${title} - Saku</title><link rel="alternate" hreflang="${text.otherLang}" href="${path}?lang=${text.otherLang}"><style>
    :root{color-scheme:light;--canvas:#f7f6f0;--surface:#fff;--ink:#203b33;--muted:#60746a;--line:#dbe6dc;--teal:#176b55;--soft:#e4efe8}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;--canvas:#101d18;--surface:#192c24;--ink:#edf3ed;--muted:#aec3b5;--line:#365144;--teal:#92d3b1;--soft:#284638}}
    *{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.65 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}a{color:var(--teal);font-weight:650;text-underline-offset:3px}header{border-bottom:1px solid var(--line);background:var(--surface)}header div{max-width:820px;margin:auto;padding:20px 24px}.brand{display:inline-flex;align-items:center;gap:10px;color:var(--ink);font-size:22px;font-weight:800;letter-spacing:-.04em;text-decoration:none}.mark{display:grid;width:34px;height:34px;place-items:center;border-radius:10px 10px 10px 4px;background:var(--teal);color:var(--surface);font-size:16px}.period{color:var(--teal)}main{max-width:820px;margin:auto;padding:54px 24px 88px}.eyebrow{margin:0 0 8px;color:var(--teal);font-size:12px;font-weight:700}h1{max-width:18ch;margin:0;color:var(--ink);font-size:clamp(34px,7vw,54px);line-height:1.04;letter-spacing:-.045em}time{display:block;margin:14px 0 30px;color:var(--muted);font-size:13px}.legal-copy{padding:26px 28px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}p{margin:0 0 18px}p:last-child{margin-bottom:0}.contact{margin-top:18px;padding:18px 20px;border-left:4px solid var(--teal);border-radius:4px 14px 14px 4px;background:var(--soft)}a:focus-visible{outline:3px solid var(--teal);outline-offset:4px;border-radius:3px}@media(max-width:560px){header div{padding:16px 18px}main{padding:38px 18px 64px}.legal-copy{padding:22px 20px}h1{font-size:36px}}header div{display:flex;align-items:center;justify-content:space-between;gap:16px}.lang{font-size:14px}.legal-copy h2{margin:28px 0 8px;font-size:19px;letter-spacing:-.02em}.legal-copy h2:first-child{margin-top:0}.legal-copy ul{margin:0 0 18px;padding-left:20px}.legal-copy li{margin-bottom:6px}
  </style></head><body><header><div><a class="brand" href="/"><span class="mark" aria-hidden="true">s.</span><span>saku<span class="period">.</span></span></a><a class="lang" href="${path}?lang=${text.otherLang}" hreflang="${text.otherLang}" lang="${text.otherLang}">${other ? text.other : ""}</a></div></header><main><p class="eyebrow">${text.eyebrow}</p><h1>${title}</h1><time datetime="${LEGAL_EFFECTIVE}">${text.effective}</time><article class="legal-copy">${body}</article><p class="contact">${text.questions}: <a href="mailto:${email}">${email}</a> · ${nav}</p></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "content-language": lang, "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "x-content-type-options": "nosniff" } });
}

export const legalCopy = copy;
