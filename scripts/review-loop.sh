#!/usr/bin/env bash
#
# Drive the review/fix cycle for the current task branch from the local machine.
#
# GitHub cannot reach a local agent, so this script polls the "agent-review"
# status check and reacts:
#   - PASS    -> the review gate is green; this script exits 0.
#   - FAIL    -> it feeds the review findings to the local agent (AGENT_EXEC_CMD),
#               runs validation, commits/pushes, re-triggers the review, repeats.
#
# It stops after MAX_REVIEW_ITERS iterations, when validation fails, or when the
# agent produced no new commit (nothing changed).
#
# Usage: scripts/review-loop.sh [issue-number]

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=scripts/agent.env
[[ -f "$script_dir/agent.env" ]] && source "$script_dir/agent.env"

BASE_BRANCH="${BASE_BRANCH:-main}"
AGENT_EXEC_CMD="${AGENT_EXEC_CMD:-}"
REVIEW_TRIGGER="${REVIEW_TRIGGER:-}"
MAX_REVIEW_ITERS="${MAX_REVIEW_ITERS:-3}"
CHECK_NAME="${REVIEW_CHECK_NAME:-agent-review}"
POLL_INTERVAL="${REVIEW_POLL_INTERVAL:-15}"
POLL_TIMEOUT="${REVIEW_POLL_TIMEOUT:-1800}"
# Where the pass/fail signal comes from:
#   check    -> the CI status check named $CHECK_NAME (needs the review workflow
#               and its API key; deterministic VERDICT).
#   comments -> the built-in Codex Cloud review posted under the PR (no repo key,
#               uses your Codex subscription). Heuristic: a fresh review with new
#               inline findings = fail, a fresh review without them = pass.
REVIEW_SOURCE="${REVIEW_SOURCE:-check}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

for command in git gh jq npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is not installed: $command" >&2
    exit 1
  fi
done

if [[ -z "$AGENT_EXEC_CMD" ]]; then
  echo "AGENT_EXEC_CMD is not set in scripts/agent.env; cannot run the fixer." >&2
  exit 1
fi

branch="$(git branch --show-current)"
if [[ -z "$branch" || "$branch" == "$BASE_BRANCH" ]]; then
  echo "Run from a task branch (not detached HEAD, not $BASE_BRANCH)." >&2
  exit 1
fi

pr_number="$(
  gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty'
)"
if [[ -z "$pr_number" ]]; then
  echo "No open pull request for branch $branch. Publish it first (scripts/publish-task.sh)." >&2
  exit 1
fi

pr_author="$(gh pr view "$pr_number" --json author --jq '.author.login')"

trigger_review() {
  if [[ -z "$REVIEW_TRIGGER" ]]; then
    echo "REVIEW_TRIGGER is not set in scripts/agent.env; cannot request a review." >&2
    return 1
  fi
  gh pr comment "$pr_number" \
    --body "${REVIEW_TRIGGER} the pull request. Review the complete diff against ${BASE_BRANCH} and post inline findings for any blocking issues."
}

# Poll the built-in review comments; echo pass|fail|timeout. A review counts as
# complete once a new PR review (by someone other than the author) appears after
# $since; new inline comments in that window mean there are findings to fix.
wait_for_review_comments() {
  local since="$1" waited=0 new_reviews new_findings
  while (( waited < POLL_TIMEOUT )); do
    new_reviews="$(
      gh api "repos/{owner}/{repo}/pulls/${pr_number}/reviews" \
        --jq "[.[] | select(.submitted_at > \"$since\" and .user.login != \"$pr_author\")] | length" 2>/dev/null || echo 0
    )"
    if [[ "${new_reviews:-0}" -gt 0 ]]; then
      new_findings="$(
        gh api "repos/{owner}/{repo}/pulls/${pr_number}/comments" \
          --jq "[.[] | select(.created_at > \"$since\" and .user.login != \"$pr_author\")] | length" 2>/dev/null || echo 0
      )"
      if [[ "${new_findings:-0}" -gt 0 ]]; then echo "fail"; else echo "pass"; fi
      return 0
    fi
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))
  done
  echo "timeout"
  return 0
}

# Wait until the review check reaches a terminal state; echo pass|fail|timeout.
wait_for_review() {
  local waited=0 state
  while (( waited < POLL_TIMEOUT )); do
    state="$(
      gh pr checks "$pr_number" --json name,state \
        --jq "[.[] | select(.name == \"$CHECK_NAME\")] | last | .state // empty" 2>/dev/null || true
    )"
    case "$state" in
      SUCCESS) echo "pass"; return 0 ;;
      FAILURE | ERROR | CANCELLED | TIMED_OUT) echo "fail"; return 0 ;;
      *) sleep "$POLL_INTERVAL"; waited=$((waited + POLL_INTERVAL)) ;;
    esac
  done
  echo "timeout"
  return 0
}

collect_findings() {
  {
    echo "## Review summaries"
    gh api "repos/{owner}/{repo}/pulls/${pr_number}/reviews" \
      --jq '.[] | select(.body != "") | "- [\(.user.login) / \(.state)] \(.body)"' 2>/dev/null || true
    echo
    echo "## Inline comments"
    gh api "repos/{owner}/{repo}/pulls/${pr_number}/comments" \
      --jq '.[] | "- \(.path):\(.line // .original_line) [\(.user.login)] \(.body)"' 2>/dev/null || true
  }
}

for (( iter = 1; iter <= MAX_REVIEW_ITERS; iter++ )); do
  echo "== Iteration $iter/$MAX_REVIEW_ITERS on PR #$pr_number (source: $REVIEW_SOURCE) =="

  if [[ "$REVIEW_SOURCE" == "comments" ]]; then
    since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "Requesting Codex review and polling PR comments since $since..."
    trigger_review || exit 1
    result="$(wait_for_review_comments "$since")"
  else
    echo "Waiting for status check '$CHECK_NAME'..."
    result="$(wait_for_review)"
  fi

  case "$result" in
    pass)
      echo "Review passed. Nothing to fix."
      exit 0 ;;
    timeout)
      echo "Timed out waiting for the review after ${POLL_TIMEOUT}s." >&2
      exit 1 ;;
    fail)
      echo "Review failed. Incorporating the reviewer's own fixes, then the rest..." ;;
  esac

  before="$(git rev-parse HEAD)"

  # The review integration (e.g. Codex Cloud) may push its own fix commits to the
  # PR branch. Pull them first so the local fixer builds on top of the reviewer's
  # edits and only addresses what is still open, instead of racing/duplicating.
  if ! git pull --rebase origin "$branch"; then
    git rebase --abort 2>/dev/null || true
    echo "Could not rebase onto origin/$branch (conflicting fixes from the review" >&2
    echo "integration). Resolve manually on PR #$pr_number." >&2
    exit 1
  fi

  prompt="$(
    cat "$script_dir/../.github/agent/fix.md"
    echo
    echo "Pull request: #${pr_number} (branch ${branch}, base ${BASE_BRANCH})"
    echo
    echo "The reviewer's own fix commits (if any) are already applied to the working"
    echo "tree. Only address findings that remain unresolved after those edits."
    echo
    collect_findings
  )"

  echo "Running local agent on the remaining findings..."
  printf '%s\n' "$prompt" | eval "$AGENT_EXEC_CMD"

  echo "Running validation..."
  if ! npm run check; then
    echo "Validation failed after the fixer run. Stopping for manual inspection." >&2
    exit 1
  fi

  # The agent may or may not commit on its own; capture any leftover changes.
  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "fix: address review findings (iteration $iter)"
  fi

  after="$(git rev-parse HEAD)"
  if [[ "$before" == "$after" ]]; then
    echo "Neither the reviewer nor the local fixer changed anything; cannot make" >&2
    echo "progress on PR #$pr_number. Stopping." >&2
    exit 1
  fi

  # Reconcile once more in case the reviewer pushed during the fixer run.
  if ! git pull --rebase origin "$branch"; then
    git rebase --abort 2>/dev/null || true
    echo "Could not rebase before pushing; resolve manually on PR #$pr_number." >&2
    exit 1
  fi

  git push

  # In 'comments' mode the next iteration posts the trigger itself (with a fresh
  # $since), so only re-trigger here for 'check' mode. A new push also re-runs
  # the review workflow automatically.
  if [[ "$REVIEW_SOURCE" != "comments" && -n "$REVIEW_TRIGGER" ]]; then
    echo "Re-triggering review: $REVIEW_TRIGGER"
    gh pr comment "$pr_number" \
      --body "${REVIEW_TRIGGER} the updated pull request. Verify previous blocking findings are resolved and review the complete current diff for new regressions."
  fi
done

echo "Reached MAX_REVIEW_ITERS=$MAX_REVIEW_ITERS without a passing review." >&2
echo "Manual intervention required on PR #$pr_number." >&2
exit 1
