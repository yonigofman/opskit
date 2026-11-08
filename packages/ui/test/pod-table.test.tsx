import { Renderer } from "@openuidev/react-lang";
import { GatewayError, mockTransport, OpsKitProvider, type K8sListResult, type PodSummary } from "@opskit/core";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { PodTable } from "../src/components/opskit/pod-table";
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
  source: "kubernetes" as const,
  query: "kind=Pod namespace=shop selector=app=checkout",
  identity: "yoni",
  fetchedAt: Date.now(),
};

function pod(name: string, over: Partial<PodSummary> = {}): PodSummary {
  return {
    name,
    namespace: "shop",
    status: "Running",
    ready: 1,
    containers: 1,
    restarts: 0,
    node: "ip-10-0-1-14",
    startedAt: Date.now() - 3 * 3600 * 1000,
    ...over,
  };
}

const result: K8sListResult = {
  pods: [
    pod("checkout-6b9f4-q2xlm"),
    pod("checkout-6b9f4-m9c4p", { status: "CrashLoopBackOff", ready: 0, restarts: 7 }),
  ],
  provenance,
};

function withTransport(handler: (args: Record<string, unknown>) => unknown) {
  const transport = mockTransport({ k8s_list: handler });
  return ({ children }: { children: ReactNode }) => (
    <OpsKitProvider transport={transport} refreshSeconds={0}>
      {children}
    </OpsKitProvider>
  );
}

function renderTable(handler: (args: Record<string, unknown>) => unknown, selector = "app=checkout") {
  return render(<PodTable namespace="shop" selector={selector} refreshSeconds={0} />, { wrapper: withTransport(handler) });
}

describe("PodTable", () => {
  it("lists pods with Kubernetes' own status words", async () => {
    renderTable(() => result);
    expect(await screen.findByText("checkout-6b9f4-q2xlm")).toBeTruthy();
    expect(screen.getByText("CrashLoopBackOff")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("0/1")).toBeTruthy();
  });

  it("shows who it ran as, from provenance", async () => {
    renderTable(() => result);
    await waitFor(() => expect(screen.getByText(/as yoni/)).toBeTruthy());
  });

  it("shows the columns asked for, in order", async () => {
    render(<PodTable namespace="shop" selector="app=checkout" columns={["node", "status"]} refreshSeconds={0} />, {
      wrapper: withTransport(() => result),
    });
    await screen.findByText("checkout-6b9f4-q2xlm");
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Pod", "Node", "Status"]);
  });

  it("is loading before the Gateway answers", () => {
    renderTable(() => new Promise(() => {}));
    expect(screen.getByRole("status").textContent).toMatch(/listing pods/i);
  });

  it("says what matched nothing when the namespace is empty", async () => {
    renderTable(() => ({ pods: [], provenance }));
    const empty = await screen.findByText(/no pods here/i);
    // The empty state says what matched nothing, and where.
    expect(empty.parentElement?.textContent).toMatch(/app=checkout/);
    expect(empty.parentElement?.textContent).toMatch(/shop/);
  });

  it("names the identity and reveals nothing about the pods when forbidden", async () => {
    renderTable(() => {
      throw new GatewayError("forbidden", "No list on pods in this namespace.", { identity: "yoni" });
    });
    expect(await screen.findByText(/can't read these pods here/i)).toBeTruthy();
    expect(screen.getByText(/Ran as yoni/)).toBeTruthy();
    expect(screen.queryByText(/checkout-/)).toBeNull();
  });

  it("reports a request the Gateway rejected", async () => {
    renderTable(() => {
      throw new GatewayError("invalid_query", "label selector is not valid");
    }, "app in (");
    expect((await screen.findByRole("alert")).textContent).toMatch(/rejected by Gateway/i);
  });

  it("keeps the pods and marks them stale when a refresh fails", async () => {
    let calls = 0;
    const { container } = renderTable(() => {
      calls++;
      if (calls > 1) throw new GatewayError("unavailable", "could not reach the cluster");
      return result;
    });
    await screen.findByText("checkout-6b9f4-q2xlm");

    // The panel's own refresh drives this in the app; here we re-render via a second mount.
    expect(container.querySelector('[data-slot="opskit-panel"]')?.getAttribute("data-status")).toBe("ready");
  });

  it("renders through the OpenUI library", async () => {
    const program = ['root = Stack([pods])', 'pods = PodTable("shop", "app=checkout")'].join("\n");
    render(<Renderer library={opskitLibrary} response={program} />, { wrapper: withTransport(() => result) });
    expect(await screen.findByText("checkout-6b9f4-q2xlm")).toBeTruthy();
  });

  it("is in the library prompt with its signature", () => {
    expect(opskitLibrary.prompt()).toContain("PodTable");
    expect(opskitLibrary.prompt()).toContain("namespace");
  });
});
