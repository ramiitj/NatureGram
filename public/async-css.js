// Apply stylesheets marked data-async-css once loaded, so they never block the first paint.
// Every icon is an inline Glyph now, so there is no icon font to wait for; .icons-ready stays for
// anything that still keys off it.
(function () {
  document.documentElement.classList.add('icons-ready');
  document.querySelectorAll('link[data-async-css]').forEach(function (l) {
    var on = function () { l.media = 'all'; };
    if (l.sheet) on(); else l.addEventListener('load', on);
  });
})();
