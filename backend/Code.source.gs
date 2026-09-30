// Registration backend — Google Apps Script bound to the group's Google Sheet.
// Setup: see backend/SETUP.md. The site talks to this through the web-app URL in prices.js (apiUrl).
//
// EDIT THIS FILE, then run `python backend/build.py` to regenerate Code.gs — the copy you paste into
// Apps Script. Code.gs writes Hebrew as \u escapes because pasting Hebrew into the Apps Script editor
// reversed it (30/09/2026: the tab came out as "תומשרה").
//
// Actions (POST body is JSON, sent as text/plain to avoid a CORS preflight):
//   save    {user, pin, data, nights, maxPeople, full, group}          → create, or update if the pin matches
//   load    {user, pin}                                                → the saved calculator state
//   delete  {user, pin}                                                → remove the entry
//   summary {}   (also GET)                                            → names, families, people per night
//   tips    {}                                                         → approved tips + approved comments (cached)
//   submitTip     {clientId, category, title, text, author, hp}        → a pending tip (safe to repeat)
//   submitComment {clientId, tipId, text, author, hp}                  → a pending comment (safe to repeat)
//   gear    {}                                                         → the approved equipment list (cached)
//   submitGear    {clientId, section, name, hp}                        → a suggested item, pending (safe to repeat)

var SHEET_NAME = 'הרשמות';
var HEAD = ['שם משתמש', 'שם להצגה', 'עודכן', 'לנים (מקסימום)', 'לנים לפי לילה', 'מחיר מלא', 'מחיר קבוצתי',
            'נתונים', 'pinHash', 'ניסיונות כושלים', 'ניסיון כושל אחרון'];
var COL = { user: 0, family: 1, updated: 2, maxPeople: 3, nightsText: 4, full: 5, group: 6,
            data: 7, pinHash: 8, fails: 9, lastFail: 10 };
var MAX_FAILS = 5;
var LOCK_MS = 15 * 60 * 1000;   // temporary, so a stranger cannot lock a family out for good

function doGet() { return json_(route({ action: 'summary' }, sheetStore_())); }

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: 'bad_request' }); }
  var cacheKey = req && { tips: TIPS_CACHE, gear: GEAR_CACHE }[req.action];
  if (cacheKey) {                                     // public read: served from cache, no lock on a hit
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (cacheKey) {
      var out = JSON.stringify(route(req, null, tipsStore_()));
      try { CacheService.getScriptCache().put(cacheKey, out, 300); } catch (x) { /* too big to cache: still served */ }
      return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
    }
    var tipAction = req && (req.action === 'submitTip' || req.action === 'submitComment' || req.action === 'submitGear');
    var res = route(req, tipAction ? null : sheetStore_(), tipAction ? tipsStore_() : null);
    if (res.ok && (req.action === 'save' || req.action === 'delete')) {
      try { syncOrganizers_(); } catch (x) { /* the organizers' copy must never break a registration */ }
    }
    return json_(res);
  } finally { lock.releaseLock(); }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- pure logic (store is injected so it can be tested outside Google) ----------
// store = registrations, tstore = tips and comments; each action touches only its own.
function route(req, store, tstore) {
  try {
    switch (req && req.action) {
      case 'save': return save_(req, store);
      case 'load': return load_(req, store);
      case 'delete': return remove_(req, store);
      case 'summary': return summary_(store);
      case 'tips': return tipsPublic_(tstore);
      case 'submitTip': return submitTip_(req, tstore);
      case 'submitComment': return submitComment_(req, tstore);
      case 'gear': return gearPublic_(tstore);
      case 'submitGear': return submitGear_(req, tstore);
      default: return { ok: false, error: 'bad_request' };
    }
  } catch (x) {
    return { ok: false, error: x.code || 'server_error' };
  }
}

function fail_(code) { var e = new Error(code); e.code = code; throw e; }
function normUser_(u) { return String(u || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function checkCreds_(req) {
  var user = normUser_(req.user);
  if (user.length < 2 || user.length > 40) fail_('bad_user');
  if (!/^\d{4,8}$/.test(String(req.pin || ''))) fail_('bad_pin');
  return user;
}
// A cell starting with = + - @ would be read by Sheets as a formula.
function safeCell_(s) { s = String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, 80); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function findRow_(store, user) {
  var rows = store.all();
  for (var i = 0; i < rows.length; i++) if (rows[i].user === user) return rows[i];
  return null;
}

// Wrong pins lock the entry for LOCK_MS, so a 4-digit code cannot be brute-forced.
function verify_(store, row, pin) {
  var now = store.nowMs();
  if (row.fails >= MAX_FAILS) {
    if (now - row.lastFail < LOCK_MS) fail_('locked');
    row.fails = 0;
  }
  if (row.pinHash !== store.hash(row.user, pin)) {
    row.fails += 1; row.lastFail = now; store.put(row);
    fail_(row.fails >= MAX_FAILS ? 'locked' : 'wrong_pin');
  }
  if (row.fails) { row.fails = 0; store.put(row); }
}

function cleanNights_(n) {
  var out = {};
  Object.keys(n || {}).forEach(function (k) {
    var v = Math.floor(Number(n[k]));
    if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v > 0 && v < 1000) out[k] = v;
  });
  return out;
}

function save_(req, store) {
  var user = checkCreds_(req);
  var data = JSON.stringify(req.data || {});
  if (data.length > 20000) fail_('too_big');
  var row = findRow_(store, user), created = !row;
  if (row) verify_(store, row, String(req.pin));
  else row = { user: user, pinHash: store.hash(user, String(req.pin)), fails: 0, lastFail: 0 };
  row.family = safeCell_(req.user);
  row.updated = store.now();
  row.maxPeople = Math.max(0, Math.floor(Number(req.maxPeople) || 0));
  row.nights = cleanNights_(req.nights);
  row.full = Math.max(0, Math.round(Number(req.full) || 0));
  row.group = Math.max(0, Math.round(Number(req.group) || 0));
  row.data = data;
  store.put(row);
  return { ok: true, created: created, summary: summary_(store) };
}

function load_(req, store) {
  var user = checkCreds_(req);
  var row = findRow_(store, user);
  if (!row) fail_('not_found');
  verify_(store, row, String(req.pin));
  var data = JSON.parse(row.data || '{}');
  delete data.__nights;
  return { ok: true, family: String(row.family).replace(/^'/, ''), updated: row.updated, data: data };
}

function remove_(req, store) {
  var user = checkCreds_(req);
  var row = findRow_(store, user);
  if (!row) fail_('not_found');
  verify_(store, row, String(req.pin));
  store.remove(row);
  return { ok: true, summary: summary_(store) };
}

// Public: names (for the name dropdown), family count and people per night. No prices, no codes.
function summary_(store) {
  var nights = {}, families = 0, names = [];
  store.all().forEach(function (r) {
    names.push(String(r.family).replace(/^'/, ''));
    if (!r.maxPeople) return;
    families++;
    Object.keys(r.nights || {}).forEach(function (k) { nights[k] = (nights[k] || 0) + r.nights[k]; });
  });
  names.sort();
  return { ok: true, families: families, nights: nights, names: names };
}

// ---------- organizers' sheet ----------
// A SEPARATE file, safe to share with organizers: family, dates, headcount, prices — no codes, no raw data.
// Sharing a Google Sheet shares every tab, so this cannot be a tab of the registration file.
// It is refreshed after every save/cancel. Columns after the computed ones ("שולם", "הערות מארגנים",
// and anything organizers add further left) are theirs: the script never writes there, and a
// cancelled family keeps its row (status "בוטל") so a recorded payment is never lost.
var ORG_PROP = 'ORG_SHEET_ID';
var ORG_TABS = { families: 'משפחות', nights: 'לילות', summary: 'סיכום' };
var ORG_HEAD = ['שם המשפחה', 'סטטוס', 'עודכן', 'תקופות', 'לנים לפי לילה', 'מבוגרים (14+)', 'ילדים (5 עד 13)',
                'פעוטות (עד 5)', 'הנחות', 'מחיר מלא', 'מחיר קבוצתי'];
var ORG_MANUAL = ['שולם (₪)', 'הערות מארגנים'];
var ADULT_KEYS = ['adult', 'matmonAdult', 'reserveAdult', 'soldier', 'student', 'senior', 'idfDisabled', 'escort'];
var CHILD_KEYS = ['child', 'matmonChild', 'reserveChild'];
var DISCOUNT_LABELS = { matmonAdult: 'מטמון מבוגר', matmonChild: 'מטמון ילד', reserveAdult: 'מילואים מבוגר',
  reserveChild: 'מילואים ילד', soldier: 'חייל/ת', student: 'סטודנט/ית', senior: 'אזרח/ית ותיק/ה',
  idfDisabled: 'נכה צה"ל ומלווה', escort: 'מלווה לאדם עם מוגבלות' };
var WEEKDAYS_ = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
var GROUP_MIN = 30;

function dmText_(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
// Weekday prefix keeps Sheets from reading "06/10" as a (month-first) date.
function nightLabel_(iso) {
  var d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
  return WEEKDAYS_[d.getUTCDay()] + ' ' + dmText_(iso);
}

// One registration row -> the organizers' computed columns.
// Headcount per category is the largest across the family's periods.
function familySummary_(row) {
  var d = {};
  try { d = typeof row.data === 'string' ? JSON.parse(row.data || '{}') : (row.data || {}); } catch (x) { /* empty */ }
  var base = d.base || {}, periods = d.periods || [], max = {}, custom = false;
  (periods.length ? periods : [{ counts: base, custom: true }]).forEach(function (p) {
    var c = p.custom ? (p.counts || {}) : base;
    if (p.custom && periods.length) custom = true;
    Object.keys(c).forEach(function (k) { max[k] = Math.max(max[k] || 0, +c[k] || 0); });
  });
  function sum(keys) { return keys.reduce(function (s, k) { return s + (max[k] || 0); }, 0); }
  var discounts = Object.keys(DISCOUNT_LABELS).filter(function (k) { return max[k] > 0; })
    .map(function (k) { return DISCOUNT_LABELS[k] + ' ×' + max[k]; }).join(', ');
  var per = periods.map(function (p) { return dmText_(p.from) + ' עד ' + dmText_(p.to); }).join(' · ') +
    (custom ? ' (ההרכב משתנה בין התקופות)' : '');
  var nights = Object.keys(row.nights || {}).sort()
    .map(function (k) { return dmText_(k) + ': ' + row.nights[k]; }).join(' · ');
  return [row.family, 'רשום', row.updated, per, nights, sum(ADULT_KEYS), sum(CHILD_KEYS), max.toddler || 0,
          discounts, row.full, row.group];
}

// Pure: merge current registrations into the organizers' existing rows.
// existing = rows below the header, full width. Returns the computed block (same order as existing,
// new families appended) plus the per-night table.
function organizerTable_(rows, existing) {
  var w = ORG_HEAD.length, byName = {}, seen = {};
  rows.forEach(function (r) { byName[normUser_(String(r.family).replace(/^'/, ''))] = r; });
  var computed = existing.map(function (e) {
    var key = normUser_(String(e[0]).replace(/^'/, ''));
    if (byName[key]) { seen[key] = true; return familySummary_(byName[key]); }
    var old = e.slice(0, w); while (old.length < w) old.push('');
    old[1] = 'בוטל';
    return old;
  });
  rows.forEach(function (r) {
    var key = normUser_(String(r.family).replace(/^'/, ''));
    if (!seen[key]) { seen[key] = true; computed.push(familySummary_(r)); }
  });
  var nightMap = {};
  rows.forEach(function (r) {
    Object.keys(r.nights || {}).forEach(function (k) {
      nightMap[k] = nightMap[k] || { people: 0, families: 0 };
      nightMap[k].people += r.nights[k]; nightMap[k].families += 1;
    });
  });
  var nights = Object.keys(nightMap).sort().map(function (k) {
    var n = nightMap[k].people;
    return [nightLabel_(k), n, nightMap[k].families, n >= GROUP_MIN ? 'כן' : 'חסרים ' + (GROUP_MIN - n)];
  });
  return { computed: computed, nights: nights };
}

function syncOrganizers_() {
  var id = PropertiesService.getScriptProperties().getProperty(ORG_PROP);
  if (!id) return false;
  var ss = SpreadsheetApp.openById(id);
  function tab(name) {
    var sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); sh.setRightToLeft(true); sh.setFrozenRows(1); }
    return sh;
  }
  var fam = tab(ORG_TABS.families), ngt = tab(ORG_TABS.nights), sum = tab(ORG_TABS.summary);
  var w = ORG_HEAD.length;
  var last = fam.getLastRow();
  var existing = last > 1 ? fam.getRange(2, 1, last - 1, Math.max(w, fam.getLastColumn())).getValues() : [];
  var t = organizerTable_(sheetStore_().all(), existing);

  fam.getRange(1, 1, 1, w + ORG_MANUAL.length).setValues([ORG_HEAD.concat(ORG_MANUAL)]).setFontWeight('bold');
  if (t.computed.length) fam.getRange(2, 1, t.computed.length, w).setValues(t.computed);   // manual columns untouched

  ngt.clearContents();
  ngt.getRange(1, 1, 1, 4).setValues([['לילה', 'לנים', 'משפחות', 'מחיר קבוצתי (' + GROUP_MIN + '+)?']]).setFontWeight('bold');
  if (t.nights.length) ngt.getRange(2, 1, t.nights.length, 4).setValues(t.nights);

  var F = "'" + ORG_TABS.families + "'!";
  sum.clearContents();
  sum.getRange(1, 1, 6, 2).setValues([
    ['משפחות רשומות', '=COUNTIF(' + F + 'B2:B,"רשום")'],
    ['משפחות שביטלו', '=COUNTIF(' + F + 'B2:B,"בוטל")'],
    ['סה"כ מחיר מלא (רשומים)', '=SUMIF(' + F + 'B2:B,"רשום",' + F + 'J2:J)'],
    ['סה"כ מחיר קבוצתי (רשומים)', '=SUMIF(' + F + 'B2:B,"רשום",' + F + 'K2:K)'],
    ['סה"כ שולם', '=SUM(' + F + 'L2:L)'],
    ['עודכן לאחרונה', Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')]
  ]);
  sum.getRange(1, 1, 6, 1).setFontWeight('bold');

  // drop the empty default tab a new spreadsheet comes with
  ss.getSheets().forEach(function (s) {
    if (s.getName() !== ORG_TABS.families && s.getName() !== ORG_TABS.nights && s.getName() !== ORG_TABS.summary &&
        s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  return true;
}

// Menu in the registration sheet: connect the organizers' file once, re-sync any time.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('מארגנים')
    .addItem('חיבור לגיליון המארגנים', 'connectOrganizers')
    .addItem('סנכרון עכשיו', 'syncNow')
    .addSeparator()
    .addItem('הפעלת התראות', 'enableAlerts')
    .addToUi();
}
function connectOrganizers() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('חיבור לגיליון המארגנים', 'הדביקו את הקישור לגיליון המארגנים:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(r.getResponseText()) || /^([a-zA-Z0-9_-]{20,})$/.exec(r.getResponseText().trim());
  if (!m) { ui.alert('לא זיהיתי קישור של Google Sheets.'); return; }
  PropertiesService.getScriptProperties().setProperty(ORG_PROP, m[1]);
  syncOrganizers_();
  ui.alert('מחובר. גיליון המארגנים מתעדכן אחרי כל הרשמה, עדכון או ביטול.');
}
function syncNow() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(syncOrganizers_() ? 'גיליון המארגנים עודכן.' : 'עוד לא חובר גיליון מארגנים — מארגנים ← חיבור לגיליון המארגנים.');
}

// ---------- tips (docs/tips-plan.md) ----------
// Two tabs in this (private) sheet. Nothing is public until Yair sets its status to מאושר.
// Moderation is one cell: the status dropdown. For a near-duplicate: status מוזג + the existing tip's number
// in "מוזג לטיפ" — the script then copies the text into a comment on that tip, so nothing is lost.
//@include search.js

var TIP_TABS = { tips: 'טיפים', comments: 'תגובות' };
var TIP_HEAD = ['מספר', 'סטטוס', 'קטגוריה', 'כותרת', 'טקסט', 'שם (לא חובה)', 'נשלח', 'אושר', 'מוזג לטיפ', 'דומה ל…', 'מזהה שליחה'];
var TIP_COL = { id: 0, status: 1, category: 2, title: 3, text: 4, author: 5, submitted: 6, approved: 7,
                mergedInto: 8, similar: 9, clientId: 10 };
var CMT_HEAD = ['מספר', 'טיפ', 'סטטוס', 'טקסט', 'שם (לא חובה)', 'נשלח', 'אושר', 'מזהה שליחה'];
var CMT_COL = { id: 0, tipId: 1, status: 2, text: 3, author: 4, submitted: 5, approved: 6, clientId: 7 };
var ST = { pending: 'ממתין', approved: 'מאושר', rejected: 'נדחה', merged: 'מוזג', hidden: 'הוסתר' };
var TIP_STATUSES = [ST.pending, ST.approved, ST.rejected, ST.merged, ST.hidden];
var CMT_STATUSES = [ST.pending, ST.approved, ST.rejected, ST.hidden];
var TIP_CATEGORIES = ['ציוד', 'אוהלים ולינה', 'אוכל ובישול', 'ילדים', 'ים וחוף', 'מקלחות ושירותים', 'בטיחות',
                      'הגעה וחניה', 'סלולרי ומחשבים', 'חשמל ותאורה', 'שונות'];
var TIP_LIMITS = { title: 60, text: 400, comment: 300, author: 40 };
var MAX_PENDING = 200;          // tips + comments waiting, so the sheet cannot be flooded
var TIPS_CACHE = 'tips-v1';

// Free text for a cell: trimmed, at most one blank line in a row, formula-guarded. Too long is an error,
// never a silent cut — the site enforces the same limits, so only a hand-made request gets here.
function tipText_(s, min, max) {
  s = String(s == null ? '' : s).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (s.length < min) fail_('too_short');
  if (s.length > max) fail_('too_long');
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function unguard_(s) { return String(s == null ? '' : s).replace(/^'(?=[=+\-@])/, ''); }
function checkClientId_(id) { if (!/^[A-Za-z0-9_-]{8,40}$/.test(String(id || ''))) fail_('bad_request'); return String(id); }
function nextId_(rows) { return rows.reduce(function (m, r) { return Math.max(m, +r.id || 0); }, 0) + 1; }
function tipNumber_(v) { var m = /\d+/.exec(String(v == null ? '' : v)); return m ? +m[0] : 0; }
function pendingCount_(ts) {
  function n(rows) { return rows.filter(function (r) { return r.status === ST.pending; }).length; }
  return n(ts.tips()) + n(ts.comments()) + n(gearRows_(ts));
}

// Public: approved tips, newest first, each with its approved comments (oldest first).
// Only these fields ever leave the sheet: no dates, no client ids, nothing pending.
function tipsPublic_(ts) {
  var byTip = {};
  ts.comments().forEach(function (c) {
    if (c.status !== ST.approved) return;
    var k = tipNumber_(c.tipId);
    (byTip[k] = byTip[k] || []).push({ id: +c.id, text: unguard_(c.text), author: unguard_(c.author) });
  });
  var tips = ts.tips().filter(function (t) { return t.status === ST.approved; }).map(function (t) {
    var cs = (byTip[+t.id] || []).sort(function (a, b) { return a.id - b.id; });
    return { id: +t.id, category: String(t.category), title: unguard_(t.title), text: unguard_(t.text),
             author: unguard_(t.author), comments: cs };
  });
  tips.sort(function (a, b) { return b.id - a.id; });
  return { ok: true, categories: TIP_CATEGORIES, tips: tips };
}

function submitTip_(req, ts) {
  var clientId = checkClientId_(req.clientId);
  if (req.hp) return { ok: true, id: 0 };                               // bot trap: pretend it worked
  var dup = ts.tips().filter(function (t) { return t.clientId === clientId; })[0];
  if (dup) return { ok: true, id: +dup.id };                              // a retry: already saved
  if (TIP_CATEGORIES.indexOf(req.category) < 0) fail_('bad_category');
  var title = tipText_(req.title, 3, TIP_LIMITS.title), text = tipText_(req.text, 5, TIP_LIMITS.text);
  var author = req.author ? tipText_(req.author, 0, TIP_LIMITS.author) : '';
  if (pendingCount_(ts) >= MAX_PENDING) fail_('busy');
  var others = ts.tips().filter(function (t) { return t.status !== ST.rejected; })
    .map(function (t) { return { id: +t.id, title: unguard_(t.title), text: unguard_(t.text) }; });
  var near = similarTips_(unguard_(title), unguard_(text), others, 1)[0];
  var tip = { id: nextId_(ts.tips()), status: ST.pending, category: req.category, title: title, text: text,
              author: author, submitted: ts.now(), approved: '', mergedInto: '',
              similar: near ? near.tip.id + ': ' + near.tip.title : '', clientId: clientId };
  ts.addTip(tip);
  return { ok: true, id: tip.id };
}

function submitComment_(req, ts) {
  var clientId = checkClientId_(req.clientId);
  if (req.hp) return { ok: true, id: 0 };
  var dup = ts.comments().filter(function (c) { return c.clientId === clientId; })[0];
  if (dup) return { ok: true, id: +dup.id };
  var tipId = tipNumber_(req.tipId);
  if (!ts.tips().some(function (t) { return +t.id === tipId && t.status === ST.approved; })) fail_('not_found');
  var text = tipText_(req.text, 2, TIP_LIMITS.comment);
  var author = req.author ? tipText_(req.author, 0, TIP_LIMITS.author) : '';
  if (pendingCount_(ts) >= MAX_PENDING) fail_('busy');
  var c = { id: nextId_(ts.comments()), tipId: tipId, status: ST.pending, text: text, author: author,
            submitted: ts.now(), approved: '', clientId: clientId };
  ts.addComment(c);
  return { ok: true, id: c.id };
}

// ---------- equipment list (docs/gear-plan.md) ----------
// Tab ציוד: the general list. Created with the starter list from gear-seed.js (item N = row id N, so a
// visitor's ticks made against the site's copy of the list still mean the same items).
// A visitor's own item arrives as a pending row; מאושר adds it to everyone's list, הוסתר takes any item off.
//@include gear-seed.js

var GEAR_TAB = 'ציוד';
var GEAR_HEAD = ['מספר', 'סטטוס', 'קטגוריה', 'פריט', 'תגיות', 'הערה', 'נשלח', 'אושר', 'מזהה שליחה'];
var GEAR_COL = { id: 0, status: 1, section: 2, name: 3, tags: 4, note: 5, submitted: 6, approved: 7, clientId: 8 };
var GEAR_STATUSES = [ST.pending, ST.approved, ST.rejected, ST.hidden];
var GEAR_NAME_MAX = 60;
var GEAR_CACHE = 'gear-v1';

// A store without gear (older test mocks) reads as an empty tab.
function gearRows_(ts) { return ts.gear ? ts.gear() : []; }

// The starter rows, as written into a new tab. "אושר" carries a label, not a date, so they are not
// re-stamped one by one on the first edit.
function gearSeedRows_() {
  return GEAR_SEED_.map(function (g, i) {
    return [i + 1, ST.approved, g[0], g[1], g[2], g[3], '', 'רשימה התחלתית', 'seed-' + (i + 1)];
  });
}

// Public: approved items in sheet order. Only these fields leave the sheet.
function gearPublic_(ts) {
  var sections = GEAR_SECTIONS_.slice();
  var items = gearRows_(ts).filter(function (g) { return g.status === ST.approved && String(g.name) !== ''; })
    .map(function (g) {
      var section = String(g.section) || 'שונות';
      if (sections.indexOf(section) < 0) sections.push(section);
      return { id: +g.id, section: section, name: unguard_(g.name),
               tags: String(g.tags || '').split(/[,،]/).map(function (t) { return t.trim(); }).filter(Boolean),
               note: unguard_(g.note) };
    });
  return { ok: true, sections: sections, items: items };
}

function submitGear_(req, ts) {
  var clientId = checkClientId_(req.clientId);
  if (req.hp) return { ok: true, id: 0 };
  var dup = gearRows_(ts).filter(function (g) { return g.clientId === clientId; })[0];
  if (dup) return { ok: true, id: +dup.id };
  if (GEAR_SECTIONS_.indexOf(req.section) < 0) fail_('bad_category');
  var name = tipText_(String(req.name || '').replace(/\n/g, ' '), 2, GEAR_NAME_MAX);
  if (pendingCount_(ts) >= MAX_PENDING) fail_('busy');
  var g = { id: nextId_(gearRows_(ts)), status: ST.pending, section: req.section, name: name, tags: '', note: '',
            submitted: ts.now(), approved: '', clientId: clientId };
  ts.addGear(g);
  return { ok: true, id: g.id };
}

// After Yair edits a status: stamp the approval time, and carry out merges.
// Safe to run any number of times — a merge's comment carries the id "merge-<tip>", so it is made once.
function housekeep_(ts) {
  var done = { stamped: 0, merged: 0 };
  function stamp(rows, update) {
    rows.forEach(function (r) {
      if (r.status === ST.approved && !r.approved) { r.approved = ts.now(); update(r); done.stamped++; }
    });
  }
  stamp(ts.tips(), ts.updateTip);
  stamp(ts.comments(), ts.updateComment);
  if (ts.gear) stamp(ts.gear(), ts.updateGear);
  ts.tips().forEach(function (t) {
    if (t.status !== ST.merged) return;
    var target = tipNumber_(t.mergedInto), key = 'merge-' + t.id;
    if (!target || target === +t.id) return;
    if (!ts.tips().some(function (x) { return +x.id === target && x.status === ST.approved; })) return;
    if (ts.comments().some(function (c) { return c.clientId === key; })) return;
    ts.addComment({ id: nextId_(ts.comments()), tipId: target, status: ST.approved,
                    text: unguard_(t.title) + ': ' + unguard_(t.text), author: t.author,
                    submitted: t.submitted, approved: ts.now(), clientId: key });
    done.merged++;
  });
  return done;
}

// The 2-hour digest: null unless something arrived since the last email (seen = highest ids already
// reported), so an item left waiting on purpose is not re-sent every 2 hours. Lists everything waiting.
function pendingDigest_(ts, seen, sheetUrl) {
  seen = seen || {};
  var tips = ts.tips().filter(function (t) { return t.status === ST.pending; });
  var cmts = ts.comments().filter(function (c) { return c.status === ST.pending; });
  var gear = gearRows_(ts).filter(function (g) { return g.status === ST.pending; });
  var fresh = tips.some(function (t) { return +t.id > (seen.tip || 0); }) ||
              cmts.some(function (c) { return +c.id > (seen.comment || 0); }) ||
              gear.some(function (g) { return +g.id > (seen.gear || 0); });
  if (!fresh) return null;
  var titles = {};
  ts.tips().forEach(function (t) { titles[+t.id] = unguard_(t.title); });
  var lines = [];
  if (tips.length) {
    lines.push('טיפים (' + tips.length + '):');
    tips.forEach(function (t) {
      lines.push('  ' + t.id + '. [' + t.category + '] ' + unguard_(t.title) + (t.similar ? '   (דומה ל־' + t.similar + ')' : ''));
    });
  }
  if (cmts.length) {
    if (lines.length) lines.push('');
    lines.push('תגובות (' + cmts.length + '):');
    cmts.forEach(function (c) {
      var k = tipNumber_(c.tipId);
      lines.push('  ' + c.id + '. על טיפ ' + k + ' (' + (titles[k] || '?') + '): ' + unguard_(c.text).slice(0, 80));
    });
  }
  if (gear.length) {
    if (lines.length) lines.push('');
    lines.push('פריטי ציוד שהוצעו (' + gear.length + '):');
    gear.forEach(function (g) { lines.push('  ' + g.id + '. [' + g.section + '] ' + unguard_(g.name)); });
    lines.push('  (בלשונית ' + GEAR_TAB + ': אפשר לתקן את הקטגוריה לפני האישור)');
  }
  lines.push('', 'לאישור: משנים את עמודת "סטטוס" ל"מאושר" (או נדחה / מוזג / הוסתר).', sheetUrl || '');
  return { subject: 'אכזיב: ' + (tips.length + cmts.length + gear.length) + ' ממתינים לאישור',
           body: lines.join('\n'),
           seen: { tip: nextId_(ts.tips()) - 1, comment: nextId_(ts.comments()) - 1, gear: nextId_(gearRows_(ts)) - 1 } };
}

// Simple trigger: runs on every hand edit of the sheet.
function onEdit(e) {
  var name = e && e.range ? e.range.getSheet().getName() : '';
  if (name !== TIP_TABS.tips && name !== TIP_TABS.comments && name !== GEAR_TAB) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;          // the next edit or digest run catches up
  try { housekeep_(tipsStore_()); } finally { lock.releaseLock(); }
  CacheService.getScriptCache().removeAll([TIPS_CACHE, GEAR_CACHE]);
}

// Time trigger (every 2 hours, installed by enableAlerts): email the owner if something new waits.
function sendDigest() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var d, props = PropertiesService.getScriptProperties();
  try {
    var ts = tipsStore_();
    housekeep_(ts);
    var seen = {};
    try { seen = JSON.parse(props.getProperty('DIGEST_SEEN') || '{}'); } catch (x) { /* start over */ }
    d = pendingDigest_(ts, seen, SpreadsheetApp.getActiveSpreadsheet().getUrl());
  } finally { lock.releaseLock(); }
  CacheService.getScriptCache().removeAll([TIPS_CACHE, GEAR_CACHE]);
  if (!d) return;
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), d.subject, d.body);
  props.setProperty('DIGEST_SEEN', JSON.stringify(d.seen));
}

// Menu: install the 2-hour trigger (Google asks for the email and trigger permissions here, once).
function enableAlerts() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDigest') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDigest').timeBased().everyHours(2).create();
  tipsStore_().tips();                       // make sure the tabs exist (ציוד is written with the starter list)
  tipsStore_().comments();
  tipsStore_().gear();
  SpreadsheetApp.getUi().alert('התראות הופעלו: כל שעתיים, אם הגיע משהו חדש לאישור, יישלח אליך מייל אחד עם כל הממתינים.');
}

// ---------- Google Sheet store ----------
function sheetStore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('SALT');
  if (!salt) { salt = Utilities.getUuid(); props.setProperty('SALT', salt); }

  function nightsText(n) {
    return Object.keys(n || {}).sort().map(function (k) { return k.slice(8, 10) + '/' + k.slice(5, 7) + ': ' + n[k]; }).join(' · ');
  }
  var cache = null;
  return {
    all: function () {
      if (cache) return cache;
      var v = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getValues() : [];
      cache = v.map(function (c, i) {
        var data = {};
        try { data = JSON.parse(c[COL.data] || '{}'); } catch (x) { /* keep empty */ }
        return { _row: i + 2, user: String(c[COL.user]), family: c[COL.family],
                 updated: c[COL.updated], maxPeople: +c[COL.maxPeople] || 0, nights: data.__nights || {},
                 full: +c[COL.full] || 0, group: +c[COL.group] || 0, data: c[COL.data],
                 pinHash: String(c[COL.pinHash]), fails: +c[COL.fails] || 0, lastFail: +c[COL.lastFail] || 0 };
      });
      return cache;
    },
    put: function (r) {
      // the per-night counts ride inside the JSON, so a hand-edited text column cannot corrupt the sum
      var d = {}; try { d = JSON.parse(r.data || '{}'); } catch (x) { /* ignore */ }
      d.__nights = r.nights; r.data = JSON.stringify(d);
      var vals = [];
      vals[COL.user] = r.user; vals[COL.family] = r.family;
      vals[COL.updated] = r.updated; vals[COL.maxPeople] = r.maxPeople; vals[COL.nightsText] = nightsText(r.nights);
      vals[COL.full] = r.full; vals[COL.group] = r.group; vals[COL.data] = r.data;
      vals[COL.pinHash] = r.pinHash; vals[COL.fails] = r.fails; vals[COL.lastFail] = r.lastFail || '';
      if (!r._row) { sh.appendRow(vals); r._row = sh.getLastRow(); this.all().push(r); }
      else sh.getRange(r._row, 1, 1, HEAD.length).setValues([vals]);
    },
    remove: function (r) { sh.deleteRow(r._row); cache = null; },
    hash: function (user, pin) {
      return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + user + '|' + pin)
        .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
    },
    now: function () { return Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm'); },
    nowMs: function () { return Date.now(); }
  };
}

// ---------- tips store (Google Sheet) ----------
// The two tabs are created on first use, with status (and category) dropdowns.
function tipsStore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  function dropdown(sh, col, list) {
    var rule = SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
    sh.getRange(2, col + 1, sh.getMaxRows() - 1, 1).setDataValidation(rule);
  }
  function tab(name, head, lists) {
    var sh = ss.getSheetByName(name);
    if (sh) return sh;
    sh = ss.insertSheet(name);
    sh.appendRow(head);
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
    lists.forEach(function (l) { dropdown(sh, l[0], l[1]); });
    return sh;
  }
  var tipSh = null, cmtSh = null, gearSh = null, tipRows = null, cmtRows = null, gearRows = null;
  function tipSheet() {
    return tipSh || (tipSh = tab(TIP_TABS.tips, TIP_HEAD, [[TIP_COL.status, TIP_STATUSES], [TIP_COL.category, TIP_CATEGORIES]]));
  }
  function cmtSheet() { return cmtSh || (cmtSh = tab(TIP_TABS.comments, CMT_HEAD, [[CMT_COL.status, CMT_STATUSES]])); }
  function gearSheet() {
    if (gearSh) return gearSh;
    var fresh = !ss.getSheetByName(GEAR_TAB);
    gearSh = tab(GEAR_TAB, GEAR_HEAD, [[GEAR_COL.status, GEAR_STATUSES], [GEAR_COL.section, GEAR_SECTIONS_]]);
    if (fresh) {                               // the starter list, in one write
      var seed = gearSeedRows_();
      gearSh.getRange(2, 1, seed.length, GEAR_HEAD.length).setValues(seed);
    }
    return gearSh;
  }
  function read(sh, cols, width) {
    var n = sh.getLastRow() - 1;
    var v = n > 0 ? sh.getRange(2, 1, n, width).getValues() : [];
    return v.map(function (c, i) {
      var r = { _row: i + 2 };
      Object.keys(cols).forEach(function (k) { r[k] = c[cols[k]]; });
      r.status = String(r.status); r.clientId = String(r.clientId);
      return r;
    }).filter(function (r) { return r.id !== ''; });
  }
  function vals(r, cols) { var out = []; Object.keys(cols).forEach(function (k) { out[cols[k]] = r[k] == null ? '' : r[k]; }); return out; }
  function add(sh, rows, r, cols) { sh.appendRow(vals(r, cols)); r._row = sh.getLastRow(); rows.push(r); }
  function update(sh, r, cols, width) { sh.getRange(r._row, 1, 1, width).setValues([vals(r, cols)]); }
  var store = {
    tips: function () { return tipRows || (tipRows = read(tipSheet(), TIP_COL, TIP_HEAD.length)); },
    comments: function () { return cmtRows || (cmtRows = read(cmtSheet(), CMT_COL, CMT_HEAD.length)); },
    addTip: function (r) { add(tipSheet(), store.tips(), r, TIP_COL); },
    addComment: function (r) { add(cmtSheet(), store.comments(), r, CMT_COL); },
    updateTip: function (r) { update(tipSheet(), r, TIP_COL, TIP_HEAD.length); },
    updateComment: function (r) { update(cmtSheet(), r, CMT_COL, CMT_HEAD.length); },
    gear: function () { return gearRows || (gearRows = read(gearSheet(), GEAR_COL, GEAR_HEAD.length)); },
    addGear: function (r) { add(gearSheet(), store.gear(), r, GEAR_COL); },
    updateGear: function (r) { update(gearSheet(), r, GEAR_COL, GEAR_HEAD.length); },
    now: function () { return new Date(); }       // a real date: the sheet shows it in its own (day-first) locale
  };
  return store;
}
