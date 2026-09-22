# ATDD hook behavior inventory

Audited: `.atdd/hooks/`, `src/atdd/coach/templates/hooks/`,
`src/atdd/coach/commands/hooks.py`, and their hook/worktree tests.

| Hook / behavior | Bun package decision |
| --- | --- |
| `pre-commit`: direct protected-branch commits | Port unchanged as Git policy. |
| `pre-commit`: staged-file advisory warning | Reimplement as blocking, configurable micro-commit policy. |
| `pre-commit`: ATDD branch registration | Exclude: state store/work-item orchestration. |
| `pre-commit`: registry auto-heal | Exclude: ATDD registry mutation. |
| `commit-msg`: mass-delete token/backstop | Reimplement with package policy and `[mass-delete-approved]`. |
| `pre-push`: protected branches | Port unchanged as Git policy. |
| `pre-push`: commits-per-push limit | Reimplement as package policy. |
| `pre-push`: ATDD interpreter/version gate | Exclude: Python/ATDD runtime. |
| `pre-push`: store mirror, tags, emergency bypass | Exclude: ATDD state/runtime orchestration. |
| `pre-push`: blast-radius validation | Reimplement using Bun enforcer profiles. |
| `pre-merge-commit`: protected main/master | Port unchanged as Git policy. |
| `post-commit`: blast-radius validation | Reimplement as advisory Bun validation. |
| `post-commit`: agent-session capture | Exclude: ATDD state store. |
| `post-merge`: reconciliation/self-upgrade | Exclude: ATDD state and package upgrade orchestration. |
| post-checkout, post-rewrite, pre-rebase, Claude/GitHub hooks | Exclude: lifecycle, GitHub, or external runtime orchestration. |
