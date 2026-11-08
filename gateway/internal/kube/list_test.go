package kube

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/rest"

	"github.com/yonigofman/opskit/gateway/internal/access"
	"github.com/yonigofman/opskit/gateway/internal/api"
	"github.com/yonigofman/opskit/gateway/internal/cache"
)

// fakeAPIServer records what the Gateway sent, so tests can assert the call
// really ran as the viewer rather than as the Gateway.
type fakeAPIServer struct {
	mu       sync.Mutex
	requests []*http.Request
	status   int
	pods     []corev1.Pod
}

func (f *fakeAPIServer) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.requests)
}

func (f *fakeAPIServer) last() *http.Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.requests[len(f.requests)-1]
}

func newFakeAPIServer(t *testing.T, pods ...corev1.Pod) (*fakeAPIServer, *rest.Config) {
	t.Helper()
	f := &fakeAPIServer{status: http.StatusOK, pods: pods}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.requests = append(f.requests, r.Clone(r.Context()))
		status, pods := f.status, f.pods
		f.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		if status != http.StatusOK {
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(metav1.Status{
				Status: metav1.StatusFailure, Code: int32(status), Reason: metav1.StatusReasonForbidden,
				Message: `pods is forbidden: User "yoni" cannot list resource "pods" in namespace "payments"`,
			})
			return
		}
		_ = json.NewEncoder(w).Encode(corev1.PodList{Items: pods})
	}))
	t.Cleanup(srv.Close)
	return f, &rest.Config{Host: srv.URL}
}

func newTestAdapter(cfg *rest.Config) *Adapter {
	return New(cfg, cache.New(time.Minute), "test")
}

func pod(name string, opts ...func(*corev1.Pod)) corev1.Pod {
	p := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: "shop"},
		Spec:       corev1.PodSpec{NodeName: "node-1"},
		Status: corev1.PodStatus{
			Phase:             corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{Ready: true}},
		},
	}
	for _, o := range opts {
		o(&p)
	}
	return p
}

func TestListRunsAsTheViewer(t *testing.T) {
	f, cfg := newFakeAPIServer(t, pod("checkout-abc"))
	a := newTestAdapter(cfg)

	result, err := a.listHandler(context.Background(), access.Identity{User: "yoni", Groups: []string{"sre", "dev"}}, K8sListArgs{
		Kind: "Pod", Namespace: "shop",
	})
	if err != nil {
		t.Fatal(err)
	}

	req := f.last()
	if got := req.Header.Get("Impersonate-User"); got != "yoni" {
		t.Errorf("Impersonate-User = %q, want yoni: the call must run as the viewer", got)
	}
	if got := req.Header.Values("Impersonate-Group"); len(got) != 2 || got[0] != "sre" {
		t.Errorf("Impersonate-Group = %v, want [sre dev]", got)
	}
	if len(result.Pods) != 1 || result.Pods[0].Name != "checkout-abc" {
		t.Fatalf("got %+v", result.Pods)
	}
	if result.Provenance.Source != "kubernetes" || result.Provenance.Identity != "yoni" {
		t.Errorf("unexpected provenance: %+v", result.Provenance)
	}
}

func TestListForwardsTheLabelSelector(t *testing.T) {
	f, cfg := newFakeAPIServer(t)
	a := newTestAdapter(cfg)

	if _, err := a.listHandler(context.Background(), access.Identity{User: "yoni"}, K8sListArgs{
		Kind: "Pod", Namespace: "shop", LabelSelector: "app=cart",
	}); err != nil {
		t.Fatal(err)
	}
	if got := f.last().URL.Query().Get("labelSelector"); got != "app=cart" {
		t.Errorf("labelSelector = %q, want app=cart", got)
	}
}

func TestListRejectsBadArgsWithoutCallingTheCluster(t *testing.T) {
	cases := []struct {
		name string
		args K8sListArgs
	}{
		{"unsupported kind", K8sListArgs{Kind: "Secret", Namespace: "shop"}},
		{"no namespace", K8sListArgs{Kind: "Pod"}},
		{"broken selector", K8sListArgs{Kind: "Pod", Namespace: "shop", LabelSelector: "app in ("}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f, cfg := newFakeAPIServer(t)
			a := newTestAdapter(cfg)

			_, err := a.listHandler(context.Background(), access.Identity{User: "yoni"}, c.args)
			apiErr, ok := err.(*api.Error)
			if !ok || apiErr.Code != "invalid_query" {
				t.Fatalf("got %v, want invalid_query", err)
			}
			if f.calls() != 0 {
				t.Errorf("the cluster must not be called for arguments we can reject ourselves")
			}
		})
	}
}

func TestListForbiddenKeepsTheClusterMessageOut(t *testing.T) {
	f, cfg := newFakeAPIServer(t)
	f.status = http.StatusForbidden
	a := newTestAdapter(cfg)

	_, err := a.listHandler(context.Background(), access.Identity{User: "yoni"}, K8sListArgs{Kind: "Pod", Namespace: "payments"})
	apiErr, ok := err.(*api.Error)
	if !ok || apiErr.Code != "forbidden" {
		t.Fatalf("got %v, want forbidden", err)
	}
	if apiErr.Identity != "yoni" {
		t.Errorf("forbidden must say who it ran as, got %q", apiErr.Identity)
	}
	if apiErr.Message != "No list on pods in this namespace." {
		t.Errorf("the cluster's own wording must not reach the client: %q", apiErr.Message)
	}
}

func TestListCacheIsPerIdentity(t *testing.T) {
	f, cfg := newFakeAPIServer(t, pod("checkout-abc"))
	a := newTestAdapter(cfg)
	args := K8sListArgs{Kind: "Pod", Namespace: "shop"}

	first, err := a.listHandler(context.Background(), access.Identity{User: "yoni"}, args)
	if err != nil {
		t.Fatal(err)
	}
	again, err := a.listHandler(context.Background(), access.Identity{User: "yoni"}, args)
	if err != nil {
		t.Fatal(err)
	}
	other, err := a.listHandler(context.Background(), access.Identity{User: "dana"}, args)
	if err != nil {
		t.Fatal(err)
	}

	if f.calls() != 2 {
		t.Fatalf("want 2 calls (yoni once, dana once), got %d", f.calls())
	}
	if first.Provenance.Cache != "miss" || again.Provenance.Cache != "hit" {
		t.Errorf("got %q then %q", first.Provenance.Cache, again.Provenance.Cache)
	}
	if again.Provenance.Identity != "yoni" || other.Provenance.Identity != "dana" {
		t.Errorf("a cache hit must report its own caller: %q, %q", again.Provenance.Identity, other.Provenance.Identity)
	}
}

func TestSummarizeUsesKubernetesWords(t *testing.T) {
	crashing := pod("checkout-crash", func(p *corev1.Pod) {
		p.Status.ContainerStatuses = []corev1.ContainerStatus{
			{Ready: false, RestartCount: 7, State: corev1.ContainerState{
				Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"},
			}},
			{Ready: true, RestartCount: 1},
		}
	})
	terminating := pod("checkout-bye", func(p *corev1.Pod) {
		now := metav1.NewTime(time.Now())
		p.DeletionTimestamp = &now
		p.Status.ContainerStatuses = []corev1.ContainerStatus{
			{Ready: false, State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "ContainerCreating"}}},
		}
	})

	got := summarize(&crashing)
	if got.Status != "CrashLoopBackOff" {
		t.Errorf("status = %q, want CrashLoopBackOff", got.Status)
	}
	if got.Ready != 1 || got.Containers != 2 || got.Restarts != 8 {
		t.Errorf("got ready=%d/%d restarts=%d, want 1/2 and 8", got.Ready, got.Containers, got.Restarts)
	}

	if s := summarize(&terminating); s.Status != "Terminating" {
		t.Errorf("a pod being deleted reads Terminating, got %q", s.Status)
	}
	if s := summarize(&[]corev1.Pod{pod("ok")}[0]); s.Status != "Running" {
		t.Errorf("status = %q, want Running", s.Status)
	}
}
