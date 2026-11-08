#!/usr/bin/env bash
# End-to-end smoke test against `docker compose up --build`: a real
# Prometheus behind the Gateway's namespace injection, not an httptest fake.
set -euo pipefail

GW=http://localhost:8080
pass=0
fail=0

check() {
  local name=$1 got=$2 want=$3
  if [[ "$got" == *"$want"* ]]; then
    echo "ok   - $name"
    pass=$((pass + 1))
  else
    echo "FAIL - $name"
    echo "       want substring: $want"
    echo "       got:            $got"
    fail=$((fail + 1))
  fi
}

echo "waiting for the gateway..."
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$GW/healthz" || true)
  [[ "$code" == "200" ]] && break
  sleep 1
done

echo "waiting for prometheus to have scraped at least once..."
sleep 6

instant() {
  local user=$1 query=$2 groups=${3:-}
  local escaped=${query//\"/\\\"}
  curl -s -X POST "$GW/v1/tools/prom_instant" \
    -H "X-OpsKit-Dev-User: $user" -H "X-OpsKit-Dev-Groups: $groups" \
    -d "{\"query\":\"$escaped\"}"
}

range() {
  local user=$1 query=$2
  local escaped=${query//\"/\\\"}
  local now end
  now=$(date +%s); end=$((now - 30))
  curl -s -X POST "$GW/v1/tools/prom_range" \
    -H "X-OpsKit-Dev-User: $user" \
    -d "{\"query\":\"$escaped\",\"start\":$end,\"end\":$now,\"step\":15}"
}

echo
echo "--- forbidden: no identity at all ---"
out=$(curl -s -X POST "$GW/v1/tools/prom_instant" -d '{"query":"up"}')
check "no identity is forbidden" "$out" '"code":"forbidden"'

echo
echo "--- scoped: yoni (shop) reading up ---"
out=$(instant yoni 'up')
check "yoni's query is scoped to shop" "$out" 'namespace=\"shop\"'
check "yoni's response carries no payments" "$(echo "$out" | grep -c payments || true)" "0"

echo
echo "--- escape attempt: yoni supplies namespace=kube-system itself ---"
out=$(instant yoni 'up{namespace="kube-system"}')
check "caller-supplied namespace is discarded" "$out" 'namespace=\"shop\"'
check "kube-system never reaches the client" "$(echo "$out" | grep -c kube-system || true)" "0"

echo
echo "--- scoped: dana (payments) reading the same query ---"
out=$(instant dana 'up')
check "dana's query is scoped to payments" "$out" 'namespace=\"payments\"'

echo
echo "--- group membership: sre's injected scope spans all its namespaces ---"
# prom_instant returns one value, not one per series, so this checks the
# matcher the Gateway actually sent upstream (provenance.injected), not the
# returned value.
out=$(instant nobody 'up' sre)
check "sre group's scope includes shop" "$out" 'shop'
check "sre group's scope includes payments" "$out" 'payments'
check "sre group's scope includes kube-system" "$out" 'kube-system'

echo
echo "--- cache: same query twice for the same user ---"
# A query no earlier step used, so this isn't riding a still-live cache
# entry from the scoped/escape-attempt checks above.
first=$(instant yoni 'prometheus_build_info')
second=$(instant yoni 'prometheus_build_info')
check "first call misses the cache" "$first" '"cache":"miss"'
check "second call hits the cache" "$second" '"cache":"hit"'
check "cache hit still reports the caller" "$second" '"identity":"yoni"'

echo
echo "--- prom_range ---"
out=$(range yoni 'up')
check "prom_range is scoped and returns series" "$out" '"series":['
check "prom_range provenance has a step" "$out" '"step":15'

echo
echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
