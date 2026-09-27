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
| `topology` | feature decomposition and the plan, source, test and E2E locations. Missing source, tests and E2E suites are reported only when a run also selects `coder` or `tester`, so a repository in the PLAN stage can enforce `planner` and `topology` before RED |
| `planner` | schemas for every plan artifact, graph integrity, the scoped planner rules |
| `telemetry` | the telemetry tracking plan: item shape, path-mirrored identity and versioning under `telemetry/`, wagon ownership of logical artifacts, the per-acceptance telemetry decision, metric label cardinality, source `Telemetry:` references, raw-string and forbidden-property emission, the vendor-SDK boundary around the TelemetryPort, and telemetry tests that bind the acceptance and item, assert the exact identity on a captured sink, cover every required item, and exercise declared timing semantics |
| `delivery` | the review record of each tranche under `docs/delivery/tranches/`: allowed writer and reviewer models with recorded fallbacks, reviewer independence, every finding fixed, withdrawn after one dispute or ruled on by a human, every configured stage approved, and, at the gate, no change without a record and a merged head that contains exactly the approved commit. Inert until adopted |
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
with every profile listed except the opt-in `delivery`, so a greenfield repository is governed from its first commit; trim the
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

### Delivery

For programs delivered as tranches by a coordinator and persistent drivers, with headless writers
and independent reviewers. Adopt it by naming `delivery` in `profiles:` (or, with no list, by adding
a `delivery:` block); `agent init` then installs the delivery skill. The adopting pull request is
itself governed: the skill and workflow it brings are outside the delivery root, so it carries its
own tranche record, reviewed and `ready` like any other. A later change to `atdd-bun.yaml` alone
needs no record: the integrity check reports any loosening for a human to approve.

The policy names, for each lifecycle stage (plan, red, green, refactor, final), who may write it and
who reviews it; either may be absent. By default two stages are reviewed: the plan, and the whole
change at its head (final). Red, green and refactor are written and held by their gates. How the
coordinator and drivers carry this out is the `delivery.operating-model` convention; what a reviewer
checks is `delivery.review`; how agents talk, through a local ntfy board with one topic per program,
tranche and review conversation (`atdd-bun chat`), is `delivery.board`, used only when `delivery.board` is
set. The skill only points to them.

The records live with the program's reasoning, in the docs profile's `docs/delivery/` area:

```text
docs/delivery/index.adoc                           the program: why, scope, how it was split (docs profile)
docs/delivery/tranches/<tranche>/evidence.yaml     one tranche's review record (delivery profile)
docs/delivery/tranches/<tranche>/*.json            the retained raw reviewer reports
```

Where delivery is adopted, the docs profile leaves the records folder's records and data files to
the delivery profile: they are not authored documentation, and changing them needs no docs
declaration. AsciiDoc there stays documentation. Where the docs profile is active, the first tranche
also brings `docs/index.adoc` and `docs/delivery/index.adoc`, each with `:doc-id:` and `:status:`,
since every docs area needs an index.

Upgrading from 0.8.0: records under `delivery/` are reported until `delivery.root: delivery` is set
(a reported root change, approved once) or they are moved. A data file in an old tranche that no
record there names is reported on local runs, not at the merge gate; removing it is a gate change a
human approves, or a new tranche's record can name it.

Upgrading from 0.9.0: an `atdd-bun.yaml` field with the wrong type (a quoted number, `yes`/`no`, a
non-string list item, `.inf`) is now reported, and on the base branch it blocks every pull request,
since the policy cannot be compared. Correct such fields on the base branch before upgrading.

Upgrading to 0.10: the policy names writers and reviewers per stage. The 0.9 stage names
(`plan_review`, `test_review`, `code_review`, `final_review` with `authors` and `reviewers`) are still
read, as `plan`, `red`, `refactor` and `final`, and 0.9 records that name review authors still count as
recorded work. Independence now defaults to `different-model`: a repository that relied on the old
`fresh-process` default sets it explicitly. A repository with no `stages:` gets the new default
operating model, without the integrity check reporting the change.

From 0.10.2 the pre-commit hook no longer counts uncommitted work: it refused exactly the small
commits that reduce it. `max_uncommitted_files` is no longer read; commit size stays limited by
`max_staged_files` and `max_staged_changed_lines`.

From 0.10.3 each ready record is judged by the delivery policy in `atdd-bun.yaml` at its `approved_sha`:
a later policy change (dropping or reordering a model, removing a review) never makes a merged record
fail. Records in progress are judged by the current policy.

From 0.10.4 a stage with nothing written (a plan-only or no-op tranche) records no work; a review
whose range recorded none answers for the latest recorded work before it.

From 0.10.5 only coordinators and drivers use the board: a writer or reviewer takes its task from its
launch prompt and returns its answer as output, which the driver posts. `atdd-bun chat wait` takes several
topics and `--skip heartbeat`; reviewers answer in JSON.

Every key is optional; these are the defaults:

```yaml
delivery:
  root: docs/delivery/tranches       # one <tranche>/evidence.yaml per tranche, reports beside it
  require_record: true               # at the gate, a change outside the root (other than atdd-bun.yaml alone) needs a tranche record
  multiplexer: herdr                 # the terminal multiplexer humans watch agents in; any command name
  # board: { url: http://127.0.0.1:2586 }   # opt-in: agents talk through a local board; absent, there is none
  independence: different-model      # a reviewer's model wrote none of the work it reviews; or fresh-process
  stages:                            # models in preference order: the first, then recorded fallbacks
    plan:     { writer: [codex, claude-opus], reviewer: [glm, claude-opus, codex] }
    red:      { writer: [glm, claude-sonnet, claude-opus, codex] }
    green:    { writer: [glm, claude-sonnet, claude-opus, codex] }
    refactor: { writer: [glm, claude-sonnet, claude-opus, codex] }
    final:    { reviewer: [codex, glm, claude-opus] }
  fallback: { after_failures: 3, within_minutes: 10, when_exhausted: block }   # or wait
  commands: {}                       # per model: { author: "...", review: "..." } overriding delivery.operating-model's defaults
```

The profile checks the record, never the running agents. The generated CI sets
`ATDD_DELIVERY_GATE`: `merge` on pull requests and the merge queue, where every record the branch
changes must be `ready`, the branch may differ from its approved SHA only under the delivery root,
and a change outside the root needs a record unless it touches only `atdd-bun.yaml` (`require_record`, default true); `post-merge` on a
push to a protected branch (the generated workflow's push branches follow `protected_branches`), where the pushed commit must contain every approved SHA it brings in. Merge tranches with a
merge commit: a squash or rebase merge writes a commit no reviewer saw, and the post-merge check
fails on it. Moving the root, dropping a stage, relaxing a stage from `different-model` to
`fresh-process`, no longer reviewing a stage, adding a writer or reviewer, moving a fallback model earlier in a list, turning off
`require_record`, making fallback easier, or adding or changing a model's `commands` loosens the policy and is reported by the integrity check.

The record's model and run identifiers are the driver's claims. The profile checks that they are
consistent and that a `ready` record retains every review's raw report (a record in progress may lag
behind); it does not verify them
cryptographically.

The hooks enforce protected-branch blocking, micro-commit limits, mass-delete approval and
validation of the affected area. Git can bypass them, so CI is the authority. The changed-line
limit counts a moved file by the edits it carries, so relocating a directory is not measured as
rewriting it; mass-delete and registry-removal approval still count a move in full.
The journey view `atdd-bun docs journeys` generates is exempt from the size caps, since its index
alone can exceed them, and never from the `docs` profile, which refuses a copy that is not exactly
what the plan generates.

## Agents and integrity

The skill gives every coding agent the lifecycle PLAN → RED → GREEN → SMOKE → REFACTOR → TRACE and
the profile that gates each stage. The block in `AGENTS.md` and `CLAUDE.md` adds the rules: never
modify the toolkit itself, only the configuration it offers; turn profiles on or off in
`profiles:` only when the user asks; and, where `delivery` is active, deliver tranches through the
delivery skill.

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
