// Package kube is the Kubernetes adapter. Every call runs as the viewer
// through impersonation, so the cluster's own RBAC decides what comes back:
// the Gateway's ServiceAccount needs nothing but `impersonate`.
//
// There is deliberately no shared informer. One cache populated by the
// Gateway's own credentials would mean reading as the Gateway rather than as
// the viewer, which is exactly the escalation the security model rules out.
package kube

import (
	"sort"
	"strings"
	"sync"

	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"

	"github.com/yonigofman/opskit/gateway/internal/access"
)

// clients hands out one impersonating clientset per identity, so repeated
// calls by the same viewer reuse a connection pool instead of building one.
type clients struct {
	base *rest.Config

	mu     sync.Mutex
	byUser map[string]kubernetes.Interface
}

func newClients(base *rest.Config) *clients {
	return &clients{base: base, byUser: map[string]kubernetes.Interface{}}
}

// identityKey is stable for the same user and group set, in any order.
func identityKey(id access.Identity) string {
	groups := append([]string(nil), id.Groups...)
	sort.Strings(groups)
	return id.User + "\x00" + strings.Join(groups, ",")
}

func (c *clients) get(id access.Identity) (kubernetes.Interface, error) {
	key := identityKey(id)

	c.mu.Lock()
	defer c.mu.Unlock()
	if client, ok := c.byUser[key]; ok {
		return client, nil
	}

	cfg := rest.CopyConfig(c.base)
	cfg.Impersonate = rest.ImpersonationConfig{UserName: id.User, Groups: id.Groups}
	client, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	c.byUser[key] = client
	return client, nil
}
