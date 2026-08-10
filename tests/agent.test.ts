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
    programs: [
      {
        slug: "hinduism-101",
        title: "Hinduism 101",
        day: 2,
        durationDays: 21,
        lessonsDelivered: 1,
      },
    ],
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
    leaveProgram: stub("leaveProgram"),
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
    expect(prompt).toContain("Default delivery time: 8:51 PM (America/Chicago)");
    expect(prompt).toContain("seven-hindu-stories-for-families");
    expect(prompt).toContain("Daily Dharma (one standalone teaching a day): off");
    expect(prompt).toContain("Never tell them to text a code");
    // Continuations ("deeper", "kids version") are resolved from history, not
    // treated as menu keywords.
    expect(prompt).toContain("never treat it as a menu keyword");
    expect(prompt).toContain("get_lesson_content");
    expect(prompt).toContain("reworded to stand alone");
  });

  it("lists every concurrent program with its own delivery time", () => {
    const prompt = buildCompanionSystemPrompt(
      snapshot({
        programs: [
          { slug: "hinduism-101", title: "Hinduism 101", day: 2, durationDays: 21, lessonsDelivered: 1 },
          {
            slug: "seven-hindu-stories-for-families",
            title: "Seven Hindu Stories for Families",
            day: 1,
            durationDays: 7,
            lessonsDelivered: 0,
            deliveryTimeText: "9:00 AM (America/Chicago)",
          },
        ],
        dailyDharmaEnabled: true,
        dailyDharmaTimeText: "6:00 AM (America/Chicago)",
      })
    );
    expect(prompt).toContain("Hinduism 101 — day 2 of 21 (1 lesson delivered so far), arrives at the default time");
    expect(prompt).toContain(
      "Seven Hindu Stories for Families — day 1 of 7 (0 lessons delivered so far), arrives at 9:00 AM (America/Chicago)"
    );
    expect(prompt).toContain("on, arrives at 6:00 AM (America/Chicago)");
    expect(prompt).toContain("several programs at the same time");
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
        args: { programSlug: "seven-hindu-stories-for-families", time: undefined },
      },
    ]);
    // The tool result went back to the model verbatim as JSON.
    const secondBody = model.bodies[1].messages as Record<string, unknown>[];
    const toolMsg = secondBody.find((m) => m.role === "tool");
    expect(JSON.parse(toolMsg!.content as string)).toMatchObject({ status: "enrolled" });
  });

  it("passes per-stream times through: enroll at 9am, existing program untouched", async () => {
    const { executor, calls } = fakeExecutor();
    const model = scriptedModel([
      {
        content: null,
        tool_calls: [
          toolCall("enroll_in_program", {
            program_slug: "seven-hindu-stories-for-families",
            time: "9am",
          }),
        ],
      },
      { content: "The stories will arrive at 9:00 AM; Hinduism 101 stays at 8:51 PM." },
    ]);
    const result = await runCompanionAgent({
      message: "Add the stories program at 9am but keep Hinduism 101 at 8:51pm",
      history: [],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
    });
    expect(result.kind).toBe("reply");
    expect(calls).toEqual([
      {
        name: "enrollInProgram",
        args: { programSlug: "seven-hindu-stories-for-families", time: "9am" },
      },
    ]);
  });

  it("routes a targeted time change to the named stream", async () => {
    const { executor, calls } = fakeExecutor();
    const model = scriptedModel([
      {
        content: null,
        tool_calls: [toolCall("change_delivery_time", { time: "9am", target: "daily-dharma" })],
      },
      { content: "Daily Dharma now arrives at 9:00 AM; everything else is unchanged." },
    ]);
    const result = await runCompanionAgent({
      message: "make daily dharma 9am but leave my program alone",
      history: [],
      snapshot: snapshot({ dailyDharmaEnabled: true }),
      executor,
      createCompletion: model.create,
    });
    expect(result.kind).toBe("reply");
    expect(calls).toEqual([
      { name: "changeDeliveryTime", args: { time: "9am", target: "daily-dharma" } },
    ]);
  });

  it("hands a pure scripture question to the guru with its standalone rewording", async () => {
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
    expect(result).toEqual({ kind: "pass-to-guru", question: "What is karma?" });
    expect(calls).toEqual([]);
    expect(model.bodies).toHaveLength(1);
  });

  it("answers a lesson continuation from get_lesson_content instead of passing to the guru", async () => {
    const { executor, calls } = fakeExecutor({
      getLessonContent: async (args) => {
        calls.push({ name: "getLessonContent", args });
        return {
          programId: "seven-hindu-stories-for-families",
          day: 1,
          title: "Ganesha and the Race Around the World",
          deeperMessage: "This story rewards a second look…",
        };
      },
    });
    const model = scriptedModel([
      {
        content: null,
        tool_calls: [
          toolCall("get_lesson_content", { program_slug: "seven-hindu-stories-for-families" }),
        ],
      },
      { content: "This story rewards a second look…" },
    ]);
    const result = await runCompanionAgent({
      message: "deeper",
      history: [
        { role: "assistant", content: "STORY 1 OF 7 — GANESHA AND THE RACE AROUND THE WORLD…" },
      ],
      snapshot: snapshot(),
      executor,
      createCompletion: model.create,
    });
    expect(result.kind).toBe("reply");
    if (result.kind === "reply") expect(result.text).toContain("second look");
    expect(calls).toEqual([
      { name: "getLessonContent", args: { programSlug: "seven-hindu-stories-for-families" } },
    ]);
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
