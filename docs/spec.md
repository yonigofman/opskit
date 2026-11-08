# OpsKit v1 spec

OpsKit is a toolkit that lets any AI agent answer with live, safe ops UI instead of text. It is not an agent, an AI SRE or a dashboard: it is the layer agents render through.

**Core principle: the model writes queries, not numbers.** The model decides *what to show* (PromQL, a resource ref, an action intent). The Gateway fetches it as the viewer, and every action goes through dry run and approval. Every number on screen is traceable to the query behind it.

## v1 goals

- An agent connected to OpsKit answers "why is checkout slow?" with a live chart, the pods, their error logs, and a rollback button with a real dry-run diff.
- No LLM ever holds credentials; every call goes through the cluster's own RBAC.
- Meets defined performance budgets, measured on every PR.
- Installs with one `helm install`, including air-gapped.

## Scope

In v1: Gateway (Go) with Kubernetes/OpenShift, Prometheus/Mimir and Loki adapters, viewer-identity RBAC, performance layer, action engine; `@opskit/core`; styled kit with six components via shadcn registry; agent pack (MCP server, system prompt, basic evals); playground and benchmark harness; Helm chart for one cluster.

Not in v1: multi-cluster, SSO/SCIM beyond the cluster's OIDC, approval routing to Slack/Teams, shareable links and snapshots, hosted or fine-tuned model, non-React renderers, Tempo, ArgoCD and GitLab adapters.

Policy, approvals and audit sit behind interfaces from v1, so a later SaaS control plane plugs in without touching the core.

## Architecture

```text
agent ──OpenUI Lang──▶ browser: @opskit/ui + @opskit/core ──user token, one WebSocket──▶ Gateway ──as the user──▶ K8s API · Prometheus/Mimir · Loki
   └──read tools──▶ MCP server (agent pack) ──▶ Gateway
```

Request flow:

1. The user asks; the agent investigates through the MCP server's read tools.
2. The agent writes OpenUI Lang with refs only, streamed to the browser.
3. The Renderer mounts each component as its line completes; its hook calls the Gateway with the user's token.
4. The Gateway authenticates, injects the namespace matcher, serves from cache or upstream, and streams the result.
5. Clicking ActionButton: `action_plan` → dry-run diff → approval → `action_execute` → audit event.

The Gateway is Go (client-go informers, one small binary). It can run standalone or as a sidecar next to the host app.

## Gateway

**Identity and RBAC**

- The host app passes the user's OIDC token; the Gateway validates it against the cluster's issuer.
- Kubernetes calls use impersonation (`Impersonate-User` / `Impersonate-Group`). The Gateway's ServiceAccount has only `impersonate`, so the cluster's RBAC decides.
- Prometheus/Mimir and Loki have no per-namespace RBAC. The Gateway uses `SelfSubjectAccessReview` to find the namespaces the user can read and injects a `namespace=~"…"` matcher into every PromQL/LogQL query, by parsing the AST (prom-label-proxy style), never with regex. In multi-tenant Mimir, `X-Scope-OrgID` comes from the same mapping.

**Tools API**: `POST /v1/tools/{tool}` with a JSON body. The same tools are exposed as an MCP endpoint (read tools only).

| Tool | Args | Returns |
| --- | --- | --- |
| `k8s_list` | kind, namespace, labelSelector | resources from the informer cache |
| `k8s_get` | kind, namespace, name | full resource + status |
| `k8s_events` | namespace, involvedObject? | events by time |
| `prom_range` | query, start, end, step | `{series, provenance}` |
| `prom_instant` | query | current value per series |
| `loki_range` | query, start, end, limit | log lines |
| `loki_tail` | query | stream (WebSocket) |
| `action_plan` | action, target, params | plan_id, diff, policy result |
| `action_execute` | plan_id | result + audit_id |

Error contract (what `@opskit/core` maps to states):

| HTTP | Body | Client state |
| --- | --- | --- |
| 400 / 422 | `{"code":"invalid_query","message","position"}` | error, query underlined at `position` |
| 401 / 403 | `{"code":"forbidden","message","identity"}` | forbidden |
| 5xx / network | `{"code":"unavailable","message"}` | stale if data was shown, else error |

Never put upstream error internals in `message`.

**Action engine**

- v1 actions: `rollout_restart`, `scale`, `rollback`, `delete_pod`.
- `action_plan` runs a server-side dry run (`dryRun=All`), computes the diff, and returns a signed `plan_id` bound to the plan hash and the user, valid for 5 minutes.
- `action_execute` accepts only a valid `plan_id`, from the same user, and only if the target's resourceVersion is unchanged since the dry run.
- Every plan and execute, including rejected plans, goes to the AuditSink.

**Extension interfaces**

```go
type PolicyProvider interface { Evaluate(ctx context.Context, user Identity, plan ActionPlan) (Decision, error) } // v1: YAML file
type Approver interface      { RequestApproval(ctx context.Context, plan ActionPlan) (Approval, error) }      // v1: same user approves in the UI
type AuditSink interface     { Record(ctx context.Context, e AuditEvent) error }                              // v1: JSON lines to stdout/file
type Adapter interface       { Tools() []ToolSpec; Call(ctx context.Context, user Identity, tool string, args json.RawMessage) (Result, error) }
```

## Component catalog

v1 answers "what's wrong right now". Each component takes refs and fetches its own data.

| Component | Main props | Data | Built on |
| --- | --- | --- | --- |
| `StatTile` | label, query, unit?, range?, warnAt?, dangerAt? | `prom_instant` + `prom_range` for the sparkline | **built** |
| `PromChart` | title, query, range?, unit?, warnAt?, dangerAt? | `prom_range` | **built** |
| `PodTable` | namespace, selector, columns? | `k8s_list` + watch | |
| `LogTail` | query, range?, follow? | `loki_range` + `loki_tail` | |
| `EventTimeline` | namespace, object? | `k8s_events` + watch | |
| `ActionButton` | label, action, target, params | `action_plan` → `action_execute` | |

v1.1 ("what changed"): RolloutStatus, ResourceDiff, ChangeMarkers (deploys drawn on charts), AlertList, ResourceCard. Later: NodeHeatmap, SLOBurn, ArgoAppTree, ServiceMap, InvestigationStep.

Every component:

- lives in `OpsPanel` (corner ticks mark generated UI);
- implements the six states with the shared views;
- ends with `ProvenanceFooter`;
- has a "source" affordance showing the exact query, fetch time and identity.

## OpenUI Lang integration

Components are ordinary OpenUI components (`defineComponent` + zod) whose props are refs. They fetch through their own hooks rather than OpenUI's built-in `Query`, because `Query` polls, routes data through generic components (losing provenance), and `Mutation` would let the model skip dry run. OpenUI's `toolProvider` may expose read tools for ad-hoc questions; `action_execute` is never exposed to it.

Fetch-on-parse: the Renderer mounts a statement as soon as its line completes, so data loads while the model is still writing. The system prompt tells the model to write data components before prose.

## Security model

The LLM is untrusted: it may propose what to show and do, but every permission, every datum and every action is enforced in the Gateway, as the user, with human approval.

| Threat | Mitigation |
| --- | --- |
| Prompt injection (e.g. a log line telling the model to roll back) | The model only proposes; actions show a dry-run diff and need approval; policy blocks dangerous actions |
| Invented data | Props are refs only; provenance on every component |
| Privilege escalation via the Gateway | ServiceAccount has only `impersonate` |
| Metrics/logs leaking across namespaces | AST-based namespace injection; cache keys include the permission scope |
| Approval replay | Signed `plan_id`, bound to user, 5 min TTL, resourceVersion check |
| XSS from logs or annotations | All content rendered as text, never HTML |
| Token theft | Short-lived tokens; never logged |

Policy file (v1):

```yaml
apiVersion: opskit.dev/v1
kind: Policy
rules:
  - action: rollout_restart
    allow: true
  - action: scale
    allow: true
    constraints: { maxReplicas: 20 }
  - action: rollback
    allow: true
    namespaces: ["!kube-*", "!openshift-*"]
  - action: delete_pod
    allow: true
    requireReason: true
```

Audit event: `timestamp, user, groups, action, target, params, plan_id, diff_hash, policy_decision, result, source`.

## Performance

| Metric | Budget |
| --- | --- |
| First token → first component on screen | < 1s |
| Cached panel data, p50 | < 300ms |
| Uncached panel data, p95 | < 1.5s |
| 10 live panels on screen | 60fps |
| LogTail sustained | 5,000 lines/s without dropped frames |
| Gateway memory, 5,000-pod cluster | < 512 MiB |

Techniques: fetch-on-parse; small model output; shared informer cache; query coalescing (client `dedupe` + Gateway); `step = range / width` (`computeStep`); short-TTL cache keyed by query + rounded range + permission scope; one multiplexed WebSocket per client; canvas charts (uPlot); virtualized tables and logs; per-frame batching; off-screen panels pause.

Benchmark harness (M0): kind + kwok with 5,000 pods, Prometheus and Loki with synthetic data, recorded LLM streams replayed at real speed, Playwright for render timing and frame rate, k6 for the Gateway; results as JSON and a PR comment.

## Milestones

1. **M0 Harness:** kind + kwok, synthetic Prometheus/Loki, recorded streams. Done: `make bench` emits metrics JSON.
2. **M1 Gateway read path:** OIDC, impersonation, informer cache, Prometheus/Loki adapters, namespace injection. Done: `k8s_list` and `prom_range` within budget; an unauthorized user gets forbidden.
3. **M2 Core + three components:** provider, hooks, PromChart (done), PodTable, LogTail. Done: playground shows all three live at 60fps.
4. **M3 Actions:** action engine, policy file, audit, ResourceDiff, ActionButton, EventTimeline. Done: full rollback with dry-run diff, approval and audit event; a stale plan is rejected.
5. **M4 Agent pack:** MCP server, system prompt, 50 evals. Done: ≥ 95% valid output on at least one model, zero invented values.
6. **M5 Release:** Helm chart, docs, README with benchmarks and evals, the checkout demo. Done: clean install on OpenShift and vanilla Kubernetes with one `helm install`.

## Open questions

- Identity for host apps without the cluster's OIDC (token exchange?).
- OpenShift: use OpenShift OAuth directly, and how it behaves with impersonation.
- v1 approver: can requesters approve their own plans, or a two-person rule for some namespaces?
- Manual `scale` vs HPA: avoid being overwritten immediately.
