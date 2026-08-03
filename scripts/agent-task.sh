#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$script_dir/lib/output.sh"

[[ -f "$script_dir/agent.env" ]] && source "$script_dir/agent.env"

BASE_BRANCH="${BASE_BRANCH:-main}"
AGENT_EXEC_CMD="${AGENT_EXEC_CMD:-}"

ISSUE="${1:-}"

if [[ -z "$ISSUE" ]]; then
  err "Missing issue number"
  hint "Usage: scripts/agent-task.sh <issue-number>"
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

for command in git gh jq npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    err "Required command is not installed: $command"
    exit 1
  fi
done

if ! gh auth status >/dev/null 2>&1; then
  err "GitHub CLI is not authenticated"
  hint "Run: gh auth login"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  err "Working tree must be clean"
  hint "Commit or stash your changes first"
  exit 1
fi

issue_json="$(gh issue view "$ISSUE" --json number,title,body,url,state,labels)"

if [[ "$(jq -r '.state' <<<"$issue_json")" != "OPEN" ]]; then
  err "Issue #$ISSUE is not open"
  exit 1
fi

title="$(jq -r '.title' <<<"$issue_json")"

prefix="$(jq -r '
  (.labels // []) | map(.name) as $names
  | if ($names | index("type:bug")) then "fix"
    elif ($names | index("type:feature")) then "feat"
    elif ($names | index("type:refactor")) then "refactor"
    else "chore"
    end
' <<<"$issue_json")"

slug="$(
  printf '%s' "$title" |
    tr '[:upper:]' '[:lower:]' |
    sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g' |
    cut -c1-45 |
    sed -E 's/-+$//'
)"

branch="${prefix}/${ISSUE}-${slug}"

step "Issue ${C_BOLD}#$ISSUE${C_RESET} ${C_DIM}·${C_RESET} $title"
step "Fetching origin/$BASE_BRANCH"
git fetch origin "$BASE_BRANCH"

if git show-ref --verify --quiet "refs/heads/$branch"; then
  git switch "$branch"
else
  gh issue develop "$ISSUE" \
    --base "$BASE_BRANCH" \
    --name "$branch" \
    --checkout
fi
ok "Branch ${C_BOLD}$branch${C_RESET}"

gh issue edit "$ISSUE" \
  --remove-label "status:ready" \
  --add-label "status:in-progress" >/dev/null 2>&1 || true

prompt="$(
  jq -r --arg base "$BASE_BRANCH" '
    "Implement GitHub issue #\(.number).

Title:
\(.title)

Issue description:
\(.body)

Issue URL:
\(.url)

Base branch:
\($base)

Required workflow:

1. Read every applicable AGENTS.md file.
2. Inspect the existing implementation and tests.
3. Implement only the requested scope.
4. Add or update tests.
5. Run all validation commands (npm run check).
6. Review the final diff against origin/\($base).
7. Commit the completed implementation.
8. Do not merge anything.
9. Do not modify unrelated files."
  ' <<<"$issue_json"
)"

if [[ -z "$AGENT_EXEC_CMD" ]]; then
  warn "AGENT_EXEC_CMD is not set; printing the prompt instead of running an agent"
  hint "Configure it in scripts/agent.env to run your CLI automatically"
  rule
  printf '%s\n' "$prompt"
  exit 0
fi

rule
step "Running agent on the task prompt"
rule
printf '%s\n' "$prompt" | eval "$AGENT_EXEC_CMD"
rule

if [[ -n "$(git status --porcelain)" ]]; then
  err "Agent left uncommitted changes; not publishing"
  hint "Review and commit or discard the changes, then re-run scripts/agent-task.sh $ISSUE"
  exit 1
fi

if [[ -z "$(git log "origin/${BASE_BRANCH}..HEAD" --oneline 2>/dev/null)" ]]; then
  err "No commits on $branch beyond origin/$BASE_BRANCH; nothing to publish"
  hint "The agent produced no changes for issue #$ISSUE"
  exit 1
fi

step "Installing dependencies (npm ci)"
if ! npm ci; then
  err "Clean dependency install failed; not publishing"
  hint "Fix the install failure, then re-run scripts/agent-task.sh $ISSUE"
  exit 1
fi
ok "Dependencies installed"

step "Validating (npm run check)"
if ! npm run check; then
  err "Validation failed; not publishing"
  hint "Fix the failures, commit, then re-run scripts/agent-task.sh $ISSUE"
  exit 1
fi
ok "Validation passed"

step "Pushing $branch"
git push -u origin "$branch"

existing_pr="$(
  gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty'
)"

if [[ -n "$existing_pr" ]]; then
  ok "Pull request ${C_BOLD}#$existing_pr${C_RESET} already exists; updated with new commits"
else
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

## Changes

${summary}

## Validation

- [x] \`npm ci\`
- [x] \`npm run check\`

## Risks

- No known risks beyond the normal review required before merge.

## Review status

Awaiting independent AI review (run scripts/review-loop.sh).
Do not merge until review findings are resolved.
EOF
)"
  )"
  existing_pr="$(gh pr view "$pr_url" --json number --jq '.number')"
  ok "Created draft pull request ${C_BOLD}#$existing_pr${C_RESET}"
  printf '  %s%s%s\n' "$C_DIM" "$pr_url" "$C_RESET"
fi

gh issue edit "$ISSUE" \
  --remove-label "status:in-progress" \
  --add-label "status:review" >/dev/null 2>&1 || true

rule
ok "Task published. Next: ${C_BOLD}scripts/review-loop.sh $ISSUE${C_RESET}"
