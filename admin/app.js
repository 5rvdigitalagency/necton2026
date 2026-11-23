(async function () {
  'use strict';

  /* ------------------------------------------------------------------
   * Elements & state
   * ---------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  const elements = {
    auth: $('cms-auth'), setup: $('cms-setup'), setupMessage: $('cms-setup-message'),
    workspace: $('cms-workspace'), session: $('cms-session'), connection: $('cms-connection'),
    newPost: $('new-post-button'), editor: $('editor-panel'), form: $('article-form'),
    list: $('post-list'), search: $('post-search'), preview: $('preview-dialog'),
    previewContent: $('preview-content'), saveStatus: $('save-status'), publishLive: $('publish-live-button')
  };
  const articleEditor = $('article-editor');
  const articleHtmlField = document.querySelector('[name="articleHtml"]');
  const articleEditorImage = $('article-editor-image');
  const articleHtmlSourcePanel = $('article-html-source-panel');
  const articleHtmlSource = $('article-html-source');
  const deleteArticleDialog = $('delete-article-dialog');
  const blockFormat = $('article-block-format');

  let cmsUser = null;
  let posts = [];
  let currentPost = null;
  let articleHtmlSourceOpen = false;
  let articleEditorSelection = null;
  let pendingDeletionSlug = null;
  let dirty = false;          // unsaved changes in the editor
  let slugTouched = false;    // user typed their own slug
  let saving = false;

  // Hidden required fields block form submit silently, so validate the body in JS instead.
  articleHtmlField.required = false;
  // Make Enter create <p> instead of <div>.
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) { /* ignore */ }

  /* ------------------------------------------------------------------
   * Helpers
   * ---------------------------------------------------------------- */
  // Escapes quotes too, so it is safe inside HTML attributes (innerHTML-based escaping is not).
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Returns a safe URL or '' (blocks javascript:, data:, etc.).
  function cleanUrl(value) {
    let url = String(value || '').trim();
    if (!url) return '';
    if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(url) && !/^(https?:|mailto:|tel:|\/|#)/i.test(url)) url = `https://${url}`;
    return /^(https?:|mailto:|tel:|\/|#)/i.test(url) ? url : '';
  }

  function slugify(text) {
    return String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  }

  /* ------------------------------------------------------------------
   * HTML sanitising + normalising (wraps loose text in <p>)
   * ---------------------------------------------------------------- */
  function safePreviewHtml(value) {
    const allowedTags = new Set(['A','ARTICLE','ASIDE','B','BLOCKQUOTE','BR','CAPTION','CODE','DD','DEL','DIV','DL','DT','EM','FIGCAPTION','FIGURE','H1','H2','H3','H4','H5','H6','HR','I','IMG','LI','MARK','OL','P','PRE','S','SECTION','SMALL','SPAN','STRIKE','STRONG','SUB','SUP','TABLE','TBODY','TD','TFOOT','TH','THEAD','TR','U','UL']);
    const globalAttributes = new Set(['class','id','title','role','aria-label','style']);
    const tableAttributes = new Set(['border','cellpadding','cellspacing','width','height','align','valign','colspan','rowspan','scope']);
    const allowedAttributes = { A:new Set(['href','target','rel','class','title']), IMG:new Set(['src','alt','width','height','loading','class']), TD:tableAttributes, TH:tableAttributes, TABLE:tableAttributes, TR:tableAttributes, THEAD:tableAttributes, TBODY:tableAttributes, TFOOT:tableAttributes, CAPTION:tableAttributes, OL:new Set(['start','type']), LI:new Set(['value']) };
    const safeStyleProperties = new Set(['color','background-color','background','border','border-top','border-right','border-bottom','border-left','border-collapse','border-spacing','padding','padding-top','padding-right','padding-bottom','padding-left','text-align','vertical-align','font-weight','font-style','text-decoration','width','height','min-width','max-width']);
    const parsed = new DOMParser().parseFromString(String(value || ''), 'text/html');
    parsed.body.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,meta,link').forEach((node) => node.remove());
    parsed.body.querySelectorAll('*').forEach((node) => {
      if (!allowedTags.has(node.tagName)) { node.replaceWith(...node.childNodes); return; }
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        if (name === 'style') {
          const declarations = [...node.style]
            .filter((property) => safeStyleProperties.has(property) && !/url\s*\(|expression\s*\(|javascript:/i.test(node.style.getPropertyValue(property)))
            .map((property) => `${property}:${node.style.getPropertyValue(property).trim()}`);
          if (declarations.length) node.setAttribute('style', declarations.join('; ')); else node.removeAttribute('style');
        } else if (!globalAttributes.has(name) && !allowedAttributes[node.tagName]?.has(name)) node.removeAttribute(attribute.name);
      });
      if (node.tagName === 'A' && !/^(https?:|mailto:|tel:|\/|#)/i.test(node.getAttribute('href') || '')) node.removeAttribute('href');
      if (node.tagName === 'IMG' && !/^(https?:|\/)/i.test(node.getAttribute('src') || '')) node.remove();
      if (node.tagName === 'A' && node.getAttribute('target') === '_blank') node.setAttribute('rel', 'noopener noreferrer');
    });
    return parsed.body.innerHTML;
  }

  const BLOCK_RE = /^(P|H[1-6]|UL|OL|DL|TABLE|BLOCKQUOTE|HR|PRE|FIGURE|SECTION|ARTICLE|ASIDE)$/;

  function normalizeArticleHtml(html) {
    const root = document.createElement('div');
    root.innerHTML = safePreviewHtml(html); // already sanitised in an inert document

    const out = document.createElement('div');
    let p = null;

    const hasContent = (el) => el.textContent.replace(/\u00a0/g, ' ').trim() !== '' || Boolean(el.querySelector('img,hr,table'));
    const flush = () => { if (p && hasContent(p)) out.appendChild(p); p = null; };
    const isBlock = (n) => n.nodeType === 1 && BLOCK_RE.test(n.tagName);

    function walk(nodes) {
      nodes.forEach((node) => {
        if (node.nodeType === 1 && node.tagName === 'DIV') {
          flush();
          if (node.attributes.length) { out.appendChild(node); return; }           // styled/classed div = layout block, keep as is
          if ([...node.children].some((c) => isBlock(c) || c.tagName === 'DIV')) { walk([...node.childNodes]); return; }
          const np = document.createElement('p');
          np.append(...node.childNodes);
          if (hasContent(np)) out.appendChild(np);
          return;
        }
        if (isBlock(node)) {
          flush();
          if (node.tagName === 'TABLE') {                                            // responsive wrapper for the public site
            const wrap = document.createElement('div');
            wrap.className = 'table-wrap';
            wrap.appendChild(node);
            out.appendChild(wrap);
            return;
          }
          const keepEmpty = !/^(P|H[1-6])$/.test(node.tagName);                     // only drop empty p/headings
          if (keepEmpty || hasContent(node)) out.appendChild(node);
          return;
        }
        if (node.nodeType === 1 && node.tagName === 'BR') { flush(); return; }    // top-level <br> = paragraph break
        if (node.nodeType === 3 && !node.textContent.trim() && !p) return;         // whitespace between blocks
        if (node.nodeType !== 1 && node.nodeType !== 3) return;
        if (!p) p = document.createElement('p');
        p.appendChild(node);
      });
    }

    walk([...root.childNodes]);
    flush();
    return out.innerHTML.trim();
  }

  /* ------------------------------------------------------------------
   * Article editor
   * ---------------------------------------------------------------- */
  function syncArticleEditor() {
    articleHtmlField.value = articleHtmlSourceOpen
      ? articleHtmlSource.value.trim()
      : normalizeArticleHtml(articleEditor.innerHTML);
  }
  function setEditorHtml(html) {
    const clean = normalizeArticleHtml(html || '');
    articleEditor.innerHTML = clean || '<p><br></p>';
    articleHtmlSource.value = clean;
    articleHtmlField.value = clean;
  }
  function ensureParagraph() {
    const html = articleEditor.innerHTML.trim();
    if (html && html !== '<br>') return;
    articleEditor.innerHTML = '<p><br></p>';
    const range = document.createRange();
    range.selectNodeContents(articleEditor.firstChild);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  }
  // Text typed straight into the editor root gets wrapped in <p> immediately.
  function wrapLooseText() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    const node = selection.anchorNode;
    if (node && node.nodeType === Node.TEXT_NODE && node.parentNode === articleEditor) document.execCommand('formatBlock', false, '<p>');
  }
  function rememberArticleEditorSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount && articleEditor.contains(selection.anchorNode)) articleEditorSelection = selection.getRangeAt(0).cloneRange();
  }
  function restoreArticleEditorSelection() {
    articleEditor.focus();
    if (!articleEditorSelection) return;
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(articleEditorSelection);
  }
  function runEditorCommand(command, value = null) {
    restoreArticleEditorSelection();
    document.execCommand(command, false, value);
    syncArticleEditor(); rememberArticleEditorSelection(); dirty = true;
  }
  function insertArticleHtml(html) {
    restoreArticleEditorSelection();
    document.execCommand('insertHTML', false, html);
    syncArticleEditor(); rememberArticleEditorSelection(); dirty = true;
  }
  function insertTable() {
    const rowsInput = parseInt(window.prompt('How many table rows?', '3'), 10);
    if (!rowsInput) return;
    const columnsInput = parseInt(window.prompt('How many table columns?', '3'), 10);
    if (!columnsInput) return;
    const rows = Math.min(20, Math.max(1, rowsInput));
    const columns = Math.min(12, Math.max(1, columnsInput));
    const head = window.confirm('Add a header row?');
    let html = '<table border="1" cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse"><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < columns; c++) html += r === 0 && head ? '<th scope="col">Header</th>' : '<td>Cell</td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    insertArticleHtml(html);
  }

  /* ------------------------------------------------------------------
   * UI helpers
   * ---------------------------------------------------------------- */
  function setConnection(text, isReady) { elements.connection.textContent = text; elements.connection.style.color = isReady ? '#bce6c8' : '#f5d593'; }
  function clearValidationErrors() {
    $('validation-errors').textContent = '';
    [...elements.form.elements].forEach((field) => field.setCustomValidity && field.setCustomValidity(''));
  }
  function showValidationErrors(error) {
    clearValidationErrors();
    const fields = error.fields || {};
    const messages = Object.entries(fields).map(([fieldName, message]) => {
      const field = elements.form.elements[fieldName];
      // Never mark hidden fields invalid: the browser cannot focus them and would block submit.
      if (field && !field.hidden && field.type !== 'hidden') field.setCustomValidity(message);
      return `${fieldName}: ${message}`;
    });
    $('validation-errors').textContent = messages.length ? messages.join(' ') : error.message;
    if (fields.articleHtml) { articleEditor.focus(); return; }
    const firstField = Object.keys(fields).map((name) => elements.form.elements[name]).find((f) => f && !f.hidden && f.type !== 'hidden');
    if (firstField) firstField.focus();
  }
  function confirmDiscard() { return !dirty || window.confirm('You have unsaved changes. Discard them?'); }

  /* ------------------------------------------------------------------
   * API
   * ---------------------------------------------------------------- */
  async function getToken() {
    // Always ask Supabase for the current session so refreshed tokens are used.
    const { data } = await window.netconSupabase.auth.getSession();
    if (!data.session) { window.location.reload(); throw new Error('Your session has expired. Please sign in again.'); }
    return data.session.access_token;
  }
  async function api(path, options = {}) {
    const token = await getToken();
    const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `CMS request failed (${response.status}).`);
      error.fields = data.fields || {};
      throw error;
    }
    return data;
  }
  function loadSupabase() {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve();
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js'; // pinned version
      script.onload = resolve;
      script.onerror = () => reject(new Error('The sign-in library (Supabase) could not be loaded.'));
      document.head.appendChild(script);
    });
  }

  /* ------------------------------------------------------------------
   * Rendering
   * ---------------------------------------------------------------- */
  function renderPosts() {
    const query = elements.search.value.trim().toLowerCase();
    const visible = posts.filter((post) => `${post.title} ${post.publicSlug} ${post.category}`.toLowerCase().includes(query));
    elements.list.innerHTML = visible.map((post) => {
      const label = (post.archivedAt ? 'archived' : (post.status || 'draft')).replace(/_/g, ' ');
      const rowClass = `${currentPost?.publicSlug === post.publicSlug ? 'is-selected' : ''}${post.archivedAt ? ' is-archived' : ''}`.trim();
      const slug = encodeURIComponent(post.publicSlug);
      const title = escapeHtml(post.title || 'article');
      const actions = [
        `<a class="cms-article-action" href="/resources/blogs/${slug}" target="_blank" rel="noopener" aria-label="View ${title}" title="View published article"><i data-lucide="external-link"></i></a>`,
        `<button class="cms-article-action" data-action="edit" data-slug="${escapeHtml(post.publicSlug)}" type="button" aria-label="Edit ${title}" title="Edit article"><i data-lucide="pencil"></i></button>`
      ];
      if (cmsUser?.role === 'reviewer') actions.push(`<button class="cms-article-action cms-article-action--danger" data-action="delete_post" data-slug="${escapeHtml(post.publicSlug)}" type="button" aria-label="Delete ${title}" title="Delete article"><i data-lucide="trash-2"></i></button>`);
      return `<article class="cms-article-card ${rowClass}"><div class="cms-article-card__body"><h3>${escapeHtml(post.title || 'Untitled article')}</h3><p>/resources/blogs/${escapeHtml(post.publicSlug)}</p><div class="cms-article-card__meta"><span class="cms-status" data-status="${escapeHtml(label)}">${escapeHtml(label)}</span><time datetime="${escapeHtml(post.updatedAt || '')}">${post.updatedAt ? new Date(post.updatedAt).toLocaleDateString('en-GB') : 'Not saved'}</time></div></div><div class="cms-article-actions" aria-label="Article actions">${actions.join('')}</div></article>`;
    }).join('') || '<p class="cms-article-list__empty">No articles match this search.</p>';
    const countElementIds = { published: 'published-count', draft: 'draft-count', in_review: 'review-count', scheduled: 'scheduled-count' };
    Object.entries(countElementIds).forEach(([status, id]) => { $(id).textContent = posts.filter((post) => post.status === status).length; });
    if (window.lucide) window.lucide.createIcons();
  }
  function renderFeaturedImage(url, altText) {
    const panel = $('featured-image-panel');
    const image = $('featured-image-preview');
    const name = $('featured-image-name');
    if (!url) { panel.hidden = true; image.removeAttribute('src'); return; }
    image.onerror = () => { image.onerror = null; image.src = '/images/pages/network-abstract.jpg'; name.textContent = 'The selected image could not be loaded. A fallback preview is shown.'; };
    image.src = url;
    image.alt = altText || 'Current featured image';
    name.textContent = url.startsWith('blob:') ? 'New image selected (not saved yet)' : url;
    panel.hidden = false;
  }
  async function refreshPosts() {
    const data = await api('/api/cms/posts'); cmsUser = data.user; posts = data.posts; renderPosts();
    elements.session.innerHTML = `<span class="cms-connection">${escapeHtml(cmsUser.display_name)} · ${escapeHtml(cmsUser.role)}</span><button class="cms-button cms-button--secondary" id="sign-out" type="button">Sign out</button>`;
    $('sign-out').addEventListener('click', async () => { await window.netconSupabase.auth.signOut(); window.location.reload(); });
  }
  function showBootstrap(message) {
    elements.workspace.hidden = true;
    elements.setup.hidden = false;
    elements.setupMessage.innerHTML = `${escapeHtml(message)} <button class="cms-button cms-button--primary" id="cms-bootstrap" type="button">Start CMS and import existing blogs</button>`;
    $('cms-bootstrap').addEventListener('click', async () => {
      const button = $('cms-bootstrap');
      button.disabled = true;
      button.textContent = 'Starting CMS...';
      try {
        await api('/api/cms/bootstrap', { method: 'POST', body: '{}' });
        elements.setup.hidden = true;
        elements.workspace.hidden = false;
        await refreshPosts();
      } catch (error) {
        button.disabled = false;
        button.textContent = error.message;
      }
    });
  }
  function updatePublishingControls(post) {
    elements.publishLive.disabled = !(cmsUser?.role === 'reviewer' && Boolean(post?.publicSlug));
  }
  function isEditableDraft(post) { return ['draft', 'changes_requested'].includes(post?.status); }

  /* ------------------------------------------------------------------
   * Editor open / close / reset
   * ---------------------------------------------------------------- */
  function clearEditorState() {
    currentPost = null;
    elements.form.reset();
    articleEditor.innerHTML = '<p><br></p>';
    articleHtmlSource.value = '';
    articleHtmlField.value = '';
    articleHtmlSourcePanel.hidden = true; articleEditor.hidden = false; articleHtmlSourceOpen = false;
    articleEditorSelection = null; dirty = false; slugTouched = false;
    clearValidationErrors(); renderFeaturedImage('', '');
    updatePublishingControls(null);
    elements.saveStatus.textContent = '';
  }
  function closeEditor() {
    clearEditorState();
    elements.editor.hidden = true;
    $('cms-lifecycle-actions').hidden = true;
    renderPosts();
  }
  function resetEditor() {
    clearEditorState();
    elements.editor.hidden = false;
    $('editor-heading').textContent = 'New article';
    $('editor-state').textContent = 'Complete the fields, then save the draft.';
    $('cms-lifecycle-actions').hidden = true;
  }
  async function openPost(slug) {
    if (!confirmDiscard()) return;
    const data = await api(`/api/cms/posts/${encodeURIComponent(slug)}`);
    clearEditorState();
    currentPost = data.post; elements.editor.hidden = false;
    $('editor-heading').textContent = `Edit: ${data.post.title}`;
    ['title', 'excerpt', 'category', 'featuredImageAlt', 'featuredImageUrl', 'seoTitle', 'seoDescription', 'schemaMarkup'].forEach((name) => { elements.form.elements[name].value = data.post[name] || ''; });
    setEditorHtml(data.post.articleHtml);
    elements.form.elements.publishedAt.value = data.post.publishedAt ? data.post.publishedAt.slice(0, 10) : '';
    elements.form.elements.isFeatured.checked = Boolean(data.post.isFeatured);
    elements.form.elements.featuredRank.value = data.post.featuredRank || '';
    elements.form.elements.publicSlug.value = data.post.publicSlug;
    slugTouched = true;
    renderFeaturedImage(data.post.featuredImageUrl, data.post.featuredImageAlt);
    updatePublishingControls(data.post);
    $('editor-state').textContent = isEditableDraft(data.post) ? 'This is an editable draft. Save changes before publishing.' : 'This is the current published version. Save changes to create an editable draft.';
    $('cms-lifecycle-actions').hidden = false;
    dirty = false;
    renderPosts();
  }

  /* ------------------------------------------------------------------
   * Uploads
   * ---------------------------------------------------------------- */
  const readBase64 = (file) => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
  const IMAGE_TYPES = ['image/avif', 'image/jpeg', 'image/png', 'image/webp'];

  async function uploadFeatureImage(file) {
    if (!file) return elements.form.elements.featuredImageUrl.value;
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('Use an AVIF, JPEG, PNG or WebP image.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Feature images must be 3 MB or smaller.');
    const data = await readBase64(file);
    const result = await api('/api/cms/media', { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type, data, altText: elements.form.elements.featuredImageAlt.value }) });
    return result.media.blobUrl;
  }
  async function uploadArticleImage(file) {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) throw new Error('Use an AVIF, JPEG, PNG or WebP image.');
    if (file.size > 3 * 1024 * 1024) throw new Error('Article images must be 3 MB or smaller.');
    const data = await readBase64(file);
    const altText = window.prompt('Describe this image for readers using a screen reader.', '') || '';
    elements.saveStatus.textContent = 'Uploading image...';
    const result = await api('/api/cms/media', { method: 'POST', body: JSON.stringify({ filename: file.name, contentType: file.type, data, altText }) });
    insertArticleHtml(`<p><img src="${escapeHtml(result.media.blobUrl)}" alt="${escapeHtml(altText)}"></p>`);
    elements.saveStatus.textContent = 'Image inserted.';
  }

  /* ------------------------------------------------------------------
   * Save / publish
   * ---------------------------------------------------------------- */
  async function saveCurrentDraft() {
    syncArticleEditor();
    const payload = Object.fromEntries(new FormData(elements.form));
    delete payload.featuredImage; // File objects cannot be JSON-serialised
    payload.isFeatured = elements.form.elements.isFeatured.checked;

    const fields = {};
    const body = String(payload.articleHtml || '');
    if (!body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() && !/<(img|table)/i.test(body)) fields.articleHtml = 'Write the article body.';
    if (!elements.form.elements.featuredImage.files[0] && !elements.form.elements.featuredImageUrl.value) fields.featuredImage = 'Choose a featured image.';
    if (Object.keys(fields).length) { const error = new Error('Please complete the highlighted fields.'); error.fields = fields; throw error; }

    payload.featuredImageUrl = await uploadFeatureImage(elements.form.elements.featuredImage.files[0]);
    if (currentPost && !isEditableDraft(currentPost)) {
      const created = await api(`/api/cms/posts/${encodeURIComponent(currentPost.publicSlug)}`, { method: 'POST', body: '{}' });
      currentPost = { ...currentPost, revisionId: created.revision.id, status: 'draft' };
    }
    if (currentPost) {
      await api(`/api/cms/posts/${encodeURIComponent(currentPost.publicSlug)}`, { method: 'PATCH', body: JSON.stringify({ ...payload, revisionId: currentPost.revisionId }) });
      currentPost.publicSlug = payload.publicSlug;
    } else {
      const created = await api('/api/cms/posts', { method: 'POST', body: JSON.stringify(payload) });
      currentPost = { publicSlug: payload.publicSlug, revisionId: created.revision.id, status: 'draft' };
    }
    elements.form.elements.featuredImageUrl.value = payload.featuredImageUrl;
    elements.form.elements.featuredImage.value = '';
    dirty = false;
    updatePublishingControls(currentPost);
  }
  function showPublishResult(title, message, url) {
    $('publish-result-title').textContent = title;
    $('publish-result-message').textContent = message;
    const link = $('publish-result-link');
    link.href = url || '/';
    link.hidden = !url;
    $('publish-result-dialog').showModal();
  }
  async function publishCurrentArticle() {
    if (!currentPost || saving) return;
    if (!window.confirm('Publish this article to the live website?')) return;
    saving = true; elements.publishLive.disabled = true;
    try {
      elements.saveStatus.textContent = 'Publishing live...';
      // Always save first so the latest edits are what goes live.
      if (currentPost.status !== 'approved' || dirty) await saveCurrentDraft();
      if (currentPost.status !== 'approved') await api(`/api/cms/revisions/${currentPost.revisionId}/workflow`, { method: 'POST', body: JSON.stringify({ action: 'publish_live' }) });
      await api(`/api/cms/revisions/${currentPost.revisionId}/publish`, { method: 'POST', body: '{}' });
      currentPost.status = 'published';
      await refreshPosts();
      elements.saveStatus.textContent = 'CMS release is published.';
      showPublishResult('Article published', 'Your article is now published on the live website.', `https://network-consultancy.com/resources/blogs/${encodeURIComponent(currentPost.publicSlug)}`);
    } catch (error) {
      elements.saveStatus.textContent = error.message;
      showValidationErrors(error);
      showPublishResult('Publishing failed', error.message || 'The article was not published. Please try again.', null);
    } finally { saving = false; updatePublishingControls(currentPost); }
  }
  async function runLifecycleAction(action, slug) {
    if (!slug) return;
    try {
      elements.saveStatus.textContent = 'Updating article...';
      await api(`/api/cms/posts/${encodeURIComponent(slug)}/lifecycle`, { method: 'POST', body: JSON.stringify({ action }) });
      elements.saveStatus.textContent = 'Article deleted.';
      if (currentPost?.publicSlug === slug) closeEditor();
      await refreshPosts();
    } catch (error) { elements.saveStatus.textContent = error.message; }
  }
  function requestArticleDeletion(slug) { if (!slug) return; pendingDeletionSlug = slug; deleteArticleDialog.showModal(); }

  /* ------------------------------------------------------------------
   * Event wiring
   * ---------------------------------------------------------------- */
  elements.newPost.addEventListener('click', () => { if (!confirmDiscard()) return; resetEditor(); renderPosts(); });
  elements.search.addEventListener('input', renderPosts);
  $('close-editor-button').addEventListener('click', () => { if (confirmDiscard()) closeEditor(); });

  // Dirty tracking, custom-validity reset, auto slug
  elements.form.addEventListener('input', (event) => {
    dirty = true;
    if (event.target.setCustomValidity) event.target.setCustomValidity('');
    if (event.target.name === 'publicSlug') slugTouched = true;
    if (event.target.name === 'title' && !slugTouched) elements.form.elements.publicSlug.value = slugify(event.target.value);
  });
  elements.form.addEventListener('change', (event) => { if (event.target.setCustomValidity) event.target.setCustomValidity(''); });
  window.addEventListener('beforeunload', (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });

  // Editor behaviour
  articleEditor.addEventListener('focus', ensureParagraph);
  articleEditor.addEventListener('input', () => {
    if (!articleEditor.innerHTML.trim() || articleEditor.innerHTML === '<br>') ensureParagraph();
    wrapLooseText();
    syncArticleEditor();
  });
  document.addEventListener('selectionchange', () => {
    rememberArticleEditorSelection();
    const selection = window.getSelection();
    if (!selection.rangeCount || !articleEditor.contains(selection.anchorNode)) return;
    let node = selection.anchorNode.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentNode : selection.anchorNode;
    while (node && node !== articleEditor) {
      if (/^(P|H[1-6])$/.test(node.tagName)) { blockFormat.value = node.tagName.toLowerCase(); return; }
      node = node.parentNode;
    }
  });

  document.querySelectorAll('[data-editor-command]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => runEditorCommand(button.dataset.editorCommand));
  });
  blockFormat.addEventListener('change', (event) => runEditorCommand('formatBlock', `<${event.target.value}>`));

  document.querySelector('[data-editor-action="link"]').addEventListener('click', () => {
    const url = cleanUrl(window.prompt('Enter the link URL (https://, mailto:, tel: or /path).', 'https://'));
    if (!url) return;
    const external = /^https?:/i.test(url) && !url.startsWith(location.origin);
    const extra = external ? ' target="_blank" rel="noopener noreferrer"' : '';
    if (!articleEditorSelection || articleEditorSelection.collapsed) {
      insertArticleHtml(`<a href="${escapeHtml(url)}"${extra}>${escapeHtml(window.prompt('Link text.', url) || url)}</a>`);
    } else {
      runEditorCommand('createLink', url);
      if (external) articleEditor.querySelectorAll('a').forEach((a) => { if (a.getAttribute('href') === url) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } });
      syncArticleEditor();
    }
  });
  document.querySelector('[data-editor-action="image"]').addEventListener('click', () => articleEditorImage.click());
  document.querySelector('[data-editor-action="cta"]').addEventListener('click', () => {
    const label = window.prompt('CTA button label.', 'Contact us');
    if (!label) return;
    const url = cleanUrl(window.prompt('CTA button URL.', '/contact'));
    if (!url) return;
    insertArticleHtml(`<p><a class="article-cta" href="${escapeHtml(url)}">${escapeHtml(label)}</a></p>`);
  });
  document.querySelector('[data-editor-action="paragraph"]').addEventListener('click', () => insertArticleHtml('<p><br></p>'));
  document.querySelector('[data-editor-action="table"]').addEventListener('click', insertTable);

  document.querySelector('[data-editor-action="html"]').addEventListener('click', () => {
    if (!articleHtmlSourceOpen) {
      syncArticleEditor(); articleHtmlSource.value = articleHtmlField.value;
      articleHtmlSourcePanel.hidden = false; articleEditor.hidden = true;
      articleHtmlSourceOpen = true; articleHtmlSource.focus();
    } else {
      articleHtmlSourcePanel.hidden = true; articleEditor.hidden = false;
      articleHtmlSourceOpen = false; syncArticleEditor();
    }
  });
  $('article-html-apply').addEventListener('click', () => {
    articleHtmlSourceOpen = false;
    setEditorHtml(articleHtmlSource.value); // sanitised + normalised, never raw innerHTML
    articleHtmlSourcePanel.hidden = true; articleEditor.hidden = false;
    articleEditorSelection = null; dirty = true;
    elements.saveStatus.textContent = 'Custom HTML applied. Save the draft to keep your changes.';
  });
  $('article-html-cancel').addEventListener('click', () => {
    articleHtmlSourcePanel.hidden = true; articleEditor.hidden = false; articleHtmlSourceOpen = false; syncArticleEditor();
  });

  articleEditorImage.addEventListener('change', async () => {
    try { await uploadArticleImage(articleEditorImage.files[0]); }
    catch (error) { elements.saveStatus.textContent = error.message; }
    finally { articleEditorImage.value = ''; }
  });
  articleEditor.addEventListener('paste', (event) => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    const imageFile = [...(clipboard.files || [])].find((file) => file.type.startsWith('image/'));
    if (imageFile) {
      event.preventDefault();
      uploadArticleImage(imageFile).catch((error) => { elements.saveStatus.textContent = error.message; });
      return;
    }
    const html = clipboard.getData('text/html');
    if (html) {
      event.preventDefault();
      insertArticleHtml(normalizeArticleHtml(html)); // keeps tables, wraps loose text in <p>
      elements.saveStatus.textContent = 'Pasted content formatted. Check it in Preview before publishing.';
      return;
    }
    const plainText = clipboard.getData('text/plain');
    if (plainText) {
      event.preventDefault();
      insertArticleHtml(plainText.split(/\r?\n/).filter((line) => line.trim()).map((line) => `<p>${escapeHtml(line)}</p>`).join(''));
    }
  });
  articleEditor.addEventListener('dragover', (event) => { if (event.dataTransfer?.types?.includes('Files')) event.preventDefault(); });
  articleEditor.addEventListener('drop', async (event) => {
    const file = [...(event.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    event.preventDefault();
    try { await uploadArticleImage(file); } catch (error) { elements.saveStatus.textContent = error.message; }
  });

  // Table tools: appear when the cursor is inside a table cell
  const tableTools = document.createElement('div');
  tableTools.className = 'cms-table-tools';
  tableTools.setAttribute('role', 'toolbar');
  tableTools.setAttribute('aria-label', 'Table tools');
  tableTools.hidden = true;
  tableTools.innerHTML = [
    ['row-above', 'Row above'], ['row-below', 'Row below'],
    ['col-left', 'Column left'], ['col-right', 'Column right'],
    ['row-delete', 'Delete row'], ['col-delete', 'Delete column'],
    ['header', 'Toggle header row'], ['table-delete', 'Delete table']
  ].map(([action, label]) => `<button type="button" data-table-action="${action}">${label}</button>`).join('');
  articleEditor.before(tableTools);

  function currentCell() {
    const selection = window.getSelection();
    let node = selection.rangeCount ? selection.anchorNode : null;
    if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    const cell = node && node.closest ? node.closest('td,th') : null;
    return cell && articleEditor.contains(cell) ? cell : null;
  }
  function makeCell(tag) {
    const cell = document.createElement(tag);
    cell.innerHTML = '<br>';
    if (tag === 'th') cell.setAttribute('scope', 'col');
    return cell;
  }
  function tableAction(action) {
    const cell = currentCell();
    if (!cell) return;
    const row = cell.parentElement;
    const table = cell.closest('table');
    const index = cell.cellIndex;
    if (action === 'row-above' || action === 'row-below') {
      const newRow = document.createElement('tr');
      [...row.cells].forEach(() => newRow.appendChild(makeCell('td')));
      row.parentNode.insertBefore(newRow, action === 'row-above' ? row : row.nextSibling);
    } else if (action === 'col-left' || action === 'col-right') {
      [...table.rows].forEach((r) => {
        const ref = r.cells[index];
        const tag = ref && ref.tagName === 'TH' ? 'th' : 'td';
        const before = action === 'col-left' ? (ref || null) : (ref ? ref.nextSibling : null);
        r.insertBefore(makeCell(tag), before);
      });
    } else if (action === 'row-delete') {
      if (table.rows.length <= 1) table.remove(); else row.remove();
    } else if (action === 'col-delete') {
      if (row.cells.length <= 1) table.remove(); else [...table.rows].forEach((r) => r.cells[index] && r.cells[index].remove());
    } else if (action === 'header') {
      const first = table.rows[0];
      const makeHeader = [...first.cells].some((c) => c.tagName !== 'TH');
      [...first.cells].forEach((c) => {
        const replacement = document.createElement(makeHeader ? 'th' : 'td');
        if (makeHeader) replacement.setAttribute('scope', 'col');
        replacement.append(...c.childNodes);
        c.replaceWith(replacement);
      });
    } else if (action === 'table-delete') {
      table.remove();
    }
    if (!articleEditor.innerHTML.trim()) ensureParagraph();
    syncArticleEditor(); dirty = true;
    tableTools.hidden = !currentCell();
  }
  tableTools.addEventListener('mousedown', (event) => event.preventDefault()); // keep the cursor in the cell
  tableTools.addEventListener('click', (event) => {
    const button = event.target.closest('[data-table-action]');
    if (button) tableAction(button.dataset.tableAction);
  });
  document.addEventListener('selectionchange', () => { tableTools.hidden = !currentCell(); });

  // Tab / Shift+Tab moves between cells; Tab in the last cell adds a row
  articleEditor.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const cell = currentCell();
    if (!cell) return;
    event.preventDefault();
    const table = cell.closest('table');
    let cells = [...table.querySelectorAll('th,td')];
    let next = cells.indexOf(cell) + (event.shiftKey ? -1 : 1);
    if (next >= cells.length) { tableAction('row-below'); cells = [...table.querySelectorAll('th,td')]; }
    const target = cells[Math.max(0, next)];
    if (!target) return;
    const range = document.createRange();
    range.selectNodeContents(target); range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
  });

  // Featured image
  let featuredObjectUrl = null;
  elements.form.elements.featuredImage.addEventListener('change', () => {
    const file = elements.form.elements.featuredImage.files[0];
    if (featuredObjectUrl) { URL.revokeObjectURL(featuredObjectUrl); featuredObjectUrl = null; }
    if (file) { featuredObjectUrl = URL.createObjectURL(file); renderFeaturedImage(featuredObjectUrl, elements.form.elements.featuredImageAlt.value); }
  });
  $('remove-featured-image').addEventListener('click', () => {
    elements.form.elements.featuredImage.value = ''; elements.form.elements.featuredImageUrl.value = '';
    renderFeaturedImage('', ''); dirty = true;
    elements.saveStatus.textContent = 'Choose a replacement image before saving.';
  });

  // List actions
  elements.list.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const { action, slug } = actionButton.dataset;
    if (action === 'edit') openPost(slug).catch((error) => alert(error.message));
    else if (action === 'delete_post') requestArticleDeletion(slug);
  });

  // Preview
  $('preview-button').addEventListener('click', () => {
    syncArticleEditor();
    const data = new FormData(elements.form);
    const image = data.get('featuredImageUrl') || (elements.form.elements.featuredImage.files[0] && featuredObjectUrl) || '';
    elements.previewContent.innerHTML = `<h1>${escapeHtml(data.get('title'))}</h1>${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(data.get('featuredImageAlt'))}">` : ''}${safePreviewHtml(data.get('articleHtml'))}`;
    elements.preview.showModal();
  });
  $('close-preview-button').addEventListener('click', () => elements.preview.close());

  // Save (guarded against double submits)
  elements.form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    saving = true;
    const submit = elements.form.querySelector('[type="submit"]');
    submit.disabled = true;
    clearValidationErrors();
    try {
      elements.saveStatus.textContent = 'Saving...';
      await saveCurrentDraft();
      elements.saveStatus.textContent = 'Draft saved. Review it with Preview, then publish live.';
      await refreshPosts();
    } catch (error) {
      elements.saveStatus.textContent = error.message; showValidationErrors(error);
    } finally { saving = false; submit.disabled = false; }
  });

  // Publish / delete
  elements.publishLive.addEventListener('click', publishCurrentArticle);
  $('close-publish-result').addEventListener('click', () => $('publish-result-dialog').close());
  $('delete-post-button').addEventListener('click', () => requestArticleDeletion(currentPost?.publicSlug));
  ['close-delete-article', 'cancel-delete-article'].forEach((id) => $(id).addEventListener('click', () => { pendingDeletionSlug = null; deleteArticleDialog.close(); }));
  $('confirm-delete-article').addEventListener('click', () => { const slug = pendingDeletionSlug; pendingDeletionSlug = null; deleteArticleDialog.close(); runLifecycleAction('delete_post', slug); });

  /* ------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------- */
  try {
    const configResponse = await fetch('/api/cms/config');
    if (!configResponse.ok) throw new Error('This preview server does not provide the CMS API yet.');
    const config = await configResponse.json();
    if (!config.configured) { elements.setup.hidden = false; elements.auth.hidden = true; elements.setupMessage.textContent = config.message; setConnection('CMS services not connected', false); return; }
    await loadSupabase();
    const supabase = window.supabase.createClient(config.supabaseUrl, config.publishableKey);
    window.netconSupabase = supabase;
    supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') window.location.reload(); });
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) {
      elements.auth.hidden = false;
      $('clerk-sign-in').innerHTML = '<form id="cms-sign-in-form"><h2 id="cms-auth-title">Sign in to continue</h2><p id="cms-auth-copy">Use the editorial account created by your Network Consultancy administrator.</p><label>Company email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button class="cms-button cms-button--primary" id="cms-auth-submit" type="submit">Sign in</button><p id="cms-auth-error" role="alert"></p></form>';
      $('cms-sign-in-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = $('cms-auth-submit'); button.disabled = true;
        const form = new FormData(event.currentTarget);
        const result = await supabase.auth.signInWithPassword({ email: form.get('email'), password: form.get('password') });
        if (result.error) { $('cms-auth-error').textContent = result.error.message; button.disabled = false; return; }
        window.location.reload();
      });
      setConnection('Sign in required', false); return;
    }
    elements.auth.hidden = true; elements.workspace.hidden = false; elements.newPost.disabled = false; setConnection('CMS connected', true);
    if (window.lucide) window.lucide.createIcons();
    try { await refreshPosts(); } catch (error) { if (error.message.includes('not been granted CMS access')) showBootstrap('No CMS role has been assigned to this account yet.'); else throw error; }
  } catch (error) { elements.setup.hidden = false; elements.auth.hidden = true; elements.setupMessage.textContent = error.message || 'The CMS could not be reached.'; setConnection('CMS connection failed', false); }
}());
