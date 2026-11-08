import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { mockTransport } from "../src/mock";
import { OpsKitProvider } from "../src/provider";
import { GatewayError, type K8sListResult, type PodSummary } from "../src/types";
import { usePodTable } from "../src/usePodTable";

const provenance = { source: "kubernetes" as const, query: "kind=Pod namespace=shop", fetchedAt: 0 };

function somePod(over: Partial<PodSummary> = {}): PodSummary {
  return {
    name: "checkout-abc",
    namespace: "shop",
    status: "Running",
    ready: 1,
    containers: 1,
    restarts: 0,
    node: "node-1",
    startedAt: 1_700_000_000_000,
    ...over,
  };
}

const someData: K8sListResult = { pods: [somePod()], provenance };

function setup(handler: (args: Record<string, unknown>) => unknown, selector?: string) {
  const spy = vi.fn(handler);
  const transport = mockTransport({ k8s_list: spy });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <OpsKitProvider transport={transport} refreshSeconds={0}>
      {children}
    </OpsKitProvider>
  );
  const hook = renderHook(() => usePodTable({ namespace: "shop", selector }), { wrapper });
  return { ...hook, spy };
}

describe("usePodTable", () => {
  it("goes from loading to ready", async () => {
    const { result } = setup(() => someData);
    expect(result.current.status).toBe("loading");
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.pods).toHaveLength(1);
    expect(result.current.provenance?.source).toBe("kubernetes");
  });

  it("asks the Gateway for pods in the namespace, with the selector", async () => {
    const { spy } = setup(() => someData, "app=checkout");
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![0]).toEqual({ kind: "Pod", namespace: "shop", labelSelector: "app=checkout" });
  });

  it("is empty when the namespace has no matching pods", async () => {
    const { result } = setup(() => ({ pods: [], provenance }));
    await waitFor(() => expect(result.current.status).toBe("empty"));
    expect(result.current.pods).toEqual([]);
  });

  it("is forbidden when RBAC says no, and keeps no data", async () => {
    const { result } = setup(() => {
      throw new GatewayError("forbidden", "No list on pods in this namespace.", { identity: "yoni" });
    });
    await waitFor(() => expect(result.current.status).toBe("forbidden"));
    expect(result.current.pods).toEqual([]);
    expect(result.current.error?.identity).toBe("yoni");
  });

  it("is an error when the Gateway rejects the request", async () => {
    const { result } = setup(() => {
      throw new GatewayError("invalid_query", "namespace is required");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.pods).toEqual([]);
  });

  it("is an error when the backend fails before any data arrived", async () => {
    const { result } = setup(() => {
      throw new GatewayError("unavailable", "could not reach the cluster");
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
  });

  it("keeps the last pods and marks them stale when a refresh fails", async () => {
    let calls = 0;
    const { result } = setup(() => {
      calls++;
      if (calls > 1) throw new GatewayError("unavailable", "could not reach the cluster");
      return someData;
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    result.current.refetch();
    await waitFor(() => expect(result.current.status).toBe("stale"));
    expect(result.current.pods).toHaveLength(1);
  });
});
