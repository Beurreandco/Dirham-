/* Dirham — offline expense tracker. All data lives in this device's IndexedDB. */
(function () {
  'use strict';
  const P = window.DirhamParser;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ---------------------------------------------------------------- storage
  const DB_NAME = 'dirham', DB_VER = 1;
  let db;
  function openDB() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB_NAME, DB_VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('txns')) d.createObjectStore('txns', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('seen')) d.createObjectStore('seen', { keyPath: 'h' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'k' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function tx(store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      fn(t.objectStore(store));
    });
  }
  function getAll(store) {
    return new Promise((res, rej) => {
      const r = db.transaction(store).objectStore(store).getAll();
      r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
    });
  }
  const putMany = (store, items) => tx(store, 'readwrite', (s) => items.forEach((i) => s.put(i)));
  const delMany = (store, keys) => tx(store, 'readwrite', (s) => keys.forEach((k) => s.delete(k)));
  const clearStore = (store) => tx(store, 'readwrite', (s) => s.clear());

  // ---------------------------------------------------------------- state
  const S = {
    txns: [], seen: new Set(),
    settings: {
      fx: Object.assign({}, P.DEFAULT_FX), budgets: {}, totalBudget: 0, customCats: [], rules: [],
      lastSmsImport: 0, lastBackup: 0, firstRun: true
    },
    tab: 'home', month: monthKey(new Date()), filter: { q: '', cat: '' }
  };
  async function saveSettings() { await putMany('kv', [{ k: 'settings', v: S.settings }]); }
  function cats() { return P.DEFAULT_CATEGORIES.concat(S.settings.customCats || []); }
  function cat(id) { return cats().find((c) => c.id === id) || { id: 'other', name: 'Other', icon: '📦', kind: 'expense' }; }

  // ---------------------------------------------------------------- utils
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function monthLabel(k, short) { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', short ? { month: 'short' } : { month: 'long', year: 'numeric' }); }
  function shiftMonth(k, n) { const [y, m] = k.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)); }
  const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  function money(v, dp = 2) { return (dp ? nf2 : nf0).format(Math.abs(v) < 0.005 ? 0 : v); }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function dayLabel(ymd) {
    const today = P.ymd(new Date()); const y = new Date(); y.setDate(y.getDate() - 1);
    if (ymd === today) return 'Today'; if (ymd === P.ymd(y)) return 'Yesterday';
    const [Y, M, D] = ymd.split('-').map(Number);
    return new Date(Y, M - 1, D).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: Y === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function ago(ts) {
    if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
    const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
  }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  function sortTx(a, b) { return (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || (b.createdAt - a.createdAt); }

  // ---------------------------------------------------------------- sheet
  let onSheetClose = null;
  function openSheet(html, after, onClose) {
    const w = $('#sheetWrap'); const s = $('#sheet');
    s.innerHTML = '<div class="grab"></div>' + html; w.hidden = false; s.scrollTop = 0;
    document.body.style.overflow = 'hidden'; onSheetClose = onClose || null;
    if (after) after(s);
  }
  function closeSheet() { $('#sheetWrap').hidden = true; document.body.style.overflow = ''; const f = onSheetClose; onSheetClose = null; if (f) f(); }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

  // ---------------------------------------------------------------- derived
  function monthTx(k) { return S.txns.filter((t) => t.date.startsWith(k)); }
  function totals(list) {
    let spent = 0, income = 0;
    for (const t of list) { if (t.type === 'expense') spent += t.aed; else if (t.type === 'income') income += t.aed; }
    return { spent, income, net: income - spent };
  }
  function byCategory(list) {
    const m = new Map();
    for (const t of list) if (t.type === 'expense') m.set(t.category, (m.get(t.category) || 0) + t.aed);
    return Array.from(m, ([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  }

  // ---------------------------------------------------------------- render
  const views = {};
  function render() {
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
    $('#fab').hidden = !(S.tab === 'home' || S.tab === 'activity');
    $('#topActions').innerHTML = '';
    views[S.tab]();
    const stale = !S.settings.lastSmsImport || Date.now() - S.settings.lastSmsImport > 3 * 864e5;
    $('#importDot').hidden = !(stale && S.txns.length);
  }
  function setTitle(t) { $('#title').textContent = t; document.title = t === 'Home' ? 'Dirham' : t + ' · Dirham'; }

  // ---------- HOME
  views.home = function () {
    setTitle('Home');
    const k = S.month; const list = monthTx(k); const tt = totals(list);
    const prev = totals(monthTx(shiftMonth(k, -1)));
    const nowK = monthKey(new Date());
    const isNow = k === nowK;
    const [Y, M] = k.split('-').map(Number); const dim = new Date(Y, M, 0).getDate();
    const dayN = isNow ? new Date().getDate() : dim;
    let html = `<div class="monthbar"><button id="mPrev" aria-label="Previous month">‹</button><span class="m">${monthLabel(k)}</span><button id="mNext" aria-label="Next month" ${isNow ? 'disabled' : ''}>›</button></div>`;

    if (!S.txns.length) {
      html += `<div class="card empty"><b>Welcome to Dirham</b>Your spending lives only on this phone — nothing is sent anywhere.<br><br>
      <button class="btn" id="goSetup">Set up automatic SMS capture</button>
      <button class="btn secondary" id="goPaste">Paste bank SMS to try it</button>
      <button class="btn plain" id="goAdd">Add a transaction manually</button></div>`;
      $('#view').innerHTML = html; bindMonth();
      $('#goSetup').onclick = () => showShortcutGuide();
      $('#goPaste').onclick = () => showPaste();
      $('#goAdd').onclick = () => editTx(null);
      return;
    }

    const stale = !S.settings.lastSmsImport || Date.now() - S.settings.lastSmsImport > 86400000;
    if (stale) html += `<button class="pill" id="quickImport">⤓ <span>Last SMS import <b>${ago(S.settings.lastSmsImport)}</b> — tap to import new messages</span></button>`;

    const diff = prev.spent ? ((tt.spent - prev.spent) / prev.spent) * 100 : null;
    const budget = +S.settings.totalBudget || 0;
    html += `<div class="card hero"><div class="label">Spent in ${monthLabel(k, true)}</div>
      <div class="big"><span class="cur">AED</span>${money(tt.spent)}</div>
      <div class="sub">${diff == null ? '' : `${diff <= 0 ? '▼' : '▲'} ${Math.abs(diff).toFixed(0)}% vs ${monthLabel(shiftMonth(k, -1), true)} · `}${money(tt.spent / Math.max(1, dayN), 0)} AED / day</div>
      ${budget ? budgetMeter(tt.spent, budget, 'Monthly budget') : ''}
      <div class="kpis"><div><div class="k">Income</div><div class="v" style="color:var(--income)">${money(tt.income, 0)}</div></div>
      <div><div class="k">Net</div><div class="v">${tt.net < 0 ? '−' : '+'}${money(Math.abs(tt.net), 0)}</div></div>
      <div><div class="k">Transactions</div><div class="v">${list.length}</div></div></div></div>`;

    // daily chart
    const daily = new Array(dim).fill(0);
    for (const t of list) if (t.type === 'expense') daily[+t.date.slice(8, 10) - 1] += t.aed;
    html += `<div class="section-title">Daily spending</div><div class="card"><div class="chart" id="dailyChart">${dailySvg(daily, dayN)}</div></div>`;

    // categories
    const bc = byCategory(list); const max = bc.length ? bc[0].v : 1;
    html += `<div class="section-title">By category <button class="link" id="editBudgets">Budgets</button></div><div class="card flush">`;
    if (!bc.length) html += `<div class="empty">No spending this month yet.</div>`;
    for (const c of bc) {
      const C = cat(c.id); const b = +S.settings.budgets[c.id] || 0;
      html += `<button class="row" data-cat="${c.id}"><span class="ico">${C.icon}</span><span class="grow"><div class="t1">${esc(C.name)}</div>
        ${b ? budgetMeter(c.v, b) : `<div class="catbar"><i style="width:${Math.max(2, (c.v / max) * 100)}%"></i></div>`}</span>
        <span class="amt">${money(c.v)}<small>${tt.spent ? Math.round((c.v / tt.spent) * 100) : 0}%</small></span></button>`;
    }
    // budgets with zero spend
    for (const [id, b] of Object.entries(S.settings.budgets)) {
      if (+b && !bc.find((x) => x.id === id)) { const C = cat(id); html += `<div class="row"><span class="ico">${C.icon}</span><span class="grow"><div class="t1">${esc(C.name)}</div>${budgetMeter(0, +b)}</span><span class="amt">0.00</span></div>`; }
    }
    html += `</div>`;

    // top merchants
    const mm = new Map();
    for (const t of list) if (t.type === 'expense') { const key = t.merchant || '—'; const o = mm.get(key) || { n: 0, v: 0, c: t.category }; o.n++; o.v += t.aed; mm.set(key, o); }
    const top = Array.from(mm, ([m, o]) => ({ m, ...o })).sort((a, b) => b.v - a.v).slice(0, 5);
    if (top.length) {
      html += `<div class="section-title">Top merchants</div><div class="card flush">`;
      for (const t of top) html += `<button class="row" data-q="${esc(t.m)}"><span class="ico">${cat(t.c).icon}</span><span class="grow"><div class="t1">${esc(t.m)}</div><div class="t2">${t.n} transaction${t.n > 1 ? 's' : ''}</div></span><span class="amt">${money(t.v)}</span></button>`;
      html += `</div>`;
    }
    // recent
    const recent = S.txns.slice(0, 5);
    html += `<div class="section-title">Recent <button class="link" id="seeAll">See all</button></div><div class="card flush">${recent.map(txRow).join('')}</div>`;

    $('#view').innerHTML = html;
    bindMonth();
    bindDaily(daily);
    $('#quickImport') && ($('#quickImport').onclick = () => $('#fileSms').click());
    $('#editBudgets').onclick = showBudgets;
    $('#seeAll').onclick = () => go('activity');
    $$('[data-cat]').forEach((b) => (b.onclick = () => { S.filter = { q: '', cat: b.dataset.cat, month: S.month }; go('activity'); }));
    $$('[data-q]').forEach((b) => (b.onclick = () => { S.filter = { q: b.dataset.q, cat: '', month: S.month }; go('activity'); }));
    bindTxRows();
  };
  function bindMonth() {
    $('#mPrev').onclick = () => { S.month = shiftMonth(S.month, -1); render(); };
    $('#mNext').onclick = () => { S.month = shiftMonth(S.month, 1); render(); };
  }
  function budgetMeter(spent, budget, label) {
    const pct = budget ? spent / budget : 0;
    const cls = pct > 1 ? 'over' : pct >= 0.8 ? 'warn' : 'good';
    const txt = pct > 1 ? `⚠ Over by ${money(spent - budget, 0)}` : pct >= 0.8 ? `● ${money(budget - spent, 0)} left` : `✓ ${money(budget - spent, 0)} left`;
    return `<div class="meter ${cls === 'good' ? '' : cls}"><i style="width:${Math.min(100, pct * 100)}%"></i></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px"><span class="status ${cls}">${txt}</span><span class="small muted num">${label ? label + ' · ' : ''}${money(budget, 0)}</span></div>`;
  }
  function dailySvg(daily, dayN) {
    const W = 600, H = 150, pad = 18, n = daily.length; const max = Math.max(1, ...daily);
    const nice = niceMax(max); const bw = (W - 2) / n; const avg = daily.slice(0, dayN).reduce((a, b) => a + b, 0) / Math.max(1, dayN);
    let s = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily spending bar chart">`;
    for (const f of [0.5, 1]) { const y = H - pad - (H - pad - 8) * f; s += `<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`; }
    for (let i = 0; i < n; i++) {
      const h = (daily[i] / nice) * (H - pad - 8); const x = i * bw + 1;
      if (daily[i] > 0) s += `<path class="bar${i >= dayN ? ' dim' : ''}" data-i="${i}" d="${roundedTop(x + bw * 0.14, H - pad - h, bw * 0.72, h, Math.min(4, bw * 0.3))}"/>`;
    }
    if (avg > 0) { const y = H - pad - (avg / nice) * (H - pad - 8); s += `<line class="avg" x1="0" x2="${W}" y1="${y}" y2="${y}"/>`; }
    s += `<line class="grid" x1="0" x2="${W}" y1="${H - pad}" y2="${H - pad}"/></svg>`;
    // axis labels as HTML so they don't stretch
    s += `<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-3);margin-top:2px"><span>1</span><span>${Math.ceil(n / 2)}</span><span>${n}</span></div>`;
    s += `<div class="small muted" style="margin-top:6px">Max ${money(max, 0)} AED · dashed line = daily average (${money(avg, 0)})</div>`;
    return s;
  }
  function roundedTop(x, y, w, h, r) { r = Math.min(r, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
  function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return v; }
  function bindDaily(daily) {
    const el = $('#dailyChart'); if (!el) return; const svg = el.querySelector('svg');
    let tip = null;
    const show = (clientX) => {
      const r = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(daily.length - 1, Math.floor(((clientX - r.left) / r.width) * daily.length)));
      if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip); }
      const [Y, M] = S.month.split('-').map(Number);
      tip.textContent = `${new Date(Y, M - 1, i + 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} · ${money(daily[i])} AED`;
      tip.style.left = Math.max(60, Math.min(r.width - 60, ((i + 0.5) / daily.length) * r.width)) + 'px';
      $$('.bar', svg).forEach((b) => b.style.opacity = +b.dataset.i === i ? 1 : 0.45);
    };
    const hide = () => { if (tip) { tip.remove(); tip = null; } $$('.bar', svg).forEach((b) => b.style.opacity = ''); };
    svg.addEventListener('pointerdown', (e) => show(e.clientX));
    svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) show(e.clientX); });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') setTimeout(hide, 1600); });
  }

  function txRow(t) {
    const C = cat(t.category);
    const cls = t.type === 'income' ? 'in' : t.type === 'transfer' ? 'tr' : '';
    const sign = t.type === 'income' ? '+' : t.type === 'transfer' ? '' : '−';
    const foreign = t.currency !== 'AED' ? `<small>${t.currency} ${money(t.amount)}</small>` : '';
    const sub = [C.name, t.account ? '•' + t.account : '', t.time || ''].filter(Boolean).join(' · ');
    return `<button class="row" data-id="${t.id}"><span class="ico">${C.icon}</span><span class="grow"><div class="t1">${esc(t.merchant || C.name)}${t.review ? '<span class="badge warn">check</span>' : ''}</div><div class="t2">${esc(sub)}</div></span><span class="amt ${cls}">${sign}${money(t.aed)}${foreign}</span></button>`;
  }
  function bindTxRows() { $$('[data-id]').forEach((b) => (b.onclick = () => editTx(S.txns.find((t) => t.id === b.dataset.id)))); }

  // ---------- ACTIVITY
  views.activity = function () {
    setTitle('Activity');
    const f = S.filter;
    const monthOpts = Array.from(new Set(S.txns.map((t) => t.date.slice(0, 7)))).sort().reverse();
    let html = `<div class="search"><input id="q" type="search" placeholder="Search merchant, note, amount" value="${esc(f.q)}" autocomplete="off"></div>
      <div class="chips" id="chips"><button class="chip ${!f.month ? 'on' : ''}" data-m="">All time</button>${monthOpts.map((m) => `<button class="chip ${f.month === m ? 'on' : ''}" data-m="${m}">${monthLabel(m)}</button>`).join('')}</div>`;
    if (f.cat) html += `<div class="chips"><button class="chip on" id="clearCat">${cat(f.cat).icon} ${esc(cat(f.cat).name)} ✕</button></div>`;
    html += `<div id="list"></div>`;
    $('#view').innerHTML = html;
    const draw = () => {
      const q = f.q.trim().toLowerCase();
      const list = S.txns.filter((t) => (!f.month || t.date.startsWith(f.month)) && (!f.cat || t.category === f.cat) &&
        (!q || (t.merchant || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || String(t.aed).includes(q) || cat(t.category).name.toLowerCase().includes(q)));
      if (!list.length) { $('#list').innerHTML = `<div class="empty"><b>No transactions</b>${S.txns.length ? 'Try a different search or month.' : 'Import your bank SMS from the Import tab.'}</div>`; return; }
      const tt = totals(list);
      let h = `<div class="small muted" style="margin:6px 4px">${list.length} transactions · spent ${money(tt.spent)} · in ${money(tt.income)} AED</div>`;
      let day = null, buf = [];
      const flush = () => { if (!buf.length) return; const sp = buf.reduce((a, t) => a + (t.type === 'expense' ? t.aed : 0), 0); h += `<div class="dayhead"><span>${dayLabel(day)}</span><span class="num">${sp ? '−' + money(sp) : ''}</span></div><div class="card flush" style="margin:0">${buf.map(txRow).join('')}</div>`; buf = []; };
      for (const t of list.slice(0, 600)) { if (t.date !== day) { flush(); day = t.date; } buf.push(t); }
      flush();
      if (list.length > 600) h += `<div class="empty small">Showing latest 600 — narrow with search or month.</div>`;
      $('#list').innerHTML = h; bindTxRows();
    };
    draw();
    $('#q').oninput = (e) => { f.q = e.target.value; draw(); };
    $$('#chips .chip').forEach((c) => (c.onclick = () => { f.month = c.dataset.m; render(); }));
    $('#clearCat') && ($('#clearCat').onclick = () => { f.cat = ''; render(); });
  };

  // ---------- IMPORT
  views.import = function () {
    setTitle('Import');
    const smsCount = S.txns.filter((t) => t.source === 'sms').length;
    $('#view').innerHTML = `
      <div class="section-title">Bank SMS</div>
      <div class="card">
        <div style="font-weight:650;font-size:17px">Import from Shortcut file</div>
        <div class="small muted" style="margin:4px 0 12px">Last import ${ago(S.settings.lastSmsImport)} · ${smsCount} SMS transactions so far. Already-imported messages are skipped automatically.</div>
        <button class="btn" id="impSms">Choose <span class="code" style="background:transparent">dirham-sms.txt</span></button>
        <button class="btn plain" id="impPaste">Paste SMS text instead</button>
      </div>
      <button class="row card" id="guide" style="margin-top:0"><span class="ico">⚙️</span><span class="grow"><div class="t1">Set up automatic SMS capture</div><div class="t2">One-time iPhone Shortcuts automation</div></span><span class="chev">›</span></button>
      <div class="section-title">Bank statement (optional)</div>
      <div class="card">
        <div style="font-weight:650;font-size:17px">Import PDF statement</div>
        <div class="small muted" style="margin:4px 0 12px">Works with Emirates NBD / Liv account and credit card e-statements (password-protected too). You review every line before it's added; transactions already captured by SMS are flagged as duplicates.</div>
        <button class="btn secondary" id="impPdf">Choose PDF</button>
      </div>
      <div class="section-title">Manual</div>
      <div class="card"><button class="btn plain" id="impManual">Add a transaction</button></div>`;
    $('#impSms').onclick = () => $('#fileSms').click();
    $('#impPaste').onclick = showPaste;
    $('#guide').onclick = showShortcutGuide;
    $('#impPdf').onclick = () => $('#filePdf').click();
    $('#impManual').onclick = () => editTx(null);
  };

  // ---------- SETTINGS
  views.settings = function () {
    setTitle('Settings');
    const n = S.txns.length;
    $('#view').innerHTML = `
      <div class="section-title">Money</div>
      <div class="card flush">
        <button class="row" id="sBudgets"><span class="ico">🎯</span><span class="grow"><div class="t1">Budgets</div><div class="t2">${Object.values(S.settings.budgets).filter(Number).length} categories${S.settings.totalBudget ? ' · total ' + money(S.settings.totalBudget, 0) + ' AED' : ''}</div></span><span class="chev">›</span></button>
        <button class="row" id="sRules"><span class="ico">🏷️</span><span class="grow"><div class="t1">Merchant rules</div><div class="t2">${S.settings.rules.length} learned from your edits</div></span><span class="chev">›</span></button>
        <button class="row" id="sCats"><span class="ico">🗂️</span><span class="grow"><div class="t1">Categories</div><div class="t2">${cats().length} categories</div></span><span class="chev">›</span></button>
        <button class="row" id="sFx"><span class="ico">💱</span><span class="grow"><div class="t1">Exchange rates</div><div class="t2">Used to convert foreign purchases to AED</div></span><span class="chev">›</span></button>
      </div>
      <div class="section-title">Your data</div>
      <div class="card flush">
        <button class="row" id="sBackup"><span class="ico">💾</span><span class="grow"><div class="t1">Back up now</div><div class="t2">Last backup ${ago(S.settings.lastBackup)} · save the file to iCloud Drive</div></span><span class="chev">›</span></button>
        <button class="row" id="sRestore"><span class="ico">♻️</span><span class="grow"><div class="t1">Restore from backup</div><div class="t2">Merges a Dirham .json backup</div></span><span class="chev">›</span></button>
        <button class="row" id="sCsv"><span class="ico">📄</span><span class="grow"><div class="t1">Export CSV</div><div class="t2">For Excel / Numbers</div></span><span class="chev">›</span></button>
        <button class="row" id="sGuide"><span class="ico">⚙️</span><span class="grow"><div class="t1">SMS capture setup</div><div class="t2">Shortcuts automation guide</div></span><span class="chev">›</span></button>
      </div>
      <div class="card small muted">${n} transactions stored on this iPhone only. Nothing is uploaded — there's no server. Deleting the Home Screen app deletes the data, so keep a backup.</div>
      <div class="card"><button class="btn danger" id="sWipe">Erase all data</button></div>
      <div class="small muted" style="text-align:center;margin:12px 0">Dirham v1.0 · works offline</div>`;
    $('#sBudgets').onclick = showBudgets; $('#sRules').onclick = showRules; $('#sCats').onclick = showCats; $('#sFx').onclick = showFx;
    $('#sBackup').onclick = backup; $('#sRestore').onclick = () => $('#fileBackup').click(); $('#sCsv').onclick = exportCsv; $('#sGuide').onclick = showShortcutGuide;
    $('#sWipe').onclick = wipe;
  };

  function go(tab) { S.tab = tab; if (tab !== 'activity') S.filter = { q: '', cat: '', month: '' }; render(); window.scrollTo(0, 0); }
  $$('.tabbar button').forEach((b) => (b.onclick = () => { if (b.dataset.tab === 'activity') S.filter = { q: '', cat: '', month: '' }; S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); }));
  $('#fab').onclick = () => editTx(null);

  // ---------------------------------------------------------------- edit
  function catOptions(kind, sel) {
    return cats().filter((c) => c.kind === kind).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
  }
  function editTx(t) {
    const isNew = !t;
    const now = new Date();
    const d = t ? { ...t } : { id: uid(), type: 'expense', amount: '', currency: 'AED', aed: 0, merchant: '', category: 'other', date: P.ymd(now), time: P.hm(now), note: '', account: '', source: 'manual', createdAt: Date.now() };
    const curList = Object.keys(S.settings.fx).sort((a, b) => (a === 'AED' ? -1 : b === 'AED' ? 1 : a.localeCompare(b)));
    openSheet(`
      <div class="sheet-head"><button data-close>Cancel</button><h2>${isNew ? 'New transaction' : 'Transaction'}</h2><button id="eSave">Save</button></div>
      <div class="seg" id="eType">${['expense', 'income', 'transfer'].map((x) => `<button data-v="${x}" class="${d.type === x ? 'on' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>
      <div class="bigamt"><select id="eCur">${curList.map((c) => `<option ${c === d.currency ? 'selected' : ''}>${c}</option>`).join('')}</select><input id="eAmt" inputmode="decimal" placeholder="0.00" value="${d.amount === '' ? '' : d.amount}"></div>
      <div class="form">
        <div class="field" id="eAedRow" ${d.currency === 'AED' ? 'hidden' : ''}><label>In AED</label><input id="eAed" inputmode="decimal" value="${d.currency === 'AED' ? '' : d.aed}"></div>
        <div class="field"><label>Merchant</label><input id="eMer" value="${esc(d.merchant)}" placeholder="e.g. Carrefour" autocomplete="off"></div>
        <div class="field"><label>Category</label><select id="eCat"></select></div>
        <div class="field"><label>Date</label><input id="eDate" type="date" value="${d.date}"></div>
        <div class="field"><label>Time</label><input id="eTime" type="time" value="${d.time || ''}"></div>
        <div class="field"><label>Card / acct</label><input id="eAcc" value="${esc(d.account || '')}" placeholder="last 4 digits" inputmode="numeric"></div>
        <div class="field"><label>Note</label><input id="eNote" value="${esc(d.note || '')}" placeholder="optional"></div>
      </div>
      <div class="form" id="eRuleWrap" hidden><label class="field check"><span class="small">Always use this category for “<b id="eRuleName"></b>”</span><input type="checkbox" id="eRule" checked></label></div>
      ${d.raw ? `<div class="section-title">Original ${d.source === 'pdf' ? 'statement line' : 'SMS'}</div><pre class="raw">${esc(d.raw)}</pre>` : ''}
      ${isNew ? '' : '<button class="btn danger" id="eDel" style="margin-top:16px">Delete transaction</button>'}
    `, (s) => {
      let type = d.type;
      const fillCats = () => { const kind = type; $('#eCat', s).innerHTML = catOptions(kind, cat(d.category).kind === kind ? d.category : (kind === 'income' ? 'other_in' : kind === 'transfer' ? 'transfer' : 'other')); };
      fillCats();
      $$('#eType button', s).forEach((b) => (b.onclick = () => { type = b.dataset.v; $$('#eType button', s).forEach((x) => x.classList.toggle('on', x === b)); fillCats(); ruleVis(); }));
      const recalc = () => { const c = $('#eCur', s).value; $('#eAedRow', s).hidden = c === 'AED'; if (c !== 'AED') $('#eAed', s).value = P.toAED(parseFloat($('#eAmt', s).value) || 0, c, S.settings.fx).toFixed(2); };
      $('#eCur', s).onchange = recalc; $('#eAmt', s).oninput = () => { if ($('#eCur', s).value !== 'AED') recalc(); };
      const ruleVis = () => { const m = $('#eMer', s).value.trim(); const changed = $('#eCat', s).value !== d.category || isNew; $('#eRuleWrap', s).hidden = !(m && changed && type !== 'transfer'); $('#eRuleName', s).textContent = m; };
      $('#eCat', s).onchange = ruleVis; $('#eMer', s).oninput = () => { if (isNew) { const guess = P.categorize($('#eMer', s).value, S.settings.rules, type); if (guess !== 'other' && cat(guess).kind === type) $('#eCat', s).value = guess; } ruleVis(); };
      if (isNew) setTimeout(() => $('#eAmt', s).focus(), 300);
      $('#eSave', s).onclick = async () => {
        const amount = parseFloat(String($('#eAmt', s).value).replace(/,/g, ''));
        if (!(amount > 0)) { toast('Enter an amount'); return; }
        const cur = $('#eCur', s).value;
        const aed = cur === 'AED' ? amount : (parseFloat($('#eAed', s).value) || P.toAED(amount, cur, S.settings.fx));
        const upd = Object.assign(d, { type, amount, currency: cur, aed: Math.round(aed * 100) / 100, merchant: $('#eMer', s).value.trim(), category: $('#eCat', s).value, date: $('#eDate', s).value || P.ymd(new Date()), time: $('#eTime', s).value, account: $('#eAcc', s).value.trim(), note: $('#eNote', s).value.trim(), review: false, updatedAt: Date.now() });
        const toSave = [upd];
        if (!$('#eRuleWrap', s).hidden && $('#eRule', s).checked) {
          const pattern = P.merchantKey(upd.merchant);
          if (pattern) {
            S.settings.rules = S.settings.rules.filter((r) => r.pattern !== pattern).concat([{ pattern, category: upd.category }]);
            await saveSettings();
            for (const o of S.txns) if (o.id !== upd.id && o.type === type && P.merchantKey(o.merchant) === pattern && o.category !== upd.category) { o.category = upd.category; toSave.push(o); }
          }
        }
        await putMany('txns', toSave);
        if (isNew) S.txns.push(upd); else { const i = S.txns.findIndex((x) => x.id === upd.id); if (i >= 0) S.txns[i] = upd; }
        S.txns.sort(sortTx); closeSheet(); render();
        toast(toSave.length > 1 ? `Saved · ${toSave.length - 1} other “${upd.merchant}” updated` : 'Saved');
      };
      if (!isNew) $('#eDel', s).onclick = async () => {
        if (!confirm('Delete this transaction?')) return;
        await delMany('txns', [d.id]); S.txns = S.txns.filter((x) => x.id !== d.id); closeSheet(); render(); toast('Deleted');
      };
    });
  }

  // ---------------------------------------------------------------- SMS import
  function buildTxFromSms(msg, fileTime) {
    const r = P.parseSms(msg.text);
    if (r.kind !== 'txn') return { r };
    const when = msg.when || r.date || fileTime || new Date();
    const useDate = r.date && msg.when && Math.abs(r.date - msg.when) > 3 * 864e5 ? r.date : when; // trust SMS text date if very different
    const category = r.category || P.categorize(r.merchant, S.settings.rules, r.type, msg.text);
    return {
      r, t: {
        id: uid(), type: r.type, amount: r.amount, currency: r.currency, aed: P.toAED(r.amount, r.currency, S.settings.fx),
        merchant: r.merchant, category, date: P.ymd(useDate), time: msg.when || (r.date && r.date.getHours() !== 12) ? P.hm(useDate) : '',
        account: r.account || '', note: '', source: 'sms', raw: msg.text, hash: P.smsHash(msg.text), review: r.confidence === 'low', createdAt: Date.now()
      }
    };
  }
  async function importSmsText(text, opts = {}) {
    const msgs = P.splitMessages(text);
    const res = { added: [], dup: 0, ignored: 0, unknown: [] };
    const seenNow = [];
    for (const m of msgs) {
      const h = P.smsHash(m.text);
      if (S.seen.has(h)) { res.dup++; continue; }
      const { r, t } = buildTxFromSms(m, opts.fileTime);
      S.seen.add(h); seenNow.push({ h, at: Date.now() });
      if (!t) { res.ignored++; continue; }
      res.added.push(t);
      if (t.review) res.unknown.push(t);
    }
    if (res.added.length) await putMany('txns', res.added);
    if (seenNow.length) await putMany('seen', seenNow);
    S.txns.push(...res.added); S.txns.sort(sortTx);
    if (!opts.paste) { S.settings.lastSmsImport = Date.now(); await saveSettings(); }
    return { ...res, total: msgs.length };
  }
  function showImportResult(res, title) {
    const spent = res.added.filter((t) => t.type === 'expense').reduce((a, t) => a + t.aed, 0);
    openSheet(`<div class="sheet-head"><span></span><h2>${esc(title)}</h2><button data-close>Done</button></div>
      <div class="result-grid">
        <div><div class="v">${res.added.length}</div><div class="k">new transactions</div></div>
        <div><div class="v">${money(spent, 0)}</div><div class="k">AED spent</div></div>
        <div><div class="v">${res.dup}</div><div class="k">already imported</div></div>
        <div><div class="v">${res.ignored}</div><div class="k">skipped (OTP, promos, declined)</div></div>
      </div>
      ${res.unknown.length ? `<div class="pill warn">⚠ ${res.unknown.length} message${res.unknown.length > 1 ? 's' : ''} had an unfamiliar format — tap to check them.</div>` : ''}
      ${res.added.length ? `<div class="card flush">${res.added.slice().sort(sortTx).slice(0, 50).map(txRow).join('')}</div>` : res.total === 0 ? `<div class="empty"><b>No messages found in that file</b>Make sure your Shortcut writes to <code>dirham-sms.txt</code> and that a bank SMS has arrived since you set it up.</div>` : ''}
    `, (s) => { $$('[data-id]', s).forEach((b) => (b.onclick = () => { closeSheet(); editTx(S.txns.find((t) => t.id === b.dataset.id)); })); }, () => render());
  }
  $('#fileSms').onchange = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    if (!files.length) return;
    let agg = { added: [], dup: 0, ignored: 0, unknown: [], total: 0 };
    for (const f of files) {
      const text = await f.text();
      const r = await importSmsText(text, { fileTime: f.lastModified ? new Date(f.lastModified) : null });
      agg.added.push(...r.added); agg.dup += r.dup; agg.ignored += r.ignored; agg.unknown.push(...r.unknown); agg.total += r.total;
    }
    showImportResult(agg, 'SMS import');
  };
  function showPaste() {
    openSheet(`<div class="sheet-head"><button data-close>Cancel</button><h2>Paste SMS</h2><button id="pGo">Import</button></div>
      <p class="small muted">In Messages, long-press a bank SMS → Copy, then paste here. Paste several at once, separated by an empty line.</p>
      <textarea class="paste" id="pText" placeholder="Purchase of AED 27.74 with Credit Card ending 9074 at Keeta, Dubai. Avl Cr. Limit is AED 30,978.13"></textarea>
      <div class="form"><div class="field"><label>Date</label><input type="date" id="pDate" value="${P.ymd(new Date())}"></div></div>
      <p class="small muted">The date is used when the message itself doesn't contain one.</p>`, (s) => {
      $('#pGo', s).onclick = async () => {
        const text = $('#pText', s).value; if (!text.trim()) { toast('Paste at least one SMS'); return; }
        const [Y, M, D] = $('#pDate', s).value.split('-').map(Number);
        const r = await importSmsText(text, { paste: true, fileTime: new Date(Y, M - 1, D, 12) });
        showImportResult(r, 'Pasted SMS');
      };
    });
  }

  function showShortcutGuide() {
    openSheet(`<div class="sheet-head"><span></span><h2>Automatic SMS capture</h2><button data-close>Done</button></div>
      <p class="small muted" style="margin-top:0">iPhone apps can't read your Messages. Instead, a Shortcuts automation saves every Emirates NBD / Liv SMS into a small text file in iCloud Drive — silently, in the background. Dirham reads that file when you tap <b>Import</b>.</p>
      <div class="section-title">1 · Create the automation</div>
      <div class="card"><ol class="steps">
        <li>Open the <b>Shortcuts</b> app → <b>Automation</b> tab → <b>+</b> (New Automation).</li>
        <li>Choose <b>Message</b>. Tap <b>Message Contains</b> and type <span class="copybox"><code>AED</code><button data-copy="AED">Copy</button></span> Leave “Sender” empty.</li>
        <li>Select <b>Run Immediately</b> and turn <b>off</b> “Notify When Run”. Tap <b>Next</b> → <b>New Blank Automation</b>.</li>
        <li>Add action <b>Text</b>. Type <span class="copybox"><code>##SMS## </code><button data-copy="##SMS## ">Copy</button></span> then (on the same line) insert the variable <b>Current Date</b>. Tap that variable → Date Format <b>ISO 8601</b> → turn on <b>Include ISO 8601 Time</b>. Press return (new line), then insert the variable <b>Shortcut Input</b> (tap it → choose <b>Content</b>).</li>
        <li>Add action <b>Append to Text File</b>. Set the text to the <b>Text</b> from step 4, and the file path to <span class="copybox"><code>dirham-sms.txt</code><button data-copy="dirham-sms.txt">Copy</button></span> Turn on <b>Make New Line</b>. (It saves into iCloud Drive → Shortcuts.)</li>
        <li>Tap <b>Done</b>. That's it — every bank SMS containing “AED” is now saved automatically.</li>
      </ol></div>
      <div class="section-title">2 · Catch foreign-currency card SMS too (optional)</div>
      <div class="card small">Credit-card purchases abroad may not mention AED. Make a second automation exactly the same way, with <b>Message Contains</b> <span class="copybox"><code>Card ending</code><button data-copy="Card ending">Copy</button></span> Duplicates are removed automatically, so overlapping automations are fine.</div>
      <div class="section-title">3 · Import</div>
      <div class="card small">Open Dirham → <b>Import</b> → <b>Choose dirham-sms.txt</b> → Browse → iCloud Drive → <b>Shortcuts</b> → <b>dirham-sms.txt</b>. Import as often as you like; messages already imported are skipped, and OTPs, promos and declined payments are ignored.</div>
      <div class="section-title">Tips</div>
      <div class="card small">• If your Shortcuts app shows <b>Save File</b> instead of Append, use Save File with “Ask Where to Save” off — Dirham can import several files at once.<br>• Keep bank SMS alerts turned on in the ENBD X / Liv app.<br>• Test it: after setup, make a small purchase, then Import.</div>
    `, (s) => { $$('[data-copy]', s).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { toast('Long-press the text to copy'); } })); });
  }

  // ---------------------------------------------------------------- PDF import
  let pdfLib = null;
  function loadPdfJs() {
    if (pdfLib) return Promise.resolve(pdfLib);
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = 'vendor/pdf.min.js';
      s.onload = () => { pdfLib = window.pdfjsLib; pdfLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(pdfLib); };
      s.onerror = () => rej(new Error('Could not load the PDF reader'));
      document.head.appendChild(s);
    });
  }
  async function pdfToLines(buf, password) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: buf, password: password || undefined, isEvalSupported: false }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5], w = it.width || 0;
        let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
        if (!row) { row = { y, cells: [] }; rows.push(row); }
        row.cells.push({ x, w, text: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.cells.sort((a, b) => a.x - b.x);
        // merge cells that touch (pdf.js often splits words)
        const merged = [];
        for (const c of r.cells) {
          const last = merged[merged.length - 1];
          if (last && c.x - (last.x + last.w) < 3) { last.text += (c.x - (last.x + last.w) > 0.8 ? ' ' : '') + c.text; last.w = c.x + c.w - last.x; }
          else merged.push({ ...c });
        }
        lines.push({ text: merged.map((c) => c.text).join('  '), cells: merged, page: p });
      }
    }
    return lines;
  }
  $('#filePdf').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    const attempt = async (pw) => {
      toast('Reading statement…');
      try {
        const lines = await pdfToLines(buf.slice(), pw);
        const rows = P.parseStatementLines(lines);
        if (!rows.length) { openSheet(`<div class="sheet-head"><span></span><h2>No transactions found</h2><button data-close>OK</button></div><p class="muted">I couldn't recognise transaction lines in <b>${esc(f.name)}</b>. Scanned (image) PDFs aren't supported. If this is a text PDF from your bank, send a note with the bank/statement type so the reader can be improved.</p>`); return; }
        reviewStatement(rows, f.name);
      } catch (err) {
        if (err && (err.name === 'PasswordException' || /password/i.test(err.message))) {
          const again = err.code === 2;
          const pwd = prompt(again ? 'Wrong password — try again:' : 'This statement is password-protected. Enter the PDF password (ENBD often uses your date of birth or part of your card number — check the email):');
          if (pwd) return attempt(pwd);
          return;
        }
        console.error(err); toast('Could not read that PDF');
      }
    };
    attempt();
  };
  function reviewStatement(rows, name) {
    // duplicate detection against existing txns: same AED amount, same type, within ±3 days
    const items = rows.map((r) => {
      const date = P.ymd(r.date);
      const merchant = P.cleanMerchant(r.description.replace(/\b(POS|PURCHASE|CARD NO\.?|DEBIT CARD|CREDIT CARD|TRANSACTION|TXN)\b[:\-]?/gi, ' ').replace(/\b\d{4,}\b/g, ' ').replace(/\s+/g, ' ').trim()) || r.description;
      const dup = S.txns.find((t) => Math.abs(t.aed - r.amount) < 0.011 && t.type === r.type && Math.abs(new Date(t.date) - new Date(date)) <= 3 * 864e5);
      const hash = 'p' + P.hash(date + '|' + r.amount + '|' + r.description.toLowerCase());
      const already = S.seen.has(hash);
      return { r, date, merchant, dup: !!dup || already, already, hash, on: !dup && !already, type: r.type };
    });
    const draw = (s) => {
      const n = items.filter((i) => i.on).length;
      $('#rvList', s).innerHTML = items.map((it, i) => `<label class="rv"><input type="checkbox" data-i="${i}" ${it.on ? 'checked' : ''}>
        <span class="grow" style="flex:1;min-width:0"><div class="t1" style="font-weight:550;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.merchant)}</div>
        <div class="small muted">${dayLabel(it.date)} ${it.dup ? `<span class="dup">· ${it.already ? 'already imported' : 'likely duplicate of SMS'}</span>` : ''}</div></span>
        <button class="chip" data-t="${i}" style="box-shadow:none;background:var(--card-2);font-size:12px">${it.type}</button>
        <span class="amt num" style="font-weight:600;${it.type === 'income' ? 'color:var(--income)' : ''}">${it.type === 'income' ? '+' : it.type === 'transfer' ? '' : '−'}${money(it.r.amount)}</span></label>`).join('');
      $('#rvGo', s).textContent = `Import ${n}`; $('#rvGo', s).disabled = !n;
      $$('input[data-i]', s).forEach((c) => (c.onchange = () => { items[+c.dataset.i].on = c.checked; draw(s); }));
      $$('[data-t]', s).forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); const it = items[+b.dataset.t]; it.type = it.type === 'expense' ? 'income' : it.type === 'income' ? 'transfer' : 'expense'; draw(s); }));
    };
    openSheet(`<div class="sheet-head"><button data-close>Cancel</button><h2>Review statement</h2><button id="rvGo">Import</button></div>
      <p class="small muted" style="margin-top:0">${esc(name)} · ${items.length} lines found · ${items.filter((i) => i.dup).length} look like duplicates and are unticked. Tap the type to switch expense / income / transfer.</p>
      <div class="btnrow" style="margin-bottom:8px"><button class="btn plain" id="rvAll" style="padding:9px">Select all</button><button class="btn plain" id="rvNone" style="padding:9px">Select none</button></div>
      <div class="card flush" id="rvList"></div>`, (s) => {
      draw(s);
      $('#rvAll', s).onclick = () => { items.forEach((i) => (i.on = true)); draw(s); };
      $('#rvNone', s).onclick = () => { items.forEach((i) => (i.on = false)); draw(s); };
      $('#rvGo', s).onclick = async () => {
        const add = items.filter((i) => i.on).map((it) => ({
          id: uid(), type: it.type, amount: it.r.amount, currency: 'AED', aed: it.r.amount, merchant: it.merchant,
          category: P.categorize(it.merchant, S.settings.rules, it.type, it.r.description), date: it.date, time: '', account: '', note: '',
          source: 'pdf', raw: it.r.description, hash: it.hash, createdAt: Date.now()
        }));
        await putMany('txns', add); await putMany('seen', items.filter((i) => i.on).map((i) => ({ h: i.hash, at: Date.now() })));
        items.forEach((i) => i.on && S.seen.add(i.hash));
        S.txns.push(...add); S.txns.sort(sortTx); closeSheet(); render(); toast(`Imported ${add.length} transactions`);
      };
    });
  }

  // ---------------------------------------------------------------- settings sheets
  function showBudgets() {
    const exp = cats().filter((c) => c.kind === 'expense');
    // suggest from last 3 months average
    const avg = {}; for (let i = 1; i <= 3; i++) for (const c of byCategory(monthTx(shiftMonth(monthKey(new Date()), -i)))) avg[c.id] = (avg[c.id] || 0) + c.v / 3;
    openSheet(`<div class="sheet-head"><button data-close>Cancel</button><h2>Monthly budgets</h2><button id="bSave">Save</button></div>
      <div class="form"><div class="field"><label>Total</label><input id="bTotal" inputmode="decimal" placeholder="no limit" value="${S.settings.totalBudget || ''}"></div></div>
      <p class="small muted">AED per month. Leave empty for no budget. Grey hint = your 3-month average.</p>
      <div class="form">${exp.map((c) => `<div class="field"><label style="width:auto;flex:1">${c.icon} ${esc(c.name)}</label><input data-b="${c.id}" inputmode="decimal" style="max-width:110px" placeholder="${avg[c.id] ? money(avg[c.id], 0) : '—'}" value="${S.settings.budgets[c.id] || ''}"></div>`).join('')}</div>`, (s) => {
      $('#bSave', s).onclick = async () => {
        S.settings.totalBudget = parseFloat($('#bTotal', s).value.replace(/,/g, '')) || 0;
        const b = {}; $$('[data-b]', s).forEach((i) => { const v = parseFloat(i.value.replace(/,/g, '')); if (v > 0) b[i.dataset.b] = v; });
        S.settings.budgets = b; await saveSettings(); closeSheet(); render(); toast('Budgets saved');
      };
    });
  }
  function showRules() {
    const draw = (s) => {
      $('#rList', s).innerHTML = S.settings.rules.length ? S.settings.rules.slice().sort((a, b) => a.pattern.localeCompare(b.pattern)).map((r) => `<div class="row"><span class="ico">${cat(r.category).icon}</span><span class="grow"><div class="t1">${esc(r.pattern)}</div><div class="t2">→ ${esc(cat(r.category).name)}</div></span><button class="link" data-del="${esc(r.pattern)}">Remove</button></div>`).join('') : '<div class="empty">No rules yet. When you change a transaction\'s category, Dirham offers to remember it for that merchant.</div>';
      $$('[data-del]', s).forEach((b) => (b.onclick = async () => { S.settings.rules = S.settings.rules.filter((r) => r.pattern !== b.dataset.del); await saveSettings(); draw(s); }));
    };
    openSheet(`<div class="sheet-head"><span></span><h2>Merchant rules</h2><button data-close>Done</button></div>
      <p class="small muted" style="margin-top:0">Merchants whose name contains the text below always get that category. Built-in rules already cover common UAE merchants (Carrefour, Talabat, Careem, ENOC, DEWA, noon…).</p>
      <div class="card flush" id="rList"></div>
      <div class="section-title">Add rule</div>
      <div class="form"><div class="field"><label>Contains</label><input id="rPat" placeholder="e.g. waitrose"></div><div class="field"><label>Category</label><select id="rCat">${catOptions('expense', 'groceries')}${catOptions('income', '')}</select></div></div>
      <button class="btn secondary" id="rAdd">Add rule & apply to past</button>`, (s) => {
      draw(s);
      $('#rAdd', s).onclick = async () => {
        const pattern = P.merchantKey($('#rPat', s).value); if (!pattern) return;
        const category = $('#rCat', s).value; const kind = cat(category).kind;
        S.settings.rules = S.settings.rules.filter((r) => r.pattern !== pattern).concat([{ pattern, category }]); await saveSettings();
        const ch = S.txns.filter((t) => t.type === kind && (' ' + P.merchantKey(t.merchant) + ' ').includes(pattern) && t.category !== category);
        ch.forEach((t) => (t.category = category)); if (ch.length) await putMany('txns', ch);
        $('#rPat', s).value = ''; draw(s); toast(`Rule added · ${ch.length} updated`);
      };
    }, () => render());
  }
  function showCats() {
    const draw = (s) => { $('#cList', s).innerHTML = cats().map((c) => `<div class="row"><span class="ico">${c.icon}</span><span class="grow"><div class="t1">${esc(c.name)}</div><div class="t2">${c.kind}</div></span>${c.custom ? `<button class="link" data-del="${c.id}">Remove</button>` : ''}</div>`).join('');
      $$('[data-del]', s).forEach((b) => (b.onclick = async () => {
        const id = b.dataset.del; const used = S.txns.filter((t) => t.category === id);
        if (used.length && !confirm(`${used.length} transactions use this category. They'll move to Other.`)) return;
        used.forEach((t) => (t.category = cat(id).kind === 'income' ? 'other_in' : 'other')); if (used.length) await putMany('txns', used);
        S.settings.customCats = S.settings.customCats.filter((c) => c.id !== id); await saveSettings(); draw(s);
      }));
    };
    openSheet(`<div class="sheet-head"><span></span><h2>Categories</h2><button data-close>Done</button></div>
      <div class="section-title">Add category</div>
      <div class="form"><div class="field"><label>Icon</label><input id="cIco" maxlength="4" placeholder="🏋️"></div><div class="field"><label>Name</label><input id="cName" placeholder="e.g. Kids"></div>
      <div class="field"><label>Type</label><select id="cKind"><option value="expense">Expense</option><option value="income">Income</option></select></div></div>
      <button class="btn secondary" id="cAdd">Add</button>
      <div class="section-title">All categories</div><div class="card flush" id="cList"></div>`, (s) => {
      draw(s);
      $('#cAdd', s).onclick = async () => {
        const name = $('#cName', s).value.trim(); if (!name) return;
        S.settings.customCats.push({ id: 'c_' + uid(), name, icon: $('#cIco', s).value.trim() || '🏷️', kind: $('#cKind', s).value, custom: true });
        await saveSettings(); $('#cName', s).value = ''; $('#cIco', s).value = ''; draw(s); toast('Category added');
      };
    }, () => render());
  }
  function showFx() {
    const list = Object.keys(S.settings.fx).filter((c) => c !== 'AED').sort();
    const used = new Set(S.txns.map((t) => t.currency));
    list.sort((a, b) => (used.has(b) - used.has(a)) || a.localeCompare(b));
    openSheet(`<div class="sheet-head"><button data-close>Cancel</button><h2>Exchange rates</h2><button id="fxSave">Save</button></div>
      <p class="small muted" style="margin-top:0">AED for 1 unit of each currency. Used when an SMS shows a foreign amount. Defaults are approximate — edit them to match your bank's rate. Existing transactions keep their AED value unless you tick the box below.</p>
      <div class="form">${list.map((c) => `<div class="field"><label>${c}${used.has(c) ? ' •' : ''}</label><input data-fx="${c}" inputmode="decimal" value="${S.settings.fx[c]}"></div>`).join('')}</div>
      <div class="form"><label class="field check"><span>Re-convert past foreign transactions</span><input type="checkbox" id="fxRe"></label></div>`, (s) => {
      $('#fxSave', s).onclick = async () => {
        $$('[data-fx]', s).forEach((i) => { const v = parseFloat(i.value); if (v > 0) S.settings.fx[i.dataset.fx] = v; });
        await saveSettings();
        if ($('#fxRe', s).checked) { const ch = S.txns.filter((t) => t.currency !== 'AED'); ch.forEach((t) => (t.aed = P.toAED(t.amount, t.currency, S.settings.fx))); if (ch.length) await putMany('txns', ch); }
        closeSheet(); render(); toast('Rates saved');
      };
    });
  }

  // ---------------------------------------------------------------- data export
  async function shareOrDownload(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return true;
  }
  async function backup() {
    const seen = await getAll('seen');
    const data = { app: 'dirham', version: 1, exportedAt: new Date().toISOString(), settings: S.settings, txns: S.txns, seen: seen.map((x) => x.h) };
    const ok = await shareOrDownload(`dirham-backup-${P.ymd(new Date())}.json`, JSON.stringify(data), 'application/json');
    if (ok) { S.settings.lastBackup = Date.now(); await saveSettings(); render(); toast('Backup ready — choose “Save to Files”'); }
  }
  $('#fileBackup').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'dirham' || !Array.isArray(data.txns)) throw new Error('bad');
      const have = new Set(S.txns.map((t) => t.id));
      const add = data.txns.filter((t) => !have.has(t.id));
      await putMany('txns', add); S.txns.push(...add); S.txns.sort(sortTx);
      if (Array.isArray(data.seen)) { const hs = data.seen.filter((h) => !S.seen.has(h)); hs.forEach((h) => S.seen.add(h)); await putMany('seen', hs.map((h) => ({ h, at: Date.now() }))); }
      if (data.settings) {
        const s = data.settings; S.settings.budgets = Object.assign({}, s.budgets || {}, S.settings.budgets);
        const pats = new Set(S.settings.rules.map((r) => r.pattern)); S.settings.rules.push(...(s.rules || []).filter((r) => !pats.has(r.pattern)));
        const cids = new Set(S.settings.customCats.map((c) => c.id)); S.settings.customCats.push(...(s.customCats || []).filter((c) => !cids.has(c.id)));
        S.settings.fx = Object.assign({}, s.fx || {}, S.settings.fx); if (!S.settings.totalBudget) S.settings.totalBudget = s.totalBudget || 0;
        await saveSettings();
      }
      render(); toast(`Restored ${add.length} transactions`);
    } catch { toast('That is not a Dirham backup file'); }
  };
  function exportCsv() {
    const q = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['Date', 'Time', 'Type', 'Merchant', 'Category', 'Amount', 'Currency', 'AED', 'Card/Account', 'Note', 'Source']];
    for (const t of S.txns) rows.push([t.date, t.time, t.type, t.merchant, cat(t.category).name, t.amount, t.currency, t.aed, t.account, t.note, t.source]);
    shareOrDownload(`dirham-${P.ymd(new Date())}.csv`, rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
  }
  async function wipe() {
    if (!confirm('Erase ALL transactions, rules and budgets from this iPhone? This cannot be undone.')) return;
    if (!confirm('Really erase everything? Consider backing up first.')) return;
    await clearStore('txns'); await clearStore('seen'); await clearStore('kv');
    location.reload();
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    try {
      db = await openDB();
      const [txns, seen, kv] = await Promise.all([getAll('txns'), getAll('seen'), getAll('kv')]);
      S.txns = txns.sort(sortTx); S.seen = new Set(seen.map((x) => x.h));
      const st = kv.find((x) => x.k === 'settings');
      if (st) S.settings = Object.assign(S.settings, st.v, { fx: Object.assign({}, P.DEFAULT_FX, st.v.fx || {}) });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      $('#view').innerHTML = `<div class="card empty"><b>Storage unavailable</b>Private Browsing blocks saving data. Open Dirham from your Home Screen or a normal Safari tab.</div>`; return;
    }
    render();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    // Hint to install
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    if (!standalone && /iPhone|iPad/.test(navigator.userAgent) && !sessionStorage.getItem('dirhamHint')) {
      try { sessionStorage.setItem('dirhamHint', '1'); } catch {}
      setTimeout(() => toast('Tip: tap Share → “Add to Home Screen” to install Dirham'), 1200);
    }
  }
  window.__dirham = { S, importSmsText, render }; // for testing
  boot();
})();
