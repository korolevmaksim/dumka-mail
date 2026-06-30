import type { AttachmentMetadata, CalendarAttendee, CalendarInvite, MailMessage } from './types';

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

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

function splitIcsProperty(line: string): IcsProperty | null {
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

function formatIcsDateOnly(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{8}$/.test(trimmed)) return null;
  return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
}

function dateOnlyToIso(dateOnly: string): string {
  return new Date(`${dateOnly}T00:00:00`).toISOString();
}

function addDaysToDateOnly(dateOnly: string, days: number): string {
  const date = new Date(`${dateOnly}T00:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateTimeParts(value: string): { year: number; month: number; day: number; hour: number; minute: number; second: number; zulu: boolean } | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second, zulu] = match;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    second: Number(second),
    zulu: zulu === 'Z',
  };
}

function intlPartsForTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number; hour: number; minute: number; second: number } | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    const value = (type: string) => Number(parts.find(part => part.type === type)?.value);
    let hour = value('hour');
    if (hour === 24) hour = 0;
    const result = {
      year: value('year'),
      month: value('month'),
      day: value('day'),
      hour,
      minute: value('minute'),
      second: value('second'),
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
}

function offsetForTimeZone(date: Date, timeZone: string): number | null {
  const parts = intlPartsForTimeZone(date, timeZone);
  if (!parts) return null;
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedDateTimeToIso(parts: NonNullable<ReturnType<typeof parseDateTimeParts>>, timeZone: string): string | null {
  const localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let offset = offsetForTimeZone(new Date(localAsUtc), timeZone);
  if (offset === null) return null;
  let utc = new Date(localAsUtc - offset);
  const nextOffset = offsetForTimeZone(utc, timeZone);
  if (nextOffset !== null && nextOffset !== offset) {
    utc = new Date(localAsUtc - nextOffset);
  }
  return utc.toISOString();
}

function parseIcsDate(property: IcsProperty | undefined): { iso: string; date?: string; isAllDay: boolean; timeZone?: string | null } | null {
  if (!property) return null;
  const trimmed = property.value.trim();
  if (!trimmed) return null;
  const dateOnly = formatIcsDateOnly(trimmed);
  if (property.params.VALUE?.toUpperCase() === 'DATE' || dateOnly) {
    const date = dateOnly || formatIcsDateOnly(trimmed);
    if (!date) return null;
    return { iso: dateOnlyToIso(date), date, isAllDay: true, timeZone: property.params.TZID || null };
  }

  const parts = parseDateTimeParts(trimmed);
  if (!parts) return null;
  if (parts.zulu) {
    return {
      iso: new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)).toISOString(),
      isAllDay: false,
      timeZone: 'UTC',
    };
  }
  if (property.params.TZID) {
    const iso = zonedDateTimeToIso(parts, property.params.TZID);
    if (iso) return { iso, isAllDay: false, timeZone: property.params.TZID };
  }
  const iso = `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
  return { iso: new Date(iso).toISOString(), isAllDay: false, timeZone: null };
}

function parseIcsDurationMs(value: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(value.trim());
  if (!match) return null;
  const [, weeks = '0', days = '0', hours = '0', minutes = '0', seconds = '0'] = match;
  return (
    Number(weeks) * 7 * 24 * 60 * 60 * 1000
    + Number(days) * 24 * 60 * 60 * 1000
    + Number(hours) * 60 * 60 * 1000
    + Number(minutes) * 60 * 1000
    + Number(seconds) * 1000
  );
}

function emailFromCalAddress(value: string): string {
  return value.replace(/^mailto:/i, '').trim();
}

function recurrenceLine(property: IcsProperty): string {
  const params = Object.entries(property.params)
    .map(([key, value]) => `;${key}=${value}`)
    .join('');
  return `${property.name}${params}:${property.value}`;
}

export function parseIcsInvite(text: string): CalendarInvite | null {
  const lines = unfoldIcsLines(text);
  let inEvent = false;
  const props: Record<string, IcsProperty[]> = {};
  const attendees: CalendarAttendee[] = [];
  const recurrenceRules: string[] = [];
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
    props[parsed.name].push(parsed);
    if (parsed.name === 'RRULE' || parsed.name === 'RDATE' || parsed.name === 'EXDATE') {
      recurrenceRules.push(recurrenceLine(parsed));
    }
  }

  const uid = props.UID?.[0]?.value.trim();
  const start = parseIcsDate(props.DTSTART?.[0]);
  if (!uid || !start) return null;

  let end = parseIcsDate(props.DTEND?.[0]);
  if (!end && props.DURATION?.[0]) {
    const durationMs = parseIcsDurationMs(props.DURATION[0].value);
    if (durationMs !== null) {
      const durationDays = durationMs / (24 * 60 * 60 * 1000);
      const endDate = start.isAllDay && start.date && Number.isInteger(durationDays)
        ? addDaysToDateOnly(start.date, durationDays)
        : null;
      end = {
        iso: endDate ? dateOnlyToIso(endDate) : new Date(new Date(start.iso).getTime() + durationMs).toISOString(),
        date: endDate || undefined,
        isAllDay: start.isAllDay,
        timeZone: start.timeZone,
      };
    }
  }
  if (!end && start.isAllDay && start.date) {
    const endDate = addDaysToDateOnly(start.date, 1);
    end = { iso: dateOnlyToIso(endDate), date: endDate, isAllDay: true, timeZone: start.timeZone };
  }
  if (!end) return null;

  return {
    uid,
    method,
    summary: unescapeIcsText(props.SUMMARY?.[0]?.value || '(No title)'),
    description: props.DESCRIPTION?.[0] ? unescapeIcsText(props.DESCRIPTION[0].value) : null,
    location: props.LOCATION?.[0] ? unescapeIcsText(props.LOCATION[0].value) : null,
    startAt: start.iso,
    endAt: end.iso,
    isAllDay: start.isAllDay && end.isAllDay,
    startDate: start.date || null,
    endDate: end.date || null,
    timeZone: start.timeZone && start.timeZone !== 'UTC' ? start.timeZone : null,
    organizerEmail: props.ORGANIZER?.[0] ? emailFromCalAddress(props.ORGANIZER[0].value) : null,
    attendees,
    recurrenceRules,
    sequence: props.SEQUENCE?.[0] ? Number(props.SEQUENCE[0].value) : null
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
