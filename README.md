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
| `delivery` | the review record of each tranche under `delivery/`: allowed author and reviewer models with recorded fallbacks, reviewer independence, every finding fixed, withdrawn after one dispute or ruled on by a human, every configured stage approved, and, at the gate, no change without a record and a merged head that contains exactly the approved commit. Inert until adopted |
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
error, never a silent run of nothing. Removing a profile loosens `atdd-bun.yaml`, so the integrity
check reports it against the base branch until a human approves the change.

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

### Delivery

For programs delivered as tranches by a coordinator and persistent drivers, with headless authors
and independent reviewers. Adopt it by naming `delivery` in `profiles:` (or, with no list, by adding
a `delivery:` block); `agent init` then installs the delivery skill and its review contract. Every
key is optional; these are the defaults:

```yaml
delivery:
  root: delivery                     # one <tranche>/evidence.yaml per tranche, reports beside it
  require_record: true               # at the gate, a change outside the root needs a tranche record
  independence: fresh-process        # or different-model; overridable per stage
  stages:                            # models in preference order: the first, then recorded fallbacks
    plan_review:  { authors: [codex],       reviewers: [glm, claude] }
    test_review:  { authors: [glm, claude], reviewers: [codex, claude] }
    code_review:  { authors: [glm, claude], reviewers: [glm, claude] }
    final_review: { authors: [codex],       reviewers: [codex, claude] }
  fallback: { after_failures: 3, within_minutes: 10, when_exhausted: block }   # or wait
  commands: {}                       # per model: { author: "...", review: "..." } overriding the skill's defaults
```

The profile checks the record, never the running agents. The generated CI sets
`ATDD_DELIVERY_GATE`: `merge` on pull requests and the merge queue, where every record the branch
changes must be `ready`, the branch may differ from its approved SHA only under the delivery root,
and a change outside the root needs a record (`require_record`, default true); `post-merge` on a
push, where the pushed commit must contain every approved SHA it brings in. Merge tranches with a
merge commit: a squash or rebase merge writes a commit no reviewer saw, and the post-merge check
fails on it. Moving the root, dropping a stage, relaxing a stage from `different-model` to
`fresh-process`, adding an author or reviewer, turning off `require_record`, or making fallback
easier loosens the policy and is reported by the integrity check.

The record's model and run identifiers are the driver's claims. The profile checks that they are
consistent and that every review's raw report is retained; it does not verify them
cryptographically.

The hooks enforce protected-branch blocking, micro-commit limits, mass-delete approval and
validation of the affected area. Git can bypass them, so CI is the authority.

## Agents and integrity

The skill gives every coding agent the lifecycle PLAN → RED → GREEN → SMOKE → REFACTOR → TRACE and
the profile that gates each stage. The block in `AGENTS.md` and `CLAUDE.md` adds the rules: never
modify the toolkit itself, only the configuration it offers; turn profiles on or off in
`profiles:` only when the user asks; and, where `delivery` is active, deliver tranches through the
delivery skill.

`atdd-bun integrity`, run by the generated test and first in CI on a clean install, fails when:

- the installed package differs from its published hashes;
- the dependency is not an npm registry version;
- a generated file (workflow, skills, the delivery review contract, instruction block, integrity test) was edited;
- `atdd-bun.yaml` is looser than on the base branch.

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
