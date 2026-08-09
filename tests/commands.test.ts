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

  it("detects lesson reply keywords", () => {
    expect(parseCommand("deeper")).toEqual({ kind: "deeper" });
    expect(parseCommand("KIDS")).toEqual({ kind: "kids" });
    expect(parseCommand("Source?")).toEqual({ kind: "source" });
    expect(parseCommand("story")).toEqual({ kind: "story" });
  });

  it("does not treat sentences containing command words as commands", () => {
    expect(parseCommand("please stop sending essays about karma")).toBeNull();
    expect(parseCommand("can I pause my puja during travel?")).toBeNull();
    expect(parseCommand("what is the source of the Gita?")).toBeNull();
    expect(parseCommand("how do I start a daily practice")).toBeNull();
  });

  it("returns null for empty / free-form text", () => {
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("What is dharma?")).toBeNull();
  });
});
