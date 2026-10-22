/* Yuvraj Sandhu · Portfolio — vanilla JS, no dependencies. */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

  /* ---------- Footer year ---------- */
  var yearEl = document.querySelector('[data-year]');
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  /* ---------- Theme toggle ---------- */
  var themeBtn = document.querySelector('.theme-toggle');

  function currentTheme() {
    var set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return prefersDark.matches ? 'dark' : 'light';
  }

  function syncThemeButton() {
    if (!themeBtn) return;
    var dark = currentTheme() === 'dark';
    themeBtn.setAttribute('aria-pressed', String(dark));
    themeBtn.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
      syncThemeButton();
    });
    // follow the OS setting live unless the visitor has picked one
    var onSchemeChange = function () { if (!root.hasAttribute('data-theme')) syncThemeButton(); };
    if (prefersDark.addEventListener) prefersDark.addEventListener('change', onSchemeChange);
    syncThemeButton();
  }

  /* ---------- Mobile navigation ---------- */
  var navToggle = document.querySelector('.nav-toggle');
  var navMenu = document.getElementById('nav-menu');
  var desktopNav = window.matchMedia('(min-width: 1000px)');

  function setMenu(open) {
    if (!navToggle || !navMenu) return;
    navToggle.setAttribute('aria-expanded', String(open));
    navMenu.classList.toggle('is-open', open);
  }

  if (navToggle && navMenu) {
    navToggle.addEventListener('click', function () {
      setMenu(navToggle.getAttribute('aria-expanded') !== 'true');
    });
    navMenu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && navToggle.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        navToggle.focus();
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.site-nav')) setMenu(false);
    });
    var onBreakpoint = function () { if (desktopNav.matches) setMenu(false); };
    if (desktopNav.addEventListener) desktopNav.addEventListener('change', onBreakpoint);
  }

  /* ---------- Header shadow once scrolled ---------- */
  var header = document.querySelector('.site-header');
  if (header) {
    var onScroll = function () { header.classList.toggle('is-scrolled', window.scrollY > 8); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  var hasIO = 'IntersectionObserver' in window;

  /* ---------- Scrollspy: mark the nav link for the section in view ---------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav-menu a[href^="#"]'));
  var sections = navLinks
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if (hasIO && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = '#' + entry.target.id;
        navLinks.forEach(function (a) {
          if (a.getAttribute('href') === id) a.setAttribute('aria-current', 'location');
          else a.removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- Reveal on scroll ---------- */
  var revealEls = document.querySelectorAll('[data-reveal]');
  if (!hasIO || reduceMotion.matches) {
    Array.prototype.forEach.call(revealEls, function (el) { el.classList.add('is-visible'); });
  } else {
    var revealer = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    Array.prototype.forEach.call(revealEls, function (el) { revealer.observe(el); });
  }

  /* ---------- Oscilloscope traces ----------
     CH1: FM signal  y = sin(2π·fc·x/W + β·sin(2π·x/W))
     CH2: its demodulated message, proportional to the instantaneous
          frequency deviation, i.e. cos(2π·x/W).
     fc is a whole number of cycles per W, so the drawing repeats every W
     and the CSS translateX(-W) loop is seamless. */
  var W = 400, FC = 11, BETA = 4.5;
  function tracePath(fn) {
    var d = '';
    for (var x = 0; x <= 2 * W; x += 1) {
      d += (x === 0 ? 'M' : 'L') + x + ' ' + fn(x).toFixed(2);
    }
    return d;
  }
  var t1 = document.getElementById('trace-1');
  var t1g = document.getElementById('trace-1-glow');
  var t2 = document.getElementById('trace-2');
  if (t1 && t2) {
    var fm = tracePath(function (x) {
      var p = 2 * Math.PI * x / W;
      return 88 + 52 * Math.sin(FC * p + BETA * Math.sin(p));
    });
    t1.setAttribute('d', fm);
    if (t1g) t1g.setAttribute('d', fm);
    t2.setAttribute('d', tracePath(function (x) {
      return 192 - 26 * Math.cos(2 * Math.PI * x / W);
    }));
  }

  // pause the sweep while the scope is off-screen
  var scope = document.querySelector('.scope');
  if (scope && hasIO) {
    new IntersectionObserver(function (entries) {
      scope.classList.toggle('is-paused', !entries[0].isIntersecting);
    }).observe(scope);
  }

  /* ---------- Remote image fallback ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('img[data-fallback]'), function (img) {
    var markMissing = function () {
      var fig = img.closest('figure');
      if (fig) fig.classList.add('is-missing');
    };
    if (img.complete && img.naturalWidth === 0) markMissing();
    else img.addEventListener('error', markMissing, { once: true });
  });
})();
