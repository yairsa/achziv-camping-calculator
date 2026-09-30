// Activities tab (docs/activities-plan.md): what families plan during the trip, as a list by day or a weekly
// calendar, with a details window to join, leave, edit or cancel. Uses api()/esc()/me() from app.js and the
// word search in search.js.
//
// Fast on the client, the server in the background (the tips.js pattern) for reading: the list shows at
// once from this browser's last copy and is refreshed in the background (prefetched after page load).
// Writes are different: each one needs the server's verdict (the family's code, a free place), so they
// wait for the answer, which carries the fresh list. Every write is safe to repeat, so api() retries it.
// The code is kept in memory for this visit only, never stored.
(function () {
  'use strict';
  var C = window.CAMP, A = window.CampApi, esc = A.esc;
  var CACHE_KEY = 'achziv-acts-cache';
  var TRIP = { from: '2026-10-06', to: '2026-10-13' };
  var TAGS = ['לכולם', 'מבוגרים', 'ילדים'];
  var TAG_CLASS = { 'לכולם': 't-all', 'מבוגרים': 't-adult', 'ילדים': 't-kid' };   // colours in style.css
  function tc(t) { return TAG_CLASS[t] ? ' ' + TAG_CLASS[t] : ''; }
  var WD = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  var HOUR_PX = 48, PHONE_DAYS = 3;
  var ERR = {
    not_registered: 'לא מצאנו הרשמה בשם הזה. רק משפחות רשומות יכולות להוסיף פעילות או להצטרף. נרשמים בלשונית "מחשבון".',
    wrong_pin: 'הקוד לא תואם את ההרשמה בשם הזה.',
    locked: 'יותר מדי ניסיונות עם קוד שגוי. ההרשמה נעולה ל-15 דקות. נסו שוב אחר כך, או פנו למארגנים.',
    bad_user: 'כתבו את שם המשפחה כפי שנרשמתם.',
    bad_pin: 'הקוד הוא 4 עד 8 ספרות.',
    not_owner: 'רק המשפחה שיצרה את הפעילות יכולה לערוך או לבטל אותה.',
    not_found: 'הפעילות הזאת כבר לא קיימת. אולי היא בוטלה.',
    full: 'אין מספיק מקומות פנויים. נסו מספר משתתפים קטן יותר.',
    below_joined: 'כבר הצטרפו יותר אנשים ממספר המקומות הזה.',
    bad_time: 'בחרו מועד בתוך ימי הטיול, 06/10 עד 13/10.',
    end_before_start: 'הסיום צריך להיות אחרי ההתחלה.',
    bad_tag: 'בחרו למי הפעילות מתאימה.',
    bad_age: 'הגילים הם מספרים שלמים, וגיל ה"מ" לא גדול מגיל ה"עד".',
    bad_capacity: 'מספר המקומות: מספר שלם מ-1 עד 500, או ריק אם אין הגבלה.',
    bad_count: 'מספר המשתתפים: 1 עד 30.',
    too_short: 'הנושא קצר מדי.',
    too_long: 'אחד השדות ארוך מדי.',
    busy: 'למשפחה שלכם כבר יש 30 פעילויות.',
    bad_request: 'השרת עוד לא מעודכן לפעילויות. נסו שוב מאוחר יותר.',
    network: 'אין חיבור לשרת כרגע. נסו שוב בעוד רגע.'
  };
  var CRED_ERRORS = { not_registered: 1, wrong_pin: 1, locked: 1, bad_user: 1, bad_pin: 1 };

  var acts = [], live = false, started = false;
  var view = 'list', day = '', tag = '', calPage = 0;
  var me = null;                    // {user, pin} that the server accepted in this visit
  var dlg = null;                   // what the dialog shows: {mode: 'details'|'form', id}
  var phone = window.matchMedia ? window.matchMedia('(max-width: 700px)') : { matches: true };

  function $(id) { return document.getElementById(id); }
  function say(p, text, kind) { p.textContent = text; p.className = 'msg' + (kind ? ' ' + kind : ''); }
  function readJson(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function writeJson(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
  function newCid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  // ---------- dates (ISO in storage, day-first on screen) ----------
  function toTime(iso) { return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); }
  function addDays(iso, n) { return new Date(toTime(iso) + n * 86400000).toISOString().slice(0, 10); }
  function dm(iso) { return iso.slice(8, 10) + '/' + iso.slice(5, 7); }
  function dayLabel(iso) { return WD[new Date(toTime(iso)).getUTCDay()] + ' ' + dm(iso); }
  function tripDays() { var out = [], d = TRIP.from; while (d <= TRIP.to) { out.push(d); d = addDays(d, 1); } return out; }
  function hm(t) { return t.slice(11, 16); }
  function mins(t) { return +t.slice(11, 13) * 60 + +t.slice(14, 16); }
  function when(a) {
    var s = a.start.slice(0, 10), e = a.end.slice(0, 10);
    return dayLabel(s) + ', ' + hm(a.start) + ' עד ' + (e === s ? '' : dayLabel(e) + ', ') + hm(a.end);
  }
  function timeOnDay(a, d) {                       // the time shown in a row under day d
    var s = a.start.slice(0, 10), e = a.end.slice(0, 10);
    if (s !== d) return when(a);
    return hm(a.start) + ' עד ' + hm(a.end) + (e === s ? '' : e === addDays(s, 1) ? ' (למחרת)' : ' (' + dayLabel(e) + ')');
  }
  function onDay(a, d) { return a.start.slice(0, 10) <= d && a.end > d + 'T00:00'; }

  // ---------- who am I ----------
  function myName() { var m = me || A.me(); return m ? m.user : A.remembered(); }
  function isMine(name) { var n = myName(); return !!n && A.norm(n) === A.norm(name); }
  function myJoin(a) { return a.joined.filter(function (j) { return isMine(j.family); })[0] || null; }

  // ---------- text ----------
  function tagText(a) {
    if (a.tag !== 'ילדים' || (a.ageFrom == null && a.ageTo == null)) return a.tag;
    if (a.ageFrom != null && a.ageTo != null) return 'ילדים, גילאי ' + a.ageFrom + ' עד ' + a.ageTo;
    return a.ageFrom != null ? 'ילדים, מגיל ' + a.ageFrom : 'ילדים, עד גיל ' + a.ageTo;
  }
  function placesText(a) {
    if (!a.capacity) return a.taken ? a.taken + ' משתתפים, אין הגבלת מקומות' : 'אין הגבלת מקומות';
    if (a.taken >= a.capacity) return 'מלא (' + a.taken + ' מתוך ' + a.capacity + ')';
    var left = a.capacity - a.taken;
    return (left === 1 ? 'נשאר מקום אחד' : 'נשארו ' + left + ' מקומות') + ' (' + a.taken + ' מתוך ' + a.capacity + ')';
  }
  function isFull(a) { return !!a.capacity && a.taken >= a.capacity; }

  // ---------- filters ----------
  function matches(a, words) {
    if (tag && a.tag !== tag && !(a.tag === 'לכולם' && tag !== 'לכולם')) return false;   // "for everyone" suits both
    if (!words.length) return true;
    var forms = searchFormsOf_([a.topic, a.description, a.owner, a.required, a.suggested, a.tag].join(' '));
    return words.every(function (w) { return searchHit_(w, forms); });
  }
  function shown() {
    var words = searchWords_($('acts-q').value);
    return acts.filter(function (a) { return matches(a, words); });
  }

  // ---------- list by day ----------
  function row(a, d) {
    var j = myJoin(a);
    return '<li><button type="button" class="arow' + tc(a.tag) + (isFull(a) ? ' full' : '') + '" data-id="' + a.id + '">' +
      '<span class="atime">' + esc(timeOnDay(a, d)) + '</span>' +
      '<span class="atopic">' + esc(a.topic) + '</span>' +
      '<span class="ameta"><span class="atag">' + esc(tagText(a)) + '</span> · ' + esc(placesText(a)) +
      (j ? ' · <strong class="amine">הצטרפתם (' + j.count + ')</strong>' : '') +
      (isMine(a.owner) ? ' · <strong class="amine">שלכם</strong>' : '') + '</span>' +
      '</button></li>';
  }
  function renderList(list) {
    var html = '';
    (day ? [day] : tripDays()).forEach(function (d) {
      // no day chosen: each activity under its first day; a day chosen: everything happening on it
      var here = list.filter(function (a) { return day ? onDay(a, d) : a.start.slice(0, 10) === d; });
      if (!here.length) return;
      html += '<div class="card aday"><h3>' + esc(dayLabel(d)) + '</h3><ul class="alist">' +
        here.map(function (a) { return row(a, d); }).join('') + '</ul></div>';
    });
    $('acts-list').innerHTML = html;
  }

  // ---------- calendar: days as columns, hours as rows ----------
  function segments(list, d) {                     // the part of each activity inside day d, in minutes
    var segs = list.filter(function (a) { return onDay(a, d); }).map(function (a) {
      var s = a.start.slice(0, 10) < d ? 0 : mins(a.start), e = a.end.slice(0, 10) > d ? 1440 : mins(a.end);
      return { a: a, s: s, e: Math.max(e, s + 15) };
    }).sort(function (x, y) { return x.s - y.s || y.e - x.e; });
    // side by side when they overlap: a lane each, inside a cluster of overlapping ones
    var cluster = [], end = -1;
    function close() { var n = 0; cluster.forEach(function (g) { n = Math.max(n, g.lane + 1); }); cluster.forEach(function (g) { g.lanes = n; }); cluster = []; }
    segs.forEach(function (g) {
      if (g.s >= end) { close(); end = -1; }
      var used = cluster.filter(function (o) { return o.e > g.s; }).map(function (o) { return o.lane; }), lane = 0;
      while (used.indexOf(lane) >= 0) lane++;
      g.lane = lane; cluster.push(g); end = Math.max(end, g.e);
    });
    close();
    return segs;
  }
  function calDays() {
    var all = day ? [day] : tripDays();
    if (!phone.matches || all.length <= PHONE_DAYS) return { days: all, all: all };
    calPage = Math.max(0, Math.min(calPage, all.length - PHONE_DAYS));
    return { days: all.slice(calPage, calPage + PHONE_DAYS), all: all };
  }
  function renderCal(list) {
    var cd = calDays(), days = cd.days, from = 8 * 60, to = 22 * 60, cols = days.map(function (d) { return segments(list, d); });
    // the hours follow what starts or ends in them; the tail of last night's activity is drawn at the top
    cols.forEach(function (segs) { segs.forEach(function (g) {
      if (g.s > 0) from = Math.min(from, Math.floor(g.s / 60) * 60);
      if (g.s > 0 || g.e > from) to = Math.max(to, Math.ceil(g.e / 60) * 60);
    }); });
    cols.forEach(function (segs) { segs.forEach(function (g) { if (g.s < from) { g.cont = true; g.s = from; g.e = Math.max(g.e, from + 30); } }); });
    var h = (to - from) / 60 * HOUR_PX, hours = '';
    for (var m = from; m < to; m += 60) hours += '<span style="top:' + ((m - from) / 60 * HOUR_PX) + 'px">' + ('0' + m / 60).slice(-2) + ':00</span>';
    var nav = '';
    if (days.length < cd.all.length) {
      var first = cd.all.indexOf(days[0]);
      nav = '<div class="calnav">' +
        '<button type="button" class="btn-secondary" id="acts-prev" aria-label="הימים הקודמים"' + (first === 0 ? ' disabled' : '') + '>›</button>' +
        '<span>' + esc(dm(days[0])) + ' עד ' + esc(dm(days[days.length - 1])) + '</span>' +
        '<button type="button" class="btn-secondary" id="acts-next" aria-label="הימים הבאים"' + (first + days.length >= cd.all.length ? ' disabled' : '') + '>‹</button></div>';
    }
    var grid = 'grid-template-columns: 44px repeat(' + days.length + ', minmax(0, 1fr))';
    $('acts-cal').innerHTML = nav + '<div class="card calwrap">' +
      '<div class="calhead" style="' + grid + '"><span></span>' + days.map(function (d) { return '<span>' + esc(dayLabel(d)) + '</span>'; }).join('') + '</div>' +
      '<div class="calbody" style="' + grid + '"><div class="calhours" style="height:' + h + 'px">' + hours + '</div>' +
      cols.map(function (segs) {
        return '<div class="calday" style="height:' + h + 'px;background-size:100% ' + HOUR_PX + 'px">' + segs.map(function (g) {
          var w = 100 / g.lanes;
          return '<button type="button" class="ablock' + tc(g.a.tag) + (isFull(g.a) ? ' full' : '') + (myJoin(g.a) || isMine(g.a.owner) ? ' mine' : '') + '" data-id="' + g.a.id + '" ' +
            'style="top:' + ((g.s - from) / 60 * HOUR_PX) + 'px;height:' + ((g.e - g.s) / 60 * HOUR_PX - 2) + 'px;' +
            'inset-inline-start:' + (g.lane * w) + '%;width:calc(' + w + '% - 2px)">' +
            '<span class="btime">' + (g.cont ? 'עד ' + esc(hm(g.a.end)) : esc(hm(g.a.start))) + '</span>' + esc(g.a.topic) + '</button>';
        }).join('') + '</div>';
      }).join('') + '</div></div>';
  }

  // ---------- the whole tab ----------
  function renderChips() {
    $('acts-days').innerHTML = [''].concat(tripDays()).map(function (d) {
      return '<button type="button" class="chip" aria-pressed="' + (d === day) + '" data-day="' + d + '">' + (d ? esc(dayLabel(d)) : 'כל הימים') + '</button>';
    }).join('');
    $('acts-tags').innerHTML = [''].concat(TAGS).map(function (t) {
      return '<button type="button" class="chip' + tc(t) + '" aria-pressed="' + (t === tag) + '" data-tag="' + esc(t) + '">' + (t ? esc(t) : 'כל הקהלים') + '</button>';
    }).join('');
  }
  function render() {
    var list = shown(), filtering = list.length !== acts.length || !!day;
    $('acts-count').textContent = !acts.length ? (live ? 'עוד אין פעילויות. אפשר להוסיף את הראשונה.' : '')
      : !list.length ? 'לא נמצאו פעילויות. נסו מילה אחרת, או בטלו את הסינון.'
      : day && view === 'list' && !$('acts-q').value.trim() && !tag ? list.filter(function (a) { return onDay(a, day); }).length + ' פעילויות ב' + dayLabel(day) + '.'
      : filtering ? 'נמצאו ' + list.length + ' מתוך ' + acts.length + ' פעילויות.'
      : acts.length + ' פעילויות.';
    $('acts-list').hidden = view !== 'list';
    $('acts-cal').hidden = view !== 'cal';
    if (view === 'list') renderList(list); else renderCal(list);
  }
  function setView(v) {
    view = v;
    $('acts-view-list').setAttribute('aria-pressed', v === 'list');
    $('acts-view-cal').setAttribute('aria-pressed', v === 'cal');
    render();
  }
  function toListTop() {
    var bar = $('acts-bar').getBoundingClientRect(), list = $('acts-count').getBoundingClientRect();
    if (list.top < bar.bottom) window.scrollBy(0, list.top - bar.bottom);
  }
  function find(id) { return acts.filter(function (a) { return a.id === +id; })[0] || null; }

  // ---------- the dialog ----------
  function openDlg() {
    var d = $('act-dlg');
    if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  }
  function closeDlg() { var d = $('act-dlg'); dlg = null; if (d.open) { if (d.close) d.close(); else d.removeAttribute('open'); } }

  // The name + code block: asked only until the server has accepted them once in this visit.
  function whoBlock(why) {
    if (me) return '<p class="hint awho">פועלים בשם <strong>' + esc(me.user) + '</strong>. <button type="button" class="btn-link" id="act-switch">החלפה</button></p>';
    var m = A.me(), name = m ? m.user : A.remembered();
    return '<fieldset class="awho"><legend>' + esc(why) + '</legend>' +
      '<div class="fields"><div class="field"><label for="act-user">שם המשפחה</label>' +
      '<input id="act-user" type="text" list="reg-names" autocomplete="off" maxlength="40" value="' + esc(name) + '"></div>' +
      '<div class="field"><label for="act-pin">הקוד של ההרשמה</label>' +
      '<input id="act-pin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]*" maxlength="8" value="' + esc(m ? m.pin : '') + '"></div></div></fieldset>';
  }
  function creds() {
    if (me) return me;
    var u = $('act-user'), p = $('act-pin'), user = u.value.trim().replace(/\s+/g, ' '), pin = p.value.trim();
    if (user.length < 2) { u.focus(); return { error: 'bad_user' }; }
    if (!/^\d{4,8}$/.test(pin)) { p.focus(); return { error: 'bad_pin' }; }
    return { user: user, pin: pin };
  }

  function details(id) {
    var a = find(id);
    if (!a) { closeDlg(); return; }
    dlg = { mode: 'details', id: a.id };
    var j = myJoin(a), full = isFull(a), owner = isMine(a.owner);
    var joined = a.joined.length ? '<ul class="ajoined">' + a.joined.map(function (x) {
      return '<li>' + esc(x.family) + ' <small>(' + x.count + ')</small></li>'; }).join('') + '</ul>' : '<p class="hint">עוד אף אחד לא הצטרף.</p>';
    var free = a.capacity ? a.capacity - a.taken + (j ? j.count : 0) : 30;
    $('act-dlg-body').innerHTML =
      '<h2 id="act-dlg-title">' + esc(a.topic) + '</h2>' +
      '<p class="awhen">' + esc(when(a)) + '</p>' +
      '<p><span class="atag' + tc(a.tag) + '">' + esc(tagText(a)) + '</span> · מארגנים: ' + esc(a.owner) + '</p>' +
      (a.description ? '<p class="adesc">' + esc(a.description) + '</p>' : '') +
      (a.required ? '<p><strong>חובה להביא:</strong> ' + esc(a.required) + '</p>' : '') +
      (a.suggested ? '<p><strong>מומלץ להביא:</strong> ' + esc(a.suggested) + '</p>' : '') +
      '<h3>מקומות</h3><p id="act-places">' + esc(placesText(a)) + '</p>' + joined +
      '<div class="aact">' + whoBlock('כדי להצטרף, שם המשפחה והקוד מההרשמה') +
      (full && !j ? '<p class="hint">הפעילות מלאה.</p>' :
        '<div class="ajoin"><label for="act-count">כמה משתתפים מהמשפחה</label>' +
        '<input id="act-count" type="number" inputmode="numeric" min="1" max="' + Math.max(1, Math.min(30, free)) + '" value="' + (j ? j.count : 1) + '">' +
        '<button type="button" id="act-join" class="btn-primary">' + (j ? 'עדכון מספר המשתתפים' : 'הצטרפות') + '</button></div>') +
      '<div class="actions">' +
      (j ? '<button type="button" id="act-leave" class="btn-secondary">יציאה מהפעילות</button>' : '') +
      '<button type="button" id="act-edit" class="btn-secondary"' + (owner ? '' : ' hidden') + '>עריכה</button>' +
      '<button type="button" id="act-cancel" class="btn-link"' + (owner ? '' : ' hidden') + '>ביטול הפעילות</button>' +
      '</div><p id="act-msg" class="msg" role="status" aria-live="polite"></p></div>';
    openDlg();
  }

  function opts(list, value) {
    if (value && list.indexOf(value) < 0) list = list.concat([value]).sort();
    return list.map(function (v) { return '<option value="' + v + '"' + (v === value ? ' selected' : '') + '>' + v + '</option>'; }).join('');
  }
  function dayOpts(value) {
    return tripDays().map(function (d) { return '<option value="' + d + '"' + (d === value ? ' selected' : '') + '>' + esc(dayLabel(d)) + '</option>'; }).join('');
  }
  var HOURS = [], MINS = ['00', '15', '30', '45'];
  for (var i = 0; i < 24; i++) HOURS.push(('0' + i).slice(-2));
  function timeFields(key, label, t) {
    return '<fieldset class="atimef"><legend>' + label + '</legend>' +
      '<label class="sr-only" for="af-' + key + '-day">יום</label><select id="af-' + key + '-day">' + dayOpts(t.slice(0, 10)) + '</select>' +
      '<span class="hmsel" dir="ltr"><label class="sr-only" for="af-' + key + '-h">שעה</label><select id="af-' + key + '-h">' + opts(HOURS, t.slice(11, 13)) + '</select>' +
      ':<label class="sr-only" for="af-' + key + '-m">דקות</label><select id="af-' + key + '-m">' + opts(MINS, t.slice(14, 16)) + '</select></span></fieldset>';
  }
  function form(id) {
    var a = id ? find(id) : null;
    if (id && !a) { closeDlg(); return; }
    dlg = { mode: 'form', id: a ? a.id : null, cid: a ? null : newCid(), endTouched: !!a };
    var start = a ? a.start : (day || TRIP.from) + 'T10:00', end = a ? a.end : start.slice(0, 11) + '11:00';
    var t = a ? a.tag : 'לכולם';
    $('act-dlg-body').innerHTML =
      '<h2 id="act-dlg-title">' + (a ? 'עריכת פעילות' : 'פעילות חדשה') + '</h2>' +
      '<form id="act-form" novalidate>' + whoBlock('מי מארגנים? שם המשפחה והקוד מההרשמה') +
      '<div class="field"><label for="af-topic">נושא</label><input id="af-topic" type="text" maxlength="60" autocomplete="off" placeholder="למשל: סדנת עפיפונים" value="' + esc(a ? a.topic : '') + '"></div>' +
      '<div class="field"><label for="af-desc">תיאור (לא חובה)</label><textarea id="af-desc" rows="3" maxlength="600">' + esc(a ? a.description : '') + '</textarea></div>' +
      timeFields('start', 'התחלה', start) + timeFields('end', 'סיום', end) +
      '<fieldset class="atagf"><legend>למי מתאים</legend><div class="chips">' + TAGS.map(function (x) {
        return '<label class="chip"><input type="radio" name="af-tag" value="' + x + '"' + (x === t ? ' checked' : '') + '> ' + x + '</label>'; }).join('') + '</div>' +
      '<div id="af-ages" class="fields"' + (t === 'ילדים' ? '' : ' hidden') + '>' +
      '<div class="field"><label for="af-from">מגיל (לא חובה)</label><input id="af-from" type="number" inputmode="numeric" min="0" max="99" value="' + (a && a.ageFrom != null ? a.ageFrom : '') + '"></div>' +
      '<div class="field"><label for="af-to">עד גיל (לא חובה)</label><input id="af-to" type="number" inputmode="numeric" min="0" max="99" value="' + (a && a.ageTo != null ? a.ageTo : '') + '"></div></div></fieldset>' +
      '<div class="field"><label for="af-cap">מספר מקומות (ריק = אין הגבלה)</label><input id="af-cap" type="number" inputmode="numeric" min="1" max="500" value="' + (a && a.capacity ? a.capacity : '') + '"></div>' +
      '<div class="field"><label for="af-req">חובה להביא (לא חובה)</label><input id="af-req" type="text" maxlength="200" autocomplete="off" value="' + esc(a ? a.required : '') + '"></div>' +
      '<div class="field"><label for="af-sug">מומלץ להביא (לא חובה)</label><input id="af-sug" type="text" maxlength="200" autocomplete="off" value="' + esc(a ? a.suggested : '') + '"></div>' +
      '<div class="actions"><button type="submit" id="af-save" class="btn-primary">' + (a ? 'שמירת השינויים' : 'הוספת הפעילות') + '</button>' +
      '<button type="button" id="af-back" class="btn-link">' + (a ? 'חזרה לפעילות' : 'ביטול') + '</button></div>' +
      '<p id="act-msg" class="msg" role="status" aria-live="polite"></p></form>';
    openDlg();
    $('af-topic').focus();
  }
  function readTime(key) { return $('af-' + key + '-day').value + 'T' + $('af-' + key + '-h').value + ':' + $('af-' + key + '-m').value; }
  function readForm() {
    var t = (document.querySelector('input[name="af-tag"]:checked') || {}).value || '';
    return { topic: $('af-topic').value.trim(), description: $('af-desc').value.trim(),
             start: readTime('start'), end: readTime('end'), tag: t,
             ageFrom: t === 'ילדים' ? $('af-from').value.trim() : '', ageTo: t === 'ילדים' ? $('af-to').value.trim() : '',
             capacity: $('af-cap').value.trim(), required: $('af-req').value.trim(), suggested: $('af-sug').value.trim() };
  }
  function checkForm(f) {
    if (f.topic.length < 3) return ['too_short', 'af-topic'];
    if (f.end <= f.start) return ['end_before_start', 'af-end-h'];
    var from = f.ageFrom === '' ? null : +f.ageFrom, to = f.ageTo === '' ? null : +f.ageTo;
    if ((from != null && !(from >= 0 && from <= 99 && from % 1 === 0)) || (to != null && !(to >= 0 && to <= 99 && to % 1 === 0)) ||
        (from != null && to != null && from > to)) return ['bad_age', 'af-from'];
    if (f.capacity !== '' && !(+f.capacity >= 1 && +f.capacity <= 500 && +f.capacity % 1 === 0)) return ['bad_capacity', 'af-cap'];
    var a = dlg.id ? find(dlg.id) : null;
    if (a && f.capacity !== '' && +f.capacity < a.taken) return ['below_joined', 'af-cap'];
    return null;
  }

  // One write: wait for the server's verdict, take the fresh list it answers with.
  var writing = false;
  function write(body, onOk) {
    if (writing) return;
    var c = creds(), msg = $('act-msg');
    if (c.error) { say(msg, ERR[c.error], 'bad'); return; }
    writing = true;
    var buttons = $('act-dlg-body').querySelectorAll('button');
    buttons.forEach(function (b) { b.disabled = true; });
    say(msg, 'שומר…');
    body.user = c.user; body.pin = c.pin;
    A.api(body).then(function (res) {
      writing = false;
      buttons.forEach(function (b) { b.disabled = false; });
      if (!res.ok) {
        if (CRED_ERRORS[res.error] && me) { me = null; if (dlg) (dlg.mode === 'form' ? keepForm : details)(dlg.id); }
        say($('act-msg'), ERR[res.error] || 'משהו השתבש. נסו שוב.', 'bad');
        return;
      }
      me = { user: c.user, pin: c.pin };
      take(res.activities);
      onOk(res);
    });
  }
  // Re-draw the form with the name + code block back in, keeping what was typed.
  function keepForm() {
    var f = readForm(), d = dlg;
    form(d.id);
    dlg.cid = d.cid || dlg.cid; dlg.endTouched = d.endTouched;
    ['topic', 'desc', 'from', 'to', 'cap', 'req', 'sug'].forEach(function (k, i) {
      $('af-' + k).value = [f.topic, f.description, f.ageFrom, f.ageTo, f.capacity, f.required, f.suggested][i];
    });
    setTime('start', f.start); setTime('end', f.end);
    document.querySelectorAll('input[name="af-tag"]').forEach(function (r) { r.checked = r.value === f.tag; });
    $('af-ages').hidden = f.tag !== 'ילדים';
  }
  function setTime(key, t) {
    $('af-' + key + '-day').value = t.slice(0, 10);
    $('af-' + key + '-h').value = t.slice(11, 13);
    var m = $('af-' + key + '-m');
    if (![].some.call(m.options, function (o) { return o.value === t.slice(14, 16); })) m.insertAdjacentHTML('beforeend', '<option>' + t.slice(14, 16) + '</option>');
    m.value = t.slice(14, 16);
  }

  function take(list) {
    acts = list || [];
    writeJson(CACHE_KEY, { activities: acts });
    render();
  }

  // ---------- events ----------
  function init() {
    renderChips();
    $('acts-view-list').addEventListener('click', function () { setView('list'); });
    $('acts-view-cal').addEventListener('click', function () { setView('cal'); });
    $('acts-q').addEventListener('input', function () { render(); toListTop(); });
    $('acts-days').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-day]'); if (!b) return;
      day = b.getAttribute('data-day'); calPage = 0;
      renderChips(); render(); toListTop();
    });
    $('acts-tags').addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-tag]'); if (!b) return;
      tag = b.getAttribute('data-tag');
      renderChips(); render(); toListTop();
    });
    function openFrom(e) {
      var b = e.target.closest && e.target.closest('[data-id]');
      if (b) details(b.getAttribute('data-id'));
    }
    $('acts-list').addEventListener('click', openFrom);
    $('acts-cal').addEventListener('click', function (e) {
      if (e.target.closest('#acts-prev')) { calPage -= PHONE_DAYS; render(); return; }
      if (e.target.closest('#acts-next')) { calPage += PHONE_DAYS; render(); return; }
      openFrom(e);
    });
    if (phone.addEventListener) phone.addEventListener('change', function () { if (view === 'cal') render(); });
    $('acts-add').addEventListener('click', function () { form(null); });
    $('act-dlg-close').addEventListener('click', closeDlg);
    $('act-dlg').addEventListener('close', function () { dlg = null; });
    $('act-dlg').addEventListener('click', function (e) { if (e.target === $('act-dlg')) closeDlg(); });   // the backdrop

    var body = $('act-dlg-body');
    body.addEventListener('input', function (e) {
      // the owner's buttons follow the name typed
      if (e.target.id === 'act-user' && dlg && dlg.mode === 'details') {
        var a = find(dlg.id), n = e.target.value, own = !!a && A.norm(n) === A.norm(a.owner);
        $('act-edit').hidden = !own; $('act-cancel').hidden = !own;
      }
    });
    body.addEventListener('change', function (e) {
      var id = e.target.id || e.target.name;
      if (id === 'af-tag') $('af-ages').hidden = e.target.value !== 'ילדים';
      if (/^af-end-/.test(id)) dlg.endTouched = true;
      if (/^af-start-/.test(id) && !dlg.endTouched) {      // the end follows the start: same day, an hour later
        var s = readTime('start'), h = Math.min(23, +s.slice(11, 13) + 1);
        setTime('end', s.slice(0, 11) + ('0' + h).slice(-2) + ':' + (h === 23 && +s.slice(11, 13) === 23 ? '59' : s.slice(14, 16)));
      }
    });
    body.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('button'); if (!t || !dlg) return;
      var a = dlg.id ? find(dlg.id) : null;
      if (t.id === 'act-switch') { me = null; (dlg.mode === 'form' ? keepForm : details)(dlg.id); return; }
      if (t.id === 'act-join') {
        var n = +$('act-count').value;
        if (!(n >= 1 && n <= 30 && n % 1 === 0)) { say($('act-msg'), ERR.bad_count, 'bad'); $('act-count').focus(); return; }
        write({ action: 'join', id: a.id, count: n }, function () {
          details(a.id); say($('act-msg'), 'הצטרפתם! ' + n + (n === 1 ? ' משתתף.' : ' משתתפים.'), 'good');
        });
      } else if (t.id === 'act-leave') {
        write({ action: 'leave', id: a.id }, function () { details(a.id); say($('act-msg'), 'יצאתם מהפעילות.', 'good'); });
      } else if (t.id === 'act-edit') {
        form(a.id);
      } else if (t.id === 'act-cancel') {
        var q = a.taken ? 'כבר הצטרפו לפעילות ' + a.taken + ' משתתפים. לבטל אותה בכל זאת?' : 'לבטל את הפעילות "' + a.topic + '"?';
        if (!window.confirm(q)) return;
        write({ action: 'deleteActivity', id: a.id }, function () {
          closeDlg(); say($('acts-state'), 'הפעילות "' + a.topic + '" בוטלה.', 'good');
        });
      } else if (t.id === 'af-back') {
        if (dlg.id) details(dlg.id); else closeDlg();
      }
    });
    body.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = readForm(), bad = checkForm(f);
      if (bad) { say($('act-msg'), ERR[bad[0]], 'bad'); $(bad[1]).focus(); return; }
      var req = { action: 'saveActivity', activity: f }, editing = !!dlg.id;
      if (editing) req.id = dlg.id; else req.clientId = dlg.cid;
      write(req, function (res) {
        details(res.id);
        say($('act-msg'), editing ? 'השינויים נשמרו.' : 'הפעילות נוספה, וכולם רואים אותה.', 'good');
      });
    });
  }

  // ---------- data: this browser's copy at once, a fresh one in the background ----------
  function start() {
    if (started) return;
    started = true;
    var cached = readJson(CACHE_KEY);
    if (cached && cached.activities) { acts = cached.activities; say($('acts-state'), ''); render(); }
    if (!C.apiUrl) { say($('acts-state'), 'הפעילויות עדיין לא פעילות.'); $('acts-add').hidden = true; return; }
    A.api({ action: 'activities' }).then(function (res) {
      if (res.ok) {
        live = true;
        if (res.trip) TRIP = res.trip;
        say($('acts-state'), '');
        $('acts-add').hidden = false;
        if (JSON.stringify(res.activities) !== JSON.stringify(acts) || !cached) { renderChips(); take(res.activities); }
        else render();
        return;
      }
      // the live script before the activities version answers "bad_request"
      if (res.error === 'bad_request') { say($('acts-state'), 'הפעילויות ייפתחו בקרוב.'); $('acts-add').hidden = true; }
      else { say($('acts-state'), cached ? '' : ERR.network, cached ? '' : 'bad'); started = false; }
    });
  }

  init();
  $('acts-add').hidden = true;             // until the server says activities are open
  render();
  $('tab-acts').addEventListener('click', start);
  $('tab-acts').addEventListener('focus', start);
  if (!$('panel-acts').hidden) start();
  else if (window.requestIdleCallback) requestIdleCallback(start, { timeout: 2500 });
  else setTimeout(start, 1500);
})();
