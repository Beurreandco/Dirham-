/* Dirham — SMS + categorisation engine. Pure functions, no DOM. Works in browser and Node. */
(function (root) {
  'use strict';

  const CURRENCIES = 'AED|USD|EUR|GBP|SAR|INR|QAR|OMR|KWD|BHD|LBP|CHF|JPY|CAD|AUD|TRY|EGP|PKR|PHP|CNY|THB|LKR|SGD|HKD|NZD|ZAR|MYR|IDR|JOD';

  const DEFAULT_FX = { // AED per 1 unit — approximate, editable in Settings (USD is pegged)
    AED: 1, USD: 3.6725, EUR: 4.30, GBP: 4.95, SAR: 0.979, INR: 0.0415, QAR: 1.009, OMR: 9.54,
    KWD: 12.0, BHD: 9.74, LBP: 0.000041, CHF: 4.6, JPY: 0.025, CAD: 2.65, AUD: 2.42, TRY: 0.089,
    EGP: 0.075, PKR: 0.013, PHP: 0.063, CNY: 0.51, THB: 0.11, LKR: 0.012, SGD: 2.85, HKD: 0.47,
    NZD: 2.2, ZAR: 0.2, MYR: 0.86, IDR: 0.00023, JOD: 5.18
  };

  const DEFAULT_CATEGORIES = [
    { id: 'groceries', name: 'Groceries', icon: '🛒', kind: 'expense' },
    { id: 'dining', name: 'Dining & cafés', icon: '🍽️', kind: 'expense' },
    { id: 'delivery', name: 'Food delivery', icon: '🛵', kind: 'expense' },
    { id: 'transport', name: 'Transport', icon: '🚕', kind: 'expense' },
    { id: 'fuel', name: 'Fuel & car', icon: '⛽', kind: 'expense' },
    { id: 'shopping', name: 'Shopping', icon: '🛍️', kind: 'expense' },
    { id: 'bills', name: 'Bills & utilities', icon: '💡', kind: 'expense' },
    { id: 'subs', name: 'Subscriptions', icon: '📺', kind: 'expense' },
    { id: 'health', name: 'Health & fitness', icon: '💪', kind: 'expense' },
    { id: 'personal', name: 'Personal care', icon: '💈', kind: 'expense' },
    { id: 'travel', name: 'Travel', icon: '✈️', kind: 'expense' },
    { id: 'fun', name: 'Entertainment', icon: '🎬', kind: 'expense' },
    { id: 'rent', name: 'Rent & home', icon: '🏠', kind: 'expense' },
    { id: 'education', name: 'Education', icon: '📚', kind: 'expense' },
    { id: 'cash', name: 'Cash withdrawal', icon: '💵', kind: 'expense' },
    { id: 'fees', name: 'Bank fees', icon: '🏦', kind: 'expense' },
    { id: 'other', name: 'Other', icon: '📦', kind: 'expense' },
    { id: 'salary', name: 'Salary', icon: '💼', kind: 'income' },
    { id: 'clients', name: 'Client payments', icon: '🥊', kind: 'income' },
    { id: 'refunds', name: 'Refunds', icon: '↩️', kind: 'income' },
    { id: 'other_in', name: 'Other income', icon: '💰', kind: 'income' },
    { id: 'transfer', name: 'Transfer / card payment', icon: '🔁', kind: 'transfer' },
    // ---- Kid (co-parenting) categories: always counted in the Kid ledger
    { id: 'k_school', name: 'School fees', icon: '🎓', kind: 'expense', group: 'kid' },
    { id: 'k_bus', name: 'School bus', icon: '🚌', kind: 'expense', group: 'kid' },
    { id: 'k_supplies', name: 'Uniforms & books', icon: '📒', kind: 'expense', group: 'kid' },
    { id: 'k_health', name: 'Kid health', icon: '🩺', kind: 'expense', group: 'kid' },
    { id: 'k_activities', name: 'Sports & classes', icon: '⚽', kind: 'expense', group: 'kid' },
    { id: 'k_care', name: 'Childcare & nanny', icon: '🍼', kind: 'expense', group: 'kid' },
    { id: 'k_food', name: 'Kid food & snacks', icon: '🍎', kind: 'expense', group: 'kid' },
    { id: 'k_clothes', name: 'Kid clothing', icon: '👕', kind: 'expense', group: 'kid' },
    { id: 'k_toys', name: 'Toys & gifts', icon: '🧸', kind: 'expense', group: 'kid' },
    { id: 'k_transport', name: 'Kid transport', icon: '🚗', kind: 'expense', group: 'kid' },
    { id: 'k_outings', name: 'Birthdays & outings', icon: '🎂', kind: 'expense', group: 'kid' },
    { id: 'k_other', name: 'Other (kid)', icon: '🧒', kind: 'expense', group: 'kid' },
    { id: 'settle', name: 'Co-parent settlement', icon: '🤝', kind: 'settlement' }
  ];

  // Ordered: more specific keywords first.
  const KEYWORDS = [
    ['k_bus', ['school bus', 'school transport', 'bus fee', 'student transport', 'stx ']],
    ['k_toys', ['toys r us', 'toysrus', 'toys', 'hamleys', 'lego', 'early learning', 'elc ']],
    ['k_clothes', ['mothercare', 'babyshop', 'baby shop', 'carters', "carter's", 'kids fashion']],
    ['k_outings', ['kidzania', 'cartoon network', 'legoland', 'magic planet', 'fun city', 'sparkys', 'bounce', 'ice land', 'aquaventure']],
    ['k_activities', ['swim academy', 'football academy', 'ballet', 'gymnastics', 'karate', 'taekwondo', 'kids academy', 'kids club']],
    ['k_school', ['school', 'nursery', 'kindergarten', 'gems ', 'taaleem', 'kidz', 'early years', 'montessori', 'british orchard']],
    ['delivery', ['talabat', 'deliveroo', 'keeta', 'noon food', 'noonfood', 'careem food', 'zomato', 'smiles', 'instashop food']],
    ['subs', ['netflix', 'spotify', 'apple.com', 'itunes', 'icloud', 'youtube', 'google one', 'google *', 'osn', 'shahid', 'disney', 'anghami', 'chatgpt', 'openai', 'anthropic', 'claude.ai', 'adobe', 'microsoft', 'amazon prime', 'primevideo', 'starzplay', 'tradingview', 'mql5', 'patreon', 'canva']],
    ['groceries', ['carrefour', 'lulu', 'spinneys', 'waitrose', 'choithram', 'union coop', 'unioncoop', 'viva ', 'kibsons', 'instashop', 'west zone', 'al maya', 'almaya', 'nesto', 'grandiose', 'geant', 'supermarket', 'hypermarket', 'baqala', 'grocery', 'grocer', 'organic foods', 'noon minutes', 'amazon fresh']],
    ['fuel', ['enoc', 'adnoc', 'emarat', 'eppco', 'petrol', 'fuel', 'car wash', 'autopro', 'tasjeel', 'shamil']],
    ['transport', ['careem', 'uber', 'rta', 'nol ', 'salik', 'taxi', 'hala ', 'parking', 'parkin', 'metro', 'ekar', 'udrive', 'yango', 'bolt']],
    ['travel', ['flydubai', 'air arabia', 'etihad', 'emirates airline', 'emirates.com', 'booking.com', 'airbnb', 'agoda', 'expedia', 'hotel', 'marriott', 'hilton', 'airline', 'airways', 'skyscanner', 'middle east airlines', 'mea ', 'trip.com', 'duty free']],
    ['health', ['pharmacy', 'aster', 'boots', 'clinic', 'hospital', 'medcare', 'mediclinic', 'nmc', 'gym', 'fitness', 'ufc', 'physio', 'nutrition', 'supplement', 'protein', 'dental', 'optical', 'lab ', 'health']],
    ['personal', ['salon', 'barber', 'hairdress', 'spa ', 'nails', 'grooming', 'tips n toes', 'laundry', 'dry clean']],
    ['fun', ['vox', 'reel cinema', 'novo cinema', 'cinema', 'playstation', 'steam', 'xbox', 'nintendo', 'dubai parks', 'ticketmaster', 'platinumlist', 'bowling', 'img worlds', 'global village', 'wild wadi']],
    ['bills', ['dewa', 'sewa', 'addc', 'aadc', 'fewa', 'empower', 'etisalat', 'e& ', ' du ', 'du telecom', 'virgin mobile', 'municipality', 'ejari', 'internet', 'telecom', 'insurance', 'chiller', 'lootah', 'emirates gas']],
    ['rent', ['rent', 'real estate', 'properties', 'property', 'ikea', 'home centre', 'home box', 'ace hardware', 'dragon mart']],
    ['education', ['udemy', 'coursera', 'university', 'academy', 'course', 'books', 'kinokuniya', 'magrudy']],
    ['shopping', ['amazon', 'noon', 'namshi', 'centrepoint', 'max fashion', 'h&m', 'zara', 'sharaf dg', 'virgin megastore', 'jumbo', 'apple store', 'decathlon', 'shein', 'temu', 'aliexpress', 'mall', 'nike', 'adidas', 'sephora', 'lulu fashion', 'uniqlo', 'emax', 'eros']],
    ['dining', ['starbucks', 'costa', 'tim hortons', 'mcdonald', 'kfc', 'burger', 'cafe', 'café', 'coffee', 'restaurant', 'pizza', 'shake shack', 'five guys', 'subway', 'pret', 'eatery', 'grill', 'kitchen', 'bakery', 'arabica', 'shawarma', 'manoushe', 'bistro', 'sushi', 'dunkin', 'krispy', 'popeyes', 'hardees', "hardee's", 'texas chicken', 'nandos', "nando's", 'paul ', 'bateel', 'jones the grocer', 'diner', 'lounge']],
    ['cash', ['atm', 'cash withdrawal']],
    ['fees', ['fee', 'charges', 'commission', 'interest', 'vat on']]
  ];

  const UAE_CITIES = ['dubai', 'abu dhabi', 'sharjah', 'ajman', 'al ain', 'ras al khaimah', 'rak', 'fujairah', 'umm al quwain', 'uae', 'ae'];

  function num(s) { return parseFloat(String(s).replace(/,/g, '')); }

  function normCur(c) {
    c = String(c || '').toUpperCase();
    if (c === 'DHS' || c === 'DH' || c === 'AED.') return 'AED';
    return c;
  }

  function cleanMerchant(m) {
    if (!m) return '';
    let s = m.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
    // Drop trailing ", City" / " City AE"
    const parts = s.split(',');
    if (parts.length > 1) {
      const last = parts[parts.length - 1].trim().toLowerCase();
      if (UAE_CITIES.includes(last) || /^[a-z ]{2,20}$/.test(last) && last.split(' ').length <= 3 && parts.length === 2 && isCityLike(last)) {
        parts.pop(); s = parts.join(',').trim();
      }
    }
    s = s.replace(/\s+(DUBAI|ABU DHABI|SHARJAH|AJMAN)\s*(AE|ARE|UAE)?$/i, '').trim();
    s = s.replace(/\s+(AE|ARE|UAE)$/i, '').trim();
    // Title-case ALL CAPS names for readability
    if (s === s.toUpperCase() && /[A-Z]/.test(s)) {
      s = s.toLowerCase().replace(/(^|[\s\-\/&(])([a-z])/g, (_, a, c) => a + c.toUpperCase());
    }
    return s;
  }
  function isCityLike(x) { return UAE_CITIES.includes(x) || ['london', 'beirut', 'paris', 'riyadh', 'doha', 'muscat', 'istanbul', 'colombo', 'new york', 'singapore'].includes(x); }

  function merchantKey(m) {
    return String(m || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ---------- hashing ----------
  function hash(str) { // cyrb53
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function smsHash(text) { return 's' + hash(String(text).toLowerCase().replace(/\s+/g, ' ').trim()); }

  // ---------- dates ----------
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fixYear(y) { y = +y; return y < 100 ? 2000 + y : y; }

  function parseLooseDate(s) {
    if (!s) return null;
    s = String(s).trim();
    let m;
    // ISO-ish (from Shortcuts)
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
      const d = new Date(Date.parse(s.replace(' ', 'T')));
      if (!isNaN(d)) return d;
      return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0));
    }
    // 30 Sep 2026 at 14:22 / Sep 30, 2026 at 2:22 PM
    const cleaned = s.replace(/\s+at\s+/i, ' ').replace(/,/g, '');
    if ((m = cleaned.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i))) {
      const mo = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()];
      if (mo != null) return mkDate(fixYear(m[3]), mo, +m[1], m[4], m[5], m[6]);
    }
    if ((m = cleaned.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i))) {
      const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
      if (mo != null) return mkDate(+m[3], mo, +m[2], m[4], m[5], m[6]);
    }
    // 30/09/2026 (day first, UAE)
    if ((m = cleaned.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?)?/i))) {
      return mkDate(fixYear(m[3]), +m[2] - 1, +m[1], m[4], m[5], m[6]);
    }
    const t = Date.parse(cleaned);
    return isNaN(t) ? null : new Date(t);
  }
  function mkDate(y, mo, d, h, mi, ap) {
    let H = h != null ? +h : 12;
    if (ap) { ap = ap.toUpperCase(); if (ap === 'PM' && H < 12) H += 12; if (ap === 'AM' && H === 12) H = 0; }
    const dt = new Date(y, mo, d, H, mi != null ? +mi : 0);
    return isNaN(dt) ? null : dt;
  }

  // date mentioned inside the SMS body, e.g. "on 24-Dec-25" or "on 24/12/2025"
  function dateInText(t) {
    const m = t.match(/\bon\s+(\d{1,2}[\-\/ ][A-Za-z]{3}[\-\/ ]\d{2,4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})(?:\s+(?:at\s+)?(\d{1,2}:\d{2}))?/i);
    if (!m) return null;
    return parseLooseDate(m[1] + (m[2] ? ' ' + m[2] : ''));
  }

  // ---------- SMS parsing ----------
  const AMT = '([\\d,]+(?:\\.\\d{1,3})?)';
  const CUR = '(' + CURRENCIES + '|DHS|DH)';
  const RX = {
    ignore: /(declin|was not processed|not been processed|has failed|unsuccessful|insufficient|\bOTP\b|one[- ]time password|verification code|activation code|do not share|will be debited|is due|due date|minimum payment|statement (?:is|has been) generated|e-?statement|pre-?approved|offer|win |congratulations)/i,
    purchase: new RegExp('purchase of ' + CUR + '\\s?' + AMT + '\\s+(?:with|using|on) (?:your )?(debit|credit|prepaid)?\\s*card(?: ending(?: with)?| no\\.?| x+)?\\s*[x*]*(\\d{4})?\\s*(?:at|@)\\s+(.+?)(?:\\.\\s*(?:Avl|Available|Your|Current|Bal)|\\.\\s*$|$)', 'i'),
    spentAt: new RegExp('(?:spent|paid|payment of|transaction of|txn of)\\s+' + CUR + '\\s?' + AMT + '.*?(?:\\bat|\\bto|\\btowards)\\s+(.+?)(?:\\s+on\\s+\\d|\\.\\s*(?:Avl|Available|Your|Current|Bal)|\\.\\s*$|$)', 'i'),
    credited: new RegExp(CUR + '\\s?' + AMT + '\\s+(?:has been |have been |was |is )?(?:credited|deposited|received)', 'i'),
    creditedRev: new RegExp('(?:credited|deposited|received)(?: with| of)?\\s+' + CUR + '\\s?' + AMT, 'i'),
    debited: new RegExp(CUR + '\\s?' + AMT + '\\s+(?:has been |have been |was |is )?(?:debited|withdrawn|deducted|transferred|sent)', 'i'),
    debitedRev: new RegExp('(?:debited|withdrawn|deducted|transferred|sent)(?: with| for| of)?\\s+' + CUR + '\\s?' + AMT, 'i'),
    anyAmt: new RegExp(CUR + '\\s?' + AMT, 'i'),
    anyAmtRev: new RegExp(AMT + '\\s?' + CUR + '\\b', 'i'),
    card: /card(?: ending(?: with)?| no\.?)?\s*[x*]*\s*(\d{4})\b/i,
    acct: /(?:a\/c|account|acct)(?: no\.?)?\s*([0-9x*]{4,})/i,
    bal: new RegExp('(?:avl\\.?|available|current)\\s*(?:bal(?:ance)?|cr\\.?\\s*limit|credit limit)(?:\\s+is|:)?\\s*' + CUR + '\\s?' + AMT, 'i')
  };

  function last4(s) { if (!s) return ''; const d = s.replace(/\D/g, ''); return d.slice(-4); }

  /**
   * Parse one SMS body. Returns
   *  { kind: 'txn', type, amount, currency, merchant, account, balance, confidence, date? }
   *  or { kind: 'ignore', reason } or { kind: 'unknown' }
   */
  function parseSms(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return { kind: 'ignore', reason: 'empty' };
    const lower = t.toLowerCase();
    const hasAmt = RX.anyAmt.test(t) || RX.anyAmtRev.test(t);
    if (RX.ignore.test(t) && !/refund|reversal|reversed/i.test(t)) return { kind: 'ignore', reason: 'not a completed transaction' };
    if (!hasAmt) return { kind: 'ignore', reason: 'no amount' };

    const out = { kind: 'txn', type: 'expense', amount: 0, currency: 'AED', merchant: '', account: '', balance: null, confidence: 'high' };
    const cardM = t.match(RX.card); const acM = t.match(RX.acct);
    out.account = cardM ? cardM[1] : (acM ? last4(acM[1]) : '');
    const balM = t.match(RX.bal); if (balM) out.balance = { currency: normCur(balM[1]), amount: num(balM[2]) };
    const inDate = dateInText(t); if (inDate) out.date = inDate;

    let m;
    // Card payment / transfer between own accounts
    if (/(payment|pymt).{0,40}(received|credited|towards|to your).{0,40}credit card|credit card.{0,30}payment.{0,30}(received|credited)|thank you for (your )?payment/i.test(t)) {
      m = t.match(RX.anyAmt) ; const r = m ? [m[1], m[2]] : (t.match(RX.anyAmtRev) ? [t.match(RX.anyAmtRev)[2], t.match(RX.anyAmtRev)[1]] : null);
      if (r) { out.type = 'transfer'; out.currency = normCur(r[0]); out.amount = num(r[1]); out.merchant = 'Credit card payment'; out.category = 'transfer'; return out; }
    }
    // Refunds / reversals
    if (/refund|reversal|reversed|cashback|chargeback/i.test(t)) {
      m = t.match(RX.anyAmt);
      if (m) {
        out.type = 'income'; out.currency = normCur(m[1]); out.amount = num(m[2]);
        const mm = t.match(/(?:from|by|at)\s+(.+?)(?:\s+(?:on|has|have|was|is)\b|\.\s|\.$|$)/i);
        out.merchant = cleanMerchant(mm ? mm[1] : 'Refund'); out.category = 'refunds'; return out;
      }
    }
    // "Purchase of AED 27.74 with Credit Card ending 9074 at Keeta, Dubai. Avl Cr. Limit is ..."
    if ((m = t.match(RX.purchase))) {
      out.currency = normCur(m[1]); out.amount = num(m[2]);
      if (m[3]) out.cardType = m[3].toLowerCase();
      if (m[4]) out.account = m[4];
      out.merchant = cleanMerchant(m[5]);
      return out;
    }
    // Cash withdrawal
    if (/withdraw|\batm\b/i.test(t) && !/transfer/i.test(lower)) {
      m = t.match(RX.anyAmt);
      if (m) {
        out.currency = normCur(m[1]); out.amount = num(m[2]); out.category = 'cash';
        const at = t.match(/\bat\s+(.+?)(?:\s+on\s+\d|\.\s*(?:Avl|Available|Your|Current|Bal)|\.\s*$|$)/i);
        out.merchant = at ? 'ATM · ' + cleanMerchant(at[1]) : 'ATM withdrawal';
        return out;
      }
    }
    // Credits (salary, incoming transfers)
    if ((m = t.match(RX.credited)) || (m = t.match(RX.creditedRev))) {
      if (!/debited|purchase|withdrawn/i.test(t.slice(0, t.search(/credited|deposited|received/i)))) {
        out.type = 'income'; out.currency = normCur(m[1]); out.amount = num(m[2]);
        const from = t.match(/\bfrom\s+(?:a\/c\s*\S+\s+of\s+)?(.+?)(?:\s+(?:on|to|into|in|ref|via|has|have|was)\b|\.\s|\.$|$)/i);
        const by = t.match(/\bby\s+(.+?)(?:\s+(?:on|to|into|ref|via)\b|\.\s|\.$|$)/i);
        const src = from ? from[1] : by ? by[1] : '';
        if (/salary|payroll|\bwps\b/i.test(t)) { out.merchant = src ? cleanMerchant(src) : 'Salary'; out.category = 'salary'; }
        else out.merchant = src && !/your account|a\/c/i.test(src) ? cleanMerchant(src) : 'Incoming credit';
        return out;
      }
    }
    // Debits (transfers out, direct debits, bill payments)
    if ((m = t.match(RX.debited)) || (m = t.match(RX.debitedRev))) {
      out.currency = normCur(m[1]); out.amount = num(m[2]);
      const to = t.match(/\b(?:to|towards|for|at|in favou?r of)\s+(?!your\b|a\/c\b|account\b)(.+?)(?:\s+(?:on|from|ref|via|using)\b|\.\s|\.$|$)/i);
      out.merchant = to ? cleanMerchant(to[1]) : (/transfer/i.test(t) ? 'Transfer out' : 'Account debit');
      if (/transfer/i.test(t) && !to) out.category = 'transfer';
      return out;
    }
    // "spent AED 20 at X" / "Payment of AED 100 to DEWA"
    if ((m = t.match(RX.spentAt))) {
      out.currency = normCur(m[1]); out.amount = num(m[2]); out.merchant = cleanMerchant(m[3]);
      out.confidence = 'medium'; return out;
    }
    // Generic fallback
    m = t.match(RX.anyAmt);
    let cur, amt;
    if (m) { cur = m[1]; amt = m[2]; } else { m = t.match(RX.anyAmtRev); cur = m[2]; amt = m[1]; }
    if (/avl|available|balance/i.test(t) && t.search(RX.anyAmt) > t.search(/avl|available|balance/i) && !/purchase|spent|paid|debit|credit/i.test(t)) {
      return { kind: 'ignore', reason: 'balance notice' };
    }
    out.currency = normCur(cur); out.amount = num(amt); out.confidence = 'low';
    out.type = /credit|received|deposit/i.test(t) && !/credit card/i.test(t) ? 'income' : 'expense';
    const at = t.match(/\b(?:at|to|from)\s+(.+?)(?:\s+on\s+\d|\.\s|\.$|$)/i);
    out.merchant = at ? cleanMerchant(at[1]) : 'Unknown';
    return out;
  }

  // ---------- Shortcut file / pasted text → messages ----------
  const MARK = /##\s*SMS\s*##/i;
  function splitMessages(text) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    const msgs = [];
    if (MARK.test(text)) {
      const parts = text.split(/##\s*SMS\s*##/i);
      for (const p of parts) {
        const body = p.replace(/^[\s|]+/, '');
        if (!body.trim()) continue;
        // first line = timestamp (optional). Accept "2026-09-30T14:22:05+04:00" or any date text
        const nl = body.indexOf('\n');
        let first = nl >= 0 ? body.slice(0, nl) : body;
        let rest = nl >= 0 ? body.slice(nl + 1) : '';
        let when = parseLooseDate(first.replace(/\|.*$/, '').trim());
        if (!when) { rest = body; }
        if (rest.trim()) msgs.push({ text: rest.trim(), when });
      }
      return msgs;
    }
    // plain paste: split on blank lines, glue paragraphs without amounts onto previous
    const paras = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    for (const p of paras) {
      const has = RX.anyAmt.test(p) || RX.anyAmtRev.test(p);
      if (!has && msgs.length) msgs[msgs.length - 1].text += '\n\n' + p;
      else msgs.push({ text: p, when: null });
    }
    return msgs;
  }

  // ---------- categorisation ----------
  function categorize(merchant, rules, type, raw) {
    const key = merchantKey(merchant);
    const hay = ' ' + key + ' ' + String(raw || '').toLowerCase() + ' ';
    if (rules) {
      // longest pattern wins
      const sorted = rules.slice().sort((a, b) => b.pattern.length - a.pattern.length);
      for (const r of sorted) if (r.pattern && (' ' + key + ' ').includes(r.pattern)) return r.category;
    }
    if (type === 'income') {
      if (/salary|payroll|wps/.test(hay)) return 'salary';
      if (/refund|reversal|cashback/.test(hay)) return 'refunds';
      return 'other_in';
    }
    if (type === 'transfer') return 'transfer';
    const mk = ' ' + key + ' ';
    for (const [cat, words] of KEYWORDS) {
      for (const w of words) {
        const whole = /^\s|\s$/.test(w);
        const k = merchantKey(w);
        if (!k) continue;
        if (whole ? mk.includes(' ' + k + ' ') : mk.includes(' ' + k)) return cat;
      }
    }
    return 'other';
  }

  function toAED(amount, currency, fx) {
    const r = (fx && fx[currency]) || DEFAULT_FX[currency];
    return r ? Math.round(amount * r * 100) / 100 : amount;
  }

  // ---------- PDF statement line parsing (pure; fed with text lines) ----------
  const DATE_START = /^(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}[\s\-\/][A-Za-z]{3}[\s\-\/]\d{2,4}|\d{4}-\d{2}-\d{2}|[A-Za-z]{3}\s+\d{1,2},?\s+\d{4})\b/;
  const AMT_TOKEN = /(?<![\d\/\-])(-?\(?[\d]{1,3}(?:,\d{3})*(?:\.\d{2})\)?|-?\d+\.\d{2})(\s?(?:CR|DR|Cr|Dr|-))?(?![\d\/])/g;
  const SKIP_LINE = /(opening balance|closing balance|balance brought forward|balance carried forward|brought forward|carried forward|total|statement period|page \d|minimum (amount|payment)|payment due|credit limit|available limit)/i;

  /** lines: [{text, cells:[{x, text}]}] in reading order. headerCols: optional {debit:x, credit:x, balance:x} */
  function parseStatementLines(lines) {
    const txns = [];
    let cols = null; let prevBal = null; let cur = null;
    for (const ln of lines) {
      const text = ln.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const low = text.toLowerCase();
      if (/(debit|withdrawal|money out)/.test(low) && /(credit|deposit|money in)/.test(low) && ln.cells) {
        cols = {};
        for (const c of ln.cells) {
          const ct = c.text.toLowerCase();
          if (/debit|withdrawal|money out/.test(ct)) cols.debit = c.x + (c.w || 0) / 2;
          else if (/credit|deposit|money in/.test(ct)) cols.credit = c.x + (c.w || 0) / 2;
          else if (/balance/.test(ct)) cols.balance = c.x + (c.w || 0) / 2;
        }
        if (cols.debit == null || cols.credit == null) cols = null;
        continue;
      }
      const openBal = text.match(/(opening balance|balance brought forward|brought forward)[^\d-]*(-?[\d,]+\.\d{2})/i);
      if (openBal) { prevBal = num(openBal[2]); continue; }
      const dm = text.match(DATE_START);
      if (!dm) {
        // continuation of description
        if (cur && !SKIP_LINE.test(text) && !(text.match(AMT_TOKEN) || []).length && text.length < 80) cur.description += ' ' + text;
        continue;
      }
      if (SKIP_LINE.test(text)) { const b = text.match(AMT_TOKEN); if (/opening|brought/i.test(text) && b) prevBal = num(b[b.length - 1].replace(/[()CRDr\s-]/g, '')); continue; }
      const date = parseLooseDate(dm[1]);
      if (!date) continue;
      let rest = text.slice(dm[0].length).trim();
      // strip a second (posting/value) date
      const dm2 = rest.match(DATE_START); if (dm2) rest = rest.slice(dm2[0].length).trim();
      // amounts with positions
      const amts = [];
      if (ln.cells) {
        for (const c of ln.cells) {
          const ct = c.text.trim();
          const mm = ct.match(/^(-?\(?[\d,]*\d\.\d{2}\)?)(\s?(?:CR|DR|Cr|Dr|-))?$/);
          if (mm) amts.push({ v: num(mm[1].replace(/[()]/g, '')), neg: /^-|\(/.test(mm[1]) || /-$/.test(mm[2] || ''), cr: /cr/i.test(mm[2] || ''), dr: /dr/i.test(mm[2] || ''), x: c.x + (c.w || 0) / 2, raw: ct });
        }
      }
      if (!amts.length) {
        let mm; AMT_TOKEN.lastIndex = 0;
        while ((mm = AMT_TOKEN.exec(rest))) amts.push({ v: num(mm[1].replace(/[()-]/g, '')), neg: /^-|\(/.test(mm[1]) || /-$/.test(mm[2] || ''), cr: /cr/i.test(mm[2] || ''), dr: /dr/i.test(mm[2] || ''), x: null, raw: mm[0] });
      }
      if (!amts.length) continue;
      let desc = rest;
      for (const a of amts) desc = desc.replace(a.raw, ' ');
      desc = desc.replace(/\b(AED|USD|EUR|GBP)\b\s*$/i, '').replace(/\s+/g, ' ').trim();

      let amount, type = 'expense', bal = null;
      if (cols && amts.every((a) => a.x != null)) {
        let debit = null, credit = null;
        for (const a of amts) {
          const dd = Math.abs(a.x - cols.debit), dc = Math.abs(a.x - cols.credit), db = cols.balance != null ? Math.abs(a.x - cols.balance) : Infinity;
          const min = Math.min(dd, dc, db);
          if (min === db) bal = a.v; else if (min === dd) debit = a.v; else credit = a.v;
        }
        if (debit != null) { amount = debit; type = 'expense'; } else if (credit != null) { amount = credit; type = 'income'; }
      }
      if (amount == null) {
        if (amts.length >= 2) {
          bal = amts[amts.length - 1].v * (amts[amts.length - 1].neg ? -1 : 1);
          const a = amts[amts.length - 2]; amount = a.v;
          if (prevBal != null) type = bal < prevBal - 0.001 ? 'expense' : 'income';
          else if (a.cr) type = 'income'; else if (a.neg) type = 'expense';
          else type = /salary|credit|deposit|refund|transfer from|received|inward/i.test(desc) ? 'income' : 'expense';
          if (amts.length >= 3 && prevBal != null) { // debit, credit, balance all present
            const d = amts[amts.length - 3].v, c = amts[amts.length - 2].v;
            if (Math.abs(prevBal - d - bal) < 0.02) { amount = d; type = 'expense'; } else if (Math.abs(prevBal + c - bal) < 0.02) { amount = c; type = 'income'; }
          }
        } else {
          const a = amts[0]; amount = a.v;
          type = a.cr || (a.neg && /payment|refund|credit/i.test(desc)) ? 'income' : 'expense';
          if (a.cr && /payment|thank you/i.test(desc)) type = 'transfer';
        }
      }
      if (bal != null) prevBal = bal;
      if (/(payment received|thank you for (your )?payment|card payment|cc payment|credit card payment)/i.test(desc)) type = 'transfer';
      if (!amount) continue;
      cur = { date, description: desc || 'Transaction', amount, type, balance: bal };
      txns.push(cur);
    }
    return txns;
  }

  function isKidCategory(id) { return /^k_/.test(String(id || '')); }

  const API = { isKidCategory, parseSms, splitMessages, categorize, cleanMerchant, merchantKey, smsHash, hash, toAED, parseLooseDate, ymd, hm, parseStatementLines, DEFAULT_FX, DEFAULT_CATEGORIES, KEYWORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.DirhamParser = API;
})(typeof self !== 'undefined' ? self : this);
