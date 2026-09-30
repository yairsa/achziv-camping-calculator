// Run: node tests/activities.e2e.js — the activities tab in headless Chrome at 360px, against backend/Code.gs running in
// Node's vm (the Google URL is mocked, so nothing reaches the live sheet). Add → join → full → leave → edit → cancel,
// the calendar, the filters, a dropped reply, a wrong code, the cached copy and the old live script.
// Needs playwright-core (PLAYWRIGHT_CORE=<path>, default: the website repo's copy) and installed Chrome (CHROME=<path>).
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/YairSahar_Business/ParentingUpClose_Website/node_modules/playwright-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../backend/Code.gs', 'utf8'), ctx);

const rows = [];
const reg = { all: () => rows, put: (r) => { if (!rows.includes(r)) rows.push(r); }, remove: (r) => rows.splice(rows.indexOf(r), 1),
  hash: (u, p) => crypto.createHash('sha256').update(u + '|' + p).digest('hex'), now: () => '30/09/2026 12:00', nowMs: () => Date.now() };
const acts = [], joins = [];
const as = { acts: () => acts, joins: () => joins, addAct: (r) => acts.push(r), updateAct() {}, addJoin: (r) => joins.push(r), updateJoin() {},
  now: () => '30/09/2026 12:00' };
for (const [user, pin] of [['משפחת כהן', '1234'], ['Levi', '5555']])
  ctx.route({ action: 'save', user, pin, nights: { '2026-10-06': 3 }, maxPeople: 3, data: {} }, reg);

let oldBackend = false, dropNext = 0, delay = 0, calls = [];
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
    const isAct = /^(activities|saveActivity|deleteActivity|join|leave)$/.test(body.action);
    let res;
    if (isAct && oldBackend) res = { ok: false, error: 'bad_request' };
    else if (isAct) res = ctx.route(body, reg, null, as);
    else if (/^(summary|save|load|delete)$/.test(body.action)) res = ctx.route(body, reg);
    else res = { ok: false, error: 'bad_request' };                       // tips and gear: not this test
    res = JSON.parse(JSON.stringify(res));
    if (dropNext > 0 && isAct && body.action !== 'activities') { dropNext--; return route.fulfill({ status: 404, contentType: 'text/html', body: '<html>not found</html>' }); }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  const url = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  const text = (sel) => page.locator(sel).innerText();
  const noHScroll = async (where) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal scroll: ' + where);
  const msg = () => text('#act-msg');
  const bg = (sel) => page.locator(sel).first().evaluate(e => getComputedStyle(e).backgroundColor);
  const waitMsg = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('act-msg').textContent), re.source, { timeout: 15000 });
  const setTime = async (key, d, h, m) => { await page.selectOption('#af-' + key + '-day', d); await page.selectOption('#af-' + key + '-h', h); await page.selectOption('#af-' + key + '-m', m); };

  // ---- prefetched in the background; the tab bar still fits at 360px ----
  await page.goto(url);
  await page.waitForTimeout(3000);
  assert.ok(calls.includes('activities'), 'activities not prefetched');
  assert.ok(await page.isHidden('#panel-acts'), 'prefetch should not switch tabs');
  { const tw = await page.evaluate(() => { const t = document.querySelector('.tabs'); return [t.scrollWidth, t.clientWidth]; }); assert.ok(tw[0] <= tw[1], 'the tab bar overflows at 360px: ' + tw); }
  await page.click('#tab-acts');
  assert.strictEqual(await text('#acts-count'), 'עוד אין פעילויות. אפשר להוסיף את הראשונה.');
  assert.ok(await page.isVisible('#acts-add'));
  assert.strictEqual(await page.locator('#acts-days .chip').count(), 9);        // all + 06/10..13/10
  await noHScroll('empty tab');

  // ---- add: validation, then a registered family with a wrong code, then the right one ----
  await page.click('#acts-add');
  assert.ok(await page.isVisible('#act-dlg'));
  assert.strictEqual(await page.inputValue('#af-end-day'), '2026-10-06');
  await page.fill('#af-topic', 'סדנת עפיפונים');
  await setTime('start', '2026-10-07', '10', '00');
  assert.strictEqual(await page.inputValue('#af-end-day'), '2026-10-07', 'the end should follow the start day');
  assert.strictEqual(await page.inputValue('#af-end-h'), '11');
  await setTime('end', '2026-10-07', '09', '00');
  await page.click('#af-save');
  assert.ok((await msg()).includes('הסיום צריך להיות אחרי'), await msg());
  await page.selectOption('#af-end-h', '12');
  await page.check('input[name="af-tag"][value="ילדים"]');
  assert.ok(await page.isVisible('#af-from'), 'ages show for kids');
  await page.fill('#af-from', '6'); await page.fill('#af-to', '12');
  await page.fill('#af-cap', '5');
  await page.fill('#af-req', 'מספריים');
  await page.fill('#af-desc', 'בונים ומעיפים\nעל החוף');
  await page.click('#af-save');
  assert.ok((await msg()).includes('שם המשפחה'), 'no name yet: ' + await msg());
  await page.fill('#act-user', 'משפחת כהן');
  await page.fill('#act-pin', '9999');
  await page.click('#af-save');
  await waitMsg(/הקוד לא תואם/);
  assert.strictEqual(acts.length, 0);
  await page.fill('#act-pin', '1234');
  delay = 800; dropNext = 1;                                              // the reply is lost once: api() retries
  await page.click('#af-save');
  await waitMsg(/הפעילות נוספה/);
  delay = 0;
  assert.strictEqual(acts.length, 1, 'a retried save made a duplicate');
  assert.strictEqual(await text('#act-dlg-title'), 'סדנת עפיפונים');
  assert.ok((await text('#act-dlg-body')).includes('ד׳ 07/10, 10:00 עד 12:00'), await text('#act-dlg-body'));
  assert.ok((await text('#act-dlg-body')).includes('ילדים, גילאי 6 עד 12'));
  assert.ok((await text('#act-dlg-body')).includes('נשארו 5 מקומות (0 מתוך 5)'));
  assert.ok(await page.isVisible('#act-edit'), 'the owner sees edit');
  assert.ok(await page.isHidden('#act-user'), 'the accepted code is not asked again');
  await noHScroll('details');

  // ---- join: 3, then change to 5 (sets, not adds) -> full ----
  await page.fill('#act-count', '3');
  await page.click('#act-join');
  await waitMsg(/הצטרפתם/);
  assert.ok((await text('#act-places')).includes('נשארו 2 מקומות'));
  await page.fill('#act-count', '5');
  await page.click('#act-join');
  await waitMsg(/הצטרפתם/);
  assert.strictEqual(joins.filter(j => j.count > 0).length, 1);
  assert.ok((await text('#act-places')).startsWith('מלא (5 מתוך 5)'), await text('#act-places'));
  await page.click('#act-dlg-close');
  assert.ok(await page.isHidden('#act-dlg'));
  assert.ok((await text('#acts-list')).includes('הצטרפתם (5)') && (await text('#acts-list')).includes('מלא'));

  // ---- another family: full, so it cannot join; it has no edit buttons ----
  await page.evaluate(() => { localStorage.setItem('achziv-registered', 'Levi'); });
  await page.reload();
  await page.click('#tab-acts');
  await page.click('.arow[data-id="1"]');
  assert.ok((await text('#act-dlg-body')).includes('הפעילות מלאה'));
  assert.strictEqual(await page.locator('#act-join').count(), 0);
  assert.ok(await page.isHidden('#act-edit'));
  assert.strictEqual(await page.inputValue('#act-user'), 'Levi', 'the name this device registered with is filled in');

  // ---- the owner leaves: a place opens and Levi joins ----
  await page.fill('#act-user', 'משפחת כהן');
  assert.ok(await page.isVisible('#act-edit'), 'the owner buttons follow the typed name');
  await page.click('#act-dlg-close');
  await page.evaluate(() => { localStorage.setItem('achziv-registered', 'משפחת כהן'); });
  await page.reload();
  await page.click('#tab-acts');
  await page.click('.arow[data-id="1"]');
  await page.fill('#act-pin', '1234');
  await page.click('#act-leave');
  await waitMsg(/יצאתם/);
  assert.ok((await text('#act-places')).includes('נשארו 5 מקומות'));
  assert.strictEqual(await page.locator('#act-leave').count(), 0);
  // Levi, in the same visit: "החלפה" asks for the name + code again
  await page.click('#act-switch');
  await page.fill('#act-user', 'Levi'); await page.fill('#act-pin', '5555');
  await page.fill('#act-count', '4');
  await page.click('#act-join');
  await waitMsg(/הצטרפתם/);
  assert.ok((await text('#act-dlg-body')).includes('Levi (4)'));

  // ---- edit (owner only): capacity below who joined is refused, then a real edit ----
  await page.click('#act-switch');
  await page.fill('#act-user', 'משפחת כהן'); await page.fill('#act-pin', '1234');
  await page.fill('#act-count', '1');
  await page.click('#act-join');
  await waitMsg(/הצטרפתם/);
  await page.click('#act-edit');
  assert.strictEqual(await page.inputValue('#af-topic'), 'סדנת עפיפונים');
  assert.strictEqual(await page.inputValue('#af-end-h'), '12');
  await page.fill('#af-cap', '3');
  await page.click('#af-save');
  assert.ok((await msg()).includes('כבר הצטרפו יותר'), await msg());
  await page.fill('#af-cap', '8');
  await page.fill('#af-topic', 'סדנת עפיפונים ענקיים');
  await page.click('#af-save');
  await waitMsg(/השינויים נשמרו/);
  assert.strictEqual(await text('#act-dlg-title'), 'סדנת עפיפונים ענקיים');
  assert.ok((await text('#act-places')).includes('נשארו 3 מקומות (5 מתוך 8)'));
  await page.click('#act-dlg-close');

  // ---- a second activity, for adults, over midnight; then filters ----
  await page.click('#acts-add');
  await page.fill('#af-topic', 'ערב שירה');
  await setTime('start', '2026-10-06', '21', '00');
  await setTime('end', '2026-10-07', '01', '00');
  await page.check('input[name="af-tag"][value="מבוגרים"]');
  assert.ok(await page.isHidden('#af-from'));
  await page.click('#af-save');
  await waitMsg(/הפעילות נוספה/);
  await page.click('#act-dlg-close');
  assert.deepStrictEqual(await page.locator('#acts-list h3').allInnerTexts(), ['ג׳ 06/10', 'ד׳ 07/10']);
  assert.strictEqual(await text('#acts-count'), '2 פעילויות.');
  assert.ok((await text('#acts-list')).includes('21:00 עד 01:00 (למחרת)'), await text('#acts-list'));
  await page.click('#acts-tags .chip[data-tag="ילדים"]');
  assert.strictEqual(await page.locator('.arow').count(), 1);
  await page.click('#acts-tags .chip[data-tag=""]');
  await page.click('#acts-days .chip[data-day="2026-10-07"]');                // over midnight: on both days
  assert.strictEqual(await page.locator('.arow').count(), 2);
  assert.ok((await text('#acts-list')).includes('ג׳ 06/10, 21:00 עד ד׳ 07/10, 01:00'));
  await page.click('#acts-days .chip[data-day=""]');
  await page.fill('#acts-q', 'עפיפון');
  assert.strictEqual(await page.locator('.arow').count(), 1);
  assert.ok((await text('#acts-count')).startsWith('נמצאו 1 מתוך 2'));
  await page.fill('#acts-q', '');
  assert.notStrictEqual(await bg('.arow[data-id="1"]'), await bg('.arow[data-id="2"]'), 'list rows share a colour');
  await noHScroll('list');

  // ---- calendar: 3 days at a time on a phone, blocks open the details ----
  await page.click('#acts-view-cal');
  assert.ok(await page.isHidden('#acts-list') && await page.isVisible('#acts-cal'));
  assert.deepStrictEqual(await page.locator('.calhead span').allInnerTexts(), ['', 'ג׳ 06/10', 'ד׳ 07/10', 'ה׳ 08/10']);
  assert.strictEqual(await page.locator('.ablock').count(), 3);                // the night event is split over two days
  assert.strictEqual(await text('.calhours span:first-child'), '08:00', 'the tail of last night should not stretch the day to 00:00');
  assert.ok((await text('.calday:nth-child(3) .ablock[data-id="2"]')).startsWith('עד 01:00'), 'the tail is drawn at the top');
  // each audience its own background: kids (id 1) and adults (id 2) differ, in the calendar and in the list
  assert.notStrictEqual(await bg('.ablock[data-id="1"]'), await bg('.ablock[data-id="2"]'), 'audiences share a colour');
  assert.ok(!/rgba\(0, 0, 0, 0\)|transparent/.test(await bg('.ablock[data-id="2"]')));
  assert.ok(await page.isDisabled('#acts-prev'));
  await page.click('#acts-next');
  assert.deepStrictEqual((await page.locator('.calhead span').allInnerTexts()).slice(1), ['ו׳ 09/10', 'ש׳ 10/10', 'א׳ 11/10']);
  await page.click('#acts-next');
  assert.deepStrictEqual((await page.locator('.calhead span').allInnerTexts()).slice(1), ['א׳ 11/10', 'ב׳ 12/10', 'ג׳ 13/10']);   // the last page stays full
  assert.ok(await page.isDisabled('#acts-next'));
  await page.click('#acts-prev'); await page.click('#acts-prev');
  await noHScroll('calendar');
  await page.locator('.ablock[data-id="1"]').click();
  assert.strictEqual(await text('#act-dlg-title'), 'סדנת עפיפונים ענקיים');
  // the block sits at its hours: 10:00 to 12:00 is two hour-rows
  const hgt = await page.locator('.ablock[data-id="1"]').evaluate(b => b.offsetHeight);
  assert.ok(Math.abs(hgt - 94) <= 2, 'block height ' + hgt);

  // ---- cancel (owner, has participants: confirmed) ----
  await page.click('#act-cancel');
  await page.waitForFunction(() => !document.getElementById('act-dlg').open, null, { timeout: 15000 });
  assert.ok((await text('#acts-state')).includes('בוטלה'));
  assert.strictEqual(acts.find(a => a.id === 1).status, 'בוטל');
  assert.strictEqual(await page.locator('.ablock[data-id="1"]').count(), 0);

  // ---- desktop: every day at once ----
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.waitForTimeout(100);
  assert.strictEqual(await page.locator('.calhead span').count(), 9);
  assert.strictEqual(await page.locator('#acts-prev').count(), 0);
  await page.setViewportSize({ width: 360, height: 780 });
  await page.click('#acts-view-list');

  // ---- slow server: the cached copy at once ----
  delay = 3000;
  const t0 = Date.now();
  await page.reload();
  await page.click('#tab-acts');
  assert.strictEqual(await page.locator('.arow').count(), 1);
  assert.ok(Date.now() - t0 < 2500, 'the cached list waited for the server');
  delay = 0;
  await page.waitForTimeout(3500);

  // ---- loaded under "ההרשמה שלי" in this visit: the name and code are filled in ----
  await page.click('#tab-calc');
  await page.fill('#reg-user', 'Levi'); await page.fill('#reg-pin', '5555');
  await page.click('#reg-load');
  await page.waitForFunction(() => /נטענה/.test(document.getElementById('reg-msg').textContent), null, { timeout: 15000 });
  await page.click('#tab-acts');
  await page.click('.arow');
  assert.strictEqual(await page.inputValue('#act-user'), 'Levi');
  assert.strictEqual(await page.inputValue('#act-pin'), '5555');
  await page.click('#act-dlg-close');

  // ---- the preview link ?demo#acts: the example activities, never sent or saved ----
  calls = [];
  await page.evaluate(() => localStorage.removeItem('achziv-acts-cache'));
  await page.goto(url + '?demo#acts');
  await page.waitForTimeout(500);
  assert.ok(await page.isVisible('#panel-acts'), 'the preview link opens the tab');
  assert.deepStrictEqual(await page.locator('.arow .atopic').allInnerTexts(), ['ארוחת ערב משותפת ומנגל', 'יוגה בזריחה על החוף', 'חיפוש אוצרות בחוף']);
  assert.ok((await text('#acts-state')).includes('תצוגה לדוגמה'));
  await page.click('.arow[data-id="2"]');
  await page.fill('#act-user', 'Levi'); await page.fill('#act-pin', '5555');
  await page.click('#act-join');
  assert.ok((await msg()).includes('לא נשמר'), await msg());
  assert.ok(!calls.includes('activities') && !calls.includes('join'), 'the preview talked to the server: ' + calls);
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('achziv-acts-cache')), null, 'the preview was cached');
  await page.click('#act-dlg-close');
  await noHScroll('preview');

  // ---- the live script before the activities version ----
  oldBackend = true;
  await page.evaluate(() => localStorage.clear());
  await page.goto(url);                                                      // off the preview link
  await page.click('#tab-acts');
  await page.waitForFunction(() => /בקרוב/.test(document.getElementById('acts-state').textContent), null, { timeout: 5000 });
  assert.ok(await page.isHidden('#acts-add'));
  await noHScroll('old backend');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('all activities e2e tests passed');
})().catch(e => { console.error(e); process.exit(1); });
