package access

import (
	"context"
	"fmt"
	"os"
	"sort"

	"gopkg.in/yaml.v3"
)

// StaticResolver maps users and groups to namespaces from a YAML file. It
// stands in for SelfSubjectAccessReview until that lands.
//
//	users:
//	  yoni: [shop, payments]
//	groups:
//	  sre: [shop, payments, kube-system]
type StaticResolver struct {
	Users  map[string][]string `yaml:"users"`
	Groups map[string][]string `yaml:"groups"`
}

// LoadStatic reads a StaticResolver from a YAML file.
func LoadStatic(path string) (*StaticResolver, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read access file: %w", err)
	}
	var r StaticResolver
	if err := yaml.Unmarshal(data, &r); err != nil {
		return nil, fmt.Errorf("parse access file: %w", err)
	}
	return &r, nil
}

// Namespaces unions the identity's user mapping with every group mapping it
// belongs to, deduplicated and sorted.
func (r *StaticResolver) Namespaces(_ context.Context, id Identity) ([]string, error) {
	set := map[string]struct{}{}
	for _, ns := range r.Users[id.User] {
		set[ns] = struct{}{}
	}
	for _, g := range id.Groups {
		for _, ns := range r.Groups[g] {
			set[ns] = struct{}{}
		}
	}

	out := make([]string, 0, len(set))
	for ns := range set {
		out = append(out, ns)
	}
	sort.Strings(out)
	return out, nil
}
