import { COMMAND_ROUTER_MODEL, openai } from "../openai";

export type CompanionToolIntent =
  | { kind: "change-time"; timeText: string }
  | { kind: "start-change-time-flow" }
  | { kind: "show-time" }
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
You route SMS messages for a Hindu learning companion.

Call a tool only when the user is trying to manage this app's delivery schedule
or asks to see the current app delivery time.

Use change_delivery_time when the user wants this app to send daily texts,
messages, lessons, teachings, Hinduism 101, program messages, or course messages
at a different time and includes the new time in the same message.

Use start_change_time_flow when the user wants to change this app's delivery
time but does not include the new time.

Use show_delivery_schedule when the user asks when this app sends messages or
what is currently scheduled.

Do not call a tool for religious, Ayurvedic, ritual, or philosophical questions,
including questions about auspicious timing, puja timing, Vedic recitation
timing, meal timing, sleep timing, or daily spiritual practice timing. Those are
content questions, not app-account actions.
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
