import { COMMAND_ROUTER_MODEL, openai } from "../openai";

export type CompanionToolIntent =
  | { kind: "change-time"; timeText: string }
  | { kind: "start-change-time-flow" }
  | { kind: "show-time" }
  | { kind: "list-programs" }
  | { kind: "enroll"; programText: string }
  | { kind: "show-my-program" }
  | { kind: "show-help" }
  | { kind: "none" };

interface ToolCallLike {
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface CompletionLike {
  choices?: Array<{
    message?: {
      tool_calls?: ToolCallLike[];
    };
  }>;
}

type CompletionCreate = (body: Record<string, unknown>) => Promise<CompletionLike>;

const TOOL_ROUTER_SYSTEM_PROMPT = `
You route SMS messages for a Hindu learning companion app. The app itself sends
daily texts: it offers enrollable multi-day programs (like Hinduism 101 or a
Bhagavad Gita series, one lesson text per day) plus a standalone Daily Dharma
teaching. Users manage everything — schedule, enrollment, program browsing — by
texting this same number.

Call a tool only when the user is asking about or trying to manage THIS app's
setup: its delivery schedule, its programs, their enrollment, or how the app
works.

Use change_delivery_time when the user wants this app to send daily texts,
messages, lessons, teachings, Hinduism 101, program messages, or course messages
at a different time and includes the new time in the same message.

Use start_change_time_flow when the user wants to change this app's delivery
time but does not include the new time.

Use show_delivery_schedule when the user asks when this app sends messages or
what is currently scheduled.

Use list_programs when the user asks what programs, courses, lesson series, or
daily-message options exist, what they can enroll or subscribe to, or what other
daily messages they could get. Prefer this over answering from scripture — the
user is asking what this app offers.

Use enroll_in_program when the user wants to start, join, enroll in, sign up
for, or switch to a specific program or Daily Dharma.

Use show_my_program when the user asks which program they are in or how far
along they are.

Use show_app_help when the user asks what this app can do, what commands are
available, or how to manage their messages (pause, resume, stop, settings).

Do not call a tool for religious, Ayurvedic, ritual, or philosophical questions,
including questions about auspicious timing, puja timing, Vedic recitation
timing, meal timing, sleep timing, or daily spiritual practice timing. Those are
content questions, not app-account actions. Questions about outside temples,
gurus, or organizations' offerings are also content questions.
`.trim();

const TOOL_ROUTER_TOOLS = [
  {
    type: "function",
    function: {
      name: "change_delivery_time",
      description:
        "Change when this SMS app sends the user's daily learning text, lesson, teaching, course, or program message.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          time: {
            type: "string",
            description:
              'The delivery time exactly as the user requested it, such as "7:15pm", "6:35 PM", or "after dinner".',
          },
        },
        required: ["time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "start_change_time_flow",
      description:
        "Start the change-time flow when the user wants to change this app's delivery time but did not provide the new time.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_delivery_schedule",
      description:
        "Show the user's current delivery time and next scheduled app message.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_programs",
      description:
        "List the daily-message programs this app offers and how to enroll.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "enroll_in_program",
      description:
        "Enroll the user in (or switch them to) one of this app's programs or Daily Dharma.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          program: {
            type: "string",
            description:
              'The program the user named, as they said it — such as "Hinduism 101", "the Gita one", or "daily dharma".',
          },
        },
        required: ["program"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_my_program",
      description: "Show which program the user is enrolled in and their progress.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "show_app_help",
      description:
        "Explain what this app can do and list the commands for managing messages.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
    },
  },
] as const;

function parseArgs(argsJson: string | undefined): Record<string, unknown> {
  if (!argsJson) return {};
  try {
    const parsed = JSON.parse(argsJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function intentFromToolCall(call: ToolCallLike | undefined): CompanionToolIntent {
  if (!call?.function?.name) return { kind: "none" };

  const args = parseArgs(call.function.arguments);
  switch (call.function.name) {
    case "change_delivery_time": {
      const timeText = typeof args.time === "string" ? args.time.trim() : "";
      return timeText ? { kind: "change-time", timeText } : { kind: "start-change-time-flow" };
    }
    case "start_change_time_flow":
      return { kind: "start-change-time-flow" };
    case "show_delivery_schedule":
      return { kind: "show-time" };
    case "list_programs":
      return { kind: "list-programs" };
    case "enroll_in_program": {
      const programText = typeof args.program === "string" ? args.program.trim() : "";
      // No usable program name → show the menu instead of guessing.
      return programText ? { kind: "enroll", programText } : { kind: "list-programs" };
    }
    case "show_my_program":
      return { kind: "show-my-program" };
    case "show_app_help":
      return { kind: "show-help" };
    default:
      return { kind: "none" };
  }
}

export async function routeCompanionToolIntent(
  text: string,
  createCompletion: CompletionCreate = (body) =>
    openai.chat.completions.create(body as never) as Promise<CompletionLike>
): Promise<CompanionToolIntent> {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "none" };

  const completion = await createCompletion({
    model: COMMAND_ROUTER_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: TOOL_ROUTER_SYSTEM_PROMPT },
      { role: "user", content: trimmed },
    ],
    tools: TOOL_ROUTER_TOOLS,
    tool_choice: "auto",
    parallel_tool_calls: false,
  });
  const toolCall = completion.choices?.[0]?.message?.tool_calls?.find(
    (call) => call.type === "function"
  );
  return intentFromToolCall(toolCall);
}
