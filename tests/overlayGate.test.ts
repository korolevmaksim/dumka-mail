// Keys that move the mailbox (`[` / `]`) are ignored while something is open
// over it. `overlayOpen()` in `useKeyboard.ts` recognises two kinds of surface:
// an Escape layer (menus, popovers) and a modal dialog in the document. A
// full-screen backdrop that is neither would let the list move behind it, so
// every backdrop in the renderer must declare itself as one of the two.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../renderer/src');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/** A dimmed layer over the whole window or workspace. */
const BACKDROP = /className="[^"]*\binset-0\b[^"]*\bbg-black\/\d+[^"]*"|className="[^"]*\bbg-black\/\d+[^"]*\binset-0\b[^"]*"/;

describe('overlays over the mailbox', () => {
  const backdrops = sourceFiles(ROOT).filter(file => BACKDROP.test(fs.readFileSync(file, 'utf8')));

  it('finds the known backdrops (the scan itself works)', () => {
    const names = backdrops.map(file => path.basename(file));
    expect(names).toEqual(expect.arrayContaining(['CommandPalette.tsx', 'ShortcutGuideOverlay.tsx', 'MessageCard.tsx', 'MoveToSectionPopover.tsx']));
  });

  it('declares every backdrop as a modal dialog or an Escape layer', () => {
    const unmarked = backdrops.filter(file => {
      const source = fs.readFileSync(file, 'utf8');
      return !(source.includes('role="dialog"') && source.includes('aria-modal="true"')) && !source.includes('useEscapeLayer(');
    });
    expect(unmarked.map(file => path.relative(ROOT, file))).toEqual([]);
  });

  it('keeps the gate checking both kinds', () => {
    const keyboard = fs.readFileSync(path.join(ROOT, 'hooks/useKeyboard.ts'), 'utf8');
    expect(keyboard).toContain('escapeLayerCount() > 0');
    expect(keyboard).toContain(`[role="dialog"][aria-modal="true"]`);
  });
});
