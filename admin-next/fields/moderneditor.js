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

let markdownLibrariesPromise = null;

function loadMarkdownLibraries(dCfg) {
  if (markdownLibrariesPromise) {
    return markdownLibrariesPromise;
  }

  // Three layers, in order of priority, mirroring getEditorUrl()'s logic
  // for TinyMCE itself:
  //  1. window.__MODERN_EDITOR_MD_URLS__, injected server-side (see
  //     onAssetsInitialized() / getMarkdownLibraryUrls() in
  //     modern-editor.php) — fastest, but only reaches the browser if the
  //     current response actually renders Grav's queued assets.
  //  2. dCfg.marked_url / dCfg.turndown_url, fetched via the REST
  //     /modern-editor/config endpoint (see getConfigData()) — this is
  //     the same reliable request the field already makes for
  //     height/menubar/plugins/toolbar, so it works even when (1) is
  //     missing, which used to be the reason "local" mode kept silently
  //     loading these two libraries from the CDN.
  //  3. Hardcoded jsDelivr CDN URLs — last resort.
  // When "local" mode is active and the files have been downloaded, (1)
  // and (2) point at the plugin's own self-hosted copies instead of
  // jsDelivr — both marked and turndown are MIT licensed, so self-hosting
  // them is just a matter of avoiding external calls, not a licensing
  // concern.
  const mdUrls = window.__MODERN_EDITOR_MD_URLS__ || {};
  const MARKED_URL = mdUrls.marked || dCfg?.marked_url || 'https://cdn.jsdelivr.net/npm/marked@12.0.0/lib/marked.umd.js';
  const TURNDOWN_URL = mdUrls.turndown || dCfg?.turndown_url || 'https://cdn.jsdelivr.net/npm/turndown@7.1.3/dist/turndown.js';

  markdownLibrariesPromise = new Promise((resolve) => {
    let loadedCount = 0;
    const totalToLoad = 2;

    function checkDone() {
      loadedCount++;
      if (loadedCount === totalToLoad) {
        resolve();
      }
    }

    // 1. Load marked
    if (window.marked) {
      loadedCount++;
    } else {
      const scriptMarked = document.createElement('script');
      scriptMarked.src = MARKED_URL;
      scriptMarked.onload = checkDone;
      scriptMarked.onerror = checkDone;
      document.head.appendChild(scriptMarked);
    }

    // 2. Load turndown
    if (window.TurndownService) {
      loadedCount++;
    } else {
      const scriptTurndown = document.createElement('script');
      scriptTurndown.src = TURNDOWN_URL;
      scriptTurndown.onload = checkDone;
      scriptTurndown.onerror = checkDone;
      document.head.appendChild(scriptTurndown);
    }

    if (loadedCount === totalToLoad) {
      resolve();
    }
  });

  return markdownLibrariesPromise;
}

function mdToHtml(md) {
  if (!md) return '';
  if (!window.marked) return md;

  let html = window.marked.parse ? window.marked.parse(md) : window.marked(md);

  // Post-process HTML to identify GitHub Alerts and render beautiful blockquote styles
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const blockquotes = doc.querySelectorAll('blockquote');
    
    blockquotes.forEach(bq => {
      const text = bq.textContent.trim();
      const match = text.match(/^\[\!([A-Z]+)\]/i);
      if (match) {
        const alertType = match[1].toUpperCase();
        bq.classList.add('markdown-alert', `markdown-alert-${alertType.toLowerCase()}`);
        
        const firstP = bq.querySelector('p');
        if (firstP) {
          let inner = firstP.innerHTML;
          inner = inner.replace(/^\[\!([A-Z]+)\]/i, '<strong>[!$1]</strong>');
          firstP.innerHTML = inner;
        }
      }
    });
    return doc.body.innerHTML;
  } catch (e) {
    console.error('Error post-processing markdown alerts', e);
    return html;
  }
}

function htmlToMd(html) {
  if (!html) return '';
  if (!window.TurndownService) return html;

  const turndownService = new window.TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '*',
    codeBlockStyle: 'fenced',
    emDelimiter: '_'
  });

  // Fix for issue #12: turndown's default escape() also escapes "[" and "]",
  // which breaks Twig expressions typed directly in the content (e.g.
  // {{media['thumbs://...'].html(...)|raw}}) by turning them into
  // {{media\['thumbs://...'\]...}}, causing a Twig SyntaxError in Grav.
  // Square brackets are not reserved Markdown syntax on their own (only
  // "[text](url)" links are, and that pattern is generated by dedicated
  // rules, not by this generic text-escaping function), so it's safe to
  // stop escaping them while keeping every other Markdown escape intact.
  turndownService.escape = function (string) {
    return string
      .replace(/\\/g, '\\\\')
      .replace(/\*/g, '\\*')
      .replace(/^-/g, '\\-')
      .replace(/^\+ /g, '\\+ ')
      .replace(/^(=+)/g, '\\$1')
      .replace(/^(#{1,6}) /g, '\\$1 ')
      .replace(/`/g, '\\`')
      .replace(/^~~~/g, '\\~~~')
      .replace(/^>/g, '\\>')
      .replace(/_/g, '\\_')
      .replace(/^(\d+)\. /g, '$1\\. ');
  };

  turndownService.addRule('markdownAlerts', {
    filter: function (node) {
      return (
        node.nodeName === 'BLOCKQUOTE' &&
        (node.classList.contains('markdown-alert') ||
         node.textContent.includes('[!NOTE]') ||
         node.textContent.includes('[!TIP]') ||
         node.textContent.includes('[!IMPORTANT]') ||
         node.textContent.includes('[!WARNING]') ||
         node.textContent.includes('[!CAUTION]'))
      );
    },
    replacement: function (content, node) {
      let alertType = 'NOTE';
      if (node.classList.contains('markdown-alert-tip') || node.textContent.includes('[!TIP]')) alertType = 'TIP';
      else if (node.classList.contains('markdown-alert-important') || node.textContent.includes('[!IMPORTANT]')) alertType = 'IMPORTANT';
      else if (node.classList.contains('markdown-alert-warning') || node.textContent.includes('[!WARNING]')) alertType = 'WARNING';
      else if (node.classList.contains('markdown-alert-caution') || node.textContent.includes('[!CAUTION]')) alertType = 'CAUTION';

      const lines = content.split('\n');
      const cleanedLines = lines.map(line => {
        let l = line.trim();
        if (l.startsWith('>')) {
          l = l.substring(1).trim();
        }
        l = l.replace(/\*\*\[\!([A-Z]+)\]\*\*/g, '');
        l = l.replace(/_\[\!([A-Z]+)\]_/g, '');
        l = l.replace(/\[\!([A-Z]+)\]/g, '');
        return l.trim();
      }).filter(l => l.length > 0);

      const resultLines = [`[!${alertType}]`, ...cleanedLines];
      return '\n\n' + resultLines.map(l => '> ' + l).join('\n') + '\n\n';
    }
  });

  let md = turndownService.turndown(html);
  md = md.replace(/\n{3,}/g, '\n\n');
  return md;
}

// Minimal, self-contained Italian UI translation for TinyMCE. Registered
// via tinymce.addI18n() instead of fetching an external language pack file
// (CDN or local), keeping Italian support free of any extra network call.
// Covers the toolbar/menu strings a content editor actually sees; anything
// not listed here simply falls back to TinyMCE's built-in English default.
const TINYMCE_IT_I18N = {
  'Bold': 'Grassetto', 'Italic': 'Corsivo', 'Underline': 'Sottolineato',
  'Text color': 'Colore testo', 'Background color': 'Colore sfondo',
  'Bullet list': 'Elenco puntato', 'Numbered list': 'Elenco numerato',
  'Align left': 'Allinea a sinistra', 'Align center': 'Allinea al centro',
  'Align right': 'Allinea a destra', 'Justify': 'Giustifica',
  'Insert/edit link': 'Inserisci/modifica link', 'Remove link': 'Rimuovi link',
  'Insert/edit image': 'Inserisci/modifica immagine', 'Insert/edit media': 'Inserisci/modifica media',
  'Insert table': 'Inserisci tabella', 'Table': 'Tabella',
  'Source code': 'Codice sorgente', 'Fullscreen': 'Schermo intero',
  'Find and replace...': 'Trova e sostituisci...', 'Find': 'Trova', 'Replace': 'Sostituisci', 'Replace all': 'Sostituisci tutto',
  'Undo': 'Annulla', 'Redo': 'Ripeti',
  'Paragraph': 'Paragrafo', 'Heading 1': 'Titolo 1', 'Heading 2': 'Titolo 2', 'Heading 3': 'Titolo 3',
  'Heading 4': 'Titolo 4', 'Heading 5': 'Titolo 5', 'Heading 6': 'Titolo 6', 'Blocks': 'Blocchi',
  'Save': 'Salva', 'Cancel': 'Annulla', 'Close': 'Chiudi', 'Ok': 'Ok',
  'Insert': 'Inserisci', 'Edit': 'Modifica', 'View': 'Visualizza', 'Format': 'Formato', 'Tools': 'Strumenti',
};

function detectItalianLocale(dCfg) {
  // window.__MODERN_EDITOR_ADMIN_LANG__ / dCfg.lang are computed by
  // getUiLanguage() in modern-editor.php, which now checks the plugin's
  // own explicit "ui_language" setting FIRST (see blueprints.yaml) before
  // any auto-detection — the one thing guaranteed to be correct regardless
  // of how a given Admin Next build exposes its own UI language. This is
  // checked before document.documentElement.lang on purpose: that signal
  // turned out to NOT reliably reflect Grav's configured admin language on
  // every Admin Next build, which is exactly what caused the editor to
  // keep loading in English despite Grav being set to Italian.
  if (window.__MODERN_EDITOR_ADMIN_LANG__ === 'it' || window.__MODERN_EDITOR_ADMIN_LANG__ === 'en') {
    return window.__MODERN_EDITOR_ADMIN_LANG__ === 'it';
  }
  if (dCfg && (dCfg.lang === 'it' || dCfg.lang === 'en')) {
    return dCfg.lang === 'it';
  }
  try {
    return document.documentElement.lang === 'it';
  } catch (e) {
    return false;
  }
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

// Builds an AJAX request for a plugin action, preferring the real Grav
// 2.0 / Admin2 REST API (window.__GRAV_API_SERVER_URL + __GRAV_API_PREFIX,
// authenticated via the X-API-Token header — NOT Authorization: Bearer,
// which FastCGI/PHP-FPM setups can silently strip). Admin2 is a decoupled
// SPA served by its own thin wrapper that returns the same shell HTML for
// any /panel/* sub-route, so the old approach of adding ?action=... to the
// current admin page URL never reached our PHP at all under Admin2 — it
// only ever worked under classic Grav 1.x admin, kept here as a fallback.
function apiRequest(path, classicAction) {
  // Same priority as detectItalianLocale(): the server-computed global
  // (which now honors the plugin's explicit "ui_language" setting) comes
  // first; document.documentElement.lang is only a last-resort guess.
  // Never navigator.language.
  let lang = null;
  if (window.__MODERN_EDITOR_ADMIN_LANG__ === 'it' || window.__MODERN_EDITOR_ADMIN_LANG__ === 'en') {
    lang = window.__MODERN_EDITOR_ADMIN_LANG__;
  } else {
    try {
      if (document.documentElement.lang === 'it' || document.documentElement.lang === 'en') {
        lang = document.documentElement.lang;
      }
    } catch (e) { /* noop */ }
  }

  // __GRAV_API_PREFIX is the real signal that Admin2's API is present.
  // __GRAV_API_SERVER_URL can legitimately be "" (meaning "same origin as
  // the current page"), which is falsy in JS — checking `&&` on it wrongly
  // treated a same-origin API as "not available" and silently fell back
  // to the broken classic ?action= mechanism (returns the SPA's HTML).
  if (window.__GRAV_API_PREFIX !== undefined && window.__GRAV_API_PREFIX !== null) {
    const urlObj = new URL((window.__GRAV_API_SERVER_URL || '') + window.__GRAV_API_PREFIX + path, window.location.href);
    if (lang) urlObj.searchParams.set('lang', lang);
    const url = urlObj.toString();
    const headers = window.__GRAV_API_TOKEN ? { 'X-API-Token': window.__GRAV_API_TOKEN } : {};
    return fetch(url, { headers }).then(r => ({ res: r, url }));
  }
  const url = new URL(window.location.href);
  url.searchParams.set('action', classicAction);
  if (lang) url.searchParams.set('lang', lang);
  return fetch(url.toString()).then(r => ({ res: r, url: url.toString() }));
}

let cachedConfig = null;

async function fetchConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const { res, url } = await apiRequest('/modern-editor/config', 'get_config');
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const body = await res.json();
        // The Grav 2.0 API wraps payloads as {"data": {...}}; the legacy
        // classic-admin fallback returns the object directly.
        cachedConfig = body && typeof body === 'object' && 'data' in body ? body.data : body;
        return cachedConfig;
      }
      console.warn('Modern Editor: get_config returned a non-JSON response.', url);
    } else {
      console.warn(`Modern Editor: get_config request failed (HTTP ${res.status}).`, url);
    }
  } catch (err) {
    console.warn('Modern Editor: get_config request errored.', err);
  }

  // Returning null (instead of a hardcoded CDN-default object) is
  // deliberate: the caller must NOT overwrite the editor_source/editor_url
  // already present in the field (set correctly server-side from the
  // blueprint) with a forced 'cdn' value just because this best-effort
  // AJAX refresh failed.
  return null;
}

function getEditorUrl(field) {
  // The blueprint (delivered by Admin2's own field/value properties, or
  // by classic admin's server-rendered field) already carries the correct
  // editor_url computed server-side (see getEditorScriptUrl() in
  // modern-editor.php, which uses Grav's resource locator +
  // base_url_relative — the only reliable way to compute it). This is now
  // the PRIMARY source: it doesn't depend on any AJAX call succeeding.
  // window.__MODERN_EDITOR_URL__ (classic-admin-only global) is a
  // secondary fallback for classic Grav 1.x admin; CDN is the last resort.
  return field?.editor_url || window.__MODERN_EDITOR_URL__ || TINYMCE_CDN;
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
      const htmlVal = mdToHtml(newVal);
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

    let dCfg = null;
    try {
      dCfg = await fetchConfig();
      if (dCfg) {
        this._field = {
          ...dCfg,
          ...this._field,
          // editor_source/editor_url intentionally NOT overwritten here:
          // this._field already has the correct values from the blueprint
          // (see getEditorUrl()), and this AJAX call is a best-effort
          // refresh for the rest of the settings only.
          height: dCfg.height || this._field.height,
          menubar: dCfg.menubar,
          plugins: dCfg.plugins || this._field.plugins,
          toolbar: dCfg.toolbar || this._field.toolbar,
        };
      }
    } catch (e) {
      console.warn('Could not fetch server config for Modern Editor, using field defaults from the blueprint.', e);
    }

    this._dCfg = dCfg;
    const url = getEditorUrl(this._field);

    Promise.all([
      loadMarkdownLibraries(dCfg).catch(err => console.warn('Markdown libs load failed', err)),
      loadTinyMCE(url)
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
    const isIt = detectItalianLocale(this._dCfg);
    const loadingLabel = isIt ? 'Caricamento editor visuale…' : 'Loading visual editor…';
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
        <div class="loading">${loadingLabel}</div>
        <textarea id="${this._editorId}" style="display:none;"></textarea>
      </div>
      <div class="ui-container"></div>
    `;
  }

  _renderError(err) {
    const isIt = detectItalianLocale(this._dCfg);
    const errorLabel = isIt ? 'Errore durante il caricamento dell\'editor visuale: ' : 'Error loading visual editor: ';
    this.shadowRoot.innerHTML = `
      <style>.error { padding: 12px; font-size: 13px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; }</style>
      <div class="error">${errorLabel}${this._esc(err.message)}</div>
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
    let toolbar = f.toolbar || 'undo redo | blocks | bold italic underline forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist | link image media table | code fullscreen';
    if (toolbar && !toolbar.includes('forecolor')) {
      // If manually defined in the user's blueprint but does not contain color picker options, inject them
      toolbar = toolbar.replace('bold italic underline', 'bold italic underline forecolor backcolor');
    }
    if (toolbar && !toolbar.includes('alignleft')) {
      // Same as above, but for the text-alignment buttons (issue request):
      // inject them right after the color pickers (or after bold/italic/underline
      // if forecolor/backcolor aren't present either).
      if (toolbar.includes('forecolor backcolor')) {
        toolbar = toolbar.replace('forecolor backcolor', 'forecolor backcolor | alignleft aligncenter alignright alignjustify');
      } else if (toolbar.includes('bold italic underline')) {
        toolbar = toolbar.replace('bold italic underline', 'bold italic underline | alignleft aligncenter alignright alignjustify');
      }
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

    const useItalian = detectItalianLocale(this._dCfg);
    if (useItalian && window.tinymce) {
      // Calling addI18n again with the same language is harmless (it just
      // re-registers the same strings), so there's no need to check
      // whether it was already registered — that previous check assumed
      // tinymce.i18n.data always exists, which isn't guaranteed across
      // TinyMCE builds and caused "Cannot read properties of undefined
      // (reading 'it')" to break the editor entirely.
      try {
        window.tinymce.addI18n('it', TINYMCE_IT_I18N);
      } catch (e) {
        console.warn('Modern Editor: could not register Italian UI strings for TinyMCE', e);
      }
    }

    const initOpts = {
      target: textarea,
      license_key: 'gpl',
      // TinyMCE is mounted inside the Shadow DOM: this must be explicitly set.
      inline: false,
      language: useItalian ? 'it' : undefined,
      height: cfg.height,
      menubar: cfg.menubar,
      plugins: cfg.plugins,
      toolbar: cfg.toolbar,
      branding: false,
      promotion: false, // Hides the "Get all features" button/badge
      skin: isDarkMode ? 'oxide-dark' : 'oxide',
      content_css: isDarkMode ? 'dark' : 'default',
      content_style: `
        blockquote {
          border-left: 4px solid ${isDarkMode ? '#4b5563' : '#d1d5db'} !important;
          padding-left: 1rem !important;
          margin-left: 0 !important;
          margin-right: 0 !important;
          color: ${isDarkMode ? '#9ca3af' : '#4b5563'} !important;
        }
        .markdown-alert {
          border-left: 4px solid !important;
          padding: 12px 16px !important;
          margin: 16px 0 !important;
          border-radius: 0 6px 6px 0 !important;
        }
        .markdown-alert-note {
          border-left-color: #2563eb !important;
          background-color: ${isDarkMode ? '#1e293b' : '#eff6ff'} !important;
          color: ${isDarkMode ? '#93c5fd' : '#1e3a8a'} !important;
        }
        .markdown-alert-tip {
          border-left-color: #10b981 !important;
          background-color: ${isDarkMode ? '#064e3b' : '#f0fdf4'} !important;
          color: ${isDarkMode ? '#a7f3d0' : '#14532d'} !important;
        }
        .markdown-alert-important {
          border-left-color: #7c3aed !important;
          background-color: ${isDarkMode ? '#2e1065' : '#f5f3ff'} !important;
          color: ${isDarkMode ? '#ddd6fe' : '#4c1d95'} !important;
        }
        .markdown-alert-warning {
          border-left-color: #d97706 !important;
          background-color: ${isDarkMode ? '#451a03' : '#fffbeb'} !important;
          color: ${isDarkMode ? '#fde68a' : '#78350f'} !important;
        }
        .markdown-alert-caution {
          border-left-color: #dc2626 !important;
          background-color: ${isDarkMode ? '#450a0a' : '#fef2f2'} !important;
          color: ${isDarkMode ? '#fecaca' : '#7f1d1d'} !important;
        }
      `,
      // Allows TinyMCE to detect the shadow root host for external click handling
      custom_ui_selector: TAG,
      // Anchors popup menus/dialogs to our ui-container in the Shadow DOM
      ui_container: uiContainer,
      setup: (editor) => {
        editor.on('init', () => {
          this._editor = editor;
          this._ready = true;
          editor.setContent(mdToHtml(this._value || ''));
        });
        editor.on('change keyup undo redo', () => {
          if (this._applying) return;
          const html = editor.getContent();
          const md = htmlToMd(html);
          this._value = md;
          this.dispatchEvent(new CustomEvent('change', {
            detail: md,
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
    const mdVal = htmlToMd(this._editor.getContent());
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
