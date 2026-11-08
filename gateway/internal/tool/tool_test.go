package tool

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/yonigofman/opskit/gateway/internal/access"
	"github.com/yonigofman/opskit/gateway/internal/api"
)

type echoArgs struct {
	Query string `json:"query"`
}

func TestDefineDecodesArgsAndPassesIdentity(t *testing.T) {
	spec := Define("echo", true, func(_ context.Context, id access.Identity, args echoArgs) (string, error) {
		return id.User + ":" + args.Query, nil
	})

	raw, _ := json.Marshal(echoArgs{Query: "up"})
	out, err := spec.Call(context.Background(), access.Identity{User: "yoni"}, raw)
	if err != nil {
		t.Fatal(err)
	}
	if out != "yoni:up" {
		t.Fatalf("got %v", out)
	}
}

func TestDefineRejectsMismatchedArgs(t *testing.T) {
	spec := Define("echo", true, func(_ context.Context, _ access.Identity, args echoArgs) (string, error) {
		return args.Query, nil
	})

	_, err := spec.Call(context.Background(), access.Identity{}, json.RawMessage(`not json`))
	apiErr, ok := err.(*api.Error)
	if !ok || apiErr.Code != "invalid_query" {
		t.Fatalf("got %v, want invalid_query", err)
	}
}

func TestReadOnlyFiltersMutatingSpecs(t *testing.T) {
	reg := NewRegistry(
		Define("prom_range", true, func(context.Context, access.Identity, echoArgs) (string, error) { return "", nil }),
		Define("action_execute", false, func(context.Context, access.Identity, echoArgs) (string, error) { return "", nil }),
	)

	ro := reg.ReadOnly()
	if len(ro) != 1 || ro[0].Name != "prom_range" {
		t.Fatalf("got %v, want only prom_range", ro)
	}
}

func TestToAPIForbidsMissingIdentity(t *testing.T) {
	reg := NewRegistry(Define("prom_range", true, func(context.Context, access.Identity, echoArgs) (string, error) { return "ok", nil }))
	apiReg := reg.ToAPI(func(context.Context) (access.Identity, error) {
		return access.Identity{}, context.DeadlineExceeded
	})

	_, err := apiReg["prom_range"](context.Background(), json.RawMessage(`{}`))
	apiErr, ok := err.(*api.Error)
	if !ok || apiErr.Code != "forbidden" {
		t.Fatalf("got %v, want forbidden", err)
	}
}

func TestToAPICallsSpecWithResolvedIdentity(t *testing.T) {
	reg := NewRegistry(Define("prom_range", true, func(_ context.Context, id access.Identity, _ echoArgs) (string, error) {
		return id.User, nil
	}))
	apiReg := reg.ToAPI(func(context.Context) (access.Identity, error) {
		return access.Identity{User: "yoni"}, nil
	})

	out, err := apiReg["prom_range"](context.Background(), json.RawMessage(`{}`))
	if err != nil {
		t.Fatal(err)
	}
	if out != "yoni" {
		t.Fatalf("got %v", out)
	}
}
