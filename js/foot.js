
/**
 * /js/foot.js
 * Shared end-of-body scripts for all pages.
 *
 * Place this as the last script before </body>:
 * <script src="/js/foot.js"></script>
 */
(function () {
  var P = window.PAGE || {};
  var skip = P.skipScripts || [];
  var extra = P.extraScripts || [];

  // Create footer container before loading footer.js
  if (!document.getElementById('site-footer')) {
    var footer = document.createElement('div');
    footer.id = 'site-footer';
    document.body.appendChild(footer);
  }

  // Maintain execution order while allowing parallel downloads
var scripts = [
  { src: '/js/cms.js', defer: true },
  { src: '/js/form-source-tracking.js', defer: true },
  { src: '/js/animations.js', defer: true },
  { src: '/js/parallax.js', defer: true },
  { src: '/js/accessibility.js', defer: true },
  { src: '/js/search-index.js', defer: true },
  { src: '/js/search.js', defer: true }
];

  // Add additional page-specific scripts
  extra.forEach(function (src) {
    scripts.push(src);
  });

  // Remove scripts excluded on individual pages
  scripts = scripts.filter(function (src, index) {
    return skip.indexOf(src) === -1 &&
           scripts.indexOf(src) === index;
  });

  // Load scripts in order; downloads can happen in parallel
  scripts.forEach(function (src) {
    var script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.body.appendChild(script);
  });

})();
