/**
 * =============================================================================
 * FRONTEND CORE LOGIC - VOUCHER KAS KELUAR & LIVE BALANCE ENGINE
 * UTS Pengkodean dan Pemrograman Akuntansi - FEB Universitas Diponegoro
 * Dosen Pengampu: Totok Dewayanto
 * =============================================================================
 */

// Master Chart of Accounts (COA)
const ACCOUNT_LIST = [
    { code: '1101', name: 'Kas Utama' },
    { code: '1020', name: 'Piutang Usaha' },
    { code: '1201', name: 'Persediaan Barang Dagang' },
    { code: '2101', name: 'Utang Usaha' },
    { code: '4010', name: 'Pendapatan Penjualan' },
    { code: '5010', name: 'Beban Pokok Pendapatan (HPP)' },
    { code: '5101', name: 'Beban Gaji Karyawan' },
    { code: '5102', name: 'Beban Sewa Kantor' }
];

const CURRENT_USER = "Budi Santoso (Kasir)";
let voucherStatusState = 'DRAFT'; // DRAFT | POSTED
let currentOriginalRef = '';

// Inisialisasi Aplikasi Saat Halaman Selesai Dimuat
window.addEventListener('DOMContentLoaded', () => {
    initVoucherForm();
});

function initVoucherForm() {
    const dateEl = document.getElementById('voucher-date');
    if (dateEl) {
        dateEl.value = new Date().toISOString().split('T')[0];
        dateEl.addEventListener('change', () => logAuditActivity("Mengubah tanggal transaksi voucher"));
    }

    const refEl = document.getElementById('voucher-ref');
    if (refEl) {
        refEl.addEventListener('input', () => {
            calculateJournalTotals();
            logAuditActivity("Mengubah nomor referensi bukti");
        });
    }

    const descEl = document.getElementById('voucher-desc');
    if (descEl) {
        descEl.addEventListener('input', () => {
            calculateJournalTotals();
            logAuditActivity("Mengubah deskripsi transaksi");
        });
    }

    // Tambahkan 2 baris awal secara otomatis
    addJournalRow();
    addJournalRow();

    logAuditActivity("Sistem Voucher Kas Keluar diinisialisasi.");
}

// -----------------------------------------------------------------------------
// HELPER UTILITIES & AUDIT LOG ENGINE
// -----------------------------------------------------------------------------

function logAuditActivity(message) {
    const container = document.getElementById('audit-log-container');
    if (!container) return;

    const timeStr = new Date().toTimeString().split(' ')[0];
    const logDiv = document.createElement('div');
    logDiv.className = "flex items-center gap-2 border-b border-slate-800 pb-1 text-slate-300 font-mono text-xs";
    logDiv.innerHTML = `<span class="text-slate-500">[${timeStr}]</span> <span class="text-blue-400 font-semibold">[${CURRENT_USER}]</span> <span>${message}</span>`;
    
    container.appendChild(logDiv);
    container.scrollTop = container.scrollHeight;
}

function formatRupiah(num) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);
}

function parseInputToInteger(valStr) {
    if (!valStr) return 0;
    const cleanStr = valStr.toString().replace(/[^0-9]/g, '');
    return parseInt(cleanStr, 10) || 0;
}

function onAmountInput(el) {
    let rawVal = parseInputToInteger(el.value);
    el.value = rawVal === 0 ? '' : new Intl.NumberFormat('id-ID').format(rawVal);
    calculateJournalTotals();
}

function onAmountBlur(el) {
    let rawVal = parseInputToInteger(el.value);
    el.value = rawVal === 0 ? '0' : new Intl.NumberFormat('id-ID').format(rawVal);
    calculateJournalTotals();
}

function onAmountFocus(el) {
    let rawVal = parseInputToInteger(el.value);
    el.value = rawVal === 0 ? '' : rawVal;
}

// -----------------------------------------------------------------------------
// MANAJEMEN BARIS TABEL JURNAL (DYNAMIC ROWS)
// -----------------------------------------------------------------------------

function addJournalRow(accountCode = '', debitVal = 0, creditVal = 0) {
    if (voucherStatusState === 'POSTED') return;

    const tbody = document.getElementById('journal-tbody');
    if (!tbody) return;

    const row = tbody.insertRow();
    row.className = "hover:bg-slate-50 transition border-b border-slate-200";

    let selectOptions = `<option value="">-- Pilih Akun --</option>`;
    ACCOUNT_LIST.forEach(acc => {
        const isSelected = acc.code === accountCode ? 'selected' : '';
        selectOptions += `<option value="${acc.code}" ${isSelected}>${acc.code} - ${acc.name}</option>`;
    });

    const formattedDebit = debitVal > 0 ? new Intl.NumberFormat('id-ID').format(debitVal) : '0';
    const formattedCredit = creditVal > 0 ? new Intl.NumberFormat('id-ID').format(creditVal) : '0';

    row.innerHTML = `
        <td class="p-3">
            <select class="account-code-select w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none" onchange="handleAccountSelect(this)">
                ${selectOptions}
            </select>
        </td>
        <td class="p-3">
            <input type="text" class="account-name-input w-full bg-slate-100 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600" readonly placeholder="Nama akun otomatis">
        </td>
        <td class="p-3">
            <input type="text" value="${formattedDebit}" class="debit-input w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-right focus:ring-2 focus:ring-blue-500 focus:outline-none" oninput="onAmountInput(this)" onfocus="onAmountFocus(this)" onblur="onAmountBlur(this)">
        </td>
        <td class="p-3">
            <input type="text" value="${formattedCredit}" class="credit-input w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-right focus:ring-2 focus:ring-blue-500 focus:outline-none" oninput="onAmountInput(this)" onfocus="onAmountFocus(this)" onblur="onAmountBlur(this)">
        </td>
        <td class="p-3 text-center">
            <button type="button" onclick="removeJournalRow(this)" class="text-slate-400 hover:text-red-600 transition p-1.5 rounded-md hover:bg-red-50" title="Hapus Baris">
                <svg class="w-4 h-4 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
        </td>
    `;

    handleAccountSelect(row.querySelector('.account-code-select'));
    logAuditActivity("Menambahkan baris rincian jurnal baru");
    calculateJournalTotals();
}

function handleAccountSelect(selectEl) {
    if (!selectEl) return;
    const code = selectEl.value;
    const row = selectEl.closest('tr');
    const nameInput = row.querySelector('.account-name-input');

    const matched = ACCOUNT_LIST.find(a => a.code === code);
    if (matched) {
        nameInput.value = matched.name;
        logAuditActivity(`Memilih akun ${matched.code} - ${matched.name}`);
    } else {
        nameInput.value = '';
    }
    calculateJournalTotals();
}

function removeJournalRow(btn) {
    if (voucherStatusState === 'POSTED') return;
    const tbody = document.getElementById('journal-tbody');
    if (tbody.rows.length <= 1) {
        showToast("Voucher minimal harus berisi 1 baris jurnal.", "warning");
        return;
    }
    btn.closest('tr').remove();
    logAuditActivity("Menghapus baris rincian jurnal");
    calculateJournalTotals();
}

// -----------------------------------------------------------------------------
// LIVE BALANCE INDICATOR & VALIDATION ENGINE
// -----------------------------------------------------------------------------

function calculateJournalTotals() {
    const tbody = document.getElementById('journal-tbody');
    if (!tbody) return;

    const rows = tbody.rows;
    let sumDebit = 0;
    let sumCredit = 0;
    let allRowsValid = true;

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const accSelect = r.querySelector('.account-code-select');
        const debInput = r.querySelector('.debit-input');
        const credInput = r.querySelector('.credit-input');

        const debVal = parseInputToInteger(debInput.value);
        const credVal = parseInputToInteger(credInput.value);

        let rowValid = true;
        if (debVal < 0 || credVal < 0) rowValid = false;
        if (debVal > 0 && credVal > 0) rowValid = false;
        if (debVal === 0 && credVal === 0) rowValid = false;
        if (!accSelect.value) rowValid = false;

        if (!rowValid) {
            allRowsValid = false;
            r.classList.add('bg-red-50/60');
        } else {
            r.classList.remove('bg-red-50/60');
        }

        sumDebit += debVal;
        sumCredit += credVal;
    }

    document.getElementById('total-debit').innerText = formatRupiah(sumDebit);
    document.getElementById('total-credit').innerText = formatRupiah(sumCredit);

    const diff = Math.abs(sumDebit - sumCredit);
    const isBalanced = (sumDebit === sumCredit) && (sumDebit > 0);

    const indicatorEl = document.getElementById('balance-indicator');
    const indicatorText = document.getElementById('indicator-text');
    const indicatorDot = document.getElementById('indicator-dot');
    const diffContainer = document.getElementById('diff-container');
    const diffValEl = document.getElementById('diff-value');

    if (diffValEl) diffValEl.innerText = formatRupiah(diff);

    if (isBalanced) {
        indicatorEl.className = "px-4 py-2 rounded-lg font-bold text-xs tracking-wide uppercase bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-2";
        indicatorText.innerText = "SEIMBANG";
        indicatorDot.className = "w-2.5 h-2.5 rounded-full bg-emerald-600";
        if (diffContainer) diffContainer.style.display = 'none';
    } else {
        indicatorEl.className = "px-4 py-2 rounded-lg font-bold text-xs tracking-wide uppercase bg-red-100 text-red-700 border border-red-300 flex items-center gap-2";
        indicatorText.innerText = "TIDAK SEIMBANG";
        indicatorDot.className = "w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse";
        if (diffContainer) diffContainer.style.display = 'block';
    }

    validateSubmitButton(allRowsValid, isBalanced, rows.length);
}

function validateSubmitButton(rowsValid, isBalanced, rowCount) {
    if (voucherStatusState === 'POSTED') return;

    const dateVal = document.getElementById('voucher-date').value;
    const refVal = document.getElementById('voucher-ref').value.trim();
    const descVal = document.getElementById('voucher-desc').value.trim();

    const submitBtn = document.getElementById('btn-submit');
    const isHeaderComplete = dateVal !== '' && refVal !== '' && descVal !== '';

    if (submitBtn) {
        submitBtn.disabled = !(isHeaderComplete && rowsValid && isBalanced && rowCount > 0);
    }
}

// -----------------------------------------------------------------------------
// SUBMIT POSTING & IMMUTABILITY LOCKING
// -----------------------------------------------------------------------------

function submitVoucherForm() {
    currentOriginalRef = document.getElementById('voucher-ref').value.trim();
    voucherStatusState = 'POSTED';

    logAuditActivity(`POSTING VOUCHER KAS KELUAR Ref: ${currentOriginalRef}`);

    // Update Badge Status
    const badge = document.getElementById('status-badge');
    badge.className = "px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase bg-emerald-100 text-emerald-800 border border-emerald-200";
    badge.innerText = "POSTED";

    // Lock All Header Inputs
    document.getElementById('voucher-date').disabled = true;
    document.getElementById('voucher-ref').disabled = true;
    document.getElementById('voucher-desc').disabled = true;

    // Hide Add & Submit Buttons
    document.getElementById('btn-add-row').style.display = 'none';
    document.getElementById('btn-submit').style.display = 'none';

    // Show Reversing Entry Button
    const btnReverse = document.getElementById('btn-reverse');
    if (btnReverse) {
        btnReverse.classList.remove('hidden');
        btnReverse.classList.add('flex');
    }

    // Disable Table Rows
    const inputs = document.querySelectorAll('#journal-tbody input, #journal-tbody select');
    inputs.forEach(i => i.disabled = true);

    const deleteBtns = document.querySelectorAll('#journal-tbody button');
    deleteBtns.forEach(b => b.style.display = 'none');

    showToast("Voucher berhasil diposting! Seluruh data transaksi kini dikunci (read-only) untuk keperluan audit.", "success");
}

// -----------------------------------------------------------------------------
// REVERSING JOURNAL ENTRY (STORNO)
// -----------------------------------------------------------------------------

function executeReversingJournal() {
    logAuditActivity(`Membuat Jurnal Pembalik (Storno) merujuk pada Ref: ${currentOriginalRef}`);

    const tbody = document.getElementById('journal-tbody');
    const rows = tbody.rows;
    const reversedData = [];

    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const code = r.querySelector('.account-code-select').value;
        const deb = parseInputToInteger(r.querySelector('.debit-input').value);
        const cred = parseInputToInteger(r.querySelector('.credit-input').value);

        // Dibalik: Debit -> Kredit, Kredit -> Debit
        reversedData.push({ accountCode: code, debit: cred, credit: deb });
    }

    voucherStatusState = 'DRAFT';

    // Unlock Header Fields
    document.getElementById('voucher-date').disabled = false;
    document.getElementById('voucher-ref').disabled = false;
    document.getElementById('voucher-desc').disabled = false;

    document.getElementById('voucher-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('voucher-ref').value = `REV-${currentOriginalRef}`;
    document.getElementById('voucher-desc').value = `Jurnal Pembalik (Storno) dari VKK Ref: ${currentOriginalRef}`;

    // Reset Status Badge
    const badge = document.getElementById('status-badge');
    badge.className = "px-3 py-1.5 rounded-lg text-xs font-bold tracking-wider uppercase bg-amber-100 text-amber-800 border border-amber-200";
    badge.innerText = "Draft";

    // Toggle Buttons
    const btnReverse = document.getElementById('btn-reverse');
    if (btnReverse) {
        btnReverse.classList.add('hidden');
        btnReverse.classList.remove('flex');
    }

    document.getElementById('btn-add-row').style.display = 'flex';
    document.getElementById('btn-submit').style.display = 'flex';

    // Rebuild Table Rows with Swapped Values
    tbody.innerHTML = '';
    reversedData.forEach(item => {
        addJournalRow(item.accountCode, item.debit, item.credit);
    });

    showToast(`Draft Jurnal Pembalik berhasil dibuat (Ref: REV-${currentOriginalRef}). Posisi Debit dan Kredit telah dibalik secara otomatis!`, "success");
}

// -----------------------------------------------------------------------------
// TOAST NOTIFICATIONS
// -----------------------------------------------------------------------------

function showToast(msg, type = "success") {
    const toast = document.createElement('div');
    const bgColor = type === "success" ? "bg-emerald-600 border-emerald-500" : "bg-amber-600 border-amber-500";
    toast.className = `fixed top-6 right-6 z-50 ${bgColor} text-white px-6 py-3 rounded-xl shadow-xl border text-sm font-semibold animate-bounce`;
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
