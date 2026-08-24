/**
 * In-thread find-in-email highlighting.
 *
 * Marks are inserted by mutating the live DOM. That is safe inside the
 * sandboxed email iframe (React does not own that document). It is not safe
 * in React-managed chrome such as the To/Cc recipient list: wrapping those
 * text nodes and later expanding/collapsing the list makes React throw
 * during commit, which has crashed the Chromium renderer and left a black
 * window.
 */
export const EMAIL_SEARCH_HIGHLIGHT_CLASS = 'email-search-highlight';
export const EMAIL_SEARCH_SKIP_ATTR = 'data-email-search-skip';
export const EMAIL_SEARCH_HOST_SELECTOR = 'iframe';
export const EMAIL_BODY_READY_EVENT = 'dumka-email-body-ready';

const INACTIVE_MARK_BACKGROUND = 'rgba(235, 140, 61, 0.4)';
const ACTIVE_MARK_BACKGROUND = '#5383E6';

export function classifyEmailSearchHost(
  tagName: string,
  isInsideSkippedChrome: boolean,
): 'iframe-body' | 'ignore' {
  if (isInsideSkippedChrome) return 'ignore';
  return tagName.toUpperCase() === 'IFRAME' ? 'iframe-body' : 'ignore';
}

function iframeBody(host: Element): HTMLElement | null {
  if (classifyEmailSearchHost(host.tagName, Boolean(host.closest(`[${EMAIL_SEARCH_SKIP_ATTR}]`))) !== 'iframe-body') {
    return null;
  }
  try {
    const iframe = host as HTMLIFrameElement;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    return doc?.body ?? null;
  } catch {
    return null;
  }
}

function listHighlightRoots(pane: HTMLElement): HTMLElement[] {
  return Array.from(pane.querySelectorAll(EMAIL_SEARCH_HOST_SELECTOR))
    .map(iframeBody)
    .filter((body): body is HTMLElement => Boolean(body));
}

function unwrapMarks(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const marks = Array.from(root.querySelectorAll(`mark.${EMAIL_SEARCH_HIGHLIGHT_CLASS}`));
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    parent.replaceChild(doc.createTextNode(mark.textContent || ''), mark);
  }
  root.normalize();
}

export function clearEmailSearchHighlights(pane: HTMLElement): void {
  for (const root of listHighlightRoots(pane)) {
    unwrapMarks(root);
  }
}

export function applyEmailSearchHighlights(
  pane: HTMLElement,
  query: string,
  activeIdx: number,
): { count: number } {
  const elements: HTMLElement[] = [];
  if (!query.trim()) return { count: 0 };

  const escaped = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');

  const traverse = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') {
        return;
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || '';
      regex.lastIndex = 0;
      if (regex.test(text)) {
        regex.lastIndex = 0;
        const parts = text.split(regex);
        const doc = node.ownerDocument;
        if (!doc) return;
        const fragment = doc.createDocumentFragment();

        for (const part of parts) {
          if (part.toLowerCase() === query.toLowerCase()) {
            const mark = doc.createElement('mark');
            mark.className = EMAIL_SEARCH_HIGHLIGHT_CLASS;
            mark.textContent = part;
            mark.style.backgroundColor = INACTIVE_MARK_BACKGROUND;
            mark.style.color = 'inherit';
            mark.style.borderRadius = '2px';
            mark.style.padding = '0 2px';
            mark.style.borderBottom = `1px solid ${INACTIVE_MARK_BACKGROUND}`;
            mark.style.fontWeight = '600';
            fragment.appendChild(mark);
            elements.push(mark);
          } else if (part) {
            fragment.appendChild(doc.createTextNode(part));
          }
        }

        const parent = node.parentNode;
        if (parent) {
          parent.replaceChild(fragment, node);
        }
      }
      return;
    }

    for (const child of Array.from(node.childNodes)) {
      traverse(child);
    }
  };

  for (const root of listHighlightRoots(pane)) {
    unwrapMarks(root);
    traverse(root);
  }

  if (elements.length > 0) {
    const safeIdx = (activeIdx + elements.length) % elements.length;
    elements.forEach((el, idx) => {
      if (idx === safeIdx) {
        el.style.backgroundColor = ACTIVE_MARK_BACKGROUND;
        el.style.color = '#ffffff';
        el.style.boxShadow = `0 0 0 2px ${ACTIVE_MARK_BACKGROUND}`;
        el.style.borderBottom = 'none';
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        el.style.backgroundColor = INACTIVE_MARK_BACKGROUND;
        el.style.color = 'inherit';
        el.style.boxShadow = 'none';
        el.style.borderBottom = `1px solid ${INACTIVE_MARK_BACKGROUND}`;
      }
    });
  }

  return { count: elements.length };
}
