// The managing page (docs/admin-plan.md): organizers review the waiting list from a phone instead of the sheet.
// Login hands back a 7-day token, kept in this phone's localStorage. The last waiting list is cached too and
// shown at once, then refreshed in the background. A decision waits for the server's verdict (it must be
// recorded), then the card leaves the list. Every admin write sets values, so the retry below is harmless.
(function () {
  'use strict';
  var C = window.CAMP;
  var TOKEN_KEY = 'achziv-admin-token', QUEUE_KEY = 'achziv-admin-queue';
  var KINDS = { tip: 'טיפ', comment: 'תגובה', gear: 'פריט ציוד' };
  var PLURAL = { tip: 'טיפים', comment: 'תגובות', gear: 'ציוד' };
  var LIST = { tip: 'tips', comment: 'comments', gear: 'gear' };
  var DONE = { approved: 'אושר', rejected: 'נדחה', merged: 'מוזג' }, DONE_F = { approved: 'אושרה', rejected: 'נדחתה' };
  var ERRORS = { too_short: 'אחד השדות קצר מדי', too_long: 'אחד השדות ארוך מדי', bad_category: 'קטגוריה לא מוכרת',
                 bad_merge: 'אפשר למזג רק לטיפ מאושר אחר', not_found: 'הפריט כבר לא קיים בגיליון',
                 bad_status: 'החלטה לא מוכרת', network: 'אין חיבור לשרת. נסו שוב.', server_error: 'שגיאה בשרת. נסו שוב.' };
  var LIMITS = { title: 60, text: 400, comment: 300, author: 40, name: 60, tags: 100, note: 200 };
  var session = null, queue = null, filter = '', current = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function say(p, text, kind) { p.textContent = text || ''; p.className = 'msg' + (kind ? ' ' + kind : ''); }
  function readJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  // Google's web-app reply step fails intermittently (~1 in 3 replies dropped after the script ran): retry until JSON.
  function api(body, attempt) {
    attempt = attempt || 1;
    return fetch(C.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () {
        if (attempt >= 4) return { ok: false, error: 'network' };
        return new Promise(function (res) { setTimeout(res, 400 * attempt); }).then(function () { return api(body, attempt + 1); });
      });
  }
  function authed(body) { body.token = session && session.token; return api(body).then(check); }
  // 'auth' = token expired, forged or its password changed: back to login. 'bad_request' on an admin action =
  // the deployed script predates the managing page.
  function check(res) {
    if (res.error === 'auth') { logout('ההתחברות פגה. יש להתחבר שוב.'); throw res; }
    if (res.error === 'bad_request') { $('adm-server').hidden = false; throw res; }
    $('adm-server').hidden = true;
    return res;
  }

  // Day-first, Israel time: 30/09 בשעה 14:05
  function when(item) {
    if (!item.ms) return String(item.submitted || '');
    var p = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', hour: '2-digit',
      minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(item.ms)).forEach(function (x) { p[x.type] = x.value; });
    return p.day + '/' + p.month + ' בשעה ' + p.hour + ':' + p.minute;   // a word between keeps RTL order
  }

  // ---------- screens ----------
  function show(name) {
    ['login', 'queue', 'item'].forEach(function (s) { $('adm-' + s).hidden = s !== name; });
    $('adm-who').hidden = !session;
    if (session) $('adm-name').textContent = session.name;
    window.scrollTo(0, 0);
  }

  function logout(why) {
    session = null; queue = null;
    writeJson(TOKEN_KEY, null); writeJson(QUEUE_KEY, null);       // pending texts do not stay on a logged-out phone
    show('login');
    say($('login-msg'), why || '', why ? 'bad' : '');
  }

  // ---------- login ----------
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('login-name').value.trim(), pw = $('login-pw').value, msg = $('login-msg'), go = $('login-go');
    if (name.length < 2 || !pw) return say(msg, 'צריך שם וסיסמה.', 'bad');
    go.disabled = true; say(msg, 'בודק…');
    api({ action: 'adminLogin', name: name, password: pw }).then(function (res) {
      go.disabled = false;
      if (res.ok) {
        session = { token: res.token, name: res.name, exp: res.exp };
        writeJson(TOKEN_KEY, session);
        $('login-pw').value = ''; say(msg, '');
        openQueue();
        return;
      }
      if (res.error === 'bad_request') { $('adm-server').hidden = false; return say(msg, ''); }
      say(msg, { wrong_password: 'שם או סיסמה שגויים.', locked: 'יותר מדי ניסיונות. אפשר לנסות שוב בעוד רבע שעה.',
                 bad_user: 'השם לא תקין.' }[res.error] || ERRORS[res.error] || 'לא הצלחנו להתחבר.', 'bad');
    });
  });
  $('adm-logout').addEventListener('click', function () { logout(); });

  // ---------- the waiting list ----------
  function items() {
    if (!queue) return [];
    var all = [];
    ['tip', 'comment', 'gear'].forEach(function (k) {
      (queue[LIST[k]] || []).forEach(function (x) { all.push({ kind: k, item: x }); });
    });
    all.sort(function (a, b) { return (b.item.ms || 0) - (a.item.ms || 0); });
    return all;
  }
  function title(kind, x) {
    if (kind === 'tip') return x.title;
    if (kind === 'comment') return x.text;
    return x.name;
  }
  function renderQueue() {
    var all = items(), counts = { tip: 0, comment: 0, gear: 0 };
    all.forEach(function (e) { counts[e.kind]++; });
    if (filter && !counts[filter]) filter = '';
    var chip = function (k, label, n) {
      return '<button type="button" data-filter="' + k + '" aria-pressed="' + (filter === k) + '">' + label + ' <b>' + n + '</b></button>';
    };
    $('queue-filter').innerHTML = chip('', 'הכל', all.length) + ['tip', 'comment', 'gear'].map(function (k) {
      return counts[k] ? chip(k, PLURAL[k], counts[k]) : '';
    }).join('');
    var shown = all.filter(function (e) { return !filter || e.kind === filter; });
    $('queue-list').innerHTML = shown.map(function (e) {
      var x = e.item, sub = e.kind === 'tip' ? x.category : e.kind === 'comment' ? 'על: ' + x.tipTitle : x.section;
      return '<li><button type="button" class="adm-card" id="q-' + e.kind + '-' + x.id + '" data-kind="' + e.kind + '" data-id="' + x.id + '">' +
        '<span class="adm-kind adm-' + e.kind + '">' + KINDS[e.kind] + '</span>' +
        '<span class="adm-title">' + esc(title(e.kind, x)) + '</span>' +
        '<span class="adm-sub">' + esc(sub) + ' · ' + esc(when(x)) + (e.kind === 'tip' && x.similar ? ' · דומה ל־' + esc(x.similar) : '') + '</span>' +
        '</button></li>';
    }).join('');
    if (!queue) $('queue-state').textContent = 'טוען…';
    else if (!all.length) $('queue-state').textContent = 'אין כרגע ממתינים לאישור.';
    else $('queue-state').textContent = '';
  }
  $('queue-filter').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (b) { filter = b.getAttribute('data-filter'); renderQueue(); }
  });
  $('queue-list').addEventListener('click', function (e) {
    var b = e.target.closest('.adm-card');
    if (b) openItem(b.getAttribute('data-kind'), +b.getAttribute('data-id'), true);
  });

  var loading = null;
  function refresh() {
    if (loading) return loading;
    $('queue-refresh').disabled = true;
    loading = authed({ action: 'adminQueue' }).then(function (res) {
      if (!res.ok) throw res;
      queue = res; writeJson(QUEUE_KEY, res);
      if (/bad/.test($('queue-msg').className)) say($('queue-msg'), '');   // keep a decision's note, drop an old error
    }).catch(function (res) {
      if (res && res.error && res.error !== 'auth' && res.error !== 'bad_request') say($('queue-msg'), ERRORS[res.error] || 'לא הצלחנו לרענן.', 'bad');
    }).then(function () {
      loading = null; $('queue-refresh').disabled = false;
      if (!$('adm-queue').hidden) renderQueue();
    });
    return loading;
  }
  $('queue-refresh').addEventListener('click', refresh);

  function openQueue(note) {
    current = null;
    show('queue');
    renderQueue();
    say($('queue-msg'), note || '', note ? 'good' : '');
    refresh();
  }

  // ---------- one item ----------
  function field(id, label, value, max, multi) {
    var attrs = ' id="f-' + id + '" maxlength="' + max + '"';
    return '<label class="adm-field">' + label +
      (multi ? '<textarea' + attrs + ' rows="5">' + esc(value) + '</textarea>' : '<input' + attrs + ' value="' + esc(value) + '">') + '</label>';
  }
  function choice(id, label, value, list) {
    var opts = list.slice();
    if (value && opts.indexOf(value) < 0) opts.unshift(value);
    return '<label class="adm-field">' + label + '<select id="f-' + id + '">' + opts.map(function (o) {
      return '<option' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('') + '</select></label>';
  }
  function find(kind, id) {
    var list = queue ? queue[LIST[kind]] || [] : [];
    return list.filter(function (x) { return x.id === id; })[0];
  }
  function openItem(kind, id, push) {
    var x = find(kind, id);
    if (!x) return openQueue();
    current = { kind: kind, id: id };
    if (push) history.pushState({ item: kind + '-' + id }, '');
    var html = '';
    if (kind === 'tip') {
      html = choice('category', 'קטגוריה', x.category, queue.categories || []) + field('title', 'כותרת', x.title, LIMITS.title) +
             field('text', 'טקסט', x.text, LIMITS.text, true) + field('author', 'שם (לא חובה)', x.author, LIMITS.author);
    } else if (kind === 'comment') {
      html = '<p class="adm-on">תגובה על הטיפ: <b>' + esc(x.tipTitle || ('טיפ ' + x.tipId)) + '</b></p>' +
             field('text', 'טקסט', x.text, LIMITS.comment, true) + field('author', 'שם (לא חובה)', x.author, LIMITS.author);
    } else {
      html = choice('section', 'קטגוריה', x.section, queue.sections || []) + field('name', 'פריט', x.name, LIMITS.name) +
             field('tags', 'תגיות (מופרדות בפסיק)', x.tags, LIMITS.tags) + field('note', 'הערה', x.note, LIMITS.note);
    }
    $('item-fields').innerHTML = html;
    $('item-meta').textContent = KINDS[kind] + ' ' + id + ' · נשלח ' + when(x) + (kind === 'tip' && x.similar ? ' · דומה ל־' + x.similar : '');
    var targets = (queue.mergeTargets || []).filter(function (t) { return t.id !== id; });
    $('item-merge').hidden = kind !== 'tip' || !targets.length;
    if (kind === 'tip') {
      var near = parseInt(x.similar, 10);
      $('merge-target').innerHTML = targets.map(function (t) {
        return '<option value="' + t.id + '"' + (t.id === near ? ' selected' : '') + '>' + t.id + ': ' + esc(t.title) + '</option>';
      }).join('');
    }
    say($('item-msg'), '');
    busy(false);
    show('item');
  }
  function busy(on) {
    Array.prototype.forEach.call(document.querySelectorAll('#adm-item [data-decide], #item-back'), function (b) { b.disabled = on; });
  }
  function fields(kind) {
    var keys = kind === 'tip' ? ['category', 'title', 'text', 'author'] : kind === 'comment' ? ['text', 'author'] : ['section', 'name', 'tags', 'note'];
    var out = {};
    keys.forEach(function (k) { out[k] = $('f-' + k).value; });
    return out;
  }
  $('adm-item').addEventListener('click', function (e) {
    var b = e.target.closest('[data-decide]');
    if (!b || !current) return;
    var status = b.getAttribute('data-decide'), c = current;
    var body = { action: 'adminDecide', kind: c.kind, id: c.id, status: status, fields: fields(c.kind) };
    if (status === 'merged') body.mergedInto = +$('merge-target').value;
    busy(true); say($('item-msg'), 'שומר…');
    authed(body).then(function (res) {
      if (!res.ok) throw res;
      var k = LIST[c.kind];
      if (queue && queue[k]) queue[k] = queue[k].filter(function (x) { return x.id !== c.id; });
      writeJson(QUEUE_KEY, queue);
      current = null;                                    // so the history step back does not reopen the list twice
      if (history.state && history.state.item) history.back();
      openQueue(KINDS[c.kind] + ' ' + c.id + ' ' + (c.kind === 'comment' ? DONE_F[status] : DONE[status]) + '.');
    }).catch(function (res) {
      busy(false);
      if (res && res.error === 'auth') return;
      if (res && res.error === 'bad_request') return say($('item-msg'), '');
      say($('item-msg'), ERRORS[res && res.error] || 'לא נשמר. נסו שוב.', 'bad');
    });
  });
  $('item-back').addEventListener('click', function () {
    if (history.state && history.state.item) history.back(); else openQueue();
  });
  window.addEventListener('popstate', function () { if (current && session) openQueue(); });

  // ---------- start: a saved login shows the cached list at once ----------
  session = readJson(TOKEN_KEY);
  if (session && !(session.token && session.exp > Date.now())) { session = null; writeJson(TOKEN_KEY, null); }
  queue = session ? readJson(QUEUE_KEY) : null;
  if (session) openQueue(); else show('login');
})();
