#!/usr/bin/env bash
#
# Create (or update) the labels used by the agent task workflow. The task and
# publish scripts assume these labels exist, so run this once per repository
# before using them.
#
# Usage: scripts/setup-labels.sh

set -euo pipefail

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated." >&2
  exit 1
fi

# label|color|description
labels=(
  "agent|5319e7|Task intended for an automated coding agent"
  "status:ready|0e8a16|Ready to be picked up"
  "status:in-progress|fbca04|Implementation in progress"
  "status:review|1d76db|Awaiting independent review"
  "status:blocked|b60205|Blocked"
  "type:bug|d73a4a|Bug fix"
  "type:feature|a2eeef|New feature"
  "type:refactor|c5def5|Refactor without behavior change"
  "risk:low|c2e0c6|Low risk"
  "risk:medium|fbca04|Medium risk"
  "risk:high|e99695|High risk"
)

for entry in "${labels[@]}"; do
  IFS='|' read -r name color description <<<"$entry"
  gh label create "$name" --color "$color" --description "$description" --force
done

echo "Labels are configured."
