// Tips tab: approved tips from the sheet, word search + category filter, write a tip, comment on a tip.
// Nothing appears until Yair approves it, so this browser remembers what it sent and shows it as
// "ממתין לאישור" until it comes back approved. Uses api()/esc() from app.js and the matcher in search.js.
(function () {
  'use strict';
  var C = window.CAMP, A = window.CampApi, esc = A.esc;
  var MINE_KEY = 'achziv-tips-mine';
  var KEEP_MS = 21 * 86400000;      // a rejected or merged submission stops showing as pending after 3 weeks
  var SHOW_COMMENTS = 3;
  var ERR = {
    too_short: 'הטקסט קצר מדי.',
    too_long: 'הטקסט ארוך מדי.',
    bad_category: 'בחרו קטגוריה.',
    busy: 'יש כרגע הרבה טיפים ותגובות שממתינים לאישור. נסו שוב מחר.',
    not_found: 'הטיפ הזה כבר לא מופיע באתר.',
    bad_request: 'הטיפים עוד לא הופעלו באתר. נסו שוב בעוד כמה ימים.',
    network: 'אין חיבור לשרת כרגע. מה שכתבתם נשאר בטופס — נסו לשלוח שוב בעוד רגע.'
  };
  var tips = [], loaded = false, loading = false;
  function $(id) { return document.getElementById(id); }
  function errText(res) { return ERR[res.error] || 'משהו השתבש. נסו שוב.'; }
  function say(p, text, kind) { p.textContent = text; p.className = 'msg' + (kind ? ' ' + kind : ''); }
  function clean(s) { return String(s || '').trim(); }

  // A retry of the same content reuses its id, so the backend finds its own row instead of adding a second.
  function clientId(holder, content) {
    if (holder._cid && holder._cidFor === content) return holder._cid;
    holder._cidFor = content;
    return (holder._cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  }

  // ---------- this browser's own submissions ----------
  function mine() {
    var m = null;
    try { m = JSON.parse(localStorage.getItem(MINE_KEY)); } catch (e) { /* no storage */ }
    if (!m || !m.tips || !m.comments) m = { tips: [], comments: [] };
    var cut = Date.now() - KEEP_MS;
    m.tips = m.tips.filter(function (x) { return x.at > cut; });
    m.comments = m.comments.filter(function (x) { return x.at > cut; });
    return m;
  }
  function saveMine(m) { try { localStorage.setItem(MINE_KEY, JSON.stringify(m)); } catch (e) { /* ignore */ } }
  // Drop what has come back approved: from now on the public list shows it.
  function prune() {
    var t = {}, c = {}, m = mine();
    tips.forEach(function (x) { t[x.id] = true; (x.comments || []).forEach(function (y) { c[y.id] = true; }); });
    m.tips = m.tips.filter(function (x) { return !t[x.id]; });
    m.comments = m.comments.filter(function (x) { return !c[x.id]; });
    saveMine(m);
  }

  // ---------- rendering ----------
  function by(author) { return author ? ' <small class="by">— ' + esc(author) + '</small>' : ''; }
  var PENDING = '<span class="pending-badge">ממתין לאישור</span>';

  function commentItem(c, pending, hide) {
    return '<li' + (pending ? ' class="pending"' : '') + (hide ? ' hidden' : '') + '>' +
      (pending ? PENDING + ' ' : '') + '<span class="ctext">' + esc(c.text) + '</span>' + by(c.author) + '</li>';
  }

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
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; say(msg, 'שולח…');
      var body = { action: 'submitComment', tipId: k, text: text, author: author, hp: form.querySelector('.chp').value };
      body.clientId = clientId(form, JSON.stringify(body));
      A.api(body).then(function (res) {
        btn.disabled = false;
        if (!res.ok) return say(msg, errText(res), 'bad');
        form._cid = null;
        var c = { id: res.id, tipId: k, text: text, author: author, at: Date.now() };
        if (res.id) { var m = mine(); m.comments.push(c); saveMine(m); }
        card.querySelector('.clist').insertAdjacentHTML('beforeend', commentItem(c, true));
        form.reset(); form.hidden = true; add.setAttribute('aria-expanded', 'false');
        say(msg, 'התגובה נשלחה ותופיע לכולם אחרי אישור.', 'good');
      });
    });
    return card;
  }

  function renderMine() {
    var box = $('tips-mine'), m = mine();
    if (!m.tips.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="card mine"><h2>נשלח מהמכשיר הזה</h2>' +
      '<p class="hint">רק אתם רואים את אלה עד שהמארגן יאשר אותם.</p>' +
      m.tips.map(function (t) {
        return '<div class="tcard pending">' + PENDING + ' <span class="tcat">' + esc(t.category) + '</span>' +
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
    var n = {};
    tips.forEach(function (t) { n[t.category] = (n[t.category] || 0) + 1; });
    $('tips-cat').innerHTML = '<option value="">הכל</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + (n[c] ? ' (' + n[c] + ')' : '') + '</option>';
    }).join('');
    $('tip-cat').innerHTML = '<option value="">בחרו קטגוריה</option>' + cats.map(function (c) {
      return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
    }).join('');
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
      var btn = form.querySelector('button[type=submit]');
      btn.disabled = true; say(msg, 'שולח…');
      var body = { action: 'submitTip', category: cat, title: title, text: text, author: clean($('tip-author').value), hp: $('tip-hp').value };
      body.clientId = clientId(form, JSON.stringify(body));
      A.api(body).then(function (res) {
        btn.disabled = false;
        if (!res.ok) return say(msg, errText(res), 'bad');
        form._cid = null;
        if (res.id) {
          var m = mine();
          m.tips.push({ id: res.id, category: cat, title: title, text: text, author: body.author, at: Date.now() });
          saveMine(m);
        }
        form.reset(); left(); showSimilar(); renderMine();
        say(msg, 'הטיפ נשלח! הוא יופיע לכולם אחרי אישור. בינתיים הוא מופיע למעלה, רק אצלכם.', 'good');
      });
    });
  }

  // ---------- load (on first visit to the tab) ----------
  function load() {
    if (loaded || loading) return;
    var state = $('tips-state');
    if (!C.apiUrl) { say(state, 'הטיפים עדיין לא פעילים.'); return; }
    loading = true; say(state, 'טוען טיפים…');
    A.api({ action: 'tips' }).then(function (res) {
      loading = false;
      if (!res.ok) {
        // the live script before the tips version answers "bad_request": say so calmly, no error colour
        say(state, res.error === 'bad_request' ? 'הטיפים יופעלו כאן בקרוב.' : errText(res), res.error === 'bad_request' ? '' : 'bad');
        return;
      }
      loaded = true;
      tips = res.tips || [];
      prune();
      fillCategories(res.categories || []);
      say(state, '');
      $('tips-tools').hidden = false; $('tip-write').hidden = false;
      render();
    });
  }

  initForm();
  $('tips-q').addEventListener('input', render);
  $('tips-cat').addEventListener('change', render);
  $('tab-tips').addEventListener('click', load);
  $('tab-tips').addEventListener('focus', load);
  if (!$('panel-tips').hidden) load();
})();
