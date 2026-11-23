(() => {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    const editor = document.getElementById('article-editor');
    const field = document.querySelector('[name="articleHtml"]');
    const form = document.getElementById('article-form');
    const toolbar = document.querySelector('.cms-rich-editor__toolbar');
    const blockSelect = document.getElementById('article-block-format');
    const imageInput = document.getElementById('article-editor-image');
    const sourcePanel = document.getElementById('article-html-source-panel');
    const sourceArea = document.getElementById('article-html-source');
    const previewBtn = document.getElementById('preview-button');

    if (!editor || !field || !form) return;

    /* ---------- Config ---------- */

    // Make Enter create <p> instead of <div>
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}

    const BLOCK_RE = /^(P|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|HR|FIGURE|PRE)$/;
    const ALLOWED_URL_RE = /^(https?:|mailto:|tel:|\/|#)/i;

    /* ---------- Sanitising ---------- */

    function sanitize(html) {
      const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
      const root = doc.body.firstElementChild;

      root.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select')
        .forEach((el) => el.remove());

      root.querySelectorAll('*').forEach((el) => {
        [...el.attributes].forEach((attr) => {
          const name = attr.name.toLowerCase();
          const value = attr.value.trim();
          if (name.startsWith('on')) return el.removeAttribute(attr.name);
          if (name === 'style') return el.removeAttribute(attr.name);
          if ((name === 'href' || name === 'src') && !ALLOWED_URL_RE.test(value) && !/^data:image\//i.test(value)) {
            el.removeAttribute(attr.name);
          }
        });
        if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
          el.setAttribute('rel', 'noopener noreferrer');
        }
      });

      return root.innerHTML;
    }

    /* ---------- Normalising (wrap loose text in <p>) ---------- */

    function normalizeArticleHtml(html) {
      const root = document.createElement('div');
      root.innerHTML = sanitize(html);

      const out = document.createElement('div');
      let p = null;

      const hasContent = (el) =>
        el.textContent.replace(/\u00a0/g, ' ').trim() !== '' ||
        el.querySelector('img,iframe,video,hr');

      const flush = () => {
        if (p && hasContent(p)) out.appendChild(p);
        p = null;
      };

      const isBlock = (n) => n.nodeType === 1 && BLOCK_RE.test(n.tagName);
      const hasBlockChild = (n) => [...n.children].some((c) => isBlock(c) || c.tagName === 'DIV');

      function walk(nodes) {
        nodes.forEach((node) => {
          if (node.nodeType === 1 && node.tagName === 'DIV') {
            if (hasBlockChild(node)) {
              flush();
              walk([...node.childNodes]);   // unwrap div containing blocks
            } else {
              flush();
              const np = document.createElement('p');
              np.innerHTML = node.innerHTML;
              if (hasContent(np)) out.appendChild(np);
            }
            return;
          }

          if (isBlock(node)) {
            flush();
            // Drop empty paragraphs/headings, keep everything else
            if (node.tagName === 'HR' || hasContent(node)) out.appendChild(node.cloneNode(true));
            return;
          }

          if (node.nodeType === 1 && node.tagName === 'BR') {
            flush();                         // top-level <br> = paragraph break
            return;
          }

          if (node.nodeType === 3 && !node.textContent.trim() && !p) return; // ignore whitespace between blocks

          if (!p) p = document.createElement('p');
          p.appendChild(node.cloneNode(true));
        });
      }

      walk([...root.childNodes]);
      flush();
      return out.innerHTML;
    }

    /* ---------- Sync editor -> hidden textarea ---------- */

    function sync() {
      field.value = normalizeArticleHtml(editor.innerHTML);
    }

    function ensureParagraph() {
      const html = editor.innerHTML.trim();
      if (!html || html === '<br>') {
        editor.innerHTML = '<p><br></p>';
        const r = document.createRange();
        r.selectNodeContents(editor.firstChild);
        r.collapse(true);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    }

    // Wrap bare top-level text typed into the editor in a <p>
    function wrapLooseText() {
      const sel = getSelection();
      if (!sel.rangeCount) return;
      const node = sel.anchorNode;
      if (node && node.nodeType === 3 && node.parentNode === editor) {
        document.execCommand('formatBlock', false, '<p>');
      }
    }

    editor.addEventListener('focus', ensureParagraph);
    editor.addEventListener('input', () => {
      wrapLooseText();
      sync();
    });
    editor.addEventListener('blur', sync);

    form.addEventListener('submit', sync, true);   // capture: runs before your own submit handler
    previewBtn?.addEventListener('click', sync, true);
    document.getElementById('publish-live-button')?.addEventListener('click', sync, true);

    /* ---------- Selection handling ---------- */

    let savedRange = null;
    document.addEventListener('selectionchange', () => {
      const sel = getSelection();
      if (sel.rangeCount && editor.contains(sel.anchorNode)) {
        savedRange = sel.getRangeAt(0).cloneRange();
      }
    });

    function restoreSelection() {
      editor.focus();
      if (savedRange) {
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(savedRange);
      }
    }

    function exec(cmd, value = null) {
      restoreSelection();
      document.execCommand(cmd, false, value);
      sync();
    }

    function insertHtml(html) {
      restoreSelection();
      document.execCommand('insertHTML', false, html);
      sync();
    }

    const esc = (s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    function cleanUrl(url) {
      url = (url || '').trim();
      if (!url) return '';
      if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url) && !ALLOWED_URL_RE.test(url)) url = 'https://' + url;
      return ALLOWED_URL_RE.test(url) ? url : '';
    }

    /* ---------- Image upload ---------- */

    // Replace this with your real upload (Supabase storage, etc.).
    // It must return a public URL string. Override from app.js with:
    //   window.CMS_uploadImage = async (file) => { ...; return publicUrl; }
    async function uploadImage(file) {
      if (typeof window.CMS_uploadImage === 'function') return window.CMS_uploadImage(file);
      // Fallback so it works out of the box: embeds the image as a data URL.
      // Not recommended for production (bloats article HTML).
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function insertImageFile(file) {
      if (!file || !/^image\/(avif|jpeg|png|webp)$/.test(file.type)) {
        alert('Please choose an AVIF, JPEG, PNG or WebP image.');
        return;
      }
      try {
        const url = await uploadImage(file);
        const alt = prompt('Image alternative text (describe the image):', '') || '';
        insertHtml(`<p><img src="${esc(url)}" alt="${esc(alt)}"></p>`);
      } catch (err) {
        console.error(err);
        alert('Image upload failed. Please try again.');
      }
    }

    imageInput?.addEventListener('change', async () => {
      const file = imageInput.files[0];
      imageInput.value = '';
      await insertImageFile(file);
    });

    editor.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    });
    editor.addEventListener('drop', async (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        e.preventDefault();
        await insertImageFile(file);
      }
    });

    /* ---------- Paste: clean pasted HTML ---------- */

    editor.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      if (!cd) return;

      const imageFile = [...(cd.files || [])].find((f) => f.type.startsWith('image/'));
      if (imageFile) {
        e.preventDefault();
        insertImageFile(imageFile);
        return;
      }

      const html = cd.getData('text/html');
      if (html) {
        e.preventDefault();
        insertHtml(normalizeArticleHtml(html));
      } else {
        const text = cd.getData('text/plain');
        if (text) {
          e.preventDefault();
          const paras = text.split(/\n{2,}/).map((t) => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('');
          insertHtml(paras);
        }
      }
    });

    /* ---------- Toolbar actions ---------- */

    // Keep the editor selection when clicking toolbar buttons
    toolbar?.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });

    const actions = {
      link() {
        const sel = getSelection();
        const hasSelection = savedRange && !savedRange.collapsed;
        const url = cleanUrl(prompt('Link URL (https://…, mailto:, tel:, or /path):', 'https://'));
        if (!url) return;
        if (hasSelection) {
          exec('createLink', url);
          editor.querySelectorAll(`a[href="${CSS.escape(url)}"]`).forEach((a) => {
            if (/^https?:/i.test(url) && !url.startsWith(location.origin)) {
              a.setAttribute('target', '_blank');
              a.setAttribute('rel', 'noopener noreferrer');
            }
          });
          sync();
        } else {
          const label = prompt('Link text:', url) || url;
          insertHtml(`<a href="${esc(url)}">${esc(label)}</a>`);
        }
      },

      image() {
        imageInput?.click();
      },

      cta() {
        const label = prompt('Button text:', 'Contact us');
        if (!label) return;
        const url = cleanUrl(prompt('Button link:', '/contact'));
        if (!url) return;
        insertHtml(`<p><a class="cta-button" href="${esc(url)}">${esc(label)}</a></p>`);
      },

      paragraph() {
        exec('formatBlock', '<p>');
        if (blockSelect) blockSelect.value = 'p';
      },

      table() {
        const rows = Math.min(20, Math.max(1, parseInt(prompt('Number of rows (including header):', '3'), 10) || 0));
        const cols = Math.min(10, Math.max(1, parseInt(prompt('Number of columns:', '3'), 10) || 0));
        if (!rows || !cols) return;
        const cells = (tag) => `<tr>${Array.from({ length: cols }, () => `<${tag}>&nbsp;</${tag}>`).join('')}</tr>`;
        const body = Array.from({ length: rows - 1 }, () => cells('td')).join('');
        insertHtml(`<table><thead>${cells('th')}</thead><tbody>${body}</tbody></table><p><br></p>`);
      },

      html() {
        sourceArea.value = normalizeArticleHtml(editor.innerHTML);
        sourcePanel.hidden = false;
        editor.hidden = true;
        sourceArea.focus();
      },
    };

    toolbar?.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.dataset.editorCommand) {
        exec(btn.dataset.editorCommand);
      } else if (btn.dataset.editorAction && actions[btn.dataset.editorAction]) {
        actions[btn.dataset.editorAction]();
      }
    });

    blockSelect?.addEventListener('change', () => {
      exec('formatBlock', `<${blockSelect.value}>`);
    });

    // Reflect the current block type in the dropdown
    document.addEventListener('selectionchange', () => {
      const sel = getSelection();
      if (!blockSelect || !sel.rangeCount || !editor.contains(sel.anchorNode)) return;
      let n = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode;
      while (n && n !== editor) {
        if (/^(P|H[1-6])$/.test(n.tagName)) {
          blockSelect.value = n.tagName.toLowerCase();
          return;
        }
        n = n.parentNode;
      }
    });

    /* ---------- Custom HTML panel ---------- */

    function closeSource() {
      sourcePanel.hidden = true;
      editor.hidden = false;
      editor.focus();
    }

    document.getElementById('article-html-apply')?.addEventListener('click', () => {
      editor.innerHTML = normalizeArticleHtml(sourceArea.value) || '<p><br></p>';
      sync();
      closeSource();
    });
    document.getElementById('article-html-cancel')?.addEventListener('click', closeSource);

    /* ---------- Keyboard shortcuts ---------- */

    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        actions.link();
      }
    });

    /* ---------- Public API (use from app.js) ---------- */

    window.ArticleEditor = {
      // Call when opening an existing article
      setHtml(html) {
        editor.innerHTML = normalizeArticleHtml(html || '') || '<p><br></p>';
        sync();
      },
      // Call if you need the cleaned HTML directly
      getHtml() {
        return normalizeArticleHtml(editor.innerHTML);
      },
      clear() {
        editor.innerHTML = '<p><br></p>';
        field.value = '';
      },
      normalize: normalizeArticleHtml,
    };

    ensureParagraph();
  });
})();