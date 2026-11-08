package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newServer(tools Registry) *httptest.Server {
	return httptest.NewServer(NewRouter(tools, slog.New(slog.NewTextHandler(io.Discard, nil))))
}

func post(t *testing.T, url, body string) (*http.Response, map[string]any) {
	t.Helper()
	res, err := http.Post(url, "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res, out
}

func TestToolSuccess(t *testing.T) {
	srv := newServer(Registry{"echo": func(_ context.Context, args json.RawMessage) (any, error) {
		var in map[string]any
		_ = json.Unmarshal(args, &in)
		return in, nil
	}})
	defer srv.Close()

	res, out := post(t, srv.URL+"/v1/tools/echo", `{"query":"up"}`)
	if res.StatusCode != http.StatusOK || out["query"] != "up" {
		t.Fatalf("got %d %v", res.StatusCode, out)
	}
}

func TestToolErrorsKeepTheirShape(t *testing.T) {
	pos := 31
	srv := newServer(Registry{
		"bad": func(context.Context, json.RawMessage) (any, error) {
			return nil, &Error{Status: 400, Code: "invalid_query", Message: "unexpected )", Position: &pos}
		},
		"denied": func(context.Context, json.RawMessage) (any, error) {
			return nil, &Error{Status: 403, Code: "forbidden", Message: "no", Identity: "yoni"}
		},
		"broken": func(context.Context, json.RawMessage) (any, error) {
			return nil, errors.New("mimir timeout with internal details")
		},
	})
	defer srv.Close()

	cases := []struct {
		tool   string
		status int
		code   string
	}{
		{"bad", 400, "invalid_query"},
		{"denied", 403, "forbidden"},
		{"broken", 503, "unavailable"},
		{"missing", 501, "unknown"},
	}
	for _, c := range cases {
		res, out := post(t, srv.URL+"/v1/tools/"+c.tool, `{}`)
		if res.StatusCode != c.status || out["code"] != c.code {
			t.Errorf("%s: got %d %v, want %d %s", c.tool, res.StatusCode, out, c.status, c.code)
		}
	}

	_, out := post(t, srv.URL+"/v1/tools/broken", `{}`)
	if strings.Contains(out["message"].(string), "internal") {
		t.Errorf("internal error details leaked: %v", out["message"])
	}
}

func TestRejectsNonJSON(t *testing.T) {
	srv := newServer(Registry{"echo": func(context.Context, json.RawMessage) (any, error) { return nil, nil }})
	defer srv.Close()
	res, _ := post(t, srv.URL+"/v1/tools/echo", `not json`)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("got %d", res.StatusCode)
	}
}

// A result that can't be marshalled (NaN reached the encoder once) must not
// leave the client a 200 with an unparseable body.
func TestUnencodableResultBecomesAnError(t *testing.T) {
	srv := newServer(Registry{"nan": func(context.Context, json.RawMessage) (any, error) {
		return map[string]any{"value": math.NaN()}, nil
	}})
	defer srv.Close()

	res, out := post(t, srv.URL+"/v1/tools/nan", `{}`)
	if res.StatusCode == http.StatusOK {
		t.Fatalf("got 200 for a result that cannot be encoded")
	}
	if out["code"] != "unavailable" {
		t.Errorf("got %v, want an unavailable error", out)
	}
}
