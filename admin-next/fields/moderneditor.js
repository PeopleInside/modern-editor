/**
 * Modern Editor — Custom Field per Admin Next (Grav 2.0)
 * (basato su TinyMCE, caricato da CDN)
 *
 * Implementa il contratto Web Component richiesto da Admin Next:
 *  - riceve `field` (definizione blueprint) e `value` (contenuto attuale) via setter
 *  - emette un evento `change` (bubbles: true) quando il contenuto cambia
 *
 * TinyMCE viene caricato da CDN al volo (nessun bundler/build step richiesto).
 * Il valore scambiato con Admin Next è sempre HTML (stringa).
 *
 * Questo campo viene applicato automaticamente al campo "content" di ogni
 * pagina dal plugin PHP (vedi modern-editor.php), senza bisogno di
 * modificare i blueprint del tema. Il tipo di campo si chiama
 * "moderneditor" (file: admin-next/fields/moderneditor.js).
 */

const TAG = window.__GRAV_FIELD_TAG;
const TINYMCE_CDN = 'https://cdn.jsdelivr.net/npm/tinymce@7/tinymce.min.js';

// Carica lo script TinyMCE una sola volta, anche se più istanze del campo sono presenti.
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
    script.onerror = () => reject(new Error('Impossibile caricare TinyMCE da CDN'));
    document.head.appendChild(script);
  });
  return window.__TINYMCE_LOADING__;
}

// Rileva se Admin Next è attualmente in dark mode. Admin Next gestisce il
// color mode (light/dark/auto) sul <html>, tipicamente con una classe
// "dark" o l'attributo data-theme="dark"/color-scheme. Per essere
// resilienti a possibili convenzioni diverse, controlliamo più segnali:
// classe "dark" sull'elemento <html>, attributo data-theme/data-color-mode,
// e in subordine la preferenza di sistema (prefers-color-scheme).
function isDarkMode() {
  const root = document.documentElement;
  if (root.classList.contains('dark')) return true;
  const dataTheme = root.getAttribute('data-theme') || root.getAttribute('data-color-mode') || root.getAttribute('data-mode');
  if (dataTheme && dataTheme.toLowerCase().includes('dark')) return true;
  if (dataTheme && dataTheme.toLowerCase().includes('light')) return false;
  // Fallback: legge il valore calcolato della custom property --background
  // di Admin Next, se sufficientemente scuro. Ultima spiaggia, solo se i
  // segnali sopra non hanno dato una risposta netta.
  try {
    const bg = getComputedStyle(root).getPropertyValue('--background').trim();
    const rgb = bg.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const [r, g, b] = rgb.map(Number);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance < 0.5;
    }
  } catch (e) {
    /* noop */
  }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

class TinyMCEField extends HTMLElement {
  _field = null;
  _value = '';
  _editor = null;
  _editorId = null;
  _applying = false; // evita loop: true mentre stiamo applicando un valore esterno
  _ready = false;
  _darkObserver = null;
  _isDark = false;

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

  connectedCallback() {
    this._editorId = 'tinymce-field-' + Math.random().toString(36).slice(2, 10);
    this._isDark = isDarkMode();
    this.attachShadow({ mode: 'open' });
    this._renderShell();
    this._watchColorScheme();
    loadTinyMCE()
      .then(() => this._initEditor())
      .catch((err) => this._renderError(err));
  }

  disconnectedCallback() {
    this._destroyEditor();
    if (this._darkObserver) {
      this._darkObserver.disconnect();
      this._darkObserver = null;
    }
  }

  /**
   * Osserva i cambi di tema (classe/attributo su <html>, o preferenza di
   * sistema se Admin Next è in modalità "auto") e ricrea l'editor con lo
   * skin corretto quando il tema cambia, senza che l'utente debba
   * ricaricare la pagina.
   */
  _watchColorScheme() {
    this._darkObserver = new MutationObserver(() => {
      const nowDark = isDarkMode();
      if (nowDark !== this._isDark) {
        this._isDark = nowDark;
        this._reinitForTheme();
      }
    });
    this._darkObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'data-color-mode', 'data-mode'],
    });

    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onChange = () => {
        const nowDark = isDarkMode();
        if (nowDark !== this._isDark) {
          this._isDark = nowDark;
          this._reinitForTheme();
        }
      };
      mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    }
  }

  _reinitForTheme() {
    if (!this._ready || !this._editor) return;
    const html = this._editor.getContent();
    this._destroyEditor();
    this._renderShell();
    this._initEditor(html);
  }

  _destroyEditor() {
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

  _renderShell() {
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        .wrap {
          border: 1px solid var(--border, #d1d5db);
          border-radius: 6px;
          overflow: hidden;
          background: var(--background, #ffffff);
        }
        .loading {
          padding: 24px; font-size: 13px; font-style: italic;
          color: var(--muted-foreground, #6b7280);
          background: var(--background, #ffffff);
        }
        .error {
          padding: 12px; font-size: 13px; color: #b91c1c; background: #fef2f2;
          border: 1px solid #fecaca; border-radius: 6px;
        }
      </style>
      <div class="wrap">
        <div class="loading">Caricamento editor visuale…</div>
        <textarea id="${this._editorId}" style="display:none;"></textarea>
      </div>
    `;
  }

  _renderError(err) {
    this.shadowRoot.innerHTML = `
      <style>.error { padding: 12px; font-size: 13px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; }</style>
      <div class="error">Errore nel caricamento dell'editor visuale: ${this._esc(err.message)}</div>
    `;
  }

  _esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
  }

  _cfg() {
    const f = this._field || {};
    return {
      height: parseInt(f.height, 10) || 500,
      menubar: !!f.menubar,
      plugins: f.plugins || 'lists link image table code fullscreen searchreplace media',
      toolbar: f.toolbar || 'undo redo | blocks | bold italic underline | bullist numlist | link image media table | code fullscreen',
    };
  }

  _initEditor(restoreValue) {
    const textarea = this.shadowRoot.getElementById(this._editorId);
    if (!textarea) return;

    textarea.style.display = '';
    this.shadowRoot.querySelector('.loading')?.remove();

    const cfg = this._cfg();
    const valueToRestore = restoreValue !== undefined ? restoreValue : this._value;

    window.tinymce.init({
      target: textarea,
      // TinyMCE monta dentro lo Shadow DOM: necessario indicarlo esplicitamente.
      inline: false,
      license_key: 'gpl',
      height: cfg.height,
      menubar: cfg.menubar,
      plugins: cfg.plugins,
      toolbar: cfg.toolbar,
      branding: false,
      // Skin e contenuto: applica le varianti scure di TinyMCE quando
      // Admin Next è in dark mode, così l'editor non resta "bianco" in
      // un'interfaccia altrimenti scura.
      skin: this._isDark ? 'oxide-dark' : 'oxide',
      content_css: this._isDark ? 'dark' : 'default',
      setup: (editor) => {
        editor.on('init', () => {
          this._editor = editor;
          this._ready = true;
          editor.setContent(valueToRestore || '');
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
    // Se cambia una opzione di configurazione rilevante (es. toolbar) dopo
    // l'inizializzazione, ricreiamo l'editor con la nuova configurazione.
    if (!this._editor) return;
    const current = JSON.stringify(this._cfg());
    if (this._lastCfg === current) return;
    this._lastCfg = current;
    const html = this._editor.getContent();
    this._destroyEditor();
    this._renderShell();
    loadTinyMCE().then(() => this._initEditor(html));
  }
}

customElements.define(TAG, TinyMCEField);
