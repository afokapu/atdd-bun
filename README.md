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

Then require the workflow's job in the GitHub branch ruleset, so it gates merges.

## Commands

| Command | What it does |
|---|---|
| `atdd-bun [profile ...] [--root <path>]` | Enforce the named profiles; `all` (the default) runs every activated one |
| `atdd-bun init [--replace]` | Install hooks, CI, agent files and the integrity test |
| `atdd-bun hooks <install\|uninstall\|status>` | Manage only the Git hooks |
| `atdd-bun ci <init\|status>` | Manage only the CI workflow |
| `atdd-bun agent <init\|status>` | Manage only the skills and the `AGENTS.md`/`CLAUDE.md` block |
| `atdd-bun integrity [init\|status]` | Check that the toolkit and its generated files are unmodified |
| `atdd-bun docs journeys [--check]` | Generate (or verify) the journey, interlocking and train views |
| `atdd-bun worktree <start\|finish\|status>` | Optional linked-worktree policy for agent work |
| `atdd-bun release check` | Read-only SemVer and release-intent check |
| `atdd-bun help [--json]` | Every command and profile, human- or agent-readable |

Run them with `bun run atdd-bun …`. To make a single Bun test fail on broken closure:

```ts
import { registerEnforcementTest } from "@afokapu/atdd-bun/register";
registerEnforcementTest({ root: import.meta.dir + "/..", profiles: ["traceability"] });
```

## Profiles

| Profile | Checks |
|---|---|
| `traceability` | acceptance → Bun test → source closure: every acceptance tested, every binding and `Tested-By` resolving |
| `topology` | feature decomposition and the plan, source, test and E2E locations |
| `planner` | schemas for every plan artifact, graph integrity, the scoped planner rules |
| `telemetry` | the telemetry tracking plan: item shape, path-mirrored identity and versioning under `telemetry/`, wagon ownership of logical artifacts, the per-acceptance telemetry decision, metric label cardinality, source `Telemetry:` references, raw-string and forbidden-property emission, the vendor-SDK boundary around the TelemetryPort, and telemetry tests that bind the acceptance and item, assert the exact identity on a captured sink, cover every required item, and exercise declared timing semantics |
| `docs` | the documentation capability, including the generated journey view |
| `coder`, `tester`, `security`, `architecture`, `metrics`, `runtime` | Bun source and test conventions |
| `interlocking` | train/interlocking binding, infrastructure and route coverage |
| `htmx` | htmx source/test conventions and Playwright browser specs (`*.e2e.ts`) |
| `design` | design-system layering, token-only styling and responsiveness |
| `all` | every activated profile; what the hooks and CI run |

`planner-nodes/ENFORCEMENT_SCOPE.yaml` says which canonical planner rules have a Bun realization.

## Greenfield and brownfield

A greenfield repository enforces every profile from the start: that is the default. A brownfield
(legacy) repository can adopt enforcement gradually. The operator lists the profiles it is ready
for, and adds more as the code catches up:

```yaml
# atdd-bun.yaml
profiles: [traceability, planner]
```

`all`, the hooks and the generated CI then run only those profiles. Any profile can still be run
by name (`bun run atdd-bun coder`) to see what remains. An unknown name or an empty list is an
error, never a silent run of nothing.

With no `profiles:` field, every profile runs, but none is governed yet. The first explicit list is
the adoption that establishes the governed set, so a brownfield repository can declare
`profiles: [docs]` in an ordinary pull request. From then on, the integrity check reports, against
the base branch, removing a profile from the list and removing the list itself. The second closes
the two-step bypass `[docs, security]` → no list → `[docs]`. `init` writes a new `atdd-bun.yaml`
with every profile listed, so a greenfield repository is governed from its first commit; trim the
list before that commit to adopt gradually.

## Configuration

Everything is set in `atdd-bun.yaml`. The main keys:

```yaml
profiles: [traceability, planner, topology]   # default: every profile
topology:                                     # default layout; point it at existing roots
  plan_root: plan
  source_root: src/wagons
  test_root: tests/wagons
  e2e_root: e2e
  telemetry_root: telemetry                    # tracking-plan registry; inert until the tree or a decision exists
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
the profile that gates each stage. The block in `AGENTS.md` and `CLAUDE.md` adds the rules: never
modify the toolkit itself, only the configuration it offers, and enable capabilities through
`profiles`.

`atdd-bun integrity`, run by the generated test and first in CI on a clean install, fails when:

- the installed package differs from its published hashes;
- the dependency is not an npm registry version;
- a generated file (workflow, skills, instruction block, integrity test) was edited;
- `atdd-bun.yaml` is looser than on the base branch (after the first explicit `profiles:` list,
  dropping a profile or the list counts).

Each finding names its restore command.

## Staying up to date

Every merge to this package's `main` is published to npm with provenance as the next patch and
tagged `vX.Y.Z`. Rules and hooks change as soon as a repository upgrades the dependency. To refresh
the skills and instruction blocks on every install, add this to the repository's own
`package.json`:

```json
"scripts": { "postinstall": "atdd-bun agent init --replace" }
```

Upgrade with `bun update @afokapu/atdd-bun`, or let Dependabot (`package-ecosystem: "bun"`) open a
pull request per release. For a new `0.x` minor, run `bun add -d @afokapu/atdd-bun@latest`. If an
upgrade changes the workflow or integrity test, run `bun run atdd-bun init --replace` and commit.

## Developing this package

`bun test` runs the detectors' clean and dirty corpora, real-Git hook fixtures, and the frontend
chain in Chromium (`bunx playwright install chromium`). Guard tests require every emitted rule to
have a strict convention, a failing fixture and an edge in `relationships.yaml`.
