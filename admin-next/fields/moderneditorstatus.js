/**
 * Modern Editor Status — Custom Field for Admin Next (Grav 2.0)
 * Renders the beautiful local status card with fully integrated AJAX.
 */

/*
 * Modern Editor Plugin for Grav
 * Copyright (C) [2026] [PeopleInside]
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 */

const TAG = window.__GRAV_FIELD_TAG;

// Builds the URL for a plugin AJAX action by reusing the CURRENT page URL
// and just adding/overwriting the `action` query param. This works no
// matter what the admin route is called (default "admin" or a custom
// one), because the PHP handler only checks isAdmin() + the `action`
// param — it doesn't require any specific path. Reconstructing the admin
// base path from config/heuristics was fragile and broke silently
// whenever the admin route was customized, leaving the status card stuck
// on "Loading status..." forever.
// Requests a plugin action, preferring the real Grav 2.0 / Admin2 REST
// API (window.__GRAV_API_SERVER_URL + __GRAV_API_PREFIX, authenticated
// via X-API-Token — not Authorization: Bearer, which FastCGI/PHP-FPM can
// silently strip). Admin2 is a decoupled SPA served by its own thin
// wrapper that returns the same shell HTML for any /panel/* sub-route, so
// appending ?action=... to the current admin URL never reached our PHP
// under Admin2 — that only ever worked under classic Grav 1.x admin,
// which is kept here as a fallback.
function apiRequest(path, classicAction, options) {
  const method = (options && options.method) || 'GET';
  const body = options && options.body;

  // __GRAV_API_PREFIX is the real signal that Admin2's API is present.
  // __GRAV_API_SERVER_URL can legitimately be "" (meaning "same origin as
  // the current page"), which is falsy in JS — checking `&&` on it wrongly
  // treated a same-origin API as "not available" and silently fell back
  // to the broken classic ?action= mechanism (returns the SPA's HTML).
  if (window.__GRAV_API_PREFIX !== undefined && window.__GRAV_API_PREFIX !== null) {
    const url = (window.__GRAV_API_SERVER_URL || '') + window.__GRAV_API_PREFIX + path;
    const headers = window.__GRAV_API_TOKEN ? { 'X-API-Token': window.__GRAV_API_TOKEN } : {};
    const init = { method, headers };
    if (body) {
      init.headers = { ...headers, 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }
    return fetch(url, init).then(r => ({ res: r, url }));
  }
  const url = new URL(window.location.href);
  url.searchParams.set('action', classicAction);
  if (body && body.version) {
    url.searchParams.set('version', body.version);
  }
  return fetch(url.toString()).then(r => ({ res: r, url: url.toString() }));
}

class ModernEditorStatusField extends HTMLElement {
  constructor() {
    super();
    this._field = null;
    this._bootstrapped = false;
    this._lastFetchTime = 0;
    this._isFetching = false;
    this._saveListenersBound = false;
  }

  set field(val) {
    const oldSource = this._field?.editor_source;
    this._field = val || {};
    const force = oldSource !== undefined && oldSource !== this._field.editor_source;
    this._bootstrap(force);
  }

  get field() {
    return this._field;
  }

  set value(val) {
    // Read-only/display field, value is not set or ignored
  }

  get value() {
    return '';
  }

  connectedCallback() {
    this._bootstrap();
    this._bindSaveListeners();
  }

  _bindSaveListeners() {
    if (this._saveListenersBound) return;
    this._saveListenersBound = true;

    const handleSaveTrigger = () => {
      // Wait for the AJAX save operation to complete (usually < 1s), then update status
      setTimeout(() => {
        this._bootstrap(true);
      }, 1200);
    };

    // Watch clicks on elements that look like save buttons in standard or next admin
    const handleDocumentClick = (e) => {
      const target = e.target.closest('#and-save, .and-save-button, button[type="submit"], .button.save, [data-key="s"]');
      if (target) {
        handleSaveTrigger();
      }
    };
    document.addEventListener('click', handleDocumentClick, { passive: true });

    // Watch keyboard shortcuts (Ctrl+S or Cmd+S)
    const handleDocumentKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        handleSaveTrigger();
      }
    };
    document.addEventListener('keydown', handleDocumentKeyDown, { passive: true });
  }

  async _bootstrap(force = false) {
    if (this._isFetching) return;

    const timeSinceLastFetch = Date.now() - this._lastFetchTime;
    if (this._bootstrapped && !force && timeSinceLastFetch < 3000) {
      this._render();
      return;
    }
    this._bootstrapped = true;

    // Show initial loading placeholder if never fetched or if forced loading is visible
    if (!this._statusHtml) {
      const isIt = document.documentElement.lang === 'it' || window.navigator.language.startsWith('it');
      this.innerHTML = `<div style="font-size: 13px; color: #6b7280; font-style: italic; padding: 12px 0;">${isIt ? 'Caricamento stato...' : 'Loading status...'}</div>`;
    }

    await this._fetchStatus();
    this._render();
  }

  async _fetchStatus() {
    if (this._isFetching) return;
    this._isFetching = true;

    try {
      const { res, url } = await apiRequest('/modern-editor/status', 'get_status');
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const body = await res.json();
          // The Grav 2.0 API wraps payloads as {"data": {...}}; the
          // legacy classic-admin fallback returns the object directly.
          const data = body && typeof body === 'object' && 'data' in body ? body.data : body;
          // Stored independently of this._field: the Admin Next framework
          // does not reliably keep calling the `field` setter, so relying
          // on this._field.content left the status card stuck on
          // "Loading status..." forever even though the fetch succeeded.
          this._statusHtml = data.html || this._statusHtml || '';
          this._lastFetchTime = Date.now();
        } else {
          console.warn('Modern Editor: get_status returned a non-JSON response.', url);
        }
      } else {
        console.warn(`Modern Editor: get_status request failed (HTTP ${res.status}).`, url);
      }
    } catch (err) {
      console.warn('Modern Editor: get_status request errored.', err);
    } finally {
      this._isFetching = false;
    }
  }

  _render() {
    const html = this._statusHtml || this._field?.content;
    if (!html) {
      // Keep loading placeholder if still fetching, or show empty
      return;
    }
    this.innerHTML = html;
    this._bindEvents();
  }

  _bindEvents() {
    const card = this.querySelector('#modern-editor-status-card');
    if (!card) return;

    card.querySelectorAll('a.button-small').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const url = btn.getAttribute('href');
        if (!url) return;

        let apiPath = null;
        let classicAction = null;
        let apiVersion = null;
        try {
          const parsed = new URL(url, window.location.href);
          classicAction = parsed.searchParams.get('action');
          apiVersion = parsed.searchParams.get('version');
          if (classicAction === 'download_tinymce') apiPath = '/modern-editor/download';
          else if (classicAction === 'check_updates') apiPath = '/modern-editor/check-updates';
          else if (classicAction === 'remove_tinymce_local') apiPath = '/modern-editor/remove';
        } catch (e) { /* fall through to plain fetch below */ }

        const originalText = btn.innerHTML;
        const originalTextContent = btn.textContent;
        const loadingText = btn.getAttribute('data-loading-text') || 'Attendi...';

        btn.textContent = '';
        const spinner = document.createElement('span');
        spinner.style.display = 'inline-block';
        spinner.style.animation = 'modern_editor_spin 1s linear infinite';
        spinner.style.marginRight = '6px';
        spinner.textContent = '⌛';
        btn.appendChild(spinner);
        btn.appendChild(document.createTextNode(' ' + loadingText));
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.75';

        // apiRequest() picks the real Grav 2.0 API when available (POST,
        // with the version in the JSON body), or falls back to the
        // classic ?action=...&ajax=1 URL for Grav 1.x classic admin.
        const request = apiPath
          ? apiRequest(apiPath, classicAction, { method: 'POST', body: apiVersion ? { version: apiVersion } : undefined })
          : fetch(url + (url.indexOf('?') !== -1 ? '&ajax=1' : '?ajax=1')).then(r => ({ res: r, url }));

        request
          .then(({ res }) => {
            if (!res.ok) throw new Error('HTTP error ' + res.status);
            return res.json();
          })
          .then(body => {
            const data = body && typeof body === 'object' && 'data' in body ? body.data : body;
            if (data.message) {
              alert(data.message);
            }
            if (data.html) {
              this._statusHtml = data.html;
              this._render();
            } else {
              window.location.reload();
            }
          })
          .catch(err => {
            console.error('Modern Editor status action failed:', err);
            const isIt = document.documentElement.lang === 'it' || window.navigator.language.startsWith('it');
            alert((isIt ? "Errore durante l'esecuzione dell'operazione: " : "Error executing operation: ") + err.message);
            if (originalText) {
              btn.innerHTML = originalText;
            } else {
              btn.textContent = originalTextContent || '';
            }
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
          });
      });
    });

    // Listen for source changes on the admin form
    const sourceInputs = document.querySelectorAll('input[name*="editor_source"], select[name*="editor_source"]');
    sourceInputs.forEach(input => {
      if (input.getAttribute('data-source-bound') === 'true') return;
      input.setAttribute('data-source-bound', 'true');
      input.addEventListener('change', () => {
        let notice = card.querySelector('.modern-editor-save-notice');
        if (!notice) {
          notice = document.createElement('div');
          notice.className = 'notice alert modern-editor-save-notice';
          notice.style.borderLeft = '4px solid #3b82f6';
          notice.style.backgroundColor = '#eff6ff';
          notice.style.color = '#1e3a8a';
          notice.style.padding = '14px';
          notice.style.marginBottom = '16px';
          notice.style.borderRadius = '4px';
          notice.style.fontSize = '13.5px';
          notice.style.lineHeight = '1.5';
          notice.style.fontWeight = '500';
          card.insertBefore(notice, card.firstChild);
          
          const style = document.createElement('style');
          style.innerHTML = '@media (prefers-color-scheme: dark) { #modern-editor-status-card .modern-editor-save-notice { background-color: #1e3a8a !important; color: #eff6ff !important; } } html.dark #modern-editor-status-card .modern-editor-save-notice, html.dark-mode #modern-editor-status-card .modern-editor-save-notice, html.theme-dark #modern-editor-status-card .modern-editor-save-notice, body.dark #modern-editor-status-card .modern-editor-save-notice, body.dark-mode #modern-editor-status-card .modern-editor-save-notice, body.theme-dark #modern-editor-status-card .modern-editor-save-notice { background-color: #1e3a8a !important; color: #eff6ff !important; }';
          document.head.appendChild(style);
        }
        const isIt = document.documentElement.lang === 'it' || window.navigator.language.startsWith('it');
        notice.innerHTML = isIt 
          ? '🔄 <strong>Salvataggio in corso...</strong> La pagina si ricaricherà automaticamente per aggiornare lo stato e i banner.'
          : '🔄 <strong>Saving settings...</strong> The page will reload automatically to update status and banners.';
        
        setTimeout(() => {
          const saveBtn = document.querySelector('#and-save, .and-save-button, button[type="submit"], .button.save, [data-key="s"]');
          if (saveBtn) {
            saveBtn.click();
          } else {
            window.location.reload();
          }
        }, 800);
      });
    });
  }
}

customElements.define(TAG, ModernEditorStatusField);
