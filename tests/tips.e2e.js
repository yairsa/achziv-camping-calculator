// Run: node tests/tips.e2e.js — the tips tab in headless Chrome at 360px, against backend/Code.gs running in
// Node's vm (the Google URL is mocked, so nothing reaches the live sheet). Submit → approve in the "sheet" →
// visible on the site, for a tip and for a comment; Google's dropped replies; the old live script.
// Needs playwright-core (PLAYWRIGHT_CORE=<path>, default: the website repo's copy) and installed Chrome (CHROME=<path>).
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/YairSahar_Business/ParentingUpClose_Website/node_modules/playwright-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../backend/Code.gs', 'utf8'), ctx);
const ST = vm.runInContext('ST', ctx);

function tipStore() {
  const tips = [], comments = [];
  return { tips: () => tips, comments: () => comments, addTip: (r) => tips.push(r), addComment: (r) => comments.push(r),
           updateTip: () => {}, updateComment: () => {}, now: () => '30/09/2026 12:00' };
}
const regStore = { all: () => [], put() {}, remove() {}, hash: () => '', now: () => '', nowMs: () => 0 };
let ts = tipStore(), oldBackend = false, dropNext = 0, calls = [], delay = 0, offline = false;
function seed() {
  ts = tipStore();
  const t = (id, category, title, text, author) => ts.addTip({ id, status: ST.approved, category, title, text, author: author || '',
    submitted: '', approved: 'x', mergedInto: '', similar: '', clientId: 'seed' + id });
  t(1, 'אוהלים ולינה', 'יתדות ארוכות לחול', 'היתדות הרגילות לא מחזיקות בחול. קחו יתדות של 30 ס"מ לפחות.', 'רונית');
  t(2, 'ילדים', 'פנס לכל ילד', 'בלילה החניון חשוך. פנס ראש לכל ילד חוסך הרבה בכי.');
  for (let i = 1; i <= 4; i++) ts.addComment({ id: i, tipId: 1, status: ST.approved, text: 'תגובה ' + i, author: '', submitted: '', approved: 'x', clientId: 'sc' + i });
  ts.addComment({ id: 5, tipId: 2, status: ST.pending, text: 'עוד לא מאושר', author: '', submitted: '', approved: '', clientId: 'sc5' });
}
const approve = (rows, id) => { rows.find(r => +r.id === id).status = ST.approved; };

(async () => {
  seed();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://script.google.com/**', async (route) => {
    const req = route.request(), body = req.method() === 'POST' ? JSON.parse(req.postData()) : { action: 'summary' };
    calls.push(body.action);
    if (offline && body.action !== 'summary') return route.abort();
    if (delay) await new Promise(r => setTimeout(r, delay));
    let res;
    if (oldBackend && /^(tips|submitTip|submitComment)$/.test(body.action)) res = { ok: false, error: 'bad_request' };
    else res = JSON.parse(JSON.stringify(ctx.route(body, body.action === 'summary' ? regStore : null, ts)));
    if (dropNext > 0) { dropNext--; return route.fulfill({ status: 404, contentType: 'text/html', body: '<html>not found</html>' }); }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  const url = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  const text = (sel) => page.locator(sel).innerText();
  const noHScroll = async (where) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal scroll: ' + where);

  // ---- prefetched in the background, so the tab is ready before it is opened ----
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('#tip-1'), null, { timeout: 5000 });
  assert.ok(await page.isHidden('#panel-tips'), 'prefetch should not switch tabs');
  await page.click('#tab-tips');
  assert.ok(await page.isVisible('#tip-1'));
  assert.strictEqual(await text('#tips-count'), '2 טיפים.');
  assert.strictEqual(await page.locator('#tip-1 .clist li:visible').count(), 3);
  await page.click('#tip-1 .more');
  assert.strictEqual(await page.locator('#tip-1 .clist li:visible').count(), 4);
  assert.ok(!(await text('#panel-tips')).includes('עוד לא מאושר'), 'a pending comment leaked');
  await page.fill('#tips-q', 'והיתדות');                       // prefix ו + ה, still found
  assert.strictEqual(await page.locator('.tcard').count(), 1);
  assert.ok((await text('#tips-count')).startsWith('נמצאו 1 מתוך 2'));
  await page.fill('#tips-q', '');
  await page.selectOption('#tips-cat', 'ילדים');
  assert.deepStrictEqual(await page.locator('#tips-list .tcard h3').allInnerTexts(), ['פנס לכל ילד']);
  await page.selectOption('#tips-cat', '');
  await noHScroll('list');

  // ---- similar panel → comment instead ----
  await page.fill('#tip-title', 'יתדות לחול');
  await page.fill('#tip-text', 'יתדות מתכת ארוכות');
  await page.waitForSelector('#tip-similar:not([hidden])');
  assert.ok((await text('#tip-similar')).includes('יתדות ארוכות לחול'));
  await page.click('#tip-similar [data-go="1"]');
  assert.ok(await page.isVisible('#cf-1'));
  assert.strictEqual(await page.inputValue('#ct-1'), 'יתדות מתכת ארוכות');
  await noHScroll('similar');

  // ---- comment: shown at once while the server is slow, and the first reply is dropped by "Google" ----
  delay = 1500; dropNext = 1;
  const t0 = Date.now();
  await page.click('#cf-1 button[type=submit]');
  await page.waitForSelector('#tip-1 .clist li.pending .sending', { timeout: 300 });
  assert.ok(Date.now() - t0 < 600, 'the comment waited for the server');
  assert.ok((await text('#tip-1 .comments > .msg')).includes('נשלחה'));
  await page.waitForFunction(() => /ממתין לאישור/.test(document.querySelector('#tip-1 .clist li.pending').textContent), null, { timeout: 15000 });
  delay = 0;
  assert.strictEqual(ts.comments().filter(c => c.text === 'יתדות מתכת ארוכות').length, 1, 'retry made a duplicate comment');

  // ---- tip: validation, submit (reply dropped twice) → "sent from this device" → approve → visible ----
  await page.fill('#tip-title', 'צל');
  await page.fill('#tip-text', 'סככה');
  await page.click('#tip-form button[type=submit]');
  assert.ok((await text('#tip-msg')).includes('קטגוריה'));
  await page.selectOption('#tip-cat', 'ים וחוף');
  await page.click('#tip-form button[type=submit]');
  assert.ok((await text('#tip-msg')).includes('3 תווים'));
  await page.fill('#tip-title', 'צל בחוף');
  await page.fill('#tip-text', 'בצהריים אין צל על החוף — שמשייה או יריעה עם מוטות.');
  await page.fill('#tip-author', 'אבי');
  dropNext = 2;
  await page.click('#tip-form button[type=submit]');
  await page.waitForSelector('#tips-mine .pending', { timeout: 300 });
  assert.ok((await text('#tip-msg')).includes('נשלח'));
  await page.waitForFunction(() => /ממתין לאישור/.test(document.getElementById('tips-mine').textContent), null, { timeout: 15000 });
  const mineTips = ts.tips().filter(t => t.title === 'צל בחוף');
  assert.strictEqual(mineTips.length, 1, 'retry made a duplicate tip');
  assert.strictEqual(mineTips[0].status, ST.pending);
  assert.strictEqual(await page.inputValue('#tip-title'), '');
  assert.ok(!(await text('#tips-list')).includes('צל בחוף'), 'a pending tip is in the public list');
  await noHScroll('pending');

  // the reload before approval still shows both as pending (from this browser's memory)
  await page.reload(); await page.waitForSelector('#tip-1');
  assert.ok((await text('#tips-mine')).includes('צל בחוף'));
  assert.strictEqual(await page.locator('#tip-1 .clist li.pending').count(), 1);

  approve(ts.tips(), mineTips[0].id);
  approve(ts.comments(), ts.comments().find(c => c.text === 'יתדות מתכת ארוכות').id);
  await page.reload(); await page.waitForSelector('#tip-1');
  assert.strictEqual(await text('#tips-mine'), '', 'approved tip still shown as pending');
  assert.ok((await text('#tips-list')).includes('צל בחוף'));
  assert.strictEqual(await page.locator('.clist li.pending').count(), 0);
  await page.click('#tip-1 .more');
  assert.ok((await text('#tip-1 .clist')).includes('יתדות מתכת ארוכות'));
  assert.strictEqual(await text('#tips-count'), '3 טיפים.');
  await noHScroll('approved');

  // ---- the cached copy shows at once while the server is slow ----
  delay = 3000;
  await page.reload();
  await page.waitForSelector('#tip-1', { timeout: 800 });
  assert.ok(await page.evaluate(() => !document.getElementById('group-card').hidden), 'group table waited for the server');
  delay = 0;
  await page.waitForTimeout(3500);

  // ---- outbox: offline send survives a reload and is sent on the next visit, once ----
  offline = true;
  await page.click('#tip-2 .add-cmt');
  await page.fill('#ct-2', 'נשלח בלי רשת');
  await page.click('#cf-2 button[type=submit]');
  await page.waitForSelector('#tip-2 li.pending .sending');
  await page.waitForTimeout(1500);
  offline = false;
  await page.reload(); await page.waitForSelector('#tip-2');
  assert.ok(await page.isVisible('#tip-2 li.pending'), 'unsent comment lost on reload');
  await page.waitForFunction(() => /ממתין לאישור/.test(document.querySelector('#tip-2 li.pending').textContent), null, { timeout: 15000 });
  assert.strictEqual(ts.comments().filter(c => c.text === 'נשלח בלי רשת').length, 1);

  // ---- an error a resend cannot fix: shown, and removable ----
  ts.tips().find(t => +t.id === 2).status = ST.hidden;     // hidden in the sheet after the page loaded
  await page.click('#tip-2 .add-cmt');
  await page.fill('#ct-2', 'על טיפ שהוסתר');
  await page.click('#cf-2 button[type=submit]');
  await page.waitForSelector('#tip-2 .failed', { timeout: 15000 });
  await page.click('#tip-2 .drop');
  assert.ok(!(await text('#tip-2')).includes('על טיפ שהוסתר'));

  // ---- the live script before the tips version: calm message, no form ----
  oldBackend = true;
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(500);
  assert.ok((await text('#tips-state')).includes('בקרוב'));
  assert.ok(await page.isHidden('#tip-write'));
  assert.ok(await page.isHidden('#tips-tools'));

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('all tips e2e tests passed');
})().catch(e => { console.error(e); process.exit(1); });
