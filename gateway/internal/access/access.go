// Package access resolves which Kubernetes namespaces an identity may read.
//
// Kubernetes calls use impersonation and the cluster's own RBAC decides.
// Prometheus/Mimir and Loki have no per-namespace RBAC, so every query is
// scoped by injecting a namespace matcher built from this package.
package access

import "context"

// Identity is who a request runs as. The Gateway never substitutes its own
// identity for the viewer's.
type Identity struct {
	User   string
	Groups []string
}

// Resolver returns the namespaces an identity may read. An empty, non-error
// result means the identity can read nothing: callers must treat that as
// forbidden and never query upstream.
type Resolver interface {
	Namespaces(ctx context.Context, id Identity) ([]string, error)
}
