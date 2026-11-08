import { Renderer } from "@openuidev/react-lang";
import { GatewayError, mockTransport, OpsKitProvider, type PromInstantResult, type PromRangeResult } from "@opskit/core";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StatTile } from "../src/components/stat-tile";
import { opskitLibrary } from "../src/openui";

// openui.tsx also registers PromChart, which imports uplot; jsdom has no canvas.
vi.mock("uplot", () => ({
  default: class {
    constructor() {}
    setData() {}
    setSize() {}
    destroy() {}
  },
}));

const provenance = {
  source: "prometheus" as const,
  query: "p95",
  identity: "yoni",
  injected: 'namespace=~"shop"',
  fetchedAt: Date.now(),
};
const instant: PromInstantResult = { value: 0.62, provenance };
const range: PromRangeResult = {
  series: [{ labels: {}, values: [[1, 0.5], [2, 0.6], [3, 0.62]] }],
  provenance,
};

function withTransport(
  instantHandler: (args: Record<string, unknown>) => unknown,
  rangeHandler: (args: Record<string, unknown>) => unknown = () => range,
) {
  const transport = mockTransport({ prom_instant: instantHandler, prom_range: rangeHandler });
  return ({ children }: { children: ReactNode }) => (
    <OpsKitProvider transport={transport} refreshSeconds={0}>
      {children}
    </OpsKitProvider>
  );
}

describe("StatTile", () => {
  it("shows the live value and the query that produced it", async () => {
    render(<StatTile label="p95 latency" query="p95" unit="s" />, { wrapper: withTransport(() => instant) });

    await waitFor(() => expect(screen.getByText("620ms")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "p95 latency" })).toBeTruthy();
    expect(screen.getAllByText("p95").length).toBeGreaterThan(0);
    expect(screen.getByText(/as yoni/)).toBeTruthy();
  });

  it("colors the number and badge when past the danger threshold", async () => {
    render(<StatTile label="p95 latency" query="p95" unit="s" dangerAt={0.5} />, {
      wrapper: withTransport(() => instant),
    });
    await waitFor(() => expect(screen.getByText("Danger")).toBeTruthy());
  });

  it("shows forbidden without any data", async () => {
    render(<StatTile label="p95" query="p95" />, {
      wrapper: withTransport(() => {
        throw new GatewayError("forbidden", "No access to payments.", { identity: "yoni" });
      }),
    });
    await waitFor(() => expect(screen.getByText(/You can't read this metric here/)).toBeTruthy());
    expect(screen.getByText(/Ran as yoni/)).toBeTruthy();
  });

  it("underlines where the query broke", async () => {
    const { container } = render(<StatTile label="errors" query="sum(rate(x[5m])))" />, {
      wrapper: withTransport(() => {
        throw new GatewayError("invalid_query", "unexpected )", { position: 16 });
      }),
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(container.querySelector("mark")?.textContent).toBe(")");
  });

  it("says so when the query has no value", async () => {
    render(<StatTile label="queue" query="queue_depth" range="15m" />, {
      wrapper: withTransport(() => ({ value: null, provenance })),
    });
    await waitFor(() => expect(screen.getByText("No value for this query")).toBeTruthy());
  });

  it("keeps the last value, dimmed, when a refresh fails", async () => {
    let fail = false;
    render(<StatTile label="p95" query="p95" unit="s" refreshSeconds={1} />, {
      wrapper: withTransport(() => {
        if (fail) throw new GatewayError("unavailable", "Mimir timed out");
        return instant;
      }),
    });
    await waitFor(() => expect(screen.getByText("620ms")).toBeTruthy());
    fail = true;
  });
});

describe("opskitLibrary", () => {
  it("renders agent output into live StatTiles", async () => {
    const program = ['root = Stack([tile])', 'tile = StatTile("p95 latency", "p95", "1h", "s")'].join("\n");

    render(<Renderer library={opskitLibrary} response={program} />, { wrapper: withTransport(() => instant) });

    await waitFor(() => expect(screen.getByText("620ms")).toBeTruthy());
  });

  it("describes StatTile to the model as taking a query", () => {
    const prompt = opskitLibrary.prompt();
    expect(prompt).toContain("StatTile(");
    expect(prompt).toContain("query");
  });
});
