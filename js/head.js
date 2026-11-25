/**
 * /js/head.js: dynamic <head> for static HTML pages.
 *
 * Each page only needs:
 *   <meta charset="UTF-8">
 *   <meta name="viewport" content="width=device-width, initial-scale=1.0">
 *   <script>window.PAGE = { ... };</script>
 *   <script src="/js/head.js"></script>      <!-- synchronous, NOT defer -->
 */
(function () {
  var SITE = {
    baseUrl: 'https://network-consultancy.com',
    name: 'Network Consultancy',
    gtmId: 'GTM-PVKBZV7',
    gscToken: 'UMvzdXxOFVqZL5BV0Z31FdlaoXjKmD450rZ5TB-qWXI',
    ogImage: '/images/misc/it-networking.jpg'
  };

  var P = Object.assign({
    title: SITE.name,
    description: '',
    path: location.pathname.replace(/\/$/, '') || '/',
    ogTitle: null,
    ogDescription: null,
    ogImage: SITE.ogImage,
    ogType: 'website',
    breadcrumbs: [],   // [['Home','/'],['Industries','/industries']]
    schema: [],        // extra JSON-LD objects
    debug: false
  }, window.PAGE || {});

  var head = document.head;
  var abs = function (p) { return /^https?:\/\//.test(p) ? p : SITE.baseUrl + p; };
  var canonical = abs(P.path);

  function meta(attr, key, content) {
    var m = document.createElement('meta');
    m.setAttribute(attr, key);
    m.setAttribute('content', content);
    head.appendChild(m);
  }
  function link(attrs) {
    var l = document.createElement('link');
    for (var k in attrs) l.setAttribute(k, attrs[k]);
    head.appendChild(l);
    return l;
  }
  function script(attrs, text) {
    var s = document.createElement('script');
    for (var k in attrs) s.setAttribute(k, attrs[k]);
    if (text) s.textContent = text;
    head.appendChild(s);
    return s;
  }

  // Title & description
  document.title = P.title;
  meta('name', 'description', P.description);
  meta('name', 'google-site-verification', SITE.gscToken);
  link({ rel: 'canonical', href: canonical });

  // Open Graph
  meta('property', 'og:type', P.ogType);
  meta('property', 'og:url', canonical);
  meta('property', 'og:title', P.ogTitle || P.title);
  meta('property', 'og:description', P.ogDescription || P.description);
  meta('property', 'og:site_name', SITE.name);
  meta('property', 'og:image', abs(P.ogImage));

  // Icons
  link({ rel: 'icon', type: 'image/png', sizes: '32x32', href: '/images/misc/favicon-32.png' });
  link({ rel: 'apple-touch-icon', sizes: '180x180', href: '/images/misc/favicon-180.png' });

  // JSON-LD (breadcrumbs auto-built + any extra schema)
  var schemas = [];
  if (P.breadcrumbs.length) {
    schemas.push({
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      '@id': canonical + '#breadcrumb',
      itemListElement: P.breadcrumbs.map(function (b, i) {
        return { '@type': 'ListItem', position: i + 1, name: b[0], item: abs(b[1]) };
      })
    });
  }
  schemas = schemas.concat(P.schema);
  if (schemas.length) {
    script({ type: 'application/ld+json' }, JSON.stringify(schemas));
  }

  // Optional debug
  if (P.debug) {
    window.addEventListener('error', function (e) {
      if (String(e.message).indexOf('toLowerCase') !== -1) {
        console.warn('toLowerCase error →', e.filename, 'line', e.lineno, 'col', e.colno);
        console.warn(e.error && e.error.stack);
      }
    });
  }

  // Google Tag Manager
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  script({ async: '', src: 'https://www.googletagmanager.com/gtm.js?id=' + SITE.gtmId });

  // Styles & scripts
  link({ rel: 'stylesheet', href: '/css/global.css' });
  var anim = link({ rel: 'stylesheet', href: '/css/animations.css', media: 'print' });
  anim.onload = function () { anim.media = 'all'; };   // non-blocking, same as your preload trick
  script({ src: '/js/schema.js', defer: '' });
})();
