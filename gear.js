// Equipment tab (docs/gear-plan.md): pick items from the general list, then pack them.
// Uses api()/esc() from app.js, the word search in search.js and the starter list in gear-seed.js.
//
// Everything personal stays in this browser (localStorage): picks, counts, family members, packing marks, own items.
// A count per item (qty, 1 if absent). An item tagged "לכל אחד" is counted per family member once names are added:
// qty is then the count for each of them, and pq holds the counts only while they differ (gear-plan §5.4).
// Fast on the client, the server in the background (the tips.js pattern):
// - The list shows at once: the cached copy from the last visit, or the starter list shipped with the site.
//   A fresh copy is fetched in the background (prefetched after page load).
// - An own item goes onto my list at once and into an outbox that suggests it to the organizer. The outbox
//   is retried until the server answers and resumed on the next visit; the client id makes a resend land on
//   the same row. When the organizer approves it, it arrives in the general list under the row id the
//   server gave it, and the own copy merges into it (still picked, still packed).
(function () {
  'use strict';
  var C = window.CAMP, A = window.CampApi, esc = A.esc;
  var KEY = 'achziv-gear-v1', CACHE_KEY = 'achziv-gear-cache';
  var FINAL = { too_short: 'השם קצר מדי', too_long: 'השם ארוך מדי', bad_category: 'קטגוריה לא מוכרת' };
  var BASIC = 'בסיסי', EACH = GEAR_PER_PERSON_, QMAX = 99;
  var sections = GEAR_SECTIONS_.slice(), items = seedItems(), live = false, started = false;
  var view = 'pick', tag = '';
  var openSecs = {};                // general list: sections opened by hand in this visit (it starts collapsed)
  var openPer = {};                 // general list: items whose per-person counters are open
  var lastCount = {};               // the count chosen last per item, for "אותו מספר לכולם"
  var who = '';                     // "הרשימה שלי": '' everyone, '_' shared items, or a person's pid
  function $(id) { return document.getElementById(id); }
  function say(p, text, kind) { p.textContent = text; p.className = 'msg' + (kind ? ' ' + kind : ''); }
  function clean(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
  function newCid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function readJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  function seedItems() {
    return gearSeedList_().map(function (g) {
      return { id: g[0], section: g[1], name: g[2], note: g[4],
               tags: String(g[3]).split(',').map(function (t) { return t.trim(); }).filter(Boolean) };
    });
  }
  function secName(s) { return GEAR_SECTION_RENAMES_[s] || s; }   // an own item saved before a section was renamed

  // ---------- this browser's list ----------
  function state() {
    var s = readJson(KEY);
    if (!s || typeof s !== 'object') s = {};
    s.picked = s.picked || {}; s.packed = s.packed || {}; s.custom = s.custom || [];
    s.people = s.people || []; s.qty = s.qty || {}; s.pq = s.pq || {};
    return s;
  }
  function qtyOf(s, key) { return s.qty[key] || 1; }
  function perPerson(s, r) { return s.people.length > 0 && r.tags.indexOf(EACH) >= 0; }
  function countFor(s, key, pid) { var m = s.pq[key]; return m && pid in m ? m[pid] : qtyOf(s, key); }
  // an item leaves the list: its count, per-person counts and packing marks go with it
  function forget(s, key) {
    delete s.qty[key]; delete s.pq[key];
    Object.keys(s.packed).forEach(function (k) { if (k === key || k.indexOf(key + '@') === 0) delete s.packed[k]; });
  }
  function save(s) { writeJson(KEY, s); }
  // Own items the organizer approved are now general items: carry the pick and the packing mark over.
  function merge() {
    var s = state(), ids = {};
    items.forEach(function (it) { ids[it.id] = true; });
    var before = s.custom.length;
    s.custom = s.custom.filter(function (c) {
      if (!c.id || !ids[c.id]) return true;
      s.picked[c.id] = 1;
      if (s.packed['c' + c.cid]) s.packed['g' + c.id] = 1;
      if (s.qty['c' + c.cid]) s.qty['g' + c.id] = s.qty['c' + c.cid];
      forget(s, 'c' + c.cid);
      return false;
    });
    if (s.custom.length !== before) save(s);
  }

  // All entries of one kind as rows: {key, section, name, note, tags, own?}
  function generalRows() {
    return items.map(function (it) { return { key: 'g' + it.id, id: it.id, section: it.section, name: it.name, note: it.note, tags: it.tags }; });
  }
  function ownRows(s) {
    return s.custom.map(function (c) { return { key: 'c' + c.cid, own: c, section: secName(c.section), name: c.name, note: '', tags: [] }; });
  }
  function isPicked(s, r) { return r.own ? true : !!s.picked[r.id]; }
  function myRows(s) {
    return generalRows().filter(function (r) { return s.picked[r.id]; }).concat(ownRows(s));
  }
  function allSections(rows) {
    var out = sections.slice();
    rows.forEach(function (r) { if (out.indexOf(r.section) < 0) out.push(r.section); });
    return out;
  }

  // ---------- outbox ----------
  var flushing = false, retryTimer = null, retryDelay = 5000;
  function flush() {
    if (flushing || !live || !C.apiUrl) return;
    var next = state().custom.filter(function (c) { return !c.id && !c.failed && c.body; })
      .sort(function (a, b) { return a.at - b.at; })[0];
    if (!next) return;
    flushing = true;
    A.api(next.body).then(function (res) {
      flushing = false;
      var s = state(), c = s.custom.filter(function (x) { return x.cid === next.cid; })[0];
      if (res.ok) {
        retryDelay = 5000;
        if (c) { if (res.id) c.id = res.id; else c.id = -1; delete c.body; save(s); }   // -1: the bot trap answered
        renderSoon(); flush();
      } else if (FINAL[res.error]) {
        if (c) { c.failed = res.error; save(s); }
        renderSoon(); flush();
      } else {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 120000);
      }
    });
  }
  window.addEventListener('online', flush);

  // ---------- rendering ----------
  function badge(c) {
    return c.failed ? '<span class="pending-badge failed">לא נשלח: ' + esc(FINAL[c.failed] || c.failed) + '</span>'
         : c.id ? '<span class="pending-badge">פריט אישי · הוצע למארגן</span>'
         : '<span class="pending-badge sending">פריט אישי · שולח…</span>';
  }
  function matches(r, words) {
    if (tag && r.tags.indexOf(tag) < 0) return false;
    if (!words.length) return true;
    var forms = searchFormsOf_([r.name, r.note, r.section, r.tags.join(' ')].join(' '));
    return words.every(function (w) { return searchHit_(w, forms); });
  }
  function itemRow(r, checked, prefix, extra, key, more) {
    key = key || r.key;
    var id = prefix + key;
    return '<li class="gitem' + (checked && prefix === 'gm-' ? ' packed' : '') + '" data-key="' + esc(key) + '">' +
      '<input type="checkbox" id="' + esc(id) + '"' + (checked ? ' checked' : '') + '>' +
      '<label for="' + esc(id) + '"><span class="gname">' + esc(r.name) + '</span>' + (more || '') +
      (r.note ? ' <small class="gnote">' + esc(r.note) + '</small>' : '') + '</label>' +
      (extra || '') + '</li>';
  }
  // − n + ; pid '' = the item's count (for a לכל אחד item: the count for each person)
  function stepper(key, pid, n, label) {
    return '<span class="gstep" data-key="' + esc(key) + '" data-pid="' + esc(pid) + '">' +
      '<button type="button" class="gminus" aria-label="' + esc('פחות ' + label) + '">−</button>' +
      '<output>' + n + '</output>' +
      '<button type="button" class="gplus" aria-label="' + esc('עוד ' + label) + '">+</button></span>';
  }
  function counters(s, r) {
    if (!perPerson(s, r)) return '<div class="gqty">' + stepper(r.key, '', qtyOf(s, r.key), r.name) + '</div>';
    if (!openPer[r.key] && !s.pq[r.key]) {
      return '<div class="gqty"><span class="glab">לכל אחד</span>' + stepper(r.key, '', qtyOf(s, r.key), r.name + ' לכל אחד') +
        '<button type="button" class="btn-link gper" data-key="' + esc(r.key) + '">לפי אדם</button></div>';
    }
    return '<div class="gqty gper-open">' + s.people.map(function (p) {
      return '<span class="gpp"><span class="glab">' + esc(p.name) + '</span>' +
        stepper(r.key, p.pid, countFor(s, r.key, p.pid), r.name + ' ל' + p.name) + '</span>';
    }).join('') + '<button type="button" class="btn-link gsame" data-key="' + esc(r.key) + '">אותו מספר לכולם</button></div>';
  }
  function sectionBlock(name, lis, counter, open) {
    return '<details class="gsec" data-sec="' + esc(name) + '"' + (open ? ' open' : '') + '><summary><span>' + esc(name) + '</span> <small class="gcount">' + counter + '</small></summary>' +
      '<ul class="glist">' + lis.join('') + '</ul></details>';
  }

  function renderPick() {
    var s = state(), words = searchWords_($('gear-q').value), filtering = words.length > 0 || !!tag;
    var rows = generalRows().concat(ownRows(s)), secs = allSections(rows), shown = 0, html = '';
    secs.forEach(function (sec) {
      var inSec = rows.filter(function (r) { return r.section === sec; });
      var vis = inSec.filter(function (r) { return matches(r, words); });
      if (!vis.length) return;
      shown += vis.length;
      var picked = inSec.filter(function (r) { return isPicked(s, r); }).length;
      html += sectionBlock(sec, vis.map(function (r) {
        var on = isPicked(s, r);
        return itemRow(r, on, 'gp-', (r.own ? ' <span class="b">' + badge(r.own) + '</span>' +
          ' <button type="button" class="btn-link gdrop" data-cid="' + esc(r.own.cid) + '">הסרה</button>' : '') +
          (on ? counters(s, r) : ''));
      }), picked + '/' + inSec.length, filtering || openSecs[sec]);   // a search opens every section it found
    });
    $('gear-pick-list').innerHTML = html;
    var allOpen = secs.every(function (sec) { return openSecs[sec]; });
    $('gear-expand').textContent = allOpen ? 'סגירת כל הקטגוריות' : 'פתיחת כל הקטגוריות';
    $('gear-expand').hidden = filtering;                       // a search already opens what it found
    var total = rows.length;
    $('gear-count').textContent = shown === total ? total + ' פריטים ברשימה הכללית.'
      : !shown ? 'לא נמצאו פריטים. נסו מילה אחרת, או בטלו את הסינון.'
      : 'נמצאו ' + shown + ' מתוך ' + total + ' פריטים.';
  }

  // What to pack: one line per item, and for a לכל אחד item one line per person who needs it. Filtered by "who".
  function packLines(s) {
    var out = [];
    myRows(s).forEach(function (r) {
      if (perPerson(s, r)) {
        s.people.forEach(function (p) {
          var n = countFor(s, r.key, p.pid);
          if (n > 0) out.push({ key: r.key + '@' + p.pid, row: r, person: p, n: n });
        });
      } else out.push({ key: r.key, row: r, n: qtyOf(s, r.key) });
    });
    if (who && who !== '_' && !s.people.some(function (p) { return p.pid === who; })) who = '';
    return out.filter(function (l) { return !who || (who === '_' ? !l.person : !!l.person && l.person.pid === who); });
  }
  function lineSuffix(l) { return (l.person ? ' · ' + l.person.name : '') + (l.n > 1 ? ' ×' + l.n : ''); }
  function renderWho(s) {
    var box = $('gear-who');
    box.hidden = !s.people.length;
    if (!s.people.length) { box.innerHTML = ''; who = ''; return; }
    box.innerHTML = [['', 'כולם'], ['_', 'משותף']].concat(s.people.map(function (p) { return [p.pid, p.name]; })).map(function (w) {
      return '<button type="button" class="chip" aria-pressed="' + (w[0] === who) + '" data-who="' + esc(w[0]) + '">' + esc(w[1]) + '</button>';
    }).join('');
  }
  function renderMine() {
    var s = state(), all = myRows(s).length, lines = packLines(s), html = '', packed = 0;
    renderWho(s);
    allSections(lines.map(function (l) { return l.row; })).forEach(function (sec) {
      var inSec = lines.filter(function (l) { return l.row.section === sec; });
      if (!inSec.length) return;
      var todo = inSec.filter(function (l) { return !s.packed[l.key]; }), done = inSec.filter(function (l) { return s.packed[l.key]; });
      packed += done.length;
      html += sectionBlock(sec, todo.concat(done).map(function (l) {
        var suf = lineSuffix(l), more = suf ? '<span class="gsuf">' + esc(suf) + '</span>' : '';
        return itemRow(l.row, !!s.packed[l.key], 'gm-', l.row.own ? ' <span class="b">' + badge(l.row.own) + '</span>' : '', l.key, more);
      }), done.length + '/' + inSec.length, true);
    });
    $('gear-mine-list').innerHTML = html;
    var n = lines.length;
    $('gear-mine-empty').hidden = all > 0;
    $('gear-progress').hidden = n === 0;
    $('gear-mine-tools').hidden = n === 0;
    $('gear-progress-text').textContent = 'ארוזים ' + packed + ' מתוך ' + n;
    $('gear-progress-bar').max = n || 1; $('gear-progress-bar').value = packed;
  }

  function renderPeople() {
    $('gear-people-list').innerHTML = state().people.map(function (p) {
      return '<li class="chip gpchip">' + esc(p.name) + ' <button type="button" class="gpdel" data-pid="' + esc(p.pid) + '"' +
        ' aria-label="' + esc('הסרת ' + p.name) + '">×</button></li>';
    }).join('');
  }
  function renderCounts() {
    var n = myRows(state()).length;
    $('gear-view-mine').textContent = 'הרשימה שלי (' + n + ')';
  }
  function render() {
    renderCounts(); renderPeople();
    if (view === 'pick') renderPick(); else renderMine();
  }
  // A background change (a send finished) must not steal focus from someone typing in the form.
  var renderTimer = null;
  function renderSoon() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 50); }

  function setView(v) {
    view = v;
    $('gear-view-pick').setAttribute('aria-pressed', v === 'pick');
    $('gear-view-mine').setAttribute('aria-pressed', v === 'mine');
    $('gear-pick').hidden = v !== 'pick';
    $('gear-mine').hidden = v !== 'mine';
    $('gear-filters').hidden = v !== 'pick';
    render();
  }

  function renderTags() {
    var seen = {}, list = [];
    items.forEach(function (it) { it.tags.forEach(function (t) { if (!seen[t]) { seen[t] = 1; list.push(t); } }); });
    if (tag && !seen[tag]) tag = '';
    $('gear-tags').innerHTML = list.map(function (t) {
      return '<button type="button" class="chip" aria-pressed="' + (t === tag) + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>';
    }).join('');
  }
  function fillSections() {
    // the server's own sections, so a script not yet updated is offered only names it accepts; a section typed
    // by hand in the sheet is left out (the script would refuse it)
    var list = sections.filter(function (c) { return GEAR_SECTIONS_.indexOf(c) >= 0 || GEAR_SECTION_RENAMES_[c]; });
    var v = $('gear-new-sec').value;
    $('gear-new-sec').innerHTML = '<option value="">בחרו קטגוריה</option>' + list.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
    $('gear-new-sec').value = v;
  }

  // The search sits in the fixed bar, so it can be used from deep in the list. When the results are
  // shorter than the scroll position, bring their top back to just under the bar.
  function toListTop() {
    var bar = $('gear-bar').getBoundingClientRect(), list = $('gear-pick').getBoundingClientRect();
    if (list.top < bar.bottom) window.scrollBy(0, list.top - bar.bottom);
  }

  // ---------- copy / share ----------
  function listText() {
    var s = state(), lines = packLines(s), person = s.people.filter(function (p) { return p.pid === who; })[0];
    var out = ['רשימת ציוד — אכזיב אוקטובר 2026' + (person ? ' — ' + person.name : who === '_' ? ' — משותף' : '')];
    allSections(lines.map(function (l) { return l.row; })).forEach(function (sec) {
      var inSec = lines.filter(function (l) { return l.row.section === sec; });
      if (!inSec.length) return;
      out.push('', sec + ':');
      inSec.forEach(function (l) { out.push((s.packed[l.key] ? '✓ ' : '☐ ') + l.row.name + lineSuffix(l)); });
    });
    return out.join('\n');
  }

  // ---------- events ----------
  function init() {
    fillSections(); renderTags();
    $('gear-view-pick').addEventListener('click', function () { setView('pick'); });
    $('gear-view-mine').addEventListener('click', function () { setView('mine'); });
    $('gear-q').addEventListener('input', function () { renderPick(); toListTop(); });
    $('gear-tags').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-tag]');
      if (!b) return;
      var t = b.getAttribute('data-tag');
      tag = tag === t ? '' : t;
      renderTags(); renderPick(); toListTop();
    });
    // remember what was opened by hand, so a redraw keeps it (not while a search opens everything)
    $('gear-pick-list').addEventListener('toggle', function (e) {
      var d = e.target;
      if (!d.classList || !d.classList.contains('gsec') || searchWords_($('gear-q').value).length || tag) return;
      openSecs[d.getAttribute('data-sec')] = d.open;
      var secs = allSections(generalRows().concat(ownRows(state())));
      $('gear-expand').textContent = secs.every(function (sec) { return openSecs[sec]; }) ? 'סגירת כל הקטגוריות' : 'פתיחת כל הקטגוריות';
    }, true);
    $('gear-expand').addEventListener('click', function () {
      var secs = allSections(generalRows().concat(ownRows(state())));
      var open = !secs.every(function (sec) { return openSecs[sec]; });
      secs.forEach(function (sec) { openSecs[sec] = open; });
      renderPick();
    });
    $('gear-clear').addEventListener('click', function () {
      if (!window.confirm('לנקות את כל הבחירות מהרשימה הכללית? פריטים אישיים שהוספתם נשארים.')) return;
      var s = state();
      s.picked = {};
      [s.packed, s.qty, s.pq].forEach(function (m) { Object.keys(m).forEach(function (k) { if (k.charAt(0) === 'g') delete m[k]; }); });
      save(s); render();
      say($('gear-pick-msg'), 'הבחירות נוקו.', 'good');
    });
    $('gear-basic').addEventListener('click', function () {
      var s = state(), n = 0;
      items.forEach(function (it) { if (it.tags.indexOf(BASIC) >= 0 && !s.picked[it.id]) { s.picked[it.id] = 1; n++; } });
      save(s); render();
      say($('gear-pick-msg'), n ? 'נוספו ' + n + ' פריטים בסיסיים לרשימה שלכם.' : 'כל הפריטים הבסיסיים כבר ברשימה שלכם.', 'good');
    });

    // picking (general list): a picked item shows its counter, so redraw (the part above it does not change,
    // so the page does not jump) and keep the focus on the box
    $('gear-pick-list').addEventListener('change', function (e) {
      var li = e.target.closest('li[data-key]'); if (!li) return;
      var key = li.getAttribute('data-key'), s = state();
      if (key.charAt(0) !== 'g') { e.target.checked = true; return; }        // own items: removed with "הסרה"
      var id = +key.slice(1);
      if (e.target.checked) s.picked[id] = 1; else { delete s.picked[id]; forget(s, key); }
      save(s); renderPick(); renderCounts();
      var again = $('gp-' + key); if (again) again.focus();
    });
    function refocus(sel) { var el = $('gear-pick-list').querySelector(sel); if (el) el.focus(); }
    $('gear-pick-list').addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.gdrop, .gminus, .gplus, .gper, .gsame');
      if (!t) return;
      var s = state(), key = t.getAttribute('data-key') || '';
      if (t.classList.contains('gdrop')) {
        var cid = t.getAttribute('data-cid');
        s.custom = s.custom.filter(function (c) { return c.cid !== cid; });
        forget(s, 'c' + cid);
        save(s); render(); return;
      }
      if (t.classList.contains('gper')) { openPer[key] = true; renderPick(); refocus('.gstep[data-key="' + key + '"] .gplus'); return; }
      if (t.classList.contains('gsame')) {
        var m = s.pq[key] || {}, vals = Object.keys(m).map(function (k) { return m[k]; });
        var v = lastCount[key] || Math.max.apply(null, vals.concat([qtyOf(s, key)]));
        if (v > 0) s.qty[key] = v;
        if (s.qty[key] === 1) delete s.qty[key];
        delete s.pq[key]; openPer[key] = false;
        save(s); renderPick();
        refocus('.gper[data-key="' + key + '"]');
        say($('gear-pick-msg'), v + ' לכל אחד.', 'good');
        return;
      }
      // − / +
      var step = t.closest('.gstep'), pid = step.getAttribute('data-pid'), d = t.classList.contains('gplus') ? 1 : -1;
      key = step.getAttribute('data-key');
      var n;
      if (pid) {
        var map = s.pq[key] || {};
        s.people.forEach(function (p) { if (!(p.pid in map)) map[p.pid] = qtyOf(s, key); });
        n = map[pid] = Math.max(0, Math.min(QMAX, map[pid] + d));
        s.pq[key] = map;
      } else {
        n = Math.max(1, Math.min(QMAX, qtyOf(s, key) + d));
        if (n === 1) delete s.qty[key]; else s.qty[key] = n;
      }
      lastCount[key] = n;
      save(s); renderPick();
      refocus('.gstep[data-key="' + key + '"][data-pid="' + pid + '"] .' + (d > 0 ? 'gplus' : 'gminus'));
    });

    // family members
    $('gear-person-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('gear-people-msg'), name = clean($('gear-person-name').value).slice(0, 20), s = state();
      if (!name) { say(msg, 'כתבו שם.', 'bad'); $('gear-person-name').focus(); return; }
      if (s.people.some(function (p) { return p.name === name; })) { say(msg, name + ' כבר ברשימה.', 'bad'); return; }
      s.people.push({ pid: newCid().slice(0, 8), name: name });
      save(s);
      $('gear-person-name').value = '';
      say(msg, '', '');
      render();
    });
    $('gear-people-list').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.gpdel');
      if (!b) return;
      var s = state(), pid = b.getAttribute('data-pid');
      s.people = s.people.filter(function (p) { return p.pid !== pid; });
      Object.keys(s.pq).forEach(function (k) { delete s.pq[k][pid]; if (!Object.keys(s.pq[k]).length) delete s.pq[k]; });
      Object.keys(s.packed).forEach(function (k) { if (k.slice(-(pid.length + 1)) === '@' + pid) delete s.packed[k]; });
      save(s); render();
      $('gear-person-name').focus();
    });

    // packing: the item moves to the bottom of its section; focus follows it
    $('gear-mine-list').addEventListener('change', function (e) {
      var li = e.target.closest('li[data-key]'); if (!li) return;
      var key = li.getAttribute('data-key'), s = state();
      if (e.target.checked) s.packed[key] = 1; else delete s.packed[key];
      save(s); renderMine();
      var again = $('gm-' + key); if (again) again.focus();
    });
    $('gear-who').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-who]');
      if (!b) return;
      who = b.getAttribute('data-who');
      renderMine();
      var again = $('gear-who').querySelector('[data-who="' + who + '"]'); if (again) again.focus();
    });
    $('gear-reset').addEventListener('click', function () {
      if (!window.confirm('לנקות את כל סימוני "ארוז"? הפריטים עצמם נשארים ברשימה.')) return;
      var s = state(); s.packed = {}; save(s); renderMine();
    });
    $('gear-copy').addEventListener('click', function () {
      var t = listText(), msg = $('gear-mine-msg');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { say(msg, 'הרשימה הועתקה.', 'good'); },
                                               function () { say(msg, 'לא הצלחתי להעתיק. נסו את וואטסאפ.', 'bad'); });
      } else say(msg, 'לא הצלחתי להעתיק. נסו את וואטסאפ.', 'bad');
    });
    $('gear-wa').addEventListener('click', function () {
      $('gear-wa').href = 'https://wa.me/?text=' + encodeURIComponent(listText());
    });

    // own item: on my list at once, suggested in the background
    $('gear-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var msg = $('gear-form-msg'), sec = $('gear-new-sec').value, name = clean($('gear-new-name').value);
      if (!sec) { say(msg, 'בחרו קטגוריה.', 'bad'); $('gear-new-sec').focus(); return; }
      if (name.length < 2) { say(msg, 'כתבו את שם הפריט.', 'bad'); $('gear-new-name').focus(); return; }
      var cid = newCid(), s = state();
      s.custom.push({ cid: cid, id: null, section: sec, name: name, at: Date.now(),
                      body: { action: 'submitGear', clientId: cid, section: sec, name: name, hp: $('gear-hp').value } });
      save(s);
      $('gear-new-name').value = '';
      openSecs[sec] = true;                                   // show where it landed
      render();
      say(msg, '"' + name + '" נוסף לרשימה שלכם, ונשלח למארגן כהצעה לרשימה הכללית.', 'good');
      flush();
    });
  }

  // ---------- data: cached copy (or the starter list) at once, fresh copy in the background ----------
  function show(res) {
    var same = JSON.stringify(res.items) === JSON.stringify(items);
    items = res.items || [];
    sections = res.sections && res.sections.length ? res.sections : GEAR_SECTIONS_.slice();
    merge();
    if (same) return;
    renderTags(); fillSections();
    // someone typing a search keeps their place: only the counters and the list under it change
    render();
  }
  function start() {
    if (started) return;
    started = true;
    var cached = readJson(CACHE_KEY);
    if (cached && cached.items) show(cached);
    if (!C.apiUrl) return;
    A.api({ action: 'gear' }).then(function (res) {
      if (res.ok) { writeJson(CACHE_KEY, { sections: res.sections, items: res.items }); live = true; show(res); flush(); return; }
      // the live script before the gear version answers "bad_request": the starter list stays, own items
      // wait in the outbox. Anything else: try again on the next opening of the tab.
      if (res.error !== 'bad_request') started = false;
    });
  }

  init();
  render();
  $('tab-gear').addEventListener('click', start);
  $('tab-gear').addEventListener('focus', start);
  if (!$('panel-gear').hidden) start();
  else if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 1500);
})();
