import { parseUserTimeInputDetailed } from "../scheduling/time";

// Deterministic inbound command router. Runs BEFORE any LLM sees the message.
// Legally/operationally significant commands (STOP, DELETE MY DATA) must
// never rely on model classification.

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
  | { kind: "deeper" }
  | { kind: "simple" }
  | { kind: "kids" }
  | { kind: "source" }
  | { kind: "practice" }
  | { kind: "story" }
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
  programs: { kind: "programs" },
  "my program": { kind: "my-program" },
  restart: { kind: "restart" },
  skip: { kind: "skip" },
  deeper: { kind: "deeper" },
  more: { kind: "deeper" },
  simple: { kind: "simple" },
  simpler: { kind: "simple" },
  kids: { kind: "kids" },
  kid: { kind: "kids" },
  source: { kind: "source" },
  sources: { kind: "source" },
  practice: { kind: "practice" },
  story: { kind: "story" },
  save: { kind: "save" },
  unsave: { kind: "unsave" },
  settings: { kind: "settings" },
  "delete my data": { kind: "delete-my-data" },
  now: { kind: "now" },
  today: { kind: "now" },
  tomorrow: { kind: "tomorrow" },
};

function parseNaturalTimeChange(t: string, raw: string): Command | null {
  const hasChangeVerb = /\b(change|switch|set|move|update|shift|adjust|make)\b/.test(t);
  const hasDirectTimeChangePhrase =
    /\b(change|switch|set|move|update|shift|adjust)\s+(?:my\s+)?time\b/.test(t);
  const hasDeliveryTarget =
    /\b(delivery|deliveries|scheduled|schedule|daily|lesson|lessons|message|messages|text|texts|teaching|teachings)\b/.test(
      t
    ) || /\bmy\s+time\b/.test(t);
  const isCorrection = /^no\s+my\s+scheduled\s+time\b/.test(t);
  if (!(isCorrection || hasDirectTimeChangePhrase || (hasChangeVerb && hasDeliveryTarget))) {
    return null;
  }

  const parsed = parseUserTimeInputDetailed(raw);
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
