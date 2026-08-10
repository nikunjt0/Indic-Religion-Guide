import { describe, expect, it } from "vitest";
import { parseCommand } from "../lib/commands/router";

describe("parseCommand", () => {
  it("detects STOP variants deterministically", () => {
    for (const t of ["STOP", "stop", "Stop.", " stop!! ", "unsubscribe", "Opt out"]) {
      expect(parseCommand(t)).toEqual({ kind: "stop" });
    }
  });

  it("detects START and START NOW", () => {
    expect(parseCommand("START")).toEqual({ kind: "start", immediate: false });
    expect(parseCommand("start now")).toEqual({ kind: "start", immediate: true });
  });

  it("detects DELETE MY DATA", () => {
    expect(parseCommand("Delete my data")).toEqual({ kind: "delete-my-data" });
    expect(parseCommand("DELETE MY DATA!!")).toEqual({ kind: "delete-my-data" });
  });

  it("parses PAUSE with durations", () => {
    expect(parseCommand("PAUSE")).toEqual({ kind: "pause" });
    expect(parseCommand("pause 7 days")).toEqual({ kind: "pause", days: 7 });
    expect(parseCommand("Pause for 3 days")).toEqual({ kind: "pause", days: 3 });
    expect(parseCommand("pause a week")).toEqual({ kind: "pause", days: 7 });
  });

  it("leaves content continuations to the conversational layer", () => {
    // "deeper" after a lesson and "deeper" after a Q&A answer mean different
    // things — a deterministic keyword can't tell which the user means, so
    // these must NOT parse as commands.
    expect(parseCommand("deeper")).toBeNull();
    expect(parseCommand("more")).toBeNull();
    expect(parseCommand("KIDS")).toBeNull();
    expect(parseCommand("Source?")).toBeNull();
    expect(parseCommand("story")).toBeNull();
    expect(parseCommand("practice")).toBeNull();
    expect(parseCommand("simpler")).toBeNull();
  });

  it("detects natural-language delivery time changes", () => {
    expect(parseCommand("Hey can we switch my time to 6:25 PM")).toEqual({
      kind: "change-time",
      time: "18:25",
      needsMeridiem: false,
    });
    expect(parseCommand("CHANGE TIME 6:25 PM")).toEqual({
      kind: "change-time",
      time: "18:25",
      needsMeridiem: false,
    });
    expect(parseCommand("Can you reschedule the daily message for 7:15pm")).toEqual({
      kind: "change-time",
      time: "19:15",
      needsMeridiem: false,
    });
    expect(parseCommand("What no I'm talking about changing the daily text you send for Hinduism 101")).toEqual({
      kind: "change-time",
      time: undefined,
      needsMeridiem: undefined,
    });
    expect(parseCommand("No my scheduled time for the daily text.")).toEqual({
      kind: "change-time",
      time: undefined,
      needsMeridiem: undefined,
    });
  });

  it("flags ambiguous delivery time changes instead of guessing AM", () => {
    expect(parseCommand("switch my daily text to 6:25")).toEqual({
      kind: "change-time",
      time: "06:25",
      needsMeridiem: true,
    });
  });

  it("does not treat sentences containing command words as commands", () => {
    expect(parseCommand("please stop sending essays about karma")).toBeNull();
    expect(parseCommand("can I pause my puja during travel?")).toBeNull();
    expect(parseCommand("what is the source of the Gita?")).toBeNull();
    expect(parseCommand("how do I start a daily practice")).toBeNull();
    expect(parseCommand("can I schedule my daily puja for 7pm?")).toBeNull();
  });

  it("leaves enrollment requests to the conversational layer", () => {
    // Real transcript: this was mis-parsed as change-time ("set" + "teaching")
    // and silently suppressed instead of enrolling the user.
    expect(
      parseCommand("I want to do daily teaching + 7 days of Gita set me up with that")
    ).toBeNull();
    expect(parseCommand("set me up with daily teachings")).toBeNull();
    expect(parseCommand("sign me up for Hinduism 101")).toBeNull();
    expect(parseCommand("I want to join the Gita program at 7am")).toBeNull();
    expect(parseCommand("make my teachings shorter")).toBeNull();
  });

  it("returns null for empty / free-form text", () => {
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("What is dharma?")).toBeNull();
  });
});
