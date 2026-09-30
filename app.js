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

  window.CampCalc = { calcPeriod: calcPeriod, calcAll: calcAll, warnings: warnings, nightsBetween: nightsBetween, dm: dm };
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

  // ---------- counters ----------
  var uid = 0;
  function counter(cat, counts) {
    var id = 'c' + (++uid);
    var row = el('div', { 'class': 'counter' });
    var priceTxt = cat.price ? money(cat.price) + (cat.unit ? ' ' + cat.unit : ' ללילה') : 'חינם';
    row.innerHTML =
      '<label for="' + id + '"><span class="lbl">' + esc(cat.label) + '</span>' +
      '<span class="meta">' + (cat.ages ? esc(cat.ages) + ' · ' : '') + priceTxt + '</span></label>' +
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
        '<legend>' + (multi ? 'תקופה ' + (i + 1) : 'תאריכי השהייה') + '</legend>' +
        '<div class="dates">' +
        '<label for="' + fId + '">הגעה<br>' + dateSelect(fId, p.from) + '</label>' +
        '<label for="' + tId + '">עזיבה<br>' + dateSelect(tId, p.to) + '</label>' +
        '<span class="nights" aria-live="polite"></span>' +
        '</div>' +
        '<label class="check"><input type="checkbox" id="' + cId + '"' + (p.custom ? ' checked' : '') + '> הרכב שונה בתקופה הזו</label>' +
        '<div class="custom" ' + (p.custom ? '' : 'hidden') + '></div>' +
        (multi ? '<button type="button" class="btn-link remove">הסרת התקופה</button>' : '');
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
      if (rm) rm.addEventListener('click', function () { state.periods.splice(i, 1); renderPeriods(); update(); });
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
      '<div class="total"><span>מחיר מלא (מקסימום)</span><strong>' + money(r.full) + '</strong></div>' +
      '<div class="total group"><span>אם הקבוצה תמנה ' + C.groupMinPeople + ' לנים לפחות</span><strong>' + money(r.group) + '</strong>' +
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

  renderPriceTable();
  renderBase();
  renderPeriods();
  update();
})();
