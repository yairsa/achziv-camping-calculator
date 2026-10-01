// Run: node tests/calc.test.js
const assert = require('assert');
global.window = {};
require('../prices.js'); require('../calc.js');
const K = window.CampCalc;
const counts = (o) => Object.assign({ adult:0, child:0, toddler:0, matmonAdult:0, matmonChild:0, reserveAdult:0,
  reserveChild:0, soldier:0, student:0, senior:0, idfDisabled:0, escort:0, mattress:0 }, o);

assert.strictEqual(K.nightsBetween('2026-10-06', '2026-10-10'), 4);
assert.strictEqual(K.dm('2026-10-06'), '06/10');

// 2 adults + 2 kids + toddler, 4 nights: full 4*(152+116)=1072, group 4*(130+98)=912
let r = K.calcPeriod(counts({ adult:2, child:2, toddler:1 }), 4);
assert.strictEqual(r.full, 1072); assert.strictEqual(r.group, 912);

// discounted people never get the group rate (no double discounts); mattress per night
r = K.calcPeriod(counts({ matmonAdult:2, senior:1, mattress:2 }), 2);
assert.strictEqual(r.full, 2*(114+38+24)); assert.strictEqual(r.group, r.full);

// split stay: base family 6-7, custom smaller family 9-10
const st = { base: counts({ adult:2, child:1 }), periods: [
  { from:'2026-10-06', to:'2026-10-07', custom:false, counts: counts({}) },
  { from:'2026-10-09', to:'2026-10-10', custom:true,  counts: counts({ adult:1 }) } ] };
const a = K.calcAll(st);
assert.strictEqual(a.full, 210 + 76); assert.strictEqual(a.group, 179 + 65); assert.strictEqual(a.maxPeople, 3);
assert.deepStrictEqual(K.warnings(st), []);

// warnings: reversed dates, >6 nights, overlap
st.periods[1] = { from:'2026-10-06', to:'2026-10-13', custom:false, counts: counts({}) };
const w = K.warnings(st);
assert.ok(w.some(x => x.includes('6 לילות'))); assert.ok(w.some(x => x.includes('חופפות')));
st.periods[1] = { from:'2026-10-09', to:'2026-10-08', custom:false, counts: counts({}) };
assert.ok(K.warnings(st).some(x => x.includes('אחרי')));
console.log('all calc tests passed');
