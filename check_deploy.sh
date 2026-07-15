#!/usr/bin/env bash

set -euo pipefail

git status

WORKFLOW_NAME=${WORKFLOW_NAME:-"CI"}
POLL_INTERVAL=${1:-10}
DEPLOY_URL=${DEPLOY_URL:-}

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is not installed or not in PATH." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

echo "Watching \"$WORKFLOW_NAME\" workflow (polling every ${POLL_INTERVAL}s)..."

while true; do
  runs_json=$(gh run list \
    --workflow "$WORKFLOW_NAME" \
    --limit 1 \
    --json status,conclusion,displayTitle,headBranch,headSha,createdAt,updatedAt,url 2>/dev/null)

  if [[ -z "$runs_json" || "$runs_json" == "[]" ]]; then
    echo "No runs found for workflow \"$WORKFLOW_NAME\"."
    exit 1
  fi

  status=$(jq -r '.[0].status' <<<"$runs_json")
  conclusion=$(jq -r '.[0].conclusion // "pending"' <<<"$runs_json")
  title=$(jq -r '.[0].displayTitle' <<<"$runs_json")
  branch=$(jq -r '.[0].headBranch' <<<"$runs_json")
  sha=$(jq -r '.[0].headSha[:7]' <<<"$runs_json")
  updated=$(jq -r '.[0].updatedAt' <<<"$runs_json")
  created=$(jq -r '.[0].createdAt' <<<"$runs_json")
  url=$(jq -r '.[0].url' <<<"$runs_json")

  if [[ "$status" == "completed" ]]; then
    echo "Latest run completed ($conclusion): $title"
    echo "Branch: $branch @ $sha"
    echo "Started: $created"
    echo "Finished: $updated"
    echo "Details: $url"
    if [[ "$conclusion" != "success" ]]; then
      exit 1
    fi
    break
  else
    echo "Run in progress ($status): $title [$branch @ $sha] - checking again in ${POLL_INTERVAL}s..."
    sleep "$POLL_INTERVAL"
  fi
done

if [[ -z "$DEPLOY_URL" ]]; then
  echo "CI passed. Set DEPLOY_URL to verify a Cloudflare preview or production deployment."
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required for deployment verification." >&2
  exit 1
fi

DEPLOY_URL=${DEPLOY_URL%/}
echo "Checking Cloudflare deployment at $DEPLOY_URL..."

root_headers=$(curl -fsSI "$DEPLOY_URL/")
debug_status=$(curl -fsS -o /dev/null -w '%{http_code}' -H 'Sec-Fetch-Mode: navigate' "$DEPLOY_URL/debug")
sw_headers=$(curl -fsSI "$DEPLOY_URL/sw.js")

if grep -qi '^server: GitHub\.com' <<<"$root_headers"; then
  echo "Error: $DEPLOY_URL is still served by GitHub Pages." >&2
  exit 1
fi

if [[ "$debug_status" != "200" ]]; then
  echo "Error: SPA deep link returned HTTP $debug_status instead of 200." >&2
  exit 1
fi

if ! grep -qi '^service-worker-allowed: /' <<<"$sw_headers"; then
  echo "Error: /sw.js is missing the root Service-Worker-Allowed header." >&2
  exit 1
fi

if ! grep -qi '^cache-control:.*no-store' <<<"$sw_headers"; then
  echo "Error: /sw.js is missing its no-store cache policy." >&2
  exit 1
fi

echo "Cloudflare origin, SPA fallback, and root service-worker headers passed."
