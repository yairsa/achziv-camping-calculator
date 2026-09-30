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
