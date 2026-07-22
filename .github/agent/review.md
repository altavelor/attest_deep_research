Review the complete pull request diff against its base branch.

Follow all applicable AGENTS.md instructions.

Check for:

- functional defects
- security vulnerabilities
- regressions
- data loss risks
- race conditions
- incorrect lifecycle handling
- missing cleanup
- insufficient tests
- unexpected public API changes
- unrelated modifications
- unmet acceptance criteria

Do not modify the repository.

Only concrete blocking findings should fail the review.

For each finding include:

- severity
- file and line
- concrete failure scenario
- explanation
- minimal recommended fix

End the response with exactly one separate line:

VERDICT: PASS

or:

VERDICT: FAIL
