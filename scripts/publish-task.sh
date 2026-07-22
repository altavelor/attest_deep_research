#!/usr/bin/env bash
#
# Validate, push the current task branch, open a draft pull request linked to
# the issue, and request an independent AI review. The review trigger comment is
# configured in scripts/agent.env (REVIEW_TRIGGER) so this is not tied to any
# single vendor.
#
# Usage: scripts/publish-task.sh <issue-number>

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/agent.env
[[ -f "$script_dir/agent.env" ]] && source "$script_dir/agent.env"

BASE_BRANCH="${BASE_BRANCH:-main}"
REVIEW_TRIGGER="${REVIEW_TRIGGER:-}"

ISSUE="${1:-}"

if [[ -z "$ISSUE" ]]; then
  echo "Usage: scripts/publish-task.sh <issue-number>" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated." >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean before publishing." >&2
  exit 1
fi

current_branch="$(git branch --show-current)"

if [[ -z "$current_branch" ]]; then
  echo "Detached HEAD is not supported." >&2
  exit 1
fi

if [[ "$current_branch" == "$BASE_BRANCH" ]]; then
  echo "Cannot publish directly from $BASE_BRANCH." >&2
  exit 1
fi

echo "Running validation..."
npm run check

echo "Pushing branch..."
git push -u origin "$current_branch"

existing_pr="$(
  gh pr list \
    --head "$current_branch" \
    --state open \
    --json number \
    --jq '.[0].number // empty'
)"

if [[ -n "$existing_pr" ]]; then
  echo "Pull request #$existing_pr already exists; no duplicate review requested."
  gh pr view "$existing_pr"
  exit 0
fi

# Title from the issue keeps a stable, meaningful PR title independent of the
# commit history shape (single vs. multiple commits).
title="$(gh issue view "$ISSUE" --json title --jq '.title')"

summary="$(git log --format='- %s' "origin/${BASE_BRANCH}..HEAD")"

pr_url="$(
  gh pr create \
    --draft \
    --base "$BASE_BRANCH" \
    --title "$title" \
    --body "$(cat <<EOF
## Linked issue

Closes #${ISSUE}

## Summary

${summary}

## Validation

- [x] \`npm run check\`

## Review status

Independent AI review requested.
Do not merge until review findings are resolved.
EOF
)"
)"

pr_number="$(gh pr view "$pr_url" --json number --jq '.number')"

echo "Created pull request #$pr_number:"
echo "$pr_url"

if [[ -n "$REVIEW_TRIGGER" ]]; then
  echo "Requesting independent review via: $REVIEW_TRIGGER"
  gh pr comment "$pr_number" \
    --body "${REVIEW_TRIGGER} this pull request as an independent reviewer. Review the complete diff against ${BASE_BRANCH}. Follow all applicable AGENTS.md review guidelines. Focus on functional regressions, security problems, race conditions, resource leaks, lifecycle violations, incorrect error handling, and missing tests."
else
  echo "REVIEW_TRIGGER is not set; skipping automated review request."
  echo "Set it in scripts/agent.env or request a review manually."
fi

gh issue edit "$ISSUE" \
  --remove-label "status:in-progress" \
  --add-label "status:review" || true

echo
echo "Implementation published. No merge performed."
