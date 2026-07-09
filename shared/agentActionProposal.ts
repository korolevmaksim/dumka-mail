export const AGENT_ACTION_PROPOSAL_START = '<DUMKA_REVIEW_QUEUE_V1>';
export const AGENT_ACTION_PROPOSAL_END = '</DUMKA_REVIEW_QUEUE_V1>';

export const AGENT_ACTION_PROPOSAL_MAX_ITEMS = 12;
export const AGENT_ACTION_PROPOSAL_MAX_BODY_CHARS = 20_000;
export const AGENT_ACTION_PROPOSAL_MAX_REASON_CHARS = 500;
export const AGENT_ACTION_PROPOSAL_MAX_LABEL_CHARS = 100;

const MAX_ENVELOPE_CHARS = 100_000;
const MAX_REMINDER_DISTANCE_MS = 366 * 24 * 60 * 60 * 1000;
const EXPLICIT_TIME_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;

export interface AgentActionProposalCitationV1 {
  accountId: string;
  threadId: string;
  messageId: string;
}

interface AgentActionProposalBaseV1 {
  citation: AgentActionProposalCitationV1;
  reason: string;
  confidence: number;
}

export type AgentActionProposalV1 =
  | (AgentActionProposalBaseV1 & {
      action: 'draftReply';
      bodyPlain: string;
    })
  | (AgentActionProposalBaseV1 & {
      action: 'setReminder';
      reminderAt: string;
    })
  | (AgentActionProposalBaseV1 & {
      action: 'archive';
    })
  | (AgentActionProposalBaseV1 & {
      action: 'applyLabel';
      labelName: string;
    });

export interface AgentActionProposalParseResult {
  visibleText: string;
  proposals: AgentActionProposalV1[];
  warning?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  return actual.length === expected.size && actual.every(key => expected.has(key));
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || value.includes('\0')) return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function parseCitation(value: unknown): AgentActionProposalCitationV1 | null {
  if (!isRecord(value) || !hasExactKeys(value, ['accountId', 'threadId', 'messageId'])) return null;
  const accountId = boundedString(value.accountId, 320);
  const threadId = boundedString(value.threadId, 512);
  const messageId = boundedString(value.messageId, 512);
  return accountId && threadId && messageId ? { accountId, threadId, messageId } : null;
}

function parseProposal(value: unknown, now: Date): AgentActionProposalV1 | null {
  if (!isRecord(value)) return null;
  const action = value.action;
  const citation = parseCitation(value.citation);
  const reason = boundedString(value.reason, AGENT_ACTION_PROPOSAL_MAX_REASON_CHARS);
  const confidence = value.confidence;
  if (!citation || !reason || !Number.isInteger(confidence) || Number(confidence) < 1 || Number(confidence) > 100) {
    return null;
  }

  const base = { citation, reason, confidence: Number(confidence) };
  if (action === 'draftReply') {
    if (!hasExactKeys(value, ['action', 'citation', 'reason', 'confidence', 'bodyPlain'])) return null;
    const bodyPlain = boundedString(value.bodyPlain, AGENT_ACTION_PROPOSAL_MAX_BODY_CHARS);
    return bodyPlain ? { ...base, action, bodyPlain } : null;
  }
  if (action === 'setReminder') {
    if (!hasExactKeys(value, ['action', 'citation', 'reason', 'confidence', 'reminderAt'])) return null;
    const reminderAt = boundedString(value.reminderAt, 64);
    if (!reminderAt || !EXPLICIT_TIME_ZONE.test(reminderAt)) return null;
    const reminderTime = Date.parse(reminderAt);
    const nowTime = now.getTime();
    if (!Number.isFinite(reminderTime) || reminderTime <= nowTime || reminderTime - nowTime > MAX_REMINDER_DISTANCE_MS) {
      return null;
    }
    return { ...base, action, reminderAt: new Date(reminderTime).toISOString() };
  }
  if (action === 'archive') {
    return hasExactKeys(value, ['action', 'citation', 'reason', 'confidence'])
      ? { ...base, action }
      : null;
  }
  if (action === 'applyLabel') {
    if (!hasExactKeys(value, ['action', 'citation', 'reason', 'confidence', 'labelName'])) return null;
    const labelName = boundedString(value.labelName, AGENT_ACTION_PROPOSAL_MAX_LABEL_CHARS);
    return labelName ? { ...base, action, labelName } : null;
  }
  return null;
}

function proposalKey(proposal: AgentActionProposalV1): string {
  const label = proposal.action === 'applyLabel' ? proposal.labelName.trim().toLowerCase() : '';
  return [
    proposal.action,
    proposal.citation.accountId.trim().toLowerCase(),
    proposal.citation.threadId,
    proposal.citation.messageId,
    label,
  ].join('\n');
}

function markerCount(text: string, marker: string): number {
  let count = 0;
  let offset = 0;
  while ((offset = text.indexOf(marker, offset)) !== -1) {
    count += 1;
    offset += marker.length;
  }
  return count;
}

export function parseAgentActionProposalResponse(
  text: string,
  now: Date = new Date(),
): AgentActionProposalParseResult {
  const startCount = markerCount(text, AGENT_ACTION_PROPOSAL_START);
  const endCount = markerCount(text, AGENT_ACTION_PROPOSAL_END);
  if (startCount === 0 && endCount === 0) return { visibleText: text, proposals: [] };
  if (startCount !== 1 || endCount !== 1) {
    return {
      visibleText: text,
      proposals: [],
      warning: 'AI action proposals were ignored because the response contained an invalid envelope.',
    };
  }

  const start = text.indexOf(AGENT_ACTION_PROPOSAL_START);
  const end = text.indexOf(AGENT_ACTION_PROPOSAL_END, start + AGENT_ACTION_PROPOSAL_START.length);
  if (end < start) {
    return {
      visibleText: text,
      proposals: [],
      warning: 'AI action proposals were ignored because the response envelope was incomplete.',
    };
  }

  const raw = text.slice(start + AGENT_ACTION_PROPOSAL_START.length, end).trim();
  const visibleText = `${text.slice(0, start)}${text.slice(end + AGENT_ACTION_PROPOSAL_END.length)}`.trim();
  if (!raw || raw.length > MAX_ENVELOPE_CHARS) {
    return { visibleText, proposals: [], warning: 'AI action proposals were ignored because the envelope size was invalid.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { visibleText, proposals: [], warning: 'AI action proposals were ignored because their JSON was invalid.' };
  }
  if (!isRecord(parsed)
    || !hasExactKeys(parsed, ['version', 'proposals'])
    || parsed.version !== 1
    || !Array.isArray(parsed.proposals)
    || parsed.proposals.length === 0
    || parsed.proposals.length > AGENT_ACTION_PROPOSAL_MAX_ITEMS) {
    return { visibleText, proposals: [], warning: 'AI action proposals were ignored because their schema was invalid.' };
  }

  const proposals = parsed.proposals.map(value => parseProposal(value, now));
  if (proposals.some(proposal => proposal === null)) {
    return { visibleText, proposals: [], warning: 'AI action proposals were ignored because at least one item was invalid.' };
  }
  const validProposals = proposals as AgentActionProposalV1[];
  const keys = validProposals.map(proposalKey);
  if (new Set(keys).size !== keys.length) {
    return { visibleText, proposals: [], warning: 'AI action proposals were ignored because duplicate items were present.' };
  }
  return { visibleText, proposals: validProposals };
}

export function buildAgentActionProposalInstruction(nowIso: string): string {
  return `\nWhen the current user explicitly asks you to prepare mailbox actions, you may append exactly one machine-readable proposal envelope after your normal answer. Never claim an action was executed. Only propose draftReply, setReminder, archive, or applyLabel. Every item requires action, citation, reason, and integer confidence from 1 to 100. draftReply additionally requires bodyPlain; setReminder requires a future ISO 8601 reminderAt with timezone; applyLabel requires labelName; archive has no additional field. Every proposal must cite an exact accountId, threadId, and non-empty messageId returned by searchMailbox during this request. Use plain text only for draft bodies. For applyLabel, use the existing label name requested by the user, never invent a label id. Current time: ${nowIso}. Do not wrap the envelope in Markdown fences.\n${AGENT_ACTION_PROPOSAL_START}\n{"version":1,"proposals":[{"action":"archive","citation":{"accountId":"account@example.com","threadId":"thread-id","messageId":"message-id"},"reason":"Why this helps","confidence":85}]}\n${AGENT_ACTION_PROPOSAL_END}\nOmit the entire envelope when no action was explicitly requested or no exact mailbox citation is available.`;
}
