/** Shared policy for text-model and Decisions sorting. Mail remains evidence, never instructions. */
export const REPLY_INTENT_POLICY = [
  'Reply means a legitimate personal response is reasonably expected: an existing conversation, an agreed task, or a relevant inbound request such as a customer or support enquiry.',
  'Unsolicited sales, PR, SEO, lead-generation and partnership pitches do not create an obligation to reply. Choose read for these, including repeated follow-ups, demo offers, requests to book a call, and requests to reply no or stop.',
  'A question mark, direct address, human signature, IMPORTANT label, or Re: subject is not evidence of an existing relationship or of the recipient having replied.',
  'accountHasReplied describes actual outgoing messages in this thread, including send-as aliases. Its absence means unknown; false alone does not make a new legitimate enquiry a cold pitch.',
  'If it is unclear whether an answer is wanted by the recipient, choose read rather than inventing a reply obligation. Do not confuse the sender wanting a response with the recipient needing to respond.',
].join(' ');

export interface ReplyIntentEvidence {
  subject: string;
  excerpt: string;
  accountHasReplied?: boolean;
  senderIsInternal?: boolean;
}

const PITCH_SUBJECT = /\b(?:pr|public relations|seo|press coverage|media coverage|lead generation|link building)\s+(?:idea|opportunit\w*|services?|proposal|offer)|\b(?:guest post|sponsored post|backlink)\b/i;
const SELLER_OFFER = /\b(?:we|i|our (?:team|company|agency))\s+(?:can help|help|offer|provide|speciali[sz]e|work with|work at|built)\b|\b(?:pr|marketing|seo|recruitment|lead generation)\s+agency\b|\bearned (?:press|media)\b/i;
const CALL_TO_ACTION = /\b(?:open to|interested in|would .{0,80}worthwhile|book (?:a|some)|schedule (?:a|some)|have (?:a|some))\b.{0,90}\b(?:talking|discussing|call|chat|conversation|demo|minutes)\b|\bwould a conversation\b/i;
const OPT_OUT = /\b(?:if|in case)\b.{0,70}\b(?:not|isn't|isn.t)\b.{0,35}\b(?:relevant|interested|priority|fit)\b|\b(?:reply|respond)\b.{0,25}\b(?:no|stop|unsubscribe)\b.{0,80}\bfollow.?up\b/i;

/**
 * A conservative local veto for explicit unsolicited commercial offers.
 * Only evaluated with known thread history; established conversations and
 * colleagues still reach the model. No archive/unsubscribe action follows.
 */
export function isExplicitColdPitch(item: ReplyIntentEvidence): boolean {
  if (item.accountHasReplied !== false || item.senderIsInternal) return false;
  const text = item.excerpt.replace(/\s+/g, ' ').slice(0, 4000);
  return (PITCH_SUBJECT.test(item.subject) && CALL_TO_ACTION.test(text))
    || (SELLER_OFFER.test(text) && (OPT_OUT.test(text) || CALL_TO_ACTION.test(text)));
}
