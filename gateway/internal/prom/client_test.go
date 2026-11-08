package prom

import (
	"encoding/json"
	"math"
	"testing"
)

// Prometheus answers with four result types, and NaN/±Inf are ordinary
// outcomes (histogram_quantile over no samples, division by zero) that JSON
// cannot carry. Both used to reach the client as a broken response.
func TestDecodeInstantResultTypes(t *testing.T) {
	cases := []struct {
		name string
		data string
		want *float64
	}{
		{
			name: "vector",
			data: `{"resultType":"vector","result":[{"metric":{"__name__":"up"},"value":[1000,"1"]}]}`,
			want: ptr(1),
		},
		{
			name: "empty vector",
			data: `{"resultType":"vector","result":[]}`,
			want: nil,
		},
		{
			name: "scalar, as scalar() answers",
			data: `{"resultType":"scalar","result":[1000,"42"]}`,
			want: ptr(42),
		},
		{
			name: "NaN is no value, not a broken response",
			data: `{"resultType":"vector","result":[{"metric":{},"value":[1000,"NaN"]}]}`,
			want: nil,
		},
		{
			name: "+Inf is no value",
			data: `{"resultType":"vector","result":[{"metric":{},"value":[1000,"+Inf"]}]}`,
			want: nil,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := decodeInstant(json.RawMessage(c.data))
			if err != nil {
				t.Fatalf("decodeInstant: %v", err)
			}
			switch {
			case c.want == nil && got != nil:
				t.Fatalf("got %v, want no value", *got)
			case c.want != nil && got == nil:
				t.Fatalf("got no value, want %v", *c.want)
			case c.want != nil && *got != *c.want:
				t.Fatalf("got %v, want %v", *got, *c.want)
			}
			if got != nil && (math.IsNaN(*got) || math.IsInf(*got, 0)) {
				t.Errorf("a non-finite value must never be returned: %v", *got)
			}
		})
	}
}

func ptr(f float64) *float64 { return &f }
