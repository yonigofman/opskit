import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { mockTransport } from "../src/mock";
import { OpsKitProvider } from "../src/provider";
import { GatewayError, type PromInstantResult, type PromRangeResult } from "../src/types";
import { useStatTile } from "../src/useStatTile";

const provenance = { source: "prometheus" as const, query: "up", fetchedAt: 0 };
const instant: PromInstantResult = { value: 305, provenance };
const range: PromRangeResult = {
  series: [{ labels: { app: "checkout" }, values: [[1, 300], [2, 305]] }],
  provenance,
};

function setup(
  instantHandler: (args: Record<string, unknown>) => unknown,
  rangeHandler: (args: Record<string, unknown>) => unknown = () => range,
) {
  const transport = mockTransport({ prom_instant: instantHandler, prom_range: rangeHandler });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OpsKitProvider transport={transport} refreshSeconds={0}>
      {children}
    </OpsKitProvider>
  );
  return renderHook((p: { width: number }) => useStatTile({ query: "up", range: "1h", width: p.width }), {
    wrapper,
    initialProps: { width: 200 },
  });
}

describe("useStatTile", () => {
  it("goes from loading to ready, with the sparkline alongside", async () => {
    const { result } = setup(() => instant);
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.value).toBe(305);
    await waitFor(() => expect(result.current.series).toHaveLength(1));
  });

  it("reports empty when the instant query has no value", async () => {
    const { result } = setup(() => ({ value: null, provenance }));
    await waitFor(() => expect(result.current.status).toBe("empty"));
  });

  it("reports forbidden without leaking a value", async () => {
    const { result } = setup(() => {
      throw new GatewayError("forbidden", "no access to payments", { identity: "yoni" });
    });
    await waitFor(() => expect(result.current.status).toBe("forbidden"));
    expect(result.current.value).toBeNull();
    expect(result.current.error?.identity).toBe("yoni");
  });

  it("reports an invalid query as an error with its position", async () => {
    const { result } = setup(() => {
      throw new GatewayError("invalid_query", "unexpected )", { position: 7 });
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.position).toBe(7);
  });

  it("keeps the last value and marks it stale when a refresh fails", async () => {
    let fail = false;
    const { result } = setup(() => {
      if (fail) throw new GatewayError("unavailable", "Mimir timed out");
      return instant;
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    fail = true;
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.status).toBe("stale"));
    expect(result.current.value).toBe(305);
  });

  it("drops the sparkline quietly when the range query fails, without changing status", async () => {
    const { result } = setup(
      () => instant,
      () => {
        throw new GatewayError("unavailable", "Mimir timed out");
      },
    );
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.series).toEqual([]);
  });
});
