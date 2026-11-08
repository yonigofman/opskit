import { formatValue, limitSeries, seriesNames, toColumns } from "../src/components/format";

describe("formatValue", () => {
  it.each([
    [0.214, "s", "214ms"],
    [1.623, "s", "1.62s"],
    [1843, "ms", "1.84s"],
    [412, "ms", "412ms"],
    [4.83, "%", "4.8%"],
    [536870912, "B", "512MiB"],
    [312.4, "req/s", "312 req/s"],
    [15320, undefined, "15.3k"],
    [null, "s", "—"],
  ] as const)("%s %s → %s", (value, unit, expected) => {
    expect(formatValue(value, unit)).toBe(expected);
  });
});

describe("seriesNames", () => {
  it("names series by the label that differs", () => {
    const series = [
      { labels: { namespace: "shop", pod: "q2xlm" }, values: [] },
      { labels: { namespace: "shop", pod: "7hd2k" }, values: [] },
    ];
    expect(seriesNames(series, "x")).toEqual(["q2xlm", "7hd2k"]);
  });

  it("falls back to the title for a single unlabelled series", () => {
    expect(seriesNames([{ labels: {}, values: [] }], "p95")).toEqual(["p95"]);
  });
});

describe("limitSeries", () => {
  it("keeps the five highest by last value when there are more than six", () => {
    const series = Array.from({ length: 8 }, (_, i) => ({ labels: { i: String(i) }, values: [[0, i]] as Array<[number, number]> }));
    const { shown, hidden } = limitSeries(series);
    expect(shown.map((s) => s.labels.i)).toEqual(["7", "6", "5", "4", "3"]);
    expect(hidden).toBe(3);
  });
});

describe("toColumns", () => {
  it("aligns series on one time axis with gaps as null", () => {
    const cols = toColumns([
      { labels: {}, values: [[10, 1], [20, 2]] },
      { labels: {}, values: [[20, 5], [30, 6]] },
    ]);
    expect(cols).toEqual([[10, 20, 30], [1, 2, null], [null, 5, 6]]);
  });
});
