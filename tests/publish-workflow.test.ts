import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");

test("Publish runs for every push to main and preserves its release gates", () => {
  expect(workflow).toMatch(/push:\n\s+branches: \[main\]/);
  expect(workflow).not.toMatch(/^\s+paths:/m);
  expect(workflow).toContain("workflow_dispatch:");
  expect(workflow).toContain("contents: write");
  expect(workflow).toContain("id-token: write");
  expect(workflow).toContain("bun install --frozen-lockfile");
  expect(workflow).toContain("playwright install --with-deps chromium");
  expect(workflow).toContain("- run: bun test");
  expect(workflow).toContain('name: Compute next version');
  expect(workflow).toContain('npm version "${{ steps.version.outputs.next }}" --no-git-tag-version --allow-same-version');
  expect(workflow).toContain('name: Write integrity manifest');
  expect(workflow).toContain("npm publish --provenance --access public");
  expect(workflow).not.toMatch(/(?:secrets\.|^\s*)NPM_TOKEN(?:\s*:|\s*}})/m);
  expect(workflow).toContain('git tag "v${{ steps.version.outputs.next }}"');
});
