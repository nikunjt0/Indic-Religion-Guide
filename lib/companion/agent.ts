import { COMPANION_AGENT_MODEL, openai } from "../openai";

// Conversational account agent. Replaces the old intent-classifier +
// canned-reply design: the model sees the user's live account state, calls
// tools that actually perform account actions, and composes the reply text
// itself — so a message like "what am I enrolled in, and what else do you
// offer?" gets one natural answer covering both parts, and "sign me up for
// the stories one" actually enrolls.
//
// The agent deliberately does NOT answer scripture/content questions: it
// hands those to the RAG guru (which retrieves and cites sources) via the
// answer_scripture_question tool. Compliance-critical keywords (STOP, DELETE
// MY DATA) never reach this module — the deterministic command router runs
// first.

// ---------------------------------------------------------------------------
// Snapshot: everything the model needs to know about the account up front
// ---------------------------------------------------------------------------

export interface CompanionAgentSnapshot {
  productName: string;
  userName?: string;
  consentGranted: boolean;
  optedOut: boolean;
  /** Human text like "Aug 14" or "you say resume"; absent when not paused. */
  pausedUntilText?: string;
  /** e.g. "8:51 PM (America/Chicago)" */
  deliveryTimeText?: string;
  /** e.g. "Monday, Aug 10 at 8:51 PM CDT" */
  nextMessageText?: string;
  dailyDharmaEnabled: boolean;
  program?: {
    slug: string;
    title: string;
    day: number;
    durationDays: number;
    lessonsDelivered: number;
  } | null;
  catalog: {
    slug: string;
    title: string;
    durationDays: number;
    description: string;
  }[];
  /** e.g. "Monday, Aug 10, 11:20 AM CDT" in the user's timezone. */
  localNowText?: string;
}

// ---------------------------------------------------------------------------
// Tool executors: the bridge implements these against Firestore/scheduling.
// Each returns plain JSON data (never prose) — the model writes the prose.
// ---------------------------------------------------------------------------

export interface CompanionToolExecutor {
  enrollInProgram(args: { programSlug: string; replaceCurrent: boolean }): Promise<unknown>;
  enableDailyDharma(): Promise<unknown>;
  disableDailyDharma(): Promise<unknown>;
  changeDeliveryTime(time: string): Promise<unknown>;
  pauseMessages(days?: number): Promise<unknown>;
  resumeMessages(): Promise<unknown>;
  restartProgram(): Promise<unknown>;
  skipTodaysLesson(): Promise<unknown>;
  optOut(): Promise<unknown>;
  getLessonContent(): Promise<unknown>;
}

export type CompanionAgentResult =
  | { kind: "reply"; text: string; guruQuestion?: string; actionsTaken: number }
  | { kind: "pass-to-guru" };

export interface AgentHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export function buildCompanionSystemPrompt(s: CompanionAgentSnapshot): string {
  const name = s.userName ? ` Their name is ${s.userName}.` : "";
  const account: string[] = [];
  if (s.optedOut) {
    account.push("Messages: OPTED OUT — they must text START to receive scheduled messages again.");
  } else if (!s.consentGranted) {
    account.push("Messages: not set up yet — they must text START to begin setup.");
  } else {
    account.push(
      `Messages: on${s.pausedUntilText ? ` (paused until ${s.pausedUntilText})` : ""}`
    );
    if (s.deliveryTimeText) account.push(`Delivery time: ${s.deliveryTimeText}`);
    account.push(`Next scheduled message: ${s.nextMessageText ?? "nothing currently scheduled"}`);
  }
  account.push(
    s.program
      ? `Program: ${s.program.title} — day ${s.program.day} of ${s.program.durationDays} (${s.program.lessonsDelivered} lesson${s.program.lessonsDelivered === 1 ? "" : "s"} delivered so far)`
      : "Program: none right now"
  );
  account.push(`Daily Dharma (one standalone teaching a day): ${s.dailyDharmaEnabled ? "on" : "off"}`);

  const catalog = s.catalog
    .map((p) => `- ${p.slug}: "${p.title}", ${p.durationDays} days. ${p.description}`)
    .join("\n");

  return `You are the guru behind ${s.productName}, a Hindu learning companion that texts one short teaching a day. You are chatting with a student over iMessage.${name}

You are the same warm teacher who sends their daily lessons — never a phone menu. Voice: warm, plain, personal, brief. Texts, not essays. Plain text only (no markdown, no bullets unless you are listing the programs, and even then keep it conversational).

You have real tools that change their account. When they ask you to set something up — enroll, switch programs, change the delivery time, pause, resume — DO IT with a tool call in this same turn, then confirm in a natural sentence with the concrete details the tool returned (like when the first lesson arrives). Never tell them to text a code, keyword, or program name to make something happen; you make it happen. Ask a short natural question only when you are genuinely missing a detail (like AM or PM) or when a tool asks you to confirm something first.

Answer every part of their message. If they ask two things, address both.

If any part of the message is a question about Hindu scripture, practice, philosophy, ritual, festivals, or Ayurveda — teaching content rather than their account — call answer_scripture_question with that part. A scripture-grounded answer with citations is sent separately; do not answer content questions yourself.

THEIR ACCOUNT RIGHT NOW:
${account.map((l) => `- ${l}`).join("\n")}

PROGRAMS YOU OFFER (one program at a time; Daily Dharma can run alongside a program):
${catalog}
- daily dharma: one standalone teaching each day, not a course — enable with the enable_daily_dharma tool.
${s.localNowText ? `\nCurrent date and time for them: ${s.localNowText}` : ""}`;
}

// ---------------------------------------------------------------------------
// Tool schemas (program enum is built from the live catalog)
// ---------------------------------------------------------------------------

function buildTools(catalogSlugs: string[]) {
  return [
    {
      type: "function",
      function: {
        name: "enroll_in_program",
        description:
          "Enroll the user in a program (one text a day until it completes). Only one program runs at a time: if another program is active this returns needs-confirmation unless replace_current is true — ask the user before switching.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            program_slug: { type: "string", enum: catalogSlugs },
            replace_current: {
              type: "boolean",
              description:
                "Set true only after the user has confirmed they want to leave their current program for this one.",
            },
          },
          required: ["program_slug"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "enable_daily_dharma",
        description: "Turn on the standalone Daily Dharma teaching (can run alongside a program).",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "disable_daily_dharma",
        description: "Turn off the standalone Daily Dharma teaching.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "change_delivery_time",
        description:
          "Change what time daily messages arrive. Pass the time as the user said it (\"7:15pm\", \"after dinner\").",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { time: { type: "string" } },
          required: ["time"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "pause_messages",
        description: "Pause scheduled messages, optionally for a number of days.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { days: { type: "integer", minimum: 1, maximum: 365 } },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "resume_messages",
        description: "Resume paused messages from where the user left off.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "restart_program",
        description: "Restart the user's current program from day 1.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "skip_todays_lesson",
        description: "Skip the current lesson and move to the next one.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "opt_out_of_all_messages",
        description:
          "Fully opt the user out of all scheduled messages. Use when they clearly ask to stop receiving texts.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_lesson_content",
        description:
          "Fetch the most recently delivered lesson's full content (deeper explanation, kids version, sources, practice) so you can share more about it.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "answer_scripture_question",
        description:
          "Hand a scripture/practice/philosophy/Ayurveda question to the citation-grounded guru pipeline. Pass the question part of the user's message, reworded to stand alone.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { question: { type: "string" } },
          required: ["question"],
        },
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Completion plumbing (injectable for tests, mirrors tool-router style)
// ---------------------------------------------------------------------------

interface ToolCallLike {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface AssistantMessageLike {
  content?: string | null;
  tool_calls?: ToolCallLike[];
}

interface CompletionLike {
  choices?: Array<{ message?: AssistantMessageLike }>;
}

type CompletionCreate = (body: Record<string, unknown>) => Promise<CompletionLike>;

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

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  exec: CompanionToolExecutor
): Promise<unknown> {
  switch (name) {
    case "enroll_in_program":
      return exec.enrollInProgram({
        programSlug: typeof args.program_slug === "string" ? args.program_slug : "",
        replaceCurrent: args.replace_current === true,
      });
    case "enable_daily_dharma":
      return exec.enableDailyDharma();
    case "disable_daily_dharma":
      return exec.disableDailyDharma();
    case "change_delivery_time":
      return exec.changeDeliveryTime(typeof args.time === "string" ? args.time : "");
    case "pause_messages":
      return exec.pauseMessages(typeof args.days === "number" ? args.days : undefined);
    case "resume_messages":
      return exec.resumeMessages();
    case "restart_program":
      return exec.restartProgram();
    case "skip_todays_lesson":
      return exec.skipTodaysLesson();
    case "opt_out_of_all_messages":
      return exec.optOut();
    case "get_lesson_content":
      return exec.getLessonContent();
    default:
      return { error: `unknown tool: ${name}` };
  }
}

const HISTORY_LIMIT = 12;
const HISTORY_CHAR_LIMIT = 1200;
const GURU_HANDOFF_NOTE =
  "A scripture-grounded answer with citations will be sent as a separate text right after your reply. Do not answer that question yourself — at most, briefly note that the answer is coming.";

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

export async function runCompanionAgent(args: {
  message: string;
  history: AgentHistoryMessage[];
  snapshot: CompanionAgentSnapshot;
  executor: CompanionToolExecutor;
  createCompletion?: CompletionCreate;
  maxRounds?: number;
}): Promise<CompanionAgentResult> {
  const createCompletion: CompletionCreate =
    args.createCompletion ??
    ((body) => openai.chat.completions.create(body as never) as Promise<CompletionLike>);
  const maxRounds = args.maxRounds ?? 4;
  const tools = buildTools(args.snapshot.catalog.map((p) => p.slug));

  const messages: Record<string, unknown>[] = [
    { role: "system", content: buildCompanionSystemPrompt(args.snapshot) },
    ...args.history.slice(-HISTORY_LIMIT).map((m) => ({
      role: m.role,
      content: m.content.slice(0, HISTORY_CHAR_LIMIT),
    })),
    { role: "user", content: args.message },
  ];

  let guruQuestion: string | undefined;
  let actionsTaken = 0;

  for (let round = 0; round < maxRounds; round++) {
    const finalRound = round === maxRounds - 1;
    const completion = await createCompletion({
      model: COMPANION_AGENT_MODEL,
      temperature: 0.4,
      messages,
      tools,
      // The last round must produce text — no infinite tool loops.
      tool_choice: finalRound ? "none" : "auto",
    });
    const msg = completion.choices?.[0]?.message;
    const toolCalls = (msg?.tool_calls ?? []).filter((c) => c.type === "function" && c.function?.name);

    if (toolCalls.length === 0) {
      const text = (msg?.content ?? "").trim();
      if (!text && actionsTaken === 0 && !guruQuestion) return { kind: "pass-to-guru" };
      return { kind: "reply", text: text || "Done. 🙏", guruQuestion, actionsTaken };
    }

    // The whole message is a content question: hand off cleanly so the guru
    // pipeline sees the original text (and any attachments) untouched.
    const isPass = (c: ToolCallLike) => c.function?.name === "answer_scripture_question";
    if (round === 0 && actionsTaken === 0 && toolCalls.every(isPass)) {
      return { kind: "pass-to-guru" };
    }

    messages.push({
      role: "assistant",
      content: msg?.content ?? null,
      tool_calls: toolCalls.map((c, i) => ({
        id: c.id ?? `call_${round}_${i}`,
        type: "function",
        function: { name: c.function!.name, arguments: c.function!.arguments ?? "{}" },
      })),
    });

    for (const [i, call] of toolCalls.entries()) {
      const name = call.function!.name!;
      const callArgs = parseArgs(call.function!.arguments);
      let result: unknown;
      if (isPass(call)) {
        const q = typeof callArgs.question === "string" ? callArgs.question.trim() : "";
        guruQuestion = guruQuestion ? `${guruQuestion} Also: ${q}` : q || args.message;
        result = { status: "queued", note: GURU_HANDOFF_NOTE };
      } else {
        try {
          result = await executeTool(name, callArgs, args.executor);
          actionsTaken++;
        } catch (err) {
          result = { error: `tool failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id ?? `call_${round}_${i}`,
        content: JSON.stringify(result ?? { status: "ok" }),
      });
    }
  }

  // Unreachable (final round forces text), but keep the compiler honest.
  return { kind: "reply", text: "Done. 🙏", guruQuestion, actionsTaken };
}
