// Guided tours: a bubble with an arrow pointing at the real element, which is lit up on a dimmed page.
// The welcome tour runs on the first visit; each tab's tour runs the first time that tab opens (after the welcome
// tour closes). Each is shown once, finished or skipped, remembered in localStorage. The ? button replays the
// current tab's tour. The tours are data, below; their texts are in tour-texts.js. ?notour in the URL, or window.ACHZIV_NOTOUR, turns them off
// (the other e2e tests set it). Plan: docs/tour-plan.md.
(function () {
  var KEY = 'achziv-tour-v1';
  var off = window.ACHZIV_NOTOUR || /[?&]notour\b/.test(location.search);
  function $(id) { return document.getElementById(id); }
  function h2of(id) { var e = $(id); return e && e.closest('.card').querySelector('h2'); }

  // Each step: its text's key in tour-texts.js (TOUR_TEXTS_), and where the arrow points: target, a selector or a
  // function (none = a centred bubble); top: scroll to the page top first (for the fixed bars and the header).
  // The text itself is in tour-texts.js, and Yair can edit it in the sheet's הדרכה tab (docs/tour-plan.md §5).
  var TOURS = {
    welcome: { tab: 'calc', steps: [
      { key: 'hello' },
      { key: 'help', target: '#tour-help', top: true },
      { key: 'tabs', target: '.tabs', top: true },
      { key: 'prices', target: '#open-prices', top: true },
      { key: 'who', target: function () { return h2of('base-main'); } },
      { key: 'when', target: function () { return h2of('periods'); } },
      { key: 'cost', target: function () { return h2of('result'); } },
      { key: 'register', target: function () { return h2of('reg-form'); } },
      { key: 'share', target: '#share-btn', top: true }
    ] },
    gear: { tab: 'gear', steps: [
      { key: 'views', target: '#gear-bar .seg' },
      { key: 'search', target: '#gear-q' },
      { key: 'basic', target: '#gear-basic' },
      { key: 'pack', target: '#gear-view-mine' },
      { key: 'add', target: function () { return h2of('gear-form'); } }
    ] },
    acts: { tab: 'acts', ready: '#acts-list .arow', steps: [
      { key: 'views', target: '#acts-bar .seg' },
      { key: 'search', target: '#acts-q' },
      { key: 'details', target: '#acts-list .arow' },
      { key: 'add', target: '#acts-add' }
    ] },
    tips: { tab: 'tips', ready: '#tips-tools', steps: [
      { key: 'intro', target: '#panel-tips .card h2' },
      { key: 'search', target: '#tips-q' },
      { key: 'write', target: '#tips-write-btn' }
    ] }
  };

  // ---------- the texts: the sheet's copy (cached in this browser) over the built-in one ----------
  // A cell left empty in the sheet falls back to the built-in text, and a row whose key is unknown is ignored.
  // The sheet's copy is fetched once per visit, after the page settles; a tour already open keeps its text.
  var TEXTS_KEY = 'achziv-tour-texts';
  function sheetTexts() { try { return JSON.parse(localStorage.getItem(TEXTS_KEY)) || []; } catch (e) { return []; } }
  function textsFor(n) {
    var own = {}, over = {};
    TOUR_TEXTS_.forEach(function (r) { if (r.tour === n) own[r.key] = r; });
    sheetTexts().forEach(function (r) { if (r && r.tour === n && own[r.key]) over[r.key] = r; });
    return function (key) {
      var o = over[key] || {}, d = own[key] || { title: '', text: '' };
      return { title: String(o.title || '').trim() || d.title, text: String(o.text || '').trim() || d.text };
    };
  }
  function refreshTexts() {
    if (!window.CampApi) return;
    window.CampApi.api({ action: 'tour' }).then(function (res) {
      if (!res || !res.ok || !Array.isArray(res.steps)) return;   // the old script answers bad_request: keep what we have
      try { localStorage.setItem(TEXTS_KEY, JSON.stringify(res.steps)); } catch (e) { /* ignore */ }
    });
  }
  // plain text → HTML: everything escaped; a blank line starts a paragraph, a single line break stays, **...** is bold
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render(text) {
    return String(text).replace(/\r/g, '').trim().split(/\n\s*\n/).map(function (p) {
      return '<p>' + esc(p.trim()).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function seen() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function markSeen(name) {
    var s = seen(); s[name] = 1;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function currentTab() {
    var t = document.querySelector('[role=tab][aria-selected="true"]');
    return t ? t.id.replace('tab-', '') : 'calc';
  }
  function tourFor(tab) { return TOURS[tab] ? tab : 'welcome'; }
  function el(step) { return typeof step.target === 'function' ? step.target() : document.querySelector(step.target); }
  function visible(e) { return !!(e && e.getClientRects().length); }

  // ---------- the overlay ----------
  var block, hole, bub, arrow, steps, at, name, back, running = false;
  var moving = false, moveTok = 0;               // moving: between two steps (faded out, scrolling)
  var FADE = 150;

  function build() {
    block = document.createElement('div'); block.className = 'tour-block';
    hole = document.createElement('div'); hole.className = 'tour-hole';
    bub = document.createElement('div'); bub.className = 'tour-bub';
    bub.setAttribute('role', 'dialog'); bub.setAttribute('aria-modal', 'true'); bub.setAttribute('aria-labelledby', 'tour-title');
    bub.innerHTML = '<p class="tour-count" id="tour-count"></p><h2 id="tour-title"></h2><div class="tour-text" id="tour-text"></div>' +
      '<div class="tour-btns"><button type="button" class="btn-primary" id="tour-next"></button>' +
      '<button type="button" class="btn-secondary" id="tour-prev">הקודם</button>' +
      '<button type="button" class="btn-link" id="tour-skip">דלג</button></div>';
    arrow = document.createElement('div'); arrow.className = 'tour-arrow'; arrow.setAttribute('aria-hidden', 'true');
    [block, hole, bub, arrow].forEach(function (x) { document.body.appendChild(x); });
    $('tour-next').addEventListener('click', function () { if (moving) return; if (at < steps.length - 1) move(at + 1); else close(); });
    $('tour-prev').addEventListener('click', function () { if (!moving && at > 0) move(at - 1); });
    $('tour-skip').addEventListener('click', close);
    bub.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(bub.querySelectorAll('button'), function (b) { return !b.hidden; });
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); }
      else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
    });
    block.addEventListener('click', function () { $('tour-next').focus(); });
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, { passive: true });
  }

  function fill(i) {
    at = i;
    var s = steps[i];
    $('tour-count').textContent = (i + 1) + ' מתוך ' + steps.length;
    $('tour-title').textContent = s.title;
    $('tour-text').innerHTML = render(s.text);
    $('tour-next').textContent = i === steps.length - 1 ? 'סיום' : 'הבא';
    $('tour-prev').hidden = i === 0;
    $('tour-skip').hidden = i === steps.length - 1;
    bub.scrollTop = 0;
  }
  function jumpTo(i) {
    var s = steps[i], e = s.target && el(s);
    if (e) { if (s.top) window.scrollTo(0, 0); else bringIn(e); }
  }
  function show(i) {
    fill(i); jumpTo(i); place();
    $('tour-next').focus({ preventScroll: true });
  }

  // Between steps, for orientation: a quick fade out (the page stays dimmed), a smooth scroll to the next target,
  // a quick fade in there. Under prefers-reduced-motion it is the plain jump. The scroll's end point is measured by
  // doing the jump and undoing it in the same frame, so nothing of it is painted.
  function move(i) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { show(i); return; }
    var tok = ++moveTok;
    moving = true; bub.setAttribute('data-moving', '');
    block.classList.add('dim');
    [bub, hole, arrow].forEach(function (x) { x.classList.add('tour-out'); });
    setTimeout(function () {
      if (tok !== moveTok) return;
      fill(i);
      var y0 = window.scrollY; jumpTo(i); var y1 = window.scrollY;
      window.scrollTo(0, y0);
      if (Math.abs(y1 - y0) > 1) window.scrollTo({ top: y1, behavior: 'smooth' });
      var t0 = Date.now();
      (function settle() {
        if (tok !== moveTok) return;
        if (Math.abs(window.scrollY - y1) > 1 && Date.now() - t0 < 900) { requestAnimationFrame(settle); return; }
        window.scrollTo(0, y1);
        moving = false; place();
        [bub, hole, arrow].forEach(function (x) { x.classList.remove('tour-out'); });
        $('tour-next').focus({ preventScroll: true });
        setTimeout(function () { if (tok === moveTok) bub.removeAttribute('data-moving'); }, FADE);
      })();
    }, FADE);
  }

  // Scroll so the target sits just under the bars pinned on top (the tab row, the calculator's bar, the gear and
  // activities bars), leaving the room below it for the bubble. A bar holding the target itself does not count.
  // Measured again after each step, because a bar that gets pinned by the scroll moves the goal.
  function bringIn(e) {
    for (var pass = 0; pass < 3; pass++) {
      var bars = 0;
      document.querySelectorAll('.tabs, .subbar, .gbar').forEach(function (b) {
        if (b.contains(e) || !b.getClientRects().length || getComputedStyle(b).position !== 'sticky') return;
        var br = b.getBoundingClientRect(), stuck = parseFloat(getComputedStyle(b).top) || 0;
        if (Math.abs(br.top - stuck) < 2) bars = Math.max(bars, br.bottom);
      });
      var d = e.getBoundingClientRect().top - bars - 10, y = window.scrollY;
      if (Math.abs(d) < 2) return;
      window.scrollBy(0, d);
      if (window.scrollY === y) return;                    // the page cannot scroll further
    }
  }

  // Put the bubble below the target, or above it, never over it: when neither side fits, the bubble shrinks to the
  // larger side and scrolls inside. Sideways it is clamped to the screen, and the arrow points at the target's middle.
  function place() {
    if (!running || !bub || bub.hidden) return;
    var s = steps[at], e = s.target && el(s), vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var M = 12, GAP = 14;
    bub.style.maxHeight = (vh - 2 * M) + 'px';
    if (!e) {
      block.classList.add('dim'); hole.hidden = true; arrow.hidden = true;   // no target: the shield dims the page
      bub.style.left = Math.max(M, (vw - bub.offsetWidth) / 2) + 'px';
      bub.style.top = Math.max(M, (vh - bub.offsetHeight) / 2) + 'px';
      return;
    }
    block.classList.toggle('dim', moving); hole.hidden = false; arrow.hidden = false;
    var r = e.getBoundingClientRect(), P = 6;
    var hl = Math.max(2, r.left - P), hr = Math.min(vw - 2, r.right + P);    // kept on screen: the tab row is full width
    hole.style.left = hl + 'px'; hole.style.top = (r.top - P) + 'px';
    hole.style.width = (hr - hl) + 'px'; hole.style.height = (r.height + 2 * P) + 'px';
    var below = vh - (r.bottom + P) - GAP - M, above = (r.top - P) - GAP - M, bh = bub.offsetHeight, down;
    if (bh <= below) down = true;
    else if (bh <= above) down = false;
    else { down = below >= above; bub.style.maxHeight = Math.max(80, down ? below : above) + 'px'; bh = bub.offsetHeight; }
    var bw = bub.offsetWidth, left = Math.min(Math.max(M, r.left + r.width / 2 - bw / 2), vw - bw - M);
    var top = down ? r.bottom + P + GAP : r.top - P - GAP - bh;
    bub.style.left = left + 'px'; bub.style.top = top + 'px';
    // the arrow sits on the bubble's edge facing the target, at the target's middle; .up: the bubble is above
    arrow.classList.toggle('up', !down);
    arrow.style.left = (left + Math.min(Math.max(18, r.left + r.width / 2 - left), bw - 18) - 7) + 'px';
    arrow.style.top = (down ? top - 7 : top + bh - 7) + 'px';
  }

  function start(n) {
    if (running) return;
    var t = TOURS[n], tabBtn = $('tab-' + t.tab);
    if (tabBtn && tabBtn.getAttribute('aria-selected') !== 'true') tabBtn.click();
    if (!$('panel-calc').hidden && $('calc-main').hidden) $('close-prices').click();
    running = true; name = n;                               // held while it waits, so nothing else starts meanwhile
    var tries = 0;
    (function go() {
      if (t.ready && !visible(document.querySelector(t.ready)) && tries++ < 40) { setTimeout(go, 150); return; }
      var tx = textsFor(n);
      steps = t.steps.filter(function (s) { return !s.target || visible(el(s)); }).map(function (s) {
        var x = tx(s.key); return { key: s.key, target: s.target, top: s.top, title: x.title, text: x.text };
      });
      if (!steps.length) { running = false; return; }
      if (!bub) build();
      back = document.activeElement;
      document.documentElement.classList.add('touring');
      block.hidden = hole.hidden = bub.hidden = arrow.hidden = false;
      show(0);
    })();
  }

  function close() {
    running = false; markSeen(name);
    moveTok++; moving = false; bub.removeAttribute('data-moving');
    [bub, hole, arrow].forEach(function (x) { x.classList.remove('tour-out'); });
    block.hidden = hole.hidden = bub.hidden = arrow.hidden = true;
    document.documentElement.classList.remove('touring');
    if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
    setTimeout(next, 0);
  }

  // what to run now: the welcome tour first, then the tour of the tab on screen
  function next() {
    if (off || running) return;
    var s = seen();
    if (!s.welcome) return start('welcome');
    var tab = currentTab();
    if (TOURS[tab] && tab !== 'welcome' && !s[tab]) start(tab);
  }

  // current(): the element the open step points at, for tests/tour.e2e.js
  window.Tour = { start: start, next: next,
    current: function () { return running && bub && !bub.hidden && steps[at].target ? el(steps[at]) : null; } };
  $('tour-help').addEventListener('click', function () { if (!running) start(tourFor(currentTab())); });
  setTimeout(refreshTexts, 2000);                        // after the page's own requests; the ? replay uses it too
  if (off) return;
  document.addEventListener('tabshown', function () { setTimeout(next, 0); });
  setTimeout(next, 300);
})();
