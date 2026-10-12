# Accounting System & Cash Disbursement Voucher (Voucher Kas Keluar)

> **Full-Stack Accounting Engine with Double-Entry Validation, Perpetual Inventory Automation, Immutable Audit Trail, and Storno Reversing Mechanism.**  
> *Naskah Ujian Tengah Semester (UTS) Mata Kuliah Pengkodean dan Pemrograman Akuntansi — Departemen Akuntansi, Fakultas Ekonomika dan Bisnis, Universitas Diponegoro.*  
> **Dosen Pengampu:** Totok Dewayanto | **Alat Komputasi:** PostgreSQL, FastAPI, JavaScript (ES6+), Tailwind CSS.

---

## 📌 Ringkasan Proyek

Proyek ini dibangun untuk mengatasi permasalahan klasik pada sistem informasi akuntansi tradisional: **anomali saldo tidak seimbang (unbalanced balance sheet)** akibat validasi yang hanya bergantung pada antarmuka pengguna (*frontend*), **keterlambatan pembaruan persediaan perpetual**, serta **kerentanan manipulasi jejak audit (*audit trail*)**.

Aplikasi ini mengintegrasikan penegakan integritas data pada tiga tingkatan (*defense-in-depth*):
1. **Database-Level Constraints & Triggers**: Mencegah saldo tidak seimbang, nilai minus pada debit/kredit, serta *negative stock*.
2. **Backend API Validation (FastAPI)**: Menegakkan aturan *zero-discrepancy* ($\text{Total Debit} = \text{Total Kredit}$), menghitung *SHA-256 Hash Checksum* untuk setiap transaksi, serta mengunci jurnal yang telah berstatus `POSTED`.
3. **Interactive Frontend Engine**: Menyediakan kalkulasi *live balance indicator*, validasi input real-time, pencatatan *audit log* real-time, serta antarmuka khusus untuk pembuatan **Jurnal Pembalik (Storno)**.

---

## 🏗️ Arsitektur Sistem & Skema Basis Data

### 1. General Ledger & Double-Entry Accounting Architecture (Soal 1)
Menggunakan pemisahan tabel *Header-Line* yang dinormalisasi hingga **Bentuk Normal Ketiga (3NF)**:
* **`chart_of_accounts`**: Master daftar akun dengan atribut `kode_akun` (PK), `nama_akun`, `tipe_saldo_normal` (`DEBIT`/`KREDIT`), dan `klasifikasi_laporan` (`NERACA`/`LABA_RUGI`).
* **`journal_headers`**: Menyimpan metadata transaksi dengan `id` (PK), `tanggal_transaksi`, `nomor_referensi` (UNIQUE), `deskripsi`, `status_posting` (`DRAFT`, `POSTED`, `REVERSED`), `created_by`, `created_at`, dan `hash_checksum`.
* **`journal_lines`**: Rincian baris jurnal berpasangan dengan `header_id` (FK ke `journal_headers`), `account_id` (FK ke `chart_of_accounts`), `debit`, dan `credit`.

```
+-------------------+           +-----------------+           +---------------+
| chart_of_accounts |           | journal_headers |           | journal_lines |
+-------------------+           +-----------------+           +---------------+
| kode_akun (PK)    |<----+     | id (PK)         |<----+     | id (PK)       |
| nama_akun         |     |     | tanggal_trans   |     |     | header_id(FK) |-----+
| tipe_saldo_normal |     +-----| nomor_referensi |     +-----| account_id(FK)|
| klasifikasi_lapor |           | deskripsi       |           | debit         |
+-------------------+           | status_posting  |           | credit        |
                                | hash_checksum   |           +---------------+
                                +-----------------+
```

#### Keunggulan Normalisasi 3NF & Separasi Header-Line:
* **Integritas Atomis**: Transaksi jurnal dianggap sebagai satu kesatuan (*header*), mencegah *partial updates* pada baris-baris rincian.
* **Auditability & Non-Repudiation**: Perubahan status transaksi dikelola pada *header*, sementara rincian nominal aman dari manipulasi parsial.
* **Mencegah Anomali Redundansi**: Informasi umum seperti tanggal, nomor bukti, dan deskripsi tidak diulang di setiap baris jurnal.

---

### 2. Otomasi Persediaan Perpetual & Database Trigger (Soal 2)
Pencatatan persediaan barang dagang menggunakan metode perpetual otomatis melalui PostgreSQL Trigger Function `trg_update_stock_and_journal()`:
* **Anti-Negative Inventory**: Apabila transaksi `SALE` mengakibatkan `stock_qty < 0`, sistem memicu `RAISE EXCEPTION` dan melakukan pembatalan (*rollback*) transaksi secara otomatis.
* **Otomatisasi Jurnal Double-Entry**:
  * **Pembelian (`PURCHASE`)**: Menambah `stock_qty` fisik, otomatis memposting jurnal: `Persediaan Barang Dagang` (Debit) dan `Kas / Utang` (Kredit).
  * **Penjualan (`SALE`)**: Memotong `stock_qty` fisik, otomatis memposting jurnal: `Beban Pokok Pendapatan / HPP` (Debit) dan `Persediaan Barang Dagang` (Kredit).

#### Penanganan Race Condition (Concurrency Control):
Untuk mencegah *overselling / phantom stock* saat transaksi bersamaan oleh beberapa kasir, sistem menggunakan penguncian baris eksklusif (`SELECT ... FOR UPDATE`) dalam tingkat isolasi `SERIALIZABLE`:

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
-- Mengunci baris item persediaan secara eksklusif
SELECT stock_qty FROM inventory_items WHERE item_id = 'ITEM-001' FOR UPDATE;

-- Eksekusi mutasi
INSERT INTO inventory_transactions (item_id, trx_type, qty) 
VALUES ('ITEM-001', 'SALE', 1);

COMMIT; -- Kunci dilepas
```

---

### 3. Modul Voucher Kas Keluar & Security Audit Trail (Soal 3)
Fitur antarmuka web dan backend untuk pengelolaan Voucher Kas Keluar:
* **Live Balance Indicator**: Indikator visual real-time yang menampilkan status **SEIMBANG** (Hijau) jika $\text{Total Debit} = \text{Total Kredit} > 0$ atau **TIDAK SEIMBANG** (Merah) beserta nilai selisihnya.
* **Tombol Posting Terkunci**: Tombol *Posting Voucher* tidak aktif (*disabled*) hingga seluruh kelengkapan *header*, validasi per baris, dan keseimbangan debit-kredit terpenuhi.
* **Immutability Status `POSTED`**: Jurnal yang telah diposting berstatus `POSTED` dan dikunci secara permanen (*read-only*). Database Trigger `trg_prevent_journal_update` akan menolak perintah `UPDATE` atau `DELETE`.
* **Mekanisme Jurnal Pembalik (Storno / Reversing Entry)**: Koreksi atas voucher yang telah diposting harus dilakukan melalui penyesuaian jurnal pembalik. Sistem secara otomatis membalikkan posisi Debit dan Kredit serta menerbitkan nomor referensi baru berawalan `REV-`.
* **SHA-256 Hash Checksum**: Setiap voucher yang diposting dihitung nilai *hash cryptographic*-nya berbasis konten transaksi untuk menjamin integritas data dari pembajakan/perubahan langsung di tingkat database.

---

## 📁 Struktur Repositori

```
.
├── schema.sql         # Skrip DDL PostgreSQL (COA, Journal, Inventory, Trigger, & Immutability)
├── main.py            # Backend REST API (FastAPI, Pydantic, Validation, SHA-256 Hash Engine)
├── app.js             # Logic Frontend (Dynamic Rows, Live Balance Engine, Audit Log, Storno UI)
└── README.md          # Dokumentasi Resmi Repositori GitHub
```

---

## 🚀 Panduan Instalasi & Penggunaan

### Prerequisites
* **Database**: PostgreSQL 14+ atau Supabase Project
* **Backend**: Python 3.10+
* **Frontend**: Modern Web Browser (Chrome / Firefox / Edge)

---

### Langkah 1: Inisialisasi Basis Data (PostgreSQL)
Eksekusi file `schema.sql` pada SQL Editor database PostgreSQL atau Supabase Anda:

```bash
psql -h localhost -U postgres -d accounting_db -f schema.sql
```

---

### Langkah 2: Menjalankan Backend API (FastAPI)
1. Install dependensi Python yang dibutuhkan:
   ```bash
   pip install fastapi uvicorn pydantic
   ```
2. Jalankan server FastAPI:
   ```bash
   python main.py
   ```
3. Buka dokumentasi Swagger UI interaktif di browser: `http://localhost:8000/docs`

---

### Langkah 3: Menjalankan Frontend Application
Buka file antarmuka web (misal `index.html` yang memuat `app.js`) di browser Anda.

---

## 🔌 Spesifikasi API Endpoints

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/accounts` | Mengambil daftar Master Chart of Accounts (COA) |
| `GET` | `/api/vouchers` | Mengambil seluruh riwayat voucher transaksi |
| `GET` | `/api/vouchers/{id}` | Mengambil detail voucher berdasarkan ID beserta hash checksum |
| `POST` | `/api/vouchers` | Memposting Voucher Kas Keluar baru (Verifikasi Zero-Discrepancy) |
| `POST` | `/api/vouchers/{id}/reverse` | Menerbitkan Jurnal Pembalik (Storno) & mengubah status voucher asal ke `REVERSED` |
| `GET` | `/api/audit-logs` | Mengambil log aktivitas audit trail sistem |

---

## 🧪 Pengujian & Skenario Audit

### 1. Uji Coba Saldo Tidak Seimbang (Zero-Discrepancy Check)
* **Aksi**: Input Debit = Rp 1.000.000 (Kas) dan Kredit = Rp 800.000 (Utang).
* **Hasil**: Indikator menampilkan **TIDAK SEIMBANG (Selisih: Rp 200.000)** dan tombol *Posting Voucher* tetap nonaktif.

### 2. Uji Coba Anti-Negative Inventory Trigger
* **Aksi**: Eksekusi transaksi penjualan barang `ITEM-001` sebanyak 150 unit ketika stok fisik hanya 100 unit.
* **Hasil**: Database menolak transaksi dan mengeluarkan pesan error:  
  `ERROR: Penjualan Dibatalkan: Stok ITEM-001 tidak mencukupi (Stok saat ini: 100, Dibutuhkan: 150).`

### 3. Uji Coba Immutability & Storno Reversal
* **Aksi**: Lakukan perintah `UPDATE journal_headers SET deskripsi = 'Ubah' WHERE id = 1;` pada voucher `POSTED`.
* **Hasil**: PostgreSQL Trigger menggagalkan perintah:  
  `ERROR: Akses Ditolak: Jurnal berstatus POSTED bersifat imutabel dan tidak dapat diubah/dihapus.`
* **Koreksi**: Pilih tombol **Buat Jurnal Pembalik**, sistem menerbitkan draft `REV-VKK-2026-001` dengan posisi Debit-Kredit terbalik secara otomatis.

---

## 👨‍💻 Kontributor & Lisensi
* **Mahasiswa**: S1 Akuntansi FEB Universitas Diponegoro
* **Ujian**: Midterm Examination Coding Akuntansi 2026/2027
* **Lisensi**: MIT License — Bebas digunakan untuk keperluan akademik dan pengembangan pendidikan akuntansi.
