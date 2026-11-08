import { Renderer } from "@openuidev/react-lang";
import { GatewayError, mockTransport, OpsKitProvider, type PromRangeResult } from "@opskit/core";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { PromChart } from "../src/components/opskit/prom-chart";
import { opskitLibrary } from "../src/openui";

// jsdom has no canvas; the chart's own logic is covered by format tests.
vi.mock("uplot", () => ({
  default: class {
    constructor() {}
    setData() {}
    setSize() {}
    destroy() {}
  },
}));

const result: PromRangeResult = {
  series: [{ labels: { app: "checkout" }, values: [[1, 0.21], [2, 1.62]] }],
  provenance: {
    source: "prometheus",
    query: 'p95{namespace=~"shop"}',
    identity: "yoni",
    injected: 'namespace=~"shop"',
    fetchedAt: Date.now(),
  },
};

function withTransport(handler: (args: Record<string, unknown>) => unknown) {
  const transport = mockTransport({ prom_range: handler });
  return ({ children }: { children: ReactNode }) => (
    <OpsKitProvider transport={transport} refreshSeconds={0}>
      {children}
    </OpsKitProvider>
  );
}

describe("PromChart", () => {
  it("shows the live value and the query that produced it", async () => {
    render(<PromChart title="p95 latency" query="p95" unit="s" />, { wrapper: withTransport(() => result) });

    await waitFor(() => expect(screen.getByText("1.62s")).toBeTruthy());
    expect(screen.getByRole("heading", { name: "p95 latency · 1h" })).toBeTruthy();
    expect(screen.getAllByText('p95{namespace=~"shop"}').length).toBeGreaterThan(0);
    expect(screen.getByText(/as yoni/)).toBeTruthy();
  });

  it("shows forbidden without any data", async () => {
    render(<PromChart title="p95" query="p95" />, {
      wrapper: withTransport(() => {
        throw new GatewayError("forbidden", "No access to payments.", { identity: "yoni" });
      }),
    });
    await waitFor(() => expect(screen.getByText(/You can't read these metrics here/)).toBeTruthy());
    expect(screen.getByText(/Ran as yoni/)).toBeTruthy();
  });

  it("underlines where the query broke", async () => {
    const { container } = render(<PromChart title="errors" query="sum(rate(x[5m])))" />, {
      wrapper: withTransport(() => {
        throw new GatewayError("invalid_query", "unexpected )", { position: 16 });
      }),
    });
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(container.querySelector("mark")?.textContent).toBe(")");
  });

  it("says so when nothing matches", async () => {
    render(<PromChart title="queue" query="queue_depth" range="15m" />, {
      wrapper: withTransport(() => ({ series: [], provenance: result.provenance })),
    });
    await waitFor(() => expect(screen.getByText("No series in this range")).toBeTruthy());
  });
});

describe("opskitLibrary", () => {
  it("renders agent output into live components", async () => {
    const program = [
      "root = Stack([title, latency])",
      'title = Heading("Checkout slowed after rev 42")',
      'latency = PromChart("p95 latency", "p95", "1h", "s")',
    ].join("\n");

    render(<Renderer library={opskitLibrary} response={program} />, { wrapper: withTransport(() => result) });

    expect(await screen.findByText("Checkout slowed after rev 42")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("1.62s")).toBeTruthy());
  });

  it("describes PromChart to the model as taking a query", () => {
    const prompt = opskitLibrary.prompt();
    expect(prompt).toContain("PromChart(");
    expect(prompt).toContain("query");
  });
});
