package prom

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yonigofman/opskit/gateway/internal/access"
	"github.com/yonigofman/opskit/gateway/internal/api"
	"github.com/yonigofman/opskit/gateway/internal/cache"
)

// resolverFunc adapts a function to access.Resolver.
type resolverFunc func(ctx context.Context, id access.Identity) ([]string, error)

func (f resolverFunc) Namespaces(ctx context.Context, id access.Identity) ([]string, error) {
	return f(ctx, id)
}

// fakeProm is a minimal Prometheus HTTP API double. It echoes the received
// query's namespace matcher into the single series it returns, so tests can
// tell which scope actually reached upstream.
type fakeProm struct {
	mu      sync.Mutex
	queries []string
	badData bool
}

func (f *fakeProm) queryCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.queries)
}

func newFakeProm(t *testing.T) (*fakeProm, string) {
	t.Helper()
	f := &fakeProm{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("query")
		f.mu.Lock()
		f.queries = append(f.queries, query)
		f.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		f.mu.Lock()
		badData := f.badData
		f.mu.Unlock()
		if badData {
			w.WriteHeader(http.StatusUnprocessableEntity)
			fmt.Fprintf(w, `{"status":"error","errorType":"bad_data","error":"query processing would load too many samples"}`)
			return
		}
		switch r.URL.Path {
		case "/api/v1/query_range":
			fmt.Fprintf(w, `{"status":"success","data":{"resultType":"matrix","result":[
				{"metric":{"__name__":"up"},"values":[[1000,"1"],[1015,"2"]]}
			]}}`)
		case "/api/v1/query":
			fmt.Fprintf(w, `{"status":"success","data":{"resultType":"vector","result":[
				{"metric":{"__name__":"up"},"value":[1000,"42"]}
			]}}`)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(srv.Close)
	return f, srv.URL
}

func newTestAdapter(baseURL string, resolver access.Resolver) *Adapter {
	a := New(baseURL, resolver, cache.New(time.Minute), nil, "test")
	return a
}

func TestPromRangeInjectsScopeAndReturnsProvenance(t *testing.T) {
	fp, url := newFakeProm(t)
	a := newTestAdapter(url, resolverFunc(func(context.Context, access.Identity) ([]string, error) {
		return []string{"shop"}, nil
	}))

	result, err := a.rangeHandler(context.Background(), access.Identity{User: "yoni"}, PromRangeArgs{
		Query: "up", Start: 0, End: 60, Step: 15,
	})
	if err != nil {
		t.Fatal(err)
	}
	if fp.queryCount() != 1 {
		t.Fatalf("expected 1 upstream call, got %d", fp.queryCount())
	}
	if result.Provenance.Source != "prometheus" || result.Provenance.Cache != "miss" {
		t.Fatalf("unexpected provenance: %+v", result.Provenance)
	}
	if result.Provenance.Query == "" || result.Provenance.Injected == "" {
		t.Fatalf("provenance missing query/injected: %+v", result.Provenance)
	}
	if len(result.Series) != 1 || len(result.Series[0].Values) != 2 {
		t.Fatalf("unexpected series: %+v", result.Series)
	}
}

func TestPromRangeForbiddenNeverCallsUpstream(t *testing.T) {
	fp, url := newFakeProm(t)
	a := newTestAdapter(url, resolverFunc(func(context.Context, access.Identity) ([]string, error) {
		return nil, nil
	}))

	_, err := a.rangeHandler(context.Background(), access.Identity{User: "nobody"}, PromRangeArgs{
		Query: "up", Start: 0, End: 60, Step: 15,
	})
	apiErr, ok := err.(*api.Error)
	if !ok || apiErr.Code != "forbidden" {
		t.Fatalf("got %v, want forbidden", err)
	}
	if apiErr.Identity != "nobody" {
		t.Fatalf("forbidden error must say who ran: %+v", apiErr)
	}
	if fp.queryCount() != 0 {
		t.Fatalf("upstream must not be called when forbidden, got %d calls", fp.queryCount())
	}
}

func TestPromRangeInvalidQueryReportsPosition(t *testing.T) {
	fp, url := newFakeProm(t)
	a := newTestAdapter(url, resolverFunc(func(context.Context, access.Identity) ([]string, error) {
		return []string{"shop"}, nil
	}))

	_, err := a.rangeHandler(context.Background(), access.Identity{User: "yoni"}, PromRangeArgs{
		Query: "http_requests_total{method=", Start: 0, End: 60, Step: 15,
	})
	apiErr, ok := err.(*api.Error)
	if !ok || apiErr.Code != "invalid_query" || apiErr.Position == nil {
		t.Fatalf("got %v, want invalid_query with a position", err)
	}
	if fp.queryCount() != 0 {
		t.Fatalf("upstream must not be called for a query that doesn't parse")
	}
}

func TestPromRangeCacheHitSkipsUpstream(t *testing.T) {
	fp, url := newFakeProm(t)
	a := newTestAdapter(url, resolverFunc(func(context.Context, access.Identity) ([]string, error) {
		return []string{"shop"}, nil
	}))
	id := access.Identity{User: "yoni"}
	args := PromRangeArgs{Query: "up", Start: 0, End: 60, Step: 15}

	first, err := a.rangeHandler(context.Background(), id, args)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.rangeHandler(context.Background(), id, args)
	if err != nil {
		t.Fatal(err)
	}

	if fp.queryCount() != 1 {
		t.Fatalf("expected the second call to be served from cache, got %d upstream calls", fp.queryCount())
	}
	if first.Provenance.Cache != "miss" || second.Provenance.Cache != "hit" {
		t.Fatalf("got cache=%s then cache=%s", first.Provenance.Cache, second.Provenance.Cache)
	}
}

func TestPromRangeCacheIsolatedBetweenUsers(t *testing.T) {
	fp, url := newFakeProm(t)
	a := newTestAdapter(url, resolverFunc(func(_ context.Context, id access.Identity) ([]string, error) {
		if id.User == "yoni" {
			return []string{"shop"}, nil
		}
		return []string{"payments"}, nil
	}))
	args := PromRangeArgs{Query: "up", Start: 0, End: 60, Step: 15}

	first, err := a.rangeHandler(context.Background(), access.Identity{User: "yoni"}, args)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.rangeHandler(context.Background(), access.Identity{User: "dana"}, args)
	if err != nil {
		t.Fatal(err)
	}

	if fp.queryCount() != 2 {
		t.Fatalf("different permission scopes must not share a cache entry, got %d upstream calls", fp.queryCount())
	}
	if first.Provenance.Cache != "miss" || second.Provenance.Cache != "miss" {
		t.Fatalf("both first calls should miss: %+v %+v", first.Provenance, second.Provenance)
	}
	if first.Provenance.Query == second.Provenance.Query {
		t.Fatalf("different scopes must produce different scoped queries, both were %q", first.Provenance.Query)
	}
}

func TestPromInstantReturnsValueAndProvenance(t *testing.T) {
	fp, url := newFakeProm(t)
	a := newTestAdapter(url, resolverFunc(func(context.Context, access.Identity) ([]string, error) {
		return []string{"shop"}, nil
	}))

	result, err := a.instantHandler(context.Background(), access.Identity{User: "yoni"}, PromInstantArgs{Query: "up"})
	if err != nil {
		t.Fatal(err)
	}
	if fp.queryCount() != 1 {
		t.Fatalf("expected 1 upstream call, got %d", fp.queryCount())
	}
	if result.Value == nil || *result.Value != 42 {
		t.Fatalf("got value %v, want 42", result.Value)
	}
}

// Sanity check that the handlers round-trip through tool.Define the same
// way the Tools API will call them: raw JSON in, any out.
func TestSpecsDecodeRawJSON(t *testing.T) {
	fp, url := newFakeProm(t)
	a := newTestAdapter(url, resolverFunc(func(context.Context, access.Identity) ([]string, error) {
		return []string{"shop"}, nil
	}))

	var rangeSpec, instantSpec = a.Specs()[0], a.Specs()[1]
	if rangeSpec.Name != "prom_range" || !rangeSpec.ReadOnly {
		t.Fatalf("unexpected spec: %+v", rangeSpec)
	}
	if instantSpec.Name != "prom_instant" || !instantSpec.ReadOnly {
		t.Fatalf("unexpected spec: %+v", instantSpec)
	}

	raw, _ := json.Marshal(PromRangeArgs{Query: "up", Start: 0, End: 60, Step: 15})
	if _, err := rangeSpec.Call(context.Background(), access.Identity{User: "yoni"}, raw); err != nil {
		t.Fatal(err)
	}
	if fp.queryCount() != 1 {
		t.Fatalf("expected 1 upstream call via the spec, got %d", fp.queryCount())
	}
}

func TestPromRangeCacheHitReportsTheCallersOwnIdentity(t *testing.T) {
	_, url := newFakeProm(t)
	// Both users resolve to the same namespaces, so they share one cache entry.
	a := newTestAdapter(url, resolverFunc(func(context.Context, access.Identity) ([]string, error) {
		return []string{"shop"}, nil
	}))
	args := PromRangeArgs{Query: "up", Start: 0, End: 60, Step: 15}

	first, err := a.rangeHandler(context.Background(), access.Identity{User: "yoni"}, args)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.rangeHandler(context.Background(), access.Identity{User: "dana"}, args)
	if err != nil {
		t.Fatal(err)
	}

	if second.Provenance.Cache != "hit" {
		t.Fatalf("expected the second call to be a cache hit, got %q", second.Provenance.Cache)
	}
	if first.Provenance.Identity != "yoni" || second.Provenance.Identity != "dana" {
		t.Fatalf("got identities %q then %q, want yoni then dana: a cache hit must report the caller who asked, not whoever filled the cache", first.Provenance.Identity, second.Provenance.Identity)
	}
}

func TestPromRangeBadDataIsInvalidQueryNotUnavailable(t *testing.T) {
	fp, url := newFakeProm(t)
	fp.badData = true
	a := newTestAdapter(url, resolverFunc(func(context.Context, access.Identity) ([]string, error) {
		return []string{"shop"}, nil
	}))

	_, err := a.rangeHandler(context.Background(), access.Identity{User: "yoni"}, PromRangeArgs{
		Query: "up", Start: 0, End: 60, Step: 15,
	})
	apiErr, ok := err.(*api.Error)
	if !ok || apiErr.Code != "invalid_query" || apiErr.Status != 400 {
		t.Fatalf("got %v, want a 400 invalid_query", err)
	}
	if strings.Contains(apiErr.Message, "too many samples") {
		t.Errorf("upstream error internals leaked into message: %q", apiErr.Message)
	}
}
