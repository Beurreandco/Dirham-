/* Dirham v2 — private, offline money app with a Personal + Kid (co-parenting) ledger.
   All data lives in this device's IndexedDB. */
(function () {
  'use strict';
  const P = window.DirhamParser;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  // ================================================================ storage
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
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
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
    return new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
  }
  const putMany = (store, items) => tx(store, 'readwrite', (s) => items.forEach((i) => s.put(i)));
  const delMany = (store, keys) => tx(store, 'readwrite', (s) => keys.forEach((k) => s.delete(k)));
  const clearStore = (store) => tx(store, 'readwrite', (s) => s.clear());

  // ================================================================ state
  const S = {
    txns: [], seen: new Set(),
    settings: {
      fx: Object.assign({}, P.DEFAULT_FX), budgets: {}, totalBudget: 0, kidBudget: 0, customCats: [], rules: [],
      lastSmsImport: 0, lastBackup: 0, theme: 'system',
      profile: { name: '', kid: '', ex: '', defaultShare: 50, setup: false }
    },
    tab: 'home', month: monthKey(new Date()), scope: 'all',
    filter: { q: '', scope: 'all', month: '', cat: '' }, selecting: false, selected: new Set(), kidMonth: monthKey(new Date())
  };
  async function saveSettings() { await putMany('kv', [{ k: 'settings', v: S.settings }]); }
  const me = () => S.settings.profile.name || 'You';
  const exN = () => S.settings.profile.ex || 'Co-parent';
  const kidN = () => S.settings.profile.kid || 'Kid';
  const initials = (n) => String(n || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';

  // ================================================================ icons
  const IC = {
    cart: '<path d="M3 4h2.2l2.3 11h10l2-8H6.4"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>',
    utensils: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1.5-3 4-3 7h3"/>',
    scooter: '<circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17H15l2-7h-3M14 5h3l1 5M4 12h6l2 5"/>',
    car: '<path d="M4 17v-5l2.2-5.2A1.5 1.5 0 0 1 7.6 6h8.8a1.5 1.5 0 0 1 1.4.8L20 12v5"/><path d="M3 12h18v5H3z"/><path d="M6 17v2M18 17v2"/>',
    fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8l3 2v7a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
    bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    bolt: '<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',
    play: '<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M10 9v5l4-2.5z"/><path d="M8 21h8"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    plane: '<path d="M3 11.5 21 4l-7.5 18-2.5-8z"/><path d="M11 14l4-4"/>',
    ticket: '<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/><path d="M14 7v10"/>',
    home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7"/>',
    banknote: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 10v4M18 10v4"/>',
    bank: '<path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/>',
    box: '<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v5c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 15v2c0 1.7 2.7 3 6 3s6-1.3 6-3v-5c0-1.6-2.4-2.9-5.5-3"/>',
    repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
    cap: '<path d="M2 9l10-5 10 5-10 5z"/><path d="M6 11v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5M22 9v6"/>',
    bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r=".9"/><circle cx="16" cy="14.5" r=".9"/>',
    pencil: '<path d="M4 20l1-4L16 5l3 3L8 19z"/><path d="M14 7l3 3"/>',
    steth: '<path d="M6 3v6a4 4 0 0 0 8 0V3"/><path d="M10 13v2a5 5 0 0 0 10 0v-2"/><circle cx="20" cy="11" r="2"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l3.8 2.8-1.4 4.4H9.6l-1.4-4.4z"/>',
    baby: '<circle cx="12" cy="8" r="4"/><path d="M10.5 8h.01M13.5 8h.01"/><path d="M6 21v-2a6 6 0 0 1 12 0v2"/>',
    apple: '<path d="M12 7c-2-1.5-7-1-7 5 0 4 3 8 5 8 1 0 1.3-.5 2-.5s1 .5 2 .5c2 0 5-4 5-8 0-6-5-6.5-7-5z"/><path d="M12 7c0-2 1-3.5 3-4"/>',
    shirt: '<path d="M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 3.5 7 8 12 8zM12 8s1.5-5 4-4.5S17 8 12 8z"/>',
    cake: '<path d="M4 21v-8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8M2 21h20M4 16c2 0 2 1.5 4 1.5s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M12 11V7"/><path d="M12 3.5c.9.9.9 1.9 0 2.8-.9-.9-.9-1.9 0-2.8z"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>',
    swap: '<path d="M7 4 3 8l4 4"/><path d="M3 8h13"/><path d="M17 20l4-4-4-4"/><path d="M21 16H8"/>',
    tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3"/>',
    download: '<path d="M12 3v12m0 0-4.5-4.5M12 15l4.5-4.5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    share: '<path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    left: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    wallet: '<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 21a2 2 0 0 1 0-4h2a3 3 0 0 0 3-3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'
  };
  const ico = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${IC[n] || IC.tag}</svg>`;
  const CAT_STYLE = {
    groceries: ['cart', 'green'], dining: ['utensils', 'orange'], delivery: ['scooter', 'red'], transport: ['car', 'blue'], fuel: ['fuel', 'amber'],
    shopping: ['bag', 'pink'], bills: ['bolt', 'amber'], subs: ['play', 'purple'], health: ['heart', 'red'], personal: ['sparkle', 'pink'],
    travel: ['plane', 'teal'], fun: ['ticket', 'indigo'], rent: ['home', 'blue'], education: ['book', 'indigo'], cash: ['banknote', 'green'],
    fees: ['bank', 'slate'], other: ['box', 'slate'], salary: ['briefcase', 'green'], clients: ['users', 'teal'], refunds: ['undo', 'teal'],
    other_in: ['coins', 'green'], transfer: ['repeat', 'slate'], settle: ['swap', 'kid'],
    k_school: ['cap', 'kid'], k_bus: ['bus', 'kid'], k_supplies: ['pencil', 'kid'], k_health: ['steth', 'kid'], k_activities: ['ball', 'kid'],
    k_care: ['baby', 'kid'], k_food: ['apple', 'kid'], k_clothes: ['shirt', 'kid'], k_toys: ['gift', 'kid'], k_transport: ['car', 'kid'],
    k_outings: ['cake', 'kid'], k_other: ['smile', 'kid']
  };
  function catIco(id, kidBadge, small) {
    const [i, t] = CAT_STYLE[id] || ['tag', (cat(id).group === 'kid' ? 'kid' : 'slate')];
    const col = t === 'kid' ? 'var(--kid)' : `var(--t-${t})`;
    return `<span class="cat-ico" style="color:${col};background:color-mix(in srgb, ${col} 14%, transparent)${small ? ';width:32px;height:32px;border-radius:10px' : ''}">${ico(i)}${kidBadge ? '<i class="kb"></i>' : ''}</span>`;
  }
  function cats() { return P.DEFAULT_CATEGORIES.concat(S.settings.customCats || []); }
  function cat(id) { return cats().find((c) => c.id === id) || { id: 'other', name: 'Other', kind: 'expense' }; }
  const isKidCat = (id) => cat(id).group === 'kid';

  // ================================================================ utils
  function monthKey(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function monthLabel(k, fmt) { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-GB', fmt === 's' ? { month: 'short' } : fmt === 'l' ? { month: 'long' } : { month: 'long', year: 'numeric' }); }
  function shiftMonth(k, n) { const [y, m] = k.split('-').map(Number); return monthKey(new Date(y, m - 1 + n, 1)); }
  const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  function money(v, dp = 2) { v = Math.abs(v) < 0.005 ? 0 : v; return (dp ? nf2 : nf0).format(v); }
  function bigMoney(v) { const s = nf2.format(Math.abs(v) < 0.005 ? 0 : v); const [a, b] = s.split('.'); return `<span class="cur">AED</span>${a}<span class="dec">.${b}</span>`; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function dayLabel(ymd) {
    const today = P.ymd(new Date()); const y = new Date(); y.setDate(y.getDate() - 1);
    if (ymd === today) return 'Today'; if (ymd === P.ymd(y)) return 'Yesterday';
    const [Y, M, D] = ymd.split('-').map(Number);
    return new Date(Y, M - 1, D).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: Y === new Date().getFullYear() ? undefined : 'numeric' });
  }
  function shortDate(ymd) { const [Y, M, D] = ymd.split('-').map(Number); return new Date(Y, M - 1, D).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }); }
  function ago(ts) {
    if (!ts) return 'never'; const m = Math.round((Date.now() - ts) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
    const d = Math.round(h / 24); return d === 1 ? 'yesterday' : d + ' days ago';
  }
  function greeting() { const h = new Date().getHours(); return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  function sortTx(a, b) { return (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || (b.createdAt - a.createdAt); }
  const stale = () => !S.settings.lastSmsImport || Date.now() - S.settings.lastSmsImport > 864e5;

  // ================================================================ theme
  function applyTheme() {
    const t = S.settings.theme || 'system';
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    try { localStorage.setItem('dirhamTheme', JSON.stringify(t)); } catch {}
    $('#themeColor').setAttribute('content', isDark() ? '#000000' : '#f2f3f6');
  }
  function isDark() { const t = document.documentElement.dataset.theme; return t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches); }
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); render(); }); } catch {}

  // ================================================================ sheet
  let onSheetClose = null;
  function openSheet(html, after, onClose) {
    const w = $('#sheetWrap'); const s = $('#sheet');
    s.innerHTML = '<div class="grab"></div>' + html; w.hidden = false; s.scrollTop = 0;
    document.body.style.overflow = 'hidden'; onSheetClose = onClose || null;
    if (after) after(s);
  }
  function closeSheet() { $('#sheetWrap').hidden = true; document.body.style.overflow = ''; const f = onSheetClose; onSheetClose = null; if (f) f(); }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

  // ================================================================ money logic
  // scope: 'personal' | 'kid'. Kid items carry paidBy ('me'|'ex') and myShare (0-100 = % I bear).
  const isKid = (t) => t.scope === 'kid';
  const myShareOf = (t) => (t.myShare == null ? S.settings.profile.defaultShare : t.myShare) / 100;
  function inScope(t, scope) { return scope === 'all' ? true : scope === 'kid' ? isKid(t) : !isKid(t); }
  const outflow = (t) => (t.type === 'expense' && !(isKid(t) && t.paidBy === 'ex') ? t.aed : 0); // money that left MY accounts
  function spentIn(list, scope) {
    let s = 0;
    for (const t of list) { if (t.type !== 'expense' || !inScope(t, scope)) continue; s += scope === 'kid' ? t.aed : outflow(t); }
    return s;
  }
  function incomeIn(list, scope) { return scope === 'kid' ? 0 : list.reduce((a, t) => a + (t.type === 'income' && inScope(t, scope) ? t.aed : 0), 0); }
  function kidStats(list) {
    const o = { total: 0, paidMe: 0, paidEx: 0, myShare: 0, exShare: 0, net: 0, settledToMe: 0, settledToEx: 0, n: 0 };
    for (const t of list) {
      if (!isKid(t)) continue;
      if (t.type === 'expense') {
        const sh = myShareOf(t); o.n++;
        o.total += t.aed; o.myShare += t.aed * sh; o.exShare += t.aed * (1 - sh);
        if (t.paidBy === 'ex') { o.paidEx += t.aed; o.net -= t.aed * sh; } else { o.paidMe += t.aed; o.net += t.aed * (1 - sh); }
      } else if (t.type === 'settlement') {
        if (t.paidBy === 'ex') { o.net -= t.aed; o.settledToMe += t.aed; } else { o.net += t.aed; o.settledToEx += t.aed; }
      }
    }
    return o; // net > 0 → ex owes me
  }
  function byCategory(list, scope) {
    const m = new Map();
    for (const t of list) {
      if (t.type !== 'expense' || !inScope(t, scope)) continue;
      const v = scope === 'kid' ? t.aed : outflow(t); if (!v) continue;
      m.set(t.category, (m.get(t.category) || 0) + v);
    }
    return Array.from(m, ([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v);
  }
  const monthTx = (k) => S.txns.filter((t) => t.date.startsWith(k));
  function balanceText(net) { if (Math.abs(net) < 0.5) return 'All settled'; return net > 0 ? `${exN()} owes you` : `You owe ${exN()}`; }
  // categorisation with ledger (user rules first)
  function classify(merchant, type, raw) {
    const key = ' ' + P.merchantKey(merchant) + ' ';
    const rules = S.settings.rules.slice().sort((a, b) => b.pattern.length - a.pattern.length);
    for (const r of rules) {
      if (r.pattern && key.includes(r.pattern) && cat(r.category).kind === type) return { category: r.category, scope: r.scope || (isKidCat(r.category) ? 'kid' : 'personal') };
    }
    const c = P.categorize(merchant, [], type, raw);
    return { category: c, scope: isKidCat(c) ? 'kid' : 'personal' };
  }
  function kidFields(scope) { return scope === 'kid' ? { scope: 'kid', paidBy: 'me', myShare: S.settings.profile.defaultShare } : { scope: 'personal' }; }

  // ================================================================ render
  const views = {};
  function render() {
    $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab));
    $('#kidTabLabel').textContent = S.settings.profile.kid || 'Kid';
    if (S.tab !== 'activity') { S.selecting = false; S.selected.clear(); }
    renderSelbar();
    views[S.tab]();
  }
  function go(tab) { S.tab = tab; render(); window.scrollTo(0, 0); }
  $$('.tabbar button').forEach((b) => (b.onclick = () => {
    if (b.dataset.tab === 'add') { editTx(null, { scope: S.tab === 'kid' || (S.tab === 'home' && S.scope === 'kid') ? 'kid' : 'personal' }); return; }
    if (b.dataset.tab === 'activity') S.filter = { q: '', scope: 'all', month: '', cat: '' };
    go(b.dataset.tab);
  }));
  function monthSel(key, id, disabledNext) {
    return `<div class="monthsel"><button class="mbtn" id="${id}Prev" aria-label="Previous month">${ico('left')}</button><span class="m">${monthLabel(key)}</span><button class="mbtn" id="${id}Next" aria-label="Next month" ${disabledNext ? 'disabled' : ''}>${ico('right')}</button></div>`;
  }
  function animateAmount(el, to) {
    if (!el) return; const t0 = performance.now(), dur = 550;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.innerHTML = bigMoney(to); return; }
    const step = (t) => { const p = Math.min(1, (t - t0) / dur); const e = 1 - Math.pow(1 - p, 3); el.innerHTML = bigMoney(to * e); if (p < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- HOME
  let lastHeroKey = '';
  views.home = function () {
    const k = S.month, scope = S.scope; const list = monthTx(k); const prevList = monthTx(shiftMonth(k, -1));
    const isNow = k === monthKey(new Date());
    const [Y, M] = k.split('-').map(Number); const dim = new Date(Y, M, 0).getDate(); const dayN = isNow ? new Date().getDate() : dim;
    const spent = spentIn(list, scope), prevSpent = spentIn(prevList, scope), income = incomeIn(list, scope);
    const ks = kidStats(list), allKs = kidStats(S.txns);
    const kidMode = scope === 'kid';
    const diff = prevSpent ? ((spent - prevSpent) / prevSpent) * 100 : null;
    const kidMine = list.filter(isKid).reduce((a, t) => a + outflow(t), 0);

    let h = `<header class="appbar"><div class="avatar">${initials(me())}</div><div class="grow"><div class="hello">${greeting()}</div><div class="name">${esc(S.settings.profile.name || 'Welcome')}</div></div>
      <button class="iconbtn" id="themeBtn" aria-label="Switch light or dark">${ico(isDark() ? 'sun' : 'moon')}</button>
      <button class="iconbtn" id="importBtn" aria-label="Import SMS">${ico('download')}${stale() && S.txns.length ? '<i class="dot"></i>' : ''}</button></header>`;
    h += `<div class="seg ${kidMode ? 'kidon' : ''}" id="scopeSeg">${[['all', 'Overview'], ['personal', 'Personal'], ['kid', esc(kidN())]].map(([v, l]) => `<button data-v="${v}" class="${scope === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;

    if (!S.txns.length) {
      h += `<div class="card empty" style="margin-top:18px"><b>Let’s bring in your spending</b>Everything stays on this phone — nothing is uploaded.<br><br>
        <button class="btn" id="eGuide">${ico('bell')} Set up automatic SMS capture</button><button class="btn plain" id="eImport">Import SMS file</button><button class="btn plain" id="ePaste">Paste bank SMS to try it</button></div>`;
      $('#view').innerHTML = h; bindHomeTop();
      $('#eGuide').onclick = showShortcutGuide; $('#ePaste').onclick = showPaste; $('#eImport').onclick = () => $('#fileSms').click();
      return;
    }

    h += `<div style="height:12px"></div>` + monthSel(k, 'm', isNow);
    const heroLbl = scope === 'all' ? 'Total spent' : scope === 'personal' ? 'Personal spending' : `${esc(kidN())}’s expenses`;
    const budget = kidMode ? +S.settings.kidBudget || 0 : +S.settings.totalBudget || 0;
    const budSpent = kidMode ? spent : spentIn(list, 'personal');
    h += `<section class="hero ${kidMode ? 'kid' : ''}"><div class="top"><span class="lbl">${heroLbl} · ${monthLabel(k, 'l')}</span>${diff == null ? '' : `<span class="delta">${diff <= 0 ? '↓' : '↑'} ${Math.abs(diff).toFixed(0)}% vs ${monthLabel(shiftMonth(k, -1), 's')}</span>`}</div>
      <div class="amount" id="heroAmt">${bigMoney(spent)}</div>
      <div class="sub">${kidMode ? `${ks.n} expense${ks.n === 1 ? '' : 's'} · ${esc(balanceText(allKs.net))}${Math.abs(allKs.net) >= 0.5 ? ' AED ' + money(Math.abs(allKs.net), 0) : ''}` : `${money(spent / Math.max(1, dayN), 0)} AED a day on average`}</div>`;
    if (kidMode) h += `<div class="stats"><div><div class="k">You paid</div><div class="v">${money(ks.paidMe, 0)}</div></div><div><div class="k">${esc(exN())} paid</div><div class="v">${money(ks.paidEx, 0)}</div></div><div><div class="k">Your share</div><div class="v">${money(ks.myShare, 0)}</div></div></div>`;
    else h += `<div class="stats"><div><div class="k">Money in</div><div class="v">${money(income, 0)}</div></div><div><div class="k">Net</div><div class="v">${income - spent < 0 ? '−' : '+'}${money(Math.abs(income - spent), 0)}</div></div><div><div class="k">${scope === 'all' ? `For ${esc(kidN())}` : 'Transactions'}</div><div class="v">${scope === 'all' ? money(kidMine, 0) : list.filter((t) => !isKid(t)).length}</div></div></div>`;
    if (budget) { const p = budSpent / budget; h += `<div class="bud"><div class="track"><i style="width:${Math.min(100, p * 100)}%"></i></div><div class="row"><span>${p > 1 ? '⚠ Over budget by ' + money(budSpent - budget, 0) : money(budget - budSpent, 0) + ' left of ' + money(budget, 0) + (kidMode ? '' : ' personal budget')}</span><span>${Math.round(p * 100)}%</span></div></div>`; }
    h += `</section>`;

    h += `<div class="quick">
      <button id="qImport"><span class="qi">${ico('download')}${stale() ? '<i class="dot"></i>' : ''}</span>Import</button>
      <button id="qAdd"><span class="qi">${ico('plus')}</span>Add</button>
      <button id="qPdf"><span class="qi">${ico('doc')}</span>Statement</button>
      <button id="qSettle"><span class="qi kid">${ico('swap')}</span>Settle up</button></div>`;
    if (stale()) h += `<button class="banner" id="staleBanner">${ico('bell')}<span>Last SMS import <b>${ago(S.settings.lastSmsImport)}</b>. Tap to bring in new transactions.</span></button>`;

    if (scope === 'all') {
      const pers = spentIn(list, 'personal');
      h += `<div class="duo"><button class="card" data-scope="personal"><div class="tile-ico" style="background:var(--accent-soft);color:var(--accent)">${ico('wallet')}</div><div class="label">Personal</div><div class="v">${money(pers, 0)}</div><div class="s">AED this month</div></button>
        <button class="card" data-scope="kid"><div class="tile-ico" style="background:var(--kid-soft);color:var(--kid)">${ico('smile')}</div><div class="label">${esc(kidN())} · you paid</div><div class="v">${money(kidMine, 0)}</div><div class="s">${Math.abs(allKs.net) < 0.5 ? 'All settled' : (allKs.net > 0 ? esc(exN()) + ' owes you ' : 'You owe ') + money(Math.abs(allKs.net), 0)}</div></button></div>`;
    }

    const cur = cumulative(list, scope, dim, dayN); const [pY, pM] = shiftMonth(k, -1).split('-').map(Number); const pdim = new Date(pY, pM, 0).getDate();
    const prev = cumulative(prevList, scope, pdim, pdim);
    h += `<div class="card"><div class="card-head"><h3>Spending pace</h3><span class="small muted">tap the chart</span></div>
      <div class="chart" id="pace">${paceSvg(cur, prev, dim, kidMode)}</div>
      <div class="chart-x"><span>1 ${monthLabel(k, 's')}</span><span>${Math.ceil(dim / 2)}</span><span>${dim}</span></div>
      <div class="legend"><span><i class="${kidMode ? 'kid' : ''}"></i>${monthLabel(k, 'l')} · ${money(spent, 0)}</span><span><i class="prev"></i>${monthLabel(shiftMonth(k, -1), 'l')} · ${money(prevSpent, 0)}</span></div></div>`;

    const bc = byCategory(list, scope); const max = bc.length ? bc[0].v : 1;
    h += `<div class="card flush"><div class="card-head"><h3>Where it went</h3><button class="link ${kidMode ? 'kid' : ''}" id="budBtn">Budgets</button></div>`;
    if (!bc.length) h += `<div class="empty">No spending here this month.</div>`;
    for (const c of bc.slice(0, 8)) {
      const C = cat(c.id); const b = +S.settings.budgets[c.id] || 0; const p = b ? c.v / b : 0;
      const cls = b ? (p > 1 ? 'over' : p >= 0.8 ? 'warn' : '') : (isKidCat(c.id) || kidMode ? 'kid' : '');
      h += `<button class="row" data-cat="${c.id}">${catIco(c.id)}<span class="grow"><div class="t1">${esc(C.name)}</div><div class="bar ${cls}"><i style="width:${Math.max(3, (b ? Math.min(1, p) : c.v / max) * 100)}%"></i></div>
        ${b ? `<div class="status"><span class="${p > 1 ? 's-over' : p >= .8 ? 's-warn' : 's-good'}">${p > 1 ? '⚠ Over by ' + money(c.v - b, 0) : (p >= .8 ? '● ' : '✓ ') + money(b - c.v, 0) + ' left'}</span><span class="muted">of ${money(b, 0)}</span></div>` : ''}</span>
        <span class="amt">${money(c.v)}<small>${spent ? Math.round((c.v / spent) * 100) : 0}%</small></span></button>`;
    }
    if (bc.length > 8) h += `<button class="row" id="moreCats"><span class="grow small muted" style="padding-left:54px">+ ${bc.length - 8} more categories</span><span class="chev">${ico('right')}</span></button>`;
    h += `</div>`;

    const recent = S.txns.filter((t) => inScope(t, scope)).slice(0, 6);
    h += `<div class="card flush"><div class="card-head"><h3>Recent</h3><button class="link ${kidMode ? 'kid' : ''}" id="seeAll">See all</button></div>${recent.map(txRow).join('') || '<div class="empty">Nothing yet.</div>'}</div>`;

    $('#view').innerHTML = h;
    if (k + scope !== lastHeroKey) { lastHeroKey = k + scope; animateAmount($('#heroAmt'), spent); }
    bindHomeTop();
    $('#mPrev').onclick = () => { S.month = shiftMonth(S.month, -1); render(); };
    $('#mNext').onclick = () => { S.month = shiftMonth(S.month, 1); render(); };
    $('#qImport').onclick = () => $('#fileSms').click();
    $('#qAdd').onclick = () => editTx(null, { scope: kidMode ? 'kid' : 'personal' });
    $('#qPdf').onclick = () => $('#filePdf').click();
    $('#qSettle').onclick = () => settleUp();
    $('#staleBanner') && ($('#staleBanner').onclick = () => $('#fileSms').click());
    $$('[data-scope]').forEach((b) => (b.onclick = () => { S.scope = b.dataset.scope; render(); window.scrollTo(0, 0); }));
    $('#budBtn').onclick = showBudgets;
    $('#seeAll').onclick = () => { S.filter = { q: '', scope, month: '', cat: '' }; go('activity'); };
    $('#moreCats') && ($('#moreCats').onclick = () => { S.filter = { q: '', scope, month: k, cat: '' }; go('activity'); });
    $$('[data-cat]').forEach((b) => (b.onclick = () => { S.filter = { q: '', scope, month: k, cat: b.dataset.cat }; go('activity'); }));
    bindPace(cur, prev, k, kidMode);
    bindTxRows($('#view'));
  };
  function bindHomeTop() {
    $('#themeBtn').onclick = async () => { S.settings.theme = isDark() ? 'light' : 'dark'; applyTheme(); await saveSettings(); render(); };
    $('#importBtn').onclick = () => $('#fileSms').click();
    $$('#scopeSeg button').forEach((b) => (b.onclick = () => { S.scope = b.dataset.v; render(); }));
  }
  function cumulative(list, scope, dim, upto) {
    const d = new Array(dim).fill(0);
    for (const t of list) { if (t.type !== 'expense' || !inScope(t, scope)) continue; d[+t.date.slice(8, 10) - 1] += scope === 'kid' ? t.aed : outflow(t); }
    const out = []; let s = 0; for (let i = 0; i < dim; i++) { s += d[i]; out.push(i < upto ? s : null); } return out;
  }
  const PW = 600, PH = 170, PT = 10, PB = 6;
  function paceGeom(cur, prev) {
    const max = Math.max(1, ...cur.filter((v) => v != null), ...prev.filter((v) => v != null)) * 1.08;
    const n = Math.max(cur.length, prev.length);
    return { x: (i) => (i / (n - 1)) * PW, y: (v) => PT + (PH - PT - PB) * (1 - v / max), n };
  }
  function paceSvg(cur, prev, dim, kid) {
    const g = paceGeom(cur, prev);
    const path = (arr) => arr.map((v, i) => (v == null ? '' : `${i === 0 || arr[i - 1] == null ? 'M' : 'L'}${g.x(i).toFixed(1)},${g.y(v).toFixed(1)}`)).join('');
    const lastI = cur.reduce((a, v, i) => (v != null ? i : a), -1);
    let s = `<svg viewBox="0 0 ${PW} ${PH}" preserveAspectRatio="none" role="img" aria-label="Cumulative spending this month compared with last month">`;
    for (const f of [0.25, 0.5, 0.75, 1]) { const yy = PT + (PH - PT - PB) * (1 - f); s += `<line class="gl" x1="0" x2="${PW}" y1="${yy}" y2="${yy}" vector-effect="non-scaling-stroke"/>`; }
    s += `<path class="l-prev" d="${path(prev)}" vector-effect="non-scaling-stroke"/>`;
    if (lastI >= 0) s += `<path class="a-now ${kid ? 'kid' : ''}" d="${path(cur)}L${g.x(lastI)},${PH}L0,${PH}Z"/><path class="l-now ${kid ? 'kid' : ''}" d="${path(cur)}" vector-effect="non-scaling-stroke"/>`;
    s += `<line class="cross" id="paceX" x1="0" x2="0" y1="0" y2="${PH}" vector-effect="non-scaling-stroke" style="display:none"/></svg>`;
    return s;
  }
  function bindPace(cur, prev, k, kid) {
    const el = $('#pace'); if (!el) return; const svg = el.querySelector('svg'); const g = paceGeom(cur, prev);
    let tip, dn, dp;
    const show = (cx) => {
      const r = svg.getBoundingClientRect(); const i = Math.max(0, Math.min(g.n - 1, Math.round(((cx - r.left) / r.width) * (g.n - 1))));
      const px = (g.x(i) / PW) * r.width; const line = $('#paceX', svg); line.style.display = ''; line.setAttribute('x1', g.x(i)); line.setAttribute('x2', g.x(i));
      if (!tip) {
        tip = document.createElement('div'); tip.className = 'tip'; el.appendChild(tip);
        dn = document.createElement('div'); dp = document.createElement('div');
        [dn, dp].forEach((d) => { d.style.cssText = 'position:absolute;width:11px;height:11px;border-radius:50%;transform:translate(-50%,-50%);border:2px solid var(--surface);pointer-events:none'; el.appendChild(d); });
        dn.style.background = kid ? 'var(--kid)' : 'var(--accent)'; dp.style.background = 'var(--text-3)';
      }
      const [Y, M] = k.split('-').map(Number);
      const lab = new Date(Y, M - 1, i + 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const cv = cur[i], pv = prev[i];
      tip.innerHTML = `${lab}: <b>${cv == null ? '—' : money(cv, 0)}</b><br><span style="opacity:.7">${monthLabel(shiftMonth(k, -1), 's')} ${i + 1}: ${pv == null ? '—' : money(pv, 0)}</span>`;
      tip.style.left = Math.max(70, Math.min(r.width - 70, px)) + 'px';
      const sy = r.height / PH;
      if (cv != null) { dn.style.display = ''; dn.style.left = px + 'px'; dn.style.top = g.y(cv) * sy + 'px'; } else dn.style.display = 'none';
      if (pv != null) { dp.style.display = ''; dp.style.left = px + 'px'; dp.style.top = g.y(pv) * sy + 'px'; } else dp.style.display = 'none';
    };
    const hide = () => { if (tip) { tip.remove(); dn.remove(); dp.remove(); tip = null; } const l = $('#paceX', svg); if (l) l.style.display = 'none'; };
    svg.addEventListener('pointerdown', (e) => show(e.clientX));
    svg.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) show(e.clientX); });
    svg.addEventListener('pointerleave', hide);
    svg.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') setTimeout(hide, 1800); });
  }

  function txRow(t) {
    const C = cat(t.category); const kid = isKid(t);
    let cls = '', sign = '−';
    if (t.type === 'income') { cls = 'in'; sign = '+'; } else if (t.type === 'transfer') { cls = 'tr'; sign = ''; }
    else if (t.type === 'settlement') { cls = t.paidBy === 'ex' ? 'in' : ''; sign = t.paidBy === 'ex' ? '+' : '−'; }
    const extra = t.currency !== 'AED' ? `<small>${t.currency} ${money(t.amount)}</small>` : kid && t.type === 'expense' ? `<small>${t.paidBy === 'ex' ? esc(exN()) + ' paid' : 'your share ' + money(t.aed * myShareOf(t), 0)}</small>` : '';
    let sub = esc(C.name);
    if (kid && t.type === 'expense') sub = `<span class="pill kid">${esc(kidN())}</span>${esc(C.name)}`;
    if (t.type === 'settlement') sub = `<span class="pill kid">Settlement</span>${t.note ? esc(t.note) : ''}`;
    if (t.review) sub = `<span class="pill warn">Check</span>` + sub;
    const selected = S.selecting ? `<span class="sel ${S.selected.has(t.id) ? 'on' : ''}">${S.selected.has(t.id) ? ico('check') : ''}</span>` : '';
    const title = t.type === 'settlement' ? (t.paidBy === 'ex' ? `${esc(exN())} paid you` : `You paid ${esc(exN())}`) : esc(t.merchant || C.name);
    return `<button class="row" data-id="${t.id}">${selected}${catIco(t.category, kid && !isKidCat(t.category) && t.type !== 'settlement')}<span class="grow"><div class="t1">${title}</div><div class="t2">${sub}${t.time ? ' · ' + t.time : ''}</div></span><span class="amt ${cls}">${sign}${money(t.aed)}${extra}</span></button>`;
  }
  function bindTxRows(root = document) {
    $$('[data-id]', root).forEach((b) => (b.onclick = () => {
      if (S.selecting) { const id = b.dataset.id; S.selected.has(id) ? S.selected.delete(id) : S.selected.add(id); views.activity(true); renderSelbar(); return; }
      editTx(S.txns.find((t) => t.id === b.dataset.id));
    }));
  }

  // ---------------------------------------------------------------- ACTIVITY
  views.activity = function (keepScroll) {
    const f = S.filter; const y = window.scrollY;
    const months = Array.from(new Set(S.txns.map((t) => t.date.slice(0, 7)))).sort().reverse();
    let h = `<header class="appbar"><div class="grow"><h1>Activity</h1></div><button class="link" id="selBtn">${S.selecting ? 'Done' : 'Select'}</button></header>
      <label class="search">${ico('search')}<input id="q" type="search" placeholder="Search merchant, category, amount" value="${esc(f.q)}" autocomplete="off"></label>
      <div class="seg ${f.scope === 'kid' ? 'kidon' : ''}" id="fScope" style="margin-bottom:10px">${[['all', 'All'], ['personal', 'Personal'], ['kid', esc(kidN())]].map(([v, l]) => `<button data-v="${v}" class="${f.scope === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="chips" id="chips"><button class="chip ${!f.month ? 'on' : ''}" data-m="">All time</button>${months.map((m) => `<button class="chip ${f.month === m ? 'on' : ''}" data-m="${m}">${monthLabel(m)}</button>`).join('')}</div>`;
    if (f.cat) h += `<div class="chips"><button class="chip on" id="clearCat">${esc(cat(f.cat).name)} ✕</button></div>`;
    if (S.selecting) h += `<div class="small muted" style="margin:0 6px 4px">Tap transactions to select them, then move them to ${esc(kidN())} or Personal.</div>`;
    h += `<div id="list"></div>`;
    $('#view').innerHTML = h;
    const draw = () => {
      const q = f.q.trim().toLowerCase();
      const list = S.txns.filter((t) => (!f.month || t.date.startsWith(f.month)) && inScope(t, f.scope) && (!f.cat || t.category === f.cat) &&
        (!q || (t.merchant || '').toLowerCase().includes(q) || (t.note || '').toLowerCase().includes(q) || String(t.aed).includes(q) || cat(t.category).name.toLowerCase().includes(q)));
      if (!list.length) { $('#list').innerHTML = `<div class="empty"><b>No transactions</b>${S.txns.length ? 'Try another filter.' : 'Import your bank SMS to get started.'}</div>`; return; }
      const sp = spentIn(list, f.scope);
      let out = `<div class="small muted" style="margin:6px 6px 0">${list.length} transactions · ${money(sp)} AED spent</div>`;
      let day = null, buf = [];
      const flush = () => { if (!buf.length) return; const s = spentIn(buf, f.scope); out += `<div class="dayhead"><span>${dayLabel(day)}</span><span class="num">${s ? '−' + money(s) : ''}</span></div><div class="card flush" style="margin:0">${buf.map(txRow).join('')}</div>`; buf = []; };
      for (const t of list.slice(0, 500)) { if (t.date !== day) { flush(); day = t.date; } buf.push(t); }
      flush();
      if (list.length > 500) out += `<div class="empty small">Showing the latest 500 — narrow with search or month.</div>`;
      $('#list').innerHTML = out; bindTxRows($('#list'));
    };
    draw();
    if (keepScroll) window.scrollTo(0, y);
    $('#q').oninput = (e) => { f.q = e.target.value; draw(); };
    $$('#fScope button').forEach((b) => (b.onclick = () => { f.scope = b.dataset.v; views.activity(); }));
    $$('#chips .chip').forEach((c) => (c.onclick = () => { f.month = c.dataset.m; views.activity(); }));
    $('#clearCat') && ($('#clearCat').onclick = () => { f.cat = ''; views.activity(); });
    $('#selBtn').onclick = () => { S.selecting = !S.selecting; S.selected.clear(); views.activity(true); renderSelbar(); };
  };
  function renderSelbar() {
    const w = $('#selbarWrap');
    if (!(S.tab === 'activity' && S.selecting)) { w.innerHTML = ''; return; }
    const n = S.selected.size;
    w.innerHTML = `<div class="selbar"><span>${n} selected</span><button class="k" id="sbKid" ${n ? '' : 'disabled'}>→ ${esc(kidN())}</button><button id="sbPers" ${n ? '' : 'disabled'}>→ Personal</button><button id="sbDel" ${n ? '' : 'disabled'}>Delete</button></div>`;
    const apply = async (scope) => {
      const ch = S.txns.filter((t) => S.selected.has(t.id) && t.type !== 'settlement');
      ch.forEach((t) => { if (scope === 'kid') { if (!isKid(t)) Object.assign(t, kidFields('kid')); } else { t.scope = 'personal'; delete t.paidBy; delete t.myShare; if (isKidCat(t.category)) t.category = 'other'; } });
      await putMany('txns', ch); S.selected.clear(); S.selecting = false; render(); toast(`${ch.length} moved to ${scope === 'kid' ? kidN() : 'Personal'}`);
    };
    $('#sbKid').onclick = () => apply('kid'); $('#sbPers').onclick = () => apply('personal');
    $('#sbDel').onclick = async () => { if (!confirm(`Delete ${n} transactions?`)) return; await delMany('txns', [...S.selected]); S.txns = S.txns.filter((t) => !S.selected.has(t.id)); S.selected.clear(); S.selecting = false; render(); toast('Deleted'); };
  }

  // ---------------------------------------------------------------- KID HUB
  views.kid = function () {
    const k = S.kidMonth; const isNow = k === monthKey(new Date());
    const all = kidStats(S.txns); const ks = kidStats(monthTx(k));
    const net = all.net; const settled = Math.abs(net) < 0.5;
    let h = `<header class="appbar"><div class="avatar kid">${initials(kidN())}</div><div class="grow"><div class="hello">Co-parenting</div><div class="name">${esc(kidN())}</div></div><button class="iconbtn" id="kidSettings" aria-label="Names and split">${ico('gear')}</button></header>`;
    h += `<section class="hero kid"><div class="balance-people"><div class="who"><span class="avatar sm">${initials(me())}</span>${esc(me())}</div><div class="arrow ${net > 0 ? 'rev' : ''}" ${settled ? 'style="opacity:.3"' : ''}></div><div class="who"><span class="avatar sm">${initials(exN())}</span>${esc(exN())}</div></div>
      <div class="lbl">${esc(balanceText(net))}</div><div class="amount">${bigMoney(Math.abs(net))}</div>
      <div class="sub">${settled ? 'Nobody owes anything right now.' : `Across all of ${esc(kidN())}’s expenses and settlements.`}</div>
      <div class="actions"><button id="kSettle">${ico('swap')} Settle up</button><button class="ghost" id="kReport">${ico('share')} Report</button></div></section>`;
    h += monthSel(k, 'km', isNow);
    h += `<div class="card"><div class="tiles"><div><div class="label">Total for ${esc(kidN())}</div><div class="v">${money(ks.total)}</div></div><div><div class="label">Your share</div><div class="v">${money(ks.myShare)}</div></div>
      <div><div class="label">You paid</div><div class="v">${money(ks.paidMe)}</div></div><div><div class="label">${esc(exN())} paid</div><div class="v">${money(ks.paidEx)}</div></div></div>
      ${ks.total ? `<div class="split"><i style="width:${(ks.myShare / ks.total) * 100}%"></i><i style="width:${(ks.exShare / ks.total) * 100}%"></i></div><div class="split-legend"><span><i></i>${esc(me())} ${Math.round((ks.myShare / ks.total) * 100)}% · ${money(ks.myShare, 0)}</span><span><i class="ex"></i>${esc(exN())} ${Math.round((ks.exShare / ks.total) * 100)}% · ${money(ks.exShare, 0)}</span></div>` : ''}
      ${(+S.settings.kidBudget) ? `<div style="margin-top:14px"><div class="label">Monthly budget</div><div class="bar ${ks.total > S.settings.kidBudget ? 'over' : 'kid'}"><i style="width:${Math.min(100, (ks.total / S.settings.kidBudget) * 100)}%"></i></div><div class="status"><span class="${ks.total > S.settings.kidBudget ? 's-over' : 's-good'}">${ks.total > S.settings.kidBudget ? '⚠ Over by ' + money(ks.total - S.settings.kidBudget, 0) : '✓ ' + money(S.settings.kidBudget - ks.total, 0) + ' left'}</span><span class="muted">of ${money(S.settings.kidBudget, 0)}</span></div></div>` : ''}</div>`;
    const bc = byCategory(monthTx(k), 'kid'); const max = bc.length ? bc[0].v : 1;
    h += `<div class="card flush"><div class="card-head"><h3>By category</h3><span class="small muted">${monthLabel(k, 'l')}</span></div>`;
    h += bc.length ? bc.map((c) => `<button class="row" data-kcat="${c.id}">${catIco(c.id)}<span class="grow"><div class="t1">${esc(cat(c.id).name)}</div><div class="bar kid"><i style="width:${Math.max(3, (c.v / max) * 100)}%"></i></div></span><span class="amt">${money(c.v)}</span></button>`).join('') : `<div class="empty"><b>No expenses for ${esc(kidN())} in ${monthLabel(k, 'l')}</b>Open any transaction and switch it to “${esc(kidN())}”, or use Activity → Select to move several at once.</div>`;
    h += `</div>`;
    const items = monthTx(k).filter(isKid);
    h += `<div class="card flush"><div class="card-head"><h3>Transactions</h3><button class="link kid" id="kAdd">+ Add</button></div>${items.map(txRow).join('') || '<div class="empty">Nothing this month.</div>'}</div>`;
    $('#view').innerHTML = h;
    $('#kmPrev').onclick = () => { S.kidMonth = shiftMonth(S.kidMonth, -1); render(); };
    $('#kmNext').onclick = () => { S.kidMonth = shiftMonth(S.kidMonth, 1); render(); };
    $('#kSettle').onclick = () => settleUp(); $('#kReport').onclick = () => kidReport(k);
    $('#kAdd').onclick = () => editTx(null, { scope: 'kid' }); $('#kidSettings').onclick = showProfile;
    $$('[data-kcat]').forEach((b) => (b.onclick = () => { S.filter = { q: '', scope: 'kid', month: k, cat: b.dataset.kcat }; go('activity'); }));
    bindTxRows($('#view'));
  };

  // ---------------------------------------------------------------- SETTINGS
  views.settings = function () {
    const p = S.settings.profile; const n = S.txns.length;
    const r = (id, icon, col, t1, t2) => `<button class="row" id="${id}"><span class="cat-ico" style="color:${col};background:color-mix(in srgb, ${col} 14%, transparent)">${ico(icon)}</span><span class="grow"><div class="t1">${t1}</div><div class="t2">${t2}</div></span><span class="chev">${ico('right')}</span></button>`;
    $('#view').innerHTML = `<header class="appbar"><div class="grow"><h1>Settings</h1></div></header>
      <div class="card flush"><button class="row" id="sProfile"><span class="avatar">${initials(me())}</span><span class="grow"><div class="t1">${esc(p.name || 'Set up your profile')}</div><div class="t2">${esc(kidN())} · shared with ${esc(exN())} · you pay ${p.defaultShare}% by default</div></span><span class="chev">${ico('right')}</span></button></div>
      <div class="section-title">Appearance</div>
      <div class="card"><div class="theme-pick" id="themePick">${[['system', 's', 'Automatic'], ['light', 'l', 'Light'], ['dark', 'd', 'Dark']].map(([v, c, l]) => `<button data-v="${v}" class="${(S.settings.theme || 'system') === v ? 'on' : ''}"><span class="sw ${c}"></span>${l}</button>`).join('')}</div></div>
      <div class="section-title">Money</div>
      <div class="card flush">
        ${r('sBudgets', 'target', 'var(--t-green)', 'Budgets', `${Object.values(S.settings.budgets).filter(Number).length} categories${S.settings.totalBudget ? ' · personal ' + money(S.settings.totalBudget, 0) : ''}${S.settings.kidBudget ? ' · ' + esc(kidN()) + ' ' + money(S.settings.kidBudget, 0) : ''}`)}
        ${r('sRules', 'tag', 'var(--t-purple)', 'Merchant rules', `${S.settings.rules.length} learned from your edits`)}
        ${r('sCats', 'palette', 'var(--t-pink)', 'Categories', `${cats().length - 1} categories`)}
        ${r('sFx', 'globe', 'var(--t-teal)', 'Exchange rates', 'For purchases in other currencies')}
      </div>
      <div class="section-title">Import</div>
      <div class="card flush">
        ${r('sImport', 'download', 'var(--accent)', 'Import SMS file', 'Last import ' + ago(S.settings.lastSmsImport))}
        ${r('sPaste', 'doc', 'var(--t-indigo)', 'Paste SMS text', 'Copy messages from the Messages app')}
        ${r('sPdf', 'doc', 'var(--t-orange)', 'Import PDF statement', 'ENBD / Liv account & card statements')}
        ${r('sGuide', 'bell', 'var(--t-amber)', 'Automatic SMS capture', 'Shortcuts automation setup')}
      </div>
      <div class="section-title">Your data</div>
      <div class="card flush">
        ${r('sBackup', 'share', 'var(--t-blue)', 'Back up now', 'Last backup ' + ago(S.settings.lastBackup))}
        ${r('sRestore', 'undo', 'var(--t-teal)', 'Restore from backup', 'Merges a Dirham .json backup')}
        ${r('sCsv', 'chart', 'var(--t-green)', 'Export CSV', 'For Excel or Numbers')}
      </div>
      <div class="card small muted">${n} transactions stored only on this iPhone. Nothing is uploaded. Deleting the Home Screen app deletes the data — back up regularly.</div>
      <button class="btn danger" id="sWipe">${ico('trash')} Erase all data</button>
      <div class="small muted" style="text-align:center;margin:16px 0">Dirham 2.0 · works offline</div>`;
    $('#sProfile').onclick = showProfile; $('#sBudgets').onclick = showBudgets; $('#sRules').onclick = showRules; $('#sCats').onclick = showCats; $('#sFx').onclick = showFx;
    $('#sImport').onclick = () => $('#fileSms').click(); $('#sPaste').onclick = showPaste; $('#sPdf').onclick = () => $('#filePdf').click(); $('#sGuide').onclick = showShortcutGuide;
    $('#sBackup').onclick = backup; $('#sRestore').onclick = () => $('#fileBackup').click(); $('#sCsv').onclick = exportCsv; $('#sWipe').onclick = wipe;
    $$('#themePick button').forEach((b) => (b.onclick = async () => { S.settings.theme = b.dataset.v; applyTheme(); await saveSettings(); render(); }));
  };

  // ================================================================ sheets
  function showProfile(first) {
    first = first === true; const p = S.settings.profile;
    openSheet(`<div class="sheet-head"><button ${first ? 'id="pSkip"' : 'data-close'}>${first ? 'Skip' : 'Cancel'}</button><h2>${first ? '' : 'Profile'}</h2><button id="pSave">${first ? 'Start' : 'Save'}</button></div>
      ${first ? `<div class="welcome-hero"><div class="logo">${ico('wallet')}</div><h2>Welcome to Dirham</h2><p class="muted" style="margin:0">Your spending, your child’s expenses, and who owes whom — private on this phone.</p></div>` : ''}
      <div class="form">
        <div class="field"><label>Your name</label><input id="pName" value="${esc(p.name)}" placeholder="e.g. Sara" autocomplete="given-name"></div>
        <div class="field"><label>Child’s name</label><input id="pKid" value="${esc(p.kid)}" placeholder="e.g. Lina"></div>
        <div class="field"><label>Co-parent</label><input id="pEx" value="${esc(p.ex)}" placeholder="e.g. Omar"></div>
      </div>
      <div class="form"><div class="field stack"><span class="fl">Default split for your child’s expenses</span>
        <div class="shares" id="pShares">${[50, 60, 70, 100].map((v) => `<button data-v="${v}">${v === 100 ? 'I pay all' : `${v} / ${100 - v}`}</button>`).join('')}</div>
        <input type="range" id="pRange" min="0" max="100" step="5" value="${p.defaultShare}">
        <div class="calc" id="pCalc"></div></div></div>
      <p class="small muted">You can change the split and who paid on any single expense.</p>`, (s) => {
      const upd = () => { const v = +$('#pRange', s).value; $('#pCalc', s).innerHTML = `You <b>${v}%</b> · ${esc($('#pEx', s).value || 'Co-parent')} <b>${100 - v}%</b>`; $$('#pShares button', s).forEach((b) => b.classList.toggle('on', +b.dataset.v === v)); };
      upd(); $('#pRange', s).oninput = upd; $('#pEx', s).oninput = upd;
      $$('#pShares button', s).forEach((b) => (b.onclick = () => { $('#pRange', s).value = b.dataset.v; upd(); }));
      const save = async () => {
        Object.assign(S.settings.profile, { name: $('#pName', s).value.trim(), kid: $('#pKid', s).value.trim(), ex: $('#pEx', s).value.trim(), defaultShare: +$('#pRange', s).value, setup: true });
        await saveSettings(); closeSheet(); render(); toast('Profile saved');
      };
      $('#pSave', s).onclick = save;
      if (first) $('#pSkip', s).onclick = async () => { S.settings.profile.setup = true; await saveSettings(); closeSheet(); };
    });
  }

  function catOptions(sel, scope, type) {
    if (type === 'settlement') return `<option value="settle" selected>Co-parent settlement</option>`;
    const list = cats().filter((c) => c.kind === type);
    const kidC = list.filter((c) => c.group === 'kid'), gen = list.filter((c) => c.group !== 'kid');
    const o = (c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`;
    if (type !== 'expense') return gen.map(o).join('');
    return scope === 'kid' ? `<optgroup label="${esc(kidN())}">${kidC.map(o).join('')}</optgroup><optgroup label="General">${gen.map(o).join('')}</optgroup>`
      : `<optgroup label="General">${gen.map(o).join('')}</optgroup><optgroup label="${esc(kidN())}">${kidC.map(o).join('')}</optgroup>`;
  }

  function editTx(t, preset = {}) {
    const isNew = !t; const now = new Date();
    const d = t ? { ...t } : Object.assign({ id: uid(), type: 'expense', amount: '', currency: 'AED', aed: 0, merchant: '', category: preset.scope === 'kid' ? 'k_other' : 'other', date: P.ymd(now), time: P.hm(now), note: '', account: '', source: 'manual', createdAt: Date.now() }, kidFields(preset.scope || 'personal'), preset);
    if (!d.scope) d.scope = 'personal';
    const curList = Object.keys(S.settings.fx).sort((a, b) => (a === 'AED' ? -1 : b === 'AED' ? 1 : a.localeCompare(b)));
    openSheet(`
      <div class="sheet-head"><button data-close>Cancel</button><h2>${isNew ? (d.type === 'settlement' ? 'Settle up' : 'New transaction') : 'Transaction'}</h2><button id="eSave">Save</button></div>
      <div class="seg forseg" id="eScope">${[['personal', 'Personal'], ['kid', esc(kidN())]].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>
      <div class="seg" id="eType" style="margin-top:8px"></div>
      <div class="bigamt"><select id="eCur">${curList.map((c) => `<option ${c === d.currency ? 'selected' : ''}>${c}</option>`).join('')}</select><input id="eAmt" inputmode="decimal" placeholder="0.00" value="${d.amount === '' ? '' : d.amount}"></div>
      <div class="form" id="eKidBox">
        <div class="field stack"><span class="fl" id="ePaidLbl">Paid by</span><div class="seg" id="ePaid"><button data-v="me"></button><button data-v="ex"></button></div></div>
        <div class="field stack" id="eShareRow"><span class="fl">Your share</span><div class="shares" id="eShares"><button data-v="50">50 / 50</button><button data-v="100">All mine</button><button data-v="0">All ${esc(exN())}</button><button data-v="custom">Custom</button></div>
          <input type="range" id="eRange" min="0" max="100" step="5" hidden><div class="calc" id="eCalc"></div></div>
      </div>
      <div class="form">
        <div class="field" id="eAedRow"><label>In AED</label><input id="eAed" inputmode="decimal" value="${d.currency === 'AED' ? '' : d.aed}"></div>
        <div class="field" id="eMerRow"><label>Merchant</label><input id="eMer" value="${esc(d.merchant)}" placeholder="e.g. Carrefour" autocomplete="off"></div>
        <div class="field" id="eCatRow"><label>Category</label><select id="eCat"></select></div>
        <div class="field"><label>Date</label><input id="eDate" type="date" value="${d.date}"></div>
        <div class="field"><label>Time</label><input id="eTime" type="time" value="${d.time || ''}"></div>
        <div class="field" id="eAccRow"><label>Card</label><input id="eAcc" value="${esc(d.account || '')}" placeholder="last 4 digits" inputmode="numeric"></div>
        <div class="field"><label>Note</label><input id="eNote" value="${esc(d.note || '')}" placeholder="optional"></div>
      </div>
      <div class="form" id="eRuleWrap" hidden><label class="field check"><span class="small" id="eRuleTxt"></span><input type="checkbox" id="eRule" ${isNew ? '' : 'checked'}></label></div>
      ${d.raw ? `<div class="section-title">Original ${d.source === 'pdf' ? 'statement line' : 'SMS'}</div><pre class="raw">${esc(d.raw)}</pre>` : ''}
      ${isNew ? '' : `<button class="btn danger" id="eDel" style="margin-top:16px">${ico('trash')} Delete</button>`}
    `, (s) => {
      let scope = d.scope, type = d.type, paidBy = d.paidBy || 'me';
      let share = d.myShare == null ? S.settings.profile.defaultShare : d.myShare; let custom = ![50, 100, 0].includes(share);
      const origCat = d.category, origScope = d.scope;
      $('#eCat', s).innerHTML = catOptions(d.category, scope, type === 'settlement' ? 'settlement' : type);
      const drawType = () => {
        const opts = scope === 'kid' ? [['expense', 'Expense'], ['settlement', 'Settlement']] : [['expense', 'Expense'], ['income', 'Income'], ['transfer', 'Transfer']];
        if (!opts.find((o) => o[0] === type)) type = 'expense';
        $('#eType', s).innerHTML = opts.map(([v, l]) => `<button data-v="${v}" class="${type === v ? 'on' : ''}">${l}</button>`).join('');
        $$('#eType button', s).forEach((b) => (b.onclick = () => { type = b.dataset.v; drawAll(); }));
      };
      const fillCats = () => {
        let sel = $('#eCat', s).value || d.category; const c = cat(sel);
        if (type === 'settlement') sel = 'settle';
        else if (c.kind !== type) sel = type === 'income' ? 'other_in' : type === 'transfer' ? 'transfer' : (scope === 'kid' ? 'k_other' : 'other');
        else if (scope === 'personal' && isKidCat(sel)) sel = 'other';
        $('#eCat', s).innerHTML = catOptions(sel, scope, type); $('#eCat', s).value = sel;
      };
      const amtNow = () => parseFloat(($('#eCur', s).value === 'AED' ? $('#eAmt', s).value : $('#eAed', s).value) || '0') || 0;
      const drawCalc = () => {
        const amt = amtNow();
        if (type === 'settlement') { $('#eCalc', s).innerHTML = ''; return; }
        const mine = amt * share / 100, theirs = amt - mine;
        let txt = `You <b>${share}%</b>${amt ? ' · AED ' + money(mine) : ''} &nbsp;·&nbsp; ${esc(exN())} <b>${100 - share}%</b>${amt ? ' · AED ' + money(theirs) : ''}`;
        if (amt) txt += `<br>${paidBy === 'me' ? (theirs ? `${esc(exN())} owes you <b>AED ${money(theirs)}</b> for this` : 'Nothing owed for this') : (mine ? `You owe ${esc(exN())} <b>AED ${money(mine)}</b> for this` : 'Nothing owed for this')}`;
        $('#eCalc', s).innerHTML = txt;
      };
      const ruleVis = () => {
        const m = $('#eMer', s).value.trim(); const c = $('#eCat', s).value;
        const changed = isNew || c !== origCat || scope !== origScope;
        const show = m && changed && (type === 'expense' || type === 'income');
        $('#eRuleWrap', s).hidden = !show;
        if (show) $('#eRuleTxt', s).innerHTML = `Always put “<b>${esc(m)}</b>” in <b>${esc(cat(c).name)}</b>${scope === 'kid' ? ` · ${esc(kidN())}` : ''}`;
      };
      const drawAll = () => {
        $$('#eScope button', s).forEach((b) => b.classList.toggle('on', b.dataset.v === scope));
        $('#eScope', s).classList.toggle('kidon', scope === 'kid');
        drawType(); fillCats();
        const kid = scope === 'kid', settle = type === 'settlement';
        $('#eKidBox', s).hidden = !kid; $('#eShareRow', s).hidden = settle;
        $('#ePaidLbl', s).textContent = settle ? 'Who paid whom' : 'Paid by';
        $$('#ePaid button', s).forEach((b) => { b.classList.toggle('on', b.dataset.v === paidBy); b.textContent = settle ? (b.dataset.v === 'ex' ? `${exN()} → ${me()}` : `${me()} → ${exN()}`) : (b.dataset.v === 'me' ? me() : exN()); });
        $$('#eShares button', s).forEach((b) => b.classList.toggle('on', custom ? b.dataset.v === 'custom' : b.dataset.v === String(share)));
        $('#eRange', s).hidden = !custom; $('#eRange', s).value = share;
        $('#eMerRow', s).hidden = settle; $('#eCatRow', s).hidden = settle; $('#eAccRow', s).hidden = settle;
        $('#eAedRow', s).hidden = $('#eCur', s).value === 'AED';
        drawCalc(); ruleVis();
      };
      $$('#eScope button', s).forEach((b) => (b.onclick = () => { scope = b.dataset.v; drawAll(); }));
      $$('#ePaid button', s).forEach((b) => (b.onclick = () => { paidBy = b.dataset.v; drawAll(); }));
      $$('#eShares button', s).forEach((b) => (b.onclick = () => { if (b.dataset.v === 'custom') { custom = true; if ([50, 100, 0].includes(share)) share = 60; } else { custom = false; share = +b.dataset.v; } drawAll(); }));
      $('#eRange', s).oninput = (e) => { share = +e.target.value; drawAll(); };
      $('#eCat', s).onchange = () => { if (isKidCat($('#eCat', s).value)) scope = 'kid'; drawAll(); };
      const recalc = () => { const c = $('#eCur', s).value; if (c !== 'AED') $('#eAed', s).value = P.toAED(parseFloat($('#eAmt', s).value) || 0, c, S.settings.fx).toFixed(2); drawAll(); };
      $('#eCur', s).onchange = recalc;
      $('#eAmt', s).oninput = () => { if ($('#eCur', s).value !== 'AED') recalc(); else drawCalc(); };
      $('#eAed', s).oninput = drawCalc;
      $('#eMer', s).oninput = () => {
        if (isNew && type !== 'settlement') {
          const g = classify($('#eMer', s).value, type);
          if (g.category !== 'other' && cat(g.category).kind === type) { if (g.scope === 'kid') scope = 'kid'; $('#eCat', s).innerHTML = catOptions(g.category, scope, type); $('#eCat', s).value = g.category; drawAll(); }
        }
        ruleVis();
      };
      drawAll();
      if (isNew) setTimeout(() => $('#eAmt', s).focus(), 320);
      $('#eSave', s).onclick = async () => {
        const amount = parseFloat(String($('#eAmt', s).value).replace(/,/g, ''));
        if (!(amount > 0)) { toast('Enter an amount'); return; }
        const cur = $('#eCur', s).value;
        const aed = cur === 'AED' ? amount : (parseFloat($('#eAed', s).value) || P.toAED(amount, cur, S.settings.fx));
        const upd = Object.assign(d, {
          type, amount, currency: cur, aed: Math.round(aed * 100) / 100, merchant: type === 'settlement' ? '' : $('#eMer', s).value.trim(),
          category: type === 'settlement' ? 'settle' : $('#eCat', s).value, date: $('#eDate', s).value || P.ymd(new Date()), time: $('#eTime', s).value,
          account: $('#eAcc', s).value.trim(), note: $('#eNote', s).value.trim(), review: false, updatedAt: Date.now(), scope
        });
        if (scope === 'kid') { upd.paidBy = paidBy; if (type === 'settlement') delete upd.myShare; else upd.myShare = share; } else { delete upd.paidBy; delete upd.myShare; }
        const toSave = [upd];
        if (!$('#eRuleWrap', s).hidden && $('#eRule', s).checked) {
          const pattern = P.merchantKey(upd.merchant);
          if (pattern) {
            S.settings.rules = S.settings.rules.filter((r) => r.pattern !== pattern).concat([{ pattern, category: upd.category, scope }]);
            await saveSettings();
            for (const o of S.txns) {
              if (o.id === upd.id || o.type !== type || P.merchantKey(o.merchant) !== pattern) continue;
              if (o.category === upd.category && (o.scope || 'personal') === scope) continue;
              o.category = upd.category;
              if (scope === 'kid') { if (!isKid(o)) Object.assign(o, kidFields('kid')); } else { o.scope = 'personal'; delete o.paidBy; delete o.myShare; }
              toSave.push(o);
            }
          }
        }
        await putMany('txns', toSave);
        if (isNew) S.txns.push(upd); else { const i = S.txns.findIndex((x) => x.id === upd.id); if (i >= 0) S.txns[i] = upd; }
        S.txns.sort(sortTx); closeSheet(); render();
        toast(toSave.length > 1 ? `Saved · ${toSave.length - 1} more “${upd.merchant}” updated` : 'Saved');
      };
      if (!isNew) $('#eDel', s).onclick = async () => { if (!confirm('Delete this transaction?')) return; await delMany('txns', [d.id]); S.txns = S.txns.filter((x) => x.id !== d.id); closeSheet(); render(); toast('Deleted'); };
    });
  }

  function settleUp() {
    const net = kidStats(S.txns).net;
    editTx(null, { scope: 'kid', type: 'settlement', category: 'settle', paidBy: net >= 0 ? 'ex' : 'me', amount: Math.abs(net) >= 0.5 ? Math.round(Math.abs(net) * 100) / 100 : '', merchant: '' });
  }

  function kidReport(k) {
    const list = monthTx(k).filter(isKid).sort((a, b) => a.date.localeCompare(b.date));
    const ks = kidStats(list); const all = kidStats(S.txns);
    const lines = [`${kidN()} — shared expenses, ${monthLabel(k)}`, '',
      `Total: AED ${money(ks.total)}`,
      `Paid by ${me()}: AED ${money(ks.paidMe)} · Paid by ${exN()}: AED ${money(ks.paidEx)}`,
      `${me()}'s share: AED ${money(ks.myShare)} · ${exN()}'s share: AED ${money(ks.exShare)}`];
    if (ks.settledToMe || ks.settledToEx) lines.push(`Settlements: ${exN()} → ${me()} AED ${money(ks.settledToMe)} · ${me()} → ${exN()} AED ${money(ks.settledToEx)}`);
    lines.push(`Overall balance: ${Math.abs(all.net) < 0.5 ? 'settled' : (all.net > 0 ? `${exN()} owes ${me()}` : `${me()} owes ${exN()}`) + ' AED ' + money(Math.abs(all.net))}`, '', 'Details:');
    for (const t of list) {
      if (t.type === 'settlement') lines.push(`${shortDate(t.date)} · Settlement · ${t.paidBy === 'ex' ? exN() + ' → ' + me() : me() + ' → ' + exN()} · AED ${money(t.aed)}`);
      else { const sh = Math.round(myShareOf(t) * 100); lines.push(`${shortDate(t.date)} · ${cat(t.category).name} · ${t.merchant || '—'} · AED ${money(t.aed)} · paid by ${t.paidBy === 'ex' ? exN() : me()} · split ${sh}/${100 - sh}`); }
    }
    const text = lines.join('\n');
    openSheet(`<div class="sheet-head"><span></span><h2>${monthLabel(k)} report</h2><button data-close>Done</button></div>
      <div class="tiles" style="margin:8px 0 12px"><div><div class="label">Total for ${esc(kidN())}</div><div class="v">${money(ks.total)}</div></div><div><div class="label">${esc(balanceText(all.net))}</div><div class="v">${money(Math.abs(all.net))}</div></div></div>
      <pre class="raw" style="max-height:42vh;overflow:auto">${esc(text)}</pre>
      <button class="btn kid" id="rText">${ico('share')} Share as message</button>
      <button class="btn soft kid" id="rCsv">${ico('doc')} Share as spreadsheet (CSV)</button>
      <p class="small muted">Send it to ${esc(exN())} on WhatsApp, or keep it for your records.</p>`, (s) => {
      $('#rText', s).onclick = async () => {
        if (navigator.share) { try { await navigator.share({ title: `${kidN()} expenses ${monthLabel(k)}`, text }); return; } catch (e) { if (e.name === 'AbortError') return; } }
        try { await navigator.clipboard.writeText(text); toast('Report copied'); } catch { toast('Long-press the text to copy'); }
      };
      $('#rCsv', s).onclick = () => {
        const q = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        const rows = [['Date', 'Type', 'Category', 'Merchant', 'Amount AED', 'Paid by', `${me()} share %`, `${me()} share AED`, `${exN()} share AED`, 'Note']];
        for (const t of list) { const sh = t.type === 'settlement' ? null : myShareOf(t); rows.push([t.date, t.type, cat(t.category).name, t.merchant, t.aed.toFixed(2), t.paidBy === 'ex' ? exN() : me(), sh == null ? '' : Math.round(sh * 100), sh == null ? '' : (t.aed * sh).toFixed(2), sh == null ? '' : (t.aed * (1 - sh)).toFixed(2), t.note]); }
        shareOrDownload(`${kidN().replace(/\W+/g, '-')}-${k}.csv`, rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
      };
    });
  }

  // ================================================================ SMS import
  function buildTxFromSms(msg, fileTime) {
    const r = P.parseSms(msg.text);
    if (r.kind !== 'txn') return { r };
    const when = msg.when || r.date || fileTime || new Date();
    const useDate = r.date && msg.when && Math.abs(r.date - msg.when) > 3 * 864e5 ? r.date : when;
    const cl = r.category ? { category: r.category, scope: 'personal' } : classify(r.merchant, r.type, msg.text);
    return {
      r, t: Object.assign({
        id: uid(), type: r.type, amount: r.amount, currency: r.currency, aed: P.toAED(r.amount, r.currency, S.settings.fx),
        merchant: r.merchant, category: cl.category, date: P.ymd(useDate), time: msg.when || (r.date && r.date.getHours() !== 12) ? P.hm(useDate) : '',
        account: r.account || '', note: '', source: 'sms', raw: msg.text, hash: P.smsHash(msg.text), review: r.confidence === 'low', createdAt: Date.now()
      }, kidFields(r.type === 'expense' ? cl.scope : 'personal'))
    };
  }
  async function importSmsText(text, opts = {}) {
    const msgs = P.splitMessages(text);
    const res = { added: [], dup: 0, ignored: 0, unknown: [] }; const seenNow = [];
    for (const m of msgs) {
      const h = P.smsHash(m.text);
      if (S.seen.has(h)) { res.dup++; continue; }
      const { t } = buildTxFromSms(m, opts.fileTime);
      S.seen.add(h); seenNow.push({ h, at: Date.now() });
      if (!t) { res.ignored++; continue; }
      res.added.push(t); if (t.review) res.unknown.push(t);
    }
    if (res.added.length) await putMany('txns', res.added);
    if (seenNow.length) await putMany('seen', seenNow);
    S.txns.push(...res.added); S.txns.sort(sortTx);
    if (!opts.paste) { S.settings.lastSmsImport = Date.now(); await saveSettings(); }
    return { ...res, total: msgs.length };
  }
  function showImportResult(res, title) {
    const spent = res.added.filter((t) => t.type === 'expense').reduce((a, t) => a + t.aed, 0);
    const nk = res.added.filter(isKid).length;
    openSheet(`<div class="sheet-head"><span></span><h2>${esc(title)}</h2><button data-close>Done</button></div>
      <div class="result-grid"><div><div class="v">${res.added.length}</div><div class="label">new transactions</div></div><div><div class="v">${money(spent, 0)}</div><div class="label">AED spent</div></div>
      <div><div class="v">${res.dup}</div><div class="label">already imported</div></div><div><div class="v">${res.ignored}</div><div class="label">skipped (OTP, promos, declined)</div></div></div>
      ${res.added.length ? `<div class="banner kid">${ico('smile')}<span>${nk ? `<b>${nk}</b> filed under ${esc(kidN())} automatically. ` : ''}Tap any item to move it to <b>${esc(kidN())}</b> and set the split.</span></div>` : ''}
      ${res.unknown.length ? `<div class="banner" style="background:color-mix(in srgb, var(--warn) 14%, transparent)">⚠ <span>${res.unknown.length} message${res.unknown.length > 1 ? 's' : ''} had an unfamiliar format — marked <b style="color:var(--warn)">Check</b>.</span></div>` : ''}
      ${res.added.length ? `<div class="card flush">${res.added.slice().sort(sortTx).slice(0, 60).map(txRow).join('')}</div>` : res.total === 0 ? `<div class="empty"><b>No messages found in that file</b>Make sure your Shortcut writes to <code>dirham-sms.txt</code>.</div>` : ''}`,
    (s) => { $$('[data-id]', s).forEach((b) => (b.onclick = () => { closeSheet(); editTx(S.txns.find((t) => t.id === b.dataset.id)); })); }, () => render());
  }
  $('#fileSms').onchange = async (e) => {
    const files = Array.from(e.target.files || []); e.target.value = ''; if (!files.length) return;
    const agg = { added: [], dup: 0, ignored: 0, unknown: [], total: 0 };
    for (const f of files) {
      const r = await importSmsText(await f.text(), { fileTime: f.lastModified ? new Date(f.lastModified) : null });
      agg.added.push(...r.added); agg.dup += r.dup; agg.ignored += r.ignored; agg.unknown.push(...r.unknown); agg.total += r.total;
    }
    showImportResult(agg, 'SMS import');
  };
  function showPaste() {
    openSheet(`<div class="sheet-head"><button data-close>Cancel</button><h2>Paste SMS</h2><button id="pGo">Import</button></div>
      <p class="small muted" style="margin-top:0">In Messages, long-press a bank SMS → Copy, then paste here. Separate several messages with an empty line.</p>
      <textarea class="paste" id="pText" placeholder="Purchase of AED 27.74 with Credit Card ending 9074 at Keeta, Dubai. Avl Cr. Limit is AED 30,978.13"></textarea>
      <div class="form"><div class="field"><label>Date</label><input type="date" id="pDate" value="${P.ymd(new Date())}"></div></div>
      <p class="small muted">Used when the message itself has no date.</p>`, (s) => {
      $('#pGo', s).onclick = async () => {
        const text = $('#pText', s).value; if (!text.trim()) { toast('Paste at least one SMS'); return; }
        const [Y, M, D] = $('#pDate', s).value.split('-').map(Number);
        showImportResult(await importSmsText(text, { paste: true, fileTime: new Date(Y, M - 1, D, 12) }), 'Pasted SMS');
      };
    });
  }
  function showShortcutGuide() {
    openSheet(`<div class="sheet-head"><span></span><h2>Automatic SMS capture</h2><button data-close>Done</button></div>
      <p class="small muted" style="margin-top:0">iPhone apps can’t read Messages. A Shortcuts automation saves every bank SMS into a text file in iCloud Drive, silently. Dirham reads that file when you tap <b>Import</b>.</p>
      <div class="card"><ol class="steps">
        <li>Open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Message</b>.</li>
        <li><b>Message Contains</b>: <span class="copybox"><code>AED</code><button data-copy="AED">Copy</button></span> Leave Sender empty.</li>
        <li>Choose <b>Run Immediately</b>, turn off <b>Notify When Run</b> → <b>Next</b> → <b>New Blank Automation</b>.</li>
        <li>Add <b>Text</b>: <span class="copybox"><code>##SMS## </code><button data-copy="##SMS## ">Copy</button></span> then the variable <b>Current Date</b> (Date Format <b>ISO 8601</b>, include time). New line, then <b>Shortcut Input → Content</b>.</li>
        <li>Add <b>Append to Text File</b> → file path <span class="copybox"><code>dirham-sms.txt</code><button data-copy="dirham-sms.txt">Copy</button></span> Turn on <b>Make New Line</b>.</li>
        <li>Tap <b>Done</b>. Then in Dirham: <b>Import</b> → iCloud Drive → Shortcuts → <b>dirham-sms.txt</b>.</li>
      </ol></div>
      <div class="card small">Optional: a second automation with <b>Message Contains</b> <code>Card ending</code> also catches foreign-currency card purchases. Duplicates are removed automatically.</div>`,
    (s) => { $$('[data-copy]', s).forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { toast('Long-press the text to copy'); } })); });
  }

  // ================================================================ PDF import
  let pdfLib = null;
  function loadPdfJs() {
    if (pdfLib) return Promise.resolve(pdfLib);
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/pdf.min.js'; s.onload = () => { pdfLib = window.pdfjsLib; pdfLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(pdfLib); }; s.onerror = () => rej(new Error('Could not load the PDF reader')); document.head.appendChild(s); });
  }
  async function pdfToLines(buf, password) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: buf, password: password || undefined, isEvalSupported: false }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent(); const rows = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5], w = it.width || 0;
        let row = rows.find((r) => Math.abs(r.y - y) < 2.5); if (!row) { row = { y, cells: [] }; rows.push(row); }
        row.cells.push({ x, w, text: it.str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.cells.sort((a, b) => a.x - b.x); const merged = [];
        for (const c of r.cells) { const last = merged[merged.length - 1]; if (last && c.x - (last.x + last.w) < 3) { last.text += (c.x - (last.x + last.w) > 0.8 ? ' ' : '') + c.text; last.w = c.x + c.w - last.x; } else merged.push({ ...c }); }
        lines.push({ text: merged.map((c) => c.text).join('  '), cells: merged, page: p });
      }
    }
    return lines;
  }
  $('#filePdf').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    const buf = new Uint8Array(await f.arrayBuffer());
    const attempt = async (pw) => {
      toast('Reading statement…');
      try {
        const rows = P.parseStatementLines(await pdfToLines(buf.slice(), pw));
        if (!rows.length) { openSheet(`<div class="sheet-head"><span></span><h2>No transactions found</h2><button data-close>OK</button></div><p class="muted">Couldn’t recognise transaction lines in <b>${esc(f.name)}</b>. Scanned (image) PDFs aren’t supported.</p>`); return; }
        reviewStatement(rows, f.name);
      } catch (err) {
        if (err && (err.name === 'PasswordException' || /password/i.test(err.message))) {
          const pwd = prompt(err.code === 2 ? 'Wrong password — try again:' : 'This statement is password-protected. Enter the PDF password:');
          if (pwd) return attempt(pwd); return;
        }
        console.error(err); toast('Could not read that PDF');
      }
    };
    attempt();
  };
  function reviewStatement(rows, name) {
    const items = rows.map((r) => {
      const date = P.ymd(r.date);
      const merchant = P.cleanMerchant(r.description.replace(/\b(POS|PURCHASE|CARD NO\.?|DEBIT CARD|CREDIT CARD|TRANSACTION|TXN)\b[:\-]?/gi, ' ').replace(/\b\d{4,}\b/g, ' ').replace(/\s+/g, ' ').trim()) || r.description;
      const dup = S.txns.find((t) => Math.abs(t.aed - r.amount) < 0.011 && t.type === r.type && Math.abs(new Date(t.date) - new Date(date)) <= 3 * 864e5);
      const hash = 'p' + P.hash(date + '|' + r.amount + '|' + r.description.toLowerCase()); const already = S.seen.has(hash);
      return { r, date, merchant, dup: !!dup || already, already, hash, on: !dup && !already, type: r.type };
    });
    const draw = (s) => {
      const n = items.filter((i) => i.on).length;
      $('#rvList', s).innerHTML = items.map((it, i) => `<label class="rv"><input type="checkbox" data-i="${i}" ${it.on ? 'checked' : ''}>
        <span style="flex:1;min-width:0"><div style="font-weight:640;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(it.merchant)}</div><div class="small muted">${dayLabel(it.date)} ${it.dup ? `<span class="dup">· ${it.already ? 'already imported' : 'likely duplicate'}</span>` : ''}</div></span>
        <button class="pill" data-t="${i}" style="border:0">${it.type}</button>
        <span class="num" style="font-weight:700;${it.type === 'income' ? 'color:var(--pos)' : ''}">${it.type === 'income' ? '+' : it.type === 'transfer' ? '' : '−'}${money(it.r.amount)}</span></label>`).join('');
      $('#rvGo', s).textContent = `Import ${n}`; $('#rvGo', s).disabled = !n;
      $$('input[data-i]', s).forEach((c) => (c.onchange = () => { items[+c.dataset.i].on = c.checked; draw(s); }));
      $$('[data-t]', s).forEach((b) => (b.onclick = (ev) => { ev.preventDefault(); const it = items[+b.dataset.t]; it.type = it.type === 'expense' ? 'income' : it.type === 'income' ? 'transfer' : 'expense'; draw(s); }));
    };
    openSheet(`<div class="sheet-head"><button data-close>Cancel</button><h2>Review statement</h2><button id="rvGo">Import</button></div>
      <p class="small muted" style="margin-top:0">${esc(name)} · ${items.length} lines · ${items.filter((i) => i.dup).length} likely duplicates unticked. Tap a type to switch it.</p>
      <div class="btnrow" style="margin-bottom:8px"><button class="btn plain" id="rvAll" style="padding:10px">Select all</button><button class="btn plain" id="rvNone" style="padding:10px">Select none</button></div>
      <div class="card flush" id="rvList"></div>`, (s) => {
      draw(s);
      $('#rvAll', s).onclick = () => { items.forEach((i) => (i.on = true)); draw(s); };
      $('#rvNone', s).onclick = () => { items.forEach((i) => (i.on = false)); draw(s); };
      $('#rvGo', s).onclick = async () => {
        const add = items.filter((i) => i.on).map((it) => { const cl = classify(it.merchant, it.type, it.r.description); return Object.assign({ id: uid(), type: it.type, amount: it.r.amount, currency: 'AED', aed: it.r.amount, merchant: it.merchant, category: cl.category, date: it.date, time: '', account: '', note: '', source: 'pdf', raw: it.r.description, hash: it.hash, createdAt: Date.now() }, kidFields(it.type === 'expense' ? cl.scope : 'personal')); });
        await putMany('txns', add); await putMany('seen', items.filter((i) => i.on).map((i) => ({ h: i.hash, at: Date.now() })));
        items.forEach((i) => i.on && S.seen.add(i.hash));
        S.txns.push(...add); S.txns.sort(sortTx); closeSheet(); render(); toast(`Imported ${add.length} transactions`);
      };
    });
  }

  // ================================================================ settings sheets
  function showBudgets() {
    const exp = cats().filter((c) => c.kind === 'expense');
    const avg = {}; for (let i = 1; i <= 3; i++) for (const c of byCategory(monthTx(shiftMonth(monthKey(new Date()), -i)), 'all')) avg[c.id] = (avg[c.id] || 0) + c.v / 3;
    const fld = (c) => `<div class="field"><span class="fl" style="flex:1;width:auto;display:flex;gap:10px;align-items:center">${catIco(c.id, false, true)}${esc(c.name)}</span><input data-b="${c.id}" inputmode="decimal" style="max-width:100px" placeholder="${avg[c.id] ? money(avg[c.id], 0) : '—'}" value="${S.settings.budgets[c.id] || ''}"></div>`;
    openSheet(`<div class="sheet-head"><button data-close>Cancel</button><h2>Monthly budgets</h2><button id="bSave">Save</button></div>
      <div class="form"><div class="field"><label>Personal total</label><input id="bTotal" inputmode="decimal" placeholder="no limit" value="${S.settings.totalBudget || ''}"></div>
      <div class="field"><label>${esc(kidN())} total</label><input id="bKid" inputmode="decimal" placeholder="no limit" value="${S.settings.kidBudget || ''}"></div></div>
      <p class="small muted">AED per month. Grey hint = your 3-month average.</p>
      <div class="section-title">General</div><div class="form">${exp.filter((c) => c.group !== 'kid').map(fld).join('')}</div>
      <div class="section-title">${esc(kidN())}</div><div class="form">${exp.filter((c) => c.group === 'kid').map(fld).join('')}</div>`, (s) => {
      $('#bSave', s).onclick = async () => {
        S.settings.totalBudget = parseFloat($('#bTotal', s).value.replace(/,/g, '')) || 0; S.settings.kidBudget = parseFloat($('#bKid', s).value.replace(/,/g, '')) || 0;
        const b = {}; $$('[data-b]', s).forEach((i) => { const v = parseFloat(i.value.replace(/,/g, '')); if (v > 0) b[i.dataset.b] = v; });
        S.settings.budgets = b; await saveSettings(); closeSheet(); render(); toast('Budgets saved');
      };
    });
  }
  function showRules() {
    const draw = (s) => {
      $('#rList', s).innerHTML = S.settings.rules.length ? S.settings.rules.slice().sort((a, b) => a.pattern.localeCompare(b.pattern)).map((r) => `<div class="row">${catIco(r.category)}<span class="grow"><div class="t1">${esc(r.pattern)}</div><div class="t2">→ ${esc(cat(r.category).name)}${r.scope === 'kid' ? ` <span class="pill kid">${esc(kidN())}</span>` : ''}</div></span><button class="link" data-del="${esc(r.pattern)}">Remove</button></div>`).join('') : '<div class="empty">No rules yet. When you change a transaction’s category or move it to your child, Dirham offers to remember it.</div>';
      $$('[data-del]', s).forEach((b) => (b.onclick = async () => { S.settings.rules = S.settings.rules.filter((r) => r.pattern !== b.dataset.del); await saveSettings(); draw(s); }));
    };
    openSheet(`<div class="sheet-head"><span></span><h2>Merchant rules</h2><button data-close>Done</button></div>
      <p class="small muted" style="margin-top:0">Merchants containing this text always get the category (and ledger). Built-in rules already cover common UAE merchants and schools.</p>
      <div class="card flush" id="rList"></div>
      <div class="section-title">Add rule</div>
      <div class="form"><div class="field"><label>Contains</label><input id="rPat" placeholder="e.g. gems wellington"></div><div class="field"><label>Category</label><select id="rCat">${catOptions('k_school', 'kid', 'expense')}</select></div></div>
      <button class="btn soft" id="rAdd">Add rule & apply to past</button>`, (s) => {
      draw(s);
      $('#rAdd', s).onclick = async () => {
        const pattern = P.merchantKey($('#rPat', s).value); if (!pattern) return;
        const category = $('#rCat', s).value; const scope = isKidCat(category) ? 'kid' : 'personal';
        S.settings.rules = S.settings.rules.filter((r) => r.pattern !== pattern).concat([{ pattern, category, scope }]); await saveSettings();
        const ch = S.txns.filter((t) => t.type === 'expense' && (' ' + P.merchantKey(t.merchant) + ' ').includes(pattern) && t.category !== category);
        ch.forEach((t) => { t.category = category; if (scope === 'kid' && !isKid(t)) Object.assign(t, kidFields('kid')); }); if (ch.length) await putMany('txns', ch);
        $('#rPat', s).value = ''; draw(s); toast(`Rule added · ${ch.length} updated`);
      };
    }, () => render());
  }
  function showCats() {
    const draw = (s) => {
      $('#cList', s).innerHTML = cats().filter((c) => c.kind !== 'settlement').map((c) => `<div class="row">${catIco(c.id)}<span class="grow"><div class="t1">${esc(c.name)}</div><div class="t2">${c.group === 'kid' ? esc(kidN()) : c.kind}</div></span>${c.custom ? `<button class="link" data-del="${c.id}">Remove</button>` : ''}</div>`).join('');
      $$('[data-del]', s).forEach((b) => (b.onclick = async () => {
        const id = b.dataset.del; const used = S.txns.filter((t) => t.category === id);
        if (used.length && !confirm(`${used.length} transactions use this category. They’ll move to Other.`)) return;
        used.forEach((t) => (t.category = cat(id).kind === 'income' ? 'other_in' : cat(id).group === 'kid' ? 'k_other' : 'other')); if (used.length) await putMany('txns', used);
        S.settings.customCats = S.settings.customCats.filter((c) => c.id !== id); await saveSettings(); draw(s);
      }));
    };
    openSheet(`<div class="sheet-head"><span></span><h2>Categories</h2><button data-close>Done</button></div>
      <div class="form"><div class="field"><label>Name</label><input id="cName" placeholder="e.g. Swimming"></div>
      <div class="field"><label>Type</label><select id="cKind"><option value="expense">Personal expense</option><option value="kid">${esc(kidN())} expense</option><option value="income">Income</option></select></div></div>
      <button class="btn soft" id="cAdd">Add category</button>
      <div class="section-title">All categories</div><div class="card flush" id="cList"></div>`, (s) => {
      draw(s);
      $('#cAdd', s).onclick = async () => {
        const name = $('#cName', s).value.trim(); if (!name) return; const k = $('#cKind', s).value;
        const c = { id: (k === 'kid' ? 'k_c' : 'c_') + uid(), name, kind: k === 'income' ? 'income' : 'expense', custom: true }; if (k === 'kid') c.group = 'kid';
        S.settings.customCats.push(c); await saveSettings(); $('#cName', s).value = ''; draw(s); toast('Category added');
      };
    }, () => render());
  }
  function showFx() {
    const used = new Set(S.txns.map((t) => t.currency));
    const list = Object.keys(S.settings.fx).filter((c) => c !== 'AED').sort((a, b) => (used.has(b) - used.has(a)) || a.localeCompare(b));
    openSheet(`<div class="sheet-head"><button data-close>Cancel</button><h2>Exchange rates</h2><button id="fxSave">Save</button></div>
      <p class="small muted" style="margin-top:0">AED for 1 unit. Defaults are approximate — match your bank’s rate if you like.</p>
      <div class="form">${list.map((c) => `<div class="field"><label>${c}${used.has(c) ? ' •' : ''}</label><input data-fx="${c}" inputmode="decimal" value="${S.settings.fx[c]}"></div>`).join('')}</div>
      <div class="form"><label class="field check"><span>Re-convert past foreign transactions</span><input type="checkbox" id="fxRe"></label></div>`, (s) => {
      $('#fxSave', s).onclick = async () => {
        $$('[data-fx]', s).forEach((i) => { const v = parseFloat(i.value); if (v > 0) S.settings.fx[i.dataset.fx] = v; }); await saveSettings();
        if ($('#fxRe', s).checked) { const ch = S.txns.filter((t) => t.currency !== 'AED'); ch.forEach((t) => (t.aed = P.toAED(t.amount, t.currency, S.settings.fx))); if (ch.length) await putMany('txns', ch); }
        closeSheet(); render(); toast('Rates saved');
      };
    });
  }

  // ================================================================ data
  async function shareOrDownload(name, text, mime) {
    const blob = new Blob([text], { type: mime }); const file = new File([blob], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return true; } catch (e) { if (e.name === 'AbortError') return false; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return true;
  }
  async function backup() {
    const seen = await getAll('seen');
    const data = { app: 'dirham', version: 2, exportedAt: new Date().toISOString(), settings: S.settings, txns: S.txns, seen: seen.map((x) => x.h) };
    if (await shareOrDownload(`dirham-backup-${P.ymd(new Date())}.json`, JSON.stringify(data), 'application/json')) { S.settings.lastBackup = Date.now(); await saveSettings(); render(); toast('Backup ready — choose “Save to Files”'); }
  }
  function normalizeTx(t) { if (!t.scope) t.scope = 'personal'; if (t.scope === 'kid' && !t.paidBy) t.paidBy = 'me'; return t; }
  $('#fileBackup').onchange = async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text()); if (data.app !== 'dirham' || !Array.isArray(data.txns)) throw new Error('bad');
      const have = new Set(S.txns.map((t) => t.id)); const add = data.txns.filter((t) => !have.has(t.id)).map(normalizeTx);
      await putMany('txns', add); S.txns.push(...add); S.txns.sort(sortTx);
      if (Array.isArray(data.seen)) { const hs = data.seen.filter((h) => !S.seen.has(h)); hs.forEach((h) => S.seen.add(h)); await putMany('seen', hs.map((h) => ({ h, at: Date.now() }))); }
      if (data.settings) {
        const s = data.settings; S.settings.budgets = Object.assign({}, s.budgets || {}, S.settings.budgets);
        const pats = new Set(S.settings.rules.map((r) => r.pattern)); S.settings.rules.push(...(s.rules || []).filter((r) => !pats.has(r.pattern)));
        const cids = new Set(S.settings.customCats.map((c) => c.id)); S.settings.customCats.push(...(s.customCats || []).filter((c) => !cids.has(c.id)));
        S.settings.fx = Object.assign({}, s.fx || {}, S.settings.fx);
        if (!S.settings.totalBudget) S.settings.totalBudget = s.totalBudget || 0; if (!S.settings.kidBudget) S.settings.kidBudget = s.kidBudget || 0;
        if (!S.settings.profile.name && s.profile) S.settings.profile = Object.assign({}, S.settings.profile, s.profile);
        await saveSettings();
      }
      render(); toast(`Restored ${add.length} transactions`);
    } catch { toast('That is not a Dirham backup file'); }
  };
  function exportCsv() {
    const q = (v) => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const rows = [['Date', 'Time', 'Ledger', 'Type', 'Merchant', 'Category', 'Amount', 'Currency', 'AED', 'Paid by', 'My share %', 'Card', 'Note', 'Source']];
    for (const t of S.txns) rows.push([t.date, t.time, isKid(t) ? kidN() : 'Personal', t.type, t.merchant, cat(t.category).name, t.amount, t.currency, t.aed, isKid(t) ? (t.paidBy === 'ex' ? exN() : me()) : '', isKid(t) && t.type === 'expense' ? Math.round(myShareOf(t) * 100) : '', t.account, t.note, t.source]);
    shareOrDownload(`dirham-${P.ymd(new Date())}.csv`, rows.map((r) => r.map(q).join(',')).join('\n'), 'text/csv');
  }
  async function wipe() {
    if (!confirm('Erase ALL transactions, rules and budgets from this iPhone? This cannot be undone.')) return;
    if (!confirm('Really erase everything? Consider backing up first.')) return;
    await clearStore('txns'); await clearStore('seen'); await clearStore('kv'); location.reload();
  }

  // ================================================================ boot
  async function boot() {
    try {
      db = await openDB();
      const [txns, seen, kv] = await Promise.all([getAll('txns'), getAll('seen'), getAll('kv')]);
      S.txns = txns.map(normalizeTx).sort(sortTx); S.seen = new Set(seen.map((x) => x.h));
      const st = kv.find((x) => x.k === 'settings');
      if (st) S.settings = Object.assign(S.settings, st.v, { fx: Object.assign({}, P.DEFAULT_FX, st.v.fx || {}), profile: Object.assign({}, S.settings.profile, st.v.profile || {}) });
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      $('#view').innerHTML = `<div class="card empty"><b>Storage unavailable</b>Private Browsing blocks saving data. Open Dirham from your Home Screen.</div>`; return;
    }
    applyTheme(); render();
    if (!S.settings.profile.setup) setTimeout(() => showProfile(true), 250);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
      const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }
  window.__dirham = { S, importSmsText, render, kidStats };
  boot();
})();
