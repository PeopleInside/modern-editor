/**
 * Modern Editor — Custom Field for Admin Next (Grav 2.0)
 * (based on TinyMCE, loaded from CDN)
 *
 * Implements the Web Component contract required by Admin Next:
 *  - receives `field` (blueprint definition) and `value` (current content) via setters
 *  - emits a `change` event (bubbles: true) when the content changes
 *
 * TinyMCE is loaded dynamically from CDN (no bundler/build step required).
 * The value exchanged with Admin Next is always HTML (string).
 *
 * This field is automatically applied to the "content" field of each
 * page by the PHP plugin (see modern-editor.php), without needing to
 * modify theme blueprints. The field type is called "moderneditor".
 */

const TAG = window.__GRAV_FIELD_TAG;
const TINYMCE_CDN = 'https://cdn.jsdelivr.net/npm/tinymce@7/tinymce.min.js';

// Load TinyMCE script once, even if multiple instances of the field are present.
function loadTinyMCE() {
  if (window.tinymce) {
    return Promise.resolve(window.tinymce);
  }
  if (window.__TINYMCE_LOADING__) {
    return window.__TINYMCE_LOADING__;
  }
  window.__TINYMCE_LOADING__ = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TINYMCE_CDN;
    script.referrerPolicy = 'origin';
    script.onload = () => resolve(window.tinymce);
    script.onerror = () => reject(new Error('Failed to load TinyMCE from CDN'));
    document.head.appendChild(script);
  });
  return window.__TINYMCE_LOADING__;
}

class TinyMCEField extends HTMLElement {
  _field = null;
  _value = '';
  _editor = null;
  _editorId = null;
  _applying = false; // Avoid loop while applying an external value
  _ready = false;

  set field(f) {
    this._field = f || {};
    if (this._ready) this._maybeReinit();
  }

  get field() {
    return this._field;
  }

  set value(v) {
    const newVal = v ?? '';
    this._value = newVal;
    if (this._editor && this._ready) {
      const current = this._editor.getContent();
      if (current !== newVal) {
        this._applying = true;
        this._editor.setContent(newVal);
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
    const isDarkMode = this._detectDarkMode();
    this._renderShell(isDarkMode);
    loadTinyMCE()
      .then(() => this._initEditor(isDarkMode))
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

    window.tinymce.init({
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
          editor.setContent(this._value || '');
        });
        editor.on('change keyup undo redo', () => {
          if (this._applying) return;
          const html = editor.getContent();
          this._value = html;
          this.dispatchEvent(new CustomEvent('change', {
            detail: html,
            bubbles: true,
          }));
        });
      },
    }).catch((err) => this._renderError(err));
  }

  _maybeReinit() {
    // If a relevant configuration option changes after initialization (e.g., toolbar), reinitialize the editor.
    if (!this._editor) return;
    const isDarkMode = this._detectDarkMode();
    const current = JSON.stringify({ ...this._cfg(), isDarkMode });
    if (this._lastCfg === current) return;
    this._lastCfg = current;
    const html = this._editor.getContent();
    this._editor.remove();
    this._ready = false;
    this._renderShell(isDarkMode);
    loadTinyMCE().then(() => {
      this._initEditor(isDarkMode);
      this._value = html;
    });
  }
}

customElements.define(TAG, TinyMCEField);
