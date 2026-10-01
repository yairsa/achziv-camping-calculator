// Run: node tests/backend.test.js — exercises backend/Code.gs route() against an in-memory sheet.
const assert = require('assert'), fs = require('fs'), vm = require('vm'), crypto = require('crypto');
const ctx = {}; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../backend/Code.gs', 'utf8'), ctx);

let clock = 1e12;
function memStore() {
  const rows = [];
  return {
    rows,
    all: () => rows,
    put: (r) => { if (!rows.includes(r)) rows.push(r); },
    remove: (r) => rows.splice(rows.indexOf(r), 1),
    hash: (u, p) => crypto.createHash('sha256').update('salt|' + u + '|' + p).digest('hex'),
    now: () => '30/09/2026 12:00',
    nowMs: () => clock
  };
}
const s = memStore(), R = (req) => JSON.parse(JSON.stringify(ctx.route(req, s)));
const fam = (user, pin, nights, extra) => Object.assign({ action: 'save', user, pin, nights,
  maxPeople: Math.max(0, ...Object.values(nights)), full: 100, group: 90, data: { base: { adult: 2 } } }, extra);

let r = R(fam('משפחת כהן', '1234', { '2026-10-06': 4, '2026-10-07': 4 }));
assert.ok(r.ok && r.created); assert.deepStrictEqual(r.summary.nights, { '2026-10-06': 4, '2026-10-07': 4 });
r = R(fam('Levi', '5555', { '2026-10-07': 3 }));
assert.strictEqual(r.summary.families, 2); assert.strictEqual(r.summary.nights['2026-10-07'], 7);
assert.deepStrictEqual(r.summary.names, ['Levi', 'משפחת כהן']);

// update with right pin; username match ignores case/extra spaces; still one row
r = R(fam('  LEVI ', '5555', { '2026-10-07': 5 }));
assert.ok(r.ok && !r.created); assert.strictEqual(r.summary.nights['2026-10-07'], 9); assert.strictEqual(s.rows.length, 2);

// wrong pin cannot overwrite; locks after 5 tries, for 15 minutes only
r = R(fam('Levi', '0000', { '2026-10-07': 50 }));
assert.strictEqual(r.error, 'wrong_pin'); assert.strictEqual(R({ action: 'summary' }).nights['2026-10-07'], 9);
for (let i = 0; i < 3; i++) R({ action: 'load', user: 'levi', pin: '0000' });
assert.strictEqual(R({ action: 'load', user: 'levi', pin: '0000' }).error, 'locked');
assert.strictEqual(R({ action: 'load', user: 'levi', pin: '5555' }).error, 'locked');   // locked even with the right pin
clock += 14 * 60 * 1000;
assert.strictEqual(R({ action: 'load', user: 'levi', pin: '5555' }).error, 'locked');
clock += 2 * 60 * 1000;
assert.ok(R({ action: 'load', user: 'levi', pin: '5555' }).ok);                          // lock expired

// load returns the saved state without internals; the pin is never stored in clear
r = R({ action: 'load', user: 'משפחת כהן', pin: '1234' });
assert.ok(r.ok); assert.deepStrictEqual(r.data, { base: { adult: 2 } }); assert.strictEqual(r.family, 'משפחת כהן');
assert.ok(!JSON.stringify(s.rows).includes('"1234"'));

// validation + formula injection
assert.strictEqual(R(fam('x', '1234', {})).error, 'bad_user');
assert.strictEqual(R(fam('abc', '12', {})).error, 'bad_pin');
R(fam('=HYPERLINK("x")', '9999', { '2026-10-06': 1, 'junk': 5 }));
const inj = s.rows.find(x => x.user.startsWith('='));
assert.ok(inj.family.startsWith("'=")); assert.strictEqual(JSON.stringify(Object.keys(inj.nights)), '["2026-10-06"]');
assert.ok(R({ action: 'summary' }).names.includes('=HYPERLINK("x")'));                 // shown without the guard quote

// delete
assert.ok(R({ action: 'delete', user: 'משפחת כהן', pin: '1234' }).ok);
assert.strictEqual(R({ action: 'load', user: 'משפחת כהן', pin: '1234' }).error, 'not_found');
assert.strictEqual(R({ action: 'nope' }).error, 'bad_request');

// the pasted file must stay pure ASCII
assert.ok(![...fs.readFileSync(__dirname + '/../backend/Code.gs')].some(b => b > 127), 'Code.gs has non-ASCII bytes');
console.log('all backend tests passed');

// ---------- organizers' sheet: pure merge ----------
{
  const st = memStore(), RR = (req) => ctx.route(req, st);
  RR({ action: 'save', user: 'משפחת כהן', pin: '1234', nights: { '2026-10-06': 3, '2026-10-07': 3 }, maxPeople: 3, full: 420, group: 358,
       data: { base: { adult: 2, child: 1, toddler: 0 }, periods: [{ from: '2026-10-06', to: '2026-10-08', custom: false, counts: {} }] } });
  RR({ action: 'save', user: 'Levi', pin: '5555', nights: { '2026-10-06': 4 }, maxPeople: 4, full: 250, group: 250,
       data: { base: { adult: 1, senior: 2, toddler: 1 },
               periods: [{ from: '2026-10-06', to: '2026-10-07', custom: true, counts: { adult: 1, senior: 2, toddler: 1 } }] } });
  const plain = (x) => JSON.parse(JSON.stringify(x));
  // first sync: empty organizers' sheet
  let t = plain(ctx.organizerTable_(st.rows, []));
  assert.strictEqual(t.computed.length, 2);
  const cohen = t.computed.find(r => r[0] === 'משפחת כהן');
  assert.deepStrictEqual(cohen.slice(1, 2), ['רשום']);
  assert.strictEqual(cohen[3], '06/10 עד 08/10');
  assert.deepStrictEqual(cohen.slice(5, 8), [2, 1, 0]);           // adults, children, toddlers
  assert.deepStrictEqual(cohen.slice(9, 11), [420, 358]);
  const levi = t.computed.find(r => r[0] === 'Levi');
  assert.deepStrictEqual(levi.slice(5, 8), [3, 0, 1]);            // seniors count as adults
  assert.ok(levi[8].includes('×2') && levi[3].includes('משתנה'));
  assert.deepStrictEqual(t.nights[0], ['ג׳ 06/10', 7, 2, 'חסרים 23']);
  assert.ok(!JSON.stringify(t).includes(st.rows[0].pinHash));    // no codes leak into the organizers' copy

  // organizers typed a payment for Levi; Cohen cancels; a new family registers
  const existing = t.computed.map(r => r.concat(r[0] === 'Levi' ? [250, 'שולם במזומן'] : ['', '']));
  RR({ action: 'delete', user: 'משפחת כהן', pin: '1234' });
  RR({ action: 'save', user: 'חדשים', pin: '1111', nights: { '2026-10-09': 30 }, maxPeople: 30, full: 1, group: 1, data: { base: { adult: 30 } } });
  t = plain(ctx.organizerTable_(st.rows, existing));
  assert.strictEqual(t.computed.length, 3);                                     // cancelled row kept
  assert.strictEqual(t.computed.find(r => r[0] === 'משפחת כהן')[1], 'בוטל');
  assert.strictEqual(t.computed.findIndex(r => r[0] === 'Levi'), existing.findIndex(r => r[0] === 'Levi'));  // same row position
  assert.ok(t.computed.every(r => r.length === 11));                            // never touches the payment columns
  assert.strictEqual(t.computed[2][0], 'חדשים');                                // appended at the end
  assert.deepStrictEqual(t.nights.find(n => n[0].endsWith('09/10')).slice(1), [30, 1, 'כן']);
}
console.log('organizer tests passed');

const P = (x) => JSON.parse(JSON.stringify(x));

// ---------- search (search.js, inlined into Code.gs) ----------
{
  assert.strictEqual(ctx.searchNorm_('אֹהֶל, מִטְבָּח!'), 'אהל מטבח');             // niqqud and punctuation gone
  assert.strictEqual(ctx.searchNorm_('חוף ים'), 'חופ ימ');                          // final letters -> regular
  assert.deepStrictEqual(P(ctx.searchWords_('של האוהל על החוף ו')), ['האוהל', 'החופ']); // stop words, 1-letter words
  assert.deepStrictEqual(P(ctx.searchForms_('והאוהלים')), ['והאוהלים', 'האוהלים', 'אוהלים']);  // up to two prefixes
  assert.deepStrictEqual(P(ctx.searchForms_('מימ')), ['מימ']);                       // never below 3 letters
  const tips = [
    { id: 1, title: 'יתדות לאוהל', text: 'בחול צריך יתדות ארוכות', category: 'אוהלים ולינה' },
    { id: 2, title: 'מים קרים', text: 'צידנית עם קרח לילדים', category: 'אוכל ובישול' },
    { id: 3, title: 'פנס ראש', text: 'עדיף על פנס יד בלילה', category: 'חשמל ותאורה' }
  ];
  const ids = (a) => a.map(t => t.id);
  assert.deepStrictEqual(ids(ctx.searchTips_('אוהל', tips)), [1]);                  // "לאוהל" found by "אוהל"
  assert.deepStrictEqual(ids(ctx.searchTips_('והאוהל', tips)), [1]);                // prefixes on the query side too
  assert.deepStrictEqual(ids(ctx.searchTips_('צידני', tips)), [2]);                 // typing: start of a word
  assert.deepStrictEqual(ids(ctx.searchTips_('פנס מים', tips)), []);                // every word must match
  assert.deepStrictEqual(ids(ctx.searchTips_('תאורה', tips)), [3]);                 // category counts
  assert.deepStrictEqual(ids(ctx.searchTips_('  ', tips)), [1, 2, 3]);              // empty query = all
  assert.deepStrictEqual(ids(ctx.searchTips_('יריעה', tips)), []);                  // word-based, not meaning-based
  const sim = P(ctx.similarTips_('יתדות לחול', 'אוהל עם יתדות', tips, 3));
  assert.strictEqual(sim.length, 1); assert.strictEqual(sim[0].tip.id, 1);
  assert.deepStrictEqual(P(ctx.similarTips_('', '', tips, 3)), []);
}
console.log('search tests passed');

// ---------- tips ----------
{
  function tipStore() {
    const tips = [], comments = [];
    return {
      tipsRows: tips, commentRows: comments,
      tips: () => tips, comments: () => comments,
      addTip: (r) => tips.push(r), addComment: (r) => comments.push(r),
      updateTip: () => {}, updateComment: () => {},
      now: () => '30/09/2026 12:00'
    };
  }
  const ts = tipStore(), T = (req) => P(ctx.route(req, null, ts));
  let n = 0;
  const tip = (extra) => Object.assign({ action: 'submitTip', clientId: 'autoclient' + (++n),
    category: 'ציוד', title: 'פנס ראש', text: 'עדיף על פנס יד בלילה', author: 'דנה' }, extra);

  // submit -> pending, not public
  let r = T(tip({ clientId: 'client-0001' }));
  assert.ok(r.ok); assert.strictEqual(r.id, 1);
  assert.strictEqual(ts.tipsRows[0].status, 'ממתין');
  assert.deepStrictEqual(T({ action: 'tips' }).tips, []);
  assert.ok(T({ action: 'tips' }).categories.includes('סלולרי ומחשבים'));

  // a retry with the same client id does not duplicate
  r = T(tip({ clientId: 'client-0001', title: 'something else' }));
  assert.deepStrictEqual([r.ok, r.id, ts.tipsRows.length], [true, 1, 1]);

  // validation
  assert.strictEqual(T(tip({ category: 'לא קיים' })).error, 'bad_category');
  assert.strictEqual(T(tip({ title: 'א' })).error, 'too_short');
  assert.strictEqual(T(tip({ title: 'א'.repeat(61) })).error, 'too_long');
  assert.strictEqual(T(tip({ text: 'א'.repeat(401) })).error, 'too_long');
  assert.strictEqual(T(tip({ author: 'א'.repeat(41) })).error, 'too_long');
  assert.strictEqual(T(tip({ clientId: 'short' })).error, 'bad_request');
  assert.strictEqual(T(tip({ clientId: 'bad id with spaces' })).error, 'bad_request');
  assert.strictEqual(ts.tipsRows.length, 1);

  // bot trap: looks fine, writes nothing
  r = T(tip({ hp: 'http://spam' }));
  assert.ok(r.ok); assert.strictEqual(ts.tipsRows.length, 1);

  // formula guard, whitespace tidy
  T(tip({ clientId: 'client-0002', title: '=HYPERLINK("x")', text: 'שורה   אחת\n\n\n\nשורה שתיים ' }));
  assert.strictEqual(ts.tipsRows[1].title, "'=HYPERLINK(\"x\")");
  assert.strictEqual(ts.tipsRows[1].text, 'שורה אחת\n\nשורה שתיים');

  // "דומה ל…" filled from the closest existing tip
  T(tip({ clientId: 'client-0003', title: 'פנס לילה', text: 'פנס ראש עדיף' }));
  assert.strictEqual(ts.tipsRows[2].similar, '1: פנס ראש');
  T(tip({ clientId: 'client-0004', category: 'ים וחוף', title: 'שמשייה', text: 'יש רוח חזקה בחוף' }));
  assert.strictEqual(ts.tipsRows[3].similar, '');

  // approve in the sheet -> public, stamped; the guard quote is not shown
  ts.tipsRows[0].status = 'מאושר'; ts.tipsRows[1].status = 'מאושר';
  let hk = ctx.housekeep_(ts);
  assert.strictEqual(hk.stamped, 2); assert.strictEqual(ts.tipsRows[0].approved, '30/09/2026 12:00');
  assert.strictEqual(ctx.housekeep_(ts).stamped, 0);                                // already stamped
  let pub = T({ action: 'tips' });
  assert.deepStrictEqual(pub.tips.map(t => t.id), [2, 1]);                          // newest first
  assert.strictEqual(pub.tips[0].title, '=HYPERLINK("x")');
  assert.deepStrictEqual(Object.keys(pub.tips[1]).sort(), ['author', 'category', 'comments', 'id', 'text', 'title']);
  assert.ok(!JSON.stringify(pub).includes('client-'));                              // client ids never leave

  // comments: only on approved tips; pending until approved
  assert.strictEqual(T({ action: 'submitComment', clientId: 'cmt-00001', tipId: 3, text: 'מסכים' }).error, 'not_found');
  assert.strictEqual(T({ action: 'submitComment', clientId: 'cmt-00001', tipId: 99, text: 'מסכים' }).error, 'not_found');
  r = T({ action: 'submitComment', clientId: 'cmt-00001', tipId: 1, text: 'מסכים, גם עם סוללה רזרבית', author: '' });
  assert.deepStrictEqual([r.ok, r.id], [true, 1]);
  assert.strictEqual(T({ action: 'submitComment', clientId: 'cmt-00001', tipId: 1, text: 'שוב' }).id, 1);   // retry
  assert.strictEqual(ts.commentRows.length, 1);
  assert.strictEqual(T({ action: 'submitComment', clientId: 'cmt-00002', tipId: 1, text: 'א'.repeat(301) }).error, 'too_long');
  assert.deepStrictEqual(T({ action: 'tips' }).tips[1].comments, []);
  ts.commentRows[0].status = 'מאושר'; ctx.housekeep_(ts);
  assert.deepStrictEqual(T({ action: 'tips' }).tips[1].comments, [{ id: 1, text: 'מסכים, גם עם סוללה רזרבית', author: '' }]);

  // merge: tip 3 -> comment on tip 1, once
  ts.tipsRows[2].status = 'מוזג'; ts.tipsRows[2].mergedInto = 'טיפ 1';
  hk = ctx.housekeep_(ts);
  assert.strictEqual(hk.merged, 1); assert.strictEqual(ctx.housekeep_(ts).merged, 0);
  pub = T({ action: 'tips' });
  assert.deepStrictEqual(pub.tips.map(t => t.id), [2, 1]);                          // merged tip not listed
  assert.deepStrictEqual(pub.tips[1].comments.map(c => c.text), ['מסכים, גם עם סוללה רזרבית', 'פנס לילה: פנס ראש עדיף']);
  assert.strictEqual(pub.tips[1].comments[1].author, 'דנה');
  // merge into a tip that is not approved, or into itself, waits
  ts.tipsRows[3].status = 'מוזג'; ts.tipsRows[3].mergedInto = 3;
  assert.strictEqual(ctx.housekeep_(ts).merged, 0);
  ts.tipsRows[3].mergedInto = 4;
  assert.strictEqual(ctx.housekeep_(ts).merged, 0);

  // hidden leaves the site
  ts.tipsRows[1].status = 'הוסתר';
  assert.deepStrictEqual(T({ action: 'tips' }).tips.map(t => t.id), [1]);

  // digest: only when something new arrived; lists everything waiting
  assert.strictEqual(ctx.pendingDigest_(ts, {}, 'https://sheet'), null);            // nothing pending now
  T(tip({ clientId: 'client-0005', title: 'מטען נייד', text: 'אין חשמל בחניון', category: 'סלולרי ומחשבים' }));
  T({ action: 'submitComment', clientId: 'cmt-00003', tipId: 1, text: 'תודה!' });
  const d1 = P(ctx.pendingDigest_(ts, {}, 'https://sheet'));
  assert.strictEqual(d1.subject, 'אכזיב: 2 ממתינים לאישור');
  assert.ok(d1.body.includes('5. [סלולרי ומחשבים] מטען נייד'), d1.body);
  assert.ok(d1.body.includes('על טיפ 1 (פנס ראש): תודה!') && d1.body.includes('https://sheet'), d1.body);
  assert.deepStrictEqual(d1.seen, { tip: 5, comment: 3, gear: 0 });
  assert.strictEqual(ctx.pendingDigest_(ts, d1.seen, ''), null);                    // same items: no second email
  T({ action: 'submitComment', clientId: 'cmt-00004', tipId: 1, text: 'עוד אחת' });
  assert.strictEqual(ctx.pendingDigest_(ts, d1.seen, '').subject, 'אכזיב: 3 ממתינים לאישור');  // new: lists all 3

  // pending cap
  const full = tipStore();
  for (let i = 1; i <= 200; i++) full.tipsRows.push({ id: i, status: 'ממתין', clientId: 'x' + i });
  assert.strictEqual(ctx.route(tip({ clientId: 'client-cap01' }), null, full).error, 'busy');
  full.tipsRows[0].status = 'מאושר';                                               // 199 tips + 1 comment waiting
  full.commentRows.push({ id: 1, tipId: 1, status: 'ממתין', clientId: 'y1' });
  assert.strictEqual(ctx.route({ action: 'submitComment', clientId: 'cmt-cap01', tipId: 1, text: 'היי' }, null, full).error, 'busy');
  full.tipsRows[1].status = 'נדחה';
  assert.ok(ctx.route(tip({ clientId: 'client-cap02' }), null, full).ok);
}
console.log('tips tests passed');

// ---------- equipment list ----------
{
  function gearStore(withSeed) {
    const tips = [], comments = [], gear = withSeed ? P(ctx.gearSeedRows_()).map(r => ({
      id: r[0], status: r[1], section: r[2], name: r[3], tags: r[4], note: r[5], submitted: r[6], approved: r[7], clientId: r[8] })) : [];
    return {
      gearRows: gear, tipsRows: tips,
      tips: () => tips, comments: () => comments, gear: () => gear,
      addTip: (r) => tips.push(r), addComment: (r) => comments.push(r), addGear: (r) => gear.push(r),
      updateTip: () => {}, updateComment: () => {}, updateGear: () => {},
      now: () => '30/09/2026 12:00'
    };
  }
  // seed: item N is row id N, all approved, none re-stamped
  const seed = P(ctx.gearSeedRows_());
  assert.strictEqual(seed.length, ctx.GEAR_SEED_.length);
  assert.ok(seed.every((r, i) => r[0] === i + 1 && r.length === ctx.GEAR_HEAD.length));
  assert.ok(seed.every(r => ctx.GEAR_SECTIONS_.includes(r[2])), 'every seed item has a known section');
  // append-only: the site went live with ids 1-101, and visitors' ticks are stored by id
  assert.deepStrictEqual([seed[0][3], seed[100][3]], ['אוהל', 'ספר'], 'starter items were inserted or removed, not appended');
  assert.strictEqual(new Set(seed.map(r => r[3])).size, seed.length, 'duplicate item names');
  const gs = gearStore(true), G = (req) => P(ctx.route(req, null, gs));
  assert.strictEqual(ctx.housekeep_(gs).stamped, 0);

  // public list: sections, items with tags split, no internals
  let pub = G({ action: 'gear' });
  assert.ok(pub.ok); assert.deepStrictEqual(pub.sections, P(ctx.GEAR_SECTIONS_));
  assert.strictEqual(pub.items.length, seed.length);
  assert.deepStrictEqual(pub.items[0], { id: 1, section: 'אוהלים ולינה', name: 'אוהל', tags: ['בסיסי'], note: '' });
  assert.deepStrictEqual(pub.items.find(i => i.name === 'משחקי קופסה וקלפים').tags, ['ילדים', 'נוחות']);
  assert.ok(!JSON.stringify(pub).includes('seed-'));

  // suggestion: pending, not public; retry does not duplicate
  const sug = (extra) => Object.assign({ action: 'submitGear', clientId: 'gear-client-1', section: 'ים וחוף', name: 'כיסא חוף' }, extra);
  let r = G(sug());
  assert.deepStrictEqual([r.ok, r.id], [true, seed.length + 1]);
  assert.strictEqual(gs.gearRows.at(-1).status, 'ממתין');
  assert.strictEqual(G(sug({ name: 'שונה' })).id, seed.length + 1);
  assert.strictEqual(gs.gearRows.length, seed.length + 1);
  assert.strictEqual(G({ action: 'gear' }).items.length, seed.length);
  // validation, bot trap, formula guard
  assert.strictEqual(G(sug({ clientId: 'gear-client-2', section: 'לא קיים' })).error, 'bad_category');
  assert.strictEqual(G(sug({ clientId: 'gear-client-2', name: 'א' })).error, 'too_short');
  assert.strictEqual(G(sug({ clientId: 'gear-client-2', name: 'א'.repeat(61) })).error, 'too_long');
  assert.strictEqual(G(sug({ clientId: 'x' })).error, 'bad_request');
  assert.ok(G(sug({ clientId: 'gear-client-3', hp: 'x' })).ok); assert.strictEqual(gs.gearRows.length, seed.length + 1);
  G(sug({ clientId: 'gear-client-4', name: '=cmd()' }));
  assert.strictEqual(gs.gearRows.at(-1).name, "'=cmd()");

  // digest lists suggested items; seen.gear stops a repeat email
  const d = P(ctx.pendingDigest_(gs, {}, 'https://sheet'));
  assert.strictEqual(d.subject, 'אכזיב: 2 ממתינים לאישור');
  assert.ok(d.body.includes('פריטי ציוד שהוצעו (2):') && d.body.includes((seed.length + 1) + '. [ים וחוף] כיסא חוף'), d.body);
  assert.ok(d.body.includes('=cmd()') && !d.body.includes("'=cmd"));
  assert.strictEqual(d.seen.gear, seed.length + 2);
  assert.strictEqual(ctx.pendingDigest_(gs, d.seen, ''), null);

  // approve -> public for everyone, stamped; hidden -> off the list; Yair may move it to another section
  const row = gs.gearRows.find(g => g.clientId === 'gear-client-1');
  row.status = 'מאושר'; row.section = 'ציוד כללי';
  assert.strictEqual(ctx.housekeep_(gs).stamped, 1);
  pub = G({ action: 'gear' });
  assert.deepStrictEqual(pub.items.at(-1), { id: seed.length + 1, section: 'ציוד כללי', name: 'כיסא חוף', tags: [], note: '' });
  gs.gearRows[0].status = 'הוסתר';
  assert.ok(!G({ action: 'gear' }).items.some(i => i.id === 1));
  // a section typed by hand in the sheet still shows, after the known ones
  gs.gearRows[1].section = 'חדש';
  assert.deepStrictEqual(G({ action: 'gear' }).sections.slice(-1), ['חדש']);

  // the pending cap is shared with the tips
  const full = gearStore(false);
  for (let i = 1; i <= 200; i++) full.tipsRows.push({ id: i, status: 'ממתין', clientId: 'x' + i });
  assert.strictEqual(ctx.route(sug({ clientId: 'gear-cap-01' }), null, full).error, 'busy');
  full.tipsRows[0].status = 'נדחה';
  assert.ok(ctx.route(sug({ clientId: 'gear-cap-02' }), null, full).ok);
  assert.strictEqual(ctx.route({ action: 'submitTip', clientId: 'tip-cap-003', category: 'ציוד', title: 'כותרת', text: 'טקסט ארוך' }, null, full).error, 'busy');
}
console.log('gear tests passed');

// ---------- activities ----------
{
  const P = (x) => JSON.parse(JSON.stringify(x));
  function actStore() {
    const acts = [], joins = [];
    return { actsRows: acts, joinRows: joins, acts: () => acts, joins: () => joins,
             addAct: (r) => acts.push(r), updateAct: () => {}, addJoin: (r) => joins.push(r), updateJoin: () => {},
             now: () => '30/09/2026 12:00' };
  }
  const reg = memStore(), as = actStore(), A = (req) => P(ctx.route(req, reg, null, as));
  ctx.route({ action: 'save', user: 'משפחת כהן', pin: '1234', nights: { '2026-10-06': 4 }, maxPeople: 4, data: {} }, reg);
  ctx.route({ action: 'save', user: 'Levi', pin: '5555', nights: { '2026-10-06': 3 }, maxPeople: 3, data: {} }, reg);
  ctx.route({ action: 'save', user: 'Mizrahi', pin: '7777', nights: { '2026-10-07': 2 }, maxPeople: 2, data: {} }, reg);
  const act = (extra) => Object.assign({ topic: 'סדנת עפיפונים', description: 'בונים ומעיפים', start: '2026-10-07T10:00',
    end: '2026-10-07T12:00', tag: 'ילדים', ageFrom: 6, ageTo: 12, capacity: 5, required: 'מספריים', suggested: '' }, extra);
  const add = (extra, cid, who) => A(Object.assign({ action: 'saveActivity', clientId: cid || 'act-client-1',
    activity: act() }, who || { user: 'משפחת כהן', pin: '1234' }, extra));

  // public read before anything exists
  let r = A({ action: 'activities' });
  assert.ok(r.ok); assert.deepStrictEqual(r.activities, []); assert.deepStrictEqual(r.trip, { from: '2026-10-06', to: '2026-10-13' });

  // only a registered family, with its code
  assert.strictEqual(add({ user: 'nobody' }).error, 'not_registered');
  assert.strictEqual(add({ pin: '0000' }).error, 'wrong_pin');
  r = add();
  assert.ok(r.ok); assert.strictEqual(r.id, 1); assert.strictEqual(r.activities.length, 1);
  const a1 = r.activities[0];
  assert.strictEqual(a1.owner, 'משפחת כהן'); assert.strictEqual(a1.ageFrom, 6); assert.strictEqual(a1.capacity, 5);
  assert.strictEqual(a1.taken, 0); assert.ok(!('clientId' in a1) && !('created' in a1));
  // a retry lands on the same row
  assert.strictEqual(add().id, 1); assert.strictEqual(as.actsRows.length, 1);

  // validation
  const bad = (a, code) => assert.strictEqual(add({ activity: act(a) }, 'act-bad-000').error, code, JSON.stringify(a));
  bad({ topic: 'אב' }, 'too_short');
  bad({ start: '2026-10-05T10:00' }, 'bad_time');                  // before the trip
  bad({ end: '2026-10-14T10:00' }, 'bad_time');                    // after it
  bad({ start: '2026-10-07T24:00' }, 'bad_time');
  bad({ end: '2026-10-07T09:00' }, 'end_before_start');
  bad({ end: '2026-10-07T10:00' }, 'end_before_start');
  bad({ tag: 'כולם' }, 'bad_tag');
  bad({ ageFrom: 12, ageTo: 6 }, 'bad_age');
  bad({ ageFrom: 2.5 }, 'bad_age');
  bad({ capacity: -3 }, 'bad_capacity');
  bad({ capacity: 501 }, 'bad_capacity');
  assert.strictEqual(as.actsRows.length, 1);
  // ages are dropped unless the tag is kids; empty or 0 capacity = unlimited; formulas are guarded
  r = add({ activity: act({ tag: 'מבוגרים', capacity: '', topic: '=cmd()', start: '2026-10-06T21:00', end: '2026-10-07T01:00' }) }, 'act-client-2',
          { user: 'levi', pin: '5555' });
  assert.ok(r.ok);
  const a2 = r.activities.find(a => a.id === 2);
  assert.strictEqual(a2.ageFrom, null); assert.strictEqual(a2.capacity, 0); assert.strictEqual(a2.topic, '=cmd()');
  assert.strictEqual(as.actsRows[1].topic, "'=cmd()"); assert.strictEqual(as.actsRows[1].owner, 'Levi');
  assert.deepStrictEqual(r.activities.map(a => a.id), [2, 1]);      // sorted by start

  // join: sets (not adds); places are advisory (activities-plan §6): a join over the number is never refused
  const J = (who, pin, count, id) => A({ action: 'join', user: who, pin, id: id || 1, count });
  assert.strictEqual(J('Levi', '5555', 0).error, 'bad_count');
  assert.strictEqual(J('Levi', '5555', 3).activities.find(a => a.id === 1).taken, 3);
  assert.strictEqual(J('levi', '5555', 3).activities.find(a => a.id === 1).taken, 3);   // a retry
  assert.strictEqual(as.joinRows.length, 1);
  assert.strictEqual(J('Mizrahi', '7777', 3).activities.find(a => a.id === 1).taken, 6);   // 6 of 5 places: fine
  r = J('Mizrahi', '7777', 2);
  let one = r.activities.find(a => a.id === 1);
  assert.strictEqual(one.taken, 5); assert.deepStrictEqual(one.joined, [{ family: 'Levi', count: 3 }, { family: 'Mizrahi', count: 2 }]);
  assert.strictEqual(J('משפחת כהן', '1234', 1).activities.find(a => a.id === 1).taken, 6);
  assert.ok(A({ action: 'leave', user: 'משפחת כהן', pin: '1234', id: 1 }).ok);
  assert.ok(J('Levi', '5555', 2).ok);                              // lowering your own count is always fine
  assert.ok(J('Levi', '5555', 4).ok);                              // and up, past the number
  assert.ok(J('Levi', '5555', 3).ok);
  assert.strictEqual(J('Levi', '5555', 1, 99).error, 'not_found');

  // leave (repeatable), then the place is free again
  assert.strictEqual(A({ action: 'leave', user: 'Mizrahi', pin: '7777', id: 1 }).activities.find(a => a.id === 1).taken, 3);
  assert.ok(A({ action: 'leave', user: 'Mizrahi', pin: '7777', id: 1 }).ok);
  assert.ok(J('משפחת כהן', '1234', 2).ok);

  // edit: owner only; the number may drop below who already joined (advisory)
  const edit = (who, a, id) => A(Object.assign({ action: 'saveActivity', id: id || 1, activity: act(a) }, who));
  assert.strictEqual(edit({ user: 'Levi', pin: '5555' }, {}).error, 'not_owner');
  assert.strictEqual(edit({ user: 'משפחת כהן', pin: '1234' }, { capacity: 4 }).activities.find(a => a.id === 1).capacity, 4);
  // the host (מנחה) is optional, one line, up to 60 characters
  assert.strictEqual(r.activities.find(a => a.id === 1).host, '');
  assert.strictEqual(edit({ user: 'משפחת כהן', pin: '1234' }, { host: 'א'.repeat(61) }).error, 'too_long');
  r = edit({ user: 'משפחת כהן', pin: '1234' }, { capacity: 6, topic: 'עפיפונים ענקיים', host: '  דנה\nמהאוהל הכחול ' });
  assert.ok(r.ok); one = r.activities.find(a => a.id === 1);
  assert.strictEqual(one.host, 'דנה מהאוהל הכחול');
  assert.strictEqual(one.topic, 'עפיפונים ענקיים'); assert.strictEqual(one.capacity, 6); assert.strictEqual(one.taken, 5);
  assert.strictEqual(as.actsRows.length, 2);

  // the organizers' tab
  const org = P(ctx.organizerActivities_(ctx.activitiesPublic_(as)));
  assert.deepStrictEqual(org[0].slice(0, 6), ['ג׳ 06/10 21:00 עד ד׳ 07/10 01:00', '=cmd()', 'Levi', '', 'מבוגרים', 0]);
  assert.deepStrictEqual(org[1], ['ד׳ 07/10 10:00 עד 12:00', 'עפיפונים ענקיים', 'משפחת כהן', 'דנה מהאוהל הכחול', 'ילדים (6–12)', 5, 6, 'Levi 3 · משפחת כהן 2']);

  // cancel: owner only, repeatable, gone from the public list; no more joins or edits
  assert.strictEqual(A({ action: 'deleteActivity', user: 'Levi', pin: '5555', id: 1 }).error, 'not_owner');
  assert.ok(A({ action: 'deleteActivity', user: 'משפחת כהן', pin: '1234', id: 1 }).ok);
  r = A({ action: 'deleteActivity', user: 'משפחת כהן', pin: '1234', id: 1 });
  assert.ok(r.ok); assert.deepStrictEqual(r.activities.map(a => a.id), [2]);
  assert.strictEqual(as.actsRows[0].status, 'בוטל');
  assert.strictEqual(J('Levi', '5555', 1).error, 'not_found');
  assert.strictEqual(edit({ user: 'משפחת כהן', pin: '1234' }, {}).error, 'not_found');
  // Yair hides one in the sheet: gone, and its family cannot cancel what it cannot see
  as.actsRows[1].status = 'הוסתר';
  assert.deepStrictEqual(A({ action: 'activities' }).activities, []);
  assert.strictEqual(A({ action: 'deleteActivity', user: 'levi', pin: '5555', id: 2 }).error, 'not_found');

  // a family can have at most 30 active activities
  const busy = actStore(), B = (i) => P(ctx.route({ action: 'saveActivity', user: 'Levi', pin: '5555',
    clientId: 'act-busy-' + String(i).padStart(3, '0'), activity: act() }, reg, null, busy));
  for (let i = 0; i < 30; i++) assert.ok(B(i).ok);
  assert.strictEqual(B(30).error, 'busy');
  busy.actsRows[0].status = 'בוטל';
  assert.ok(B(31).ok);

  // three example activities from the sheet menu: one per audience, public at once, safe to run twice
  const demo = actStore();
  assert.strictEqual(ctx.addDemoActivities_(demo), 3);
  assert.strictEqual(ctx.addDemoActivities_(demo), 0);
  const pubDemo = P(ctx.route({ action: 'activities' }, null, null, demo)).activities;
  assert.deepStrictEqual(pubDemo.map(a => a.tag), ['לכולם', 'מבוגרים', 'ילדים']);
  assert.ok(pubDemo.every(a => a.owner === 'המארגנים' && a.description.includes('לדוגמה')));
  assert.strictEqual(pubDemo[2].ageFrom, 5); assert.strictEqual(pubDemo[0].capacity, 0);
  // each one would also pass the site's own save (same checks as a family's activity)
  for (const [i, a] of pubDemo.entries()) {
    const r2 = P(ctx.route({ action: 'saveActivity', user: 'Levi', pin: '5555', clientId: 'demo-check-' + i, activity: a }, reg, null, actStore()));
    assert.ok(r2.ok, a.topic + ': ' + r2.error);
  }
  // families join them; no family can edit them
  assert.ok(P(ctx.route({ action: 'join', user: 'Levi', pin: '5555', id: 2, count: 2 }, reg, null, demo)).ok);
  assert.strictEqual(P(ctx.route({ action: 'deleteActivity', user: 'Levi', pin: '5555', id: 2 }, reg, null, demo)).error, 'not_owner');
}
console.log('activities tests passed');

// ---------- guided tour texts (docs/tour-plan.md §5.2) ----------
{
  const P = (o) => JSON.parse(JSON.stringify(o));
  const seed = P(ctx.tourSeedRows_()), texts = P(ctx.TOUR_TEXTS_), names = P(ctx.TOUR_NAMES_);
  // the seed is the site's text, one row per bubble, numbered from 1 within each tour
  assert.strictEqual(seed.length, texts.length);
  seed.forEach((r, i) => {
    assert.deepStrictEqual([r[0], r[2], r[3], r[4]], [names[texts[i].tour], texts[i].key, texts[i].title, texts[i].text]);
  });
  assert.deepStrictEqual(seed.filter(r => r[0] === names.gear).map(r => r[1]), [1, 2, 3, 4, 5]);
  const rows = seed.map(r => ({ tour: r[0], step: r[1], key: r[2], title: r[3], text: r[4] }));
  const T = () => P(ctx.route({ action: 'tour' }, null, { tour: () => rows }));
  const at = (tour, key) => rows.findIndex(r => r.tour === names[tour] && r.key === key);
  const [iTabs, iWho, iWhen, iCost] = [at('welcome', 'tabs'), at('welcome', 'who'), at('welcome', 'when'), at('welcome', 'cost')];
  assert.deepStrictEqual([iTabs, iWho, iWhen, iCost], [2, 4, 5, 6]);   // consecutive: steps[k] below is rows[k] until 'when' is dropped
  // untouched: every step comes back as seeded
  let res = T();
  assert.ok(res.ok);
  assert.deepStrictEqual(res.steps, texts.map(t => ({ tour: t.tour, key: t.key, title: t.title, text: t.text })));
  // an edited row wins; an empty cell is left out (the site falls back); an empty row is dropped
  rows[iTabs].title = 'כותרת חדשה'; rows[iTabs].text = 'שורה\n\nעוד **חשוב**';
  rows[iWho].title = '   '; rows[iWhen].title = ''; rows[iWhen].text = '';
  res = T();
  assert.deepStrictEqual(res.steps[iTabs], { tour: 'welcome', key: 'tabs', title: 'כותרת חדשה', text: 'שורה\n\nעוד **חשוב**' });
  assert.deepStrictEqual(res.steps[iWho], { tour: 'welcome', key: 'who', text: texts[iWho].text });
  assert.ok(!res.steps.some(s => s.key === 'when' && s.tour === 'welcome'));
  // an unknown key or tour is ignored; a formula guard is removed
  rows.push({ tour: names.gear, step: 9, key: 'nope', title: 'x', text: 'x' }, { tour: 'לא קיים', step: 1, key: 'hello', title: 'x', text: 'x' });
  rows[iCost].text = "'=1+1";
  res = T();
  assert.strictEqual(res.steps.length, texts.length - 1);
  assert.strictEqual(res.steps[iCost - 1].text, '=1+1');
  // a store without the tab (older mocks) answers with no steps
  assert.deepStrictEqual(P(ctx.route({ action: 'tour' }, null, {})), { ok: true, steps: [] });
}
// the tab follows the site: a tab made by the first version (no `help`, the price list after the cost, the old
// share text), with one text edited by hand and a stray row
{
  const P = (o) => JSON.parse(JSON.stringify(o));
  const texts = P(ctx.TOUR_TEXTS_), names = P(ctx.TOUR_NAMES_), retired = P(ctx.TOUR_RETIRED_);
  const oldOrder = ['hello', 'tabs', 'who', 'when', 'cost', 'prices', 'register', 'share'];
  const d = (k) => texts.find(t => t.tour === 'welcome' && t.key === k);
  const rows = oldOrder.map((k, i) => ({ tour: names.welcome, step: i + 1, key: k, title: d(k).title,
    text: k === 'share' ? retired['welcome/share'][0] : d(k).text }))
    .concat(texts.filter(t => t.tour !== 'welcome').map((t, i) => ({ tour: names[t.tour], step: 1, key: t.key, title: t.title, text: t.text })));
  rows[2].text = 'נכתב ביד';
  rows.splice(3, 0, { tour: 'משהו', step: 1, key: 'x', title: 'זר', text: 'זר' });
  const fix = P(ctx.tourSync_(rows));
  assert.strictEqual(fix.length, texts.length + 1);
  assert.deepStrictEqual(fix.slice(0, 5).map(r => r[2]), ['hello', 'help', 'tabs', 'prices', 'who']);
  assert.deepStrictEqual(fix.slice(0, 9).map(r => r[1]), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual(fix[1][4], d('help').text);                       // the new step, with its text
  assert.strictEqual(fix[4][4], 'נכתב ביד');                            // a hand edit moves with its row
  assert.strictEqual(fix[8][4], d('share').text);                       // the retired text is replaced
  assert.deepStrictEqual(fix.at(-1).slice(2), ['x', 'זר', 'זר']);       // a stray row stays, at the end
  assert.ok(fix.slice(0, -1).every((r, i) => r[2] === texts[i].key && r[0] === names[texts[i].tour]));
  // once fixed, nothing more to do; an edited share text is never touched
  const again = fix.map(r => ({ tour: r[0], step: r[1], key: r[2], title: r[3], text: r[4] }));
  assert.strictEqual(ctx.tourSync_(again), null);
  again[8].text = 'שלי';
  assert.strictEqual(ctx.tourSync_(again), null);
  // a freshly seeded tab is already right
  assert.strictEqual(ctx.tourSync_(P(ctx.tourSeedRows_()).map(r => ({ tour: r[0], step: r[1], key: r[2], title: r[3], text: r[4] }))), null);
}
console.log('tour text tests passed');

// ---------- managing page: organizers' login (admin-plan §4.1) ----------
{
  let now = 2e12;
  const saved = [];
  function adminStore() {
    let orgs = {};
    return {
      orgs: () => orgs,
      saveOrgs: (o) => { orgs = o; saved.push(JSON.stringify(o)); },
      salt: () => crypto.randomBytes(8).toString('hex'),
      hash: (salt, pw) => crypto.createHash('sha256').update(salt + '|' + pw).digest('hex'),
      sign: (body) => crypto.createHmac('sha256', 'test-key').update(body).digest('hex'),
      nowMs: () => now
    };
  }
  const adm = adminStore(), A = (req) => P(ctx.route(req, null, null, null, adm));
  const login = (name, password) => A({ action: 'adminLogin', name, password });

  // setting a password: length rules; only a salted hash is kept
  assert.throws(() => ctx.setAdminPassword_(adm, 'יאיר', 'short'), e => e.code === 'bad_password');
  assert.throws(() => ctx.setAdminPassword_(adm, 'י', 'long enough'), e => e.code === 'bad_user');
  ctx.setAdminPassword_(adm, ' יאיר  ', 'סיסמה-טובה-1');
  ctx.setAdminPassword_(adm, 'Dana', 'dana-password');
  assert.ok(!saved.some(s => s.includes('סיסמה-טובה-1')), 'a password is stored in clear');
  assert.strictEqual(adm.orgs()['יאיר'].ver, 1);

  // right password: a token for 7 days; the name matches like family names (case, spaces)
  let r = login('יאיר', 'סיסמה-טובה-1');
  assert.ok(r.ok); assert.strictEqual(r.name, 'יאיר'); assert.strictEqual(r.exp, now + 7 * 24 * 3600 * 1000);
  const tok = r.token;
  assert.deepStrictEqual(A({ action: 'adminMe', token: tok }), { ok: true, name: 'יאיר' });
  assert.ok(login('  dana ', 'dana-password').ok);

  // wrong password, unknown name: the same answer
  assert.strictEqual(login('יאיר', 'סיסמה-טובה-2').error, 'wrong_password');
  assert.strictEqual(login('nobody', 'whatever-1').error, 'wrong_password');
  assert.strictEqual(login('יאיר', undefined).error, 'wrong_password');

  // lockout: 5 wrong in a row locks that name for 15 minutes, even with the right password; others unaffected
  for (let i = 0; i < 3; i++) login('יאיר', 'nope-nope');
  assert.strictEqual(login('יאיר', 'nope-nope').error, 'locked');
  assert.strictEqual(login('יאיר', 'סיסמה-טובה-1').error, 'locked');
  assert.ok(login('dana', 'dana-password').ok);
  assert.ok(A({ action: 'adminMe', token: tok }).ok);                          // an open login is not locked out
  now += 14 * 60 * 1000;
  assert.strictEqual(login('יאיר', 'סיסמה-טובה-1').error, 'locked');
  now += 2 * 60 * 1000;
  r = login('יאיר', 'סיסמה-טובה-1');
  assert.ok(r.ok); assert.strictEqual(adm.orgs()['יאיר'].fails, 0);
  assert.strictEqual(login('יאיר', 'nope-nope').error, 'wrong_password');     // the count started again

  // forged or broken tokens
  const [n, v, e, sig] = tok.split('.');
  const bad = (t) => assert.strictEqual(A({ action: 'adminMe', token: t }).error, 'auth', String(t));
  bad(undefined); bad(''); bad('abc'); bad(tok + '.x');
  bad([n, v, +e + 1e9, sig].join('.'));                                      // a longer expiry, old signature
  bad([encodeURIComponent('dana'), v, e, sig].join('.'));                     // someone else's name
  bad([n, v, e, sig.replace(/.$/, c => c === '0' ? '1' : '0')].join('.'));
  bad(['%E0%A4%A', v, e, adm.sign(['%E0%A4%A', v, e].join('.'))].join('.')); // signed, but not a valid name

  // expiry
  const t2 = login('dana', 'dana-password').token;
  now += 7 * 24 * 3600 * 1000 - 1;
  assert.ok(A({ action: 'adminMe', token: t2 }).ok);
  now += 1;
  bad(t2);

  // a new password ends that organizer's open logins, and only theirs
  const ty = login('יאיר', 'סיסמה-טובה-1').token, td = login('dana', 'dana-password').token;
  ctx.setAdminPassword_(adm, 'יאיר', 'סיסמה-חדשה-2');
  assert.strictEqual(adm.orgs()['יאיר'].ver, 2);
  bad(ty);
  assert.ok(A({ action: 'adminMe', token: td }).ok);
  assert.strictEqual(login('יאיר', 'סיסמה-טובה-1').error, 'wrong_password');
  assert.ok(A({ action: 'adminMe', token: login('יאיר', 'סיסמה-חדשה-2').token }).ok);

  // a bad name is rejected before anything is looked up
  assert.strictEqual(login('x', 'whatever-1').error, 'bad_user');
  assert.ok(ctx.sameText_('abc', 'abc') && !ctx.sameText_('abc', 'abd') && !ctx.sameText_('abc', 'ab'));
}
console.log('admin login tests passed');

// ---------- managing page: the waiting list and one item's decision (admin-plan §4.2) ----------
{
  const ST = ctx.ST;
  const logged = [];
  let orgs = {};
  const adm = {
    orgs: () => orgs, saveOrgs: (o) => { orgs = o; }, salt: () => 's',
    hash: (salt, pw) => crypto.createHash('sha256').update(salt + '|' + pw).digest('hex'),
    sign: (body) => crypto.createHmac('sha256', 'k').update(body).digest('hex'), nowMs: () => 3e12,
    log: (rows) => logged.push(...P(rows))
  };
  const tips = [], comments = [], gear = [], writes = [];
  const ts = {
    tips: () => tips, comments: () => comments, gear: () => gear,
    addTip: (r) => tips.push(r), addComment: (r) => comments.push(r), addGear: (r) => gear.push(r),
    updateTip: (r) => writes.push(['tip', r.id]), updateComment: (r) => writes.push(['comment', r.id]),
    updateGear: (r) => writes.push(['gear', r.id]), now: () => new Date(Date.UTC(2026, 9, 1, 9, 0))
  };
  const at = (h) => new Date(Date.UTC(2026, 8, 30, h));
  const tip = (id, status, title, extra) => tips.push(Object.assign({ id, status, category: 'ציוד', title, text: 'טקסט של ' + title,
    author: '', submitted: at(id), approved: status === ST.approved ? 'x' : '', mergedInto: '', similar: '', clientId: 'c' + id }, extra));
  tip(1, ST.approved, 'יתדות ארוכות');
  tip(2, ST.pending, 'יתדות לחול', { similar: '1: יתדות ארוכות', author: 'רונית' });
  tip(3, ST.pending, 'כובע לילדים');
  tip(4, ST.rejected, 'ספאם');
  tip(5, ST.pending, "'=HYPERLINK(1)");
  comments.push({ id: 1, tipId: 1, status: ST.pending, text: 'מסכים', author: '', submitted: at(7), approved: '', clientId: 'k1' });
  comments.push({ id: 2, tipId: 1, status: ST.approved, text: 'ישן', author: '', submitted: at(1), approved: 'x', clientId: 'k2' });
  gear.push({ id: 1, status: ST.approved, section: 'ביגוד', name: 'כובע', tags: '', note: '', submitted: '', approved: 'x', clientId: 's1' });
  gear.push({ id: 2, status: ST.pending, section: 'שונות', name: 'פטיש לחול', tags: '', note: '', submitted: at(9), approved: '', clientId: 'g2' });
  ctx.setAdminPassword_(adm, 'יאיר', 'password-1');
  const tok = ctx.adminLogin_({ name: 'יאיר', password: 'password-1' }, adm).token;
  const A = (req) => P(ctx.route(Object.assign({ token: tok }, req), null, ts, null, adm));

  // no token, a bad token: nothing is read or written
  assert.strictEqual(P(ctx.route({ action: 'adminQueue' }, null, ts, null, adm)).error, 'auth');
  assert.strictEqual(A({ action: 'adminDecide', token: 'x.1.2.3', kind: 'tip', id: 2, status: 'approved' }).error, 'auth');
  assert.strictEqual(writes.length, 0);

  // the queue: pending only, newest first, the similar hint, a comment's tip title, counts, merge targets
  let q = A({ action: 'adminQueue' });
  assert.ok(q.ok);
  assert.deepStrictEqual(q.tips.map(t => t.id), [5, 3, 2]);
  assert.strictEqual(q.tips[0].title, '=HYPERLINK(1)');                                 // shown without the guard
  assert.strictEqual(q.tips[2].similar, '1: יתדות ארוכות'); assert.strictEqual(q.tips[2].author, 'רונית');
  assert.strictEqual(q.tips[2].ms, at(2).getTime());
  assert.deepStrictEqual(q.comments.map(c => [c.id, c.tipTitle]), [[1, 'יתדות ארוכות']]);
  assert.deepStrictEqual(q.gear.map(g => g.name), ['פטיש לחול']);
  assert.deepStrictEqual(q.counts, { tip: 3, comment: 1, gear: 1 });
  assert.deepStrictEqual(q.mergeTargets, [{ id: 1, title: 'יתדות ארוכות' }]);
  assert.ok(q.categories.includes('ילדים') && q.sections.includes('ביגוד'));
  assert.ok(!JSON.stringify(q).includes('clientId') && !JSON.stringify(q).includes('"c2"'), 'client ids leaked');

  // approve a tip with an edited category and title: one write, stamped, each change logged with its old value
  let r = A({ action: 'adminDecide', kind: 'tip', id: 3, status: 'approved', fields: { category: 'ילדים', title: 'כובע רחב לילדים' } });
  assert.deepStrictEqual(r, { ok: true, id: 3, status: ST.approved });
  assert.deepStrictEqual(writes, [['tip', 3]]);
  assert.strictEqual(tips[2].category, 'ילדים'); assert.ok(tips[2].approved instanceof Date);
  assert.deepStrictEqual(logged.map(l => l.slice(1)), [
    ['יאיר', 'tip', 3, 'category', 'ציוד', 'ילדים'],
    ['יאיר', 'tip', 3, 'title', 'כובע לילדים', 'כובע רחב לילדים'],
    ['יאיר', 'tip', 3, 'status', ST.pending, ST.approved]]);
  assert.ok(ctx.tipsPublic_(ts).tips.some(t => t.title === 'כובע רחב לילדים'), 'approved but not public');
  // the same request again (a dropped reply): nothing written, nothing logged
  r = A({ action: 'adminDecide', kind: 'tip', id: 3, status: 'approved', fields: { category: 'ילדים', title: 'כובע רחב לילדים' } });
  assert.ok(r.ok); assert.strictEqual(writes.length, 1); assert.strictEqual(logged.length, 3);

  // bad fields: the same limits as a submission, and nothing changes
  const bad = (req, code) => assert.strictEqual(A(Object.assign({ action: 'adminDecide' }, req)).error, code, JSON.stringify(req));
  bad({ kind: 'tip', id: 2, status: 'approved', fields: { category: 'לא קיים' } }, 'bad_category');
  bad({ kind: 'tip', id: 2, status: 'approved', fields: { title: 'x' } }, 'too_short');
  bad({ kind: 'tip', id: 2, status: 'approved', fields: { text: 'y'.repeat(401) } }, 'too_long');
  bad({ kind: 'comment', id: 1, status: 'merged' }, 'bad_status');
  bad({ kind: 'tip', id: 2, status: 'hidden' }, 'bad_status');
  bad({ kind: 'nope', id: 2, status: 'approved' }, 'bad_request');
  bad({ kind: 'tip', id: 99, status: 'approved' }, 'not_found');
  bad({ kind: 'tip', id: 2, status: 'merged', mergedInto: 2 }, 'bad_merge');           // into itself
  bad({ kind: 'tip', id: 2, status: 'merged', mergedInto: 4 }, 'bad_merge');           // into a rejected tip
  bad({ kind: 'gear', id: 2, status: 'approved', fields: { section: 'אין כזה' } }, 'bad_category');
  assert.strictEqual(writes.length, 1); assert.strictEqual(tips[1].status, ST.pending);

  // merge: the tip becomes a comment on its target, once, even when retried
  r = A({ action: 'adminDecide', kind: 'tip', id: 2, status: 'merged', mergedInto: 1 });
  assert.ok(r.ok); assert.strictEqual(tips[1].status, ST.merged); assert.strictEqual(tips[1].mergedInto, 1);
  A({ action: 'adminDecide', kind: 'tip', id: 2, status: 'merged', mergedInto: 1 });
  assert.strictEqual(comments.filter(c => c.clientId === 'merge-2').length, 1);
  assert.ok(ctx.tipsPublic_(ts).tips.find(t => t.id === 1).comments.some(c => c.text.startsWith('יתדות לחול: ')));

  // reject a comment with an edit; a formula typed by the organizer is guarded in the sheet and the log
  r = A({ action: 'adminDecide', kind: 'comment', id: 1, status: 'rejected', fields: { text: '=cmd' } });
  assert.ok(r.ok); assert.strictEqual(comments[0].status, ST.rejected); assert.strictEqual(comments[0].text, "'=cmd");
  assert.strictEqual(comments[0].approved, '', 'a rejection is not stamped as approved');
  assert.deepStrictEqual(logged.find(l => l[2] === 'comment' && l[4] === 'text').slice(5), ['מסכים', "'=cmd"]);

  // approve a gear item with a new section, tags and note: on everyone's list
  r = A({ action: 'adminDecide', kind: 'gear', id: 2, status: 'approved',
          fields: { section: 'אוהלים ולינה', tags: ' חול ,חוף,, ', note: 'לקרקע קשה' } });
  assert.ok(r.ok);
  assert.deepStrictEqual(P(ctx.gearPublic_(ts).items.find(g => g.id === 2)),
    { id: 2, section: 'אוהלים ולינה', name: 'פטיש לחול', tags: ['חול', 'חוף'], note: 'לקרקע קשה' });

  // the queue now holds only what is still waiting
  q = A({ action: 'adminQueue' });
  assert.deepStrictEqual(q.counts, { tip: 1, comment: 0, gear: 0 });
  assert.deepStrictEqual(q.mergeTargets.map(t => t.id), [3, 1]);
}
console.log('admin queue tests passed');

// ---------- managing page: edit anything current (admin-plan §4.3) ----------
{
  const ST = ctx.ST, AST = ctx.AST, NL = String.fromCharCode(10);
  const logged = [];
  let orgs = {};
  const adm = {
    orgs: () => orgs, saveOrgs: (o) => { orgs = o; }, salt: () => 's',
    hash: (salt, pw) => crypto.createHash('sha256').update(salt + '|' + pw).digest('hex'),
    sign: (body) => crypto.createHmac('sha256', 'k').update(body).digest('hex'), nowMs: () => 3e12,
    log: (rows) => logged.push(...P(rows))
  };
  const writes = [];
  const tips = [
    { id: 1, status: ST.approved, category: 'ציוד', title: 'יתדות ארוכות', text: 'טקסט ארוך מספיק', author: '', submitted: '', approved: 'x', mergedInto: '', similar: '', clientId: 'c1' },
    { id: 2, status: ST.merged, category: 'ציוד', title: 'יתדות לחול', text: 'טקסט ארוך מספיק', author: '', submitted: '', approved: '', mergedInto: 1, similar: '', clientId: 'c2' }];
  const comments = [{ id: 1, tipId: 1, status: ST.approved, text: 'מסכים', author: '', submitted: '', approved: 'x', clientId: 'k1' }];
  const gear = [{ id: 1, status: ST.approved, section: 'ביגוד', name: 'כובע', tags: '', note: '', submitted: '', approved: 'x', clientId: 's1' }];
  const tour = P(ctx.tourSeedRows_()).map((r, i) => ({ _row: i + 2, tour: r[0], step: r[1], key: r[2], title: r[3], text: r[4] }));
  tour[2].title = 'נערך ביד';
  const ts = {
    tips: () => tips, comments: () => comments, gear: () => gear, tour: () => tour,
    updateTip: (r) => writes.push(['tip', r.id]), updateComment: (r) => writes.push(['comment', r.id]),
    updateGear: (r) => writes.push(['gear', r.id]), updateTour: (r) => writes.push(['tour', r.key]),
    now: () => new Date(Date.UTC(2026, 9, 1, 9, 0))
  };
  const acts = [{ id: 1, status: AST.active, owner: 'Levi', topic: 'ציור בחול', host: '', description: '', start: '2026-10-07T10:00',
    end: '2026-10-07T11:00', tag: 'ילדים', ageFrom: 4, ageTo: 9, capacity: 10, required: '', suggested: '', created: '', updated: '', clientId: 'a1' }];
  const joins = [{ actId: 1, family: 'Cohen', count: 3, updated: '' }];
  const as = { acts: () => acts, joins: () => joins, updateAct: (r) => writes.push(['activity', r.id]), now: () => new Date(Date.UTC(2026, 9, 1, 9, 0)) };
  ctx.setAdminPassword_(adm, 'יאיר', 'password-1');
  const tok = ctx.adminLogin_({ name: 'יאיר', password: 'password-1' }, adm).token;
  const A = (req) => P(ctx.route(Object.assign({ token: tok }, req), null, ts, as, adm));
  const bad = (req, code) => assert.strictEqual(A(Object.assign({ action: 'adminUpdate' }, req)).error, code, JSON.stringify(req));

  // no token: nothing read, nothing written
  assert.strictEqual(P(ctx.route({ action: 'adminList', kind: 'tip' }, null, ts, as, adm)).error, 'auth');
  assert.strictEqual(P(ctx.route({ action: 'adminUpdate', kind: 'tip', id: 1, status: 'hidden' }, null, ts, as, adm)).error, 'auth');
  assert.strictEqual(A({ action: 'adminList', kind: 'nope' }).error, 'bad_request');
  assert.strictEqual(writes.length, 0);

  // lists: every status, as keys; the merge target; an activity's taken places; tour texts with the built-in ones
  let l = A({ action: 'adminList', kind: 'tip' });
  assert.deepStrictEqual(l.items.map(t => [t.id, t.status, t.mergedInto]), [[2, 'merged', 1], [1, 'approved', null]]);
  assert.deepStrictEqual(l.statuses, ['approved', 'hidden', 'rejected', 'pending']);
  assert.ok(!JSON.stringify(l).includes('clientId'), 'client ids leaked');
  assert.deepStrictEqual(A({ action: 'adminList', kind: 'comment' }).items.map(c => [c.id, c.tipTitle]), [[1, 'יתדות ארוכות']]);
  assert.deepStrictEqual(A({ action: 'adminList', kind: 'gear' }).items.map(g => g.name), ['כובע']);
  l = A({ action: 'adminList', kind: 'activity' });
  assert.deepStrictEqual([l.items[0].status, l.items[0].taken, l.items[0].ageFrom], ['active', 3, 4]);
  assert.deepStrictEqual(l.trip, { from: '2026-10-06', to: '2026-10-13' });
  l = A({ action: 'adminList', kind: 'tour' });
  const texts = P(ctx.TOUR_TEXTS_);
  assert.strictEqual(l.items.length, texts.length);
  assert.deepStrictEqual([l.items[2].id, l.items[2].title, l.items[2].defTitle], [texts[2].tour + '/' + texts[2].key, 'נערך ביד', texts[2].title]);
  assert.strictEqual(l.items[0].step, 1); assert.strictEqual(l.items[0].tourName, 'פתיחה');

  // hide a tip, then restore it: off the public list and back, two logged status changes
  let r = A({ action: 'adminUpdate', kind: 'tip', id: 1, status: 'hidden' });
  assert.deepStrictEqual(r, { ok: true, id: 1, saved: true, status: 'hidden' });
  assert.ok(!ctx.tipsPublic_(ts).tips.some(t => t.id === 1));
  r = A({ action: 'adminUpdate', kind: 'tip', id: 1, status: 'hidden' });                // retried: nothing
  assert.strictEqual(r.saved, false); assert.strictEqual(writes.length, 1);
  r = A({ action: 'adminUpdate', kind: 'tip', id: 1, status: 'approved', fields: { title: 'יתדות ארוכות מאוד' } });
  assert.ok(r.saved && ctx.tipsPublic_(ts).tips.some(t => t.title === 'יתדות ארוכות מאוד'));
  assert.strictEqual(tips[0].approved, 'x', 'an earlier approval stamp stays');
  assert.deepStrictEqual(logged.map(x => x.slice(2, 7)), [
    ['tip', 1, 'status', ST.approved, ST.hidden],
    ['tip', 1, 'title', 'יתדות ארוכות', 'יתדות ארוכות מאוד'], ['tip', 1, 'status', ST.hidden, ST.approved]]);
  // a merged tip set back to approved loses its merge target; edits without a status keep the status
  A({ action: 'adminUpdate', kind: 'tip', id: 2, status: 'approved' });
  assert.deepStrictEqual([tips[1].status, tips[1].mergedInto], [ST.approved, '']);
  assert.ok(ctx.isDate_(tips[1].approved));
  A({ action: 'adminUpdate', kind: 'comment', id: 1, fields: { text: 'מסכים מאוד' } });
  assert.deepStrictEqual([comments[0].text, comments[0].status], ['מסכים מאוד', ST.approved]);
  A({ action: 'adminUpdate', kind: 'gear', id: 1, status: 'hidden', fields: { note: 'רחב' } });
  assert.ok(!ctx.gearPublic_(ts).items.some(g => g.id === 1));

  bad({ kind: 'tip', id: 1, status: 'merged' }, 'bad_status');
  bad({ kind: 'comment', id: 1, status: 'active' }, 'bad_status');
  bad({ kind: 'tip', id: 1, fields: { title: 'x' } }, 'too_short');
  bad({ kind: 'gear', id: 9, status: 'hidden' }, 'not_found');
  bad({ kind: 'tour', id: 'welcome/hello', status: 'hidden' }, 'bad_status');

  // fix an activity's time: still inside the trip and after its start; stamped as updated; public at once
  const w0 = writes.length;
  r = A({ action: 'adminUpdate', kind: 'activity', id: 1, fields: { start: '2026-10-08T16:00', end: '2026-10-08T17:30' } });
  assert.ok(r.saved); assert.strictEqual(writes.length, w0 + 1);
  assert.ok(ctx.isDate_(acts[0].updated));
  assert.strictEqual(ctx.activitiesPublic_(as).activities[0].start, '2026-10-08T16:00');
  r = A({ action: 'adminUpdate', kind: 'activity', id: 1, fields: { start: '2026-10-08T16:00', end: '2026-10-08T17:30' } });
  assert.strictEqual(r.saved, false); assert.strictEqual(writes.length, w0 + 1);              // a retry writes nothing
  bad({ kind: 'activity', id: 1, fields: { end: '2026-10-08T15:00' } }, 'end_before_start');
  bad({ kind: 'activity', id: 1, fields: { start: '2026-10-20T10:00' } }, 'bad_time');
  bad({ kind: 'activity', id: 1, fields: { tag: 'כולם' } }, 'bad_tag');
  bad({ kind: 'activity', id: 1, fields: { ageFrom: 10 } }, 'bad_age');                       // above ageTo 9
  bad({ kind: 'activity', id: 1, fields: { capacity: 501 } }, 'bad_capacity');
  bad({ kind: 'activity', id: 1, status: 'approved' }, 'bad_status');
  assert.strictEqual(writes.length, w0 + 1);
  // for everyone: the ages go; no limit; hidden then active again
  A({ action: 'adminUpdate', kind: 'activity', id: 1, fields: { tag: 'לכולם', capacity: '' } });
  assert.deepStrictEqual([acts[0].ageFrom, acts[0].ageTo, acts[0].capacity], ['', '', '']);
  A({ action: 'adminUpdate', kind: 'activity', id: 1, status: 'hidden' });
  assert.strictEqual(ctx.activitiesPublic_(as).activities.length, 0);
  assert.deepStrictEqual(A({ action: 'adminUpdate', kind: 'activity', id: 1, status: 'active' }).status, 'active');
  assert.strictEqual(acts[0].owner, 'Levi', 'the owner never changes');

  // a tour bubble: title and text, blank lines kept, an empty cell falls back to the site's text
  r = A({ action: 'adminUpdate', kind: 'tour', id: 'welcome/help', fields: { title: 'עזרה', text: 'שורה אחת' + NL + NL + '**שנייה**' } });
  assert.ok(r.saved); assert.deepStrictEqual(writes[writes.length - 1], ['tour', 'help']);
  let pub = P(ctx.tourPublic_(ts)).steps.find(s => s.key === 'help' && s.tour === 'welcome');
  assert.deepStrictEqual(pub, { tour: 'welcome', key: 'help', title: 'עזרה', text: 'שורה אחת' + NL + NL + '**שנייה**' });
  A({ action: 'adminUpdate', kind: 'tour', id: 'welcome/help', fields: { title: '' } });
  pub = P(ctx.tourPublic_(ts)).steps.find(s => s.key === 'help' && s.tour === 'welcome');
  assert.strictEqual(pub.title, undefined);
  assert.deepStrictEqual(logged.filter(x => x[2] === 'tour').map(x => [x[3], x[4]]),
    [['welcome/help', 'title'], ['welcome/help', 'text'], ['welcome/help', 'title']]);
  bad({ kind: 'tour', id: 'welcome/nope', fields: { title: 'x' } }, 'not_found');
  bad({ kind: 'tour', id: 'welcome/help', fields: { text: 'y'.repeat(2001) } }, 'too_long');
}
console.log('admin edit tests passed');

// ---------- managing page: add and delete (admin-plan §4.6) ----------
{
  const ST = ctx.ST, AST = ctx.AST;
  const logged = [];
  let orgs = {};
  const adm = {
    orgs: () => orgs, saveOrgs: (o) => { orgs = o; }, salt: () => 's',
    hash: (salt, pw) => crypto.createHash('sha256').update(salt + '|' + pw).digest('hex'),
    sign: (body) => crypto.createHmac('sha256', 'k').update(body).digest('hex'), nowMs: () => 3e12,
    log: (rows) => logged.push(...P(rows))
  };
  const now = () => new Date(Date.UTC(2026, 9, 1, 9, 0));
  const tips = [{ id: 1, status: ST.approved, category: 'ציוד', title: 'יתדות ארוכות', text: 'טקסט ארוך מספיק', author: '', submitted: '', approved: 'x', mergedInto: '', similar: '', clientId: 'c1' },
                { id: 2, status: ST.pending, category: 'ציוד', title: 'ממתין', text: 'טקסט ארוך מספיק', author: '', submitted: '', approved: '', mergedInto: '', similar: '', clientId: 'c2' }];
  const comments = [], gear = [{ id: 1, status: ST.approved, section: 'ביגוד', name: 'כובע', tags: '', note: '', submitted: '', approved: 'x', clientId: 'seed-1' },
                                { id: 2, status: ST.approved, section: 'ביגוד', name: 'סנדלים', tags: '', note: '', submitted: '', approved: 'x', clientId: 'seed-2' }];
  const acts = [], writes = [];
  const ts = { tips: () => tips, comments: () => comments, gear: () => gear, tour: () => [],
    addTip: (r) => tips.push(r), addComment: (r) => comments.push(r), addGear: (r) => gear.push(r),
    updateTip: (r) => writes.push(['tip', r.id]), updateComment: (r) => writes.push(['comment', r.id]),
    updateGear: (r) => writes.push(['gear', r.id]), updateTour() {}, now };
  const as = { acts: () => acts, joins: () => [], addAct: (r) => acts.push(r), updateAct: (r) => writes.push(['activity', r.id]), now };
  ctx.setAdminPassword_(adm, 'יאיר', 'password-1');
  const tok = ctx.adminLogin_({ name: 'יאיר', password: 'password-1' }, adm).token;
  const A = (req) => P(ctx.route(Object.assign({ token: tok }, req), null, ts, as, adm));
  const add = (kind, fields, extra) => A(Object.assign({ action: 'adminAdd', kind, clientId: 'adm-' + kind + '-' + Math.random().toString(36).slice(2, 10), fields }, extra));

  // no token, unknown kind, tour (steps are code): refused, nothing written
  assert.strictEqual(P(ctx.route({ action: 'adminAdd', kind: 'tip', clientId: 'abcdefgh1', fields: {} }, null, ts, as, adm)).error, 'auth');
  assert.strictEqual(P(ctx.route({ action: 'adminDelete', kind: 'tip', id: 1 }, null, ts, as, adm)).error, 'auth');
  assert.strictEqual(add('tour', { title: 'x' }).error, 'bad_request');
  assert.strictEqual(A({ action: 'adminAdd', kind: 'tip', clientId: 'bad id!', fields: {} }).error, 'bad_request');

  // missing or bad fields: the same checks as an edit, and nothing added
  assert.strictEqual(add('tip', { category: 'ציוד', title: 'כותרת', text: '' }).error, 'too_short');
  assert.strictEqual(add('tip', { category: 'לא קיים', title: 'כותרת', text: 'טקסט ארוך' }).error, 'bad_category');
  assert.strictEqual(add('gear', { section: 'ביגוד' }).error, 'too_short');
  assert.strictEqual(add('activity', { topic: 'שחייה', start: '', end: '', tag: 'לכולם' }).error, 'bad_time');
  assert.strictEqual(add('activity', { topic: 'שחייה', start: '2026-10-07T10:00', end: '2026-10-07T09:00', tag: 'לכולם' }).error, 'end_before_start');
  assert.strictEqual(add('comment', { text: 'מצוין' }, { tipId: 2 }).error, 'bad_tip');        // only on an approved tip
  assert.deepStrictEqual([tips.length, gear.length, acts.length, comments.length, logged.length], [2, 2, 0, 0, 0]);

  // add each kind: approved / active at once, on the public lists, logged once
  let r = A({ action: 'adminAdd', kind: 'tip', clientId: 'adm-tip-0001', fields: { category: 'ילדים', title: 'כובע רחב', text: 'השמש חזקה מאוד', author: '' } });
  assert.deepStrictEqual(r, { ok: true, id: 3, added: true });
  assert.deepStrictEqual(A({ action: 'adminAdd', kind: 'tip', clientId: 'adm-tip-0001', fields: { category: 'ילדים', title: 'כובע רחב', text: 'השמש חזקה מאוד' } }),
    { ok: true, id: 3, added: false });                                                      // a retry: the same row
  assert.strictEqual(tips.length, 3);
  assert.strictEqual(tips[2].status, ST.approved); assert.ok(tips[2].approved);
  assert.ok(ctx.tipsPublic_(ts).tips.some(t => t.id === 3 && t.title === 'כובע רחב'));
  r = add('comment', { text: 'גם קרם הגנה' }, { tipId: 1 });
  assert.deepStrictEqual([r.ok, r.id, comments[0].tipId, comments[0].status], [true, 1, 1, ST.approved]);
  r = add('gear', { section: 'ים וחוף', name: 'שמשייה', tags: 'נוחות, ילדים', note: '' });
  assert.deepStrictEqual([r.id, gear[2].tags, gear[2].status], [3, 'נוחות, ילדים', ST.approved]);
  assert.ok(ctx.gearPublic_(ts).items.some(g => g.id === 3));
  r = add('activity', { topic: 'שחייה בבוקר', start: '2026-10-07T07:00', end: '2026-10-07T08:00', tag: 'מבוגרים', ageFrom: 5, capacity: '' });
  assert.deepStrictEqual([r.id, acts[0].owner, acts[0].status, acts[0].ageFrom, acts[0].capacity], [1, 'המארגנים', AST.active, '', '']);
  assert.ok(ctx.activitiesPublic_(as).activities.some(a => a.topic === 'שחייה בבוקר'));
  assert.deepStrictEqual(logged.map(l => [l[2], l[3], l[4]]), [['tip', 3, 'נוסף'], ['comment', 1, 'נוסף'], ['gear', 3, 'נוסף'], ['activity', 1, 'נוסף']]);
  assert.ok(String(logged[0][6]).includes('כובע רחב'));
  assert.ok(!JSON.stringify(A({ action: 'adminList', kind: 'comment' })).includes('clientId'));
  assert.deepStrictEqual(A({ action: 'adminList', kind: 'comment' }).tips.map(t => t.id), [3, 1]);   // approved tips to add to

  // delete: a tombstone — hidden, main field emptied, the id kept; gone from the admin list and the site; logged whole
  logged.length = 0;
  r = A({ action: 'adminDelete', kind: 'gear', id: 3 });
  assert.deepStrictEqual(r, { ok: true, deleted: true });
  assert.deepStrictEqual([gear[2].id, gear[2].status, gear[2].name], [3, ST.hidden, '']);
  assert.ok(!A({ action: 'adminList', kind: 'gear' }).items.some(g => g.id === 3));
  assert.ok(!ctx.gearPublic_(ts).items.some(g => g.id === 3));
  assert.deepStrictEqual(A({ action: 'adminDelete', kind: 'gear', id: 3 }), { ok: true, deleted: false });   // a retry
  assert.deepStrictEqual(A({ action: 'adminDelete', kind: 'gear', id: 99 }), { ok: true, deleted: false });
  assert.strictEqual(A({ action: 'adminUpdate', kind: 'gear', id: 3, fields: { name: 'חזר' } }).error, 'not_found');
  assert.strictEqual(add('gear', { section: 'ביגוד', name: 'כפכפים' }).id, 4);                 // the deleted id is never reused
  assert.deepStrictEqual(logged.map(l => [l[2], l[3], l[4]]), [['gear', 3, 'נמחק'], ['gear', 4, 'נוסף']]);
  assert.ok(String(logged[0][5]).includes('שמשייה'));
  A({ action: 'adminDelete', kind: 'tip', id: 1 });
  assert.ok(!ctx.tipsPublic_(ts).tips.some(t => t.id === 1));
  assert.ok(!A({ action: 'adminList', kind: 'tip' }).items.some(t => t.id === 1));
  assert.ok(!A({ action: 'adminList', kind: 'comment' }).tips.some(t => t.id === 1));
  A({ action: 'adminDelete', kind: 'comment', id: 1 });
  assert.strictEqual(A({ action: 'adminList', kind: 'comment' }).items.length, 0);
  A({ action: 'adminDelete', kind: 'activity', id: 1 });
  assert.deepStrictEqual([acts[0].status, acts[0].topic], [AST.hidden, '']);
  assert.strictEqual(A({ action: 'adminList', kind: 'activity' }).items.length, 0);
  assert.strictEqual(ctx.activitiesPublic_(as).activities.length, 0);
  assert.strictEqual(A({ action: 'adminDelete', kind: 'tour', id: 'welcome/help' }).error, 'bad_request');
  // a hidden row with its text is NOT a tombstone: still listed, so it can be restored
  A({ action: 'adminUpdate', kind: 'gear', id: 1, status: 'hidden' });
  assert.ok(A({ action: 'adminList', kind: 'gear' }).items.some(g => g.id === 1 && g.status === 'hidden'));
}
console.log('admin add/delete tests passed');

// ---------- managing page: registrations (admin-plan §4.4) ----------
{
  const logged = [];
  let orgs = {}, now = 4e12;
  const adm = {
    orgs: () => orgs, saveOrgs: (o) => { orgs = o; }, salt: () => 's',
    hash: (salt, pw) => crypto.createHash('sha256').update(salt + '|' + pw).digest('hex'),
    sign: (body) => crypto.createHmac('sha256', 'k').update(body).digest('hex'), nowMs: () => now,
    log: (rows) => logged.push(...P(rows))
  };
  const fs2 = memStore(), replies = [];
  fs2.nowMs = () => now;
  const pub = (req) => P(ctx.route(req, fs2));
  const stay = (base, periods) => ({ base, periods: periods.map(p => Object.assign({ custom: false, counts: {} }, p)) });
  pub({ action: 'save', user: 'Cohen', pin: '1234', nights: { '2026-10-06': 3 }, maxPeople: 3, full: 999, group: 999,
        data: stay({ adult: 2, child: 1 }, [{ from: '2026-10-06', to: '2026-10-07' }]) });
  pub({ action: 'save', user: 'משפחת לוי', pin: '5555', nights: { '2026-10-07': 2 }, maxPeople: 2, full: 304, group: 260,
        data: stay({ adult: 2 }, [{ from: '2026-10-07', to: '2026-10-09' }]) });
  for (let i = 0; i < 5; i++) pub({ action: 'load', user: 'משפחת לוי', pin: '0000' });
  assert.strictEqual(pub({ action: 'load', user: 'משפחת לוי', pin: '5555' }).error, 'locked');
  const hashes = fs2.rows.map(r => r.pinHash);

  ctx.setAdminPassword_(adm, 'יאיר', 'password-1');
  const tok = ctx.adminLogin_({ name: 'יאיר', password: 'password-1' }, adm).token;
  const A = (req) => { const r = P(ctx.route(Object.assign({ token: tok }, req), fs2, null, null, adm)); replies.push(r); return r; };
  const bad = (req, code) => assert.strictEqual(A(Object.assign({ action: 'adminFamilyUpdate', user: 'cohen' }, req)).error, code, JSON.stringify(req));

  // no token: nothing read, nothing changed
  ['adminFamilies', 'adminFamilyUpdate', 'adminFamilyCancel', 'adminFamilyUnlock'].forEach(action =>
    assert.strictEqual(P(ctx.route({ action, user: 'cohen' }, fs2, null, null, adm)).error, 'auth', action));
  assert.strictEqual(fs2.rows.length, 2);

  // the list: by name, the stay without internals, the lock
  let l = A({ action: 'adminFamilies' });
  assert.deepStrictEqual(l.items.map(f => [f.user, f.family, f.locked]), [['cohen', 'Cohen', false], ['משפחת לוי', 'משפחת לוי', true]]);
  assert.deepStrictEqual(l.items[0].nights, { '2026-10-06': 3 });
  assert.strictEqual(l.items[0].updated, '30/09/2026 12:00');
  assert.strictEqual(l.items[0].data.periods[0].from, '2026-10-06'); assert.ok(!('__nights' in l.items[0].data));

  // new dates and headcount: priced by calc.js (whatever price the family's browser sent before), code and name kept
  const next = stay({ adult: 2, child: 2, toddler: 1 }, [{ from: '2026-10-06', to: '2026-10-09' }]);
  let r = A({ action: 'adminFamilyUpdate', user: 'COHEN ', data: next, full: 1, group: 1, maxPeople: 99 });
  assert.ok(r.ok && r.saved);
  assert.deepStrictEqual([r.full, r.group, r.maxPeople], [3 * (152 + 116), 3 * (130 + 98), 5]);
  assert.deepStrictEqual(r.nights, { '2026-10-06': 5, '2026-10-07': 5, '2026-10-08': 5 });
  const cohen = fs2.rows.find(x => x.user === 'cohen');
  assert.strictEqual(cohen.pinHash, hashes[0]); assert.strictEqual(cohen.family, 'Cohen');
  let ld = pub({ action: 'load', user: 'Cohen', pin: '1234' });                 // the family's own code still opens it
  assert.ok(ld.ok); assert.strictEqual(ld.data.periods[0].to, '2026-10-09'); assert.strictEqual(ld.data.base.child, 2);
  assert.strictEqual(pub({ action: 'summary' }).nights['2026-10-08'], 5);
  assert.deepStrictEqual(logged.map(x => [x[1], x[2], x[3], x[4]]),
    [['יאיר', 'family', 'Cohen', 'data'], ['יאיר', 'family', 'Cohen', 'maxPeople'], ['יאיר', 'family', 'Cohen', 'full'], ['יאיר', 'family', 'Cohen', 'group']]);
  assert.strictEqual(JSON.parse(logged[0][5]).periods[0].to, '2026-10-07');     // the old stay can be typed back
  assert.deepStrictEqual([logged[2][5], logged[2][6]], ['999', '804']);
  // a retry (dropped reply) changes and logs nothing
  r = A({ action: 'adminFamilyUpdate', user: 'cohen', data: next });
  assert.ok(r.ok && !r.saved); assert.strictEqual(logged.length, 4);

  // the calculator's own warnings refuse a stay; nothing is written
  bad({ data: stay({ adult: 2 }, [{ from: '2026-10-06', to: '2026-10-08' }, { from: '2026-10-07', to: '2026-10-09' }]) }, 'bad_stay');  // overlap
  bad({ data: stay({ adult: 2 }, [{ from: '2026-10-06', to: '2026-10-13' }]) }, 'bad_stay');            // 7 nights in a row
  bad({ data: stay({ adult: 2 }, [{ from: '2026-10-08', to: '2026-10-08' }]) }, 'bad_stay');            // no night
  bad({ data: stay({}, [{ from: '2026-10-06', to: '2026-10-08' }]) }, 'bad_stay');                       // nobody
  bad({ data: stay({ adult: 1.5 }, [{ from: '2026-10-06', to: '2026-10-08' }]) }, 'bad_stay');
  bad({ data: stay({ adult: 100 }, [{ from: '2026-10-06', to: '2026-10-08' }]) }, 'bad_stay');
  bad({ data: stay({ adult: 2 }, [{ from: '2026-02-30', to: '2026-03-02' }]) }, 'bad_stay');
  bad({ data: stay({ adult: 2 }, []) }, 'bad_stay');
  bad({ data: { base: { adult: 2 } } }, 'bad_stay');
  bad({ user: 'nobody', data: next }, 'not_found');
  assert.strictEqual(logged.length, 4);
  // a period with its own composition is priced by it; unknown keys are dropped
  r = A({ action: 'adminFamilyUpdate', user: 'cohen', data: { base: { adult: 2, junk: 7 }, periods: [
    { from: '2026-10-06', to: '2026-10-07', custom: false, counts: { adult: 9 } },
    { from: '2026-10-08', to: '2026-10-09', custom: true, counts: { adult: 1, mattress: 1 } }] } });
  assert.deepStrictEqual([r.full, r.group, r.maxPeople], [152 + 76 + 12, 130 + 65 + 12, 2]);
  assert.ok(!cohen.data.includes('junk'));
  assert.deepStrictEqual(JSON.parse(cohen.data).periods[0].counts.adult, 0);

  // unlock: the right code works at once; the wrong one still counts; a retry is quiet
  r = A({ action: 'adminFamilyUnlock', user: 'משפחת לוי' });
  assert.ok(r.ok && r.saved);
  assert.ok(pub({ action: 'load', user: 'משפחת לוי', pin: '5555' }).ok);
  assert.strictEqual(fs2.rows.find(x => x.user === 'משפחת לוי').pinHash, hashes[1]);
  assert.deepStrictEqual(logged.slice(-1).map(x => [x[3], x[4], x[5], x[6]]), [['משפחת לוי', 'fails', '5', '0']]);
  const n = logged.length;
  assert.ok(!A({ action: 'adminFamilyUnlock', user: 'משפחת לוי' }).saved); assert.strictEqual(logged.length, n);
  assert.strictEqual(A({ action: 'adminFamilyUnlock', user: 'nobody' }).error, 'not_found');

  // cancel: gone from the public summary, the log keeps the stay (never the code); a retry is fine
  r = A({ action: 'adminFamilyCancel', user: 'cohen' });
  assert.ok(r.ok && r.removed);
  assert.deepStrictEqual(pub({ action: 'summary' }).names, ['משפחת לוי']);
  const last = logged[logged.length - 1];
  assert.deepStrictEqual([last[3], last[4], last[6]], ['Cohen', 'registration', ctx.AST.cancelled]);
  assert.strictEqual(JSON.parse(last[5]).family, 'Cohen'); assert.strictEqual(JSON.parse(last[5]).full, 240);
  r = A({ action: 'adminFamilyCancel', user: 'cohen' });
  assert.ok(r.ok && !r.removed); assert.strictEqual(logged.length, n + 1);

  // no reply and no log row ever carries a code's hash
  const out = JSON.stringify(replies) + JSON.stringify(logged);
  hashes.forEach(h => assert.ok(!out.includes(h), 'a code hash leaked'));
  assert.ok(!/pinHash|"fails"|"1234"|"5555"/.test(JSON.stringify(replies)));
}
console.log('admin registration tests passed');
