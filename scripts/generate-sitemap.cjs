
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://network-consultancy.com";
const ROOT_DIR = path.resolve(__dirname, "..");
const OUTPUT_FILE = path.join(ROOT_DIR, "sitemap.xml");

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  ".vercel",
  "dist",
  "build"
]);

const EXCLUDED_FILES = new Set([
  "404.html",
  "500.html",
  "thank-you.html",
  "test.html"
]);

// CMS blog URLs that are not represented by physical HTML files.
const CMS_BLOG_SLUGS = [
  "identify-network-security-weaknesses",
  "network-infrastructure-decisions-before-scaling",
  "identify-network-capacity-problems-before-downtime",
  "it-support-companies-birmingham-break-fix-managed-it",
  "business-network-slows-down-as-company-grows",
  "remote-team-connectivity-problems",
  "network-design-deployment-services",
  "network-design-and-implementation"
];

// Read all HTML files recursively.
function getHtmlFiles(directory, results = []) {
  const entries = fs.readdirSync(directory, {
    withFileTypes: true
  });

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        getHtmlFiles(fullPath, results);
      }
    } else if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith(".html")
    ) {
      results.push(fullPath);
    }
  }

  return results;
}

// Escape XML special characters.
function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, character => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;"
  })[character]);
}

// Read HTML attributes regardless of their order.
function getAttributes(tag) {
  const attributes = {};

  const regex =
    /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;

  let match;

  while ((match = regex.exec(tag)) !== null) {
    attributes[match[1].toLowerCase()] =
      match[2] ?? match[3] ?? match[4] ?? "";
  }

  return attributes;
}

// Check whether a page should be excluded.
function isNoindex(html) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];

  for (const tag of metaTags) {
    const attributes = getAttributes(tag);
    const name = (attributes.name || "").toLowerCase();

    if (
      ["robots", "googlebot"].includes(name) &&
      /\bnoindex\b/i.test(attributes.content || "")
    ) {
      return true;
    }
  }

  return false;
}

// Extract canonical URL.
function getCanonical(html) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];

  for (const tag of linkTags) {
    const attributes = getAttributes(tag);

    const rel = (attributes.rel || "")
      .toLowerCase()
      .split(/\s+/);

    if (rel.includes("canonical") && attributes.href) {
      try {
        return new URL(attributes.href, BASE_URL).href;
      } catch {
        return null;
      }
    }
  }

  return null;
}

// Convert physical HTML paths into website URLs.
function getPageUrl(file) {
  const relativePath = path.relative(ROOT_DIR, file)
    .split(path.sep)
    .join("/");

  let urlPath;

  if (relativePath.toLowerCase() === "index.html") {
    urlPath = "/";
  } else if (/\/index\.html$/i.test(relativePath)) {
    urlPath = "/" + relativePath.replace(/\/index\.html$/i, "/");
  } else {
    urlPath = "/" + relativePath.replace(/\.html$/i, "");
  }

  return new URL(urlPath, BASE_URL).href;
}

// Generate the sitemap.
function generateSitemap() {
  const urlMap = new Map();
  const excludedUrls = new Set();

  // ----------------------------------
  // 1. Collect static HTML pages
  // ----------------------------------

  console.log("Scanning static HTML pages...");

  const files = getHtmlFiles(ROOT_DIR);

  let staticCount = 0;

  for (const file of files) {
    const filename = path.basename(file).toLowerCase();

    if (EXCLUDED_FILES.has(filename)) continue;

    const html = fs.readFileSync(file, "utf8");

    const canonical = getCanonical(html);
    const physicalUrl = getPageUrl(file);

    // Exclude noindex pages.
    if (isNoindex(html)) {
      excludedUrls.add(physicalUrl);

      if (canonical) {
        excludedUrls.add(canonical);
      }

      continue;
    }

    const pageUrl = canonical || physicalUrl;

    let parsedUrl;

    try {
      parsedUrl = new URL(pageUrl);
    } catch {
      console.warn("Invalid URL skipped:", pageUrl);
      continue;
    }

    if (parsedUrl.origin !== BASE_URL) continue;
    if (parsedUrl.search || parsedUrl.hash) continue;

    const finalUrl = parsedUrl.href;

    const lastModified = fs.statSync(file).mtime.toISOString();

    urlMap.set(finalUrl, {
      loc: finalUrl,
      lastmod: lastModified
    });

    staticCount++;
  }

  // ----------------------------------
  // 2. Add manually maintained CMS blogs
  // ----------------------------------

  let blogCount = 0;

  console.log("Adding manually maintained CMS blog URLs...");

  for (const slug of CMS_BLOG_SLUGS) {
    const blogUrl = new URL(
      "/resources/blogs/" + encodeURIComponent(slug),
      BASE_URL
    ).href;

    if (excludedUrls.has(blogUrl)) {
      console.log("Skipping noindex blog:", blogUrl);
      continue;
    }

    if (!urlMap.has(blogUrl)) {
      blogCount++;

      urlMap.set(blogUrl, {
        loc: blogUrl,
        lastmod: null
      });
    }
  }

  // ----------------------------------
  // 3. Sort and prepare XML
  // ----------------------------------

  const pages = [...urlMap.values()]
    .sort((a, b) => a.loc.localeCompare(b.loc));

  if (pages.length > 50000) {
    throw new Error(
      "More than 50,000 URLs found. A sitemap index is required."
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(page => `  <url>
    <loc>${escapeXml(page.loc)}</loc>${page.lastmod ? `
    <lastmod>${escapeXml(page.lastmod)}</lastmod>` : ""}
  </url>`).join("\n")}
</urlset>
`;

  // ----------------------------------
  // 4. Write sitemap.xml
  // ----------------------------------

  fs.writeFileSync(OUTPUT_FILE, xml, "utf8");

  console.log("-----------------------------------");
  console.log("XML Sitemap generated successfully");
  console.log("Website:", BASE_URL);
  console.log("Static HTML URLs:", staticCount);
  console.log("CMS blog URLs added:", blogCount);
  console.log("Total unique URLs:", pages.length);
  console.log("Output:", OUTPUT_FILE);
  console.log("-----------------------------------");
}

// Run sitemap generation.
try {
  generateSitemap();
} catch (error) {
  console.error("Sitemap generation failed:", error.message);
  process.exit(1);
}