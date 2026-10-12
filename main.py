"""
=============================================================================
BACKEND API - FASTAPI ACCCOUNTING ENGINE & VOUCHER KAS KELUAR
UTS Pengkodean dan Pemrograman Akuntansi - FEB Universitas Diponegoro
Dosen Pengampu: Totok Dewayanto
=============================================================================
"""

import hashlib
from datetime import date, datetime
from typing import List, Optional
from fastapi import FastAPI, HTTPException, Status, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, field_validator

app = FastAPI(
    title="Accounting Voucher Kas Keluar API",
    description="Engine backend akuntansi terintegrasi zero-discrepancy double-entry, audit trail, dan immutability journal.",
    version="1.0.0"
)

# Cross-Origin Resource Sharing (CORS) Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------------------------------------------------------
# IN-MEMORY / MOCK DATABASE STRUCTURE (SIAP DIHUBUNGKAN KE POSTGRESQL/SUPABASE)
# -----------------------------------------------------------------------------

COA_DATABASE = [
    {"kode_akun": "1101", "nama_akun": "Kas Utama", "tipe_saldo_normal": "DEBIT", "klasifikasi_laporan": "NERACA"},
    {"kode_akun": "1020", "nama_akun": "Piutang Usaha", "tipe_saldo_normal": "DEBIT", "klasifikasi_laporan": "NERACA"},
    {"kode_akun": "1201", "nama_akun": "Persediaan Barang Dagang", "tipe_saldo_normal": "DEBIT", "klasifikasi_laporan": "NERACA"},
    {"kode_akun": "2101", "nama_akun": "Utang Usaha", "tipe_saldo_normal": "KREDIT", "klasifikasi_laporan": "NERACA"},
    {"kode_akun": "4010", "nama_akun": "Pendapatan Penjualan", "tipe_saldo_normal": "KREDIT", "klasifikasi_laporan": "LABA_RUGI"},
    {"kode_akun": "5010", "nama_akun": "Beban Pokok Pendapatan (HPP)", "tipe_saldo_normal": "DEBIT", "klasifikasi_laporan": "LABA_RUGI"},
    {"kode_akun": "5101", "nama_akun": "Beban Gaji Karyawan", "tipe_saldo_normal": "DEBIT", "klasifikasi_laporan": "LABA_RUGI"},
    {"kode_akun": "5102", "nama_akun": "Beban Sewa Kantor", "tipe_saldo_normal": "DEBIT", "klasifikasi_laporan": "LABA_RUGI"}
]

VOUCHER_DATABASE = []
AUDIT_LOGS = []

def record_audit(user: str, action: str, details: str):
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "user": user,
        "action": action,
        "details": details
    }
    AUDIT_LOGS.append(log_entry)

# Record initial startup
record_audit("System", "INIT", "Sistem backend voucher kas keluar diinisialisasi.")

# -----------------------------------------------------------------------------
# PYDANTIC SCHEMAS
# -----------------------------------------------------------------------------

class JournalLineSchema(BaseModel):
    account_id: str = Field(..., description="Kode akun terpilih")
    debit: float = Field(0.0, ge=0.0, description="Nilai debit (harus >= 0)")
    credit: float = Field(0.0, ge=0.0, description="Nilai kredit (harus >= 0)")

    @field_validator('credit')
    def validate_single_entry_logic(cls, v, values):
        debit_val = values.data.get('debit', 0.0)
        if debit_val == 0.0 and v == 0.0:
            raise ValueError("Baris jurnal tidak boleh bernilai nol untuk debit dan kredit sekaligus.")
        if debit_val > 0.0 and v > 0.0:
            raise ValueError("Satu baris jurnal tidak boleh memiliki nilai debit dan kredit secara bersamaan.")
        return v

class VoucherCreateSchema(BaseModel):
    tanggal_transaksi: str
    nomor_referensi: str
    deskripsi: str
    created_by: Optional[str] = "Budi Santoso (Kasir)"
    lines: List[JournalLineSchema]

    @field_validator('lines')
    def validate_double_entry_balance(cls, lines):
        if not lines:
            raise ValueError("Voucher harus memiliki setidaknya satu baris jurnal.")
        
        total_debit = sum(line.debit for line in lines)
        total_credit = sum(line.credit for line in lines)

        # Menggunakan pembulatan presisi untuk menghindari floating-point rounding issue
        if round(total_debit, 2) != round(total_credit, 2):
            raise ValueError(f"Asas Double-Entry Terlanggar! Total Debit ({total_debit}) != Total Kredit ({total_credit}).")
        
        if round(total_debit, 2) <= 0:
            raise ValueError("Total nominal transaksi jurnal harus lebih besar dari 0.")
        
        return lines

# -----------------------------------------------------------------------------
# API ENDPOINTS
# -----------------------------------------------------------------------------

@app.get("/api/accounts", summary="Mendapatkan Daftar Chart of Accounts")
def get_chart_of_accounts():
    return {"status": "success", "data": COA_DATABASE}

@app.get("/api/vouchers", summary="Mendapatkan Seluruh Daftar Voucher")
def get_vouchers():
    return {"status": "success", "count": len(VOUCHER_DATABASE), "data": VOUCHER_DATABASE}

@app.get("/api/vouchers/{voucher_id}", summary="Mendapatkan Detail Voucher Berdasarkan ID")
def get_voucher_by_id(voucher_id: int):
    for v in VOUCHER_DATABASE:
        if v["id"] == voucher_id:
            return {"status": "success", "data": v}
    raise HTTPException(status_code=404, detail="Voucher tidak ditemukan.")

@app.post("/api/vouchers", summary="Posting Voucher Kas Keluar Baru")
def create_voucher(payload: VoucherCreateSchema):
    # Cek keunikan nomor referensi
    for v in VOUCHER_DATABASE:
        if v["nomor_referensi"] == payload.nomor_referensi:
            raise HTTPException(status_code=400, detail=f"Nomor referensi '{payload.nomor_referensi}' sudah digunakan.")

    # Hitung SHA-256 Hash Checksum untuk Audit Immutability
    checksum_raw = f"{payload.tanggal_transaksi}|{payload.nomor_referensi}|{payload.deskripsi}|"
    for line in payload.lines:
        checksum_raw += f"{line.account_id}:{line.debit}:{line.credit};"
    
    hash_checksum = hashlib.sha256(checksum_raw.encode('utf-8')).hexdigest()

    new_id = len(VOUCHER_DATABASE) + 1
    voucher_record = {
        "id": new_id,
        "tanggal_transaksi": payload.tanggal_transaksi,
        "nomor_referensi": payload.nomor_referensi,
        "deskripsi": payload.deskripsi,
        "status_posting": "POSTED",
        "created_by": payload.created_by,
        "created_at": datetime.now().isoformat(),
        "hash_checksum": hash_checksum,
        "total_debit": sum(line.debit for line in payload.lines),
        "total_credit": sum(line.credit for line in payload.lines),
        "lines": [line.dict() for line in payload.lines]
    }

    VOUCHER_DATABASE.append(voucher_record)
    record_audit(payload.created_by, "POST_VOUCHER", f"Memposting voucher Ref: {payload.nomor_referensi} (Checksum: {hash_checksum[:10]}...)")

    return {
        "status": "success",
        "message": "Voucher Kas Keluar berhasil diposting dan dikunci.",
        "data": voucher_record
    }

@app.post("/api/vouchers/{voucher_id}/reverse", summary="Membuat Jurnal Pembalik (Storno)")
def reverse_voucher(voucher_id: int, user: str = Query("Budi Santoso (Kasir)")):
    target_voucher = None
    for v in VOUCHER_DATABASE:
        if v["id"] == voucher_id:
            target_voucher = v
            break

    if not target_voucher:
        raise HTTPException(status_code=404, detail="Voucher tidak ditemukan.")

    if target_voucher["status_posting"] != "POSTED":
        raise HTTPException(status_code=400, detail="Hanya voucher berstatus 'POSTED' yang dapat dibuatkan jurnal pembalik.")

    # Tandai voucher asal sebagai REVERSED
    target_voucher["status_posting"] = "REVERSED"

    # Buat baris jurnal pembalik (Dibalik: Debit -> Kredit, Kredit -> Debit)
    reversed_lines = []
    for line in target_voucher["lines"]:
        reversed_lines.append({
            "account_id": line["account_id"],
            "debit": line["credit"],
            "credit": line["debit"]
        })

    rev_ref = f"REV-{target_voucher['nomor_referensi']}"
    rev_id = len(VOUCHER_DATABASE) + 1

    checksum_raw = f"{date.today().isoformat()}|{rev_ref}|Storno dari Ref {target_voucher['nomor_referensi']}|"
    for line in reversed_lines:
        checksum_raw += f"{line['account_id']}:{line['debit']}:{line['credit']};"
    hash_checksum = hashlib.sha256(checksum_raw.encode('utf-8')).hexdigest()

    reversing_voucher = {
        "id": rev_id,
        "tanggal_transaksi": date.today().isoformat(),
        "nomor_referensi": rev_ref,
        "deskripsi": f"Jurnal Pembalik (Storno) dari VKK Ref: {target_voucher['nomor_referensi']}",
        "status_posting": "POSTED",
        "created_by": user,
        "created_at": datetime.now().isoformat(),
        "hash_checksum": hash_checksum,
        "total_debit": sum(line["debit"] for line in reversed_lines),
        "total_credit": sum(line["credit"] for line in reversed_lines),
        "lines": reversed_lines
    }

    VOUCHER_DATABASE.append(reversing_voucher)
    record_audit(user, "REVERSE_VOUCHER", f"Membuat Jurnal Pembalik {rev_ref} merujuk pada {target_voucher['nomor_referensi']}")

    return {
        "status": "success",
        "message": f"Berhasil membuat Jurnal Pembalik ({rev_ref}). Status voucher asal diubah menjadi REVERSED.",
        "data": reversing_voucher
    }

@app.get("/api/audit-logs", summary="Mendapatkan Log Audit Sistem")
def get_audit_logs():
    return {"status": "success", "count": len(AUDIT_LOGS), "data": AUDIT_LOGS}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
