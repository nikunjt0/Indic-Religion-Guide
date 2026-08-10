import { describe, expect, it } from "vitest";
import {
  buildCondenseMessages,
  condenseFollowUpQuestion,
} from "../lib/rag/condense";

describe("follow-up condensation", () => {
  it("builds a prompt with the recent turns and the newest message", () => {
    const messages = buildCondenseMessages(
      "What will happen if I take it home and use it for charge?",
      [
        {
          role: "user",
          content: "Can I take an unclaimed charger from a table at work?",
        },
        {
          role: "assistant",
          content: "Taking another's property without permission is discouraged…",
        },
      ],
    );
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("standalone question");
    // The newest intent must be preserved, not the prior turn's question.
    expect(messages[0].content).toContain("Never re-ask an earlier turn's question");
    expect(messages[1].content).toContain("User: Can I take an unclaimed charger");
    expect(messages[1].content).toContain("Guide: Taking another's property");
    expect(messages[1].content).toContain(
      "NEWEST MESSAGE:\nWhat will happen if I take it home and use it for charge?",
    );
  });

  it("keeps only the last turns and truncates long ones", () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn ${i} ${"x".repeat(1000)}`,
    }));
    const messages = buildCondenseMessages("and then?", history);
    expect(messages[1].content).not.toContain("turn 3 ");
    expect(messages[1].content).toContain("turn 4 ");
    expect(messages[1].content).toContain("turn 9 ");
    // 600-char cap per turn: the 1000-x run is cut down.
    expect(messages[1].content).not.toContain("x".repeat(700));
  });

  it("returns null without calling the API when there is nothing to condense", async () => {
    // No OPENAI_API_KEY in tests — these would throw if the client were touched.
    await expect(condenseFollowUpQuestion("first question", [])).resolves.toBeNull();
    await expect(
      condenseFollowUpQuestion("   ", [{ role: "user", content: "hi" }]),
    ).resolves.toBeNull();
  });
});
