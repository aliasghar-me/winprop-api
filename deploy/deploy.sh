#!/usr/bin/env bash
# deploy.sh <env> <image_tag>
#
# Deploy (or re-deploy) a specific image tag to staging or production.
# Run from /opt/winprop on the VPS.
#
# Examples:
#   ./deploy/deploy.sh staging abc1234
#   ./deploy/deploy.sh prod    abc1234
set -euo pipefail

ENV="${1:?Usage: deploy.sh <staging|prod> <image_tag>}"
IMAGE_TAG="${2:?Usage: deploy.sh <staging|prod> <image_tag>}"

case "$ENV" in
  staging|prod) ;;
  *) echo "Error: env must be 'staging' or 'prod'"; exit 1 ;;
esac

COMPOSE_FILE="/opt/winprop/deploy/compose.${ENV}.yml"
ENV_FILE="/opt/winprop/.env.${ENV}"
HEALTH_URL_VAR="HEALTH_URL_${ENV^^}"

# Load the env file to pick up GHCR_OWNER etc.
# shellcheck source=/dev/null
set -a; source "$ENV_FILE"; set +a

echo "==> Deploying winprop-api:${IMAGE_TAG} to ${ENV}"

export IMAGE_TAG

echo "--> Pulling image ghcr.io/${GHCR_OWNER}/winprop-api:${IMAGE_TAG}"
docker compose -f "$COMPOSE_FILE" pull api

echo "--> Starting services"
docker compose -f "$COMPOSE_FILE" up -d

echo "--> Waiting for container to become healthy (up to 60s)"
for i in $(seq 1 12); do
  STATUS=$(docker compose -f "$COMPOSE_FILE" ps --format json api 2>/dev/null \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d[0].get('Health','unknown'))" 2>/dev/null || echo "unknown")
  if [ "$STATUS" = "healthy" ]; then
    echo "    Container is healthy (attempt ${i})"
    break
  fi
  echo "    attempt ${i}/12 — status: ${STATUS}, waiting 5s…"
  sleep 5
done

# Derive health URL from the running Caddy domain if not set externally.
# Override by setting HEALTH_URL_STAGING or HEALTH_URL_PROD in the env file.
if [ -n "${!HEALTH_URL_VAR:-}" ]; then
  HEALTH_URL="${!HEALTH_URL_VAR}"
elif [ "$ENV" = "staging" ]; then
  HEALTH_URL="https://api-staging.${DOMAIN:-yourdomain.com}/health"
else
  HEALTH_URL="https://api.${DOMAIN:-yourdomain.com}/health"
fi

echo "--> Health check: ${HEALTH_URL}"
if curl --fail --silent --max-time 10 --retry 3 --retry-delay 5 "$HEALTH_URL"; then
  echo ""
  echo "==> Deploy succeeded: winprop-api:${IMAGE_TAG} is live on ${ENV}"
else
  echo ""
  echo "ERROR: Health check failed. Rolling back is manual — run:"
  echo "  ./deploy/rollback.sh ${ENV} <previous_sha>"
  exit 1
fi
