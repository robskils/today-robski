/* Daybook public-site language switcher.
   Each page declares window.__lang (its language) and window.__alts (a map of
   lang -> the equivalent page's URL). This renders any .lang-switch element and
   remembers the choice in a cookie the worker reads to auto-route the apex. */
(function () {
  var A = window.__alts || {}, L = window.__lang || 'en';
  var NAME = { en: 'EN', pt: 'PT', fr: 'FR', es: 'ES' };
  var FULL = { en: 'English', pt: 'Português', fr: 'Français', es: 'Español' };
  var ORDER = ['en', 'pt', 'fr', 'es'];
  function remember(l) { try { document.cookie = 'db_lang=' + l + '; path=/; max-age=31536000; samesite=lax'; } catch (e) {} }
  remember(L);
  function fill(el) {
    el.innerHTML = '';
    ORDER.forEach(function (l) {
      if (!A[l]) return;
      var a = document.createElement('a');
      a.href = A[l]; a.textContent = NAME[l]; a.title = FULL[l];
      a.setAttribute('hreflang', l === 'pt' ? 'pt-PT' : l);
      a.setAttribute('lang', l);
      if (l === L) { a.className = 'on'; a.setAttribute('aria-current', 'true'); }
      a.addEventListener('click', function () { remember(l); });
      el.appendChild(a);
    });
  }
  document.querySelectorAll('.lang-switch').forEach(fill);
})();
