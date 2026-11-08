package api

import (
	"net/http"
	"strings"
)

// CORS lets a browser origin call the Gateway cross-origin: the host app and
// the Gateway are commonly on different ports or hosts (spec.md: "It can run
// standalone or as a sidecar next to the host app"). Only origins in
// allowedOrigins are ever echoed back; anything else gets no CORS headers at
// all, so the browser's same-origin policy still blocks it.
func CORS(allowedOrigins []string, next http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		allowed[o] = struct{}{}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, ok := allowed[origin]; ok {
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Origin", origin)
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-OpsKit-Dev-User, X-OpsKit-Dev-Groups")
			}
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
