import type { Transport } from "./transport.js";
import { GatewayError } from "./types.js";

export type MockHandler = (args: Record<string, unknown>) => unknown | Promise<unknown>;

export interface MockTransportOptions {
  /** Simulated round trip, in milliseconds. */
  latencyMs?: number;
}

/**
 * A Transport backed by local functions instead of a Gateway.
 * Use it for demos, docs and tests: components behave exactly as they do live.
 * Handlers may throw a GatewayError to simulate forbidden, invalid or unavailable.
 */
export function mockTransport(
  handlers: Record<string, MockHandler>,
  options: MockTransportOptions = {},
): Transport {
  const latency = options.latencyMs ?? 0;
  return {
    async call<T>(tool: string, args: Record<string, unknown>, callOptions: { signal?: AbortSignal } = {}) {
      const handler = handlers[tool];
      if (!handler) throw new GatewayError("unknown", `Mock has no handler for tool "${tool}"`);
      if (latency > 0) await sleep(latency, callOptions.signal);
      return (await handler(args)) as T;
    },
  };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
