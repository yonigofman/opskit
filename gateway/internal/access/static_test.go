package access

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func writeStatic(t *testing.T, yaml string) *StaticResolver {
	t.Helper()
	path := filepath.Join(t.TempDir(), "access.yaml")
	if err := os.WriteFile(path, []byte(yaml), 0o600); err != nil {
		t.Fatal(err)
	}
	r, err := LoadStatic(path)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestStaticResolverUnionsUserAndGroups(t *testing.T) {
	r := writeStatic(t, `
users:
  yoni: [shop]
groups:
  sre: [shop, payments]
`)

	got, err := r.Namespaces(context.Background(), Identity{User: "yoni", Groups: []string{"sre"}})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"payments", "shop"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestStaticResolverUnknownIdentityHasNoNamespaces(t *testing.T) {
	r := writeStatic(t, `
users:
  yoni: [shop]
`)

	got, err := r.Namespaces(context.Background(), Identity{User: "nobody"})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("got %v, want none", got)
	}
}
