# `@afokapu/atdd-bun`

Bun-native ATDD enforcement for repositories that keep their plan, acceptances, tests and
implementation in one Git history. It checks the links a plan makes explicit:

```text
plan / WMBT → acceptance → Bun test → implementation
```

It runs on Bun from the repository's own `node_modules`, with no global install and no network
access. The same checks run as local tests, as Git hooks for fast feedback, and in GitHub Actions,
which is the merge gate. Every finding fails: there is no advisory mode and no ratchet baseline.

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
| `atdd-bun [profile ...] [--root <path>]` | Enforce one or more profiles (default `all`) |
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
| `all` | everything; what CI runs |

`planner-nodes/ENFORCEMENT_SCOPE.yaml` says which canonical planner rules have a Bun realization.

## Staged activation (greenfield and brownfield)

A greenfield repository activates everything from the start. A brownfield repository whose plan
describes more than is built can enable capabilities gradually, feature by feature, through
`status` on features and trains:

| Status | Meaning |
|---|---|
| *(none)* | executable, exactly as before lifecycles existed |
| `planned` | declared, not yet executable: its acceptances are **planned debt**, not violations |
| `tested` | every acceptance the feature owns must be bound by a Bun test |
| `implemented` | as `tested`, and component source must claim the feature |

```yaml
# plan/orders/place-order.yaml
urn: feature:orders:place-order
status: planned
```

What never loosens:

- Schema, planner and topology validation apply to planned artifacts too.
- Moving a feature to `tested` or `implemented` fails the commit (hook) and CI until every acceptance it owns is bound.
- Every component source needs a resolving `Tested-By:`, whatever its status; planned features may carry partial source.
- Every test binding (`Acceptance:`, `WMBT:`, `Train:`) must resolve, including those into planned scope.
- A `tested` or `implemented` train needs a Bun test with `// Train: <id>`; a planned train owes no
  E2E, browser spec or route test yet.
- Once any status is declared, an acceptance owned by more than one feature fails, and so does a
  status outside the vocabulary.

A downgrade to `planned` hides nothing that exists: source and test bindings stay strict, and
the deferred acceptances are listed by `atdd-bun lifecycle`, a deterministic report fit for CI logs.

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
worktrees: { enabled: false }
release: { enabled: false }
```

The hooks enforce protected-branch blocking, micro-commit limits, mass-delete approval and
validation of the affected area. Git can bypass them, so CI is the authority.

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
tagged `vX.Y.Z` on a commit whose `package.json` carries that version. Rules and hooks change as
soon as a repository upgrades the dependency. To refresh the skills and instruction blocks on every
install, add this to the repository's own `package.json`:

```json
"scripts": { "postinstall": "atdd-bun agent init --replace" }
```

Upgrade with `bun update @afokapu/atdd-bun`, or let Dependabot (`package-ecosystem: "bun"`) open
a pull request per release. For a new `0.x` minor, run `bun add -d @afokapu/atdd-bun@latest`. If an
upgrade changes the workflow or integrity test, run `bun run atdd-bun init --replace` and commit.
