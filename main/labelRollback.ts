// What each label action must put back if it fails, and who is responsible
// for a label when several actions of one thread overlap.
//
// An action's optimistic write reports the labels it really changed
// (`ThreadsRepo.updateLabels`); the opposite of that is its rollback plan. It
// is kept here, in memory, while the action can still fail: until Gmail
// accepts it, including while it is parked for the reconciler. Once Gmail
// accepted it the plan is emptied but the entry stays (`accept`) until the
// journal holds the final state (`forget`): in between, the journal still
// says `running`, and the entry is what shows that the action's labels landed.
//
// When an action is rolled back, a label that a newer, not failed action of
// the same thread also sets or clears, and has already written, is left alone: that action decides the
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

interface TrackedAction extends LabelRollbackPlan {
  /**
   * Gmail accepted the action: nothing is put back any more. The entry stays
   * until the journal says so too, because until then the journal still shows
   * the action as `running` and nothing else tells that its labels landed.
   */
  accepted?: boolean;
}

export interface RolledBackAction {
  id?: string | null;
  accountId: string;
  threadId: string;
}

/** Above this many plans, the ones whose action is settled are swept out. */
const DEFAULT_PLAN_SWEEP_THRESHOLD = 1000;
const PLAN_SWEEP_STEP = 100;
const plans = new Map<string, TrackedAction>();
let sweepThreshold = DEFAULT_PLAN_SWEEP_THRESHOLD;
let nextSweepAt = DEFAULT_PLAN_SWEEP_THRESHOLD;

/**
 * Drops the plans of actions that can no longer fail (the journal says
 * completed or failed, or has no entry). Every caller forgets its plan when
 * its action settles; this only catches what slipped through. A plan of an
 * action that can still fail is never dropped, however many there are: without
 * it a rejected action would restore the labels of its kind instead of what
 * it changed, and a handed-over label would be lost.
 */
function sweepSettledPlans(): void {
  for (const actionId of Array.from(plans.keys())) {
    const status = ActionLogRepo.get(actionId)?.status;
    if (!status || status === 'completed' || status === 'failed') plans.delete(actionId);
  }
  nextSweepAt = Math.max(sweepThreshold, plans.size + PLAN_SWEEP_STEP);
}

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
    if (plans.size > nextSweepAt) sweepSettledPlans();
  },

  /**
   * Gmail accepted the action: it will not be rolled back, but it keeps the
   * labels it took over. Call `forget` once its `completed` state is stored.
   */
  accept(actionId: string | null | undefined): void {
    if (!actionId) return;
    // Also for an action without a plan (replayed after a restart): the marker
    // is what counts, until its `completed` state is stored.
    plans.delete(actionId);
    plans.set(actionId, { add: [], remove: [], accepted: true });
    if (plans.size > nextSweepAt) sweepSettledPlans();
  },

  /**
   * The journal holds the action's final state (completed, failed, cancelled):
   * nothing here is needed any more. Before that, use `accept`.
   */
  forget(actionId: string | null | undefined): void {
    if (actionId) plans.delete(actionId);
  },

  /**
   * Rolls back the label change of `action`. Call it inside the rollback
   * write, together with the write that marks the action failed. `fallback`
   * is used when no plan is known (no action id, or a restart since).
   */
  rollback(action: RolledBackAction, fallback: LabelRollbackPlan): LabelChange {
    const tracked = action.id ? plans.get(action.id) : null;
    if (action.id) plans.delete(action.id);
    // Accepted by Gmail: there is nothing to put back.
    if (tracked?.accepted) return { added: [], removed: [] };
    const plan = tracked || fallback;
    const newer = action.id ? ActionLogRepo.listNewerLabelActions(action.id) : [];
    const touches = (other: { kind: Parameters<typeof labelChangesOfAction>[0]['kind']; payloadJson?: string | null }, label: string) => {
      const changes = labelChangesOfAction(other);
      return [...changes.add, ...changes.remove].some(item => sameLabel(item, label));
    };

    const add: string[] = [];
    const remove: string[] = [];
    // Only an action whose own label write has landed can have taken a label
    // over: it is tracked here (with a plan, or accepted by Gmail and waiting
    // for its `completed` state to be stored), or the journal shows it past
    // that write (parked or completed). One that is journaled but has not written yet
    // (`queued` / `running` without a plan) will write on top of whatever
    // this rollback leaves, and record that as its own change.
    const hasLanded = (other: { id: string; status: string }) => (
      plans.has(other.id) || other.status === 'pending_sync' || other.status === 'completed'
    );
    const decide = (label: string, direction: 'add' | 'remove') => {
      // The oldest of the newer actions is the one that built on this state.
      const owner = newer.find(other => hasLanded(other) && touches(other, label));
      if (!owner) {
        (direction === 'add' ? add : remove).push(label);
        return;
      }
      // It decides the label now. Should it fail as well, it restores what
      // this action found, whatever it changed itself.
      const ownerPlan = plans.get(owner.id);
      if (!ownerPlan || ownerPlan.accepted) return;
      ownerPlan.add = without(ownerPlan.add, label);
      ownerPlan.remove = without(ownerPlan.remove, label);
      ownerPlan[direction].push(label);
    };
    for (const label of plan.add) decide(label, 'add');
    for (const label of plan.remove) decide(label, 'remove');

    if (add.length === 0 && remove.length === 0) return { added: [], removed: [] };
    return ThreadsRepo.rollbackLabels(action.accountId, action.threadId, add, remove);
  },

  /** The plan currently held for an action that can still fail (tests, diagnostics). */
  planFor(actionId: string): LabelRollbackPlan | null {
    const plan = plans.get(actionId);
    return plan && !plan.accepted ? { add: [...plan.add], remove: [...plan.remove] } : null;
  },

  /** Whether the action is known here at all, with a plan or as accepted. */
  isTracked(actionId: string): boolean {
    return plans.has(actionId);
  },

  resetForTests(options: { sweepThreshold?: number } = {}): void {
    plans.clear();
    sweepThreshold = options.sweepThreshold ?? DEFAULT_PLAN_SWEEP_THRESHOLD;
    nextSweepAt = sweepThreshold;
  },
};
