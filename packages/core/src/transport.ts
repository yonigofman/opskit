import { GatewayError } from "./types.js";

export interface CallOptions {
  signal?: AbortSignal;
}

/**
 * How components reach the Gateway. Components never talk to Kubernetes,
 * Prometheus or Loki directly: everything goes through a Transport.
 */
export interface Transport {
  call<T>(tool: string, args: Record<string, unknown>, options?: CallOptions): Promise<T>;
}

export interface HttpTransportOptions {
  /** Base URL of the OpsKit Gateway, e.g. "/opskit" or "https://opskit.internal". */
  url: string;
  /** Returns the viewer's token. The Gateway runs every call as this identity. */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
  fetch?: typeof fetch;
}

interface ErrorBody {
  code?: string;
  message?: string;
  position?: number;
  identity?: string;
}

/** Talks to the Gateway's Tools API: POST {url}/v1/tools/{tool} with JSON args. */
export function httpTransport(options: HttpTransportOptions): Transport {
  const base = options.url.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    async call<T>(tool: string, args: Record<string, unknown>, callOptions: CallOptions = {}) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const token = await options.getToken?.();
      if (token) headers.authorization = `Bearer ${token}`;

      let res: Response;
      try {
        res = await doFetch(`${base}/v1/tools/${encodeURIComponent(tool)}`, {
          method: "POST",
          headers,
          body: JSON.stringify(args),
          signal: callOptions.signal,
        });
      } catch (err) {
        if (isAbort(err)) throw err;
        throw new GatewayError("unavailable", "Can't reach the OpsKit Gateway");
      }

      if (res.ok) return (await res.json()) as T;

      const body = await readErrorBody(res);
      const extra = { position: body.position, identity: body.identity };
      if (res.status === 401 || res.status === 403) {
        throw new GatewayError("forbidden", body.message ?? "Access denied", extra);
      }
      if (res.status === 400 || res.status === 422) {
        throw new GatewayError("invalid_query", body.message ?? "The query was rejected", extra);
      }
      if (res.status >= 500) {
        throw new GatewayError("unavailable", body.message ?? `Gateway error ${res.status}`);
      }
      throw new GatewayError("unknown", body.message ?? `Unexpected status ${res.status}`, extra);
    },
  };
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  try {
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" ? (body as ErrorBody) : {};
  } catch {
    return {};
  }
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/**
 * Collapses identical calls that are in flight at the same time into one request.
 * Three panels asking for the same query cost one round trip.
 */
export function dedupe(transport: Transport): Transport {
  const inflight = new Map<string, Promise<unknown>>();
  return {
    call<T>(tool: string, args: Record<string, unknown>) {
      const key = `${tool}:${stableStringify(args)}`;
      const existing = inflight.get(key);
      if (existing) return existing as Promise<T>;
      const p = transport.call<T>(tool, args).finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    },
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}
