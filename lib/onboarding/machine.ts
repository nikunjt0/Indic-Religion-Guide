import { parseUserTimeInputDetailed } from "../scheduling/time";
import { parseCommand } from "../commands/router";

// Conversational onboarding as an explicit, persisted state machine. The LLM
// never decides which question comes next. Users can ask a real question
// mid-onboarding: the caller detects that via `deflected` and answers it,
// then re-sends the pending prompt.

export type OnboardingState =
  | "awaiting-consent"
  | "awaiting-name"
  | "awaiting-goal"
  | "awaiting-level"
  | "awaiting-tradition"
  | "awaiting-language"
  | "awaiting-delivery-time"
  | "awaiting-timezone-confirmation"
  | "awaiting-program-selection"
  | "awaiting-start-choice"
  | "completed";

export interface OnboardingProfilePatch {
  displayName?: string;
  primaryGoal?: string;
  experienceLevel?: string;
  traditionPreference?: string;
  preferredLanguage?: string;
  preferredLocalTime?: string;
  timezone?: string;
  selectedProgram?: string;
  consentGranted?: boolean;
  startImmediately?: boolean;
}

export interface OnboardingStepResult {
  nextState: OnboardingState;
  patch: OnboardingProfilePatch;
  replies: string[];
  /** True when the input looked like a free-form question, not an answer. */
  deflected?: boolean;
}

export interface OnboardingContext {
  productName: string;
  defaultTimezone: string; // IANA guess to confirm
  candidateTimezone?: string; // better guess (web context) when available
  /** The user's personal Stripe checkout link; adds the pricing paragraph. */
  signupUrl?: string | null;
}

const GOALS: Record<string, string> = {
  "1": "understand-basics",
  "2": "daily-practice",
  "3": "teach-children",
  "4": "study-gita",
  "5": "reconnect-with-culture",
};

const LEVELS: Record<string, string> = {
  "1": "beginner",
  "2": "familiar",
  "3": "intermediate",
};

const TRADITIONS: Record<string, string> = {
  "1": "not-sure",
  "2": "general",
  "3": "vaishnava",
  "4": "shaiva",
  "5": "shakta",
  "6": "smarta",
  "7": "other",
};

const LANGUAGES: Record<string, string> = {
  "1": "english",
  "2": "english-with-sanskrit",
  "3": "hinglish",
  "4": "hindi",
};

const PROGRAMS: Record<string, string> = {
  "1": "hinduism-101",
  "2": "seven-days-bhagavad-gita",
  "3": "seven-hindu-stories-for-families",
  "4": "daily-dharma",
};

export function welcomeMessage(ctx: OnboardingContext): string {
  const pricing = ctx.signupUrl
    ? `${ctx.productName} is $5 a month with a 1-week free trial, and you can cancel anytime just ` +
      `by texting me. Start your free week here (Apple Pay works): ${ctx.signupUrl}\n\n`
    : "";
  return (
    `Namaste, and welcome! 🙏 I'm your Hindu Guru — a daily companion for dharma and Hindu ` +
    `traditions, grounded in scripture: the Bhagavad Gita, the Upanishads, the Ramayana and ` +
    `Mahabharata, the Puranas, devotional poetry, and classical Ayurveda. I cite my sources ` +
    `when I answer.\n\n` +
    `Here's what I can do for you:\n` +
    `• Text you one short daily teaching at a time you choose\n` +
    `• Walk you through programs like Hinduism 101 or Seven Days of the Bhagavad Gita\n` +
    `• Answer any question, anytime — a verse, a ritual, a festival, or something you've ` +
    `wondered about for years\n\n` +
    pricing +
    `Ready? Just tell me what you'd like — daily teachings, a program, or a question — and ` +
    `I'll set you up. (Reply STOP anytime to opt out.)`
  );
}

function promptFor(state: OnboardingState, ctx: OnboardingContext, tz?: string): string {
  switch (state) {
    case "awaiting-name":
      return "Wonderful. What should I call you?";
    case "awaiting-goal":
      return (
        "What would help you most?\n" +
        "1. Understand Hinduism\n2. Build a daily practice\n3. Teach my children\n" +
        "4. Study the Bhagavad Gita\n5. Reconnect with my roots\n\nReply with a number or your own words."
      );
    case "awaiting-level":
      return (
        "How familiar are you with Hinduism?\n" +
        "1. Starting from the basics\n2. Familiar with stories and rituals\n3. Ready for deeper philosophy"
      );
    case "awaiting-tradition":
      return (
        "Do you follow a particular Hindu tradition? (No wrong answer — many families aren't sure.)\n" +
        "1. Not sure\n2. General Hindu\n3. Vaishnava\n4. Shaiva\n5. Shakta\n6. Smarta\n7. Something else"
      );
    case "awaiting-language":
      return (
        "How should I write?\n1. English\n2. English with Sanskrit terms\n3. Hinglish\n4. Hindi"
      );
    case "awaiting-delivery-time":
      return "What time should your daily teaching arrive? You can say “7:30 AM” or “after dinner.”";
    case "awaiting-timezone-confirmation":
      return `I have your timezone as ${tz ?? ctx.candidateTimezone ?? ctx.defaultTimezone}. Is that right? Just say yes, or tell me your city.`;
    case "awaiting-program-selection":
      return (
        "One last thing — where should we start?\n" +
        "1. Hinduism 101 (21 days, the foundations)\n" +
        "2. Seven Days of the Bhagavad Gita\n" +
        "3. Seven Hindu Stories for Families\n" +
        "4. Just Daily Dharma (one standalone teaching a day)"
      );
    default:
      return "";
  }
}

/** Re-prompt for the current state (used after answering a mid-flow question). */
export function currentPrompt(
  state: OnboardingState,
  ctx: OnboardingContext,
  tz?: string
): string {
  return promptFor(state, ctx, tz);
}

function matchChoice(
  input: string,
  numbered: Record<string, string>,
  keywords: [RegExp, string][]
): string | null {
  const t = input.trim().toLowerCase();
  const num = /^(\d)\b/.exec(t);
  if (num && numbered[num[1]]) return numbered[num[1]];
  // A question about the options is not an answer to them — keyword matching
  // must not swallow "wait, what's the difference between Shaiva and Vaishnava?"
  if (looksLikeQuestion(input)) return null;
  for (const [re, value] of keywords) {
    if (re.test(t)) return value;
  }
  return null;
}

function looksLikeQuestion(input: string): boolean {
  const t = input.trim().toLowerCase();
  return (
    t.length > 60 ||
    t.includes("?") ||
    /^(what|why|how|who|when|where|is |are |can |does |should )/.test(t)
  );
}

export function stepOnboarding(
  state: OnboardingState,
  input: string,
  ctx: OnboardingContext
): OnboardingStepResult {
  const raw = input.trim();
  const cmd = parseCommand(raw);

  // STOP always wins, from any state.
  if (cmd?.kind === "stop") {
    return {
      nextState: state,
      patch: { consentGranted: false },
      replies: [
        "You're opted out — I won't send you anything else. Reply START anytime if you'd like to begin again.",
      ],
    };
  }

  switch (state) {
    case "awaiting-consent": {
      if (cmd?.kind === "start" || /^(yes|yep|yeah|ok|okay|sure|begin)\b/i.test(raw)) {
        return {
          nextState: "awaiting-name",
          patch: { consentGranted: true },
          replies: [promptFor("awaiting-name", ctx)],
        };
      }
      return {
        nextState: "awaiting-consent",
        patch: {},
        replies: [welcomeMessage(ctx)],
        deflected: looksLikeQuestion(raw),
      };
    }

    case "awaiting-name": {
      // Commands and question-looking input are not names.
      if (cmd || looksLikeQuestion(raw) || raw.length === 0 || raw.length > 60) {
        return {
          nextState: "awaiting-name",
          patch: {},
          replies: [promptFor("awaiting-name", ctx)],
          deflected: looksLikeQuestion(raw),
        };
      }
      const name = raw.replace(/^i(?:'| a)?m\s+/i, "").replace(/^my name is\s+/i, "").trim();
      return {
        nextState: "awaiting-goal",
        patch: { displayName: name },
        replies: [`Nice to meet you, ${name}.`, promptFor("awaiting-goal", ctx)],
      };
    }

    case "awaiting-goal": {
      const goal = matchChoice(raw, GOALS, [
        [/understand|basics|learn/, "understand-basics"],
        [/daily|practice|habit/, "daily-practice"],
        [/child|kid|teach|family|son|daughter/, "teach-children"],
        [/gita/, "study-gita"],
        [/reconnect|roots|culture|heritage/, "reconnect-with-culture"],
      ]);
      if (!goal) {
        return {
          nextState: "awaiting-goal",
          patch: {},
          replies: [promptFor("awaiting-goal", ctx)],
          deflected: looksLikeQuestion(raw),
        };
      }
      return {
        nextState: "awaiting-level",
        patch: { primaryGoal: goal },
        replies: [promptFor("awaiting-level", ctx)],
      };
    }

    case "awaiting-level": {
      const level = matchChoice(raw, LEVELS, [
        [/basic|beginner|start|new/, "beginner"],
        [/familiar|stories|rituals|some/, "familiar"],
        [/deep|philosophy|advanced/, "intermediate"],
      ]);
      if (!level) {
        return {
          nextState: "awaiting-level",
          patch: {},
          replies: [promptFor("awaiting-level", ctx)],
          deflected: looksLikeQuestion(raw),
        };
      }
      return {
        nextState: "awaiting-tradition",
        patch: { experienceLevel: level },
        replies: [promptFor("awaiting-tradition", ctx)],
      };
    }

    case "awaiting-tradition": {
      const tradition = matchChoice(raw, TRADITIONS, [
        [/not sure|dont know|don't know|no idea|unsure/, "not-sure"],
        [/general|just hindu|regular/, "general"],
        [/vaishnav/, "vaishnava"],
        [/shaiv|saiv/, "shaiva"],
        [/shakt/, "shakta"],
        [/smart/, "smarta"],
        [/swaminarayan/, "swaminarayan"],
        [/other|something else/, "other"],
      ]);
      if (!tradition) {
        return {
          nextState: "awaiting-tradition",
          patch: {},
          replies: [promptFor("awaiting-tradition", ctx)],
          deflected: looksLikeQuestion(raw),
        };
      }
      return {
        nextState: "awaiting-language",
        patch: { traditionPreference: tradition },
        replies: [promptFor("awaiting-language", ctx)],
      };
    }

    case "awaiting-language": {
      const language = matchChoice(raw, LANGUAGES, [
        [/hinglish/, "hinglish"],
        [/hindi/, "hindi"],
        [/sanskrit/, "english-with-sanskrit"],
        [/english/, "english"],
      ]);
      if (!language) {
        return {
          nextState: "awaiting-language",
          patch: {},
          replies: [promptFor("awaiting-language", ctx)],
          deflected: looksLikeQuestion(raw),
        };
      }
      return {
        nextState: "awaiting-delivery-time",
        patch: { preferredLanguage: language },
        replies: [promptFor("awaiting-delivery-time", ctx)],
      };
    }

    case "awaiting-delivery-time": {
      const parsed = parseUserTimeInputDetailed(raw);
      if (parsed?.needsMeridiem) {
        return {
          nextState: "awaiting-delivery-time",
          patch: {},
          replies: ["Please include AM or PM, like “6:25 PM”."],
          deflected: looksLikeQuestion(raw),
        };
      }
      if (!parsed) {
        return {
          nextState: "awaiting-delivery-time",
          patch: {},
          replies: [
            "I didn't catch a time there. Try something like “7:30 AM”, “8 pm”, or “after dinner”.",
          ],
          deflected: looksLikeQuestion(raw),
        };
      }
      return {
        nextState: "awaiting-timezone-confirmation",
        patch: { preferredLocalTime: parsed.time },
        replies: [
          `Got it — ${formatTime12h(parsed.time)} each day.`,
          promptFor("awaiting-timezone-confirmation", ctx),
        ],
      };
    }

    case "awaiting-timezone-confirmation": {
      const affirmative = /^(yes|yep|yeah|right|correct|that's right|thats right|y)\b/i.test(raw);
      const correctedTime = parseUserTimeInputDetailed(raw);
      const tz = guessTimezone(raw);
      if (correctedTime?.needsMeridiem) {
        return {
          nextState: "awaiting-timezone-confirmation",
          patch: {},
          replies: ["Please include AM or PM for the new delivery time, like “6:25 PM”."],
          deflected: looksLikeQuestion(raw),
        };
      }
      if (correctedTime) {
        const timezone = tz ?? (affirmative ? ctx.candidateTimezone ?? ctx.defaultTimezone : undefined);
        return {
          nextState: timezone ? "awaiting-program-selection" : "awaiting-timezone-confirmation",
          patch: {
            preferredLocalTime: correctedTime.time,
            ...(timezone ? { timezone } : {}),
          },
          replies: [
            `Got it — ${formatTime12h(correctedTime.time)} each day.`,
            timezone
              ? promptFor("awaiting-program-selection", ctx)
              : promptFor("awaiting-timezone-confirmation", ctx),
          ],
        };
      }
      if (affirmative) {
        return {
          nextState: "awaiting-program-selection",
          patch: { timezone: ctx.candidateTimezone ?? ctx.defaultTimezone },
          replies: [promptFor("awaiting-program-selection", ctx)],
        };
      }
      if (tz) {
        return {
          nextState: "awaiting-program-selection",
          patch: { timezone: tz },
          replies: [`Thanks — set to ${tz}.`, promptFor("awaiting-program-selection", ctx)],
        };
      }
      return {
        nextState: "awaiting-timezone-confirmation",
        patch: {},
        replies: [
          "Which city are you in? (For example “Chicago”, “London”, or “Mumbai” — I use it only to time your messages.)",
        ],
        deflected: looksLikeQuestion(raw),
      };
    }

    case "awaiting-program-selection": {
      const program = matchChoice(raw, PROGRAMS, [
        [/101|foundation|basics/, "hinduism-101"],
        [/gita/, "seven-days-bhagavad-gita"],
        [/stor|famil|kid/, "seven-hindu-stories-for-families"],
        [/daily|dharma|just/, "daily-dharma"],
      ]);
      if (!program) {
        return {
          nextState: "awaiting-program-selection",
          patch: {},
          replies: [promptFor("awaiting-program-selection", ctx)],
          deflected: looksLikeQuestion(raw),
        };
      }
      return {
        nextState: "awaiting-start-choice",
        patch: { selectedProgram: program },
        replies: [
          "You're all set. Would you like your first teaching now, or starting tomorrow at your chosen time?",
        ],
      };
    }

    case "awaiting-start-choice": {
      // "not now, tomorrow" contains both words — check the deferral first.
      if (cmd?.kind === "tomorrow" || /\b(tomorrow|later)\b/i.test(raw)) {
        return { nextState: "completed", patch: { startImmediately: false }, replies: [] };
      }
      if (cmd?.kind === "now" || /\b(now|today|right away|asap)\b/i.test(raw)) {
        return { nextState: "completed", patch: { startImmediately: true }, replies: [] };
      }
      return {
        nextState: "awaiting-start-choice",
        patch: {},
        replies: ["Would you like your first teaching now, or starting tomorrow?"],
        deflected: looksLikeQuestion(raw),
      };
    }

    case "completed":
      return { nextState: "completed", patch: {}, replies: [] };
  }
}

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const meridiem = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

// Small city → IANA map for the common diaspora cases; anything else can be
// refined later from the web dashboard. Deliberately deterministic.
const CITY_TZ: [RegExp, string][] = [
  [/chicago|dallas|houston|austin|minneapolis|central/, "America/Chicago"],
  [/new york|nyc|boston|atlanta|miami|toronto|eastern|new jersey|washington/, "America/New_York"],
  [/los angeles|san francisco|seattle|san jose|bay area|pacific|portland/, "America/Los_Angeles"],
  [/denver|phoenix|mountain/, "America/Denver"],
  [/london|uk|england/, "Europe/London"],
  [/mumbai|delhi|bangalore|bengaluru|chennai|hyderabad|kolkata|pune|india|ist/, "Asia/Kolkata"],
  [/dubai|abu dhabi/, "Asia/Dubai"],
  [/singapore/, "Asia/Singapore"],
  [/sydney|melbourne/, "Australia/Sydney"],
];

export function guessTimezone(input: string): string | null {
  const t = input.trim().toLowerCase();
  // Direct IANA id ("America/Chicago")
  if (/^[a-z_]+\/[a-z_]+$/i.test(t)) {
    const canonical = t
      .split("/")
      .map((part) => part.split("_").map((w) => w[0]?.toUpperCase() + w.slice(1)).join("_"))
      .join("/");
    return canonical;
  }
  for (const [re, tz] of CITY_TZ) {
    if (re.test(t)) return tz;
  }
  return null;
}
