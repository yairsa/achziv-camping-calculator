// Run: node tests/tour.e2e.js — the guided tours and the share button in headless Chrome at 360px, against
// backend/Code.gs running in Node's vm (the Google URL is mocked, so nothing reaches the live sheet).
// The welcome tour on the first visit, each tab's tour once on first opening, every step's target on screen and
// neither under a fixed bar nor under its own bubble, skip remembered, ? replays; the share menu, and the share
// modal once after the first registration only;
// texts edited in the sheet's הדרכה tab. Plan: docs/tour-plan.md §4.4, §5.3.
// Needs playwright-core (PLAYWRIGHT_CORE=<path>, default: the website repo's copy) and installed Chrome (CHROME=<path>).
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/YairSahar_Business/ParentingUpClose_Website/node_modules/playwright-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../backend/Code.gs', 'utf8'), ctx);
const rows = [];
const reg = { all: () => rows, put: (r) => { if (!rows.includes(r)) rows.push(r); }, remove: (r) => rows.splice(rows.indexOf(r), 1),
  hash: (u, p) => crypto.createHash('sha256').update(u + '|' + p).digest('hex'), now: () => '30/09/2026 12:00', nowMs: () => Date.now() };
const ts = { tips: () => [], comments: () => [], gear: () => [], addTip() {}, addComment() {}, addGear() {},
  updateTip() {}, updateComment() {}, updateGear() {}, now: () => '30/09/2026 12:00' };
// the sheet's הדרכה tab: null = the old script, which answers `tour` with bad_request
let tourRows = null;

const url = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
const errors = [];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  // a fresh visitor: its own storage. share: 'none' (no share sheet: the menu) or 'stub' (records navigator.share)
  async function visitor(share) {
    const c = await browser.newContext({ viewport: { width: 360, height: 640 } });
    await c.addInitScript((mode) => {
      if (mode === 'none') delete Navigator.prototype.share;
      else { window.__shared = []; Navigator.prototype.share = function (d) { window.__shared.push(d); return Promise.resolve(); }; }
    }, share);
    await c.route('https://fonts.googleapis.com/**', r => r.abort());
    await c.route('https://script.google.com/**', (route) => {
      const req = route.request(), body = req.method() === 'POST' ? JSON.parse(req.postData()) : { action: 'summary' };
      let res;
      if (/^(summary|save|load|delete)$/.test(body.action)) res = ctx.route(body, reg);
      else if (/^(tips|gear)$/.test(body.action)) res = ctx.route(body, null, ts);
      else if (body.action === 'tour' && tourRows) res = ctx.route(body, null, { tour: () => tourRows });
      else res = { ok: false, error: 'bad_request' };
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify(JSON.parse(JSON.stringify(res))) });
    });
    const page = await c.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    return page;
  }
  const open = (page) => page.isVisible('.tour-bub');
  const waitTour = (page) => page.waitForSelector('.tour-bub:not([hidden])', { timeout: 8000 });
  const settled = (page) => page.waitForSelector('.tour-bub:not([data-moving])', { timeout: 5000 });
  const seen = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('achziv-tour-v1') || '{}'));

  // Every step: the bubble on screen, the target on screen, under no fixed bar, and not under its own bubble;
  // no horizontal scroll; focus in the bubble.
  async function checkStep(page, where) {
    const g = await page.evaluate(() => {
      const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
      const e = window.Tour.current(), vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const covered = [];
      if (e) document.querySelectorAll('.tabs, .subbar, .gbar').forEach((bar) => {
        if (bar.contains(e) || !bar.getClientRects().length) return;
        const a = bar.getBoundingClientRect(), r = e.getBoundingClientRect();
        if (a.bottom > r.top + 1 && a.top < r.bottom - 1 && a.right > r.left && a.left < r.right) covered.push(bar.className);
      });
      return { bub: box(document.querySelector('.tour-bub').getBoundingClientRect()), t: e && box(e.getBoundingClientRect()),
        vw, vh, sw: document.documentElement.scrollWidth, covered, focus: document.activeElement && document.activeElement.id,
        count: document.getElementById('tour-count').textContent };
    });
    const w = where + ' (' + g.count + ')';
    assert.ok(g.bub.l >= 0 && g.bub.r <= g.vw && g.bub.t >= 0 && g.bub.b <= g.vh, 'bubble off screen: ' + w + ' ' + JSON.stringify(g.bub));
    assert.ok(g.sw <= g.vw, 'horizontal scroll: ' + w);
    assert.strictEqual(g.focus, 'tour-next', 'focus not in the bubble: ' + w);
    if (g.t) {
      assert.ok(g.t.t >= 0 && g.t.b <= g.vh, 'target off screen: ' + w + ' ' + JSON.stringify(g.t));
      assert.deepStrictEqual(g.covered, [], 'target under a fixed bar: ' + w);
      assert.ok(g.bub.b <= g.t.t || g.bub.t >= g.t.b, 'the bubble covers its target: ' + w);
    }
    return g.count;
  }
  // walk a tour to its end with סיום, checking every step; returns the step count
  async function walk(page, where) {
    await waitTour(page);
    let n = 0;
    for (;;) {
      n++;
      const count = await checkStep(page, where);
      assert.strictEqual(count, n + ' מתוך ' + count.split(' ').pop(), 'counter: ' + where);
      const last = (await page.innerText('#tour-next')) === 'סיום';
      assert.strictEqual(await page.isVisible('#tour-skip'), !last, 'skip on the last step: ' + where);
      assert.strictEqual(await page.isVisible('#tour-prev'), n > 1, 'back on the first step: ' + where);
      await page.click('#tour-next');
      if (last) break;
      // between steps: faded out with the page still dimmed, then the next step once the scroll has settled
      assert.ok(await page.evaluate(() => document.querySelector('.tour-bub').classList.contains('tour-out') &&
        document.querySelector('.tour-block').classList.contains('dim')), 'no fade between steps: ' + where);
      await settled(page);
    }
    assert.ok(!(await open(page)), 'still open after סיום: ' + where);
    return n;
  }

  // ---- the first visit: the welcome tour, 8 steps, the disclaimer in step 1 ----
  let page = await visitor('none');
  await page.goto(url);
  await waitTour(page);
  const first = await page.innerText('.tour-bub');
  for (const s of ['לא רשמי', 'רשות הטבע והגנים', 'ט.ל.ח', 'לא נאספים פרטים אישיים', 'רק בדפדפן'])
    assert.ok(first.includes(s), 'the disclaimer lacks: ' + s);
  // back and forth, then the whole walk
  await page.click('#tour-next'); await settled(page); await page.click('#tour-prev'); await settled(page);
  assert.ok((await page.innerText('#tour-count')).startsWith('1 '));
  assert.strictEqual(await walk(page, 'welcome'), 8);
  assert.strictEqual((await seen(page)).welcome, 1);
  await page.reload(); await page.waitForTimeout(800);
  assert.ok(!(await open(page)), 'the welcome tour ran twice');
  // the old script answers `tour` with bad_request: nothing cached, the built-in text stays
  await page.waitForTimeout(2500);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('achziv-tour-texts')), null, 'cached a bad_request');
  // the permanent note, on every tab (the tab tours marked seen, so they stay out of the way here)
  await page.evaluate(() => localStorage.setItem('achziv-tour-v1', JSON.stringify({ welcome: 1, gear: 1, acts: 1, tips: 1 })));
  for (const t of ['calc', 'place', 'gear', 'acts', 'tips']) {
    await page.click('#tab-' + t);
    assert.ok(await page.isVisible('.site-note') && (await page.innerText('.site-note')).includes('לא רשמי'), 'no note on ' + t);
  }

  // ---- the tab tours: once each, on first opening ----
  page = await visitor('none');
  await page.goto(url + '?demo');                              // ?demo: example activities, so the row step shows
  await waitTour(page); await page.keyboard.press('Escape');     // Esc closes, and counts as seen
  assert.ok(!(await open(page)));
  assert.strictEqual((await seen(page)).welcome, 1);
  const sizes = {};
  for (const t of ['gear', 'acts', 'tips']) {
    await page.click('#tab-' + t);
    sizes[t] = await walk(page, t);
    await page.click('#tab-calc'); await page.click('#tab-' + t); await page.waitForTimeout(500);
    assert.ok(!(await open(page)), 'the ' + t + ' tour ran twice');
  }
  assert.deepStrictEqual(sizes, { gear: 5, acts: 4, tips: 3 });
  await page.click('#tab-place'); await page.waitForTimeout(400);
  assert.ok(!(await open(page)), 'a tour on the place tab');

  // ---- ? replays the tour of the tab on screen ----
  await page.click('#tab-gear'); await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#tour-help');
  await waitTour(page);
  assert.strictEqual(await page.innerText('#tour-title'), 'רשימת ציוד');
  await page.click('#tour-skip');
  assert.ok(!(await open(page)));
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'tour-help', 'focus did not return');
  await page.click('#tab-calc'); await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('#tour-help'); await waitTour(page);
  assert.strictEqual(await page.innerText('#tour-title'), 'ברוכים הבאים!');
  await page.keyboard.press('Escape');

  // ---- arriving on a tab by link: the welcome tour first (on the calculator), then that tab's tour on opening ----
  page = await visitor('none');
  await page.goto(url + '#tips');
  await waitTour(page);
  assert.strictEqual(await page.innerText('#tour-title'), 'ברוכים הבאים!');
  assert.ok(await page.isVisible('#panel-calc'));
  await page.click('#tour-skip');
  assert.deepStrictEqual(await seen(page), { welcome: 1 });
  await page.click('#tab-tips'); await waitTour(page);
  assert.strictEqual(await page.innerText('#tour-title'), 'טיפים מהקבוצה');
  await page.keyboard.press('Escape');

  // ---- reduced motion: the plain jump between steps, no fade ----
  {
    const c = await browser.newContext({ viewport: { width: 360, height: 640 }, reducedMotion: 'reduce' });
    await c.route('https://**', r => r.abort());
    const p = await c.newPage(); p.on('pageerror', e => errors.push(String(e)));
    await p.goto(url); await waitTour(p);
    await p.click('#tour-next');
    assert.ok(await p.evaluate(() => !document.querySelector('.tour-bub').hasAttribute('data-moving') &&
      document.getElementById('tour-count').textContent.startsWith('2 ')), 'a fade under reduced motion');
    await c.close();
  }

  // ---- ?notour: nothing ----
  page = await visitor('none');
  await page.goto(url + '?notour'); await page.waitForTimeout(800);
  await page.click('#tab-gear'); await page.waitForTimeout(500);
  assert.ok(!(await open(page)), 'a tour under ?notour');

  // ---- share: the menu where there is no share sheet ----
  page = await visitor('none');
  await page.goto(url + '?notour');
  await page.click('#share-btn');
  assert.ok(await page.isVisible('#share-menu'));
  assert.strictEqual(await page.getAttribute('#share-btn', 'aria-expanded'), 'true');
  const wa = decodeURIComponent(await page.getAttribute('#share-wa', 'href'));
  assert.ok(wa.startsWith('https://wa.me/?text=') && wa.includes('https://yairsa.github.io/achziv-camping-calculator/'), wa);
  assert.ok(!/קוד|1234/.test(wa), 'personal data in the shared text');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal scroll: share menu');
  await page.click('#share-copy');
  await page.waitForFunction(() => document.getElementById('share-msg').textContent.length > 0);
  await page.click('h1');
  assert.ok(await page.isHidden('#share-menu'), 'the menu did not close');

  // ---- share: the device's share sheet ----
  page = await visitor('stub');
  await page.goto(url + '?notour');
  await page.click('#share-btn');
  assert.ok(await page.isHidden('#share-menu'));
  const shared = await page.evaluate(() => window.__shared);
  assert.strictEqual(shared.length, 1);
  assert.strictEqual(shared[0].url, 'https://yairsa.github.io/achziv-camping-calculator/');

  // ---- the share modal: once, after the first successful registration ----
  page = await visitor('none');
  await page.goto(url);
  await waitTour(page); await page.keyboard.press('Escape');
  const register = async (user, pin, confirm) => {
    await page.fill('#reg-user', user); await page.fill('#reg-pin', pin);
    if (confirm && await page.isVisible('#reg-pin2')) await page.fill('#reg-pin2', pin);
    await page.evaluate(() => { document.getElementById('reg-msg').textContent = ''; });
    await page.click('#reg-save');
    if (await page.isVisible('#reg-ask')) await page.click('#reg-ask-no');   // same device, a new name: "a new registration"
    await page.waitForFunction(() => /נרשמתם|עודכנה/.test(document.getElementById('reg-msg').textContent), null, { timeout: 15000 });
  };
  await register('משפחת טור', '4321', true);
  await page.waitForSelector('#share-dlg[open]', { timeout: 3000 });
  assert.ok((await page.innerText('#share-dlg')).includes('רוצים לשתף'));
  assert.ok(await page.isVisible('#share-dlg-wa') && await page.isVisible('#share-dlg-copy'));
  await page.click('#share-dlg-no');
  assert.ok(await page.isHidden('#share-dlg'));
  await register('משפחת טור', '4321', false);                          // an update: no modal
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#share-dlg'), 'the modal after an update');
  await page.reload(); await page.waitForTimeout(500);                  // a second new name on this device
  await register('משפחת שתיים', '9876', true);
  assert.ok(rows.length >= 2, 'the second family was not saved');
  await page.waitForTimeout(400);
  assert.ok(await page.isHidden('#share-dlg'), 'the modal a second time');

  // ---- texts edited in the sheet (docs/tour-plan.md §5.3): the next tour shows them, the open one keeps its text ----
  tourRows = JSON.parse(JSON.stringify(ctx.tourSeedRows_())).map(r => ({ tour: r[0], step: r[1], key: r[2], title: r[3], text: r[4] }));
  tourRows[0].title = 'שלום מהגיליון';
  tourRows[0].text = 'פסקה ראשונה\nשורה שנייה\n\n**מודגש** ואז <b>לא HTML</b>';
  tourRows[1].title = ''; tourRows[1].text = '';                      // cleared: the built-in text
  page = await visitor('none');
  await page.goto(url);
  await waitTour(page);
  assert.strictEqual(await page.innerText('#tour-title'), 'ברוכים הבאים!', 'the first tour waited for the server');
  await page.waitForFunction(() => localStorage.getItem('achziv-tour-texts'), null, { timeout: 8000 });
  assert.strictEqual(await page.innerText('#tour-title'), 'ברוכים הבאים!', 'the open tour changed mid-way');
  await page.keyboard.press('Escape');
  await page.click('#tour-help'); await waitTour(page);
  assert.strictEqual(await page.innerText('#tour-title'), 'שלום מהגיליון');
  const html = await page.innerHTML('#tour-text');
  assert.strictEqual(html, '<p>פסקה ראשונה<br>שורה שנייה</p><p><strong>מודגש</strong> ואז &lt;b&gt;לא HTML&lt;/b&gt;</p>', html);
  await checkStep(page, 'sheet text');
  await page.click('#tour-next'); await settled(page);
  assert.strictEqual(await page.innerText('#tour-title'), 'חלקי האתר', 'a cleared cell did not fall back');
  assert.ok((await page.innerText('#tour-text')).startsWith('כאן עוברים בין החלקים'));
  await page.keyboard.press('Escape');
  // the next visit shows the cached sheet text at once
  await page.evaluate(() => localStorage.removeItem('achziv-tour-v1'));
  await page.reload(); await waitTour(page);
  assert.strictEqual(await page.innerText('#tour-title'), 'שלום מהגיליון', 'the cached text was not used');
  await page.keyboard.press('Escape');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('tour.e2e: all passed');
})().catch((e) => { console.error(e); process.exit(1); });
