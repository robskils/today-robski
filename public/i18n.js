/* Daybook public-site language switcher.
   Each page declares window.__lang (its language) and window.__alts (a map of
   lang -> the equivalent page's URL). In the nav it renders as a compact
   dropdown (saves space with the longer Latin labels); elsewhere (the footer)
   it renders as inline links. The choice is saved in a db_lang cookie the
   worker reads to auto-route the apex. */
(function () {
  var A = window.__alts || {}, L = window.__lang || 'en';
  var NAME = { en: 'EN', pt: 'PT', fr: 'FR', es: 'ES' };
  var FULL = { en: 'English', pt: 'Português', fr: 'Français', es: 'Español' };
  var ORDER = ['en', 'pt', 'fr', 'es'];
  function remember(l) { try { document.cookie = 'db_lang=' + l + '; path=/; max-age=31536000; samesite=lax'; } catch (e) {} }
  remember(L);
  function link(l, role) {
    var a = document.createElement('a');
    a.href = A[l]; a.title = FULL[l];
    a.setAttribute('hreflang', l === 'pt' ? 'pt-PT' : l);
    a.setAttribute('lang', l);
    if (role) a.setAttribute('role', role);
    a.addEventListener('click', function () { remember(l); });
    return a;
  }
  function inline(el) {
    el.innerHTML = '';
    ORDER.forEach(function (l) {
      if (!A[l]) return;
      var a = link(l); a.textContent = NAME[l];
      if (l === L) { a.className = 'on'; a.setAttribute('aria-current', 'true'); }
      el.appendChild(a);
    });
  }
  function dropdown(el) {
    el.innerHTML = '';
    el.classList.add('lang-dd');
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'lang-btn';
    btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', 'Language: ' + FULL[L]);
    btn.innerHTML = NAME[L] + ' <span class="lang-caret" aria-hidden="true">▾</span>';
    var menu = document.createElement('div');
    menu.className = 'lang-menu'; menu.setAttribute('role', 'menu');
    ORDER.forEach(function (l) {
      if (!A[l]) return;
      var a = link(l, 'menuitem'); a.textContent = FULL[l];
      if (l === L) a.className = 'on';
      menu.appendChild(a);
    });
    function close() { el.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      var open = el.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', function (e) { if (!el.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    el.appendChild(btn); el.appendChild(menu);
  }
  document.querySelectorAll('.lang-switch').forEach(function (el) {
    if (el.closest('nav')) dropdown(el); else inline(el);
  });
})();
