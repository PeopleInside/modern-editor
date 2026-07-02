/**
 * Modern Editor — Custom Field for Admin Next (Grav 2.0)
 * (based on TinyMCE, loaded from CDN or local self-hosted files)
 *
 * Implements the Web Component contract required by Admin Next:
 *  - receives `field` (blueprint definition) and `value` (current content) via setters
 *  - emits a `change` event (bubbles: true) when the content changes
 *
 * TinyMCE is loaded dynamically from CDN or local self-hosted files.
 * The value exchanged with Admin Next is always HTML (string).
 *
 * This field is automatically applied to the "content" field of each
 * page by the PHP plugin (see modern-editor.php), without needing to
 * modify theme blueprints. The field type is called "moderneditor".
 */

const TAG = window.__GRAV_FIELD_TAG;
const TINYMCE_CDN = 'https://cdn.jsdelivr.net/npm/tinymce@7/tinymce.min.js';
const TINYMCE_CDN_HOSTS = ['cdn.jsdelivr.net', 'tiny.cloud', 'cdnjs.cloudflare.com'];

function isTrustedTinyMceCdnUrl(url) {
  try {
    const parsed = new URL(url, window.location.href);
    const host = parsed.hostname.toLowerCase();
    return TINYMCE_CDN_HOSTS.includes(host);
  } catch (e) {
    return false;
  }
}

// Load TinyMCE script once, even if multiple instances of the field are present.
function loadTinyMCE(url) {
  const isUrlCdn = isTrustedTinyMceCdnUrl(url);

  if (window.tinymce) {
    const isCurrentCdn = !window.tinymce.baseURL || isTrustedTinyMceCdnUrl(window.tinymce.baseURL);
    if (isUrlCdn !== isCurrentCdn) {
      const scripts = document.querySelectorAll('script[src*="tinymce.min.js"], script[src*="tinymce.js"]');
      scripts.forEach(s => s.remove());
      delete window.tinymce;
      window.__TINYMCE_LOADING__ = null;
    } else {
      return Promise.resolve(window.tinymce);
    }
  }

  if (window.__TINYMCE_LOADING__) {
    return window.__TINYMCE_LOADING__;
  }

  // Pre-initialize TinyMCE base URL so it doesn't auto-detect incorrectly
  if (url && !isUrlCdn) {
    const urlParts = url.split('/');
    urlParts.pop(); // remove 'tinymce.min.js'
    const baseUrl = urlParts.join('/');
    window.tinyMCEPreInit = {
      base: baseUrl,
      suffix: '.min'
    };
  } else {
    delete window.tinyMCEPreInit;
  }

  window.__TINYMCE_LOADING__ = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url || TINYMCE_CDN;
    script.referrerPolicy = 'origin';
    script.onload = () => resolve(window.tinymce);
    script.onerror = () => reject(new Error('Failed to load TinyMCE'));
    document.head.appendChild(script);
  });
  return window.__TINYMCE_LOADING__;
}

function markdownToHtml(markdown) {
  if (!markdown) return '';
  
  let normalizedText = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalizedText.split(/\n{2,}/);
  const htmlBlocks = [];
  let inList = false;
  let listType = '';
  
  function closeList() {
    if (inList) {
      htmlBlocks.push(`</${listType}>`);
      inList = false;
      listType = '';
    }
  }
  
  for (let block of blocks) {
    let trimmed = block.trim();
    if (!trimmed) continue;
    
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const content = parseInlineMarkdown(headingMatch[2]);
      htmlBlocks.push(`<h${level}>${content}</h${level}>`);
      continue;
    }
    
    if (trimmed.startsWith('>')) {
      closeList();
      const content = trimmed.split('\n').map(line => line.replace(/^>\s?/, '')).join('\n');
      htmlBlocks.push(`<blockquote>${markdownToHtml(content)}</blockquote>`);
      continue;
    }
    
    const ulMatch = trimmed.match(/^[\*\-\+]\s+(.*)$/);
    const olMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    
    if (ulMatch || olMatch) {
      const isOl = !!olMatch;
      const currentListType = isOl ? 'ol' : 'ul';
      
      if (!inList || listType !== currentListType) {
        closeList();
        inList = true;
        listType = currentListType;
        htmlBlocks.push(`<${listType}>`);
      }
      
      const lines = trimmed.split('\n');
      for (let line of lines) {
        let itemTrimmed = line.trim();
        const itemMatch = isOl ? itemTrimmed.match(/^\d+\.\s+(.*)$/) : itemTrimmed.match(/^[\*\-\+]\s+(.*)$/);
        if (itemMatch) {
          htmlBlocks.push(`<li>${parseInlineMarkdown(itemMatch[1])}</li>`);
        } else if (itemTrimmed) {
          const lastIdx = htmlBlocks.length - 1;
          if (lastIdx >= 0 && htmlBlocks[lastIdx].endsWith('</li>')) {
            htmlBlocks[lastIdx] = htmlBlocks[lastIdx].slice(0, -5) + ' ' + parseInlineMarkdown(itemTrimmed) + '</li>';
          }
        }
      }
      continue;
    }
    
    if (trimmed.startsWith('```')) {
      closeList();
      const lines = trimmed.split('\n');
      const lastLineIdx = lines[lines.length - 1].startsWith('```') ? lines.length - 1 : lines.length;
      const codeLines = lines.slice(1, lastLineIdx).join('\n');
      htmlBlocks.push(`<pre><code>${escapeHtml(codeLines)}</code></pre>`);
      continue;
    }
    
    closeList();
    const content = trimmed.split('\n').map(line => parseInlineMarkdown(line.trim())).join('<br>');
    htmlBlocks.push(`<p>${content}</p>`);
  }
  
  closeList();
  return htmlBlocks.join('\n');
}

function sanitizeUrl(url) {
  let trimmed = (url || '').trim();
  
  // Decode HTML entities
  try {
    const txt = document.createElement('textarea');
    txt.innerHTML = trimmed;
    trimmed = txt.value;
  } catch (e) {
    // ignore decode errors on malformed entities
  }

  // Try to decode percent URL-encoded characters
  try {
    trimmed = decodeURIComponent(trimmed);
  } catch (e) {
    // ignore decode errors on malformed percent-encodings
  }
  
  // Remove control characters (ASCII 0-32) and other invisible space characters
  trimmed = trimmed.replace(/[\x00-\x20\u200B\u2028\u2029]/g, '');
  
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) {
    return 'about:blank';
  }
  if (/^[a-z0-9+.-]+:/i.test(trimmed) && !/^(https?|mailto|tel):/i.test(trimmed)) {
    return 'about:blank';
  }
  return trimmed.replace(/"/g, '%22').replace(/'/g, '%27');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseInlineMarkdown(str) {
  let html = escapeHtml(str);
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, url) => {
    return `<img src="${sanitizeUrl(url)}" alt="${alt}">`;
  });
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, (match, text, url) => {
    return `<a href="${sanitizeUrl(url)}">${text}</a>`;
  });
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.*?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.*?)_/g, '<em>$1</em>');
  html = html.replace(/`(.*?)`/g, '<code>$1</code>');
  return html;
}

function htmlToMarkdown(html) {
  if (!html) return '';
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  let markdown = nodeToMarkdown(doc.body);
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  return markdown.trim();
}

function nodeToMarkdown(node) {
  let result = '';
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }
  const tagName = node.tagName.toLowerCase();
  let childrenMarkdown = '';
  for (let child of node.childNodes) {
    childrenMarkdown += nodeToMarkdown(child);
  }
  
  switch (tagName) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = parseInt(tagName.charAt(1), 10);
      result = '\n\n' + '#'.repeat(level) + ' ' + childrenMarkdown.trim() + '\n\n';
      break;
    }
    case 'p':
      result = '\n\n' + childrenMarkdown.trim() + '\n\n';
      break;
    case 'strong':
    case 'b':
      result = '**' + childrenMarkdown + '**';
      break;
    case 'em':
    case 'i':
      result = '*' + childrenMarkdown + '*';
      break;
    case 'code':
      result = '`' + childrenMarkdown + '`';
      break;
    case 'a': {
      const href = node.getAttribute('href') || '';
      result = '[' + childrenMarkdown + '](' + href + ')';
      break;
    }
    case 'img': {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      result = '![' + alt + '](' + src + ')';
      break;
    }
    case 'ul':
      result = '\n\n' + childrenMarkdown + '\n\n';
      break;
    case 'ol': {
      let olResult = '\n\n';
      let index = 1;
      for (let child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'li') {
          const itemMd = nodeToMarkdown(child).trim();
          olResult += `${index}. ${itemMd}\n`;
          index++;
        }
      }
      result = olResult + '\n';
      break;
    }
    case 'li': {
      const parent = node.parentNode;
      if (parent && parent.tagName.toLowerCase() === 'ol') {
        result = childrenMarkdown;
      } else {
        result = '* ' + childrenMarkdown.trim() + '\n';
      }
      break;
    }
    case 'blockquote':
      result = '\n\n' + childrenMarkdown.trim().split('\n').map(line => '> ' + line).join('\n') + '\n\n';
      break;
    case 'pre': {
      const codeEl = node.querySelector('code');
      if (codeEl) {
        result = '\n\n```\n' + codeEl.textContent + '\n```\n\n';
      } else {
        result = '\n\n```\n' + node.textContent + '\n```\n\n';
      }
      break;
    }
    case 'br':
      result = '\n';
      break;
    case 'div':
      result = '\n' + childrenMarkdown + '\n';
      break;
    default:
      result = childrenMarkdown;
      break;
  }
  return result;
}

function getAdminPath() {
  if (window.__MODERN_EDITOR_ADMIN_PATH__) {
    return window.__MODERN_EDITOR_ADMIN_PATH__;
  }
  if (window.GravAdmin?.config?.base_url_relative) {
    return window.GravAdmin.config.base_url_relative;
  }
  if (window.GravAdmin?.config?.base_url) {
    return window.GravAdmin.config.base_url;
  }
  if (window.Grav?.config?.base_url_relative) {
    return window.Grav.config.base_url_relative;
  }
  if (window.Grav?.config?.base_url) {
    return window.Grav.config.base_url;
  }
  
  const pathname = window.location.pathname;
  const adminIdx = pathname.indexOf('/admin');
  if (adminIdx !== -1) {
    return pathname.substring(0, adminIdx + 6);
  }
  return '/admin';
}

let cachedConfig = null;

async function fetchConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const adminPath = getAdminPath();
  const cleanAdminPath = adminPath.endsWith('/') ? adminPath.slice(0, -1) : adminPath;
  const url = cleanAdminPath + '/plugins/modern-editor?action=get_config';

  try {
    const response = await fetch(url);
    if (response.ok) {
      cachedConfig = await response.json();
      return cachedConfig;
    }
  } catch (err) {
    console.error('Failed to fetch Modern Editor config:', err);
  }

  return {
    editor_source: 'cdn',
    editor_url: TINYMCE_CDN,
    height: 500,
    menubar: true,
    plugins: "lists link image table code fullscreen searchreplace media",
    toolbar: "undo redo | blocks | bold italic underline forecolor backcolor | bullist numlist | link image media table | code fullscreen"
  };
}

function getEditorUrl(field) {
  // 1. Detect the dynamic plugin root path via the script tag of moderneditor.js
  let localPrefix = '';
  const scriptEl = document.querySelector('script[src*="moderneditor.js"]');
  if (scriptEl) {
    const src = scriptEl.getAttribute('src') || '';
    const idx = src.indexOf('/admin-next/fields/moderneditor.js');
    if (idx !== -1) {
      localPrefix = src.substring(0, idx);
    }
  }

  // 2. Check the configured editor URL from the blueprint / global variable
  const configUrl = window.__MODERN_EDITOR_URL__ || field?.editor_url || '';

  // 3. If local source is active or configUrl points to a local file, construct a perfect local URL
  const isCdn = configUrl.includes('cdn.jsdelivr.net') || configUrl.includes('tiny.cloud') || configUrl.includes('cdnjs');
  if (field?.editor_source === 'local' || (configUrl && !isCdn)) {
    if (localPrefix) {
      return localPrefix + '/assets/tinymce/tinymce.min.js';
    }
    return configUrl;
  }

  // Fallback to CDN or global URL
  return configUrl || TINYMCE_CDN;
}

function ensureBaseUrl(url) {
  const isCdn = url.includes('cdn.jsdelivr.net') || url.includes('tiny.cloud') || url.includes('cdnjs');
  if (window.tinymce && url && !isCdn) {
    const urlParts = url.split('/');
    urlParts.pop(); // remove 'tinymce.min.js'
    const baseUrl = urlParts.join('/');
    window.tinymce.baseURL = baseUrl;
    if (window.tinyMCE) {
      window.tinyMCE.baseURL = baseUrl;
    }
  }
}

class TinyMCEField extends HTMLElement {
  _field = null;
  _value = '';
  _editor = null;
  _editorId = null;
  _applying = false; // Avoid loop while applying an external value
  _ready = false;
  _bootstrapped = false;

  set field(f) {
    this._field = f || {};
    if (this.shadowRoot) {
      this._bootstrap();
    }
    if (this._ready) this._maybeReinit();
  }

  get field() {
    return this._field;
  }

  set value(v) {
    const newVal = v ?? '';
    this._value = newVal;
    if (this._editor && this._ready) {
      let htmlVal = newVal;
      if (typeof markdownToHtml === 'function') {
        htmlVal = markdownToHtml(newVal);
      }
      const current = this._editor.getContent();
      if (current !== htmlVal) {
        this._applying = true;
        this._editor.setContent(htmlVal);
        this._applying = false;
      }
    }
  }

  get value() {
    return this._value;
  }

  _detectDarkMode() {
    try {
      const isDarkClass = document.documentElement.classList.contains('dark') ||
                          document.documentElement.classList.contains('dark-mode') ||
                          document.body.classList.contains('dark') ||
                          document.body.classList.contains('dark-mode') ||
                          document.body.classList.contains('theme-dark') ||
                          document.documentElement.classList.contains('theme-dark') ||
                          document.documentElement.getAttribute('data-theme') === 'dark' ||
                          document.body.getAttribute('data-theme') === 'dark';
      
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      
      return isDarkClass || prefersDark;
    } catch (e) {
      return false;
    }
  }

  connectedCallback() {
    this._editorId = 'tinymce-field-' + Math.random().toString(36).slice(2, 10);
    this.attachShadow({ mode: 'open' });
    if (this._field) {
      this._bootstrap();
    }
  }

  async _bootstrap() {
    if (this._bootstrapped) return;
    if (!this._field) return;
    this._bootstrapped = true;

    const isDarkMode = this._detectDarkMode();
    this._renderShell(isDarkMode);

    try {
      const dCfg = await fetchConfig();
      this._field = {
        ...dCfg,
        ...this._field,
        editor_source: dCfg.editor_source,
        editor_url: dCfg.editor_url,
        height: dCfg.height || this._field.height,
        menubar: dCfg.menubar,
        plugins: dCfg.plugins || this._field.plugins,
        toolbar: dCfg.toolbar || this._field.toolbar,
      };
    } catch (e) {
      console.warn('Could not fetch server config for Modern Editor, using local defaults.', e);
    }

    const url = getEditorUrl(this._field);

    loadTinyMCE(url)
      .then(() => {
        ensureBaseUrl(url);
        this._initEditor(isDarkMode);
      })
      .catch((err) => this._renderError(err));
  }

  disconnectedCallback() {
    if (this._editor) {
      try {
        this._editor.remove();
      } catch (e) {
        /* noop */
      }
      this._editor = null;
      this._ready = false;
    }
  }

  _renderShell(isDarkMode) {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; }
        .wrap {
          border: 1px solid ${isDarkMode ? '#3f3f46' : '#d1d5db'};
          border-radius: 6px;
          overflow: hidden;
          background-color: ${isDarkMode ? '#18181b' : '#ffffff'};
        }
        .loading {
          padding: 24px; font-size: 13px; color: ${isDarkMode ? '#a1a1aa' : '#6b7280'}; font-style: italic;
        }
        .error {
          padding: 12px; font-size: 13px; color: #b91c1c; background: #fef2f2;
          border: 1px solid #fecaca; border-radius: 6px;
        }
        .ui-container {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          z-index: 99999;
        }
      </style>
      <div class="wrap">
        <div class="loading">Loading visual editor…</div>
        <textarea id="${this._editorId}" style="display:none;"></textarea>
      </div>
      <div class="ui-container"></div>
    `;
  }

  _renderError(err) {
    this.shadowRoot.innerHTML = `
      <style>.error { padding: 12px; font-size: 13px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; }</style>
      <div class="error">Error loading visual editor: ${this._esc(err.message)}</div>
    `;
  }

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }

  _cfg() {
    const f = this._field || {};
    const mVal = f.menubar;
    const isMenubarEnabled = mVal === undefined || mVal === true || mVal === 'true' || mVal === 1 || mVal === '1';
    
    // Ensure the toolbar contains forecolor and backcolor to allow changing the text/background color
    let toolbar = f.toolbar || 'undo redo | blocks | bold italic underline forecolor backcolor | bullist numlist | link image media table | code fullscreen';
    if (toolbar && !toolbar.includes('forecolor')) {
      // If manually defined in the user's blueprint but does not contain color picker options, inject them
      toolbar = toolbar.replace('bold italic underline', 'bold italic underline forecolor backcolor');
    }

    return {
      height: parseInt(f.height, 10) || 500,
      menubar: isMenubarEnabled,
      plugins: f.plugins || 'lists link image table code fullscreen searchreplace media',
      toolbar: toolbar,
    };
  }

  _initEditor(isDarkMode) {
    const textarea = this.shadowRoot.getElementById(this._editorId);
    if (!textarea) return;

    textarea.style.display = '';
    this.shadowRoot.querySelector('.loading')?.remove();

    const cfg = this._cfg();
    const uiContainer = this.shadowRoot.querySelector('.ui-container');

    const initOpts = {
      target: textarea,
      license_key: 'gpl',
      // TinyMCE is mounted inside the Shadow DOM: this must be explicitly set.
      inline: false,
      height: cfg.height,
      menubar: cfg.menubar,
      plugins: cfg.plugins,
      toolbar: cfg.toolbar,
      branding: false,
      promotion: false, // Hides the "Get all features" button/badge
      skin: isDarkMode ? 'oxide-dark' : 'oxide',
      content_css: isDarkMode ? 'dark' : 'default',
      // Allows TinyMCE to detect the shadow root host for external click handling
      custom_ui_selector: TAG,
      // Anchors popup menus/dialogs to our ui-container in the Shadow DOM
      ui_container: uiContainer,
      setup: (editor) => {
        editor.on('init', () => {
          this._editor = editor;
          this._ready = true;
          let htmlVal = this._value || '';
          if (typeof markdownToHtml === 'function') {
            htmlVal = markdownToHtml(htmlVal);
          }
          editor.setContent(htmlVal);
        });
        editor.on('change keyup undo redo', () => {
          if (this._applying) return;
          const html = editor.getContent();
          let mdVal = html;
          if (typeof htmlToMarkdown === 'function') {
            mdVal = htmlToMarkdown(html);
          }
          this._value = mdVal;
          this.dispatchEvent(new CustomEvent('change', {
            detail: mdVal,
            bubbles: true,
          }));
        });
      },
    };

    // If loading from local path, specify base_url so TinyMCE can load its assets (plugins, skins, themes) correctly
    const editorUrl = getEditorUrl(this._field);
    if (editorUrl && !isTrustedTinyMceCdnUrl(editorUrl)) {
      const urlParts = editorUrl.split('/');
      urlParts.pop(); // remove 'tinymce.min.js'
      initOpts.base_url = urlParts.join('/');
    }

    window.tinymce.init(initOpts).catch((err) => this._renderError(err));
  }

  _maybeReinit() {
    // If a relevant configuration option changes after initialization (e.g., toolbar), reinitialize the editor.
    if (!this._editor) return;
    const isDarkMode = this._detectDarkMode();
    const editorUrl = getEditorUrl(this._field);
    const current = JSON.stringify({ ...this._cfg(), isDarkMode, editor_url: editorUrl });
    if (this._lastCfg === current) return;
    this._lastCfg = current;
    const html = this._editor.getContent();
    let mdVal = html;
    if (typeof htmlToMarkdown === 'function') {
      mdVal = htmlToMarkdown(html);
    }
    this._editor.remove();
    this._ready = false;
    this._renderShell(isDarkMode);
    
    loadTinyMCE(editorUrl).then(() => {
      ensureBaseUrl(editorUrl);
      this._initEditor(isDarkMode);
      this._value = mdVal;
    });
  }
}

customElements.define(TAG, TinyMCEField);
