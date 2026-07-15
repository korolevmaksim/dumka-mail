# Split Rule Email Autocomplete and Editing Implementation Plan

**Goal:** Make split classification rules easy to create and maintain for specific people while preserving free-text, domain, and partial-match routing.

## Research decisions

- Use an editable combobox rather than a closed contact picker. The WAI-ARIA Authoring Practices combobox pattern explicitly supports arbitrary text with suggested values and describes `ArrowDown`, `ArrowUp`, `Enter`, and `Escape` behavior for a list autocomplete popup: <https://www.w3.org/WAI/ARIA/apg/patterns/combobox/>.
- Keep DOM focus on the input while exposing the highlighted option with `aria-activedescendant`, and connect the input to the popup with `aria-controls`, as required by WAI-ARIA 1.2: <https://www.w3.org/TR/wai-aria/#combobox>.
- Treat multiple values inside one rule as OR. Gmail documents `OR` and brace groups such as `{from:amy from:david}` as matching one or more criteria: <https://support.google.com/mail/answer/7190>.
- Reuse Dumka Mail's local `EmailSuggestionsRepo`, which already combines Google Contacts with cached From/To/Cc/Bcc history. Do not add a network request, dependency, or second contact index.
- Keep the editor inline. The settings surface is already dense and contextual; editing in place preserves the selected account scope and avoids a modal-only workflow.

## 1. Persisted rule model and compatibility

- Add optional `values: string[]` to `MailCategoryRule` and `CustomClassifierRule` while retaining the legacy `value` field.
- Add shared normalization that trims values, removes case-insensitive duplicates, and falls back to `value` when `values` is missing.
- For legacy From/To/Cc rules only, split comma-, semicolon-, or newline-separated `value` strings so existing rules created as `a@example.com, b@example.com` start working without a migration.
- Persist the first normalized value in `value` for old-reader compatibility and the complete set in `values`.

## 2. Matching semantics

- Evaluate multiple values inside one rule with OR semantics.
- Apply negation to the whole set: a negated rule matches only when none of its values match.
- Preserve all existing operators (`contains`, `equals`, `startsWith`, `endsWith`) and all existing single-value behavior.

## 3. Rule editor

- Extract the create form into a controlled `ClassificationRuleEditor` used by both create and edit modes.
- For From/To/Cc fields, render removable value chips plus an editable combobox.
- Allow both autocomplete selection and arbitrary typed values so names, fragments such as `billing@`, and remembered addresses remain valid.
- Keep Sender Domain and Subject as focused single-value text inputs; domain routing such as `github.com` remains explicit and unchanged.
- Explain in helper copy that multiple address values use OR semantics.

## 4. Autocomplete and accessibility

- Load suggestions through the existing `db:listEmailSuggestions` IPC endpoint.
- Scope account-specific rules to that account's suggestions; load all accounts for Global rules.
- Exclude already selected values and group pseudo-addresses from individual-address results.
- Implement labelled combobox/listbox semantics, `aria-expanded`, `aria-controls`, `aria-activedescendant`, selected option state, keyboard navigation, Escape dismissal, and Backspace chip removal.

## 5. Editing and rule list presentation

- Add an Edit action to every configured rule.
- Populate the inline editor with the selected rule and save back to the same rule id.
- Add Cancel and clear edit mode when the scope changes or the edited rule is deleted.
- Render multi-value rules as a concise condition followed by individual chips instead of one quoted comma string.

## 6. Verification

- Add pure tests for normalization, legacy comma-list compatibility, deduplication, and canonical persistence.
- Extend category-engine tests for OR matching, recipient matching, partial text, and whole-set negation.
- Run focused tests, the full Vitest suite, `npm run build`, and `git diff --check`.
- Verify the settings flow in the running app, then commit, push `main`, run `npm run install-app`, and verify the installed application bundle and launched process.
