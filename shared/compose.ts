// Compose / draft-prefill + validation logic, ported from the Swift
// "Personal Mail Client" (Models/Draft.swift, Support/MIMEBuilder.swift,
// Support/EmailAddressFormatting.swift).
//
// This module is part of the dependency-free `shared/` layer: it runs in both
// the Electron main process and the React renderer, so it must stay pure
// (standard JS/TS + Intl + relative `shared/` imports only).

import type { EmailAddressSuggestion, MailMessage, Recipient } from './types'
import { escapeHtml, plainTextToHtmlFragment, sanitizeDraftHtmlFragment } from './draftHtml'

/** A pre-filled draft skeleton produced by reply/forward actions. */
export interface DraftSeed {
  to: Recipient[]
  cc: Recipient[]
  subject: string
  body: string
  bodyHtml?: string | null
  /** RFC `In-Reply-To` message id (from the message's `rfcMessageId`). */
  replyMessageId?: string | null
  /** RFC `References` header value (existing refs + the message id). */
  replyReferences?: string | null
}

/** Result of validating a draft prior to send. */
export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface EmailSuggestionFilterOptions {
  existingRecipients?: Recipient[]
  excludedEmails?: string[]
  limit?: number
}

/** Maximum total attachment size, mirroring `DraftValidator.maxTotalAttachmentBytes`. */
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024

// User-facing validation strings, copied verbatim from
// `DraftValidationError.userMessage` in Draft.swift.
const MSG_MISSING_RECIPIENT = 'Add at least one recipient'
const MSG_MISSING_SUBJECT = 'Add a subject'
const MSG_EMPTY_BODY = 'Write a message or attach a file'
const MSG_UNSAFE_HEADER = 'Remove line breaks from recipients or subject'
const MSG_ATTACHMENTS_TOO_LARGE = 'Attachments are over 25 MB'
const invalidRecipientMessage = (recipient: string): string => `Invalid recipient: ${recipient}`

// ---------------------------------------------------------------------------
// Email + header helpers
// ---------------------------------------------------------------------------

/**
 * Validates a bare email address, mirroring `DraftValidator.isValidEmailAddress`:
 * exactly one `@`, non-empty local part, domain contains `.` and is not
 * leading/trailing-dotted, and the whole value contains no whitespace.
 */
export function isValidEmail(s: string): boolean {
  if (s.length === 0) return false
  if (/\s/.test(s)) return false
  const parts = s.split('@')
  if (parts.length !== 2) return false
  const local = parts[0]
  const domain = parts[1]
  if (local.length === 0) return false
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.')
}

/** Mirrors `MIMEBuilder.isSafeHeaderValue` — no CR or LF anywhere. */
function isSafeHeaderValue(value: string): boolean {
  return !/[\r\n]/.test(value)
}

// ---------------------------------------------------------------------------
// Date formatting (replaces Swift `DateFormatting.messageHeader`)
// ---------------------------------------------------------------------------

/**
 * Formats a message timestamp for quoted/forwarded headers. Uses a fixed UTC
 * locale rendering so it is deterministic across environments. Falls back to
 * the raw input when it is not a parseable date.
 */
export function formatMessageHeaderDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date)
}

// ---------------------------------------------------------------------------
// Recipient helpers (ported from `Draft.uniqueEmails`)
// ---------------------------------------------------------------------------

/**
 * Deduplicates recipients case-insensitively by email, drops empties, and
 * excludes any address in `excluding` (a set of lowercased emails). Preserves
 * the first-seen `Recipient` (including its display name) and trims emails.
 */
function uniqueRecipients(list: Recipient[], excluding: Set<string>): Recipient[] {
  const seen = new Set(excluding)
  const out: Recipient[] = []
  for (const r of list) {
    const email = (r.email ?? '').trim()
    if (!email) continue
    const key = email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: (r.name ?? '').trim(), email })
  }
  return out
}

function normalizedEmailKey(email: string): string {
  return email.trim().toLowerCase()
}

function currentRecipientToken(input: string): string {
  const parts = input.split(/[,\s;]+/)
  return (parts[parts.length - 1] ?? '').trim().toLowerCase()
}

function suggestionTimeValue(value?: string | null): number {
  if (!value) return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function suggestionMatchScore(suggestion: EmailAddressSuggestion, query: string): number | null {
  const email = suggestion.email.trim().toLowerCase()
  const name = suggestion.name.trim().toLowerCase()
  if (email.startsWith(query)) return 0
  if (name.startsWith(query)) return 1
  if (suggestion.kind === 'group') {
    const memberMatch = (suggestion.members ?? []).some(member => {
      const memberEmail = member.email.trim().toLowerCase()
      const memberName = member.name.trim().toLowerCase()
      return memberEmail.includes(query) || memberName.includes(query)
    })
    if (memberMatch) return 2
  }
  if (email.includes(query)) return 2
  if (name.includes(query)) return 3
  return null
}

function suggestionKindPriority(suggestion: EmailAddressSuggestion): number {
  if (suggestion.kind === 'group') return 2
  if (suggestion.kind === 'contact') return 1
  return 0
}

function sanitizeSuggestionMembers(members: Recipient[] | undefined, excluded: Set<string>): Recipient[] {
  const seen = new Set(excluded)
  const out: Recipient[] = []
  for (const member of members ?? []) {
    const email = member.email.trim()
    const key = normalizedEmailKey(email)
    if (!key || seen.has(key) || !isValidEmail(email)) continue
    seen.add(key)
    out.push({ name: member.name.trim(), email })
  }
  return out
}

export function filterEmailSuggestions(
  suggestions: EmailAddressSuggestion[],
  input: string,
  options: EmailSuggestionFilterOptions = {},
): EmailAddressSuggestion[] {
  const query = currentRecipientToken(input)
  if (!query) return []

  const limit = Math.max(1, Math.floor(options.limit ?? 8))
  const excluded = new Set<string>()
  for (const recipient of options.existingRecipients ?? []) {
    const key = normalizedEmailKey(recipient.email ?? '')
    if (key) excluded.add(key)
  }
  for (const email of options.excludedEmails ?? []) {
    const key = normalizedEmailKey(email)
    if (key) excluded.add(key)
  }

  const seen = new Set<string>()
  const matches: { suggestion: EmailAddressSuggestion; score: number; index: number }[] = []
  suggestions.forEach((suggestion, index) => {
    const kind = suggestion.kind ?? 'address'
    const email = suggestion.email.trim()
    const members = kind === 'group' ? sanitizeSuggestionMembers(suggestion.members, excluded) : undefined
    const key = kind === 'group'
      ? `group:${(suggestion.groupId || suggestion.name || email).trim().toLowerCase()}`
      : normalizedEmailKey(email)
    if (!key || seen.has(key)) return
    if (kind === 'group') {
      if (!members || members.length === 0) return
    } else if (excluded.has(key) || !isValidEmail(email)) {
      return
    }
    const score = suggestionMatchScore(suggestion, query)
    if (score === null) return
    seen.add(key)
    matches.push({
      suggestion: {
        name: suggestion.name.trim(),
        email,
        sourceCount: Math.max(1, Math.floor(suggestion.sourceCount || 1)),
        lastMessageAt: suggestion.lastMessageAt ?? null,
        kind,
        groupId: suggestion.groupId,
        members,
        subtitle: suggestion.subtitle,
      },
      score,
      index,
    })
  })

  return matches
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      const kindDelta = suggestionKindPriority(b.suggestion) - suggestionKindPriority(a.suggestion)
      if (kindDelta !== 0) return kindDelta
      if (a.suggestion.sourceCount !== b.suggestion.sourceCount) {
        return b.suggestion.sourceCount - a.suggestion.sourceCount
      }
      const timeDelta = suggestionTimeValue(b.suggestion.lastMessageAt) - suggestionTimeValue(a.suggestion.lastMessageAt)
      if (timeDelta !== 0) return timeDelta
      return a.index - b.index
    })
    .slice(0, limit)
    .map(item => item.suggestion)
}

function senderRecipient(message: MailMessage): Recipient {
  return { name: (message.senderName ?? '').trim(), email: message.senderEmail }
}

function bodySource(message: MailMessage): string {
  return message.bodyPlain ?? message.snippet ?? ''
}

function bodyHtmlSource(message: MailMessage): string {
  const richBody = sanitizeDraftHtmlFragment(message.bodyHtml || '')
  return richBody || plainTextToHtmlFragment(bodySource(message))
}

// ---------------------------------------------------------------------------
// Subject helpers (ported from `Draft.subject`)
// ---------------------------------------------------------------------------

function replySubject(subject: string): string {
  return subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`
}

function forwardSubject(subject: string): string {
  return subject.toLowerCase().startsWith('fwd:') ? subject : `Fwd: ${subject}`
}

// ---------------------------------------------------------------------------
// Threading context (ported from `Draft.replyContext` + `referencesHeader`)
// ---------------------------------------------------------------------------

function replyThreading(message: MailMessage): { replyMessageId: string | null; replyReferences: string | null } {
  const id = (message.rfcMessageId ?? '').trim()
  if (!id) return { replyMessageId: null, replyReferences: null }
  const existing = (message.rfcReferences ?? '').trim()
  const references = existing ? `${existing} ${id}` : id
  return { replyMessageId: id, replyReferences: references }
}

// ---------------------------------------------------------------------------
// Body builders
// ---------------------------------------------------------------------------

const GMAIL_QUOTE_STYLE = 'margin:0px 0px 0px 0.8ex; border-left:1px solid rgb(204,204,204); padding-left:1ex'

function replyAttribution(message: MailMessage): string {
  const sender = (message.senderName ?? '').trim() || message.senderEmail
  const date = formatMessageHeaderDate(message.receivedAt)
  return `On ${date}, ${sender} wrote:`
}

function quoteReplyBody(message: MailMessage): string {
  const original = bodySource(message)
  const quoted = original.split('\n').map((line) => `> ${line}`).join('\n')
  return `\n\n${replyAttribution(message)}\n${quoted}`
}

function quoteReplyBodyHtml(message: MailMessage): string {
  const original = bodyHtmlSource(message)
  const attribution = escapeHtml(replyAttribution(message))
  return [
    '<div class="gmail_quote" data-dumka-quoted-reply="true">',
    `<div class="gmail_attr" dir="ltr">${attribution}<br></div>`,
    `<blockquote class="gmail_quote" style="${GMAIL_QUOTE_STYLE}">`,
    original,
    '</blockquote>',
    '</div>',
  ].join('')
}

function forwardBody(message: MailMessage): string {
  const sender = message.senderEmail
  const date = formatMessageHeaderDate(message.receivedAt)
  const latestBody = bodySource(message)
  return `\n\nForwarded message\nFrom: ${sender}\nDate: ${date}\nSubject: ${message.subject}\n\n${latestBody}`
}

// ---------------------------------------------------------------------------
// Public draft-prefill API
// ---------------------------------------------------------------------------

/**
 * Builds a reply (or reply-all) draft seed from a single message, ported from
 * `Draft.recipients`/`subject`/`replyContext`.
 *
 * - Subject is prefixed `Re: ` unless it already starts with `re:`.
 * - The original message is quoted in the body.
 * - `In-Reply-To`/`References` come from the message's `rfcMessageId` /
 *   `rfcReferences`.
 * - When the message was sent by me, the reply targets its original recipients.
 * - `replyAll` additionally carries Cc = (original To + Cc) minus me and minus
 *   the resolved To set.
 */
export function startReply(message: MailMessage, selfEmail: string, replyAll = false): DraftSeed {
  const self = selfEmail.trim().toLowerCase()
  const selfSet = self ? new Set([self]) : new Set<string>()
  const sentByMe = self !== '' && message.senderEmail.trim().toLowerCase() === self
  const sender = senderRecipient(message)
  const messageTo = message.to ?? []
  const messageCc = message.cc ?? []

  let to: Recipient[] = []
  let cc: Recipient[] = []

  if (!replyAll) {
    if (sentByMe) {
      const candidate = uniqueRecipients(messageTo, new Set(selfSet))
      to = candidate.length ? candidate : uniqueRecipients([sender], new Set(selfSet))
    } else {
      to = uniqueRecipients([sender], new Set(selfSet))
    }
  } else {
    const hasMetadata = messageTo.length > 0 || messageCc.length > 0
    let handled = false
    if (hasMetadata) {
      const toCandidates = sentByMe ? messageTo : [sender]
      to = uniqueRecipients(toCandidates, new Set(selfSet))
      const ccExclude = new Set(selfSet)
      for (const r of to) ccExclude.add(r.email.toLowerCase())
      cc = uniqueRecipients([...messageTo, ...messageCc], ccExclude)
      if (to.length === 0 && cc.length > 0) {
        to = [cc[0]]
        cc = cc.slice(1)
      }
      if (to.length > 0 || cc.length > 0) handled = true
    }
    if (!handled) {
      to = uniqueRecipients([sender], new Set(selfSet))
      cc = []
    }
  }

  const { replyMessageId, replyReferences } = replyThreading(message)
  return {
    to,
    cc,
    subject: replySubject(message.subject),
    body: quoteReplyBody(message),
    bodyHtml: quoteReplyBodyHtml(message),
    replyMessageId,
    replyReferences,
  }
}

/**
 * Builds a forward draft seed from a single message, ported from
 * `Draft.subject`/`body` for `.forward`: empty recipients, `Fwd: ` subject,
 * and a quoted "Forwarded message" body. No reply threading headers.
 */
export function startForward(message: MailMessage): DraftSeed {
  return {
    to: [],
    cc: [],
    subject: forwardSubject(message.subject),
    body: forwardBody(message),
    replyMessageId: null,
    replyReferences: null,
  }
}

// ---------------------------------------------------------------------------
// Validation (ported from `DraftValidator.validate`)
// ---------------------------------------------------------------------------

/**
 * Validates a draft before send, ported from `DraftValidator.validate`.
 * Accumulates all problems (rather than throwing on the first, as Swift does)
 * so the UI can surface them. Error strings match
 * `DraftValidationError.userMessage` verbatim.
 */
export function validateDraft(input: {
  to: Recipient[]
  cc?: Recipient[]
  bcc?: Recipient[]
  subject: string
  body: string
  attachmentBytes?: number
}): ValidationResult {
  const errors: string[] = []
  const push = (message: string): void => {
    if (!errors.includes(message)) errors.push(message)
  }

  const to = input.to ?? []
  const cc = input.cc ?? []
  const bcc = input.bcc ?? []
  const recipients = [...to, ...cc, ...bcc]
  if (recipients.length === 0) {
    push(MSG_MISSING_RECIPIENT)
  }

  for (const recipient of recipients) {
    const trimmed = (recipient.email ?? '').trim()
    if (!isValidEmail(trimmed)) {
      push(invalidRecipientMessage(recipient.email ?? ''))
    } else if (!isSafeHeaderValue(trimmed)) {
      push(MSG_UNSAFE_HEADER)
    }
  }

  if (input.subject.trim().length === 0) {
    push(MSG_MISSING_SUBJECT)
  } else if (!isSafeHeaderValue(input.subject)) {
    push(MSG_UNSAFE_HEADER)
  }

  const attachmentBytes = input.attachmentBytes ?? 0
  if (attachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    push(MSG_ATTACHMENTS_TOO_LARGE)
  }

  if (input.body.trim().length === 0 && attachmentBytes <= 0) {
    push(MSG_EMPTY_BODY)
  }

  return { valid: errors.length === 0, errors }
}
