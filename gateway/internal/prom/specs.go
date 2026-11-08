package prom

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/yonigofman/opskit/gateway/internal/access"
	"github.com/yonigofman/opskit/gateway/internal/api"
	"github.com/yonigofman/opskit/gateway/internal/cache"
	"github.com/yonigofman/opskit/gateway/internal/tool"
)

// maxPoints bounds a range query the way Prometheus itself does, so a wide
// start/end with a tiny step can't be used to exhaust the Gateway.
const maxPoints = 11_000

// PromSeries mirrors PromSeries in packages/core/src/types.ts.
type PromSeries struct {
	Labels map[string]string `json:"labels"`
	Values [][2]float64      `json:"values"`
}

// Provenance mirrors Provenance in packages/core/src/types.ts.
type Provenance struct {
	Source     string `json:"source"`
	System     string `json:"system,omitempty"`
	Query      string `json:"query"`
	Identity   string `json:"identity,omitempty"`
	Injected   string `json:"injected,omitempty"`
	FetchedAt  int64  `json:"fetchedAt"`
	Cache      string `json:"cache,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Step       int64  `json:"step,omitempty"`
}

// PromRangeArgs mirrors PromRangeArgs in packages/core/src/types.ts.
type PromRangeArgs struct {
	Query string `json:"query"`
	Start int64  `json:"start"`
	End   int64  `json:"end"`
	Step  int64  `json:"step"`
}

// PromRangeResult mirrors PromRangeResult in packages/core/src/types.ts.
type PromRangeResult struct {
	Series     []PromSeries `json:"series"`
	Provenance Provenance   `json:"provenance"`
}

// PromInstantArgs mirrors PromInstantArgs in packages/core/src/types.ts.
type PromInstantArgs struct {
	Query string `json:"query"`
}

// PromInstantResult mirrors PromInstantResult in packages/core/src/types.ts.
type PromInstantResult struct {
	Value      *float64   `json:"value"`
	Provenance Provenance `json:"provenance"`
}

// Adapter is the Prometheus/Mimir adapter: it scopes every query to the
// caller's namespaces, serves from cache where possible, and calls upstream
// otherwise.
type Adapter struct {
	Resolver access.Resolver
	Cache    *cache.Cache
	System   string // human name for provenance, e.g. "Mimir · tenant shop"
	Logger   *slog.Logger

	// RoundSeconds buckets start/end/now so concurrent requests for the
	// same window coalesce onto one cache entry.
	RoundSeconds int64

	upstream *upstream
}

// New builds an Adapter against a Prometheus-compatible base URL.
func New(baseURL string, resolver access.Resolver, c *cache.Cache, httpClient *http.Client, system string) *Adapter {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	return &Adapter{
		Resolver:     resolver,
		Cache:        c,
		System:       system,
		Logger:       slog.Default(),
		RoundSeconds: 15,
		upstream:     &upstream{base: baseURL, client: httpClient},
	}
}

// Specs returns the tools this adapter serves. Both are read-only: nothing
// here may ever mutate the cluster.
func (a *Adapter) Specs() []tool.Spec {
	return []tool.Spec{
		tool.Define("prom_range", true, a.rangeHandler),
		tool.Define("prom_instant", true, a.instantHandler),
	}
}

func (a *Adapter) scope(ctx context.Context, id access.Identity) ([]string, *api.Error) {
	ns, err := a.Resolver.Namespaces(ctx, id)
	if err != nil {
		a.Logger.Error("resolve namespaces failed", "user", id.User, "err", err)
		return nil, &api.Error{Status: http.StatusServiceUnavailable, Code: "unavailable", Message: "could not resolve permissions"}
	}
	if len(ns) == 0 {
		return nil, &api.Error{Status: http.StatusForbidden, Code: "forbidden", Message: "no namespaces in scope", Identity: id.User}
	}
	return ns, nil
}

// upstreamToAPIError maps a Prometheus HTTP API failure to the client's
// error contract. bad_data means the query engine itself rejected the
// query (distinct from what the Go PromQL parser accepts, e.g. exceeding
// max-samples) and is reported as invalid_query, not unavailable.
func upstreamToAPIError(err error) *api.Error {
	if uerr, ok := err.(*upstreamError); ok && uerr.isBadData() {
		return &api.Error{Status: 400, Code: "invalid_query", Message: "prometheus rejected this query"}
	}
	return &api.Error{Status: 503, Code: "unavailable", Message: "prometheus query failed"}
}

func (a *Adapter) round(t int64) int64 {
	if a.RoundSeconds <= 0 {
		return t
	}
	return t - t%a.RoundSeconds
}

func scopeHash(ns []string) string {
	sum := sha256.Sum256([]byte(strings.Join(ns, ",")))
	return hex.EncodeToString(sum[:8])
}

func (a *Adapter) rangeHandler(ctx context.Context, id access.Identity, args PromRangeArgs) (PromRangeResult, error) {
	if args.Query == "" {
		return PromRangeResult{}, &api.Error{Status: 400, Code: "invalid_query", Message: "query is required"}
	}
	if args.Step <= 0 || args.End < args.Start {
		return PromRangeResult{}, &api.Error{Status: 400, Code: "invalid_query", Message: "start, end and step must describe a valid range"}
	}
	if (args.End-args.Start)/args.Step > maxPoints {
		return PromRangeResult{}, &api.Error{Status: 400, Code: "invalid_query", Message: "range and step would return too many points"}
	}

	ns, apiErr := a.scope(ctx, id)
	if apiErr != nil {
		return PromRangeResult{}, apiErr
	}

	rewritten, injected, perr := rewriteQuery(args.Query, ns)
	if perr != nil {
		pos := perr.Position
		return PromRangeResult{}, &api.Error{Status: 400, Code: "invalid_query", Message: perr.Message, Position: &pos}
	}

	roundedStart, roundedEnd := a.round(args.Start), a.round(args.End)
	key := fmt.Sprintf("prom_range|%s|%d|%d|%d|%s", rewritten, roundedStart, roundedEnd, args.Step, scopeHash(ns))

	if cached, ok := a.Cache.Get(key); ok {
		result := cached.(PromRangeResult)
		result.Provenance.Cache = "hit"
		result.Provenance.DurationMs = 0
		result.Provenance.Identity = id.User
		return result, nil
	}

	started := time.Now()
	raw, err := a.upstream.queryRange(ctx, rewritten, args.Start, args.End, args.Step)
	if err != nil {
		a.Logger.Error("prom_range upstream failed", "err", err)
		return PromRangeResult{}, upstreamToAPIError(err)
	}

	series := make([]PromSeries, 0, len(raw))
	for _, r := range raw {
		series = append(series, PromSeries{Labels: r.labels, Values: r.values})
	}

	result := PromRangeResult{
		Series: series,
		Provenance: Provenance{
			Source:     "prometheus",
			System:     a.System,
			Query:      rewritten,
			Identity:   id.User,
			Injected:   injected,
			FetchedAt:  time.Now().UnixMilli(),
			Cache:      "miss",
			DurationMs: time.Since(started).Milliseconds(),
			Step:       args.Step,
		},
	}
	a.Cache.Set(key, result)
	return result, nil
}

func (a *Adapter) instantHandler(ctx context.Context, id access.Identity, args PromInstantArgs) (PromInstantResult, error) {
	if args.Query == "" {
		return PromInstantResult{}, &api.Error{Status: 400, Code: "invalid_query", Message: "query is required"}
	}

	ns, apiErr := a.scope(ctx, id)
	if apiErr != nil {
		return PromInstantResult{}, apiErr
	}

	rewritten, injected, perr := rewriteQuery(args.Query, ns)
	if perr != nil {
		pos := perr.Position
		return PromInstantResult{}, &api.Error{Status: 400, Code: "invalid_query", Message: perr.Message, Position: &pos}
	}

	now := a.round(time.Now().Unix())
	key := fmt.Sprintf("prom_instant|%s|%d|%s", rewritten, now, scopeHash(ns))

	if cached, ok := a.Cache.Get(key); ok {
		result := cached.(PromInstantResult)
		result.Provenance.Cache = "hit"
		result.Provenance.DurationMs = 0
		result.Provenance.Identity = id.User
		return result, nil
	}

	started := time.Now()
	value, err := a.upstream.queryInstant(ctx, rewritten)
	if err != nil {
		a.Logger.Error("prom_instant upstream failed", "err", err)
		return PromInstantResult{}, upstreamToAPIError(err)
	}

	result := PromInstantResult{
		Value: value,
		Provenance: Provenance{
			Source:     "prometheus",
			System:     a.System,
			Query:      rewritten,
			Identity:   id.User,
			Injected:   injected,
			FetchedAt:  time.Now().UnixMilli(),
			Cache:      "miss",
			DurationMs: time.Since(started).Milliseconds(),
		},
	}
	a.Cache.Set(key, result)
	return result, nil
}
