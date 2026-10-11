# DOS residual detector inventory

## Exact reproduction

The read-only DOS evidence worktree was exported from committed head
`1256e26790895997e4014eb2e57aa8f696c7c34e` plus its binary tracked diff
(SHA-256 `336de73e5c1ad2b4849a6de4985ec06e78c92702369b2746e614ae2abfe8a726`)
and the two git-reported untracked files. The disposable export installed the
frozen `@afokapu/atdd-bun@0.10.63` lock and ran `atdd-bun all`.

The raw release output contains **11**, not 12, findings. The reported total
of 12 has no twelfth rule/path/subject in the exact output; the grouped
arithmetic is therefore reconciled as 11.

| Count | Rule and subject | Classification | Truthful behavior / disposition |
| ---: | --- | --- | --- |
| 1 | `coder.bun.dead-code-reachability`, `e2e/support/train-context.ts` | detector false positive | A Bun smoke or e2e test imports the support helper. Test files are executable roots, so their local support graph is reachable. |
| 1 | `coder.bun.journey-runner-boundary`, `src/trains/journey.ts` declaration read | detector false positive | `JourneyRunner` passes its own journey path to a validating `declaration()` helper that reads and parses YAML. |
| 3 | `coder.bun.station-master-interlocking-routing`, `src/server.ts` (`unlinked`, `no-trainrunner-delegation`, `dispatch-bypasses-runners`) | detector false positive | The Station Master returns the mapped `JourneyRunner` execution. The journey owns the bound `InterlockingRunner -> TrainRunner` chain; importing lower runners into the Station Master would be a misleading workaround. |
| 1 | `coder.bun.station-master-journey-routing`, `src/server.ts` (`dispatch-bypasses-runner`) | detector false positive | The exported `executeAction` awaits the mapped journey once, preserves that result through source enrichment, and returns it. |
| 3 | `tester.bun.interlocking-smoke-coverage-for-station-master`, scenario/replay/source interlockings | detector false positive | Each smoke calls the production Station Master action and asserts its observable result. The same proven journey chain supplies the runner proof. |
| 2 | `traceability.plan.executable-acceptance-has-test`, cancel-world-compilation and prepare-source-corpus | detector false positive | Each acceptance is present in a Bun test header. A duplicated test URN previously overwrote earlier bindings; all bindings must be retained. |
| 1 | `coder.bun.journey-runner-boundary`, `src/trains/journey.ts` continuation traversal | genuine DOS behavioral gap | After a matching continuation, execution must advance to the declared next interlocking and return the declared terminal outcome (or expose a deliberately bounded, separately declared continuation contract). The observed runtime returns after the entrypoint route instead. |

The committed regression tests use minimal truthful shapes and paired mutants for the
support-reachability, declaration-helper, Station Master chain, and duplicated-binding
classes. They retain the genuine continuation finding rather than weakening its rule.
