---
name: add-gateway-tool
description: Add or change a tool in the OpsKit Go Gateway (prom_range, k8s_list, loki_tail, action_plan…) together with its client-side types and mock. Use for any work under gateway/, including auth, impersonation, namespace injection and adapters.
---

# Add a Gateway tool

The Gateway is the only code that touches the cluster. Read `docs/spec.md` (Gateway, Security model) and `gateway/internal/api/api.go` first.

## Rules that never bend

- **Run as the viewer.** Kubernetes calls use impersonation of the authenticated user and groups. Never fall back to the Gateway's own ServiceAccount for reads or writes.
- **Scope every PromQL and LogQL query.** Parse the query and inject `namespace=~"<allowed>"` into every vector/stream selector through the AST (`github.com/prometheus/prometheus/promql/parser` for PromQL; Loki's `logql/syntax` for LogQL). Never use string or regex rewriting. If the user can read no namespace in scope, return `forbidden` without querying.
- **Cache keys include the permission scope** (the allowed-namespace set or a hash of it), never only the query.
- **Mutations only through the action engine:** `action_plan` (dry run, signed plan_id, 5 min TTL, bound to user and resourceVersion), then `action_execute`. No tool may mutate directly.
- **Errors use the client's contract** (`*api.Error`): `invalid_query` with `position` when a parser reports one, `forbidden` with `identity`, `unavailable` for upstream trouble. Never put upstream error text in `message`. Log it with `slog` instead.
- **Return provenance** with every data result: `source`, `system`, the rewritten `query`, `identity`, `injected`, `fetchedAt` (unix ms), `cache`, `durationMs`, `step`. Field names must match `Provenance` in `packages/core/src/types.ts`.

## Steps

1. **Go handler.** Put the adapter under `gateway/internal/<backend>/` (for example `prom`, `kube`, `loki`) and register the tool in the `api.Registry` built in `cmd/opskit-gateway/main.go`. Decode args into a struct and validate them (time ranges, step bounds, limits). Respect `ctx` cancellation and set upstream timeouts.
2. **Go tests**, table-driven, next to the code:
   - success;
   - each error code;
   - namespace injection, including queries that try to escape it (`or on() vector(1)`, subqueries, `{__name__=~".+"}`, a namespace matcher already present);
   - cache isolation between two users with different namespaces.
   Use `httptest` fakes for upstreams, never real clusters.
3. **Client types.** Add or extend args and result types in `packages/core/src/types.ts`. Add a hook if a component needs it (see `add-opskit-component`).
4. **Mock.** Add the tool to `apps/playground/src/fixtures.ts` so the playground and tests run without a Gateway. Keep its error shapes identical to the Go ones.
5. **Spec.** Update the Tools API table in `docs/spec.md` if the tool or its args are new.

## Check

```bash
cd gateway && gofmt -l . && go vet ./... && go test -race ./...
```

Then exercise it for real against the local stack, because unit tests use fakes:

```bash
docker compose up --build -d   # Prometheus + Gateway on :8080
./gateway/deploy/smoke.sh
```

For a Prometheus tool, the playground's probe page (Probe tab) runs arbitrary PromQL through the Gateway as
any identity and shows what it rewrote. Then run the `verify-opskit` skill for the TypeScript side.
