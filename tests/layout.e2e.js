// Run: node tests/layout.e2e.js — the page frame in headless Chrome at 360px: tab order, the tab row fixed on top,
// and the price list as a section of the calculator (opened by a button, closed by ✕ or the back button).
// The Google URL is aborted, so nothing reaches the live sheet.
const assert = require('assert'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'C:/YairSahar_Business/ParentingUpClose_Website/node_modules/playwright-core');
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('https://**', r => r.abort());
  const url = 'file:///' + path.resolve(__dirname, '../index.html').replace(/\\/g, '/');
  const noHScroll = async (where) => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal scroll: ' + where);
  const top = (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top, sel);

  await page.goto(url);
  assert.deepStrictEqual(await page.locator('[role=tab]').allInnerTexts(), ['מחשבון', 'על המקום', 'ציוד', 'פעילויות', 'טיפים']);
  assert.ok(await page.isVisible('#open-prices') && await page.isHidden('#calc-prices'));
  // the calculator's note shows under the calculator only
  assert.ok((await page.locator('.foot').innerText()).includes('המחיר הקובע'));
  assert.ok(await page.isVisible('.foot'));
  for (const t of ['#tab-place', '#tab-gear', '#tab-acts', '#tab-tips']) { await page.click(t); assert.ok(await page.isHidden('.foot'), 'the note shows on ' + t); }
  await page.click('#tab-calc');
  await page.mouse.move(180, 500);                                           // off the tab row, so the wheel scrolls the page

  // the tab row and the calculator's bar stay on top while scrolling
  await page.mouse.wheel(0, 1500); await page.waitForTimeout(200);
  assert.strictEqual(await top('.tabs'), 0, 'the tab row scrolled away');
  const barTop = await top('#calc-main .subbar'), tabsH = await page.evaluate(() => document.querySelector('.tabs').offsetHeight);
  assert.ok(Math.abs(barTop - tabsH) <= 1, 'the מחירון bar is not right under the tabs: ' + barTop + ' vs ' + tabsH);
  const scrolled = await page.evaluate(() => window.scrollY);

  // open: the price list replaces the calculator, from the top
  // (dispatched, not page.click: Playwright would scroll the button into view first, which a tap does not)
  await page.locator('#open-prices').dispatchEvent('click');
  assert.ok(await page.isVisible('#price-table') && await page.isHidden('#calc-main'));
  assert.ok(await page.locator('#price-table tbody tr').count() > 5);
  assert.strictEqual(await page.evaluate(() => window.scrollY), 0);
  assert.ok(await page.evaluate(() => document.activeElement.id === 'close-prices'));
  await noHScroll('prices');
  // ✕ closes it and returns to the same place in the calculator
  await page.mouse.wheel(0, 400); await page.waitForTimeout(200);
  assert.strictEqual(await top('#calc-prices .subbar'), tabsH, 'the ✕ bar is not fixed under the tabs');
  await page.click('#close-prices');
  await page.waitForFunction(() => !document.getElementById('calc-main').hidden);
  assert.ok(await page.isHidden('#calc-prices'));
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => window.scrollY);
  assert.ok(Math.abs(back - scrolled) < 5, 'the calculator did not return to its place: ' + back + ' vs ' + scrolled);

  // the phone's back button closes it too
  await page.click('#open-prices');
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById('calc-main').hidden);
  assert.ok(await page.isHidden('#calc-prices'));

  // an old link to the price tab opens the price list
  await page.goto('about:blank'); await page.goto(url + '#prices');
  assert.ok(await page.isVisible('#price-table'));
  await page.click('#close-prices');
  assert.ok(await page.isVisible('#calc-main'));

  await noHScroll('calc');
  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('all layout e2e tests passed');
})().catch(e => { console.error(e); process.exit(1); });
