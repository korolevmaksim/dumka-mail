# Thread summaries

Settings → AI model → Thread summaries controls the summary shown above a
conversation with at least six messages. Existing installations inherit the
main provider and model, use the conversation language and have no extra context.

Choose a separate provider and model from its live model catalog, or keep the
main model. No model identifier is built into the application. Provider keys and
endpoints use the existing AI Configuration storage. These choices do not change
chat, sorting or reply drafts.

Summary language can follow the latest substantive message or be selected
explicitly. Summary instructions and context accepts up to 4,000 characters;
press **Save summary instructions** to apply it. Provider, model and language
changes save immediately. The context is added to system instructions, while
mail remains untrusted data and summaries must stay grounded in the conversation.

Summaries still require account permission to send mail text. Requests include
only the latest 12 messages with bounded excerpts. SQLite and renderer caches
include the summary preferences and effective provider/model, as well as the
last message. Changing preferences cancels in-flight summaries and regenerates
them when the conversation is open. Existing cache rows without a configuration
key are ignored and replaced on demand; the column migration is idempotent.

Verification covers routing, prompt language/context, normalization, cache
invalidation, concurrent cancellation, privacy revocation and repository reads.
