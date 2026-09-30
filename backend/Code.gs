// GENERATED from Code.source.gs by backend/build.py - edit that file, not this one.
// Registration backend - Google Apps Script bound to the group's Google Sheet.
// Setup: see backend/SETUP.md. The site talks to this through the web-app URL in prices.js (apiUrl).
//
// EDIT THIS FILE, then run `python backend/build.py` to regenerate Code.gs - the copy you paste into
// Apps Script. Code.gs writes Hebrew as \u escapes because pasting Hebrew into the Apps Script editor
// reversed it (30/09/2026: the tab came out as "תומשרה").
//
// Actions (POST body is JSON, sent as text/plain to avoid a CORS preflight):
//   save    {user, pin, data, nights, maxPeople, full, group}          -> create, or update if the pin matches
//   load    {user, pin}                                                -> the saved calculator state
//   delete  {user, pin}                                                -> remove the entry
//   summary {}   (also GET)                                            -> names, families, people per night

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
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return json_(route(req, sheetStore_())); } finally { lock.releaseLock(); }
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
