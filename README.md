# `@afokapu/atdd-bun`

A Bun-only packaging of ATDD's Bun convention corpus. It does not invoke ATDD
core, Python, the workspace-provider adapter, or the substrate binder.

## Consumer use

Install it as a development dependency, then create one local test:

```ts
import { registerEnforcementTest } from "@afokapu/atdd-bun/register";

registerEnforcementTest({
  root: import.meta.dir + "/..",
  profiles: ["traceability", "architecture", "security"],
});
```

Or run it in CI:

```sh
bun run atdd-bun --profile traceability,architecture --root .
```

## Profiles

`traceability`, `docs`, `planner`, `coder`, `tester`, `security`, `architecture`, `metrics`, `runtime`,
`interlocking`, `htmx`, and `all` select the shipped detector families.

`planner` first runs package plan-integrity guards, then only the explicitly
declared Bun planner rules. [The enforcement scope](planner-nodes/ENFORCEMENT_SCOPE.yaml)
marks each rule as complete or partial; the other canonical planner nodes are
reference-only and are never presented as enforced.

`traceability` is a standalone closure gate:

```text
plan acceptance -> Bun test -> implementation component
```

It reports an untested plan acceptance, an unbound/unknown test reference, an
implementation without `Tested-By:`, and an implementation whose named test does
not exist.

## Linked-worktree policy

An opt-in policy can require the primary checkout to be named `main` and be on
the `main` branch, while all feature commits happen in linked worktrees beside it:

```text
my-repo/
  main/
  worktrees/feature-x/
```

```yaml
# main/atdd-bun.yaml
worktrees:
  enabled: true
  root: ../worktrees
  primary_directory: main
  primary_branch: main
  require_linked_worktree: true
```

Use `atdd-bun worktree start feature/x`, `atdd-bun worktree status`, and, after
merging into local `main`, `atdd-bun worktree finish --delete-branch`. The hook
blocks commits from the primary checkout, protected branches, detached heads, or
worktrees outside the configured root. `finish` refuses dirty or unmerged work;
it never removes a worktree automatically.

## Corpus proof

`bun test` runs every detector against its clean and dirty fixture trees and
asserts that every declared rule ID both ships with a convention and fires on the
corresponding dirty corpus. The snapshot includes all eleven original Bun
detector families plus the new traceability-closure detector.
