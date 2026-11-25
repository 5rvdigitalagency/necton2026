import sanitizeHtml from 'sanitize-html';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ARTICLE_HTML_LENGTH = 150000;

function stringField(value, field, maximum, errors, required = true) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (required && !normalized) errors[field] = 'This field is required.';
  if (normalized.length > maximum) errors[field] = `Use at most ${maximum} characters.`;
  return normalized;
}

const SAFE_STYLE_VALUE = [/^(?!.*(?:url\s*\(|expression\s*\(|javascript:|@import)).*$/i];
const STYLE_PROPERTIES = [
  'color', 'background-color', 'background', 'border', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-collapse', 'border-spacing', 'padding',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin',
  'margin-top', 'margin-bottom', 'text-align', 'vertical-align', 'font-weight',
  'font-style', 'font-size', 'font-family', 'line-height', 'text-decoration', 'width',
  'height', 'min-width', 'max-width', 'overflow-x', 'table-layout'
];

export function sanitizeArticleHtml(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [
      'a', 'b', 'blockquote', 'br', 'caption', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3',
      'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 's', 'span', 'strike',
      'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'class', 'title'],
      img: ['src', 'alt', 'width', 'height'],
      div: ['class', 'style'],
      p: ['style'], h1: ['style'], h2: ['style'], h3: ['style'],
      h4: ['style'], h5: ['style'], h6: ['style'], li: ['style'],
      blockquote: ['style'], span: ['style'],
      table: ['border', 'cellpadding', 'cellspacing', 'width', 'style'],
      thead: ['style'], tbody: ['style'], tfoot: ['style'], tr: ['style'],
      th: ['scope', 'colspan', 'rowspan', 'align', 'valign', 'style'],
      td: ['colspan', 'rowspan', 'align', 'valign', 'style']
    },
    allowedClasses: { a: ['article-cta'], div: ['table-wrap'] },
    allowedStyles: {
      '*': Object.fromEntries(STYLE_PROPERTIES.map((property) => [property, SAFE_STYLE_VALUE]))
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true)
    }
  }).trim();
}

export function validateRevisionInput(input, { allowSlug = false } = {}) {
  const errors = {};
  let schemaMarkup = null;
  const revision = {
    title: stringField(input.title, 'title', 180, errors),
    excerpt: stringField(input.excerpt, 'excerpt', 360, errors),
    category: stringField(input.category, 'category', 80, errors),
    featuredImageUrl: stringField(input.featuredImageUrl, 'featuredImageUrl', 2048, errors),
    featuredImageAlt: stringField(input.featuredImageAlt, 'featuredImageAlt', 250, errors, false),
    seoTitle: stringField(input.seoTitle || input.title, 'seoTitle', 180, errors),
    seoDescription: stringField(input.seoDescription || input.excerpt, 'seoDescription', 360, errors)
  };
  const rawArticleHtml = typeof input.articleHtml === 'string' ? input.articleHtml : '';
  if (!rawArticleHtml.trim()) errors.articleHtml = 'Article content is required.';
  if (rawArticleHtml.length > MAX_ARTICLE_HTML_LENGTH) {
    errors.articleHtml = `Use at most ${MAX_ARTICLE_HTML_LENGTH} characters.`;
  }
  revision.articleHtml = sanitizeArticleHtml(rawArticleHtml);
  if (!revision.articleHtml) errors.articleHtml = 'Article content must contain allowed HTML.';

  if (typeof input.schemaMarkup === 'string' && input.schemaMarkup.trim()) {
    try {
      schemaMarkup = JSON.parse(input.schemaMarkup);
      if (!schemaMarkup || typeof schemaMarkup !== 'object' || Array.isArray(schemaMarkup)) {
        errors.schemaMarkup = 'Schema markup must be a JSON object.';
      }
    } catch {
      errors.schemaMarkup = 'Schema markup must be valid JSON.';
    }
  }
  revision.schemaMarkup = schemaMarkup;

  if (allowSlug) {
    revision.publicSlug = stringField(input.publicSlug, 'publicSlug', 120, errors).toLowerCase();
    if (revision.publicSlug && !SLUG_PATTERN.test(revision.publicSlug)) {
      errors.publicSlug = 'Use lowercase letters, numbers, and single hyphens only.';
    }
  }

  for (const urlField of ['featuredImageUrl']) {
    if (revision[urlField] && !/^https:\/\/|^\//.test(revision[urlField])) {
      errors[urlField] = 'Use an HTTPS or site-relative image URL.';
    }
  }
  return { errors, revision };
}