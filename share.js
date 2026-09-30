// Share the site with other families: the header button, and a modal once after the first registration on this
// device. navigator.share where the device has it (phones), otherwise WhatsApp or copying the link. The shared text
// carries no personal data. Plan: docs/tour-plan.md §4.3.
(function () {
  var KEY = 'achziv-shared-offer';
  var LIVE = 'https://yairsa.github.io/achziv-camping-calculator/';
  var URL_ = /^https?:/.test(location.protocol) ? location.href.split(/[?#]/)[0] : LIVE;
  var TEXT = 'קמפינג הקבוצה באכזיב, 06/10 עד 13/10: מחשבון עלות הלינה, רשימת ציוד, פעילויות וטיפים';
  var off = window.ACHZIV_NOTOUR || /[?&]notour\b/.test(location.search);
  function $(id) { return document.getElementById(id); }
  var canShare = !!navigator.share;

  function nativeShare() {
    return navigator.share({ title: document.title, text: TEXT, url: URL_ }).catch(function () { /* cancelled */ });
  }
  function copy(msgEl) {
    var done = function () { msgEl.textContent = 'הקישור הועתק.'; };
    var t = TEXT + '\n' + URL_;
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, fallback);
    else fallback();
    function fallback() {
      var a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select();
      try { document.execCommand('copy'); done(); } catch (e) { msgEl.textContent = 'לא הצלחנו להעתיק. העתיקו את כתובת הדף.'; }
      a.remove();
    }
  }
  // the WhatsApp and copy buttons, for devices with no share sheet
  function actions(prefix) {
    return '<a class="btn-secondary" id="' + prefix + '-wa" target="_blank" rel="noopener" href="https://wa.me/?text=' +
      encodeURIComponent(TEXT + '\n' + URL_) + '">שליחה בוואטסאפ</a>' +
      '<button type="button" class="btn-secondary" id="' + prefix + '-copy">העתקת הקישור</button>';
  }

  // ---------- the header button ----------
  var btn = $('share-btn'), menu = $('share-menu');
  menu.innerHTML = '<div class="actions">' + actions('share') + '</div><p class="msg good" id="share-msg" role="status" aria-live="polite"></p>';
  $('share-copy').addEventListener('click', function () { copy($('share-msg')); });
  function openMenu(on) { menu.hidden = !on; btn.setAttribute('aria-expanded', on); if (on) $('share-msg').textContent = ''; }
  btn.addEventListener('click', function () {
    if (canShare) nativeShare(); else openMenu(menu.hidden);
  });
  document.addEventListener('click', function (e) {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) openMenu(false);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { openMenu(false); btn.focus(); } });

  // ---------- after the first registration ----------
  var dlg = $('share-dlg');
  $('share-dlg-actions').innerHTML = (canShare ? '<button type="button" class="btn-primary" id="share-dlg-go">שיתוף</button>' : actions('share-dlg')) +
    '<button type="button" class="btn-link" id="share-dlg-no">לא עכשיו</button>';
  if (canShare) $('share-dlg-go').addEventListener('click', function () { nativeShare().then(function () { dlg.close(); }); });
  else $('share-dlg-copy').addEventListener('click', function () { copy($('share-dlg-msg')); });
  $('share-dlg-no').addEventListener('click', function () { dlg.close(); });
  function offered() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }
  document.addEventListener('registered', function () {
    if (off || offered()) return;
    try { localStorage.setItem(KEY, '1'); } catch (e) { /* ignore */ }
    $('share-dlg-msg').textContent = '';
    dlg.showModal();
  });
})();
