import { defineConfig } from "@playwright/test"
import { join } from "node:path"

export default defineConfig({
  testDir: "./tests", testMatch: "**/*.e2e.ts", fullyParallel: false, workers: 1,
  outputDir: process.env.PI_SCRATCH_DIR ? join(process.env.PI_SCRATCH_DIR, "mygit-browser-results") : "test-results",
  use: { baseURL: "http://127.0.0.1:9347", headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, viewport: { width: 1440, height: 900 }, screenshot: "only-on-failure" },
  webServer: { command: "npm run dev -- --port 9347", url: "http://127.0.0.1:9347", reuseExistingServer: !process.env.CI, timeout: 30000 },
})
