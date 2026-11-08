package prom

import (
	"strings"
	"testing"
)

func TestRewriteQueryInjectsNamespace(t *testing.T) {
	cases := []struct {
		name    string
		query   string
		allowed []string
		want    []string // substrings that must all appear in the rewritten query
		notWant []string // substrings that must not appear
	}{
		{
			name:    "plain selector",
			query:   `http_requests_total{method="GET"}`,
			allowed: []string{"shop", "payments"},
			want:    []string{`namespace=~"shop|payments"`, `method="GET"`},
		},
		{
			name:    "or on() vector(1) leaves the literal side alone",
			query:   `up or on() vector(1)`,
			allowed: []string{"shop"},
			want:    []string{`namespace="shop"`, `vector(1)`},
		},
		{
			name:    "subquery selector is still rewritten",
			query:   `max_over_time(rate(http_requests_total[5m])[1h:1m])`,
			allowed: []string{"shop"},
			want:    []string{`namespace="shop"`},
		},
		{
			name:    "name-only selector still gets scoped",
			query:   `{__name__=~".+"}`,
			allowed: []string{"shop"},
			want:    []string{`namespace="shop"`, `__name__=~".+"`},
		},
		{
			name:    "caller-supplied namespace matcher is discarded, not unioned",
			query:   `up{namespace="kube-system"}`,
			allowed: []string{"shop"},
			want:    []string{`namespace="shop"`},
			notWant: []string{"kube-system"},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, injected, err := rewriteQuery(c.query, c.allowed)
			if err != nil {
				t.Fatalf("rewriteQuery(%q): %v", c.query, err)
			}
			for _, w := range c.want {
				if !strings.Contains(got, w) {
					t.Errorf("rewritten query %q missing %q", got, w)
				}
			}
			for _, nw := range c.notWant {
				if strings.Contains(got, nw) {
					t.Errorf("rewritten query %q must not contain %q", got, nw)
				}
			}
			if injected == "" {
				t.Errorf("expected a non-empty injected matcher")
			}
		})
	}
}

func TestRewriteQueryInvalidSyntaxReportsPosition(t *testing.T) {
	_, _, err := rewriteQuery(`http_requests_total{method=`, []string{"shop"})
	if err == nil {
		t.Fatal("expected a parse error")
	}
	if err.Position == 0 {
		t.Errorf("expected a non-zero position for the broken character, got %d", err.Position)
	}
}
