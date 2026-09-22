# `@afokapu/atdd-bun`

`@afokapu/atdd-bun` is a Bun-native ATDD enforcement package for repositories
that keep their plan, acceptance evidence, tests, and implementation in the
same Git history. It gives developers and coding agents fast local feedback,
then runs the same checks in GitHub Actions.

It does not require Python, the `atdd` executable, an ATdd state store, a
global installation, or network access while enforcing a repository.

## What it protects

The package is an enforcer, not a planner or deployment platform. It checks the
relationships that a plan makes explicit:

```text
plan / WMBT → acceptance → Bun test → implementation
```

Depending on the selected profile, it also checks the Bun code/test convention
corpus, documentation policy, plan integrity, scoped planner validation, and
interlocking rules.

It deliberately does **not** claim that static links prove a test is
semantically adequate. Where the package can establish only a structural link,
its report says so. Deployment execution, cloud credentials, and release
publishing remain repository-owned.

## How a repository uses it

A repository normally uses the package in three places:

1. A local Bun test or command gives immediate feedback while work is underway.
2. Git hooks prevent clearly invalid commits and pushes; they are convenience,
   not merge authority.
3. GitHub Actions runs the full policy. Protect the resulting required check in
   the repository’s GitHub branch ruleset.

The practical result is that an agent cannot quietly add production code without
the plan/test links the repository has chosen to require, and a local hook is
not the only thing standing between an invalid branch and `main`.

## Install and first use

When the package is published to the configured package registry, add it as a
development dependency:

```sh
bun add -d @afokapu/atdd-bun
```

Run the complete installed policy from the repository root:

```sh
bun run atdd-bun all
```

`all` runs every enabled packaged detector. It is the command that CI uses for
the local enforcement portion of its check. Run a focused profile directly—for
example, `bun run atdd-bun planner` or `bun run atdd-bun traceability`—without
an extra `profile` verb. `--profile <name>` remains available for compatibility.

For a focused local test, register only the policy that matters to that test:

```ts
import { registerEnforcementTest } from "@afokapu/atdd-bun/register";

registerEnforcementTest({
  root: import.meta.dir + "/..",
  profiles: ["traceability"],
});
```

This makes a Bun test fail when plan → acceptance → test → implementation
closure is broken, without enabling unrelated code-quality profiles.

## Choose the enforcement scope

Run `bun run atdd-bun help` to see the complete command list, or
`bun run atdd-bun help --json` for an agent-readable command/profile inventory.

Profiles describe *what is being checked*, rather than a technical detector
name.

| Profile | Use it when you need to check |
|---|---|
| `traceability` | plan acceptance, Bun test, and implementation closure |
| `planner` | plan parsing/graph integrity plus the explicitly scoped planner rules |
| `docs` | the optional documentation capability and its declared artifacts |
| `coder`, `tester`, `security`, `architecture`, `metrics`, `runtime` | Bun source and test conventions for that concern |
| `interlocking` | declared train/interlocking binding, infrastructure, and coverage |
| `htmx` | htmx-specific source and test conventions |
| `all` | the complete package policy, normally used by CI |

The package ships the canonical planner-node corpus as planning reference, but
does not pretend that every node is executable. The
[planner enforcement scope](planner-nodes/ENFORCEMENT_SCOPE.yaml) identifies
which rules have a Bun realization, which predicates are only partial, and which
nodes are reference-only.

The planner profile first validates recognized plan artifacts against the
package-shipped JSON Schemas—wagon, feature, WMBT (including embedded
acceptances), train, and train interlocking. It then runs cross-artifact
validators such as registry coherence and traceability. Hooks, direct CLI use,
and CI invoke this same profile and therefore share the same schema source.

## Hooks: fast feedback, not merge authority

Install hooks once in each worktree where you work:

```sh
bun run atdd-bun hooks install
```

This creates `.githooks/` dispatchers and sets a worktree-local
`core.hooksPath`. It refuses to replace another configured hook path unless you
explicitly pass `--replace`.

The hooks enforce protected-branch blocking, micro-commit limits, mass-delete
approval, affected-area validation, and configured traceability. To inspect or
remove that installation, use:

```sh
bun run atdd-bun hooks status
bun run atdd-bun hooks uninstall
```

Hooks can be bypassed by Git and therefore are never the merge gate. The CI
workflow and GitHub branch ruleset are the authority for merging.

## CI: the merge gate

Generate the repository-owned workflow with:

```sh
bun run atdd-bun ci init
```

This writes `.github/workflows/atdd-bun.yml`. It refuses to overwrite an
existing workflow unless `--replace` is supplied. The generated workflow runs
on pull requests, merge-queue merge groups, and pushes to `main`/`master`; it
installs with `bun install --frozen-lockfile`, runs the locally installed package
without `bunx`, runs `bun test`, and uploads reports when present.

After generating it, configure the GitHub branch ruleset to require the workflow
job before merging. `merge_group` is included so the same protection works with
GitHub Merge Queue.

## Linked worktrees for agent work

An optional policy reserves one primary checkout for `main` and requires feature
commits to happen in sibling linked worktrees:

```text
my-repo/
  main/                    # primary checkout, on branch main
  worktrees/feature-x/     # linked checkout, on branch feature/x
```

Enable the policy in `main/atdd-bun.yaml`:

```yaml
worktrees:
  enabled: true
  root: ../worktrees
  primary_directory: main
  primary_branch: main
  require_linked_worktree: true
```

An agent starts one worktree per work item—not per commit:

```sh
# Run from my-repo/main/ while it is on main.
bun run atdd-bun worktree start feature/x
```

That command creates `worktrees/feature-x`, creates the `feature/x` branch, and
installs the package hooks there. Subsequent commits happen normally from that
linked checkout. The hook rejects commits from the primary checkout, protected
branches, detached heads, and linked checkouts outside the configured root.

When the branch is merged into local `main`, inspect or safely retire it with:

```sh
bun run atdd-bun worktree status
bun run atdd-bun worktree finish --delete-branch
```

`finish` refuses a dirty or unmerged worktree. It never removes a worktree just
because a hook ran.

Git stores linked-worktree metadata in `main/.git/worktrees/`; the linked
checkouts themselves belong beside `main`, not inside `.git` or inside the
primary repository working tree.

## Release policy

If a repository enables `release` in `atdd-bun.yaml`, this read-only command
checks SemVer, a single release decision, release intent, and that the proposed
version is greater than the latest reachable matching local Git tag:

```sh
bun run atdd-bun release check
```

It creates no tag, makes no network request, and does not publish anything.
The separate optional release workflow is where a repository may create a tag or
publish using its own credentials and registry configuration.

## Verification of this package

`bun test` runs the package’s real-Git fixtures and detector clean/dirty corpora.
The suite proves that every declared convention output has a matching convention
and a deliberate failing case; it also covers hook isolation, CI generation,
planner scope, release validation, and linked-worktree policy.

## Boundaries

This package intentionally excludes ATdd’s Python runtime orchestration,
registry/state reconciliation, GitHub API integration, cluster access, and
deployment execution. Those capabilities may be configured around the package,
but repository enforcement remains deterministic and locally runnable.
