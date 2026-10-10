---
name: milestone-check
description: Run the full definition-of-done checks for the current milestone.
disable-model-invocation: true
allowed-tools: Bash(npm run *) Bash(npm test *) Bash(uv run *) Bash(git status *) Bash(git diff *)
---
## Current state
!`git status --short`

## Steps
1. Use the test-runner subagent for frontend lint and tests and backend ruff and pytest; report only failures.
2. Walk the current milestone's acceptance criteria in docs/SPEC.md one by one, with pass/fail and evidence.
3. Confirm README is updated, .env is untracked, and OFFLINE=true works with bundled snapshots.
4. Take a Playwright screenshot of the main screen at 1366x768.
5. Run the code-reviewer subagent on the diff.
6. Report. Do not commit unless every check passes.
