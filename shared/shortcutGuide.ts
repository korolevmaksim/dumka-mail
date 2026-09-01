import { appKeymapBindings, type KeymapGroup } from './appKeymap';
import type { ShortcutSettings } from './types';

export interface GuideItem {
  keys: string;
  label: string;
}

export interface ShortcutGuideSection {
  title: string;
  items: GuideItem[];
}

const GROUP_ORDER: KeymapGroup[] = ['Universal', 'Mail List', 'Compose', 'Navigation'];

export function shortcutGuideSections(s: ShortcutSettings): ShortcutGuideSection[] {
  const bindings = appKeymapBindings(s);
  return GROUP_ORDER
    .map(title => ({
      title,
      items: bindings
        .filter(binding => binding.group === title)
        .map(binding => ({ label: binding.label, keys: binding.keys })),
    }))
    .filter(section => section.items.length > 0);
}
