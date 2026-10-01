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
                 bad_status: 'סטטוס לא מוכר', bad_time: 'הזמן חייב להיות בימי הקמפינג',
                 end_before_start: 'הסיום חייב להיות אחרי ההתחלה', bad_tag: 'קהל לא מוכר', bad_age: 'הגילים לא תקינים',
                 bad_capacity: 'מספר המקומות לא תקין (עד 500)', bad_tip: 'צריך לבחור טיפ מאושר', network: 'אין חיבור לשרת. נסו שוב.', server_error: 'שגיאה בשרת. נסו שוב.' };
  var LIMITS = { title: 60, text: 400, comment: 300, author: 40, name: 60, tags: 100, note: 200 };
  var session = null, queue = null, filter = '', current = null, view = 'queue';

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function say(p, text, kind) { p.textContent = text || ''; p.className = 'msg' + (kind ? ' ' + kind : ''); }
  function readJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  // Google's web-app reply step fails intermittently (~1 in 3 replies dropped after the script ran): retry until JSON.
  // A reply that hangs is given up after 30s and retried the same way (every admin write is safe to repeat).
  var TIMEOUT = window.ACHZIV_ADMIN_TIMEOUT || 30000;              // the e2e test shortens it
  function api(body, attempt) {
    attempt = attempt || 1;
    var ac = window.AbortController ? new AbortController() : null, timer = ac && setTimeout(function () { ac.abort(); }, TIMEOUT);
    return fetch(C.apiUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
                             signal: ac ? ac.signal : undefined })
      .then(function (r) { return r.json(); })
      .then(function (res) { clearTimeout(timer); return res; }, function (e) { clearTimeout(timer); throw e; })
      .catch(function () {
        if (attempt >= 4) return { ok: false, error: 'network' };
        return new Promise(function (res) { setTimeout(res, 400 * attempt); }).then(function () { return api(body, attempt + 1); });
      });
  }
  function authed(body) {
    var tok = body.token = session && session.token;
    return api(body).then(function (res) {
      // a reply to a request made under an older login (a background refresh still on its way) must not log out this one
      if (res.error === 'auth' && (!session || session.token !== tok)) throw res;
      return check(res);
    });
  }
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
    ['login', 'queue', 'item', 'list', 'edit'].forEach(function (s) { $('adm-' + s).hidden = s !== name; });
    $('adm-who').hidden = !session;
    $('adm-nav').hidden = !session || (name !== 'queue' && name !== 'list');
    Array.prototype.forEach.call(document.querySelectorAll('#adm-nav [data-view]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === view));
    });
    if (session) $('adm-name').textContent = session.name;
    window.scrollTo(0, 0);
  }

  function logout(why) {
    session = null; queue = null; lists = {}; editing = null;
    writeJson(TOKEN_KEY, null); writeJson(QUEUE_KEY, null);       // pending texts do not stay on a logged-out phone
    Object.keys(EDIT).forEach(function (k) { writeJson(LIST_KEY + k, null); });
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
        prefetchAll();
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
    current = null; editing = null; view = 'queue';
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
  window.addEventListener('popstate', function () {
    if (!session) return;
    if (current) openQueue();
    else if (editing) openList(editing.kind);
  });

  // ---------- edit anything current (docs/admin-plan.md §4.3) ----------
  // A tab per kind lists every row, whatever its status, with search. Tapping a row opens its edit screen. The last
  // list of each kind is cached like the waiting list. Saving waits for the server's verdict, as a decision does.
  var LIST_KEY = 'achziv-admin-list-';
  var WD = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  var STATUS = { approved: 'מאושר', pending: 'ממתין', rejected: 'נדחה', hidden: 'הוסתר', merged: 'מוזג',
                 active: 'פעיל', cancelled: 'בוטל' };
  var EDIT = {
    tip: { label: 'טיפים', one: 'טיפ', title: function (x) { return x.title; }, sub: function (x) { return x.category; } },
    comment: { label: 'תגובות', one: 'תגובה', title: function (x) { return x.text; },
               sub: function (x) { return 'על: ' + (x.tipTitle || 'טיפ ' + x.tipId); } },
    gear: { label: 'ציוד', one: 'פריט ציוד', title: function (x) { return x.name; }, sub: function (x) { return x.section; } },
    activity: { label: 'פעילויות', one: 'פעילות', title: function (x) { return x.topic; },
                sub: function (x) { return actWhen(x) + ' · ' + x.owner; } },
    tour: { label: 'טקסטים של ההדרכה', one: 'בועה', title: function (x) { return x.title || x.defTitle; },
            sub: function (x) { return 'סיור ' + x.tourName + ' · צעד ' + x.step; } }
  };
  var ELIMITS = { topic: 60, host: 60, description: 600, gearList: 200, tourTitle: 200, tourText: 2000 };
  // Tour bubbles are code (a step cannot be added or removed); a registration is made by the family, with its own code.
  var ADDABLE = { tip: 1, comment: 1, gear: 1, activity: 1 }, DELETABLE = { tip: 1, comment: 1, gear: 1, activity: 1, family: 1 };
  var lists = {}, listFilter = '', editing = null;

  function dayLabel(iso) {
    var d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));
    return WD[d.getUTCDay()] + ' ' + iso.slice(8, 10) + '/' + iso.slice(5, 7);
  }
  function actWhen(a) {
    var s = a.start.slice(0, 10), e = a.end.slice(0, 10);
    return dayLabel(s) + ', ' + a.start.slice(11, 16) + ' עד ' + (e === s ? '' : dayLabel(e) + ', ') + a.end.slice(11, 16);
  }

  function itemDomId(kind, id) {           // unique for any id: a family's Hebrew name, a tour's welcome/help
    return 'l-' + kind + '-' + String(id).replace(/[^A-Za-z0-9_-]/g, function (ch) {
      var n = ch.charCodeAt(0);
      return n < 128 ? '-' : '-' + n.toString(16);
    });
  }
  function renderList() {
    var kind = view, data = lists[kind], cfg = EDIT[kind];
    var all = data ? data.items : [], counts = {};
    all.forEach(function (x) { if (x.status) counts[x.status] = (counts[x.status] || 0) + 1; });
    if (listFilter && !counts[listFilter]) listFilter = '';
    var keys = Object.keys(counts);
    $('list-filter').innerHTML = keys.length < 2 ? '' :
      '<button type="button" data-filter="" aria-pressed="' + !listFilter + '">הכל <b>' + all.length + '</b></button>' +
      keys.map(function (k) {
        return '<button type="button" data-filter="' + k + '" aria-pressed="' + (listFilter === k) + '">' + (STATUS[k] || esc(k)) + ' <b>' + counts[k] + '</b></button>';
      }).join('');
    var q = $('list-q').value.trim().toLowerCase();
    var shown = all.filter(function (x) {
      if (listFilter && x.status !== listFilter) return false;
      if (!q) return true;
      return [cfg.title(x), cfg.sub(x), x.text, x.author, x.tags, x.note, x.description, x.host].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    $('list-items').innerHTML = shown.map(function (x) {
      var st = x.status && x.status !== 'approved' && x.status !== 'active' && x.status !== 'registered' ? ' · <b>' + (STATUS[x.status] || esc(x.status)) + '</b>' : '';
      return '<li class="adm-row"><button type="button" class="adm-card" id="' + itemDomId(kind, x.id) + '" data-id="' + esc(x.id) + '">' +
        '<span class="adm-title">' + esc(cfg.title(x)) + '</span>' +
        '<span class="adm-sub">' + esc(cfg.sub(x)) + st + '</span></button>' +
        (DELETABLE[kind] ? '<button type="button" class="adm-del" data-del="' + esc(x.id) + '" aria-label="' +
          esc((kind === 'family' ? 'ביטול ההרשמה: ' : 'מחיקה: ') + cfg.title(x)) + '">🗑</button>' : '') + '</li>';
    }).join('');
    $('list-add').hidden = !ADDABLE[kind];
    $('list-add').textContent = ADDABLE[kind] ? '+ הוספת ' + cfg.one : '';
    $('list-state').textContent = !data ? (listFailed[kind] ? 'לא הצלחנו לטעון את הרשימה. נסו "רענון".' : 'טוען…') :
      !all.length ? 'אין עדיין שורות.' : !shown.length ? 'לא נמצא.' : '';
  }

  var listLoading = {}, listFailed = {};
  function refreshList(kind) {
    if (listLoading[kind]) return listLoading[kind];
    if (view === kind) $('list-refresh').disabled = true;     // a background refresh of another tab leaves this one alone
    var req = kind === 'family' ? { action: 'adminFamilies' } : { action: 'adminList', kind: kind };
    listLoading[kind] = authed(req).then(function (res) {
      if (!res.ok) throw res;
      if (kind === 'family') famListed(res);
      lists[kind] = res; writeJson(LIST_KEY + kind, res); listFailed[kind] = false;
      if (view === kind && /bad/.test($('list-msg').className)) say($('list-msg'), '');
    }).catch(function (res) {
      listFailed[kind] = true;
      if (view === kind && res && res.error !== 'auth' && res.error !== 'bad_request') say($('list-msg'), ERRORS[res && res.error] || 'לא הצלחנו לרענן.', 'bad');
    }).then(function () {
      listLoading[kind] = null;
      if (view === kind) { $('list-refresh').disabled = false; if (!$('adm-list').hidden) renderList(); }
    });
    return listLoading[kind];
  }
  function openList(kind, note) {
    if (view !== kind) { listFilter = ''; $('list-q').value = ''; }
    view = kind; current = null; editing = null;
    if (!lists[kind]) lists[kind] = readJson(LIST_KEY + kind);
    $('list-title').textContent = EDIT[kind].label;
    show('list');
    renderList();
    say($('list-msg'), note || '', note ? 'good' : '');
    $('list-refresh').disabled = !!listLoading[kind];
    refreshList(kind);
  }
  $('adm-nav').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (!b) return;
    var v = b.getAttribute('data-view');
    if (v === 'queue') openQueue(); else openList(v);
  });
  $('list-q').addEventListener('input', renderList);
  $('list-filter').addEventListener('click', function (e) {
    var b = e.target.closest('[data-filter]');
    if (b) { listFilter = b.getAttribute('data-filter'); renderList(); }
  });
  $('list-refresh').addEventListener('click', function () { refreshList(view); });
  $('list-items').addEventListener('click', function (e) {
    var d = e.target.closest('.adm-del');
    if (d) return deleteItem(view, d.getAttribute('data-del'), d);
    var b = e.target.closest('.adm-card');
    if (b) openEdit(view, b.getAttribute('data-id'), true);
  });
  $('list-add').addEventListener('click', function () {
    if (!lists[view]) return say($('list-msg'), 'הרשימה עוד נטענת. רגע…');
    openEdit(view, null, true, true);
  });

  // ---------- delete (docs/admin-plan.md §4.6): asks first, then waits for the server's verdict ----------
  function deleteItem(kind, id, btn) {
    var x = findListed(kind, id);
    if (!x) return;
    var name = EDIT[kind].title(x), family = kind === 'family';
    var ask = family ? 'לבטל את ההרשמה של ' + x.family + '? היא תוסר מהרשימה, ובגיליון המארגנים תסומן "בוטל". המשפחה תוכל להירשם מחדש.'
      : 'למחוק את ' + EDIT[kind].one + ' "' + name + '"?\nהוא יוסר מהאתר ומהרשימה כאן. התוכן נשמר ביומן הניהול בגיליון.';
    if (!confirm(ask)) return;
    btn.disabled = true; say($('list-msg'), family ? 'מבטל…' : 'מוחק…');
    authed(family ? { action: 'adminFamilyCancel', user: x.id } : { action: 'adminDelete', kind: kind, id: x.id }).then(function (res) {
      if (!res.ok) throw res;                        // deleted / removed: false = a retry after a dropped reply, also done
      lists[kind].items = lists[kind].items.filter(function (y) { return String(y.id) !== String(x.id); });
      writeJson(LIST_KEY + kind, lists[kind]);
      if (view === kind) { renderList(); say($('list-msg'), family ? 'ההרשמה של ' + x.family + ' בוטלה.' : '"' + name + '" נמחק.', 'good'); }
    }).catch(function (res) {
      btn.disabled = false;
      if (res && (res.error === 'auth' || res.error === 'bad_request')) return;
      say($('list-msg'), ERRORS[res && res.error] || 'לא נמחק. נסו שוב.', 'bad');
    });
  }

  // ---------- on entering the page, every tab refreshes in the background, one request after another ----------
  var PREFETCH = ['tip', 'comment', 'gear', 'activity', 'tour', 'family'];
  function prefetchAll() {
    var tok = session && session.token;               // a logout or a new login ends this round
    PREFETCH.reduce(function (p, kind) {
      return p.then(function () { if (session && session.token === tok) return refreshList(kind); });
    }, Promise.resolve());
  }

  // ---------- the edit screen ----------
  function statusChoice(statuses, value) {
    if (!statuses || !statuses.length) return '';
    var opts = statuses.slice();
    var html = opts.map(function (k) { return '<option value="' + k + '"' + (k === value ? ' selected' : '') + '>' + STATUS[k] + '</option>'; });
    if (opts.indexOf(value) < 0) html.unshift('<option value="" selected>' + (STATUS[value] || esc(value)) + ' (בלי שינוי)</option>');
    return '<label class="adm-field">סטטוס<select id="e-status">' + html.join('') + '</select></label>';
  }
  function num(id, label, value, max) {
    return '<label class="adm-field">' + label + '<input id="f-' + id + '" type="number" inputmode="numeric" min="0" max="' + max + '" value="' +
      (value == null || value === 0 && id === 'capacity' ? '' : esc(value)) + '"></label>';
  }
  function pad(n) { return ('0' + n).slice(-2); }
  function timePick(id, label, t, days) {
    var day = t.slice(0, 10), h = t.slice(11, 13), m = t.slice(14, 16), hours = [], mins = ['00', '15', '30', '45'];
    for (var i = 0; i < 24; i++) hours.push(pad(i));
    if (mins.indexOf(m) < 0) mins.push(m), mins.sort();
    var sel = function (part, list, v, show) {
      return '<select id="f-' + id + '-' + part + '" aria-label="' + label + ' ' + show + '">' + list.map(function (o) {
        return '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + (part === 'day' ? esc(dayLabel(o)) : o) + '</option>';
      }).join('') + '</select>';
    };
    if (days.indexOf(day) < 0) days = [day].concat(days);
    return '<fieldset class="adm-field adm-time"><legend>' + label + '</legend>' + sel('day', days, day, 'יום') +
      '<span class="adm-at">בשעה</span>' + sel('m', mins, m, 'דקות') + '<span>:</span>' + sel('h', hours, h, 'שעה') + '</fieldset>';
  }
  function tripDays(trip) {
    var out = [], d = new Date(trip.from + 'T00:00:00Z'), end = new Date(trip.to + 'T00:00:00Z');
    for (; d <= end; d = new Date(d.getTime() + 86400000)) out.push(d.toISOString().slice(0, 10));
    return out;
  }
  function findListed(kind, id) {
    var data = lists[kind];
    return data ? data.items.filter(function (x) { return String(x.id) === String(id); })[0] : null;
  }
  // A new row starts from these; the server fills the id, the status (מאושר / פעיל) and the dates.
  function blankItem(kind, data) {
    if (kind === 'tip') return { category: (data.categories || [])[0] || '', title: '', text: '', author: '' };
    if (kind === 'comment') return { text: '', author: '' };
    if (kind === 'gear') return { section: (data.sections || [])[0] || '', name: '', tags: '', note: '' };
    var day = data.trip.from;
    return { topic: '', host: '', description: '', start: day + 'T10:00', end: day + 'T11:00', tag: (data.tags || [])[0] || '',
             ageFrom: null, ageTo: null, capacity: 0, required: '', suggested: '' };
  }
  function commentTips(data) {
    if (data.tips) return data.tips;
    return ((lists.tip && lists.tip.items) || []).filter(function (t) { return t.status === 'approved'; });
  }
  function newClientId() { return 'adm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function openEdit(kind, id, push, isNew) {
    var data = lists[kind], x = isNew ? blankItem(kind, data) : findListed(kind, id);
    if (!x) return openList(kind);
    editing = isNew ? { kind: kind, id: null, isNew: true, clientId: newClientId() } : { kind: kind, id: x.id, status: x.status };
    if (push) history.pushState({ edit: kind + '-' + (isNew ? 'new' : x.id) }, '');
    $('edit-extra').innerHTML = '';
    if (kind === 'family') return openFamily(x);
    var html = '', meta = isNew ? EDIT[kind].one + ' חדש' + (kind === 'activity' || kind === 'comment' ? 'ה' : '') +
      ': יופיע באתר מיד עם השמירה' : EDIT[kind].one + ' ' + x.id;
    if (kind === 'comment' && isNew) {
      html = '<label class="adm-field">על הטיפ<select id="f-tipId">' + commentTips(data).map(function (t) {
        return '<option value="' + t.id + '">' + esc(t.title) + '</option>';
      }).join('') + '</select></label>' +
             field('text', 'טקסט', x.text, LIMITS.comment, true) + field('author', 'שם (לא חובה)', x.author, LIMITS.author);
    } else if (kind === 'tip') {
      html = choice('category', 'קטגוריה', x.category, data.categories || []) + field('title', 'כותרת', x.title, LIMITS.title) +
             field('text', 'טקסט', x.text, LIMITS.text, true) + field('author', 'שם (לא חובה)', x.author, LIMITS.author);
      if (x.mergedInto) meta += ' · מוזג לטיפ ' + x.mergedInto;
    } else if (kind === 'comment') {
      html = '<p class="adm-on">תגובה על הטיפ: <b>' + esc(x.tipTitle || ('טיפ ' + x.tipId)) + '</b></p>' +
             field('text', 'טקסט', x.text, LIMITS.comment, true) + field('author', 'שם (לא חובה)', x.author, LIMITS.author);
    } else if (kind === 'gear') {
      html = choice('section', 'קטגוריה', x.section, data.sections || []) + field('name', 'פריט', x.name, LIMITS.name) +
             field('tags', 'תגיות (מופרדות בפסיק)', x.tags, LIMITS.tags) + field('note', 'הערה', x.note, LIMITS.note);
    } else if (kind === 'activity') {
      var days = tripDays(data.trip);
      html = field('topic', 'נושא', x.topic, ELIMITS.topic) + field('host', 'מנחה (לא חובה)', x.host, ELIMITS.host) +
             field('description', 'תיאור', x.description, ELIMITS.description, true) +
             timePick('start', 'התחלה', x.start, days) + timePick('end', 'סיום', x.end, days) +
             choice('tag', 'קהל', x.tag, data.tags || []) +
             '<div id="f-ages" class="adm-pair">' + num('ageFrom', 'מגיל', x.ageFrom, 99) + num('ageTo', 'עד גיל', x.ageTo, 99) + '</div>' +
             num('capacity', 'מקומות (ריק = בלי הגבלה)', x.capacity, 500) +
             field('required', 'חובה להביא', x.required, ELIMITS.gearList) + field('suggested', 'מומלץ להביא', x.suggested, ELIMITS.gearList);
      if (!isNew) meta += ' · של ' + x.owner + ' · נרשמו ' + x.taken;
    } else {
      html = field('title', 'כותרת', x.title, ELIMITS.tourTitle) + field('text', 'טקסט', x.text, ELIMITS.tourText, true) +
             '<p class="hint">שדה ריק מציג את הטקסט המובנה. שורה ריקה פותחת פסקה, **כך** מודגש.</p>' +
             '<details class="adm-default"><summary>הטקסט המובנה</summary><p><b>' + esc(x.defTitle) + '</b></p>' + tourRender_(x.defText) + '</details>';
      meta = 'סיור ' + x.tourName + ' · צעד ' + x.step;
    }
    $('edit-fields').innerHTML = html + (isNew ? '' : statusChoice(data.statuses, x.status));
    $('edit-meta').textContent = meta;
    if (kind === 'tour') {
      $('f-title').placeholder = x.defTitle;
      $('f-text').rows = 8;
      $('f-text').placeholder = x.defText;
    }
    $('edit-preview-wrap').hidden = kind !== 'tour';
    preview();
    ages();
    say($('edit-msg'), '');
    $('edit-save').disabled = false; $('edit-back').disabled = false;
    show('edit');
  }
  function preview() {
    if (!editing || editing.kind !== 'tour') return;
    var x = findListed('tour', editing.id) || {};
    var t = $('f-title').value.trim() || x.defTitle, body = $('f-text').value.trim() || x.defText;
    $('edit-preview').innerHTML = '<h3>' + esc(t) + '</h3>' + tourRender_(body);
  }
  function ages() { if ($('f-ages')) $('f-ages').hidden = $('f-tag').value !== 'ילדים'; }
  $('edit-fields').addEventListener('input', preview);
  $('edit-fields').addEventListener('change', ages);

  var EDIT_KEYS = { tip: ['category', 'title', 'text', 'author'], comment: ['text', 'author'], gear: ['section', 'name', 'tags', 'note'],
                    activity: ['topic', 'host', 'description', 'tag', 'ageFrom', 'ageTo', 'capacity', 'required', 'suggested'],
                    tour: ['title', 'text'] };
  function editFields(kind) {
    var out = {};
    EDIT_KEYS[kind].forEach(function (k) { out[k] = $('f-' + k).value; });
    if (kind === 'activity') {
      ['start', 'end'].forEach(function (k) {
        out[k] = $('f-' + k + '-day').value + 'T' + $('f-' + k + '-h').value + ':' + $('f-' + k + '-m').value;
      });
      if (out.tag !== 'ילדים') { delete out.ageFrom; delete out.ageTo; }
    }
    return out;
  }
  $('edit-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editing) return;
    if (editing.kind === 'family') return saveFamily();
    if (editing.isNew) return saveNew();
    var c = editing, body = { action: 'adminUpdate', kind: c.kind, id: c.id, fields: editFields(c.kind) };
    var st = $('e-status') ? $('e-status').value : '';
    if (st && st !== c.status) body.status = st;
    $('edit-save').disabled = true; $('edit-back').disabled = true; say($('edit-msg'), 'שומר…');
    authed(body).then(function (res) {
      if (!res.ok) throw res;
      var x = findListed(c.kind, c.id);
      if (x) {                                          // shown at once; the background refresh brings the server's form
        Object.keys(body.fields).forEach(function (k) { if (k in x) x[k] = body.fields[k]; });
        if (res.status) x.status = res.status;
        if (body.status && c.kind === 'tip') x.mergedInto = null;
        writeJson(LIST_KEY + c.kind, lists[c.kind]);
      }
      editing = null;
      if (history.state && history.state.edit) history.back();
      openList(c.kind, EDIT[c.kind].one + ' ' + (c.kind === 'tour' ? '' : c.id + ' ') + 'נשמר.');
    }).catch(function (res) {
      $('edit-save').disabled = false; $('edit-back').disabled = false;
      if (res && res.error === 'auth') return;
      if (res && res.error === 'bad_request') return say($('edit-msg'), '');
      say($('edit-msg'), ERRORS[res && res.error] || 'לא נשמר. נסו שוב.', 'bad');
    });
  });
  $('edit-back').addEventListener('click', function () {
    if (history.state && history.state.edit) history.back(); else openList(view);
  });

  // A new row: the clientId was made when the form opened, so saving again after a lost reply never adds it twice.
  function saveNew() {
    var c = editing, body = { action: 'adminAdd', kind: c.kind, clientId: c.clientId, fields: editFields(c.kind) };
    if (c.kind === 'comment') body.tipId = +$('f-tipId').value;
    $('edit-save').disabled = true; $('edit-back').disabled = true; say($('edit-msg'), 'שומר…');
    authed(body).then(function (res) {
      if (!res.ok) throw res;
      var x = Object.assign({ id: res.id, status: c.kind === 'activity' ? 'active' : 'approved' }, body.fields);
      if (c.kind === 'activity') {
        x.owner = 'המארגנים'; x.taken = 0;
        x.capacity = +x.capacity || 0; x.ageFrom = x.ageFrom ? +x.ageFrom : null; x.ageTo = x.ageTo ? +x.ageTo : null;
      }
      if (c.kind === 'comment') {
        x.tipId = body.tipId;
        x.tipTitle = (commentTips(lists.comment).filter(function (t) { return +t.id === body.tipId; })[0] || {}).title || '';
      }
      var list = lists[c.kind];                         // shown at once; the refresh brings the server's form
      if (!list.items.some(function (y) { return +y.id === +res.id; })) list.items.unshift(x);
      writeJson(LIST_KEY + c.kind, list);
      var pending = listLoading[c.kind];                // a refresh already on its way predates this row
      editing = null;
      if (history.state && history.state.edit) history.back();
      openList(c.kind, EDIT[c.kind].one + ' ' + res.id + ' נוסף.');
      if (pending) pending.then(function () { refreshList(c.kind); });
    }).catch(function (res) {
      $('edit-save').disabled = false; $('edit-back').disabled = false;
      if (res && res.error === 'auth') return;
      if (res && res.error === 'bad_request') return say($('edit-msg'), '');
      say($('edit-msg'), ERRORS[res && res.error] || 'לא נשמר. נסו שוב.', 'bad');
    });
  }

  // ---------- registrations (docs/admin-plan.md §4.4) ----------
  // A family's stay is edited with the calculator's own pieces (calc.js: the same categories, checks and prices). The
  // server checks and prices it again with that very code, and keeps the family's code as it is. Codes are never shown.
  var K = window.CampCalc, fam = null;
  var NF = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
  var MAIN = C.categories.filter(function (c) { return c.main; }), DISC = C.categories.filter(function (c) { return !c.main; });
  var DATES = [];
  for (var dt = K.toTime(C.dateRangeStart); dt <= K.toTime(C.dateRangeEnd); dt += K.DAY) DATES.push(K.toIso(dt));
  STATUS.registered = 'רשומה'; STATUS.locked = 'נעולה';
  ERRORS.bad_stay = 'יש בעיה בתאריכים או בהרכב: ראו את ההערות'; ERRORS.too_big = 'יותר מדי תקופות';
  function money(n) { return NF.format(n || 0) + ' ₪'; }
  function nightsWord(n) { return n > 0 ? n + (n === 1 ? ' לילה' : ' לילות') : '—'; }
  function stayText(x) {
    var ps = (x.data && x.data.periods) || [];
    return ps.map(function (p) { return K.dm(p.from) + ' עד ' + K.dm(p.to); }).join(' · ') + ' · ' + x.maxPeople + ' לנים';
  }
  EDIT.family = { label: 'הרשמות', one: 'הרשמה', title: function (x) { return x.family; },
                  sub: function (x) { return stayText(x) + ' · ' + money(x.full); } };
  function famListed(res) {
    res.items.forEach(function (x) { x.id = x.user; x.status = x.locked ? 'locked' : 'registered'; });
  }
  function famState(d) {
    d = d || {};
    var ps = d.periods && d.periods.length ? d.periods : [{ from: C.defaultFrom, to: C.defaultTo }];
    return { base: Object.assign(K.emptyCounts(), d.base), periods: ps.map(function (p) {
      return { from: p.from, to: p.to, custom: !!p.custom, counts: Object.assign(K.emptyCounts(), p.counts) };
    }) };
  }

  function counterHtml(scope, cat, n) {
    var id = 'fc-' + scope + '-' + cat.id;
    return '<div class="counter"><div class="who"><label for="' + id + '"><span class="lbl">' + esc(cat.label) + '</span>' +
      '<span class="meta">' + (cat.ages ? esc(cat.ages) + ' · ' : '') + (cat.price ? money(cat.price) + ' ' + (cat.unit || 'ללילה') : 'חינם') +
      '</span></label></div><div class="stepper">' +
      '<button type="button" class="step" data-d="1" aria-label="הוספת ' + esc(cat.label) + '">+</button>' +
      '<input id="' + id + '" data-scope="' + scope + '" data-cat="' + cat.id + '" type="number" inputmode="numeric" min="0" max="99" value="' + (n || 0) + '">' +
      '<button type="button" class="step" data-d="-1" aria-label="הפחתת ' + esc(cat.label) + '">−</button></div></div>';
  }
  function countersHtml(scope, counts) {
    var group = function (cats) { return cats.map(function (c) { return counterHtml(scope, c, counts[c.id]); }).join(''); };
    var any = function (cats) { return cats.some(function (c) { return counts[c.id] > 0; }); };
    return '<div class="counters">' + group(MAIN) + '</div>' +
      '<details' + (any(DISC) ? ' open' : '') + '><summary>הנחות וזכאויות</summary><div class="counters">' + group(DISC) + '</div></details>' +
      '<details' + (any(C.extras) ? ' open' : '') + '><summary>תוספות</summary><div class="counters">' + group(C.extras) + '</div></details>';
  }
  function dateSel(id, label, v) {
    var opts = DATES.indexOf(v) < 0 ? DATES.concat([v]).sort() : DATES;
    return '<label for="' + id + '">' + label + '<br><select id="' + id + '">' + opts.map(function (d) {
      return '<option value="' + d + '"' + (d === v ? ' selected' : '') + '>' + K.weekday(d) + ' ' + K.dmy(d) + '</option>';
    }).join('') + '</select></label>';
  }

  function openFamily(x) {
    fam = { state: famState(x.data) };
    $('edit-meta').textContent = 'הרשמה · עודכן ' + when({ ms: x.ms, submitted: x.updated });
    $('edit-preview-wrap').hidden = true;
    renderFamily();
    say($('edit-msg'), '');
    $('edit-back').disabled = false;
    show('edit');
  }
  function renderFamily() {
    var x = findListed('family', editing.id), s = fam.state, multi = s.periods.length > 1;
    var html = '<h2 class="adm-fam">' + esc(x.family) + '</h2>' +
      (x.locked ? '<p class="msg bad" id="fam-locked">ההרשמה נעולה ל־15 דקות אחרי קודים שגויים.</p>' : '') +
      '<fieldset class="period"><legend>הרכב המשפחה</legend>' + countersHtml('b', s.base) + '</fieldset>';
    s.periods.forEach(function (p, i) {
      html += '<fieldset class="period"><legend>' + (multi ? 'תקופה ' + (i + 1) : 'תאריכי השהייה') + '</legend>' +
        '<div class="dates">' + dateSel('fp-from-' + i, 'הגעה', p.from) + dateSel('fp-to-' + i, 'עזיבה', p.to) +
        '<span class="nights" id="fp-n-' + i + '">' + nightsWord(K.nightsBetween(p.from, p.to)) + '</span></div>' +
        '<div class="check"><label><input type="checkbox" id="fp-custom-' + i + '"' + (p.custom ? ' checked' : '') + '> הרכב שונה בתקופה הזו</label></div>' +
        (p.custom ? '<div class="custom"><p class="hint">ההרכב בתקופה הזו בלבד:</p>' + countersHtml('p' + i, p.counts) + '</div>' : '') +
        (multi ? '<button type="button" class="btn-link" data-remove="' + i + '">מחיקת תקופה ' + (i + 1) + '</button>' : '') + '</fieldset>';
    });
    html += '<button type="button" class="btn-secondary" id="fam-add">+ תקופה נוספת</button><div id="fam-result" aria-live="polite"></div>';
    $('edit-fields').innerHTML = html;
    $('edit-extra').innerHTML = '<div class="adm-fam-acts">' +
      (x.locked ? '<button type="button" class="btn-secondary" id="fam-unlock">שחרור הנעילה</button>' : '') +
      '<button type="button" class="btn-secondary adm-reject" id="fam-cancel">ביטול ההרשמה</button></div>' +
      '<p class="hint">הקוד של המשפחה לא מוצג ולא משתנה כאן. משפחה ששכחה את הקוד: מבטלים, והיא נרשמת מחדש.</p>';
    famResult();
  }
  // The calculator's own warnings and totals, with what the sheet holds now beside them.
  function famResult() {
    var x = findListed('family', editing.id), s = fam.state, r = K.calcAll(s), w = K.warnings(s);
    $('fam-result').innerHTML = (w.length ? '<ul class="warn">' + w.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="totals"><div class="total"><span>מחיר מלא</span><strong>' + money(r.full) + '</strong></div>' +
      '<div class="total group"><span>מחיר קבוצתי (מ־' + C.groupMinPeople + ' לנים)</span><strong>' + money(r.group) + '</strong></div></div>' +
      '<p class="hint">עד <strong>' + r.maxPeople + '</strong> לנים. עכשיו בגיליון: ' + money(x.full) + ' / ' + money(x.group) + ', עד ' + x.maxPeople + ' לנים.</p>';
    $('edit-save').disabled = !!w.length;
  }
  function isFam() { return editing && editing.kind === 'family' && fam; }
  function setCount(input, v) {
    v = Math.max(0, Math.min(99, parseInt(v, 10) || 0));
    var sc = input.getAttribute('data-scope'), counts = sc === 'b' ? fam.state.base : fam.state.periods[+sc.slice(1)].counts;
    counts[input.getAttribute('data-cat')] = v; input.value = v;
    famResult();
  }
  $('edit-fields').addEventListener('click', function (e) {
    if (!isFam()) return;
    var b = e.target.closest('.step, [data-remove], #fam-add');
    if (!b) return;
    var ps = fam.state.periods;
    if (b.classList.contains('step')) {
      var input = b.parentNode.querySelector('input');
      setCount(input, (parseInt(input.value, 10) || 0) + (+b.getAttribute('data-d')));
    } else if (b.id === 'fam-add') {
      var from = ps[ps.length - 1].to;
      ps.push({ from: from, to: K.toIso(K.toTime(from) + K.DAY), custom: false, counts: K.emptyCounts() });
      renderFamily();
      $('fp-from-' + (ps.length - 1)).focus();
    } else {
      var i = +b.getAttribute('data-remove');
      if (!confirm('למחוק את תקופה ' + (i + 1) + ' (' + K.dm(ps[i].from) + ' עד ' + K.dm(ps[i].to) + ')?')) return;
      ps.splice(i, 1);
      renderFamily();
    }
  });
  $('edit-fields').addEventListener('input', function (e) {
    if (isFam() && e.target.hasAttribute('data-cat')) setCount(e.target, e.target.value);
  });
  $('edit-fields').addEventListener('change', function (e) {
    if (!isFam()) return;
    var m = /^fp-(from|to|custom)-(\d+)$/.exec(e.target.id);
    if (!m) return;
    var p = fam.state.periods[+m[2]];
    if (m[1] === 'custom') {
      p.custom = e.target.checked;
      if (p.custom) p.counts = Object.assign(K.emptyCounts(), fam.state.base);
      renderFamily();
      return;
    }
    p[m[1]] = e.target.value;
    $('fp-n-' + m[2]).textContent = nightsWord(K.nightsBetween(p.from, p.to));
    famResult();
  });

  function famBusy(on) {
    ['edit-save', 'edit-back', 'fam-cancel', 'fam-unlock'].forEach(function (id) { if ($(id)) $(id).disabled = on; });
    if (!on) famResult();
  }
  function famFail(res) {
    famBusy(false);
    if (res && res.error === 'auth') return;
    if (res && res.error === 'bad_request') return say($('edit-msg'), '');
    say($('edit-msg'), ERRORS[res && res.error] || 'לא נשמר. נסו שוב.', 'bad');
  }
  function leaveFamily(note) {
    writeJson(LIST_KEY + 'family', lists.family);
    editing = null; fam = null;
    if (history.state && history.state.edit) history.back();
    openList('family', note);
  }
  function saveFamily() {
    var id = editing.id, data = JSON.parse(JSON.stringify(fam.state));
    famBusy(true); say($('edit-msg'), 'שומר…');
    authed({ action: 'adminFamilyUpdate', user: id, data: data }).then(function (res) {
      if (!res.ok) throw res;
      var x = findListed('family', id);                 // shown at once; the background refresh brings the server's copy
      if (x) { x.data = data; x.full = res.full; x.group = res.group; x.maxPeople = res.maxPeople; x.nights = res.nights; }
      leaveFamily('ההרשמה של ' + (x ? x.family : id) + ' נשמרה.');
    }).catch(famFail);
  }
  $('edit-extra').addEventListener('click', function (e) {
    if (!isFam()) return;
    var id = editing.id, x = findListed('family', id);
    if (e.target.id === 'fam-cancel') {
      if (!confirm('לבטל את ההרשמה של ' + x.family + '? היא תוסר מהרשימה, ובגיליון המארגנים תסומן "בוטל". המשפחה תוכל להירשם מחדש.')) return;
      famBusy(true); say($('edit-msg'), 'מבטל…');
      authed({ action: 'adminFamilyCancel', user: id }).then(function (res) {
        if (!res.ok) throw res;                          // removed: false = a retry after a dropped reply, also done
        lists.family.items = lists.family.items.filter(function (y) { return y.id !== id; });
        leaveFamily('ההרשמה של ' + x.family + ' בוטלה.');
      }).catch(famFail);
    } else if (e.target.id === 'fam-unlock') {
      famBusy(true); say($('edit-msg'), 'משחרר…');
      authed({ action: 'adminFamilyUnlock', user: id }).then(function (res) {
        if (!res.ok) throw res;
        x.locked = false; x.status = 'registered';
        writeJson(LIST_KEY + 'family', lists.family);
        renderFamily();
        famBusy(false);
        say($('edit-msg'), 'הנעילה שוחררה: המשפחה יכולה להיכנס עם הקוד שלה.', 'good');
      }).catch(famFail);
    }
  });

  // ---------- start: a saved login shows the cached list at once ----------
  session = readJson(TOKEN_KEY);
  if (session && !(session.token && session.exp > Date.now())) { session = null; writeJson(TOKEN_KEY, null); }
  queue = session ? readJson(QUEUE_KEY) : null;
  if (session) { openQueue(); prefetchAll(); } else show('login');
})();
