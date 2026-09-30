// GENERATED from Code.source.gs by backend/build.py - edit that file, not this one.
// Registration backend - Google Apps Script bound to the group's Google Sheet.
// Setup: see backend/SETUP.md. The site talks to this through the web-app URL in prices.js (apiUrl).
//
// EDIT THIS FILE, then run `python backend/build.py` to regenerate Code.gs - the copy you paste into
// Apps Script. Code.gs writes Hebrew as \u escapes because pasting Hebrew into the Apps Script editor
// reversed it (30/09/2026: the tab came out as "\u05ea\u05d5\u05de\u05e9\u05e8\u05d4").
//
// Actions (POST body is JSON, sent as text/plain to avoid a CORS preflight):
//   save    {user, pin, data, nights, maxPeople, full, group}          -> create, or update if the pin matches
//   load    {user, pin}                                                -> the saved calculator state
//   delete  {user, pin}                                                -> remove the entry
//   summary {}   (also GET)                                            -> names, families, people per night
//   tips    {}                                                         -> approved tips + approved comments (cached)
//   submitTip     {clientId, category, title, text, author, hp}        -> a pending tip (safe to repeat)
//   submitComment {clientId, tipId, text, author, hp}                  -> a pending comment (safe to repeat)

var SHEET_NAME = '\u05d4\u05e8\u05e9\u05de\u05d5\u05ea';
var HEAD = ['\u05e9\u05dd \u05de\u05e9\u05ea\u05de\u05e9', '\u05e9\u05dd \u05dc\u05d4\u05e6\u05d2\u05d4', '\u05e2\u05d5\u05d3\u05db\u05df', '\u05dc\u05e0\u05d9\u05dd (\u05de\u05e7\u05e1\u05d9\u05de\u05d5\u05dd)', '\u05dc\u05e0\u05d9\u05dd \u05dc\u05e4\u05d9 \u05dc\u05d9\u05dc\u05d4', '\u05de\u05d7\u05d9\u05e8 \u05de\u05dc\u05d0', '\u05de\u05d7\u05d9\u05e8 \u05e7\u05d1\u05d5\u05e6\u05ea\u05d9',
            '\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd', 'pinHash', '\u05e0\u05d9\u05e1\u05d9\u05d5\u05e0\u05d5\u05ea \u05db\u05d5\u05e9\u05dc\u05d9\u05dd', '\u05e0\u05d9\u05e1\u05d9\u05d5\u05df \u05db\u05d5\u05e9\u05dc \u05d0\u05d7\u05e8\u05d5\u05df'];
var COL = { user: 0, family: 1, updated: 2, maxPeople: 3, nightsText: 4, full: 5, group: 6,
            data: 7, pinHash: 8, fails: 9, lastFail: 10 };
var MAX_FAILS = 5;
var LOCK_MS = 15 * 60 * 1000;   // temporary, so a stranger cannot lock a family out for good

function doGet() { return json_(route({ action: 'summary' }, sheetStore_())); }

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return json_({ ok: false, error: 'bad_request' }); }
  if (req && req.action === 'tips') {                 // public read: served from cache, no lock on a hit
    var hit = CacheService.getScriptCache().get(TIPS_CACHE);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (req && req.action === 'tips') {
      var out = JSON.stringify(route(req, null, tipsStore_()));
      try { CacheService.getScriptCache().put(TIPS_CACHE, out, 300); } catch (x) { /* too big to cache: still served */ }
      return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
    }
    var tipAction = req && (req.action === 'submitTip' || req.action === 'submitComment');
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
// A SEPARATE file, safe to share with organizers: family, dates, headcount, prices - no codes, no raw data.
// Sharing a Google Sheet shares every tab, so this cannot be a tab of the registration file.
// It is refreshed after every save/cancel. Columns after the computed ones ("\u05e9\u05d5\u05dc\u05dd", "\u05d4\u05e2\u05e8\u05d5\u05ea \u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd",
// and anything organizers add further left) are theirs: the script never writes there, and a
// cancelled family keeps its row (status "\u05d1\u05d5\u05d8\u05dc") so a recorded payment is never lost.
var ORG_PROP = 'ORG_SHEET_ID';
var ORG_TABS = { families: '\u05de\u05e9\u05e4\u05d7\u05d5\u05ea', nights: '\u05dc\u05d9\u05dc\u05d5\u05ea', summary: '\u05e1\u05d9\u05db\u05d5\u05dd' };
var ORG_HEAD = ['\u05e9\u05dd \u05d4\u05de\u05e9\u05e4\u05d7\u05d4', '\u05e1\u05d8\u05d8\u05d5\u05e1', '\u05e2\u05d5\u05d3\u05db\u05df', '\u05ea\u05e7\u05d5\u05e4\u05d5\u05ea', '\u05dc\u05e0\u05d9\u05dd \u05dc\u05e4\u05d9 \u05dc\u05d9\u05dc\u05d4', '\u05de\u05d1\u05d5\u05d2\u05e8\u05d9\u05dd (14+)', '\u05d9\u05dc\u05d3\u05d9\u05dd (5 \u05e2\u05d3 13)',
                '\u05e4\u05e2\u05d5\u05d8\u05d5\u05ea (\u05e2\u05d3 5)', '\u05d4\u05e0\u05d7\u05d5\u05ea', '\u05de\u05d7\u05d9\u05e8 \u05de\u05dc\u05d0', '\u05de\u05d7\u05d9\u05e8 \u05e7\u05d1\u05d5\u05e6\u05ea\u05d9'];
var ORG_MANUAL = ['\u05e9\u05d5\u05dc\u05dd (\u20aa)', '\u05d4\u05e2\u05e8\u05d5\u05ea \u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd'];
var ADULT_KEYS = ['adult', 'matmonAdult', 'reserveAdult', 'soldier', 'student', 'senior', 'idfDisabled', 'escort'];
var CHILD_KEYS = ['child', 'matmonChild', 'reserveChild'];
var DISCOUNT_LABELS = { matmonAdult: '\u05de\u05d8\u05de\u05d5\u05df \u05de\u05d1\u05d5\u05d2\u05e8', matmonChild: '\u05de\u05d8\u05de\u05d5\u05df \u05d9\u05dc\u05d3', reserveAdult: '\u05de\u05d9\u05dc\u05d5\u05d0\u05d9\u05dd \u05de\u05d1\u05d5\u05d2\u05e8',
  reserveChild: '\u05de\u05d9\u05dc\u05d5\u05d0\u05d9\u05dd \u05d9\u05dc\u05d3', soldier: '\u05d7\u05d9\u05d9\u05dc/\u05ea', student: '\u05e1\u05d8\u05d5\u05d3\u05e0\u05d8/\u05d9\u05ea', senior: '\u05d0\u05d6\u05e8\u05d7/\u05d9\u05ea \u05d5\u05ea\u05d9\u05e7/\u05d4',
  idfDisabled: '\u05e0\u05db\u05d4 \u05e6\u05d4"\u05dc \u05d5\u05de\u05dc\u05d5\u05d5\u05d4', escort: '\u05de\u05dc\u05d5\u05d5\u05d4 \u05dc\u05d0\u05d3\u05dd \u05e2\u05dd \u05de\u05d5\u05d2\u05d1\u05dc\u05d5\u05ea' };
var WEEKDAYS_ = ['\u05d0\u05f3', '\u05d1\u05f3', '\u05d2\u05f3', '\u05d3\u05f3', '\u05d4\u05f3', '\u05d5\u05f3', '\u05e9\u05f3'];
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
    .map(function (k) { return DISCOUNT_LABELS[k] + ' \u00d7' + max[k]; }).join(', ');
  var per = periods.map(function (p) { return dmText_(p.from) + ' \u05e2\u05d3 ' + dmText_(p.to); }).join(' \u00b7 ') +
    (custom ? ' (\u05d4\u05d4\u05e8\u05db\u05d1 \u05de\u05e9\u05ea\u05e0\u05d4 \u05d1\u05d9\u05df \u05d4\u05ea\u05e7\u05d5\u05e4\u05d5\u05ea)' : '');
  var nights = Object.keys(row.nights || {}).sort()
    .map(function (k) { return dmText_(k) + ': ' + row.nights[k]; }).join(' \u00b7 ');
  return [row.family, '\u05e8\u05e9\u05d5\u05dd', row.updated, per, nights, sum(ADULT_KEYS), sum(CHILD_KEYS), max.toddler || 0,
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
    old[1] = '\u05d1\u05d5\u05d8\u05dc';
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
    return [nightLabel_(k), n, nightMap[k].families, n >= GROUP_MIN ? '\u05db\u05df' : '\u05d7\u05e1\u05e8\u05d9\u05dd ' + (GROUP_MIN - n)];
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
  ngt.getRange(1, 1, 1, 4).setValues([['\u05dc\u05d9\u05dc\u05d4', '\u05dc\u05e0\u05d9\u05dd', '\u05de\u05e9\u05e4\u05d7\u05d5\u05ea', '\u05de\u05d7\u05d9\u05e8 \u05e7\u05d1\u05d5\u05e6\u05ea\u05d9 (' + GROUP_MIN + '+)?']]).setFontWeight('bold');
  if (t.nights.length) ngt.getRange(2, 1, t.nights.length, 4).setValues(t.nights);

  var F = "'" + ORG_TABS.families + "'!";
  sum.clearContents();
  sum.getRange(1, 1, 6, 2).setValues([
    ['\u05de\u05e9\u05e4\u05d7\u05d5\u05ea \u05e8\u05e9\u05d5\u05de\u05d5\u05ea', '=COUNTIF(' + F + 'B2:B,"\u05e8\u05e9\u05d5\u05dd")'],
    ['\u05de\u05e9\u05e4\u05d7\u05d5\u05ea \u05e9\u05d1\u05d9\u05d8\u05dc\u05d5', '=COUNTIF(' + F + 'B2:B,"\u05d1\u05d5\u05d8\u05dc")'],
    ['\u05e1\u05d4"\u05db \u05de\u05d7\u05d9\u05e8 \u05de\u05dc\u05d0 (\u05e8\u05e9\u05d5\u05de\u05d9\u05dd)', '=SUMIF(' + F + 'B2:B,"\u05e8\u05e9\u05d5\u05dd",' + F + 'J2:J)'],
    ['\u05e1\u05d4"\u05db \u05de\u05d7\u05d9\u05e8 \u05e7\u05d1\u05d5\u05e6\u05ea\u05d9 (\u05e8\u05e9\u05d5\u05de\u05d9\u05dd)', '=SUMIF(' + F + 'B2:B,"\u05e8\u05e9\u05d5\u05dd",' + F + 'K2:K)'],
    ['\u05e1\u05d4"\u05db \u05e9\u05d5\u05dc\u05dd', '=SUM(' + F + 'L2:L)'],
    ['\u05e2\u05d5\u05d3\u05db\u05df \u05dc\u05d0\u05d7\u05e8\u05d5\u05e0\u05d4', Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm')]
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
  SpreadsheetApp.getUi().createMenu('\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd')
    .addItem('\u05d7\u05d9\u05d1\u05d5\u05e8 \u05dc\u05d2\u05d9\u05dc\u05d9\u05d5\u05df \u05d4\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd', 'connectOrganizers')
    .addItem('\u05e1\u05e0\u05db\u05e8\u05d5\u05df \u05e2\u05db\u05e9\u05d9\u05d5', 'syncNow')
    .addSeparator()
    .addItem('\u05d4\u05e4\u05e2\u05dc\u05ea \u05d4\u05ea\u05e8\u05d0\u05d5\u05ea', 'enableAlerts')
    .addToUi();
}
function connectOrganizers() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('\u05d7\u05d9\u05d1\u05d5\u05e8 \u05dc\u05d2\u05d9\u05dc\u05d9\u05d5\u05df \u05d4\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd', '\u05d4\u05d3\u05d1\u05d9\u05e7\u05d5 \u05d0\u05ea \u05d4\u05e7\u05d9\u05e9\u05d5\u05e8 \u05dc\u05d2\u05d9\u05dc\u05d9\u05d5\u05df \u05d4\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var m = /\/d\/([a-zA-Z0-9_-]{20,})/.exec(r.getResponseText()) || /^([a-zA-Z0-9_-]{20,})$/.exec(r.getResponseText().trim());
  if (!m) { ui.alert('\u05dc\u05d0 \u05d6\u05d9\u05d4\u05d9\u05ea\u05d9 \u05e7\u05d9\u05e9\u05d5\u05e8 \u05e9\u05dc Google Sheets.'); return; }
  PropertiesService.getScriptProperties().setProperty(ORG_PROP, m[1]);
  syncOrganizers_();
  ui.alert('\u05de\u05d7\u05d5\u05d1\u05e8. \u05d2\u05d9\u05dc\u05d9\u05d5\u05df \u05d4\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd \u05de\u05ea\u05e2\u05d3\u05db\u05df \u05d0\u05d7\u05e8\u05d9 \u05db\u05dc \u05d4\u05e8\u05e9\u05de\u05d4, \u05e2\u05d3\u05db\u05d5\u05df \u05d0\u05d5 \u05d1\u05d9\u05d8\u05d5\u05dc.');
}
function syncNow() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(syncOrganizers_() ? '\u05d2\u05d9\u05dc\u05d9\u05d5\u05df \u05d4\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd \u05e2\u05d5\u05d3\u05db\u05df.' : '\u05e2\u05d5\u05d3 \u05dc\u05d0 \u05d7\u05d5\u05d1\u05e8 \u05d2\u05d9\u05dc\u05d9\u05d5\u05df \u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd - \u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd \u2190 \u05d7\u05d9\u05d1\u05d5\u05e8 \u05dc\u05d2\u05d9\u05dc\u05d9\u05d5\u05df \u05d4\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd.');
}

// ---------- tips (docs/tips-plan.md) ----------
// Two tabs in this (private) sheet. Nothing is public until Yair sets its status to \u05de\u05d0\u05d5\u05e9\u05e8.
// Moderation is one cell: the status dropdown. For a near-duplicate: status \u05de\u05d5\u05d6\u05d2 + the existing tip's number
// in "\u05de\u05d5\u05d6\u05d2 \u05dc\u05d8\u05d9\u05e4" - the script then copies the text into a comment on that tip, so nothing is lost.
// Word search for tips - shared by the site and the backend.
// The site loads it with a <script> tag; backend/build.py inlines it into Code.gs at `//@include search.js`,
// so the backend's "\u05d3\u05d5\u05de\u05d4 \u05dc\u2026" column and the site's live "similar tips" panel agree.
//
// Word-based, not meaning-based: "\u05d0\u05d5\u05d4\u05dc" does not find "\u05d9\u05e8\u05d9\u05e2\u05d4". To stop Hebrew spelling from hiding
// matches it drops niqqud, treats final letters as regular ones, and tries each word without up to two
// prefix letters (\u05d4 \u05d5 \u05d1 \u05dc \u05de \u05e9 \u05db), so "\u05d5\u05d4\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd" still meets "\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd".

var SEARCH_FINALS_ = { '\u05da': '\u05db', '\u05dd': '\u05de', '\u05df': '\u05e0', '\u05e3': '\u05e4', '\u05e5': '\u05e6' };
var SEARCH_PREFIX_ = '\u05d4\u05d5\u05d1\u05dc\u05de\u05e9\u05db';
var SEARCH_STOP_ = ' \u05e9\u05dc \u05e2\u05dc \u05d0\u05ea \u05e2\u05dd \u05d6\u05d4 \u05d6\u05d5 \u05d2\u05dd \u05dc\u05d0 \u05db\u05d9 \u05d0\u05dd \u05d0\u05d5 \u05d9\u05e9 \u05d0\u05d9\u05df \u05d4\u05d5\u05d0 \u05d4\u05d9\u05d0 \u05d4\u05dd \u05d4\u05df \u05db\u05dc \u05de\u05d4 \u05e8\u05e7 \u05e2\u05d5\u05d3 \u05d0\u05d1\u05dc \u05d0\u05d6 \u05d0\u05e0\u05d9 \u05d0\u05e0\u05d7\u05e0\u05d5 \u05d0\u05ea\u05dd ' +
  '\u05dc\u05db\u05dd \u05dc\u05d4\u05dd \u05dc\u05e0\u05d5 \u05e9\u05dc\u05e0\u05d5 \u05e9\u05dc\u05db\u05dd \u05db\u05de\u05d5 \u05de\u05d0\u05d5\u05d3 \u05db\u05d3\u05d0\u05d9 \u05de\u05de\u05e9 \u05d9\u05d5\u05ea\u05e8 \u05e4\u05d7\u05d5\u05ea \u05d0\u05d7\u05e8\u05d9 \u05dc\u05e4\u05e0\u05d9 \u05d1\u05d9\u05df \u05ea\u05d5\u05da \u05e9\u05dd \u05e4\u05d4 \u05db\u05d0\u05df the and for with ';

// One word or phrase -> lower case, no niqqud, no final letters, letters and digits only.
function searchNorm_(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[\u0591-\u05c7]/g, '')
    .replace(/[\u05da\u05dd\u05df\u05e3\u05e5]/g, function (c) { return SEARCH_FINALS_[c]; })
    .replace(/[^0-9a-z\u05d0-\u05ea]+/g, ' ').trim();
}

// Text -> distinct meaningful words (stop words and one-letter words dropped).
// The stop list goes through the same normaliser, or "\u05e2\u05dd" (now "\u05e2\u05de") would slip through.
var searchStop_ = null;
function searchWords_(s) {
  var seen = {}, out = [];
  if (!searchStop_) searchStop_ = ' ' + searchNorm_(SEARCH_STOP_) + ' ';
  searchNorm_(s).split(' ').forEach(function (w) {
    if (w.length < 2 || seen[w] || searchStop_.indexOf(' ' + w + ' ') >= 0) return;
    seen[w] = true; out.push(w);
  });
  return out;
}

// A word and the same word without its prefix letters, as long as 3 letters remain.
// A second prefix only after \u05d5 or \u05e9, or when it is \u05d4 ("\u05d5\u05d4\u05d0\u05d5\u05d4\u05dc", "\u05e9\u05d1\u05d7\u05d5\u05e3", "\u05de\u05d4\u05d7\u05d5\u05e3") -
// otherwise "\u05d1\u05dc\u05d9\u05dc\u05d4" would lose the \u05dc of "\u05dc\u05d9\u05dc\u05d4" too.
function searchForms_(w) {
  var out = [w], p = SEARCH_PREFIX_;
  if (w.length > 3 && p.indexOf(w.charAt(0)) >= 0) {
    out.push(w.slice(1));
    if (w.length > 4 && p.indexOf(w.charAt(1)) >= 0 && ('\u05d5\u05e9'.indexOf(w.charAt(0)) >= 0 || w.charAt(1) === '\u05d4')) out.push(w.slice(2));
  }
  return out;
}

// Does query word q appear among the forms of the text words? A query form of 3+ letters also
// matches the start of a longer word, so the list narrows while the last word is still being typed.
function searchHit_(q, textForms) {
  var qf = searchForms_(q);
  for (var i = 0; i < qf.length; i++) {
    for (var j = 0; j < textForms.length; j++) {
      var t = textForms[j];
      if (t === qf[i] || (qf[i].length >= 3 && t.length > qf[i].length && t.indexOf(qf[i]) === 0)) return true;
    }
  }
  return false;
}

function searchFormsOf_(text) {
  var out = [];
  searchWords_(text).forEach(function (w) { out.push.apply(out, searchForms_(w)); });
  return out;
}

// Tips matching every word of the query (title, text and category), in their original order.
function searchTips_(query, tips) {
  var q = searchWords_(query);
  if (!q.length) return tips.slice();
  return tips.filter(function (t) {
    var forms = searchFormsOf_([t.title, t.text, t.category].join(' '));
    return q.every(function (w) { return searchHit_(w, forms); });
  });
}

// The n tips sharing the most words with a draft (title words count double).
// Returns [{tip, score}], best first; tips sharing nothing are left out.
function similarTips_(title, text, tips, n) {
  var tq = searchWords_(title), xq = searchWords_(text).filter(function (w) { return tq.indexOf(w) < 0; });
  if (!tq.length && !xq.length) return [];
  var scored = tips.map(function (t) {
    var forms = searchFormsOf_(t.title + ' ' + t.text), score = 0;
    tq.forEach(function (w) { if (searchHit_(w, forms)) score += 2; });
    xq.forEach(function (w) { if (searchHit_(w, forms)) score += 1; });
    return { tip: t, score: score };
  }).filter(function (s) { return s.score > 0; });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, n || 3);
}

var TIP_TABS = { tips: '\u05d8\u05d9\u05e4\u05d9\u05dd', comments: '\u05ea\u05d2\u05d5\u05d1\u05d5\u05ea' };
var TIP_HEAD = ['\u05de\u05e1\u05e4\u05e8', '\u05e1\u05d8\u05d8\u05d5\u05e1', '\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4', '\u05db\u05d5\u05ea\u05e8\u05ea', '\u05d8\u05e7\u05e1\u05d8', '\u05e9\u05dd (\u05dc\u05d0 \u05d7\u05d5\u05d1\u05d4)', '\u05e0\u05e9\u05dc\u05d7', '\u05d0\u05d5\u05e9\u05e8', '\u05de\u05d5\u05d6\u05d2 \u05dc\u05d8\u05d9\u05e4', '\u05d3\u05d5\u05de\u05d4 \u05dc\u2026', '\u05de\u05d6\u05d4\u05d4 \u05e9\u05dc\u05d9\u05d7\u05d4'];
var TIP_COL = { id: 0, status: 1, category: 2, title: 3, text: 4, author: 5, submitted: 6, approved: 7,
                mergedInto: 8, similar: 9, clientId: 10 };
var CMT_HEAD = ['\u05de\u05e1\u05e4\u05e8', '\u05d8\u05d9\u05e4', '\u05e1\u05d8\u05d8\u05d5\u05e1', '\u05d8\u05e7\u05e1\u05d8', '\u05e9\u05dd (\u05dc\u05d0 \u05d7\u05d5\u05d1\u05d4)', '\u05e0\u05e9\u05dc\u05d7', '\u05d0\u05d5\u05e9\u05e8', '\u05de\u05d6\u05d4\u05d4 \u05e9\u05dc\u05d9\u05d7\u05d4'];
var CMT_COL = { id: 0, tipId: 1, status: 2, text: 3, author: 4, submitted: 5, approved: 6, clientId: 7 };
var ST = { pending: '\u05de\u05de\u05ea\u05d9\u05df', approved: '\u05de\u05d0\u05d5\u05e9\u05e8', rejected: '\u05e0\u05d3\u05d7\u05d4', merged: '\u05de\u05d5\u05d6\u05d2', hidden: '\u05d4\u05d5\u05e1\u05ea\u05e8' };
var TIP_STATUSES = [ST.pending, ST.approved, ST.rejected, ST.merged, ST.hidden];
var CMT_STATUSES = [ST.pending, ST.approved, ST.rejected, ST.hidden];
var TIP_CATEGORIES = ['\u05e6\u05d9\u05d5\u05d3', '\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea',
                      '\u05d4\u05d2\u05e2\u05d4 \u05d5\u05d7\u05e0\u05d9\u05d4', '\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9 \u05d5\u05de\u05d7\u05e9\u05d1\u05d9\u05dd', '\u05d7\u05e9\u05de\u05dc \u05d5\u05ea\u05d0\u05d5\u05e8\u05d4', '\u05e9\u05d5\u05e0\u05d5\u05ea'];
var TIP_LIMITS = { title: 60, text: 400, comment: 300, author: 40 };
var MAX_PENDING = 200;          // tips + comments waiting, so the sheet cannot be flooded
var TIPS_CACHE = 'tips-v1';

// Free text for a cell: trimmed, at most one blank line in a row, formula-guarded. Too long is an error,
// never a silent cut - the site enforces the same limits, so only a hand-made request gets here.
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
  return ts.tips().filter(function (t) { return t.status === ST.pending; }).length +
         ts.comments().filter(function (c) { return c.status === ST.pending; }).length;
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

// After Yair edits a status: stamp the approval time, and carry out merges.
// Safe to run any number of times - a merge's comment carries the id "merge-<tip>", so it is made once.
function housekeep_(ts) {
  var done = { stamped: 0, merged: 0 };
  function stamp(rows, update) {
    rows.forEach(function (r) {
      if (r.status === ST.approved && !r.approved) { r.approved = ts.now(); update(r); done.stamped++; }
    });
  }
  stamp(ts.tips(), ts.updateTip);
  stamp(ts.comments(), ts.updateComment);
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
  var fresh = tips.some(function (t) { return +t.id > (seen.tip || 0); }) ||
              cmts.some(function (c) { return +c.id > (seen.comment || 0); });
  if (!fresh) return null;
  var titles = {};
  ts.tips().forEach(function (t) { titles[+t.id] = unguard_(t.title); });
  var lines = [];
  if (tips.length) {
    lines.push('\u05d8\u05d9\u05e4\u05d9\u05dd (' + tips.length + '):');
    tips.forEach(function (t) {
      lines.push('  ' + t.id + '. [' + t.category + '] ' + unguard_(t.title) + (t.similar ? '   (\u05d3\u05d5\u05de\u05d4 \u05dc\u05be' + t.similar + ')' : ''));
    });
  }
  if (cmts.length) {
    if (lines.length) lines.push('');
    lines.push('\u05ea\u05d2\u05d5\u05d1\u05d5\u05ea (' + cmts.length + '):');
    cmts.forEach(function (c) {
      var k = tipNumber_(c.tipId);
      lines.push('  ' + c.id + '. \u05e2\u05dc \u05d8\u05d9\u05e4 ' + k + ' (' + (titles[k] || '?') + '): ' + unguard_(c.text).slice(0, 80));
    });
  }
  lines.push('', '\u05dc\u05d0\u05d9\u05e9\u05d5\u05e8: \u05de\u05e9\u05e0\u05d9\u05dd \u05d0\u05ea \u05e2\u05de\u05d5\u05d3\u05ea "\u05e1\u05d8\u05d8\u05d5\u05e1" \u05dc"\u05de\u05d0\u05d5\u05e9\u05e8" (\u05d0\u05d5 \u05e0\u05d3\u05d7\u05d4 / \u05de\u05d5\u05d6\u05d2 / \u05d4\u05d5\u05e1\u05ea\u05e8).', sheetUrl || '');
  return { subject: '\u05d0\u05db\u05d6\u05d9\u05d1: ' + (tips.length + cmts.length) + ' \u05de\u05de\u05ea\u05d9\u05e0\u05d9\u05dd \u05dc\u05d0\u05d9\u05e9\u05d5\u05e8',
           body: lines.join('\n'), seen: { tip: nextId_(ts.tips()) - 1, comment: nextId_(ts.comments()) - 1 } };
}

// Simple trigger: runs on every hand edit of the sheet.
function onEdit(e) {
  var name = e && e.range ? e.range.getSheet().getName() : '';
  if (name !== TIP_TABS.tips && name !== TIP_TABS.comments) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;          // the next edit or digest run catches up
  try { housekeep_(tipsStore_()); } finally { lock.releaseLock(); }
  CacheService.getScriptCache().remove(TIPS_CACHE);
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
  CacheService.getScriptCache().remove(TIPS_CACHE);
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
  tipsStore_().tips();                       // make sure both tabs exist
  tipsStore_().comments();
  SpreadsheetApp.getUi().alert('\u05d4\u05ea\u05e8\u05d0\u05d5\u05ea \u05d4\u05d5\u05e4\u05e2\u05dc\u05d5: \u05db\u05dc \u05e9\u05e2\u05ea\u05d9\u05d9\u05dd, \u05d0\u05dd \u05d4\u05d2\u05d9\u05e2 \u05de\u05e9\u05d4\u05d5 \u05d7\u05d3\u05e9 \u05dc\u05d0\u05d9\u05e9\u05d5\u05e8, \u05d9\u05d9\u05e9\u05dc\u05d7 \u05d0\u05dc\u05d9\u05da \u05de\u05d9\u05d9\u05dc \u05d0\u05d7\u05d3 \u05e2\u05dd \u05db\u05dc \u05d4\u05de\u05de\u05ea\u05d9\u05e0\u05d9\u05dd.');
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
    return Object.keys(n || {}).sort().map(function (k) { return k.slice(8, 10) + '/' + k.slice(5, 7) + ': ' + n[k]; }).join(' \u00b7 ');
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
  var tipSh = null, cmtSh = null, tipRows = null, cmtRows = null;
  function tipSheet() {
    return tipSh || (tipSh = tab(TIP_TABS.tips, TIP_HEAD, [[TIP_COL.status, TIP_STATUSES], [TIP_COL.category, TIP_CATEGORIES]]));
  }
  function cmtSheet() { return cmtSh || (cmtSh = tab(TIP_TABS.comments, CMT_HEAD, [[CMT_COL.status, CMT_STATUSES]])); }
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
    now: function () { return new Date(); }       // a real date: the sheet shows it in its own (day-first) locale
  };
  return store;
}
