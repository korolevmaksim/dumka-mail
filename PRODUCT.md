# Product

## Register

product

## Users

People managing one or more Gmail accounts who want a fast, keyboard-friendly desktop workflow with local ownership of mail data. They use Dumka Mail to identify what needs attention, understand why an action is suggested, and safely process mail without surrendering control to opaque automation.

## Product Purpose

Dumka Mail is a local-first mail and schedule operator. It turns cached Gmail and Google Calendar data into explainable briefings, search results, reply obligations, calendar plans, cleanup suggestions, and reviewable actions. Success means the user can make faster decisions while always understanding the evidence, what remains local, and which external action will occur before approving it.

## Calendar Workspace

Calendar is a first-class workspace inside the same desktop application, not a separate service. It reads every selected Google calendar directly into the local SQLite cache and supports routine scheduling across Month, Week, Day, Agenda, Quarter, and Year. Event edits use Google access roles and attendee-notification choices; cached views, search, mail-derived tasks, and queued changes remain useful offline. Calendar sets, templates, reminders, `.ics` workflows, source-mail links, Today handoff, and unified account scope use the existing local state rather than introducing a second backend or sync engine.

Ask Dumka can search the bounded local calendar cache and calculate free slots through read-only tools. It has no calendar mutation tool: creating or changing an event remains a visible user-reviewed action in Calendar, while email follow-ups remain drafts until the user sends them.

## Brand Personality

Calm, trustworthy, and precise. The interface should feel native to a focused desktop productivity tool: compact enough for daily work, explicit about risk and state, and confident without becoming decorative or theatrical.

## Anti-references

- Hosted AI inboxes that obscure where mail data is processed or imply autonomous control.
- Marketing-dashboard visuals that prioritize decorative metrics over the next useful action.
- Modal-heavy workflows that repeatedly remove the user from their mailbox context.
- Destructive or external actions presented without evidence, scope, approval, and recovery guidance.

## Design Principles

1. Preserve user agency: proposals are reviewable and externally consequential actions require explicit approval.
2. Show the evidence: recommendations explain the sender, source mail, risk, and intended result.
3. Keep context intact: exploration and decisions return users to the same workflow state.
4. Local-first by default: clearly distinguish local computation from provider or Gmail network activity.
5. Earn density: compact surfaces should remain readable, keyboard-accessible, and consistent with the existing mail workflow.

## Accessibility & Inclusion

Target WCAG 2.1 AA contrast for text and controls. Preserve keyboard navigation, visible focus, semantic control labels, screen-reader-friendly state, reduced-motion behavior, and non-color-only communication for risk and status.
