/**
 * /js/foot.js: shared end-of-body block.
 *
 * Put this as the LAST thing in <body> on every page:
 *   <script src="/js/foot.js"></script>      <!-- synchronous, NOT defer -->
 *
 * Optional per-page settings (set before this script):
 *   window.PAGE = {
 *     skipScripts:  ['/js/parallax.js'],        // don't load these on this page
 *     extraScripts: ['/js/contact-form.js']     // load these after the defaults
 *   };
 */
(function () {
  var P = window.PAGE || {};
  var skip = P.skipScripts || [];
  var extra = P.extraScripts || [];

  // Order matters: search-index.js must come before search.js.
  var scripts = [
    { src: '/js/footer.js', defer: false },   // fills #site-footer, so it runs immediately
    { src: '/js/cms.js', defer: true },
    { src: '/js/form-source-tracking.js', defer: true },
    { src: '/js/animations.js', defer: true },
    { src: '/js/parallax.js', defer: true },
    { src: '/js/accessibility.js', defer: true },
    { src: '/js/search-index.js', defer: true },
    { src: '/js/search.js', defer: true }
  ];

  extra.forEach(function (src) { scripts.push({ src: src, defer: true }); });

  var html = '<div id="site-footer"></div>';
  scripts.forEach(function (s) {
    if (skip.indexOf(s.src) !== -1) return;
    html += '<script src="' + s.src + '"' + (s.defer ? ' defer' : '') + '><\/script>';
  });

  // document.write keeps the scripts "parser-inserted", so defer ordering and
  // DOMContentLoaded timing behave exactly as if they were written in the HTML.
  document.write(html);
})();