import { useRef, useEffect } from 'react';

function preprocessHtml(html: string): string {
  if (!html) return html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
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
    return doc.documentElement.innerHTML;
  } catch (e) {
    console.error('Error preprocessing HTML:', e);
    return html;
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
        <meta name="referrer" content="no-referrer">
        <base target="_blank">
        <style>
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
        window.dispatchEvent(event);
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
