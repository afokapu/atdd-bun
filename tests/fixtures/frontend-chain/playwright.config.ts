import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.CHAIN_PORT ?? 4317);
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  retries: 0,
  reporter: [["json", { outputFile: process.env.CHAIN_REPORT ?? "playwright-report.json" }]],
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${port}` },
  webServer: { command: "bun src/server.ts", url: `http://127.0.0.1:${port}/`, env: { PORT: String(port) }, reuseExistingServer: false, timeout: 30_000 },
});
