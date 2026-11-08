// Package api serves the OpsKit Tools API: POST /v1/tools/{tool} with JSON args.
//
// Errors use the shape @opskit/core expects:
//
//	400 {"code":"invalid_query","message":"…","position":31}
//	403 {"code":"forbidden","message":"…","identity":"yoni"}
//	503 {"code":"unavailable","message":"…"}
package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
)

// Tool handles one named tool call. args is the raw JSON body.
type Tool func(ctx context.Context, args json.RawMessage) (any, error)

// Registry maps tool names (prom_range, k8s_list, …) to handlers.
type Registry map[string]Tool

// Error is a tool failure the client can act on.
type Error struct {
	Status   int    `json:"-"`
	Code     string `json:"code"`
	Message  string `json:"message"`
	Position *int   `json:"position,omitempty"`
	Identity string `json:"identity,omitempty"`
}

func (e *Error) Error() string { return e.Message }

// Provenance mirrors Provenance in packages/core/src/types.ts: the proof
// shown under every panel. Every tool result carries one.
type Provenance struct {
	Source string `json:"source"` // prometheus | loki | kubernetes
	System string `json:"system,omitempty"`
	// Query as it actually ran, after any rewriting.
	Query    string `json:"query"`
	Identity string `json:"identity,omitempty"`
	// Matchers the Gateway injected to enforce RBAC, where it injects any.
	Injected   string `json:"injected,omitempty"`
	FetchedAt  int64  `json:"fetchedAt"`
	Cache      string `json:"cache,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	// Range queries only: resolution in seconds.
	Step int64 `json:"step,omitempty"`
}

const maxBody = 1 << 20

// NewRouter returns the Gateway's HTTP handler.
func NewRouter(tools Registry, logger *slog.Logger) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok\n")
	})

	mux.HandleFunc("POST /v1/tools/{tool}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("tool")
		tool, ok := tools[name]
		if !ok {
			writeError(w, &Error{Status: http.StatusNotImplemented, Code: "unknown", Message: "tool " + name + " is not available on this Gateway"})
			return
		}

		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBody))
		if err != nil || !json.Valid(body) {
			writeError(w, &Error{Status: http.StatusBadRequest, Code: "invalid_query", Message: "request body must be a JSON object"})
			return
		}

		result, err := tool(r.Context(), body)
		if err != nil {
			var apiErr *Error
			if !errors.As(err, &apiErr) {
				logger.Error("tool failed", "tool", name, "err", err)
				apiErr = &Error{Status: http.StatusServiceUnavailable, Code: "unavailable", Message: "upstream failed"}
			}
			writeError(w, apiErr)
			return
		}

		// Encode into memory first: a half-written body would reach the client
		// as a 200 it cannot parse, with the status already sent.
		encoded, err := json.Marshal(result)
		if err != nil {
			logger.Error("tool result could not be encoded", "tool", name, "err", err)
			writeError(w, &Error{Status: http.StatusInternalServerError, Code: "unavailable", Message: "the result could not be encoded"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(encoded)
	})

	return mux
}

func writeError(w http.ResponseWriter, e *Error) {
	status := e.Status
	if status == 0 {
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(e)
}
