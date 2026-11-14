import { useRef, useEffect, useMemo, useState } from 'react';
import { stripTrackingPixelsFromHtml } from '../../../shared/mailSecurity';
import { EMAIL_BODY_READY_EVENT } from '../lib/emailSearchHighlights';
import { htmlHasOwnCanvas } from '../lib/emailCanvas';
import { createForwardFinder, MAIL_HTML_SCAN_LIMIT, skipWhitespace } from '../../../shared/htmlScan';

interface ThemeCanvas {
  colorScheme: 'light' | 'dark';
  background: string;
  foreground: string;
  link: string;
}

const CSS_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

function cssColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  // Only plain colour literals reach the iframe's <style>.
  return CSS_COLOR.test(trimmed) ? trimmed : fallback;
}

/** App theme colours for simple messages (no canvas of their own). */
function readThemeCanvas(): ThemeCanvas {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const dark = root.getAttribute('data-theme') === 'dark';
  return {
    colorScheme: dark ? 'dark' : 'light',
    background: cssColor(styles.getPropertyValue('--raised-surface'), dark ? '#1B1D22' : '#FFFFFF'),
    foreground: cssColor(styles.getPropertyValue('--text-primary'), dark ? '#E6E6E6' : '#111111'),
    link: cssColor(styles.getPropertyValue('--accent'), '#5383E6'),
  };
}

/** Re-renders when the app theme (or interface style) changes. */
function useThemeKey(): string {
  const read = () => {
    const root = document.documentElement;
    return `${root.getAttribute('data-theme') || ''}|${root.getAttribute('data-interface-style') || ''}`;
  };
  const [key, setKey] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setKey(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-interface-style'] });
    return () => observer.disconnect();
  }, []);
  return key;
}

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

/** First index >= from where `predicate` holds; cached like `createForwardFinder`. */
function createPredicateFinder(source: string, predicate: (char: string) => boolean): (from: number) => number {
  let queriedFrom = Number.POSITIVE_INFINITY;
  let found = -1;
  return (from: number) => {
    if (from >= queriedFrom && (found === -1 || found >= from)) return found;
    queriedFrom = from;
    found = -1;
    for (let index = from; index < source.length; index += 1) {
      if (predicate(source[index])) {
        found = index;
        break;
      }
    }
    return found;
  };
}

/** First regex match starting at or after `from`; cached so forward queries never rescan. */
function createForwardMatchFinder(source: string, pattern: RegExp): (from: number) => RegExpExecArray | null {
  let queriedFrom = Number.POSITIVE_INFINITY;
  let found: RegExpExecArray | null = null;
  return (from: number) => {
    if (from >= queriedFrom && (found === null || found.index >= from)) return found;
    queriedFrom = from;
    pattern.lastIndex = from;
    found = pattern.exec(source);
    return found;
  };
}

/** `url(` + spaces + optional quote + spaces + optional `http:`/`https:` + `//`, checked by hand. */
function hasRemoteCssUrl(html: string): boolean {
  const opener = /url\(/gi;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(html)) !== null) {
    let index = skipWhitespace(html, match.index + match[0].length);
    if (html[index] === '"' || html[index] === "'") index = skipWhitespace(html, index + 1);
    const rest = html.slice(index, index + 8).toLowerCase();
    if (rest.startsWith('//') || rest.startsWith('http://') || rest.startsWith('https://')) return true;
  }
  return false;
}

/**
 * True when the HTML references remote (http/https) image resources.
 *
 * Same answer as the former regexes
 * `/<(?:img|source)\b[^>]+\b(?:src|srcset)\s*=\s*(?:"[^"]*(?:https?:)?\/\/|'[^']*(?:https?:)?\/\/|[^\s>]*(?:https?:)?\/\/)/i`
 * and `/url\(\s*["']?\s*(?:https?:)?\/\//i`, but linear: both were
 * quadratic on hostile mail (unclosed tags, repeated `src=`, `url(` followed
 * by long whitespace). Every lookup below only moves forward, and an image tag
 * that shares its end with the previous one only holds attributes already
 * checked. Beyond `MAIL_HTML_SCAN_LIMIT` it answers true: the mail is treated
 * as having remote images, which stay blocked until the user allows them.
 */
export function hasRemoteImages(html: string): boolean {
  if (!html) return false;
  if (html.length > MAIL_HTML_SCAN_LIMIT) return true;
  if (hasRemoteCssUrl(html)) return true;

  const tagOpener = /<(?:img|source)\b/gi;
  const nextAttribute = createForwardMatchFinder(html, /\b(?:src|srcset)\s*=\s*/gi);
  const nextGt = createForwardFinder(html, '>');
  const nextDoubleQuote = createForwardFinder(html, '"');
  const nextSingleQuote = createForwardFinder(html, "'");
  const nextDoubleSlash = createForwardFinder(html, '//');
  const nextRunEnd = createPredicateFinder(html, char => char === '>' || /\s/.test(char));
  const slashesBefore = (from: number, limit: number) => {
    const slashes = nextDoubleSlash(from);
    return slashes !== -1 && slashes + 1 < limit;
  };

  let previousTagEnd = -1;
  let tag: RegExpExecArray | null;
  while ((tag = tagOpener.exec(html)) !== null) {
    const nameEnd = tag.index + tag[0].length;
    const gt = nextGt(nameEnd);
    // `[^>]+` runs to the first `>` (or the end of the document).
    const tagEnd = gt === -1 ? html.length : gt;
    if (tagEnd === previousTagEnd) continue;
    previousTagEnd = tagEnd;

    // `[^>]+` needs at least one character before the attribute.
    let attr = nextAttribute(nameEnd + 1);
    while (attr && attr.index < tagEnd) {
      const valueStart = attr.index + attr[0].length;
      // Third alternative (checked first so every lookup moves forward): the
      // run of non-space, non-`>` characters from the value start, quote included.
      const runEnd = nextRunEnd(valueStart);
      if (slashesBefore(valueStart, runEnd === -1 ? html.length : runEnd)) return true;
      const quote = html[valueStart];
      if (quote === '"' || quote === "'") {
        const close = (quote === '"' ? nextDoubleQuote : nextSingleQuote)(valueStart + 1);
        if (slashesBefore(valueStart + 1, close === -1 ? html.length : close)) return true;
      }
      attr = nextAttribute(Math.max(valueStart, attr.index + 1));
    }
    if (gt === -1) break;
    tagOpener.lastIndex = Math.max(tagOpener.lastIndex, nameEnd);
  }
  return false;
}

// Hardened HTML renderer (TD-C2/C3): strict CSP blocks all scripts and gates
// remote images; the iframe never gets `allow-scripts`, so no email JS can run.
// `allow-same-origin` is retained ONLY to measure body height for auto-sizing —
// with scripts disabled by both the sandbox and CSP `script-src 'none'`, this is
// not an escape vector.
export function SafeHtmlRenderer({
  html,
  loadRemoteImages,
  onLinkClick,
}: {
  html: string;
  loadRemoteImages: boolean;
  onLinkClick?: (url: string) => boolean;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  // Rich HTML (newsletters, designed mail) keeps its white canvas; simple
  // messages follow the app theme so they do not glare as a white card.
  const ownCanvas = useMemo(() => htmlHasOwnCanvas(html), [html]);
  const themeKey = useThemeKey();

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let timers: any[] = [];
    let docRef: Document | null = null;
    let handleIframeKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let handleIframeClick: ((e: MouseEvent) => void) | null = null;
    let frameId: number | null = null;
    setReady(false);

    const prepareIframe = () => {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc) return;
      docRef = doc;
      const imgSrc = loadRemoteImages ? 'data: cid: blob: https: http:' : 'data: cid: blob:';
      const theme = ownCanvas ? null : readThemeCanvas();
      const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:; media-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none';`;

      const head = `
        <meta http-equiv="Content-Security-Policy" content="${csp}">
        <meta name="color-scheme" content="${theme ? theme.colorScheme : 'light'}">
        <meta name="referrer" content="no-referrer">
        <base target="_blank">
        <style>
          :root {
            color-scheme: ${theme ? theme.colorScheme : 'light'};
            ${theme ? `background-color: ${theme.background};` : ''}
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 12px;
            line-height: 1.5;
            margin: 0;
            padding: 8px;
            color: ${theme ? theme.foreground : '#111111'};
            background-color: ${theme ? theme.background : '#ffffff'};
            word-break: break-word;
          }
          a { color: ${theme ? theme.link : '#5383E6'}; text-decoration: underline; }
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

      handleIframeClick = (event: MouseEvent) => {
        const target = event.target as { closest?: (selector: string) => Element | null } | null;
        const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
        if (!anchor || !onLinkClick) return;

        const url = anchor.href || anchor.getAttribute('href') || '';
        if (!url) return;
        try {
          if (!onLinkClick(url)) return;
          event.preventDefault();
          event.stopPropagation();
        } catch (error) {
          console.error('Email link handler failed:', error);
        }
      };
      doc.addEventListener('click', handleIframeClick);

      const resizeIframe = () => {
        if (iframe && iframe.contentWindow?.document.body) {
          const height = iframe.contentWindow.document.body.scrollHeight;
          iframe.style.height = `${height + 16}px`;
        }
      };

      iframe.onload = resizeIframe;
      resizeIframe();
      timers = [50, 300, 1000].map(ms => setTimeout(resizeIframe, ms));
      setReady(true);
      window.dispatchEvent(new Event(EMAIL_BODY_READY_EVENT));
    };

    frameId = globalThis.requestAnimationFrame(prepareIframe);

    return () => {
      if (frameId !== null) globalThis.cancelAnimationFrame(frameId);
      timers.forEach(clearTimeout);
      if (docRef && handleIframeKeyDown) {
        docRef.removeEventListener('keydown', handleIframeKeyDown);
      }
      if (docRef && handleIframeClick) {
        docRef.removeEventListener('click', handleIframeClick);
      }
    };
  }, [html, loadRemoteImages, onLinkClick, ownCanvas, themeKey]);

  return (
    <div className="relative min-h-10">
      {!ready && (
        <div className="absolute inset-0 animate-pulse rounded bg-[var(--hover-row)] motion-reduce:animate-none" />
      )}
      <iframe
        ref={iframeRef}
        title="Email message content"
        sandbox="allow-popups allow-same-origin"
        aria-busy={!ready}
        data-email-canvas={ownCanvas ? 'own' : 'theme'}
        className={`w-full rounded overflow-hidden transition-opacity motion-reduce:transition-none ${ownCanvas ? 'bg-white text-black' : 'bg-transparent'} ${ready ? 'opacity-100' : 'opacity-0'}`}
        style={{ minHeight: '40px', height: 'auto', display: 'block', border: 'none' }}
      />
    </div>
  );
}
