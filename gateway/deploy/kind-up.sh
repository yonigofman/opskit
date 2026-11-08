#!/usr/bin/env bash
# Creates the local kind cluster the Gateway's Kubernetes tools run against,
# with namespaces, workloads and RBAC: yoni can read pods in shop, dana in
# payments, and neither can read the other's.
#
# The kubeconfig written here is kind's admin credential. The Gateway uses it
# only to impersonate the viewer, never to read as itself, and it is
# gitignored. In a real cluster this is a ServiceAccount with `impersonate`.
set -euo pipefail

CLUSTER=opskit
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "creating kind cluster $CLUSTER..."
  kind create cluster --name "$CLUSTER" --wait 120s
fi

kubectl --context "kind-$CLUSTER" apply -f "$DIR/kind.yaml"

# The in-network address, so the Gateway container can reach the API server
# over the shared `kind` docker network.
kind get kubeconfig --name "$CLUSTER" --internal > "$DIR/kind-kubeconfig.yaml"
echo "wrote $DIR/kind-kubeconfig.yaml (gitignored)"

kubectl --context "kind-$CLUSTER" -n shop wait --for=condition=Ready pod -l app=cart --timeout=120s >/dev/null || true
echo
kubectl --context "kind-$CLUSTER" get pods -n shop
echo
echo "yoni can list pods in shop:     $(kubectl --context "kind-$CLUSTER" auth can-i list pods -n shop --as yoni)"
echo "yoni can list pods in payments: $(kubectl --context "kind-$CLUSTER" auth can-i list pods -n payments --as yoni)"
