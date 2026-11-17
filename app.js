/* =========================================================
   CATATKU — app.js
   Aplikasi pencatat keuangan pribadi (PWA) → Google Sheets via Apps Script
   ========================================================= */
(() => {
  'use strict';

  // ---------------------------------------------------------
  // Konstanta & penyimpanan lokal
  // ---------------------------------------------------------
  const LS = {
    cfg: 'catatku.cfg', cache: 'catatku.cache', queue: 'catatku.queue',
    pin: 'catatku.pin', prefs: 'catatku.prefs'
  };
  const DEFAULT_CATS = {
    pengeluaran: ['Makan & Minum', 'Transportasi', 'Belanja', 'Tagihan', 'Pulsa & Internet', 'Kesehatan', 'Hiburan', 'Pendidikan', 'Rumah Tangga', 'Lainnya'],
    pemasukan: ['Gaji', 'Bonus', 'Freelance', 'Hadiah', 'Investasi', 'Lainnya']
  };
  const PALETTE = ['#4f46e5', '#0fb5a6', '#a855f7', '#f59e0b', '#ec4899', '#0ea5e9', '#22c55e', '#ef6c57', '#94a3b8'];
  const ICONS = [
    [/makan|minum|food|kuliner|jajan|kopi|resto/i, '🍜'], [/transport|bensin|bbm|ojek|grab|gojek|parkir|tol|kendaraan|motor|mobil/i, '🛵'],
    [/belanja|shopping|baju|pakaian/i, '🛍️'], [/tagihan|listrik|air|pln|pdam|cicilan|kredit|sewa|kos/i, '🧾'],
    [/pulsa|internet|data|wifi|paket/i, '📶'], [/sehat|obat|dokter|klinik|rumah sakit|bpjs/i, '💊'],
    [/hibur|nonton|film|game|liburan|wisata|rekreasi/i, '🎬'], [/didik|kuliah|sekolah|kursus|buku|spp/i, '🎓'],
    [/rumah tangga|dapur|sabun|kebersihan|laundry/i, '🏠'], [/gaji|salary|upah|honor/i, '💼'],
    [/bonus|thr|insentif/i, '🎁'], [/freelance|proyek|project|sampingan|jasa/i, '💻'],
    [/hadiah|kado|gift|angpao/i, '🎀'], [/invest|saham|reksa|dividen|bunga|tabungan|emas/i, '📈'],
    [/zakat|sedekah|infaq|donasi|amal|sumbang/i, '🤲'], [/olahraga|lari|gym|sepatu/i, '🏃'],
    [/foto|kamera|lensa/i, '📷'], [/keluarga|orang tua|anak|pacar/i, '💞']
  ];

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* penuh / diblokir */ } },
    del(k) { try { localStorage.removeItem(k); } catch { } }
  };

  const state = {
    cfg: store.get(LS.cfg, null),            // { url, key, meta }
    items: [],                               // transaksi dari sheet
    queue: store.get(LS.queue, []),          // transaksi offline belum terkirim
    prefs: Object.assign({ lastType: 'pengeluaran', customCats: { pemasukan: [], pengeluaran: [] }, trendMode: 'harian' }, store.get(LS.prefs, {})),
    period: { type: 'bulan', start: null, end: null },
    route: 'home',
    loading: false,
    loadedAt: 0,
    filters: { q: '', type: 'semua', kategori: '', from: '', to: '' },
    historyLimit: 60
  };
  const cache = store.get(LS.cache, null);
  if (cache && Array.isArray(cache.items)) { state.items = cache.items; state.loadedAt = cache.at || 0; }

  // ---------------------------------------------------------
  // Utilitas
  // ---------------------------------------------------------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
  const rp = (n) => 'Rp ' + nf.format(Math.round((Number(n) || 0) * 100) / 100);
  const rpSigned = (n) => (n < 0 ? '− ' : '') + rp(Math.abs(n));
  const short = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace('.', ',').replace(',0', '') + 'M';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',').replace(',0', '') + 'jt';
    if (a >= 1e3) return Math.round(n / 1e3) + 'rb';
    return String(Math.round(n));
  };
  const iconFor = (cat, type) => { for (const [re, ic] of ICONS) if (re.test(cat)) return ic; return type === 'pemasukan' ? '💰' : '💸'; };

  // tanggal (semua lokal, format yyyy-mm-dd)
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const today = () => ymd(new Date());
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const BULAN_P = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const fmtDate = (s, withDay = false) => {
    if (!s) return 'Tanpa tanggal';
    const d = parse(s);
    return (withDay ? HARI[d.getDay()] + ', ' : '') + `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}`;
  };
  const relDate = (s) => {
    if (!s) return 'Tanpa tanggal';
    const t = today();
    if (s === t) return 'Hari ini';
    if (s === addDays(t, -1)) return 'Kemarin';
    return fmtDate(s, true);
  };

  const sha256 = async (txt) => {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  const vibrate = (p = 12) => { try { navigator.vibrate && navigator.vibrate(p); } catch { } };

  // ---------------------------------------------------------
  // API (Google Apps Script)
  // ---------------------------------------------------------
  class NetworkError extends Error { }

  async function api(action, payload = {}, cfg = state.cfg) {
    if (!cfg) throw new Error('Aplikasi belum terhubung.');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let res;
    try {
      // text/plain → tidak memicu preflight CORS di Apps Script
      res = await fetch(cfg.url, {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action, key: cfg.key }, payload)),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        signal: ctrl.signal, redirect: 'follow', cache: 'no-store'
      });
    } catch (e) {
      throw new NetworkError(e.name === 'AbortError' ? 'Koneksi terlalu lama. Coba lagi.' : 'Tidak ada koneksi internet.');
    } finally { clearTimeout(timer); }
    let data;
    try { data = await res.json(); } catch {
      throw new Error('Balasan server tidak valid. Pastikan URL Web App benar dan akses "Siapa saja" (Anyone).');
    }
    if (!data.ok) throw new Error(data.error || 'Terjadi kesalahan di server.');
    return data.data;
  }

  async function loadData({ silent = false } = {}) {
    if (!state.cfg || state.loading) return;
    state.loading = true;
    setRefreshing(true);
    if (!silent && !state.loadedAt) render();
    try {
      await flushQueue();
      const data = await api('list');
      state.items = data.items || [];
      state.loadedAt = Date.now();
      store.set(LS.cache, { items: state.items, at: state.loadedAt });
    } catch (e) {
      if (!silent || !(e instanceof NetworkError)) toast(e.message, 'error');
    } finally {
      state.loading = false;
      setRefreshing(false);
      render();
    }
  }

  function setRefreshing(on) { const b = $('#btnRefresh'); if (b) b.classList.toggle('spin', on); }

  // Antrean offline
  function saveQueue() { store.set(LS.queue, state.queue); updateSyncPill(); }
  async function flushQueue() {
    if (!state.queue.length || !navigator.onLine) return;
    let sent = 0;
    for (const q of [...state.queue]) {
      try {
        await api('add', { tx: q });
        state.queue = state.queue.filter((x) => x.qid !== q.qid);
        saveQueue();
        sent++;
      } catch (e) {
        if (e instanceof NetworkError) break;
        // ditolak server (mis. data tidak valid) → keluarkan dari antrean agar tidak macet
        state.queue = state.queue.filter((x) => x.qid !== q.qid);
        saveQueue();
        toast('Satu transaksi offline gagal dikirim: ' + e.message, 'error');
      }
    }
    if (sent) toast(`${sent} transaksi offline berhasil dikirim ke sheet`, 'success');
  }
  function updateSyncPill() {
    const el = $('#syncPill'); if (!el) return;
    const n = state.queue.length;
    el.hidden = !n;
    el.innerHTML = n ? `⏳ ${n} transaksi menunggu dikirim${navigator.onLine ? '…' : ' (offline)'}` : '';
  }

  // Semua transaksi = data sheet + antrean offline
  function allItems() {
    const pending = state.queue.map((q) => Object.assign({}, q, { id: 'q:' + q.qid, pending: true }));
    return pending.concat(state.items);
  }

  // ---------------------------------------------------------
  // Periode & perhitungan
  // ---------------------------------------------------------
  function periodRange(p = state.period) {
    const t = today();
    const d = parse(t);
    let start, end, prevStart, prevEnd, label, prevLabel;
    switch (p.type) {
      case 'hari':
        start = end = t; prevStart = prevEnd = addDays(t, -1); label = 'Hari ini'; prevLabel = 'kemarin'; break;
      case 'minggu': {
        const dow = (d.getDay() + 6) % 7; // Senin = 0
        start = addDays(t, -dow); end = t;
        prevStart = addDays(start, -7); prevEnd = addDays(end, -7);
        label = 'Minggu ini'; prevLabel = 'minggu lalu'; break;
      }
      case 'custom': {
        start = p.start || t; end = p.end || t;
        if (start > end) [start, end] = [end, start];
        const len = diffDays(start, end) + 1;
        prevEnd = addDays(start, -1); prevStart = addDays(prevEnd, -(len - 1));
        label = `${fmtDate(start)} – ${fmtDate(end)}`; prevLabel = 'periode sebelumnya'; break;
      }
      default: { // bulan
        start = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; end = t;
        const pm = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        const lastPm = new Date(d.getFullYear(), d.getMonth(), 0).getDate();
        prevStart = ymd(pm);
        prevEnd = ymd(new Date(pm.getFullYear(), pm.getMonth(), Math.min(d.getDate(), lastPm)));
        label = BULAN_P[d.getMonth()] + ' ' + d.getFullYear(); prevLabel = 'bulan lalu (tanggal yang sama)';
      }
    }
    return { start, end, prevStart, prevEnd, label, prevLabel };
  }

  const inRange = (tx, a, b) => tx.tanggal && tx.tanggal >= a && tx.tanggal <= b;

  function summarize(items) {
    let inc = 0, out = 0;
    for (const t of items) t.type === 'pemasukan' ? (inc += t.nominal) : (out += t.nominal);
    return { inc, out, net: inc - out, count: items.length };
  }

  function byCategory(items, type = 'pengeluaran') {
    const m = new Map();
    for (const t of items) if (t.type === type) m.set(t.kategori || 'Tanpa kategori', (m.get(t.kategori || 'Tanpa kategori') || 0) + t.nominal);
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }

  function pctChange(cur, prev) {
    if (!prev && !cur) return { txt: 'Sama-sama nol', cls: '' };
    if (!prev) return { txt: 'Data baru', cls: '' };
    const p = ((cur - prev) / prev) * 100;
    const arrow = p > 0 ? '▲' : p < 0 ? '▼' : '•';
    return { txt: `${arrow} ${Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0).replace('.', ',')}%`, p };
  }

  function categories(type) {
    const freq = new Map();
    for (const t of allItems()) if (t.type === type && t.kategori) freq.set(t.kategori, (freq.get(t.kategori) || 0) + 1);
    const used = [...freq.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
    const custom = state.prefs.customCats[type] || [];
    const seen = new Set();
    const out = [];
    for (const c of [...used, ...custom, ...DEFAULT_CATS[type]]) {
      const k = c.toLowerCase();
      if (!seen.has(k)) { seen.add(k); out.push(c); }
    }
    return out;
  }

  // ---------------------------------------------------------
  // Grafik SVG ringan (tanpa library)
  // ---------------------------------------------------------
  function donutSVG(data, total) {
    const R = 60, r = 42, C = 75;
    if (!total) return '';
    let a0 = -Math.PI / 2, paths = '';
    data.forEach((d, i) => {
      const frac = d.value / total;
      if (frac <= 0) return;
      const a1 = a0 + frac * Math.PI * 2 - (data.length > 1 ? 0.025 : 0);
      if (frac >= 0.9999) {
        paths += `<circle cx="${C}" cy="${C}" r="${(R + r) / 2}" fill="none" stroke="${d.color}" stroke-width="${R - r}"/>`;
      } else {
        const large = a1 - a0 > Math.PI ? 1 : 0;
        const p = (rad, ang) => `${C + rad * Math.cos(ang)} ${C + rad * Math.sin(ang)}`;
        paths += `<path d="M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z" fill="${d.color}" style="animation:rise .5s ${i * 0.05}s both"/>`;
      }
      a0 += frac * Math.PI * 2;
    });
    return `<svg class="chart" viewBox="0 0 150 150" role="img" aria-label="Grafik donat pengeluaran per kategori">${paths}
      <text x="75" y="70" text-anchor="middle" style="font-size:10px;fill:#6b7088">Total</text>
      <text x="75" y="88" text-anchor="middle" style="font-size:15px;font-weight:800;fill:#141629">${esc(short(total))}</text></svg>`;
  }

  // Grafik batang berkelompok: labels[], series [{name,color,values[]}]
  function barsSVG(labels, series, { height = 170 } = {}) {
    const W = 340, H = height, padL = 34, padB = 22, padT = 8;
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const nice = niceMax(max);
    const cw = (W - padL) / labels.length;
    const bw = Math.min(16, (cw * 0.7) / series.length);
    let g = '';
    for (let i = 0; i <= 3; i++) {
      const y = padT + (H - padB - padT) * (1 - i / 3);
      g += `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" stroke="#eef0f6" stroke-dasharray="${i ? '3 4' : ''}"/>`;
      g += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end">${short((nice * i) / 3)}</text>`;
    }
    const step = Math.ceil(labels.length / 8);
    labels.forEach((l, i) => {
      const cx = padL + cw * i + cw / 2;
      series.forEach((s, j) => {
        const v = s.values[i] || 0;
        const h = ((H - padB - padT) * v) / nice;
        const x = cx - (bw * series.length) / 2 + j * bw + 1;
        if (v > 0) g += `<rect class="bar-anim" style="animation-delay:${i * 0.02}s" x="${x}" y="${H - padB - h}" width="${bw - 2}" height="${Math.max(h, 1.5)}" rx="${Math.min(4, bw / 3)}" fill="${s.color}"><title>${esc(s.name)} ${esc(l)}: ${esc(rp(v))}</title></rect>`;
      });
      if (i % step === 0) g += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
  }

  // Grafik garis: labels[], series [{name,color,values[]}]
  function lineSVG(labels, series, { height = 170 } = {}) {
    const W = 340, H = height, padL = 34, padB = 22, padT = 10;
    const max = Math.max(1, ...series.flatMap((s) => s.values));
    const nice = niceMax(max);
    const n = labels.length;
    const X = (i) => padL + (n === 1 ? (W - padL) / 2 : ((W - padL - 6) * i) / (n - 1));
    const Y = (v) => padT + (H - padB - padT) * (1 - v / nice);
    let g = '<defs>';
    series.forEach((s, k) => { g += `<linearGradient id="lg${k}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".22"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`; });
    g += '</defs>';
    for (let i = 0; i <= 3; i++) {
      const y = padT + (H - padB - padT) * (1 - i / 3);
      g += `<line x1="${padL}" x2="${W}" y1="${y}" y2="${y}" stroke="#eef0f6" stroke-dasharray="${i ? '3 4' : ''}"/>`;
      g += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end">${short((nice * i) / 3)}</text>`;
    }
    series.forEach((s, k) => {
      const pts = s.values.map((v, i) => `${X(i)},${Y(v || 0)}`);
      if (s.fill) g += `<path d="M ${X(0)},${Y(0)} L ${pts.join(' L ')} L ${X(n - 1)},${Y(0)} Z" fill="url(#lg${k})"/>`;
      g += `<polyline class="line-anim" points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="5 5" style="animation:none"' : ''}/>`;
      if (n <= 31) s.values.forEach((v, i) => { if (v > 0) g += `<circle cx="${X(i)}" cy="${Y(v)}" r="2.6" fill="#fff" stroke="${s.color}" stroke-width="1.8"><title>${esc(labels[i])}: ${esc(rp(v))}</title></circle>`; });
    });
    const step = Math.ceil(n / 7);
    labels.forEach((l, i) => { if (i % step === 0 || i === n - 1) g += `<text x="${X(i)}" y="${H - 6}" text-anchor="middle">${esc(l)}</text>`; });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>`;
  }

  function niceMax(v) {
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1.5 ? 1.5 : m <= 3 ? 3 : m <= 6 ? 6 : 10) * p;
  }

  // ---------------------------------------------------------
  // Komponen UI: toast, sheet, dialog
  // ---------------------------------------------------------
  function toast(msg, type = 'success', ms = 2800) {
    const wrap = $('#toasts');
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML = `<span class="t-ic">${type === 'success' ? '✓' : type === 'error' ? '!' : 'i'}</span><span>${esc(msg)}</span>`;
    wrap.appendChild(el);
    if (type === 'error') vibrate([20, 40, 20]);
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, type === 'error' ? ms + 1500 : ms);
  }

  const sheetStack = [];
  function openSheet(html, { dialog = false, onClose } = {}) {
    const host = $('#sheets');
    const bd = document.createElement('div'); bd.className = 'sheet-backdrop';
    const sh = document.createElement('div'); sh.className = 'sheet' + (dialog ? ' dialog' : '');
    sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-modal', 'true');
    sh.innerHTML = (dialog ? '' : '<div class="sheet-handle"></div>') + html;
    host.append(bd, sh);
    requestAnimationFrame(() => { bd.classList.add('show'); sh.classList.add('show'); });
    const entry = { bd, sh, onClose };
    sheetStack.push(entry);
    history.pushState({ sheet: sheetStack.length }, '');
    bd.addEventListener('click', () => closeSheet());
    $$('[data-close]', sh).forEach((b) => b.addEventListener('click', () => closeSheet()));
    enableSwipeDown(sh, dialog);
    return sh;
  }
  function closeSheet() { if (sheetStack.length) history.back(); }
  function removeTopSheet() {
    const e = sheetStack.pop(); if (!e) return;
    e.bd.classList.remove('show'); e.sh.classList.remove('show');
    setTimeout(() => { e.bd.remove(); e.sh.remove(); }, 340);
    if (e.onClose) e.onClose();
  }
  window.addEventListener('popstate', () => { if (sheetStack.length) removeTopSheet(); });

  function enableSwipeDown(sh, dialog) {
    if (dialog) return;
    let y0 = null, dy = 0;
    sh.addEventListener('touchstart', (e) => { if (sh.scrollTop <= 0 && !e.target.closest('input,textarea,select,.chips,.cat-grid,.quick-amt')) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
    sh.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); sh.style.transition = 'none'; sh.style.transform = `translate(-50%, ${dy}px)`; }, { passive: true });
    sh.addEventListener('touchend', () => { if (y0 === null) return; sh.style.transition = ''; sh.style.transform = ''; if (dy > 110) closeSheet(); y0 = null; });
  }

  function confirmDialog({ title, text, okText = 'Ya', danger = true, icon = '🗑️' }) {
    return new Promise((resolve) => {
      let answered = false;
      const sh = openSheet(`
        <div class="dialog-ic">${icon}</div>
        <h3>${esc(title)}</h3><p>${text}</p>
        <button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-ok>${esc(okText)}</button>
        <button class="btn btn-soft" data-close>Batal</button>`, { dialog: true, onClose: () => { if (!answered) resolve(false); } });
      $('[data-ok]', sh).addEventListener('click', () => { answered = true; resolve(true); closeSheet(); });
    });
  }

  // ---------------------------------------------------------
  // Form tambah / edit transaksi
  // ---------------------------------------------------------
  function openTxForm(existing = null, presetType = null) {
    const isEdit = !!existing;
    const f = {
      type: existing ? existing.type : (presetType || state.prefs.lastType || 'pengeluaran'),
      nominal: existing ? existing.nominal : 0,
      kategori: existing ? existing.kategori : '',
      tanggal: existing ? (existing.tanggal || today()) : today(),
      catatan: existing ? existing.catatan : ''
    };

    const sh = openSheet(`
      <div class="sheet-head"><h3>${isEdit ? 'Edit Transaksi' : 'Tambah Transaksi'}</h3><button class="sheet-close" data-close aria-label="Tutup">×</button></div>
      <div class="segmented" data-v="${f.type}" id="fType" ${isEdit ? 'aria-disabled="true"' : ''}>
        <span class="thumb"></span>
        <button type="button" data-v="pengeluaran">Pengeluaran</button>
        <button type="button" data-v="pemasukan">Pemasukan</button>
      </div>
      ${isEdit ? '<p class="err" style="color:var(--faint)">Jenis tidak bisa diubah saat edit. Hapus lalu buat baru jika salah jenis.</p>' : ''}

      <div class="field">
        <label for="fAmt">Nominal</label>
        <div class="amount-wrap" id="amtWrap"><span>Rp</span>
          <input id="fAmt" class="amount-input num" inputmode="numeric" autocomplete="off" placeholder="0" value="${f.nominal ? nf.format(f.nominal) : ''}" aria-describedby="eAmt">
        </div>
        <div class="quick-amt" id="quickAmt">${[10000, 20000, 50000, 100000, 500000, 1000000].map((v) => `<button type="button" data-v="${v}">+${short(v)}</button>`).join('')}</div>
        <p class="err" id="eAmt" role="alert"></p>
      </div>

      <div class="field">
        <span class="label">Kategori</span>
        <div class="cat-grid" id="catGrid"></div>
        <p class="err" id="eCat" role="alert"></p>
      </div>

      <div class="field">
        <label for="fDate">Tanggal</label>
        <div class="date-chips" id="dateChips">
          <button type="button" class="chip" data-d="0">Hari ini</button>
          <button type="button" class="chip" data-d="-1">Kemarin</button>
        </div>
        <input id="fDate" type="date" class="input" value="${f.tanggal}" max="${addDays(today(), 366)}">
      </div>

      <div class="field">
        <label for="fNote">Catatan <span style="font-weight:400;color:var(--faint)">(opsional)</span></label>
        <textarea id="fNote" class="input" rows="1" maxlength="300" placeholder="mis. makan siang bareng tim">${esc(f.catatan)}</textarea>
      </div>

      <div class="save-bar"><button class="btn btn-primary" id="fSave">${isEdit ? 'Simpan Perubahan' : 'Simpan'}</button></div>
    `);

    const amt = $('#fAmt', sh), seg = $('#fType', sh), grid = $('#catGrid', sh), date = $('#fDate', sh);

    const renderCats = () => {
      const cats = categories(f.type);
      if (f.kategori && !cats.some((c) => c.toLowerCase() === f.kategori.toLowerCase())) cats.unshift(f.kategori);
      grid.innerHTML = cats.slice(0, 14).map((c) => `<button type="button" class="cat-chip ${c === f.kategori ? 'active' : ''}" data-c="${esc(c)}">${iconFor(c, f.type)} ${esc(c)}</button>`).join('') +
        (cats.length > 14 ? `<button type="button" class="cat-chip add" data-more>Lainnya…</button>` : '') +
        `<button type="button" class="cat-chip add" data-new>＋ Baru</button>`;
    };
    renderCats();

    const syncDateChips = () => $$('#dateChips .chip', sh).forEach((c) => c.classList.toggle('active', addDays(today(), Number(c.dataset.d)) === date.value));
    syncDateChips();

    if (!isEdit) {
      seg.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        f.type = b.dataset.v; seg.dataset.v = f.type; f.kategori = ''; renderCats(); vibrate(8);
      });
    }

    amt.addEventListener('input', () => {
      const digits = amt.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 13);
      f.nominal = Number(digits || 0);
      amt.value = digits ? nf.format(f.nominal) : '';
      $('#amtWrap', sh).classList.remove('invalid'); $('#eAmt', sh).textContent = '';
    });
    $('#quickAmt', sh).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      f.nominal = (f.nominal || 0) + Number(b.dataset.v);
      amt.value = nf.format(f.nominal); $('#amtWrap', sh).classList.remove('invalid'); $('#eAmt', sh).textContent = ''; vibrate(6);
    });

    grid.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-new') || b.hasAttribute('data-more')) {
        const name = await promptCategory(f.type, b.hasAttribute('data-more'));
        if (name) { f.kategori = name; renderCats(); }
        return;
      }
      f.kategori = b.dataset.c; vibrate(6);
      $$('.cat-chip', grid).forEach((c) => c.classList.toggle('active', c === b));
      grid.classList.remove('invalid'); $('#eCat', sh).textContent = '';
    });

    $('#dateChips', sh).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      date.value = addDays(today(), Number(b.dataset.d)); syncDateChips();
    });
    date.addEventListener('change', syncDateChips);
    const note = $('#fNote', sh);
    const autoGrow = () => { note.style.height = 'auto'; note.style.height = Math.min(note.scrollHeight, 140) + 'px'; };
    note.addEventListener('input', autoGrow);

    const save = $('#fSave', sh);
    save.addEventListener('click', async () => {
      // validasi
      let ok = true;
      if (!f.nominal || f.nominal <= 0) { ok = false; $('#amtWrap', sh).classList.add('invalid'); $('#eAmt', sh).textContent = 'Nominal wajib diisi dan harus lebih dari 0.'; }
      if (!f.kategori) { ok = false; grid.classList.add('invalid'); $('#eCat', sh).textContent = 'Pilih salah satu kategori.'; }
      if (!date.value) { ok = false; date.classList.add('invalid'); }
      if (!ok) { vibrate([20, 40, 20]); return; }

      const tx = { type: f.type, nominal: f.nominal, kategori: f.kategori, tanggal: date.value, catatan: note.value.trim() };
      save.disabled = true; save.innerHTML = '<span class="spinner"></span> Menyimpan…';
      try {
        if (isEdit && existing.pending) {
          const q = state.queue.find((x) => 'q:' + x.qid === existing.id);
          if (q) Object.assign(q, tx); saveQueue();
          toast('Transaksi offline diperbarui', 'success');
        } else if (isEdit) {
          await api('update', { tx: Object.assign({}, tx, { row: existing.row, fp: existing.fp }) });
          toast('Perubahan tersimpan ke sheet', 'success');
        } else {
          await api('add', { tx });
          toast(`${f.type === 'pemasukan' ? 'Pemasukan' : 'Pengeluaran'} ${rp(f.nominal)} tersimpan`, 'success');
        }
        state.prefs.lastType = f.type; store.set(LS.prefs, state.prefs);
        vibrate(15);
        closeSheet();
        loadData({ silent: true });
      } catch (e) {
        if (e instanceof NetworkError && !isEdit) {
          state.queue.push(Object.assign({ qid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }, tx));
          saveQueue();
          state.prefs.lastType = f.type; store.set(LS.prefs, state.prefs);
          toast('Offline — transaksi disimpan di HP dan akan dikirim otomatis saat online', 'info', 4000);
          closeSheet(); render();
        } else {
          toast('Gagal menyimpan: ' + e.message, 'error');
          save.disabled = false; save.textContent = isEdit ? 'Simpan Perubahan' : 'Simpan';
        }
      }
    });

    if (!isEdit) setTimeout(() => amt.focus(), 360);
  }

  function promptCategory(type, showAll) {
    return new Promise((resolve) => {
      let done = false;
      const all = categories(type);
      const sh = openSheet(`
        <div class="sheet-head"><h3>${showAll ? 'Pilih Kategori' : 'Kategori Baru'}</h3><button class="sheet-close" data-close aria-label="Tutup">×</button></div>
        <input class="input" id="newCat" maxlength="40" placeholder="Ketik nama kategori…" autocomplete="off">
        <div class="cat-grid" id="catAll" style="margin-top:12px">${all.map((c) => `<button type="button" class="cat-chip" data-c="${esc(c)}">${iconFor(c, type)} ${esc(c)}</button>`).join('')}</div>
        <div class="field"><button class="btn btn-primary" id="useCat">Pakai Kategori</button></div>`, { onClose: () => { if (!done) resolve(null); } });
      const inp = $('#newCat', sh);
      const finish = (name) => {
        name = (name || '').trim().replace(/\s+/g, ' ');
        if (!name) { inp.classList.add('invalid'); return; }
        const exist = all.find((c) => c.toLowerCase() === name.toLowerCase());
        if (!exist) {
          const list = state.prefs.customCats[type] || (state.prefs.customCats[type] = []);
          list.unshift(name); store.set(LS.prefs, state.prefs);
        }
        done = true; resolve(exist || name); closeSheet();
      };
      inp.addEventListener('input', () => {
        const q = inp.value.trim().toLowerCase(); inp.classList.remove('invalid');
        $$('#catAll .cat-chip', sh).forEach((b) => { b.hidden = q && !b.dataset.c.toLowerCase().includes(q); });
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(inp.value); });
      $('#catAll', sh).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) finish(b.dataset.c); });
      $('#useCat', sh).addEventListener('click', () => finish(inp.value));
      setTimeout(() => inp.focus(), 360);
    });
  }

  // Detail transaksi → edit / hapus
  function openDetail(tx) {
    const isIn = tx.type === 'pemasukan';
    const sh = openSheet(`
      <div class="sheet-head"><h3>Detail Transaksi</h3><button class="sheet-close" data-close aria-label="Tutup">×</button></div>
      <div style="display:flex;align-items:center;gap:12px">
        <div class="tx-ic ${isIn ? 'in' : 'out'}">${iconFor(tx.kategori, tx.type)}</div>
        <div><strong>${esc(tx.kategori || 'Tanpa kategori')}</strong><div style="font-size:13px;color:var(--muted)">${isIn ? 'Pemasukan' : 'Pengeluaran'}${tx.pending ? ' · <span class="badge-pending">Belum terkirim</span>' : ''}</div></div>
      </div>
      <div class="detail-amt num" style="color:${isIn ? 'var(--in)' : 'var(--text)'}">${isIn ? '+' : '−'} ${rp(tx.nominal)}</div>
      <dl class="detail-list">
        <div><dt>Tanggal</dt><dd>${esc(fmtDate(tx.tanggal, true))}</dd></div>
        <div><dt>Catatan</dt><dd>${esc(tx.catatan || '—')}</dd></div>
        <div><dt>Lokasi di sheet</dt><dd>${tx.pending ? 'Menunggu dikirim' : `${isIn ? 'Pemasukan' : 'Pengeluaran'}, baris ${tx.row}`}</dd></div>
      </dl>
      <div class="row-2">
        <button class="btn btn-soft" id="dEdit">✏️ Edit</button>
        <button class="btn btn-danger" id="dDel" style="margin-top:0">🗑️ Hapus</button>
      </div>`);

    $('#dEdit', sh).addEventListener('click', () => { closeSheet(); setTimeout(() => openTxForm(tx), 360); });
    $('#dDel', sh).addEventListener('click', async () => {
      const yes = await confirmDialog({
        title: 'Hapus transaksi ini?',
        text: `<b>${esc(tx.kategori)}</b> · ${esc(rp(tx.nominal))} · ${esc(fmtDate(tx.tanggal))}<br>Baris ini akan dihapus permanen dari sheet ${isIn ? 'Pemasukan' : 'Pengeluaran'}.`,
        okText: 'Ya, Hapus'
      });
      if (!yes) return;
      const btn = $('#dDel', sh); btn.disabled = true; btn.innerHTML = '<span class="spinner" style="border-color:rgba(224,71,91,.3);border-top-color:var(--out)"></span>';
      try {
        if (tx.pending) {
          state.queue = state.queue.filter((x) => 'q:' + x.qid !== tx.id); saveQueue();
        } else {
          await api('delete', { tx: { type: tx.type, row: tx.row, fp: tx.fp } });
          state.items = state.items.filter((x) => x.id !== tx.id);
        }
        toast('Transaksi dihapus', 'success');
        closeSheet();
        render();
        if (!tx.pending) loadData({ silent: true });
      } catch (e) {
        toast('Gagal menghapus: ' + e.message, 'error');
        btn.disabled = false; btn.textContent = '🗑️ Hapus';
      }
    });
  }

  // ---------------------------------------------------------
  // Render halaman
  // ---------------------------------------------------------
  const TITLES = { home: 'Beranda', riwayat: 'Riwayat', analisis: 'Analisis', setelan: 'Setelan' };

  function render() {
    if (!state.cfg) return;
    $('#topbarTitle').textContent = TITLES[state.route];
    const h = new Date().getHours();
    $('#topbarSub').textContent = state.route === 'home'
      ? (h < 11 ? 'Selamat pagi ☀️' : h < 15 ? 'Selamat siang 🌤️' : h < 19 ? 'Selamat sore 🌇' : 'Selamat malam 🌙')
      : ({ setelan: 'Pengaturan aplikasi', riwayat: 'Semua transaksi' }[state.route] || periodRange().label);
    $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.route === state.route));
    updateSyncPill();
    const v = $('#view');
    const firstLoad = state.loading && !state.loadedAt && !state.queue.length;
    if (firstLoad && state.route !== 'setelan') { v.innerHTML = skeleton(); return; }
    ({ home: renderHome, riwayat: renderHistory, analisis: renderAnalysis, setelan: renderSettings })[state.route](v);
  }

  function skeleton() {
    return `<div class="skel" style="height:190px;border-radius:26px"></div>
      <div class="insights" style="margin-top:14px"><div class="skel" style="height:98px"></div><div class="skel" style="height:98px"></div></div>
      <div class="skel" style="height:64px;margin-top:22px"></div><div class="skel" style="height:64px;margin-top:8px"></div><div class="skel" style="height:64px;margin-top:8px"></div>`;
  }

  function periodChips() {
    const t = state.period.type;
    const p = periodRange();
    return `<div class="chips" id="periodChips">
      ${[['hari', 'Hari ini'], ['minggu', 'Minggu ini'], ['bulan', 'Bulan ini'], ['custom', t === 'custom' ? '📅 ' + p.label : '📅 Custom']].map(([k, l]) => `<button class="chip ${t === k ? 'active' : ''}" data-p="${k}">${esc(l)}</button>`).join('')}
    </div>`;
  }
  function bindPeriodChips(v) {
    $('#periodChips', v)?.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.p === 'custom') return openCustomPeriod();
      state.period = { type: b.dataset.p }; render();
    });
  }
  function openCustomPeriod() {
    const p = periodRange();
    const sh = openSheet(`
      <div class="sheet-head"><h3>Pilih Periode</h3><button class="sheet-close" data-close aria-label="Tutup">×</button></div>
      <div class="chips" id="presetP">
        <button class="chip" data-r="7">7 hari</button><button class="chip" data-r="30">30 hari</button>
        <button class="chip" data-r="lm">Bulan lalu</button><button class="chip" data-r="90">3 bulan</button><button class="chip" data-r="yr">Tahun ini</button>
      </div>
      <div class="row-2" style="margin-top:12px">
        <div><label class="label" for="cpA">Dari</label><input type="date" id="cpA" class="input" value="${state.period.type === 'custom' ? p.start : addDays(today(), -29)}"></div>
        <div><label class="label" for="cpB">Sampai</label><input type="date" id="cpB" class="input" value="${state.period.type === 'custom' ? p.end : today()}"></div>
      </div>
      <div class="field"><button class="btn btn-primary" id="cpOk">Terapkan</button></div>`);
    $('#presetP', sh).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const t = today(), d = parse(t);
      let a = t, z = t;
      if (b.dataset.r === 'lm') { a = ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)); z = ymd(new Date(d.getFullYear(), d.getMonth(), 0)); }
      else if (b.dataset.r === 'yr') { a = `${d.getFullYear()}-01-01`; }
      else a = addDays(t, -(Number(b.dataset.r) - 1));
      $('#cpA', sh).value = a; $('#cpB', sh).value = z;
    });
    $('#cpOk', sh).addEventListener('click', () => {
      const a = $('#cpA', sh).value, z = $('#cpB', sh).value;
      if (!a || !z) return toast('Isi kedua tanggal', 'error');
      state.period = { type: 'custom', start: a <= z ? a : z, end: a <= z ? z : a };
      closeSheet(); setTimeout(render, 50);
    });
  }

  function txRow(t) {
    const isIn = t.type === 'pemasukan';
    return `<button class="tx" data-id="${esc(t.id)}">
      <div class="tx-ic ${isIn ? 'in' : 'out'}">${iconFor(t.kategori, t.type)}</div>
      <div class="tx-main"><strong>${esc(t.kategori || 'Tanpa kategori')}${t.pending ? '<span class="badge-pending">offline</span>' : ''}</strong><span>${esc(t.catatan || (isIn ? 'Pemasukan' : 'Pengeluaran'))}</span></div>
      <div class="tx-amt num ${isIn ? 'in' : 'out'}">${isIn ? '+' : '−'}${esc(rp(t.nominal))}</div>
    </button>`;
  }
  function bindTxClicks(v) {
    v.addEventListener('click', (e) => {
      const b = e.target.closest('.tx'); if (!b) return;
      const t = allItems().find((x) => x.id === b.dataset.id);
      if (t) openDetail(t);
    });
  }

  function emptyState(icon, title, text, withBtn = true) {
    return `<div class="empty"><div class="empty-art">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>
      ${withBtn ? '<button class="btn btn-primary" data-add>＋ Tambah Transaksi</button>' : ''}</div>`;
  }

  function computeInsights(items, p) {
    const cur = items.filter((t) => inRange(t, p.start, p.end));
    const prev = items.filter((t) => inRange(t, p.prevStart, p.prevEnd));
    const s = summarize(cur), sp = summarize(prev);
    const cats = byCategory(cur);
    const days = Math.max(1, diffDays(p.start, p.end < today() ? p.end : today()) + 1);
    const biggest = cur.filter((t) => t.type === 'pengeluaran').sort((a, b) => b.nominal - a.nominal)[0];
    return { cur, s, sp, cats, avg: Math.round(s.out / days), days, biggest, chgOut: pctChange(s.out, sp.out), chgIn: pctChange(s.inc, sp.inc) };
  }

  function insightCards(ins, p) {
    const top = ins.cats[0];
    const chg = ins.chgOut;
    return `<div class="insights">
      <div class="insight"><div class="ic">🏆</div><p>Pengeluaran terbesar</p>
        <strong>${top ? esc(top.label) : '—'}</strong><small class="num">${top ? `${esc(rp(top.value))} · ${Math.round((top.value / ins.s.out) * 100)}%` : 'Belum ada pengeluaran'}</small></div>
      <div class="insight"><div class="ic">📆</div><p>Rata-rata harian</p>
        <strong class="num">${esc(rp(ins.avg))}</strong><small>${ins.days} hari</small></div>
      <div class="insight"><div class="ic">📊</div><p>Pengeluaran vs ${esc(p.prevLabel.replace(' (tanggal yang sama)', ''))}</p>
        <strong class="num ${chg.p > 0 ? 'up' : chg.p < 0 ? 'down' : ''}">${esc(chg.txt)}</strong><small class="num">sebelumnya ${esc(rp(ins.sp.out))}</small></div>
      <div class="insight"><div class="ic">💎</div><p>Pemasukan vs ${esc(p.prevLabel.replace(' (tanggal yang sama)', ''))}</p>
        <strong class="num ${ins.chgIn.p > 0 ? 'down' : ins.chgIn.p < 0 ? 'up' : ''}">${esc(ins.chgIn.txt)}</strong><small class="num">sebelumnya ${esc(rp(ins.sp.inc))}</small></div>
    </div>`;
  }

  function renderHome(v) {
    const items = allItems();
    const p = periodRange();
    const ins = computeInsights(items, p);
    const recent = items.slice().sort(sortTx).slice(0, 6);

    v.innerHTML = `
      ${periodChips()}
      <section class="hero" style="margin-top:8px">
        <p class="hero-label">Saldo bersih · ${esc(p.label)}</p>
        <div class="hero-value num">${esc(rpSigned(ins.s.net))}</div>
        <div class="hero-row">
          <div class="hero-stat"><p><span class="dot" style="background:#7ff0df"></span>Pemasukan</p><strong class="num">${esc(rp(ins.s.inc))}</strong></div>
          <div class="hero-stat"><p><span class="dot" style="background:#ffb3c0"></span>Pengeluaran</p><strong class="num">${esc(rp(ins.s.out))}</strong></div>
        </div>
      </section>
      <div class="section-title"><h2>Insight</h2><button class="link" data-go="analisis">Lihat grafik</button></div>
      ${insightCards(ins, p)}
      <div class="section-title"><h2>Transaksi terbaru</h2>${recent.length ? '<button class="link" data-go="riwayat">Semua</button>' : ''}</div>
      ${recent.length ? `<div class="tx-list">${recent.map(txRow).join('')}</div>`
        : emptyState('🪙', 'Belum ada transaksi', 'Catat pemasukan atau pengeluaran pertamamu. Cuma butuh beberapa detik.')}
      ${state.loadedAt ? `<p class="foot-note">Terakhir sinkron ${esc(new Date(state.loadedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }))}</p>` : ''}
    `;
    bindPeriodChips(v); bindCommon(v);
  }

  const sortTx = (a, b) => {
    if (a.pending !== b.pending) return a.pending ? -1 : 1;
    if ((a.tanggal || '') !== (b.tanggal || '')) return (a.tanggal || '') < (b.tanggal || '') ? 1 : -1;
    return (b.row || 0) - (a.row || 0);
  };

  function filteredHistory() {
    const F = state.filters;
    const q = F.q.trim().toLowerCase();
    return allItems().filter((t) => {
      if (F.type !== 'semua' && t.type !== F.type) return false;
      if (F.kategori && t.kategori !== F.kategori) return false;
      if (F.from && (!t.tanggal || t.tanggal < F.from)) return false;
      if (F.to && (!t.tanggal || t.tanggal > F.to)) return false;
      if (q) {
        const hay = `${t.kategori} ${t.catatan} ${t.nominal} ${nf.format(t.nominal)} ${fmtDate(t.tanggal)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort(sortTx);
  }

  function historyResults() {
    const list = filteredHistory();
    const total = allItems().length;
    const s = summarize(list);
    const shown = list.slice(0, state.historyLimit);
    const groups = [];
    for (const t of shown) {
      const k = t.pending ? '__pending' : (t.tanggal || '');
      let g = groups[groups.length - 1];
      if (!g || g.k !== k) groups.push(g = { k, items: [] });
      g.items.push(t);
    }
    return `<div class="result-info"><span>${list.length} transaksi</span><span class="num"><span style="color:var(--in)">+${esc(short(s.inc))}</span> · <span style="color:var(--out)">−${esc(short(s.out))}</span></span></div>
      ${list.length ? groups.map((g) => {
        const gs = summarize(g.items);
        return `<div class="tx-group-title"><span>${g.k === '__pending' ? '⏳ Menunggu dikirim' : esc(relDate(g.k))}</span><span class="num">${gs.out ? '−' + esc(short(gs.out)) : ''}${gs.inc && gs.out ? ' · ' : ''}${gs.inc ? '+' + esc(short(gs.inc)) : ''}</span></div>
          <div class="tx-list">${g.items.map(txRow).join('')}</div>`;
      }).join('') + (list.length > shown.length ? `<div class="field"><button class="btn btn-soft" data-more>Tampilkan lebih banyak (${list.length - shown.length} lagi)</button></div>` : '')
        : (total ? emptyState('🔍', 'Tidak ditemukan', 'Coba ubah kata kunci atau filter pencarian.', false) + '<div style="text-align:center"><button class="link" data-reset>Reset filter</button></div>'
          : emptyState('📭', 'Riwayat masih kosong', 'Transaksi yang kamu catat akan muncul di sini.'))}`;
  }

  function renderHistory(v) {
    const F = state.filters;
    const cats = [...new Set(allItems().map((t) => t.kategori).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
    const activeFilters = (F.kategori ? 1 : 0) + (F.from || F.to ? 1 : 0);

    v.innerHTML = `
      <div class="search">
        <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input class="input" id="hq" type="search" placeholder="Cari kategori, catatan, nominal…" value="${esc(F.q)}" autocomplete="off" enterkeyhint="search">
      </div>
      <div class="filter-row">
        <div class="chips" id="htype" style="padding:0;flex:1">
          ${[['semua', 'Semua'], ['pengeluaran', 'Keluar'], ['pemasukan', 'Masuk']].map(([k, l]) => `<button class="chip ${F.type === k ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}
        </div>
        <button class="filter-btn ${activeFilters ? 'on' : ''}" id="hfilter">⚙︎ Filter${activeFilters ? ` (${activeFilters})` : ''}</button>
      </div>
      <div id="hres">${historyResults()}</div>`;

    const res = $('#hres', v);
    const refresh = () => { res.innerHTML = historyResults(); bindCommon(res); };
    bindCommon(res);
    const hq = $('#hq', v);
    let tmr;
    hq.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { F.q = hq.value; state.historyLimit = 60; refresh(); }, 200); });
    $('#htype', v).addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      F.type = b.dataset.t; state.historyLimit = 60;
      $$('#htype .chip', v).forEach((c) => c.classList.toggle('active', c === b)); refresh();
    });
    res.addEventListener('click', (e) => {
      if (e.target.closest('[data-more]')) { state.historyLimit += 60; refresh(); }
      if (e.target.closest('[data-reset]')) { Object.assign(F, { q: '', type: 'semua', kategori: '', from: '', to: '' }); renderHistory(v); }
    });
    $('#hfilter', v).addEventListener('click', () => {
      const sh = openSheet(`
        <div class="sheet-head"><h3>Filter Riwayat</h3><button class="sheet-close" data-close aria-label="Tutup">×</button></div>
        <label class="label" for="fk">Kategori</label>
        <select id="fk" class="input"><option value="">Semua kategori</option>${cats.map((c) => `<option value="${esc(c)}" ${c === F.kategori ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <div class="row-2" style="margin-top:14px">
          <div><label class="label" for="ff">Dari tanggal</label><input type="date" id="ff" class="input" value="${F.from}"></div>
          <div><label class="label" for="ft">Sampai</label><input type="date" id="ft" class="input" value="${F.to}"></div>
        </div>
        <div class="field"><button class="btn btn-primary" id="fapply">Terapkan</button><button class="btn btn-soft" id="fclear">Hapus filter</button></div>`);
      $('#fapply', sh).addEventListener('click', () => { F.kategori = $('#fk', sh).value; F.from = $('#ff', sh).value; F.to = $('#ft', sh).value; state.historyLimit = 60; closeSheet(); setTimeout(() => renderHistory(v), 50); });
      $('#fclear', sh).addEventListener('click', () => { F.kategori = ''; F.from = ''; F.to = ''; closeSheet(); setTimeout(() => renderHistory(v), 50); });
    });
  }

  function renderAnalysis(v) {
    const items = allItems();
    const p = periodRange();
    const ins = computeInsights(items, p);
    const cats = ins.cats;
    const totalOut = ins.s.out;
    const topN = cats.slice(0, 7);
    if (cats.length > 7) topN.push({ label: 'Lainnya', value: cats.slice(7).reduce((a, b) => a + b.value, 0) });
    topN.forEach((c, i) => { c.color = PALETTE[i % PALETTE.length]; });

    // Tren
    const mode = state.prefs.trendMode;
    let tLabels = [], tOut = [], tIn = [];
    const spanDays = diffDays(p.start, p.end) + 1;
    if (mode === 'harian' && spanDays <= 92) {
      const len = Math.max(spanDays, p.type === 'hari' ? 7 : spanDays);
      const start = p.type === 'hari' ? addDays(p.end, -6) : p.start;
      const idx = {};
      for (let i = 0; i < len; i++) { const d = addDays(start, i); idx[d] = i; const dd = parse(d); tLabels.push(len <= 7 ? HARI[dd.getDay()].slice(0, 3) : String(dd.getDate())); tOut.push(0); tIn.push(0); }
      for (const t of items) if (t.tanggal in idx) (t.type === 'pengeluaran' ? tOut : tIn)[idx[t.tanggal]] += t.nominal;
    } else {
      const end = parse(p.end);
      const idx = {};
      for (let i = 11; i >= 0; i--) {
        const d = new Date(end.getFullYear(), end.getMonth() - i, 1);
        idx[`${d.getFullYear()}-${pad(d.getMonth() + 1)}`] = tLabels.length;
        tLabels.push(BULAN[d.getMonth()]); tOut.push(0); tIn.push(0);
      }
      for (const t of items) { const k = (t.tanggal || '').slice(0, 7); if (k in idx) (t.type === 'pengeluaran' ? tOut : tIn)[idx[k]] += t.nominal; }
    }

    // Pemasukan vs pengeluaran 6 bulan terakhir
    const now = parse(today());
    const mLabels = [], mIn = [], mOut = [], midx = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      midx[`${d.getFullYear()}-${pad(d.getMonth() + 1)}`] = mLabels.length;
      mLabels.push(BULAN[d.getMonth()]); mIn.push(0); mOut.push(0);
    }
    for (const t of items) { const k = (t.tanggal || '').slice(0, 7); if (k in midx) (t.type === 'pemasukan' ? mIn : mOut)[midx[k]] += t.nominal; }
    const hasMonthly = mIn.some(Boolean) || mOut.some(Boolean);
    const hasTrend = tOut.some(Boolean) || tIn.some(Boolean);

    v.innerHTML = `
      ${periodChips()}
      <section class="card chart-card" style="margin-top:8px">
        <h3>Pengeluaran per kategori</h3><p class="sub">${esc(p.label)} · ${esc(rp(totalOut))}</p>
        ${totalOut ? `<div class="donut-wrap">${donutSVG(topN, totalOut)}
          <ul class="legend">${topN.map((c) => `<li><span class="dot" style="background:${c.color}"></span><span>${esc(c.label)}</span><b class="num">${Math.round((c.value / totalOut) * 100)}%</b></li>`).join('')}</ul></div>
          <div class="cat-bars" style="margin-top:16px">${topN.map((c) => `<div><div class="cat-bar-top"><span>${iconFor(c.label)} ${esc(c.label)}</span><b class="num">${esc(rp(c.value))}</b></div>
            <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${(c.value / topN[0].value) * 100}%;background:${c.color}"></div></div></div>`).join('')}</div>`
        : emptyState('🥧', 'Belum ada pengeluaran', 'Tidak ada pengeluaran di periode ini.', false)}
      </section>

      <section class="card chart-card" style="margin-top:14px">
        <div class="chart-head"><div><h3>Tren</h3><p class="sub">${mode === 'harian' && spanDays <= 92 ? (p.type === 'hari' ? '7 hari terakhir' : 'Per hari · ' + esc(p.label)) : '12 bulan terakhir'}</p></div>
          <div class="mini-seg" id="tmode"><button class="${mode === 'harian' ? 'active' : ''}" data-m="harian">Harian</button><button class="${mode === 'bulanan' ? 'active' : ''}" data-m="bulanan">Bulanan</button></div></div>
        ${hasTrend ? lineSVG(tLabels, [{ name: 'Pengeluaran', color: '#e0475b', values: tOut, fill: true }, { name: 'Pemasukan', color: '#0fb5a6', values: tIn }])
          + '<div class="legend-inline"><span><i class="dot" style="background:#e0475b"></i>Pengeluaran</span><span><i class="dot" style="background:#0fb5a6"></i>Pemasukan</span></div>'
          : emptyState('📈', 'Belum ada data', 'Grafik tren muncul setelah ada transaksi.', false)}
      </section>

      <section class="card chart-card" style="margin-top:14px">
        <h3>Pemasukan vs Pengeluaran</h3><p class="sub">6 bulan terakhir</p>
        ${hasMonthly ? barsSVG(mLabels, [{ name: 'Pemasukan', color: '#0fb5a6', values: mIn }, { name: 'Pengeluaran', color: '#7c3aed', values: mOut }])
          + '<div class="legend-inline"><span><i class="dot" style="background:#0fb5a6"></i>Pemasukan</span><span><i class="dot" style="background:#7c3aed"></i>Pengeluaran</span></div>'
          + `<div class="cat-bars" style="margin-top:14px">${mLabels.map((l, i) => ({ l, net: mIn[i] - mOut[i] })).slice(-3).reverse().map((r) => `<div class="cat-bar-top"><span>Selisih ${esc(r.l)}</span><b class="num" style="color:${r.net >= 0 ? 'var(--in)' : 'var(--out)'}">${esc(rpSigned(r.net))}</b></div>`).join('')}</div>`
          : emptyState('📊', 'Belum ada data', 'Perbandingan bulanan muncul setelah ada transaksi.', false)}
      </section>

      <div class="section-title"><h2>Insight</h2></div>
      ${insightCards(ins, p)}
      ${ins.biggest ? `<div class="card" style="margin-top:10px;display:flex;gap:12px;align-items:center"><div class="tx-ic out">${iconFor(ins.biggest.kategori)}</div>
        <div class="tx-main"><span>Transaksi pengeluaran terbesar</span><strong>${esc(ins.biggest.kategori)} · ${esc(fmtDate(ins.biggest.tanggal))}</strong></div><b class="num">${esc(rp(ins.biggest.nominal))}</b></div>` : ''}
    `;
    bindPeriodChips(v);
    $('#tmode', v).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; state.prefs.trendMode = b.dataset.m; store.set(LS.prefs, state.prefs); renderAnalysis(v); });
    bindCommon(v);
  }

  function renderSettings(v) {
    const meta = state.cfg.meta || {};
    const pinOn = !!store.get(LS.pin, null);
    const col = (t) => meta.sheets && meta.sheets[t] ? meta.sheets[t].kolom : null;
    const mapRows = (t) => {
      const c = col(t); if (!c) return '<tr><td colspan="2" style="color:var(--muted)">Tekan "Tes koneksi" untuk melihat</td></tr>';
      return [['Tanggal', c.tanggal], ['Nominal', c.nominal], ['Kategori', c.kategori], ['Catatan', c.catatan]].map(([a, b]) => `<tr><td>${a}</td><td>${b ? esc(b) : '<span style="color:var(--out)">tidak ada</span>'}</td></tr>`).join('');
    };
    v.innerHTML = `
      <div class="section-title" style="margin-top:6px"><h2>Koneksi Google Sheets</h2></div>
      <div class="card">
        <div style="display:flex;align-items:center;gap:10px"><div class="tx-ic in">📗</div><div class="tx-main"><strong>${esc(meta.spreadsheet || 'Spreadsheet terhubung')}</strong><span>${state.items.length} transaksi terbaca</span></div></div>
        <div class="row-2" style="margin-top:12px">
          <div><span class="label">Sheet Pemasukan</span><table class="map-table">${mapRows('pemasukan')}</table></div>
          <div><span class="label">Sheet Pengeluaran</span><table class="map-table">${mapRows('pengeluaran')}</table></div>
        </div>
        <div class="row-2" style="margin-top:14px"><button class="btn btn-soft" id="sPing" style="height:48px;font-size:14.5px">🔌 Tes koneksi</button><button class="btn btn-soft" id="sSync" style="height:48px;font-size:14.5px;margin-top:0">🔄 Sinkron</button></div>
      </div>

      <div class="section-title"><h2>Keamanan</h2></div>
      <div class="set-group">
        <button class="set-item" id="sPin"><div class="ic">🔒</div><div class="tx-main"><strong>Kunci PIN</strong><span>Minta PIN setiap aplikasi dibuka</span></div><span class="switch ${pinOn ? 'on' : ''}"></span></button>
        <button class="set-item" id="sLogout"><div class="ic">🚪</div><div class="tx-main"><strong>Putuskan koneksi di HP ini</strong><span>Hapus URL, kunci, dan data tersimpan di HP ini. Data di sheet tetap aman.</span></div><span class="chev">›</span></button>
      </div>

      <div class="section-title"><h2>Kategori</h2></div>
      <div class="set-group">
        <button class="set-item" id="sCats"><div class="ic">🏷️</div><div class="tx-main"><strong>Kategori buatanku</strong><span>${(state.prefs.customCats.pengeluaran.length + state.prefs.customCats.pemasukan.length)} kategori tambahan. Kategori dari sheet terbaca otomatis.</span></div><span class="chev">›</span></button>
      </div>

      ${state.queue.length ? `<div class="section-title"><h2>Antrean offline</h2></div>
      <div class="set-group"><button class="set-item" id="sFlush"><div class="ic">⏳</div><div class="tx-main"><strong>${state.queue.length} transaksi belum terkirim</strong><span>Ketuk untuk kirim sekarang</span></div><span class="chev">›</span></button></div>` : ''}

      <p class="foot-note">Catatku v1.0 · Data tersimpan di Google Sheets milikmu</p>
    `;
    $('#sPing', v).addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Mengecek…';
      try { const meta = await api('ping'); state.cfg.meta = meta; store.set(LS.cfg, state.cfg); toast('Koneksi OK — ' + meta.spreadsheet, 'success'); renderSettings(v); }
      catch (err) { toast(err.message, 'error'); b.disabled = false; b.textContent = '🔌 Tes koneksi'; }
    });
    $('#sSync', v).addEventListener('click', () => loadData());
    $('#sFlush', v)?.addEventListener('click', async () => { await flushQueue(); loadData({ silent: true }); });
    $('#sPin', v).addEventListener('click', async () => {
      if (store.get(LS.pin, null)) {
        const ok = await confirmDialog({ title: 'Matikan kunci PIN?', text: 'Aplikasi akan langsung terbuka tanpa PIN.', okText: 'Matikan', icon: '🔓' });
        if (ok) { store.del(LS.pin); toast('Kunci PIN dimatikan', 'success'); renderSettings(v); }
      } else {
        const pin = await pinSetup();
        if (pin) { const salt = Math.random().toString(36).slice(2); store.set(LS.pin, { salt, hash: await sha256(salt + pin) }); toast('Kunci PIN aktif', 'success'); renderSettings(v); }
      }
    });
    $('#sLogout', v).addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Putuskan koneksi?', text: `Pengaturan di HP ini akan dihapus${state.queue.length ? `, termasuk <b>${state.queue.length} transaksi offline yang belum terkirim</b>` : ''}. Data di Google Sheets tidak terpengaruh.`, okText: 'Putuskan', icon: '🚪' });
      if (!ok) return;
      Object.values(LS).forEach((k) => store.del(k));
      location.reload();
    });
    $('#sCats', v).addEventListener('click', () => {
      const cc = state.prefs.customCats;
      const list = (t) => cc[t].length ? cc[t].map((c, i) => `<button class="cat-chip" data-t="${t}" data-i="${i}">${esc(c)} ✕</button>`).join('') : '<span style="color:var(--muted);font-size:13px">Belum ada</span>';
      const sh = openSheet(`
        <div class="sheet-head"><h3>Kategori Buatanku</h3><button class="sheet-close" data-close aria-label="Tutup">×</button></div>
        <p style="color:var(--muted);font-size:13.5px;margin:0 0 12px">Ketuk untuk menghapus dari daftar pilihan. Kategori yang sudah dipakai di sheet tetap muncul otomatis. Tambah kategori baru lewat tombol "＋ Baru" di form transaksi.</p>
        <span class="label">Pengeluaran</span><div class="cat-grid" id="ccOut">${list('pengeluaran')}</div>
        <span class="label" style="margin-top:14px">Pemasukan</span><div class="cat-grid" id="ccIn">${list('pemasukan')}</div>
        <div class="field"><button class="btn btn-soft" data-close>Selesai</button></div>`, { onClose: () => renderSettings(v) });
      sh.addEventListener('click', (e) => {
        const b = e.target.closest('.cat-chip[data-t]'); if (!b) return;
        cc[b.dataset.t].splice(Number(b.dataset.i), 1); store.set(LS.prefs, state.prefs);
        $('#ccOut', sh).innerHTML = list('pengeluaran'); $('#ccIn', sh).innerHTML = list('pemasukan');
      });
    });
  }

  function bindCommon(v) {
    $$('[data-go]', v).forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
    $$('[data-add]', v).forEach((b) => b.addEventListener('click', () => openTxForm()));
  }

  function go(route) {
    if (state.route === route) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    state.route = route; window.scrollTo(0, 0); render();
  }

  // ---------------------------------------------------------
  // PIN
  // ---------------------------------------------------------
  function keypadHTML() {
    return `<div class="pin-dots" id="pinDots">${'<i></i>'.repeat(4)}</div>
      <div class="keypad" id="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join('')}
      <button class="ghost" data-k="x" aria-label="Batal"></button><button data-k="0">0</button><button class="ghost" data-k="del" aria-label="Hapus">⌫</button></div>`;
  }
  function bindKeypad(root, onDone) {
    let buf = '';
    const dots = $('#pinDots', root);
    const paint = () => $$('i', dots).forEach((d, i) => d.classList.toggle('on', i < buf.length));
    const press = (k) => {
      if (k === 'del') buf = buf.slice(0, -1);
      else if (/\d/.test(k) && buf.length < 4) buf += k;
      vibrate(5); paint();
      if (buf.length === 4) { const val = buf; setTimeout(() => { buf = ''; paint(); onDone(val, () => { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); vibrate([30, 40, 30]); }); }, 120); }
    };
    $('#keypad', root).addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.k !== 'x') press(b.dataset.k); });
    const onKey = (e) => { if (root.hidden) return; if (/^\d$/.test(e.key)) press(e.key); if (e.key === 'Backspace') press('del'); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }

  function pinSetup() {
    return new Promise((resolve) => {
      let first = null, done = false;
      const sh = openSheet(`<div class="sheet-head"><h3>Buat PIN</h3><button class="sheet-close" data-close aria-label="Tutup">×</button></div>
        <div style="display:flex;flex-direction:column;align-items:center"><p id="pinMsg" style="color:var(--muted);margin:0">Masukkan 4 digit PIN baru</p>${keypadHTML()}</div>`,
        { onClose: () => { unbind(); if (!done) resolve(null); } });
      const unbind = bindKeypad(sh, (val, fail) => {
        if (!first) { first = val; $('#pinMsg', sh).textContent = 'Ulangi PIN untuk konfirmasi'; return; }
        if (val === first) { done = true; resolve(val); closeSheet(); }
        else { fail(); first = null; $('#pinMsg', sh).textContent = 'PIN tidak sama. Ulangi dari awal.'; }
      });
    });
  }

  function showLock() {
    const pin = store.get(LS.pin, null);
    if (!pin) return Promise.resolve();
    return new Promise((resolve) => {
      const el = $('#lock');
      el.innerHTML = `<div class="brand-logo">C</div><h2>Masukkan PIN</h2><p id="lockMsg">Catatku terkunci</p>${keypadHTML()}`;
      el.hidden = false; $('#app').hidden = true;
      let tries = 0;
      const unbind = bindKeypad(el, async (val, fail) => {
        if (await sha256(pin.salt + val) === pin.hash) { unbind(); el.hidden = true; $('#app').hidden = false; resolve(); }
        else {
          fail(); tries++;
          $('#lockMsg').textContent = tries >= 5 ? 'Lupa PIN? Hapus data situs ini di pengaturan browser, lalu hubungkan ulang.' : 'PIN salah, coba lagi';
        }
      });
    });
  }

  // ---------------------------------------------------------
  // Setup awal (menghubungkan ke Apps Script)
  // ---------------------------------------------------------
  function showSetup() {
    const el = $('#setup');
    $('#app').hidden = true; el.hidden = false;
    el.innerHTML = `
      <div class="brand"><div class="brand-logo">C</div><div><h1>Catatku</h1><p>Catat keuangan langsung ke Google Sheets</p></div></div>
      <div class="setup-card glass card">
        <h2>Hubungkan ke spreadsheet</h2>
        <p>Isi sekali saja. Data ini hanya tersimpan di HP ini.</p>
        <div class="field"><label for="suUrl">URL Web App (Apps Script)</label>
          <input id="suUrl" class="input" inputmode="url" autocomplete="off" placeholder="https://script.google.com/macros/s/…/exec"></div>
        <div class="field"><label for="suKey">Kunci rahasia (API key)</label>
          <input id="suKey" class="input mono" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="tempel kunci dari log setup()"></div>
        <p class="err" id="suErr" role="alert"></p>
        <div class="field"><button class="btn btn-primary" id="suGo">Hubungkan</button></div>
        <ol class="steps-mini"><li>URL didapat setelah Deploy → Web app di Apps Script.</li><li>Kunci muncul di Log setelah menjalankan fungsi <b>setup</b>.</li></ol>
      </div>
      <div id="suResult"></div>`;
    $('#suGo').addEventListener('click', async () => {
      const url = $('#suUrl').value.trim(), key = $('#suKey').value.trim();
      const err = $('#suErr'); err.textContent = '';
      if (!/^https:\/\/script\.google(usercontent)?\.com\/.+\/exec/.test(url)) { err.textContent = 'URL harus diawali https://script.google.com/… dan diakhiri /exec'; $('#suUrl').classList.add('invalid'); return; }
      if (key.length < 16) { err.textContent = 'Kunci rahasia terlalu pendek. Salin lengkap dari log.'; $('#suKey').classList.add('invalid'); return; }
      const b = $('#suGo'); b.disabled = true; b.innerHTML = '<span class="spinner"></span> Menghubungkan…';
      try {
        const meta = await api('ping', {}, { url, key });
        const sheets = meta.sheets;
        $('#suResult').innerHTML = `<div class="card" style="margin-top:14px"><h3 style="margin:0 0 8px;font-size:16px">✅ Terhubung ke "${esc(meta.spreadsheet)}"</h3>
          ${['pemasukan', 'pengeluaran'].map((t) => `<p style="margin:6px 0;font-size:13.5px"><b>${esc(sheets[t].nama)}</b> (header baris ${sheets[t].headerRow}): Tanggal → <b>${esc(sheets[t].kolom.tanggal || '—')}</b>, Nominal → <b>${esc(sheets[t].kolom.nominal)}</b>, Kategori → <b>${esc(sheets[t].kolom.kategori || '—')}</b>, Catatan → <b>${esc(sheets[t].kolom.catatan || '—')}</b></p>`).join('')}
          <p style="font-size:12.5px;color:var(--muted)">Jika ada pasangan kolom yang salah, ubah CONFIG.FIELDS di Code.gs lalu deploy ulang.</p>
          <button class="btn btn-primary" id="suDone">Mulai pakai</button></div>`;
        b.disabled = false; b.textContent = 'Hubungkan ulang';
        $('#suDone').addEventListener('click', () => {
          state.cfg = { url, key, meta }; store.set(LS.cfg, state.cfg);
          el.hidden = true; $('#app').hidden = false; render(); loadData();
        });
        $('#suDone').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        err.textContent = e.message;
        b.disabled = false; b.textContent = 'Hubungkan';
      }
    });
  }

  // ---------------------------------------------------------
  // Start
  // ---------------------------------------------------------
  $$('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.route)));
  $('#fabAdd').addEventListener('click', () => openTxForm());
  $('#btnRefresh').addEventListener('click', () => loadData());
  bindTxClicks($('#view'));
  window.addEventListener('online', async () => { updateSyncPill(); if (state.queue.length) { await flushQueue(); loadData({ silent: true }); } });
  window.addEventListener('offline', updateSyncPill);

  // Kunci ulang jika aplikasi ditinggal > 2 menit; muat ulang data saat kembali
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!state.cfg) return;
    if (hiddenAt && Date.now() - hiddenAt > 120000) { await showLock(); }
    if (Date.now() - state.loadedAt > 60000) loadData({ silent: true });
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => { }));
  }

  (async function start() {
    if (!state.cfg) return showSetup();
    await showLock();
    $('#app').hidden = false;
    render();
    // shortcut dari ikon: ?add=pengeluaran / ?add=pemasukan
    const add = new URLSearchParams(location.search).get('add');
    if (add === 'pengeluaran' || add === 'pemasukan') { history.replaceState(null, '', location.pathname); openTxForm(null, add); }
    loadData({ silent: !!state.loadedAt });
  })();
})();
