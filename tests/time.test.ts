import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  isInQuietHours,
  localDateOf,
  nextOccurrence,
  parseLocalTime,
  parseUserTimeInput,
} from "../lib/scheduling/time";

const msAt = (iso: string, zone: string) => DateTime.fromISO(iso, { zone }).toMillis();

describe("nextOccurrence", () => {
  it("finds later-today when preferred time has not passed", () => {
    const after = msAt("2026-07-30T05:00:00", "America/Chicago");
    const { atMs, localDate } = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      after
    );
    expect(DateTime.fromMillis(atMs, { zone: "America/Chicago" }).toISO()).toBe(
      "2026-07-30T07:30:00.000-05:00"
    );
    expect(localDate).toBe("2026-07-30");
  });

  it("rolls to tomorrow when preferred time already passed", () => {
    const after = msAt("2026-07-30T08:00:00", "America/Chicago");
    const { localDate } = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      after
    );
    expect(localDate).toBe("2026-07-31");
  });

  it("is strictly after: exactly at preferred time rolls forward", () => {
    const after = msAt("2026-07-30T07:30:00", "America/Chicago");
    const { localDate } = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      after
    );
    expect(localDate).toBe("2026-07-31");
  });

  it("America/Chicago spring-forward: local intent preserved across DST start", () => {
    // DST begins 2026-03-08 in the US. 07:30 the day before is CST (-6),
    // 07:30 the day of is CDT (-5) — the wall-clock intent stays 07:30.
    const before = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      msAt("2026-03-07T00:00:00", "America/Chicago")
    );
    const during = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      msAt("2026-03-08T00:00:00", "America/Chicago")
    );
    expect(DateTime.fromMillis(before.atMs, { zone: "America/Chicago" }).toFormat("HH:mm ZZ")).toBe(
      "07:30 -06:00"
    );
    expect(DateTime.fromMillis(during.atMs, { zone: "America/Chicago" }).toFormat("HH:mm ZZ")).toBe(
      "07:30 -05:00"
    );
    // 23h apart in real time, same wall-clock time.
    expect(during.atMs - before.atMs).toBe(23 * 3_600_000);
  });

  it("America/Chicago fall-back: 24h wall-clock becomes 25h real time", () => {
    const before = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      msAt("2026-10-31T00:00:00", "America/Chicago")
    );
    const after = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      before.atMs
    );
    expect(after.atMs - before.atMs).toBe(25 * 3_600_000);
    expect(after.localDate).toBe("2026-11-01");
  });

  it("preferred time in the skipped DST hour resolves forward (never crashes)", () => {
    const { atMs, localDate } = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "02:30" },
      msAt("2026-03-08T00:00:00", "America/Chicago")
    );
    // 02:30 does not exist on 2026-03-08; luxon shifts to 03:30 CDT.
    expect(DateTime.fromMillis(atMs, { zone: "America/Chicago" }).toFormat("HH:mm ZZ")).toBe(
      "03:30 -05:00"
    );
    expect(localDate).toBe("2026-03-08");
  });

  it("preferred time in the repeated DST hour picks the first occurrence", () => {
    const { atMs } = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "01:30" },
      msAt("2026-11-01T00:00:00", "America/Chicago")
    );
    expect(DateTime.fromMillis(atMs, { zone: "America/Chicago" }).toFormat("HH:mm ZZ")).toBe(
      "01:30 -05:00" // CDT — the earlier of the two 01:30s
    );
  });

  it("handles America/New_York, America/Los_Angeles, Asia/Kolkata, Europe/London", () => {
    for (const zone of [
      "America/New_York",
      "America/Los_Angeles",
      "Asia/Kolkata",
      "Europe/London",
    ]) {
      const { atMs } = nextOccurrence(
        { timezone: zone, preferredLocalTime: "06:00" },
        msAt("2026-07-30T00:00:00", zone)
      );
      expect(DateTime.fromMillis(atMs, { zone }).toFormat("HH:mm")).toBe("06:00");
    }
  });

  it("timezone change changes the UTC instant but keeps local intent", () => {
    const after = Date.UTC(2026, 6, 30);
    const chicago = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      after
    );
    const kolkata = nextOccurrence(
      { timezone: "Asia/Kolkata", preferredLocalTime: "07:30" },
      after
    );
    expect(chicago.atMs).not.toBe(kolkata.atMs);
  });

  it("respects deliveryDays (weekday mask)", () => {
    // 2026-07-30 is a Thursday (ISO weekday 4). Only Mondays allowed → next is Aug 3.
    const { localDate } = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30", deliveryDays: [1] },
      msAt("2026-07-30T00:00:00", "America/Chicago")
    );
    expect(localDate).toBe("2026-08-03");
  });

  it("leap day", () => {
    const { localDate } = nextOccurrence(
      { timezone: "America/Chicago", preferredLocalTime: "07:30" },
      msAt("2028-02-28T12:00:00", "America/Chicago")
    );
    expect(localDate).toBe("2028-02-29");
  });

  it("month-end and year-end rollovers", () => {
    expect(
      nextOccurrence(
        { timezone: "Asia/Kolkata", preferredLocalTime: "07:30" },
        msAt("2026-01-31T09:00:00", "Asia/Kolkata")
      ).localDate
    ).toBe("2026-02-01");
    expect(
      nextOccurrence(
        { timezone: "Asia/Kolkata", preferredLocalTime: "07:30" },
        msAt("2026-12-31T09:00:00", "Asia/Kolkata")
      ).localDate
    ).toBe("2027-01-01");
  });

  it("rejects invalid inputs", () => {
    expect(() =>
      nextOccurrence({ timezone: "Not/AZone", preferredLocalTime: "07:30" }, 0)
    ).toThrow();
    expect(() =>
      nextOccurrence({ timezone: "America/Chicago", preferredLocalTime: "25:99" }, 0)
    ).toThrow();
  });
});

describe("parseLocalTime", () => {
  it("accepts HH:mm", () => {
    expect(parseLocalTime("07:30")).toEqual({ hour: 7, minute: 30 });
    expect(parseLocalTime("23:59")).toEqual({ hour: 23, minute: 59 });
  });
  it("rejects garbage", () => {
    expect(parseLocalTime("7:5")).toBeNull();
    expect(parseLocalTime("24:00")).toBeNull();
    expect(parseLocalTime("soon")).toBeNull();
  });
});

describe("parseUserTimeInput", () => {
  it("parses explicit times", () => {
    expect(parseUserTimeInput("7:30 AM")).toBe("07:30");
    expect(parseUserTimeInput("7:30pm")).toBe("19:30");
    expect(parseUserTimeInput("12 am")).toBe("00:00");
    expect(parseUserTimeInput("12:15 pm")).toBe("12:15");
    expect(parseUserTimeInput("19:00")).toBe("19:00");
  });
  it("maps dayparts", () => {
    expect(parseUserTimeInput("after dinner")).toBe("19:30");
    expect(parseUserTimeInput("in the morning please")).toBe("07:30");
    expect(parseUserTimeInput("before bed")).toBe("21:00");
  });
  it("returns null for unparseable input", () => {
    expect(parseUserTimeInput("whenever")).toBeNull();
  });
});

describe("quiet hours", () => {
  it("same-day window", () => {
    const at = msAt("2026-07-30T13:00:00", "America/Chicago");
    expect(isInQuietHours(at, "America/Chicago", "12:00", "14:00")).toBe(true);
    expect(isInQuietHours(at, "America/Chicago", "14:00", "16:00")).toBe(false);
  });
  it("overnight window", () => {
    const night = msAt("2026-07-30T23:00:00", "America/Chicago");
    const morning = msAt("2026-07-30T06:30:00", "America/Chicago");
    const day = msAt("2026-07-30T12:00:00", "America/Chicago");
    expect(isInQuietHours(night, "America/Chicago", "22:00", "07:00")).toBe(true);
    expect(isInQuietHours(morning, "America/Chicago", "22:00", "07:00")).toBe(true);
    expect(isInQuietHours(day, "America/Chicago", "22:00", "07:00")).toBe(false);
  });
});

describe("localDateOf", () => {
  it("returns the local calendar date", () => {
    const ms = Date.UTC(2026, 6, 31, 2, 0); // 02:00 UTC Jul 31
    expect(localDateOf(ms, "America/Chicago")).toBe("2026-07-30");
    expect(localDateOf(ms, "Asia/Kolkata")).toBe("2026-07-31");
  });
});
