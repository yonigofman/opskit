// Command opskit-gateway is the trusted server between OpsKit components and the
// cluster. It runs every query as the viewer, injects RBAC scoping, caches and
// coalesces upstream calls, and is the only path for actions.
//
// M1: Prometheus/Mimir read path (prom_range, prom_instant), namespaces resolved
// from a static YAML mapping. Kubernetes/Loki adapters and OIDC token
// validation land in later sessions.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/yonigofman/opskit/gateway/internal/access"
	"github.com/yonigofman/opskit/gateway/internal/api"
	"github.com/yonigofman/opskit/gateway/internal/cache"
	"github.com/yonigofman/opskit/gateway/internal/prom"
	"github.com/yonigofman/opskit/gateway/internal/tool"
)

type identityKey struct{}

// devIdentityMiddleware reads the caller's identity off plain headers,
// trusting whatever the caller claims. It exists so prom_range/prom_instant
// can be exercised before OIDC token validation lands, and main() refuses
// to start with it unless OPSKIT_DEV_INSECURE_AUTH=1 is set explicitly, so
// it can never end up wired into a real deployment by omission.
func devIdentityMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := access.Identity{User: r.Header.Get("X-OpsKit-Dev-User")}
		if groups := r.Header.Get("X-OpsKit-Dev-Groups"); groups != "" {
			id.Groups = strings.Split(groups, ",")
		}
		ctx := context.WithValue(r.Context(), identityKey{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func identityFromContext(ctx context.Context) (access.Identity, error) {
	id, ok := ctx.Value(identityKey{}).(access.Identity)
	if !ok || id.User == "" {
		return access.Identity{}, errors.New("no identity on this request")
	}
	return id, nil
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	if os.Getenv("OPSKIT_DEV_INSECURE_AUTH") != "1" {
		logger.Error("refusing to start: OIDC token validation isn't built yet (M1 continues next session); " +
			"set OPSKIT_DEV_INSECURE_AUTH=1 only against a non-production Prometheus to test prom_range/prom_instant " +
			"with identity taken from X-OpsKit-Dev-User/-Groups headers")
		os.Exit(1)
	}

	addr := os.Getenv("OPSKIT_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	accessFile := os.Getenv("OPSKIT_ACCESS_FILE")
	if accessFile == "" {
		logger.Error("OPSKIT_ACCESS_FILE is required: path to the static user/group -> namespaces mapping")
		os.Exit(1)
	}
	resolver, err := access.LoadStatic(accessFile)
	if err != nil {
		logger.Error("failed to load access file", "err", err)
		os.Exit(1)
	}

	promURL := os.Getenv("OPSKIT_PROM_URL")
	if promURL == "" {
		logger.Error("OPSKIT_PROM_URL is required: base URL of the Prometheus/Mimir upstream")
		os.Exit(1)
	}
	promSystem := os.Getenv("OPSKIT_PROM_SYSTEM")
	if promSystem == "" {
		promSystem = "Prometheus"
	}

	promAdapter := prom.New(promURL, resolver, cache.New(5*time.Second), nil, promSystem)
	promAdapter.Logger = logger

	registry := tool.NewRegistry(promAdapter.Specs()...)

	srv := &http.Server{
		Addr:              addr,
		Handler:           devIdentityMiddleware(api.NewRouter(registry.ToAPI(identityFromContext), logger)),
		ReadHeaderTimeout: 5 * time.Second,
	}

	logger.Info("opskit gateway listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server stopped", "err", err)
		os.Exit(1)
	}
}
