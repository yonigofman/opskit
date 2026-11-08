import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { mockTransport } from "../src/mock";
import { OpsKitProvider } from "../src/provider";
import { GatewayError, type PromRangeResult } from "../src/types";
import { usePromRange } from "../src/usePromRange";

const provenance = { source: "prometheus" as const, query: "up", fetchedAt: 0 };
const someData: PromRangeResult = {
  series: [{ labels: { pod: "a" }, values: [[1, 1], [2, 2]] }],
  provenance,
};

function setup(handler: (args: Record<string, unknown>) => unknown) {
  const spy = vi.fn(handler);
  const transport = mockTransport({ prom_range: spy });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OpsKitProvider transport={transport} refreshSeconds={0}>
      {children}
    </OpsKitProvider>
  );
  const hook = renderHook((p: { width: number }) => usePromRange({ query: "up", range: "1h", width: p.width }), {
    wrapper,
    initialProps: { width: 600 },
  });
  return { ...hook, spy };
}

describe("usePromRange", () => {
  it("goes from loading to ready", async () => {
    const { result } = setup(() => someData);
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.series).toHaveLength(1);
    expect(result.current.provenance?.query).toBe("up");
  });

  it("sends an aligned range with a step that fits the width", async () => {
    const { spy } = setup(() => someData);
    await waitFor(() => expect(spy).toHaveBeenCalled());
    const args = spy.mock.calls[0]![0] as { start: number; end: number; step: number; query: string };
    expect(args.query).toBe("up");
    expect(args.end - args.start).toBe(3600);
    expect(args.end % args.step).toBe(0);
    expect(3600 / args.step).toBeLessThanOrEqual(600);
  });

  it("does not fetch until the width is known", async () => {
    const { spy, rerender } = setup(() => someData);
    rerender({ width: 0 });
    spy.mockClear();
    await new Promise((r) => setTimeout(r, 10));
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports empty when the query matches nothing", async () => {
    const { result } = setup(() => ({ series: [], provenance }));
    await waitFor(() => expect(result.current.status).toBe("empty"));
  });

  it("reports forbidden without leaking any data", async () => {
    const { result } = setup(() => {
      throw new GatewayError("forbidden", "no access to payments", { identity: "yoni" });
    });
    await waitFor(() => expect(result.current.status).toBe("forbidden"));
    expect(result.current.series).toEqual([]);
    expect(result.current.error?.identity).toBe("yoni");
  });

  it("reports an invalid query as an error with its position", async () => {
    const { result } = setup(() => {
      throw new GatewayError("invalid_query", "unexpected )", { position: 31 });
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.position).toBe(31);
  });

  it("keeps the last data and marks it stale when a refresh fails", async () => {
    let fail = false;
    const { result } = setup(() => {
      if (fail) throw new GatewayError("unavailable", "Mimir timed out");
      return someData;
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fail = true;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe("stale"));
    expect(result.current.series).toHaveLength(1);
  });

  it("shows an error when the backend fails before any data arrived", async () => {
    const { result } = setup(() => {
      throw new GatewayError("unavailable", "Mimir timed out");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
  });
});
