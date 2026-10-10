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
a managed block in `AGENTS.md` and `CLAUDE.md`, and `atdd-bun.integrity.test.ts`. Commit all of
them. Nothing is overwritten
without `--replace`, and adding the dependency changes nothing until you run `init`.

Then require the workflow's job in the GitHub branch ruleset, so it gates merges.

For a declared GitHub Packages scope in `.npmrc` (for example,
`@forgeonehundred:registry=https://npm.pkg.github.com`), run
`bun run atdd-bun ci init --replace`. The generator preserves that scope and adds
only `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}`; the generated workflow
supplies the ephemeral Actions token to its frozen install step. It refuses an
existing stored token rather than reading, copying, or replacing it.

## Commands

| Command | What it does |
|---|---|
| `atdd-bun [profile ...] [--root <path>]` | Enforce the named profiles; `all` (the default) runs every activated one |
| `atdd-bun init [--replace]` | Install hooks, CI, agent files and the integrity test |
| `atdd-bun hooks <install\|uninstall\|status>` | Manage only the Git hooks |
| `atdd-bun ci <init\|status>` | Manage only the CI workflow |
| `atdd-bun agent <init\|status>` | Manage the `AGENTS.md`/`CLAUDE.md` instruction block |
| `atdd-bun profiles registry [--check]` | Generate (or verify) deterministic profile-scoped convention registries |
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
| `docs` | the documentation capability, including the generated journey view |
| `coder`, `tester`, `security`, `architecture`, `metrics`, `runtime` | Bun source and test conventions |
| `interlocking` | train/interlocking binding, infrastructure and route coverage |
| `htmx` | htmx source/test conventions and Playwright browser specs (`*.e2e.ts`) |
| `design` | design-system layering, token-only styling and responsiveness |
| `flow` | optional ATDD Flow companion conventions for durable seats, tasks and threads |
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

### Flow profile compatibility

`flow` is the canonical optional profile name. For a compatible upgrade, a legacy explicit
`workflow` entry in `atdd-bun.yaml`, or a direct `bun run atdd-bun workflow`, normalizes to
`flow`; it does not make unrelated names valid. `flow` requires `@afokapu/atdd-bun` **0.10.45 or
newer**. If a checkout reports that `flow` is unknown, it is running a stale toolkit: run
`bun update @afokapu/atdd-bun`, then use the repository-local command
`bun run atdd-bun flow --root .` (never a PATH-global `atdd-bun`). Keep `flow` in newly edited
configuration.

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
worktrees: { enabled: false }                 # enabled defaults to ~/Github/worktrees/<repo>/...
release: { enabled: false }
```

When enabled without overrides, a primary checkout at `~/Github/<repo>` uses linked worktrees at `~/Github/worktrees/<repo>/<branch>`. The defaults use `primary_directory: .` (the current primary checkout) and `root: ../worktrees/{repo}`; `{repo}` expands to the primary checkout's directory name. Repositories that need another layout can set either field explicitly.

## Exact-base finding ratchet (opt-in)

Strict enforcement is the default: `bun run atdd-bun all` still fails for every finding. A consumer may opt into an exact-base comparison for one explicit profile set:

```yaml
# atdd-bun.yaml
ratchet:
  mode: report       # or reject-new
  profiles: [coder, tester]
```

Run it only against a full reviewed base SHA:

```sh
bun run atdd-bun coder tester --ratchet --base <40-character-reviewed-main-sha>
```

The command runs the same installed detectors against an isolated exact base and the clean candidate, emits a redacted JSON `carried`/`new`/`resolved` fingerprint report, and never writes or accepts a baseline. `report` records debt without changing command success; `reject-new` exits non-zero only when the candidate adds a finding absent from the equivalent base. The declared `ratchet.profiles` must exactly match the command's effective profiles. Base and candidate profile/context digests must match or comparison fails closed; profile/config adoption is separately governed. Use debt-remediation branches to remove carried findings. Direct implementation profiles can opt in only through this explicit policy and do not alter configured merge profiles or `profiles:`.

Fingerprints are SHA-256 of a versioned rule, normalized repository-relative path, and semantic subject where supplied; line/column, rendered evidence, source text, absolute paths, and runtime data are excluded. Ratchet findings are unrelated to Bun `test.failing()` or JUnit/behavioral-test baselines.

### One-time explicit profile activation

When an existing exact main has debt under a smaller explicit profile list, a separately governed adoption commit may expand that list without accepting the debt. The base and candidate are both judged with the candidate's newly selected profile set, so old findings are `carried`, candidate-only findings remain `new` and reject `reject-new`, and removals are reported as `resolved`:

```sh
bun run atdd-bun --profile flow,traceability --ratchet --ratchet-activate-profiles --base <40-character-reviewed-main-sha>
```

This is an activation-only exception to the ordinary equal-context rule, not a baseline migration. It requires an explicit candidate `profiles:` list, an explicit base list that is a strict subset of it, and identical non-profile policy/configuration. A removal, implicit/default-list adoption, unrelated configuration change, dirty tree, unavailable/non-ancestor base, or omission of `--ratchet-activate-profiles` fails closed. The command stores no activation state or accepted findings; after the governed expansion lands, use ordinary `--ratchet` with exact matching context. Strict non-ratchet enforcement remains unchanged.

## Docs-site theme

A repository that publishes its AsciiDoc docs as a site does not need its own theme.
`templates/docs/site.css` styles Asciidoctor's default HTML5 output (`toc: left`), light and
dark, and is clean under the `design` profile. Use it from the package rather than copying it,
so it stays out of your scans and updates with the toolkit. Asciidoctor embeds it into each page;
write the site to `dist/`, which no profile scans:

```sh
asciidoctor -a stylesheet="$PWD/node_modules/@afokapu/atdd-bun/templates/docs/site.css" -D dist docs/index.adoc
```

To re-theme it, override its custom properties (`--paper`, `--ink`, `--accent`, `--sans`, …) on
`:root` in a stylesheet of your own, using your design tokens.

## Agents and integrity

The managed block directs an agent to the profile-preset convention, then to the selected profile's
generated registry under `conventions/_profiles/`. Each registry is a deterministic projection of
the profile's detector manifests, convention paths, and direct relationship edges, so the agent
opens only the conventions relevant to its task. It also prevents the agent from modifying the
toolkit or changing profile activation without the user's choice.

For a live ATDD Flow Desk, that managed block additionally requires the provisioned `atdd-flow`
command: an agent must not use `bunx` to fetch another Flow version, initialize an existing Desk,
or rewrite a Desk/project/seat/runtime record to work around a missing command or a pane mismatch.
It reports the prerequisite or binding problem to the operator/coordinator instead. Refresh an
existing consumer's managed block with `bun run atdd-bun agent init --replace` after upgrading.

`atdd-bun integrity`, run by the generated test and first in CI on a clean install, fails when:

- the installed package differs from its published hashes;
- the dependency is not an npm registry version;
- a generated file (workflow, instruction block, integrity test) was edited;
- `atdd-bun.yaml` is looser than on the base branch (after the first explicit `profiles:` list,
  dropping a profile or the list counts).

Each finding names its restore command.

## Staying up to date

Every merge to this package's `main` is published to npm with provenance as the next patch and
tagged `vX.Y.Z`. Rules and hooks change as soon as a repository upgrades the dependency. To refresh
the managed instruction blocks on every install, add this to the repository's own
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
