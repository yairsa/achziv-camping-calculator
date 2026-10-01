// The calculator's price logic: shared by the site and the backend (docs/admin-plan.md §4.4).
// The site loads it with a <script> tag after prices.js. backend/build.py inlines prices.js and this file into Code.gs
// (`//@include`), so an organizer's edit on the managing page is priced by the very same code as the family's own.
// Pure: no page, no storage. Reads window.CAMP (prices.js); writes window.CampCalc.
(function () {
  'use strict';
  var C = window.CAMP;
  var ALL = C.categories.concat(C.extras);
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


  window.CampCalc = { calcPeriod: calcPeriod, calcAll: calcAll, warnings: warnings, nightsBetween: nightsBetween, dm: dm,
    nightsCount: nightsCount, emptyCounts: emptyCounts, peopleIn: peopleIn, toTime: toTime, toIso: toIso, dmy: dmy,
    weekday: weekday, ALL: ALL, DAY: DAY };
})();
