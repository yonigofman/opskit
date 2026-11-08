// Command opskit-gateway is the trusted server between OpsKit components and the
// cluster. It runs every query as the viewer, injects RBAC scoping, caches and
// coalesces upstream calls, and is the only path for actions.
//
// This is the M0 skeleton: it serves the Tools API contract and health checks.
// Adapters (Kubernetes, Prometheus/Mimir, Loki) land in M1.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/yonigofman/opskit/gateway/internal/api"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	addr := os.Getenv("OPSKIT_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	srv := &http.Server{
		Addr:              addr,
		Handler:           api.NewRouter(api.Registry{}, logger),
		ReadHeaderTimeout: 5 * time.Second,
	}

	logger.Info("opskit gateway listening", "addr", addr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("server stopped", "err", err)
		os.Exit(1)
	}
}
