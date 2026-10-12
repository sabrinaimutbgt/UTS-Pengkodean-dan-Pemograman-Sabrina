-- =============================================================================
-- SKRIP DDL POSTGRESQL & AUTOMATION TRIGGER
-- UTS Pengkodean dan Pemrograman Akuntansi - FEB Universitas Diponegoro
-- Dosen Pengampu: Totok Dewayanto
-- Modul: General Ledger, Perpetual Inventory, & Voucher Kas Keluar
-- =============================================================================

-- 1. BERSIHKAN TABEL LAMA (Safe Execution Order)
DROP TRIGGER IF EXISTS trg_inventory_mutasi ON inventory_transactions CASCADE;
DROP TRIGGER IF EXISTS trg_prevent_journal_update ON journal_headers CASCADE;
DROP TRIGGER IF EXISTS trg_prevent_line_update ON journal_lines CASCADE;

DROP FUNCTION IF EXISTS trg_update_stock_and_journal() CASCADE;
DROP FUNCTION IF EXISTS trg_enforce_journal_immutability() CASCADE;

DROP TABLE IF EXISTS inventory_transactions CASCADE;
DROP TABLE IF EXISTS inventory_items CASCADE;
DROP TABLE IF EXISTS journal_lines CASCADE;
DROP TABLE IF EXISTS journal_headers CASCADE;
DROP TABLE IF EXISTS chart_of_accounts CASCADE;

-- =============================================================================
-- SOAL 1: DESAIN ARSITEKTUR DATA & GENERAL LEDGER
-- =============================================================================

-- 1.1 Tabel Master Chart of Accounts (COA)
CREATE TABLE chart_of_accounts (
    kode_akun VARCHAR(20) PRIMARY KEY,
    nama_akun VARCHAR(100) NOT NULL,
    tipe_saldo_normal VARCHAR(10) NOT NULL,
    klasifikasi_laporan VARCHAR(20) NOT NULL,
    CONSTRAINT chk_tipe_saldo CHECK (tipe_saldo_normal IN ('DEBIT', 'KREDIT')),
    CONSTRAINT chk_klasifikasi CHECK (klasifikasi_laporan IN ('NERACA', 'LABA_RUGI'))
);

-- 1.2 Tabel Header Jurnal Transaksi
CREATE TABLE journal_headers (
    id BIGSERIAL PRIMARY KEY,
    tanggal_transaksi DATE NOT NULL DEFAULT CURRENT_DATE,
    nomor_referensi VARCHAR(50) UNIQUE NOT NULL,
    deskripsi TEXT,
    status_posting VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    created_by VARCHAR(50) DEFAULT 'system',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    hash_checksum VARCHAR(64),
    CONSTRAINT chk_status_posting CHECK (status_posting IN ('DRAFT', 'POSTED', 'REVERSED'))
);

-- 1.3 Tabel Rincian Jurnal (Journal Lines)
CREATE TABLE journal_lines (
    id BIGSERIAL PRIMARY KEY,
    header_id BIGINT NOT NULL,
    account_id VARCHAR(20) NOT NULL,
    debit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    credit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    CONSTRAINT fk_lines_header FOREIGN KEY (header_id) 
        REFERENCES journal_headers (id) ON DELETE RESTRICT,
    CONSTRAINT fk_lines_account FOREIGN KEY (account_id) 
        REFERENCES chart_of_accounts (kode_akun) ON DELETE RESTRICT,
    CONSTRAINT chk_debit_non_negative CHECK (debit >= 0.00),
    CONSTRAINT chk_credit_non_negative CHECK (credit >= 0.00),
    CONSTRAINT chk_not_both_zero CHECK (NOT (debit = 0.00 AND credit = 0.00)),
    CONSTRAINT chk_not_both_positive CHECK (NOT (debit > 0.00 AND credit > 0.00))
);

-- =============================================================================
-- SOAL 2: OTOMASI PERSEDIAAN PERPETUAL & TRIGGER BASIS DATA
-- =============================================================================

-- 2.1 Tabel Master Item Persediaan
CREATE TABLE inventory_items (
    item_id VARCHAR(10) PRIMARY KEY,
    item_name VARCHAR(100) NOT NULL,
    stock_qty INT NOT NULL DEFAULT 0,
    unit_cost NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    CONSTRAINT chk_stock_non_negative CHECK (stock_qty >= 0)
);

-- 2.2 Tabel Transaksi Mutasi Persediaan
CREATE TABLE inventory_transactions (
    trx_id SERIAL PRIMARY KEY,
    item_id VARCHAR(10) NOT NULL REFERENCES inventory_items(item_id) ON DELETE RESTRICT,
    trx_type VARCHAR(10) NOT NULL,
    qty INT NOT NULL,
    trx_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_trx_type CHECK (trx_type IN ('PURCHASE', 'SALE', 'ADJUSTMENT'))
);

-- 2.3 Trigger Function Automasi Stok & Jurnal
CREATE OR REPLACE FUNCTION trg_update_stock_and_journal()
RETURNS TRIGGER AS $$
DECLARE
    v_current_stock INT;
    v_unit_cost NUMERIC(15,2);
    v_header_id BIGINT;
    v_ref_num VARCHAR(50);
    v_total_amount NUMERIC(15,2);
BEGIN
    -- A. Ambil Data Master Barang
    SELECT stock_qty, unit_cost 
    INTO v_current_stock, v_unit_cost 
    FROM inventory_items 
    WHERE item_id = NEW.item_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaksi Gagal: Barang dengan item_id "%" tidak ditemukan.', NEW.item_id;
    END IF;

    -- B. Validasi Stok & Pembaruan Jumlah Fisik
    IF NEW.trx_type = 'PURCHASE' THEN
        UPDATE inventory_items 
        SET stock_qty = stock_qty + NEW.qty 
        WHERE item_id = NEW.item_id;

    ELSIF NEW.trx_type = 'SALE' THEN
        -- Anti-Negative Inventory Validation
        IF (v_current_stock - NEW.qty) < 0 THEN
            RAISE EXCEPTION 'Penjualan Dibatalkan: Stok % tidak mencukupi (Stok saat ini: %, Dibutuhkan: %).', 
                NEW.item_id, v_current_stock, NEW.qty;
        END IF;

        UPDATE inventory_items 
        SET stock_qty = stock_qty - NEW.qty 
        WHERE item_id = NEW.item_id;

    ELSIF NEW.trx_type = 'ADJUSTMENT' THEN
        IF (v_current_stock + NEW.qty) < 0 THEN
            RAISE EXCEPTION 'Penyesuaian Dibatalkan: Koreksi stok menyebabkan nilai negatif.';
        END IF;

        UPDATE inventory_items 
        SET stock_qty = stock_qty + NEW.qty 
        WHERE item_id = NEW.item_id;
    END IF;

    -- C. Otomatisasi Pencatatan Jurnal Akuntansi (Double-Entry)
    v_ref_num := 'INV-TRX-' || NEW.trx_id;
    v_total_amount := ABS(NEW.qty) * v_unit_cost;

    IF v_total_amount > 0 THEN
        INSERT INTO journal_headers (tanggal_transaksi, nomor_referensi, deskripsi, status_posting)
        VALUES (CURRENT_DATE, v_ref_num, 'Otomatisasi Mutasi Persediaan (' || NEW.trx_type || ') - ' || NEW.item_id, 'POSTED')
        RETURNING id INTO v_header_id;

        IF NEW.trx_type = 'PURCHASE' THEN
            -- Persediaan (Debit), Kas / Utang (Kredit)
            INSERT INTO journal_lines (header_id, account_id, debit, credit)
            VALUES (v_header_id, '1201', v_total_amount, 0.00);

            INSERT INTO journal_lines (header_id, account_id, debit, credit)
            VALUES (v_header_id, '1101', 0.00, v_total_amount);

        ELSIF NEW.trx_type = 'SALE' THEN
            -- HPP (Debit), Persediaan (Kredit)
            INSERT INTO journal_lines (header_id, account_id, debit, credit)
            VALUES (v_header_id, '5010', v_total_amount, 0.00);

            INSERT INTO journal_lines (header_id, account_id, debit, credit)
            VALUES (v_header_id, '1201', 0.00, v_total_amount);
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_inventory_mutasi
AFTER INSERT ON inventory_transactions
FOR EACH ROW
EXECUTE FUNCTION trg_update_stock_and_journal();

-- =============================================================================
-- SOAL 3: PENETAPAN IMMUTABILITY & AUDIT TRAIL
-- =============================================================================

-- 3.1 Trigger Proteksi Immutability Jurnal POSTED
CREATE OR REPLACE FUNCTION trg_enforce_journal_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR(20);
BEGIN
    IF TG_TABLE_NAME = 'journal_headers' THEN
        IF OLD.status_posting = 'POSTED' THEN
            RAISE EXCEPTION 'Akses Ditolak: Jurnal berstatus POSTED bersifat imutabel dan tidak dapat diubah/dihapus. Gunakan mekanisme Jurnal Pembalik (Storno).';
        END IF;
    ELSIF TG_TABLE_NAME = 'journal_lines' THEN
        SELECT status_posting INTO v_status FROM journal_headers WHERE id = OLD.header_id;
        IF v_status = 'POSTED' THEN
            RAISE EXCEPTION 'Akses Ditolak: Rincian baris jurnal yang terhubung dengan header POSTED tidak dapat diubah/dihapus.';
        END IF;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_journal_update
BEFORE UPDATE OR DELETE ON journal_headers
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_journal_immutability();

CREATE TRIGGER trg_prevent_line_update
BEFORE UPDATE OR DELETE ON journal_lines
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_journal_immutability();

-- =============================================================================
-- SEED DATA AWAL (DEMO & TESTING)
-- =============================================================================

-- Master Akun (Chart of Accounts)
INSERT INTO chart_of_accounts (kode_akun, nama_akun, tipe_saldo_normal, klasifikasi_laporan) VALUES
('1101', 'Kas Utama', 'DEBIT', 'NERACA'),
('1020', 'Piutang Usaha', 'DEBIT', 'NERACA'),
('1201', 'Persediaan Barang Dagang', 'DEBIT', 'NERACA'),
('2101', 'Utang Usaha', 'KREDIT', 'NERACA'),
('4010', 'Pendapatan Penjualan', 'KREDIT', 'LABA_RUGI'),
('5010', 'Beban Pokok Pendapatan (HPP)', 'DEBIT', 'LABA_RUGI'),
('5101', 'Beban Gaji Karyawan', 'DEBIT', 'LABA_RUGI'),
('5102', 'Beban Sewa Kantor', 'DEBIT', 'LABA_RUGI');

-- Master Barang
INSERT INTO inventory_items (item_id, item_name, stock_qty, unit_cost) VALUES
('ITEM-001', 'Beras Ritel 5kg', 100, 65000.00),
('ITEM-002', 'Minyak Goreng 2L', 50, 35000.00);
