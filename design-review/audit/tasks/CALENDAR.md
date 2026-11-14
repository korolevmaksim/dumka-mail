# Task: bring the calendar to the same standard as mail

Read `design-review/audit/tasks/COMMON.md` first and follow it.

Five independent reviewers scored the calendar 4.4/10, the weakest part of the app. Look at
`design-review/audit/shots/18-calendar-month.png`, `20-calendar-week.png`, `21-calendar-event.png`,
`47-light-calendar.png`, `06-thread-invitation.png`, and compare with the mail screens `03-thread-open.png`,
`29-inbox-model-sections.png`, `22-settings-account.png`: the calendar must look and behave like the same product.

## Files you own

- everything in `renderer/src/calendar/`
- `renderer/src/components/CalendarInviteCard.tsx`
- `renderer/src/lib/calendarAgenda.ts`, `renderer/src/lib/calendarEventFormHelpers.ts`
- new files you create under `renderer/src/calendar/` and new tests under `tests/`
- existing tests of the files above

Read-only for you: `shared/calendar*.ts` (if a pure helper there needs a display change, add a new function in a new
file under `renderer/src/calendar/` instead).

## What to fix (all of it)

1. **Time grid (week and day views): an event's block must show its real duration.** Today every event is a
   one-line chip of the same height, so a 15-minute stand-up and a 4-hour block look the same and busy time looks
   free. Height = duration; a minimum height for short events; title on the first line and the time range on the
   second when there is room; overlapping events sit side by side in columns. Put the geometry in a pure, unit-tested
   function (start/end/overlap → top, height, column, columns).
2. **Month view.** Multi-day and all-day bars carry their title on every week segment they span (today the
   continuation segments are blank). Weekday headers line up with the day columns and all columns have equal width.
   When a day has more events than fit, show `+N more`, which opens that day.
3. **Colour.** Events take the colour of their calendar (`backgroundColor` from Google when present), otherwise a
   stable colour per account, so work and personal are told apart at a glance. Text on an event must pass AA.
   Do not rely on colour alone: keep the calendar/account name available in the event details.
4. **Event panel: reading first, editing on request.** Today opening an event shows details, RSVP and a long
   `Edit event` form at once, with three date formats, an unlabeled `45` field and the Save/Delete buttons cut off.
   Make it: a compact read view (title as the heading, when via `formatEventWhen` plus the time zone when it differs
   from the local one, where, participants with their response, the RSVP buttons `Yes` / `Maybe` / `No` with text
   labels, related mail, and `Edit`, `Duplicate`, `Delete`). `Edit` switches to the form. The form has labelled fields
   (`Duration` with its unit), and a footer with `Save` and `Cancel` that is always visible. Nothing is clipped at
   1440×900 or at 1000×700. The panel must not push the last day column out of view.
5. **One date and time vocabulary** (see COMMON.md) across the header, sidebar (`Up next`), grid, month, event panel
   and the invitation card. No `12/11/2026, 14:00:00`, no `12.11.2026`, no 12-hour times.
6. **Invitation card in mail (`CalendarInviteCard.tsx`).** Replace the four look-alike icon buttons with labelled
   buttons: `Yes`, `Maybe`, `No` (show the `Y` and `N` key hints on Yes and No; those shortcuts already exist in the
   app and are handled elsewhere — do not add key handlers), and a separate labelled `Add to calendar` /
   `Open in calendar` action. Show the time through the shared formatter. Keep every existing behaviour and prop.
7. **Same visual language as mail.** Header height, title size, segmented view switcher, buttons, inputs, selects,
   focus rings, key hints and spacing should match mail and the account settings page (COMMON.md lists the reference
   components). `New event` is the one filled button. Remove decorative differences that make the calendar look like
   a different app. Light and dark themes both must work (use tokens only, no hex colours except event colours
   coming from the calendar data).
8. **Sidebar.** `Up next` uses the shared formatter and shows the calendar colour dot; long titles truncate with a
   `title` attribute. The mini-month marks today and the selected day distinctly.

Keep all current capabilities working (creating, editing, RSVP, switching views and accounts, search, export).
Add unit tests for the new pure logic. Do not start the app; say clearly in your report that the result was not
looked at on screen.
