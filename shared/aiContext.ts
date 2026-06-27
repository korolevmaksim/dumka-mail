// Pure, dependency-free AI context builder ported from the Swift original
// (`Services/AI/AIPrivacyFilter.swift` + `Services/Security/SecretRedactor.swift`).
//
// This module assembles the structured "selected mail or draft context" that is
// handed to the AI providers, while keeping bodies optional (privacy) and
// scrubbing secrets out of any text that leaves the device. It must stay free of
// Electron / Node / React / DOM imports so it can run in both the main and
// renderer processes (and be unit-tested directly).

import type { MailMessage, MailThread, AISettings } from './types'

// ---------------------------------------------------------------------------
// HTML -> text
// ---------------------------------------------------------------------------

/**
 * Decode the small set of HTML entities the Swift original handled
 * (`&nbsp; &amp; &lt; &gt;`), plus a few more common named entities and
 * numeric / hex character references. Replacements run sequentially to mirror
 * the Swift `replacingOccurrences` ordering.
 */
function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => codePoint(parseInt(dec, 10)))
}

function codePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return ''
  try {
    return String.fromCodePoint(value)
  } catch {
    return ''
  }
}

/**
 * Strip HTML to readable plain text without a DOM. Mirrors the Swift
 * `textFromHTML`: remove tags, decode entities, collapse whitespace. Script and
 * style blocks are dropped wholesale so their contents never leak into the
 * "readable" text.
 */
export function htmlToText(html: string): string {
  if (!html) return ''
  return decodeEntities(
    html
      // drop <script>…</script> and <style>…</style> including their content
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      // strip every remaining tag (Swift: "<[^>]+>" -> " ")
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Secret redaction
// ---------------------------------------------------------------------------

// Ported from Swift `SecretRedactor.redact`, extended with a couple of broader
// patterns (standalone bearer tokens, long hex / base64 blobs) as the porting
// plan calls out ("redact bearer tokens, api keys, long hex/base64 secrets").
// Each pattern is matched case-insensitively and globally.
const REDACTION_PATTERNS: RegExp[] = [
  // email addresses
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
  // Google OAuth access tokens
  /ya29\.[A-Z0-9._-]+/gi,
  // OpenAI / Anthropic style secret keys
  /sk-[A-Z0-9._-]+/gi,
  // Google API keys
  /AIza[A-Z0-9_-]{20,}/gi,
  // Anthropic message ids
  /msg_[A-Z0-9._-]+/gi,
  // api key assignments
  /api[_-]?key\s*[:=]?\s*[A-Z0-9._/-]+/gi,
  /x-api-key\s*[:=]?\s*[A-Z0-9._/-]+/gi,
  // authorization header with bearer
  /authorization\s*[:=]\s*Bearer\s+[A-Z0-9._/-]+/gi,
  // standalone bearer tokens
  /Bearer\s+[A-Z0-9._/+-]+/gi,
  // OAuth token fields
  /refresh_token\s*[:=]?\s*[A-Z0-9._/-]+/gi,
  /access_token\s*[:=]?\s*[A-Z0-9._/-]+/gi,
  /client_secret\s*[:=]?\s*[A-Z0-9._/-]+/gi,
  // long hex secrets (>=32 hex chars)
  /\b[0-9a-fA-F]{32,}\b/g,
  // long base64 secrets (>=40 chars)
  /\b[A-Za-z0-9+/]{40,}={0,2}/g,
]

const REDACTED = '[REDACTED]'

/**
 * Replace anything that looks like a credential (tokens, api keys, emails,
 * long hex / base64 blobs) with `[REDACTED]`. Safe to call on free-form text
 * before it leaves the device or is shown in an error surface.
 */
export function redactSecrets(s: string): string {
  if (!s) return s
  let output = s
  for (const pattern of REDACTION_PATTERNS) {
    output = output.replace(pattern, REDACTED)
  }
  return output
}

// ---------------------------------------------------------------------------
// Thread context
// ---------------------------------------------------------------------------

/**
 * Resolve the most readable text for a single message, mirroring the Swift
 * `messageText`: prefer trimmed plain text, fall back to HTML→text, then the
 * snippet.
 */
function messageText(message: MailMessage): string {
  const plain = (message.bodyPlain ?? '').trim()
  if (plain) return plain
  const html = (message.bodyHtml ?? '').trim()
  if (html) return htmlToText(html)
  return message.snippet ?? ''
}

/**
 * Build the structured AI context block for a thread and its messages.
 *
 * Ported from Swift `AIPrivacyFilter.threadContext`. Differences from the Swift
 * original, per the porting plan:
 *  - messages are passed explicitly (the TS `MailThread` does not embed them);
 *  - message bodies are included only when `ai.allowMailBodyContext` is true
 *    (the Swift filter always included bodies);
 *  - body text is run through `redactSecrets` before it is emitted.
 */
export function buildThreadContext(
  thread: MailThread | null,
  messages: MailMessage[],
  ai: AISettings,
): string {
  const includeBodies = ai?.allowMailBodyContext === true
  const lines: string[] = []

  if (thread) {
    lines.push(`Subject: ${thread.subject}`)
    lines.push(`Snippet: ${thread.snippet}`)
    lines.push(`Senders: ${thread.senderNames.join(', ')}`)
    lines.push(`Has attachments: ${thread.hasAttachments ? 'yes' : 'no'}`)
  }

  if (messages.length > 0) {
    lines.push('Messages:')
    messages.forEach((message, index) => {
      lines.push(`Message ${index + 1} from ${message.senderName}:`)
      lines.push(`Subject: ${message.subject}`)
      if (includeBodies) {
        lines.push('Body:')
        lines.push(redactSecrets(messageText(message)))
      }
      lines.push(`Has attachments: ${message.hasAttachments ? 'yes' : 'no'}`)
    })
  }

  return lines.join('\n')
}
