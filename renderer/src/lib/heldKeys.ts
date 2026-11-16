// A key press that chose something in a popover belongs to that popover
// until the key is released. Without this, the popover closes on the first
// keydown, focus returns to the mailbox, and the auto-repeat of the same
// held key lands on the mail shortcuts behind it: `⇧1` repeats as `!`
// (move to spam), `↩` opens the focused conversation.
//
// `ownKeyUntilRelease(code)` marks the physical key; every repeated keydown
// of it is swallowed in the capture phase, before any other handler, until
// its keyup. A fresh (non-repeat) keydown means the key was released without
// a keyup reaching this window, so ownership ends there too.
const owned = new Set<string>();
let installed = false;

export interface HeldKeyEvent {
  code: string;
  repeat?: boolean;
}

/** True when this keydown is the auto-repeat of an owned key and must not act. */
export function isOwnedKeyRepeat(event: HeldKeyEvent): boolean {
  if (!event.code || !owned.has(event.code)) return false;
  if (!event.repeat) {
    owned.delete(event.code);
    return false;
  }
  return true;
}

export function releaseOwnedKey(code: string): void {
  owned.delete(code);
}

export function releaseAllOwnedKeys(): void {
  owned.clear();
}

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('keydown', event => {
    if (!isOwnedKeyRepeat(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  window.addEventListener('keyup', event => releaseOwnedKey(event.code), true);
  // The keyup goes elsewhere when the window loses focus mid-press.
  window.addEventListener('blur', releaseAllOwnedKeys);
}

/** The physical key (`KeyboardEvent.code`) stays with its popover until it is released. */
export function ownKeyUntilRelease(code: string | null | undefined): void {
  if (!code) return;
  install();
  owned.add(code);
}
