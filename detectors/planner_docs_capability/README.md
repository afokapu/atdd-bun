# Fixtures

These trees are the **code under inspection** — consumer documentation corpora the
detector reads — not this implementation's own test suite.

`clean/` is a complete, valid canonical tree (spec 2 §4): all six authored areas
with their `index.adoc`, documents carrying `:doc-id:` and `:status:`, three of the
four confirmed relationship verbs exercised and every target declared, one ADR with
a `:decides:` edge and a registry that matches its projection.

It also ships `docs/dist/index.md` **on purpose**. Markdown there is render output
and must never be reported by the authored-format rule; a fixture is the only way to
prove the exclusion is real rather than asserted.

Each `dirty_*` tree is `clean/` plus exactly one defect, so that
`test_*_fires_only_*` can prove the nine checks are independent:

| Tree | Defect | Rule |
|---|---|---|
| `dirty_markdown` | `docs/architecture/notes.md` | `planner.docs.asciidoc-only` |
| `dirty_identity` | a document with no attributes | `planner.docs.identity-required` |
| `dirty_duplicate_id` | two documents claiming `purpose.worktrees` | `planner.docs.doc-id-unique` |
| `dirty_unresolved_edge` | `:implements: purpose.wortrees` (a typo) | `planner.docs.graph-target-resolves` |
| `dirty_missing_index` | `docs/delivery/` with its index removed | `planner.docs.area-index-required` |
| `dirty_adr_registry` | ADR-20260906-002 absent from the registry | `planner.docs.adr-registry-derived` |

`dirty_unresolved_edge` carries the **#1758 regression**: the test asserts the graph's
NODE COUNT directly, not merely that a finding was produced. A resolver that reported
the unresolved target *and* synthesized a node for it would pass a findings-only
assertion and reintroduce the exact defect.

The three remaining rules — `artifact-path-shape`, `undeclared-change` and
`reference-integrity` — take a declaration, a change set or a renderer rather than a
tree, so they are exercised inline in the suite instead of by a fixture.
