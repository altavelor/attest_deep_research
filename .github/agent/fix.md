Address the actionable findings from the independent AI review of the current
pull request.

Workflow:

1. Read the linked GitHub issue and the complete pull request diff.
2. Read every review finding and inline comment provided below.
3. Verify each finding against the code, the acceptance criteria, and the
   project architecture before changing anything.
4. Fix only valid, actionable findings that are still unresolved. The reviewer
   may have already pushed its own fix commits — do not redo or revert those;
   address only what remains. Do not blindly apply incorrect or out-of-scope
   suggestions.
5. Preserve the original task scope; do not make unrelated changes.
6. Add or update tests for any changed behavior.
7. Run all validation commands (npm run check).
8. Commit the corrections with a Conventional Commit message.
9. Do not merge the pull request.

If a finding is wrong or out of scope, briefly note why instead of changing code.
