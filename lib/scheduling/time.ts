import { DateTime } from "luxon";

// Timezone-aware scheduling math. The invariant: the user's local delivery
// intent ("7:30 AM in America/Chicago") is the source of truth; UTC instants
// are always derived, never stored as the intent.
//
// DST behavior (luxon semantics we rely on, covered by tests):
// - A preferred time that falls in a DST gap (e.g. 02:30 on spring-forward
//   day) resolves to the shifted wall-clock instant luxon produces.
// - A preferred time in a repeated hour (fall-back) resolves to the FIRST
//   occurrence (earlier offset).

export interface LocalSchedule {
  timezone: string; // IANA
  preferredLocalTime: string; // "HH:mm"
  /** ISO weekday numbers 1 (Mon) – 7 (Sun); empty/undefined = every day. */
  deliveryDays?: number[];
}

export function isValidTimezone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function parseLocalTime(value: string): { hour: number; minute: number } | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * Next UTC instant strictly after `afterMs` at which the schedule fires.
 * Also returns the local date the delivery belongs to (YYYY-MM-DD).
 */
export function nextOccurrence(
  schedule: LocalSchedule,
  afterMs: number
): { atMs: number; localDate: string } {
  const time = parseLocalTime(schedule.preferredLocalTime);
  if (!time) throw new Error(`invalid preferredLocalTime: ${schedule.preferredLocalTime}`);
  const zone = schedule.timezone;
  if (!isValidTimezone(zone)) throw new Error(`invalid timezone: ${zone}`);

  const days =
    schedule.deliveryDays && schedule.deliveryDays.length > 0
      ? new Set(schedule.deliveryDays)
      : null;

  let cursor = DateTime.fromMillis(afterMs, { zone }).startOf("day");
  // Look ahead up to 8 days: enough to find the next allowed weekday even
  // with a 7-day mask plus a same-day miss.
  for (let i = 0; i < 9; i++) {
    const candidate = cursor.set({
      hour: time.hour,
      minute: time.minute,
      second: 0,
      millisecond: 0,
    });
    if (candidate.toMillis() > afterMs && (!days || days.has(candidate.weekday))) {
      return { atMs: candidate.toMillis(), localDate: candidate.toISODate()! };
    }
    cursor = cursor.plus({ days: 1 });
  }
  throw new Error("no valid delivery occurrence found within 9 days");
}

/** The local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDateOf(ms: number, timezone: string): string {
  return DateTime.fromMillis(ms, { zone: timezone }).toISODate()!;
}

/**
 * Whether a local time falls inside quiet hours [start, end). Supports
 * overnight windows (e.g. 22:00–07:00).
 */
export function isInQuietHours(
  ms: number,
  timezone: string,
  quietStart?: string,
  quietEnd?: string
): boolean {
  if (!quietStart || !quietEnd) return false;
  const start = parseLocalTime(quietStart);
  const end = parseLocalTime(quietEnd);
  if (!start || !end) return false;
  const local = DateTime.fromMillis(ms, { zone: timezone });
  const minutes = local.hour * 60 + local.minute;
  const s = start.hour * 60 + start.minute;
  const e = end.hour * 60 + end.minute;
  if (s === e) return false;
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e; // overnight window
}

/**
 * Parse loose user time input ("7:30 AM", "7am", "19:00", "after dinner")
 * into "HH:mm", or null when unparseable. Dayparts map to sensible defaults.
 */
export function parseUserTimeInput(input: string): string | null {
  const s = input.trim().toLowerCase();
  const dayparts: [RegExp, string][] = [
    [/(early\s+morning|sunrise|dawn)/, "06:30"],
    [/(after\s+lunch|midday|noon)/, "12:30"],
    [/(morning|breakfast)/, "07:30"],
    [/(afternoon)/, "15:00"],
    [/(after\s+dinner|evening)/, "19:30"],
    [/(before\s+bed|bedtime|night)/, "21:00"],
  ];
  const m = /(^|\D)([01]?\d|2[0-3])(?::([0-5]\d))?\s*(am|pm|a\.m\.|p\.m\.)?(\D|$)/.exec(s);
  if (m && (m[3] !== undefined || m[4])) {
    let hour = Number(m[2]);
    const minute = m[3] ? Number(m[3]) : 0;
    const meridiem = m[4]?.replace(/\./g, "");
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    if (hour <= 23) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  for (const [re, time] of dayparts) {
    if (re.test(s)) return time;
  }
  return null;
}
