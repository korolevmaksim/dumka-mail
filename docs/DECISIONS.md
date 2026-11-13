# OpenAI Decisions sorting

Settings → AI model → Sorting engine selects either the existing background
text model or OpenAI Decisions. Decisions has an independent model selection
and minimum-confidence setting. The picker loads the OpenAI text-model catalog
with the saved OpenAI key, supports refresh and manual model entry, and never
preselects a model. The catalog includes models for other endpoints: the
Decisions endpoint validates whether the selected model and key are supported.
Unsupported-model errors are recorded in System logs with the HTTP status and
a configuration hint, without the provider response body.

The engine setting does not enable background work. Background sorting and
permission to send mail text must both resolve to true for each account.
Existing installations retain the text-model engine and an empty Decisions
model until the user changes them. Chat, summaries and background reply drafts
retain their existing provider/model configuration.

## Request and safety boundaries

- The main process calls `POST /v1/decisions` using the existing saved OpenAI
  key and configured OpenAI endpoint. No SDK or production dependency is added.
- Each request contains at most 12 refinable threads from one account, using
  the same bounded, sanitized excerpts as the existing sorting path. Mail is
  untrusted data. No tools or mailbox mutations are exposed to the endpoint.
- Each thread has a named choice question with only the transitions allowed
  by its local rule decision. Invitations, security notices and other
  non-refinable decisions never enter this work list. Manual corrections win.
- Named answers must be complete, unique, recognized and correctly typed.
  Refusals or confidence below the configured threshold preserve the local
  category. The threshold is an initial application policy, not a calibrated
  accuracy guarantee; tune it against reviewed examples.
- Decisions does not generate a written explanation or infer a deadline.
  Rows show the suggested category and model confidence. Later uses the
  application's normal Later time.
- Requests time out after 30 seconds and remain cancellable through response
  body reading. Turning off sorting, withdrawing mail access, or changing
  configuration cancels background work; stale answers are not applied.
- Cached Decisions records are scoped to the last message, engine, selected
  model and confidence threshold. Uncertain/refused results are also cached
  under the unchanged local rule category to avoid repeated calls on restart.
  Switching back to the text engine ignores Decisions records.

OpenRouter and Gemini sorting transports are not part of this change. They
remain available through the pre-existing background text-model engine.

References: [Decisions guide](https://developers.openai.com/api/docs/guides/decisions)
and [API reference](https://developers.openai.com/api/reference/resources/decisions/methods/create).

## Verification

`tests/openAIDecisions.test.ts` covers the request/response contract, confidence,
refusals, invalid responses, selected-model propagation, transport errors,
cancellation, timeout and cache identity. `tests/agentPrepService.test.ts`
covers routing, permissions, manual corrections, caching and mid-request
configuration changes. Settings migration and the source-wide no-built-in-model
regression checks run in the full test suite.


## Reply intent and unsolicited outreach

Reply is reserved for a legitimate expected personal response. A question mark,
IMPORTANT label, direct greeting, human signature or repeated `Re:` follow-up
is not sufficient. Unsolicited sales, PR, SEO and similar offers, including
requests to book a call or reply no, are classified as Read when useful rather
than creating a reply obligation. Relevant new customer/support enquiries may
still need a reply; no prior reply alone is not evidence of unsolicited mail.

Both text-model and Decisions prompts use `shared/replyIntent.ts`. The bounded
input also includes whether actual non-draft outgoing messages exist in this
thread, recognizing SENT aliases. This adds a boolean, not extra message bodies.
A conservative local veto changes a model's Reply to Read only for explicit
commercial offers with solicitation cues and known unengaged thread history.
It does not fire for internal senders or an existing exchange. Broader ambiguous
cases remain model judgments and can still require a manual correction.

These Read threads remain protected under the existing person rules. This does
not archive, unsubscribe or send anything, and a manual user classification wins.
Both engines use a versioned reply-intent cache identity: older model decisions
are ignored immediately by inbox sections and background draft selection, then
re-evaluated within the normal bounded background work budget. User corrections
are retained. The confidence threshold and selected models are unchanged.

Regression tests cover repeated PR outreach without replies, commercial offers,
legitimate new enquiries, ongoing conversations and SENT aliases, old cached
Reply decisions, both transports, and prevention of background drafts for a
rejected reply suggestion. Fixtures are synthetic.
