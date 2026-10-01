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
const tour = P(ctx.tourSeedRows_()).map((r, i) => ({ _row: i + 2, tour: r[0], step: r[1], key: r[2], title: r[3], text: r[4] }));
const ts = {
  tips: () => tips, comments: () => comments, gear: () => gear, tour: () => tour,
  addTip: (r) => tips.push(r), addComment: (r) => comments.push(r), addGear: (r) => gear.push(r),
  updateTip() {}, updateComment() {}, updateGear() {}, updateTour() {}, now: () => new Date()
};
const acts = [{ id: 1, status: 'פעיל', owner: 'משפחת לוי', topic: 'ציור בחול', host: '', description: 'ציור ופיסול בחול הרטוב',
  start: '2026-10-07T10:00', end: '2026-10-07T11:00', tag: 'ילדים', ageFrom: 4, ageTo: 9, capacity: 10, required: '', suggested: '',
  created: '', updated: '', clientId: 'a1' }];
const as = { acts: () => acts, joins: () => [], addAct() {}, updateAct() {}, addJoin() {}, updateJoin() {}, now: () => new Date() };
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
    const res = oldBackend ? { ok: false, error: 'bad_request' } : P(ctx.route(body, null, ts, as, adm));
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

  await page.fill('#login-name', 'יאיר'); await page.fill('#login-pw', 'camp-password-2');
  await page.click('#login-go');
  await page.waitForSelector('#q-tip-4');

  // ---- §4.3 edit anything: a tab per kind; hide a tip and restore it ----
  const rows = () => page.locator('#list-items .adm-card .adm-title').allInnerTexts();
  await page.click('#adm-nav [data-view="tip"]');
  await page.waitForSelector('#adm-list:not([hidden]) #l-tip-1');
  assert.strictEqual(await text('#list-title'), 'טיפים');
  assert.strictEqual(await page.getAttribute('#adm-nav [data-view="tip"]', 'aria-pressed'), 'true');
  await page.fill('#list-q', 'מדוזות');
  assert.deepStrictEqual(await rows(), ['מדוזות בחוף']);
  await page.fill('#list-q', '');
  await noHScroll('tip list');
  await page.click('#l-tip-1');
  assert.ok(await page.isVisible('#adm-edit'));
  assert.strictEqual(await page.inputValue('#f-title'), 'יתדות ארוכות לחול');
  assert.strictEqual(await page.inputValue('#e-status'), 'approved');
  await page.selectOption('#e-status', 'hidden');
  await noHScroll('tip edit');
  delay = 1500;                                       // a slow server: the list shows the change before it refreshes
  await page.click('#edit-save');
  await page.waitForFunction(() => /טיפ 1 נשמר/.test(document.getElementById('list-msg').textContent));
  assert.ok((await text('#l-tip-1')).includes('הוסתר'), 'the list does not show the new status at once');
  delay = 0;
  await page.waitForFunction(() => !document.getElementById('list-refresh').disabled);
  assert.ok(!P(ctx.tipsPublic_(ts)).tips.some(t => t.id === 1), 'the hidden tip is still public');
  assert.ok((await page.locator('#list-filter button').allInnerTexts()).some(t => /^הוסתר/.test(t)));
  await page.click('#list-filter [data-filter="hidden"]');
  assert.deepStrictEqual(await rows(), ['יתדות ארוכות לחול']);
  await page.click('#l-tip-1');
  await page.selectOption('#e-status', 'approved');
  await page.click('#edit-save');
  await page.waitForFunction(() => /טיפ 1 נשמר/.test(document.getElementById('list-msg').textContent));
  assert.ok(P(ctx.tipsPublic_(ts)).tips.some(t => t.id === 1), 'the restored tip is not public');
  assert.deepStrictEqual(logged.filter(l => l[2] === 'tip' && l[3] === 1).map(l => l[6]), [ST.hidden, ST.approved]);

  // ---- the back button closes the edit screen; a merged tip's status reads "no change" ----
  await page.click('#l-tip-3');
  assert.strictEqual(await page.inputValue('#e-status'), '');
  assert.ok((await text('#edit-meta')).includes('מוזג לטיפ 1'));
  await page.goBack();
  await page.waitForSelector('#adm-list:not([hidden])');

  // ---- fix an activity's time; a wrong time keeps the screen open with the edits ----
  await page.click('#adm-nav [data-view="activity"]');
  await page.waitForSelector('#l-activity-1');
  assert.ok((await text('#l-activity-1')).includes('ד׳ 07/10, 10:00 עד 11:00'));
  await page.click('#l-activity-1');
  assert.ok(await page.isVisible('#f-ages'));
  assert.ok((await text('#edit-meta')).includes('משפחת לוי'));
  await page.selectOption('#f-end-h', '09');
  await page.click('#edit-save');
  await page.waitForFunction(() => /אחרי ההתחלה/.test(document.getElementById('edit-msg').textContent));
  assert.ok(await page.isVisible('#adm-edit'));
  assert.strictEqual(acts[0].end, '2026-10-07T11:00');
  await page.selectOption('#f-start-day', '2026-10-08'); await page.selectOption('#f-start-h', '16'); await page.selectOption('#f-start-m', '30');
  await page.selectOption('#f-end-day', '2026-10-08'); await page.selectOption('#f-end-h', '18');
  await noHScroll('activity edit');
  await page.click('#edit-save');
  await page.waitForFunction(() => /פעילות 1 נשמר/.test(document.getElementById('list-msg').textContent));
  const act = P(ctx.activitiesPublic_(as)).activities[0];
  assert.deepStrictEqual([act.start, act.end, act.ageFrom], ['2026-10-08T16:30', '2026-10-08T18:00', 4]);
  assert.ok((await text('#l-activity-1')).includes('ה׳ 08/10, 16:30 עד 18:00'));
  // for everyone: the ages are hidden and cleared
  await page.click('#l-activity-1');
  await page.selectOption('#f-tag', 'לכולם');
  assert.ok(await page.isHidden('#f-ages'));
  await page.click('#edit-save');
  await page.waitForFunction(() => /פעילות 1 נשמר/.test(document.getElementById('list-msg').textContent));
  assert.deepStrictEqual([acts[0].tag, acts[0].ageFrom, acts[0].ageTo], ['לכולם', '', '']);

  // ---- edit a tour bubble: the preview uses the site's format, then the public page shows it ----
  const NL = String.fromCharCode(10);
  await page.click('#adm-nav [data-view="tour"]');
  await page.waitForSelector('#l-tour-welcome-hello');
  await page.click('#l-tour-welcome-hello');
  assert.ok(await page.isVisible('#edit-preview-wrap'));
  assert.strictEqual(await page.isVisible('#e-status'), false, 'a tour text has no status');
  await page.fill('#f-title', 'שלום מדף הניהול');
  await page.fill('#f-text', 'פסקה אחת' + NL + NL + '**מודגש** כאן');
  assert.strictEqual(await page.innerHTML('#edit-preview'), '<h3>שלום מדף הניהול</h3><p>פסקה אחת</p><p><strong>מודגש</strong> כאן</p>');
  await page.fill('#f-title', '');
  assert.ok((await page.innerHTML('#edit-preview')).startsWith('<h3>ברוכים הבאים!</h3>'), 'an empty title does not preview the built-in one');
  await page.fill('#f-title', 'שלום מדף הניהול');
  await noHScroll('tour edit');
  await page.click('#edit-save');
  await page.waitForFunction(() => /בועה נשמר/.test(document.getElementById('list-msg').textContent));
  assert.deepStrictEqual([tour[0].title, tour[0].text], ['שלום מדף הניהול', 'פסקה אחת' + NL + NL + '**מודגש** כאן']);
  assert.deepStrictEqual(await rows().then(r => r[0]), 'שלום מדף הניהול');
  {
    const pc = await browser.newContext({ viewport: { width: 360, height: 780 } });
    const pub = await pc.newPage();
    pub.on('pageerror', e => errors.push('public: ' + e));
    await pub.route('https://fonts.googleapis.com/**', r => r.abort());
    await pub.route('https://script.google.com/**', (route) => {
      const body = JSON.parse(route.request().postData() || '{}');       // the summary is a GET
      const res = body.action === 'tour' ? P(ctx.route(body, null, ts)) : { ok: false, error: 'server_error' };
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
    });
    await pub.goto('file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/'));
    await pub.waitForFunction(() => localStorage.getItem('achziv-tour-texts'), null, { timeout: 8000 });
    await pub.keyboard.press('Escape');
    await pub.click('#tour-help');
    await pub.waitForSelector('.tour-bub:not([hidden])');
    assert.strictEqual(await pub.innerText('#tour-title'), 'שלום מדף הניהול');
    assert.strictEqual(await pub.innerHTML('#tour-text'), '<p>פסקה אחת</p><p><strong>מודגש</strong> כאן</p>');
    await pc.close();
  }

  // ---- logout leaves nothing behind ----
  await page.click('#adm-logout');
  assert.ok(await page.isVisible('#adm-login'));
  assert.deepStrictEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => /^achziv-admin/.test(k))), [], 'logout left data');
  await noHScroll('login');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('admin e2e passed');
})().catch(e => { console.error(e); process.exit(1); });
