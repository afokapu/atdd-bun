# Planner port boundary

This package is Python-free for Bun enforcement. It deliberately does not claim
to port ATDD's full planner yet.

## Portable planner kernel

The package ships 195 canonical convention nodes in `planner-nodes/` and
21 schemas in `planner-schemas/`. It does not ship Python validator files:
they are executable Python/pytest code, not portable package assets. Port each
selected validator into Bun/TypeScript before enabling it in a `planner` profile.

1. Plan artifact schemas and canonical paths: wagon, feature, WMBT, acceptance,
   train, contract, interlocking, and journey-topology documents.
2. URN and naming grammar, including wagon/feature/WMBT chains.
3. Plan graph references: wagon-to-feature, WMBT-to-acceptance, train registry
   and participant/sequence references, contract registry references.
4. Static interlocking route declarations and their digest/registry invariants.
5. Journey topology closure across interlockings, bound through artifacts produced by the selected train.

## Port status

Enabled in the Bun `planner` profile (clean against ATDD's current plan and with a
dirty fixture per emitted rule):

- wagon identity and duplicate wagon slugs;
- wagon URN naming;
- duplicate produced artifact and feature declarations;
- produce/consume destination and source validity, including direct self-cycles;
- duplicate contract and telemetry ownership.
- train registry/document coherence in both directions.
- journey continuation closure across reachable interlocking routes.

The current source surface has 63 Python validator modules and 372 test cases.
The remaining modules are deliberately not represented as inert Python or as a
claim of parity. Each is admitted only after its applicability rules, clean real
plan baseline, and fault cases are reproduced under Bun.

These rules validate committed files and have no need for ATDD runtime state.

## Not a package concern

Do not port these into this package without a separate product decision:

- interactive `atdd plan` sessions, ratify/author state, and generated issue bodies;
- GitHub, local-store, coach, and runtime integrations;
- ATDD substrate admission, rule binding, dispositions, or suppressions.

They are orchestration capabilities, not Bun repository enforcement.

## Parity requirement

The current Python planner contains 197 convention nodes, 18 schemas, and 78 files
under its validators surface. A TypeScript port is accepted only when each selected
validator has a clean fixture, a fault fixture, and a Bun test proving both outcomes.
