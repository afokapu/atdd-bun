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

`traceability` is a standalone closure gate:

```text
plan acceptance -> Bun test -> implementation component
```

It reports an untested plan acceptance, an unbound/unknown test reference, an
implementation without `Tested-By:`, and an implementation whose named test does
not exist.

## Corpus proof

`bun test` runs every detector against its clean and dirty fixture trees and
asserts that every declared rule ID both ships with a convention and fires on the
corresponding dirty corpus. The snapshot includes all eleven original Bun
detector families plus the new traceability-closure detector.
