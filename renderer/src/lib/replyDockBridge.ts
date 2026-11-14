// Lets the global keyboard handler (`R`, `⇧R`, `⌘↩`, `⌘⇧↩`) reach the reply dock of
// the open thread without lifting its state into the store. The dock registers
// itself while mounted; a handler returns true when it handled the key.
import type { SendIntent } from '../../../shared/sendFlow';

export interface ReplyDockHandle {
  /** `R`: focus the open editor, or open the prepared / saved draft for editing. */
  reply: () => boolean;
  /** `⌘↩` / `⌘⇧↩`: send the dock's draft (including a prepared one shown but not yet edited). */
  send: (intent: SendIntent) => boolean;
  /** `⇧R`: ask the model for a reply draft. The draft is shown, never sent. */
  draft: () => boolean;
}

let current: ReplyDockHandle | null = null;

export function registerReplyDock(handle: ReplyDockHandle): () => void {
  current = handle;
  return () => {
    if (current === handle) current = null;
  };
}

export function activeReplyDock(): ReplyDockHandle | null {
  return current;
}
