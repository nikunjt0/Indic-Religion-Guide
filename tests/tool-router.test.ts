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
