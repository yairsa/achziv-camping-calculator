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
const as = { acts: () => acts, joins: () => [], addAct: (r) => acts.push(r), updateAct() {}, addJoin() {}, updateJoin() {}, now: () => new Date() };
const tip = (id, status, category, title, text, extra) => tips.push(Object.assign({ id, status, category, title, text, author: '',
  submitted: at(29, id), approved: status === ST.approved ? 'x' : '', mergedInto: '', similar: '', clientId: 'c' + id }, extra));
tip(1, ST.approved, 'אוהלים ולינה', 'יתדות ארוכות לחול', 'היתדות הרגילות לא מחזיקות בחול.');
tip(2, ST.pending, 'ציוד', 'כובע רחב לילדים', 'השמש חזקה מאוד בחוף, כובע עם שוליים רחבים.', { author: 'רונית' });
tip(3, ST.pending, 'שונות', 'יתדות מתכת לחול', 'בחול רק יתדות מתכת ארוכות מחזיקות.', { similar: '1: יתדות ארוכות לחול' });
comments.push({ id: 1, tipId: 1, status: ST.pending, text: 'מסכים לגמרי, גם פטיש גומי עוזר', author: '', submitted: at(30, 8), approved: '', clientId: 'k1' });
gear.push({ id: 1, status: ST.approved, section: 'ביגוד', name: 'כובע', tags: '', note: '', submitted: '', approved: 'x', clientId: 's1' });
gear.push({ id: 2, status: ST.pending, section: 'שונות', name: 'פטיש גומי', tags: '', note: '', submitted: at(30, 9), approved: '', clientId: 'g2' });

// registrations (§4.4): an in-memory registration sheet, filled through the public save
const regRows = [];
const rs = { all: () => regRows, put: (r) => { if (!regRows.includes(r)) regRows.push(r); }, remove: (r) => regRows.splice(regRows.indexOf(r), 1),
  hash: (u, p) => crypto.createHash('sha256').update('salt|' + u + '|' + p).digest('hex'), now: () => '01/10/2026 09:00', nowMs: () => Date.now() };
const stay = (base, periods) => ({ base, periods: periods.map(p => Object.assign({ custom: false, counts: {} }, p)) });
ctx.route({ action: 'save', user: 'משפחת כהן', pin: '1234', nights: {}, maxPeople: 3, full: 420, group: 1,
  data: stay({ adult: 2, child: 1 }, [{ from: '2026-10-06', to: '2026-10-08' }]) }, rs);
ctx.route({ action: 'save', user: 'Levi', pin: '5555', nights: {}, maxPeople: 2, full: 304, group: 260,
  data: stay({ adult: 2 }, [{ from: '2026-10-07', to: '2026-10-09' }]) }, rs);
for (let i = 0; i < 5; i++) ctx.route({ action: 'load', user: 'Levi', pin: '0000' }, rs);
const codeHashes = regRows.map(r => r.pinHash);
const sent = [];

let oldBackend = false, dropNext = 0, delay = 0, hangNext = 0;
const calls = [];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://fonts.googleapis.com/**', r => r.abort());
  await page.route('https://script.google.com/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    calls.push(body.action + (body.kind ? ':' + body.kind : ''));
    if (hangNext > 0) { hangNext--; return; }          // never answered (and never run): the page gives up and retries
    if (delay) await new Promise(r => setTimeout(r, delay));
    const res = oldBackend ? { ok: false, error: 'bad_request' } : P(ctx.route(body, rs, ts, as, adm));
    sent.push(JSON.stringify(res));
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
  assert.strictEqual(calls.slice(before).filter(a => a.startsWith('adminDecide')).length, 2, 'the dropped reply was not retried');
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

  // ---- §4.4 registrations: the families tab, a locked family marked ----
  const fam = (name) => '#list-items .adm-card:has-text("' + name + '")';
  const result = () => text('#fam-result');
  await page.click('#adm-nav [data-view="family"]');
  await page.waitForSelector('#adm-list:not([hidden]) ' + fam('Levi'));
  assert.strictEqual(await text('#list-title'), 'הרשמות');
  assert.deepStrictEqual(await rows(), ['Levi', 'משפחת כהן']);
  assert.ok((await text(fam('Levi'))).includes('נעולה'));
  assert.ok((await text(fam('משפחת כהן'))).includes('06/10 עד 08/10 · 3 לנים'));
  await noHScroll('family list');

  // ---- a family's stay through the calculator's pieces: headcount, dates, a warning, a second period ----
  await page.click(fam('משפחת כהן'));
  assert.strictEqual(await text('.adm-fam'), 'משפחת כהן');
  assert.ok(await page.isHidden('#fam-unlock'));
  assert.ok((await result()).includes('420'));                                    // 2 nights × (2×76 + 58)
  await page.click('.counter:has(#fc-b-child) [data-d="1"]');
  assert.strictEqual(await page.inputValue('#fc-b-child'), '2');
  assert.ok((await result()).includes('536'));
  await page.selectOption('#fp-to-0', '2026-10-09');
  assert.strictEqual(await text('#fp-n-0'), '3 לילות');
  assert.ok((await result()).includes('804'));
  await page.selectOption('#fp-to-0', '2026-10-14');                             // 8 nights: the calculator's warning
  assert.ok((await result()).includes('6 לילות'));
  assert.ok(await page.isDisabled('#edit-save'));
  await page.selectOption('#fp-to-0', '2026-10-09');
  assert.ok(await page.isEnabled('#edit-save'));
  await page.click('#fam-add');
  assert.strictEqual(await page.inputValue('#fp-from-1'), '2026-10-09');
  await page.check('#fp-custom-1');
  assert.strictEqual(await page.inputValue('#fc-p1-child'), '2');                  // starts from the family's composition
  await page.fill('#fc-p1-adult', '1'); await page.fill('#fc-p1-child', '0');
  assert.ok((await result()).includes('880'));                                    // 804 + one adult, one night
  await noHScroll('family edit');
  await page.click('#edit-save');
  await page.waitForFunction(() => /ההרשמה של משפחת כהן נשמרה/.test(document.getElementById('list-msg').textContent));
  const cohen = regRows.find(r => r.user === 'משפחת כהן');
  assert.deepStrictEqual([cohen.full, cohen.group, cohen.maxPeople], [880, 3 * (130 + 98) + 65, 4]);
  assert.deepStrictEqual(P(cohen.nights), { '2026-10-06': 4, '2026-10-07': 4, '2026-10-08': 4, '2026-10-09': 1 });
  assert.strictEqual(cohen.pinHash, codeHashes[0]);
  assert.ok(P(ctx.route({ action: 'load', user: 'משפחת כהן', pin: '1234' }, rs)).ok, 'the family code no longer opens it');
  assert.ok((await text(fam('משפחת כהן'))).includes('880'));
  assert.ok(logged.some(l => l[2] === 'family' && l[3] === 'משפחת כהן' && l[4] === 'full'));

  // ---- unlock a family locked by wrong codes ----
  await page.click(fam('Levi'));
  assert.ok(await page.isVisible('#fam-locked'));
  await page.click('#fam-unlock');
  await page.waitForFunction(() => /הנעילה שוחררה/.test(document.getElementById('edit-msg').textContent));
  assert.ok(await page.isHidden('#fam-unlock'));
  assert.ok(P(ctx.route({ action: 'load', user: 'Levi', pin: '5555' }, rs)).ok, 'still locked');

  // ---- cancel it; the reply is dropped once, and the retry (already gone) still counts as done ----
  page.once('dialog', d => d.accept());
  dropNext = 1; delay = 1500;                          // slow too: the list drops it before the refresh comes back
  await page.click('#fam-cancel');
  await page.waitForFunction(() => /ההרשמה של Levi בוטלה/.test(document.getElementById('list-msg').textContent));
  assert.deepStrictEqual(regRows.map(r => r.user), ['משפחת כהן']);
  assert.deepStrictEqual(await rows(), ['משפחת כהן']);
  delay = 0;
  await page.waitForFunction(() => !document.getElementById('list-refresh').disabled);
  assert.deepStrictEqual(await rows(), ['משפחת כהן']);
  codeHashes.forEach(h => assert.ok(!sent.some(s => s.includes(h)), 'a code hash reached the page'));

  // ---- §4.6 entering the page refreshes every tab in the background, one after another ----
  await page.addInitScript(() => { window.ACHZIV_ADMIN_TIMEOUT = 1500; });
  calls.length = 0;
  await page.reload();
  await page.waitForFunction(() => !document.getElementById('adm-queue').hidden);
  await page.waitForFunction(() => true);
  const bg = ['adminList:tip', 'adminList:comment', 'adminList:gear', 'adminList:activity', 'adminList:tour', 'adminFamilies'];
  for (let i = 0; i < 50 && !bg.every(a => calls.includes(a)); i++) await page.waitForTimeout(100);
  assert.deepStrictEqual(calls.filter(a => bg.includes(a)), bg, 'the background refresh did not visit every tab, in order');

  // ---- add a gear item from the top of its list; a missing name keeps the form ----
  await page.click('#adm-nav [data-view="gear"]');
  assert.strictEqual(await text('#list-add'), '+ הוספת פריט ציוד');
  assert.ok(await page.isHidden('#e-status').catch(() => true));
  await page.click('#list-add');
  assert.ok(await page.isVisible('#adm-edit'));
  assert.ok(!(await page.$('#e-status')), 'a new row has no status choice');
  await page.selectOption('#f-section', 'ים וחוף');
  await page.click('#edit-save');
  await page.waitForFunction(() => /קצר/.test(document.getElementById('edit-msg').textContent));
  await page.fill('#f-name', 'שמשייה');
  await page.fill('#f-tags', 'נוחות');
  await noHScroll('gear add');
  hangNext = 1;                                        // the first try hangs: given up after the timeout and retried
  await page.click('#edit-save');
  await page.waitForFunction(() => /נוסף/.test(document.getElementById('list-msg').textContent), null, { timeout: 15000 });
  const added = gear.filter(g => g.name === 'שמשייה');
  assert.strictEqual(added.length, 1);
  assert.deepStrictEqual([added[0].status, added[0].section, added[0].tags], [ST.approved, 'ים וחוף', 'נוחות']);
  assert.ok((await rows()).includes('שמשייה'));
  assert.ok(P(ctx.gearPublic_(ts)).items.some(g => g.name === 'שמשייה'), 'not public');

  // ---- add a tip; the reply is dropped once and the retry adds nothing more ----
  await page.click('#edit-back').catch(() => {});
  await page.click('#adm-nav [data-view="tip"]');
  await page.click('#list-add');
  await page.selectOption('#f-category', 'ילדים');
  await page.fill('#f-title', 'בקבוק לכל ילד');
  await page.fill('#f-text', 'עם שם, כדי שלא יתבלבלו');
  dropNext = 1;
  await page.click('#edit-save');
  await page.waitForFunction(() => /נוסף/.test(document.getElementById('list-msg').textContent));
  assert.strictEqual(tips.filter(t => t.title === 'בקבוק לכל ילד').length, 1);
  assert.ok((await rows()).includes('בקבוק לכל ילד'));

  // ---- add a comment on an approved tip, and an activity ----
  await page.click('#adm-nav [data-view="comment"]');
  await page.waitForFunction(() => !document.getElementById('list-refresh').disabled);
  await page.click('#list-add');
  const newTip = tips.find(t => t.title === 'בקבוק לכל ילד');
  await page.selectOption('#f-tipId', String(newTip.id));
  await page.fill('#f-text', 'וגם מדבקה');
  await page.click('#edit-save');
  await page.waitForFunction(() => /נוסף/.test(document.getElementById('list-msg').textContent));
  assert.ok(comments.some(c => c.text === 'וגם מדבקה' && c.tipId === newTip.id && c.status === ST.approved));
  await page.click('#adm-nav [data-view="activity"]');
  await page.click('#list-add');
  await page.fill('#f-topic', 'שירה סביב המדורה');
  await page.selectOption('#f-start-day', '2026-10-08'); await page.selectOption('#f-start-h', '20');
  await page.selectOption('#f-end-day', '2026-10-08'); await page.selectOption('#f-end-h', '21');
  await noHScroll('activity add');
  delay = 1000;                                        // a slow server: the new row is listed before the refresh comes back
  await page.click('#edit-save');
  await page.waitForFunction(() => /נוסף/.test(document.getElementById('list-msg').textContent));
  assert.ok((await rows()).includes('שירה סביב המדורה'), 'the new row is not shown at once');
  delay = 0;
  const song = acts.find(a => a.topic === 'שירה סביב המדורה');
  assert.deepStrictEqual([song.owner, song.status, song.start, song.end], ['המארגנים', 'פעיל', '2026-10-08T20:00', '2026-10-08T21:00']);
  assert.ok((await rows()).includes('שירה סביב המדורה'));
  await page.waitForFunction(() => !document.getElementById('list-refresh').disabled);
  assert.ok((await rows()).includes('שירה סביב המדורה'), 'gone after the refresh');

  // ---- delete asks first: a cancelled confirm changes nothing; an accepted one removes it everywhere ----
  const delBtn = '#list-items .adm-del[aria-label="מחיקה: שירה סביב המדורה"]';
  page.once('dialog', d => { assert.ok(d.message().includes('שירה סביב המדורה')); d.dismiss(); });
  await page.click(delBtn);
  assert.strictEqual(song.status, 'פעיל');
  assert.ok((await rows()).includes('שירה סביב המדורה'));
  page.once('dialog', d => d.accept());
  await page.click(delBtn);
  await page.waitForFunction(() => /נמחק/.test(document.getElementById('list-msg').textContent));
  assert.deepStrictEqual([song.status, song.topic], ['הוסתר', '']);
  assert.ok(!(await rows()).includes('שירה סביב המדורה'));
  assert.ok(!P(ctx.activitiesPublic_(as)).activities.some(a => a.id === song.id));
  await page.click('#adm-nav [data-view="gear"]');
  page.once('dialog', d => d.accept());
  dropNext = 1;                                        // the delete's reply is lost: the retry finds it gone, still done
  await page.click('#list-items .adm-del[aria-label="מחיקה: שמשייה"]');
  await page.waitForFunction(() => /נמחק/.test(document.getElementById('list-msg').textContent));
  assert.ok(!(await rows()).includes('שמשייה'));
  assert.ok(!P(ctx.gearPublic_(ts)).items.some(g => g.id === added[0].id));
  await page.click('#adm-nav [data-view="tour"]');
  assert.ok(await page.isHidden('#list-add'));
  assert.strictEqual(await page.locator('#list-items .adm-del').count(), 0, 'tour bubbles cannot be deleted');

  // ---- logout leaves nothing behind ----
  await page.click('#adm-logout');
  assert.ok(await page.isVisible('#adm-login'));
  assert.deepStrictEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => /^achziv-admin/.test(k))), [], 'logout left data');
  await noHScroll('login');

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('admin e2e passed');
})().catch(e => { console.error(e); process.exit(1); });
