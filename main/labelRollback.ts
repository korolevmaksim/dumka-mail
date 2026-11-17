// What each label action must put back if it fails, and who is responsible
// for a label when several actions of one thread overlap.
//
// An action's optimistic write reports the labels it really changed
// (`ThreadsRepo.updateLabels`); the opposite of that is its rollback plan. It
// is kept here, in memory, while the action can still fail: until Gmail
// accepts it, including while it is parked for the reconciler.
//
// When an action is rolled back, a label that a newer, not failed action of
// the same thread also sets or clears is left alone: that action decides the
// label now, and putting the older state back would undo it. The
// responsibility moves with it: the newer action's plan takes over what the
// failed one would have restored, so if it fails too the label goes back to
// what it was before both. Without that, two overlapping archives that are
// both rejected would leave the thread archived.
//
// After a restart there are no plans; an action replayed by the reconciler
// falls back to the labels of its kind.

import { labelChangesOfAction } from '../shared/mailActions';
import { ActionLogRepo, ThreadsRepo, type LabelChange } from './database';

/** Labels to add back and to remove again. */
export interface LabelRollbackPlan {
  add: string[];
  remove: string[];
}

export interface RolledBackAction {
  id?: string | null;
  accountId: string;
  threadId: string;
}

const MAX_TRACKED_PLANS = 1000;
const plans = new Map<string, LabelRollbackPlan>();

function sameLabel(left: string, right: string): boolean {
  return left.toUpperCase() === right.toUpperCase();
}

function without(labels: string[], label: string): string[] {
  return labels.filter(other => !sameLabel(other, label));
}

export const LabelRollbacks = {
  /** After the optimistic label write of `actionId` landed: remember what it really changed. */
  track(actionId: string | null | undefined, change: LabelChange): void {
    if (!actionId) return;
    plans.delete(actionId);
    plans.set(actionId, { add: [...change.removed], remove: [...change.added] });
    // Plans of actions that were never settled here (parked ones the
    // reconciler completed) are dropped oldest first.
    while (plans.size > MAX_TRACKED_PLANS) {
      const oldest = plans.keys().next().value;
      if (oldest === undefined) break;
      plans.delete(oldest);
    }
  },

  /** Gmail accepted the action: it will not be rolled back. */
  forget(actionId: string | null | undefined): void {
    if (actionId) plans.delete(actionId);
  },

  /**
   * Rolls back the label change of `action`. Call it inside the rollback
   * write, together with the write that marks the action failed. `fallback`
   * is used when no plan is known (no action id, or a restart since).
   */
  rollback(action: RolledBackAction, fallback: LabelRollbackPlan): LabelChange {
    const plan = (action.id ? plans.get(action.id) : null) || fallback;
    if (action.id) plans.delete(action.id);
    const newer = action.id ? ActionLogRepo.listNewerLabelActions(action.id) : [];
    const touches = (other: { kind: Parameters<typeof labelChangesOfAction>[0]['kind']; payloadJson?: string | null }, label: string) => {
      const changes = labelChangesOfAction(other);
      return [...changes.add, ...changes.remove].some(item => sameLabel(item, label));
    };

    const add: string[] = [];
    const remove: string[] = [];
    const decide = (label: string, direction: 'add' | 'remove') => {
      // The oldest of the newer actions is the one that built on this state.
      const owner = newer.find(other => touches(other, label));
      if (!owner) {
        (direction === 'add' ? add : remove).push(label);
        return;
      }
      // It decides the label now. Should it fail as well, it restores what
      // this action found, whatever it changed itself.
      const ownerPlan = plans.get(owner.id);
      if (!ownerPlan) return;
      ownerPlan.add = without(ownerPlan.add, label);
      ownerPlan.remove = without(ownerPlan.remove, label);
      ownerPlan[direction].push(label);
    };
    for (const label of plan.add) decide(label, 'add');
    for (const label of plan.remove) decide(label, 'remove');

    if (add.length === 0 && remove.length === 0) return { added: [], removed: [] };
    return ThreadsRepo.rollbackLabels(action.accountId, action.threadId, add, remove);
  },

  /** The plan currently held for an action (tests, diagnostics). */
  planFor(actionId: string): LabelRollbackPlan | null {
    const plan = plans.get(actionId);
    return plan ? { add: [...plan.add], remove: [...plan.remove] } : null;
  },

  resetForTests(): void {
    plans.clear();
  },
};
