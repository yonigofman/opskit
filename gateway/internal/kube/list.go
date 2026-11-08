package kube

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/rest"

	"github.com/yonigofman/opskit/gateway/internal/access"
	"github.com/yonigofman/opskit/gateway/internal/api"
	"github.com/yonigofman/opskit/gateway/internal/cache"
	"github.com/yonigofman/opskit/gateway/internal/tool"
)

// kindPod is the only kind k8s_list serves today: it is what PodTable needs.
// Others are rejected by name rather than silently returning nothing.
const kindPod = "Pod"

// PodSummary mirrors PodSummary in packages/core/src/types.ts. It is the few
// fields a table shows, not the whole object.
type PodSummary struct {
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	// Status as Kubernetes words it: Running, CrashLoopBackOff, OOMKilled…
	Status     string `json:"status"`
	Ready      int    `json:"ready"`
	Containers int    `json:"containers"`
	Restarts   int32  `json:"restarts"`
	Node       string `json:"node"`
	/// Unix milliseconds the pod started, for age. 0 when it hasn't.
	StartedAt int64 `json:"startedAt"`
}

// K8sListArgs mirrors K8sListArgs in packages/core/src/types.ts.
type K8sListArgs struct {
	Kind          string `json:"kind"`
	Namespace     string `json:"namespace"`
	LabelSelector string `json:"labelSelector"`
}

// K8sListResult mirrors K8sListResult in packages/core/src/types.ts.
type K8sListResult struct {
	Pods       []PodSummary   `json:"pods"`
	Provenance api.Provenance `json:"provenance"`
}

// Adapter serves the Kubernetes tools as the viewer.
type Adapter struct {
	Cache  *cache.Cache
	System string // human name for provenance, e.g. "Kubernetes · prod"
	Logger *slog.Logger

	clients *clients
}

// New builds an Adapter over a base rest.Config. The config carries how to
// reach and trust the API server; it must not carry a user's credentials,
// because every call impersonates the viewer instead.
func New(base *rest.Config, c *cache.Cache, system string) *Adapter {
	return &Adapter{
		Cache:   c,
		System:  system,
		Logger:  slog.Default(),
		clients: newClients(base),
	}
}

// Specs returns the tools this adapter serves. Read-only: nothing here may
// ever change the cluster.
func (a *Adapter) Specs() []tool.Spec {
	return []tool.Spec{
		tool.Define("k8s_list", true, a.listHandler),
	}
}

func (a *Adapter) listHandler(ctx context.Context, id access.Identity, args K8sListArgs) (K8sListResult, error) {
	if args.Kind != kindPod {
		return K8sListResult{}, &api.Error{
			Status: http.StatusBadRequest, Code: "invalid_query",
			Message: fmt.Sprintf("k8s_list serves kind %q; %q is not available yet", kindPod, args.Kind),
		}
	}
	if args.Namespace == "" {
		return K8sListResult{}, &api.Error{Status: http.StatusBadRequest, Code: "invalid_query", Message: "namespace is required"}
	}
	if _, err := labels.Parse(args.LabelSelector); err != nil {
		return K8sListResult{}, &api.Error{Status: http.StatusBadRequest, Code: "invalid_query", Message: "label selector is not valid"}
	}

	query := describe(args)
	key := fmt.Sprintf("k8s_list|%s|%s", query, identityKey(id))
	if cached, ok := a.Cache.Get(key); ok {
		result := cached.(K8sListResult)
		result.Provenance.Cache = "hit"
		result.Provenance.DurationMs = 0
		result.Provenance.Identity = id.User
		return result, nil
	}

	client, err := a.clients.get(id)
	if err != nil {
		a.Logger.Error("building an impersonating client failed", "user", id.User, "err", err)
		return K8sListResult{}, &api.Error{Status: http.StatusServiceUnavailable, Code: "unavailable", Message: "could not reach the cluster"}
	}

	started := time.Now()
	list, err := client.CoreV1().Pods(args.Namespace).List(ctx, metav1.ListOptions{LabelSelector: args.LabelSelector})
	if err != nil {
		return K8sListResult{}, a.listError(err, id)
	}

	pods := make([]PodSummary, 0, len(list.Items))
	for i := range list.Items {
		pods = append(pods, summarize(&list.Items[i]))
	}

	result := K8sListResult{
		Pods: pods,
		Provenance: api.Provenance{
			Source:     "kubernetes",
			System:     a.System,
			Query:      query,
			Identity:   id.User,
			FetchedAt:  time.Now().UnixMilli(),
			Cache:      "miss",
			DurationMs: time.Since(started).Milliseconds(),
		},
	}
	a.Cache.Set(key, result)
	return result, nil
}

// listError maps the API server's answer to the client's error contract.
// RBAC denials become forbidden; everything else is unavailable, with the
// detail logged rather than returned.
func (a *Adapter) listError(err error, id access.Identity) *api.Error {
	if apierrors.IsForbidden(err) || apierrors.IsUnauthorized(err) {
		return &api.Error{
			Status: http.StatusForbidden, Code: "forbidden",
			Message: "No list on pods in this namespace.", Identity: id.User,
		}
	}
	a.Logger.Error("k8s_list failed", "user", id.User, "err", err)
	return &api.Error{Status: http.StatusServiceUnavailable, Code: "unavailable", Message: "could not reach the cluster"}
}

func describe(args K8sListArgs) string {
	q := fmt.Sprintf("kind=%s namespace=%s", args.Kind, args.Namespace)
	if args.LabelSelector != "" {
		q += " selector=" + args.LabelSelector
	}
	return q
}

// summarize reduces a pod to what a table shows, keeping Kubernetes' own
// words for the status so "CrashLoopBackOff" reads as it does in kubectl.
func summarize(pod *corev1.Pod) PodSummary {
	out := PodSummary{
		Name:       pod.Name,
		Namespace:  pod.Namespace,
		Status:     string(pod.Status.Phase),
		Containers: len(pod.Status.ContainerStatuses),
		Node:       pod.Spec.NodeName,
	}
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.Ready {
			out.Ready++
		}
		out.Restarts += cs.RestartCount
	}
	if reason := blockingReason(pod); reason != "" {
		out.Status = reason
	}
	if pod.DeletionTimestamp != nil {
		out.Status = "Terminating"
	}
	if pod.Status.StartTime != nil {
		out.StartedAt = pod.Status.StartTime.UnixMilli()
	}
	return out
}

// blockingReason is the container reason kubectl shows in place of the phase:
// CrashLoopBackOff, ImagePullBackOff, OOMKilled and friends.
func blockingReason(pod *corev1.Pod) string {
	for _, cs := range pod.Status.ContainerStatuses {
		if cs.State.Waiting != nil && cs.State.Waiting.Reason != "" {
			return cs.State.Waiting.Reason
		}
		if cs.State.Terminated != nil && cs.State.Terminated.Reason != "" && cs.State.Terminated.Reason != "Completed" {
			return cs.State.Terminated.Reason
		}
	}
	return ""
}
