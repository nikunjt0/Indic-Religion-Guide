import { parseUserTimeInputDetailed } from "../scheduling/time";

// Deterministic inbound command router. Runs BEFORE any LLM sees the message.
// Legally/operationally significant commands (STOP, DELETE MY DATA) must
// never rely on model classification.
//
// Deliberately NOT here: content continuations like "deeper", "more", "kids",
// "source", "story", "practice", "simpler". Those are ambiguous — they can
// refer to a delivered lesson, a Daily Dharma teaching, or the guru's last
// answer — so they go to the conversational layer, which resolves them from
// chat history instead of always hijacking them to the last lesson.

export type Command =
  | { kind: "start"; immediate: boolean }
  | { kind: "stop" }
  | { kind: "pause"; days?: number }
  | { kind: "resume" }
  | { kind: "help" }
  | { kind: "time" }
  | { kind: "change-time"; time?: string; needsMeridiem?: boolean }
  | { kind: "programs" }
  | { kind: "my-program" }
  | { kind: "restart" }
  | { kind: "skip" }
  | { kind: "save" }
  | { kind: "unsave" }
  | { kind: "settings" }
  | { kind: "delete-my-data" }
  | { kind: "now" }
  | { kind: "tomorrow" };

/** Lowercase, strip surrounding punctuation/emoji noise, collapse spaces. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:'"“”‘’()\[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const EXACT: Record<string, Command> = {
  start: { kind: "start", immediate: false },
  "start now": { kind: "start", immediate: true },
  unstop: { kind: "start", immediate: false },
  subscribe: { kind: "start", immediate: false },
  stop: { kind: "stop" },
  unsubscribe: { kind: "stop" },
  cancel: { kind: "stop" },
  end: { kind: "stop" },
  quit: { kind: "stop" },
  optout: { kind: "stop" },
  "opt out": { kind: "stop" },
  pause: { kind: "pause" },
  resume: { kind: "resume" },
  help: { kind: "help" },
  info: { kind: "help" },
  time: { kind: "time" },
  "change time": { kind: "change-time" },
  "change my time": { kind: "change-time" },
  "change delivery time": { kind: "change-time" },
  "change scheduled time": { kind: "change-time" },
  "change schedule": { kind: "change-time" },
  reschedule: { kind: "change-time" },
  "reschedule messages": { kind: "change-time" },
  "reschedule daily message": { kind: "change-time" },
  "reschedule daily teaching": { kind: "change-time" },
  programs: { kind: "programs" },
  "my program": { kind: "my-program" },
  restart: { kind: "restart" },
  skip: { kind: "skip" },
  save: { kind: "save" },
  unsave: { kind: "unsave" },
  settings: { kind: "settings" },
  "delete my data": { kind: "delete-my-data" },
  now: { kind: "now" },
  today: { kind: "now" },
  tomorrow: { kind: "tomorrow" },
};

function parseNaturalTimeChange(t: string, raw: string): Command | null {
  // Enrollment asks ("set me up with the Gita program", "I want to do daily
  // teaching") constantly contain the change verbs below plus a delivery noun.
  // They are requests for the conversational layer, never time changes.
  if (/\b(enroll|sign (?:me|us) up|set (?:me|us) up|get (?:me )?started|want to (?:do|start|join|begin)|join)\b/.test(t)) {
    return null;
  }
  // Verbs that on their own mean a schedule change vs. verbs that only mean
  // one when an actual time appears in the message ("set my texts to 8pm"
  // yes; "make my teachings shorter" no).
  const hasStrongChangeVerb =
    /\b(change|changing|switch|move|shift|reschedule|rescheduling)\b/.test(t);
  const hasWeakChangeVerb = /\b(set|update|adjust|make)\b/.test(t);
  const hasDirectTimeChangePhrase =
    /\b(change|changing|switch|set|move|update|shift|adjust|reschedule|rescheduling)\s+(?:my\s+)?time\b/.test(
      t
    );
  const hasDeliveryTarget =
    /\b(delivery|deliveries|scheduled\s+time|message|messages|text|texts|teaching|teachings|lesson|lessons|course|program|hinduism\s+101)\b/.test(
      t
    ) || /\bmy\s+time\b/.test(t);
  const isCorrection = /^no\s+my\s+scheduled\s+time\b/.test(t);
  const parsed = parseUserTimeInputDetailed(raw);
  const hasTimeSignal = /\btime\b/.test(t) || parsed !== null;
  const hasChangeVerb = hasStrongChangeVerb || (hasWeakChangeVerb && hasTimeSignal);
  if (!(isCorrection || hasDirectTimeChangePhrase || (hasChangeVerb && hasDeliveryTarget))) {
    return null;
  }
  return {
    kind: "change-time",
    time: parsed?.time,
    needsMeridiem: parsed?.needsMeridiem,
  };
}

/**
 * Parse a message into a command, or null when it is free-form text for the
 * answer engine. Only whole-message matches count — "please stop sending
 * essays about karma" is a question, not an opt-out.
 */
export function parseCommand(text: string): Command | null {
  const t = normalize(text);
  if (!t) return null;

  const exact = EXACT[t];
  if (exact) return exact;

  // PAUSE N DAYS / PAUSE FOR N DAYS / PAUSE N
  const pause = /^pause(?:\s+for)?\s+(\d{1,3})(?:\s+days?)?$/.exec(t);
  if (pause) return { kind: "pause", days: Number(pause[1]) };

  // PAUSE A WEEK / PAUSE ONE WEEK
  const pauseWeek = /^pause(?:\s+for)?\s+(?:a|one|1)\s+week$/.exec(t);
  if (pauseWeek) return { kind: "pause", days: 7 };

  const timeChange = parseNaturalTimeChange(t, text);
  if (timeChange) return timeChange;

  return null;
}
