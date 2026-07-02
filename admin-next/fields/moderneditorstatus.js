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

function getAdminPath() {
  // 1. Priority: Check if admin path was set by PHP
  if (window.__MODERN_EDITOR_ADMIN_PATH__) {
    const path = window.__MODERN_EDITOR_ADMIN_PATH__;
    return path.endsWith('/') ? path.slice(0, -1) : path;
  }
  
  // 2. Check Grav global config objects
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
  
  // 3. Fallback: Detect admin path from current URL pathname
  const pathname = window.location.pathname;
  const segments = pathname.split('/').filter(s => s.length > 0);
  
  // Look for standard admin section keywords as complete path segments.
  // Note: These keywords are duplicated in moderneditor.js because both files
  // are loaded independently as separate Web Components by Grav Admin.
  const adminKeywords = [
    'plugins', 'pages', 'dashboard', 'themes', 'configuration', 
    'config', 'tools', 'navigation', 'media', 'users'
  ];
  
  // Find the first admin keyword and reconstruct base path
  for (let i = 0; i < segments.length; i++) {
    if (adminKeywords.includes(segments[i])) {
      // Reconstruct the path using all segments preceding the admin keyword
      const basePath = '/' + segments.slice(0, i).join('/');
      return basePath === '/' ? '' : basePath;
    }
  }
  
  // 4. Last resort: Check for /admin pattern
  const adminIdx = pathname.indexOf('/admin');
  if (adminIdx !== -1) {
    const basePath = pathname.substring(0, adminIdx);
    return basePath === '' ? '/admin' : basePath + '/admin';
  }
  
  return '';
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
    if (!this._field || !this._field.content) {
      const isIt = document.documentElement.lang === 'it' || window.navigator.language.startsWith('it');
      this.innerHTML = `<div style="font-size: 13px; color: #6b7280; font-style: italic; padding: 12px 0;">${isIt ? 'Caricamento stato...' : 'Loading status...'}</div>`;
    }

    await this._fetchStatus();
    this._render();
  }

  async _fetchStatus() {
    if (this._isFetching) return;
    this._isFetching = true;

    const adminPath = getAdminPath();
    const cleanAdminPath = adminPath.endsWith('/') ? adminPath.slice(0, -1) : adminPath;
    const url = cleanAdminPath + '/plugins/modern-editor?action=get_status';

    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        if (this._field) {
          this._field.content = data.html || '';
        }
        this._lastFetchTime = Date.now();
      }
    } catch (err) {
      console.error('Failed to fetch Modern Editor status:', err);
    } finally {
      this._isFetching = false;
    }
  }

  _render() {
    if (!this._field || !this._field.content) {
      // Keep loading placeholder if still fetching, or show empty
      return;
    }
    this.innerHTML = this._field.content;
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

        const ajaxUrl = url + (url.indexOf('?') !== -1 ? '&ajax=1' : '?ajax=1');

        fetch(ajaxUrl)
          .then(response => {
            if (!response.ok) throw new Error('HTTP error ' + response.status);
            return response.json();
          })
          .then(data => {
            if (data.message) {
              alert(data.message);
            }
            if (data.html) {
              if (this._field) {
                this._field.content = data.html;
                this._render();
              } else {
                window.location.reload();
              }
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
