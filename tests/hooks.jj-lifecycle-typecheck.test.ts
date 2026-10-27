// URN: test:toolkit:hooks-jj-lifecycle-typecheck:E001-UNIT-001-bound-test-file
// Acceptance: acc:toolkit:E001-UNIT-001-bound-test-file
// Phase: UNIT
// Layer: integration
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import ts from "typescript";

// Published consumers typecheck src/hooks.ts under strict mode. The JJ lifecycle
// error unions must narrow on `"error" in value` without leaking `undefined`.
test("JJ lifecycle error results narrow under strict typechecking", () => {
  const file = resolve(import.meta.dir, "../src/hooks.ts");
  const program = ts.createProgram([file], {
    strict: true, noEmit: true, types: [], skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
  });
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`could not load ${file}`);
  const lifecycle = new Set(["startJjWorktree", "finishJjWorktree", "startTarget", "finishCandidate", "noConflicts", "branchForCommit"]);
  const ranges: Array<[number, number]> = [];
  source.forEachChild(node => {
    if (ts.isFunctionDeclaration(node) && node.name && lifecycle.has(node.name.text)) ranges.push([node.getStart(source), node.getEnd()]);
  });
  expect(ranges).toHaveLength(lifecycle.size);
  const diagnostics = program.getSemanticDiagnostics(source)
    .filter(item => item.start !== undefined && ranges.some(([start, end]) => item.start! >= start && item.start! < end))
    .map(item => {
      const { line } = source.getLineAndCharacterOfPosition(item.start!);
      return `hooks.ts:${line + 1} TS${item.code} ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`;
    });
  expect(diagnostics).toEqual([]);
});
