// Tips tab: approved tips from the sheet, word search + category filter, write a tip, comment on a tip.
// Uses api()/esc() from app.js and the matcher in search.js.
//
// Fast on the client, the server in the background:
// - The last good tips list is cached in this browser and shown at once; a fresh copy is fetched in the
//   background (prefetched after page load, so the tab is ready before it is opened).
// - A submitted tip or comment appears at once as pending and goes into an outbox kept in localStorage.
//   The outbox is sent in the background, retried until the server answers, and resumed on the next visit
//   if the page was closed. The client id makes every resend land on the same row.
(function () {
  'use strict';
  var C = window.CAMP, A = window.CampApi, esc = A.esc;
  var MINE_KEY = 'achziv-tips-mine', CACHE_KEY = 'achziv-tips-cache';
  var KEEP_MS = 21 * 86400000;      // a rejected or merged submission stops showing as pending after 3 weeks
  var SHOW_COMMENTS = 3;
  // Errors a resend cannot fix. Anything else (network, server_error, busy, bad_request from the script
  // before the tips version) stays in the outbox and is retried later.
  var FINAL = { too_short: 'הטקסט קצר מדי', too_long: 'הטקסט ארוך מדי', bad_category: 'קטגוריה לא מוכרת',
                not_found: 'הטיפ כבר לא מופיע באתר' };
  var tips = [], started = false, live = false;
  function $(id) { return document.getElementById(id); }
  function say(p, text, kind) { p.textContent = text; p.className = 'msg' + (kind ? ' ' + kind : ''); }
  function clean(s) { return String(s || '').trim(); }
  function newCid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function readJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  // ---------- this browser's own submissions (also the outbox: id == null and not failed) ----------
  function mine() {
    var m = readJson(MINE_KEY);
    if (!m || !m.tips || !m.comments) m = { tips: [], comments: [] };
    var cut = Date.now() - KEEP_MS;
    function keep(x) { return x.at > cut && x.cid; }      // entries from before the outbox had no cid
    m.tips = m.tips.filter(keep); m.comments = m.comments.filter(keep);
    return m;
  }
  function saveMine(m) { writeJson(MINE_KEY, m); }
  function edit(cid, fn) {                                   // re-read, change one entry, save
    var m = mine();
    m.tips.concat(m.comments).forEach(function (x) { if (x.cid === cid) fn(x); });
    saveMine(m);
  }
  function drop(cid) {
    var m = mine();
    m.tips = m.tips.filter(function (x) { return x.cid !== cid; });
    m.comments = m.comments.filter(function (x) { return x.cid !== cid; });
    saveMine(m);
  }
  // Drop what has come back approved: from now on the public list shows it.
  function prune() {
    var t = {}, c = {}, m = mine();
    tips.forEach(function (x) { t[x.id] = true; (x.comments || []).forEach(function (y) { c[y.id] = true; }); });
    m.tips = m.tips.filter(function (x) { return !(x.id && t[x.id]); });
    m.comments = m.comments.filter(function (x) { return !(x.id && c[x.id]); });
    saveMine(m);
  }

  // ---------- outbox ----------
  var flushing = false, retryTimer = null, retryDelay = 5000;
  function flush() {
    if (flushing || !C.apiUrl) return;
    var m = mine();
    var next = m.tips.concat(m.comments).filter(function (x) { return !x.id && !x.failed; })
      .sort(function (a, b) { return a.at - b.at; })[0];
    if (!next) return;
    flushing = true;
    A.api(next.body).then(function (res) {
      flushing = false;
      if (res.ok) {
        retryDelay = 5000;
        if (res.id) edit(next.cid, function (x) { x.id = res.id; delete x.body; });
        else drop(next.cid);                                  // the bot trap answered: nothing was stored
        badges(); flush();
      } else if (FINAL[res.error]) {
        edit(next.cid, function (x) { x.failed = res.error; });
        badges(); flush();
      } else {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(flush, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 120000);
      }
    });
  }
  window.addEventListener('online', flush);

  // ---------- rendering ----------
  function by(author) { return author ? ' <small class="by">— ' + esc(author) + '</small>' : ''; }
  function badge(x) {
    return x.failed ? '<span class="pending-badge failed">לא נשלח: ' + esc(FINAL[x.failed] || x.failed) + '</span>' +
                      ' <button type="button" class="btn-link drop" data-cid="' + esc(x.cid) + '">הסרה</button>'
         : x.id ? '<span class="pending-badge">ממתין לאישור</span>'
         : '<span class="pending-badge sending">שולח…</span>';
  }
  function commentItem(c, pending, hide) {
    return '<li' + (pending ? ' class="pending" data-cid="' + esc(c.cid) + '"' : '') + (hide ? ' hidden' : '') + '>' +
      (pending ? '<span class="b">' + badge(c) + '</span> ' : '') + '<span class="ctext">' + esc(c.text) + '</span>' + by(c.author) + '</li>';
  }
  // Refresh the pending badges in place (after a background send), without touching open forms.
  function badges() {
    var m = mine(), byCid = {};
    m.comments.forEach(function (c) { byCid[c.cid] = c; });
    document.querySelectorAll('#tips-list li.pending').forEach(function (li) {
      var c = byCid[li.getAttribute('data-cid')];
      if (c) li.querySelector('.b').innerHTML = badge(c); else li.remove();
    });
    renderMine();
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('#panel-tips .drop');
    if (b) { drop(b.getAttribute('data-cid')); badges(); }
  });

  function tipCard(t, myComments) {
    var cs = t.comments || [], older = Math.max(0, cs.length - SHOW_COMMENTS), k = t.id;
    var card = document.createElement('article');
    card.className = 'card tcard'; card.id = 'tip-' + k;
    card.innerHTML =
      '<p class="tcat">' + esc(t.category) + '</p>' +
      '<h3>' + esc(t.title) + '</h3>' +
      '<p class="ttext">' + esc(t.text) + by(t.author) + '</p>' +
      '<div class="comments">' +
        (cs.length ? '<h4>תגובות (' + cs.length + ')</h4>' : '') +
        (older ? '<button type="button" class="btn-link more" aria-expanded="false">עוד ' + older + (older === 1 ? ' תגובה' : ' תגובות') + '</button>' : '') +
        '<ul class="clist">' + cs.map(function (c, i) { return commentItem(c, false, i < older); }).join('') +
          myComments.map(function (c) { return commentItem(c, true); }).join('') + '</ul>' +
        '<button type="button" class="btn-link add-cmt" aria-expanded="false" aria-controls="cf-' + k + '">הוספת תגובה</button>' +
        '<form class="cform" id="cf-' + k + '" novalidate hidden>' +
          '<div class="field"><label for="ct-' + k + '">התגובה שלכם</label>' +
            '<textarea id="ct-' + k + '" rows="3" maxlength="300"></textarea></div>' +
          '<div class="field"><label for="ca-' + k + '">שם (לא חובה)</label>' +
            '<input id="ca-' + k + '" type="text" maxlength="40" autocomplete="off"></div>' +
          '<div class="hp" aria-hidden="true"><label>לא למילוי <input class="chp" type="text" tabindex="-1" autocomplete="off"></label></div>' +
          '<div class="actions"><button type="submit" class="btn-primary">שליחה לאישור</button></div>' +
        '</form>' +
        '<p class="msg" role="status" aria-live="polite"></p>' +
      '</div>';

    var more = card.querySelector('.more');
    if (more) more.addEventListener('click', function () {
      card.querySelectorAll('.clist li[hidden]').forEach(function (li) { li.hidden = false; });
      more.remove();
    });
    var form = card.querySelector('.cform'), add = card.querySelector('.add-cmt'), msg = card.querySelector('.comments > .msg');
    add.addEventListener('click', function () {
      form.hidden = !form.hidden;
      add.setAttribute('aria-expanded', !form.hidden);
      if (!form.hidden) $('ct-' + k).focus();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = clean($('ct-' + k).value), author = clean($('ca-' + k).value);
      if (text.length < 2) { say(msg, 'כתבו תגובה קצרה לפני השליחה.', 'bad'); $('ct-' + k).focus(); return; }
      var cid = newCid();
      var c = { cid: cid, id: null, tipId: k, text: text, author: author, at: Date.now(),
                body: { action: 'submitComment', clientId: cid, tipId: k, text: text, author: author, hp: form.querySelector('.chp').value } };
      var m = mine(); m.comments.push(c); saveMine(m);
      card.querySelector('.clist').insertAdjacentHTML('beforeend', commentItem(c, true));
      form.reset(); form.hidden = true; add.setAttribute('aria-expanded', 'false');
      say(msg, 'התגובה נשלחה ותופיע לכולם אחרי אישור.', 'good');
      flush();
    });
    return card;
  }

  function renderMine() {
    var box = $('tips-mine'), m = mine();
    if (!m.tips.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card mine"><h2>נשלח מהמכשיר הזה</h2>' +
      '<p class="hint">רק אתם רואים את אלה עד שהמארגן יאשר אותם.</p>' +
      m.tips.map(function (t) {
        return '<div class="tcard pending">' + badge(t) + ' <span class="tcat">' + esc(t.category) + '</span>' +
          '<h3>' + esc(t.title) + '</h3><p class="ttext">' + esc(t.text) + by(t.author) + '</p></div>';
      }).join('') + '</div>';
  }

  function render() {
    var q = $('tips-q').value, cat = $('tips-cat').value;
    var list = searchTips_(q, cat ? tips.filter(function (t) { return t.category === cat; }) : tips);
    var box = $('tips-list'), m = mine();
    box.innerHTML = '';
    list.forEach(function (t) {
      box.appendChild(tipCard(t, m.comments.filter(function (c) { return c.tipId === t.id; })));
    });
    $('tips-count').textContent = !tips.length ? 'עוד אין טיפים מאושרים — אפשר לכתוב את הראשון.'
      : list.length === tips.length ? tips.length + (tips.length === 1 ? ' טיפ' : ' טיפים') + '.'
      : !list.length ? 'לא נמצאו טיפים. נסו מילה אחרת, או "הכל" בקטגוריה.'
      : 'נמצאו ' + list.length + ' מתוך ' + tips.length + ' טיפים.';
    renderMine();
  }

  function fillCategories(cats) {
    var n = {}, f = $('tips-cat').value, w = $('tip-cat').value;
    tips.forEach(function (t) { n[t.category] = (n[t.category] || 0) + 1; });
    $('tips-cat').innerHTML = '<option value="">הכל</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + (n[c] ? ' (' + n[c] + ')' : '') + '</option>';
    }).join('');
    $('tip-cat').innerHTML = '<option value="">בחרו קטגוריה</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
    $('tips-cat').value = f; $('tip-cat').value = w;       // a background refresh keeps what was chosen
  }

  // ---------- "maybe it already exists" while writing ----------
  var simTimer = null;
  function showSimilar() {
    var box = $('tip-similar');
    var sims = similarTips_($('tip-title').value, $('tip-text').value, tips, 3)
      .filter(function (s) { return s.score >= 2; });          // one shared word in the text alone is noise
    if (!sims.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.innerHTML = '<p><strong>אולי זה כבר קיים?</strong></p><ul>' + sims.map(function (s) {
      return '<li><span>' + esc(s.tip.title) + '</span> <button type="button" class="btn-link" data-go="' + s.tip.id + '">' +
        'זה כבר קיים — להוסיף תגובה במקום?</button></li>';
    }).join('') + '</ul>';
    box.hidden = false;
  }
  function goComment(id) {
    $('tips-q').value = ''; $('tips-cat').value = ''; render();
    var card = $('tip-' + id); if (!card) return;
    var form = card.querySelector('.cform'), ta = $('ct-' + id), draft = clean($('tip-text').value);
    form.hidden = false; card.querySelector('.add-cmt').setAttribute('aria-expanded', 'true');
    if (!ta.value && draft.length <= 300) ta.value = draft;
    if (!$('ca-' + id).value) $('ca-' + id).value = $('tip-author').value;
    card.scrollIntoView({ block: 'start' });
    ta.focus();
  }

  // ---------- write a tip ----------
  function initForm() {
    var form = $('tip-form'), msg = $('tip-msg');
    function left() { var n = 400 - $('tip-text').value.length; $('tip-left').textContent = 'נשארו ' + n + ' תווים'; }
    left();
    ['tip-title', 'tip-text'].forEach(function (id) {
      $(id).addEventListener('input', function () { clearTimeout(simTimer); simTimer = setTimeout(showSimilar, 250); });
    });
    $('tip-text').addEventListener('input', left);
    $('tip-similar').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-go]');
      if (b) goComment(+b.getAttribute('data-go'));
    });
    $('tips-write-btn').addEventListener('click', function () {
      $('tip-write').scrollIntoView({ block: 'start' });
      $('tip-cat').focus();
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var cat = $('tip-cat').value, title = clean($('tip-title').value), text = clean($('tip-text').value);
      if (!cat) { say(msg, 'בחרו קטגוריה.', 'bad'); $('tip-cat').focus(); return; }
      if (title.length < 3) { say(msg, 'כתבו כותרת קצרה (3 תווים לפחות).', 'bad'); $('tip-title').focus(); return; }
      if (text.length < 5) { say(msg, 'כתבו את הטיפ עצמו (5 תווים לפחות).', 'bad'); $('tip-text').focus(); return; }
      var cid = newCid(), author = clean($('tip-author').value);
      var m = mine();
      m.tips.push({ cid: cid, id: null, category: cat, title: title, text: text, author: author, at: Date.now(),
                    body: { action: 'submitTip', clientId: cid, category: cat, title: title, text: text, author: author, hp: $('tip-hp').value } });
      saveMine(m);
      form.reset(); left(); showSimilar(); renderMine();
      say(msg, 'הטיפ נשלח! הוא יופיע לכולם אחרי אישור. בינתיים הוא מופיע למעלה, רק אצלכם.', 'good');
      flush();
    });
  }

  // ---------- data: cached copy at once, fresh copy in the background ----------
  function show(res) {
    var same = live && JSON.stringify(res.tips) === JSON.stringify(tips);
    tips = res.tips || [];
    prune();
    fillCategories(res.categories || []);
    say($('tips-state'), '');
    $('tips-tools').hidden = false; $('tip-write').hidden = false;
    live = true;
    if (same) return;
    // Someone mid-comment keeps their form: the list redraws on their next search or filter change.
    var busy = document.querySelector('#tips-list .cform:not([hidden])');
    if (busy) { badges(); return; }
    render();
  }
  function start() {
    if (started) return;
    started = true;
    if (!C.apiUrl) { say($('tips-state'), 'הטיפים עדיין לא פעילים.'); return; }
    var cached = readJson(CACHE_KEY);
    if (cached && cached.tips) show(cached);
    A.api({ action: 'tips' }).then(function (res) {
      if (res.ok) { writeJson(CACHE_KEY, { tips: res.tips, categories: res.categories }); show(res); flush(); return; }
      if (live) return;                                    // keep showing the cached copy
      // the live script before the tips version answers "bad_request": say so calmly, no error colour
      if (res.error === 'bad_request') say($('tips-state'), 'הטיפים יופעלו כאן בקרוב.');
      else { say($('tips-state'), 'אין חיבור לשרת כרגע. נסו שוב בעוד רגע.', 'bad'); started = false; }
    });
  }

  initForm();
  $('tips-q').addEventListener('input', render);
  $('tips-cat').addEventListener('change', render);
  $('tab-tips').addEventListener('click', start);
  $('tab-tips').addEventListener('focus', start);
  // Prefetch once the page has settled, so the tab is ready before anyone opens it.
  if (!$('panel-tips').hidden) start();
  else if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 2000 });
  else setTimeout(start, 1200);
})();
