// Lets the keyboard handler (`[` / `]`), the command palette and the
// "Prepared for you" pane move the mailbox list to a section without lifting
// its scroll state into the store. The list registers itself while it shows
// sections; a call returns false when there is nothing to jump to.
import type { Decision } from '../../../shared/types';

export interface SectionJumpHandle {
  /** Brings the section's header to the top of the list. */
  jumpTo: (decision: Decision) => boolean;
  /** `]` (1) / `[` (-1). */
  jumpBy: (delta: 1 | -1) => boolean;
}

let current: SectionJumpHandle | null = null;

export function registerSectionJump(handle: SectionJumpHandle): () => void {
  current = handle;
  return () => {
    if (current === handle) current = null;
  };
}

export function activeSectionJump(): SectionJumpHandle | null {
  return current;
}
