const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

export function isTextEditingElement(element: Element | null): boolean {
  if (!element) return false;

  const htmlElement = element as HTMLElement;
  if (htmlElement.isContentEditable) return true;

  const tagName = element.tagName.toUpperCase();
  if (tagName === 'TEXTAREA') return true;
  if (tagName !== 'INPUT') return false;

  const inputType = element.getAttribute('type')?.toLowerCase() || 'text';
  return !NON_TEXT_INPUT_TYPES.has(inputType);
}
