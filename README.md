# `@afokapu/atdd-bun`

Bun-native ATDD enforcement for repositories that keep their plan, acceptances, tests and
implementation in one Git history. It checks the links a plan makes explicit:

```text
plan / WMBT → acceptance → Bun test → implementation
```

It runs on Bun from the repository's own `node_modules`, with no global install and no network
access. The same checks run as local tests, as Git hooks for fast feedback, and in GitHub Actions,
which is the merge gate. `atdd-bun all` fails on every finding: there is no advisory mode and no
ratchet baseline. A brownfield repository can gate on its changed slice ([adoption](#greenfield-and-brownfield-adoption)).

## Install

```sh
bun add -d @afokapu/atdd-bun
bun run atdd-bun init
```

`init` installs the Git hooks (`.githooks/`), the CI workflow (`.github/workflows/atdd-bun.yml`),
the agent skill (`.agents/skills/atdd/`, `.claude/skills/atdd/`), a managed block in `AGENTS.md`
and `CLAUDE.md`, and `atdd-bun.integrity.test.ts`. Commit all of them. Nothing is overwritten
without `--replace`, and adding the dependency changes nothing until you run `init`.

After that, require the workflow's job in the GitHub branch ruleset so it gates merges.

## Commands

| Command | What it does |
|---|---|
| `atdd-bun [profile ...] [--root <path>]` | Enforce one or more profiles (default `all`, the full audit) |
| `atdd-bun gate [--base <ref>]` | What hooks and CI block on: see [adoption](#greenfield-and-brownfield-adoption) |
| `atdd-bun init [--replace]` | Install hooks, CI, agent files and integrity test |
| `atdd-bun hooks <install\|uninstall\|status>` | Manage only the Git hooks |
| `atdd-bun ci <init\|status>` | Manage only the CI workflow |
| `atdd-bun agent <init\|status>` | Manage only the skills and the `AGENTS.md`/`CLAUDE.md` block |
| `atdd-bun integrity [init\|status]` | Check that the toolkit and its generated files are unmodified |
| `atdd-bun lifecycle [--json]` | Report planned debt: feature/train statuses and planned acceptances |
| `atdd-bun docs journeys [--check]` | Generate (or verify) the journey/interlocking/train views |
| `atdd-bun worktree <start\|finish\|status>` | Optional linked-worktree policy for agent work |
| `atdd-bun release check` | Read-only SemVer and release-intent check |
| `atdd-bun help [--json]` | All commands and profiles, human- or agent-readable |

Run them with `bun run atdd-bun …`. To make a single Bun test fail on broken closure:

```ts
import { registerEnforcementTest } from "@afokapu/atdd-bun/register";
registerEnforcementTest({ root: import.meta.dir + "/..", profiles: ["traceability"] });
```

## Profiles

| Profile | Checks |
|---|---|
| `traceability` | acceptance → Bun test → source closure, and the lifecycle rules below |
| `topology` | feature decomposition and the plan, source, test and E2E locations |
| `planner` | schemas for every plan artifact, graph integrity, the scoped planner rules |
| `docs` | the documentation capability, including the generated journey view |
| `coder`, `tester`, `security`, `architecture`, `metrics`, `runtime` | Bun source and test conventions |
| `interlocking` | train/interlocking binding, infrastructure and route coverage |
| `htmx` | htmx source/test conventions and Playwright browser specs (`*.e2e.ts`) |
| `design` | design-system layering, token-only styling and responsiveness |
| `all` | everything: the full audit |

`planner-nodes/ENFORCEMENT_SCOPE.yaml` says which canonical planner rules have a Bun realization.

## Greenfield and brownfield adoption

A greenfield repository enables everything from the start. A brownfield one enables capabilities
gradually, on two independent axes. `atdd-bun all` is always the full, strict audit.

**Plan scope: feature and train `status`.** A plan describing more than is built marks it
`planned` (declared, not executable: its acceptances are *planned debt*), then `tested` (every
acceptance it owns has a Bun test) and `implemented` (also claimed by component source). No status
means executable, as before. `atdd-bun lifecycle` lists the planned debt deterministically.

- Schema, planner and topology validation apply to planned artifacts too; a bad status or an
  acceptance owned by two features fails.
- Activating a feature fails the commit and CI until every acceptance it owns is bound.
- Every source `Tested-By:` and every test binding must resolve, whatever the status; planned
  features may carry partial source, so a downgrade hides nothing that exists.
- A `tested`/`implemented` train needs a `// Train: <id>` test; a planned one owes no E2E yet.

**Gate scope: `adoption.mode`.** Hooks and the generated CI block on `atdd-bun gate`. In greenfield
(the default) that is the full audit. With `adoption: { mode: brownfield }` it blocks on the
changed slice: findings in a file the change touches, naming an identity on a line it adds or
removes (so deleting a test brings its acceptance back), or owned by a plan artifact it edits (so a
`status:` flip activates that feature's acceptances). Legacy findings elsewhere are counted on
every run and still fail `atdd-bun all`. With no usable base, or when `atdd-bun.yaml` changes beyond
`adoption`, the gate runs the full audit. Switching to brownfield, moving its base or moving a
topology root counts as loosening `atdd-bun.yaml`, which the integrity check reports for approval.

## Configuration

Everything is set in `atdd-bun.yaml`. The main keys:

```yaml
topology:            # default layout; point it at an existing repository's roots
  plan_root: plan
  source_root: src/wagons
  test_root: tests/wagons
  e2e_root: e2e
frontend:
  viewports: [375, 768, 1280]
  breakpoints: [480, 768, 1024, 1280]
registry_paths: ["plan/_*.yaml", "contracts/_*.yaml"]   # exempt from micro-commit size caps only
max_registry_removed_lines: 350                        # larger removals need [mass-delete-approved]
adoption: { mode: greenfield, base: origin/HEAD }        # brownfield: gate on the changed slice
worktrees: { enabled: false }
release: { enabled: false }
```

The hooks enforce protected-branch blocking, micro-commit limits, mass-delete approval and the
gate. Git can bypass them, so CI is the authority. Scans skip `node_modules`, build output and
nested agent worktrees (`.claude/worktrees/`), which are other checkouts of the repository.

## Agents and integrity

The skill gives every coding agent the lifecycle PLAN → RED → GREEN → SMOKE → REFACTOR → TRACE and
the profile that gates each stage. The block in `AGENTS.md` and `CLAUDE.md` adds the rule: never
modify the toolkit itself, only the configuration it offers.

`atdd-bun integrity`, run by the generated test and first in CI on a clean install, fails when:

- the installed package differs from its published hashes;
- the dependency is not an npm registry version;
- a generated file (workflow, skills, instruction block, integrity test) was edited;
- `atdd-bun.yaml` is looser than on the base branch.

Each finding names its restore command.

## Staying up to date

Every merge to this package's `main` is published to npm with provenance as the next patch and
tagged `vX.Y.Z` on a release commit holding exactly the published tree. Rules and hooks change as
soon as a repository upgrades the dependency. To refresh the skills and instruction blocks on every
install, add this to the repository's own `package.json`:

```json
"scripts": { "postinstall": "atdd-bun agent init --replace" }
```

Upgrade with `bun update @afokapu/atdd-bun`, or let Dependabot (`package-ecosystem: "bun"`) open
a pull request per release. For a new `0.x` minor, run `bun add -d @afokapu/atdd-bun@latest`. If an
upgrade changes the workflow or integrity test, run `bun run atdd-bun init --replace` and commit.
