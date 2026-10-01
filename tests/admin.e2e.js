// Run: node tests/admin.e2e.js — the managing page (admin.html) in headless Chrome at 360px, against backend/Code.gs
// running in Node's vm (the Google URL is mocked, so nothing reaches the live sheet). Login, the waiting list, one
// item's review with edits, approve / reject / merge, a dropped reply, the cached list, the old live script, logout.
// Needs playwright-core (PLAYWRIGHT_CORE=<path>, default: the website repo's copy) and installed Chrome (CHROME=<path>).
const assert = require('assert'), fs = require('fs'), vm = require('vm'), path = require('path'), crypto = require('crypto');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/YairSahar_Business/ParentingUpClose_Website/node_modules/playwright-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../backend/Code.gs', 'utf8'), ctx);
const ST = vm.runInContext('ST', ctx);
const P = (x) => JSON.parse(JSON.stringify(x));

let orgs = {};
const logged = [];
const adm = {
  orgs: () => orgs, saveOrgs: (o) => { orgs = o; }, salt: () => crypto.randomBytes(8).toString('hex'),
  hash: (salt, pw) => crypto.createHash('sha256').update(salt + '|' + pw).digest('hex'),
  sign: (body) => crypto.createHmac('sha256', 'e2e').update(body).digest('hex'), nowMs: () => Date.now(),
  log: (rows) => logged.push(...P(rows))
};
ctx.setAdminPassword_(adm, 'יאיר', 'camp-password-1');

const at = (d, h) => new Date(Date.UTC(2026, 8, d, h));
const tips = [], comments = [], gear = [];
const ts = {
  tips: () => tips, comments: () => comments, gear: () => gear,
  addTip: (r) => tips.push(r), addComment: (r) => comments.push(r), addGear: (r) => gear.push(r),
  updateTip() {}, updateComment() {}, updateGear() {}, now: () => new Date()
};
const tip = (id, status, category, title, text, extra) => tips.push(Object.assign({ id, status, category, title, text, author: '',
  submitted: at(29, id), approved: status === ST.approved ? 'x' : '', mergedInto: '', similar: '', clientId: 'c' + id }, extra));
tip(1, ST.approved, 'אוהלים ולינה', 'יתדות ארוכות לחול', 'היתדות הרגילות לא מחזיקות בחול.');
tip(2, ST.pending, 'ציוד', 'כובע רחב לילדים', 'השמש חזקה מאוד בחוף, כובע עם שוליים רחבים.', { author: 'רונית' });
tip(3, ST.pending, 'שונות', 'יתדות מתכת לחול', 'בחול רק יתדות מתכת ארוכות מחזיקות.', { similar: '1: יתדות ארוכות לחול' });
comments.push({ id: 1, tipId: 1, status: ST.pending, text: 'מסכים לגמרי, גם פטיש גומי עוזר', author: '', submitted: at(30, 8), approved: '', clientId: 'k1' });
gear.push({ id: 1, status: ST.approved, section: 'ביגוד', name: 'כובע', tags: '', note: '', submitted: '', approved: 'x', clientId: 's1' });
gear.push({ id: 2, status: ST.pending, section: 'שונות', name: 'פטיש גומי', tags: '', note: '', submitted: at(30, 9), approved: '', clientId: 'g2' });

let oldBackend = false, dropNext = 0, delay = 0;
const calls = [];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://script.google.com/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    calls.push(body.action);
    if (delay) await new Promise(r => setTimeout(r, delay));
    const res = oldBackend ? { ok: false, error: 'bad_request' } : P(ctx.route(body, null, ts, null, adm));
    if (dropNext > 0) { dropNext--; return route.fulfill({ status: 404, contentType: 'text/html', body: '<html>not found</html>' }); }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  const url = 'file:///' + path.resolve(__dirname, '../admin.html').replace(/\\/g, '/');
  const text = (sel) => page.locator(sel).innerText();
  const noHScroll = async (where) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal scroll: ' + where);
  const cards = () => page.locator('#queue-list .adm-card .adm-title').allInnerTexts();

  // ---- the old live script: login says the server is not updated yet ----
  oldBackend = true;
  await page.goto(url);
  assert.ok(await page.isVisible('#adm-login'));
  await page.fill('#login-name', 'יאיר'); await page.fill('#login-pw', 'camp-password-1');
  await page.click('#login-go');
  await page.waitForSelector('#adm-server:not([hidden])');
  oldBackend = false;

  // ---- wrong password, then the right one ----
  await page.fill('#login-pw', 'wrong-password');
  await page.click('#login-go');
  await page.waitForFunction(() => /שגויים/.test(document.getElementById('login-msg').textContent));
  await page.fill('#login-pw', 'camp-password-1');
  await page.click('#login-go');
  await page.waitForSelector('#adm-queue:not([hidden]) .adm-card');
  assert.ok(await page.isHidden('#adm-server'), 'the old-server note stayed up');
  assert.strictEqual(await text('#adm-name'), 'יאיר');
  assert.strictEqual(await page.inputValue('#login-pw'), '', 'the password stayed in the form');
  assert.ok(!(await page.evaluate(() => JSON.stringify(localStorage))).includes('camp-password-1'), 'the password was stored');

  // ---- the list: newest first, counts per kind, filter ----
  assert.deepStrictEqual(await cards(), ['פטיש גומי', 'מסכים לגמרי, גם פטיש גומי עוזר', 'יתדות מתכת לחול', 'כובע רחב לילדים']);
  assert.deepStrictEqual(await page.locator('#queue-filter button').allInnerTexts(), ['הכל 4', 'טיפים 2', 'תגובות 1', 'ציוד 1']);
  assert.ok((await text('#q-tip-3')).includes('דומה ל־1: יתדות ארוכות לחול'));
  assert.ok((await text('#q-tip-3')).includes('29/09 בשעה 06:00'), 'submitted time is day-first, Israel time');
  await page.click('#queue-filter [data-filter="tip"]');
  assert.deepStrictEqual(await cards(), ['יתדות מתכת לחול', 'כובע רחב לילדים']);
  await page.click('#queue-filter [data-filter=""]');
  await noHScroll('list');

  // ---- review a tip: edit the category and title, approve → gone from the list and public ----
  await page.click('#q-tip-2');
  assert.ok(await page.isVisible('#adm-item'));
  assert.strictEqual(await page.inputValue('#f-title'), 'כובע רחב לילדים');
  assert.strictEqual(await page.inputValue('#f-author'), 'רונית');
  await page.selectOption('#f-category', 'ילדים');
  await page.fill('#f-title', 'כובע עם שוליים לילדים');
  await noHScroll('review');
  await page.click('#adm-item [data-decide="approved"]');
  await page.waitForSelector('#adm-queue:not([hidden])');
  assert.strictEqual(await text('#queue-msg'), 'טיפ 2 אושר.');
  assert.ok(!(await cards()).some(t => t.includes('כובע')), 'the approved tip is still waiting');
  const pub = P(ctx.tipsPublic_(ts)).tips.find(t => t.id === 2);
  assert.deepStrictEqual([pub.category, pub.title], ['ילדים', 'כובע עם שוליים לילדים']);
  assert.deepStrictEqual(logged.filter(l => l[3] === 2).map(l => l[4]), ['category', 'title', 'status']);
  assert.strictEqual(logged[0][1], 'יאיר');

  // ---- the phone's back button closes the item ----
  await page.click('#q-comment-1');
  assert.ok((await text('#adm-item')).includes('תגובה על הטיפ: יתדות ארוכות לחול'));
  await page.goBack();
  await page.waitForSelector('#adm-queue:not([hidden])');

  // ---- reject a comment, and the first reply is dropped by "Google": retried, decided once ----
  await page.click('#q-comment-1');
  dropNext = 1;
  const before = calls.length;
  await page.click('#adm-item [data-decide="rejected"]');
  await page.waitForFunction(() => /נדחתה/.test(document.getElementById('queue-msg').textContent));
  assert.strictEqual(calls.slice(before).filter(a => a === 'adminDecide').length, 2, 'the dropped reply was not retried');
  assert.strictEqual(comments[0].status, ST.rejected);
  assert.strictEqual(logged.filter(l => l[2] === 'comment').length, 1, 'the retry logged twice');

  // ---- merge a tip: the similar tip is pre-selected; it becomes a comment on the target ----
  await page.click('#q-tip-3');
  assert.ok(await page.isVisible('#item-merge'));
  assert.strictEqual(await page.inputValue('#merge-target'), '1');
  await page.click('#adm-item [data-decide="merged"]');
  await page.waitForFunction(() => /מוזג/.test(document.getElementById('queue-msg').textContent));
  assert.ok(P(ctx.tipsPublic_(ts)).tips.find(t => t.id === 1).comments.some(c => c.text.startsWith('יתדות מתכת לחול: ')));

  // ---- a server error keeps the item open with the edits ----
  await page.click('#q-gear-2');
  assert.ok(await page.isHidden('#item-merge'), 'merge offered for a gear item');
  await page.fill('#f-name', 'x');
  await page.click('#adm-item [data-decide="approved"]');
  await page.waitForFunction(() => /קצר מדי/.test(document.getElementById('item-msg').textContent));
  assert.ok(await page.isVisible('#adm-item'));
  assert.strictEqual(gear[1].status, ST.pending);

  // ---- approve a gear item with a new section and tags: on everyone's list ----
  await page.fill('#f-name', 'פטיש גומי ליתדות');
  await page.selectOption('#f-section', 'אוהלים ולינה');
  await page.fill('#f-tags', 'חול, חוף');
  await page.click('#adm-item [data-decide="approved"]');
  await page.waitForFunction(() => /פריט ציוד 2 אושר/.test(document.getElementById('queue-msg').textContent));
  assert.deepStrictEqual(P(ctx.gearPublic_(ts)).items.find(g => g.id === 2),
    { id: 2, section: 'אוהלים ולינה', name: 'פטיש גומי ליתדות', tags: ['חול', 'חוף'], note: '' });
  assert.strictEqual(await text('#queue-state'), 'אין כרגע ממתינים לאישור.');

  // ---- next visit: still logged in, the cached list at once while the server is slow ----
  tip(4, ST.pending, 'בטיחות', 'מדוזות בחוף', 'בתחילת אוקטובר יש לפעמים מדוזות. כדאי לבדוק לפני שנכנסים.');
  delay = 1500;
  await page.reload();
  await page.waitForSelector('#adm-queue:not([hidden])', { timeout: 500 });
  assert.strictEqual(await text('#queue-state'), 'אין כרגע ממתינים לאישור.', 'the cached list was not shown at once');
  await page.waitForSelector('#q-tip-4', { timeout: 5000 });
  delay = 0;

  // ---- a password change ends the login: back to the login screen ----
  ctx.setAdminPassword_(adm, 'יאיר', 'camp-password-2');
  await page.click('#queue-refresh');
  await page.waitForSelector('#adm-login:not([hidden])');
  assert.ok((await text('#login-msg')).includes('פגה'));

  // ---- logout leaves nothing behind ----
  await page.fill('#login-name', 'יאיר'); await page.fill('#login-pw', 'camp-password-2');
  await page.click('#login-go');
  await page.waitForSelector('#q-tip-4');
  await page.click('#adm-logout');
  assert.ok(await page.isVisible('#adm-login'));
  assert.strictEqual(await page.evaluate(() => localStorage.getItem('achziv-admin-token') || localStorage.getItem('achziv-admin-queue')), null);
  await noHScroll('login');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('admin e2e passed');
})().catch(e => { console.error(e); process.exit(1); });
