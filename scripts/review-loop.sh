#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

source "$script_dir/lib/output.sh"

[[ -f "$script_dir/agent.env" ]] && source "$script_dir/agent.env"

BASE_BRANCH="${BASE_BRANCH:-main}"
AGENT_EXEC_CMD="${AGENT_EXEC_CMD:-}"
REVIEW_TRIGGER="${REVIEW_TRIGGER:-}"
MAX_REVIEW_ITERS="${MAX_REVIEW_ITERS:-3}"
CHECK_NAME="${REVIEW_CHECK_NAME:-agent-review}"
POLL_INTERVAL="${REVIEW_POLL_INTERVAL:-15}"
POLL_TIMEOUT="${REVIEW_POLL_TIMEOUT:-1800}"
REVIEW_SOURCE="${REVIEW_SOURCE:-check}"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

for command in git gh jq npm; do
  if ! command -v "$command" >/dev/null 2>&1; then
    err "Required command is not installed: $command"
    exit 1
  fi
done

if [[ -z "$AGENT_EXEC_CMD" ]]; then
  err "AGENT_EXEC_CMD is not set in scripts/agent.env; cannot run the fixer"
  exit 1
fi

branch="$(git branch --show-current)"
if [[ -z "$branch" || "$branch" == "$BASE_BRANCH" ]]; then
  err "Run from a task branch (not detached HEAD, not $BASE_BRANCH)"
  exit 1
fi

pr_number="$(
  gh pr list --head "$branch" --state open --json number --jq '.[0].number // empty'
)"
if [[ -z "$pr_number" ]]; then
  err "No open pull request for branch $branch"
  hint "Create the branch, PR, and push first: scripts/agent-task.sh <issue-number>"
  exit 1
fi

pr_author="$(gh pr view "$pr_number" --json author --jq '.author.login')"

trigger_review() {
  if [[ -z "$REVIEW_TRIGGER" ]]; then
    err "REVIEW_TRIGGER is not set in scripts/agent.env; cannot request a review"
    return 1
  fi
  gh pr comment "$pr_number" \
    --body "${REVIEW_TRIGGER} the pull request. Review the complete diff against ${BASE_BRANCH} and post inline findings for any blocking issues."
}

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
  rule
  step "Iteration ${C_BOLD}$iter/$MAX_REVIEW_ITERS${C_RESET} on PR ${C_BOLD}#$pr_number${C_RESET} ${C_DIM}(source: $REVIEW_SOURCE)${C_RESET}"

  if [[ "$REVIEW_SOURCE" == "comments" ]]; then
    since="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    step "Requesting review and polling PR comments since $since"
    trigger_review || exit 1
    result="$(wait_for_review_comments "$since")"
  else
    step "Waiting for status check '$CHECK_NAME'"
    result="$(wait_for_review)"
  fi

  case "$result" in
    pass)
      ok "Review passed. Nothing to fix."
      exit 0 ;;
    timeout)
      err "Timed out waiting for the review after ${POLL_TIMEOUT}s"
      exit 1 ;;
    fail)
      warn "Review reported findings; incorporating the reviewer's fixes, then the rest" ;;
  esac

  before="$(git rev-parse HEAD)"

  if ! git pull --rebase origin "$branch"; then
    git rebase --abort 2>/dev/null || true
    err "Could not rebase onto origin/$branch (conflicting fixes from the review integration)"
    hint "Resolve manually on PR #$pr_number"
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

  rule
  step "Running local agent on the remaining findings"
  rule
  printf '%s\n' "$prompt" | eval "$AGENT_EXEC_CMD"
  rule

  step "Validating (npm run check)"
  if ! npm run check; then
    err "Validation failed after the fixer run; stopping for manual inspection"
    exit 1
  fi
  ok "Validation passed"

  if [[ -n "$(git status --porcelain)" ]]; then
    git add -A
    git commit -m "fix: address review findings (iteration $iter)"
  fi

  after="$(git rev-parse HEAD)"
  if [[ "$before" == "$after" ]]; then
    err "Neither the reviewer nor the local fixer changed anything; cannot make progress on PR #$pr_number"
    exit 1
  fi

  if ! git pull --rebase origin "$branch"; then
    git rebase --abort 2>/dev/null || true
    err "Could not rebase before pushing; resolve manually on PR #$pr_number"
    exit 1
  fi

  step "Pushing fixes for iteration $iter"
  git push

  if [[ "$REVIEW_SOURCE" != "comments" && -n "$REVIEW_TRIGGER" ]]; then
    step "Re-triggering review: $REVIEW_TRIGGER"
    gh pr comment "$pr_number" \
      --body "${REVIEW_TRIGGER} the updated pull request. Verify previous blocking findings are resolved and review the complete current diff for new regressions."
  fi
done

rule
err "Reached MAX_REVIEW_ITERS=$MAX_REVIEW_ITERS without a passing review"
hint "Manual intervention required on PR #$pr_number"
exit 1
