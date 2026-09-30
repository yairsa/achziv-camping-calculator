// Equipment tab (docs/gear-plan.md): pick items from the general list, then pack them.
// Uses api()/esc() from app.js, the word search in search.js and the starter list in gear-seed.js.
//
// Everything personal stays in this browser (localStorage): picks, packing marks, own items.
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
  var BASIC = 'בסיסי';
  var sections = GEAR_SECTIONS_.slice(), items = seedItems(), live = false, started = false;
  var view = 'pick', tag = '';
  function $(id) { return document.getElementById(id); }
  function say(p, text, kind) { p.textContent = text; p.className = 'msg' + (kind ? ' ' + kind : ''); }
  function clean(s) { return String(s || '').trim().replace(/\s+/g, ' '); }
  function newCid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function readJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  function seedItems() {
    return GEAR_SEED_.map(function (g, i) {
      return { id: i + 1, section: g[0], name: g[1], note: g[3],
               tags: String(g[2]).split(',').map(function (t) { return t.trim(); }).filter(Boolean) };
    });
  }

  // ---------- this browser's list ----------
  function state() {
    var s = readJson(KEY);
    if (!s || typeof s !== 'object') s = {};
    s.picked = s.picked || {}; s.packed = s.packed || {}; s.custom = s.custom || [];
    return s;
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
      delete s.packed['c' + c.cid];
      return false;
    });
    if (s.custom.length !== before) save(s);
  }

  // All entries of one kind as rows: {key, section, name, note, tags, own?}
  function generalRows() {
    return items.map(function (it) { return { key: 'g' + it.id, id: it.id, section: it.section, name: it.name, note: it.note, tags: it.tags }; });
  }
  function ownRows(s) {
    return s.custom.map(function (c) { return { key: 'c' + c.cid, own: c, section: c.section, name: c.name, note: '', tags: [] }; });
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
  function itemRow(r, checked, prefix, extra) {
    var id = prefix + r.key;
    return '<li class="gitem' + (checked && prefix === 'gm-' ? ' packed' : '') + '" data-key="' + esc(r.key) + '">' +
      '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '>' +
      '<label for="' + id + '"><span class="gname">' + esc(r.name) + '</span>' +
      (r.note ? ' <small class="gnote">' + esc(r.note) + '</small>' : '') + '</label>' +
      (extra || '') + '</li>';
  }
  function sectionBlock(name, lis, counter) {
    return '<details class="gsec" open><summary><span>' + esc(name) + '</span> <small class="gcount">' + counter + '</small></summary>' +
      '<ul class="glist">' + lis.join('') + '</ul></details>';
  }

  function renderPick() {
    var s = state(), words = searchWords_($('gear-q').value);
    var rows = generalRows().concat(ownRows(s)), secs = allSections(rows), shown = 0, html = '';
    secs.forEach(function (sec) {
      var inSec = rows.filter(function (r) { return r.section === sec; });
      var vis = inSec.filter(function (r) { return matches(r, words); });
      if (!vis.length) return;
      shown += vis.length;
      var picked = inSec.filter(function (r) { return isPicked(s, r); }).length;
      html += sectionBlock(sec, vis.map(function (r) {
        return itemRow(r, isPicked(s, r), 'gp-', r.own ? ' <span class="b">' + badge(r.own) + '</span>' +
          ' <button type="button" class="btn-link gdrop" data-cid="' + esc(r.own.cid) + '">הסרה</button>' : '');
      }), picked + '/' + inSec.length);
    });
    $('gear-pick-list').innerHTML = html;
    var total = rows.length;
    $('gear-count').textContent = shown === total ? total + ' פריטים ברשימה הכללית.'
      : !shown ? 'לא נמצאו פריטים. נסו מילה אחרת, או בטלו את הסינון.'
      : 'נמצאו ' + shown + ' מתוך ' + total + ' פריטים.';
  }

  function renderMine() {
    var s = state(), rows = myRows(s), secs = allSections(rows), html = '', packed = 0;
    secs.forEach(function (sec) {
      var inSec = rows.filter(function (r) { return r.section === sec; });
      if (!inSec.length) return;
      var todo = inSec.filter(function (r) { return !s.packed[r.key]; }), done = inSec.filter(function (r) { return s.packed[r.key]; });
      packed += done.length;
      html += sectionBlock(sec, todo.concat(done).map(function (r) {
        return itemRow(r, !!s.packed[r.key], 'gm-', r.own ? ' <span class="b">' + badge(r.own) + '</span>' : '');
      }), done.length + '/' + inSec.length);
    });
    $('gear-mine-list').innerHTML = html;
    var n = rows.length;
    $('gear-mine-empty').hidden = n > 0;
    $('gear-progress').hidden = n === 0;
    $('gear-mine-tools').hidden = n === 0;
    $('gear-progress-text').textContent = 'ארוזים ' + packed + ' מתוך ' + n;
    $('gear-progress-bar').max = n || 1; $('gear-progress-bar').value = packed;
  }

  function renderCounts() {
    var n = myRows(state()).length;
    $('gear-view-mine').textContent = 'הרשימה שלי (' + n + ')';
  }
  function render() {
    renderCounts();
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
    var v = $('gear-new-sec').value;
    $('gear-new-sec').innerHTML = '<option value="">בחרו קטגוריה</option>' + GEAR_SECTIONS_.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
    $('gear-new-sec').value = v;
  }

  // ---------- copy / share ----------
  function listText() {
    var s = state(), rows = myRows(s), out = ['רשימת ציוד — אכזיב אוקטובר 2026'];
    allSections(rows).forEach(function (sec) {
      var inSec = rows.filter(function (r) { return r.section === sec; });
      if (!inSec.length) return;
      out.push('', sec + ':');
      inSec.forEach(function (r) { out.push((s.packed[r.key] ? '✓ ' : '☐ ') + r.name); });
    });
    return out.join('\n');
  }

  // ---------- events ----------
  function init() {
    fillSections(); renderTags();
    $('gear-view-pick').addEventListener('click', function () { setView('pick'); });
    $('gear-view-mine').addEventListener('click', function () { setView('mine'); });
    $('gear-q').addEventListener('input', renderPick);
    $('gear-tags').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-tag]');
      if (!b) return;
      var t = b.getAttribute('data-tag');
      tag = tag === t ? '' : t;
      renderTags(); renderPick();
    });
    $('gear-basic').addEventListener('click', function () {
      var s = state(), n = 0;
      items.forEach(function (it) { if (it.tags.indexOf(BASIC) >= 0 && !s.picked[it.id]) { s.picked[it.id] = 1; n++; } });
      save(s); render();
      say($('gear-pick-msg'), n ? 'נוספו ' + n + ' פריטים בסיסיים לרשימה שלכם.' : 'כל הפריטים הבסיסיים כבר ברשימה שלכם.', 'good');
    });

    // picking (general list): update the counters in place, so the list does not jump
    $('gear-pick-list').addEventListener('change', function (e) {
      var li = e.target.closest('li[data-key]'); if (!li) return;
      var key = li.getAttribute('data-key'), s = state();
      if (key.charAt(0) !== 'g') { e.target.checked = true; return; }        // own items: removed with "הסרה"
      var id = +key.slice(1);
      if (e.target.checked) s.picked[id] = 1; else { delete s.picked[id]; delete s.packed[key]; }
      save(s);
      var sec = li.closest('.gsec'), boxes = sec.querySelectorAll('input[type=checkbox]');
      var on = 0; boxes.forEach(function (b) { if (b.checked) on++; });
      var c = sec.querySelector('.gcount'), total = c.textContent.split('/')[1];
      if (!$('gear-q').value.trim() && !tag) c.textContent = on + '/' + total;
      else { renderPick(); var again = $('gp-' + key); if (again) again.focus(); }
      renderCounts();
    });
    $('gear-pick-list').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.gdrop');
      if (!b) return;
      var s = state(), cid = b.getAttribute('data-cid');
      s.custom = s.custom.filter(function (c) { return c.cid !== cid; });
      delete s.packed['c' + cid];
      save(s); render();
    });

    // packing: the item moves to the bottom of its section; focus follows it
    $('gear-mine-list').addEventListener('change', function (e) {
      var li = e.target.closest('li[data-key]'); if (!li) return;
      var key = li.getAttribute('data-key'), s = state();
      if (e.target.checked) s.packed[key] = 1; else delete s.packed[key];
      save(s); renderMine();
      var again = $('gm-' + key); if (again) again.focus();
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
    renderTags();
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
