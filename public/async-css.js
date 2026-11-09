// Apply stylesheets marked data-async-css once loaded, so they never block the first paint.
document.querySelectorAll('link[data-async-css]').forEach(function (l) {
  var on = function () { l.media = 'all'; };
  if (l.sheet) on(); else l.addEventListener('load', on);
});
