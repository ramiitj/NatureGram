// Apply stylesheets marked data-async-css once loaded, so they never block the first paint.
// Icon names (Material Symbols ligatures) stay invisible until the icon font is ready (see index.css),
// then html gets .icons-ready. A 3 s fallback makes sure icons never stay hidden.
(function () {
  var root = document.documentElement;
  var ready = function () { root.classList.add('icons-ready'); };
  setTimeout(ready, 3000);
  var waitForIcons = function () {
    if (!document.fonts || !document.fonts.load) { ready(); return; }
    document.fonts.load('24px "Material Symbols Outlined"', 'home').then(function (faces) {
      if (faces && faces.length) ready();
    }, ready);
  };
  document.querySelectorAll('link[data-async-css]').forEach(function (l) {
    var isIcons = l.href.indexOf('Material+Symbols') !== -1;
    var on = function () { l.media = 'all'; if (isIcons) waitForIcons(); };
    if (l.sheet) on(); else { l.addEventListener('load', on); if (isIcons) l.addEventListener('error', ready); }
  });
})();
