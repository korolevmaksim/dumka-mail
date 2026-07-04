import { useRef, useEffect } from 'react';
import { stripTrackingPixelsFromHtml } from '../../../shared/mailSecurity';

function findNextMediaRule(css: string, from: number): number {
  let i = from;
  while (i < css.length) {
    const char = css[i];
    if (char === '"' || char === "'") {
      i = skipQuotedString(css, i);
      continue;
    }
    if (char === '/' && css[i + 1] === '*') {
      i = skipCssComment(css, i);
      continue;
    }
    if (css.slice(i, i + 6).toLowerCase() === '@media') {
      const next = css[i + 6];
      if (!next || /[\s({]/.test(next)) return i;
    }
    i += 1;
  }
  return -1;
}

function findNextOpeningBrace(css: string, from: number): number {
  let i = from;
  while (i < css.length) {
    const char = css[i];
    if (char === '"' || char === "'") {
      i = skipQuotedString(css, i);
      continue;
    }
    if (char === '/' && css[i + 1] === '*') {
      i = skipCssComment(css, i);
      continue;
    }
    if (char === '{') return i;
    i += 1;
  }
  return -1;
}

function findMatchingBrace(css: string, openBrace: number): number {
  let depth = 0;
  let i = openBrace;
  while (i < css.length) {
    const char = css[i];
    if (char === '"' || char === "'") {
      i = skipQuotedString(css, i);
      continue;
    }
    if (char === '/' && css[i + 1] === '*') {
      i = skipCssComment(css, i);
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  return -1;
}

function skipQuotedString(css: string, start: number): number {
  const quote = css[start];
  let i = start + 1;
  while (i < css.length) {
    if (css[i] === '\\') {
      i += 2;
      continue;
    }
    if (css[i] === quote) return i + 1;
    i += 1;
  }
  return css.length;
}

function skipCssComment(css: string, start: number): number {
  const end = css.indexOf('*/', start + 2);
  return end === -1 ? css.length : end + 2;
}

export function removeDarkColorSchemeMediaRules(css: string): string {
  let result = '';
  let cursor = 0;

  while (cursor < css.length) {
    const mediaStart = findNextMediaRule(css, cursor);
    if (mediaStart === -1) {
      result += css.slice(cursor);
      break;
    }

    const openingBrace = findNextOpeningBrace(css, mediaStart + 6);
    if (openingBrace === -1) {
      result += css.slice(cursor);
      break;
    }

    const closingBrace = findMatchingBrace(css, openingBrace);
    if (closingBrace === -1) {
      result += css.slice(cursor);
      break;
    }

    result += css.slice(cursor, mediaStart);
    const mediaPrelude = css.slice(mediaStart, openingBrace);
    if (!/prefers-color-scheme\s*:\s*dark/i.test(mediaPrelude)) {
      result += css.slice(mediaStart, closingBrace + 1);
    }
    cursor = closingBrace + 1;
  }

  return result;
}

function preprocessHtml(html: string): string {
  if (!html) return html;
  const htmlWithoutTrackers = stripTrackingPixelsFromHtml(html);
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlWithoutTrackers, 'text/html');
    const colorSchemeMetas = doc.querySelectorAll(
      'meta[name="color-scheme" i], meta[name="supported-color-schemes" i]'
    );
    colorSchemeMetas.forEach((meta) => meta.setAttribute('content', 'light'));

    const styleElements = doc.querySelectorAll('style');
    styleElements.forEach((styleElement) => {
      const sanitizedCss = removeDarkColorSchemeMediaRules(styleElement.textContent || '');
      if (sanitizedCss.trim()) {
        styleElement.textContent = sanitizedCss;
      } else {
        styleElement.remove();
      }
    });

    const images = doc.querySelectorAll('img');
    images.forEach((img) => {
      const hasHeight = img.hasAttribute('height');
      const hasWidth = img.hasAttribute('width');

      const cleanValue = (val: string) => {
        return /^\d+$/.test(val.trim()) ? `${val.trim()}px` : val.trim();
      };

      if (hasHeight && !hasWidth) {
        const heightVal = img.getAttribute('height');
        if (heightVal && !img.style.height) {
          img.style.height = cleanValue(heightVal);
        }
      } else if (hasWidth && !hasHeight) {
        const widthVal = img.getAttribute('width');
        if (widthVal && !img.style.width) {
          img.style.width = cleanValue(widthVal);
        }
      }
    });
    return `${doc.head.innerHTML}${doc.body.innerHTML}`;
  } catch (e) {
    console.error('Error preprocessing HTML:', e);
    return htmlWithoutTrackers;
  }
}

/** True when the HTML references remote (http/https) image resources. */
export function hasRemoteImages(html: string): boolean {
  if (!html) return false;
  return /<(?:img|source)\b[^>]+\b(?:src|srcset)\s*=\s*(?:"[^"]*(?:https?:)?\/\/|'[^']*(?:https?:)?\/\/|[^\s>]*(?:https?:)?\/\/)/i.test(html) ||
    /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html);
}

// Hardened HTML renderer (TD-C2/C3): strict CSP blocks all scripts and gates
// remote images; the iframe never gets `allow-scripts`, so no email JS can run.
// `allow-same-origin` is retained ONLY to measure body height for auto-sizing —
// with scripts disabled by both the sandbox and CSP `script-src 'none'`, this is
// not an escape vector.
export function SafeHtmlRenderer({ html, loadRemoteImages }: { html: string; loadRemoteImages: boolean }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let timers: any[] = [];
    let docRef: Document | null = null;
    let handleIframeKeyDown: ((e: KeyboardEvent) => void) | null = null;

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (doc) {
      docRef = doc;
      const imgSrc = loadRemoteImages ? 'data: cid: blob: https: http:' : 'data: cid: blob:';
      const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none';`;

      const head = `
        <meta http-equiv="Content-Security-Policy" content="${csp}">
        <meta name="color-scheme" content="light">
        <meta name="referrer" content="no-referrer">
        <base target="_blank">
        <style>
          :root {
            color-scheme: light;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 12px;
            line-height: 1.5;
            margin: 0;
            padding: 8px;
            color: #111111;
            background-color: #ffffff;
            word-break: break-word;
          }
          a { color: #5383E6; text-decoration: underline; }
          img { max-width: 100% !important; height: auto; }
          table { max-width: 100% !important; }
        </style>
      `;

      doc.open();
      doc.write(`<!doctype html><html><head>${head}</head><body>${preprocessHtml(html)}</body></html>`);
      doc.close();

      handleIframeKeyDown = (e: KeyboardEvent) => {
        const activeEl = doc.activeElement;
        const isInputFocused = activeEl && (
          activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable
        );
        if (isInputFocused) return;

        const event = new KeyboardEvent('keydown', {
          key: e.key,
          code: e.code,
          location: e.location,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          repeat: e.repeat,
          bubbles: true,
          cancelable: true
        });
        const consumed = !window.dispatchEvent(event);
        // If an app shortcut handled the forwarded copy, consume the original
        // event too; otherwise Electron treats it as unhandled and fires the
        // matching menu accelerator as well, running the shortcut twice.
        // Note: `consumed` reflects preventDefault from ANY window keydown
        // listener — a future handler that consumes a key whose native default
        // matters inside the email body (e.g. Cmd+C copy) would suppress it here.
        if (consumed) e.preventDefault();
      };

      doc.addEventListener('keydown', handleIframeKeyDown);

      const resizeIframe = () => {
        if (iframe && iframe.contentWindow?.document.body) {
          const height = iframe.contentWindow.document.body.scrollHeight;
          iframe.style.height = `${height + 16}px`;
        }
      };

      iframe.onload = resizeIframe;
      resizeIframe();
      timers = [50, 300, 1000].map(ms => setTimeout(resizeIframe, ms));
    }

    return () => {
      timers.forEach(clearTimeout);
      if (docRef && handleIframeKeyDown) {
        docRef.removeEventListener('keydown', handleIframeKeyDown);
      }
    };
  }, [html, loadRemoteImages]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-popups allow-same-origin"
      className="w-full bg-white rounded text-black overflow-hidden"
      style={{ minHeight: '40px', height: 'auto', display: 'block', border: 'none' }}
    />
  );
}
