import { describe, expect, it } from "vitest";
import {
  buildCompanionSystemPrompt,
  runCompanionAgent,
  type CompanionAgentSnapshot,
  type CompanionToolExecutor,
} from "../lib/companion/agent";

function snapshot(overrides: Partial<CompanionAgentSnapshot> = {}): CompanionAgentSnapshot {
  return {
    productName: "Dharma Companion",
    userName: "Nikunj",
    consentGranted: true,
    optedOut: false,
    deliveryTimeText: "8:51 PM (America/Chicago)",
    nextMessageText: "Monday, Aug 10 at 8:51 PM CDT",
    dailyDharmaEnabled: false,
    program: {
      slug: "hinduism-101",
      title: "Hinduism 101",
      day: 2,
      durationDays: 21,
      lessonsDelivered: 1,
    },
    catalog: [
      { slug: "hinduism-101", title: "Hinduism 101", durationDays: 21, description: "Foundations." },
      {
        slug: "seven-hindu-stories-for-families",
        title: "Seven Hindu Stories for Families",
        durationDays: 7,
        description: "Stories to share with children.",
      },
    ],
    localNowText: "Monday, Aug 10, 11:20 AM CDT",
    ...overrides,
  };
}

interface RecordedCall {
  name: string;
  args?: unknown;
}

function fakeExecutor(overrides: Partial<CompanionToolExecutor> = {}) {
  const calls: RecordedCall[] = [];
  const stub =
    (name: string, result: unknown = { status: "ok" }) =>
    async (args?: unknown) => {
      calls.push({ name, args });
      return result;
    };
  const executor: CompanionToolExecutor = {
    enrollInProgram: stub("enrollInProgram", {
      status: "enrolled",
      program: "Seven Hindu Stories for Families",
      firstLessonArrives: "Tuesday at 8:51 PM",
    }),
    enableDailyDharma: stub("enableDailyDharma"),
    disableDailyDharma: stub("disableDailyDharma"),
    changeDeliveryTime: stub("changeDeliveryTime"),
    pauseMessages: stub("pauseMessages"),
    resumeMessages: stub("resumeMessages"),
    restartProgram: stub("restartProgram"),
    skipTodaysLesson: stub("skipTodaysLesson"),
    optOut: stub("optOut"),
    getLessonContent: stub("getLessonContent"),
    ...overrides,
  };
  return { calls, executor };
}

/** Scripted model: returns each message in order, recording request bodies. */
function scriptedModel(messages: Record<string, unknown>[]) {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  const create = async (body: Record<string, unknown>) => {
    bodies.push(body);
    const message = messages[Math.min(i, messages.length - 1)];
    i++;
    return { choices: [{ message }] };
  };
  return { bodies, create };
}

function toolCall(name: string, args: Record<string, unknown>, id = "call_1") {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

describe("companion agent system prompt", () => {
  it("gives the model the live account state and catalog", () => {
    const prompt = buildCompanionSystemPrompt(snapshot());
    expect(prompt).toContain("Hinduism 101 — day 2 of 21");
    expect(prompt).toContain("Delivery time: 8:51 PM (America/Chicago)");
    expect(prompt).toContain("seven-hindu-stories-for-families");
    expect(prompt).toContain("Daily Dharma (one standalone teaching a day): off");
    expect(prompt).toContain("Never tell them to text a code");
  });

  it("tells the model when the user is opted out or not set up", () => {
    expect(
      buildCompanionSystemPrompt(snapshot({ optedOut: true, consentGranted: false }))
    ).toContain("OPTED OUT");
    expect(
      buildCompanionSystemPrompt(snapshot({ optedOut: false, consentGranted: false }))
    ).toContain("not set up yet");
  });
});

describe("runCompanionAgent", () => {
  it("returns the model's own text for a no-tool conversational answer", async () => {
    const { executor, calls } = fakeExecutor();
    const model = scriptedModel([
      { content: "You're on day 2 of Hinduism 101. Besides that I offer the stories program too." },
    ]);
    const result = await runCompanionAgent({
      message: "What am I enrolled in and what else do you have?",
      history: [],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
    });
    expect(result).toEqual({
      kind: "reply",
      text: "You're on day 2 of Hinduism 101. Besides that I offer the stories program too.",
      guruQuestion: undefined,
      actionsTaken: 0,
    });
    expect(calls).toEqual([]);
  });

  it("executes an enrollment tool call and replies with the second-round text", async () => {
    const { executor, calls } = fakeExecutor();
    const model = scriptedModel([
      {
        content: null,
        tool_calls: [
          toolCall("enroll_in_program", { program_slug: "seven-hindu-stories-for-families" }),
        ],
      },
      { content: "Done! The stories begin Tuesday at 8:51 PM. 🙏" },
    ]);
    const result = await runCompanionAgent({
      message: "Can I also enroll in the seven Hindu stories for families",
      history: [],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
    });
    expect(result).toEqual({
      kind: "reply",
      text: "Done! The stories begin Tuesday at 8:51 PM. 🙏",
      guruQuestion: undefined,
      actionsTaken: 1,
    });
    expect(calls).toEqual([
      {
        name: "enrollInProgram",
        args: { programSlug: "seven-hindu-stories-for-families", replaceCurrent: false },
      },
    ]);
    // The tool result went back to the model verbatim as JSON.
    const secondBody = model.bodies[1].messages as Record<string, unknown>[];
    const toolMsg = secondBody.find((m) => m.role === "tool");
    expect(JSON.parse(toolMsg!.content as string)).toMatchObject({ status: "enrolled" });
  });

  it("hands a pure scripture question to the guru untouched", async () => {
    const { executor, calls } = fakeExecutor();
    const model = scriptedModel([
      {
        content: null,
        tool_calls: [toolCall("answer_scripture_question", { question: "What is karma?" })],
      },
    ]);
    const result = await runCompanionAgent({
      message: "What is karma?",
      history: [],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
    });
    expect(result).toEqual({ kind: "pass-to-guru" });
    expect(calls).toEqual([]);
    expect(model.bodies).toHaveLength(1);
  });

  it("handles a mixed message: performs the account action and extracts the scripture question", async () => {
    const { executor, calls } = fakeExecutor();
    const model = scriptedModel([
      {
        content: null,
        tool_calls: [
          toolCall("enroll_in_program", { program_slug: "seven-hindu-stories-for-families" }, "c1"),
          toolCall("answer_scripture_question", { question: "Why do we light a diya?" }, "c2"),
        ],
      },
      { content: "You're enrolled in the stories! Your diya answer is coming right up." },
    ]);
    const result = await runCompanionAgent({
      message: "Enroll me in the family stories, and why do we light a diya?",
      history: [],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
    });
    expect(result).toEqual({
      kind: "reply",
      text: "You're enrolled in the stories! Your diya answer is coming right up.",
      guruQuestion: "Why do we light a diya?",
      actionsTaken: 1,
    });
    expect(calls.map((c) => c.name)).toEqual(["enrollInProgram"]);
  });

  it("surfaces executor failures to the model instead of crashing", async () => {
    const { executor } = fakeExecutor({
      changeDeliveryTime: async () => {
        throw new Error("firestore down");
      },
    });
    const model = scriptedModel([
      { content: null, tool_calls: [toolCall("change_delivery_time", { time: "7pm" })] },
      { content: "I hit a snag changing your time — mind trying again in a minute?" },
    ]);
    const result = await runCompanionAgent({
      message: "move my lessons to 7pm",
      history: [],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
    });
    expect(result.kind).toBe("reply");
    const secondBody = model.bodies[1].messages as Record<string, unknown>[];
    const toolMsg = secondBody.find((m) => m.role === "tool");
    expect(toolMsg!.content as string).toContain("firestore down");
  });

  it("passes to the guru when the model produces neither text nor actions", async () => {
    const { executor } = fakeExecutor();
    const model = scriptedModel([{ content: "" }]);
    const result = await runCompanionAgent({
      message: "hmm",
      history: [],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
    });
    expect(result).toEqual({ kind: "pass-to-guru" });
  });

  it("forces a text reply on the final round instead of looping tools forever", async () => {
    const { executor } = fakeExecutor();
    const model = scriptedModel([
      { content: null, tool_calls: [toolCall("resume_messages", {}, "a")] },
      { content: null, tool_calls: [toolCall("resume_messages", {}, "b")] },
      { content: null, tool_calls: [toolCall("resume_messages", {}, "c")] },
      { content: "All set — you're resumed." },
    ]);
    const result = await runCompanionAgent({
      message: "resume",
      history: [],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
      maxRounds: 4,
    });
    expect(result.kind).toBe("reply");
    expect(model.bodies).toHaveLength(4);
    expect(model.bodies[3].tool_choice).toBe("none");
  });
});
