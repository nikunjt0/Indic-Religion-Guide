import { describe, expect, it } from "vitest";
import { intentFromToolCall, routeCompanionToolIntent } from "../lib/commands/tool-router";

describe("companion tool router", () => {
  it("maps change_delivery_time tool calls to a delivery-time intent", () => {
    expect(
      intentFromToolCall({
        type: "function",
        function: {
          name: "change_delivery_time",
          arguments: JSON.stringify({ time: "7:15pm" }),
        },
      })
    ).toEqual({ kind: "change-time", timeText: "7:15pm" });
  });

  it("starts the change-time flow when the tool call has no time", () => {
    expect(
      intentFromToolCall({
        type: "function",
        function: {
          name: "change_delivery_time",
          arguments: JSON.stringify({ time: "" }),
        },
      })
    ).toEqual({ kind: "start-change-time-flow" });
  });

  it("maps program setup tool calls to companion intents", () => {
    expect(
      intentFromToolCall({
        type: "function",
        function: { name: "list_programs", arguments: "{}" },
      })
    ).toEqual({ kind: "list-programs" });
    expect(
      intentFromToolCall({
        type: "function",
        function: {
          name: "enroll_in_program",
          arguments: JSON.stringify({ program: "Hinduism 101" }),
        },
      })
    ).toEqual({ kind: "enroll", programText: "Hinduism 101" });
    expect(
      intentFromToolCall({
        type: "function",
        function: { name: "show_my_program", arguments: "{}" },
      })
    ).toEqual({ kind: "show-my-program" });
    expect(
      intentFromToolCall({
        type: "function",
        function: { name: "show_app_help", arguments: "{}" },
      })
    ).toEqual({ kind: "show-help" });
  });

  it("falls back to the program list when enrollment names no program", () => {
    expect(
      intentFromToolCall({
        type: "function",
        function: { name: "enroll_in_program", arguments: JSON.stringify({ program: " " }) },
      })
    ).toEqual({ kind: "list-programs" });
  });

  it("offers program tools so enrollment questions stay in-app", async () => {
    const seenBodies: Record<string, unknown>[] = [];
    const intent = await routeCompanionToolIntent(
      "What are other programs I can enroll in for daily messages",
      async (body) => {
        seenBodies.push(body);
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  { type: "function", function: { name: "list_programs", arguments: "{}" } },
                ],
              },
            },
          ],
        };
      }
    );

    expect(intent).toEqual({ kind: "list-programs" });
    const tools = seenBodies[0]?.tools as { function: { name: string } }[];
    const names = tools.map((t) => t.function.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list_programs",
        "enroll_in_program",
        "show_my_program",
        "show_app_help",
      ])
    );
  });

  it("returns none when the model calls no account-action tool", async () => {
    const intent = await routeCompanionToolIntent(
      "can I schedule my daily puja for 7pm?",
      async () => ({
        choices: [{ message: {} }],
      })
    );

    expect(intent).toEqual({ kind: "none" });
  });

  it("routes natural app schedule language through model tool calls", async () => {
    const seenBodies: Record<string, unknown>[] = [];
    const intent = await routeCompanionToolIntent(
      "Can you reschedule the daily message for 7:15pm",
      async (body) => {
        seenBodies.push(body);
        return {
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: "function",
                    function: {
                      name: "change_delivery_time",
                      arguments: JSON.stringify({ time: "7:15pm" }),
                    },
                  },
                ],
              },
            },
          ],
        };
      }
    );

    expect(intent).toEqual({ kind: "change-time", timeText: "7:15pm" });
    expect(seenBodies[0]?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: "change_delivery_time" }),
        }),
      ])
    );
  });
});
