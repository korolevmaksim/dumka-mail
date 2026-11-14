// Minimal Chrome DevTools Protocol client (no dependencies, Node 22+ WebSocket).
import fs from 'node:fs';
import path from 'node:path';

export async function connect(port = 9333, { timeoutMs = 30000 } = {}) {
  const started = Date.now();
  let target;
  while (Date.now() - started < timeoutMs) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      target = list.find(t => t.type === 'page' && !t.url.startsWith('devtools://'));
      if (target) break;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  if (!target) throw new Error('No page target found');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message} ${message.error.data || ''}`));
      else resolve(message.result);
    } else if (message.method) {
      listeners.forEach(listener => listener(message));
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');

  const page = {
    send,
    on: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    close: () => ws.close(),
    async eval(expression, { awaitPromise = true } = {}) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
      if (result.exceptionDetails) {
        throw new Error(`eval failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
      }
      return result.result.value;
    },
    async shot(file, { clip } = {}) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const result = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
      return file;
    },
    async key(key, { meta = false, shift = false, ctrl = false, alt = false, code, text } = {}) {
      const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
      const named = {
        Enter: [13, 'Enter', '\r'], Escape: [27, 'Escape'], Tab: [9, 'Tab'], Backspace: [8, 'Backspace'],
        ArrowDown: [40, 'ArrowDown'], ArrowUp: [38, 'ArrowUp'], ArrowLeft: [37, 'ArrowLeft'], ArrowRight: [39, 'ArrowRight'],
        ' ': [32, 'Space', ' '], Delete: [46, 'Delete'],
      };
      let vk; let resolvedCode = code; let resolvedText = text;
      if (named[key]) { [vk, resolvedCode, resolvedText] = [named[key][0], code || named[key][1], text ?? named[key][2]]; }
      else if (key.length === 1) {
        const upper = key.toUpperCase();
        vk = upper.charCodeAt(0);
        if (/[a-z]/i.test(key)) resolvedCode = code || `Key${upper}`;
        else if (/[0-9]/.test(key)) resolvedCode = code || `Digit${key}`;
        else if (key === '/') { vk = 191; resolvedCode = code || 'Slash'; }
        else if (key === '?') { vk = 191; resolvedCode = code || 'Slash'; }
        else if (key === '#') { vk = 51; resolvedCode = code || 'Digit3'; }
        else if (key === '[') { vk = 219; resolvedCode = code || 'BracketLeft'; }
        else if (key === ']') { vk = 221; resolvedCode = code || 'BracketRight'; }
        else if (key === ',') { vk = 188; resolvedCode = code || 'Comma'; }
        else if (key === '.') { vk = 190; resolvedCode = code || 'Period'; }
        if (resolvedText === undefined && !meta && !ctrl) resolvedText = key;
      }
      const base = { modifiers, key, code: resolvedCode, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await send('Input.dispatchKeyEvent', { type: resolvedText ? 'keyDown' : 'rawKeyDown', ...base, ...(resolvedText ? { text: resolvedText } : {}) });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async type(text) { await send('Input.insertText', { text }); },
    async clickAt(x, y) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },
    /** Clicks the first visible element matching a CSS selector and/or exact-ish text. */
    async click({ selector = 'button,a,[role="button"],[role="tab"],[role="menuitem"],[role="option"]', text, exact = false, nth = 0 } = {}) {
      const point = await page.eval(`(() => {
        const wanted = ${JSON.stringify(text ?? null)};
        const exact = ${JSON.stringify(exact)};
        const items = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).filter(el => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          if (wanted === null) return true;
          const label = ((el.innerText || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '')).trim();
          return exact ? (el.innerText || '').trim() === wanted || el.getAttribute('aria-label') === wanted : label.toLowerCase().includes(wanted.toLowerCase());
        });
        const el = items[${nth}];
        if (!el) return null;
        el.scrollIntoView({ block: 'nearest' });
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })()`);
      if (!point) throw new Error(`click target not found: ${selector} ${text ?? ''}`);
      await page.clickAt(point.x, point.y);
      return point;
    },
    async waitFor(expression, { timeoutMs = 15000, intervalMs = 50 } = {}) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const value = await page.eval(expression).catch(() => null);
        if (value) return value;
        await sleep(intervalMs);
      }
      throw new Error(`waitFor timed out: ${expression.slice(0, 120)}`);
    },
    async text(selector = 'body') {
      return page.eval(`(document.querySelector(${JSON.stringify(selector)})?.innerText || '')`);
    },
  };
  return page;
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function control(pathname, body = {}, port = 9334) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method: 'POST', body: JSON.stringify(body) });
  return response.json();
}
