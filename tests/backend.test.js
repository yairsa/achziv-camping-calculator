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

  // join: sets (not adds), capacity is enforced, a full activity takes no more
  const J = (who, pin, count, id) => A({ action: 'join', user: who, pin, id: id || 1, count });
  assert.strictEqual(J('Levi', '5555', 0).error, 'bad_count');
  assert.strictEqual(J('Levi', '5555', 3).activities.find(a => a.id === 1).taken, 3);
  assert.strictEqual(J('levi', '5555', 3).activities.find(a => a.id === 1).taken, 3);   // a retry
  assert.strictEqual(as.joinRows.length, 1);
  assert.strictEqual(J('Mizrahi', '7777', 3).error, 'full');
  r = J('Mizrahi', '7777', 2);
  let one = r.activities.find(a => a.id === 1);
  assert.strictEqual(one.taken, 5); assert.deepStrictEqual(one.joined, [{ family: 'Levi', count: 3 }, { family: 'Mizrahi', count: 2 }]);
  assert.strictEqual(J('משפחת כהן', '1234', 1).error, 'full');
  assert.ok(J('Levi', '5555', 2).ok);                              // lowering your own count is always fine
  assert.ok(J('Levi', '5555', 3).ok);                              // and back up to the limit
  assert.strictEqual(J('Levi', '5555', 4).error, 'full');
  assert.strictEqual(J('Levi', '5555', 1, 99).error, 'not_found');

  // leave (repeatable), then the place is free again
  assert.strictEqual(A({ action: 'leave', user: 'Mizrahi', pin: '7777', id: 1 }).activities.find(a => a.id === 1).taken, 3);
  assert.ok(A({ action: 'leave', user: 'Mizrahi', pin: '7777', id: 1 }).ok);
  assert.ok(J('משפחת כהן', '1234', 2).ok);

  // edit: owner only; capacity cannot drop below who already joined
  const edit = (who, a, id) => A(Object.assign({ action: 'saveActivity', id: id || 1, activity: act(a) }, who));
  assert.strictEqual(edit({ user: 'Levi', pin: '5555' }, {}).error, 'not_owner');
  assert.strictEqual(edit({ user: 'משפחת כהן', pin: '1234' }, { capacity: 4 }).error, 'below_joined');
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
