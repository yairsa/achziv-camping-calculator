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
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var res = route(req, sheetStore_());
    if (res.ok && (req.action === 'save' || req.action === 'delete')) {
      try { syncOrganizers_(); } catch (x) { /* the organizers' copy must never break a registration */ }
    }
    return json_(res);
  } finally { lock.releaseLock(); }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- pure logic (store is injected so it can be tested outside Google) ----------
function route(req, store) {
  try {
    switch (req && req.action) {
      case 'save': return save_(req, store);
      case 'load': return load_(req, store);
      case 'delete': return remove_(req, store);
      case 'summary': return summary_(store);
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
