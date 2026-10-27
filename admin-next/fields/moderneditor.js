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

function normalizeLinkUrl(url) {
  if (!url || typeof url !== 'string') return url;
  let trimmed = url.trim();
  // Strip accidental or legacy https://# or http://# anchor prefixes
  if (/^https?:\/\/#/i.test(trimmed)) {
    trimmed = trimmed.replace(/^https?:\/\//i, '');
  }
  if (!trimmed || /^(https?:\/\/|\/|\.\/|\.\.\/|#|[a-z0-9+-.]+:\/\/|[a-z0-9+-]+:)/i.test(trimmed)) {
    return trimmed;
  }
  return 'https://' + trimmed;
}

function normalizeLinksInHtml(html) {
  if (!html || typeof html !== 'string' || !html.includes('<a ')) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const links = doc.querySelectorAll('a[href]');
    let changed = false;
    links.forEach(a => {
      const href = a.getAttribute('href');
      if (href) {
        const norm = normalizeLinkUrl(href);
        if (norm !== href) {
          a.setAttribute('href', norm);
          changed = true;
        }
      }
    });
    return changed ? doc.body.innerHTML : html;
  } catch (e) {
    return html;
  }
}

function parseTimeParam(val) {
  if (!val) return 0;
  val = String(val).trim().toLowerCase();
  if (/^\d+s?$/i.test(val)) {
    return parseInt(val, 10);
  }
  let seconds = 0;
  const h = val.match(/(\d+)h/i);
  const m = val.match(/(\d+)m/i);
  const s = val.match(/(\d+)s/i);
  if (h) seconds += parseInt(h[1], 10) * 3600;
  if (m) seconds += parseInt(m[1], 10) * 60;
  if (s) seconds += parseInt(s[1], 10);
  return seconds;
}

function parseYoutubeUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  let videoId = '';
  const shortMatch = u.match(/(?:https?:)?\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/i);
  if (shortMatch) {
    videoId = shortMatch[1];
  } else {
    const vMatch = u.match(/(?:https?:)?\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/.*[?&]v=([a-zA-Z0-9_-]{11})/i);
    if (vMatch) {
      videoId = vMatch[1];
    } else {
      const embedMatch = u.match(/(?:https?:)?\/\/(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:embed|v|shorts|live)\/([a-zA-Z0-9_-]{11})/i);
      if (embedMatch) {
        videoId = embedMatch[1];
      }
    }
  }
  if (!videoId) return null;

  let timeSeconds = 0;
  const tMatch = u.match(/[?&#](?:t|start)=([a-zA-Z0-9]+)/i);
  if (tMatch) {
    timeSeconds = parseTimeParam(tMatch[1]);
  }

  let embedUrl = 'https://www.youtube.com/embed/' + videoId;
  const params = [];
  if (timeSeconds > 0) {
    params.push('start=' + timeSeconds);
  }
  const listMatch = u.match(/[?&#]list=([a-zA-Z0-9_-]+)/i);
  if (listMatch) {
    params.push('list=' + listMatch[1]);
  }
  if (params.length > 0) {
    embedUrl += '?' + params.join('&');
  }

  return {
    videoId: videoId,
    startSeconds: timeSeconds,
    embedUrl: embedUrl
  };
}

function parseVimeoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  const m = u.match(/(?:https?:)?\/\/(?:www\.)?vimeo\.com\/(?:video\/)?([0-9]+)/i);
  if (!m) return null;
  const videoId = m[1];
  let embedUrl = 'https://player.vimeo.com/video/' + videoId;
  const tMatch = u.match(/[?&#]t=([a-zA-Z0-9]+)/i);
  if (tMatch) {
    embedUrl += '#t=' + tMatch[1];
  }
  return {
    videoId: videoId,
    embedUrl: embedUrl
  };
}

function normalizeYoutubeIframeHtml(html) {
  if (!html || typeof html !== 'string' || (!html.includes('youtube') && !html.includes('youtu.be'))) {
    return html;
  }
  return html.replace(/(<iframe\s+[^>]*?src=["'])([^"']+)(["'][^>]*?>)/gi, (match, prefix, src, suffix) => {
    if (!/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)/i.test(src)) {
      return match;
    }
    const tMatch = src.match(/[?&#](?:t|start)=([a-zA-Z0-9]+)/i);
    if (tMatch) {
      const seconds = parseTimeParam(tMatch[1]);
      if (seconds > 0) {
        let cleaned = src.replace(/([?&])(?:t|start)=[a-zA-Z0-9]+(&?)/i, '$1');
        cleaned = cleaned.replace(/[?&]$/, '');
        cleaned = cleaned.replace(/\?&|&&/, '&');
        const delim = cleaned.includes('?') ? '&' : '?';
        return prefix + cleaned + delim + 'start=' + seconds + suffix;
      }
    }
    return match;
  });
}

function separateMultipleIframesInHtml(html) {
  if (!html || typeof html !== 'string' || (!html.includes('<iframe') && !html.includes('<video'))) {
    return html;
  }
  // Se un paragrafo racchiude più di un iframe o video, separali preservando attributi (style di allineamento, class, ecc.)
  return html.replace(/<p(\s+[^>]*)?>([\s\S]*?)<\/p>/gi, (match, pAttrs, inner) => {
    const iframes = inner.match(/<(?:iframe|video)[\s\S]*?<\/(?:iframe|video)>/gi);
    if (iframes && iframes.length > 1) {
      const attrs = pAttrs || '';
      return iframes.map((f) => '<p' + attrs + '>' + f + '</p>').join('\n');
    }
    return match;
  });
}

function restoreMarkdownExtraAttrs(md) {
  if (!md || typeof md !== 'string') return md;
  let processed = md.replace(/(!?)\[([^\]]*)\]\(([^)]+)\)\{:?\s*([^}]+)\}/g, (match, isImg, text, urlAndTitle, attrsStr) => {
    let url = urlAndTitle.trim();
    let title = '';
    const titleMatch = url.match(/^(\S+)\s+(["'])(.*)\2$/);
    if (titleMatch) {
      url = titleMatch[1];
      title = titleMatch[3];
    }
    if (isImg !== '!') {
      url = normalizeLinkUrl(url);
    }
    const attrPairs = [];
    const attrRegex = /([a-zA-Z0-9_-]+)(?:=(["']?)(.*?)\2)?(?=\s|$)/g;
    let m;
    while ((m = attrRegex.exec(attrsStr)) !== null) {
      const name = m[1];
      const val = m[3] !== undefined ? m[3] : name;
      attrPairs.push(`${name}="${val}"`);
    }
    const attrHtml = attrPairs.length > 0 ? ' ' + attrPairs.join(' ') : '';
    if (isImg === '!') {
      return `<img src="${url}" alt="${text}"${title ? ` title="${title}"` : ''}${attrHtml} />`;
    } else {
      return `<a href="${url}"${title ? ` title="${title}"` : ''}${attrHtml}>${text}</a>`;
    }
  });

  // Also normalize standard markdown links [text](url) that don't have extra attributes
  processed = processed.replace(/(^|[^!])\[([^\]]*)\]\(([^)\s]+)(?:(\s+["'][^"']*["']))?\)/g, (match, prefix, text, url, title) => {
    const cleanUrl = normalizeLinkUrl(url);
    return `${prefix}[${text}](${cleanUrl}${title || ''})`;
  });

  return processed;
}

function mdToHtml(md) {
  if (!md) return '';
  if (!window.marked) return md;

  // Fix: clean up runaway backslash accumulation before markdown formatting markers (e.g. \\* -> *, \\_ -> _)
  let processed = md.replace(/\\+(\*|_)/g, '$1');

  // Inside HTML blocks (where marked does not parse markdown syntax), convert **bold** and *italic*
  // into native HTML <strong> and <em> tags so they render visually as real formatting in TinyMCE
  // instead of literal asterisks, preventing re-escaping loops on save.
  processed = processed.replace(/(<[a-z][a-z0-9]*(?:\s+[^>]*?)?>)([\s\S]*?)(<\/[a-z][a-z0-9]*>)/gi, (match, openTag, inner, closeTag) => {
    if (inner.includes('*') || inner.includes('_')) {
      inner = inner
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+?)\__/g, '<strong>$1</strong>')
        .replace(/(^|[^\*])\*([^*\n]+?)\*([^\*]|$)/g, '$1<em>$2</em>$3');
    }
    return openTag + inner + closeTag;
  });

  const processedMd = restoreMarkdownExtraAttrs(processed);
  let html = window.marked.parse ? window.marked.parse(processedMd) : window.marked(processedMd);

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
    let resHtml = doc.body.innerHTML;
    if (resHtml.includes('youtube') || resHtml.includes('youtu.be')) {
      resHtml = normalizeYoutubeIframeHtml(resHtml);
    }
    if (resHtml.includes('<iframe') || resHtml.includes('<video')) {
      resHtml = separateMultipleIframesInHtml(resHtml);
    }
    return resHtml;
  } catch (e) {
    console.error('Error post-processing markdown alerts', e);
    if (html.includes('youtube') || html.includes('youtu.be')) {
      html = normalizeYoutubeIframeHtml(html);
    }
    if (html.includes('<iframe') || html.includes('<video')) {
      html = separateMultipleIframesInHtml(html);
    }
    return html;
  }
}

function cleanAsterisksInHtml(html) {
  if (!html || typeof html !== 'string' || (!html.includes('**') && !html.includes('__'))) return html;
  let cleaned = html.replace(/(<[a-z][a-z0-9]*(?:\s+[^>]*?)?>)([\s\S]*?)(<\/[a-z][a-z0-9]*>)/gi, (match, openTag, inner, closeTag) => {
    if (inner.includes('**') || inner.includes('__')) {
      inner = inner
        .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_\n]+?)\__/g, '<strong>$1</strong>');
    }
    return openTag + inner + closeTag;
  });
  if (cleaned.includes('**') || cleaned.includes('__')) {
    cleaned = cleaned
      .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+?)\__/g, '<strong>$1</strong>');
  }
  return cleaned;
}

function isInsideHtmlContainer(node) {
  let curr = node ? node.parentNode : null;
  const htmlBlockNames = new Set([
    'DIV', 'SPAN', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'FONT',
    'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION',
    'DETAILS', 'SUMMARY', 'NAV', 'FORM', 'FIELDSET', 'BLOCKQUOTE', 'IFRAME', 'VIDEO', 'AUDIO'
  ]);
  while (curr && curr.nodeName !== 'BODY' && curr.nodeName !== '#document' && curr.nodeName !== 'HTML') {
    const name = curr.nodeName;
    if (htmlBlockNames.has(name)) {
      return true;
    }
    if (name === 'P' && (curr.getAttribute('style') || curr.getAttribute('class') || curr.getAttribute('id'))) {
      return true;
    }
    curr = curr.parentNode;
  }
  return false;
}

function htmlToMd(html) {
  if (!html) return '';
  if (html.includes('youtube') || html.includes('youtu.be')) {
    html = normalizeYoutubeIframeHtml(html);
  }
  if (html.includes('<iframe') || html.includes('<video')) {
    html = separateMultipleIframesInHtml(html);
  }
  html = normalizeLinksInHtml(html);
  if (!window.TurndownService) return html;

  const turndownService = new window.TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '*',
    codeBlockStyle: 'fenced',
    emDelimiter: '_',
    br: '<br />',
    blankReplacement: function (content, node) {
      if (node.nodeName === 'P') {
        let htmlAttr = '';
        if (node.attributes && node.attributes.length > 0) {
          for (const attr of node.attributes) {
            htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
          }
        }
        return '\n\n<p' + htmlAttr + '>&nbsp;</p>\n\n';
      }
      return node.isBlock ? '\n\n' : '';
    }
  });

  // Fix for issue #12 & runaway backslashes:
  // Clean runaway backslashes before markdown markers to prevent exponential \\\\* accumulation,
  // and preserve "[" / "]" for Twig expressions.
  turndownService.escape = function (string) {
    string = string.replace(/\\+(\*|_|`|~|\[|\])/g, '$1');
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

  turndownService.addRule('gravEmbeds', {
    filter: ['iframe', 'video', 'audio'],
    replacement: function (content, node) {
      return '\n\n' + node.outerHTML + '\n\n';
    }
  });

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

  turndownService.addRule('gravSpans', {
    filter: function (node) {
      return node.nodeName === 'SPAN' && (
        node.getAttribute('style') ||
        node.getAttribute('class') ||
        node.getAttribute('id') ||
        node.getAttribute('title') ||
        node.getAttribute('dir')
      );
    },
    replacement: function (content, node) {
      if (!content && !node.textContent) return '';
      let htmlAttr = '';
      if (node.attributes) {
        for (const attr of node.attributes) {
          htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
        }
      }
      return '<span' + htmlAttr + '>' + content + '</span>';
    }
  });

  turndownService.addRule('gravFonts', {
    filter: function (node) {
      return node.nodeName === 'FONT' && (
        node.getAttribute('color') ||
        node.getAttribute('size') ||
        node.getAttribute('face') ||
        node.getAttribute('style') ||
        node.getAttribute('class')
      );
    },
    replacement: function (content, node) {
      if (!content && !node.textContent) return '';
      let htmlAttr = '';
      if (node.attributes) {
        for (const attr of node.attributes) {
          htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
        }
      }
      return '<font' + htmlAttr + '>' + content + '</font>';
    }
  });

  turndownService.addRule('gravHeadings', {
    filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
    replacement: function (content, node) {
      const hLevel = Number(node.nodeName.charAt(1));
      const hasExtraAttrs = node.getAttribute('style') || node.getAttribute('class') || node.getAttribute('id');
      if (!hasExtraAttrs) {
        return '\n\n' + '#'.repeat(hLevel) + ' ' + content + '\n\n';
      }
      let htmlAttr = '';
      if (node.attributes) {
        for (const attr of node.attributes) {
          htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
        }
      }
      return '\n\n<h' + hLevel + htmlAttr + '>' + content + '</h' + hLevel + '>\n\n';
    }
  });

  turndownService.addRule('gravLineBreak', {
    filter: 'br',
    replacement: function (content, node) {
      if (node.getAttribute && (node.getAttribute('data-mce-bogus') === '1' || node.getAttribute('data-mce-bogus') === 'all')) {
        return '';
      }
      return '<br />\n';
    }
  });

  turndownService.addRule('gravParagraphs', {
    filter: function (node) {
      return node.nodeName === 'P' && (
        node.getAttribute('style') ||
        node.getAttribute('class') ||
        node.getAttribute('id')
      );
    },
    replacement: function (content, node) {
      let htmlAttr = '';
      if (node.attributes) {
        for (const attr of node.attributes) {
          htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
        }
      }
      const trimmed = content.trim();
      const inner = trimmed ? content : '&nbsp;';
      return '\n\n<p' + htmlAttr + '>' + inner + '</p>\n\n';
    }
  });

  turndownService.addRule('gravDivs', {
    filter: function (node) {
      return node.nodeName === 'DIV' && (
        node.getAttribute('style') ||
        node.getAttribute('class') ||
        node.getAttribute('id')
      );
    },
    replacement: function (content, node) {
      if (!content.trim()) return '';
      let htmlAttr = '';
      if (node.attributes) {
        for (const attr of node.attributes) {
          htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
        }
      }
      return '\n\n<div' + htmlAttr + '>\n' + content + '\n</div>\n\n';
    }
  });

  turndownService.addRule('gravInlineFormat', {
    filter: ['u', 'mark', 'sub', 'sup', 'small', 'ins', 'abbr', 'kbd', 'cite'],
    replacement: function (content, node) {
      const tag = node.nodeName.toLowerCase();
      let htmlAttr = '';
      if (node.attributes) {
        for (const attr of node.attributes) {
          htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
        }
      }
      return '<' + tag + htmlAttr + '>' + content + '</' + tag + '>';
    }
  });

  turndownService.addRule('gravStrong', {
    filter: ['strong', 'b'],
    replacement: function (content, node) {
      if (!content.trim()) return '';
      if (isInsideHtmlContainer(node)) {
        let htmlAttr = '';
        if (node.attributes) {
          for (const attr of node.attributes) {
            htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
          }
        }
        return '<strong' + htmlAttr + '>' + content + '</strong>';
      }
      return '**' + content + '**';
    }
  });

  turndownService.addRule('gravEmphasis', {
    filter: ['em', 'i'],
    replacement: function (content, node) {
      if (!content.trim()) return '';
      if (isInsideHtmlContainer(node)) {
        let htmlAttr = '';
        if (node.attributes) {
          for (const attr of node.attributes) {
            htmlAttr += ' ' + attr.name + '="' + attr.value + '"';
          }
        }
        return '<em' + htmlAttr + '>' + content + '</em>';
      }
      return '_' + content + '_';
    }
  });

  turndownService.addRule('gravLinks', {
    filter: function (node) {
      return node.nodeName === 'A' && node.getAttribute('href');
    },
    replacement: function (content, node) {
      const rawHref = node.getAttribute('href') || '';
      const href = normalizeLinkUrl(rawHref);
      const title = node.getAttribute('title');
      const target = node.getAttribute('target');
      const rel = node.getAttribute('rel');
      const className = node.getAttribute('class');
      const id = node.getAttribute('id');
      const download = node.getAttribute('download');
      const style = node.getAttribute('style');

      const hasExtraAttrs = target || rel || className || id || download || style;
      if (!hasExtraAttrs) {
        return '[' + content + '](' + href + (title ? ' "' + title + '"' : '') + ')';
      }

      let htmlAttr = ' href="' + href + '"';
      if (title) htmlAttr += ' title="' + title + '"';
      if (target) htmlAttr += ' target="' + target + '"';
      if (rel) htmlAttr += ' rel="' + rel + '"';
      if (className) htmlAttr += ' class="' + className + '"';
      if (id) htmlAttr += ' id="' + id + '"';
      if (download) htmlAttr += ' download="' + download + '"';
      if (style) htmlAttr += ' style="' + style + '"';

      return '<a' + htmlAttr + '>' + content + '</a>';
    }
  });

  turndownService.addRule('gravAnchors', {
    filter: function (node) {
      return node.nodeName === 'A' && !node.getAttribute('href') && (node.getAttribute('id') || node.getAttribute('name'));
    },
    replacement: function (content, node) {
      const id = node.getAttribute('id') || node.getAttribute('name');
      return '<a id="' + id + '">' + content + '</a>';
    }
  });

  turndownService.addRule('gravImages', {
    filter: function (node) {
      return node.nodeName === 'IMG' && node.getAttribute('src');
    },
    replacement: function (content, node) {
      const src = node.getAttribute('src') || '';
      const alt = node.getAttribute('alt') || '';
      const title = node.getAttribute('title');
      const width = node.getAttribute('width');
      const height = node.getAttribute('height');
      const className = node.getAttribute('class');
      const id = node.getAttribute('id');
      const style = node.getAttribute('style');

      const hasExtraAttrs = width || height || className || id || style;
      if (!hasExtraAttrs) {
        return '![' + alt + '](' + src + (title ? ' "' + title + '"' : '') + ')';
      }

      let htmlAttr = ' src="' + src + '"';
      if (alt) htmlAttr += ' alt="' + alt + '"';
      if (title) htmlAttr += ' title="' + title + '"';
      if (width) htmlAttr += ' width="' + width + '"';
      if (height) htmlAttr += ' height="' + height + '"';
      if (className) htmlAttr += ' class="' + className + '"';
      if (id) htmlAttr += ' id="' + id + '"';
      if (style) htmlAttr += ' style="' + style + '"';

      return '<img' + htmlAttr + ' />';
    }
  });

  let md = turndownService.turndown(html);
  md = md.replace(/\n{3,}/g, '\n\n');
  return md;
}

// Fix: pasting content copied from third-party sites/editors (typically
// WordPress "View Source" exports, but also Word/Google Docs) dumped a lot
// of foreign markup straight into the editor: presentational `class`
// attributes tied to CSS that doesn't exist on this site (e.g. WordPress'
// own `alignnone`/`size-full`/`wp-image-123` classes on `<img>`), noisy
// inline `style` attributes, and — worst of all — deeply nested `<div>`
// wrappers (including `<div>&nbsp;</div>` used by WordPress purely as
// visual spacing) around what is otherwise just a sequence of paragraphs.
// None of this is meaningful once pasted here: the foreign classes point at
// CSS that isn't loaded on this site so they do nothing (or clash with this
// theme's own styles), and Turndown (html -> Markdown, see htmlToMd()) has
// no dedicated rule for arbitrary nested <div> soup, so it was passing
// those divs through close to verbatim and producing broken/ugly Markdown
// full of stray blank "&nbsp;" lines and mismatched block structure instead
// of clean paragraphs. This runs on every paste (see the 'PastePreProcess'
// listener in _initEditor) and: drops spacer-only elements, strips
// presentational class/id/data-* attributes, keeps only the inline styles
// that actually carry meaning here (text-align, since it's used for e.g.
// centered captions/images), and unwraps <div> wrappers into their content
// so what lands in the editor is the same flat paragraph/image structure a
// user would get by typing/inserting it directly.
function sanitizePastedHtml(html) {
  if (!html) return html;

  let doc;
  try {
    doc = new DOMParser().parseFromString(`<div id="__me_root__">${html}</div>`, 'text/html');
  } catch (e) {
    return html;
  }
  const root = doc.getElementById('__me_root__');
  if (!root) return html;

  const isBlank = (node) => {
    // Treat &nbsp; (\u00A0) the same as regular whitespace when deciding
    // whether an element only exists as spacing.
    const text = (node.textContent || '').replace(/\u00A0/g, ' ').trim();
    return text.length === 0 && !node.querySelector('img, table, hr, iframe, video, audio');
  };

  // 1. Drop elements that only serve as WordPress-style visual spacers,
  //    e.g. <div>&nbsp;</div>. Keep <p> elements that have explicit styling
  //    or are intentional spacing.
  root.querySelectorAll('div, p').forEach((el) => {
    if (el.nodeName === 'DIV' && isBlank(el)) {
      el.remove();
    } else if (el.nodeName === 'P' && !el.getAttribute('style') && !el.getAttribute('class') && !el.getAttribute('id') && !el.innerHTML.includes('&nbsp;') && isBlank(el)) {
      el.remove();
    }
  });

  // 2. Strip presentational/foreign attributes from every remaining
  //    element, keeping only an allow-list of attributes that are actually
  //    useful here (including link/image/anchor targets, IDs, classes, plus a filtered `style`).
  const ATTR_ALLOWLIST = new Set([
    'href', 'src', 'alt', 'title', 'width', 'height', 'target', 'rel', 'id', 'name', 'class',
    'allowfullscreen', 'allow', 'frameborder', 'referrerpolicy', 'loading', 'sandbox',
    'controls', 'autoplay', 'loop', 'muted', 'poster', 'preload', 'playsinline'
  ]);
  root.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name === 'style') return; // handled separately below
      if (!ATTR_ALLOWLIST.has(name)) {
        el.removeAttribute(attr.name);
      }
    });

    // Keep meaningful layout styling in inline style: text-align,
    // image/element float, margins (for spacing around floated images),
    // display, and clear. Drops foreign fonts, colors, and junk.
    const style = el.getAttribute('style');
    if (style) {
      const parts = [];
      const alignMatch = style.match(/text-align\s*:\s*(left|right|center|justify)/i);
      if (alignMatch) parts.push(`text-align: ${alignMatch[1].toLowerCase()}`);
      const floatMatch = style.match(/float\s*:\s*(left|right|none)/i);
      if (floatMatch) parts.push(`float: ${floatMatch[1].toLowerCase()}`);
      const marginMatch = style.match(/margin(?:-[a-z]+)?\s*:\s*[^;]+/i);
      if (marginMatch) parts.push(marginMatch[0].trim());
      const displayMatch = style.match(/display\s*:\s*(block|inline|inline-block)/i);
      if (displayMatch) parts.push(`display: ${displayMatch[1].toLowerCase()}`);
      const clearMatch = style.match(/clear\s*:\s*(both|left|right|none)/i);
      if (clearMatch) parts.push(`clear: ${clearMatch[1].toLowerCase()}`);

      if (parts.length > 0) {
        el.setAttribute('style', parts.join('; ') + ';');
      } else {
        el.removeAttribute('style');
      }
    }
  });

  // 3. Unwrap <div> wrappers (deepest first) so nested "div soup" collapses
  //    into the flat paragraph/image structure Turndown converts cleanly.
  const divs = Array.from(root.querySelectorAll('div')).reverse();
  divs.forEach((div) => {
    const parent = div.parentNode;
    if (!parent) return;
    while (div.firstChild) parent.insertBefore(div.firstChild, div);
    parent.removeChild(div);
  });

  let sanitized = root.innerHTML;
  if (sanitized.includes('youtube') || sanitized.includes('youtu.be')) {
    sanitized = normalizeYoutubeIframeHtml(sanitized);
  }
  if (sanitized.includes('<iframe') || sanitized.includes('<video')) {
    sanitized = separateMultipleIframesInHtml(sanitized);
  }
  return sanitized;
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
  'Anchor': 'Ancora', 'Anchors': 'Ancore',
  'Insert/edit anchor': 'Inserisci/modifica ancora',
  'Id': 'Identificatore', 'ID': 'ID',
  'Id should start with a letter, followed only by letters, numbers, dashes, dots, colons or underscores.': "L'ID deve iniziare con una lettera, seguita solo da lettere, numeri, trattini, punti o trattini bassi.",
  'Insert/edit image': 'Inserisci/modifica immagine', 'Insert/edit media': 'Inserisci/modifica media',
  'Left (text wrap)': 'A sinistra (testo a lato)',
  'Right (text wrap)': 'A destra (testo a lato)',
  'Center (block)': 'Centrato (blocco)',
  'Allinea a sinistra (testo a lato)': 'Allinea a sinistra (testo a lato)',
  'Allinea a destra (testo a lato)': 'Allinea a destra (testo a lato)',
  'Centrato (blocco)': 'Centrato (blocco)',
  'Class': 'Classe', 'None': 'Nessuno',
  'Insert table': 'Inserisci tabella', 'Table': 'Tabella',
  'Source code': 'Codice sorgente', 'Fullscreen': 'Schermo intero',
  'Find and replace...': 'Trova e sostituisci...', 'Find': 'Trova', 'Replace': 'Sostituisci', 'Replace all': 'Sostituisci tutto',
  'Undo': 'Annulla', 'Redo': 'Ripeti',
  'Paragraph': 'Paragrafo', 'Heading 1': 'Titolo 1', 'Heading 2': 'Titolo 2', 'Heading 3': 'Titolo 3',
  'Heading 4': 'Titolo 4', 'Heading 5': 'Titolo 5', 'Heading 6': 'Titolo 6', 'Blocks': 'Blocchi',
  'Save': 'Salva', 'Cancel': 'Annulla', 'Close': 'Chiudi', 'Ok': 'Ok',
  'Insert': 'Inserisci', 'Edit': 'Modifica', 'View': 'Visualizza', 'Format': 'Formato', 'Tools': 'Strumenti',
};

// Normalizes a BCP-47 language tag ("it-IT", "en_US", "IT", ...) down to
// its primary subtag ("it", "en"), lowercased. Every raw language signal
// in this file (browser globals, dCfg, documentElement.lang) MUST go
// through this before being compared to 'it'/'en': comparing a full tag
// like "it-IT" with strict equality against 'it' silently fails even
// though the language IS Italian, which is exactly what kept this field
// in English on Grav installs whose admin locale is exposed as a
// region-qualified tag rather than a bare "it".
function normalizeLangTag(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const primary = value.split(/[-_]/)[0].toLowerCase();
  return (primary === 'it' || primary === 'en') ? primary : null;
}

function detectItalianLocale(dCfg) {
  // Priority order (each candidate normalized via normalizeLangTag()):
  //  1. window.__GRAV_I18N.locale — Admin Next's OWN i18n store, the same
  //     source Grav uses to translate the rest of the SPA. Exposed as a
  //     full BCP-47 tag (e.g. "it-IT"), not a bare "it".
  //  2. window.__MODERN_EDITOR_ADMIN_LANG__ / dCfg.lang — computed by
  //     getUiLanguage() in modern-editor.php (honors the plugin's own
  //     explicit "ui_language" setting first). Kept as a fallback for
  //     admin builds where __GRAV_I18N isn't present.
  //  3. document.documentElement.lang — last-resort guess.
  const i18nLocale = window.__GRAV_I18N && normalizeLangTag(window.__GRAV_I18N.locale);
  if (i18nLocale) {
    return i18nLocale === 'it';
  }
  const adminLang = normalizeLangTag(window.__MODERN_EDITOR_ADMIN_LANG__);
  if (adminLang) {
    return adminLang === 'it';
  }
  const cfgLang = dCfg && normalizeLangTag(dCfg.lang);
  if (cfgLang) {
    return cfgLang === 'it';
  }
  try {
    return normalizeLangTag(document.documentElement.lang) === 'it';
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
  // Same priority/normalization as detectItalianLocale(): __GRAV_I18N.locale
  // first (Admin Next's own i18n store, exposed as a full BCP-47 tag like
  // "it-IT" — must be normalized, not compared with strict equality),
  // then the server-computed global, then document.documentElement.lang
  // as a last resort. Never navigator.language.
  let lang = window.__GRAV_I18N && normalizeLangTag(window.__GRAV_I18N.locale);
  if (!lang) {
    lang = normalizeLangTag(window.__MODERN_EDITOR_ADMIN_LANG__);
  }
  if (!lang) {
    try {
      lang = normalizeLangTag(document.documentElement.lang);
    } catch (e) { /* noop */ }
  }

  const cacheBuster = Date.now();

  // __GRAV_API_PREFIX is the real signal that Admin2's API is present.
  // __GRAV_API_SERVER_URL can legitimately be "" (meaning "same origin as
  // the current page"), which is falsy in JS — checking `&&` on it wrongly
  // treated a same-origin API as "not available" and silently fell back
  // to the broken classic ?action= mechanism (returns the SPA's HTML).
  if (window.__GRAV_API_PREFIX !== undefined && window.__GRAV_API_PREFIX !== null) {
    const urlObj = new URL((window.__GRAV_API_SERVER_URL || '') + window.__GRAV_API_PREFIX + path, window.location.href);
    if (lang) urlObj.searchParams.set('lang', lang);
    urlObj.searchParams.set('_t', cacheBuster);
    const url = urlObj.toString();
    const headers = window.__GRAV_API_TOKEN ? { 'X-API-Token': window.__GRAV_API_TOKEN } : {};
    return fetch(url, { headers, cache: 'no-store' }).then(r => ({ res: r, url }));
  }
  const url = new URL(window.location.href);
  url.searchParams.set('action', classicAction);
  if (lang) url.searchParams.set('lang', lang);
  url.searchParams.set('_t', cacheBuster);
  return fetch(url.toString(), { cache: 'no-store' }).then(r => ({ res: r, url: url.toString() }));
}

let configPromise = null;

async function fetchConfig() {
  if (configPromise) {
    return configPromise;
  }

  configPromise = (async () => {
    try {
      const { res, url } = await apiRequest('/modern-editor/config', 'get_config');
      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const body = await res.json();
          // The Grav 2.0 API wraps payloads as {"data": {...}}; the legacy
          // classic-admin fallback returns the object directly.
          const dCfg = body && typeof body === 'object' && 'data' in body ? body.data : body;
          return dCfg;
        }
        console.warn('Modern Editor: get_config returned a non-JSON response.', url);
      } else {
        console.warn(`Modern Editor: get_config request failed (HTTP ${res.status}).`, url);
      }
    } catch (err) {
      console.warn('Modern Editor: get_config request errored.', err);
    } finally {
      // Clear the promise after a short delay (e.g. 1000ms) so that subsequent
      // page navigations/mounts fetch fresh config, but simultaneous mounts
      // on the same page still share the same in-flight or immediate request.
      setTimeout(() => {
        configPromise = null;
      }, 1000);
    }
    return null;
  })();

  return configPromise;
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
  _initialCleanValue = '';
  _baselineValue = '';
  _lastEmittedValue = null;
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

  _isMarkdownEnabled() {
    // 1. Explicitly disabled in field blueprint / definition or host attribute
    const f = this._field || {};
    if (f.markdown_enabled === false || f.markdown_enabled === 'false' || f.markdown === false || f.markdown === 'false') {
      return false;
    }
    const hostAttr = this.getAttribute('markdown_enabled') || this.getAttribute('markdown');
    if (hostAttr === 'false' || hostAttr === '0') {
      return false;
    }

    // 2. Disabled globally in server config (via REST /config endpoint)
    if (this._dCfg && (this._dCfg.markdown_enabled === false || this._dCfg.markdown_enabled === 'false')) {
      return false;
    }

    // 3. Detect page-level markdown toggle in Grav Admin form DOM
    // When editing a page in Grav Admin (Admin Next / Classic Admin),
    // the "Advanced" (Avanzate) tab contains a toggle for "header.process.markdown".
    // When Markdown is disabled on a page, this field is set to 0 / false.
    try {
      // Check radio inputs (e.g. data[header][process][markdown] or header.process.markdown)
      const checkedRadio = document.querySelector(
        'input[type="radio"][name="data[header][process][markdown]"]:checked, ' +
        'input[type="radio"][name="header.process.markdown"]:checked, ' +
        'input[type="radio"][name*="process.markdown"]:checked, ' +
        'input[type="radio"][name*="[process][markdown]"]:checked'
      );
      if (checkedRadio) {
        const rVal = String(checkedRadio.value).toLowerCase();
        if (rVal === '0' || rVal === 'false' || rVal === 'off' || rVal === 'disabled' || rVal === 'no') {
          return false;
        }
      }

      // Check toggles, checkboxes, grav-field-toggles
      const toggleFields = document.querySelectorAll(
        'input[name="data[header][process][markdown]"], ' +
        'input[name="header.process.markdown"], ' +
        'input[name*="[process][markdown]"], ' +
        'input[name*="process.markdown"], ' +
        'grav-field-toggle[name*="process.markdown"], ' +
        'grav-field-toggle[name*="[process][markdown]"], ' +
        '[data-grav-field*="process.markdown"], ' +
        '[data-field-name*="process.markdown"]'
      );
      for (const el of toggleFields) {
        if (el.tagName === 'INPUT' && el.type === 'checkbox') {
          if (!el.checked) return false;
        } else if (el.tagName && el.tagName.includes('TOGGLE')) {
          const val = el.value !== undefined ? el.value : el.getAttribute('value');
          if (val === 0 || val === false || val === '0' || val === 'false') {
            return false;
          }
        } else if (el.tagName === 'INPUT' && el.type === 'hidden') {
          if (el.value === '0' || el.value === 'false') {
            return false;
          }
        }
      }

      // Check active toggle labels/buttons in Grav Admin UI
      const activeLabels = document.querySelectorAll(
        '.form-field[data-grav-field*="process.markdown"] label.active, ' +
        '.form-field[data-grav-field*="process.markdown"] .radio-active, ' +
        '.form-field[data-grav-field*="process.markdown"] [data-active="true"]'
      );
      for (const lbl of activeLabels) {
        const forAttr = lbl.getAttribute('for');
        if (forAttr) {
          const inp = document.getElementById(forAttr);
          if (inp && (inp.value === '0' || inp.value === 'false')) return false;
        }
        const text = (lbl.textContent || '').trim().toLowerCase();
        if (text === 'disabled' || text === 'disabilitato' || text === 'disattivo' || text === 'off' || text === '0' || text === 'no') {
          return false;
        }
      }

      // Check page template input: if template is explicitly 'html' or ends with '.html'
      const templateInput = document.querySelector(
        'select[name*="template"], input[name*="template"], [data-grav-field*="template"]'
      );
      if (templateInput) {
        const tVal = (templateInput.value || '').toLowerCase();
        if (tVal === 'html' || tVal.endsWith('.html')) {
          return false;
        }
      }
    } catch (e) {
      /* noop */
    }

    // 4. Check page filename / URL for .html extension
    try {
      const loc = window.location.href.toLowerCase();
      if (loc.includes('.html') || loc.includes('/template:html')) {
        return false;
      }
    } catch (e) {
      /* noop */
    }

    // 5. Check frontmatter in content or form fields: process.markdown: false or markdown: false
    const checkFm = (str) => {
      if (!str || typeof str !== 'string') return false;
      const m = str.match(/^---\s*[\r\n]+([\s\S]*?)[\r\n]+---/);
      const yaml = m ? m[1] : (str.startsWith('---') ? str : '');
      if (yaml) {
        if (/(?:^|\n)\s*markdown\s*:\s*(?:false|0|no|off)\b/i.test(yaml)) return true;
        if (/(?:^|\n)\s*process\s*:\s*(?:[^\n]*\n)*?\s+markdown\s*:\s*(?:false|0|no|off)\b/i.test(yaml)) return true;
      }
      return false;
    };

    if (checkFm(this._value) || checkFm(this._initialCleanValue)) {
      return false;
    }

    try {
      const rawInputs = document.querySelectorAll('textarea[name*="frontmatter"], textarea[name*="header"], textarea[name*="raw"]');
      for (const ta of rawInputs) {
        if (checkFm(ta.value)) {
          return false;
        }
      }
    } catch (e) {
      /* noop */
    }

    // 6. Full HTML document detection (starts with <!DOCTYPE html> or <html>)
    const valTrim = (this._value || this._initialCleanValue || '').trim().toLowerCase();
    if (valTrim.startsWith('<!doctype html') || valTrim.startsWith('<html') || (valTrim.includes('<html') && valTrim.includes('</html>') && valTrim.includes('<body'))) {
      return false;
    }

    return true;
  }

  _bindMarkdownToggleListener() {
    if (this._mdToggleBound) return;
    this._mdToggleBound = true;

    const handleToggleChange = (e) => {
      const target = e.target;
      if (!target) return;
      const name = (target.name || target.getAttribute?.('name') || target.getAttribute?.('data-grav-field') || '').toLowerCase();
      if (name.includes('markdown') && name.includes('process')) {
        const wasMd = this._lastKnownMdEnabled;
        const nowMd = this._isMarkdownEnabled();
        if (wasMd !== undefined && wasMd !== nowMd) {
          this._lastKnownMdEnabled = nowMd;
          if (this._editor && this._ready) {
            const html = this._editor.getContent();
            this._baselineValue = nowMd ? htmlToMd(html) : html;
            this._value = this._baselineValue;
            this._lastEmittedValue = this._baselineValue;
          }
        }
      }
    };

    document.addEventListener('change', handleToggleChange, true);
    this._unbindToggle = () => document.removeEventListener('change', handleToggleChange, true);
  }

  set value(v) {
    const newVal = v ?? '';

    // 1. Reactive loop guard: if incoming value matches current value or the value
    // this editor instance just emitted to Admin2, ignore it. This breaks
    // the reactive feedback cycle from Admin2 form listeners.
    if (newVal === this._value || newVal === this._lastEmittedValue) {
      return;
    }

    // 2. Fix for Issue #26: If the editor is currently focused and the user
    // is actively typing, NEVER overwrite TinyMCE content with setContent().
    // Calling setContent() clears the DOM selection, jumps the caret to (0,0),
    // and clears the undo stack.
    if (this._editor && this._ready && this._editor.hasFocus && this._editor.hasFocus()) {
      this._value = newVal;
      return;
    }

    this._value = newVal;

    if (!this._ready) {
      this._initialCleanValue = newVal;
      return;
    }

    if (this._editor && this._ready) {
      const isMdEnabled = this._isMarkdownEnabled();
      let htmlVal = isMdEnabled ? mdToHtml(newVal) : newVal;
      if (!isMdEnabled) {
        htmlVal = cleanAsterisksInHtml(htmlVal);
      }
      const current = this._editor.getContent();
      if (current !== htmlVal && current.trim() !== htmlVal.trim()) {
        this._applying = true;
        this._editor.setContent(htmlVal);
        this._editor.undoManager?.clear();
        this._editor.setDirty(false);
        this._applying = false;
        const renderedHtml = this._editor.getContent();
        this._baselineValue = isMdEnabled ? htmlToMd(renderedHtml) : renderedHtml;
        this._initialCleanValue = this._baselineValue;
        this._value = this._baselineValue;
        this._lastEmittedValue = this._baselineValue;
        if (this._lightTextarea) {
          this._lightTextarea.value = this._baselineValue;
        }
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
    this._ensureLightTextarea();
    this._bindMarkdownToggleListener();
    if (this._field) {
      this._bootstrap();
    }
  }

  _ensureLightTextarea() {
    if (this._lightTextarea && this.contains(this._lightTextarea)) return;
    const name = this.getAttribute('name') || this._field?.name || 'data[content]';
    let ta = this.querySelector('textarea.modern-editor-light-sink');
    if (!ta) {
      ta = document.createElement('textarea');
      ta.className = 'modern-editor-light-sink';
      ta.style.display = 'none';
      ta.setAttribute('tabindex', '-1');
      ta.setAttribute('aria-hidden', 'true');
      this.appendChild(ta);
    }
    ta.name = name;
    ta.value = this._value || '';
    this._lightTextarea = ta;
  }

  _enableSaveButton() {
    try {
      const saveSelectors = [
        '#titlebar-save',
        '#and-save',
        '.and-save-button',
        '[data-action="save"]',
        'button[name="task"][value="save"]',
        'button[type="submit"]',
        '.button.save',
        '.page-save',
        '[data-key="s"]'
      ];
      const buttons = document.querySelectorAll(saveSelectors.join(', '));
      buttons.forEach((btn) => {
        btn.removeAttribute('disabled');
        btn.disabled = false;
        btn.classList.remove('disabled');
        btn.classList.remove('button-disabled');
      });

      const form = this.closest('form') || document.querySelector('form#blueprints, form#page-edit, form.admin-form');
      if (form) {
        form.setAttribute('data-dirty', 'true');
        form.classList.add('dirty', 'form-dirty');
      }
    } catch (e) {
      /* noop */
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
        // If the field already had markdown_enabled explicitly set to false in blueprint or page,
        // do not let dCfg.markdown_enabled overwrite it to true!
        const fieldMdExplicitFalse = this._field?.markdown_enabled === false ||
                                     this._field?.markdown_enabled === 'false' ||
                                     this._field?.markdown === false ||
                                     this._field?.markdown === 'false';

        const resolvedMdEnabled = fieldMdExplicitFalse
          ? false
          : (dCfg.markdown_enabled !== undefined ? dCfg.markdown_enabled : this._field?.markdown_enabled);

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
          markdown_enabled: resolvedMdEnabled,
        };
      }
    } catch (e) {
      console.warn('Could not fetch server config for Modern Editor, using field defaults from the blueprint.', e);
    }

    this._dCfg = dCfg;
    const url = getEditorUrl(this._field);
    const isMdEnabled = this._isMarkdownEnabled();

    const promises = [];
    if (isMdEnabled) {
      promises.push(loadMarkdownLibraries(dCfg).catch(err => console.warn('Markdown libs load failed', err)));
    }
    promises.push(loadTinyMCE(url));

    Promise.all(promises)
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
    this._cleanupAuxSink();
    if (this._unbindToggle) {
      this._unbindToggle();
      this._unbindToggle = null;
      this._mdToggleBound = false;
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
    
    let plugins = f.plugins || 'lists link image table code fullscreen searchreplace media anchor';
    if (!plugins.includes('anchor')) {
      plugins += ' anchor';
    }

    // Ensure the toolbar contains forecolor and backcolor to allow changing the text/background color
    let toolbar = f.toolbar || 'undo redo | blocks | bold italic underline forecolor backcolor | alignleft aligncenter alignright alignjustify | bullist numlist | link anchor image media table | code fullscreen';
    if (toolbar && !toolbar.includes('anchor')) {
      if (toolbar.includes('link')) {
        toolbar = toolbar.replace('link', 'link anchor');
      } else {
        toolbar += ' | anchor';
      }
    }
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
      plugins: plugins,
      toolbar: toolbar,
    };
  }

  _initEditor(isDarkMode) {
    const textarea = this.shadowRoot.getElementById(this._editorId);
    if (!textarea) return;

    textarea.style.display = '';
    this.shadowRoot.querySelector('.loading')?.remove();

    const updateInfo = window.__MODERN_EDITOR_UPDATE_INFO__ || (this._dCfg && this._dCfg.update_info);
    if (updateInfo && updateInfo.hasUpdate && !updateInfo.autoUpdate) {
      const dismissedVer = localStorage.getItem('modern_editor_dismissed_ver');
      if (dismissedVer !== updateInfo.latestVersion) {
        const wrap = this.shadowRoot.querySelector('.wrap');
        if (wrap && !wrap.querySelector('.update-banner')) {
          const banner = document.createElement('div');
          banner.className = 'update-banner';
          banner.style.cssText = 'padding: 10px 14px; background: #fffbeb; border-bottom: 1px solid #fef3c7; color: #92400e; font-size: 13px; display: flex; justify-content: space-between; align-items: center;';
          banner.innerHTML = `<span><strong>${updateInfo.bannerTitle || 'Modern Editor: Aggiornamenti disponibili'}:</strong> ${updateInfo.bannerMessage || 'Sono disponibili nuove versioni dell\'editor o delle librerie Markdown.'}</span> <a href="#" style="color: #b45309; font-weight: 600; text-decoration: underline; margin-left: 12px; white-space: nowrap;">${updateInfo.dismissLabel || 'Nascondi fino a una nuova versione'}</a>`;
          banner.querySelector('a').addEventListener('click', (e) => {
            e.preventDefault();
            localStorage.setItem('modern_editor_dismissed_ver', updateInfo.latestVersion);
            banner.remove();
          });
          wrap.insertBefore(banner, wrap.firstChild);
        }
      }
    }

    const cfg = this._cfg();

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
      media_live_embeds: true,
      custom_elements: '~iframe',
      extended_valid_elements: 'iframe[*],video[*],audio[*],source[*],track[*],p[style|class|id|align],span[style|class|id],img[*],figure[*],figcaption[*],a[*]',
      media_url_resolver: (data, resolve) => {
        return new Promise((res) => {
          try {
            const url = (data && data.url ? data.url : '').trim();
            if (!url) {
              if (typeof resolve === 'function') {
                resolve({ html: '' });
              }
              res({ html: '' });
              return;
            }

            const ytInfo = parseYoutubeUrl(url);
            if (ytInfo) {
              const iframeHtml = '<iframe src="' + ytInfo.embedUrl + '" width="560" height="314" allowfullscreen="allowfullscreen"></iframe>';
              const ytResult = { html: iframeHtml };
              if (typeof resolve === 'function') {
                resolve(ytResult);
              }
              res(ytResult);
              return;
            }

            const vimeoInfo = parseVimeoUrl(url);
            if (vimeoInfo) {
              const vimeoHtml = '<iframe src="' + vimeoInfo.embedUrl + '" width="560" height="314" allowfullscreen="allowfullscreen"></iframe>';
              const vimeoResult = { html: vimeoHtml };
              if (typeof resolve === 'function') {
                resolve(vimeoResult);
              }
              res(vimeoResult);
              return;
            }

            const defaultResult = { html: '' };
            if (typeof resolve === 'function') {
              resolve(defaultResult);
            }
            res(defaultResult);
          } catch (err) {
            const fallbackErr = { html: '' };
            if (typeof resolve === 'function') {
              resolve(fallbackErr);
            }
            res(fallbackErr);
          }
        });
      },
      image_advtab: true,
      image_class_list: [
        { title: 'None', value: '' },
        { title: useItalian ? 'Allinea a sinistra (testo a lato)' : 'Align left (text wrap)', value: 'align-left' },
        { title: useItalian ? 'Allinea a destra (testo a lato)' : 'Align right (text wrap)', value: 'align-right' },
        { title: useItalian ? 'Centrato (blocco)' : 'Center (block)', value: 'align-center' }
      ],
      link_default_protocol: 'https',
      link_assume_external_targets: false,
      link_attributes_postprocess: (attrs) => {
        if (attrs && attrs.href) {
          attrs.href = normalizeLinkUrl(attrs.href);
        }
      },
      link_target_list: [
        { title: 'None', value: '' },
        { title: 'New window', value: '_blank' },
        { title: 'Same window', value: '_self' }
      ],
      link_rel_list: [
        { title: 'None', value: '' },
        { title: 'No Referrer', value: 'noreferrer' },
        { title: 'No Opener', value: 'noopener' },
        { title: 'No Referrer No Opener', value: 'noreferrer noopener' },
        { title: 'Nofollow', value: 'nofollow' }
      ],
      // Fix: TinyMCE's CSS-only "fake" fullscreen (position: fixed +
      // z-index: 1200) still rendered *underneath* Admin Next's own sticky
      // page header in some builds. That header sits in an ancestor further
      // up the tree that establishes its own stacking context (e.g. a
      // transformed/animated page-transition wrapper), which traps the
      // editor's z-index locally — no CSS override injected from outside
      // the editor's own component can win against that, since the two
      // elements are never compared in the same stacking context to begin
      // with. Using the real browser Fullscreen API instead puts the editor
      // on the browser's "top layer", which by definition sits above every
      // other element on the page regardless of any ancestor's stacking
      // context, so this fixes the overlap unconditionally.
      fullscreen_native: true,
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
        img.align-left, img[style*="float: left"], img[style*="float:left"] {
          float: left !important;
          margin: 0 1.25rem 1rem 0 !important;
          max-width: 50% !important;
        }
        img.align-right, img[style*="float: right"], img[style*="float:right"] {
          float: right !important;
          margin: 0 0 1rem 1.25rem !important;
          max-width: 50% !important;
        }
        img.align-center, img[style*="margin: auto"] {
          display: block !important;
          margin: 1rem auto !important;
          clear: both !important;
        }
        .mce-preview-object.alignleft, iframe.alignleft {
          float: left !important;
          margin: 0.5em 1.5em 0.5em 0 !important;
        }
        .mce-preview-object.alignright, iframe.alignright {
          float: right !important;
          margin: 0.5em 0 0.5em 1.5em !important;
        }
        .mce-preview-object.aligncenter, iframe.aligncenter {
          display: block !important;
          margin-left: auto !important;
          margin-right: auto !important;
          clear: both !important;
        }
      `,
      // Allows TinyMCE to detect the shadow root host for external click handling
      custom_ui_selector: TAG,
      // Fix: the toolbar's "..." overflow button (TinyMCE's default
      // toolbar_mode: 'floating') opens a floating drawer panel that
      // TinyMCE auto-closes on any click it detects as "outside" the
      // toolbar. That outside-click detection isn't Shadow DOM-aware: our
      // editor lives inside a Shadow Root (this is a Web Component), and
      // for listeners attached outside that tree (as TinyMCE's is), the
      // browser retargets `event.target` to the shadow *host* element for
      // any event that crosses the shadow boundary — so TinyMCE's
      // `toolbarElm.contains(event.target)` check always evaluates to
      // false, even for clicks that landed squarely inside the drawer
      // itself. The drawer is misclassified as "clicked outside" and
      // closes itself almost immediately, which is why it flashes open
      // for a moment and then disappears, making it unusable. Switching to
      // 'wrap' avoids the floating panel (and its outside-click check)
      // entirely: overflow buttons are simply shown on an extra toolbar
      // row instead, which needs no cross-shadow-boundary click detection.
      toolbar_mode: 'wrap',
      // Fix (#18): image/link URLs entered as a root-relative path (e.g.
      // "/index/_about/chris-lowe.jpg") were coming back out of the
      // Source/Image dialogs mangled into "../../../../../index/_about/
      // chris-lowe.jpg" and saved to the page's markdown in that broken
      // form. TinyMCE defaults `relative_urls` to true, which rewrites
      // every URL to be relative to `document_base_url` — and since that
      // option isn't set either, it defaults to the *current page's own
      // URL*, i.e. wherever Admin Next is mounted (e.g.
      // /admin/pages/foo/bar/baz), not the frontend page the content will
      // actually render on. The saved path only "looked" correct on the
      // frontend by coincidence, when the real page happened to sit at a
      // matching URL depth so the "../" segments cancelled back out to
      // root; on any other page (or once a URL-rewriting plugin such as a
      // CDN plugin string-concatenates its base URL onto this already-
      // relative path instead of resolving it as a real path) it breaks,
      // e.g. "https://cdn.example.tld../../../../../index/...". Disabling
      // relative_urls (and remove_script_host, which has the same
      // rewriting behavior for protocol/host-relative URLs) makes TinyMCE
      // keep URLs exactly as entered, so a root-relative path is stored
      // and read back unchanged.
      //
      // Fix (#18 follow-up): disabling relative_urls alone wasn't enough.
      // `convert_urls` is a *separate* TinyMCE option (also on by default)
      // that still ran and, per TinyMCE's own docs, "convert[s] URLs to be
      // relative or absolute, depending on the relative_urls option" — so
      // with relative_urls now false, convert_urls kept firing but flipped
      // to absolutizing every URL instead: it resolved the root-relative
      // path against `document_base_url` (again defaulting to the current
      // page, e.g. whatever prototype/staging domain Admin Next happens to
      // be running on) and saved that as a full "https://<current-domain>
      // /index/_about/chris-lowe.jpg" URL. That silently baked the editing
      // environment's own domain into the content, breaking the same
      // edit-on-prototype/copy-to-live workflow the original fix was meant
      // to protect, and defeating URL-rewriting plugins (e.g. a CDN
      // plugin) that only rewrite root-relative paths and pass already-
      // absolute URLs through untouched. Disabling convert_urls too makes
      // TinyMCE leave every URL completely untouched, so the root-relative
      // path the user actually typed is what gets stored.
      relative_urls: false,
      remove_script_host: false,
      convert_urls: false,
      // Fix: right-clicking inside the editor's text area always opened
      // TinyMCE's own context menu (with e.g. a "Link" entry), which not
      // only hid the browser's native context menu but, since it's a
      // custom menu rendered by TinyMCE rather than a real right-click on
      // editable text, also prevented the browser from ever offering its
      // own spell-check suggestions there. Disabling TinyMCE's context
      // menu entirely lets the real browser context menu (and with it,
      // right-click spell-check suggestions) come through instead;
      // `browser_spellcheck: true` complements this by making TinyMCE mark
      // its editing area as spellcheck="true" (it defaults to "false"),
      // which is what makes the browser actually underline/spell-check the
      // text in the first place.
      contextmenu: false,
      browser_spellcheck: true,
      setup: (editor) => {
        editor.on('init', () => {
          this._editor = editor;
          const initialVal = this._value || '';

          const isMdEnabled = this._isMarkdownEnabled();
          this._lastKnownMdEnabled = isMdEnabled;
          let initialHtml = isMdEnabled ? mdToHtml(initialVal) : initialVal;
          if (!isMdEnabled) {
            initialHtml = cleanAsterisksInHtml(initialHtml);
          }
          this._applying = true;
          editor.setContent(initialHtml);
          editor.undoManager?.clear();
          editor.setDirty(false);
          this._applying = false;

          const renderedHtml = editor.getContent();
          this._baselineValue = isMdEnabled ? htmlToMd(renderedHtml) : renderedHtml;
          this._value = this._baselineValue;
          this._initialCleanValue = this._baselineValue;
          this._lastEmittedValue = this._baselineValue;
          if (this._lightTextarea) {
            this._lightTextarea.value = this._baselineValue;
          }
          this._ready = true;
        });
        // Fix: pasted content (typically copied from WordPress or other
        // sites/editors) was inserted as-is, carrying foreign classes,
        // inline styles and deeply nested spacer <div>s that produced
        // broken/ugly Markdown once converted — see sanitizePastedHtml()
        // above for the full explanation.
        editor.on('PastePreProcess', (e) => {
          e.content = sanitizePastedHtml(e.content);
        });
        editor.on('BeforeSetContent', (e) => {
          if (e.content) {
            if (e.content.includes('youtube') || e.content.includes('youtu.be')) {
              e.content = normalizeYoutubeIframeHtml(e.content);
            }
            if (e.content.includes('<iframe') || e.content.includes('<video')) {
              e.content = separateMultipleIframesInHtml(e.content);
            }
          }
        });
        editor.on('SaveContent', (e) => {
          if (e.content) {
            if (e.content.includes('youtube') || e.content.includes('youtu.be')) {
              e.content = normalizeYoutubeIframeHtml(e.content);
            }
            if (e.content.includes('<iframe') || e.content.includes('<video')) {
              e.content = separateMultipleIframesInHtml(e.content);
            }
          }
        });
        // native fullscreen puts our shadow host (not the sink we relocated
        // to document.body) into the browser's top layer, so the sink has
        // to move back inside the shadow root while fullscreen is active —
        // see _setAuxSinkFullscreen for the full explanation.
        editor.on('FullscreenStateChanged', (e) => {
          this._setAuxSinkFullscreen(e.state);
        });
        // Fix: toolbar, formatting, and typing actions need to notify Admin Next
        // so that the Save button is enabled immediately.
        // Crucially, we only emit change/input events when actual unsaved changes exist
        // (content differs from baseline), preventing false-positive "unsaved changes" prompts
        // when opening, viewing, clicking around, or leaving pages.
        const notifyChange = (force = false) => {
          if (this._applying || !this._ready || !editor) return;

          let html = editor.getContent();
          if (html.includes('youtube') || html.includes('youtu.be')) {
            html = normalizeYoutubeIframeHtml(html);
          }
          if (html.includes('<iframe') || html.includes('<video')) {
            html = separateMultipleIframesInHtml(html);
          }
          const isMdEnabled = this._isMarkdownEnabled();
          let finalVal = isMdEnabled ? htmlToMd(html) : html;
          if (!isMdEnabled) {
            finalVal = cleanAsterisksInHtml(finalVal);
          }

          const hasDirty = editor.isDirty ? editor.isDirty() : false;
          const baselineDiff = finalVal !== this._baselineValue;

          // If not forced:
          // A genuine modification exists only if the converted content differs from
          // our initialized baseline (_baselineValue).
          // If the markdown value matches baseline, no unsaved changes exist (e.g. initial render,
          // caret navigation, selection change, or undo back to starting point).
          if (!force) {
            if (!baselineDiff) {
              // Content matches clean baseline: synchronize internal value quietly without firing change events or marking form dirty
              this._value = finalVal;
              this._lastEmittedValue = finalVal;
              if (this._lightTextarea) {
                this._lightTextarea.value = finalVal;
              }
              const textarea = this.shadowRoot?.getElementById(this._editorId);
              if (textarea) {
                textarea.value = finalVal;
              }
              return;
            }

            // If editor has not been marked dirty by TinyMCE AND there was no baseline difference, return
            if (!hasDirty && !baselineDiff) {
              return;
            }
          }

          this._value = finalVal;
          this._lastEmittedValue = finalVal;

          const textarea = this.shadowRoot?.getElementById(this._editorId);
          if (textarea) {
            textarea.value = finalVal;
          }

          if (this._lightTextarea) {
            this._lightTextarea.value = finalVal;
            this._lightTextarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            this._lightTextarea.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          }

          this.dispatchEvent(new CustomEvent('change', {
            detail: finalVal,
            bubbles: true,
            composed: true,
          }));
          this.dispatchEvent(new CustomEvent('input', {
            detail: finalVal,
            bubbles: true,
            composed: true,
          }));

          // Always ensure the Grav Admin Save button is enabled / active
          this._enableSaveButton();
        };

        const handleEditorEvent = () => {
          if (this._applying || !this._ready) return;
          notifyChange();
          if (typeof queueMicrotask === 'function') {
            queueMicrotask(() => notifyChange());
          } else {
            setTimeout(() => notifyChange(), 0);
          }
        };

        const applyImgAlignment = (align) => {
          const selected = editor.selection.getNode();
          const img = (selected && selected.nodeName === 'IMG') ? selected : (selected ? selected.querySelector('img') : null);
          if (!img) return;

          editor.undoManager.transact(() => {
            img.classList.remove('align-left', 'align-right', 'align-center');
            let currentStyle = img.getAttribute('style') || '';
            currentStyle = currentStyle
              .replace(/float\s*:\s*(left|right|none)\s*;?/gi, '')
              .replace(/margin(?:-[a-z]+)?\s*:\s*[^;]+;?/gi, '')
              .replace(/display\s*:\s*(block|inline|inline-block)\s*;?/gi, '')
              .replace(/clear\s*:\s*(both|none)\s*;?/gi, '')
              .trim();

            if (align === 'left') {
              img.classList.add('align-left');
              img.setAttribute('style', (currentStyle ? currentStyle + ' ' : '') + 'float: left; margin: 0 1rem 1rem 0;');
            } else if (align === 'right') {
              img.classList.add('align-right');
              img.setAttribute('style', (currentStyle ? currentStyle + ' ' : '') + 'float: right; margin: 0 0 1rem 1rem;');
            } else if (align === 'center') {
              img.classList.add('align-center');
              img.setAttribute('style', (currentStyle ? currentStyle + ' ' : '') + 'display: block; margin: 1rem auto; clear: both;');
            } else {
              if (currentStyle) {
                img.setAttribute('style', currentStyle);
              } else {
                img.removeAttribute('style');
              }
            }
            editor.setDirty(true);
            editor.nodeChanged();
            notifyChange();
          });
        };

        editor.ui.registry.addButton('imgalignleft', {
          icon: 'align-left',
          tooltip: useItalian ? 'Allinea immagine a sinistra (testo a lato)' : 'Align image left (text wrap)',
          onAction: () => applyImgAlignment('left')
        });

        editor.ui.registry.addButton('imgalignright', {
          icon: 'align-right',
          tooltip: useItalian ? 'Allinea immagine a destra (testo a lato)' : 'Align image right (text wrap)',
          onAction: () => applyImgAlignment('right')
        });

        editor.ui.registry.addButton('imgaligncenter', {
          icon: 'align-center',
          tooltip: useItalian ? 'Centra immagine (blocco)' : 'Align image center (block)',
          onAction: () => applyImgAlignment('center')
        });

        editor.ui.registry.addButton('imgalignnone', {
          icon: 'close',
          tooltip: useItalian ? 'Rimuovi allineamento' : 'Remove alignment',
          onAction: () => applyImgAlignment('none')
        });

        editor.ui.registry.addContextToolbar('imagealignments', {
          predicate: (node) => node && node.nodeName === 'IMG',
          items: 'image | imgalignleft imgalignright imgaligncenter imgalignnone',
          position: 'node',
          scope: 'node'
        });

        editor.on('change input keyup undo redo ExecCommand SetContent NodeChange Paste Cut ClearUndos dirty CloseWindow', handleEditorEvent);
      },
    };

    // If loading from local path, specify base_url so TinyMCE can load its assets (plugins, skins, themes) correctly
    const editorUrl = getEditorUrl(this._field);
    if (editorUrl && !isTrustedTinyMceCdnUrl(editorUrl)) {
      const urlParts = editorUrl.split('/');
      urlParts.pop(); // remove 'tinymce.min.js'
      initOpts.base_url = urlParts.join('/');
    }

    // Issue #16 / #12: relocate the dialog sink out of the Shadow DOM
    // before the dialogs themselves are ever opened (see _watchForAuxSink).
    this._watchForAuxSink();

    window.tinymce.init(initOpts).catch((err) => this._renderError(err));
  }

  // Issue #16 (and already flagged in #12): when TinyMCE's target lives
  // inside a Shadow Root, TinyMCE's own getContentContainer() attaches the
  // dialog "sink" — the `.tox-tinymce-aux` element that holds the Source
  // code dialog, Image dialog, etc. — directly to that shadow root (the
  // `ui_container` init option has no effect here: it's only read in
  // `inline: true` mode, so it was silently ignored). Since our shadow
  // host is rendered inside Admin Next's page body, that sink ends up
  // trapped in the same local stacking context as the sticky page header
  // — the exact issue already fixed for fullscreen mode above, but a plain
  // modal dialog can't use the Fullscreen API. Instead we physically move
  // the sink to `document.body`, a genuine sibling of whatever wraps the
  // header, once it appears. Its skin stylesheet is mirrored into the main
  // document too, since a shadow root's <link>/<style> tags stop applying
  // to elements once they leave that tree.
  _watchForAuxSink() {
    if (this._auxObserver || !this.shadowRoot) return;
    const tryRelocate = () => {
      const sink = this.shadowRoot.querySelector('.tox-tinymce-aux');
      if (sink && !sink.dataset.medRelocated) {
        this._relocateAuxSink(sink);
        return true;
      }
      return false;
    };
    if (tryRelocate()) return;
    this._auxObserver = new MutationObserver(() => {
      if (tryRelocate() && this._auxObserver) {
        this._auxObserver.disconnect();
        this._auxObserver = null;
      }
    });
    this._auxObserver.observe(this.shadowRoot, { childList: true });
  }

  _relocateAuxSink(sink) {
    sink.dataset.medRelocated = '1';

    // Mirror the skin stylesheet(s) TinyMCE injected into the shadow root
    // so the relocated dialog keeps its styling once it's in the light DOM.
    this._mirroredLinks = this._mirroredLinks || [];
    this.shadowRoot.querySelectorAll('link[rel="stylesheet"][href*="/skins/"]').forEach((link) => {
      if (!link.href || document.head.querySelector(`link[href="${link.href}"]`)) return;
      const clone = link.cloneNode(true);
      document.head.appendChild(clone);
      this._mirroredLinks.push(clone);
    });

    // Sit above absolutely everything, regardless of any ancestor's
    // trapped stacking context — this is now a top-level child of <body>.
    sink.style.zIndex = '2147483001';
    document.body.appendChild(sink);
    this._auxSink = sink;
  }

  // Native Fullscreen puts our shadow host (the custom element itself) —
  // not document.body — into the browser's top layer (see getFullscreenRoot
  // in the fullscreen plugin: it targets the shadow *host* when the editor
  // lives inside a Shadow Root). Anything outside that host's subtree,
  // however high its z-index, renders underneath the fullscreen content.
  // So while fullscreen is active the sink needs to live back inside the
  // shadow root; once it ends, it goes back to document.body to escape
  // Admin Next's own trapped stacking context (see _relocateAuxSink).
  _setAuxSinkFullscreen(isFullscreen) {
    const sink = this._auxSink;
    if (!sink || !this.shadowRoot) return;
    if (isFullscreen) {
      if (sink.parentNode !== this.shadowRoot) {
        this.shadowRoot.appendChild(sink);
      }
    } else if (sink.parentNode !== document.body) {
      document.body.appendChild(sink);
    }
  }

  _cleanupAuxSink() {
    if (this._auxObserver) {
      this._auxObserver.disconnect();
      this._auxObserver = null;
    }
    if (this._auxSink && this._auxSink.parentNode) {
      this._auxSink.parentNode.removeChild(this._auxSink);
    }
    this._auxSink = null;
    if (this._mirroredLinks) {
      this._mirroredLinks.forEach((l) => l.parentNode && l.parentNode.removeChild(l));
      this._mirroredLinks = null;
    }
  }

  _maybeReinit() {
    // If a relevant configuration option changes after initialization (e.g., toolbar), reinitialize the editor.
    if (!this._editor) return;
    const isDarkMode = this._detectDarkMode();
    const editorUrl = getEditorUrl(this._field);
    const current = JSON.stringify({ ...this._cfg(), isDarkMode, editor_url: editorUrl });
    if (this._lastCfg === current) return;
    this._lastCfg = current;
    const isMdEnabled = this._isMarkdownEnabled();
    const mdVal = isMdEnabled ? htmlToMd(this._editor.getContent()) : this._editor.getContent();
    this._editor.remove();
    this._cleanupAuxSink();
    this._ready = false;
    this._renderShell(isDarkMode);
    
    loadTinyMCE(editorUrl).then(() => {
      ensureBaseUrl(editorUrl);
      this._initEditor(isDarkMode);
      this._value = mdVal;
      this._lastEmittedValue = mdVal;
      this._initialCleanValue = mdVal;
    });
  }
}

customElements.define(TAG, TinyMCEField);
