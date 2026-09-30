// Run: node tests/gear.e2e.js — the equipment tab in headless Chrome at 360px, against backend/Code.gs running in
// Node's vm (the Google URL is mocked, so nothing reaches the live sheet). Pick → pack → own item → approve in the
// "sheet" → merged; the starter list before the server answers; the old live script.
// Needs playwright-core (PLAYWRIGHT_CORE=<path>, default: the website repo's copy) and installed Chrome (CHROME=<path>).
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/YairSahar_Business/ParentingUpClose_Website/node_modules/playwright-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../backend/Code.gs', 'utf8'), ctx);
const ST = vm.runInContext('ST', ctx);
const SEED = JSON.parse(JSON.stringify(ctx.gearSeedRows_()));

function store() {
  const tips = [], comments = [], gear = SEED.map(r => ({ id: r[0], status: r[1], section: r[2], name: r[3], tags: r[4],
    note: r[5], submitted: r[6], approved: r[7], clientId: r[8] }));
  return { tips: () => tips, comments: () => comments, gear: () => gear,
           addTip: (r) => tips.push(r), addComment: (r) => comments.push(r), addGear: (r) => gear.push(r),
           updateTip() {}, updateComment() {}, updateGear() {}, now: () => '30/09/2026 12:00' };
}
const regStore = { all: () => [], put() {}, remove() {}, hash: () => '', now: () => '', nowMs: () => 0 };
let ts = store(), oldBackend = false, dropNext = 0, delay = 0, calls = [];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://script.google.com/**', async (route) => {
    const req = route.request(), body = req.method() === 'POST' ? JSON.parse(req.postData()) : { action: 'summary' };
    calls.push(body.action);
    if (delay) await new Promise(r => setTimeout(r, delay));
    let res;
    if (oldBackend && /^(gear|submitGear)$/.test(body.action)) res = { ok: false, error: 'bad_request' };
    else res = JSON.parse(JSON.stringify(ctx.route(body, body.action === 'summary' ? regStore : null, ts)));
    if (dropNext > 0 && body.action === 'submitGear') { dropNext--; return route.fulfill({ status: 404, contentType: 'text/html', body: '<html>not found</html>' }); }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  const url = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  const text = (sel) => page.locator(sel).innerText();
  const noHScroll = async (where) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal scroll: ' + where);
  const mineKeys = () => page.locator('#gear-mine-list li').evaluateAll(ls => ls.map(l => l.getAttribute('data-key')));

  // ---- prefetched in the background; the tab bar fits at 360px ----
  await page.goto(url);
  await page.waitForTimeout(3000);
  assert.ok(calls.includes('gear'), 'gear list not prefetched');
  assert.ok(await page.isHidden('#panel-gear'), 'prefetch should not switch tabs');
  { const tw = await page.evaluate(() => { const t = document.querySelector('.tabs'); return [t.scrollWidth, t.clientWidth, [...t.children].map(c => c.offsetWidth)]; }); assert.ok(tw[0] <= tw[1], 'the tab bar overflows at 360px: ' + JSON.stringify(tw)); }
  await page.click('#tab-gear');
  assert.strictEqual(await text('#gear-count'), SEED.length + ' פריטים ברשימה הכללית.');
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (0)');
  await noHScroll('pick');

  // ---- search and tag filter ----
  await page.fill('#gear-q', 'פנס');
  assert.ok((await text('#gear-count')).startsWith('נמצאו 3 מתוך'), await text('#gear-count'));
  await page.fill('#gear-q', '');
  await page.click('.chip[data-tag="תינוקות"]');
  assert.strictEqual(await page.locator('#gear-pick-list li').count(), SEED.filter(r => r[4].includes('תינוקות')).length);
  await page.click('.chip[data-tag="תינוקות"]');                // off again
  assert.strictEqual(await page.locator('#gear-pick-list li').count(), SEED.length);

  // ---- pick: two by hand, then every basic item ----
  await page.check('#gp-g1');                                     // אוהל
  await page.check('#gp-g6');                                     // משאבה (not basic)
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (2)');
  assert.ok((await text('#gear-pick-list .gsec:first-child .gcount')).startsWith('2/'));
  const basic = SEED.filter(r => r[4].split(',').includes('בסיסי')).length;
  await page.click('#gear-basic');
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (' + (basic + 1) + ')');
  assert.ok((await text('#gear-pick-msg')).includes('נוספו ' + (basic - 1)));
  await page.uncheck('#gp-g6');
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (' + basic + ')');

  // ---- pack: the item moves to the bottom of its section ----
  await page.click('#gear-view-mine');
  assert.ok(await page.isVisible('#gear-mine-list'));
  assert.strictEqual(await text('#gear-progress-text'), 'ארוזים 0 מתוך ' + basic);
  let keys = await mineKeys();
  assert.strictEqual(keys[0], 'g1');
  await page.check('#gm-g1');
  keys = await mineKeys();
  const firstSec = await page.locator('#gear-mine-list .gsec').first().locator('li').evaluateAll(ls => ls.map(l => l.getAttribute('data-key')));
  assert.strictEqual(firstSec[firstSec.length - 1], 'g1', 'a packed item should move to the bottom of its section');
  assert.ok(await page.locator('#gear-mine-list li[data-key="g1"]').evaluate(l => l.classList.contains('packed')));
  assert.strictEqual(await text('#gear-progress-text'), 'ארוזים 1 מתוך ' + basic);
  assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'gm-g1'), 'focus lost after packing');
  await noHScroll('mine');

  // copy / WhatsApp carry the list, with the packed mark
  await page.evaluate(() => window.addEventListener('click', e => { if (e.target.closest('#gear-wa')) e.preventDefault(); }, true));
  await page.click('#gear-wa');
  const wa = decodeURIComponent(await page.getAttribute('#gear-wa', 'href'));
  assert.ok(wa.includes('אוהלים ולינה:') && wa.includes('✓ אוהל') && wa.includes('☐ שק שינה לכל אחד'), wa);

  // ---- own item: validation, shown at once while the server is slow and drops the reply ----
  await page.click('#gear-form button[type=submit]');
  assert.ok((await text('#gear-form-msg')).includes('קטגוריה'));
  await page.selectOption('#gear-new-sec', 'ים וחוף');
  await page.click('#gear-form button[type=submit]');
  assert.ok((await text('#gear-form-msg')).includes('שם הפריט'));
  await page.fill('#gear-new-name', 'כיסא חוף נמוך');
  delay = 1200; dropNext = 1;
  const t0 = Date.now();
  await page.click('#gear-form button[type=submit]');
  await page.waitForSelector('#gear-mine-list li[data-key^="c"] .sending', { timeout: 400 });
  assert.ok(Date.now() - t0 < 700, 'the own item waited for the server');
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (' + (basic + 1) + ')');
  await page.waitForFunction(() => /הוצע למארגן/.test(document.getElementById('gear-mine-list').textContent), null, { timeout: 15000 });
  delay = 0;
  const rows = ts.gear().filter(g => g.name === 'כיסא חוף נמוך');
  assert.strictEqual(rows.length, 1, 'retry made a duplicate suggestion');
  assert.strictEqual(rows[0].status, ST.pending);
  const ownKey = (await mineKeys()).find(k => k.startsWith('c'));
  await page.check('#gm-' + ownKey);                               // packed before the approval
  await noHScroll('own item');

  // ---- approved in the sheet (moved to another section): merges into the general item ----
  rows[0].status = ST.approved; rows[0].section = 'ציוד כללי';
  ts.gear()[1].status = ST.hidden;                                // and one seed item hidden
  await page.reload();
  await page.click('#tab-gear');
  await page.waitForFunction((id) => document.querySelector('#gear-mine-list li[data-key="g' + id + '"], #gear-pick-list li[data-key="g' + id + '"]'), rows[0].id, { timeout: 5000 });
  await page.click('#gear-view-mine');
  keys = await mineKeys();
  assert.ok(keys.includes('g' + rows[0].id) && !keys.some(k => k.startsWith('c')), 'own item did not merge: ' + keys);
  assert.ok(await page.isChecked('#gm-g' + rows[0].id), 'packed mark lost in the merge');
  assert.ok(!(await text('#gear-mine-list')).includes('הוצע'));
  await page.click('#gear-view-pick');
  assert.strictEqual(await page.locator('#gp-g2').count(), 0, 'a hidden item is still listed');
  assert.strictEqual(await text('#gear-count'), SEED.length + ' פריטים ברשימה הכללית.');   // -1 hidden, +1 approved

  // ---- reset packing marks (confirm accepted) ----
  await page.click('#gear-view-mine');
  await page.click('#gear-reset');
  assert.ok((await text('#gear-progress-text')).startsWith('ארוזים 0 מתוך'));

  // ---- first visit, slow server: the starter list at once ----
  await page.evaluate(() => localStorage.clear());
  delay = 3000;
  const t1 = Date.now();
  await page.reload();
  await page.click('#tab-gear');
  assert.strictEqual(await text('#gear-count'), SEED.length + ' פריטים ברשימה הכללית.');
  assert.ok(Date.now() - t1 < 2500, 'the starter list waited for the server');
  delay = 0;
  await page.waitForTimeout(3500);

  // ---- the live script before the gear version: starter list, own item waits in the outbox ----
  oldBackend = true;
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#tab-gear');
  await page.waitForTimeout(600);
  assert.strictEqual(await text('#gear-count'), SEED.length + ' פריטים ברשימה הכללית.');
  await page.selectOption('#gear-new-sec', 'שונות');
  await page.fill('#gear-new-name', 'מחכה בתור');
  await page.click('#gear-form button[type=submit]');
  await page.waitForTimeout(800);
  assert.ok((await text('#gear-pick-list')).includes('מחכה בתור'));
  assert.ok(await page.locator('#gear-pick-list .sending').count() === 1, 'the own item should wait, still sending');
  await page.reload();
  await page.click('#tab-gear');
  assert.ok((await text('#gear-pick-list')).includes('מחכה בתור'), 'unsent own item lost on reload');
  // the new script arrives: the waiting item is sent on the next visit
  oldBackend = false;
  await page.reload();
  await page.click('#tab-gear');
  await page.waitForFunction(() => /הוצע למארגן/.test(document.getElementById('gear-pick-list').textContent), null, { timeout: 15000 });
  assert.strictEqual(ts.gear().filter(g => g.name === 'מחכה בתור').length, 1);
  // an own item can be removed from the list
  await page.click('#gear-pick-list .gdrop');
  assert.ok(!(await text('#gear-pick-list')).includes('מחכה בתור'));

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('all gear e2e tests passed');
})().catch(e => { console.error(e); process.exit(1); });
