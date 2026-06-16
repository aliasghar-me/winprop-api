#!/usr/bin/env bash
# rollback.sh <env> <previous_sha>
#
# Roll back to a previously deployed image (immutable SHA tag in GHCR).
# Rollback = redeploy the old image; the container CMD re-runs migrate deploy
# (which is a no-op if schema hasn't changed).
#
# To find the previous SHA:
#   git log --oneline          # in the repo
#   gh api /orgs/OWNER/packages/container/winprop-api/versions  # in GHCR
#
# Examples:
#   ./deploy/rollback.sh staging abc1234
#   ./deploy/rollback.sh prod    abc1234
set -euo pipefail

ENV="${1:?Usage: rollback.sh <staging|prod> <previous_sha>}"
PREVIOUS_SHA="${2:?Usage: rollback.sh <staging|prod> <previous_sha>}"

case "$ENV" in
  staging|prod) ;;
  *) echo "Error: env must be 'staging' or 'prod'"; exit 1 ;;
esac

echo "==> Rolling back ${ENV} to winprop-api:${PREVIOUS_SHA}"

# Delegate to deploy.sh — same logic, just a different (old) SHA.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$SCRIPT_DIR/deploy.sh" "$ENV" "$PREVIOUS_SHA"
