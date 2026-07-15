import { describe, expect, it } from 'vitest';
import { isTextEditingElement } from '../renderer/src/lib/undoRouting';

function element(tagName: string, options: { contentEditable?: boolean; type?: string } = {}): Element {
  return {
    tagName,
    isContentEditable: options.contentEditable || false,
    getAttribute: (name: string) => name === 'type' ? options.type || null : null,
  } as unknown as Element;
}

describe('undo routing', () => {
  it('routes rich compose editors and text controls to native text undo', () => {
    expect(isTextEditingElement(element('DIV', { contentEditable: true }))).toBe(true);
    expect(isTextEditingElement(element('TEXTAREA'))).toBe(true);
    expect(isTextEditingElement(element('INPUT'))).toBe(true);
    expect(isTextEditingElement(element('INPUT', { type: 'email' }))).toBe(true);
  });

  it('keeps mail-action undo for non-editable focus targets', () => {
    expect(isTextEditingElement(null)).toBe(false);
    expect(isTextEditingElement(element('BUTTON'))).toBe(false);
    expect(isTextEditingElement(element('INPUT', { type: 'checkbox' }))).toBe(false);
  });
});
