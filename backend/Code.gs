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
//   gear    {}                                                         -> the approved equipment list (cached)
//   tour    {}                                                         -> the guided tours' texts from the sheet (cached)
//   submitGear    {clientId, section, name, hp}                        -> a suggested item, pending (safe to repeat)
//   activities {}                                                      -> active activities with who joined (cached)
//   saveActivity   {user, pin, activity, clientId | id}                -> a new activity, or an edit by its family
//   deleteActivity {user, pin, id}                                     -> its family cancels it
//   join  {user, pin, id, count}  /  leave {user, pin, id}             -> set / clear this family's participants
//   (every activity write needs a registered family, and answers with the fresh list)

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
  var cacheKey = req && { tips: TIPS_CACHE, gear: GEAR_CACHE, activities: ACTS_CACHE, tour: TOUR_CACHE }[req.action];
  if (cacheKey) {                                     // public read: served from cache, no lock on a hit
    var hit = CacheService.getScriptCache().get(cacheKey);
    if (hit) return ContentService.createTextOutput(hit).setMimeType(ContentService.MimeType.JSON);
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (cacheKey) {
      var out = JSON.stringify(route(req, null, tipsStore_(), activitiesStore_()));
      try { CacheService.getScriptCache().put(cacheKey, out, 300); } catch (x) { /* too big to cache: still served */ }
      return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
    }
    var tipAction = req && (req.action === 'submitTip' || req.action === 'submitComment' || req.action === 'submitGear');
    var actAction = !!(req && ACT_WRITES[req.action]);
    var res = route(req, tipAction ? null : sheetStore_(), tipAction ? tipsStore_() : null, actAction ? activitiesStore_() : null);
    if (res.ok && actAction) CacheService.getScriptCache().remove(ACTS_CACHE);
    if (res.ok && (req.action === 'save' || req.action === 'delete' || actAction)) {
      try { syncOrganizers_(); } catch (x) { /* the organizers' copy must never break a registration */ }
    }
    return json_(res);
  } finally { lock.releaseLock(); }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- pure logic (store is injected so it can be tested outside Google) ----------
// store = registrations, tstore = tips, comments and gear, astore = activities.
function route(req, store, tstore, astore) {
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
      case 'tour': return tourPublic_(tstore);
      case 'submitGear': return submitGear_(req, tstore);
      case 'activities': return activitiesPublic_(astore);
      case 'saveActivity': return saveActivity_(req, store, astore);
      case 'deleteActivity': return deleteActivity_(req, store, astore);
      case 'join': return join_(req, store, astore);
      case 'leave': return leave_(req, store, astore);
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
var ORG_TABS = { families: '\u05de\u05e9\u05e4\u05d7\u05d5\u05ea', nights: '\u05dc\u05d9\u05dc\u05d5\u05ea', summary: '\u05e1\u05d9\u05db\u05d5\u05dd', acts: '\u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea' };
var ORG_ACT_HEAD = ['\u05de\u05ea\u05d9', '\u05e0\u05d5\u05e9\u05d0', '\u05de\u05e9\u05e4\u05d7\u05d4 \u05de\u05d0\u05e8\u05d2\u05e0\u05ea', '\u05de\u05e0\u05d7\u05d4', '\u05e7\u05d4\u05dc', '\u05de\u05e9\u05ea\u05ea\u05e4\u05d9\u05dd', '\u05de\u05e7\u05d5\u05de\u05d5\u05ea', '\u05de\u05d9 \u05d4\u05e6\u05d8\u05e8\u05e3'];
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

  var act = tab(ORG_TABS.acts), acts = organizerActivities_(activitiesPublic_(activitiesStore_()));
  act.clearContents();
  act.getRange(1, 1, 1, ORG_ACT_HEAD.length).setValues([ORG_ACT_HEAD]).setFontWeight('bold');
  if (acts.length) act.getRange(2, 1, acts.length, ORG_ACT_HEAD.length).setValues(acts);

  // drop the empty default tab a new spreadsheet comes with
  var ours = Object.keys(ORG_TABS).map(function (k) { return ORG_TABS[k]; });
  ss.getSheets().forEach(function (s) {
    if (ours.indexOf(s.getName()) < 0 && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
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
    .addSeparator()
    .addItem('\u05d4\u05d5\u05e1\u05e4\u05ea 3 \u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea \u05dc\u05d3\u05d5\u05d2\u05de\u05d4', 'addDemoActivities')
    .addToUi();
}
// Three example activities, one per audience, so families see what the tab is for. Safe to run twice
// (fixed client ids). Hide one by setting its status to \u05d4\u05d5\u05e1\u05ea\u05e8 in the \u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea tab.
function addDemoActivities() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  var n;
  try {
    n = addDemoActivities_(activitiesStore_());
    CacheService.getScriptCache().remove(ACTS_CACHE);
    try { syncOrganizers_(); } catch (x) { /* the organizers' copy must never block this */ }
  } finally { lock.releaseLock(); }
  SpreadsheetApp.getActiveSpreadsheet().toast(n ? '\u05e0\u05d5\u05e1\u05e4\u05d5 ' + n + ' \u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea \u05dc\u05d3\u05d5\u05d2\u05de\u05d4.' : '\u05d4\u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea \u05dc\u05d3\u05d5\u05d2\u05de\u05d4 \u05db\u05d1\u05e8 \u05e7\u05d9\u05d9\u05de\u05d5\u05ea.');
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
// Tab \u05e6\u05d9\u05d5\u05d3: the general list. Created with the starter list from gear-seed.js (item N = row id N, so a
// visitor's ticks made against the site's copy of the list still mean the same items).
// A visitor's own item arrives as a pending row; \u05de\u05d0\u05d5\u05e9\u05e8 adds it to everyone's list, \u05d4\u05d5\u05e1\u05ea\u05e8 takes any item off.
// Equipment list: sections and the starter list - shared by the site and the backend (docs/gear-plan.md).
// The site loads it with a <script> tag, so the list works at once, even before the server answers.
// backend/build.py inlines it into Code.gs at `//@include gear-seed.js`, and the script writes these rows
// into the sheet's \u05e6\u05d9\u05d5\u05d3 tab the first time it creates the tab. Item N here is row id N there, so the
// site's ticks mean the same thing before and after the sheet takes over.
// After that the sheet is the source: edit items there, not here (this file only seeds a new tab).
//
// Row: [section, item, tags (comma separated), note]. Tags: \u05d1\u05e1\u05d9\u05e1\u05d9 \u00b7 \u05d9\u05dc\u05d3\u05d9\u05dd \u00b7 \u05ea\u05d9\u05e0\u05d5\u05e7\u05d5\u05ea \u00b7 \u05e0\u05d5\u05d7\u05d5\u05ea.
// House rules this respects: no ropes between trees (no hammock), no music (no speaker), gas up to 10 kg,
// no glass, no electricity or generators.

var GEAR_SECTIONS_ = ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea',
                      '\u05d7\u05e9\u05de\u05dc \u05d5\u05ea\u05d0\u05d5\u05e8\u05d4', '\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9 \u05d5\u05de\u05d7\u05e9\u05d1\u05d9\u05dd', '\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05e9\u05d5\u05e0\u05d5\u05ea'];

var GEAR_SEED_ = [
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05d0\u05d5\u05d4\u05dc', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05d9\u05ea\u05d3\u05d5\u05ea \u05d0\u05e8\u05d5\u05db\u05d5\u05ea \u05dc\u05d7\u05d5\u05dc', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05d4\u05d9\u05ea\u05d3\u05d5\u05ea \u05d4\u05e8\u05d2\u05d9\u05dc\u05d5\u05ea \u05dc\u05d0 \u05de\u05d7\u05d6\u05d9\u05e7\u05d5\u05ea \u05d1\u05d7\u05d5\u05dc'],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05e4\u05d8\u05d9\u05e9 \u05d0\u05d5 \u05e7\u05d5\u05e8\u05e0\u05e1 \u05dc\u05d9\u05ea\u05d3\u05d5\u05ea', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05e9\u05e7 \u05e9\u05d9\u05e0\u05d4 \u05dc\u05db\u05dc \u05d0\u05d7\u05d3', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05de\u05d6\u05e8\u05df \u05dc\u05db\u05dc \u05d0\u05d7\u05d3', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05de\u05ea\u05e0\u05e4\u05d7 \u05e4\u05d7\u05d5\u05ea \u05de\u05d5\u05de\u05dc\u05e5. \u05d0\u05e4\u05e9\u05e8 \u05d2\u05dd \u05dc\u05e9\u05db\u05d5\u05e8 \u05d1\u05d7\u05e0\u05d9\u05d5\u05df, 12 \u20aa \u05dc\u05dc\u05d9\u05dc\u05d4, \u05dc\u05e4\u05d9 \u05d4\u05de\u05dc\u05d0\u05d9'],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05de\u05e9\u05d0\u05d1\u05d4 \u05dc\u05de\u05d6\u05e8\u05df \u05de\u05ea\u05e0\u05e4\u05d7', '', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05db\u05e8\u05d9\u05ea', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05e9\u05de\u05d9\u05db\u05d4 \u05d3\u05e7\u05d4', '', '\u05d4\u05dc\u05d9\u05dc\u05d5\u05ea \u05d1\u05d0\u05d5\u05e7\u05d8\u05d5\u05d1\u05e8 \u05d9\u05db\u05d5\u05dc\u05d9\u05dd \u05dc\u05d4\u05d9\u05d5\u05ea \u05e7\u05e8\u05d9\u05e8\u05d9\u05dd'],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05de\u05e6\u05e2\u05d9\u05dd (\u05e1\u05d3\u05d9\u05df, \u05e6\u05d9\u05e4\u05d9\u05ea)', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05d9\u05e8\u05d9\u05e2\u05ea \u05e7\u05e8\u05e7\u05e2 \u05de\u05ea\u05d7\u05ea \u05dc\u05d0\u05d5\u05d4\u05dc', '', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05d9\u05e8\u05d9\u05e2\u05ea \u05e6\u05dc \u05d0\u05d5 \u05d2\u05d6\u05d9\u05d1\u05d5', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05db\u05d9\u05e1\u05d0\u05d5\u05ea \u05de\u05ea\u05e7\u05e4\u05dc\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05e9\u05d5\u05dc\u05d7\u05df \u05de\u05ea\u05e7\u05e4\u05dc', '\u05e0\u05d5\u05d7\u05d5\u05ea', '\u05d9\u05e9 \u05d1\u05d7\u05e0\u05d9\u05d5\u05df 80 \u05e9\u05d5\u05dc\u05d7\u05e0\u05d5\u05ea \u05e4\u05d9\u05e7\u05e0\u05d9\u05e7'],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05e9\u05d8\u05d9\u05d7\u05d5\u05df \u05dc\u05db\u05e0\u05d9\u05e1\u05d4 \u05dc\u05d0\u05d5\u05d4\u05dc', '\u05e0\u05d5\u05d7\u05d5\u05ea', '\u05e4\u05d7\u05d5\u05ea \u05d7\u05d5\u05dc \u05d1\u05ea\u05d5\u05da \u05d4\u05d0\u05d5\u05d4\u05dc'],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05de\u05d8\u05d0\u05d8\u05d0 \u05e7\u05d8\u05df \u05d5\u05d9\u05e2\u05d4', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],

  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05d1\u05d2\u05d3\u05d9\u05dd \u05dc\u05d4\u05d7\u05dc\u05e4\u05d4 \u05dc\u05db\u05dc \u05d9\u05d5\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05d1\u05e7\u05de\u05e4\u05d9\u05e0\u05d2 \u05de\u05d7\u05dc\u05d9\u05e4\u05d9\u05dd \u05e4\u05d7\u05d5\u05ea \u05de\u05d1\u05d1\u05d9\u05ea'],
  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05d4\u05dc\u05d1\u05e9\u05d4 \u05ea\u05d7\u05ea\u05d5\u05e0\u05d4 \u05d5\u05d2\u05e8\u05d1\u05d9\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05e1\u05d5\u05d5\u05d8\u05e9\u05d9\u05e8\u05d8 \u05d0\u05d5 \u05de\u05e2\u05d9\u05dc \u05e7\u05dc \u05dc\u05e2\u05e8\u05d1', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05de\u05db\u05e0\u05e1\u05d9\u05d9\u05dd \u05d0\u05e8\u05d5\u05db\u05d9\u05dd', '', ''],
  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05e4\u05d9\u05d2\u05f3\u05de\u05d4', '', ''],
  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05db\u05d5\u05d1\u05e2', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05e1\u05e0\u05d3\u05dc\u05d9\u05dd \u05d0\u05d5 \u05db\u05e4\u05db\u05e4\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05e0\u05e2\u05dc\u05d9\u05d9\u05dd \u05e1\u05d2\u05d5\u05e8\u05d5\u05ea', '', '\u05dc\u05d8\u05d9\u05d5\u05dc\u05d9\u05dd \u05d1\u05d0\u05d6\u05d5\u05e8'],
  ['\u05d1\u05d9\u05d2\u05d5\u05d3', '\u05e9\u05e7\u05d9\u05ea \u05dc\u05db\u05d1\u05d9\u05e1\u05d4 \u05de\u05dc\u05d5\u05db\u05dc\u05db\u05ea', '', ''],

  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05db\u05d9\u05e8\u05ea \u05d2\u05d6 \u05d5\u05d1\u05dc\u05d5\u05df', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05d1\u05dc\u05d5\u05df \u05d2\u05d6 \u05e2\u05d3 10 \u05e7\u05f4\u05d2 \u05d1\u05dc\u05d1\u05d3'],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05de\u05e6\u05d9\u05ea \u05d0\u05d5 \u05d2\u05e4\u05e8\u05d5\u05e8\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e1\u05d9\u05e8 \u05d5\u05de\u05d7\u05d1\u05ea', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e4\u05d9\u05e0\u05d2\u05f3\u05d0\u05df \u05d0\u05d5 \u05e7\u05d5\u05de\u05e7\u05d5\u05dd \u05dc\u05e7\u05e4\u05d4', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e6\u05dc\u05d7\u05d5\u05ea, \u05db\u05d5\u05e1\u05d5\u05ea \u05d5\u05e1\u05db\u05d5\u05f4\u05dd \u05e8\u05d1-\u05e4\u05e2\u05de\u05d9\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05d1\u05dc\u05d9 \u05d6\u05db\u05d5\u05db\u05d9\u05ea - \u05d0\u05e1\u05d5\u05e8 \u05dc\u05d4\u05db\u05e0\u05d9\u05e1 \u05d6\u05db\u05d5\u05db\u05d9\u05ea'],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e7\u05e8\u05e9 \u05d7\u05d9\u05ea\u05d5\u05da \u05d5\u05e1\u05db\u05d9\u05df', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e6\u05d9\u05d3\u05e0\u05d9\u05ea \u05d5\u05e7\u05e8\u05d7\u05d5\u05e0\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05dc\u05d4\u05e7\u05e4\u05d9\u05d0 \u05de\u05e8\u05d0\u05e9 \u05e7\u05e8\u05d7\u05d5\u05e0\u05d9\u05dd \u05d5\u05d1\u05e7\u05d1\u05d5\u05e7\u05d9 \u05de\u05d9\u05dd. \u05d9\u05e9 \u05d1\u05d7\u05e0\u05d9\u05d5\u05df 3 \u05de\u05e7\u05e8\u05e8\u05d9\u05dd \u05d5-2 \u05de\u05e7\u05e4\u05d9\u05d0\u05d9\u05dd \u05de\u05e9\u05d5\u05ea\u05e4\u05d9\u05dd'],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05d1\u05e7\u05d1\u05d5\u05e7 \u05de\u05d9\u05dd \u05d0\u05d9\u05e9\u05d9', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05d9\u05e9 \u05d1\u05e8\u05d6\u05d9\u05d5\u05ea \u05de\u05d9\u05dd \u05dc\u05e9\u05ea\u05d9\u05d9\u05d4'],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05de\u05e0\u05d2\u05dc \u05d5\u05e4\u05d7\u05de\u05d9\u05dd', '\u05e0\u05d5\u05d7\u05d5\u05ea', '\u05de\u05e0\u05d2\u05dc \u05de\u05d5\u05ea\u05e8, \u05d1\u05e6\u05d9\u05d5\u05d3 \u05e2\u05e6\u05de\u05d9. \u05de\u05d3\u05d5\u05e8\u05d5\u05ea \u05d0\u05e1\u05d5\u05e8\u05d5\u05ea'],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05de\u05dc\u05e7\u05d7\u05d9\u05d9\u05dd \u05d5\u05e0\u05d9\u05d9\u05e8 \u05db\u05e1\u05e3', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e7\u05d5\u05e4\u05e1\u05d0\u05d5\u05ea \u05d0\u05d7\u05e1\u05d5\u05df \u05e2\u05dd \u05de\u05db\u05e1\u05d4', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e7\u05e4\u05d4, \u05ea\u05d4 \u05d5\u05e1\u05d5\u05db\u05e8', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e9\u05de\u05df, \u05de\u05dc\u05d7 \u05d5\u05ea\u05d1\u05dc\u05d9\u05e0\u05d9\u05dd', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e4\u05d5\u05ea\u05d7\u05df \u05e7\u05d5\u05e4\u05e1\u05d0\u05d5\u05ea', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05de\u05e9\u05e7\u05d0\u05d5\u05ea', '', '\u05d1\u05dc\u05d9 \u05d1\u05e7\u05d1\u05d5\u05e7\u05d9 \u05d6\u05db\u05d5\u05db\u05d9\u05ea'],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05d7\u05d8\u05d9\u05e4\u05d9\u05dd \u05d5\u05e4\u05d9\u05e6\u05d5\u05d7\u05d9\u05dd', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e1\u05d1\u05d5\u05df \u05db\u05dc\u05d9\u05dd \u05d5\u05e1\u05e4\u05d5\u05d2', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05d9\u05e9 \u05db\u05d9\u05d5\u05e8\u05d9\u05dd \u05dc\u05e9\u05d8\u05d9\u05e4\u05ea \u05db\u05dc\u05d9\u05dd'],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05de\u05d2\u05d1\u05ea \u05de\u05d8\u05d1\u05d7', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e9\u05e7\u05d9\u05d5\u05ea \u05d6\u05d1\u05dc', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],

  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05d1\u05d2\u05d3 \u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05de\u05d2\u05d1\u05ea \u05d7\u05d5\u05e3', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05e7\u05e8\u05dd \u05d4\u05d2\u05e0\u05d4', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05de\u05e9\u05e7\u05e4\u05d9 \u05e9\u05de\u05e9', '', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05e9\u05de\u05e9\u05d9\u05d9\u05d4', '\u05e0\u05d5\u05d7\u05d5\u05ea', '\u05d9\u05e9 2 \u05e1\u05db\u05db\u05d5\u05ea \u05e6\u05dc \u05d1\u05d7\u05d5\u05e3 \u05d4\u05e8\u05d7\u05e6\u05d4'],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05de\u05d7\u05e6\u05dc\u05ea \u05dc\u05d7\u05d5\u05e3', '', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05e0\u05e2\u05dc\u05d9 \u05d9\u05dd', '', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05de\u05e9\u05e7\u05e4\u05ea \u05e9\u05d7\u05d9\u05d9\u05d4 \u05d0\u05d5 \u05e9\u05e0\u05d5\u05e8\u05e7\u05dc', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05db\u05d3\u05d5\u05e8 \u05d0\u05d5 \u05de\u05d8\u05e7\u05d5\u05ea', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05ea\u05d9\u05e7 \u05d7\u05d5\u05e3', '', ''],

  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05de\u05d2\u05d1\u05ea \u05e8\u05d7\u05e6\u05d4', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05e9\u05de\u05e4\u05d5, \u05de\u05e8\u05db\u05da \u05d5\u05e1\u05d1\u05d5\u05df', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d7\u05de\u05d5\u05ea \u05de-18:00 \u05e2\u05d3 09:00'],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05de\u05d1\u05e8\u05e9\u05ea \u05d5\u05de\u05e9\u05d7\u05ea \u05e9\u05d9\u05e0\u05d9\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05db\u05e4\u05db\u05e4\u05d9\u05dd \u05dc\u05de\u05e7\u05dc\u05d7\u05ea', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05ea\u05d9\u05e7 \u05e8\u05d7\u05e6\u05d4', '', ''],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05d3\u05d0\u05d5\u05d3\u05d5\u05e8\u05e0\u05d8 \u05d5\u05de\u05e1\u05e8\u05e7', '', ''],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05de\u05d2\u05d1\u05d5\u05e0\u05d9\u05dd \u05dc\u05d7\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05e0\u05d9\u05d9\u05e8 \u05d8\u05d5\u05d0\u05dc\u05d8 \u05dc\u05d2\u05d9\u05d1\u05d5\u05d9', '', ''],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05de\u05d5\u05e6\u05e8\u05d9 \u05d4\u05d9\u05d2\u05d9\u05d9\u05e0\u05d4 \u05e0\u05e9\u05d9\u05ea', '', ''],

  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05e4\u05e0\u05e1 \u05e8\u05d0\u05e9 \u05dc\u05db\u05dc \u05d9\u05dc\u05d3', '\u05d9\u05dc\u05d3\u05d9\u05dd', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05d1\u05d2\u05d3\u05d9\u05dd \u05e0\u05d5\u05e1\u05e4\u05d9\u05dd \u05dc\u05d4\u05d7\u05dc\u05e4\u05d4', '\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05d7\u05d5\u05dc \u05d5\u05de\u05d9\u05dd - \u05de\u05ea\u05dc\u05db\u05dc\u05db\u05d9\u05dd \u05de\u05d4\u05e8'],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05db\u05d5\u05d1\u05e2 \u05dc\u05db\u05dc \u05d9\u05dc\u05d3', '\u05d9\u05dc\u05d3\u05d9\u05dd', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05e6\u05e2\u05e6\u05d5\u05e2\u05d9 \u05d7\u05d5\u05dc', '\u05d9\u05dc\u05d3\u05d9\u05dd', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05d2\u05dc\u05d2\u05dc \u05d9\u05dd \u05d0\u05d5 \u05de\u05e6\u05d5\u05e4\u05d9\u05dd', '\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05e8\u05d7\u05e6\u05d4 \u05e8\u05e7 \u05d1\u05d7\u05d5\u05e3 \u05d4\u05de\u05d5\u05db\u05e8\u05d6 \u05d5\u05d1\u05e9\u05e2\u05d5\u05ea \u05d4\u05d4\u05e6\u05dc\u05d4'],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05de\u05e9\u05d7\u05e7\u05d9 \u05e7\u05d5\u05e4\u05e1\u05d4 \u05d5\u05e7\u05dc\u05e4\u05d9\u05dd', '\u05d9\u05dc\u05d3\u05d9\u05dd,\u05e0\u05d5\u05d7\u05d5\u05ea', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05d1\u05d5\u05d1\u05d4 \u05d0\u05d5 \u05d7\u05e4\u05e5 \u05de\u05e2\u05d1\u05e8 \u05dc\u05e9\u05d9\u05e0\u05d4', '\u05d9\u05dc\u05d3\u05d9\u05dd', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05e1\u05d9\u05e8 \u05dc\u05d9\u05dc\u05d4', '\u05d9\u05dc\u05d3\u05d9\u05dd', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05e2\u05d2\u05dc\u05d4 \u05d0\u05d5 \u05de\u05e0\u05e9\u05d0', '\u05ea\u05d9\u05e0\u05d5\u05e7\u05d5\u05ea', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05d7\u05d9\u05ea\u05d5\u05dc\u05d9\u05dd \u05d5\u05de\u05d2\u05d1\u05d5\u05e0\u05d9\u05dd', '\u05ea\u05d9\u05e0\u05d5\u05e7\u05d5\u05ea', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05de\u05d9\u05d8\u05ea \u05ea\u05d9\u05e0\u05d5\u05e7 \u05de\u05ea\u05e7\u05e4\u05dc\u05ea', '\u05ea\u05d9\u05e0\u05d5\u05e7\u05d5\u05ea', ''],
  ['\u05d9\u05dc\u05d3\u05d9\u05dd', '\u05d1\u05e7\u05d1\u05d5\u05e7\u05d9\u05dd, \u05de\u05d5\u05e6\u05e5 \u05d5\u05d0\u05d5\u05db\u05dc \u05dc\u05ea\u05d9\u05e0\u05d5\u05e7', '\u05ea\u05d9\u05e0\u05d5\u05e7\u05d5\u05ea', ''],

  ['\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea', '\u05e2\u05e8\u05db\u05ea \u05e2\u05d6\u05e8\u05d4 \u05e8\u05d0\u05e9\u05d5\u05e0\u05d4', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05e4\u05dc\u05e1\u05d8\u05e8\u05d9\u05dd, \u05d7\u05d9\u05d8\u05d5\u05d9, \u05ea\u05d7\u05d1\u05d5\u05e9\u05ea, \u05e4\u05d9\u05e0\u05e6\u05d8\u05d4, \u05de\u05e1\u05e4\u05e8\u05d9\u05d9\u05dd'],
  ['\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea', '\u05ea\u05e8\u05d5\u05e4\u05d5\u05ea', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05e7\u05d1\u05d5\u05e2\u05d5\u05ea, \u05d5\u05dc\u05e4\u05d9 \u05d4\u05e6\u05d5\u05e8\u05da: \u05de\u05e9\u05db\u05da \u05db\u05d0\u05d1\u05d9\u05dd, \u05de\u05d5\u05e8\u05d9\u05d3 \u05d7\u05d5\u05dd'],
  ['\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea', '\u05e6\u05d9\u05d5\u05d3 \u05e8\u05e4\u05d5\u05d0\u05d9 \u05d0\u05d9\u05e9\u05d9', '', '\u05dc\u05de\u05e9\u05dc \u05de\u05d3 \u05e1\u05d5\u05db\u05e8 \u05d0\u05d5 \u05de\u05e9\u05d0\u05e3'],
  ['\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea', '\u05d3\u05d5\u05d7\u05d4 \u05d9\u05ea\u05d5\u05e9\u05d9\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea', '\u05de\u05e9\u05d7\u05d4 \u05dc\u05e2\u05e7\u05d9\u05e6\u05d5\u05ea \u05d5\u05d0\u05e0\u05d8\u05d9-\u05d4\u05d9\u05e1\u05d8\u05de\u05d9\u05df', '', ''],
  ['\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea', '\u05e4\u05dc\u05e1\u05d8\u05e8\u05d9\u05dd', '', ''],
  ['\u05d1\u05d8\u05d9\u05d7\u05d5\u05ea', '\u05db\u05e4\u05e4\u05d5\u05ea \u05e2\u05d1\u05d5\u05d3\u05d4 \u05dc\u05de\u05e0\u05d2\u05dc', '', ''],

  ['\u05d7\u05e9\u05de\u05dc \u05d5\u05ea\u05d0\u05d5\u05e8\u05d4', '\u05e4\u05e0\u05e1 \u05e8\u05d0\u05e9', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05d7\u05e9\u05de\u05dc \u05d5\u05ea\u05d0\u05d5\u05e8\u05d4', '\u05e4\u05e0\u05e1 \u05d0\u05d5 \u05e2\u05e9\u05e9\u05d9\u05ea \u05dc\u05d0\u05d5\u05d4\u05dc', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05d0\u05d9\u05df \u05d7\u05e9\u05de\u05dc \u05d1\u05d7\u05e0\u05d9\u05d5\u05df, \u05d5\u05d2\u05e0\u05e8\u05d8\u05d5\u05e8\u05d9\u05dd \u05d0\u05e1\u05d5\u05e8\u05d9\u05dd'],
  ['\u05d7\u05e9\u05de\u05dc \u05d5\u05ea\u05d0\u05d5\u05e8\u05d4', '\u05e1\u05d5\u05dc\u05dc\u05d5\u05ea \u05e8\u05d6\u05e8\u05d1\u05d9\u05d5\u05ea', '', ''],
  ['\u05d7\u05e9\u05de\u05dc \u05d5\u05ea\u05d0\u05d5\u05e8\u05d4', '\u05e9\u05e8\u05e9\u05e8\u05ea \u05d0\u05d5\u05e8\u05d5\u05ea \u05e2\u05dc \u05e1\u05d5\u05dc\u05dc\u05d5\u05ea', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],

  ['\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9 \u05d5\u05de\u05d7\u05e9\u05d1\u05d9\u05dd', '\u05de\u05d8\u05e2\u05df \u05d5\u05db\u05d1\u05dc \u05dc\u05d8\u05dc\u05e4\u05d5\u05df', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05d9\u05e9 \u05d1\u05d7\u05e0\u05d9\u05d5\u05df 20 \u05e0\u05e7\u05d5\u05d3\u05d5\u05ea \u05d8\u05e2\u05d9\u05e0\u05d4'],
  ['\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9 \u05d5\u05de\u05d7\u05e9\u05d1\u05d9\u05dd', '\u05e1\u05d5\u05dc\u05dc\u05d4 \u05e0\u05d9\u05d9\u05d3\u05ea (\u05e4\u05d0\u05d5\u05d5\u05e8 \u05d1\u05e0\u05e7)', '\u05d1\u05e1\u05d9\u05e1\u05d9', ''],
  ['\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9 \u05d5\u05de\u05d7\u05e9\u05d1\u05d9\u05dd', '\u05de\u05d8\u05e2\u05df \u05dc\u05e8\u05db\u05d1', '', ''],
  ['\u05e1\u05dc\u05d5\u05dc\u05e8\u05d9 \u05d5\u05de\u05d7\u05e9\u05d1\u05d9\u05dd', '\u05d0\u05d5\u05d6\u05e0\u05d9\u05d5\u05ea', '\u05e0\u05d5\u05d7\u05d5\u05ea', '\u05d0\u05e1\u05d5\u05e8 \u05dc\u05d4\u05e9\u05de\u05d9\u05e2 \u05de\u05d5\u05d6\u05d9\u05e7\u05d4 \u05d1\u05d7\u05e0\u05d9\u05d5\u05df'],

  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05e2\u05d2\u05dc\u05d4 \u05dc\u05d4\u05d5\u05d1\u05dc\u05ea \u05e6\u05d9\u05d5\u05d3', '\u05e0\u05d5\u05d7\u05d5\u05ea', '\u05d0\u05e4\u05e9\u05e8 \u05dc\u05e7\u05d1\u05dc \u05e2\u05d2\u05dc\u05d4 \u05d1\u05d7\u05e0\u05d9\u05d5\u05df \u05d1\u05d4\u05e4\u05e7\u05d3\u05ea \u05ea\u05e2\u05d5\u05d3\u05d4 \u05de\u05d6\u05d4\u05d4'],
  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05d0\u05e8\u05d2\u05d6\u05d9\u05dd \u05d0\u05d5 \u05ea\u05d9\u05e7\u05d9\u05dd \u05dc\u05d0\u05e8\u05d9\u05d6\u05d4', '', ''],
  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05e9\u05e7\u05d9\u05d5\u05ea \u05d0\u05d8\u05d5\u05de\u05d5\u05ea \u05dc\u05d1\u05d2\u05d3\u05d9\u05dd \u05e8\u05d8\u05d5\u05d1\u05d9\u05dd', '', ''],
  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05de\u05ea\u05e7\u05df \u05d9\u05d9\u05d1\u05d5\u05e9 \u05de\u05ea\u05e7\u05e4\u05dc \u05d5\u05d0\u05d8\u05d1\u05d9\u05dd', '\u05e0\u05d5\u05d7\u05d5\u05ea', '\u05d0\u05e1\u05d5\u05e8 \u05dc\u05e7\u05e9\u05d5\u05e8 \u05d7\u05d1\u05dc\u05d9\u05dd \u05d1\u05d9\u05df \u05d4\u05e2\u05e6\u05d9\u05dd'],
  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05e1\u05db\u05d9\u05df \u05e8\u05d1-\u05ea\u05db\u05dc\u05d9\u05ea\u05d9', '', ''],
  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05e1\u05e8\u05d8 \u05d4\u05d3\u05d1\u05e7\u05d4 \u05d5\u05d0\u05d6\u05d9\u05e7\u05d5\u05e0\u05d9\u05dd', '', ''],
  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05ea\u05d9\u05e7 \u05d2\u05d1 \u05e7\u05d8\u05df \u05dc\u05d8\u05d9\u05d5\u05dc\u05d9\u05dd', '', ''],

  ['\u05e9\u05d5\u05e0\u05d5\u05ea', '\u05ea\u05e2\u05d5\u05d3\u05d4 \u05de\u05d6\u05d4\u05d4', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05de\u05e4\u05e7\u05d9\u05d3\u05d9\u05dd \u05d1\u05d4\u05d2\u05e2\u05d4 \u05dc\u05d7\u05e0\u05d9\u05d5\u05df'],
  ['\u05e9\u05d5\u05e0\u05d5\u05ea', '\u05db\u05e8\u05d8\u05d9\u05e1\u05d9 \u05d4\u05e0\u05d7\u05d4 \u05d1\u05ea\u05d5\u05e7\u05e3', '', '\u05de\u05d8\u05de\u05d5\u05df, \u05de\u05d9\u05dc\u05d5\u05d0\u05d9\u05dd, \u05e1\u05d8\u05d5\u05d3\u05e0\u05d8, \u05d0\u05d6\u05e8\u05d7 \u05d5\u05ea\u05d9\u05e7 - \u05d1\u05d4\u05e6\u05d2\u05ea \u05db\u05e8\u05d8\u05d9\u05e1'],
  ['\u05e9\u05d5\u05e0\u05d5\u05ea', '\u05d0\u05de\u05e6\u05e2\u05d9 \u05ea\u05e9\u05dc\u05d5\u05dd', '\u05d1\u05e1\u05d9\u05e1\u05d9', '\u05de\u05e9\u05dc\u05de\u05d9\u05dd \u05d1\u05e7\u05d5\u05e4\u05d4 \u05d1\u05d4\u05d2\u05e2\u05d4'],
  ['\u05e9\u05d5\u05e0\u05d5\u05ea', '\u05de\u05e9\u05e7\u05e4\u05d9 \u05e8\u05d0\u05d9\u05d9\u05d4 \u05d0\u05d5 \u05e2\u05d3\u05e9\u05d5\u05ea', '', ''],
  ['\u05e9\u05d5\u05e0\u05d5\u05ea', '\u05e1\u05e4\u05e8', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],

  // Added 30/09/2026 from Yair's own camping list, made general. Appended, never inserted: item N is row
  // id N, and the site has been live with ids 1-101, so a visitor's ticks must keep their meaning.
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05de\u05d7\u05e6\u05dc\u05ea \u05dc\u05d9\u05e9\u05d9\u05d1\u05d4 \u05dc\u05d9\u05d3 \u05d4\u05d0\u05d5\u05d4\u05dc', '', ''],
  ['\u05d0\u05d5\u05d4\u05dc\u05d9\u05dd \u05d5\u05dc\u05d9\u05e0\u05d4', '\u05d7\u05d1\u05dc\u05d9\u05dd \u05dc\u05d9\u05e8\u05d9\u05e2\u05ea \u05d4\u05e6\u05dc', '', '\u05e7\u05d5\u05e9\u05e8\u05d9\u05dd \u05dc\u05d9\u05ea\u05d3\u05d5\u05ea. \u05d0\u05e1\u05d5\u05e8 \u05dc\u05e7\u05e9\u05d5\u05e8 \u05d7\u05d1\u05dc\u05d9\u05dd \u05dc\u05e2\u05e6\u05d9\u05dd'],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05db\u05dc\u05d9 \u05e2\u05d6\u05e8 \u05dc\u05d1\u05d9\u05e9\u05d5\u05dc (\u05de\u05e6\u05e7\u05ea, \u05db\u05e3 \u05e2\u05e5, \u05e7\u05e2\u05e8\u05d4)', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05d2\u05d9\u05d2\u05d9\u05ea \u05dc\u05e9\u05d8\u05d9\u05e4\u05ea \u05db\u05dc\u05d9\u05dd', '\u05e0\u05d5\u05d7\u05d5\u05ea', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05de\u05d2\u05d1\u05d5\u05ea \u05e0\u05d9\u05d9\u05e8', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05de\u05e6\u05e8\u05db\u05d9\u05dd \u05d9\u05d1\u05e9\u05d9\u05dd (\u05e4\u05e1\u05d8\u05d4, \u05d0\u05d5\u05e8\u05d6, \u05e7\u05d8\u05e0\u05d9\u05d5\u05ea)', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05e9\u05d9\u05de\u05d5\u05e8\u05d9\u05dd', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05d9\u05e8\u05e7\u05d5\u05ea \u05d5\u05e4\u05d9\u05e8\u05d5\u05ea', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05dc\u05d7\u05dd, \u05e7\u05e8\u05e7\u05e8\u05d9\u05dd \u05d5\u05de\u05de\u05e8\u05d7\u05d9\u05dd', '', ''],
  ['\u05d0\u05d5\u05db\u05dc \u05d5\u05d1\u05d9\u05e9\u05d5\u05dc', '\u05d0\u05e8\u05d5\u05d7\u05d5\u05ea \u05d1\u05d5\u05e7\u05e8 (\u05d9\u05d5\u05d2\u05d5\u05e8\u05d8, \u05d2\u05e8\u05e0\u05d5\u05dc\u05d4, \u05d3\u05d9\u05d9\u05e1\u05d4)', '', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05de\u05e9\u05d7\u05e7\u05d9 \u05de\u05d9\u05dd', '\u05d9\u05dc\u05d3\u05d9\u05dd', ''],
  ['\u05d9\u05dd \u05d5\u05d7\u05d5\u05e3', '\u05d7\u05d9\u05ea\u05d5\u05dc\u05d9 \u05d9\u05dd', '\u05ea\u05d9\u05e0\u05d5\u05e7\u05d5\u05ea', ''],
  ['\u05de\u05e7\u05dc\u05d7\u05d5\u05ea \u05d5\u05e9\u05d9\u05e8\u05d5\u05ea\u05d9\u05dd', '\u05d2\u05d5\u05de\u05d9\u05d5\u05ea \u05d5\u05e7\u05dc\u05d9\u05e4\u05e1\u05d9\u05dd \u05dc\u05e9\u05d9\u05e2\u05e8', '', ''],
  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05e1\u05d1\u05d5\u05df \u05db\u05d1\u05d9\u05e1\u05d4', '', ''],
  ['\u05e6\u05d9\u05d5\u05d3 \u05db\u05dc\u05dc\u05d9', '\u05de\u05e9\u05d0\u05d1\u05d4 \u05dc\u05e6\u05de\u05d9\u05d2\u05d9 \u05d4\u05e8\u05db\u05d1', '', ''],
  ['\u05e9\u05d5\u05e0\u05d5\u05ea', '\u05e8\u05d9\u05e9\u05d9\u05d5\u05df \u05e0\u05d4\u05d9\u05d2\u05d4', '\u05d1\u05e1\u05d9\u05e1\u05d9', '']
];

var GEAR_TAB = '\u05e6\u05d9\u05d5\u05d3';
var GEAR_HEAD = ['\u05de\u05e1\u05e4\u05e8', '\u05e1\u05d8\u05d8\u05d5\u05e1', '\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4', '\u05e4\u05e8\u05d9\u05d8', '\u05ea\u05d2\u05d9\u05d5\u05ea', '\u05d4\u05e2\u05e8\u05d4', '\u05e0\u05e9\u05dc\u05d7', '\u05d0\u05d5\u05e9\u05e8', '\u05de\u05d6\u05d4\u05d4 \u05e9\u05dc\u05d9\u05d7\u05d4'];
var GEAR_COL = { id: 0, status: 1, section: 2, name: 3, tags: 4, note: 5, submitted: 6, approved: 7, clientId: 8 };
var GEAR_STATUSES = [ST.pending, ST.approved, ST.rejected, ST.hidden];
var GEAR_NAME_MAX = 60;
var GEAR_CACHE = 'gear-v1';

// A store without gear (older test mocks) reads as an empty tab.
function gearRows_(ts) { return ts.gear ? ts.gear() : []; }

// The starter rows, as written into a new tab. "\u05d0\u05d5\u05e9\u05e8" carries a label, not a date, so they are not
// re-stamped one by one on the first edit.
function gearSeedRows_() {
  return GEAR_SEED_.map(function (g, i) {
    return [i + 1, ST.approved, g[0], g[1], g[2], g[3], '', '\u05e8\u05e9\u05d9\u05de\u05d4 \u05d4\u05ea\u05d7\u05dc\u05ea\u05d9\u05ea', 'seed-' + (i + 1)];
  });
}

// Public: approved items in sheet order. Only these fields leave the sheet.
function gearPublic_(ts) {
  var sections = GEAR_SECTIONS_.slice();
  var items = gearRows_(ts).filter(function (g) { return g.status === ST.approved && String(g.name) !== ''; })
    .map(function (g) {
      var section = String(g.section) || '\u05e9\u05d5\u05e0\u05d5\u05ea';
      if (sections.indexOf(section) < 0) sections.push(section);
      return { id: +g.id, section: section, name: unguard_(g.name),
               tags: String(g.tags || '').split(/[,\u060c]/).map(function (t) { return t.trim(); }).filter(Boolean),
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
  if (gear.length) {
    if (lines.length) lines.push('');
    lines.push('\u05e4\u05e8\u05d9\u05d8\u05d9 \u05e6\u05d9\u05d5\u05d3 \u05e9\u05d4\u05d5\u05e6\u05e2\u05d5 (' + gear.length + '):');
    gear.forEach(function (g) { lines.push('  ' + g.id + '. [' + g.section + '] ' + unguard_(g.name)); });
    lines.push('  (\u05d1\u05dc\u05e9\u05d5\u05e0\u05d9\u05ea ' + GEAR_TAB + ': \u05d0\u05e4\u05e9\u05e8 \u05dc\u05ea\u05e7\u05df \u05d0\u05ea \u05d4\u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4 \u05dc\u05e4\u05e0\u05d9 \u05d4\u05d0\u05d9\u05e9\u05d5\u05e8)');
  }
  lines.push('', '\u05dc\u05d0\u05d9\u05e9\u05d5\u05e8: \u05de\u05e9\u05e0\u05d9\u05dd \u05d0\u05ea \u05e2\u05de\u05d5\u05d3\u05ea "\u05e1\u05d8\u05d8\u05d5\u05e1" \u05dc"\u05de\u05d0\u05d5\u05e9\u05e8" (\u05d0\u05d5 \u05e0\u05d3\u05d7\u05d4 / \u05de\u05d5\u05d6\u05d2 / \u05d4\u05d5\u05e1\u05ea\u05e8).', sheetUrl || '');
  return { subject: '\u05d0\u05db\u05d6\u05d9\u05d1: ' + (tips.length + cmts.length + gear.length) + ' \u05de\u05de\u05ea\u05d9\u05e0\u05d9\u05dd \u05dc\u05d0\u05d9\u05e9\u05d5\u05e8',
           body: lines.join('\n'),
           seen: { tip: nextId_(ts.tips()) - 1, comment: nextId_(ts.comments()) - 1, gear: nextId_(gearRows_(ts)) - 1 } };
}

// ---------- guided tour texts (docs/tour-plan.md \u00a75) ----------
// Tab \u05d4\u05d3\u05e8\u05db\u05d4: one row per tour bubble, created with the site's own texts from tour-texts.js. Yair edits \u05db\u05d5\u05ea\u05e8\u05ea
// and \u05d8\u05e7\u05e1\u05d8; \u05de\u05e4\u05ea\u05d7 ties the row to its step in tour.js. The site keeps its built-in text for an empty cell and
// ignores a row whose tour or key it does not know, so a cleared cell never leaves an empty bubble.
// Guided tour texts: every bubble's title and text - shared by the site and the backend (docs/tour-plan.md \u00a75).
// The site loads it with a <script> tag, so a tour shows its text at once, even before the server answers.
// backend/build.py inlines it into Code.gs at `//@include tour-texts.js`, and the script writes these rows into
// the sheet's \u05d4\u05d3\u05e8\u05db\u05d4 tab the first time it creates the tab. After that Yair edits \u05db\u05d5\u05ea\u05e8\u05ea and \u05d8\u05e7\u05e1\u05d8 there; a cell left
// empty falls back to the text here. `key` ties a row to its step in tour.js (where the arrow points stays code).
//
// Text format: plain text. A blank line starts a new paragraph, **...** is bold. No HTML: tour.js escapes it.

// The name each tour carries in the sheet's \u05e1\u05d9\u05d5\u05e8 column.
var TOUR_NAMES_ = { welcome: '\u05e4\u05ea\u05d9\u05d7\u05d4', gear: '\u05e6\u05d9\u05d5\u05d3', acts: '\u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea', tips: '\u05d8\u05d9\u05e4\u05d9\u05dd' };

// Built-in texts that were replaced here after a sheet was created with them. A sheet cell still holding one was
// never edited, so the script moves it to the current text. Key: tour/key.
var TOUR_RETIRED_ = {
  'welcome/share': ['\u05de\u05db\u05d9\u05e8\u05d9\u05dd \u05e2\u05d5\u05d3 \u05de\u05e9\u05e4\u05d7\u05d5\u05ea \u05de\u05d4\u05e7\u05d1\u05d5\u05e6\u05d4? \u05e9\u05dc\u05d7\u05d5 \u05dc\u05d4\u05df \u05d0\u05ea \u05d4\u05d0\u05ea\u05e8. \u05d4\u05e1\u05d9\u05d5\u05e8 \u05d4\u05d6\u05d4 \u05d7\u05d5\u05d6\u05e8 \u05d1\u05db\u05dc \u05d6\u05de\u05df \u05d1\u05db\u05e4\u05ea\u05d5\u05e8 ?.']
};

var TOUR_TEXTS_ = [
  { tour: 'welcome', key: 'hello', title: '\u05d1\u05e8\u05d5\u05db\u05d9\u05dd \u05d4\u05d1\u05d0\u05d9\u05dd!',
    text: '\u05d4\u05d0\u05ea\u05e8 \u05e2\u05d5\u05d6\u05e8 \u05dc\u05e7\u05d1\u05d5\u05e6\u05d4 \u05dc\u05d4\u05ea\u05d0\u05e8\u05d2\u05df \u05dc\u05e7\u05de\u05e4\u05d9\u05e0\u05d2 \u05d1\u05d0\u05db\u05d6\u05d9\u05d1: \u05d7\u05d9\u05e9\u05d5\u05d1 \u05e2\u05dc\u05d5\u05ea \u05d4\u05dc\u05d9\u05e0\u05d4, \u05de\u05d9\u05d3\u05e2 \u05e2\u05dc \u05d4\u05de\u05e7\u05d5\u05dd, ' +
      '\u05e8\u05e9\u05d9\u05de\u05ea \u05e6\u05d9\u05d5\u05d3, \u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea \u05d5\u05d8\u05d9\u05e4\u05d9\u05dd. \u05e1\u05d9\u05d5\u05e8 \u05e7\u05e6\u05e8, \u05e4\u05d7\u05d5\u05ea \u05de\u05d3\u05e7\u05d4.\n\n' +
      '**\u05dc\u05d9\u05d3\u05d9\u05e2\u05ea\u05db\u05dd:** \u05d6\u05d4 \u05d0\u05ea\u05e8 \u05dc\u05d0 \u05e8\u05e9\u05de\u05d9 \u05d5\u05de\u05d9\u05d9\u05e2\u05e5 \u05d1\u05dc\u05d1\u05d3, \u05e9\u05d1\u05e0\u05d4 \u05d0\u05d7\u05d3 \u05de\u05d7\u05d1\u05e8\u05d9 \u05d4\u05e7\u05d1\u05d5\u05e6\u05d4 \u05d1\u05e9\u05d1\u05d9\u05dc \u05d4\u05e7\u05d1\u05d5\u05e6\u05d4. ' +
      '\u05d4\u05d5\u05d0 \u05dc\u05d0 \u05e7\u05e9\u05d5\u05e8 \u05dc\u05e8\u05e9\u05d5\u05ea \u05d4\u05d8\u05d1\u05e2 \u05d5\u05d4\u05d2\u05e0\u05d9\u05dd \u05d0\u05d5 \u05dc\u05d7\u05e0\u05d9\u05d5\u05df, \u05d5\u05dc\u05d0 \u05de\u05ea\u05d7\u05d9\u05d9\u05d1 \u05dc\u05d3\u05d1\u05e8. \u05d4\u05de\u05d7\u05d9\u05e8 \u05d4\u05e7\u05d5\u05d1\u05e2 \u05d4\u05d5\u05d0 \u05d4\u05de\u05d7\u05d9\u05e8 \u05d1\u05e7\u05d5\u05e4\u05d4. \u05d8.\u05dc.\u05d7. ' +
      '\u05d4\u05e9\u05ea\u05de\u05e9\u05d5 \u05d1\u05d5 \u05d0\u05dd \u05d4\u05d5\u05d0 \u05e2\u05d5\u05d6\u05e8 \u05dc\u05db\u05dd.\n\n' +
      '**\u05e4\u05e8\u05d8\u05d9\u05d5\u05ea:** \u05dc\u05d0 \u05e0\u05d0\u05e1\u05e4\u05d9\u05dd \u05e4\u05e8\u05d8\u05d9\u05dd \u05d0\u05d9\u05e9\u05d9\u05d9\u05dd (\u05dc\u05d0 \u05d8\u05dc\u05e4\u05d5\u05df, \u05dc\u05d0 \u05de\u05d9\u05d9\u05dc \u05d5\u05dc\u05d0 \u05ea\u05e2\u05d5\u05d3\u05ea \u05d6\u05d4\u05d5\u05ea). \u05e8\u05e9\u05d9\u05de\u05ea \u05d4\u05e6\u05d9\u05d5\u05d3 \u05e0\u05e9\u05de\u05e8\u05ea \u05e8\u05e7 ' +
      '\u05d1\u05d3\u05e4\u05d3\u05e4\u05df \u05e9\u05dc\u05db\u05dd. \u05d4\u05e8\u05e9\u05de\u05d4 \u05e9\u05d5\u05de\u05e8\u05ea \u05e8\u05e7 \u05d0\u05ea \u05d4\u05e9\u05dd \u05e9\u05d1\u05d7\u05e8\u05ea\u05dd, \u05de\u05e1\u05e4\u05e8 \u05d4\u05dc\u05e0\u05d9\u05dd \u05d5\u05d4\u05ea\u05d0\u05e8\u05d9\u05db\u05d9\u05dd, \u05db\u05d3\u05d9 \u05dc\u05e1\u05e4\u05d5\u05e8 \u05db\u05de\u05d4 \u05e0\u05d4\u05d9\u05d4.' },
  { tour: 'welcome', key: 'help', title: '\u05d4\u05e1\u05d9\u05d5\u05e8 \u05ea\u05de\u05d9\u05d3 \u05db\u05d0\u05df',
    text: '\u05d0\u05e4\u05e9\u05e8 \u05dc\u05d7\u05d6\u05d5\u05e8 \u05dc\u05e1\u05d9\u05d5\u05e8 \u05d4\u05d6\u05d4 \u05d1\u05db\u05dc \u05d6\u05de\u05df, \u05d1\u05db\u05e4\u05ea\u05d5\u05e8 ?. \u05d1\u05db\u05dc \u05d7\u05dc\u05e7 \u05e9\u05dc \u05d4\u05d0\u05ea\u05e8 \u05d4\u05d5\u05d0 \u05de\u05e6\u05d9\u05d2 \u05e1\u05d9\u05d5\u05e8 \u05e7\u05e6\u05e8 \u05e2\u05dc \u05d0\u05d5\u05ea\u05d5 \u05d7\u05dc\u05e7.' },
  { tour: 'welcome', key: 'tabs', title: '\u05d7\u05dc\u05e7\u05d9 \u05d4\u05d0\u05ea\u05e8',
    text: '\u05db\u05d0\u05df \u05e2\u05d5\u05d1\u05e8\u05d9\u05dd \u05d1\u05d9\u05df \u05d4\u05d7\u05dc\u05e7\u05d9\u05dd: \u05d4\u05de\u05d7\u05e9\u05d1\u05d5\u05df, \u05de\u05d9\u05d3\u05e2 \u05e2\u05dc \u05d4\u05de\u05e7\u05d5\u05dd, \u05e8\u05e9\u05d9\u05de\u05ea \u05e6\u05d9\u05d5\u05d3, \u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea \u05d5\u05d8\u05d9\u05e4\u05d9\u05dd \u05de\u05d4\u05e7\u05d1\u05d5\u05e6\u05d4.' },
  { tour: 'welcome', key: 'prices', title: '\u05de\u05d7\u05d9\u05e8\u05d5\u05df',
    text: '\u05d4\u05de\u05d7\u05d9\u05e8\u05d5\u05df \u05d4\u05de\u05dc\u05d0, \u05de\u05d0\u05ea\u05e8 \u05e8\u05e9\u05d5\u05ea \u05d4\u05d8\u05d1\u05e2 \u05d5\u05d4\u05d2\u05e0\u05d9\u05dd.' },
  { tour: 'welcome', key: 'who', title: '1. \u05de\u05d9 \u05de\u05d2\u05d9\u05e2?',
    text: '\u05e1\u05de\u05e0\u05d5 \u05db\u05de\u05d4 \u05de\u05d1\u05d5\u05d2\u05e8\u05d9\u05dd \u05d5\u05d9\u05dc\u05d3\u05d9\u05dd \u05de\u05d2\u05d9\u05e2\u05d9\u05dd. \u05d9\u05e9 \u05dc\u05db\u05dd \u05d4\u05e0\u05d7\u05d4 (\u05e1\u05d8\u05d5\u05d3\u05e0\u05d8\u05d9\u05dd, \u05de\u05d9\u05dc\u05d5\u05d0\u05d9\u05dd, \u05d0\u05d6\u05e8\u05d7\u05d9\u05dd \u05d5\u05ea\u05d9\u05e7\u05d9\u05dd \u05d5\u05e2\u05d5\u05d3)? \u05e4\u05ea\u05d7\u05d5 \u05d0\u05ea "\u05d9\u05e9 \u05dc\u05db\u05dd \u05d4\u05e0\u05d7\u05d4" \u05d5\u05e1\u05e4\u05e8\u05d5 \u05d0\u05d5\u05ea\u05dd \u05e9\u05dd.' },
  { tour: 'welcome', key: 'when', title: '2. \u05de\u05ea\u05d9?',
    text: '\u05d1\u05d5\u05d7\u05e8\u05d9\u05dd \u05ea\u05d0\u05e8\u05d9\u05da \u05d4\u05d2\u05e2\u05d4 \u05d5\u05ea\u05d0\u05e8\u05d9\u05da \u05e2\u05d6\u05d9\u05d1\u05d4. \u05de\u05d2\u05d9\u05e2\u05d9\u05dd \u05e8\u05e7 \u05dc\u05d7\u05dc\u05e7 \u05de\u05d4\u05d6\u05de\u05df, \u05d0\u05d5 \u05d1\u05d4\u05e4\u05e1\u05e7\u05d5\u05ea? "\u05d4\u05d5\u05e1\u05e4\u05ea \u05ea\u05e7\u05d5\u05e4\u05d4" \u05de\u05e4\u05e6\u05dc\u05ea \u05d0\u05ea \u05d4\u05e9\u05d4\u05d9\u05d9\u05d4.' },
  { tour: 'welcome', key: 'cost', title: '3. \u05db\u05de\u05d4 \u05d6\u05d4 \u05e2\u05d5\u05dc\u05d4',
    text: '\u05d4\u05e2\u05dc\u05d5\u05ea \u05de\u05ea\u05e2\u05d3\u05db\u05e0\u05ea \u05de\u05d9\u05d3 \u05d1\u05d6\u05de\u05df \u05e9\u05de\u05de\u05dc\u05d0\u05d9\u05dd: \u05de\u05d7\u05d9\u05e8 \u05e8\u05d2\u05d9\u05dc \u05d5\u05de\u05d7\u05d9\u05e8 \u05e2\u05dd \u05d4\u05e0\u05d7\u05d4 \u05e7\u05d1\u05d5\u05e6\u05ea\u05d9\u05ea.' },
  { tour: 'welcome', key: 'register', title: '4. \u05e9\u05de\u05d9\u05e8\u05ea \u05d4\u05d4\u05e8\u05e9\u05de\u05d4 (\u05dc\u05d0 \u05d7\u05d5\u05d1\u05d4)',
    text: '\u05e8\u05d5\u05e6\u05d9\u05dd \u05e9\u05d4\u05e7\u05d1\u05d5\u05e6\u05d4 \u05ea\u05d3\u05e2 \u05e9\u05d0\u05ea\u05dd \u05de\u05d2\u05d9\u05e2\u05d9\u05dd? \u05e9\u05de\u05e8\u05d5 \u05d0\u05ea \u05de\u05d4 \u05e9\u05de\u05d9\u05dc\u05d0\u05ea\u05dd, \u05e2\u05dd \u05e9\u05dd \u05de\u05e9\u05e4\u05d7\u05d4 \u05d5\u05e7\u05d5\u05d3 \u05e9\u05ea\u05d1\u05d7\u05e8\u05d5. \u05e2\u05dd \u05d0\u05d5\u05ea\u05d5 \u05e9\u05dd \u05d5\u05e7\u05d5\u05d3 \u05d0\u05e4\u05e9\u05e8 \u05dc\u05e2\u05d3\u05db\u05df, \u05dc\u05d1\u05d8\u05dc \u05d5\u05dc\u05d4\u05e6\u05d8\u05e8\u05e3 \u05dc\u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea.' },
  { tour: 'welcome', key: 'share', title: '\u05e9\u05d9\u05ea\u05d5\u05e3 \u05e2\u05dd \u05d7\u05d1\u05e8\u05d9\u05dd',
    text: '\u05de\u05db\u05d9\u05e8\u05d9\u05dd \u05e2\u05d5\u05d3 \u05de\u05e9\u05e4\u05d7\u05d5\u05ea \u05de\u05d4\u05e7\u05d1\u05d5\u05e6\u05d4? \u05e9\u05dc\u05d7\u05d5 \u05dc\u05d4\u05df \u05d0\u05ea \u05d4\u05d0\u05ea\u05e8.' },

  { tour: 'gear', key: 'views', title: '\u05e8\u05e9\u05d9\u05de\u05ea \u05e6\u05d9\u05d5\u05d3',
    text: '"\u05d1\u05d7\u05d9\u05e8\u05ea \u05e4\u05e8\u05d9\u05d8\u05d9\u05dd" \u05de\u05e6\u05d9\u05d2\u05d4 \u05d0\u05ea \u05db\u05dc \u05de\u05d4 \u05e9\u05db\u05d3\u05d0\u05d9 \u05dc\u05d4\u05d1\u05d9\u05d0. "\u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05d9" \u05de\u05e6\u05d9\u05d2\u05d4 \u05d0\u05ea \u05de\u05d4 \u05e9\u05d1\u05d7\u05e8\u05ea\u05dd.' },
  { tour: 'gear', key: 'search', title: '\u05d7\u05d9\u05e4\u05d5\u05e9 \u05d5\u05e1\u05d9\u05e0\u05d5\u05df',
    text: '\u05de\u05d7\u05e4\u05e9\u05d9\u05dd \u05e4\u05e8\u05d9\u05d8, \u05d0\u05d5 \u05de\u05e1\u05e0\u05e0\u05d9\u05dd \u05dc\u05e4\u05d9 \u05ea\u05d2\u05d9\u05ea.' },
  { tour: 'gear', key: 'basic', title: '\u05d4\u05e4\u05e8\u05d9\u05d8\u05d9\u05dd \u05d4\u05d1\u05e1\u05d9\u05e1\u05d9\u05d9\u05dd',
    text: '\u05dc\u05d7\u05d9\u05e6\u05d4 \u05d0\u05d7\u05ea \u05de\u05d5\u05e1\u05d9\u05e4\u05d4 \u05dc\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05db\u05dd \u05d0\u05ea \u05db\u05dc \u05d4\u05e4\u05e8\u05d9\u05d8\u05d9\u05dd \u05d4\u05d1\u05e1\u05d9\u05e1\u05d9\u05d9\u05dd.' },
  { tour: 'gear', key: 'pack', title: '\u05d0\u05d5\u05e8\u05d6\u05d9\u05dd',
    text: '\u05d1"\u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05d9" \u05de\u05e1\u05de\u05e0\u05d9\u05dd \u05de\u05d4 \u05db\u05d1\u05e8 \u05d0\u05e8\u05d5\u05d6 \u05d5\u05e8\u05d5\u05d0\u05d9\u05dd \u05db\u05de\u05d4 \u05e0\u05e9\u05d0\u05e8. \u05de\u05e9\u05dd \u05d0\u05e4\u05e9\u05e8 \u05d2\u05dd \u05dc\u05e9\u05dc\u05d5\u05d7 \u05d0\u05ea \u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05d1\u05d5\u05d5\u05d0\u05d8\u05e1\u05d0\u05e4. \u05d4\u05e8\u05e9\u05d9\u05de\u05d4 \u05e0\u05e9\u05de\u05e8\u05ea \u05e8\u05e7 \u05d1\u05d3\u05e4\u05d3\u05e4\u05df \u05d4\u05d6\u05d4.' },
  { tour: 'gear', key: 'add', title: '\u05d7\u05e1\u05e8 \u05e4\u05e8\u05d9\u05d8?',
    text: '\u05d4\u05d5\u05e1\u05d9\u05e4\u05d5 \u05d0\u05d5\u05ea\u05d5 \u05dc\u05e8\u05e9\u05d9\u05de\u05d4 \u05e9\u05dc\u05db\u05dd. \u05d4\u05d5\u05d0 \u05d9\u05d9\u05e9\u05dc\u05d7 \u05d2\u05dd \u05dc\u05de\u05d0\u05e8\u05d2\u05df, \u05e9\u05d9\u05d7\u05dc\u05d9\u05d8 \u05d0\u05dd \u05dc\u05d4\u05d5\u05e1\u05d9\u05e3 \u05d0\u05d5\u05ea\u05d5 \u05dc\u05e8\u05e9\u05d9\u05de\u05d4 \u05d4\u05db\u05dc\u05dc\u05d9\u05ea.' },

  { tour: 'acts', key: 'views', title: '\u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea',
    text: '\u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea \u05e9\u05de\u05e9\u05e4\u05d7\u05d5\u05ea \u05d1\u05e7\u05d1\u05d5\u05e6\u05d4 \u05de\u05ea\u05db\u05e0\u05e0\u05d5\u05ea. \u05e8\u05d5\u05d0\u05d9\u05dd \u05d0\u05d5\u05ea\u05df \u05d1\u05e8\u05e9\u05d9\u05de\u05d4 \u05dc\u05e4\u05d9 \u05d9\u05de\u05d9\u05dd, \u05d0\u05d5 \u05d1\u05dc\u05d5\u05d7 \u05e9\u05d1\u05d5\u05e2\u05d9.' },
  { tour: 'acts', key: 'search', title: '\u05d7\u05d9\u05e4\u05d5\u05e9 \u05d5\u05e1\u05d9\u05e0\u05d5\u05df',
    text: '\u05d7\u05d9\u05e4\u05d5\u05e9, \u05d5\u05e1\u05d9\u05e0\u05d5\u05df \u05dc\u05e4\u05d9 \u05d9\u05d5\u05dd \u05d5\u05dc\u05e4\u05d9 \u05e7\u05d4\u05dc: \u05dc\u05db\u05d5\u05dc\u05dd, \u05dc\u05de\u05d1\u05d5\u05d2\u05e8\u05d9\u05dd \u05d0\u05d5 \u05dc\u05d9\u05dc\u05d3\u05d9\u05dd.' },
  { tour: 'acts', key: 'details', title: '\u05e4\u05e8\u05d8\u05d9\u05dd \u05d5\u05d4\u05e6\u05d8\u05e8\u05e4\u05d5\u05ea',
    text: '\u05dc\u05d7\u05d9\u05e6\u05d4 \u05e2\u05dc \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea \u05e4\u05d5\u05ea\u05d7\u05ea \u05d0\u05ea \u05d4\u05e4\u05e8\u05d8\u05d9\u05dd. \u05de\u05e9\u05dd \u05de\u05e6\u05d8\u05e8\u05e4\u05d9\u05dd, \u05e2\u05dd \u05d4\u05e9\u05dd \u05d5\u05d4\u05e7\u05d5\u05d3 \u05e9\u05dc \u05d4\u05d4\u05e8\u05e9\u05de\u05d4.' },
  { tour: 'acts', key: 'add', title: '\u05d4\u05d5\u05e1\u05e4\u05ea \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea',
    text: '\u05de\u05e9\u05e4\u05d7\u05d4 \u05e8\u05e9\u05d5\u05de\u05d4 \u05d9\u05db\u05d5\u05dc\u05d4 \u05dc\u05d4\u05d5\u05e1\u05d9\u05e3 \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea \u05de\u05e9\u05dc\u05d4.' },

  { tour: 'tips', key: 'intro', title: '\u05d8\u05d9\u05e4\u05d9\u05dd \u05de\u05d4\u05e7\u05d1\u05d5\u05e6\u05d4',
    text: '\u05d8\u05d9\u05e4\u05d9\u05dd \u05e9\u05d7\u05d1\u05e8\u05d9 \u05d4\u05e7\u05d1\u05d5\u05e6\u05d4 \u05db\u05ea\u05d1\u05d5: \u05e6\u05d9\u05d5\u05d3, \u05dc\u05d9\u05e0\u05d4, \u05d0\u05d5\u05db\u05dc, \u05d9\u05dc\u05d3\u05d9\u05dd \u05d5\u05e2\u05d5\u05d3.' },
  { tour: 'tips', key: 'search', title: '\u05d7\u05d9\u05e4\u05d5\u05e9',
    text: '\u05d7\u05d9\u05e4\u05d5\u05e9 \u05d1\u05d8\u05d9\u05e4\u05d9\u05dd, \u05d5\u05e1\u05d9\u05e0\u05d5\u05df \u05dc\u05e4\u05d9 \u05e7\u05d8\u05d2\u05d5\u05e8\u05d9\u05d4.' },
  { tour: 'tips', key: 'write', title: '\u05db\u05ea\u05d9\u05d1\u05ea \u05d8\u05d9\u05e4',
    text: '\u05d9\u05e9 \u05dc\u05db\u05dd \u05d8\u05d9\u05e4? \u05db\u05ea\u05d1\u05d5 \u05d0\u05d5\u05ea\u05d5 \u05db\u05d0\u05df. \u05d4\u05d5\u05d0 \u05d9\u05d5\u05e4\u05d9\u05e2 \u05d1\u05d0\u05ea\u05e8 \u05d0\u05d7\u05e8\u05d9 \u05d0\u05d9\u05e9\u05d5\u05e8 \u05e9\u05dc \u05d4\u05de\u05d0\u05e8\u05d2\u05df.' }
];

var TOUR_TAB = '\u05d4\u05d3\u05e8\u05db\u05d4';
var TOUR_HEAD = ['\u05e1\u05d9\u05d5\u05e8', '\u05de\u05e1\u05e4\u05e8 \u05e6\u05e2\u05d3', '\u05de\u05e4\u05ea\u05d7', '\u05db\u05d5\u05ea\u05e8\u05ea', '\u05d8\u05e7\u05e1\u05d8'];
var TOUR_COL = { tour: 0, step: 1, key: 2, title: 3, text: 4 };
var TOUR_CACHE = 'tour-v1';
var TOUR_TEXT_MAX = 2000;

function tourSeedRows_() {
  var n = {};
  return TOUR_TEXTS_.map(function (r) {
    n[r.tour] = (n[r.tour] || 0) + 1;
    return [TOUR_NAMES_[r.tour], n[r.tour], r.key, r.title, r.text];
  });
}

// The tab follows the site: a step added in tour-texts.js after the tab was made gets its row, in its place, and
// the rows keep the site's order and numbering. Yair's text moves with its row; a cell still holding a retired
// built-in text (TOUR_RETIRED_) gets the current one. Rows with an unknown key stay, at the end.
// rows: as read ({tour, step, key, title, text}). Returns the tab's new values, or null when it is already right.
function tourSync_(rows) {
  var byName = tourIds_(), have = {}, rest = [];
  rows.forEach(function (r) {
    var id = byName[String(r.tour).trim()], k = id + '/' + String(r.key).trim();
    if (id && !have[k]) have[k] = r; else rest.push(r);
  });
  var n = {}, out = [], same = true;
  TOUR_TEXTS_.forEach(function (d, i) {
    var k = d.tour + '/' + d.key, r = have[k], retired = TOUR_RETIRED_[k] || [];
    n[d.tour] = (n[d.tour] || 0) + 1;
    var title = r ? r.title : d.title, text = r ? r.text : d.text;
    if (r && retired.indexOf(String(text).trim()) >= 0) text = d.text;
    var row = [TOUR_NAMES_[d.tour], n[d.tour], d.key, title, text];
    if (!r || rows[i] !== r || +r.step !== n[d.tour] || text !== r.text) same = false;
    out.push(row);
  });
  if (same) return null;
  rest.forEach(function (r) { out.push([r.tour, r.step, r.key, r.title, r.text]); });
  return out;
}
function tourIds_() {
  var byName = {};
  Object.keys(TOUR_NAMES_).forEach(function (id) { byName[TOUR_NAMES_[id]] = id; byName[id] = id; });
  return byName;
}

// Public: the sheet's texts for known steps, empty cells left out (the site falls back to its own text).
function tourPublic_(ts) {
  var byName = tourIds_(), known = {};
  TOUR_TEXTS_.forEach(function (r) { known[r.tour + '/' + r.key] = true; });
  var steps = [];
  (ts && ts.tour ? ts.tour() : []).forEach(function (r) {
    var tour = byName[String(r.tour).trim()], key = String(r.key).trim();
    if (!tour || !known[tour + '/' + key]) return;
    var s = { tour: tour, key: key };
    var title = unguard_(r.title).trim().slice(0, 200), text = unguard_(r.text).trim().slice(0, TOUR_TEXT_MAX);
    if (title) s.title = title;
    if (text) s.text = text;
    if (title || text) steps.push(s);
  });
  return { ok: true, steps: steps };
}

// Simple trigger: runs on every hand edit of the sheet.
function onEdit(e) {
  var name = e && e.range ? e.range.getSheet().getName() : '';
  if (name === ACT_TABS.acts || name === ACT_TABS.joins) { CacheService.getScriptCache().remove(ACTS_CACHE); return; }
  if (name === TOUR_TAB) { CacheService.getScriptCache().remove(TOUR_CACHE); return; }
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
  tipsStore_().tips();                       // make sure the tabs exist (\u05e6\u05d9\u05d5\u05d3 is written with the starter list)
  tipsStore_().comments();
  tipsStore_().gear();
  tipsStore_().tour();                       // \u05d4\u05d3\u05e8\u05db\u05d4, written with the site's tour texts
  SpreadsheetApp.getUi().alert('\u05d4\u05ea\u05e8\u05d0\u05d5\u05ea \u05d4\u05d5\u05e4\u05e2\u05dc\u05d5: \u05db\u05dc \u05e9\u05e2\u05ea\u05d9\u05d9\u05dd, \u05d0\u05dd \u05d4\u05d2\u05d9\u05e2 \u05de\u05e9\u05d4\u05d5 \u05d7\u05d3\u05e9 \u05dc\u05d0\u05d9\u05e9\u05d5\u05e8, \u05d9\u05d9\u05e9\u05dc\u05d7 \u05d0\u05dc\u05d9\u05da \u05de\u05d9\u05d9\u05dc \u05d0\u05d7\u05d3 \u05e2\u05dd \u05db\u05dc \u05d4\u05de\u05de\u05ea\u05d9\u05e0\u05d9\u05dd.');
}

// ---------- activities (docs/activities-plan.md) ----------
// Two tabs in this (private) sheet, created on the first write. A registered family (its name + code) adds an
// activity and it is public at once; only that family edits or cancels it. Yair can hide one: status \u05d4\u05d5\u05e1\u05ea\u05e8.
// Families join with a number of participants. Capacity is checked here, under the script lock, so two
// last joins cannot both succeed. Every write is safe to repeat: a new activity carries a client id, and a
// join sets the family's count rather than adding to it.
var ACT_TABS = { acts: '\u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea', joins: '\u05d4\u05e6\u05d8\u05e8\u05e4\u05d5\u05d9\u05d5\u05ea' };
var ACT_HEAD = ['\u05de\u05e1\u05e4\u05e8', '\u05e1\u05d8\u05d8\u05d5\u05e1', '\u05de\u05e9\u05e4\u05d7\u05d4 \u05de\u05d0\u05e8\u05d2\u05e0\u05ea', '\u05e0\u05d5\u05e9\u05d0', '\u05ea\u05d9\u05d0\u05d5\u05e8', '\u05d4\u05ea\u05d7\u05dc\u05d4', '\u05e1\u05d9\u05d5\u05dd', '\u05e7\u05d4\u05dc', '\u05de\u05d2\u05d9\u05dc', '\u05e2\u05d3 \u05d2\u05d9\u05dc',
                '\u05de\u05e7\u05d5\u05de\u05d5\u05ea', '\u05d7\u05d5\u05d1\u05d4 \u05dc\u05d4\u05d1\u05d9\u05d0', '\u05de\u05d5\u05de\u05dc\u05e5 \u05dc\u05d4\u05d1\u05d9\u05d0', '\u05e0\u05d5\u05e6\u05e8', '\u05e2\u05d5\u05d3\u05db\u05df', '\u05de\u05d6\u05d4\u05d4 \u05e9\u05dc\u05d9\u05d7\u05d4', '\u05de\u05e0\u05d7\u05d4'];
var ACT_COL = { id: 0, status: 1, owner: 2, topic: 3, description: 4, start: 5, end: 6, tag: 7, ageFrom: 8, ageTo: 9,
                capacity: 10, required: 11, suggested: 12, created: 13, updated: 14, clientId: 15, host: 16 };
var JOIN_HEAD = ['\u05e4\u05e2\u05d9\u05dc\u05d5\u05ea', '\u05de\u05e9\u05e4\u05d7\u05d4', '\u05de\u05e9\u05ea\u05ea\u05e4\u05d9\u05dd', '\u05e2\u05d5\u05d3\u05db\u05df'];
var JOIN_COL = { actId: 0, family: 1, count: 2, updated: 3 };
var AST = { active: '\u05e4\u05e2\u05d9\u05dc', hidden: '\u05d4\u05d5\u05e1\u05ea\u05e8', cancelled: '\u05d1\u05d5\u05d8\u05dc' };
var ACT_STATUSES = [AST.active, AST.hidden, AST.cancelled];
var ACT_TAGS = ['\u05dc\u05db\u05d5\u05dc\u05dd', '\u05de\u05d1\u05d5\u05d2\u05e8\u05d9\u05dd', '\u05d9\u05dc\u05d3\u05d9\u05dd'];
var ACT_LIMITS = { topic: 60, host: 60, description: 600, gear: 200, capacity: 500, join: 30 };
var TRIP = { from: '2026-10-06', to: '2026-10-13' };   // the days an activity may fall on
var MAX_ACTS_PER_FAMILY = 30;
var ACTS_CACHE = 'acts-v1';
var ACT_WRITES = { saveActivity: 1, deleteActivity: 1, join: 1, leave: 1 };

// "2026-10-06T10:00", 24-hour clock, inside the trip.
function actTime_(v) {
  var s = String(v == null ? '' : v), m = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d$/.exec(s);
  if (!m || m[1] < TRIP.from || m[1] > TRIP.to) fail_('bad_time');
  return s;
}
function actAge_(v) {
  if (v === '' || v == null) return '';
  var n = Number(v);
  if (!(n >= 0 && n <= 99) || n !== Math.floor(n)) fail_('bad_age');
  return n;
}
function actGear_(s) { return s ? tipText_(s, 0, ACT_LIMITS.gear) : ''; }
// The registered family behind a name + code (the registration's own lockout applies).
function actFamily_(req, store) {
  var user = checkCreds_(req), row = findRow_(store, user);
  if (!row) fail_('not_registered');
  verify_(store, row, String(req.pin));
  return { key: user, name: String(row.family).replace(/^'/, '') };
}
function isOwner_(a, fam) { return normUser_(unguard_(a.owner)) === fam.key; }
function actJoins_(as, id) {
  return as.joins().filter(function (j) { return +j.actId === id && Math.floor(+j.count) > 0; });
}
function actTaken_(as, id) { return actJoins_(as, id).reduce(function (s, j) { return s + Math.floor(+j.count); }, 0); }
function findAct_(as, id) {
  id = Math.floor(Number(id)) || 0;
  return as.acts().filter(function (a) { return +a.id === id; })[0] || null;
}

// Public: active activities, by start time. Family names and counts are public by design (as on the
// registration list); codes, client ids and dates of writing never leave the sheet.
function activitiesPublic_(as) {
  var list = as.acts().filter(function (a) { return a.status === AST.active; }).map(function (a) {
    var joined = actJoins_(as, +a.id).map(function (j) { return { family: unguard_(j.family), count: Math.floor(+j.count) }; });
    return { id: +a.id, owner: unguard_(a.owner), topic: unguard_(a.topic), host: unguard_(a.host), description: unguard_(a.description),
             start: String(a.start), end: String(a.end), tag: String(a.tag),
             ageFrom: a.ageFrom === '' ? null : +a.ageFrom, ageTo: a.ageTo === '' ? null : +a.ageTo,
             capacity: +a.capacity || 0, required: unguard_(a.required), suggested: unguard_(a.suggested),
             joined: joined, taken: joined.reduce(function (s, j) { return s + j.count; }, 0) };
  });
  list.sort(function (x, y) { return x.start < y.start ? -1 : x.start > y.start ? 1 : x.id - y.id; });
  return { ok: true, trip: TRIP, tags: ACT_TAGS, activities: list };
}
function actDone_(as, extra) {
  var out = { ok: true, activities: activitiesPublic_(as).activities };
  Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
  return out;
}

// Create (with clientId) or edit (with id, owner only).
function saveActivity_(req, store, as) {
  var fam = actFamily_(req, store), a = req.activity || {};
  var f = {
    topic: tipText_(String(a.topic || '').replace(/\n/g, ' '), 3, ACT_LIMITS.topic),
    host: a.host ? tipText_(String(a.host).replace(/\n/g, ' '), 0, ACT_LIMITS.host) : '',     // optional: who leads it
    description: a.description ? tipText_(a.description, 0, ACT_LIMITS.description) : '',
    start: actTime_(a.start), end: actTime_(a.end),
    tag: String(a.tag || ''), ageFrom: '', ageTo: '', capacity: '',
    required: actGear_(a.required), suggested: actGear_(a.suggested)
  };
  if (f.end <= f.start) fail_('end_before_start');
  if (ACT_TAGS.indexOf(f.tag) < 0) fail_('bad_tag');
  if (f.tag === '\u05d9\u05dc\u05d3\u05d9\u05dd') {                                   // ages mean something only for kids
    f.ageFrom = actAge_(a.ageFrom); f.ageTo = actAge_(a.ageTo);
    if (f.ageFrom !== '' && f.ageTo !== '' && f.ageFrom > f.ageTo) fail_('bad_age');
  }
  if (a.capacity !== '' && a.capacity != null && +a.capacity !== 0) {
    var cap = Number(a.capacity);
    if (!(cap >= 1 && cap <= ACT_LIMITS.capacity) || cap !== Math.floor(cap)) fail_('bad_capacity');
    f.capacity = cap;
  }
  var row;
  if (req.id) {
    row = findAct_(as, req.id);
    if (!row || row.status !== AST.active) fail_('not_found');
    if (!isOwner_(row, fam)) fail_('not_owner');
    if (f.capacity && actTaken_(as, +row.id) > f.capacity) fail_('below_joined');
    Object.keys(f).forEach(function (k) { row[k] = f[k]; });
    row.updated = as.now();
    as.updateAct(row);
    return actDone_(as, { id: +row.id });
  }
  var clientId = checkClientId_(req.clientId);
  var dup = as.acts().filter(function (x) { return x.clientId === clientId; })[0];
  if (dup) return actDone_(as, { id: +dup.id });            // a retry: already saved
  var mine = as.acts().filter(function (x) { return x.status === AST.active && isOwner_(x, fam); }).length;
  if (mine >= MAX_ACTS_PER_FAMILY) fail_('busy');
  row = { id: nextId_(as.acts()), status: AST.active, owner: safeCell_(fam.name), created: as.now(), updated: '',
          clientId: clientId };
  Object.keys(f).forEach(function (k) { row[k] = f[k]; });
  as.addAct(row);
  return actDone_(as, { id: row.id });
}

// Cancel (status \u05d1\u05d5\u05d8\u05dc: the row and its joins stay, for the record). Repeating it is fine.
function deleteActivity_(req, store, as) {
  var fam = actFamily_(req, store), row = findAct_(as, req.id);
  if (!row || row.status === AST.hidden) fail_('not_found');
  if (!isOwner_(row, fam)) fail_('not_owner');
  if (row.status !== AST.cancelled) { row.status = AST.cancelled; row.updated = as.now(); as.updateAct(row); }
  return actDone_(as);
}

// Sets this family's participants (not adds), so a retry cannot double-count.
function join_(req, store, as) {
  var fam = actFamily_(req, store), row = findAct_(as, req.id);
  if (!row || row.status !== AST.active) fail_('not_found');
  var n = Number(req.count);
  if (!(n >= 1 && n <= ACT_LIMITS.join) || n !== Math.floor(n)) fail_('bad_count');
  var id = +row.id, mine = as.joins().filter(function (j) { return +j.actId === id && normUser_(unguard_(j.family)) === fam.key; })[0];
  var others = actTaken_(as, id) - (mine ? Math.max(0, Math.floor(+mine.count) || 0) : 0);
  if (+row.capacity && others + n > +row.capacity) fail_('full');
  if (mine) { mine.count = n; mine.updated = as.now(); as.updateJoin(mine); }
  else as.addJoin({ actId: id, family: safeCell_(fam.name), count: n, updated: as.now() });
  return actDone_(as);
}

function leave_(req, store, as) {
  var fam = actFamily_(req, store), id = Math.floor(Number(req.id)) || 0;
  as.joins().forEach(function (j) {
    if (+j.actId === id && normUser_(unguard_(j.family)) === fam.key && +j.count) {
      j.count = 0; j.updated = as.now(); as.updateJoin(j);
    }
  });
  return actDone_(as);
}

// Pure: the example activities (menu "\u05d4\u05d5\u05e1\u05e4\u05ea 3 \u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea \u05dc\u05d3\u05d5\u05d2\u05de\u05d4"). Owned by "\u05d4\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd", so no family edits them.
// The example activities - shared by the site and the backend (docs/activities-plan.md \u00a75.2b).
// The backend adds them to the sheet from the menu "\u05d4\u05d5\u05e1\u05e4\u05ea 3 \u05e4\u05e2\u05d9\u05dc\u05d5\u05d9\u05d5\u05ea \u05dc\u05d3\u05d5\u05d2\u05de\u05d4" (backend/build.py inlines this file
// into Code.gs at `//@include acts-demo.js`). The site shows them, unsaved, on the preview link ?demo#acts.
var DEMO_OWNER = '\u05d4\u05de\u05d0\u05e8\u05d2\u05e0\u05d9\u05dd';
var DEMO_NOTE = '\n\n\u05d6\u05d5 \u05e4\u05e2\u05d9\u05dc\u05d5\u05ea \u05dc\u05d3\u05d5\u05d2\u05de\u05d4, \u05db\u05d3\u05d9 \u05dc\u05d4\u05e8\u05d0\u05d5\u05ea \u05d0\u05d9\u05da \u05d6\u05d4 \u05e0\u05e8\u05d0\u05d4.';
var DEMO_ACTS = [
  { clientId: 'demo-activity-1', topic: '\u05d0\u05e8\u05d5\u05d7\u05ea \u05e2\u05e8\u05d1 \u05de\u05e9\u05d5\u05ea\u05e4\u05ea \u05d5\u05de\u05e0\u05d2\u05dc', start: '2026-10-07T18:30', end: '2026-10-07T21:00', tag: '\u05dc\u05db\u05d5\u05dc\u05dd',
    capacity: '', description: '\u05de\u05d3\u05dc\u05d9\u05e7\u05d9\u05dd \u05de\u05e0\u05d2\u05dc\u05d9\u05dd \u05dc\u05d9\u05d3 \u05d4\u05e9\u05d5\u05dc\u05d7\u05e0\u05d5\u05ea, \u05d5\u05db\u05dc \u05de\u05e9\u05e4\u05d7\u05d4 \u05de\u05d1\u05d9\u05d0\u05d4 \u05de\u05e9\u05d4\u05d5 \u05dc\u05e9\u05d5\u05dc\u05d7\u05df \u05d4\u05de\u05e9\u05d5\u05ea\u05e3.',
    required: '\u05e6\u05dc\u05d7\u05ea, \u05db\u05d5\u05e1 \u05d5\u05e1\u05db\u05d5"\u05dd', suggested: '\u05e1\u05dc\u05d8 \u05d0\u05d5 \u05e7\u05d9\u05e0\u05d5\u05d7 \u05dc\u05e9\u05d5\u05dc\u05d7\u05df \u05d4\u05de\u05e9\u05d5\u05ea\u05e3' },
  { clientId: 'demo-activity-2', topic: '\u05d9\u05d5\u05d2\u05d4 \u05d1\u05d6\u05e8\u05d9\u05d7\u05d4 \u05e2\u05dc \u05d4\u05d7\u05d5\u05e3', start: '2026-10-08T06:00', end: '2026-10-08T07:00', tag: '\u05de\u05d1\u05d5\u05d2\u05e8\u05d9\u05dd',
    capacity: 12, description: '\u05ea\u05e8\u05d2\u05d5\u05dc \u05e8\u05d2\u05d5\u05e2 \u05dc\u05db\u05dc \u05d4\u05e8\u05de\u05d5\u05ea, \u05de\u05d5\u05dc \u05d4\u05d9\u05dd.', required: '\u05de\u05d6\u05e8\u05df \u05d9\u05d5\u05d2\u05d4 \u05d0\u05d5 \u05de\u05d2\u05d1\u05ea', suggested: '\u05d1\u05e7\u05d1\u05d5\u05e7 \u05de\u05d9\u05dd' },
  { clientId: 'demo-activity-3', topic: '\u05d7\u05d9\u05e4\u05d5\u05e9 \u05d0\u05d5\u05e6\u05e8\u05d5\u05ea \u05d1\u05d7\u05d5\u05e3', start: '2026-10-09T10:00', end: '2026-10-09T11:30', tag: '\u05d9\u05dc\u05d3\u05d9\u05dd',
    ageFrom: 5, ageTo: 10, capacity: 15, description: '\u05de\u05e9\u05d9\u05de\u05d5\u05ea \u05d5\u05e8\u05de\u05d6\u05d9\u05dd \u05dc\u05d0\u05d5\u05e8\u05da \u05d4\u05d7\u05d5\u05e3, \u05d5\u05e4\u05e8\u05e1 \u05e7\u05d8\u05df \u05d1\u05e1\u05d5\u05e3.',
    required: '\u05db\u05d5\u05d1\u05e2 \u05d5\u05d1\u05e7\u05d1\u05d5\u05e7 \u05de\u05d9\u05dd', suggested: '\u05d3\u05dc\u05d9 \u05e7\u05d8\u05df' }
];
function addDemoActivities_(as) {
  var n = 0;
  DEMO_ACTS.forEach(function (d) {
    if (as.acts().some(function (x) { return x.clientId === d.clientId; })) return;
    var row = { id: nextId_(as.acts()), status: AST.active, owner: DEMO_OWNER, created: as.now(), updated: '', clientId: d.clientId,
                topic: d.topic, host: d.host || '', description: d.description + DEMO_NOTE, start: d.start, end: d.end, tag: d.tag,
                ageFrom: d.ageFrom == null ? '' : d.ageFrom, ageTo: d.ageTo == null ? '' : d.ageTo, capacity: d.capacity,
                required: safeCell_(d.required), suggested: safeCell_(d.suggested) };
    as.addAct(row); n++;
  });
  return n;
}

function actWhen_(a) {
  var s = String(a.start), e = String(a.end);
  return nightLabel_(s.slice(0, 10)) + ' ' + s.slice(11) + ' \u05e2\u05d3 ' +
    (e.slice(0, 10) === s.slice(0, 10) ? '' : nightLabel_(e.slice(0, 10)) + ' ') + e.slice(11);
}
// Pure: the organizers' activities tab (active only; rewritten on every sync, nothing manual in it).
function organizerActivities_(pub) {
  return pub.activities.map(function (a) {
    var who = a.tag + (a.ageFrom != null || a.ageTo != null
      ? ' (' + (a.ageFrom != null ? a.ageFrom : '') + '\u2013' + (a.ageTo != null ? a.ageTo : '') + ')' : '');
    return [actWhen_(a), a.topic, a.owner, a.host, who, a.taken, a.capacity || '\u05dc\u05dc\u05d0 \u05d4\u05d2\u05d1\u05dc\u05d4',
            a.joined.map(function (j) { return j.family + ' ' + j.count; }).join(' \u00b7 ')];
  });
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
  var tourSh = null, tourRows = null;
  function tourSheet() {
    if (tourSh) return tourSh;
    var fresh = !ss.getSheetByName(TOUR_TAB);
    tourSh = tab(TOUR_TAB, TOUR_HEAD, []);
    if (fresh) {                               // today's texts, in one write; the columns stay plain text
      var seed = tourSeedRows_();
      tourSh.getRange(2, 1, seed.length, TOUR_HEAD.length).setNumberFormat('@').setValues(seed).setWrap(true);
      tourSh.setColumnWidth(TOUR_COL.title + 1, 200);
      tourSh.setColumnWidth(TOUR_COL.text + 1, 500);
    }
    return tourSh;
  }
  function readTour() {
    var sh = tourSheet(), n = sh.getLastRow() - 1;
    var v = n > 0 ? sh.getRange(2, 1, n, TOUR_HEAD.length).getValues() : [];
    return v.map(function (c) {
      var r = {};
      Object.keys(TOUR_COL).forEach(function (k) { r[k] = c[TOUR_COL[k]]; });
      return r;
    });
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
    tour: function () {
      if (tourRows) return tourRows;
      tourRows = readTour();
      var fix = tourSync_(tourRows);           // a new step, or the order changed on the site: follow it
      if (fix) {
        tourSheet().getRange(2, 1, fix.length, TOUR_HEAD.length).setNumberFormat('@').setValues(fix).setWrap(true);
        tourRows = readTour();
      }
      return tourRows;
    },
    now: function () { return new Date(); }       // a real date: the sheet shows it in its own (day-first) locale
  };
  return store;
}

// ---------- activities store (Google Sheet) ----------
// Reading never creates the tabs (the organizers' sync reads them on every registration); the first write does.
// Start and end are plain-text cells ("2026-10-06T10:00"), so Sheets cannot turn them into a date.
function activitiesStore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = {}, rows = {};
  function sheet(name, head, create) {
    if (sheets[name]) return sheets[name];
    var sh = ss.getSheetByName(name);
    if (!sh && create) {
      sh = ss.insertSheet(name);
      if (name === ACT_TABS.acts) {
        sh.getRange(1, ACT_COL.start + 1, sh.getMaxRows(), 2).setNumberFormat('@');
        var rule = SpreadsheetApp.newDataValidation().requireValueInList(ACT_STATUSES, true).setAllowInvalid(false).build();
        sh.getRange(2, ACT_COL.status + 1, sh.getMaxRows() - 1, 1).setDataValidation(rule);
      }
      sh.appendRow(head);
      sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.setRightToLeft(true);
    }
    return sh ? (sheets[name] = sh) : null;
  }
  function iso(v) {
    return v instanceof Date ? Utilities.formatDate(v, 'Asia/Jerusalem', "yyyy-MM-dd'T'HH:mm") : String(v);
  }
  function read(name, head, cols) {
    if (rows[name]) return rows[name];
    var sh = sheet(name, head, false), n = sh ? sh.getLastRow() - 1 : 0;
    var v = n > 0 ? sh.getRange(2, 1, n, head.length).getValues() : [];
    rows[name] = v.map(function (c, i) {
      var r = { _row: i + 2 };
      Object.keys(cols).forEach(function (k) { r[k] = c[cols[k]]; });
      if (name === ACT_TABS.acts) { r.status = String(r.status); r.clientId = String(r.clientId); r.start = iso(r.start); r.end = iso(r.end); }
      return r;
    }).filter(function (r) { return name === ACT_TABS.acts ? r.id !== '' : r.actId !== ''; });
    return rows[name];
  }
  function vals(r, cols) { var out = []; Object.keys(cols).forEach(function (k) { out[cols[k]] = r[k] == null ? '' : r[k]; }); return out; }
  function add(name, head, cols, r) {
    var list = read(name, head, cols), sh = sheet(name, head, true);
    sh.appendRow(vals(r, cols)); r._row = sh.getLastRow(); list.push(r);
  }
  function update(name, head, cols, r) { sheet(name, head, true).getRange(r._row, 1, 1, head.length).setValues([vals(r, cols)]); }
  return {
    acts: function () { return read(ACT_TABS.acts, ACT_HEAD, ACT_COL); },
    joins: function () { return read(ACT_TABS.joins, JOIN_HEAD, JOIN_COL); },
    addAct: function (r) { add(ACT_TABS.acts, ACT_HEAD, ACT_COL, r); },
    updateAct: function (r) { update(ACT_TABS.acts, ACT_HEAD, ACT_COL, r); },
    addJoin: function (r) { add(ACT_TABS.joins, JOIN_HEAD, JOIN_COL, r); },
    updateJoin: function (r) { update(ACT_TABS.joins, JOIN_HEAD, JOIN_COL, r); },
    now: function () { return new Date(); }
  };
}
