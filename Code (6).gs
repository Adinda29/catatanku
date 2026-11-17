/**
 * =====================================================================
 *  CATATKU — Penghubung (API) antara aplikasi di HP dan Google Sheets
 *  File: Code.gs  (tempel di Extensions > Apps Script pada spreadsheet-mu)
 * =====================================================================
 *
 *  Prinsip keamanan data lama:
 *  - Data lama tidak pernah diubah. setup() hanya MENAMBAH yang belum ada:
 *    tab Pemasukan/Pengeluaran/Dompet/Anggaran/Transfer dan satu kolom
 *    header "Dompet" di ujung kanan sheet transaksi.
 *  - Saat menambah, hanya sel di kolom Tanggal/Kategori/Nominal/Catatan/
 *    Dompet pada baris kosong berikutnya yang diisi. Kolom lain (mis. rumus)
 *    tidak disentuh.
 *  - Saat edit/hapus, isi baris dicek dulu (sidik jari). Kalau isi baris
 *    di sheet sudah berbeda dari yang dilihat aplikasi, perubahan DITOLAK.
 *  - Semua permintaan wajib membawa kunci rahasia (API key).
 */

// ---------------------------------------------------------------------
// PENGATURAN — ubah hanya jika perlu
// ---------------------------------------------------------------------
const CONFIG = {
  SHEET: {
    pemasukan: 'Pemasukan',
    pengeluaran: 'Pengeluaran',
    dompet: 'Dompet',          // daftar dompet + saldo awal (dikelola aplikasi)
    anggaran: 'Anggaran',      // batas pengeluaran per kategori per bulan
    transfer: 'Transfer'       // perpindahan uang antar dompet
  },

  // Baris tempat header berada. 0 = deteksi otomatis (dicari di 10 baris
  // teratas). Isi angka (mis. 1 atau 3) jika deteksi otomatis keliru.
  HEADER_ROW: 0,

  // Nama kolom yang dikenali (tidak peka huruf besar/kecil).
  // Jika header-mu berbeda, tambahkan namanya di daftar yang sesuai.
  FIELDS: {
    tanggal:  ['tanggal', 'tgl', 'tanggal transaksi', 'date', 'waktu', 'hari/tanggal'],
    nominal:  ['nominal', 'jumlah', 'jumlah (rp)', 'nominal (rp)', 'amount', 'nilai', 'rupiah', 'rp', 'harga', 'total'],
    kategori: ['kategori', 'category', 'jenis', 'sumber', 'pos', 'kelompok'],
    catatan:  ['catatan', 'keterangan', 'ket', 'ket.', 'deskripsi', 'uraian', 'note', 'notes', 'memo', 'detail'],
    dompet:   ['dompet', 'akun', 'rekening', 'sumber dana', 'metode', 'metode pembayaran', 'wallet', 'account']
  },

  TIMEZONE: 'Asia/Makassar'   // WITA (Banjarmasin)
};

// ---------------------------------------------------------------------
// SETUP — jalankan SEKALI dari editor (pilih fungsi "setup" lalu Run)
// ---------------------------------------------------------------------
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('API_KEY');
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    props.setProperty('API_KEY', key);
  }
  const ss = getSpreadsheet_();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  const dibuat = buatSheetJikaBelumAda_(ss).concat(buatTabTambahan_(ss));
  const kolomBaru = [];
  ['pemasukan', 'pengeluaran'].forEach(function (t) {
    try { if (tambahKolomDompet_(t)) kolomBaru.push(CONFIG.SHEET[t]); } catch (e) { /* dilaporkan di bawah */ }
  });

  const report = ['pemasukan', 'pengeluaran'].map(function (t) {
    try {
      const info = getSheetInfo_(t);
      return '✔ Sheet "' + info.sheet.getName() + '": header di baris ' + info.headerRow +
        ' → Tanggal=' + colName_(info.map.tanggal) +
        ', Nominal=' + colName_(info.map.nominal) +
        ', Kategori=' + colName_(info.map.kategori) +
        ', Catatan=' + colName_(info.map.catatan) +
        ', Dompet=' + colName_(info.map.dompet);
    } catch (err) {
      return '✖ ' + err.message;
    }
  });

  Logger.log('================ SETUP SELESAI ================');
  Logger.log('KUNCI RAHASIA (API KEY) kamu:');
  Logger.log(key);
  Logger.log('Salin kunci di atas, nanti dimasukkan ke aplikasi.');
  Logger.log('-----------------------------------------------');
  Logger.log('File terhubung: "' + ss.getName() + '"');
  dibuat.forEach(function (n) { Logger.log('＋ Tab "' + n + '" belum ada, sudah dibuat otomatis.'); });
  kolomBaru.forEach(function (n) { Logger.log('＋ Kolom "Dompet" ditambahkan di ujung kanan sheet "' + n + '" (data lama tidak diubah).'); });
  report.forEach(function (r) { Logger.log(r); });
  Logger.log('===============================================');
}

/**
 * Membuat tab Pemasukan / Pengeluaran HANYA jika belum ada.
 * Tab yang sudah ada tidak pernah diubah. Tab kosong bawaan ("Sheet1")
 * dipakai ulang agar file tetap rapi.
 */
function buatSheetJikaBelumAda_(ss) {
  const HEADER = ['Tanggal', 'Kategori', 'Nominal', 'Catatan'];
  const dibuat = [];
  ['pemasukan', 'pengeluaran'].forEach(function (type) {
    const name = CONFIG.SHEET[type];
    const kw = type === 'pemasukan' ? /masuk|income|pendapatan/i : /keluar|expense|biaya|belanja/i;
    const ada = ss.getSheets().some(function (s) { return norm_(s.getName()) === norm_(name); }) ||
      ss.getSheets().filter(function (s) { return kw.test(s.getName()); }).length === 1;
    if (ada) return;

    let sh = ss.getSheets().filter(function (s) {
      return /^(sheet|lembar|lembaran)\s*1$/i.test(s.getName()) && s.getLastRow() === 0;
    })[0];
    if (sh) sh.setName(name); else sh = ss.insertSheet(name);

    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER])
      .setFontWeight('bold').setFontColor('#ffffff')
      .setBackground(type === 'pemasukan' ? '#0f9f8f' : '#4f46e5');
    sh.setFrozenRows(1);
    sh.getRange('A2:A').setNumberFormat('dd/MM/yyyy');
    sh.getRange('C2:C').setNumberFormat('"Rp" #,##0');
    sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 160); sh.setColumnWidth(3, 130); sh.setColumnWidth(4, 260);
    dibuat.push(name);
  });
  SpreadsheetApp.flush();
  return dibuat;
}

/** Tab pendukung yang dikelola aplikasi. Dibuat hanya jika belum ada. */
function buatTabTambahan_(ss) {
  const defs = {
    dompet:   { header: ['Nama', 'Jenis', 'Saldo Awal'], rows: [['Tunai', 'Tunai', 0]], color: '#7c3aed', money: [3] },
    anggaran: { header: ['Kategori', 'Batas per Bulan'], rows: [], color: '#e0475b', money: [2] },
    transfer: { header: ['Tanggal', 'Dari', 'Ke', 'Nominal', 'Biaya Admin', 'Catatan'], rows: [], color: '#0ea5e9', money: [4, 5], date: 1 }
  };
  const dibuat = [];
  Object.keys(defs).forEach(function (key) {
    if (findTab_(ss, CONFIG.SHEET[key])) return;
    const d = defs[key];
    const sh = ss.insertSheet(CONFIG.SHEET[key]);
    sh.getRange(1, 1, 1, d.header.length).setValues([d.header])
      .setFontWeight('bold').setFontColor('#ffffff').setBackground(d.color);
    sh.setFrozenRows(1);
    if (d.rows.length) sh.getRange(2, 1, d.rows.length, d.header.length).setValues(d.rows);
    d.money.forEach(function (c) { sh.getRange(2, c, 999, 1).setNumberFormat('"Rp" #,##0'); });
    if (d.date) sh.getRange(2, d.date, 999, 1).setNumberFormat('dd/MM/yyyy');
    dibuat.push(CONFIG.SHEET[key]);
  });
  return dibuat;
}

/** Menambah header "Dompet" di kolom kosong paling kanan jika belum ada. */
function tambahKolomDompet_(type) {
  const info = getSheetInfo_(type);
  if (info.map.dompet >= 0) return false;
  const sh = info.sheet;
  const col = Math.max(sh.getLastColumn(), info.header.length) + 1;
  const cell = sh.getRange(info.headerRow, col);
  sh.getRange(info.headerRow, info.header.length).copyTo(cell, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  cell.setValue('Dompet');
  SpreadsheetApp.flush();
  return true;
}

/** Jalankan jika kunci bocor / ingin ganti kunci. HP lama harus login ulang. */
function gantiKunci() {
  PropertiesService.getScriptProperties().deleteProperty('API_KEY');
  setup();
}

// ---------------------------------------------------------------------
// ENDPOINT WEB
// ---------------------------------------------------------------------
function doGet() {
  return json_({ ok: true, message: 'API Catatku aktif. Buka aplikasi di HP untuk memakai.' });
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    checkKey_(body.key);

    switch (body.action) {
      case 'ping':   return json_({ ok: true, data: ping_() });
      case 'list':   return json_({ ok: true, data: listAll_() });
      case 'add':    return json_({ ok: true, data: withLock_(function () { return addTx_(body.tx); }) });
      case 'update': return json_({ ok: true, data: withLock_(function () { return updateTx_(body.tx); }) });
      case 'delete': return json_({ ok: true, data: withLock_(function () { return deleteTx_(body.tx); }) });
      case 'saveWallets':    return json_({ ok: true, data: withLock_(function () { return saveWallets_(body.wallets); }) });
      case 'saveBudgets':    return json_({ ok: true, data: withLock_(function () { return saveBudgets_(body.budgets); }) });
      case 'addTransfer':    return json_({ ok: true, data: withLock_(function () { return addTransfer_(body.tr); }) });
      case 'deleteTransfer': return json_({ ok: true, data: withLock_(function () { return deleteTransfer_(body.tr); }) });
      default: throw new Error('Aksi tidak dikenal.');
    }
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

// ---------------------------------------------------------------------
// AKSI
// ---------------------------------------------------------------------
function ping_() {
  const out = { spreadsheet: getSpreadsheet_().getName(), sheets: {} };
  ['pemasukan', 'pengeluaran'].forEach(function (t) {
    const info = getSheetInfo_(t);
    out.sheets[t] = {
      nama: info.sheet.getName(),
      headerRow: info.headerRow,
      header: info.header,
      kolom: {
        tanggal: info.map.tanggal >= 0 ? info.header[info.map.tanggal] : null,
        nominal: info.header[info.map.nominal],
        kategori: info.map.kategori >= 0 ? info.header[info.map.kategori] : null,
        catatan: info.map.catatan >= 0 ? info.header[info.map.catatan] : null,
        dompet: info.map.dompet >= 0 ? info.header[info.map.dompet] : null
      }
    };
  });
  return out;
}

function listAll_() {
  const items = [];
  ['pemasukan', 'pengeluaran'].forEach(function (t) {
    const info = getSheetInfo_(t);
    const sh = info.sheet;
    const lastRow = sh.getLastRow();
    const first = info.headerRow + 1;
    if (lastRow < first) return;

    const n = lastRow - first + 1;
    const width = info.header.length;
    const range = sh.getRange(first, 1, n, width);
    const values = range.getValues();
    const display = range.getDisplayValues();
    const formulas = sh.getRange(first, info.map.nominal + 1, n, 1).getFormulas();

    for (let i = 0; i < n; i++) {
      if (isTotalRow_(values[i], formulas[i][0], info)) continue;
      const tx = rowToTx_(t, first + i, values[i], display[i], info);
      if (tx) items.push(tx);
    }
  });
  items.sort(function (a, b) {
    if (a.tanggal !== b.tanggal) return a.tanggal < b.tanggal ? 1 : -1;
    return b.row - a.row;
  });
  const ext = readExtras_();
  return {
    items: items,
    wallets: ext.wallets, budgets: ext.budgets, transfers: ext.transfers,
    hasDompet: ['pemasukan', 'pengeluaran'].every(function (t) { return getSheetInfo_(t).map.dompet >= 0; }),
    serverTime: Utilities.formatDate(new Date(), sheetTz_(), 'yyyy-MM-dd')
  };
}

function addTx_(tx) {
  const clean = validateTx_(tx, true);
  const info = getSheetInfo_(clean.type);
  const sh = info.sheet;

  // Cari baris terakhir yang benar-benar berisi data transaksi
  const lastRow = sh.getLastRow();
  const first = info.headerRow + 1;
  let lastData = info.headerRow;
  let totalRow = -1;

  if (lastRow >= first) {
    const n = lastRow - first + 1;
    const keyCols = [info.map.nominal, info.map.tanggal, info.map.kategori].filter(function (c) { return c >= 0; });
    const values = sh.getRange(first, 1, n, info.header.length).getValues();
    const formulas = sh.getRange(first, info.map.nominal + 1, n, 1).getFormulas();
    for (let i = n - 1; i >= 0; i--) {
      const filled = keyCols.some(function (c) { return values[i][c] !== '' && values[i][c] !== null; });
      if (!filled) continue;
      if (totalRow < 0 && isTotalRow_(values[i], formulas[i][0], info)) { totalRow = first + i; continue; }
      lastData = first + i;
      break;
    }
  }

  let target;
  if (totalRow > 0) {
    // Ada baris TOTAL di bawah data: sisipkan baris baru tepat di atasnya
    sh.insertRowBefore(totalRow);
    target = totalRow;
    extendTotalFormulas_(sh, totalRow + 1, lastData, target, info.header.length);
  } else {
    target = lastData + 1;
    if (target > sh.getMaxRows()) sh.insertRowAfter(sh.getMaxRows());
  }

  // Salin format sel dari baris data sebelumnya (hanya kolom yang diisi)
  if (lastData > info.headerRow && lastData !== target) {
    mappedCols_(info).forEach(function (c) {
      sh.getRange(lastData, c + 1).copyTo(sh.getRange(target, c + 1), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    });
  } else if (lastData === info.headerRow) {
    // sheet masih kosong: beri format standar
    if (info.map.tanggal >= 0) sh.getRange(target, info.map.tanggal + 1).setNumberFormat('dd/MM/yyyy');
    sh.getRange(target, info.map.nominal + 1).setNumberFormat('#,##0');
  }

  writeCells_(sh, target, info, clean);
  SpreadsheetApp.flush();
  return { row: target };
}

function updateTx_(tx) {
  const clean = validateTx_(tx, false);
  const info = getSheetInfo_(clean.type);
  const sh = info.sheet;
  const row = verifyRow_(sh, info, clean.type, tx.row, tx.fp);
  writeCells_(sh, row, info, clean);
  SpreadsheetApp.flush();
  return { row: row };
}

function deleteTx_(tx) {
  if (!tx || (tx.type !== 'pemasukan' && tx.type !== 'pengeluaran')) throw new Error('Jenis transaksi tidak valid.');
  const info = getSheetInfo_(tx.type);
  const sh = info.sheet;
  const row = verifyRow_(sh, info, tx.type, tx.row, tx.fp);
  sh.deleteRow(row);
  SpreadsheetApp.flush();
  return { row: row };
}

// ---------------------------------------------------------------------
// DOMPET, ANGGARAN, TRANSFER
// ---------------------------------------------------------------------
function findTab_(ss, name) {
  return ss.getSheetByName(name) ||
    ss.getSheets().filter(function (s) { return norm_(s.getName()) === norm_(name); })[0] || null;
}

function needTab_(key) {
  const sh = findTab_(getSpreadsheet_(), CONFIG.SHEET[key]);
  if (!sh) throw new Error('Tab "' + CONFIG.SHEET[key] + '" belum ada. Jalankan fungsi setup() di Apps Script, lalu deploy versi baru.');
  return sh;
}

function tabRows_(sh, width) {
  const last = sh.getLastRow();
  if (last < 2) return { values: [], display: [] };
  const r = sh.getRange(2, 1, last - 1, width);
  return { values: r.getValues(), display: r.getDisplayValues() };
}

function readExtras_() {
  const ss = getSpreadsheet_();
  const out = { wallets: [], budgets: [], transfers: [] };

  const sw = findTab_(ss, CONFIG.SHEET.dompet);
  if (sw) {
    tabRows_(sw, 3).values.forEach(function (r) {
      const nama = String(r[0] || '').trim();
      if (nama) out.wallets.push({ nama: nama, jenis: String(r[1] || '').trim() || 'Lainnya', saldoAwal: parseSigned_(r[2]) });
    });
  }
  const sb = findTab_(ss, CONFIG.SHEET.anggaran);
  if (sb) {
    tabRows_(sb, 2).values.forEach(function (r) {
      const k = String(r[0] || '').trim(), b = parseNumber_(r[1]);
      if (k && b) out.budgets.push({ kategori: k, batas: b });
    });
  }
  const st = findTab_(ss, CONFIG.SHEET.transfer);
  if (st) {
    const t = tabRows_(st, 6);
    t.values.forEach(function (r, i) {
      const n = parseNumber_(r[3]);
      if (!n) return;
      out.transfers.push({
        id: 'transfer:' + (i + 2), row: i + 2, tanggal: parseDate_(r[0]) || '',
        dari: String(r[1] || '').trim(), ke: String(r[2] || '').trim(),
        nominal: n, biaya: parseNumber_(r[4]) || 0, catatan: String(t.display[i][5] || '').trim(),
        fp: fingerprint_(t.display[i])
      });
    });
  }
  return out;
}

/** Menulis ulang daftar dompet (tab Dompet sepenuhnya dikelola aplikasi). */
function saveWallets_(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('Minimal harus ada satu dompet.');
  const seen = {};
  const rows = list.map(function (w) {
    const nama = String(w.nama || '').trim().slice(0, 40);
    if (!nama) throw new Error('Nama dompet tidak boleh kosong.');
    if (seen[nama.toLowerCase()]) throw new Error('Nama dompet "' + nama + '" dobel.');
    seen[nama.toLowerCase()] = true;
    const saldo = Number(w.saldoAwal);
    if (!isFinite(saldo)) throw new Error('Saldo awal "' + nama + '" tidak valid.');
    return [nama, String(w.jenis || 'Lainnya').slice(0, 20), Math.round(saldo * 100) / 100];
  });
  writeManaged_(needTab_('dompet'), rows, 3);
  return { count: rows.length };
}

function saveBudgets_(list) {
  if (!Array.isArray(list)) throw new Error('Data anggaran tidak valid.');
  const seen = {};
  const rows = [];
  list.forEach(function (b) {
    const k = String(b.kategori || '').trim().slice(0, 60);
    const v = Number(b.batas);
    if (!k || !isFinite(v) || v <= 0 || seen[k.toLowerCase()]) return;
    seen[k.toLowerCase()] = true;
    rows.push([k, Math.round(v)]);
  });
  writeManaged_(needTab_('anggaran'), rows, 2);
  return { count: rows.length };
}

function writeManaged_(sh, rows, width) {
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, width).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, width).setValues(rows);
  SpreadsheetApp.flush();
}

function addTransfer_(tr) {
  if (!tr) throw new Error('Data transfer kosong.');
  const dari = String(tr.dari || '').trim(), ke = String(tr.ke || '').trim();
  if (!dari || !ke) throw new Error('Pilih dompet asal dan tujuan.');
  if (dari.toLowerCase() === ke.toLowerCase()) throw new Error('Dompet asal dan tujuan tidak boleh sama.');
  const nominal = Number(tr.nominal), biaya = Number(tr.biaya || 0);
  if (!isFinite(nominal) || nominal <= 0) throw new Error('Nominal transfer harus lebih dari 0.');
  if (!isFinite(biaya) || biaya < 0) throw new Error('Biaya admin tidak valid.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tr.tanggal || ''))) throw new Error('Tanggal tidak valid.');
  const catatan = String(tr.catatan || '').trim().slice(0, 300);

  const sh = needTab_('transfer');
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 1, 1, 6).setValues([[
    Utilities.parseDate(tr.tanggal, sheetTz_(), 'yyyy-MM-dd'), dari, ke, nominal, biaya || '', catatan
  ]]);
  let feeRow = null;
  if (biaya > 0) {
    feeRow = addTx_({ type: 'pengeluaran', nominal: biaya, kategori: 'Biaya Admin', tanggal: tr.tanggal,
      catatan: 'Biaya transfer ' + dari + ' → ' + ke, dompet: dari }).row;
  }
  SpreadsheetApp.flush();
  return { row: row, feeRow: feeRow };
}

function deleteTransfer_(tr) {
  const sh = needTab_('transfer');
  const row = Number(tr && tr.row);
  if (!row || row < 2 || row > sh.getLastRow()) throw new Error('Transfer tidak ditemukan. Muat ulang lalu coba lagi.');
  const display = sh.getRange(row, 1, 1, 6).getDisplayValues()[0];
  if (fingerprint_(display) !== tr.fp) throw new Error('Data di sheet sudah berubah sejak terakhir dimuat. Muat ulang lalu coba lagi.');
  sh.deleteRow(row);
  SpreadsheetApp.flush();
  return { row: row };
}

function parseSigned_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v || '').trim();
  if (!s) return 0;
  const neg = /^-|^\(|-\s*rp|rp\s*-/i.test(s);
  const n = parseNumber_(s);
  return n ? (neg ? -n : n) : 0;
}

// ---------------------------------------------------------------------
// HELPER
// ---------------------------------------------------------------------
let TZ_CACHE_ = null;
function sheetTz_() {
  if (!TZ_CACHE_) TZ_CACHE_ = getSpreadsheet_().getSpreadsheetTimeZone() || CONFIG.TIMEZONE;
  return TZ_CACHE_;
}

function getSpreadsheet_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!id) throw new Error('Spreadsheet tidak ditemukan. Jalankan fungsi setup() dari editor Apps Script.');
    ss = SpreadsheetApp.openById(id);
  }
  return ss;
}

function getSheetInfo_(type) {
  const name = CONFIG.SHEET[type];
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    // toleran terhadap beda huruf besar/kecil / spasi
    sh = ss.getSheets().filter(function (s) { return norm_(s.getName()) === norm_(name); })[0];
  }
  if (!sh) {
    // nama mirip: tab yang mengandung kata "masuk" / "keluar" (hanya jika tepat satu)
    const kw = type === 'pemasukan' ? /masuk|income|pendapatan/i : /keluar|expense|biaya|belanja/i;
    const cand = ss.getSheets().filter(function (s) { return kw.test(s.getName()); });
    if (cand.length === 1) sh = cand[0];
  }
  if (!sh) {
    const names = ss.getSheets().map(function (s) { return '"' + s.getName() + '"'; }).join(', ');
    throw new Error('Sheet "' + name + '" tidak ditemukan di file "' + ss.getName() + '". Tab yang ada: ' + names +
      '. Ubah nama tab, atau isi CONFIG.SHEET.' + type + ' dengan nama tab yang benar.');
  }

  const lastCol = Math.max(sh.getLastColumn(), 1);
  let headerRow = CONFIG.HEADER_ROW;
  let header, map;

  if (headerRow > 0) {
    header = sh.getRange(headerRow, 1, 1, lastCol).getDisplayValues()[0];
    map = mapHeader_(header);
  } else {
    const scan = Math.min(10, Math.max(sh.getLastRow(), 1));
    const rows = sh.getRange(1, 1, scan, lastCol).getDisplayValues();
    let best = -1, bestScore = -1;
    rows.forEach(function (r, i) {
      const m = mapHeader_(r);
      const score = (m.nominal >= 0 ? 3 : 0) + (m.tanggal >= 0 ? 2 : 0) + (m.kategori >= 0 ? 1 : 0) + (m.catatan >= 0 ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    headerRow = best + 1;
    header = rows[best];
    map = mapHeader_(header);
  }

  // potong header kosong di kanan
  let w = header.length;
  while (w > 1 && String(header[w - 1]).trim() === '') w--;
  header = header.slice(0, w).map(function (h) { return String(h).trim(); });

  if (map.nominal < 0) {
    throw new Error('Kolom nominal tidak dikenali di sheet "' + sh.getName() + '". Header terbaca: [' +
      header.join(' | ') + ']. Tambahkan nama kolom nominal-mu ke CONFIG.FIELDS.nominal.');
  }
  return { sheet: sh, headerRow: headerRow, header: header, map: map };
}

function mapHeader_(header) {
  const h = header.map(norm_);
  const used = {};
  const map = {};
  ['tanggal', 'nominal', 'kategori', 'catatan', 'dompet'].forEach(function (field) {
    const aliases = CONFIG.FIELDS[field].map(norm_);
    let idx = -1;
    // 1) cocok persis
    for (let i = 0; i < h.length && idx < 0; i++) if (!used[i] && h[i] && aliases.indexOf(h[i]) >= 0) idx = i;
    // 2) mengandung kata kunci (alias minimal 3 huruf)
    for (let a = 0; a < aliases.length && idx < 0; a++) {
      if (aliases[a].length < 3) continue;
      for (let i = 0; i < h.length; i++) if (!used[i] && h[i] && h[i].indexOf(aliases[a]) >= 0) { idx = i; break; }
    }
    if (idx >= 0) used[idx] = true;
    map[field] = idx;
  });
  return map;
}

/** Rumus di baris TOTAL yang rentangnya berakhir di baris data terakhir
 *  (mis. =SUM(D4:D7)) diperpanjang agar ikut menghitung baris baru (=SUM(D4:D8)). */
function extendTotalFormulas_(sh, totalRow, lastData, newRow, width) {
  if (lastData <= 0) return;
  const rng = sh.getRange(totalRow, 1, 1, width);
  const f = rng.getFormulas()[0];
  const re = new RegExp('(:\\$?[A-Z]{1,3}\\$?)' + lastData + '(?!\\d)', 'g');
  f.forEach(function (formula, i) {
    if (formula && re.test(formula)) {
      re.lastIndex = 0;
      sh.getRange(totalRow, i + 1).setFormula(formula.replace(re, '$1' + newRow));
    }
    re.lastIndex = 0;
  });
}

function mappedCols_(info) {
  return ['tanggal', 'nominal', 'kategori', 'catatan', 'dompet'].map(function (f) { return info.map[f]; }).filter(function (c) { return c >= 0; });
}

function isTotalRow_(values, nominalFormula, info) {
  if (nominalFormula && /^=\s*(SUM|SUBTOTAL|SUMIF)/i.test(nominalFormula)) return true;
  const label = values.slice(0, 3).concat(info.map.kategori >= 0 ? [values[info.map.kategori]] : []);
  return label.some(function (v) { return /^\s*(grand\s*)?total\b/i.test(String(v)); }) && !isValidDate_(values[info.map.tanggal]);
}

function rowToTx_(type, row, values, display, info) {
  const nominal = parseNumber_(values[info.map.nominal]);
  if (nominal === null) return null;
  const tgl = info.map.tanggal >= 0 ? parseDate_(values[info.map.tanggal]) : '';
  return {
    id: type + ':' + row,
    type: type,
    row: row,
    tanggal: tgl || '',
    nominal: nominal,
    kategori: info.map.kategori >= 0 ? String(display[info.map.kategori]).trim() : '',
    catatan: info.map.catatan >= 0 ? String(display[info.map.catatan]).trim() : '',
    dompet: info.map.dompet >= 0 ? String(display[info.map.dompet]).trim() : '',
    fp: fingerprint_(display)
  };
}

function writeCells_(sh, row, info, tx) {
  if (info.map.tanggal >= 0) {
    // tanggal dibuat di zona waktu spreadsheet agar tidak bergeser sehari
    sh.getRange(row, info.map.tanggal + 1).setValue(Utilities.parseDate(tx.tanggal, sheetTz_(), 'yyyy-MM-dd'));
  }
  sh.getRange(row, info.map.nominal + 1).setValue(tx.nominal);
  if (info.map.kategori >= 0) sh.getRange(row, info.map.kategori + 1).setValue(tx.kategori);
  if (info.map.catatan >= 0) sh.getRange(row, info.map.catatan + 1).setValue(tx.catatan);
  if (info.map.dompet >= 0 && tx.dompet !== undefined) sh.getRange(row, info.map.dompet + 1).setValue(tx.dompet);
}

function verifyRow_(sh, info, type, row, fp) {
  row = Number(row);
  if (!row || row <= info.headerRow || row > sh.getLastRow()) {
    throw new Error('Baris transaksi tidak ditemukan. Muat ulang data lalu coba lagi.');
  }
  const display = sh.getRange(row, 1, 1, info.header.length).getDisplayValues()[0];
  if (fingerprint_(display) !== fp) {
    throw new Error('Data di sheet sudah berubah sejak terakhir dimuat. Demi keamanan, perubahan dibatalkan. Muat ulang lalu coba lagi.');
  }
  return row;
}

function validateTx_(tx, isNew) {
  if (!tx) throw new Error('Data transaksi kosong.');
  if (tx.type !== 'pemasukan' && tx.type !== 'pengeluaran') throw new Error('Jenis transaksi tidak valid.');
  const nominal = Number(tx.nominal);
  if (!isFinite(nominal) || nominal <= 0) throw new Error('Nominal harus lebih dari 0.');
  if (nominal > 1e13) throw new Error('Nominal terlalu besar.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(tx.tanggal || ''))) throw new Error('Tanggal tidak valid.');
  const kategori = String(tx.kategori || '').trim().slice(0, 60);
  if (!kategori) throw new Error('Kategori wajib diisi.');
  return {
    type: tx.type,
    nominal: Math.round(nominal * 100) / 100,
    tanggal: tx.tanggal,
    kategori: kategori,
    catatan: String(tx.catatan || '').trim().slice(0, 300),
    dompet: tx.dompet === undefined ? undefined : String(tx.dompet || '').trim().slice(0, 40)
  };
}

function parseNumber_(v) {
  if (typeof v === 'number') return isFinite(v) && v !== 0 ? Math.abs(v) : null;
  let s = String(v || '').trim();
  if (!s) return null;
  s = s.replace(/rp\.?/i, '').replace(/\s/g, '').replace(/[^\d.,-]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');   // 1.250.000,50
  else s = s.replace(/[.,](?=\d{3}(\D|$))/g, '');                      // 1.250.000 / 1,250,000
  const n = parseFloat(s);
  return isFinite(n) && n !== 0 ? Math.abs(n) : null;
}

function isValidDate_(v) {
  return Object.prototype.toString.call(v) === '[object Date]' && !isNaN(v.getTime());
}

function parseDate_(v) {
  if (isValidDate_(v)) return Utilities.formatDate(v, sheetTz_(), 'yyyy-MM-dd');
  if (typeof v === 'number' && v > 20000 && v < 80000) { // serial number spreadsheet
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  }
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); // dd/mm/yyyy (format Indonesia)
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return y + '-' + pad_(m[2]) + '-' + pad_(m[1]);
  }
  const bulan = { jan:1, feb:2, mar:3, apr:4, mei:5, may:5, jun:6, jul:7, agu:8, agt:8, aug:8, sep:9, okt:10, oct:10, nov:11, des:12, dec:12 };
  m = s.toLowerCase().match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (m && bulan[m[2]]) return m[3] + '-' + pad_(bulan[m[2]]) + '-' + pad_(m[1]);
  return '';
}

function fingerprint_(displayRow) {
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(displayRow.map(String)), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(raw).slice(0, 16);
}

function checkKey_(key) {
  const real = PropertiesService.getScriptProperties().getProperty('API_KEY');
  if (!real) throw new Error('API belum di-setup. Jalankan fungsi setup() di editor Apps Script.');
  if (!key || String(key) !== real) {
    Utilities.sleep(800); // perlambat tebakan kunci
    throw new Error('Kunci rahasia salah.');
  }
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Server sedang sibuk, coba lagi.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function norm_(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function pad_(n) { return ('0' + n).slice(-2); }
function colName_(i) {
  if (i < 0) return '(tidak ada)';
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
