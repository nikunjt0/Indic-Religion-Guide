import { describe, expect, it } from "vitest";
import {
  citationTailFromSources,
  citationTailWithUrl,
  compactSourceLabels,
} from "../bridge/src/format";
import type { SourceGroup } from "../lib/types/firestore";

const headacheSources: SourceGroup[] = [
  {
    index: 1,
    source_title: "The Complete Book of Ayurvedic Home Remedies",
    quotes: [
      {
        id: "a",
        source_title: "The Complete Book of Ayurvedic Home Remedies",
        chapter: null,
        verse: null,
        page: 193,
        text: "EAT SOMETHING SWEET...",
      },
      {
        id: "b",
        source_title: "The Complete Book of Ayurvedic Home Remedies",
        chapter: null,
        verse: null,
        page: 228,
        text: "First thing in the morning, take 1 ripe banana...",
      },
    ],
  },
  {
    index: 2,
    source_title: "Charaka Samhita",
    quotes: [
      {
        id: "c",
        source_title: "Charaka Samhita",
        chapter: "Su3",
        verse: "23",
        page: 12,
        text: "The following paste is used for headache...",
      },
    ],
  },
];

describe("SMS citation formatting", () => {
  it("formats compact source labels with references", () => {
    expect(compactSourceLabels(headacheSources)).toEqual([
      "Ayurvedic Home Remedies pp.193, 228",
      "Charaka Samhita Su3.23",
    ]);
  });

  it("keeps compact citations when no URL is available", () => {
    expect(citationTailFromSources(headacheSources)).toBe(
      "\n\nSources: Ayurvedic Home Remedies pp.193, 228; Charaka Samhita Su3.23"
    );
  });

  it("keeps the full source URL at the bottom when available", () => {
    expect(citationTailWithUrl(headacheSources, "https://example.com/q/abc")).toBe(
      "\n\nSources: Ayurvedic Home Remedies pp.193, 228; Charaka Samhita Su3.23\nFull source excerpts: https://example.com/q/abc"
    );
  });
});
