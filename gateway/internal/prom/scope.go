// Package prom is the Prometheus/Mimir adapter: it rewrites every query
// through the PromQL AST to scope it to the caller's namespaces, then calls
// upstream, caches and returns provenance.
package prom

import (
	"strings"

	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql/parser"
)

// namespaceMatcher builds the matcher injected into every selector. A single
// namespace uses MatchEqual; more than one uses MatchRegexp.
func namespaceMatcher(allowed []string) *labels.Matcher {
	if len(allowed) == 1 {
		return labels.MustNewMatcher(labels.MatchEqual, "namespace", allowed[0])
	}
	return labels.MustNewMatcher(labels.MatchRegexp, "namespace", strings.Join(allowed, "|"))
}

// rewriteQuery parses query and forces a namespace matcher built from
// allowed onto every vector/matrix selector, through the AST rather than
// string or regex rewriting. Any namespace matcher the caller supplied is
// discarded, never unioned or intersected with: the caller never gets to
// widen its own scope. It returns the rewritten query and the exact matcher
// string injected, for provenance.
func rewriteQuery(query string, allowed []string) (rewritten string, injected string, err *parseError) {
	expr, perr := parser.ParseExpr(query)
	if perr != nil {
		return "", "", toParseError(perr)
	}

	matcher := namespaceMatcher(allowed)
	parser.Inspect(expr, func(node parser.Node, _ []parser.Node) error {
		sel, ok := node.(*parser.VectorSelector)
		if !ok {
			return nil
		}
		kept := sel.LabelMatchers[:0]
		for _, m := range sel.LabelMatchers {
			if m.Name != "namespace" {
				kept = append(kept, m)
			}
		}
		sel.LabelMatchers = append(kept, matcher)
		return nil
	})

	return expr.String(), matcher.String(), nil
}

// parseError carries the character offset parser.ParseErr reports, mapped
// to the client's invalid_query contract.
type parseError struct {
	Message  string
	Position int
}

func toParseError(err error) *parseError {
	switch e := err.(type) {
	case *parser.ParseErr:
		return &parseError{Message: "could not parse query", Position: int(e.PositionRange.Start)}
	case parser.ParseErrors:
		if len(e) > 0 {
			return &parseError{Message: "could not parse query", Position: int(e[0].PositionRange.Start)}
		}
	}
	return &parseError{Message: "could not parse query", Position: 0}
}
