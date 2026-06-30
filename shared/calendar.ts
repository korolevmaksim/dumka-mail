import type { AttachmentMetadata, CalendarAttendee, CalendarInvite, MailMessage } from './types';

function unfoldIcsLines(text: string): string[] {
  const rawLines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of rawLines) {
    if (/^[ \t]/.test(line) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function splitIcsProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(';');
  const params: Record<string, string> = {};
  for (const part of paramParts) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseIcsDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{8}$/.test(trimmed)) {
    return new Date(`${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}T00:00:00`).toISOString();
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(trimmed);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}${zulu ? 'Z' : ''}`;
  return new Date(iso).toISOString();
}

function emailFromCalAddress(value: string): string {
  return value.replace(/^mailto:/i, '').trim();
}

export function parseIcsInvite(text: string): CalendarInvite | null {
  const lines = unfoldIcsLines(text);
  let inEvent = false;
  const props: Record<string, string[]> = {};
  const attendees: CalendarAttendee[] = [];
  let method: string | null = null;

  for (const line of lines) {
    const parsed = splitIcsProperty(line);
    if (!parsed) continue;
    if (parsed.name === 'METHOD') {
      method = parsed.value.toUpperCase();
      continue;
    }
    if (parsed.name === 'BEGIN' && parsed.value.toUpperCase() === 'VEVENT') {
      inEvent = true;
      continue;
    }
    if (parsed.name === 'END' && parsed.value.toUpperCase() === 'VEVENT') {
      break;
    }
    if (!inEvent) continue;

    if (parsed.name === 'ATTENDEE') {
      const email = emailFromCalAddress(parsed.value);
      if (email) {
        attendees.push({
          email,
          displayName: parsed.params.CN || null,
          responseStatus: null,
          optional: parsed.params.ROLE === 'OPT-PARTICIPANT'
        });
      }
      continue;
    }

    if (!props[parsed.name]) props[parsed.name] = [];
    props[parsed.name].push(parsed.value);
  }

  const uid = props.UID?.[0]?.trim();
  const startAt = parseIcsDate(props.DTSTART?.[0] || '');
  const endAt = parseIcsDate(props.DTEND?.[0] || '');
  if (!uid || !startAt || !endAt) return null;

  return {
    uid,
    method,
    summary: unescapeIcsText(props.SUMMARY?.[0] || '(No title)'),
    description: props.DESCRIPTION?.[0] ? unescapeIcsText(props.DESCRIPTION[0]) : null,
    location: props.LOCATION?.[0] ? unescapeIcsText(props.LOCATION[0]) : null,
    startAt,
    endAt,
    organizerEmail: props.ORGANIZER?.[0] ? emailFromCalAddress(props.ORGANIZER[0]) : null,
    attendees,
    sequence: props.SEQUENCE?.[0] ? Number(props.SEQUENCE[0]) : null
  };
}

export function decodeIcsAttachment(attachment: AttachmentMetadata): string | null {
  if (!attachment.base64Data) return null;
  try {
    const clean = attachment.base64Data.includes(',')
      ? attachment.base64Data.slice(attachment.base64Data.indexOf(',') + 1)
      : attachment.base64Data;
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(clean, 'base64').toString('utf-8');
    }
    return decodeURIComponent(escape(atob(clean)));
  } catch {
    return null;
  }
}

export function calendarInvitesFromMessage(message: MailMessage): CalendarInvite[] {
  const invites: CalendarInvite[] = [];
  for (const attachment of message.attachments || []) {
    const isCalendar = attachment.mimeType.toLowerCase().startsWith('text/calendar')
      || attachment.filename.toLowerCase().endsWith('.ics')
      || attachment.filename.toLowerCase().endsWith('.ical');
    if (!isCalendar) continue;
    const decoded = decodeIcsAttachment(attachment);
    if (!decoded) continue;
    const invite = parseIcsInvite(decoded);
    if (invite) invites.push(invite);
  }
  return invites;
}
