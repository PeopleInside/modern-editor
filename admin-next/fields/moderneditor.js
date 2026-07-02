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

function getLocalPrefix() {
  const scriptEl = document.querySelector('script[src*="moderneditor.js"]');
  if (scriptEl) {
    const src = scriptEl.getAttribute('src') || '';
    const idx = src.indexOf('/admin-next/fields/moderneditor.js');
    if (idx !== -1) {
      return src.substring(0, idx);
    }
  }
  return '';
}

function loadScript(url, globalName) {
  if (window[globalName]) {
    return Promise.resolve(window[globalName]);
  }
  const loadingKey = '__LOADING_' + globalName + '__';
  if (window[loadingKey]) {
    return window[loadingKey];
  }
  window[loadingKey] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => {
      delete window[loadingKey];
      resolve(window[globalName]);
    };
    script.onerror = () => {
      delete window[loadingKey];
      reject(new Error('Failed to load ' + globalName));
    };
    document.head.appendChild(script);
  });
  return window[loadingKey];
}

function loadMarkdownLibraries() {
  const localPrefix = getLocalPrefix();
  const markedUrl = localPrefix ? localPrefix + '/admin-next/fields/lib/marked.min.js' : 'https://cdn.jsdelivr.net/npm/marked@12.0.1/marked.min.js';
  const turndownUrl = localPrefix ? localPrefix + '/admin-next/fields/lib/turndown.min.js' : 'https://cdn.jsdelivr.net/npm/turndown@7.1.3/dist/turndown.min.js';

  return Promise.all([
    loadScript(markedUrl, 'marked'),
    loadScript(turndownUrl, 'TurndownService')
  ]);
}

function convertMarkdownToHtml(markdown) {
  if (window.marked) {
    if (typeof window.marked.parse === 'function') {
      return window.marked.parse(markdown);
    }
    if (typeof window.marked === 'function') {
      return window.marked(markdown);
    }
  }
  console.warn('Modern Editor: window.marked is not loaded. Displaying raw content.');
  return markdown;
}

function convertHtmlToMarkdown(html) {
  if (window.TurndownService) {
    const turndownService = new window.TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced'
    });
    return turndownService.turndown(html);
  }
  console.warn('Modern Editor: window.TurndownService is not loaded. Saving content as HTML.');
  return html;
}

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
  
  // Dynamic parsing of the first segment after Grav site base relative path
  let siteBase = '';
  if (window.GravAdmin?.config?.base_url_relative) {
    siteBase = window.GravAdmin.config.base_url_relative;
  } else if (window.Grav?.config?.base_url_relative) {
    siteBase = window.Grav.config.base_url_relative;
  }
  
  if (siteBase.endsWith('/')) {
    siteBase = siteBase.slice(0, -1);
  }
  
  if (pathname.startsWith(siteBase)) {
    const relativePath = pathname.substring(siteBase.length);
    const segments = relativePath.split('/').filter(Boolean);
    if (segments.length > 0) {
      return siteBase + '/' + segments[0];
    }
  }
  
  const adminKeywords = [
    '/plugins', '/pages', '/dashboard', '/themes', '/configuration', 
    '/config', '/tools', '/navigation', '/media', '/users'
  ];
  for (const kw of adminKeywords) {
    const idx = pathname.indexOf(kw);
    if (idx > 0) {
      const nextChar = pathname.charAt(idx + kw.length);
      if (nextChar === '' || nextChar === '/') {
        return pathname.substring(0, idx);
      }
    }
  }
  
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
  const localPrefix = getLocalPrefix();

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
  _lastHtml = '';

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
      const newHtml = convertMarkdownToHtml(newVal);
      if (this._lastHtml !== newHtml) {
        const currentHtml = this._editor.getContent();
        if (currentHtml !== newHtml) {
          this._applying = true;
          this._editor.setContent(newHtml);
          this._lastHtml = newHtml;
          this._applying = false;
        }
      }
    }
  }

  get value() {
    if (this._editor && this._ready) {
      return convertHtmlToMarkdown(this._editor.getContent());
    }
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

    Promise.all([
      loadTinyMCE(url),
      loadMarkdownLibraries()
    ])
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
          const html = convertMarkdownToHtml(this._value || '');
          this._lastHtml = html;
          editor.setContent(html);
        });
        editor.on('change keyup undo redo', () => {
          if (this._applying) return;
          const html = editor.getContent();
          if (this._lastHtml === html) return;
          this._lastHtml = html;
          const markdown = convertHtmlToMarkdown(html);
          this._value = markdown;
          this.dispatchEvent(new CustomEvent('change', {
            detail: markdown,
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
    const markdown = convertHtmlToMarkdown(this._editor.getContent());
    this._editor.remove();
    this._ready = false;
    this._renderShell(isDarkMode);
    
    Promise.all([
      loadTinyMCE(editorUrl),
      loadMarkdownLibraries()
    ]).then(() => {
      ensureBaseUrl(editorUrl);
      this._initEditor(isDarkMode);
      this._value = markdown;
      this._lastHtml = ''; // Reset cached HTML on re-initialization
    });
  }
}

customElements.define(TAG, TinyMCEField);
