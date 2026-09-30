// Word search for tips — shared by the site and the backend.
// The site loads it with a <script> tag; backend/build.py inlines it into Code.gs at `//@include search.js`,
// so the backend's "דומה ל…" column and the site's live "similar tips" panel agree.
//
// Word-based, not meaning-based: "אוהל" does not find "יריעה". To stop Hebrew spelling from hiding
// matches it drops niqqud, treats final letters as regular ones, and tries each word without up to two
// prefix letters (ה ו ב ל מ ש כ), so "והאוהלים" still meets "אוהלים".

var SEARCH_FINALS_ = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
var SEARCH_PREFIX_ = 'הובלמשכ';
var SEARCH_STOP_ = ' של על את עם זה זו גם לא כי אם או יש אין הוא היא הם הן כל מה רק עוד אבל אז אני אנחנו אתם ' +
  'לכם להם לנו שלנו שלכם כמו מאוד כדאי ממש יותר פחות אחרי לפני בין תוך שם פה כאן the and for with ';

// One word or phrase -> lower case, no niqqud, no final letters, letters and digits only.
function searchNorm_(s) {
  return String(s == null ? '' : s).toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/[ךםןףץ]/g, function (c) { return SEARCH_FINALS_[c]; })
    .replace(/[^0-9a-zא-ת]+/g, ' ').trim();
}

// Text -> distinct meaningful words (stop words and one-letter words dropped).
// The stop list goes through the same normaliser, or "עם" (now "עמ") would slip through.
var searchStop_ = null;
function searchWords_(s) {
  var seen = {}, out = [];
  if (!searchStop_) searchStop_ = ' ' + searchNorm_(SEARCH_STOP_) + ' ';
  searchNorm_(s).split(' ').forEach(function (w) {
    if (w.length < 2 || seen[w] || searchStop_.indexOf(' ' + w + ' ') >= 0) return;
    seen[w] = true; out.push(w);
  });
  return out;
}

// A word and the same word without its prefix letters, as long as 3 letters remain.
// A second prefix only after ו or ש, or when it is ה ("והאוהל", "שבחוף", "מהחוף") —
// otherwise "בלילה" would lose the ל of "לילה" too.
function searchForms_(w) {
  var out = [w], p = SEARCH_PREFIX_;
  if (w.length > 3 && p.indexOf(w.charAt(0)) >= 0) {
    out.push(w.slice(1));
    if (w.length > 4 && p.indexOf(w.charAt(1)) >= 0 && ('וש'.indexOf(w.charAt(0)) >= 0 || w.charAt(1) === 'ה')) out.push(w.slice(2));
  }
  return out;
}

// Does query word q appear among the forms of the text words? A query form of 3+ letters also
// matches the start of a longer word, so the list narrows while the last word is still being typed.
function searchHit_(q, textForms) {
  var qf = searchForms_(q);
  for (var i = 0; i < qf.length; i++) {
    for (var j = 0; j < textForms.length; j++) {
      var t = textForms[j];
      if (t === qf[i] || (qf[i].length >= 3 && t.length > qf[i].length && t.indexOf(qf[i]) === 0)) return true;
    }
  }
  return false;
}

function searchFormsOf_(text) {
  var out = [];
  searchWords_(text).forEach(function (w) { out.push.apply(out, searchForms_(w)); });
  return out;
}

// Tips matching every word of the query (title, text and category), in their original order.
function searchTips_(query, tips) {
  var q = searchWords_(query);
  if (!q.length) return tips.slice();
  return tips.filter(function (t) {
    var forms = searchFormsOf_([t.title, t.text, t.category].join(' '));
    return q.every(function (w) { return searchHit_(w, forms); });
  });
}

// The n tips sharing the most words with a draft (title words count double).
// Returns [{tip, score}], best first; tips sharing nothing are left out.
function similarTips_(title, text, tips, n) {
  var tq = searchWords_(title), xq = searchWords_(text).filter(function (w) { return tq.indexOf(w) < 0; });
  if (!tq.length && !xq.length) return [];
  var scored = tips.map(function (t) {
    var forms = searchFormsOf_(t.title + ' ' + t.text), score = 0;
    tq.forEach(function (w) { if (searchHit_(w, forms)) score += 2; });
    xq.forEach(function (w) { if (searchHit_(w, forms)) score += 1; });
    return { tip: t, score: score };
  }).filter(function (s) { return s.score > 0; });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, n || 3);
}
