# `@afokapu/atdd-bun`

`@afokapu/atdd-bun` is a Bun-native ATDD enforcement package for repositories
that keep their plan, acceptance evidence, tests, and implementation in the
same Git history. It gives developers and coding agents fast local feedback,
then runs the same checks in GitHub Actions.

It runs entirely on Bun from the repository's own `node_modules`: no global
installation and no network access while enforcing a repository.

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

Add the package from npm as a development dependency, then bootstrap the
repository once:

```sh
bun add -d @afokapu/atdd-bun
bun run atdd-bun init
```

`init` installs the three local surfaces described below: Git
[hooks](#hooks-fast-feedback-not-merge-authority), the
[CI workflow](#ci-the-merge-gate), and the
[agent skill](#agent-skill-the-lifecycle-in-the-agents-context). Commit what it
generates (`.githooks/`, `.github/workflows/atdd-bun.yml`, `.agents/`, `.claude/`,
`AGENTS.md`) so every clone and every agent session gets them. To keep the
package and the skill current automatically, see
[Staying up to date](#staying-up-to-date).

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
| `design` | the design system: tokens ← primitives ← components ← templates, token-only colors, spacing, radii, and motion (also part of `coder`) |
| `all` | the complete package policy, normally used by CI |

The package ships the canonical planner-node corpus as planning reference, but
does not pretend that every node is executable. The
[planner enforcement scope](planner-nodes/ENFORCEMENT_SCOPE.yaml) identifies
which rules have a Bun realization, which predicates are only partial, and which
nodes are reference-only.

The planner profile first validates recognized plan artifacts against the
package-shipped JSON Schemas—wagon, feature, WMBT (including embedded
acceptances), train, train interlocking, and journey topology. It then runs
cross-artifact validators such as registry coherence, traceability, and
cross-interlocking continuation closure. A journey starts at one interlocking;
each reachable route must either terminate explicitly or continue, through an
artifact produced by that route's selected train, to another interlocking. Exposed journeys also
carry Station Master actions; the Bun interlocking family checks those actions resolve through
`JOURNEY_MAP` to `JourneyRunner`, while internal journeys carry no public reachability obligation.
Hooks, direct CLI use, and CI invoke this same profile and therefore share the
same schema source.

### Design system

The `design` profile (also part of `coder`) is the Bun realization of the core
`coder.design.*` obligations. It recognizes a design system by its directory:
a folder named `design`, `design_system`, or `design-system`, whose first
subfolder names the layer:

```text
design/
  tokens/ or foundations/   values only: palette, spacing, radii, motion
  primitives/               Button, Text, Stack … built from tokens
  components/               composed from primitives
  templates/                page structure composed from components
```

Imports flow downward only, and the design system never imports app code.
Outside the tokens layer, `.tsx`, `.html`, and `.css` files take colors,
spacing, radii, and durations from tokens (`var(--…)`); app components render
controls through primitives and import at least one design-system element; and
every exported component has a consumer. Defining a custom property
(`--accent: #0ea5e9`) is defining a token and is allowed anywhere. A repository
without a design directory is not judged by these rules.

### Theme and contract registry

Theme vocabulary belongs to the repository, not the package. When a plan uses
themes, declare them in `plan/_themes.yaml`; only index `0: commons` is
reserved. Every other index and kebab-case name is repository-defined.

```yaml
themes:
  "0": commons
  "1": orders
  "2": inventory
```

Every contract is recorded in `contracts/_contracts.yaml` with its identity,
path, theme, producers, and consumers. The planner profile checks that contract
references resolve, registry paths exist, a contract identity begins with its
declared theme, and cross-wagon artifacts have contract evidence.

## Hooks: fast feedback, not merge authority

Run the explicit repository bootstrap once in each worktree where you work:

```sh
bun run atdd-bun init
```

It creates `.githooks/` dispatchers, sets a worktree-local `core.hooksPath`,
generates `.github/workflows/atdd-bun.yml`, and installs the coding-agent skill
when they are absent. It never overwrites another hook path, an existing
generated workflow, or an existing skill unless you explicitly pass `--replace`.
The package itself has no install script: adding the dependency never changes
the repository until you run `init`.

Use `hooks install`, `ci init`, `agent init`, or `integrity init` when only one surface is wanted:

```sh
bun run atdd-bun hooks install
bun run atdd-bun ci init
bun run atdd-bun agent init
bun run atdd-bun integrity init
```

The hooks enforce protected-branch blocking, micro-commit limits, mass-delete
approval, affected-area validation, and configured traceability. To inspect or
remove that installation, use:

```sh
bun run atdd-bun hooks status
bun run atdd-bun hooks uninstall
```

Hooks can be bypassed by Git and therefore are never the merge gate. The CI
workflow and GitHub branch ruleset are the authority for merging.

### Declarative registries

Micro-commit limits (`max_staged_files`, `max_staged_changed_lines`, default
350) exist to keep imperative code changes small. They do not apply to
declarative registries, which can legitimately be hundreds or thousands of lines
and must not be split into invalid intermediate states. Registries are matched by
`registry_paths` (default `plan/_*.yaml`, `plan/_*.yml`, `contracts/_*.yaml`,
`contracts/_*.yml`).

A staged registry is exempt from the size caps only. It is still:

- validated by the `planner` and `traceability` profiles on every commit that
  touches it, even when `require_traceability` is `false`;
- subject to removal approval: a net removal above `max_registry_removed_lines`
  (default 350) needs `[mass-delete-approved]` in the commit message. Rewriting
  or reordering entries in place is not a removal.

```yaml
# atdd-bun.yaml
registry_paths: ["plan/_*.yaml", "contracts/_*.yaml", "telemetry/_*.yaml"]
max_registry_removed_lines: 200
```

Duplicate, stale, and ownership checks come from the planner rules, and
independent review comes from the CI workflow and branch ruleset.

## Agent skill: the lifecycle in the agent's context

`agent init` gives every coding agent the same short ATDD skill:

- `.agents/skills/atdd/SKILL.md`: the vendor-neutral Agent Skills path (Codex,
  GitHub Copilot, Cursor, Gemini CLI, and others);
- `.claude/skills/atdd/SKILL.md`: Claude Code;
- a managed `<!-- atdd-bun:start -->` block in `AGENTS.md` pointing at the skill,
  for agents that read `AGENTS.md` but not skills. The rest of `AGENTS.md` is
  never touched.

The skill names the lifecycle PLAN → RED → GREEN → SMOKE → REFACTOR → TRACE, the
conventions each stage follows, and the `atdd-bun` profile that gates it. It
points at the conventions shipped in this package instead of restating them, so
it stays correct as they change; after upgrading, refresh it with
`bun run atdd-bun agent init --replace`, or let the repository's own
`postinstall` do it (see [Staying up to date](#staying-up-to-date)). The skill
steers the agent; the profiles, hooks, and CI remain the enforcement.

## Integrity: files agents must not change

Coding agents can edit anything on the machine they run on, including
`node_modules/@afokapu/atdd-bun`, the files this package generates, and
`atdd-bun.yaml`. `init` therefore writes `atdd-bun.integrity.test.ts` (into the
`[test] root` from `bunfig.toml`, if one is set), and the generated CI workflow
runs `bun run atdd-bun integrity` before enforcement. Both run the same check:

| Checked | Canonical source | Restore |
|---|---|---|
| Every file of the installed package | `integrity.json`, the hashes published with the package | `bun install --force` |
| The dependency is an npm version range, locked to the registry with an integrity hash | npm | `bun add -d @afokapu/atdd-bun` |
| The CI workflow, both skills, the `AGENTS.md` block, and the integrity test | what the installed version generates (its version stamp is ignored) | `bun run atdd-bun init --replace` |
| `atdd-bun.yaml` is not looser than on the branch being merged into | the merge base; for a push to the base branch, the previous commit | `git checkout <base> -- atdd-bun.yaml` |

A failure is addressed to the agent: it lists every changed file with its
restore command and tells it to stop and ask a human instead of working around
the check. Locally, this is a reminder an agent can still ignore, because
anything on its machine can be edited. In CI the check runs on a clean install,
so its verdict cannot be faked. Loosening the policy remains possible, as a
separate change a human approves.

After upgrading to a version that changes generated files, run
`bun run atdd-bun init --replace` and commit the result.

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

## Staying up to date

Every change merged into this package's `main` is published to npm
automatically as the next patch version, with provenance, and tagged `vX.Y.Z`.

The hooks and the CI workflow run the package installed in `node_modules`, so
conventions, validators, and hook policy change as soon as a repository
upgrades the dependency; nothing needs reinstalling. The agent skill is the one
generated copy. To refresh it on every install, add a script to the
repository's own `package.json` (Bun runs a project's own lifecycle scripts, not
a dependency's):

```json
"scripts": {
  "postinstall": "atdd-bun agent init --replace"
}
```

To receive each release as a pull request, add `.github/dependabot.yml` on the
default branch:

```yaml
version: 2
updates:
  - package-ecosystem: "bun"
    directory: "/"
    schedule:
      interval: "daily"
    allow:
      - dependency-name: "@afokapu/atdd-bun"
```

Merging that pull request installs the new version and, through `postinstall`,
rewrites the skill. Without Dependabot, upgrade with
`bun update @afokapu/atdd-bun`. The lockfile pins the installed version, so
nothing changes until one of these runs. While the package is `0.x`, a `^0.1.x`
range accepts only `0.1.*`; move to a new minor with
`bun add -d @afokapu/atdd-bun@latest`.

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
and a deliberate failing case; it also covers hook isolation, the declarative
registry policy, CI generation, agent-skill installation, planner scope, release
validation, and linked-worktree policy.
