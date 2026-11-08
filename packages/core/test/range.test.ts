import { alignedRange, computeStep, formatAge, parseDuration } from "../src/range";

describe("parseDuration", () => {
  it.each([
    ["30s", 30],
    ["15m", 900],
    ["1h", 3600],
    ["1h30m", 5400],
    ["7d", 604800],
  ])("parses %s", (input, seconds) => {
    expect(parseDuration(input)).toBe(seconds);
  });

  it.each(["", "1x", "h1", "1h 30m", "0m", "-5m"])("rejects %j", (input) => {
    expect(() => parseDuration(input)).toThrow(/Invalid duration/);
  });
});

describe("computeStep", () => {
  it("keeps about one point per pixel, on a cache-friendly step", () => {
    expect(computeStep(3600, 400)).toBe(15);
    expect(computeStep(86400, 400)).toBe(300);
    expect(computeStep(604800, 800)).toBe(900);
  });

  it("never goes below the minimum step", () => {
    expect(computeStep(300, 2000)).toBe(15);
  });

  it("never returns more points than pixels", () => {
    for (const [range, width] of [[3600, 120], [86400, 333], [604800, 517]] as const) {
      expect(range / computeStep(range, width)).toBeLessThanOrEqual(width);
    }
  });
});

describe("alignedRange", () => {
  it("aligns the end to the step so caches hit", () => {
    const { start, end } = alignedRange(3600, 30, 1_700_000_017_000);
    expect(end % 30).toBe(0);
    expect(end - start).toBe(3600);
  });
});

describe("formatAge", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatAge(0, 4_000)).toBe("4s ago");
    expect(formatAge(0, 180_000)).toBe("3m ago");
    expect(formatAge(0, 7_200_000)).toBe("2h ago");
  });
});
