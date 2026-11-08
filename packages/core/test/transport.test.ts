import { dedupe, httpTransport, type Transport } from "../src/transport";
import { GatewayError } from "../src/types";

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

describe("httpTransport", () => {
  it("posts args to the tool endpoint with the viewer's token", async () => {
    const fetch = fakeFetch(200, { ok: true });
    const t = httpTransport({ url: "https://gw.example/", getToken: () => "tok", fetch });

    await expect(t.call("prom_range", { query: "up" })).resolves.toEqual({ ok: true });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://gw.example/v1/tools/prom_range");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ query: "up" });
  });

  it.each([
    [403, "forbidden"],
    [401, "forbidden"],
    [400, "invalid_query"],
    [503, "unavailable"],
    [418, "unknown"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const t = httpTransport({ url: "/gw", fetch: fakeFetch(status, { message: "nope", position: 31 }) });
    const err = await t.call("prom_range", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe(code);
  });

  it("keeps the parse position for invalid queries", async () => {
    const t = httpTransport({ url: "/gw", fetch: fakeFetch(400, { message: "unexpected )", position: 31 }) });
    const err = (await t.call("prom_range", {}).catch((e: unknown) => e)) as GatewayError;
    expect(err.position).toBe(31);
    expect(err.message).toBe("unexpected )");
  });

  it("reports an unreachable Gateway as unavailable", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const t = httpTransport({ url: "/gw", fetch });
    const err = (await t.call("prom_range", {}).catch((e: unknown) => e)) as GatewayError;
    expect(err.code).toBe("unavailable");
  });
});

describe("dedupe", () => {
  it("sends one request for identical in-flight calls, whatever the key order", async () => {
    let resolve!: (v: unknown) => void;
    const inner: Transport = { call: vi.fn(() => new Promise((r) => (resolve = r))) as Transport["call"] };
    const t = dedupe(inner);

    const a = t.call("prom_range", { query: "up", step: 15 });
    const b = t.call("prom_range", { step: 15, query: "up" });
    resolve({ series: [] });

    await expect(Promise.all([a, b])).resolves.toEqual([{ series: [] }, { series: [] }]);
    expect(inner.call).toHaveBeenCalledTimes(1);
  });

  it("sends again once the first call settled", async () => {
    const inner: Transport = { call: vi.fn(async () => 1) as Transport["call"] };
    const t = dedupe(inner);
    await t.call("x", {});
    await t.call("x", {});
    expect(inner.call).toHaveBeenCalledTimes(2);
  });
});
