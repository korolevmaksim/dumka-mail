# Operator Home, Follow-up Radar, and Rules Simulator Implementation Plan

Spec: `docs/superpowers/specs/2026-07-08-operator-home-followups-rules.md`

## Global Constraints

- Preserve existing dirty work; do not revert unrelated edits.
- Do not add production dependencies.
- Keep `shared/` dependency-free.
- IPC changes must touch `main/index.ts`, `main/preload.ts`, and `renderer/src/vite-env.d.ts`.
- Use idempotent migrations only.
- Run focused tests while developing, then `npm test` and `npm run build`.
- Final code review must be performed by subagents until clean before `npm run install-app`.

## Task 1: Shared models and pure helpers

Files:

- Modify `shared/types.ts`
- Create `shared/followUpRadar.ts`
- Create `shared/mailRuleSimulator.ts`
- Create `tests/followUpRadar.test.ts`
- Create `tests/mailRuleSimulator.test.ts`

Acceptance:

- Follow-up detection is deterministic over message timelines.
- Dismissed/snoozed state hides exact outbound-message candidates.
- Inbound-after-sent resolves a follow-up without persisted state.
- Rule simulator reports matched threads, skipped actions, missing labels, already-applied effects, and preview-only send-like actions.

## Task 2: Follow-up persistence and IPC

Files:

- Modify `main/migrations.ts`
- Modify `main/repositories.ts`
- Modify `main/database.ts`
- Modify `main/index.ts`
- Modify `main/preload.ts`
- Modify `renderer/src/vite-env.d.ts`

Acceptance:

- `follow_up_radar_state` table is created idempotently.
- Main process can list follow-up radar items for one account.
- Main process can dismiss/snooze exact `(account, thread, sentMessage)` items.
- Listing is bounded by settings/options and returns warnings about local-cache scope.

## Task 3: Store integration and Operator Home shell

Files:

- Modify `renderer/src/stores/useSettingsState.ts`
- Modify `renderer/src/stores/AppStore.tsx`
- Modify `renderer/src/stores/useAIState.ts`
- Modify `renderer/src/components/layout/LeftRail.tsx`
- Modify `renderer/src/components/layout/CommandPalette.tsx`
- Modify `renderer/src/hooks/useKeyboard.ts`
- Modify `renderer/src/App.tsx`
- Create `renderer/src/components/today/TodayHome.tsx`

Acceptance:

- `workspaceView` switches between `today` and `mail`.
- Today renders as a first-class workspace, not a mailbox/split.
- Existing mail navigation returns to `mail`.
- Daily Briefing can be run from Today without forcing the AI side panel open.

## Task 4: Follow-up Radar UI and reply pipeline

Files:

- Continue `TodayHome.tsx`
- Modify store types/actions as needed

Acceptance:

- Today shows follow-up count and top follow-up items.
- Actions work: open, draft follow-up, remind, snooze, dismiss.
- UI states are explicit for disabled follow-ups, loading, empty, and error.

## Task 5: Rules Simulator UI and candidate flow

Files:

- Create `renderer/src/components/automation/RuleSimulatorPanel.tsx`
- Modify `renderer/src/components/settings/tabs/MailRulesSettingsSection.tsx`
- Continue `TodayHome.tsx`

Acceptance:

- Simulator appears in Operator Home and mail rules settings.
- It previews existing rules against local cached threads.
- It suggests disabled candidate rules from repeated approved actions.
- Creating a candidate rule adds it disabled; user must enable it later.

## Task 6: Documentation and final verification

Files:

- Update `README.md`
- Update `docs/PRIVACY.md` if network/local behavior wording changes.

Commands:

- `npx vitest run tests/followUpRadar.test.ts tests/mailRuleSimulator.test.ts`
- `npm test`
- `npm run build`
- Subagent spec review and code quality review until clean.
- `npm run install-app`

