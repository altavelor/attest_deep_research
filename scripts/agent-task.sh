#!/usr/bin/env bash
#
# Prepare a task branch for a GitHub issue and hand a normalized prompt to a
# coding agent. The agent CLI is configured in scripts/agent.env (AGENT_EXEC_CMD)
# so this workflow is not tied to any single vendor.
#
# Usage: scripts/agent-task.sh <issue-number>

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/agent.env
[[ -f "$script_dir/agent.env" ]] && source "$script_dir/agent.env"

BASE_BRANCH="${BASE_BRANCH:-main}"
AGENT_EXEC_CMD="${AGENT_EXEC_CMD:-}"

ISSUE="${1:-}"

if [[ -z "$ISSUE" ]]; then
  echo "Usage: scripts/agent-task.sh <issue-number>" >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

for command in git gh jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is not installed: $command" >&2
    exit 1
  fi
done

if ! gh auth status >/dev/null 2>&1; then
  echo "GitHub CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree must be clean." >&2
  exit 1
fi

issue_json="$(gh issue view "$ISSUE" --json number,title,body,url,state,labels)"

if [[ "$(jq -r '.state' <<<"$issue_json")" != "OPEN" ]]; then
  echo "Issue #$ISSUE is not open." >&2
  exit 1
fi

title="$(jq -r '.title' <<<"$issue_json")"

# Derive the Conventional-Commit branch prefix from the issue's type:* label so
# branch names match AGENTS.md (feat/fix/refactor/chore). Default to chore.
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

git fetch origin "$BASE_BRANCH"

if git show-ref --verify --quiet "refs/heads/$branch"; then
  git switch "$branch"
else
  gh issue develop "$ISSUE" \
    --base "$BASE_BRANCH" \
    --name "$branch" \
    --checkout
fi

gh issue edit "$ISSUE" \
  --remove-label "status:ready" \
  --add-label "status:in-progress" || true

# The issue body is untrusted external input. It is passed to the agent as task
# data (a prompt), never executed as a shell command.
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

echo "Branch: $branch"
echo "Issue:  #$ISSUE"
echo

if [[ -z "$AGENT_EXEC_CMD" ]]; then
  echo "AGENT_EXEC_CMD is not set; printing the prompt instead of running an agent." >&2
  echo "Configure it in scripts/agent.env to run your CLI automatically." >&2
  echo
  printf '%s\n' "$prompt"
  exit 0
fi

# Feed the prompt on STDIN so large prompts and special characters are safe.
printf '%s\n' "$prompt" | eval "$AGENT_EXEC_CMD"
