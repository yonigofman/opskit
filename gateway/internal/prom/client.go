package prom

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
)

// upstream is the minimal Prometheus HTTP API client the adapter needs.
type upstream struct {
	base   string
	client *http.Client
}

type apiEnvelope struct {
	Status    string          `json:"status"`
	Data      json.RawMessage `json:"data"`
	ErrorType string          `json:"errorType"`
	Error     string          `json:"error"`
}

// apiResult covers the vector and matrix result types, where result is a
// list of series. The scalar and string types put a bare [ts, value] pair in
// result instead, so they are decoded separately: see decodeInstant.
type apiResult struct {
	ResultType string `json:"resultType"`
	Result     []struct {
		Metric map[string]string      `json:"metric"`
		Value  [2]json.RawMessage     `json:"value"`  // instant
		Values []([2]json.RawMessage) `json:"values"` // range
	} `json:"result"`
}

// resultTypeOf reads just the resultType, before committing to a shape for result.
func resultTypeOf(data json.RawMessage) string {
	var head struct {
		ResultType string `json:"resultType"`
	}
	_ = json.Unmarshal(data, &head)
	return head.ResultType
}

// queryRange calls /api/v1/query_range and returns one series per result.
func (u *upstream) queryRange(ctx context.Context, query string, start, end, step int64) ([]rawSeries, error) {
	v := url.Values{
		"query": {query},
		"start": {strconv.FormatInt(start, 10)},
		"end":   {strconv.FormatInt(end, 10)},
		"step":  {strconv.FormatInt(step, 10)},
	}
	data, err := u.do(ctx, "/api/v1/query_range", v)
	if err != nil {
		return nil, err
	}
	var res apiResult
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, fmt.Errorf("decode query_range result: %w", err)
	}

	out := make([]rawSeries, 0, len(res.Result))
	for _, r := range res.Result {
		values := make([][2]float64, 0, len(r.Values))
		for _, pair := range r.Values {
			t, v, err := decodeSample(pair)
			if err != nil {
				return nil, err
			}
			// NaN and ±Inf are ordinary PromQL outcomes but have no JSON
			// representation; a gap is what the chart should show anyway.
			if math.IsNaN(v) || math.IsInf(v, 0) {
				continue
			}
			values = append(values, [2]float64{t, v})
		}
		out = append(out, rawSeries{labels: r.Metric, values: values})
	}
	return out, nil
}

// queryInstant calls /api/v1/query and returns the first series' value, or
// nil if the query matched nothing or evaluated to NaN.
func (u *upstream) queryInstant(ctx context.Context, query string) (*float64, error) {
	data, err := u.do(ctx, "/api/v1/query", url.Values{"query": {query}})
	if err != nil {
		return nil, err
	}
	return decodeInstant(data)
}

func decodeInstant(data json.RawMessage) (*float64, error) {
	// scalar() and string literals answer with a bare [ts, value] pair.
	if t := resultTypeOf(data); t == "scalar" || t == "string" {
		var bare struct {
			Result [2]json.RawMessage `json:"result"`
		}
		if err := json.Unmarshal(data, &bare); err != nil {
			return nil, fmt.Errorf("decode %s result: %w", t, err)
		}
		_, v, err := decodeSample(bare.Result)
		if err != nil {
			return nil, err
		}
		return finite(v), nil
	}

	var res apiResult
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, fmt.Errorf("decode query result: %w", err)
	}
	if len(res.Result) == 0 {
		return nil, nil
	}
	_, v, err := decodeSample(res.Result[0].Value)
	if err != nil {
		return nil, err
	}
	return finite(v), nil
}

// finite maps NaN and ±Inf to "no value": they are ordinary PromQL outcomes
// (histogram_quantile over no samples, division by zero) that JSON can't carry.
func finite(v float64) *float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}

func (u *upstream) do(ctx context.Context, path string, query url.Values) (json.RawMessage, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.base+path+"?"+query.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var env apiEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}
	if env.Status != "success" {
		return nil, &upstreamError{httpStatus: resp.Status, errorType: env.ErrorType, message: env.Error}
	}
	return env.Data, nil
}

// upstreamError is what Prometheus's HTTP API reports when it rejects a
// query. bad_data means the query itself was malformed or unsupported by
// the query engine (distinct from what the Go PromQL parser accepts), so
// callers map it to invalid_query rather than unavailable.
type upstreamError struct {
	httpStatus string
	errorType  string
	message    string
}

func (e *upstreamError) Error() string {
	return fmt.Sprintf("upstream returned %s: %s: %s", e.httpStatus, e.errorType, e.message)
}

func (e *upstreamError) isBadData() bool { return e.errorType == "bad_data" }

func decodeSample(pair [2]json.RawMessage) (t float64, v float64, err error) {
	if err := json.Unmarshal(pair[0], &t); err != nil {
		return 0, 0, fmt.Errorf("decode sample timestamp: %w", err)
	}
	var s string
	if err := json.Unmarshal(pair[1], &s); err != nil {
		return 0, 0, fmt.Errorf("decode sample value: %w", err)
	}
	v, err = strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, 0, fmt.Errorf("parse sample value: %w", err)
	}
	return t, v, nil
}

// rawSeries is one series as decoded off the wire, before it is shaped into
// the client's PromSeries.
type rawSeries struct {
	labels map[string]string
	values [][2]float64
}
