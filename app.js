(function () {
  'use strict';
  var C = window.CAMP;
  var STORE_KEY = 'achziv-calc-v1';
  var ALL = C.categories.concat(C.extras);
  var byId = {};
  ALL.forEach(function (c) { byId[c.id] = c; });

  // ---------- pure helpers (also exported for tests) ----------
  var DAY = 86400000;
  var WEEKDAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  function toTime(iso) { var p = iso.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function toIso(t) { return new Date(t).toISOString().slice(0, 10); }
  function dm(iso) { var p = iso.split('-'); return p[2] + '/' + p[1]; }          // day-first
  function dmy(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
  function weekday(iso) { return WEEKDAYS[new Date(toTime(iso)).getUTCDay()]; }
  function nightsBetween(from, to) { return Math.round((toTime(to) - toTime(from)) / DAY); }

  function emptyCounts() {
    var o = {};
    ALL.forEach(function (c) { o[c.id] = 0; });
    return o;
  }

  function peopleIn(counts) {
    return C.categories.reduce(function (s, c) { return s + (counts[c.id] || 0); }, 0);
  }

  // One period: every line priced at full and at group rate.
  function calcPeriod(counts, nights) {
    var lines = [], full = 0, group = 0;
    if (nights <= 0) return { lines: lines, full: 0, group: 0 };
    ALL.forEach(function (c) {
      var n = counts[c.id] || 0;
      if (!n) return;
      var f = n * c.price * nights;
      var g = n * (c.groupPrice != null ? c.groupPrice : c.price) * nights;
      lines.push({ id: c.id, label: c.label, count: n, price: c.price, groupPrice: c.groupPrice, nights: nights, full: f, group: g });
      full += f; group += g;
    });
    return { lines: lines, full: full, group: group };
  }

  function calcAll(state) {
    var periods = state.periods.map(function (p) {
      var counts = p.custom ? p.counts : state.base;
      var nights = nightsBetween(p.from, p.to);
      var r = calcPeriod(counts, nights);
      r.from = p.from; r.to = p.to; r.nights = nights; r.people = peopleIn(counts);
      return r;
    });
    var full = 0, group = 0, maxPeople = 0;
    periods.forEach(function (r) { full += r.full; group += r.group; if (r.nights > 0) maxPeople = Math.max(maxPeople, r.people); });
    return { periods: periods, full: full, group: group, maxPeople: maxPeople };
  }

  function warnings(state) {
    var w = [];
    var ps = state.periods.map(function (p, i) { return { i: i, from: p.from, to: p.to, n: nightsBetween(p.from, p.to) }; });
    ps.forEach(function (p) {
      if (p.n <= 0) w.push('תקופה ' + (p.i + 1) + ': תאריך העזיבה חייב להיות אחרי תאריך ההגעה.');
      else if (p.n > C.maxConsecutiveNights) w.push('תקופה ' + (p.i + 1) + ': אפשר לכל היותר ' + C.maxConsecutiveNights + ' לילות ברצף.');
    });
    for (var a = 0; a < ps.length; a++) for (var b = a + 1; b < ps.length; b++) {
      if (ps[a].n > 0 && ps[b].n > 0 && toTime(ps[a].from) < toTime(ps[b].to) && toTime(ps[b].from) < toTime(ps[a].to))
        w.push('תקופות ' + (a + 1) + ' ו-' + (b + 1) + ' חופפות — אותו לילה ייספר פעמיים.');
    }
    var people = peopleIn(state.base) + state.periods.reduce(function (s, p) { return s + (p.custom ? peopleIn(p.counts) : 0); }, 0);
    if (!people) w.push('עדיין לא הוספתם אף לן.');
    return w;
  }

  // People sleeping each night, keyed by the ISO date of the evening.
  function nightsCount(state) {
    var out = {};
    state.periods.forEach(function (p) {
      var n = peopleIn(p.custom ? p.counts : state.base);
      if (!n) return;
      for (var t = toTime(p.from); t < toTime(p.to); t += DAY) { var k = toIso(t); out[k] = (out[k] || 0) + n; }
    });
    return out;
  }

  window.CampCalc = { calcPeriod: calcPeriod, calcAll: calcAll, warnings: warnings, nightsBetween: nightsBetween, dm: dm, nightsCount: nightsCount };
  if (typeof document === 'undefined') return;   // loaded by tests only

  // ---------- state ----------
  function defaultState() {
    var base = emptyCounts(); base.adult = 2;
    return { base: base, periods: [{ from: C.defaultFrom, to: C.defaultTo, custom: false, counts: emptyCounts() }] };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (s && s.base && s.periods && s.periods.length) {
        s.base = Object.assign(emptyCounts(), s.base);
        s.periods.forEach(function (p) { p.counts = Object.assign(emptyCounts(), p.counts); });
        return s;
      }
    } catch (e) { /* no storage — start fresh */ }
    return defaultState();
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  var state = load();

  // ---------- formatting ----------
  var nf = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
  function money(n) { return nf.format(n) + ' ₪'; }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- info bubbles: hover, keyboard focus, or tap (phones have no hover) ----------
  var uid = 0;
  function tip(text, about) {
    var id = 'tip' + (++uid);
    return '<span class="tip"><button type="button" class="tip-btn" aria-expanded="false" aria-describedby="' + id + '"' +
      ' aria-label="מידע נוסף' + (about ? ': ' + esc(about) : '') + '">i</button>' +
      '<span class="tip-bubble" role="tooltip" id="' + id + '">' + esc(text) + '</span></span>';
  }
  function closeTips(except) {
    document.querySelectorAll('.tip.open').forEach(function (t) {
      if (t !== except) { t.classList.remove('open'); t.querySelector('.tip-btn').setAttribute('aria-expanded', 'false'); }
    });
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.tip-btn');
    if (!btn) { closeTips(); return; }
    var t = btn.parentNode, open = !t.classList.contains('open');
    closeTips(t);
    t.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeTips(); });

  // Position the bubble in viewport coordinates, clamped so it never leaves a narrow screen.
  function placeTip(t) {
    var btn = t.querySelector('.tip-btn'), bub = t.querySelector('.tip-bubble');
    if (getComputedStyle(bub).display === 'none') return;
    var r = btn.getBoundingClientRect(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var w = bub.offsetWidth, h = bub.offsetHeight, m = 8;
    var cx = r.left + r.width / 2;
    var left = Math.max(m, Math.min(vw - w - m, cx - w / 2));
    var below = r.bottom + 8 + h <= vh - m || r.top - 8 - h < m;
    bub.style.left = left + 'px';
    bub.style.top = (below ? r.bottom + 8 : r.top - 8 - h) + 'px';
    bub.style.setProperty('--arrow-x', (cx - left) + 'px');
    bub.classList.toggle('above', !below);
  }
  function placeLater(e) {
    var t = e.target.closest && e.target.closest('.tip');
    if (t) requestAnimationFrame(function () { placeTip(t); });
  }
  document.addEventListener('mouseover', placeLater);
  document.addEventListener('focusin', placeLater);
  document.addEventListener('click', placeLater);
  window.addEventListener('scroll', function () { document.querySelectorAll('.tip').forEach(placeTip); }, { passive: true });
  window.addEventListener('resize', function () { document.querySelectorAll('.tip').forEach(placeTip); });
  // static bubbles written in index.html as <span data-tip="...">
  document.querySelectorAll('[data-tip]').forEach(function (s) { s.outerHTML = tip(s.getAttribute('data-tip'), s.getAttribute('data-about')); });

  // ---------- counters ----------
  function counter(cat, counts) {
    var id = 'c' + (++uid);
    var row = el('div', { 'class': 'counter' });
    var priceTxt = cat.price ? money(cat.price) + (cat.unit ? ' ' + cat.unit : ' ללילה') : 'חינם';
    row.innerHTML =
      '<div class="who"><label for="' + id + '"><span class="lbl">' + esc(cat.label) + '</span>' +
      '<span class="meta">' + (cat.ages ? esc(cat.ages) + ' · ' : '') + priceTxt + '</span></label>' +
      (cat.note ? tip(cat.note, cat.label) : '') + '</div>' +
      '<div class="stepper">' +
      '<button type="button" class="step" data-d="1" aria-label="הוספת ' + esc(cat.label) + '">+</button>' +
      '<input id="' + id + '" type="number" inputmode="numeric" min="0" max="99" value="' + (counts[cat.id] || 0) + '">' +
      '<button type="button" class="step" data-d="-1" aria-label="הפחתת ' + esc(cat.label) + '">−</button>' +
      '</div>';
    var input = row.querySelector('input');
    function set(v) {
      v = Math.max(0, Math.min(99, parseInt(v, 10) || 0));
      counts[cat.id] = v; input.value = v;
      update();
    }
    input.addEventListener('input', function () { set(input.value); });
    row.querySelectorAll('.step').forEach(function (b) {
      b.addEventListener('click', function () { set((counts[cat.id] || 0) + (+b.dataset.d)); });
    });
    return row;
  }
  function fillCounters(container, cats, counts) {
    container.innerHTML = '';
    cats.forEach(function (c) { container.appendChild(counter(c, counts)); });
  }
  var mainCats = C.categories.filter(function (c) { return c.main; });
  var discCats = C.categories.filter(function (c) { return !c.main; });
  function hasAny(counts, cats) { return cats.some(function (c) { return counts[c.id] > 0; }); }

  function renderBase() {
    fillCounters(document.getElementById('base-main'), mainCats, state.base);
    fillCounters(document.getElementById('base-discounts'), discCats, state.base);
    fillCounters(document.getElementById('base-extras'), C.extras, state.base);
    if (hasAny(state.base, discCats)) document.getElementById('base-discounts-box').open = true;
    if (hasAny(state.base, C.extras)) document.getElementById('base-extras-box').open = true;
  }

  // ---------- periods ----------
  var dateOptions = [];
  for (var t = toTime(C.dateRangeStart); t <= toTime(C.dateRangeEnd); t += DAY) dateOptions.push(toIso(t));

  function dateSelect(id, value) {
    var opts = dateOptions.slice();
    if (opts.indexOf(value) < 0) { opts.push(value); opts.sort(); }
    return '<select id="' + id + '">' + opts.map(function (d) {
      return '<option value="' + d + '"' + (d === value ? ' selected' : '') + '>' + weekday(d) + ' ' + dmy(d) + '</option>';
    }).join('') + '</select>';
  }

  function renderPeriods() {
    var box = document.getElementById('periods');
    box.innerHTML = '';
    var multi = state.periods.length > 1;
    state.periods.forEach(function (p, i) {
      var card = el('fieldset', { 'class': 'period' });
      var fId = 'pf' + i, tId = 'pt' + i, cId = 'pc' + i;
      card.innerHTML =
        '<legend>' + (multi ? 'תקופה ' + (i + 1) : 'תאריכי השהייה') + ' ' +
          tip('כניסה לחניון בין 15:00 ל-19:00. פינוי עד 12:00 ביום העזיבה (מי שנשאר אחרי 12:00 משלם תוספת של 50% מדמי כניסת יום). עד ' + C.maxConsecutiveNights + ' לילות ברצף.', 'שעות') + '</legend>' +
        '<div class="dates">' +
        '<label for="' + fId + '">הגעה<br>' + dateSelect(fId, p.from) + '</label>' +
        '<label for="' + tId + '">עזיבה<br>' + dateSelect(tId, p.to) + '</label>' +
        '<span class="nights" aria-live="polite"></span>' +
        '</div>' +
        '<div class="check"><label><input type="checkbox" id="' + cId + '"' + (p.custom ? ' checked' : '') + '> הרכב שונה בתקופה הזו</label> ' +
        tip('למשל: סבא וסבתא מצטרפים רק ללילה אחד, או אחד ההורים מגיע מאוחר יותר. אם לא מסמנים, התקופה משתמשת בהרכב שלמעלה.', 'הרכב שונה') + '</div>' +
        '<div class="custom" ' + (p.custom ? '' : 'hidden') + '></div>' +
        (multi ? '<button type="button" class="remove" aria-label="מחיקת תקופה ' + (i + 1) + '" title="מחיקת התקופה">' +
          '<svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>' +
          '<path d="M10 11v6"/><path d="M14 11v6"/></svg></button>' : '');
      var nightsEl = card.querySelector('.nights');
      function showNights() { var n = nightsBetween(p.from, p.to); nightsEl.textContent = n > 0 ? n + (n === 1 ? ' לילה' : ' לילות') : '—'; }
      showNights();
      card.querySelector('#' + fId).addEventListener('change', function (e) { p.from = e.target.value; showNights(); update(); });
      card.querySelector('#' + tId).addEventListener('change', function (e) { p.to = e.target.value; showNights(); update(); });
      var customBox = card.querySelector('.custom');
      function fillCustom() {
        customBox.innerHTML = '<p class="hint">ההרכב בתקופה הזו בלבד:</p>';
        var c1 = el('div', { 'class': 'counters' }), c2 = el('div', { 'class': 'counters' }), c3 = el('div', { 'class': 'counters' });
        fillCounters(c1, mainCats, p.counts);
        var d = el('details'); d.appendChild(el('summary', null, 'הנחות וזכאויות')); fillCounters(c2, discCats, p.counts); d.appendChild(c2);
        if (hasAny(p.counts, discCats)) d.open = true;
        var x = el('details'); x.appendChild(el('summary', null, 'תוספות')); fillCounters(c3, C.extras, p.counts); x.appendChild(c3);
        if (hasAny(p.counts, C.extras)) x.open = true;
        customBox.appendChild(c1); customBox.appendChild(d); customBox.appendChild(x);
      }
      if (p.custom) fillCustom();
      card.querySelector('#' + cId).addEventListener('change', function (e) {
        p.custom = e.target.checked;
        if (p.custom) { p.counts = Object.assign(emptyCounts(), state.base); fillCustom(); customBox.hidden = false; }
        else { customBox.hidden = true; customBox.innerHTML = ''; }
        update();
      });
      var rm = card.querySelector('.remove');
      if (rm) rm.addEventListener('click', function () {
        var n = nightsBetween(p.from, p.to);
        if (!confirm('למחוק את תקופה ' + (i + 1) + ' (' + dm(p.from) + ' עד ' + dm(p.to) + ', ' + n + (n === 1 ? ' לילה' : ' לילות') + ')?')) return;
        state.periods.splice(i, 1); renderPeriods(); update();
        var next = document.getElementById('pf' + Math.min(i, state.periods.length - 1));
        if (next) next.focus();
      });
      box.appendChild(card);
    });
  }

  document.getElementById('add-period').addEventListener('click', function () {
    var last = state.periods[state.periods.length - 1];
    var from = last.to, to = toIso(toTime(from) + DAY);
    state.periods.push({ from: from, to: to, custom: false, counts: emptyCounts() });
    renderPeriods(); update();
    var sel = document.getElementById('pf' + (state.periods.length - 1));
    if (sel) sel.focus();
  });

  document.getElementById('reset').addEventListener('click', function () {
    state = defaultState(); renderBase(); renderPeriods(); update();
  });

  // ---------- result ----------
  function renderResult() {
    var r = calcAll(state), w = warnings(state);
    var out = '';
    if (w.length) out += '<ul class="warn">' + w.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';

    r.periods.forEach(function (p, i) {
      if (p.nights <= 0) return;
      out += '<div class="breakdown"><h3>' + (r.periods.length > 1 ? 'תקופה ' + (i + 1) + ': ' : '') +
        dm(p.from) + ' עד ' + dm(p.to) + ' · ' + p.nights + (p.nights === 1 ? ' לילה' : ' לילות') + ' · ' + p.people + ' לנים</h3>';
      if (!p.lines.length) out += '<p class="hint">אין לנים בתקופה הזו.</p>';
      else {
        out += '<table><tbody>' + p.lines.map(function (l) {
          return '<tr><td>' + esc(l.label) + '</td><td class="num">' + l.count + ' × ' + money(l.price) +
            ' × ' + l.nights + (l.nights === 1 ? ' לילה' : ' לילות') + '</td><td class="num">' + money(l.full) + '</td></tr>';
        }).join('') + '</tbody></table>';
      }
      out += '</div>';
    });

    var saved = r.full - r.group;
    out += '<div class="totals">' +
      '<div class="total"><span>מחיר מלא (מקסימום) ' +
        tip('לפי המחירון הרגיל, כולל ביקור בגן הלאומי. משלמים בקופה בהגעה (אשראי או מזומן).', 'מחיר מלא') + '</span><strong>' + money(r.full) + '</strong></div>' +
      '<div class="total group"><span>אם הקבוצה תמנה ' + C.groupMinPeople + ' לנים לפחות ' +
        tip('קבוצה שמגיעה יחד ומונה 30 לנים לפחות משלמת 65 ₪ למבוגר ו-49 ₪ לילד (בערך 15% הנחה). ההנחה חלה רק על מי שמשלם מחיר רגיל, כי אין כפל הנחות.', 'מחיר קבוצתי') + '</span><strong>' + money(r.group) + '</strong>' +
      (saved > 0 ? '<small>חיסכון של ' + money(saved) + ' — הנחה קבוצתית (~15%) למשלמי מחיר רגיל</small>'
                 : '<small>אין אצלכם משלמי מחיר רגיל, ולכן ההנחה הקבוצתית לא משנה את המחיר (אין כפל הנחות)</small>') +
      '</div></div>';
    if (r.maxPeople) out += '<p class="hint">אתם מוסיפים לקבוצה עד <strong>' + r.maxPeople + '</strong> לנים.</p>';
    out += '<p class="hint">המחיר כולל ביקור בגן הלאומי. משלמים בקופה בהגעה. השאר אחרי 12:00 ביום העזיבה — בתוספת תשלום.</p>';
    document.getElementById('result').innerHTML = out;
  }

  function update() { renderResult(); save(); }

  // ---------- price table ----------
  function renderPriceTable() {
    var rows = ALL.map(function (c) {
      return '<tr><th scope="row">' + esc(c.label) + (c.ages ? '<br><small>' + esc(c.ages) + '</small>' : '') + '</th>' +
        '<td class="num">' + (c.price ? money(c.price) : 'חינם') + (c.unit ? ' <small>' + c.unit + '</small>' : '') + '</td>' +
        '<td class="num">' + (c.groupPrice != null ? money(c.groupPrice) : '—') + '</td>' +
        '<td><small>' + esc(c.note || '') + '</small></td></tr>';
    }).join('');
    document.getElementById('price-table').innerHTML =
      '<thead><tr><th scope="col">סוג</th><th scope="col">מחיר ללילה</th><th scope="col">בקבוצה (30+)</th><th scope="col">הערות</th></tr></thead><tbody>' + rows + '</tbody>';
    document.getElementById('source-link').href = C.sourceUrl;
    document.getElementById('checked-date').textContent = C.checked;
    document.querySelectorAll('.checked').forEach(function (e) { e.textContent = C.checked; });
  }

  // ---------- tabs (arrow keys follow RTL) ----------
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[role=tab]'));
  function selectTab(tab, focus) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute('aria-selected', on);
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    try { history.replaceState(null, '', '#' + tab.id.replace('tab-', '')); } catch (e) { /* ignore */ }
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { selectTab(t); });
    t.addEventListener('keydown', function (e) {
      var d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
      if (e.key === 'Home') { selectTab(tabs[0], true); e.preventDefault(); }
      else if (e.key === 'End') { selectTab(tabs[tabs.length - 1], true); e.preventDefault(); }
      else if (d) { selectTab(tabs[(i + d + tabs.length) % tabs.length], true); e.preventDefault(); }
    });
  });
  var fromHash = document.getElementById('tab-' + location.hash.slice(1));
  if (fromHash) selectTab(fromHash);

  // ---------- registration (Google Sheet backend) ----------
  var ERR = {
    bad_user: 'שם המשפחה צריך להכיל 2 עד 40 תווים.',
    bad_pin: 'הקוד צריך להיות 4 עד 8 ספרות.',
    wrong_pin: 'השם הזה כבר רשום, והקוד לא תואם. אם זו ההרשמה שלכם — בדקו את הקוד. אם לא — בחרו שם אחר.',
    locked: 'יותר מדי ניסיונות עם קוד שגוי. ההרשמה נעולה ל-15 דקות — נסו שוב אחר כך, או פנו למארגנים.',
    not_found: 'לא מצאנו הרשמה בשם הזה.',
    too_big: 'יותר מדי נתונים — נסו לצמצם את מספר התקופות.',
    network: 'אין חיבור לשרת כרגע. נסו שוב בעוד רגע.'
  };
  var REG_KEY = 'achziv-registered';   // the name this device last saved or loaded successfully
  var names = [];                      // registered names, from the summary (for the dropdown)
  var signedIn = null;                 // name loaded/saved in this page visit, with the right code
  function norm(u) { return String(u || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function known(u) { var n = norm(u); return names.some(function (x) { return norm(x) === n; }); }
  function remembered() { try { return localStorage.getItem(REG_KEY) || ''; } catch (e) { return ''; } }
  function remember(u) { try { if (u) localStorage.setItem(REG_KEY, u); else localStorage.removeItem(REG_KEY); } catch (e) { /* ignore */ } }
  // Google's web-app reply step fails intermittently (measured 30/09/2026: ~1 in 3 requests got a 404
  // page after the script had already run). Every action is safe to repeat, so retry until a JSON reply.
  function api(body, attempt) {
    attempt = attempt || 1;
    return fetch(C.apiUrl, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'text/plain;charset=utf-8' } : undefined,
                             body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json(); })
      .catch(function () {
        if (attempt >= 4) return { ok: false, error: 'network' };
        return new Promise(function (res) { setTimeout(res, 400 * attempt); })
          .then(function () { return api(body, attempt + 1); })
          .then(function (res) {
            // the first try may have deleted it and only the reply was lost
            if (body && body.action === 'delete' && res.error === 'not_found') return { ok: true, summary: null };
            return res;
          });
      });
  }
  function regMsg(text, kind) {
    var m = document.getElementById('reg-msg');
    m.textContent = text; m.className = 'msg' + (kind ? ' ' + kind : '');
  }
  function fail(res) { regMsg(ERR[res.error] || 'משהו השתבש. נסו שוב.', 'bad'); }
  // A new name needs the code typed twice; an existing name (or one already loaded here) does not.
  function needsConfirm() {
    var u = document.getElementById('reg-user').value;
    return !(known(u) || (signedIn && norm(signedIn) === norm(u)));
  }
  function syncConfirm() { document.getElementById('reg-pin2-field').hidden = !needsConfirm(); }
  function creds(forSave) {
    var user = document.getElementById('reg-user').value.trim().replace(/\s+/g, ' ');
    var pin = document.getElementById('reg-pin').value.trim();
    if (user.length < 2) { regMsg(ERR.bad_user, 'bad'); document.getElementById('reg-user').focus(); return null; }
    if (!/^\d{4,8}$/.test(pin)) { regMsg(ERR.bad_pin, 'bad'); document.getElementById('reg-pin').focus(); return null; }
    if (forSave && needsConfirm() && document.getElementById('reg-pin2').value.trim() !== pin) {
      regMsg('הקוד והאימות שלו לא זהים — הקלידו את אותו קוד בשני השדות.', 'bad');
      document.getElementById('reg-pin2').focus(); return null;
    }
    return { user: user, pin: pin };
  }
  function busy(on) { document.querySelectorAll('#reg-form button').forEach(function (b) { b.disabled = on; }); }

  function renderGroup(sum) {
    if (!sum || !sum.ok) return;
    if (sum.names) {
      names = sum.names;
      document.getElementById('reg-names').innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
      syncConfirm();
    }
    document.getElementById('group-card').hidden = false;
    var box = document.getElementById('group-status');
    var keys = Object.keys(sum.nights).sort();
    if (!keys.length) { box.innerHTML = '<p class="hint">עוד אין הרשמות.</p>'; return; }
    var min = C.groupMinPeople;
    box.innerHTML = '<p><strong>' + sum.families + '</strong> ' + (sum.families === 1 ? 'משפחה רשומה' : 'משפחות רשומות') + '.</p>' +
      '<table class="nights-table"><thead><tr><th scope="col">לילה</th><th scope="col">לנים</th><th scope="col">מחיר קבוצתי?</th></tr></thead><tbody>' +
      keys.map(function (k) {
        var n = sum.nights[k];
        return '<tr><td>' + weekday(k) + ' ' + dm(k) + '</td><td class="num">' + n + '</td><td>' +
          (n >= min ? '<span class="yes">✓ כן</span>' : '<span class="no">חסרים ' + (min - n) + '</span>') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="hint">מחיר קבוצתי מ-' + min + ' לנים שמגיעים יחד. הספירה כוללת רק מי שנרשם כאן.</p>';
  }

  function payload(c) {
    var r = calcAll(state);
    return { user: c.user, pin: c.pin, family: c.user, data: state, nights: nightsCount(state),
             maxPeople: r.maxPeople, full: r.full, group: r.group };
  }

  // After a successful save/load: let people keep name + code themselves (we cannot recover the code).
  function showKeep(c) {
    var url = /^https?:/.test(location.protocol) ? location.href.split('#')[0] : '';
    var text = 'ההרשמה שלי לקמפינג באכזיב\nשם: ' + c.user + '\nקוד: ' + c.pin + (url ? '\n' + url : '');
    document.getElementById('keep-wa').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    var subject = encodeURIComponent('ההרשמה שלי לקמפינג באכזיב'), body = encodeURIComponent(text);
    // mailto does nothing on a computer with no mail app set up (typical when email lives in Gmail on the web),
    // so Gmail's compose page is offered as well.
    document.getElementById('keep-gmail').href = 'https://mail.google.com/mail/?view=cm&fs=1&su=' + subject + '&body=' + body;
    document.getElementById('keep-mail').href = 'mailto:?subject=' + subject + '&body=' + body;
    document.getElementById('keep-copy').onclick = function () {
      var done = function () { regMsg('הפרטים הועתקו — הדביקו אותם במקום שמור.', 'good'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
      function fallback() {
        var t = el('textarea'); t.value = text; document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); done(); } catch (e) { regMsg('לא הצלחנו להעתיק — רשמו את השם והקוד בעצמכם.', 'bad'); }
        t.remove();
      }
    };
    document.getElementById('reg-keep').hidden = false;
  }

  function signIn(user) {
    signedIn = user; remember(user);
    document.getElementById('reg-hello').hidden = true;
    syncConfirm();
  }

  function doSave(c) {
    busy(true); regMsg('שומר…');
    api(Object.assign({ action: 'save' }, payload(c))).then(function (res) {
      busy(false);
      if (!res.ok) return fail(res);
      signIn(c.user);
      regMsg(res.created ? 'נרשמתם! אפשר לחזור ולעדכן עם אותו שם וקוד.' : 'ההרשמה עודכנה — הפרטים הקודמים הוחלפו בחדשים.', 'good');
      renderGroup(res.summary);
      showKeep(c);
    });
  }

  function initRegistration() {
    if (!C.apiUrl) { document.getElementById('reg-form').hidden = true; document.getElementById('reg-off').hidden = false; return; }
    var userEl = document.getElementById('reg-user');
    var mine = remembered();
    if (mine) {
      userEl.value = mine;
      var hello = document.getElementById('reg-hello');
      hello.innerHTML = 'מהמכשיר הזה נרשמתם בשם <strong>' + esc(mine) + '</strong>. כדי לראות או לעדכן — הקלידו את הקוד ולחצו "טעינת ההרשמה שלי".';
      hello.hidden = false;
    }
    userEl.addEventListener('input', function () {
      syncConfirm();
      document.getElementById('reg-ask').hidden = true;
      if (signedIn && norm(signedIn) !== norm(userEl.value)) document.getElementById('reg-keep').hidden = true;
    });
    syncConfirm();

    // eye buttons: show / hide the code
    document.querySelectorAll('#reg-form .eye').forEach(function (b) {
      b.addEventListener('click', function () {
        var input = document.getElementById(b.getAttribute('aria-controls'));
        var show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        b.setAttribute('aria-pressed', show);
        b.setAttribute('aria-label', show ? 'הסתרת הקוד' : 'הצגת הקוד');
      });
    });

    var pending = null;
    document.getElementById('reg-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var c = creds(true); if (!c) return;
      if (warnings(state).length) { regMsg('יש בעיה בפרטים שמילאתם — ראו את ההערות בסעיף 3.', 'bad'); return; }
      // Same device, a different and new name: probably the same family under another spelling.
      var mine = remembered();
      if (mine && norm(mine) !== norm(c.user) && known(mine) && !known(c.user)) {
        pending = c;
        document.getElementById('reg-ask-q').innerHTML = 'מהמכשיר הזה כבר נרשמו בשם <strong>' + esc(mine) +
          '</strong>. האם את.ה ' + esc(mine) + '? אם כן — עדיף לעדכן את ההרשמה הקיימת במקום ליצור חדשה.';
        document.getElementById('reg-ask').hidden = false;
        document.getElementById('reg-ask-yes').focus();
        return;
      }
      doSave(c);
    });
    document.getElementById('reg-ask-yes').addEventListener('click', function () {
      document.getElementById('reg-ask').hidden = true; pending = null;
      userEl.value = remembered();
      document.getElementById('reg-pin').value = ''; document.getElementById('reg-pin2').value = '';
      syncConfirm();
      regMsg('הקלידו את הקוד של ההרשמה הקיימת ולחצו "טעינת ההרשמה שלי" — ואז אפשר לשנות ולשמור.', 'good');
      document.getElementById('reg-pin').focus();
    });
    document.getElementById('reg-ask-no').addEventListener('click', function () {
      document.getElementById('reg-ask').hidden = true;
      if (pending) { var c = pending; pending = null; doSave(c); }
    });

    document.getElementById('reg-load').addEventListener('click', function () {
      var c = creds(false); if (!c) return;
      busy(true); regMsg('טוען…');
      api({ action: 'load', user: c.user, pin: c.pin }).then(function (res) {
        busy(false);
        if (!res.ok) return fail(res);
        var d = res.data;
        if (d && d.base && d.periods && d.periods.length) {
          state = { base: Object.assign(emptyCounts(), d.base),
                    periods: d.periods.map(function (p) { return { from: p.from, to: p.to, custom: !!p.custom, counts: Object.assign(emptyCounts(), p.counts) }; }) };
          renderBase(); renderPeriods(); update();
        }
        signIn(res.family || c.user);
        regMsg('ההרשמה נטענה' + (res.updated ? ' (עודכנה לאחרונה ' + res.updated + ')' : '') +
          '. אפשר לשנות ולשמור שוב — השמירה תחליף את הפרטים הקודמים.', 'good');
        showKeep(c);
      });
    });

    document.getElementById('reg-delete').addEventListener('click', function () {
      var c = creds(false); if (!c) return;
      if (!confirm('לבטל את ההרשמה של "' + c.user + '"?')) return;
      busy(true); regMsg('מבטל…');
      api({ action: 'delete', user: c.user, pin: c.pin }).then(function (res) {
        busy(false);
        if (!res.ok) return fail(res);
        if (norm(remembered()) === norm(c.user)) remember('');
        signedIn = null;
        document.getElementById('reg-keep').hidden = true;
        regMsg('ההרשמה בוטלה.', 'good');
        if (res.summary) renderGroup(res.summary); else api(null).then(renderGroup);
      });
    });

    api(null).then(renderGroup);
  }

  renderPriceTable();
  initRegistration();
  renderBase();
  renderPeriods();
  update();
})();
