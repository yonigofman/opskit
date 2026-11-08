// Package tool defines each Gateway tool once (name, typed args, handler,
// whether it may ever mutate) so the same Spec serves the HTTP Tools API
// today and an MCP adapter later. Only ReadOnly specs may ever be exposed
// over MCP; action_plan/action_execute are defined with ReadOnly: false and
// are structurally excluded from it.
package tool

import (
	"context"
	"encoding/json"

	"github.com/yonigofman/opskit/gateway/internal/access"
	"github.com/yonigofman/opskit/gateway/internal/api"
)

// Spec is one tool: a name, whether it may mutate, and a handler that takes
// the caller's identity explicitly (never read from ambient context) plus
// raw JSON args.
type Spec struct {
	Name     string
	ReadOnly bool
	Call     func(ctx context.Context, id access.Identity, args json.RawMessage) (any, error)
}

// Define wraps a typed handler into a Spec, decoding args into Args before
// calling fn. Write each tool's contract once as the fn signature.
func Define[Args, Result any](name string, readOnly bool, fn func(ctx context.Context, id access.Identity, args Args) (Result, error)) Spec {
	return Spec{
		Name:     name,
		ReadOnly: readOnly,
		Call: func(ctx context.Context, id access.Identity, raw json.RawMessage) (any, error) {
			var args Args
			if len(raw) > 0 {
				if err := json.Unmarshal(raw, &args); err != nil {
					return nil, &api.Error{Status: 400, Code: "invalid_query", Message: "arguments do not match this tool's contract"}
				}
			}
			return fn(ctx, id, args)
		},
	}
}

// Registry holds every Spec the Gateway knows about.
type Registry struct {
	specs map[string]Spec
}

// NewRegistry builds a Registry from a set of Specs.
func NewRegistry(specs ...Spec) *Registry {
	r := &Registry{specs: make(map[string]Spec, len(specs))}
	for _, s := range specs {
		r.specs[s.Name] = s
	}
	return r
}

// ReadOnly returns the specs an MCP adapter may ever register.
func (r *Registry) ReadOnly() []Spec {
	out := make([]Spec, 0, len(r.specs))
	for _, s := range r.specs {
		if s.ReadOnly {
			out = append(out, s)
		}
	}
	return out
}

// ToAPI adapts the Registry to the HTTP Tools API, resolving the caller's
// identity from ctx for every call.
func (r *Registry) ToAPI(identityFromContext func(ctx context.Context) (access.Identity, error)) api.Registry {
	out := make(api.Registry, len(r.specs))
	for name, spec := range r.specs {
		out[name] = func(ctx context.Context, args json.RawMessage) (any, error) {
			id, err := identityFromContext(ctx)
			if err != nil {
				return nil, &api.Error{Status: 403, Code: "forbidden", Message: "no identity on this request"}
			}
			return spec.Call(ctx, id, args)
		}
	}
	return out
}
