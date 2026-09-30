// Registration backend - Google Apps Script bound to the group's Google Sheet.
// Setup: see backend/SETUP.md. The site talks to this through the web-app URL in prices.js (apiUrl).
//
// Actions (POST body is JSON, sent as text/plain to avoid a CORS preflight):
//   save    {user, pin, family, data, nights, maxPeople, full, group}  -> create, or update if the pin matches
//   load    {user, pin}                                                 -> the saved calculator state
//   delete  {user, pin}                                                 -> remove the entry
//   summary {}   (also GET)                                             -> families + people per night, no names

// Hebrew strings are written as \u escapes so the file is pure ASCII and survives any copy-paste.
// SHEET_NAME = 'Registrations'; HEAD = user, display name, updated, max people, people per night,
// full price, group price, data, pinHash, failed attempts.
var SHEET_NAME = '\u05d4\u05e8\u05e9\u05de\u05d5\u05ea';
var HEAD = ['\u05e9\u05dd \u05de\u05e9\u05ea\u05de\u05e9', '\u05e9\u05dd \u05dc\u05d4\u05e6\u05d2\u05d4', '\u05e2\u05d5\u05d3\u05db\u05df', '\u05dc\u05e0\u05d9\u05dd (\u05de\u05e7\u05e1\u05d9\u05de\u05d5\u05dd)', '\u05dc\u05e0\u05d9\u05dd \u05dc\u05e4\u05d9 \u05dc\u05d9\u05dc\u05d4', '\u05de\u05d7\u05d9\u05e8 \u05de\u05dc\u05d0', '\u05de\u05d7\u05d9\u05e8 \u05e7\u05d1\u05d5\u05e6\u05ea\u05d9',
            '\u05e0\u05ea\u05d5\u05e0\u05d9\u05dd', 'pinHash', '\u05e0\u05d9\u05e1\u05d9\u05d5\u05e0\u05d5\u05ea \u05db\u05d5\u05e9\u05dc\u05d9\u05dd'];
var MAX_FAILS = 5;

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
function safeCell_(s) { s = String(s == null ? '' : s).slice(0, 80); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function findRow_(store, user) {
  var rows = store.all();
  for (var i = 0; i < rows.length; i++) if (rows[i].user === user) return rows[i];
  return null;
}

// Wrong pin counts toward a lockout, so a 4-digit code cannot be guessed by brute force.
function verify_(store, row, pin) {
  if (row.fails >= MAX_FAILS) fail_('locked');
  if (row.pinHash !== store.hash(row.user, pin)) {
    row.fails += 1; store.put(row);
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
  else row = { user: user, pinHash: store.hash(user, String(req.pin)), fails: 0 };
  var nights = cleanNights_(req.nights);
  row.family = safeCell_(req.family || req.user);
  row.updated = store.now();
  row.maxPeople = Math.max(0, Math.floor(Number(req.maxPeople) || 0));
  row.nights = nights;
  row.full = Math.max(0, Number(req.full) || 0);
  row.group = Math.max(0, Number(req.group) || 0);
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
  return { ok: true, family: row.family, updated: row.updated, data: data };
}

function remove_(req, store) {
  var user = checkCreds_(req);
  var row = findRow_(store, user);
  if (!row) fail_('not_found');
  verify_(store, row, String(req.pin));
  store.remove(row);
  return { ok: true, summary: summary_(store) };
}

function summary_(store) {
  var nights = {}, families = 0;
  store.all().forEach(function (r) {
    if (!r.maxPeople) return;
    families++;
    Object.keys(r.nights || {}).forEach(function (k) { nights[k] = (nights[k] || 0) + r.nights[k]; });
  });
  return { ok: true, families: families, nights: nights };
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
  function parseNights(t) {
    var out = {};
    String(t || '').split(' \u00b7 ').forEach(function (p) {
      var m = /^(\d\d)\/(\d\d): (\d+)$/.exec(p);
      if (m) out['2026-' + m[2] + '-' + m[1]] = +m[3];
    });
    return out;
  }
  var cache = null;
  return {
    all: function () {
      if (cache) return cache;
      var v = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, HEAD.length).getValues() : [];
      cache = v.map(function (c, i) {
        var data = {};
        try { data = JSON.parse(c[7] || '{}'); } catch (x) { /* keep empty */ }
        return { _row: i + 2, user: String(c[0]), family: c[1], updated: c[2], maxPeople: +c[3] || 0,
                 nights: data.__nights || parseNights(c[4]), full: +c[5] || 0, group: +c[6] || 0,
                 data: c[7], pinHash: String(c[8]), fails: +c[9] || 0 };
      });
      return cache;
    },
    put: function (r) {
      // the per-night counts ride inside the JSON too, so a hand-edited text column cannot corrupt the sum
      var d = {}; try { d = JSON.parse(r.data || '{}'); } catch (x) { /* ignore */ }
      d.__nights = r.nights; r.data = JSON.stringify(d);
      var vals = [[r.user, r.family, r.updated, r.maxPeople, nightsText(r.nights), r.full, r.group, r.data, r.pinHash, r.fails]];
      if (!r._row) { sh.appendRow(vals[0]); r._row = sh.getLastRow(); this.all().push(r); }
      else sh.getRange(r._row, 1, 1, HEAD.length).setValues(vals);
    },
    remove: function (r) { sh.deleteRow(r._row); cache = null; },
    hash: function (user, pin) {
      return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + user + '|' + pin)
        .map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
    },
    now: function () { return Utilities.formatDate(new Date(), 'Asia/Jerusalem', 'dd/MM/yyyy HH:mm'); }
  };
}
