package api

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCORSAllowedOriginIsEchoedBack(t *testing.T) {
	called := false
	h := CORS([]string{"http://localhost:5173"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/tools/prom_instant", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Fatal("allowed origin must still reach the handler")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:5173" {
		t.Errorf("got Access-Control-Allow-Origin=%q", got)
	}
	if got := rec.Header().Get("Vary"); got != "Origin" {
		t.Errorf("got Vary=%q, want Origin", got)
	}
}

func TestCORSDisallowedOriginGetsNoHeaders(t *testing.T) {
	called := false
	h := CORS([]string{"http://localhost:5173"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/tools/prom_instant", nil)
	req.Header.Set("Origin", "https://evil.example")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Fatal("the handler still runs; the browser is what enforces same-origin, not the server")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("disallowed origin must not be echoed back, got %q", got)
	}
}

func TestCORSPreflightShortCircuits(t *testing.T) {
	called := false
	h := CORS([]string{"http://localhost:5173"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	}))

	req := httptest.NewRequest(http.MethodOptions, "/v1/tools/prom_instant", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if called {
		t.Fatal("a preflight OPTIONS request must never reach the tool handler")
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("got status %d, want 204", rec.Code)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Error("preflight response must advertise allowed methods")
	}
}

func TestCORSIgnoresBlankEntriesFromEnvVarParsing(t *testing.T) {
	// strings.Split("http://localhost:5173,", ",") yields a trailing "" entry;
	// a request with no Origin header must not match it.
	called := false
	h := CORS([]string{"http://localhost:5173", "", "  "}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/tools/prom_instant", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Fatal("a request with no Origin header must still reach the handler")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("a blank allowed-origins entry must never match an absent Origin, got %q", got)
	}
}

func TestCORSNoOriginPassesThrough(t *testing.T) {
	called := false
	h := CORS([]string{"http://localhost:5173"}, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/tools/prom_instant", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Fatal("a same-origin or non-browser request with no Origin header must still work")
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("got %q, want no CORS header without an Origin", got)
	}
}
