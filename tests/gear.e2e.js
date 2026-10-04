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
const ALL = JSON.parse(JSON.stringify(ctx.gearSeedRows_())), SEED = ALL.filter(r => r[1] === 'מאושר');   // the visible rows

function store() {
  const tips = [], comments = [], gear = ALL.map(r => ({ id: r[0], status: r[1], section: r[2], name: r[3], tags: r[4],
    note: r[5], submitted: r[6], approved: r[7], clientId: r[8] }));
  return { tips: () => tips, comments: () => comments, gear: () => gear,
           addTip: (r) => tips.push(r), addComment: (r) => comments.push(r), addGear: (r) => gear.push(r),
           updateTip() {}, updateComment() {}, updateGear() {}, now: () => '30/09/2026 12:00' };
}
const regStore = { all: () => [], put() {}, remove() {}, hash: () => '', now: () => '', nowMs: () => 0 };
let ts = store(), gearOverride = null, oldBackend = false, dropNext = 0, delay = 0, calls = [];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 780 } });
  await page.addInitScript(() => { window.ACHZIV_NOTOUR = 1; });   // no guided tours or share modal here: tour.e2e.js covers them
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
    else if (gearOverride && body.action === 'gear') res = gearOverride;
    else res = JSON.parse(JSON.stringify(ctx.route(body, body.action === 'summary' ? regStore : null, ts)));
    if (dropNext > 0 && body.action === 'submitGear') { dropNext--; return route.fulfill({ status: 404, contentType: 'text/html', body: '<html>not found</html>' }); }
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(res) });
  });
  const url = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  const text = (sel) => page.locator(sel).innerText();
  const noHScroll = async (where) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal scroll: ' + where);
  const top = (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);
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
  const openSecs = () => page.locator('#gear-pick-list details[open]').count();
  assert.strictEqual(await openSecs(), 0, 'the general list should start collapsed');
  // a folded section must look like it opens (flex on <summary> hides the browser's arrow)
  assert.ok(await page.evaluate(() => { const c = getComputedStyle(document.querySelector('.gsec summary > span'), '::before');
    return c.content !== 'none' && parseFloat(c.borderLeftWidth) > 1 && c.transform !== 'none'; }), 'folded sections show no arrow');
  await page.click('#gear-expand');
  assert.strictEqual(await openSecs(), await page.locator('#gear-pick-list .gsec').count(), 'open all');
  assert.strictEqual(await text('#gear-expand'), 'סגירת כל הקטגוריות');
  assert.strictEqual(await page.locator('#gear-pick-list li:visible').count(), SEED.length);
  await page.click('#gear-expand');
  assert.strictEqual(await openSecs(), 0, 'close all');
  assert.strictEqual(await text('#gear-expand'), 'פתיחת כל הקטגוריות');
  await noHScroll('pick');

  // ---- search and tag filter ----
  await page.fill('#gear-q', 'פנס');
  assert.ok((await text('#gear-count')).startsWith('נמצאו 2 מתוך'), await text('#gear-count'));
  assert.strictEqual(await openSecs(), await page.locator('#gear-pick-list .gsec').count(), 'a search should open what it found');
  await page.fill('#gear-q', '');
  assert.strictEqual(await openSecs(), 0, 'clearing the search should fold back');
  await page.click('.chip[data-tag="תינוקות"]');
  assert.strictEqual(await page.locator('#gear-pick-list li').count(), SEED.filter(r => r[4].includes('תינוקות')).length);
  await page.click('.chip[data-tag="תינוקות"]');                // off again
  assert.strictEqual(await page.locator('#gear-pick-list li').count(), SEED.length);

  // ---- pick: two by hand, then every basic item ----
  await page.click('#gear-pick-list .gsec[data-sec="אוהלים ומחנה"] summary');
  await page.check('#gp-g1');                                     // אוהל
  await page.check('#gp-g10');                                    // יריעת קרקע (not basic)
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (2)');
  assert.ok((await text('#gear-pick-list .gsec:first-child .gcount')).startsWith('2/'));
  const basic = SEED.filter(r => r[4].split(',').includes('בסיסי')).length;
  await page.click('#gear-basic');
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (' + (basic + 1) + ')');
  assert.ok((await text('#gear-pick-msg')).includes('נוספו ' + (basic - 1)));
  assert.strictEqual(await openSecs(), 1, 'a redraw should keep the section opened by hand');
  await page.uncheck('#gp-g10');
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (' + basic + ')');

  // ---- the view toggle and the filters stay on top while scrolling ----
  for (const sec of ['ביגוד', 'מטבח ובישול', 'ים וחוף']) await page.click('#gear-pick-list .gsec[data-sec="' + sec + '"] summary');
  await page.mouse.wheel(0, 2500); await page.waitForTimeout(200);
  const tabsH = await page.evaluate(() => document.querySelector('.tabs').offsetHeight);
  assert.ok(await page.evaluate(() => window.scrollY) > 600, 'the list is too short to test scrolling');
  assert.ok(Math.abs(await top('#gear-bar') - tabsH) <= 1, 'the gear bar scrolled away');
  assert.ok(await page.isVisible('#gear-q') && await page.isVisible('.chip[data-tag="ילדים"]'));
  await noHScroll('gear bar');
  await page.fill('#gear-q', 'פנס');                             // from deep in the list: results come into view
  const [barB, listT] = await page.evaluate(() => [document.getElementById('gear-bar').getBoundingClientRect().bottom,
                                                   document.getElementById('gear-pick').getBoundingClientRect().top]);
  assert.ok(listT >= barB - 1 && listT < barB + 40, 'search results out of view: list top ' + listT + ', bar bottom ' + barB);
  await page.fill('#gear-q', '');

  // ---- pack: the item moves to the bottom of its section ----
  await page.click('#gear-view-mine');
  assert.ok(await page.isVisible('#gear-mine-list'));
  assert.ok(await page.isHidden('#gear-filters') && await page.isVisible('#gear-view-pick'), 'filters belong to the picking view only');
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
  assert.ok(wa.includes('אוהלים ומחנה:') && wa.includes('✓ אוהל') && wa.split('\n').includes('☐ שק שינה'), wa);

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

  // ---- clear every selection in the general list (confirm accepted) ----
  await page.click('#gear-view-pick');
  await page.click('#gear-clear');
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (0)');
  assert.strictEqual(await page.locator('#gear-pick-list input:checked').count(), 0);
  assert.ok((await text('#gear-pick-msg')).includes('נוקו'));

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
  assert.ok((await page.textContent('#gear-pick-list')).includes('מחכה בתור'), 'unsent own item lost on reload');
  // the new script arrives: the waiting item is sent on the next visit
  oldBackend = false;
  await page.reload();
  await page.click('#tab-gear');
  await page.waitForFunction(() => /הוצע למארגן/.test(document.getElementById('gear-pick-list').textContent), null, { timeout: 15000 });
  assert.strictEqual(ts.gear().filter(g => g.name === 'מחכה בתור').length, 1);
  // an own item can be removed from the list
  await page.click('#gear-pick-list .gsec[data-sec="שונות"] summary');
  await page.click('#gear-pick-list .gdrop');
  assert.ok(!(await page.textContent('#gear-pick-list')).includes('מחכה בתור'));

  // ---- §5.4: a list saved before 04/10 loads unchanged; an own item under a renamed section ----
  const LS = 'achziv-gear-v1';
  const saved = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), LS);
  await page.evaluate((k) => {
    localStorage.clear();
    localStorage.setItem(k, JSON.stringify({ picked: { 1: 1, 16: 1 }, packed: { g1: 1 }, custom: [{ cid: 'old1', id: null,
      section: 'אוהלים ולינה', name: 'פריט ישן', at: 1,
      body: { action: 'submitGear', clientId: 'old-client-1', section: 'אוהלים ולינה', name: 'פריט ישן', hp: '' } }] }));
  }, LS);
  await page.reload();
  await page.click('#tab-gear');
  assert.strictEqual(await text('#gear-view-mine'), 'הרשימה שלי (3)');
  await page.waitForFunction(() => /הוצע למארגן/.test(document.getElementById('gear-pick-list').textContent), null, { timeout: 15000 });
  assert.strictEqual(ts.gear().find(g => g.clientId === 'old-client-1').section, 'אוהלים ומחנה', 'an old section name reached the sheet');
  assert.ok((await page.textContent('#gear-pick-list .gsec[data-sec="אוהלים ומחנה"]')).includes('פריט ישן'));
  assert.strictEqual(await page.locator('#gear-pick-list .gsec[data-sec="אוהלים ולינה"]').count(), 0);

  // ---- a number on every picked item: typed, or − / + ----
  let st;
  await page.click('#gear-expand');                                // open everything
  assert.strictEqual(await page.locator('li[data-key="g27"] .gstep').count(), 0, 'an unpicked item has no counter');
  await page.check('#gp-g27');                                     // סיר
  const num = (key, pid) => page.locator('li[data-key="' + key + '"] .gstep[data-pid="' + (pid || '') + '"] .gnum');
  const val = (key, pid) => num(key, pid).inputValue();
  const plus = (key, pid) => page.click('li[data-key="' + key + '"] .gstep[data-pid="' + (pid || '') + '"] .gplus');
  const minus = (key, pid) => page.click('li[data-key="' + key + '"] .gstep[data-pid="' + (pid || '') + '"] .gminus');
  const type = async (key, pid, n) => { await num(key, pid).fill(String(n)); await num(key, pid).press('Enter'); await num(key, pid).blur(); };
  assert.strictEqual(await val('g27'), '1');
  await plus('g27'); await plus('g27');
  assert.strictEqual(await val('g27'), '3');
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('gplus')), 'focus lost after +');
  await minus('g27'); await minus('g27'); await minus('g27');      // never below 1: untick to remove
  assert.strictEqual(await val('g27'), '1');
  await type('g27', '', 2);
  assert.strictEqual(await val('g27'), '2');
  assert.strictEqual(await page.locator('li[data-key="g27"] .geach').count(), 0, 'no names yet: no לכל אחד');

  // ---- family members ----
  await page.click('#gear-person-form button[type=submit]');
  assert.ok((await text('#gear-people-msg')).includes('כתבו שם'));
  for (const n of ['נועה', 'יואב']) { await page.fill('#gear-person-name', n); await page.press('#gear-person-name', 'Enter'); }
  await page.fill('#gear-person-name', 'נועה'); await page.press('#gear-person-name', 'Enter');
  assert.ok((await text('#gear-people-msg')).includes('כבר ברשימה'));
  assert.strictEqual(await page.locator('#gear-people-list li').count(), 2);
  // name box 70%, button 20% (Yair, 04/10: the button was full width and hid the typed name)
  { const [f, i, b] = await page.evaluate(() => ['#gear-person-form', '#gear-person-name', '#gear-person-form button'].map(s => document.querySelector(s).getBoundingClientRect().width));
    assert.ok(Math.abs(i / f - 0.7) < 0.02 && Math.abs(b / f - 0.2) < 0.02, 'person form widths: ' + [f, i, b]); }
  const [noa, yoav] = (await saved()).people.map(p => p.pid);

  // ---- §5.5: any item, type a number and press לכל אחד (Yair's תחתונים example, on an untagged item here) ----
  assert.strictEqual(await page.locator('li[data-key="g27"] .geach').count(), 1, 'every item can go per member');
  await page.check('#gp-g10');                                     // יריעת קרקע: no לכל אחד tag
  await type('g10', '', 4);
  await page.click('li[data-key="g10"] .geach');
  assert.ok((await text('#gear-pick-msg')).includes('4 לכל אחד'));
  assert.deepStrictEqual([await val('g10', noa), await val('g10', yoav)], ['4', '4']);
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains('gone')), 'focus lost after לכל אחד');
  // fine-tune one member with − / +
  await plus('g10', yoav); await minus('g10', noa); await minus('g10', noa);
  assert.deepStrictEqual([await val('g10', noa), await val('g10', yoav)], ['2', '5']);
  await noHScroll('per-member counters');
  // the top number still applies to everyone
  await type('g10', '', 3);
  assert.deepStrictEqual([await val('g10', noa), await val('g10', yoav)], ['3', '3']);
  await plus('g10', yoav);                                         // 3 + 4
  // משותף: back to one number, the members' total
  await page.click('li[data-key="g10"] .gone');
  assert.strictEqual(await val('g10'), '7');
  assert.strictEqual(await page.locator('li[data-key="g10"] .gmembers').count(), 0);
  // a לכל אחד-tagged item starts per member (חולצה, ticked before 04/10), 1 each
  assert.deepStrictEqual([await val('g16', noa), await val('g16', yoav)], ['1', '1']);
  await type('g16', '', 4);
  assert.deepStrictEqual([await val('g16', noa), await val('g16', yoav)], ['4', '4']);
  await type('g16', noa, 0);                                       // a member who does not need it
  // a redraw keeps all of it
  await page.reload(); await page.click('#tab-gear'); await page.click('#gear-expand');
  assert.deepStrictEqual([await val('g16', noa), await val('g16', yoav), await val('g10')], ['0', '4', '7']);

  // ---- packing: one row per item, a box per member; a member's own list ----
  await page.click('#gear-view-mine');
  const row = (key) => page.locator('#gear-mine-list li[data-key="' + key + '"]');
  assert.ok((await row('g16').innerText()).includes('יואב ×4') && !(await row('g16').innerText()).includes('נועה'), 'a 0 count is not packed: ' + JSON.stringify(await row('g16').innerText()));
  assert.ok((await row('g10').innerText()).includes('יריעת קרקע מתחת לאוהל ×7'));
  assert.strictEqual(await row('g1').locator('label').first().innerText(), 'אוהל', 'a single item shows no count');
  assert.ok(await page.isChecked('[id="gm-g1"]'), 'a packed mark from before 04/10 was lost');
  // a member's box packs their share; the row is done when every member's is (שק שינה, לכל אחד)
  await page.click('#gear-view-pick');
  await page.check('#gp-g4');
  await page.click('#gear-view-mine');
  await page.check('input[data-pk="g4@' + noa + '"]');
  assert.ok(!(await page.isChecked('[id="gm-g4"]')), 'one member packed is not the whole row');
  await page.check('input[data-pk="g4@' + yoav + '"]');
  assert.ok(await page.isChecked('[id="gm-g4"]'), 'every member packed: the row is packed');
  assert.ok(await row('g4').evaluate(l => l.classList.contains('packed')));
  // the row's box packs everyone at once
  await page.check('[id="gm-g16"]');
  assert.ok(await page.isChecked('input[data-pk="g16@' + yoav + '"]'));
  await page.uncheck('[id="gm-g16"]');
  assert.ok(!(await page.isChecked('input[data-pk="g16@' + yoav + '"]')));
  await noHScroll('mine per member');
  // member boxes wrap inside the card (a label once shrank under its text and spilled out of it)
  // (the rows here are not crowded enough to show it, so check what prevents it: a member label never shrinks)
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('#gear-mine-list .gmembers')].every(m => m.scrollWidth <= m.clientWidth + 1)), 'member boxes overflow');
  assert.ok(await page.evaluate(() => [...document.querySelectorAll('#gear-mine-list .gmem')].every(l => getComputedStyle(l).flexShrink === '0')), 'a member label can shrink under its text');
  // a member's own list: their share of each per-member item, ticked for them
  await page.click('#gear-who [data-who="' + noa + '"]');
  let keys2 = await mineKeys();
  assert.ok(keys2.length > 0 && keys2.every(k => k.endsWith('@' + noa)) && !keys2.includes('g16@' + noa), 'נועה: ' + keys2);
  assert.ok(await page.isChecked('[id="gm-g4@' + noa + '"]'), 'packed for נועה in the all view, not in hers');
  await page.click('#gear-wa');
  let wa2 = decodeURIComponent(await page.getAttribute('#gear-wa', 'href'));
  assert.ok(wa2.split('\n')[0].endsWith('— נועה') && wa2.includes('✓ שק שינה') && !wa2.includes('סיר'), wa2);
  await page.click('#gear-who [data-who="_"]');
  keys2 = await mineKeys();
  assert.ok(keys2.includes('g27') && keys2.includes('g10') && !keys2.includes('g4') && !keys2.some(k => k.includes('@')), 'משותף: ' + keys2);
  await page.click('#gear-who [data-who=""]');
  await page.click('#gear-wa');
  wa2 = decodeURIComponent(await page.getAttribute('#gear-wa', 'href'));
  assert.ok(wa2.includes('✓ שק שינה — ✓נועה, ✓יואב') && wa2.includes('☐ חולצה — יואב ×4'), wa2);
  // removing a person takes their counts and packing marks
  await page.click('#gear-view-pick');
  await page.click('#gear-people-list .gpdel[data-pid="' + yoav + '"]');
  st = await saved();
  assert.ok(!Object.keys(st.packed).some(k => k.endsWith('@' + yoav)) && st.people.length === 1);
  // unticking an item clears its numbers and its mode
  await page.uncheck('#gp-g10');
  st = await saved();
  assert.deepStrictEqual([st.qty.g10, st.mode.g10], [undefined, undefined]);

  // ---- §5.5: a tick on a split item carries to its parts, once; a hidden item's tick moves ----
  await page.evaluate((k) => localStorage.setItem(k, JSON.stringify({ picked: { 29: 1, 63: 1 } })), LS);
  await page.reload(); await page.click('#tab-gear');
  st = await saved();
  assert.deepStrictEqual(Object.keys(st.picked).map(Number).sort((a, b) => a - b), [29, 63, 82, 1031, 1032]);
  assert.strictEqual(st.carried, 1);
  await page.click('#gear-view-pick'); await page.click('#gear-expand'); await page.uncheck('#gp-g1031');
  await page.reload(); await page.click('#tab-gear');
  assert.ok(!(await saved()).picked[1031], 'the carry ran twice');
  assert.strictEqual(await page.locator('#gp-g63').count(), 0, 'a hidden item is listed');

  // the live script before the 04/10 version: the add form offers only the sections it accepts
  gearOverride = { ok: true, sections: ['אוהלים ולינה', 'ביגוד', 'שונות', 'נכתב ביד'], items: [{ id: 1, section: 'אוהלים ולינה', name: 'אוהל', tags: [], note: '' }] };
  await page.evaluate(() => localStorage.removeItem('achziv-gear-cache'));
  await page.reload(); await page.click('#tab-gear');
  await page.waitForFunction(() => document.getElementById('gear-count').textContent.startsWith('1 '), null, { timeout: 5000 }).catch(() => {});
  const opts = await page.locator('#gear-new-sec option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
  assert.deepStrictEqual(opts, ['אוהלים ולינה', 'ביגוד', 'שונות'], 'form sections: ' + opts);
  gearOverride = null;

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('all gear e2e tests passed');
})().catch(e => { console.error(e); process.exit(1); });
