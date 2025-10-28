#!/usr/bin/env bash

set -euo pipefail

WORKFLOW_NAME=${WORKFLOW_NAME:-"Build and Deploy to GitHub Pages"}
POLL_INTERVAL=${1:-10}

if ! command -v gh >/dev/null 2>&1; then
  echo "Error: GitHub CLI (gh) is not installed or not in PATH." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

echo "Watching \"$WORKFLOW_NAME\" workflow (polling every ${POLL_INTERVAL}s)…"

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
    break
  else
    echo "Run in progress ($status): $title [$branch @ $sha] – checking again in ${POLL_INTERVAL}s…"
    sleep "$POLL_INTERVAL"
  fi
done
